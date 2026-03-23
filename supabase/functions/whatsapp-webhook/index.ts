import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const FONNTE_TOKEN = Deno.env.get('FONNTE_API_TOKEN');
  if (!FONNTE_TOKEN) return jsonResponse({ error: 'FONNTE_API_TOKEN not configured' }, 500);

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  try {
    // Fonnte webhook sends form-urlencoded or JSON
    let sender = '';
    let message = '';

    const contentType = req.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const body = await req.json();
      sender = body.sender || '';
      message = body.message || body.text || '';
    } else {
      const formData = await req.formData().catch(() => null);
      if (formData) {
        sender = formData.get('sender')?.toString() || '';
        message = formData.get('message')?.toString() || formData.get('text')?.toString() || '';
      } else {
        const text = await req.text();
        try {
          const body = JSON.parse(text);
          sender = body.sender || '';
          message = body.message || body.text || '';
        } catch {
          return jsonResponse({ error: 'Invalid request body' }, 400);
        }
      }
    }

    if (!sender || !message) {
      return jsonResponse({ ok: true, skipped: true, reason: 'no sender or message' });
    }

    // Normalize phone number
    const cleanSender = sender.replace(/[^0-9]/g, '');

    // Check if sender is authorized (admin chat ID or whitelisted number)
    const ADMIN_CHAT_ID = Deno.env.get('ADMIN_TELEGRAM_CHAT_ID') || '';
    const { data: whitelistSetting } = await supabase
      .from('site_settings')
      .select('value')
      .eq('key', 'whatsapp_admin_numbers')
      .maybeSingle();

    const whitelistNumbers = (whitelistSetting?.value || '')
      .split(',')
      .map((n: string) => n.trim().replace(/[^0-9]/g, ''))
      .filter(Boolean);

    // Add the primary admin number from Fonnte (the connected number itself is always allowed)
    const { data: waSetting } = await supabase
      .from('site_settings')
      .select('value')
      .eq('key', 'whatsapp_number')
      .maybeSingle();
    const primaryWaNumber = (waSetting?.value || '').replace(/[^0-9]/g, '');

    const allowedNumbers = [...whitelistNumbers];
    if (primaryWaNumber) allowedNumbers.push(primaryWaNumber);

    const isAuthorized = allowedNumbers.some(n => cleanSender.endsWith(n) || n.endsWith(cleanSender));

    if (!isAuthorized) {
      return jsonResponse({ ok: true, skipped: true, reason: 'unauthorized sender' });
    }

    // Process command
    const rawText = message.trim();
    const response = await processCommand(supabase, rawText);

    if (response) {
      await sendFonnteMessage(FONNTE_TOKEN, sender, response);
      
      // Cross-notify to Telegram (skip read-only commands)
      const readOnly = /^\/(help|start|menu|status|balance|users|replay)$/i;
      if (!readOnly.test(rawText.trim())) {
        await notifyTelegram(rawText, response);
      }
    }

    return jsonResponse({ ok: true, processed: true });
  } catch (e) {
    console.error('whatsapp-webhook error:', e);
    return jsonResponse({ error: e instanceof Error ? e.message : 'Unknown error' }, 500);
  }
});

async function processCommand(supabase: any, rawText: string): Promise<string | null> {
  const text = rawText.toUpperCase();
  const yaMatch = text.match(/^YA\s+(.+)$/);
  const tidakMatch = text.match(/^TIDAK\s+(.+)$/);
  const isStatus = /^\/status$/i.test(rawText);
  const addCoinMatch = rawText.match(/^\/addcoin\s+(\S+)\s+(\d+)(?:\s+(.+))?$/i);
  const balanceMatch = rawText.match(/^\/balance\s+(\S+)$/i);
  const isUsers = /^\/users$/i.test(rawText);
  const isHelp = /^\/(help|start|menu)$/i.test(rawText);
  const isMembers = /^\/members$/i.test(rawText);
  const msgmembersMatch = rawText.match(/^\/msgmembers\s+(.+)$/is);
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
  const blocktokenMatch = rawText.match(/^\/blocktoken\s+(\S+)$/i);
  const unblocktokenMatch = rawText.match(/^\/unblocktoken\s+(\S+)$/i);
  const resettokenMatch = rawText.match(/^\/resettoken\s+(\S+)$/i);
  const deletetokenMatch = rawText.match(/^\/deletetoken\s+(\S+)$/i);
  const tokensListMatch = /^\/tokens$/i.test(rawText);
  const isStats = /^\/stats$/i.test(rawText);
  const cekuserMatch = rawText.match(/^\/cekuser\s+(\S+)$/i);
  const announceMatch = rawText.match(/^\/announce\s+(.+)$/is);
  const isShowList = /^\/showlist$/i.test(rawText);
  const isPendapatan = /^\/pendapatan$/i.test(rawText);
  const isOrderToday = /^\/ordertoday$/i.test(rawText);
  const isTopUsers = /^\/topusers$/i.test(rawText);
  const setpriceMatch = rawText.match(/^\/setprice\s+(.+?)\s+(coin|replay)\s+(\d+)$/i);

  if (isHelp) return handleHelp();
  if (isStatus) return await handleStatus(supabase);
  if (addCoinMatch) return await handleAddCoin(supabase, addCoinMatch[1], parseInt(addCoinMatch[2], 10), addCoinMatch[3] || null);
  if (deductCoinMatch) return await handleDeductCoin(supabase, deductCoinMatch[1], parseInt(deductCoinMatch[2], 10), deductCoinMatch[3] || null);
  if (balanceMatch) return await handleBalance(supabase, balanceMatch[1]);
  if (isUsers) return await handleUsers(supabase);
  if (isMembers) return await handleMembers(supabase);
  if (msgmembersMatch) return await handleMsgMembers(supabase, msgmembersMatch[1].trim());
  if (broadcastMatch) return await handleBroadcast(supabase, broadcastMatch[1].trim());
  if (replayMatch) return await handleReplayToggle(supabase, replayMatch[1].trim());
  if (isReplayList) return await handleReplayList(supabase);
  if (setliveMatch) return await handleSetLive(supabase, setliveMatch[1]?.trim() || null);
  if (isSetOffline) return await handleSetOffline(supabase);
  if (isShowInfo) return await handleShowInfo(supabase);
  if (msgshowMatch) return await handleMsgShow(supabase, msgshowMatch[1].trim(), msgshowMatch[2].trim());
  if (blocktokenMatch) return await handleTokenCmd(supabase, blocktokenMatch[1], 'block');
  if (unblocktokenMatch) return await handleTokenCmd(supabase, unblocktokenMatch[1], 'unblock');
  if (resettokenMatch) return await handleTokenCmd(supabase, resettokenMatch[1], 'reset');
  if (deletetokenMatch) return await handleTokenCmd(supabase, deletetokenMatch[1], 'delete');
  if (tokensListMatch) return await handleTokensList(supabase);
  if (isStats) return await handleStatsWa(supabase);
  if (cekuserMatch) return await handleCekUserWa(supabase, cekuserMatch[1]);
  if (announceMatch) return await handleAnnounceWa(supabase, announceMatch[1].trim());
  if (isShowList) return await handleShowListWa(supabase);
  if (isPendapatan) return await handlePendapatanWa(supabase);
  if (isOrderToday) return await handleOrderTodayWa(supabase);
  if (isTopUsers) return await handleTopUsersWa(supabase);
  if (resetMatch) return await handlePasswordReset(supabase, resetMatch[1].toLowerCase(), 'approve');
  if (tolakResetMatch) return await handlePasswordReset(supabase, tolakResetMatch[1].toLowerCase(), 'reject');
  if (yaMatch) {
    const ids = yaMatch[1].split(',').map((s: string) => s.trim().toLowerCase()).filter(Boolean);
    return await handleBulkOrders(supabase, ids, 'approve');
  }
  if (tidakMatch) {
    const ids = tidakMatch[1].split(',').map((s: string) => s.trim().toLowerCase()).filter(Boolean);
    return await handleBulkOrders(supabase, ids, 'reject');
  }

  return null;
}

