# Nana Aba Frontend

Vite + React frontend for the UG advisor app.

## Environment Variables

Create a local `.env` file from `.env.example` and set:

```env
VITE_API_BASE=https://lordofcodess--ug-handbook-rag-fastapi-app.modal.run
VITE_TTS_BASE=https://lordofcodess--auntie-aba-api-fastapi-app.modal.run
```

Notes:
- `VITE_API_BASE` is used for chat, voice chat, transcript analysis, and health checks.
- `VITE_TTS_BASE` is used for text-to-speech requests.
- The frontend already reads both values from `src/api.ts`, so adding `VITE_TTS_BASE` does not require any extra code changes.

## Local Development

```bash
npm install
npm run dev
```

## Production Build

```bash
npm run build
```

## Vercel

Set `VITE_API_BASE` and `VITE_TTS_BASE` in the Vercel project settings for both Preview and Production, then redeploy.
