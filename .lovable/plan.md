

## Plan: Fix Coin Bug, Add Membership Messaging & Bot Commands

### Root Cause: Coin Balance Increasing Without Admin Confirmation

**Bug found**: When confirming coin orders via bot (Telegram/WhatsApp), the code manually reads balance, adds coins, then writes back. This is NOT atomic -- if two confirmations happen simultaneously, or if the `confirm_coin_order` RPC is also called (from admin panel), coins get double-credited.

Both `telegram-poll/index.ts` (line 390-395) and `whatsapp-webhook/index.ts` (line 462-467) have this pattern:
```
read balance → add amount → write back (NOT ATOMIC)
```

Meanwhile, the `confirm_coin_order` RPC already handles this correctly with atomic upsert. The bot code should use the RPC instead.

### Changes

#### 1. Fix coin double-credit in Telegram bot
**File: `supabase/functions/telegram-poll/index.ts`**
- In `processCoinOrder()` (line 383-413): Replace manual balance update with `supabase.rpc("confirm_coin_order", { _order_id: order.id })` call
- This ensures atomic balance update and prevents race conditions
- The RPC already updates status + balance + handles conflicts

#### 2. Fix coin double-credit in WhatsApp bot
**File: `supabase/functions/whatsapp-webhook/index.ts`**
- In `processCoinOrder()` (line 455-488): Same fix -- use `confirm_coin_order` RPC instead of manual balance update

#### 3. Add `/members` bot command (Telegram)
**File: `supabase/functions/telegram-poll/index.ts`**
- Add regex: `/^\/members$/i`
- `handleMembersCommand()`: Query `subscription_orders` with status=confirmed, join with shows, list member name/phone/email grouped by show

#### 4. Add `/msgmembers` bot command (Telegram)
**File: `supabase/functions/telegram-poll/index.ts`**
- Add regex: `/^\/msgmembers\s+(.+)$/is`
- `handleMsgMembersCommand()`: Send WhatsApp message to ALL confirmed membership users across all subscription shows

#### 5. Add same commands to WhatsApp bot
**File: `supabase/functions/whatsapp-webhook/index.ts`**
- Add `/members` and `/msgmembers` commands mirroring the Telegram bot

#### 6. Add individual WA messaging on admin panel
**File: `src/components/admin/SubscriptionOrderManager.tsx`**
- Already has per-order WA messaging and bulk messaging
- Add a "Send via Fonnte" button that sends through the backend edge function `send-whatsapp` instead of opening wa.me links (for server-side sending)
- This allows admin to send without leaving the dashboard

#### 7. Update help text in both bots
- Add `/members` and `/msgmembers <pesan>` to help output

### Summary of file changes:
- **`supabase/functions/telegram-poll/index.ts`** -- Fix coin RPC, add `/members` and `/msgmembers`
- **`supabase/functions/whatsapp-webhook/index.ts`** -- Fix coin RPC, add `/members` and `/msgmembers`
- **`src/components/admin/SubscriptionOrderManager.tsx`** -- Add Fonnte-based server-side WA sending