function handleHelp(): string {
  return `🤖 *REALTIME48 BOT - DAFTAR COMMAND*

📋 *Order Management:*
/status - Cek order pending
YA <id> - Konfirmasi order
YA id1,id2,id3 - Bulk konfirmasi
TIDAK <id> - Tolak order

💰 *Koin Management:*
/addcoin <user> <jumlah> - Tambah koin
/addcoin <user> <jumlah> <alasan> - Tambah koin + alasan
/deductcoin <user> <jumlah> - Kurangi koin
/balance <user> - Cek saldo user

👥 *User Management:*
/users - Daftar semua user
/members - Daftar member langganan

🎬 *Show Management:*
/replay - Lihat daftar show replay
/replay <nama show> - Toggle mode replay

📡 *Live Stream:*
/showinfo - Info stream & show aktif saat ini
/setlive - Set stream jadi LIVE
/setoffline - Set semua stream jadi OFFLINE

🔑 *Token Management:*
/tokens - Lihat daftar token aktif + 4 digit
/blocktoken <4digit> - Blokir token (4 digit belakang)
/unblocktoken <4digit> - Buka blokir token
/resettoken <4digit> - Reset sesi token
/deletetoken <4digit> - Hapus token

🔐 *Password Reset:*
RESET <id> - Setujui reset password
TOLAK_RESET <id> - Tolak reset password

📨 *Messaging:*
/msgshow <nama show> | <pesan> - Kirim WA ke semua pemesan show
/msgmembers <pesan> - Kirim WA ke semua member

📢 *Lainnya:*
/broadcast <pesan> - Kirim notifikasi
/help - Tampilkan daftar command

📊 *Statistik & Analitik:*
/stats - Statistik lengkap platform
/cekuser <username> - Detail info user
/showlist - Daftar semua show + status
/pendapatan - Ringkasan pendapatan
/ordertoday - Order hari ini
/topusers - Top user berdasarkan saldo
/announce <pesan> - Kirim WA ke semua user`;
}

