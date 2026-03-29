

## Plan: Encrypt Stream URLs & Ensure Cross-Browser + PWA Compatibility

### Problem
1. **M3U8/HLS and Cloudflare URLs are visible** in browser DevTools Network tab — users can find the original stream source
2. **Player performance** needs to remain smooth
3. **Cross-browser compatibility** (Chrome, Safari, Firefox, Edge, etc.)
4. **PWA always stays updated** with latest website features

### Current Architecture
- `useSignedStreamUrl` hook calls `stream-proxy` edge function (POST) which returns a `signed_url`
- For **m3u8**: returns a signed proxy URL → HLS player loads it → proxy rewrites m3u8 to proxy sub-playlists too (URLs hidden). **TS segments** are served directly from origin (visible in Network tab)
- For **cloudflare**: returns a signed proxy URL → but the `VideoPlayer.tsx` currently **ignores the signed URL for cloudflare** and constructs `iframe.videodelivery.net` URLs directly (line 431-437), exposing the Cloudflare Stream ID
- For **youtube**: returns encrypted ID → player decrypts client-side with XOR key (key visible in source code)
- The XOR key `[82,84,52,56,120,75,57,109,81,50,118,76,55,110,80,52]` is hardcoded in both client and server

### Plan

#### 1. Proxy TS Segments Through Stream-Proxy (Hide M3U8 Origin)
- Add a new mode `ts` to `stream-proxy` edge function that proxies `.ts` segment requests
- In `rewriteM3u8Hybrid`, rewrite `.ts` segment URLs to go through the proxy with signed tokens
- This ensures **no direct origin URLs** appear in the Network tab — all requests go through `stream-proxy`
- Use short TTL signatures (matching playlist TTL) for segment URLs

#### 2. Fix Cloudflare Stream Proxy (Currently Broken)
- The `VideoPlayer.tsx` cloudflare handler (line 425-438) currently builds iframe URLs directly, **bypassing the signed proxy entirely**
- Fix: when `proxyType === "cloudflare"`, use the `signedUrl` from `useSignedStreamUrl` which points to `stream-proxy?mode=cf` — this serves an HTML page with the embedded Cloudflare player, hiding the real stream ID
- The edge function already has the `cf` mode that generates the correct embed HTML

#### 3. Obfuscate XOR Key (YouTube)
- Move the XOR decryption key to a computed/derived form instead of a plain array literal
- This is a deterrent — determined users can still find it, but it won't be immediately obvious

#### 4. Cross-Browser Compatibility
- Ensure `<video>` element has all necessary attributes: `playsinline`, `webkit-playsinline`, `x-webkit-airplay`, `preload`
- Verify CSP headers allow all required domains
- Already present — validate no regressions

#### 5. PWA Auto-Update
- Already configured with `registerType: "autoUpdate"`, `skipWaiting: true`, `clientsClaim: true`
- Add `sw.js` cache version bump mechanism to force PWA clients to get latest version
- Update `CACHE_RESET_VERSION` in `main.tsx` to `v5` to force cache bust on existing installs

### Files to Modify

| File | Change |
|------|--------|
| `supabase/functions/stream-proxy/index.ts` | Add `mode=ts` for segment proxying; update `rewriteM3u8Hybrid` to rewrite `.ts` URLs through proxy |
| `src/components/VideoPlayer.tsx` | Fix cloudflare to use signed proxy URL (iframe src = signedUrl); obfuscate XOR key |
| `src/pages/LivePage.tsx` | Pass `signedUrl` + `proxyType` correctly to VideoPlayer for cloudflare |
| `src/main.tsx` | Bump `CACHE_RESET_VERSION` to v5 |

### Performance Considerations
- TS segment proxy adds ~50-100ms latency per segment fetch (edge function overhead)
- To mitigate: use generous `Cache-Control` headers on segments, keep buffer settings large (30s+)
- M3U8 playlist proxy already has 3s cache — segments can have 30s cache since they're immutable
- Alternative: instead of proxying TS segments (which adds latency), only proxy the m3u8 manifests and rewrite segment URLs to use **time-limited signed direct URLs** — this keeps performance identical while hiding the base URL pattern

### Recommended Approach for TS Segments
Rather than proxying every segment through the edge function (which would add latency and potentially cause buffering), use **signed redirect URLs**: the proxy rewrites `.ts` URLs to point to `stream-proxy?mode=seg&u=<encoded>&exp=<exp>&sig=<sig>`, and the edge function responds with a **302 redirect** to the actual segment URL. This way:
- The original domain is never visible in the m3u8 manifest
- Segments load directly from CDN (no latency penalty)
- The redirect URL expires, so captured URLs become useless

### Technical Details

**New `seg` mode in stream-proxy:**
```
GET /stream-proxy?mode=seg&u=<base64url>&exp=<timestamp>&sig=<hmac>
→ Verify signature
→ 302 Redirect to decoded URL
→ Cache-Control: private, no-store
```

**Cloudflare fix in VideoPlayer:**
```typescript
// Instead of building iframe URL directly:
if (playlistType === "cloudflare") {
  // signedUrl from useSignedStreamUrl already points to stream-proxy?mode=cf
  createProtectedIframe(container, signedUrl, { ... });
}
```

