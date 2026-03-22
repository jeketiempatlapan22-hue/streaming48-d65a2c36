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
          const cmdText = (msg.text as string).trim();
          await processAdminMessage(supabase, BOT_TOKEN, ADMIN_CHAT_ID, msg);
          totalProcessed++;
          await supabase.from('telegram_messages').update({ processed: true }).eq('update_id', msg.update_id);
          
          // Cross-notify to WhatsApp (skip read-only commands)
          const readOnly = /^\/(help|start|status|balance|users|replay)$/i;
          if (!readOnly.test(cmdText)) {
            await notifyWhatsAppAdmins(supabase, cmdText);
          }
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
  const isHelp = /^\/(help|start)$/i.test(rawText);
  const deductCoinMatch = rawText.match(/^\/deductcoin\s+(\S+)\s+(\d+)(?:\s+(.+))?$/i);
  const broadcastMatch = rawText.match(/^\/broadcast\s+(.+)$/is);
  const replayMatch = rawText.match(/^\/replay\s+(.+)$/i);
  const isReplayList = /^\/replay$/i.test(rawText);
  const setliveMatch = rawText.match(/^\/setlive(?:\s+(.+))?$/i);
  const isSetOffline = /^\/setoffline$/i.test(rawText);
  const isShowInfo = /^\/showinfo$/i.test(rawText);
  const msgshowMatch = rawText.match(/^\/msgshow\s+(.+?)\s*\|\s*(.+)$/is);
  const resetMatch = text.match(/^RESET\s+(\S+)$/);
  const tolakResetMatch = text.match(/^TOLAK_RESET\s+(\S+)$/);
  const setactiveMatch = rawText.match(/^\/setactive\s+(\S+)$/i);

  if (isHelp) {
    await handleHelpCommand(botToken, chatId);
  } else if (isStatus) {
    await handleStatusCommand(supabase, botToken, chatId);
  } else if (addCoinMatch) {
    await handleAddCoinCommand(supabase, botToken, chatId, addCoinMatch[1], parseInt(addCoinMatch[2], 10), addCoinMatch[3] || null);
  } else if (deductCoinMatch) {
    await handleDeductCoinCommand(supabase, botToken, chatId, deductCoinMatch[1], parseInt(deductCoinMatch[2], 10), deductCoinMatch[3] || null);
  } else if (balanceMatch) {
    await handleBalanceCommand(supabase, botToken, chatId, balanceMatch[1]);
  } else if (isUsers) {
    await handleUsersCommand(supabase, botToken, chatId);
  } else if (broadcastMatch) {
    await handleBroadcastCommand(supabase, botToken, chatId, broadcastMatch[1].trim());
  } else if (replayMatch) {
    await handleReplayToggle(supabase, botToken, chatId, replayMatch[1].trim());
  } else if (isReplayList) {
    await handleReplayList(supabase, botToken, chatId);
  } else if (setactiveMatch) {
    await handleSetActiveCommand(supabase, botToken, chatId, setactiveMatch[1].trim());
  } else if (setliveMatch) {
    await handleSetLiveCommand(supabase, botToken, chatId, setliveMatch[1]?.trim() || null);
  } else if (isSetOffline) {
    await handleSetOfflineCommand(supabase, botToken, chatId);
  } else if (isShowInfo) {
    await handleShowInfoCommand(supabase, botToken, chatId);
  } else if (msgshowMatch) {
    await handleMsgShowCommand(supabase, botToken, chatId, msgshowMatch[1].trim(), msgshowMatch[2].trim());
  } else if (resetMatch) {
    await handlePasswordResetCommand(supabase, botToken, chatId, resetMatch[1].toLowerCase(), 'approve');
  } else if (tolakResetMatch) {
    await handlePasswordResetCommand(supabase, botToken, chatId, tolakResetMatch[1].toLowerCase(), 'reject');
  } else if (yaMatch) {
    const ids = yaMatch[1].split(',').map((s: string) => s.trim().toLowerCase()).filter(Boolean);
    await processBulkOrders(supabase, botToken, chatId, ids, 'approve');
  } else if (tidakMatch) {
    const ids = tidakMatch[1].split(',').map((s: string) => s.trim().toLowerCase()).filter(Boolean);
    await processBulkOrders(supabase, botToken, chatId, ids, 'reject');
  }
}