async function handleStatus(supabase: any): Promise<string> {
  try {
    const { data: coinOrders } = await supabase.from('coin_orders').select('id, coin_amount, price, created_at, user_id, short_id').eq('status', 'pending').order('created_at', { ascending: false }).limit(10);
    const { data: subOrders } = await supabase.from('subscription_orders').select('id, show_id, phone, email, created_at, short_id').eq('status', 'pending').order('created_at', { ascending: false }).limit(10);

    let msg = '📊 *STATUS ORDER TERBARU*\n\n';

    if (coinOrders?.length > 0) {
      msg += `🪙 *Order Koin Pending (${coinOrders.length}):*\n`;
      const allIds: string[] = [];
      for (const o of coinOrders) {
        const { data: profile } = await supabase.from('profiles').select('username').eq('id', o.user_id).single();
        const time = new Date(o.created_at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
        const sid = o.short_id || o.id.substring(0, 6);
        allIds.push(sid);
        msg += `• ${sid} ${profile?.username || 'User'} - ${o.coin_amount} koin | ${time}\n`;
      }
      msg += `\n💡 Konfirmasi semua: YA ${allIds.join(',')}\n`;
    } else {
      msg += '🪙 *Order Koin:* Tidak ada order pending\n';
    }

    msg += '\n';

    if (subOrders?.length > 0) {
      msg += `🎬 *Subscription Pending (${subOrders.length}):*\n`;
      const allIds: string[] = [];
      for (const o of subOrders) {
        const { data: show } = await supabase.from('shows').select('title').eq('id', o.show_id).single();
        const time = new Date(o.created_at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
        const sid = o.short_id || o.id.substring(0, 6);
        allIds.push(sid);
        msg += `• ${sid} ${show?.title || 'Unknown'} - ${o.email} | ${time}\n`;
      }
      msg += `\n💡 Konfirmasi semua: YA ${allIds.join(',')}\n`;
    } else {
      msg += '🎬 *Subscription:* Tidak ada order pending\n';
    }

    msg += '\n📌 Ketik /help untuk daftar command';
    return msg;
  } catch {
    return '⚠️ Error mengambil data status';
  }
}

async function handleAddCoin(supabase: any, username: string, amount: number, reason: string | null): Promise<string> {
  try {
    if (amount <= 0 || amount > 100000) return '⚠️ Jumlah koin harus antara 1-100.000';

    const { data: profile } = await supabase.from('profiles').select('id, username').ilike('username', username).maybeSingle();
    if (!profile) return `⚠️ User "${username}" tidak ditemukan.`;

    const { data: existing } = await supabase.from('coin_balances').select('balance').eq('user_id', profile.id).maybeSingle();
    let newBalance: number;
    if (existing) {
      newBalance = existing.balance + amount;
      await supabase.from('coin_balances').update({ balance: newBalance, updated_at: new Date().toISOString() }).eq('user_id', profile.id);
    } else {
      newBalance = amount;
      await supabase.from('coin_balances').insert({ user_id: profile.id, balance: amount });
    }

    await supabase.from('coin_transactions').insert({
      user_id: profile.id, amount, type: 'admin_grant',
      description: reason || 'Koin ditambahkan oleh admin via WhatsApp',
    });

    return `✅ *Koin Ditambahkan!*\n\n👤 User: ${profile.username}\n💰 +${amount} koin\n🏦 Saldo baru: ${newBalance}${reason ? `\n📝 Alasan: ${reason}` : ''}`;
  } catch (e) {
    return `⚠️ Error: ${e instanceof Error ? e.message : 'Unknown'}`;
  }
}

async function handleDeductCoin(supabase: any, username: string, amount: number, reason: string | null): Promise<string> {
  try {
    if (amount <= 0 || amount > 100000) return '⚠️ Jumlah koin harus antara 1-100.000';

    const { data: profile } = await supabase.from('profiles').select('id, username').ilike('username', username).maybeSingle();
    if (!profile) return `⚠️ User "${username}" tidak ditemukan.`;

    const { data: existing } = await supabase.from('coin_balances').select('balance').eq('user_id', profile.id).maybeSingle();
    const currentBal = existing?.balance ?? 0;
    if (currentBal < amount) return `⚠️ Saldo ${profile.username} hanya ${currentBal} koin. Tidak cukup untuk dikurangi ${amount}.`;

    const newBalance = currentBal - amount;
    await supabase.from('coin_balances').update({ balance: newBalance, updated_at: new Date().toISOString() }).eq('user_id', profile.id);
    await supabase.from('coin_transactions').insert({
      user_id: profile.id, amount: -amount, type: 'admin_deduct',
      description: reason || 'Koin dikurangi oleh admin via WhatsApp',
    });

    return `✅ *Koin Dikurangi!*\n\n👤 User: ${profile.username}\n💸 -${amount} koin\n🏦 Saldo baru: ${newBalance}${reason ? `\n📝 Alasan: ${reason}` : ''}`;
  } catch (e) {
    return `⚠️ Error: ${e instanceof Error ? e.message : 'Unknown'}`;
  }
}

async function handleBalance(supabase: any, username: string): Promise<string> {
  try {
    const { data: profile } = await supabase.from('profiles').select('id, username').ilike('username', username).maybeSingle();
    if (!profile) return `⚠️ User "${username}" tidak ditemukan.`;

    const { data: balData } = await supabase.from('coin_balances').select('balance').eq('user_id', profile.id).maybeSingle();
    const balance = balData?.balance ?? 0;

    return `💰 *Saldo Koin*\n\n👤 User: ${profile.username}\n🪙 Saldo: *${balance}* koin`;
  } catch (e) {
    return `⚠️ Error: ${e instanceof Error ? e.message : 'Unknown'}`;
  }
}

async function handleUsers(supabase: any): Promise<string> {
  try {
    const { data: profiles } = await supabase.from('profiles').select('id, username, created_at').order('created_at', { ascending: false }).limit(50);
    if (!profiles || profiles.length === 0) return '📋 Belum ada user terdaftar.';

    let msg = `👥 *DAFTAR USER (${profiles.length})*\n\n`;
    for (const p of profiles) {
      const { data: balData } = await supabase.from('coin_balances').select('balance').eq('user_id', p.id).maybeSingle();
      const bal = balData?.balance ?? 0;
      const date = new Date(p.created_at).toLocaleDateString('id-ID');
      msg += `• ${p.username || 'No Name'} - 🪙 ${bal} koin | 📅 ${date}\n`;
    }
    msg += `\n💡 Cek saldo: /balance <username>\nTambah koin: /addcoin <username> <jumlah>`;
    return msg;
  } catch (e) {
    return `⚠️ Error: ${e instanceof Error ? e.message : 'Unknown'}`;
  }
}

async function handleBroadcast(supabase: any, message: string): Promise<string> {
  try {
    await supabase.from('admin_notifications').insert({
      title: '📢 Broadcast Admin',
      message,
      type: 'broadcast',
    });
    return `✅ Broadcast terkirim!\n\n📝 Pesan: ${message}`;
  } catch (e) {
    return `⚠️ Error broadcast: ${e instanceof Error ? e.message : 'Unknown'}`;
  }
}

async function handleReplayList(supabase: any): Promise<string> {
  try {
    const { data: shows } = await supabase
      .from('shows')
      .select('id, title, is_replay, replay_coin_price, schedule_date, access_password')
      .eq('is_active', true)
      .gt('replay_coin_price', 0)
      .order('created_at', { ascending: false })
      .limit(20);

    if (!shows || shows.length === 0) return '🎬 Tidak ada show dengan harga replay.';

    let msg = '🎬 *DAFTAR SHOW REPLAY*\n\n';
    for (const s of shows) {
      const status = s.is_replay ? '🟢 ON' : '🔴 OFF';
      const pw = s.access_password ? `🔐 ${s.access_password}` : '⚠️ No password';
      msg += `${status} *${s.title}*\n   📅 ${s.schedule_date || '-'} | 🪙 ${s.replay_coin_price} koin | ${pw}\n\n`;
    }
    msg += '💡 Toggle replay: /replay <nama show>';
    return msg;
  } catch (e) {
    return `⚠️ Error: ${e instanceof Error ? e.message : 'Unknown'}`;
  }
}

async function handleReplayToggle(supabase: any, showName: string): Promise<string> {
  try {
    const { data: shows } = await supabase
      .from('shows')
      .select('id, title, is_replay, replay_coin_price, access_password')
      .eq('is_active', true)
      .ilike('title', `%${showName}%`)
      .limit(5);

    if (!shows || shows.length === 0) return `⚠️ Show "${showName}" tidak ditemukan.`;

    if (shows.length > 1) {
      let msg = `⚠️ Ditemukan ${shows.length} show:\n\n`;
      for (const s of shows) {
        const status = s.is_replay ? '🟢 ON' : '🔴 OFF';
        msg += `${status} ${s.title}\n`;
      }
      msg += '\n💡 Gunakan nama yang lebih spesifik.';
      return msg;
    }

    const show = shows[0];
    const newStatus = !show.is_replay;
    await supabase.from('shows').update({ is_replay: newStatus }).eq('id', show.id);

    const statusText = newStatus ? '🟢 ON' : '🔴 OFF';
    const pw = show.access_password ? `\n🔐 Password: ${show.access_password}` : '\n⚠️ Belum ada password!';

    return `✅ *Replay ${newStatus ? 'Diaktifkan' : 'Dinonaktifkan'}!*\n\n🎬 Show: ${show.title}\n📊 Status: ${statusText}\n🪙 Harga: ${show.replay_coin_price} koin${newStatus ? pw : ''}`;
  } catch (e) {
    return `⚠️ Error: ${e instanceof Error ? e.message : 'Unknown'}`;
  }
}

async function handleSetLive(supabase: any, title: string | null): Promise<string> {
  try {
    // Get or create stream record
    let { data: stream } = await supabase.from('streams').select('id, title').eq('is_active', true).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (!stream) {
      const { data: newStream } = await supabase.from('streams').insert({ title: 'RealTime48', type: 'youtube', url: '', is_active: true, is_live: false }).select().single();
      stream = newStream;
    }
    if (!stream) return '⚠️ Gagal membuat stream.';

    await supabase.from('streams').update({ is_live: true }).eq('id', stream.id);

    // Get active show info
    const { data: settings } = await supabase.from('site_settings').select('value').eq('key', 'active_show_id').maybeSingle();
    let showInfo = '';
    if (settings?.value) {
      const { data: show } = await supabase.from('shows').select('title').eq('id', settings.value).maybeSingle();
      if (show) showInfo = `\n🎭 Show aktif: *${show.title}*`;
    }

    return `🟢 *Stream LIVE!*\n\n📡 ${stream.title} sekarang LIVE!${showInfo}`;
  } catch (e) {
    return `⚠️ Error: ${e instanceof Error ? e.message : 'Unknown'}`;
  }
}

async function handleSetOffline(supabase: any): Promise<string> {
  try {
    const { data: liveStreams } = await supabase.from('streams').select('id, title').eq('is_live', true);
    if (!liveStreams || liveStreams.length === 0) return '📡 Tidak ada stream yang sedang LIVE.';
    await supabase.from('streams').update({ is_live: false }).eq('is_live', true);
    const names = liveStreams.map((s: any) => s.title).join(', ');
    return `🔴 *Stream OFFLINE!*\n\n📡 ${names} sekarang OFFLINE.`;
  } catch (e) {
    return `⚠️ Error: ${e instanceof Error ? e.message : 'Unknown'}`;
  }
}

async function handleBulkOrders(supabase: any, shortIds: string[], action: 'approve' | 'reject'): Promise<string> {
  const results: string[] = [];
  for (const shortId of shortIds) {
    const result = await processOrderByShortId(supabase, shortId, action);
    results.push(result);
  }
  if (shortIds.length > 1) {
    return `📋 *Hasil Bulk ${action === 'approve' ? 'Konfirmasi' : 'Tolak'}:*\n\n${results.join('\n')}`;
  }
  return results[0] || '⚠️ Tidak ada order ditemukan';
}

async function processOrderByShortId(supabase: any, shortId: string, action: 'approve' | 'reject'): Promise<string> {
  const { data: coinOrder } = await supabase.from('coin_orders').select('id, user_id, coin_amount, status, package_id, phone, short_id').eq('short_id', shortId).eq('status', 'pending').maybeSingle();
  if (coinOrder) {
    return await processCoinOrder(supabase, coinOrder, action);
  }

  const { data: subOrder } = await supabase.from('subscription_orders').select('id, show_id, phone, email, status, short_id').eq('short_id', shortId).eq('status', 'pending').maybeSingle();
  if (subOrder) {
    return await processSubOrder(supabase, subOrder, action);
  }

  return `⚠️ ${shortId} tidak ditemukan`;
}

async function processCoinOrder(supabase: any, order: any, action: 'approve' | 'reject'): Promise<string> {
  try {
    const sid = order.short_id || order.id.substring(0, 6);
    if (action === 'approve') {
      // Use atomic RPC to prevent double-credit race conditions
      const { data: rpcResult, error: rpcError } = await supabase.rpc('confirm_coin_order', { _order_id: order.id });
      if (rpcError || !rpcResult?.success) {
        return `⚠️ Order koin ${sid}: ${rpcResult?.error || rpcError?.message || 'Gagal konfirmasi'}`;
      }

      const { data: profile } = await supabase.from('profiles').select('username').eq('id', order.user_id).single();
      const newBalance = rpcResult.new_balance ?? order.coin_amount;

      if (order.phone) {
        const FONNTE_TOKEN = Deno.env.get('FONNTE_API_TOKEN');
        if (FONNTE_TOKEN) {
          const waMsg = `✅ Pembayaran kamu untuk *${order.coin_amount} koin* telah dikonfirmasi!\n\n💰 Saldo saat ini: ${newBalance} koin.\n\nTerima kasih! 🎉`;
          await sendFonnteMessage(FONNTE_TOKEN, order.phone, waMsg);
        }
      }

      return `✅ Order koin ${sid} dikonfirmasi! ${profile?.username || 'User'} +${order.coin_amount} koin (Saldo: ${newBalance})`;
    } else {
      await supabase.from('coin_orders').update({ status: 'rejected' }).eq('id', order.id).eq('status', 'pending');
      return `❌ Order koin ${sid} ditolak.`;
    }
  } catch (e) {
    return `⚠️ Error: ${e instanceof Error ? e.message : 'Unknown'}`;
  }
}

async function processSubOrder(supabase: any, order: any, action: 'approve' | 'reject'): Promise<string> {
  try {
    const sid = order.short_id || order.id.substring(0, 6);
    const { data: show } = await supabase.from('shows').select('title').eq('id', order.show_id).single();
    const showTitle = show?.title || 'Unknown Show';

    if (action === 'approve') {
      const { data: confirmed } = await supabase.from('subscription_orders').update({ status: 'confirmed' }).eq('id', order.id).eq('status', 'pending').select('id').maybeSingle();
      if (!confirmed) return `⚠️ Subscription ${sid} sudah diproses.`;
      return `✅ Subscription ${sid} untuk "${showTitle}" dikonfirmasi!`;
    } else {
      await supabase.from('subscription_orders').update({ status: 'rejected' }).eq('id', order.id).eq('status', 'pending');
      return `❌ Subscription ${sid} untuk "${showTitle}" ditolak.`;
    }
  } catch (e) {
    return `⚠️ Error: ${e instanceof Error ? e.message : 'Unknown'}`;
  }
}

async function handlePasswordReset(supabase: any, shortId: string, action: 'approve' | 'reject'): Promise<string> {
  try {
    const { data: request } = await supabase
      .from('password_reset_requests')
      .select('id, user_id, identifier, phone, short_id, secure_token')
      .eq('short_id', shortId)
      .eq('status', 'pending')
      .maybeSingle();

    if (!request) return `⚠️ Request reset ${shortId} tidak ditemukan atau sudah diproses.`;

    if (action === 'approve') {
      await supabase.from('password_reset_requests')
        .update({ status: 'approved', processed_at: new Date().toISOString() })
        .eq('id', request.id);

      // Send reset link via WhatsApp if phone exists
      const FONNTE_TOKEN = Deno.env.get('FONNTE_API_TOKEN');
      if (FONNTE_TOKEN && request.phone) {
        const resetLink = `https://streaming48.lovable.app/reset-password?token=${request.secure_token || request.short_id}`;
        const waMsg = `🔑 *Reset Password Disetujui*\n\nKlik link berikut untuk membuat password baru:\n${resetLink}\n\n⏰ Link berlaku 2 jam.`;
        await sendFonnteMessage(FONNTE_TOKEN, request.phone, waMsg);
      }

      return `✅ Reset password ${shortId} disetujui! Link reset dikirim ke user.`;
    } else {
      await supabase.from('password_reset_requests')
        .update({ status: 'rejected', processed_at: new Date().toISOString() })
        .eq('id', request.id);
      return `❌ Reset password ${shortId} ditolak.`;
    }
  } catch (e) {
    return `⚠️ Error: ${e instanceof Error ? e.message : 'Unknown'}`;
  }
}

async function handleMsgShow(supabase: any, showName: string, message: string): Promise<string> {
  try {
    const FONNTE_TOKEN = Deno.env.get('FONNTE_API_TOKEN');
    if (!FONNTE_TOKEN) return '⚠️ FONNTE_API_TOKEN tidak dikonfigurasi.';

    const { data: shows } = await supabase.from('shows').select('id, title').eq('is_active', true).ilike('title', `%${showName}%`).limit(5);
    if (!shows || shows.length === 0) return `⚠️ Show "${showName}" tidak ditemukan.`;
    if (shows.length > 1) {
      let msg = `⚠️ Ditemukan ${shows.length} show:\n\n`;
      for (const s of shows) msg += `• ${s.title}\n`;
      msg += '\n💡 Gunakan nama yang lebih spesifik.';
      return msg;
    }

    const show = shows[0];
    const { data: orders } = await supabase.from('subscription_orders').select('phone, email').eq('show_id', show.id).eq('status', 'confirmed');
    const phones = [...new Set((orders || []).map((o: any) => o.phone).filter(Boolean))];

    if (phones.length === 0) return `⚠️ Tidak ada pemesan dengan nomor telepon untuk show "${show.title}".`;

    let sent = 0;
    let failed = 0;
    for (const phone of phones) {
      try {
        await sendFonnteMessage(FONNTE_TOKEN, phone, message);
        sent++;
      } catch {
        failed++;
      }
    }

    return `✅ *Pesan Terkirim!*\n\n🎬 Show: ${show.title}\n📨 Terkirim: ${sent} nomor${failed > 0 ? `\n⚠️ Gagal: ${failed}` : ''}\n\n📝 Pesan: ${message}`;
  } catch (e) {
    return `⚠️ Error: ${e instanceof Error ? e.message : 'Unknown'}`;
  }
}

async function sendFonnteMessage(token: string, target: string, message: string) {
  const cleanPhone = target.replace(/^0/, '62').replace(/[^0-9]/g, '');
  if (!cleanPhone) return;
  try {
    await fetch('https://api.fonnte.com/send', {
      method: 'POST',
      headers: { Authorization: token },
      body: new URLSearchParams({ target: cleanPhone, message }),
    });
  } catch (e) {
    console.error('sendFonnteMessage error:', e);
  }
}

async function notifyTelegram(command: string, result: string) {
  const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN');
  const ADMIN_CHAT_ID = Deno.env.get('ADMIN_TELEGRAM_CHAT_ID');
  if (!BOT_TOKEN || !ADMIN_CHAT_ID) return;

  // Skip read-only commands
  const readOnly = /^\/(help|start|menu|status|balance|users|replay)$/i;
  if (readOnly.test(command.trim())) return;

  const telegramMsg = `📱 *WhatsApp Bot Activity*\n\nCommand: \`${command}\`\n\n${result}`;
  
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: ADMIN_CHAT_ID, text: telegramMsg }),
    });
  } catch (e) {
    console.error('notifyTelegram error:', e);
  }
}

