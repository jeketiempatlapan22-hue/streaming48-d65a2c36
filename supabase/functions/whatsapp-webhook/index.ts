import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// In-memory rate limiter
const rlMap = new Map<string, { count: number; resetAt: number }>();
function edgeRL(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  if (rlMap.size > 500) { for (const [k, v] of rlMap) { if (now > v.resetAt) rlMap.delete(k); } }
  const e = rlMap.get(key);
  if (!e || now > e.resetAt) { rlMap.set(key, { count: 1, resetAt: now + windowMs }); return true; }
  if (e.count >= max) return false;
  e.count++;
  return true;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (!edgeRL(`wa_webhook:${ip}`, 30, 60_000)) {
    return new Response(JSON.stringify({ error: 'Rate limited' }), {
      status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Webhook secret validation — MANDATORY to prevent spoofed requests
  const WEBHOOK_SECRET = Deno.env.get('WHATSAPP_WEBHOOK_SECRET');
  if (!WEBHOOK_SECRET) {
    return jsonResponse({ error: 'WHATSAPP_WEBHOOK_SECRET not configured' }, 500);
  }
  const url = new URL(req.url);
  const providedSecret = url.searchParams.get('secret');
  if (providedSecret !== WEBHOOK_SECRET) {
    return jsonResponse({ error: 'Forbidden' }, 403);
  }

  const FONNTE_TOKEN = Deno.env.get('FONNTE_API_TOKEN');
  if (!FONNTE_TOKEN) return jsonResponse({ error: 'FONNTE_API_TOKEN not configured' }, 500);

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // Persistent DB-level rate limit: 1000 webhook calls per hour per IP
  const { data: dbAllowed } = await supabase.rpc("check_rate_limit", {
    _key: "wa_webhook_ip:" + ip, _max_requests: 1000, _window_seconds: 3600,
  });
  if (dbAllowed === false) {
    return new Response(JSON.stringify({ error: 'Rate limited' }), {
      status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    // Fonnte webhook can send JSON, x-www-form-urlencoded, or form-data
    let sender = '';
    let message = '';

    const contentType = (req.headers.get('content-type') || '').toLowerCase();

    if (contentType.includes('application/json')) {
      const body = await req.json().catch(() => ({} as Record<string, unknown>));
      sender = String((body as any).sender || '');
      message = String((body as any).message || (body as any).text || '');
    } else if (contentType.includes('application/x-www-form-urlencoded')) {
      const text = await req.text();
      const params = new URLSearchParams(text);
      sender = params.get('sender') || '';
      message = params.get('message') || params.get('text') || '';
    } else {
      // Important: use clone for fallback so body is not consumed twice
      const reqClone = req.clone();
      const formData = await req.formData().catch(() => null);

      if (formData) {
        sender = formData.get('sender')?.toString() || '';
        message = formData.get('message')?.toString() || formData.get('text')?.toString() || '';
      } else {
        const text = await reqClone.text();
        try {
          const body = JSON.parse(text);
          sender = String(body?.sender || '');
          message = String(body?.message || body?.text || '');
        } catch {
          const params = new URLSearchParams(text);
          sender = params.get('sender') || '';
          message = params.get('message') || params.get('text') || '';
        }
      }
    }

    if (!sender || !message) {
      return jsonResponse({ ok: true, skipped: true, reason: 'no sender or message' });
    }

    // Normalize phone number
    const cleanSender = sender.replace(/[^0-9]/g, '');
    const rawText = message.trim();

    // ========== PUBLIC COMMANDS (any sender) ==========
    const publicResponse = await processPublicCommand(supabase, rawText, cleanSender, FONNTE_TOKEN);
    if (publicResponse !== null) {
      const { text: respText, imageUrl: respImage } = typeof publicResponse === 'string' 
        ? { text: publicResponse, imageUrl: undefined } 
        : publicResponse;
      await sendFonnteMessage(FONNTE_TOKEN, sender, respText, respImage);
      return jsonResponse({ ok: true, processed: true, type: 'public' });
    }

    // ========== ADMIN COMMANDS (whitelisted senders only) ==========
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

// ========== PUBLIC COMMANDS (accessible by anyone) ==========
async function processPublicCommand(supabase: any, rawText: string, senderPhone: string, fonnteToken: string): Promise<{ text: string; imageUrl?: string } | null> {
  const text = rawText.trim();

  // Public menu
  if (/^(MENU|HAI|HALO|HI|INFO|START)$/i.test(text)) {
    return { text: handlePublicMenu() };
  }

  // List shows
  if (/^(DAFTAR\s*SHOW|LIST\s*SHOW|JADWAL|SHOW)$/i.test(text)) {
    return { text: await handlePublicShowList(supabase) };
  }

  // Check order status: CEK <short_id>
  const cekMatch = text.match(/^(?:CEK|STATUS)\s+(\S+)$/i);
  if (cekMatch) {
    return { text: await handlePublicCheckOrder(supabase, cekMatch[1].trim()) };
  }

  return null; // Not a public command
}

function handlePublicMenu(): string {
  return `👋 *Halo! Selamat datang di REALTIME48!*

🎬 Berikut perintah yang bisa kamu gunakan:

📋 *SHOW* — Lihat daftar show yang tersedia
📊 *CEK <ID order>* — Cek status pesanan kamu

💡 *Contoh:*
• Ketik *SHOW* untuk lihat jadwal
• Ketik *CEK s12* untuk cek status order

🛒 Untuk pembelian show & koin, kunjungi:
🌐 *realtime48stream.my.id*`;
}

async function handlePublicShowList(supabase: any): Promise<string> {
  try {
    const { data: shows } = await supabase
      .from('shows')
      .select('id, title, price, schedule_date, schedule_time, is_order_closed, is_subscription, coin_price, category, is_replay, lineup')
      .eq('is_active', true)
      .eq('is_replay', false)
      .order('created_at', { ascending: false })
      .limit(20);

    if (!shows || shows.length === 0) {
      return '📋 Tidak ada show yang tersedia saat ini.\n\nKunjungi website: realtime48stream.my.id';
    }

    let msg = '🎬 *DAFTAR SHOW TERSEDIA*\n\n';
    shows.forEach((s: any, i: number) => {
      const num = i + 1;
      const status = s.is_order_closed ? '🔴 CLOSED' : '🟢 OPEN';
      const schedule = s.schedule_date ? `📅 ${s.schedule_date}${s.schedule_time ? ' ' + s.schedule_time : ''}` : '';
      const type = s.is_subscription ? '🎬 Member' : '🎭 Reguler';
      msg += `*${num}. ${s.title}*\n${type} | ${status}\n💰 ${s.price}${s.coin_price > 0 ? ` | 🪙 ${s.coin_price} koin` : ''}\n${schedule}\n\n`;
    });

    msg += `🛒 Untuk pembelian, kunjungi:\n🌐 *realtime48stream.my.id*`;
    return msg;
  } catch (e) {
    return `⚠️ Error: ${e instanceof Error ? e.message : 'Unknown'}`;
  }
}

async function handlePublicCheckOrder(supabase: any, shortId: string): Promise<string> {
  try {
    // Check coin orders
    const { data: coinOrder } = await supabase
      .from('coin_orders')
      .select('id, short_id, status, coin_amount, price, created_at')
      .ilike('short_id', shortId)
      .maybeSingle();

    if (coinOrder) {
      const statusMap: Record<string, string> = {
        pending: '⏳ Menunggu konfirmasi admin',
        confirmed: '✅ Sudah dikonfirmasi',
        rejected: '❌ Ditolak',
        cancelled: '🚫 Dibatalkan',
      };
      const time = new Date(coinOrder.created_at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
      return `🪙 *STATUS ORDER KOIN*\n\nID: ${coinOrder.short_id || shortId}\nJumlah: ${coinOrder.coin_amount} koin\nHarga: ${coinOrder.price || '-'}\nStatus: ${statusMap[coinOrder.status] || coinOrder.status}\nWaktu: ${time}`;
    }

    // Check subscription orders
    const { data: subOrder } = await supabase
      .from('subscription_orders')
      .select('id, short_id, status, show_id, created_at')
      .ilike('short_id', shortId)
      .maybeSingle();

    if (subOrder) {
      const { data: show } = await supabase.from('shows').select('title').eq('id', subOrder.show_id).maybeSingle();
      const statusMap: Record<string, string> = {
        pending: '⏳ Menunggu konfirmasi admin',
        confirmed: '✅ Sudah dikonfirmasi',
        rejected: '❌ Ditolak',
        cancelled: '🚫 Dibatalkan',
      };
      const time = new Date(subOrder.created_at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
      return `🎬 *STATUS ORDER SHOW*\n\nID: ${subOrder.short_id || shortId}\nShow: ${show?.title || '-'}\nStatus: ${statusMap[subOrder.status] || subOrder.status}\nWaktu: ${time}`;
    }

    return `❓ Order dengan ID *${shortId}* tidak ditemukan.\n\nPastikan ID yang kamu masukkan benar.`;
  } catch (e) {
    return `⚠️ Error: ${e instanceof Error ? e.message : 'Unknown'}`;
  }
}


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
  const createtokenMatch = rawText.match(/^\/createtoken\s+(.+?)(?:\s+(\d+))?$/i);
  const givetokenMatch = rawText.match(/^\/givetoken\s+(\S+)\s+(.+?)(?:\s+(\d+))?$/i);
  const bulktokenMatch = rawText.match(/^\/bulktoken\s+(.+?)\s+(\d+)(?:\s+(\d+))?$/i);
  const setshortidMatch = rawText.match(/^\/setshortid\s+#([a-f0-9]{6})\s+(\S+)$/i);
  const resendMatch = rawText.match(/^\/resend\s+(\S+)$/i);
  const maketokenMatch = rawText.match(/^\/maketoken\s+(.+?)\s+(\d+\s*(?:hari|minggu|bulan|hari))(?:\s+(\d+))?(?:\s+(.+))?$/i);

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
  if (setpriceMatch) return await handleSetPriceWa(supabase, setpriceMatch[1].trim(), setpriceMatch[2].toLowerCase() as 'coin' | 'replay', parseInt(setpriceMatch[3], 10));
  if (createtokenMatch) return await handleCreateTokenWa(supabase, createtokenMatch[1].trim(), createtokenMatch[2] ? parseInt(createtokenMatch[2], 10) : 1);
  if (givetokenMatch) return await handleGiveTokenWa(supabase, givetokenMatch[1], givetokenMatch[2].trim(), givetokenMatch[3] ? parseInt(givetokenMatch[3], 10) : 1);
  if (bulktokenMatch) return await handleBulkTokenWa(supabase, bulktokenMatch[1].trim(), parseInt(bulktokenMatch[2], 10), bulktokenMatch[3] ? parseInt(bulktokenMatch[3], 10) : 1);
  if (setshortidMatch) return await handleSetShortIdWa(supabase, setshortidMatch[1], setshortidMatch[2]);
  if (resendMatch) return await handleResendWa(supabase, resendMatch[1]);
  if (maketokenMatch) return await handleMakeTokenWa(supabase, maketokenMatch[1].trim(), maketokenMatch[2].trim(), maketokenMatch[3] ? parseInt(maketokenMatch[3], 10) : 1, maketokenMatch[4]?.trim() || null);
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
/replay <nama/ID> - Toggle mode replay (nama, #hexid, atau short_id)

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
/createtoken <nama/ID> - Buat token untuk show (1 device)
/createtoken <nama/ID> <max> - Buat token + max device
/bulktoken <show> <jumlah> - Buat banyak token sekaligus
/bulktoken <show> <jumlah> <max> - Bulk token + max device
/givetoken <user> <show> - Beri token ke user
/givetoken <user> <show> <max> - Beri token + max device

🔐 *Password Reset:*
RESET <id> - Setujui reset password
TOLAK_RESET <id> - Tolak reset password

📨 *Messaging:*
/msgshow <nama show> | <pesan> - Kirim WA ke semua pemesan show
/msgmembers <pesan> - Kirim WA ke semua member
/resend <order_id> - Kirim ulang token & info replay ke pembeli

📢 *Lainnya:*
/broadcast <pesan> - Kirim notifikasi
/setshortid #ID <nama> - Set custom ID untuk show
/help - Tampilkan daftar command

📊 *Statistik & Analitik:*
/stats - Statistik lengkap platform
/cekuser <username> - Detail info user
/showlist - Daftar semua show + status
/pendapatan - Ringkasan pendapatan
/ordertoday - Order hari ini
/topusers - Top user berdasarkan saldo
/announce <pesan> - Kirim WA ke semua user
/setprice <nama/ID> coin <harga> - Set harga koin show
/setprice <nama/ID> replay <harga> - Set harga replay show

🎫 *Token Custom:*
/maketoken <show> <durasi> - Token durasi custom (1 device)
/maketoken <show> <durasi> <max> - Token durasi + max device
/maketoken <show> <durasi> <max> <sandi> - Token + sandi replay
  Durasi: 30hari, 1minggu, 2bulan, dll`;
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
      const sid = s.short_id || s.id.substring(0, 6);
      msg += `${status} *${s.title}* (#${sid})\n   📅 ${s.schedule_date || '-'} | 🪙 ${s.replay_coin_price} koin | ${pw}\n\n`;
    }
    msg += '💡 Toggle replay: /replay <nama/ID>';
    return msg;
  } catch (e) {
    return `⚠️ Error: ${e instanceof Error ? e.message : 'Unknown'}`;
  }
}

async function findShowByInput(supabase: any, input: string): Promise<{ show: any | null; multiple: any[] | null; error: string | null }> {
  const cleanInput = input.replace(/^#/, '').trim();

  // Fetch all active shows for matching
  const { data: allShows } = await supabase
    .from('shows')
    .select('id, title, is_replay, replay_coin_price, access_password, short_id, coin_price, schedule_date, schedule_time, is_active, category')
    .eq('is_active', true);

  if (!allShows || allShows.length === 0) return { show: null, multiple: null, error: 'Tidak ada show aktif.' };

  // Try custom short_id match
  const shortIdMatch = allShows.find((s: any) => s.short_id && s.short_id.toLowerCase() === cleanInput.toLowerCase());
  if (shortIdMatch) return { show: shortIdMatch, multiple: null, error: null };

  // Try hex ID prefix match (first 6 chars of UUID)
  const hexMatch = allShows.find((s: any) => s.id.substring(0, 6).toLowerCase() === cleanInput.toLowerCase());
  if (hexMatch) return { show: hexMatch, multiple: null, error: null };

  // Try title search
  const titleMatches = allShows.filter((s: any) => s.title.toLowerCase().includes(cleanInput.toLowerCase()));
  if (titleMatches.length === 1) return { show: titleMatches[0], multiple: null, error: null };
  if (titleMatches.length > 1) return { show: null, multiple: titleMatches, error: null };

  return { show: null, multiple: null, error: `Show "${input}" tidak ditemukan.` };
}

async function handleReplayToggle(supabase: any, showName: string): Promise<string> {
  try {
    const result = await findShowByInput(supabase, showName);
    if (result.error) return `⚠️ ${result.error}`;

    if (result.multiple) {
      let msg = `⚠️ Ditemukan ${result.multiple.length} show:\n\n`;
      for (const s of result.multiple) {
        const status = s.is_replay ? '🟢 ON' : '🔴 OFF';
        const sid = s.short_id || s.id.substring(0, 6);
        msg += `${status} ${s.title} (#${sid})\n`;
      }
      msg += '\n💡 Gunakan ID: /replay #<id>';
      return msg;
    }

    const show = result.show;
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
          const waMsg = `━━━━━━━━━━━━━━━━━━\n✅ *Pembelian Koin Dikonfirmasi!*\n━━━━━━━━━━━━━━━━━━\n\n🪙 Jumlah: *${order.coin_amount} koin*\n💎 Saldo saat ini: *${newBalance} koin*\n\n_Terima kasih atas pembelian Anda!_ 🎉\n━━━━━━━━━━━━━━━━━━`;
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
    const { data: show } = await supabase.from('shows').select('title, group_link, is_subscription, is_replay, access_password, membership_duration_days, schedule_date, schedule_time').eq('id', order.show_id).single();
    const showTitle = show?.title || 'Unknown Show';

    if (action === 'approve') {
      // Use correct RPC based on show type
      const rpcName = show?.is_subscription ? 'confirm_membership_order' : 'confirm_regular_order';
      const { data: rpcResult, error: rpcError } = await supabase.rpc(rpcName, { _order_id: order.id });
      const result = typeof rpcResult === 'string' ? (() => { try { return JSON.parse(rpcResult); } catch { return null; } })() : rpcResult;

      if (rpcError || !result?.success) {
        return `⚠️ Order ${sid}: ${result?.error || rpcError?.message || 'Gagal konfirmasi'}`;
      }

      // Send WhatsApp notification to user
      const FONNTE_TOKEN = Deno.env.get('FONNTE_API_TOKEN');
      if (FONNTE_TOKEN && order.phone) {
        const siteUrl = 'https://realtime48stream.my.id';

        if (show?.is_subscription) {
          // Membership confirmation with token/link/replay info
          let waMsg = `━━━━━━━━━━━━━━━━━━\n✅ *Membership Dikonfirmasi!*\n━━━━━━━━━━━━━━━━━━\n\n🎭 Show: *${showTitle}*\n⏰ Durasi: *${result.duration_days || show?.membership_duration_days || 30} hari*\n`;
          if (result.token_code) {
            waMsg += `\n🎫 *Token Membership:* ${result.token_code}\n📺 *Link Nonton:*\n${siteUrl}/live?t=${result.token_code}\n`;
          }
          if (show?.group_link) {
            waMsg += `\n🔗 *Link Grup:*\n${show.group_link}\n`;
          }
          waMsg += `\n🔄 *Info Replay:*\n🔗 Link: https://replaytime.lovable.app\n`;
          if (show?.access_password) {
            waMsg += `🔑 Sandi Replay: ${show.access_password}\n`;
          }
          waMsg += `\n⚠️ _Jangan bagikan token/link ini ke orang lain._\n━━━━━━━━━━━━━━━━━━\n_Terima kasih telah berlangganan!_ 🎉`;
          await sendFonnteMessage(FONNTE_TOKEN, order.phone, waMsg);
        } else if (result.type === 'regular' && result.token_code) {
          // Regular show confirmation
          const liveLink = `${siteUrl}/live?t=${result.token_code}`;
          let waMsg = `━━━━━━━━━━━━━━━━━━\n✅ *Pesanan Dikonfirmasi!*\n━━━━━━━━━━━━━━━━━━\n\n🎭 Show: *${showTitle}*\n\n🎫 *Token Akses:* ${result.token_code}\n📺 *Link Nonton:*\n${liveLink}\n`;
          if (show?.access_password) {
            waMsg += `🔑 *Sandi:* ${show.access_password}\n`;
          }
          if (show?.schedule_date) {
            waMsg += `📅 *Jadwal:* ${show.schedule_date} ${show.schedule_time || ''}\n`;
          }
          waMsg += `\n🔄 *Info Replay:*\n🔗 Link: https://replaytime.lovable.app\n`;
          if (show?.access_password) {
            waMsg += `🔑 Sandi Replay: ${show.access_password}\n`;
          }
          waMsg += `\n⚠️ _Token hanya berlaku untuk 1 perangkat._\n_Jangan bagikan link ini ke orang lain._\n━━━━━━━━━━━━━━━━━━\n_Terima kasih!_ 🎉`;
          await sendFonnteMessage(FONNTE_TOKEN, order.phone, waMsg);
        }
      }

      const tokenInfo = result.token_code ? ` Token: ${result.token_code}` : '';
      return `✅ Order ${sid} untuk "${showTitle}" dikonfirmasi!${tokenInfo}`;
    } else {
      await supabase.from('subscription_orders').update({ status: 'rejected' }).eq('id', order.id).eq('status', 'pending');
      // Notify user of rejection
      const FONNTE_TOKEN = Deno.env.get('FONNTE_API_TOKEN');
      if (FONNTE_TOKEN && order.phone) {
        await sendFonnteMessage(FONNTE_TOKEN, order.phone, `❌ Maaf, pesanan kamu untuk *${showTitle}* tidak dapat dikonfirmasi.\n\nSilakan hubungi admin jika ada pertanyaan.`);
      }
      return `❌ Order ${sid} untuk "${showTitle}" ditolak.`;
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
        const resetLink = `https://realtime48stream.my.id/reset-password?token=${request.secure_token || request.short_id}`;
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
    const phones = await collectShowBuyerPhones(supabase, show.id);

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

async function collectShowBuyerPhones(supabase: any, showId: string): Promise<string[]> {
  const phones = new Set<string>();

  // 1. Subscription orders (membership buyers)
  const { data: subOrders } = await supabase
    .from('subscription_orders').select('phone, user_id')
    .eq('show_id', showId).eq('status', 'confirmed');
  for (const o of (subOrders || [])) {
    if (o.phone) phones.add(o.phone);
  }

  // 2. Coin transaction buyers (redeemed coins for this show)
  const { data: coinTxns } = await supabase
    .from('coin_transactions').select('user_id')
    .eq('reference_id', showId)
    .in('type', ['redeem', 'replay_redeem']);
  const coinUserIds = [...new Set((coinTxns || []).map((t: any) => t.user_id))];

  // 3. Get phone from coin_orders for coin buyers
  if (coinUserIds.length > 0) {
    const { data: coinOrders } = await supabase
      .from('coin_orders').select('phone, user_id')
      .in('user_id', coinUserIds).eq('status', 'confirmed');
    for (const o of (coinOrders || [])) {
      if (o.phone) phones.add(o.phone);
    }
  }

  // 4. Collect all unique user_ids
  const allUserIds = new Set<string>();
  for (const o of (subOrders || [])) { if (o.user_id) allUserIds.add(o.user_id); }
  for (const uid of coinUserIds) { allUserIds.add(uid); }

  // 5. Try to get phone from any coin_orders for users without phone
  if (allUserIds.size > 0) {
    const { data: extraOrders } = await supabase
      .from('coin_orders').select('phone')
      .in('user_id', [...allUserIds])
      .neq('phone', '').not('phone', 'is', null).limit(100);
    for (const o of (extraOrders || [])) {
      if (o.phone) phones.add(o.phone);
    }
  }

  return [...phones].filter(Boolean);
}

async function handleResendWa(supabase: any, shortId: string): Promise<string> {
  try {
    const cleanId = shortId.trim().replace(/^#/, '');
    const normalizedId = cleanId.toLowerCase();
    const siteUrl = 'https://realtime48stream.my.id';
    const FONNTE_TOKEN = Deno.env.get('FONNTE_API_TOKEN');
    if (!FONNTE_TOKEN) return '⚠️ FONNTE_API_TOKEN tidak dikonfigurasi.';

    // Try subscription_orders
    const { data: subOrder } = await supabase
      .from('subscription_orders')
      .select('id, show_id, phone, email, status, short_id, user_id, created_at')
      .or(`short_id.ilike.${normalizedId},id.eq.${normalizedId}`)
      .maybeSingle();

    if (subOrder) {
      if (subOrder.status !== 'confirmed') {
        return `⚠️ Order ${cleanId} belum dikonfirmasi (status: ${subOrder.status}).`;
      }

      const { data: show } = await supabase
        .from('shows')
        .select('title, access_password, is_subscription, is_replay, group_link, schedule_date, schedule_time')
        .eq('id', subOrder.show_id)
        .maybeSingle();

      // Find token: try by user_id first, then by show_id + creation time (for guests)
      let token = null;
      if (subOrder.user_id) {
        const { data: t } = await supabase
          .from('tokens')
          .select('code, status, expires_at')
          .eq('show_id', subOrder.show_id)
          .eq('user_id', subOrder.user_id)
          .eq('status', 'active')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        token = t;
      }
      if (!token) {
        const orderTime = new Date(subOrder.created_at);
        const minTime = new Date(orderTime.getTime() - 5 * 60_000).toISOString();
        const maxTime = new Date(orderTime.getTime() + 30 * 60_000).toISOString();
        const { data: t } = await supabase
          .from('tokens')
          .select('code, status, expires_at')
          .eq('show_id', subOrder.show_id)
          .eq('status', 'active')
          .gte('created_at', minTime)
          .lte('created_at', maxTime)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        token = t;
      }

      if (!subOrder.phone) {
        return `⚠️ Order ${cleanId} tidak memiliki nomor telepon.`;
      }

      let waMsg = `━━━━━━━━━━━━━━━━━━\n🔄 *Info Pesanan Anda*\n━━━━━━━━━━━━━━━━━━\n\n🎭 Show: *${show?.title || 'Show'}*\n`;

      if (token?.code) {
        waMsg += `\n🎫 *Token Akses:* ${token.code}\n📺 *Link Nonton:*\n${siteUrl}/live?t=${token.code}\n`;
      }

      if (show?.access_password) {
        waMsg += `🔑 *Sandi:* ${show.access_password}\n`;
      }

      if (show?.schedule_date) {
        waMsg += `📅 *Jadwal:* ${show.schedule_date} ${show.schedule_time || ''}\n`;
      }

      if (show?.group_link) {
        waMsg += `\n🔗 *Link Grup:*\n${show.group_link}\n`;
      }

      waMsg += `\n🔄 *Info Replay:*\n🔗 Link: https://replaytime.lovable.app\n`;
      if (show?.access_password) {
        waMsg += `🔑 Sandi Replay: ${show.access_password}\n`;
      }

      waMsg += `\n⚠️ _Jangan bagikan token/link ini ke orang lain._\n━━━━━━━━━━━━━━━━━━\n_Terima kasih!_ 🎉`;

      await sendFonnteMessage(FONNTE_TOKEN, subOrder.phone, waMsg);

      return `✅ *Info berhasil dikirim ulang!*\n\n🆔 Order: ${subOrder.short_id || cleanId}\n🎬 Show: ${show?.title || '-'}\n📱 Phone: ${subOrder.phone}\n${token?.code ? `🎫 Token: ${token.code}` : '⚠️ Token tidak ditemukan'}`;
    }

    // Try coin_orders
    const { data: coinOrder } = await supabase
      .from('coin_orders')
      .select('id, user_id, coin_amount, phone, status, short_id')
      .or(`short_id.ilike.${normalizedId},id.eq.${normalizedId}`)
      .maybeSingle();

    if (coinOrder) {
      if (coinOrder.status !== 'confirmed') {
        return `⚠️ Order koin ${cleanId} belum dikonfirmasi (status: ${coinOrder.status}).`;
      }
      if (!coinOrder.phone) {
        return `⚠️ Order koin ${cleanId} tidak memiliki nomor telepon.`;
      }

      const { data: balData } = await supabase.from('coin_balances').select('balance').eq('user_id', coinOrder.user_id).maybeSingle();
      const balance = balData?.balance ?? 0;

      const waMsg = `━━━━━━━━━━━━━━━━━━\n🔄 *Info Pembelian Koin*\n━━━━━━━━━━━━━━━━━━\n\n🪙 Jumlah: *${coinOrder.coin_amount} koin*\n💎 Saldo saat ini: *${balance} koin*\n\n🛒 Koin dapat digunakan untuk membeli akses show.\n🌐 realtime48stream.my.id\n\n_Terima kasih!_ 🙏\n━━━━━━━━━━━━━━━━━━`;

      await sendFonnteMessage(FONNTE_TOKEN, coinOrder.phone, waMsg);

      return `✅ *Info koin dikirim ulang!*\n\n🆔 Order: ${coinOrder.short_id || cleanId}\n📱 Phone: ${coinOrder.phone}\n🪙 ${coinOrder.coin_amount} koin`;
    }

    return `⚠️ Order "${cleanId}" tidak ditemukan.`;
  } catch (e) {
    return `⚠️ Error resend: ${e instanceof Error ? e.message : 'Unknown'}`;
  }
}

async function uploadQrToStorage(supabase: any, qrData: string, filename: string): Promise<string | null> {
  try {
    // Generate QR image from qrserver API
    const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=500x500&data=${encodeURIComponent(qrData)}`;
    const imgRes = await fetch(qrApiUrl);
    if (!imgRes.ok) { console.warn('QR server fetch failed:', imgRes.status); return qrApiUrl; }
    const imgBlob = await imgRes.blob();
    const imgBuffer = new Uint8Array(await imgBlob.arrayBuffer());

    // Add timestamp to avoid cache issues
    const ts = Date.now();
    const path = `qris/${filename}-${ts}.png`;
    const { error: upErr } = await supabase.storage
      .from('admin-media')
      .upload(path, imgBuffer, { contentType: 'image/png', upsert: true });
    if (upErr) {
      console.warn('Storage upload error:', upErr.message);
      // Fallback: return direct QR API URL
      return qrApiUrl;
    }

    // Use signed URL instead of public URL for better reliability
    const { data: signedData, error: signErr } = await supabase.storage
      .from('admin-media')
      .createSignedUrl(path, 86400); // 24 hours
    if (signErr || !signedData?.signedUrl) {
      console.warn('Signed URL error:', signErr?.message);
      // Fallback: try public URL
      const { data: pubUrl } = supabase.storage.from('admin-media').getPublicUrl(path);
      return pubUrl?.publicUrl || qrApiUrl;
    }
    console.log('QRIS signed URL created:', signedData.signedUrl.substring(0, 80) + '...');
    return signedData.signedUrl;
  } catch (e) {
    console.warn('uploadQrToStorage error:', e);
    // Final fallback: direct QR server URL
    return `https://api.qrserver.com/v1/create-qr-code/?size=500x500&data=${encodeURIComponent(qrData)}`;
  }
}

async function sendFonnteMessage(token: string, target: string, message: string, imageUrl?: string) {
  let cleanPhone = target.replace(/[^0-9]/g, '');
  if (cleanPhone.startsWith('0')) cleanPhone = '62' + cleanPhone.slice(1);
  if (!cleanPhone.startsWith('62')) cleanPhone = '62' + cleanPhone;
  if (!cleanPhone) return;
  try {
    if (imageUrl) {
      console.log('sendFonnteMessage with image:', { target: cleanPhone, imageUrl: imageUrl.substring(0, 120) });
      
      // Try sending with 'url' parameter first (for direct image URLs)
      const imgRes = await fetch('https://api.fonnte.com/send', {
        method: 'POST',
        headers: {
          Authorization: token,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          target: cleanPhone,
          message,
          url: imageUrl,
          type: 'image',
        }),
      });
      const imgResText = await imgRes.text();
      console.log('Fonnte image response:', imgRes.status, imgResText);
      
      // If image send failed, try with 'file' parameter as fallback
      let parsed: any = {};
      try { parsed = JSON.parse(imgResText); } catch {}
      if (!imgRes.ok || parsed?.status === false) {
        console.log('Fonnte image failed, retrying with file parameter...');
        const retryRes = await fetch('https://api.fonnte.com/send', {
          method: 'POST',
          headers: {
            Authorization: token,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            target: cleanPhone,
            message,
            file: imageUrl,
            type: 'image',
          }),
        });
        const retryText = await retryRes.text();
        console.log('Fonnte file retry response:', retryRes.status, retryText);
        
        // If still failed, send text-only as last resort
        let retryParsed: any = {};
        try { retryParsed = JSON.parse(retryText); } catch {}
        if (!retryRes.ok || retryParsed?.status === false) {
          console.log('Image send failed completely, sending text-only with QRIS link');
          await fetch('https://api.fonnte.com/send', {
            method: 'POST',
            headers: {
              Authorization: token,
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
              target: cleanPhone,
              message: message + `\n\n📱 *Link QRIS:*\n${imageUrl}`,
            }),
          });
        }
      }
    } else {
      await fetch('https://api.fonnte.com/send', {
        method: 'POST',
        headers: {
          Authorization: token,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          target: cleanPhone,
          message,
        }),
      });
    }
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

async function handleSetPriceWa(supabase: any, showInput: string, priceType: 'coin' | 'replay', price: number): Promise<string> {
  if (price < 0 || price > 999999) return '⚠️ Harga harus antara 0-999.999';

  // Try to find show by name or short ID
  const shortIdMatch = showInput.match(/^#?([a-f0-9]{6})$/i);
  let show: any = null;

  if (shortIdMatch) {
    const shortId = shortIdMatch[1].toLowerCase();
    const { data: shows } = await supabase.from('shows').select('id, title, coin_price, replay_coin_price');
    show = (shows || []).find((s: any) => s.id.replace(/-/g, '').slice(0, 6).toLowerCase() === shortId);
  } else {
    const { data: shows } = await supabase.from('shows').select('id, title, coin_price, replay_coin_price').ilike('title', `%${showInput}%`).limit(1);
    show = shows?.[0];
  }

  if (!show) return `⚠️ Show "${showInput}" tidak ditemukan.`;

  const field = priceType === 'coin' ? 'coin_price' : 'replay_coin_price';
  const oldPrice = priceType === 'coin' ? show.coin_price : (show.replay_coin_price ?? 0);
  await supabase.from('shows').update({ [field]: price }).eq('id', show.id);
  const label = priceType === 'coin' ? 'Harga Koin' : 'Harga Replay';
  return `✅ *${label}* untuk *${show.title}* berhasil diubah!\n\n🔄 ${oldPrice} → *${price}* koin`;
}

async function handleCreateTokenWa(supabase: any, showInput: string, maxDevices: number): Promise<string> {
  try {
    if (maxDevices < 1 || maxDevices > 9999) return '⚠️ Max device harus antara 1-9999';

    const cleanInput = showInput.replace(/^#/, '').trim();
    let show: any = null;

    // Try custom short_id first
    const { data: allShows } = await supabase.from('shows').select('id, title, schedule_date, schedule_time, access_password, short_id');
    show = (allShows || []).find((s: any) => s.short_id && s.short_id.toLowerCase() === cleanInput.toLowerCase());

    if (!show) {
      const hexOnly = cleanInput.replace(/-/g, '').toLowerCase();
      const isHexId = /^[a-f0-9]{6,32}$/i.test(hexOnly);
      if (isHexId) {
        show = (allShows || []).find((s: any) => s.id.replace(/-/g, '').toLowerCase() === hexOnly);
        if (!show && hexOnly.length >= 6) {
          const prefixMatches = (allShows || []).filter((s: any) => s.id.replace(/-/g, '').toLowerCase().startsWith(hexOnly));
          if (prefixMatches.length === 1) show = prefixMatches[0];
        }
      } else {
        show = (allShows || []).find((s: any) => s.title.toLowerCase().includes(cleanInput.toLowerCase()));
      }
    }

    if (!show) return `⚠️ Show "${showInput}" tidak ditemukan.`;

    const code = 'RT48-' + Array.from(crypto.getRandomValues(new Uint8Array(6))).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();

    let expiresAt: string | null = null;
    if (show.schedule_date && show.schedule_time) {
      const { data: parsed } = await supabase.rpc('parse_show_datetime', { _date: show.schedule_date, _time: show.schedule_time || '23.59 WIB' });
      if (parsed) {
        const showDt = new Date(parsed);
        const endOfDay = new Date(showDt);
        endOfDay.setHours(23, 59, 59, 0);
        expiresAt = endOfDay > new Date() ? endOfDay.toISOString() : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      }
    }
    if (!expiresAt) expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const { error: insertErr } = await supabase.from('tokens').insert({
      code,
      show_id: show.id,
      max_devices: maxDevices,
      expires_at: expiresAt,
      status: 'active',
    });

    if (insertErr) return `⚠️ Gagal membuat token: ${insertErr.message}`;

    const expDate = new Date(expiresAt).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
    const schedule = show.schedule_date ? `${show.schedule_date}${show.schedule_time ? ' ' + show.schedule_time : ''}` : '-';
    const liveLink = `realtime48stream.my.id/live?t=${code}`;

    let msg = `━━━━━━━━━━━━━━━━━━\n✅ *Token Berhasil Dibuat!*\n━━━━━━━━━━━━━━━━━━\n\n🎬 Show: *${show.title}*\n📅 Jadwal: ${schedule}\n\n🔑 *Token:* ${code}\n📱 Max Device: *${maxDevices}*\n⏰ Kedaluwarsa: ${expDate}\n\n📺 *Link Nonton:*\n${liveLink}`;

    msg += `\n\n🔄 *Info Replay:*\n🔗 Link: https://replaytime.lovable.app`;
    if (show.access_password) {
      msg += `\n🔐 Sandi Replay: ${show.access_password}`;
    }
    msg += `\n━━━━━━━━━━━━━━━━━━`;

    return msg;
  } catch (e) {
    return `⚠️ Error: ${e instanceof Error ? e.message : 'Unknown'}`;
  }
}

async function handleGiveTokenWa(supabase: any, usernameInput: string, showInput: string, maxDevices: number): Promise<string> {
  try {
    if (maxDevices < 1 || maxDevices > 9999) return '⚠️ Max device harus antara 1-9999';

    const { data: profiles } = await supabase.from('profiles').select('id, username').ilike('username', usernameInput).limit(5);
    if (!profiles || profiles.length === 0) return `⚠️ User "${usernameInput}" tidak ditemukan`;
    const profile = profiles.find((p: any) => p.username?.toLowerCase() === usernameInput.toLowerCase()) || profiles[0];

    const cleanShowInput = showInput.replace(/^#/, '').trim();
    let show: any = null;

    // Try custom short_id first
    const { data: allShows } = await supabase.from('shows').select('id, title, schedule_date, schedule_time, access_password, short_id');
    show = (allShows || []).find((s: any) => s.short_id && s.short_id.toLowerCase() === cleanShowInput.toLowerCase());

    if (!show) {
      const hexOnly = cleanShowInput.replace(/-/g, '').toLowerCase();
      const isHexId = /^[a-f0-9]{6,32}$/i.test(hexOnly);
      if (isHexId) {
        show = (allShows || []).find((s: any) => s.id.replace(/-/g, '').toLowerCase() === hexOnly);
        if (!show && hexOnly.length >= 6) {
          const prefixMatches = (allShows || []).filter((s: any) => s.id.replace(/-/g, '').toLowerCase().startsWith(hexOnly));
          if (prefixMatches.length === 1) show = prefixMatches[0];
        }
      } else {
        show = (allShows || []).find((s: any) => s.title.toLowerCase().includes(cleanShowInput.toLowerCase()));
      }
    }

    if (!show) return `⚠️ Show "${showInput}" tidak ditemukan.`;

    const code = 'RT48-' + Array.from(crypto.getRandomValues(new Uint8Array(6))).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();

    let expiresAt: string | null = null;
    if (show.schedule_date && show.schedule_time) {
      const { data: parsed } = await supabase.rpc('parse_show_datetime', { _date: show.schedule_date, _time: show.schedule_time || '23.59 WIB' });
      if (parsed) {
        const showDt = new Date(parsed);
        const endOfDay = new Date(showDt);
        endOfDay.setHours(23, 59, 59, 0);
        expiresAt = endOfDay > new Date() ? endOfDay.toISOString() : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      }
    }
    if (!expiresAt) expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const { error: insertErr } = await supabase.from('tokens').insert({
      code,
      show_id: show.id,
      user_id: profile.id,
      max_devices: maxDevices,
      expires_at: expiresAt,
      status: 'active',
    });

    if (insertErr) return `⚠️ Gagal membuat token: ${insertErr.message}`;

    const expDate = new Date(expiresAt).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
    const schedule = show.schedule_date ? `${show.schedule_date}${show.schedule_time ? ' ' + show.schedule_time : ''}` : '-';
    const liveLink = `realtime48stream.my.id/live?t=${code}`;

    let msg = `━━━━━━━━━━━━━━━━━━\n✅ *Token Diberikan ke User!*\n━━━━━━━━━━━━━━━━━━\n\n👤 User: *${profile.username || 'Unknown'}*\n🎬 Show: *${show.title}*\n📅 Jadwal: ${schedule}\n\n🔑 *Token:* ${code}\n📱 Max Device: *${maxDevices}*\n⏰ Kedaluwarsa: ${expDate}\n\n📺 *Link Nonton:*\n${liveLink}`;

    msg += `\n\n🔄 *Info Replay:*\n🔗 Link: https://replaytime.lovable.app`;
    if (show.access_password) {
      msg += `\n🔐 Sandi Replay: ${show.access_password}`;
    }
    msg += `\n━━━━━━━━━━━━━━━━━━`;

    return msg;
  } catch (e) {
    return `⚠️ Error: ${e instanceof Error ? e.message : 'Unknown'}`;
  }
}

async function handleBulkTokenWa(supabase: any, showInput: string, count: number, maxDevices: number): Promise<string> {
  try {
    if (count < 1 || count > 100) return '⚠️ Jumlah token harus antara 1-100';
    if (maxDevices < 1 || maxDevices > 9999) return '⚠️ Max device harus antara 1-9999';

    // Find show by custom short_id, hex ID, or name
    const cleanInput = showInput.replace(/^#/, '').trim();
    let show: any = null;

    // Try custom short_id first
    const { data: allShows } = await supabase.from('shows').select('id, title, schedule_date, schedule_time, access_password, short_id');
    show = (allShows || []).find((s: any) => s.short_id && s.short_id.toLowerCase() === cleanInput.toLowerCase());

    if (!show) {
      const hexOnly = cleanInput.replace(/-/g, '').toLowerCase();
      const isHexId = /^[a-f0-9]{6,32}$/i.test(hexOnly);
      if (isHexId) {
        show = (allShows || []).find((s: any) => s.id.replace(/-/g, '').toLowerCase() === hexOnly);
        if (!show && hexOnly.length >= 6) {
          const prefixMatches = (allShows || []).filter((s: any) => s.id.replace(/-/g, '').toLowerCase().startsWith(hexOnly));
          if (prefixMatches.length === 1) show = prefixMatches[0];
        }
      } else {
        show = (allShows || []).find((s: any) => s.title.toLowerCase().includes(cleanInput.toLowerCase()));
      }
    }

    if (!show) return `⚠️ Show "${showInput}" tidak ditemukan.`;

    let expiresAt: string | null = null;
    if (show.schedule_date && show.schedule_time) {
      const { data: parsed } = await supabase.rpc('parse_show_datetime', { _date: show.schedule_date, _time: show.schedule_time || '23.59 WIB' });
      if (parsed) {
        const showDt = new Date(parsed);
        const endOfDay = new Date(showDt);
        endOfDay.setHours(23, 59, 59, 0);
        expiresAt = endOfDay > new Date() ? endOfDay.toISOString() : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      }
    }
    if (!expiresAt) expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const tokens: string[] = [];
    const rows = [];
    for (let i = 0; i < count; i++) {
      const code = 'RT48-' + Array.from(crypto.getRandomValues(new Uint8Array(6))).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
      tokens.push(code);
      rows.push({ code, show_id: show.id, max_devices: maxDevices, expires_at: expiresAt, status: 'active' });
    }

    const { error: insertErr } = await supabase.from('tokens').insert(rows);
    if (insertErr) return `⚠️ Gagal membuat token: ${insertErr.message}`;

    const expDate = new Date(expiresAt).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

    let msg = `━━━━━━━━━━━━━━━━━━\n✅ *${count} Token Berhasil Dibuat!*\n━━━━━━━━━━━━━━━━━━\n\n`;
    msg += `🎬 Show: *${show.title}*\n`;
    msg += `📱 Max Device: *${maxDevices}*\n`;
    msg += `⏰ Kedaluwarsa: ${expDate}\n\n`;

    msg += `🔄 *Info Replay:*\n🔗 Link: https://replaytime.lovable.app\n`;
    if (show.access_password) {
      msg += `🔐 Sandi Replay: ${show.access_password}\n`;
    }
    msg += `\n🔑 *Daftar Token:*\n`;
    for (const code of tokens) {
      msg += `${code}\n`;
    }
    msg += `\n📺 *Link Nonton (contoh):*\nrealtime48stream.my.id/live?t=${tokens[0]}`;
    msg += `\n━━━━━━━━━━━━━━━━━━`;

    return msg;
  } catch (e) {
    return `⚠️ Error: ${e instanceof Error ? e.message : 'Unknown'}`;
  }
}

async function handleSetShortIdWa(supabase: any, hexId: string, shortId: string): Promise<string> {
  try {
    const { data: allShows } = await supabase.from('shows').select('id, title, short_id');
    const hexOnly = hexId.replace(/-/g, '').toLowerCase();
    const show = (allShows || []).find((s: any) => s.id.replace(/-/g, '').toLowerCase().startsWith(hexOnly));
    if (!show) return `⚠️ Show dengan ID #${hexId} tidak ditemukan.`;

    if (!/^[a-zA-Z0-9_-]{2,30}$/.test(shortId)) {
      return '⚠️ Custom ID hanya boleh huruf, angka, - dan _ (2-30 karakter)';
    }

    const existing = (allShows || []).find((s: any) => s.short_id === shortId && s.id !== show.id);
    if (existing) return `⚠️ ID "${shortId}" sudah dipakai show lain.`;

    await supabase.from('shows').update({ short_id: shortId }).eq('id', show.id);
    return `✅ Custom ID berhasil diset!\n\n🎬 Show: *${show.title}*\n🏷️ Custom ID: *${shortId}*\n\n💡 Sekarang bisa gunakan ID ini di semua command:\n/createtoken ${shortId}\n/bulktoken ${shortId} 10`;
  } catch (e) {
    return `⚠️ Error: ${e instanceof Error ? e.message : 'Unknown'}`;
  }
}

function parseDuration(durationStr: string): number {
  const match = durationStr.match(/^(\d+)\s*(hari|minggu|bulan)$/i);
  if (!match) return 0;
  const num = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  if (unit === 'hari') return num;
  if (unit === 'minggu') return num * 7;
  if (unit === 'bulan') return num * 30;
  return 0;
}

async function handleMakeTokenWa(supabase: any, showInput: string, durationStr: string, maxDevices: number, replayPassword: string | null): Promise<string> {
  try {
    if (maxDevices < 1 || maxDevices > 9999) return '⚠️ Max device harus antara 1-9999';
    const durationDays = parseDuration(durationStr);
    if (durationDays <= 0) return '⚠️ Format durasi salah. Contoh: 30hari, 1minggu, 2bulan';

    if (durationDays > 30 && !replayPassword) {
      return '⚠️ Durasi >30 hari wajib menyertakan sandi replay.\nContoh: /maketoken ShowA 60hari 1 sandiABC';
    }

    const cleanInput = showInput.replace(/^#/, '').trim();
    let show: any = null;
    const { data: allShows } = await supabase.from('shows').select('id, title, schedule_date, schedule_time, access_password, short_id');
    show = (allShows || []).find((s: any) => s.short_id && s.short_id.toLowerCase() === cleanInput.toLowerCase());
    if (!show) {
      const hexOnly = cleanInput.replace(/-/g, '').toLowerCase();
      const isHexId = /^[a-f0-9]{6,32}$/i.test(hexOnly);
      if (isHexId) {
        show = (allShows || []).find((s: any) => s.id.replace(/-/g, '').toLowerCase() === hexOnly);
        if (!show && hexOnly.length >= 6) {
          const prefixMatches = (allShows || []).filter((s: any) => s.id.replace(/-/g, '').toLowerCase().startsWith(hexOnly));
          if (prefixMatches.length === 1) show = prefixMatches[0];
        }
      } else {
        show = (allShows || []).find((s: any) => s.title.toLowerCase().includes(cleanInput.toLowerCase()));
      }
    }
    if (!show) return `⚠️ Show "${showInput}" tidak ditemukan.`;

    const code = 'RT48-' + Array.from(crypto.getRandomValues(new Uint8Array(6))).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
    const expiresAt = new Date(Date.now() + durationDays * 86400000).toISOString();

    const { error: insertErr } = await supabase.from('tokens').insert({
      code, show_id: show.id, max_devices: maxDevices, expires_at: expiresAt, status: 'active',
    });
    if (insertErr) return `⚠️ Gagal membuat token: ${insertErr.message}`;

    const expDate = new Date(expiresAt).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', day: '2-digit', month: 'long', year: 'numeric' });
    const liveLink = `realtime48stream.my.id/live?t=${code}`;

    let msg = `━━━━━━━━━━━━━━━━━━\n✅ *Token Custom Berhasil Dibuat!*\n━━━━━━━━━━━━━━━━━━\n\n🎬 Show: *${show.title}*\n🔑 Token: ${code}\n📱 Max Device: *${maxDevices}*\n⏰ Durasi: *${durationDays} hari*\n📅 Kedaluwarsa: ${expDate}\n\n📺 *Link Nonton:*\n${liveLink}\n\n🔄 *Info Replay:*\n🔗 Link: https://replaytime.lovable.app`;

    if (durationDays > 7 && replayPassword) {
      msg += `\n🔐 Sandi Replay: ${replayPassword}`;
    }
    msg += `\n━━━━━━━━━━━━━━━━━━`;

    return msg;
  } catch (e) {
    return `⚠️ Error: ${e instanceof Error ? e.message : 'Unknown'}`;
  }
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
