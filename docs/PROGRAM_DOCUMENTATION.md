# WasteWise Program Documentation

## 1. Purpose

WasteWise helps users scan food items and receive model-based classification results and freshness guidance.

The application consists of:

- A React frontend for camera capture, scanning UI, and user flows
- A FastAPI backend for local model inference using PyTorch

## 2. High-Level Architecture

Client flow:

1. User captures an image in the scanner UI
2. Frontend sends base64 image payload to POST /api/analyze
3. Backend loads and preprocesses the image
4. Backend runs checkpoint inference and returns structured result
5. Frontend displays success modal or non-food error prompt

Main components:

- Frontend app: src/
- Backend API: backend/ml_api/app.py
- Model checkpoint: models/checkpoints/best_model.pt

## 3. Frontend Overview

Primary files:

- src/pages/ScanReceipt.tsx
  - Camera access
  - Auto-scan loop
  - Manual capture
  - Error and success UX handling
- src/services/imageProcessor.ts
  - API client for /api/analyze
  - Response parsing and error handling

Scanner behavior notes:

- If response type is food, it shows item/condition results
- If response type is unknown, it shows an explicit not-food retry error and stops auto-rescan until user retries

## 4. Backend Overview

Main file:

- backend/ml_api/app.py

Responsibilities:

- Exposes GET /api/health and POST /api/analyze
- Loads best_model.pt checkpoint metadata and state
- Builds a matching classifier backbone based on config.model_name
- Preprocesses input images
- Performs inference and non-food rejection logic
- Generates user-facing output copy via Google Gemini when configured

Supported model_name values:

- resnet50
- resnet18
- efficientnet_v2_s

## 5. Model Compatibility and Reload

Checkpoint expectations:

- food_to_idx mapping
- model_state_dict
- optional config fields (model_name, image_size)

Optional heads supported:

- spoilage_head
- is_food_head

Hot reload behavior:

- Backend caches model bundle
- Cache invalidates when models/checkpoints/best_model.pt modification time changes
- Replaced checkpoint is loaded on next request

## 6. Non-Food Rejection Strategy

The backend rejects non-food via several checks:

- Predicted label belongs to known unknown labels
- Optional is_food head probability below threshold
- Food confidence below threshold
- Top-1 vs Top-2 margin below threshold
- Prediction entropy above threshold
- Spoilage confidence below threshold (when spoilage head exists)

Result format for rejection:

- type: unknown
- message: instructs user to scan a food item

Gemini output integration:

- When `GEMINI_API_KEY` is configured, backend calls Gemini to generate:
  - food result message and practical suggestions
  - unknown/non-food rejection message
- If Gemini is unavailable or not configured, backend falls back to local deterministic messages

## 7. API Contract

GET /api/health

- Purpose: verify service and model state
- Returns status, model filename, model_name, class count, unknown label count

POST /api/analyze

Request body:

- image: base64 string
- mimeType: image mime type

Response body (key fields):

- type: food or unknown
- item
- condition
- suggestions
- message
- confidence
- conditionConfidence
- topPredictions

## 8. Running and Operations

Core scripts from package.json:

- npm run dev
  - Starts both frontend and API
- npm run dev:web
  - Starts Vite only
- npm run dev:api
  - Starts API unless existing API already owns port 8000

Operational checks:

- Health check: curl http://127.0.0.1:8000/api/health
- Python syntax check: ./.venv/bin/python -m py_compile backend/ml_api/app.py

Gemini configuration:

- Required env var for Gemini outputs: `GEMINI_API_KEY`
- Optional model override: `GEMINI_MODEL` (default: `gemini-2.0-flash`)

## 9. Known Notes

- TypeScript lint may fail for unrelated asset path issues outside inference flow.
- If custom checkpoints use unsupported backbones, backend will raise a runtime error until support is added.
- For best non-food performance, include strong non-food coverage in training data.

## 10. Recommended Update Workflow

When training a new model:

1. Save/replace models/checkpoints/best_model.pt
2. Call /api/health to verify the loaded model metadata
3. Test a known food sample and a known non-food sample
4. Adjust environment threshold values only if needed
