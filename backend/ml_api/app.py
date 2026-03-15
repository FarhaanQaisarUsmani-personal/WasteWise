import base64
import io
import json
import math
import os
import re
from typing import Literal
from urllib import error as urlerror
from urllib import request as urlrequest

import torch
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import numpy as np
from pydantic import BaseModel
from PIL import Image, ImageOps, UnidentifiedImageError
from torch import nn
from torchvision import models, transforms


def _load_env_file() -> None:
    env_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../.env"))
    if not os.path.exists(env_path):
        return

    try:
        with open(env_path, "r", encoding="utf-8") as env_file:
            for raw_line in env_file:
                line = raw_line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue

                key, value = line.split("=", 1)
                key = key.strip()
                if not key or key in os.environ:
                    continue

                value = value.strip()
                if len(value) >= 2 and value[0] == value[-1] and value[0] in {"\"", "'"}:
                    value = value[1:-1]

                os.environ[key] = value
    except OSError:
        return


_load_env_file()


MODEL_PATH = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "../../models/checkpoints/best_model.pt")
)
DEFAULT_SPOILAGE_LABELS = ["fresh", "ripe", "aging", "overripe", "spoiled"]
IMAGE_MEAN = [0.485, 0.456, 0.406]
IMAGE_STD = [0.229, 0.224, 0.225]
DEFAULT_UNKNOWN_LABELS = "non_food,non-food,non food,background,other,unknown,not_food"
DEFAULT_RECEIPT_LABELS = "receipt,receipt_food,food_receipt"
DEFAULT_GEMINI_MODEL = "gemini-2.5-flash"

MODEL_RUNTIME_CACHE: dict[str, object | None] = {"bundle": None, "mtime": None}
SALVAGE_FULLY_SPOILED_MIN_COVERAGE = float(
    os.getenv("SALVAGE_FULLY_SPOILED_MIN_COVERAGE", "0.7")
)
SALVAGE_CONFIDENCE_MIN = float(os.getenv("SALVAGE_CONFIDENCE_MIN", "0.55"))
FRESHNESS_SPOILED_MAX = float(os.getenv("FRESHNESS_SPOILED_MAX", "0.65"))
FRESHNESS_FRESH_MIN = float(os.getenv("FRESHNESS_FRESH_MIN", "0.85"))


class AnalyzeRequest(BaseModel):
    image: str
    mimeType: str


