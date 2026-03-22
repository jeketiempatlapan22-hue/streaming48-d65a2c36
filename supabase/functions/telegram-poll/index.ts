import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const TELEGRAM_API = 'https://api.telegram.org/bot';
const MAX_RUNTIME_MS = 50_000;
const MIN_REMAINING_MS = 5_000;
const POLL_INTERVAL_MS = 2000;
const LOCK_WINDOW_MS = 60_000;
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const startTime = Date.now();
  const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN');
  if (!BOT_TOKEN) return errorResponse('TELEGRAM_BOT_TOKEN is not configured');

  const ADMIN_CHAT_ID = Deno.env.get('ADMIN_TELEGRAM_CHAT_ID');
  if (!ADMIN_CHAT_ID) return errorResponse('ADMIN_TELEGRAM_CHAT_ID is not configured');

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const lock = await acquireLock(supabase);
  if (!lock.acquired) return jsonResponse({ ok: true, skipped: true, reason: 'previous run still active' });

  let currentOffset = lock.update_offset;
  let totalProcessed = 0;

  try {
    await ensureNoWebhook(BOT_TOKEN);
    let pollCount = 0;

    while (true) {
      const elapsed = Date.now() - startTime;
      const remainingMs = MAX_RUNTIME_MS - elapsed;
      if (remainingMs < MIN_REMAINING_MS) break;

      await touchState(supabase);

      const response = await fetch(`${TELEGRAM_API}${BOT_TOKEN}/getUpdates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ offset: currentOffset, timeout: 0, allowed_updates: ['message'] }),
      });

      const data = await response.json();
      if (!response.ok) {
        if (data?.error_code === 409) { await sleep(5000); continue; }
        break;
      }

      pollCount++;
      const updates = data.result ?? [];

      if (updates.length > 0) {
        const rows = updates.filter((u: any) => u.message).map((u: any) => ({
          update_id: u.update_id, chat_id: u.message.chat.id,
          text: u.message.text ?? null, raw_update: u, processed: false,
        }));

        if (rows.length > 0) {
          await supabase.from('telegram_messages').upsert(rows, { onConflict: 'update_id' });
        }

        const newOffset = Math.max(...updates.map((u: any) => u.update_id)) + 1;
        await supabase.from('telegram_bot_state').update({ update_offset: newOffset, updated_at: new Date().toISOString() }).eq('id', 1);
        currentOffset = newOffset;

        const adminMessages = rows.filter((r: any) => String(r.chat_id) === ADMIN_CHAT_ID && r.text);
        for (const msg of adminMessages) {
          await processAdminMessage(supabase, BOT_TOKEN, ADMIN_CHAT_ID, msg);
          totalProcessed++;
          await supabase.from('telegram_messages').update({ processed: true }).eq('update_id', msg.update_id);
        }
        continue;
      }
      await sleep(POLL_INTERVAL_MS);
    }
    return jsonResponse({ ok: true, processed: totalProcessed, polls: pollCount, finalOffset: currentOffset });
  } finally {
    await releaseLock(supabase);
  }
});

async function ensureNoWebhook(botToken: string): Promise<boolean> {
  try {
    const infoRes = await fetch(`${TELEGRAM_API}${botToken}/getWebhookInfo`);
    const infoData = await infoRes.json();
    if (infoData.ok && infoData.result?.url) {
      await forceDeleteWebhook(botToken);
      await sleep(2000);
    }
    return true;
  } catch { return await forceDeleteWebhook(botToken); }
}

async function forceDeleteWebhook(botToken: string): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${TELEGRAM_API}${botToken}/deleteWebhook`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ drop_pending_updates: false }),
      });
      const data = await res.json();
      if (data.ok) return true;
    } catch {}
    await sleep(1000);
  }
  return false;
}

async function processAdminMessage(supabase: any, botToken: string, chatId: string, msg: any) {
  const rawText = (msg.text as string).trim();
  const text = rawText.toUpperCase();
  const yaMatch = text.match(/^YA\s+(.+)$/);
  const tidakMatch = text.match(/^TIDAK\s+(.+)$/);
  const isStatus = rawText === '/status' || text === '/STATUS';
  const addCoinMatch = rawText.match(/^\/addcoin\s+(\S+)\s+(\d+)(?:\s+(.+))?$/i);
  const balanceMatch = rawText.match(/^\/balance\s+(\S+)$/i);
  const isUsers = /^\/users$/i.test(rawText);

  if (isStatus) {
    await handleStatusCommand(supabase, botToken, chatId);
  } else if (addCoinMatch) {
    await handleAddCoinCommand(supabase, botToken, chatId, addCoinMatch[1], parseInt(addCoinMatch[2], 10), addCoinMatch[3] || null);
  } else if (balanceMatch) {
    await handleBalanceCommand(supabase, botToken, chatId, balanceMatch[1]);
  } else if (isUsers) {
    await handleUsersCommand(supabase, botToken, chatId);
  } else if (yaMatch) {
    const ids = yaMatch[1].split(',').map((s: string) => s.trim().toLowerCase()).filter(Boolean);
    await processBulkOrders(supabase, botToken, chatId, ids, 'approve');
  } else if (tidakMatch) {
    const ids = tidakMatch[1].split(',').map((s: string) => s.trim().toLowerCase()).filter(Boolean);
    await processBulkOrders(supabase, botToken, chatId, ids, 'reject');
  }
}