// Helper: find show by short ID (first 6 hex chars of UUID) or by name
async function findShowByIdOrName(supabase: any, input: string, activeOnly = true): Promise<{ show: any | null; multiple: any[] | null; error: string | null }> {
  const shortIdMatch = input.match(/^#?([a-f0-9]{6})$/i);
  if (shortIdMatch) {
    const shortId = shortIdMatch[1].toLowerCase();
    const query = supabase.from('shows').select('id, title, is_replay, replay_coin_price, access_password, schedule_date, schedule_time, coin_price, is_active, category');
    if (activeOnly) query.eq('is_active', true);
    const { data: shows } = await query;
    const match = (shows || []).find((s: any) => s.id.replace(/-/g, '').slice(0, 6).toLowerCase() === shortId);
    if (match) return { show: match, multiple: null, error: null };
    return { show: null, multiple: null, error: `Show dengan ID #${shortId} tidak ditemukan.` };
  }
  // Search by name
  const query = supabase.from('shows').select('id, title, is_replay, replay_coin_price, access_password, schedule_date, schedule_time, coin_price, is_active, category').ilike('title', `%${input}%`).limit(5);
  if (activeOnly) query.eq('is_active', true);
  const { data: shows } = await query;
  if (!shows || shows.length === 0) return { show: null, multiple: null, error: `Show "${input}" tidak ditemukan.` };
  if (shows.length === 1) return { show: shows[0], multiple: null, error: null };
  return { show: null, multiple: shows, error: null };
}

function showShortId(id: string): string {
  return id.replace(/-/g, '').slice(0, 6).toLowerCase();
}

async function handleHelpCommand(botToken: string, chatId: string) {
  const msg = `🤖 *REALTIME48 BOT \\- DAFTAR COMMAND*\n\n` +
    `📋 *Order Management:*\n` +
    `\`/status\` \\- Cek order pending\n` +
    `\`YA <id>\` \\- Konfirmasi order\n` +
    `\`YA id1,id2,id3\` \\- Bulk konfirmasi\n` +
    `\`TIDAK <id>\` \\- Tolak order\n\n` +
    `💰 *Koin Management:*\n` +
    `\`/addcoin <user> <jumlah>\` \\- Tambah koin\n` +
    `\`/addcoin <user> <jumlah> <alasan>\` \\- Tambah koin \\+ alasan\n` +
    `\`/deductcoin <user> <jumlah>\` \\- Kurangi koin\n` +
    `\`/balance <user>\` \\- Cek saldo user\n\n` +
    `👥 *User Management:*\n` +
    `\`/users\` \\- Daftar semua user\n\n` +
    `🎬 *Show Management:*\n` +
    `\`/replay\` \\- Lihat daftar show \\+ ID\n` +
    `\`/replay <nama/ID>\` \\- Toggle replay by nama atau \\#ID\n` +
    `\`/setactive <ID>\` \\- Set show aktif by \\#ID\n\n` +
    `📡 *Live Stream:*\n` +
    `\`/showinfo\` \\- Info stream \\& show aktif saat ini\n` +
    `\`/setlive\` \\- Set stream jadi LIVE\n` +
    `\`/setlive <nama/ID>\` \\- Set LIVE \\+ pilih show aktif\n` +
    `\`/setoffline\` \\- Set semua stream jadi OFFLINE\n\n` +
    `🔑 *Password Reset:*\n` +
    `\`RESET <id>\` \\- Setujui reset password\n` +
    `\`TOLAK\\_RESET <id>\` \\- Tolak reset password\n\n` +
    `📨 *Messaging:*\n` +
    `\`/msgshow <nama/ID> | <pesan>\` \\- Kirim WA ke pemesan show\n\n` +
    `📢 *Lainnya:*\n` +
    `\`/broadcast <pesan>\` \\- Kirim notifikasi ke semua user\n` +
    `\`/help\` \\- Tampilkan daftar command ini\n\n` +
    `💡 _ID show bisa dilihat di Admin Panel Show Manager \\(\\#6 digit\\)_`;
  await sendTelegramMessage(botToken, chatId, msg);
}

async function handleDeductCoinCommand(supabase: any, botToken: string, chatId: string, username: string, amount: number, reason: string | null) {
  try {
    if (amount <= 0 || amount > 100000) {
      await sendTelegramMessage(botToken, chatId, '⚠️ Jumlah koin harus antara 1\\-100\\.000');
      return;
    }
    const { data: profile } = await supabase.from('profiles').select('id, username').ilike('username', username).maybeSingle();
    if (!profile) {
      await sendTelegramMessage(botToken, chatId, `⚠️ User "${escapeMarkdown(username)}" tidak ditemukan\\.`);
      return;
    }
    const { data: existing } = await supabase.from('coin_balances').select('balance').eq('user_id', profile.id).maybeSingle();
    const currentBal = existing?.balance ?? 0;
    if (currentBal < amount) {
      await sendTelegramMessage(botToken, chatId, `⚠️ Saldo ${escapeMarkdown(profile.username)} hanya ${currentBal} koin\\. Tidak cukup untuk dikurangi ${amount}\\.`);
      return;
    }
    const newBalance = currentBal - amount;
    await supabase.from('coin_balances').update({ balance: newBalance, updated_at: new Date().toISOString() }).eq('user_id', profile.id);
    await supabase.from('coin_transactions').insert({
      user_id: profile.id, amount: -amount, type: 'admin_deduct',
      description: reason || 'Koin dikurangi oleh admin via Telegram',
    });
    await sendTelegramMessage(botToken, chatId,
      `✅ *Koin Dikurangi\\!*\n\n👤 User: ${escapeMarkdown(profile.username)}\n💸 \\-${amount} koin\n🏦 Saldo baru: ${newBalance}${reason ? `\n📝 Alasan: ${escapeMarkdown(reason)}` : ''}`
    );
  } catch (e) {
    await sendTelegramMessage(botToken, chatId, `⚠️ Error: ${e instanceof Error ? escapeMarkdown(e.message) : 'Unknown'}`);
  }
}

async function handleBroadcastCommand(supabase: any, botToken: string, chatId: string, message: string) {
  try {
    await supabase.from('admin_notifications').insert({
      title: '📢 Broadcast Admin',
      message: message,
      type: 'broadcast',
    });
    await sendTelegramMessage(botToken, chatId, `✅ Broadcast terkirim\\!\n\n📝 Pesan: ${escapeMarkdown(message)}`);
  } catch (e) {
    await sendTelegramMessage(botToken, chatId, `⚠️ Error broadcast: ${e instanceof Error ? escapeMarkdown(e.message) : 'Unknown'}`);
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

    message += '\n📌 Ketik `/help` untuk daftar semua command';
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

async function handleBalanceCommand(supabase: any, botToken: string, chatId: string, username: string) {
  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('id, username')
      .ilike('username', username)
      .maybeSingle();

    if (!profile) {
      await sendTelegramMessage(botToken, chatId, `⚠️ User "${escapeMarkdown(username)}" tidak ditemukan\\.`);
      return;
    }

    const { data: balData } = await supabase
      .from('coin_balances')
      .select('balance')
      .eq('user_id', profile.id)
      .maybeSingle();

    const balance = balData?.balance ?? 0;

    await sendTelegramMessage(botToken, chatId,
      `💰 *Saldo Koin*\n\n👤 User: ${escapeMarkdown(profile.username)}\n🪙 Saldo: *${balance}* koin`
    );
  } catch (e) {
    await sendTelegramMessage(botToken, chatId, `⚠️ Error: ${e instanceof Error ? escapeMarkdown(e.message) : 'Unknown'}`);
  }
}

async function handleUsersCommand(supabase: any, botToken: string, chatId: string) {
  try {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, username, created_at')
      .order('created_at', { ascending: false })
      .limit(50);

    if (!profiles || profiles.length === 0) {
      await sendTelegramMessage(botToken, chatId, '📋 Belum ada user terdaftar\\.');
      return;
    }

    let message = `👥 *DAFTAR USER \\(${profiles.length}\\)*\n\n`;

    for (const p of profiles) {
      const { data: balData } = await supabase
        .from('coin_balances')
        .select('balance')
        .eq('user_id', p.id)
        .maybeSingle();

      const bal = balData?.balance ?? 0;
      const date = new Date(p.created_at).toLocaleDateString('id-ID');
      message += `• ${escapeMarkdown(p.username || 'No Name')} \\- 🪙 ${bal} koin \\| 📅 ${escapeMarkdown(date)}\n`;
    }

    message += `\n💡 Cek saldo: \`/balance <username>\`\nTambah koin: \`/addcoin <username> <jumlah>\``;

    await sendTelegramMessage(botToken, chatId, message);
  } catch (e) {
    await sendTelegramMessage(botToken, chatId, `⚠️ Error: ${e instanceof Error ? escapeMarkdown(e.message) : 'Unknown'}`);
  }
}

async function handleReplayList(supabase: any, botToken: string, chatId: string) {
  try {
    const { data: shows } = await supabase
      .from('shows')
      .select('id, title, is_replay, replay_coin_price, schedule_date, access_password')
      .eq('is_active', true)
      .gt('replay_coin_price', 0)
      .order('created_at', { ascending: false })
      .limit(20);

    if (!shows || shows.length === 0) {
      await sendTelegramMessage(botToken, chatId, '🎬 Tidak ada show dengan harga replay\\.');
      return;
    }

    let message = `🎬 *DAFTAR SHOW REPLAY*\n\n`;
    for (const s of shows) {
      const status = s.is_replay ? '🟢 ON' : '🔴 OFF';
      const pw = s.access_password ? `🔐 ${escapeMarkdown(s.access_password)}` : '⚠️ No password';
      message += `${status} *${escapeMarkdown(s.title)}*\n   📅 ${escapeMarkdown(s.schedule_date || '-')} \\| 🪙 ${s.replay_coin_price} koin \\| ${pw}\n\n`;
    }
    message += `💡 Toggle replay: \`/replay <nama show>\``;
    await sendTelegramMessage(botToken, chatId, message);
  } catch (e) {
    await sendTelegramMessage(botToken, chatId, `⚠️ Error: ${e instanceof Error ? escapeMarkdown(e.message) : 'Unknown'}`);
  }
}

async function handleReplayToggle(supabase: any, botToken: string, chatId: string, showName: string) {
  try {
    const { data: shows } = await supabase
      .from('shows')
      .select('id, title, is_replay, replay_coin_price, access_password')
      .eq('is_active', true)
      .ilike('title', `%${showName}%`)
      .limit(5);

    if (!shows || shows.length === 0) {
      await sendTelegramMessage(botToken, chatId, `⚠️ Show "${escapeMarkdown(showName)}" tidak ditemukan\\.`);
      return;
    }

    if (shows.length > 1) {
      let msg = `⚠️ Ditemukan ${shows.length} show:\n\n`;
      for (const s of shows) {
        const status = s.is_replay ? '🟢 ON' : '🔴 OFF';
        msg += `${status} ${escapeMarkdown(s.title)}\n`;
      }
      msg += `\n💡 Gunakan nama yang lebih spesifik\\.`;
      await sendTelegramMessage(botToken, chatId, msg);
      return;
    }

    const show = shows[0];
    const newStatus = !show.is_replay;

    await supabase.from('shows').update({ is_replay: newStatus }).eq('id', show.id);

    const statusText = newStatus ? '🟢 ON' : '🔴 OFF';
    const pw = show.access_password ? `\n🔐 Password: \`${escapeMarkdown(show.access_password)}\`` : '\n⚠️ Belum ada password\\!';
    
    await sendTelegramMessage(botToken, chatId,
      `✅ *Replay ${newStatus ? 'Diaktifkan' : 'Dinonaktifkan'}\\!*\n\n🎬 Show: ${escapeMarkdown(show.title)}\n📊 Status: ${statusText}\n🪙 Harga: ${show.replay_coin_price} koin${newStatus ? pw : ''}`
    );
  } catch (e) {
    await sendTelegramMessage(botToken, chatId, `⚠️ Error: ${e instanceof Error ? escapeMarkdown(e.message) : 'Unknown'}`);
  }
}

async function handleSetLiveCommand(supabase: any, botToken: string, chatId: string, title: string | null) {
  try {
    // Get or create stream record
    let { data: stream } = await supabase.from('streams').select('id, title').eq('is_active', true).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (!stream) {
      const { data: newStream } = await supabase.from('streams').insert({ title: 'RealTime48', type: 'youtube', url: '', is_active: true, is_live: false }).select().single();
      stream = newStream;
    }
    if (!stream) { await sendTelegramMessage(botToken, chatId, '⚠️ Gagal membuat stream\\.'); return; }

    await supabase.from('streams').update({ is_live: true }).eq('id', stream.id);

    // Get active show info
    const { data: settings } = await supabase.from('site_settings').select('value').eq('key', 'active_show_id').maybeSingle();
    let showInfo = '';
    if (settings?.value) {
      const { data: show } = await supabase.from('shows').select('title').eq('id', settings.value).maybeSingle();
      if (show) showInfo = `\n🎭 Show aktif: *${escapeMarkdown(show.title)}*`;
    }

    await sendTelegramMessage(botToken, chatId, `🟢 *Stream LIVE\\!*\n\n📡 ${escapeMarkdown(stream.title)} sekarang LIVE\\!${showInfo}`);
  } catch (e) { await sendTelegramMessage(botToken, chatId, `⚠️ Error: ${e instanceof Error ? escapeMarkdown(e.message) : 'Unknown'}`); }
}

async function handleSetOfflineCommand(supabase: any, botToken: string, chatId: string) {
  try {
    const { data: liveStreams } = await supabase.from('streams').select('id, title').eq('is_live', true);
    if (!liveStreams || liveStreams.length === 0) { await sendTelegramMessage(botToken, chatId, '📡 Tidak ada stream yang sedang LIVE\\.'); return; }
    await supabase.from('streams').update({ is_live: false }).eq('is_live', true);
    const names = liveStreams.map((s: any) => escapeMarkdown(s.title)).join(', ');
    await sendTelegramMessage(botToken, chatId, `🔴 *Stream OFFLINE\\!*\n\n📡 ${names} sekarang OFFLINE\\.`);
  } catch (e) { await sendTelegramMessage(botToken, chatId, `⚠️ Error: ${e instanceof Error ? escapeMarkdown(e.message) : 'Unknown'}`); }
}

async function handleMsgShowCommand(supabase: any, botToken: string, chatId: string, showName: string, message: string) {
  try {
    const { data: shows } = await supabase.from('shows').select('id, title').eq('is_active', true).ilike('title', `%${showName}%`).limit(5);
    if (!shows || shows.length === 0) {
      await sendTelegramMessage(botToken, chatId, `⚠️ Show "${escapeMarkdown(showName)}" tidak ditemukan\\.`);
      return;
    }
    if (shows.length > 1) {
      let msg = `⚠️ Ditemukan ${shows.length} show:\n\n`;
      for (const s of shows) msg += `• ${escapeMarkdown(s.title)}\n`;
      msg += '\n💡 Gunakan nama yang lebih spesifik\\.';
      await sendTelegramMessage(botToken, chatId, msg);
      return;
    }

    const show = shows[0];
    const { data: orders } = await supabase.from('subscription_orders').select('phone, email').eq('show_id', show.id).eq('status', 'confirmed');
    const phones = [...new Set((orders || []).map((o: any) => o.phone).filter(Boolean))];

    if (phones.length === 0) {
      await sendTelegramMessage(botToken, chatId, `⚠️ Tidak ada pemesan dengan nomor telepon untuk show "${escapeMarkdown(show.title)}"\\.`);
      return;
    }

    let sent = 0;
    let failed = 0;
    for (const phone of phones) {
      try {
        await sendFonnteWhatsApp(phone, message);
        sent++;
      } catch { failed++; }
    }

    const result = `✅ *Pesan Terkirim\\!*\n\n🎬 Show: ${escapeMarkdown(show.title)}\n📨 Terkirim: ${sent} nomor${failed > 0 ? `\n⚠️ Gagal: ${failed}` : ''}\n\n📝 Pesan: ${escapeMarkdown(message)}`;
    await sendTelegramMessage(botToken, chatId, result);
  } catch (e) {
    await sendTelegramMessage(botToken, chatId, `⚠️ Error: ${e instanceof Error ? escapeMarkdown(e.message) : 'Unknown'}`);
  }
}

async function handlePasswordResetCommand(supabase: any, botToken: string, chatId: string, shortId: string, action: 'approve' | 'reject') {
  try {
    const { data: request } = await supabase.from('password_reset_requests').select('id, user_id, identifier, phone, short_id').eq('short_id', shortId).eq('status', 'pending').maybeSingle();
    if (!request) { await sendTelegramMessage(botToken, chatId, `⚠️ Request reset ${escapeMarkdown(shortId)} tidak ditemukan\\.`); return; }
    if (action === 'approve') {
      await supabase.from('password_reset_requests').update({ status: 'approved', processed_at: new Date().toISOString() }).eq('id', request.id);
      const FONNTE_TOKEN = Deno.env.get('FONNTE_API_TOKEN');
      if (FONNTE_TOKEN && request.phone) {
        const resetLink = `https://streaming48.lovable.app/reset-password?token=${request.short_id}`;
        await sendFonnteWhatsApp(request.phone, `🔑 *Reset Password Disetujui*\n\nKlik link berikut untuk membuat password baru:\n${resetLink}\n\n⏰ Link berlaku 24 jam.`);
      }
      await sendTelegramMessage(botToken, chatId, `✅ Reset password ${escapeMarkdown(shortId)} disetujui\\! Link dikirim ke user\\.`);
    } else {
      await supabase.from('password_reset_requests').update({ status: 'rejected', processed_at: new Date().toISOString() }).eq('id', request.id);
      await sendTelegramMessage(botToken, chatId, `❌ Reset password ${escapeMarkdown(shortId)} ditolak\\.`);
    }
  } catch (e) { await sendTelegramMessage(botToken, chatId, `⚠️ Error: ${e instanceof Error ? escapeMarkdown(e.message) : 'Unknown'}`); }
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

async function notifyWhatsAppAdmins(supabase: any, command: string) {
  const FONNTE_TOKEN = Deno.env.get('FONNTE_API_TOKEN');
  if (!FONNTE_TOKEN) return;
  
  try {
    // Get whitelist numbers
    const { data: waSetting } = await supabase.from('site_settings').select('value').eq('key', 'whatsapp_admin_numbers').maybeSingle();
    const { data: primarySetting } = await supabase.from('site_settings').select('value').eq('key', 'whatsapp_number').maybeSingle();
    
    const numbers: string[] = [];
    if (waSetting?.value) numbers.push(...waSetting.value.split(',').map((n: string) => n.trim()).filter(Boolean));
    if (primarySetting?.value) numbers.push(primarySetting.value.trim());
    
    if (numbers.length === 0) return;
    
    const msg = `🤖 *Telegram Bot Activity*\n\nCommand: ${command}`;
    
    for (const num of [...new Set(numbers)]) {
      const cleanPhone = num.replace(/^0/, '62').replace(/[^0-9]/g, '');
      if (!cleanPhone) continue;
      await fetch('https://api.fonnte.com/send', {
        method: 'POST', headers: { Authorization: FONNTE_TOKEN },
        body: new URLSearchParams({ target: cleanPhone, message: msg }),
      });
    }
  } catch (e) { console.error('notifyWhatsAppAdmins error:', e); }
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

async function handleShowInfoCommand(supabase: any, botToken: string, chatId: string) {
  try {
    const { data: stream } = await supabase.from('streams').select('id, title, is_live').eq('is_active', true).order('created_at', { ascending: false }).limit(1).maybeSingle();
    const { data: settings } = await supabase.from('site_settings').select('key, value').in('key', ['active_show_id', 'next_show_time']);
    const settingsMap: any = {};
    (settings || []).forEach((s: any) => { settingsMap[s.key] = s.value; });

    let msg = '📡 *INFO STREAM & SHOW*\n\n';
    if (stream) {
      msg += `🎬 Stream: *${escapeMarkdown(stream.title)}*\n`;
      msg += `Status: ${stream.is_live ? '🟢 LIVE' : '🔴 OFFLINE'}\n\n`;
    } else {
      msg += '⚠️ Tidak ada record stream\\.\n\n';
    }

    if (settingsMap.active_show_id) {
      const { data: show } = await supabase.from('shows').select('title, schedule_date, schedule_time, is_replay').eq('id', settingsMap.active_show_id).maybeSingle();
      if (show) {
        msg += `🎭 Show aktif: *${escapeMarkdown(show.title)}*\n`;
        if (show.schedule_date) msg += `📅 Jadwal: ${escapeMarkdown(show.schedule_date)} ${escapeMarkdown(show.schedule_time || '')}\n`;
        if (show.is_replay) msg += `🔁 Mode: Replay\n`;
      }
    } else {
      msg += '🎭 Show aktif: _Belum dipilih_\n';
    }

    if (settingsMap.next_show_time) {
      msg += `\n⏰ Countdown: ${escapeMarkdown(new Date(settingsMap.next_show_time).toLocaleString('id-ID'))}`;
    }

    const { data: playlists } = await supabase.from('playlists').select('title, type, is_active').order('sort_order');
    if (playlists && playlists.length > 0) {
      msg += '\n\n📋 *Sumber Video:*\n';
      for (const p of playlists) {
        msg += `${p.is_active ? '✅' : '❌'} ${escapeMarkdown(p.title)} \\(${escapeMarkdown(p.type)}\\)\n`;
      }
    }

    await sendTelegramMessage(botToken, chatId, msg);
  } catch (e) {
    await sendTelegramMessage(botToken, chatId, `⚠️ Error: ${e instanceof Error ? escapeMarkdown(e.message) : 'Unknown'}`);
  }
}

function errorResponse(msg: string) {
  console.error('telegram-poll error:', msg);
  return jsonResponse({ error: msg }, 500);
}