class AnalyzeResponse(BaseModel):
    type: Literal["receipt", "food", "unknown"]
    items: list[str] | None = None
    item: str | None = None
    condition: str | None = None
    suggestions: list[str] | None = None
    etaRange: str | None = None
    repurposingActions: list[str] | None = None
    message: str | None = None
    confidence: float | None = None
    conditionConfidence: float | None = None
    salvageStatus: str | None = None
    salvageable: bool | None = None
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

    def generate_receipt_analysis(self, confidence: float) -> str | None:
        if not self.enabled:
            return None

        prompt = (
            "You are helping the WasteWise app explain receipt detection from a model scan. "
            "Return strict JSON only with this schema: "
            '{"message": string}. '
            "Keep message under 100 characters. "
            "Clearly confirm receipt was detected. "
            f"Confidence: {confidence}."
        )
        output = self._generate_json(prompt)
        if not isinstance(output, dict):
            return None

        message = output.get("message")
        return message if isinstance(message, str) else None

    def extract_receipt_items(self, image_bytes: bytes, mime_type: str) -> list[str] | None:
        if not self.enabled:
            return None

        prompt = (
            "Extract purchased item names from this shopping receipt image. "
            "Return strict JSON only with this schema: "
            '{"items": ["item1", "item2", "item3"]}. '
            "Include only item names, no prices, totals, tax, store name, date, payment info, or IDs. "
            "Deduplicate near-identical lines and keep order of appearance. "
            "If unreadable, return an empty items array."
        )
        output = self._generate_json_with_image(prompt, image_bytes, mime_type)
        items: list[str] = []
        if isinstance(output, dict):
            parsed = output.get("items")
            if isinstance(parsed, list):
                items = [value for value in parsed if isinstance(value, str)]

        if not items:
            text_output = self._generate_text_with_image(
                (
                    "Read this receipt and return only purchased item names as plain lines. "
                    "No JSON. No prices. No totals. No store info."
                ),
                image_bytes,
                mime_type,
            )
            if text_output:
                items = self._extract_items_from_text(text_output)

        if not items:
            return None

        cleaned: list[str] = []
        seen: set[str] = set()
        for value in items:
            normalized = " ".join(value.strip().split())
            if not normalized:
                continue
            key = normalized.lower()
            if key in seen:
                continue
            seen.add(key)
            cleaned.append(normalized)

        return cleaned

    def detect_receipt(self, image_bytes: bytes, mime_type: str) -> bool:
        if not self.enabled:
            return False

        prompt = (
            "Determine whether this image is primarily a purchase receipt. "
            "Return strict JSON only with this schema: "
            '{"isReceipt": boolean}. '
            "Set isReceipt true only when receipt text/line-item structure is clearly visible."
        )
        output = self._generate_json_with_image(prompt, image_bytes, mime_type)
        if not isinstance(output, dict):
            return False
        return bool(output.get("isReceipt"))

    def disambiguate_food_label(
        self,
        image_bytes: bytes,
        mime_type: str,
        candidates: list[str],
    ) -> str | None:
        if not self.enabled:
            return None

        cleaned_candidates = [candidate.strip() for candidate in candidates if candidate.strip()]
        if len(cleaned_candidates) < 2:
            return None

        candidate_list = ", ".join(cleaned_candidates)
        prompt = (
            "Classify the main food item in this image using only one of the allowed labels. "
            "Return strict JSON only with this schema: "
            '{"label": string}. '
            f"Allowed labels: {candidate_list}. "
            "Pick exactly one allowed label and return no extra text."
        )
        output = self._generate_json_with_image(prompt, image_bytes, mime_type)
        if not isinstance(output, dict):
            return None

        label = output.get("label")
        if not isinstance(label, str):
            return None

        normalized = label.strip().lower()
        candidate_lookup = {candidate.lower(): candidate for candidate in cleaned_candidates}
        if normalized in candidate_lookup:
            return candidate_lookup[normalized]
        return None

    def assess_salvageability(
        self,
        image_bytes: bytes,
        mime_type: str,
        item: str,
        condition: str,
    ) -> dict[str, object] | None:
        if not self.enabled:
            return None

        prompt = (
            "Inspect this food image for visible spoilage severity and salvageability. "
            "Return strict JSON only with this schema: "
            '{"salvageStatus": "not_spoiled|partially_spoiled|fully_spoiled|unknown", "salvageable": boolean, "spoilageCoverage": number, "confidence": number}. '
            "Use fully_spoiled only when spoilage appears widespread and the remaining edible portion looks unsafe. "
            "If only part is bruised/damaged and clean portions can be trimmed and cooked, use partially_spoiled. "
            "Use partially_spoiled when damaged parts can be removed and remainder cooked safely soon. "
            "Use not_spoiled when it looks safe for normal use. "
            "spoilageCoverage must be in range [0,1] where 1 means nearly entire food is affected. "
            "confidence must be in range [0,1]. "
            f"Food item: {item}. Model condition: {condition}."
        )
        output = self._generate_json_with_image(prompt, image_bytes, mime_type)
        if not isinstance(output, dict):
            return None

        salvage_status = output.get("salvageStatus")
        salvageable_raw = output.get("salvageable")
        spoilage_coverage = output.get("spoilageCoverage")
        confidence = output.get("confidence")

        valid_statuses = {"not_spoiled", "partially_spoiled", "fully_spoiled", "unknown"}
        if not isinstance(salvage_status, str):
            return None
        normalized = salvage_status.strip().lower().replace("-", "_").replace(" ", "_")
        if "partial" in normalized or "slight" in normalized:
            normalized = "partially_spoiled"
        elif "full" in normalized or "unsafe" in normalized:
            normalized = "fully_spoiled"
        elif "not" in normalized and "spoil" in normalized:
            normalized = "not_spoiled"
        if normalized not in valid_statuses:
            return None

        salvageable: bool
        if isinstance(salvageable_raw, bool):
            salvageable = salvageable_raw
        elif isinstance(salvageable_raw, str):
            salvageable = salvageable_raw.strip().lower() in {"true", "yes", "y", "1"}
        elif isinstance(salvageable_raw, (int, float)):
            salvageable = bool(salvageable_raw)
        else:
            salvageable = normalized != "fully_spoiled"

        if not isinstance(spoilage_coverage, (int, float)):
            spoilage_coverage = 0.0
        if not isinstance(confidence, (int, float)):
            confidence = 0.0

        spoilage_coverage = float(max(0.0, min(1.0, spoilage_coverage)))
        confidence = float(max(0.0, min(1.0, confidence)))

        return {
            "salvageStatus": normalized,
            "salvageable": salvageable,
            "spoilageCoverage": spoilage_coverage,
            "confidence": confidence,
        }

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
            f"Confidence: {confidence}."
        )
        output = self._generate_json(prompt)
        if not isinstance(output, dict):
            return None

        eta_range = output.get("etaRange")
        repurposing = output.get("repurposingActions")

        # Keep Gemini ETA even if action list is missing or imperfect.
        if isinstance(eta_range, str):
            actions: list[str] = []
            if isinstance(repurposing, list):
                actions = [action for action in repurposing if isinstance(action, str)]
            return {"etaRange": eta_range, "repurposingActions": actions[:3]}

        return None

    def _generate_json(self, prompt: str) -> dict | None:
        return self._generate_json_with_image(prompt, image_bytes=None, mime_type=None)

    def _generate_text_with_image(
        self,
        prompt: str,
        image_bytes: bytes,
        mime_type: str,
    ) -> str | None:
        if not self.enabled:
            return None

        parts: list[dict[str, object]] = [{"text": prompt}]
        parts.append(
            {
                "inlineData": {
                    "mimeType": mime_type,
                    "data": base64.b64encode(image_bytes).decode("utf-8"),
                }
            }
        )

        payload = {
            "contents": [{"parts": parts}],
            "generationConfig": {
                "temperature": 0.2,
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
            with urlrequest.urlopen(req, timeout=10) as response:
                body = response.read().decode("utf-8")
            parsed = json.loads(body)
            candidates = parsed.get("candidates", [])
            if not candidates:
                return None
            parts_out = candidates[0].get("content", {}).get("parts", [])
            if not parts_out:
                return None
            text = parts_out[0].get("text", "")
            return text if isinstance(text, str) else None
        except (urlerror.URLError, json.JSONDecodeError, TimeoutError, ValueError):
            return None

    def _generate_json_with_image(
        self,
        prompt: str,
        image_bytes: bytes | None,
        mime_type: str | None,
    ) -> dict | None:
        parts: list[dict[str, object]] = [{"text": prompt}]
        if image_bytes is not None and mime_type:
            parts.append(
                {
                    "inlineData": {
                        "mimeType": mime_type,
                        "data": base64.b64encode(image_bytes).decode("utf-8"),
                    }
                }
            )

        payload = {
            "contents": [{"parts": parts}],
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
            return self._best_effort_json_parse(text)
        except (urlerror.URLError, json.JSONDecodeError, TimeoutError, ValueError):
            return None

    def _best_effort_json_parse(self, text: str) -> dict | None:
        if not isinstance(text, str):
            return None

        try:
            parsed = json.loads(text)
            return parsed if isinstance(parsed, dict) else None
        except json.JSONDecodeError:
            pass

        fence_match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
        if fence_match:
            try:
                parsed = json.loads(fence_match.group(1))
                return parsed if isinstance(parsed, dict) else None
            except json.JSONDecodeError:
                pass

        brace_match = re.search(r"\{[\s\S]*\}", text)
        if brace_match:
            candidate = brace_match.group(0)
            try:
                parsed = json.loads(candidate)
                return parsed if isinstance(parsed, dict) else None
            except json.JSONDecodeError:
                pass

        items = self._extract_items_from_text(text)
        if items:
            return {"items": items}

        return None

    def _extract_items_from_text(self, text: str) -> list[str]:
        lines = [" ".join(line.strip().split()) for line in text.splitlines()]
        blacklist = (
            "total",
            "subtotal",
            "tax",
            "discount",
            "payment",
            "cash",
            "credit",
            "card",
            "change",
            "balance",
            "receipt",
            "thank you",
            "store",
            "date",
            "time",
        )

        cleaned: list[str] = []
        seen: set[str] = set()
        for line in lines:
            if len(line) < 2:
                continue
            lower = line.lower()
            if any(token in lower for token in blacklist):
                continue
            line = re.sub(r"\s+[-x]?\d+[\.,]\d{2}\s*$", "", line)
            line = re.sub(r"\s+\d+\s*$", "", line)
            line = re.sub(r"[^A-Za-z0-9\s\-&,()]", "", line).strip()
            if len(line) < 2:
                continue
            key = line.lower()
            if key in seen:
                continue
            seen.add(key)
            cleaned.append(line)

        return cleaned[:30]

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
        self.unknown_indices = {
            index
            for index, label in self.idx_to_food.items()
            if label.lower() in self.unknown_labels
        }
        receipt_candidates = {
            label.strip().lower()
            for label in os.getenv("MODEL_RECEIPT_LABELS", DEFAULT_RECEIPT_LABELS).split(",")
            if label.strip()
        }
        self.receipt_labels = {
            label.lower() for label in self.idx_to_food.values() if label.lower() in receipt_candidates
        }
        self.receipt_indices = {
            index
            for index, label in self.idx_to_food.items()
            if label.lower() in self.receipt_labels
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
        self.food_threshold = float(os.getenv("MODEL_CONFIDENCE_THRESHOLD", "0.90"))
        self.display_confidence_temperature = float(
            os.getenv("MODEL_DISPLAY_CONFIDENCE_TEMPERATURE", "0.70")
        )
        self.receipt_threshold = float(os.getenv("MODEL_RECEIPT_CONFIDENCE_THRESHOLD", "0.20"))
        self.receipt_label_min_confidence = float(
            os.getenv("MODEL_RECEIPT_LABEL_MIN_CONFIDENCE", "0.12")
        )
        self.receipt_strong_prob_threshold = float(os.getenv("MODEL_RECEIPT_STRONG_PROB", "0.07"))
        self.receipt_prob_threshold = float(os.getenv("MODEL_RECEIPT_CLASS_MIN_PROB", "0.05"))
        self.receipt_secondary_threshold = float(os.getenv("MODEL_RECEIPT_CLASS_SECONDARY_PROB", "0.03"))
        self.receipt_top_gap_threshold = float(os.getenv("MODEL_RECEIPT_TOP_GAP", "0.45"))
        self.receipt_unknown_tolerance = float(os.getenv("MODEL_RECEIPT_UNKNOWN_TOLERANCE", "0.20"))
        self.margin_threshold = float(os.getenv("MODEL_MARGIN_THRESHOLD", "0.30"))
        self.entropy_threshold = float(os.getenv("MODEL_ENTROPY_THRESHOLD", "0.72"))
        self.spoilage_threshold = float(os.getenv("MODEL_SPOILAGE_CONFIDENCE_THRESHOLD", "0.55"))
        self.is_food_threshold = float(os.getenv("MODEL_IS_FOOD_THRESHOLD", "0.92"))
        self.unknown_prob_threshold = float(os.getenv("MODEL_UNKNOWN_CLASS_MIN_PROB", "0.03"))
        self.unknown_margin_threshold = float(os.getenv("MODEL_UNKNOWN_CLASS_MARGIN", "0.45"))
        self.unknown_guardrail_prob = float(os.getenv("MODEL_UNKNOWN_GUARDRAIL_PROB", "0.02"))
        self.unknown_guardrail_food_max = float(os.getenv("MODEL_UNKNOWN_GUARDRAIL_FOOD_MAX", "0.995"))
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

    def analyze(self, image_bytes: bytes, mime_type: str) -> AnalyzeResponse:
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
        top_labels = [str(prediction["label"]).lower() for prediction in top_predictions]

        # Correct common citrus/root confusion when model top classes are close.
        if (
            {"orange", "carrot"}.issubset(set(top_labels))
            and margin <= 0.35
        ):
            resolved = self.gemini.disambiguate_food_label(
                image_bytes,
                mime_type,
                candidates=["orange", "carrot"],
            )
            if resolved:
                predicted_label = resolved

        max_unknown_prob = self._max_unknown_probability(food_probs)
        receipt_prob = self._receipt_probability(food_probs)

        receipt_is_near_top = (
            receipt_prob is not None
            and receipt_prob >= self.receipt_secondary_threshold
            and (top_confidence - receipt_prob) <= self.receipt_top_gap_threshold
        )
        receipt_is_strong = (
            receipt_prob is not None and receipt_prob >= self.receipt_strong_prob_threshold
        )
        receipt_is_confident = receipt_prob is not None and receipt_prob >= self.receipt_prob_threshold
        receipt_close_to_unknown = (
            receipt_prob is not None
            and (
                max_unknown_prob is None
                or receipt_prob >= (max_unknown_prob - self.receipt_unknown_tolerance)
            )
        )

        if (
            receipt_is_strong
            or (receipt_close_to_unknown and (receipt_is_confident or receipt_is_near_top))
        ):
            receipt_items = self.gemini.extract_receipt_items(image_bytes, mime_type) or []
            receipt_message = self.gemini.generate_receipt_analysis(receipt_prob)
            return AnalyzeResponse(
                type="receipt",
                items=receipt_items,
                message=self._receipt_result_message(receipt_items, receipt_message),
                confidence=round(receipt_prob, 4),
                topPredictions=top_predictions,
            )

        if (
            predicted_label.lower() in self.receipt_labels
            and top_confidence >= self.receipt_label_min_confidence
        ):
            receipt_items = self.gemini.extract_receipt_items(image_bytes, mime_type) or []
            receipt_message = self.gemini.generate_receipt_analysis(top_confidence)
            return AnalyzeResponse(
                type="receipt",
                items=receipt_items,
                message=self._receipt_result_message(receipt_items, receipt_message),
                confidence=round(top_confidence, 4),
                topPredictions=top_predictions,
            )

        if receipt_prob is not None and receipt_prob >= self.receipt_threshold:
            receipt_items = self.gemini.extract_receipt_items(image_bytes, mime_type) or []
            receipt_message = self.gemini.generate_receipt_analysis(receipt_prob)
            return AnalyzeResponse(
                type="receipt",
                items=receipt_items,
                message=self._receipt_result_message(receipt_items, receipt_message),
                confidence=round(receipt_prob, 4),
                topPredictions=top_predictions,
            )

        if self._looks_like_receipt_image(image):
            receipt_items = self.gemini.extract_receipt_items(image_bytes, mime_type) or []
            receipt_message = self.gemini.generate_receipt_analysis(top_confidence)
            return AnalyzeResponse(
                type="receipt",
                items=receipt_items,
                message=self._receipt_result_message(receipt_items, receipt_message),
                confidence=round(top_confidence, 4),
                topPredictions=top_predictions,
            )

        if self.gemini.detect_receipt(image_bytes, mime_type):
            receipt_items = self.gemini.extract_receipt_items(image_bytes, mime_type) or []
            receipt_message = self.gemini.generate_receipt_analysis(top_confidence)
            return AnalyzeResponse(
                type="receipt",
                items=receipt_items,
                message=self._receipt_result_message(receipt_items, receipt_message),
                confidence=round(top_confidence, 4),
                topPredictions=top_predictions,
            )

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

        if (
            max_unknown_prob is not None
            and (
                max_unknown_prob >= self.unknown_prob_threshold
                or (top_confidence - max_unknown_prob) <= self.unknown_margin_threshold
            )
        ):
            reason = "non-food class probability is high"
            unknown_message = self.gemini.generate_non_food_analysis(top_predictions, reason)
            return AnalyzeResponse(
                type="unknown",
                message=unknown_message or "This looks like a non-food object. Please scan a food item.",
                confidence=round(max_unknown_prob, 4),
                topPredictions=top_predictions,
            )

        if (
            max_unknown_prob is not None
            and max_unknown_prob >= self.unknown_guardrail_prob
            and top_confidence <= self.unknown_guardrail_food_max
        ):
            reason = "unknown/non-food signal present while food confidence is not dominant"
            unknown_message = self.gemini.generate_non_food_analysis(top_predictions, reason)
            return AnalyzeResponse(
                type="unknown",
                message=unknown_message or "This appears to be non-food. Please scan a food item.",
                confidence=round(max_unknown_prob, 4),
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
        display_food_confidence = self._sharpen_display_confidence(top_confidence)
        model_condition = (
            self.spoilage_labels[spoilage_index] if spoilage_probs is not None else "unknown"
        )
        salvage_assessment = self._resolve_salvage_assessment(
            image_bytes=image_bytes,
            mime_type=mime_type,
            item=predicted_label,
            condition=model_condition,
            condition_confidence=spoilage_confidence,
        )
        salvage_status = str(salvage_assessment.get("salvageStatus", "unknown"))
        salvageable = bool(salvage_assessment.get("salvageable", True))
        condition = self._normalize_condition_for_display(
            base_condition=model_condition,
            condition_confidence=spoilage_confidence,
            salvage_status=salvage_status,
        )
        gemini_message = self.gemini.generate_food_analysis(
            item=predicted_label,
            condition=condition,
            confidence=display_food_confidence,
            top_predictions=top_predictions,
        )
        suggestions = self.gemini.generate_suggestions(
            item=predicted_label,
            condition=condition,
            confidence=display_food_confidence,
        )
        eta_repurpose = self.gemini.generate_eta_and_repurposing(
            item=predicted_label,
            condition=condition,
            confidence=display_food_confidence,
        )
        if not eta_repurpose:
            eta_repurpose = self._fallback_eta_and_repurposing(condition)
        fallback_message = (
            f"Detected {predicted_label} with {round(display_food_confidence * 100)}% confidence."
        )

        safety_message, safety_suggestions, safety_eta_repurpose = self._apply_spoilage_safety_policy(
            condition=condition,
            salvage_status=salvage_status,
            salvageable=salvageable,
            condition_confidence=spoilage_confidence,
            message=gemini_message or fallback_message,
            suggestions=suggestions,
            eta_repurpose=eta_repurpose,
        )

        return AnalyzeResponse(
            type="food",
            item=predicted_label,
            condition=condition,
            suggestions=safety_suggestions,
            etaRange=safety_eta_repurpose.get("etaRange") if safety_eta_repurpose else None,
            repurposingActions=(
                safety_eta_repurpose.get("repurposingActions") if safety_eta_repurpose else None
            ),
            message=safety_message,
            confidence=round(display_food_confidence, 4),
            conditionConfidence=round(spoilage_confidence, 4) if spoilage_confidence is not None else None,
            salvageStatus=salvage_status,
            salvageable=salvageable,
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

    def _max_unknown_probability(self, probs: torch.Tensor) -> float | None:
        if not self.unknown_indices:
            return None
        values = [float(probs[index].item()) for index in self.unknown_indices if index < probs.shape[0]]
        if not values:
            return None
        return max(values)

    def _receipt_probability(self, probs: torch.Tensor) -> float | None:
        if not self.receipt_indices:
            return None
        values = [float(probs[index].item()) for index in self.receipt_indices if index < probs.shape[0]]
        if not values:
            return None
        return sum(values)

    def _sharpen_display_confidence(self, probability: float) -> float:
        # Sharpen display confidence only; model gating continues using raw probabilities.
        p = min(max(probability, 1e-6), 1 - 1e-6)
        temperature = max(self.display_confidence_temperature, 1e-3)
        logit = math.log(p / (1.0 - p))
        return 1.0 / (1.0 + math.exp(-(logit / temperature)))

    def _fallback_eta_and_repurposing(self, condition: str) -> dict[str, object]:
        condition_key = (condition or "").strip().lower()

        if condition_key == "fresh":
            return {
                "etaRange": "4-7 days at room temp, longer if refrigerated.",
                "repurposingActions": [
                    "Store in a cool, dry place.",
                    "Use in salads or snacks in 1-2 days.",
                    "Refrigerate once fully ripe.",
                ],
            }

        if condition_key == "ripe":
            return {
                "etaRange": "2-4 days before quality starts dropping.",
                "repurposingActions": [
                    "Eat soon for best flavor.",
                    "Slice and chill for quick use.",
                    "Use in smoothies or desserts.",
                ],
            }

        if condition_key == "aging":
            return {
                "etaRange": "1-2 days before becoming overripe.",
                "repurposingActions": [
                    "Cook or blend today.",
                    "Freeze portions for later.",
                    "Use in sauces or baking.",
                ],
            }

        if condition_key == "overripe":
            return {
                "etaRange": "Use within 24 hours.",
                "repurposingActions": [
                    "Blend into smoothies now.",
                    "Use for jam, puree, or baking.",
                    "Freeze immediately if not using now.",
                ],
            }

        if condition_key == "spoiled":
            return {
                "etaRange": "Already spoiled - do not eat.",
                "repurposingActions": [
                    "Discard safely.",
                    "Compost if appropriate.",
                ],
            }

        return {
            "etaRange": "Estimate unavailable from model output.",
            "repurposingActions": [
                "Inspect visually and by smell before use.",
                "Prioritize using this item soon.",
            ],
        }

    def _default_salvage_assessment(self, condition: str) -> dict[str, object]:
        condition_key = (condition or "").strip().lower()
        if condition_key == "spoiled":
            return {"salvageStatus": "partially_spoiled", "salvageable": True}
        if condition_key in {"aging", "overripe"}:
            return {"salvageStatus": "partially_spoiled", "salvageable": True}
        if condition_key in {"fresh", "ripe"}:
            return {"salvageStatus": "not_spoiled", "salvageable": True}
        return {"salvageStatus": "unknown", "salvageable": True}

    def _resolve_salvage_assessment(
        self,
        image_bytes: bytes,
        mime_type: str,
        item: str,
        condition: str,
        condition_confidence: float | None,
    ) -> dict[str, object]:
        fallback = self._default_salvage_assessment(condition)
        gemini_result = self.gemini.assess_salvageability(
            image_bytes=image_bytes,
            mime_type=mime_type,
            item=item,
            condition=condition,
        )
        if not isinstance(gemini_result, dict):
            return fallback

        status = gemini_result.get("salvageStatus")
        salvageable = gemini_result.get("salvageable")
        if isinstance(status, str) and isinstance(salvageable, bool):
            normalized_status = status.strip().lower()
            normalized_condition = (condition or "").strip().lower()
            spoilage_coverage = float(gemini_result.get("spoilageCoverage", 0.0))
            confidence = float(gemini_result.get("confidence", 0.0))

            # Be conservative: only mark fully spoiled when both model and image strongly indicate unsalvageable food.
            if normalized_status == "fully_spoiled":
                if salvageable:
                    return {"salvageStatus": "partially_spoiled", "salvageable": True}
                if normalized_condition != "spoiled":
                    return {"salvageStatus": "partially_spoiled", "salvageable": True}
                if spoilage_coverage < SALVAGE_FULLY_SPOILED_MIN_COVERAGE:
                    return {"salvageStatus": "partially_spoiled", "salvageable": True}
                if confidence < SALVAGE_CONFIDENCE_MIN:
                    return {"salvageStatus": "partially_spoiled", "salvageable": True}

            result = {"salvageStatus": normalized_status, "salvageable": salvageable}
            if condition_confidence is not None:
                result = self._apply_freshness_band_policy(result, condition_confidence)
            return result

        if condition_confidence is not None:
            return self._apply_freshness_band_policy(fallback, condition_confidence)
        return fallback

    def _apply_freshness_band_policy(
        self,
        assessment: dict[str, object],
        condition_confidence: float,
    ) -> dict[str, object]:
        confidence = float(condition_confidence)
        if confidence > 1.0:
            confidence = confidence / 100.0
        current_status = str(assessment.get("salvageStatus", "unknown")).strip().lower()
        current_salvageable = bool(assessment.get("salvageable", True))

        # Explicit product thresholds:
        # >85% fresh, otherwise salvageable.
        if confidence > FRESHNESS_FRESH_MIN:
            return {"salvageStatus": "not_spoiled", "salvageable": True}

        # Keep explicit unsalvageable result only when Gemini already marked fully spoiled.
        if current_status == "fully_spoiled" and not current_salvageable:
            return {"salvageStatus": "fully_spoiled", "salvageable": False}

        return {"salvageStatus": "partially_spoiled", "salvageable": True}

    def _normalize_condition_for_display(
        self,
        base_condition: str,
        condition_confidence: float | None,
        salvage_status: str,
    ) -> str:
        if condition_confidence is not None:
            confidence = float(condition_confidence)
            if confidence > 1.0:
                confidence = confidence / 100.0
            if confidence > FRESHNESS_FRESH_MIN:
                return "fresh"
            return "aging"

        status = (salvage_status or "").strip().lower()
        if status == "not_spoiled":
            return "fresh"
        if status == "partially_spoiled":
            return "aging"
        if status == "fully_spoiled":
            return "spoiled"
        return base_condition

    def _apply_spoilage_safety_policy(
        self,
        condition: str,
        salvage_status: str,
        salvageable: bool,
        condition_confidence: float | None,
        message: str,
        suggestions: list[str] | None,
        eta_repurpose: dict[str, object] | None,
    ) -> tuple[str, list[str], dict[str, object]]:
        condition_key = (condition or "").strip().lower()
        salvage_key = (salvage_status or "").strip().lower()
        base_eta = dict(eta_repurpose or {})

        if salvage_key == "fully_spoiled":
            base_eta["etaRange"] = "Fully spoiled: discard now. Do not consume."
            base_eta["repurposingActions"] = [
                "Do not eat or taste it.",
                "Discard in a sealed trash bag.",
                "Clean nearby surfaces and containers.",
            ]
            return (
                "Fully spoiled: throw this away and do not consume it.",
                [
                    "Do not cut around mold and eat.",
                    "Discard immediately in a sealed bag.",
                    "Sanitize knife/board after handling.",
                ],
                base_eta,
            )

        if salvage_key == "not_spoiled":
            return (
                "Fresh: safe to use now with normal storage and handling.",
                [
                    "Store properly to keep quality high.",
                    "Use raw or cooked as planned.",
                    "Recheck before eating if appearance changes.",
                ],
                base_eta,
            )

        if (
            salvage_key == "partially_spoiled"
            or condition_key in {"aging", "overripe"}
            or (condition_key == "spoiled" and salvageable)
        ):
            if "etaRange" not in base_eta or not isinstance(base_eta.get("etaRange"), str):
                base_eta["etaRange"] = "Kinda spoiled: use today after trimming damaged parts."
            base_eta["repurposingActions"] = [
                "Trim bruised or soft spots generously.",
                "Use in cooked dishes today.",
                "Discard if mold, slime, or bad odor appears.",
            ]
            return (
                "Kinda spoiled but often salvageable: trim bad parts and cook it safely today.",
                [
                    "Cut off damaged areas with a clean knife.",
                    "Add to pie, sauce, or compote today.",
                    "Throw away if mold or sour smell is present.",
                ],
                base_eta,
            )

        return message, suggestions or [], base_eta

    def _receipt_result_message(self, receipt_items: list[str], receipt_message: str | None) -> str:
        if receipt_message:
            return receipt_message
        if receipt_items:
            return f"Receipt detected. Read {len(receipt_items)} entries."
        if not self.gemini.enabled:
            return "Receipt detected, but text reading is disabled (missing GEMINI_API_KEY)."
        return "Receipt detected, but no readable item entries were found."

    def _looks_like_receipt_image(self, image: Image.Image) -> bool:
        def score_receipt_like(rgb_image: Image.Image) -> bool:
            width, height = rgb_image.size
            if width < 2 or height < 2:
                return False

            max_side = max(width, height)
            if max_side > 640:
                scale = 640 / max_side
                rgb_image = rgb_image.resize((max(1, int(width * scale)), max(1, int(height * scale))))
                width, height = rgb_image.size

            arr = np.asarray(rgb_image).astype(np.float32)
            if arr.ndim != 3 or arr.shape[2] != 3:
                return False

            r = arr[:, :, 0]
            g = arr[:, :, 1]
            b = arr[:, :, 2]

            max_c = np.maximum(np.maximum(r, g), b)
            min_c = np.minimum(np.minimum(r, g), b)
            delta = max_c - min_c
            saturation = np.where(max_c > 0, delta / np.maximum(max_c, 1e-6), 0.0)
            gray = 0.299 * r + 0.587 * g + 0.114 * b

            brightness_mean = float(np.mean(gray))
            low_saturation_ratio = float(np.mean(saturation < 0.22))
            white_ratio = float(np.mean((gray > 180.0) & (saturation < 0.20)))
            dark_ratio = float(np.mean(gray < 110.0))

            dx = np.abs(np.diff(gray, axis=1))
            dy = np.abs(np.diff(gray, axis=0))
            edge_ratio = float((np.mean(dx > 18.0) + np.mean(dy > 18.0)) / 2.0)

            aspect_ratio = max(height / max(width, 1), width / max(height, 1))

            return (
                brightness_mean > 120.0
                and low_saturation_ratio > 0.55
                and white_ratio > 0.24
                and edge_ratio > 0.045
                and dark_ratio < 0.40
                and (aspect_ratio > 1.25 or white_ratio > 0.40)
            )

        rgb = image.convert("RGB")
        if score_receipt_like(rgb):
            return True

        # Fallback: focus on center crop to ignore background clutter around the receipt.
        width, height = rgb.size
        crop_w = max(1, int(width * 0.72))
        crop_h = max(1, int(height * 0.72))
        left = (width - crop_w) // 2
        top = (height - crop_h) // 2
        center = rgb.crop((left, top, left + crop_w, top + crop_h))
        return score_receipt_like(center)

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
        "receipt_labels": len(bundle.receipt_labels),
    }


@app.post("/api/analyze", response_model=AnalyzeResponse)
def analyze_image(request: AnalyzeRequest) -> AnalyzeResponse:
    try:
        image_bytes = base64.b64decode(request.image, validate=True)
    except ValueError as error:
        raise HTTPException(status_code=400, detail="Invalid base64 image payload.") from error

    if not image_bytes:
        raise HTTPException(status_code=400, detail="Image payload is empty.")

    return get_model_bundle().analyze(image_bytes, request.mimeType)
