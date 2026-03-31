

## Plan: Fix Quality Duplicates, Viewer Count Inflation & Session Stability

### Issues Identified

1. **Duplicate quality labels**: HLS streams often have multiple levels with the same resolution (e.g., three 1080p levels with different bitrates). The current code maps each level individually without deduplication.

2. **Viewer count inflating on refresh**: When a user refreshes, a new `viewerKeyRef` UUID is generated before the `beforeunload` handler fires. The `sendBeacon` to the Supabase RPC endpoint may silently fail because it sends a Blob without the required `Authorization` header — `sendBeacon` only supports `Content-Type` via Blob, not custom headers. So old viewer keys linger for 90 seconds.

3. **Users getting kicked/blocked unexpectedly**: The session re-creation interval (every 120s) calls `create_token_session`. If the RPC returns `device_limit` due to a stale session from a previous tab/refresh not being cleaned up, the user gets kicked. The `beforeunload` handler for `release_token_session` also uses a raw `fetch` without the `Authorization` header, so it may fail silently.

### Changes

#### 1. `src/components/VideoPlayer.tsx` — Deduplicate Quality Levels

In `MANIFEST_PARSED` handler, deduplicate levels by height, keeping the highest-bitrate variant for each resolution:

```typescript
// Before: levels with same height appear multiple times
// After: deduplicate by height, pick highest bitrate per resolution
const seen = new Map<string, number>();
data.levels?.forEach((l: any, i: number) => {
  const label = l.height ? `${l.height}p` : `Level ${i}`;
  const existing = seen.get(label);
  if (existing === undefined || (l.bitrate || 0) > (data.levels[existing]?.bitrate || 0)) {
    seen.set(label, i);
  }
});
const levels = Array.from(seen.entries()).map(([label, value]) => ({ label, value }));
setQualities([{ label: "Auto", value: -1 }, ...levels]);
```

#### 2. `src/components/viewer/LiveViewerCount.tsx` — Fix Viewer Count Inflation

**Problem**: `sendBeacon` cannot send custom HTTP headers. The Supabase REST RPC endpoint requires `apikey` header (query param works) AND `Authorization` header. Without `Authorization`, the request is treated as anonymous, and the RPC may still work (since `viewer_counts` RLS allows public), but the `sendBeacon` Blob approach doesn't set `Content-Type: application/json` in a way Supabase accepts.

**Fix**:
- Persist `viewerKey` in `sessionStorage` so the same key survives page refreshes within the same tab
- Fix `sendBeacon` to use proper URL format with both `apikey` query param and send as proper JSON
- Add `Authorization` header via a `fetch` with `keepalive: true` as primary, `sendBeacon` as fallback

#### 3. `src/pages/LivePage.tsx` — Prevent Accidental Kicks

**Problem**: The `release_token_session` fetch in `beforeunload` doesn't include `Authorization` header, so it may fail. When user refreshes, old session isn't released, and new session creation may hit `device_limit`.

**Fix**:
- Add `Authorization: Bearer <anon_key>` to the `release_token_session` fetch
- In the session re-creation interval, treat `device_limit` errors more gracefully — don't kick the user, instead retry after releasing stale sessions
- Increase tolerance: if `create_token_session` returns `device_limit`, attempt a `self_reset_token_session` automatically before giving up

#### 4. Session Stability for 1000+ Users Over 7 Hours

- Reduce session re-creation interval from 120s to 180s (less DB load)
- Add retry tolerance: allow up to 3 consecutive `device_limit` errors before showing error (covers brief race conditions during refresh)
- Ensure `blocked-check` interval (60s) doesn't kick users on transient network errors

### Files Modified
1. `src/components/VideoPlayer.tsx` — Deduplicate quality levels
2. `src/components/viewer/LiveViewerCount.tsx` — Fix viewer key persistence and sendBeacon
3. `src/pages/LivePage.tsx` — Fix session release headers and device_limit handling