async function handleMembers(supabase: any): Promise<string> {
  try {
    const { data: orders } = await supabase
      .from('subscription_orders')
      .select('phone, email, show_id, created_at')
      .eq('status', 'confirmed')
      .order('created_at', { ascending: false });

    if (!orders || orders.length === 0) return '👥 Belum ada member langganan.';

    const { data: shows } = await supabase.from('shows').select('id, title').eq('is_subscription', true);
    const showMap: Record<string, string> = {};
    (shows || []).forEach((s: any) => { showMap[s.id] = s.title; });

    const grouped: Record<string, any[]> = {};
    for (const o of orders) {
      const title = showMap[o.show_id] || 'Unknown';
      if (!grouped[title]) grouped[title] = [];
      grouped[title].push(o);
    }

    let msg = `👥 *DAFTAR MEMBER LANGGANAN (${orders.length})*\n\n`;
    for (const [title, members] of Object.entries(grouped)) {
      msg += `🎬 *${title}* (${members.length})\n`;
      for (const m of members) {
        msg += `  📞 ${m.phone || '-'} | 📧 ${m.email || '-'}\n`;
      }
      msg += '\n';
    }
    msg += `💡 Kirim pesan massal: /msgmembers <pesan>`;
    return msg;
  } catch (e) {
    return `⚠️ Error: ${e instanceof Error ? e.message : 'Unknown'}`;
  }
}

