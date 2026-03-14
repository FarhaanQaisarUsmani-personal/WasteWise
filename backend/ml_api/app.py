import base64
import io
import math
import os
from typing import Literal

import torch
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from PIL import Image, ImageOps, UnidentifiedImageError
from torch import nn
from torchvision import models, transforms


MODEL_PATH = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "../../models/checkpoints/best_model.pt")
)
DEFAULT_SPOILAGE_LABELS = ["fresh", "ripe", "aging", "overripe", "spoiled"]
IMAGE_MEAN = [0.485, 0.456, 0.406]
IMAGE_STD = [0.229, 0.224, 0.225]
DEFAULT_UNKNOWN_LABELS = "non_food,non-food,non food,background,other,unknown,not_food"

MODEL_RUNTIME_CACHE: dict[str, object | None] = {"bundle": None, "mtime": None}


class AnalyzeRequest(BaseModel):
    image: str
    mimeType: str


class AnalyzeResponse(BaseModel):
    type: Literal["food", "unknown"]
    item: str | None = None
    condition: str | None = None
    suggestions: list[str] | None = None
    message: str | None = None
    confidence: float | None = None
    conditionConfidence: float | None = None
    topPredictions: list[dict[str, float | str]] | None = None


class WasteWiseClassifier(nn.Module):
    def __init__(
        self,
        model_name: str,
        num_food_classes: int,
        num_spoilage_classes: int,
        num_is_food_classes: int = 0,
    ):
        super().__init__()

        backbone, feature_dim = self._build_backbone(model_name)

        self.backbone = backbone
        self.food_head = nn.Linear(feature_dim, num_food_classes)
        self.spoilage_head = (
            nn.Linear(feature_dim, num_spoilage_classes) if num_spoilage_classes > 0 else None
        )
        self.is_food_head = (
            nn.Linear(feature_dim, num_is_food_classes) if num_is_food_classes > 0 else None
        )

    def forward(
        self, inputs: torch.Tensor
    ) -> tuple[torch.Tensor, torch.Tensor | None, torch.Tensor | None]:
        features = self.backbone(inputs)
        spoilage_logits = self.spoilage_head(features) if self.spoilage_head is not None else None
        is_food_logits = self.is_food_head(features) if self.is_food_head is not None else None
        return self.food_head(features), spoilage_logits, is_food_logits

    def _build_backbone(self, model_name: str) -> tuple[nn.Module, int]:
        normalized = (model_name or "resnet50").strip().lower()

        if normalized == "resnet50":
            backbone = models.resnet50(weights=None)
            feature_dim = backbone.fc.in_features
            backbone.fc = nn.Identity()
            return backbone, feature_dim

        if normalized == "resnet18":
            backbone = models.resnet18(weights=None)
            feature_dim = backbone.fc.in_features
            backbone.fc = nn.Identity()
            return backbone, feature_dim

        if normalized == "efficientnet_v2_s":
            backbone = models.efficientnet_v2_s(weights=None)
            if not isinstance(backbone.classifier, nn.Sequential):
                raise RuntimeError("Unsupported efficientnet classifier format.")
            last_layer = backbone.classifier[-1]
            if not isinstance(last_layer, nn.Linear):
                raise RuntimeError("Unsupported efficientnet classifier head type.")
            feature_dim = last_layer.in_features
            backbone.classifier = nn.Identity()
            return backbone, feature_dim

        raise RuntimeError(
            f"Unsupported model_name '{model_name}'. Supported values: resnet50, resnet18, efficientnet_v2_s"
        )


