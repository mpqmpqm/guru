# CLAUDE.md

This file provides guidance to coding agents working with this repository.

## Project Overview

Guru is a voice-guided yoga/meditation instruction system. It uses OpenAI Responses to generate spoken guidance and OpenAI TTS for audio synthesis. The server drives a local tool loop through `speak`, `silence`, `time`, `stopwatch`, `load_skill`, and `load_reference`, then streams the resulting events and audio to the client in real time.

## Commands

```bash
npm run dev          # Start dev server with hot reload (tsx watch)
npm run typecheck    # Type-check with tsc -b
npm run build        # Build for production (tsc -p tsconfig.build.json)
npm run start        # Run production build (node dist/index.js)
```

## Architecture

### Server (`server/`)

Express server with SSE for events and framed PCM streaming for audio.

- `index.ts` - Express app setup, routes, health checks
- `routes/chat.ts` - SSE endpoint for streaming events, POST for sending messages
- `routes/audio.ts` - Framed PCM audio stream endpoint ("radio station" model)
- `services/responses-agent.ts` - OpenAI Responses turn loop and stream adapter
- `services/openai-tools.ts` - OpenAI function-tool definitions and local dispatch
- `services/session-manager.ts` - In-memory session state, audio queue management
- `services/db.ts` - SQLite persistence (better-sqlite3) for sessions, cues, tool calls, thinking traces, errors
- `tools/speak.ts` - Delivers spoken guidance via OpenAI TTS
- `tools/silence.ts` - Holds intentional space between speech
- `tools/time.ts` - Session timing tool for pacing guidance
- `tools/stopwatch.ts` - Stopwatch tool for duration tracking inside a session

### Skills (`skills/`)

Repo-local skills define guidance behavior. Each has a `SKILL.md` file with instructions and optional reference material.

- `cue/` - Core orientation: how to speak, use silence, approach uncertainty
- `breathwork/` - Pranayama and breath practices
- `vinyasa/` - Flow yoga instruction
- `yin/` - Yin yoga guidance (includes pose references)

### Client (`public/`)

Vanilla JS frontend that connects via SSE for events and fetches PCM audio stream for playback.

## Key Patterns

**Agent Communication**: The Responses runtime streams text deltas and function calls. Every completed turn must include at least one `speak()` call. The server auto-retries if a response finishes without speech.

**Audio Flow**: OpenAI TTS → PCM chunks → session audio queue → framed stream at playback rate (24kHz, 16-bit mono). The queue throttles to real-time to sync `onComplete` with actual playback.

**Session State**: In-memory `SessionManager` tracks active sessions. SQLite persists provider/model state, response IDs, cues, thinking summaries, and errors for inspection. Sessions auto-cleanup after 30 minutes.

**Event Sequence**: Unified counter (`eventSequence`) orders all events (thinking blocks, cues, errors) for replay/inspection.

## Database Schema

SQLite with WAL mode. Tables include `sessions`, `messages`, `cues`, `silences`, `tool_calls`, `thinking_traces`, and `errors`. Event tables use `sequence_num` for ordering within a session.

## Code Style

Prettier config: 65 char print width, 2 space indent, trailing commas, prose wrap always.