async function processBulkOrders(supabase: any, botToken: string, chatId: string, shortIds: string[], action: 'approve' | 'reject') {
  const results: string[] = [];
  for (const shortId of shortIds) {
    const result = await processOrderByShortId(supabase, botToken, chatId, shortId, action);
    results.push(result);
  }
  if (shortIds.length > 1) {
    const summary = `📋 *Hasil Bulk ${action === 'approve' ? 'Konfirmasi' : 'Tolak'}:*\n\n${results.join('\n')}`;
    await sendTelegramMessage(botToken, chatId, summary);
  }
}

async function processOrderByShortId(supabase: any, botToken: string, chatId: string, shortId: string, action: 'approve' | 'reject'): Promise<string> {
  const { data: coinOrder } = await supabase.from('coin_orders').select('id, user_id, coin_amount, status, package_id, phone, short_id').eq('short_id', shortId).eq('status', 'pending').maybeSingle();
  if (coinOrder) { await processCoinOrder(supabase, botToken, chatId, coinOrder, action, shortId.length <= 5); return `${action === 'approve' ? '✅' : '❌'} ${escapeMarkdown(shortId)} \\(koin\\)`; }

  const { data: subOrder } = await supabase.from('subscription_orders').select('id, show_id, phone, email, status, short_id').eq('short_id', shortId).eq('status', 'pending').maybeSingle();
  if (subOrder) { await processSubscriptionOrder(supabase, botToken, chatId, subOrder, action, shortId.length <= 5); return `${action === 'approve' ? '✅' : '❌'} ${escapeMarkdown(shortId)} \\(subscription\\)`; }

  return `⚠️ ${escapeMarkdown(shortId)} tidak ditemukan`;
}