async function handleMsgMembers(supabase: any, message: string): Promise<string> {
  try {
    const { data: orders } = await supabase
      .from('subscription_orders')
      .select('phone')
      .eq('status', 'confirmed');

    if (!orders || orders.length === 0) return '⚠️ Tidak ada member untuk dikirimi pesan.';

    const phones = [...new Set(orders.map((o: any) => o.phone).filter(Boolean))];
    if (phones.length === 0) return '⚠️ Tidak ada nomor HP member yang tersedia.';

    const FONNTE_TOKEN = Deno.env.get('FONNTE_API_TOKEN');
    if (!FONNTE_TOKEN) return '⚠️ FONNTE_API_TOKEN belum dikonfigurasi.';

    let sent = 0;
    for (const phone of phones) {
      await sendFonnteMessage(FONNTE_TOKEN, phone, message);
      sent++;
    }

    return `✅ Pesan berhasil dikirim ke ${sent} member!`;
  } catch (e) {
    return `⚠️ Error: ${e instanceof Error ? e.message : 'Unknown'}`;
  }
}

async function handleShowInfo(supabase: any): Promise<string> {
  try {
    const { data: stream } = await supabase.from('streams').select('id, title, is_live').eq('is_active', true).order('created_at', { ascending: false }).limit(1).maybeSingle();
    const { data: settings } = await supabase.from('site_settings').select('key, value').in('key', ['active_show_id', 'next_show_time']);
    const settingsMap: any = {};
    (settings || []).forEach((s: any) => { settingsMap[s.key] = s.value; });

    let msg = '📡 *INFO STREAM & SHOW*\n\n';
    if (stream) {
      msg += `🎬 Stream: *${stream.title}*\n`;
      msg += `Status: ${stream.is_live ? '🟢 LIVE' : '🔴 OFFLINE'}\n\n`;
    } else {
      msg += '⚠️ Tidak ada record stream.\n\n';
    }

    if (settingsMap.active_show_id) {
      const { data: show } = await supabase.from('shows').select('title, schedule_date, schedule_time, is_replay').eq('id', settingsMap.active_show_id).maybeSingle();
      if (show) {
        msg += `🎭 Show aktif: *${show.title}*\n`;
        if (show.schedule_date) msg += `📅 Jadwal: ${show.schedule_date} ${show.schedule_time || ''}\n`;
        if (show.is_replay) msg += `🔁 Mode: Replay\n`;
      }
    } else {
      msg += '🎭 Show aktif: _Belum dipilih_\n';
    }

    if (settingsMap.next_show_time) {
      msg += `\n⏰ Countdown: ${new Date(settingsMap.next_show_time).toLocaleString('id-ID')}`;
    }

    const { data: playlists } = await supabase.from('playlists').select('title, type, is_active').order('sort_order');
    if (playlists && playlists.length > 0) {
      msg += '\n\n📋 *Sumber Video:*\n';
      for (const p of playlists) {
        msg += `${p.is_active ? '✅' : '❌'} ${p.title} (${p.type})\n`;
      }
    }

    return msg;
  } catch (e) {
    return `⚠️ Error: ${e instanceof Error ? e.message : 'Unknown'}`;
  }
}

