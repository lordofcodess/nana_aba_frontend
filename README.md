# Nana Aba Frontend

Vite + React frontend for the UG advisor app.

## Environment Variables

Create a local `.env` file from `.env.example` and set:

```env
VITE_API_BASE=http://localhost:8000
VITE_TTS_BASE=https://omnivoice-75xxrqc2qa-uc.a.run.app
```

Notes:
- `VITE_API_BASE` is used for chat, voice chat, transcript analysis, and health checks.
- `VITE_TTS_BASE` is used for text-to-speech requests.
- The frontend already reads both values from `src/api.ts`, so adding `VITE_TTS_BASE` does not require any extra code changes.
- The main chat/RAG API is hosted on Google Cloud Run at `https://nana-aba-rag-api-194975005212.us-central1.run.app`.
- OmniVoice TTS remains a separate Cloud Run service.

## Results and programme suggestions

Use **Analyze results or document** in the chat composer to upload a Ghanaian
WASSCE/SSSCE result sheet as a PDF or image. The API reads the subjects and grades,
then compares WASSCE results with the loaded UG first-year entry requirements and
published cut-offs. Suggestions are guidance based on the previous cut-off cycle,
not an admission decision. SSSCE grades are read, but are not automatically compared
with WASSCE cut-off points because the grading scales differ.

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

Set these values in the Vercel project settings for both Preview and Production, then redeploy:

```env
VITE_API_BASE=https://nana-aba-rag-api-194975005212.us-central1.run.app
VITE_TTS_BASE=https://omnivoice-75xxrqc2qa-uc.a.run.app
```
