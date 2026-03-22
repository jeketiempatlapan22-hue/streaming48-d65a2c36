

## Plan: Bot Commands, Admin Panel Cleanup, Poll Integration, Animations & Stability

### 1. Add `/shows` bot command + enforce ID-only for action commands

**File: `supabase/functions/telegram-poll/index.ts`**

- Add new regex: `const isShows = /^\/shows$/i.test(rawText);`
- Add `handleShowsCommand()` that lists ALL shows (active) with Title, Schedule Date/Time, Short ID
- Update `/setlive`, `/replay`, `/setoffline` to require `#ID` only (remove name-based matching for action commands)
  - `/setlive` (no args) → just toggle live
  - `/setlive #ID` → toggle live + set active show
  - `/replay #ID` → toggle replay
  - `/replay` → list shows with replay info (keep as-is)
- Update `/help` text to reflect ID-only usage

### 2. Remove Analytics menu from admin panel

**File: `src/components/admin/AdminSidebar.tsx`**
- Remove `analytics` entry and `TrendingUp` import from `sections` array

**File: `src/pages/AdminDashboard.tsx`**
- Remove `AdminAnalytics` lazy import and `case "analytics"` from `renderSection()`

### 3. Move Live Poll into Monitor

**File: `src/components/admin/AdminSidebar.tsx`**
- Remove `polls` entry from `sections` array

**File: `src/pages/AdminDashboard.tsx`**
- Remove `PollManager` import and `case "polls"`

**File: `src/components/admin/AdminMonitor.tsx`**
- Import and render `PollManager` below the chat section
- Import and render `LivePoll` as admin preview

### 4. Fix LivePoll realtime (stale closure) + ensure all users can vote/change

**File: `src/components/viewer/LivePoll.tsx`**
- Use `useRef` for poll ID to fix stale closure in realtime listener
- Poll votes table already has public INSERT/SELECT/DELETE RLS — all users can vote
- Reduce debounce to 300ms for snappier updates

### 5. Make animations slightly bigger

**File: `src/components/viewer/PlayerAnimations.tsx`**
- Increase particle size: `size: 4 + Math.random() * 10` (was `2 + Math.random() * 6`)
- Increase emoji sizes in getStyle for leaves/hearts/sakura by +4px
- Keep `backgroundOnly` z-index at z-0 so animations stay behind player

### 6. Session stability for 1000 users / 7 hours

**File: `src/pages/LivePage.tsx`**
- Remove `pagehide` session release (causes false releases on mobile/tab switch)
- Keep only `beforeunload` for intentional page close
- Increase heartbeat interval from 45s to 120s to reduce server load (6h stale cleanup covers gaps)
- Add retry logic on heartbeat failure (don't kick user on transient error)

**File: `supabase/functions/stream-proxy/index.ts`**
- Increase rate limits for 7-hour sessions (already set to 180/min for m3u8, sufficient)
- Increase signed URL expiry to 7200s (2 hours) so fewer refreshes needed

### 7. Device locking strictness

The `create_token_session` RPC already has advisory locks and strict `max_devices` enforcement. The issue of stale sessions releasing too quickly (via `pagehide`) is addressed in step 6. With only `beforeunload` releasing sessions, and 6-hour stale cleanup, device locks will hold properly.

### Summary of files changed:
- `supabase/functions/telegram-poll/index.ts` — `/shows` command, ID-only for actions
- `src/components/admin/AdminSidebar.tsx` — Remove analytics + polls
- `src/pages/AdminDashboard.tsx` — Remove analytics + polls cases
- `src/components/admin/AdminMonitor.tsx` — Add PollManager + LivePoll
- `src/components/viewer/LivePoll.tsx` — Fix stale closure, reduce debounce
- `src/components/viewer/PlayerAnimations.tsx` — Bigger particles
- `src/pages/LivePage.tsx` — Remove pagehide, increase heartbeat, add retry
- `supabase/functions/stream-proxy/index.ts` — Increase URL expiry