async function findTokenByInput(supabase: any, input: string): Promise<{ token: any | null; error: string | null; multiple: any[] | null }> {
  // Try exact match first
  const { data: exact } = await supabase.from('tokens').select('id, code, status').eq('code', input).maybeSingle();
  if (exact) return { token: exact, error: null, multiple: null };

  // Try 4-char suffix match (case-insensitive)
  const suffix = input.toLowerCase();
  const { data: all } = await supabase.from('tokens').select('id, code, status').eq('status', 'active').order('created_at', { ascending: false }).limit(500);
  if (!all) return { token: null, error: 'Gagal mencari token.', multiple: null };

  // Also search blocked tokens for unblock
  const { data: allBlocked } = await supabase.from('tokens').select('id, code, status').eq('status', 'blocked').order('created_at', { ascending: false }).limit(500);
  const combined = [...(all || []), ...(allBlocked || [])];

  const matches = combined.filter((t: any) => t.code.toLowerCase().endsWith(suffix));
  if (matches.length === 0) return { token: null, error: `Token dengan akhiran "${input}" tidak ditemukan.`, multiple: null };
  if (matches.length === 1) return { token: matches[0], error: null, multiple: null };
  return { token: null, error: null, multiple: matches };
}

async function handleTokenCmd(supabase: any, tokenInput: string, action: 'block' | 'unblock' | 'reset' | 'delete'): Promise<string> {
  try {
    const { token, error, multiple } = await findTokenByInput(supabase, tokenInput);
    if (error) return `⚠️ ${error}`;
    if (multiple) {
      const list = multiple.map((t: any) => `• ${t.code} [${t.status}]`).join('\n');
      return `⚠️ Ditemukan ${multiple.length} token dengan akhiran "${tokenInput}":\n${list}\n\nGunakan kode lengkap untuk aksi.`;
    }

    if (action === 'block') {
      await supabase.from('tokens').update({ status: 'blocked' }).eq('id', token.id);
      await supabase.from('token_sessions').update({ is_active: false }).eq('token_id', token.id);
      return `🚫 Token ${token.code} telah *diblokir*! Semua sesi dimatikan.`;
    } else if (action === 'unblock') {
      await supabase.from('tokens').update({ status: 'active' }).eq('id', token.id);
      return `✅ Token ${token.code} telah *dibuka blokirnya*.`;
    } else if (action === 'reset') {
      await supabase.from('token_sessions').delete().eq('token_id', token.id);
      return `🔄 Semua sesi untuk token ${token.code} telah *direset*.`;
    } else if (action === 'delete') {
      await supabase.from('chat_messages').delete().eq('token_id', token.id);
      await supabase.from('token_sessions').delete().eq('token_id', token.id);
      await supabase.from('tokens').delete().eq('id', token.id);
      return `🗑️ Token ${token.code} telah *dihapus* beserta semua sesi dan pesan chat.`;
    }
    return '⚠️ Aksi tidak dikenal.';
  } catch (e) {
    return `⚠️ Error: ${e instanceof Error ? e.message : 'Unknown'}`;
  }
}

async function handleTokensList(supabase: any): Promise<string> {
  const { data: tokens } = await supabase.from('tokens').select('code, status, expires_at, duration_type').order('created_at', { ascending: false }).limit(30);
  if (!tokens || tokens.length === 0) return '📋 Tidak ada token.';
  const now = new Date();
  const lines = tokens.map((t: any) => {
    const last4 = t.code.slice(-4);
    const expired = t.expires_at && new Date(t.expires_at) < now;
    const statusIcon = t.status === 'blocked' ? '🔴' : expired ? '🟡' : '🟢';
    return `${statusIcon} ...${last4} [${t.status}] ${t.duration_type || ''}`;
  });
  return `🔑 *Daftar Token (${tokens.length}):*\n${lines.join('\n')}\n\n💡 Gunakan 4 digit belakang untuk aksi token.`;
}

