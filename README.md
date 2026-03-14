<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/27f12d5a-469c-426c-8dde-cdf58b2f555b

## Run Locally

**Prerequisites:** Node.js and the workspace Python virtual environment

1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Start the local ML API in a separate terminal:
   `npm run api`
4. Run the app:
   `npm run dev`

The scanner now uses the local model checkpoint at `models/checkpoints/best_model.pt` through the FastAPI service in `backend/ml_api/app.py`.
