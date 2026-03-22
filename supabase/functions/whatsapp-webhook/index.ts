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
  const deductCoinMatch = rawText.match(/^\/deductcoin\s+(\S+)\s+(\d+)(?:\s+(.+))?$/i);
  const broadcastMatch = rawText.match(/^\/broadcast\s+(.+)$/is);
  const replayMatch = rawText.match(/^\/replay\s+(.+)$/i);
  const isReplayList = /^\/replay$/i.test(rawText);
  const setliveMatch = rawText.match(/^\/setlive(?:\s+(.+))?$/i);
  const isSetOffline = /^\/setoffline$/i.test(rawText);

  if (isHelp) return handleHelp();
  if (isStatus) return await handleStatus(supabase);
  if (addCoinMatch) return await handleAddCoin(supabase, addCoinMatch[1], parseInt(addCoinMatch[2], 10), addCoinMatch[3] || null);
  if (deductCoinMatch) return await handleDeductCoin(supabase, deductCoinMatch[1], parseInt(deductCoinMatch[2], 10), deductCoinMatch[3] || null);
  if (balanceMatch) return await handleBalance(supabase, balanceMatch[1]);
  if (isUsers) return await handleUsers(supabase);
  if (broadcastMatch) return await handleBroadcast(supabase, broadcastMatch[1].trim());
  if (replayMatch) return await handleReplayToggle(supabase, replayMatch[1].trim());
  if (isReplayList) return await handleReplayList(supabase);
  if (setliveMatch) return await handleSetLive(supabase, setliveMatch[1]?.trim() || null);
  if (isSetOffline) return await handleSetOffline(supabase);
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

🎬 *Show Management:*
/replay - Lihat daftar show replay
/replay <nama show> - Toggle mode replay

📢 *Lainnya:*
/broadcast <pesan> - Kirim notifikasi
/help - Tampilkan daftar command`;
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
      const { data: confirmed } = await supabase.from('coin_orders').update({ status: 'confirmed' }).eq('id', order.id).eq('status', 'pending').select('id').maybeSingle();
      if (!confirmed) return `⚠️ Order koin ${sid} sudah diproses.`;

      const { data: existing } = await supabase.from('coin_balances').select('balance').eq('user_id', order.user_id).maybeSingle();
      if (existing) {
        await supabase.from('coin_balances').update({ balance: existing.balance + order.coin_amount, updated_at: new Date().toISOString() }).eq('user_id', order.user_id);
      } else {
        await supabase.from('coin_balances').insert({ user_id: order.user_id, balance: order.coin_amount });
      }

      const { data: profile } = await supabase.from('profiles').select('username').eq('id', order.user_id).single();
      const { data: balData } = await supabase.from('coin_balances').select('balance').eq('user_id', order.user_id).maybeSingle();

      if (order.phone) {
        const FONNTE_TOKEN = Deno.env.get('FONNTE_API_TOKEN');
        if (FONNTE_TOKEN) {
          const waMsg = `✅ Pembayaran kamu untuk *${order.coin_amount} koin* telah dikonfirmasi!\n\n💰 Saldo saat ini: ${balData?.balance ?? order.coin_amount} koin.\n\nTerima kasih! 🎉`;
          await sendFonnteMessage(FONNTE_TOKEN, order.phone, waMsg);
        }
      }

      return `✅ Order koin ${sid} dikonfirmasi! ${profile?.username || 'User'} +${order.coin_amount} koin (Saldo: ${balData?.balance ?? order.coin_amount})`;
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

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