// ======== NEW COMMANDS ========

async function handleStatsWa(supabase: any): Promise<string> {
  const [usersRes, balRes, tokensRes, coinOrdersRes, subOrdersRes, showsRes, sessionsRes] = await Promise.all([
    supabase.from('profiles').select('id', { count: 'exact', head: true }),
    supabase.from('coin_balances').select('balance'),
    supabase.from('tokens').select('id, status, expires_at', { count: 'exact' }),
    supabase.from('coin_orders').select('id, status, coin_amount'),
    supabase.from('subscription_orders').select('id, status'),
    supabase.from('shows').select('id').eq('is_active', true),
    supabase.from('token_sessions').select('id').eq('is_active', true),
  ]);
  const totalUsers = usersRes.count || 0;
  const totalCoins = (balRes.data || []).reduce((sum: number, b: any) => sum + (b.balance || 0), 0);
  const now = new Date();
  const activeTokens = (tokensRes.data || []).filter((t: any) => t.status === 'active' && (!t.expires_at || new Date(t.expires_at) > now)).length;
  const blockedTokens = (tokensRes.data || []).filter((t: any) => t.status === 'blocked').length;
  const pendingCoin = (coinOrdersRes.data || []).filter((o: any) => o.status === 'pending').length;
  const confirmedCoin = (coinOrdersRes.data || []).filter((o: any) => o.status === 'confirmed').length;
  const pendingSub = (subOrdersRes.data || []).filter((o: any) => o.status === 'pending').length;
  const confirmedSub = (subOrdersRes.data || []).filter((o: any) => o.status === 'confirmed').length;
  const activeSessions = (sessionsRes.data || []).length;

  return `📊 *STATISTIK PLATFORM REALTIME48*

👥 *User:*
  Total user: *${totalUsers}*
  Session aktif: *${activeSessions}*

💰 *Koin:*
  Total koin beredar: *${totalCoins.toLocaleString()}*

🔑 *Token:*
  Aktif: *${activeTokens}* | Diblokir: *${blockedTokens}*

🪙 *Order Koin:*
  Pending: *${pendingCoin}* | Dikonfirmasi: *${confirmedCoin}*

🎬 *Subscription:*
  Pending: *${pendingSub}* | Dikonfirmasi: *${confirmedSub}*

🎭 Show aktif: *${(showsRes.data || []).length}*`;
}

