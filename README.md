# Guru

Voice-guided yoga and meditation instruction powered by
Claude (Agent SDK) with OpenAI TTS streaming audio to a
vanilla JS client.

## Features

- Real-time spoken guidance with streamed PCM audio
- SSE event stream for cues, timing, and inspection
- SQLite persistence for sessions, cues, and traces

## Quickstart

```bash
npm install
cp .env.example .env
npm run dev
```

Then open http://localhost:3000.

## Environment

- `ANTHROPIC_API_KEY` (required)
- `OPENAI_API_KEY` (required)
- `PORT` (optional, default 3000)
- `FLY_APP_NAME` (optional, enables `/data` DB path)

## Scripts

```bash
npm run dev       # Start dev server with hot reload
npm run typecheck # Type-check with tsc -b
npm run build     # Build for production
npm run start     # Run production build
```

## Deployment

The repo includes `fly.toml` for Fly.io deploys and a
GitHub Actions workflow that expects `FLY_API_TOKEN`
to be configured as a repository secret.