async function handleStatusCommand(supabase: any, botToken: string, chatId: string) {
  try {
    const { data: coinOrders } = await supabase.from('coin_orders').select('id, coin_amount, price, created_at, user_id, short_id').eq('status', 'pending').order('created_at', { ascending: false }).limit(10);
    const { data: subOrders } = await supabase.from('subscription_orders').select('id, show_id, phone, email, created_at, short_id').eq('status', 'pending').order('created_at', { ascending: false }).limit(10);

    let message = '📊 *STATUS ORDER TERBARU*\n\n';

    if (coinOrders?.length > 0) {
      message += `🪙 *Order Koin Pending \\(${coinOrders.length}\\):*\n`;
      const allIds: string[] = [];
      for (const o of coinOrders) {
        const { data: profile } = await supabase.from('profiles').select('username').eq('id', o.user_id).single();
        const time = new Date(o.created_at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
        const sid = o.short_id || o.id.substring(0, 6);
        allIds.push(sid);
        message += `• \`${escapeMarkdown(sid)}\` ${escapeMarkdown(profile?.username || 'User')} \\- ${o.coin_amount} koin \\| ${escapeMarkdown(time)}\n`;
      }
      message += `\n💡 Konfirmasi semua: \`YA ${allIds.join(',')}\`\n`;
    } else { message += '🪙 *Order Koin:* Tidak ada order pending\n'; }

    message += '\n';

    if (subOrders?.length > 0) {
      message += `🎬 *Subscription Pending \\(${subOrders.length}\\):*\n`;
      const allIds: string[] = [];
      for (const o of subOrders) {
        const { data: show } = await supabase.from('shows').select('title').eq('id', o.show_id).single();
        const time = new Date(o.created_at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
        const sid = o.short_id || o.id.substring(0, 6);
        allIds.push(sid);
        message += `• \`${escapeMarkdown(sid)}\` ${escapeMarkdown(show?.title || 'Unknown')} \\- ${escapeMarkdown(o.email)} \\| ${escapeMarkdown(time)}\n`;
      }
      message += `\n💡 Konfirmasi semua: \`YA ${allIds.join(',')}\`\n`;
    } else { message += '🎬 *Subscription:* Tidak ada order pending\n'; }

    message += '\n📌 *Commands:*\n`YA <id>` \\- Konfirmasi order\n`YA id1,id2,id3` \\- Bulk konfirmasi\n`TIDAK <id>` \\- Tolak order\n`/addcoin <username> <jumlah>` \\- Tambah koin\n`/balance <username>` \\- Cek saldo user\n`/users` \\- Daftar semua user\n`/status` \\- Cek order pending';
    await sendTelegramMessage(botToken, chatId, message);
  } catch { await sendTelegramMessage(botToken, chatId, '⚠️ Error mengambil data status'); }
}

async function processCoinOrder(supabase: any, botToken: string, chatId: string, order: any, action: 'approve' | 'reject', isBulk: boolean) {
  try {
    const sid = order.short_id || order.id.substring(0, 6);
    if (action === 'approve') {
      const { data: confirmedOrder } = await supabase.from('coin_orders').update({ status: 'confirmed' }).eq('id', order.id).eq('status', 'pending').select('id').maybeSingle();
      if (!confirmedOrder) { if (!isBulk) await sendTelegramMessage(botToken, chatId, `⚠️ Order koin \`${escapeMarkdown(sid)}\` sudah diproses\.`); return; }

      const { data: existingBalance } = await supabase.from('coin_balances').select('balance').eq('user_id', order.user_id).maybeSingle();
      if (existingBalance) {
        await supabase.from('coin_balances').update({ balance: existingBalance.balance + order.coin_amount, updated_at: new Date().toISOString() }).eq('user_id', order.user_id);
      } else {
        await supabase.from('coin_balances').insert({ user_id: order.user_id, balance: order.coin_amount });
      }

      const { data: profile } = await supabase.from('profiles').select('username').eq('id', order.user_id).single();
      const { data: balanceData } = await supabase.from('coin_balances').select('balance').eq('user_id', order.user_id).maybeSingle();
      const newBalance = balanceData?.balance ?? order.coin_amount;

      if (order.phone) {
        const waMsg = `✅ Pembayaran kamu untuk *${order.coin_amount} koin* telah dikonfirmasi!\n\n💰 Saldo saat ini: ${newBalance} koin.\n\nTerima kasih! 🎉`;
        await sendFonnteWhatsApp(order.phone, waMsg);
      }

      if (!isBulk) await sendTelegramMessage(botToken, chatId, `✅ Order koin \`${escapeMarkdown(sid)}\` berhasil dikonfirmasi\\!\n👤 ${escapeMarkdown(profile?.username || 'User')}\n💰 \\+${order.coin_amount} koin\n🏦 Saldo: ${newBalance}`);
    } else {
      await supabase.from('coin_orders').update({ status: 'rejected' }).eq('id', order.id).eq('status', 'pending');
      if (order.phone) await sendFonnteWhatsApp(order.phone, '❌ Maaf, pembayaran kamu untuk pembelian koin tidak dapat dikonfirmasi.\n\nSilakan hubungi admin jika ada pertanyaan.');
      if (!isBulk) await sendTelegramMessage(botToken, chatId, `❌ Order koin \`${escapeMarkdown(sid)}\` telah ditolak\.`);
    }
  } catch (e) { await sendTelegramMessage(botToken, chatId, `⚠️ Error: ${e instanceof Error ? e.message : 'Unknown'}`); }
}

async function processSubscriptionOrder(supabase: any, botToken: string, chatId: string, order: any, action: 'approve' | 'reject', isBulk: boolean) {
  try {
    const sid = order.short_id || order.id.substring(0, 6);
    const { data: show } = await supabase.from('shows').select('title, group_link').eq('id', order.show_id).single();
    const showTitle = show?.title || 'Unknown Show';

    if (action === 'approve') {
      const { data: confirmed } = await supabase.from('subscription_orders').update({ status: 'confirmed' }).eq('id', order.id).eq('status', 'pending').select('id').maybeSingle();
      if (!confirmed) { if (!isBulk) await sendTelegramMessage(botToken, chatId, `⚠️ Subscription \`${escapeMarkdown(sid)}\` sudah diproses\.`); return; }
      if (!isBulk) await sendTelegramMessage(botToken, chatId, `✅ Subscription \`${escapeMarkdown(sid)}\` untuk "${escapeMarkdown(showTitle)}" berhasil dikonfirmasi\\!`);
    } else {
      await supabase.from('subscription_orders').update({ status: 'rejected' }).eq('id', order.id).eq('status', 'pending');
      if (!isBulk) await sendTelegramMessage(botToken, chatId, `❌ Subscription \`${escapeMarkdown(sid)}\` untuk "${escapeMarkdown(showTitle)}" telah ditolak\.`);
    }
  } catch (e) { await sendTelegramMessage(botToken, chatId, `⚠️ Error: ${e instanceof Error ? e.message : 'Unknown'}`); }
}
async function handleAddCoinCommand(supabase: any, botToken: string, chatId: string, username: string, amount: number, reason: string | null) {
  try {
    if (amount <= 0 || amount > 100000) {
      await sendTelegramMessage(botToken, chatId, '⚠️ Jumlah koin harus antara 1\\-100\\.000');
      return;
    }

    // Find user by username
    const { data: profile } = await supabase
      .from('profiles')
      .select('id, username')
      .ilike('username', username)
      .maybeSingle();

    if (!profile) {
      await sendTelegramMessage(botToken, chatId, `⚠️ User "${escapeMarkdown(username)}" tidak ditemukan\\.`);
      return;
    }

    // Upsert coin balance
    const { data: existing } = await supabase
      .from('coin_balances')
      .select('balance')
      .eq('user_id', profile.id)
      .maybeSingle();

    let newBalance: number;
    if (existing) {
      newBalance = existing.balance + amount;
      await supabase.from('coin_balances').update({ balance: newBalance, updated_at: new Date().toISOString() }).eq('user_id', profile.id);
    } else {
      newBalance = amount;
      await supabase.from('coin_balances').insert({ user_id: profile.id, balance: amount });
    }

    // Log transaction
    await supabase.from('coin_transactions').insert({
      user_id: profile.id,
      amount: amount,
      type: 'admin_grant',
      description: reason || `Koin ditambahkan oleh admin via Telegram`,
    });

    await sendTelegramMessage(botToken, chatId,
      `✅ *Koin Ditambahkan\\!*\n\n👤 User: ${escapeMarkdown(profile.username || username)}\n💰 \\+${amount} koin\n🏦 Saldo baru: ${newBalance}${reason ? `\n📝 Alasan: ${escapeMarkdown(reason)}` : ''}`
    );
  } catch (e) {
    await sendTelegramMessage(botToken, chatId, `⚠️ Error addcoin: ${e instanceof Error ? escapeMarkdown(e.message) : 'Unknown'}`);
  }
}

function escapeMarkdown(text: string): string {
  return String(text || '').replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

async function sendFonnteWhatsApp(phone: string, message: string) {
  const FONNTE_TOKEN = Deno.env.get('FONNTE_API_TOKEN');
  if (!FONNTE_TOKEN) return;
  const cleanPhone = phone.replace(/^0/, '62').replace(/[^0-9]/g, '');
  if (!cleanPhone) return;
  try {
    await fetch('https://api.fonnte.com/send', {
      method: 'POST', headers: { Authorization: FONNTE_TOKEN },
      body: new URLSearchParams({ target: cleanPhone, message }),
    });
  } catch (e) { console.error('sendFonnteWhatsApp error:', e); }
}

async function sendTelegramMessage(botToken: string, chatId: string, text: string) {
  const res = await fetch(`${TELEGRAM_API}${botToken}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'MarkdownV2' }),
  });
  const data = await res.json();
  if (!data.ok) {
    await fetch(`${TELEGRAM_API}${botToken}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: text.replace(/\\([_*\[\]()~`>#+\-=|{}.!\\])/g, '$1') }),
    });
  }
}

async function acquireLock(supabase: any): Promise<{ acquired: boolean; update_offset: number }> {
  const nowIso = new Date().toISOString();
  const staleBeforeIso = new Date(Date.now() - LOCK_WINDOW_MS).toISOString();
  const { data, error } = await supabase.from('telegram_bot_state').update({ updated_at: nowIso }).eq('id', 1).lt('updated_at', staleBeforeIso).select('update_offset').maybeSingle();
  if (error) throw new Error(`lock failed: ${error.message}`);
  if (!data) return { acquired: false, update_offset: 0 };
  return { acquired: true, update_offset: Number(data.update_offset ?? 0) };
}

async function touchState(supabase: any) {
  await supabase.from('telegram_bot_state').update({ updated_at: new Date().toISOString() }).eq('id', 1);
}

async function releaseLock(supabase: any) {
  await supabase.from('telegram_bot_state').update({ updated_at: new Date(0).toISOString() }).eq('id', 1);
}

function sleep(ms: number): Promise<void> { return new Promise(resolve => setTimeout(resolve, ms)); }

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

function errorResponse(msg: string) {
  console.error('telegram-poll error:', msg);
  return jsonResponse({ error: msg }, 500);
}