class ModelBundle:
    def __init__(self):
        checkpoint = torch.load(MODEL_PATH, map_location=self.device)
        config = checkpoint.get("config", {})
        self.model_name = str(config.get("model_name", "resnet50"))

        food_to_idx = checkpoint.get("food_to_idx", {})
        if not food_to_idx:
            raise RuntimeError("Checkpoint is missing food label metadata.")

        self.idx_to_food = {index: label for label, index in food_to_idx.items()}
        unknown_candidates = {
            label.strip().lower()
            for label in os.getenv("MODEL_UNKNOWN_LABELS", DEFAULT_UNKNOWN_LABELS).split(",")
            if label.strip()
        }
        self.unknown_labels = {
            label.lower() for label in self.idx_to_food.values() if label.lower() in unknown_candidates
        }

        state_dict = checkpoint.get("model_state_dict", {})
        spoilage_bias = state_dict.get("spoilage_head.bias")
        spoilage_classes = int(spoilage_bias.shape[0]) if spoilage_bias is not None else 0
        is_food_bias = state_dict.get("is_food_head.bias")
        self.is_food_classes = int(is_food_bias.shape[0]) if is_food_bias is not None else 0
        configured_labels = [
            label.strip()
            for label in os.getenv("SPOILAGE_LABELS", ",".join(DEFAULT_SPOILAGE_LABELS)).split(",")
            if label.strip()
        ]
        if spoilage_classes == 0:
            configured_labels = []
        elif len(configured_labels) != spoilage_classes:
            configured_labels = [f"stage-{index}" for index in range(spoilage_classes)]
        self.spoilage_labels = configured_labels

        self.image_size = int(config.get("image_size", 224))
        # Non-food rejection uses multiple signals to avoid accepting arbitrary objects.
        self.food_threshold = float(os.getenv("MODEL_CONFIDENCE_THRESHOLD", "0.82"))
        self.margin_threshold = float(os.getenv("MODEL_MARGIN_THRESHOLD", "0.30"))
        self.entropy_threshold = float(os.getenv("MODEL_ENTROPY_THRESHOLD", "0.72"))
        self.spoilage_threshold = float(os.getenv("MODEL_SPOILAGE_CONFIDENCE_THRESHOLD", "0.40"))
        self.is_food_threshold = float(os.getenv("MODEL_IS_FOOD_THRESHOLD", "0.60"))

        self.model = WasteWiseClassifier(
            model_name=self.model_name,
            num_food_classes=len(self.idx_to_food),
            num_spoilage_classes=spoilage_classes,
            num_is_food_classes=self.is_food_classes,
        )
        self.model.load_state_dict(state_dict, strict=False)
        self.model.to(self.device)
        self.model.eval()

        resize_size = int(round(self.image_size * 256 / 224))
        self.preprocess = transforms.Compose(
            [
                transforms.Resize(resize_size),
                transforms.CenterCrop(self.image_size),
                transforms.ToTensor(),
                transforms.Normalize(mean=IMAGE_MEAN, std=IMAGE_STD),
            ]
        )

    @property
    def device(self) -> torch.device:
        if torch.backends.mps.is_available():
            return torch.device("mps")
        return torch.device("cpu")

    def analyze(self, image_bytes: bytes) -> AnalyzeResponse:
        try:
            image = Image.open(io.BytesIO(image_bytes))
        except UnidentifiedImageError as error:
            raise HTTPException(status_code=400, detail="Unsupported image data.") from error

        image = ImageOps.exif_transpose(image).convert("RGB")
        tensor = self.preprocess(image).unsqueeze(0).to(self.device)

        with torch.inference_mode():
            food_logits, spoilage_logits, is_food_logits = self.model(tensor)
            food_probs = torch.softmax(food_logits, dim=1)[0]
            spoilage_probs = (
                torch.softmax(spoilage_logits, dim=1)[0] if spoilage_logits is not None else None
            )
            is_food_prob = self._is_food_probability(is_food_logits)

        top_values, top_indices = torch.topk(food_probs, k=min(3, food_probs.shape[0]))
        top_confidence = float(top_values[0].item())
        second_confidence = float(top_values[1].item()) if top_values.shape[0] > 1 else 0.0
        margin = top_confidence - second_confidence
        entropy = self._normalized_entropy(food_probs)
        spoilage_top_confidence = (
            float(torch.max(spoilage_probs).item()) if spoilage_probs is not None else 1.0
        )

        food_index = int(top_indices[0].item())
        predicted_label = self.idx_to_food[food_index]

        if predicted_label.lower() in self.unknown_labels:
            return AnalyzeResponse(
                type="unknown",
                message="This object looks non-food to the model. Please scan a food item.",
                confidence=round(top_confidence, 4),
                topPredictions=self._top_predictions(top_values, top_indices),
            )

        if is_food_prob is not None and is_food_prob < self.is_food_threshold:
            return AnalyzeResponse(
                type="unknown",
                message="The model identified this as non-food. Please scan a food item.",
                confidence=round(is_food_prob, 4),
                topPredictions=self._top_predictions(top_values, top_indices),
            )

        if (
            top_confidence < self.food_threshold
            or margin < self.margin_threshold
            or entropy > self.entropy_threshold
            or spoilage_top_confidence < self.spoilage_threshold
        ):
            return AnalyzeResponse(
                type="unknown",
                message=(
                    "This scan does not confidently match a known food item. "
                    "Try centering a clear food close-up and scan again."
                ),
                confidence=round(top_confidence, 4),
                topPredictions=self._top_predictions(top_values, top_indices),
            )

        spoilage_index = int(torch.argmax(spoilage_probs).item()) if spoilage_probs is not None else -1
        spoilage_confidence = (
            float(spoilage_probs[spoilage_index].item()) if spoilage_probs is not None else None
        )
        condition = self.spoilage_labels[spoilage_index] if spoilage_probs is not None else "unknown"

        return AnalyzeResponse(
            type="food",
            item=predicted_label,
            condition=condition,
            suggestions=self._suggestions_for(condition),
            confidence=round(top_confidence, 4),
            conditionConfidence=round(spoilage_confidence, 4) if spoilage_confidence is not None else None,
            topPredictions=self._top_predictions(top_values, top_indices),
        )

    def _top_predictions(
        self, values: torch.Tensor, indices: torch.Tensor
    ) -> list[dict[str, float | str]]:
        predictions: list[dict[str, float | str]] = []
        for value, index in zip(values.tolist(), indices.tolist()):
            predictions.append(
                {
                    "label": self.idx_to_food[int(index)],
                    "confidence": round(float(value), 4),
                }
            )
        return predictions

    def _normalized_entropy(self, probs: torch.Tensor) -> float:
        # Normalize entropy to [0, 1] regardless of class count.
        clipped = torch.clamp(probs, min=1e-8)
        entropy = float((-clipped * torch.log(clipped)).sum().item())
        max_entropy = math.log(float(probs.shape[0])) if probs.shape[0] > 1 else 1.0
        return entropy / max_entropy

    def _is_food_probability(self, is_food_logits: torch.Tensor | None) -> float | None:
        if is_food_logits is None:
            return None

        logits = is_food_logits[0]
        if logits.shape[0] == 1:
            return float(torch.sigmoid(logits[0]).item())

        probs = torch.softmax(logits, dim=0)
        # By convention we treat index 1 as "food" for a 2-logit head.
        if logits.shape[0] >= 2:
            return float(probs[1].item())

        return None

    def _suggestions_for(self, condition: str) -> list[str]:
        normalized = condition.lower()
        if normalized in {"fresh", "ripe"}:
            return [
                "Store it properly now to extend shelf life.",
                "Use it in your next meal while quality is high.",
            ]
        if normalized in {"aging", "overripe"}:
            return [
                "Use it today in smoothies, soups, sauces, or stir-fries.",
                "Cut and freeze leftovers before quality drops further.",
                "Prep it now so it does not get forgotten in storage.",
            ]
        if normalized == "spoiled":
            return [
                "Inspect it closely before eating and discard it if there are signs of mold or off odors.",
                "Separate it from other produce to avoid spreading spoilage.",
            ]
        return ["Review the image manually if the condition does not look right."]


