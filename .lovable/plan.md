

## Plan: Auto-play, YouTube Quality, Token Device Limit & QRIS Fulfillment

### 1. Auto-play on page load/refresh

**Current state**: `autoPlay` prop is `true` by default, but browsers block unmuted autoplay. The M3U8 player calls `video.play()` on `MANIFEST_PARSED` — this may fail silently if not muted. YouTube already starts muted.

**Fix in `src/components/VideoPlayer.tsx`**:
- For M3U8: set `video.muted = true` before first `play()` call, then unmute after 1.5s (same pattern as YouTube)
- Add `autoPlay` and `muted` attributes to the `<video>` element for maximum browser compatibility
- Ensure the `play()` call in `MANIFEST_PARSED` handler succeeds by muting first

### 2. YouTube highest resolution with buffering fallback

**Fix in `src/components/VideoPlayer.tsx`**:
- On `onReady`, call `ytPlayerRef.current.setPlaybackQualityRange('highres', 'highres')` to force highest quality
- Track buffering duration: when `onStateChange` reports `state === 3` (buffering), start a 10s timer. If still buffering after 10s, call `setPlaybackQualityRange('default', 'default')` to switch to auto
- Clear the timer when playback resumes (`state === 1`)

### 3. Token device limit = 1

**Current state**: Already correct.
- `confirm_regular_order` RPC creates tokens with `max_devices = 1`
- `redeem_coins_for_token` RPC creates tokens with `max_devices = 1`
- No changes needed — just verification

### 4. Dynamic QRIS auto-confirmation + WhatsApp notification

**Current state**: `pakasir-callback` already:
- Auto-confirms via `confirm_regular_order` RPC (creates token)
- Sends WhatsApp with token, live link, replay info, and access password
- Updates order status from `pending` to `confirmed`

**Issue**: The polling in `PurchaseModal.tsx` checks `payment_status === "paid" || status === "confirmed"` — this should work. But `pakasir-callback` updates `payment_status` to `"paid"` first, then calls `confirm_regular_order` which sets `status = "confirmed"`. Both conditions are checked, so this is correct.

**Additional fix in `supabase/functions/pakasir-callback/index.ts`**:
- After `confirm_regular_order` succeeds, also update `status = "confirmed"` explicitly on the order (the RPC does this internally, but ensure `payment_status` is also set so the frontend polling catches it immediately)
- Already implemented correctly — no changes needed

### Summary of actual changes needed

**File: `src/components/VideoPlayer.tsx`**:
1. Add `muted autoPlay` attributes to `<video>` element and mute before first play, then auto-unmute after 1.5s
2. Add YouTube quality forcing to `highres` on ready, with a 10s buffering fallback to auto

No backend changes needed — token device limits and QRIS fulfillment are already correctly implemented.

