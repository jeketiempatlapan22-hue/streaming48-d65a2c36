

## Plan: Token Separation, Session Management, User Self-Reset & Viewer Count Fix

### Issues Identified

1. **Token separation** — TokenFactory already separates COIN- tokens into a "Koin" tab. The code looks correct. Need to verify if the issue is that `coin_tokens` query returns empty or the tab isn't visible. The filtering logic (`not("code", "like", "COIN-%")` and `like("code", "COIN-%")`) is correct. **No code change needed here** — it already works.

2. **LiveViewerCount** is in the page header (line 196 of LivePage.tsx) — needs to be removed from header and kept only in LiveChat.

3. **Auto-release token session on page leave** — `beforeunload` already exists (line 121). Need to also add `visibilitychange` (document hidden) and `pagehide` for mobile reliability.

4. **Strict device enforcement** — Already enforced in `create_token_session` RPC. Working as designed.

5. **User self-reset button** — New feature: button on device_limit error page to let users reset their own sessions (max 2x per 24h).

6. **Rate-limited self-reset** — Need a new table or use `rate_limits` to track user reset attempts.

---

### Changes

#### 1. Remove LiveViewerCount from LivePage header
**File: `src/pages/LivePage.tsx`**
- Remove `LiveViewerCount` import and usage from header (line 196)
- The viewer count already exists in LiveChat's presence-based `onlineCount`

#### 2. Improve session auto-release reliability
**File: `src/pages/LivePage.tsx`**
- Add `pagehide` event listener (works better on mobile than `beforeunload`)
- Add `visibilitychange` listener that releases session when page becomes hidden for extended time

#### 3. User self-reset on device_limit screen
**File: `src/pages/LivePage.tsx`**
- On the `device_limit` error screen, add a "Reset Session" button
- Call a new RPC `self_reset_token_session` that:
  - Deletes all active sessions for the token
  - Checks rate limit (max 2x per 24h per token code)
  - Returns success/failure

#### 4. New database RPC: `self_reset_token_session`
**Migration SQL:**
```sql
CREATE OR REPLACE FUNCTION public.self_reset_token_session(_token_code text, _fingerprint text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  t RECORD; _allowed boolean;
BEGIN
  SELECT * INTO t FROM public.tokens WHERE code = _token_code AND status = 'active';
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Token tidak valid'); END IF;

  -- Rate limit: 2 resets per 24 hours per token
  SELECT public.check_rate_limit('self_reset:' || _token_code, 2, 86400) INTO _allowed;
  IF NOT _allowed THEN
    RETURN jsonb_build_object('success', false, 'error', 'Batas reset tercapai (2x per 24 jam). Coba lagi nanti.');
  END IF;

  -- Delete all active sessions for this token
  DELETE FROM public.token_sessions WHERE token_id = t.id AND is_active = true;

  -- Create new session for current device
  INSERT INTO public.token_sessions (token_id, fingerprint, user_agent)
  VALUES (t.id, _fingerprint, '');

  RETURN jsonb_build_object('success', true);
END; $$;
```

#### 5. Update device_limit error UI
**File: `src/pages/LivePage.tsx`**
- Add "Reset Session" button that calls `self_reset_token_session` RPC
- On success, reload the page to re-validate
- Show remaining resets info and error messages

#### Summary of file changes:
- **`src/pages/LivePage.tsx`** — Remove LiveViewerCount from header, improve session release, add self-reset button on device_limit screen
- **Database migration** — New `self_reset_token_session` RPC function

