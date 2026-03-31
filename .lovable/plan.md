

## Plan: Remove Public Bot Ordering, Enhance Admin Token Creation, Fix Stats Separation

### Overview
Three changes: (1) remove public ordering commands from WhatsApp bot, (2) enhance `/createtoken` to include replay info and confirmation message format, (3) fix LandingStats to properly separate active shows from replays.

---

### 1. Remove Public WhatsApp Bot Ordering Commands

**File:** `supabase/functions/whatsapp-webhook/index.ts`

- In `processPublicCommand()`, remove the ORDER/BELI show handler, BELI KOIN handler, KOIN list handler, and their associated functions
- Keep: `MENU/SHOW/CEK` commands (info-only, no ordering)
- Remove functions: `handlePublicOrder`, `handlePublicCoinOrder`, `handlePublicCoinList`
- Update `handlePublicMenu()` to only show info commands (SHOW, CEK), remove ORDER/BELI/KOIN instructions
- Update `handlePublicShowList()` to remove the "ORDER" CTA at the bottom, replace with website link

---

### 2. Enhance Admin `/createtoken` with Confirmation Message + Replay Info

**File:** `supabase/functions/whatsapp-webhook/index.ts`

- Update `handleCreateTokenWa()` response to match the elegant confirmation format used in `pakasir-callback`:
  - Add visual dividers (`━━━━━━━━━━━━━━━━━━`)
  - Include show schedule, access password (if set)
  - Include replay info: link `https://replaytime.lovable.app` and replay password
  - Include live link with token
- Update `handleGiveTokenWa()` similarly — send the same formatted confirmation via WhatsApp to the target user's phone (lookup from `coin_orders` or `subscription_orders`)
- Fix the undeclared `show` variable bug on line 1788 (missing `let show: any = null;`)

---

### 3. Separate Replay Shows from Active Shows in Landing Stats

**File:** `src/components/viewer/LandingStats.tsx`

- Change "Total Show" to count only non-replay shows: `showsList.filter(s => !s.is_replay).length`
- "Replay" already counts replay shows correctly — keep as is
- This ensures active shows and replays don't mix

**File:** `supabase/functions/cached-landing-data/index.ts`

- No change needed — it returns all active shows; filtering happens client-side

---

### Technical Details

**WhatsApp bot public command removal:**
- Lines ~142-175: Remove coin/order matchers from `processPublicCommand`
- Lines ~177-196: Simplify menu text
- Lines ~228-586: Delete `handlePublicOrder`, `handlePublicCoinList`, `handlePublicCoinOrder` functions
- Keep `handlePublicShowList` and `handlePublicCheckOrder`

**Token creation enhancement (lines ~1777-1834):**
```
━━━━━━━━━━━━━━━━━━
✅ *Token Berhasil Dibuat!*
━━━━━━━━━━━━━━━━━━

🎬 Show: *{title}*
📅 Jadwal: {date} {time}
🔑 Token: {code}
📱 Max Device: {max}
⏰ Kedaluwarsa: {expiry}

📺 *Link Nonton:*
realtime48show.my.id/live?t={code}

🔐 Sandi Akses: {password}

🔄 *Info Replay:*
🔗 Link: https://replaytime.lovable.app
🔐 Sandi Replay: {password}
━━━━━━━━━━━━━━━━━━
```

**LandingStats fix (line 35):**
```typescript
shows: showsList.filter((s: any) => !s.is_replay).length,
```

