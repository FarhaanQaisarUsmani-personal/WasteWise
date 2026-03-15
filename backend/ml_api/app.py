import base64
import io
import json
import math
import os
from typing import Literal
from urllib import error as urlerror
from urllib import request as urlrequest

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
DEFAULT_GEMINI_MODEL = "gemini-2.5-flash"

MODEL_RUNTIME_CACHE: dict[str, object | None] = {"bundle": None, "mtime": None}


class AnalyzeRequest(BaseModel):
    image: str
    mimeType: str


class AnalyzeResponse(BaseModel):
    type: Literal["food", "unknown"]
    item: str | None = None
    condition: str | None = None
    suggestions: list[str] | None = None
    etaRange: str | None = None
    repurposingActions: list[str] | None = None
    message: str | None = None
    confidence: float | None = None
    conditionConfidence: float | None = None
    topPredictions: list[dict[str, float | str]] | None = None


class GeminiOutputGenerator:
    def __init__(self):
        self.api_key = os.getenv("GEMINI_API_KEY", "").strip()
        self.model = os.getenv("GEMINI_MODEL", DEFAULT_GEMINI_MODEL).strip() or DEFAULT_GEMINI_MODEL

    @property
    def enabled(self) -> bool:
        return bool(self.api_key)

    def generate_food_analysis(
        self,
        item: str,
        condition: str,
        confidence: float,
        top_predictions: list[dict[str, float | str]],
    ) -> str | None:
        if not self.enabled:
            return None

        top_str = ", ".join(
            [f"{prediction['label']} ({prediction['confidence']})" for prediction in top_predictions]
        )
        prompt = (
            "You are helping the WasteWise app summarize model food-scan results. "
            "Return strict JSON only with this schema: "
            '{"message": string}. '
            "Keep message under 140 characters. "
            "Give a short user-friendly confirmation of detected food type and confidence. "
            f"Detected item: {item}. Condition: {condition}. Confidence: {confidence}. "
            f"Top predictions: {top_str}."
        )
        output = self._generate_json(prompt)
        if not isinstance(output, dict):
            return None

        message = output.get("message")
        return message if isinstance(message, str) else None

    def generate_non_food_analysis(
        self,
        top_predictions: list[dict[str, float | str]],
        reason: str,
    ) -> str | None:
        if not self.enabled:
            return None

        top_str = ", ".join(
            [f"{prediction['label']} ({prediction['confidence']})" for prediction in top_predictions]
        )
        prompt = (
            "You are helping the WasteWise app explain non-food rejection from a model scan. "
            "Return strict JSON only with this schema: "
            '{"message": string}. '
            "Keep message under 120 characters. "
            "It should clearly tell the user this is not food and to try again. "
            f"Reason: {reason}. "
            f"Top predictions: {top_str}."
        )
        output = self._generate_json(prompt)
        if not isinstance(output, dict):
            return None

        message = output.get("message")
        return message if isinstance(message, str) else None

    def generate_suggestions(
        self,
        item: str,
        condition: str,
        confidence: float,
    ) -> list[str] | None:
        if not self.enabled:
            return None

        prompt = (
            "You are helping the WasteWise app provide practical usage suggestions for scanned food. "
            "Return strict JSON only with this schema: "
            '{"suggestions": ["suggestion1", "suggestion2", "suggestion3"]}. '
            "Generate 2-3 actionable suggestions based on the food type and ripeness condition. "
            "Each suggestion should be under 80 characters and provide practical advice. "
            "Include: optimal consumption timeframe, storage tips, preparation ideas, or warnings. "
            "Tailor suggestions based on condition (fresh=eat now, ripe=ready, aging=cook, overripe=process, spoiled=discard). "
            f"Food item: {item}. "
            f"Condition: {condition}. "
            f"Confidence: {confidence}."
        )
        output = self._generate_json(prompt)
        if not isinstance(output, dict):
            return None

        suggestions = output.get("suggestions")
        if isinstance(suggestions, list) and all(isinstance(s, str) for s in suggestions):
            return suggestions
        return None

    def generate_eta_and_repurposing(
        self,
        item: str,
        condition: str,
        confidence: float,
    ) -> dict | None:
        if not self.enabled:
            return None

        prompt = (
            "You are helping the WasteWise app provide practical timeline and repurposing options for scanned food. "
            "Return strict JSON only with this schema: "
            '{"etaRange": string, "repurposingActions": ["action1", "action2", "action3"]}. '
            "Generate a realistic ETA showing how many days until the food reaches the next spoilage stage. "
            "For spoiled items, write 'Already spoiled - do not eat'. "
            "For fresh/ripe items, include storage method (e.g. room temp, fridge). "
            "Generate 2-3 practical repurposing actions the user can take before it spoils. "
            "Each action should be under 60 characters and mention: consumption timing, storage, preparation, or usage ideas. "
            "Tailor actions based on condition: fresh/ripe=storage/consumption, aging=cooking, overripe=smoothies/baking/jam, spoiled=composting/discard. "
            f"Food item: {item}. "
            f"Condition: {condition}."
        )
        output = self._generate_json(prompt)
        if not isinstance(output, dict):
            return None

        eta_range = output.get("etaRange")
        repurposing = output.get("repurposingActions")

        if isinstance(eta_range, str) and isinstance(repurposing, list):
            if all(isinstance(a, str) for a in repurposing):
                return {"etaRange": eta_range, "repurposingActions": repurposing}

        return None

    def _generate_json(self, prompt: str) -> dict | None:
        payload = {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {
                "responseMimeType": "application/json",
                "temperature": 0.3,
            },
        }
        endpoint = (
            f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:generateContent"
            f"?key={self.api_key}"
        )
        request_data = json.dumps(payload).encode("utf-8")
        req = urlrequest.Request(
            endpoint,
            data=request_data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )

        try:
            with urlrequest.urlopen(req, timeout=8) as response:
                body = response.read().decode("utf-8")
            parsed = json.loads(body)
            candidates = parsed.get("candidates", [])
            if not candidates:
                return None
            parts = candidates[0].get("content", {}).get("parts", [])
            if not parts:
                return None
            text = parts[0].get("text", "")
            return json.loads(text)
        except (urlerror.URLError, json.JSONDecodeError, TimeoutError, ValueError):
            return None


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
        self.gemini = GeminiOutputGenerator()

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

        top_predictions = self._top_predictions(top_values, top_indices)

        if predicted_label.lower() in self.unknown_labels:
            reason = "predicted class is configured as non-food/unknown"
            unknown_message = self.gemini.generate_non_food_analysis(top_predictions, reason)
            return AnalyzeResponse(
                type="unknown",
                message=unknown_message
                or "This object looks non-food to the model. Please scan a food item.",
                confidence=round(top_confidence, 4),
                topPredictions=top_predictions,
            )

        if is_food_prob is not None and is_food_prob < self.is_food_threshold:
            reason = "model is_food head confidence is below threshold"
            unknown_message = self.gemini.generate_non_food_analysis(top_predictions, reason)
            return AnalyzeResponse(
                type="unknown",
                message=unknown_message or "The model identified this as non-food. Please scan a food item.",
                confidence=round(is_food_prob, 4),
                topPredictions=top_predictions,
            )

        if (
            top_confidence < self.food_threshold
            or margin < self.margin_threshold
            or entropy > self.entropy_threshold
            or spoilage_top_confidence < self.spoilage_threshold
        ):
            reason = "model confidence checks failed for known food classes"
            unknown_message = self.gemini.generate_non_food_analysis(top_predictions, reason)
            return AnalyzeResponse(
                type="unknown",
                message=unknown_message
                or (
                    "This scan does not confidently match a known food item. "
                    "Try centering a clear food close-up and scan again."
                ),
                confidence=round(top_confidence, 4),
                topPredictions=top_predictions,
            )

        spoilage_index = int(torch.argmax(spoilage_probs).item()) if spoilage_probs is not None else -1
        spoilage_confidence = (
            float(spoilage_probs[spoilage_index].item()) if spoilage_probs is not None else None
        )
        condition = self.spoilage_labels[spoilage_index] if spoilage_probs is not None else "unknown"
        gemini_message = self.gemini.generate_food_analysis(
            item=predicted_label,
            condition=condition,
            confidence=top_confidence,
            top_predictions=top_predictions,
        )
        suggestions = self.gemini.generate_suggestions(
            item=predicted_label,
            condition=condition,
            confidence=top_confidence,
        )
        eta_repurpose = self.gemini.generate_eta_and_repurposing(
            item=predicted_label,
            condition=condition,
            confidence=top_confidence,
        )
        fallback_message = (
            f"Detected {predicted_label} with {round(top_confidence * 100)}% confidence."
        )

        return AnalyzeResponse(
            type="food",
            item=predicted_label,
            condition=condition,
            suggestions=suggestions,
            etaRange=eta_repurpose.get("etaRange") if eta_repurpose else None,
            repurposingActions=eta_repurpose.get("repurposingActions") if eta_repurpose else None,
            message=gemini_message or fallback_message,
            confidence=round(top_confidence, 4),
            conditionConfidence=round(spoilage_confidence, 4) if spoilage_confidence is not None else None,
            topPredictions=None,
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