def get_model_bundle() -> ModelBundle:
    if not os.path.exists(MODEL_PATH):
        raise RuntimeError(f"Model checkpoint not found at {MODEL_PATH}")

    model_mtime = os.path.getmtime(MODEL_PATH)
    cached_bundle = MODEL_RUNTIME_CACHE["bundle"]
    cached_mtime = MODEL_RUNTIME_CACHE["mtime"]
    if cached_bundle is None or cached_mtime != model_mtime:
        MODEL_RUNTIME_CACHE["bundle"] = ModelBundle()
        MODEL_RUNTIME_CACHE["mtime"] = model_mtime

    return MODEL_RUNTIME_CACHE["bundle"]


app = FastAPI(title="WasteWise ML API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health_check() -> dict[str, str | int]:
    bundle = get_model_bundle()
    return {
        "status": "ok",
        "model": os.path.basename(MODEL_PATH),
        "model_name": bundle.model_name,
        "classes": len(bundle.idx_to_food),
        "unknown_labels": len(bundle.unknown_labels),
    }


@app.post("/api/analyze", response_model=AnalyzeResponse)
def analyze_image(request: AnalyzeRequest) -> AnalyzeResponse:
    try:
        image_bytes = base64.b64decode(request.image, validate=True)
    except ValueError as error:
        raise HTTPException(status_code=400, detail="Invalid base64 image payload.") from error

    if not image_bytes:
        raise HTTPException(status_code=400, detail="Image payload is empty.")

    return get_model_bundle().analyze(image_bytes)
