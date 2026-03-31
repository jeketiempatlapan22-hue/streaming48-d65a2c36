

## Plan: Fix Player M3U8 & YouTube + Add Loading Animation

### Root Cause Analysis

**M3U8 Issues:**
- Console shows repeated `bufferStalledError` (non-fatal) from HLS.js GapController — the player stalls because segments load but playback position gets stuck
- Current `bufferStalledError` handler nudges `currentTime` forward but doesn't address the underlying gap detection issue
- HLS.js config has `enableWorker: false` which degrades performance; the real CORS fix should be in `xhrSetup` instead
- `loadSource` before `attachMedia` is technically wrong per HLS.js docs — it works sometimes but causes race conditions

**YouTube Issues:**
- YouTube API mode sets `controls: 1` (YouTube's own controls) AND has an overlay div that blocks the iframe — but also blocks YouTube's own controls, causing "configuration error" appearance
- Iframe fallback mode has no overlay at all, exposing the source URL
- Play/pause button doesn't work reliably because the overlay intercepts all clicks

### Changes

#### 1. `src/components/VideoPlayer.tsx` — Complete Player Fix

**M3U8 Fixes:**
- Fix initialization order: `attachMedia` first, then `loadSource` on `MEDIA_ATTACHED` event (correct per HLS.js docs)
- Re-enable worker (`enableWorker: true`) but add `xhrSetup` with proper CORS mode
- Improve `bufferStalledError` handling: seek past gaps more aggressively using `hls.js` built-in `nudgeOffset`
- Add `progressive: true` for faster first-frame rendering
- Increase `maxBufferHole` to tolerate small gaps without stalling

**YouTube Fixes:**
- Use `controls: 0` in YouTube API mode to disable YouTube's native controls (which are blocked by overlay anyway)
- Keep the transparent overlay to prevent users from accessing source URL
- Wire play/pause, mute/unmute through the custom control bar using YouTube API methods
- For iframe fallback: wrap in a container with pointer-events overlay that still allows YouTube controls via `pointer-events: none` on specific areas, OR use the proxy HTML page which already has an overlay

**Loading Animation:**
- Add a lightweight "connecting" spinner/pulse animation shown while `isLoading` is true
- For M3U8: set `isLoading = true` initially, clear on `canplay`/`playing` events
- For YouTube: show during `ytMode === "loading"` state
- Use a simple centered spinner with "Menghubungkan..." text — no skeleton, no blur, no blocking overlay
- The loading indicator is `pointer-events-none` so it never blocks the video element

#### 2. Key Technical Details

```text
M3U8 Init Flow (fixed):
  1. hls = new Hls(config)
  2. hls.attachMedia(video)        ← attach first
  3. on MEDIA_ATTACHED → hls.loadSource(url)  ← then load
  4. on MANIFEST_PARSED → video.play()
  5. on canplay/playing → isLoading = false

YouTube Flow:
  API mode:  controls=0, overlay blocks iframe, custom buttons control API
  Fallback:  use proxy HTML page (already has overlay built-in)
```

**HLS Config Changes:**
- `enableWorker: true` (better performance)
- `maxBufferHole: 1.0` (tolerate 1s gaps)  
- `nudgeOffset: 0.2` (auto-skip small gaps)
- `startFragPrefetch: true` (faster first frame)

### Files Modified
1. `src/components/VideoPlayer.tsx` — Fix HLS init order, YouTube overlay+controls, add loading animation

