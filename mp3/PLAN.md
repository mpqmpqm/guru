# MP3 Streaming Test Plan

## Goal
Create a minimal test app to debug MP3 streaming with silence to an `<audio>` element, specifically targeting iOS Safari compatibility.

## Hypothesis
The stuttering with continuous MP3 streaming may be caused by:
1. Chunk boundaries not aligning with MP3 frame boundaries
2. Browser decoder timing/buffering issues
3. Gap between audio segments when no silence is streamed

## Test App Architecture

### Server (Node.js + Express)

```
/test-audio/
  server.js       - Express server
  silence.mp3     - Pre-generated silent MP3 (1 second, same bitrate as TTS)
  package.json
```

#### Endpoints

1. `GET /stream` - Continuous MP3 stream that:
   - Sends a spoken MP3 chunk (can use a pre-recorded file or OpenAI TTS)
   - Sends silence MP3 for N seconds
   - Repeats

2. `GET /info` - Returns current stream state for debugging

#### Key Implementation Details

```javascript
// Pre-load silence MP3 into memory
const silenceChunk = fs.readFileSync('./silence.mp3');

// Stream pattern: audio -> silence -> audio -> silence...
app.get('/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'audio/mpeg',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  // Stream loop
  async function streamLoop() {
    while (!res.writableEnded) {
      // Stream a TTS clip
      await streamTTSChunk(res, "Testing one two three");

      // Stream 2 seconds of silence
      await streamSilence(res, 2000);
    }
  }

  streamLoop();
});
```

### Client (HTML)

```html
<!DOCTYPE html>
<html>
<head><title>MP3 Stream Test</title></head>
<body>
  <button id="play">Play</button>
  <div id="status">Ready</div>
  <audio id="audio" preload="none"></audio>

  <script>
    const audio = document.getElementById('audio');
    const status = document.getElementById('status');

    document.getElementById('play').onclick = () => {
      audio.src = '/stream';
      audio.play();
    };

    // Debug events
    ['playing', 'waiting', 'stalled', 'error', 'pause', 'ended']
      .forEach(e => audio.addEventListener(e, () => {
        status.textContent = `Event: ${e} @ ${audio.currentTime.toFixed(2)}s`;
        console.log(e, audio.currentTime, audio.buffered.length);
      }));
  </script>
</body>
</html>
```

## Generating Silent MP3

### Option A: Pre-generate with ffmpeg
```bash
# Generate 1 second of silence at 24kHz mono, CBR to match OpenAI TTS
ffmpeg -f lavfi -i anullsrc=r=24000:cl=mono -t 1 -c:a libmp3lame -b:a 64k silence.mp3
```

### Option B: Use a library (lame, ffmpeg.wasm)
More complex but allows dynamic silence duration.

## Test Matrix

| Test | Description | Expected |
|------|-------------|----------|
| 1 | Single TTS clip, no silence | Plays cleanly |
| 2 | TTS + 2s silence + TTS | No stutter at transitions |
| 3 | Rapid TTS clips (0.5s silence) | Smooth continuous playback |
| 4 | iOS Safari - locked screen | Continues playing |
| 5 | iOS Safari - app switch | Resumes on return |

## Debug Checklist

- [ ] MP3 frames aligned at chunk boundaries?
- [ ] Consistent bitrate between TTS and silence?
- [ ] Same sample rate (24kHz)?
- [ ] Same channel count (mono)?
- [ ] Buffer underrun events (`waiting`, `stalled`)?
- [ ] Does adding `Transfer-Encoding: chunked` help?
- [ ] Does larger chunk size help?

## If Silence Works

Integrate back into guru:
1. Generate silence.mp3 matching OpenAI TTS specs
2. In `cue.ts`, stream silence MP3 during pauses instead of setTimeout
3. Keep connection open continuously

## If Silence Doesn't Fix Stutter

Consider:
1. HLS streaming (segment-based, iOS-native)
2. Accept Web Audio API limitation (no locked-screen playback)
3. Hybrid: Web Audio + background silent `<audio>` to keep app alive
