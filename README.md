# WasteWise

WasteWise is a React + Vite application with a local FastAPI + PyTorch inference API for food scanning.

The scanner sends captured images to the local API, which loads the model checkpoint from models/checkpoints/best_model.pt and returns:

- food vs unknown result
- detected item
- condition estimate
- confidence values and top predictions
- Gemini-generated output copy (message/suggestions) when configured

## Quick Start

Prerequisites:

- Node.js 18+
- Python 3.11+ (or compatible with your local virtual environment)
- A project virtual environment at .venv with FastAPI, torch, torchvision, and pillow installed

Optional (for Gemini output generation):

- `GEMINI_API_KEY` environment variable
- Optional `GEMINI_MODEL` (defaults to `gemini-2.0-flash`)

Install dependencies:

npm install

Run the app:

npm run dev

This starts:

- Frontend: Vite on port 3000
- Backend: FastAPI model API on port 8000

If `GEMINI_API_KEY` is set, backend response copy is generated using Google Gemini.
If it is not set, backend uses built-in fallback messages and suggestions.

If port 8000 is already occupied by an existing WasteWise API process, the dev API script reuses it instead of failing startup.

## Important Paths

- Frontend scan page: src/pages/ScanReceipt.tsx
- Frontend image API client: src/services/imageProcessor.ts
- Backend inference API: backend/ml_api/app.py
- Active model checkpoint: models/checkpoints/best_model.pt

## API Endpoints

- GET /api/health
  - Returns model status and metadata (model name, class count, unknown-label count)
- POST /api/analyze
  - Accepts JSON with image (base64) and mimeType
  - Returns structured classification result

## Replacing the Model Checkpoint

You can replace models/checkpoints/best_model.pt with a newly trained checkpoint.

The API supports model loading from checkpoint config and currently handles:

- resnet50
- resnet18
- efficientnet_v2_s

The backend detects checkpoint file timestamp changes and reloads the model bundle automatically on the next request.

If your checkpoint contains a non-food label (for example non_food or unknown), scans predicted as those labels are rejected as unknown.

## Current Non-Food Rejection Behavior

The backend rejects non-food scans using multiple signals:

- known unknown/non-food class labels
- optional is_food head (if present in checkpoint)
- confidence + margin + entropy thresholds
- Gemini-generated user-facing unknown message (when configured)

The scanner UI now stops auto-rescan and shows an explicit error message when unknown is returned:

This is not food. Please try again with a food item.

## Troubleshooting

Frontend works but scanning fails:

- Check backend health:
  - curl http://127.0.0.1:8000/api/health
- If unhealthy, restart backend:
  - npm run dev:api

Port issues:

- If Vite port is occupied, Vite may choose another port.
- If API port 8000 is already in use by WasteWise, the script prints a reuse message and continues.

Checkpoint load error:

- Verify checkpoint exists at models/checkpoints/best_model.pt
- Verify checkpoint has food_to_idx and model_state_dict
- Verify config.model_name matches a supported backbone listed above

## Additional Documentation

See docs/PROGRAM_DOCUMENTATION.md for a concise system overview and component-level documentation.
