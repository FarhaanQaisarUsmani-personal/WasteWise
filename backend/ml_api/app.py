import base64
import io
import os
from functools import lru_cache
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
    def __init__(self, num_food_classes: int, num_spoilage_classes: int):
        super().__init__()
        backbone = models.resnet50(weights=None)
        feature_dim = backbone.fc.in_features
        backbone.fc = nn.Identity()

        self.backbone = backbone
        self.food_head = nn.Linear(feature_dim, num_food_classes)
        self.spoilage_head = nn.Linear(feature_dim, num_spoilage_classes)

    def forward(self, inputs: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        features = self.backbone(inputs)
        return self.food_head(features), self.spoilage_head(features)


class ModelBundle:
    def __init__(self):
        checkpoint = torch.load(MODEL_PATH, map_location=self.device)
        food_to_idx = checkpoint.get("food_to_idx", {})
        if not food_to_idx:
            raise RuntimeError("Checkpoint is missing food label metadata.")

        self.idx_to_food = {index: label for label, index in food_to_idx.items()}
        spoilage_classes = checkpoint["model_state_dict"]["spoilage_head.bias"].shape[0]
        configured_labels = [
            label.strip()
            for label in os.getenv("SPOILAGE_LABELS", ",".join(DEFAULT_SPOILAGE_LABELS)).split(",")
            if label.strip()
        ]
        if len(configured_labels) != spoilage_classes:
            configured_labels = [f"stage-{index}" for index in range(spoilage_classes)]
        self.spoilage_labels = configured_labels

        self.image_size = int(checkpoint.get("config", {}).get("image_size", 224))
        self.food_threshold = float(os.getenv("MODEL_CONFIDENCE_THRESHOLD", "0.62"))
        self.margin_threshold = float(os.getenv("MODEL_MARGIN_THRESHOLD", "0.18"))

        self.model = WasteWiseClassifier(
            num_food_classes=len(self.idx_to_food),
            num_spoilage_classes=spoilage_classes,
        )
        self.model.load_state_dict(checkpoint["model_state_dict"])
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
            food_logits, spoilage_logits = self.model(tensor)
            food_probs = torch.softmax(food_logits, dim=1)[0]
            spoilage_probs = torch.softmax(spoilage_logits, dim=1)[0]

        top_values, top_indices = torch.topk(food_probs, k=min(3, food_probs.shape[0]))
        top_confidence = float(top_values[0].item())
        second_confidence = float(top_values[1].item()) if top_values.shape[0] > 1 else 0.0
        margin = top_confidence - second_confidence

        if top_confidence < self.food_threshold or margin < self.margin_threshold:
            return AnalyzeResponse(
                type="unknown",
                message=(
                    "The uploaded checkpoint is not confident this image matches one of the trained food classes. "
                    "Try a clearer close-up of the food item."
                ),
                confidence=round(top_confidence, 4),
                topPredictions=self._top_predictions(top_values, top_indices),
            )

        food_index = int(top_indices[0].item())
        spoilage_index = int(torch.argmax(spoilage_probs).item())
        spoilage_confidence = float(spoilage_probs[spoilage_index].item())
        condition = self.spoilage_labels[spoilage_index]

        return AnalyzeResponse(
            type="food",
            item=self.idx_to_food[food_index],
            condition=condition,
            suggestions=self._suggestions_for(condition),
            confidence=round(top_confidence, 4),
            conditionConfidence=round(spoilage_confidence, 4),
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


@lru_cache(maxsize=1)
def get_model_bundle() -> ModelBundle:
    if not os.path.exists(MODEL_PATH):
        raise RuntimeError(f"Model checkpoint not found at {MODEL_PATH}")
    return ModelBundle()


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
        "classes": len(bundle.idx_to_food),
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
