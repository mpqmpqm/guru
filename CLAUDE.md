# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Guru is a voice-guided yoga/meditation instruction system. It uses Claude (via the Agent SDK) to generate spoken guidance, with OpenAI TTS for audio synthesis. The agent guides through `speak` and `silence` tools that convert text to audio and stream it to the client in real-time.

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
- `services/agent.ts` - Claude Agent SDK integration, `streamChat()` generator
- `services/session-manager.ts` - In-memory session state, audio queue management
- `services/db.ts` - SQLite persistence (better-sqlite3) for sessions, cues, thinking traces, errors
- `tools/speak.ts` - Delivers spoken guidance via OpenAI TTS
- `tools/silence.ts` - Holds intentional space between speech
- `tools/time.ts` - Session timing tool for pacing guidance

### Skills (`skills/`)

Claude Code skills that define guidance behavior. Each has a `SKILL.md` file with prompts and procedural knowledge.

- `cue/` - Core orientation: how to speak, use silence, approach uncertainty
- `breathwork/` - Pranayama and breath practices
- `vinyasa/` - Flow yoga instruction
- `yin/` - Yin yoga guidance (includes pose references)
- `living-instruction/` - Techniques for avoiding formulaic language

### Client (`public/`)

Vanilla JS frontend that connects via SSE for events and fetches PCM audio stream for playback.

## Key Patterns

**Agent Communication**: The agent guides through `mcp__guide__speak` and `mcp__guide__silence`. Every response must include at least one speak. The system auto-retries if no speak is called.

**Audio Flow**: OpenAI TTS → PCM chunks → session audio queue → framed stream at playback rate (24kHz, 16-bit mono). The queue throttles to real-time to sync `onComplete` with actual playback.

**Session State**: In-memory `SessionManager` tracks active sessions. SQLite persists cues/thinking/errors for inspection. Sessions auto-cleanup after 30 minutes.

**Event Sequence**: Unified counter (`eventSequence`) orders all events (thinking blocks, cues, errors) for replay/inspection.

## Database Schema

SQLite with WAL mode. Tables: `sessions`, `cues`, `silences`, `thinking_traces`, `errors`. All have `sequence_num` for ordering within a session.

## Code Style

Prettier config: 65 char print width, 2 space indent, trailing commas, prose wrap always.