async function handleCekUserWa(supabase: any, username: string): Promise<string> {
  const { data: profile } = await supabase.from('profiles').select('id, username, created_at').ilike('username', username).maybeSingle();
  if (!profile) return `⚠️ User "${username}" tidak ditemukan.`;

  const [balRes, coinOrdersRes, tokensRes] = await Promise.all([
    supabase.from('coin_balances').select('balance').eq('user_id', profile.id).maybeSingle(),
    supabase.from('coin_orders').select('id, coin_amount, status, created_at').eq('user_id', profile.id).order('created_at', { ascending: false }).limit(5),
    supabase.from('tokens').select('code, status, expires_at, duration_type').eq('user_id', profile.id).order('created_at', { ascending: false }).limit(10),
  ]);

  const balance = balRes.data?.balance ?? 0;
  const regDate = new Date(profile.created_at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
  const now = new Date();

  let msg = `🔍 *DETAIL USER: ${profile.username || 'Unknown'}*\n\n`;
  msg += `📅 Terdaftar: ${regDate}\n`;
  msg += `💰 Saldo koin: *${balance}*\n\n`;

  const userTokens = tokensRes.data || [];
  if (userTokens.length > 0) {
    msg += `🔑 *Token (${userTokens.length}):*\n`;
    for (const t of userTokens) {
      const expired = t.expires_at && new Date(t.expires_at) < now;
      const icon = t.status === 'blocked' ? '🔴' : expired ? '🟡' : '🟢';
      msg += `  ${icon} ...${t.code.slice(-4)} ${t.status} ${t.duration_type || ''}\n`;
    }
    msg += '\n';
  }

  const coinOrders = coinOrdersRes.data || [];
  if (coinOrders.length > 0) {
    msg += `🪙 *Order Koin Terakhir:*\n`;
    for (const o of coinOrders) {
      const time = new Date(o.created_at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short' });
      const icon = o.status === 'confirmed' ? '✅' : o.status === 'rejected' ? '❌' : '⏳';
      msg += `  ${icon} ${o.coin_amount} koin - ${time}\n`;
    }
  }

  return msg;
}

async function handleAnnounceWa(supabase: any, message: string): Promise<string> {
  const [coinRes, subRes] = await Promise.all([
    supabase.from('coin_orders').select('phone').not('phone', 'is', null),
    supabase.from('subscription_orders').select('phone').not('phone', 'is', null),
  ]);

  const phones = new Set<string>();
  for (const o of (coinRes.data || [])) { if (o.phone?.trim()) phones.add(o.phone.trim()); }
  for (const o of (subRes.data || [])) { if (o.phone?.trim()) phones.add(o.phone.trim()); }

  if (phones.size === 0) return '⚠️ Tidak ada nomor HP user yang tersedia.';

  const FONNTE_TOKEN = Deno.env.get('FONNTE_API_TOKEN');
  if (!FONNTE_TOKEN) return '⚠️ FONNTE_API_TOKEN tidak dikonfigurasi.';

  let sent = 0;
  for (const phone of phones) {
    try { await sendFonnteMessage(FONNTE_TOKEN, phone, `📢 *PENGUMUMAN REALTIME48*\n\n${message}`); sent++; } catch {}
  }

  return `✅ Pengumuman terkirim ke *${sent}*/${phones.size} nomor!`;
}

async function handleShowListWa(supabase: any): Promise<string> {
  const { data: shows } = await supabase.from('shows').select('id, title, is_active, is_replay, is_subscription, is_order_closed, coin_price, replay_coin_price, schedule_date, schedule_time').order('created_at', { ascending: false }).limit(50);
  if (!shows || shows.length === 0) return '🎬 Tidak ada show.';

  let msg = `🎬 *DAFTAR SEMUA SHOW (${shows.length})*\n\n`;
  for (const s of shows) {
    const sid = s.id.replace(/-/g, '').slice(0, 6).toLowerCase();
    const status: string[] = [];
    if (!s.is_active) status.push('❌ Nonaktif');
    else status.push('✅ Aktif');
    if (s.is_replay) status.push('🔁 Replay');
    if (s.is_subscription) status.push('👑 Member');
    if (s.is_order_closed) status.push('🔒 Tutup');

    const { count } = await supabase.from('subscription_orders').select('id', { count: 'exact', head: true }).eq('show_id', s.id).eq('status', 'confirmed');

    msg += `#${sid} *${s.title}*\n`;
    msg += `   ${status.join(' | ')}\n`;
    msg += `   🪙 ${s.coin_price}/${s.replay_coin_price} | 📦 ${count || 0} order\n`;
    if (s.schedule_date) msg += `   📅 ${s.schedule_date} ${s.schedule_time || ''}\n`;
    msg += '\n';
  }
  return msg;
}

async function handlePendapatanWa(supabase: any): Promise<string> {
  const { data: coinOrders } = await supabase.from('coin_orders').select('coin_amount, price, status, created_at').eq('status', 'confirmed');
  const { data: subOrders } = await supabase.from('subscription_orders').select('id, created_at').eq('status', 'confirmed');

  const totalCoinRevenue = (coinOrders || []).reduce((sum: number, o: any) => {
    const price = parseInt((o.price || '0').replace(/[^0-9]/g, ''), 10);
    return sum + price;
  }, 0);
  const totalCoinsSold = (coinOrders || []).reduce((sum: number, o: any) => sum + (o.coin_amount || 0), 0);

  const monthlyMap: Record<string, { coin: number; sub: number }> = {};
  for (const o of (coinOrders || [])) {
    const month = new Date(o.created_at).toLocaleDateString('id-ID', { year: 'numeric', month: 'short', timeZone: 'Asia/Jakarta' });
    if (!monthlyMap[month]) monthlyMap[month] = { coin: 0, sub: 0 };
    monthlyMap[month].coin += parseInt((o.price || '0').replace(/[^0-9]/g, ''), 10);
  }
  for (const o of (subOrders || [])) {
    const month = new Date(o.created_at).toLocaleDateString('id-ID', { year: 'numeric', month: 'short', timeZone: 'Asia/Jakarta' });
    if (!monthlyMap[month]) monthlyMap[month] = { coin: 0, sub: 0 };
    monthlyMap[month].sub++;
  }

  let msg = `💰 *RINGKASAN PENDAPATAN*\n\n`;
  msg += `🪙 *Penjualan Koin:*\n`;
  msg += `  Total order: *${(coinOrders || []).length}*\n`;
  msg += `  Total koin terjual: *${totalCoinsSold.toLocaleString()}*\n`;
  msg += `  Total pendapatan: *Rp ${totalCoinRevenue.toLocaleString()}*\n\n`;
  msg += `🎬 *Subscription:*\n`;
  msg += `  Total order: *${(subOrders || []).length}*\n\n`;

  const months = Object.entries(monthlyMap).slice(-6);
  if (months.length > 0) {
    msg += `📅 *Per Bulan (6 terakhir):*\n`;
    for (const [month, data] of months) {
      msg += `  ${month}: Rp ${data.coin.toLocaleString()} | ${data.sub} sub\n`;
    }
  }
  return msg;
}

async function handleOrderTodayWa(supabase: any): Promise<string> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayIso = todayStart.toISOString();

  const [coinRes, subRes] = await Promise.all([
    supabase.from('coin_orders').select('id, coin_amount, price, status, short_id, created_at').gte('created_at', todayIso).order('created_at', { ascending: false }),
    supabase.from('subscription_orders').select('id, email, status, short_id, created_at').gte('created_at', todayIso).order('created_at', { ascending: false }),
  ]);

  const coinOrders = coinRes.data || [];
  const subOrders = subRes.data || [];

  if (coinOrders.length === 0 && subOrders.length === 0) return '📋 Tidak ada order hari ini.';

  let msg = `📋 *ORDER HARI INI*\n\n`;

  if (coinOrders.length > 0) {
    const pending = coinOrders.filter((o: any) => o.status === 'pending').length;
    const confirmed = coinOrders.filter((o: any) => o.status === 'confirmed').length;
    const rejected = coinOrders.filter((o: any) => o.status === 'rejected').length;
    msg += `🪙 *Koin (${coinOrders.length}):* ⏳${pending} ✅${confirmed} ❌${rejected}\n`;
    for (const o of coinOrders.slice(0, 10)) {
      const icon = o.status === 'confirmed' ? '✅' : o.status === 'rejected' ? '❌' : '⏳';
      const time = new Date(o.created_at).toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' });
      msg += `  ${icon} ${o.short_id || '-'} ${o.coin_amount} koin - ${time}\n`;
    }
    msg += '\n';
  }

  if (subOrders.length > 0) {
    const pending = subOrders.filter((o: any) => o.status === 'pending').length;
    const confirmed = subOrders.filter((o: any) => o.status === 'confirmed').length;
    const rejected = subOrders.filter((o: any) => o.status === 'rejected').length;
    msg += `🎬 *Subscription (${subOrders.length}):* ⏳${pending} ✅${confirmed} ❌${rejected}\n`;
    for (const o of subOrders.slice(0, 10)) {
      const icon = o.status === 'confirmed' ? '✅' : o.status === 'rejected' ? '❌' : '⏳';
      const time = new Date(o.created_at).toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' });
      msg += `  ${icon} ${o.short_id || '-'} ${o.email || '-'} - ${time}\n`;
    }
  }

  return msg;
}

async function handleTopUsersWa(supabase: any): Promise<string> {
  const { data: balances } = await supabase.from('coin_balances').select('user_id, balance').order('balance', { ascending: false }).limit(15);
  if (!balances || balances.length === 0) return '👥 Belum ada user dengan saldo koin.';

  let msg = `🏆 *TOP USERS (SALDO KOIN)*\n\n`;
  let rank = 0;
  for (const b of balances) {
    rank++;
    const { data: profile } = await supabase.from('profiles').select('username').eq('id', b.user_id).maybeSingle();
    const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `${rank}.`;
    msg += `${medal} *${profile?.username || 'Unknown'}* - ${b.balance.toLocaleString()} koin\n`;
  }
  return msg;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
