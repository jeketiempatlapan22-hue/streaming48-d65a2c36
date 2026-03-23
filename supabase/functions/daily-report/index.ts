import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const TELEGRAM_API = 'https://api.telegram.org/bot';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN');
  const ADMIN_CHAT_ID = Deno.env.get('ADMIN_TELEGRAM_CHAT_ID');
  if (!BOT_TOKEN || !ADMIN_CHAT_ID) {
    return new Response(JSON.stringify({ error: 'Missing config' }), { status: 500, headers: corsHeaders });
  }

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  try {
    // Today range (WIB = UTC+7)
    const now = new Date();
    const todayWIB = new Date(now.getTime() + 7 * 60 * 60 * 1000);
    const dateStr = todayWIB.toISOString().slice(0, 10);
    const todayStart = new Date(`${dateStr}T00:00:00+07:00`).toISOString();
    const todayEnd = new Date(`${dateStr}T23:59:59+07:00`).toISOString();

    // Fetch all data in parallel
    const [
      coinOrdersRes, subOrdersRes, usersRes, balRes,
      tokensRes, sessionsRes, showsRes, newUsersRes
    ] = await Promise.all([
      supabase.from('coin_orders').select('id, coin_amount, price, status, created_at').gte('created_at', todayStart).lte('created_at', todayEnd),
      supabase.from('subscription_orders').select('id, status, created_at').gte('created_at', todayStart).lte('created_at', todayEnd),
      supabase.from('profiles').select('id', { count: 'exact', head: true }),
      supabase.from('coin_balances').select('balance'),
      supabase.from('tokens').select('id, status, expires_at'),
      supabase.from('token_sessions').select('id').eq('is_active', true),
      supabase.from('shows').select('id').eq('is_active', true),
      supabase.from('profiles').select('id', { count: 'exact', head: true }).gte('created_at', todayStart).lte('created_at', todayEnd),
    ]);

    const coinOrders = coinOrdersRes.data || [];
    const subOrders = subOrdersRes.data || [];

    // Coin order stats
    const coinPending = coinOrders.filter(o => o.status === 'pending').length;
    const coinConfirmed = coinOrders.filter(o => o.status === 'confirmed').length;
    const coinRejected = coinOrders.filter(o => o.status === 'rejected').length;
    const totalRevenue = coinOrders
      .filter(o => o.status === 'confirmed')
      .reduce((sum, o) => sum + parseInt((o.price || '0').replace(/[^0-9]/g, ''), 10), 0);
    const totalCoinsSold = coinOrders
      .filter(o => o.status === 'confirmed')
      .reduce((sum, o) => sum + (o.coin_amount || 0), 0);

    // Sub order stats
    const subPending = subOrders.filter(o => o.status === 'pending').length;
    const subConfirmed = subOrders.filter(o => o.status === 'confirmed').length;
    const subRejected = subOrders.filter(o => o.status === 'rejected').length;

    // Global stats
    const totalUsers = usersRes.count || 0;
    const newUsers = newUsersRes.count || 0;
    const totalCoinsCirculating = (balRes.data || []).reduce((sum: number, b: any) => sum + (b.balance || 0), 0);
    const nowDate = new Date();
    const activeTokens = (tokensRes.data || []).filter((t: any) => t.status === 'active' && (!t.expires_at || new Date(t.expires_at) > nowDate)).length;
    const blockedTokens = (tokensRes.data || []).filter((t: any) => t.status === 'blocked').length;
    const activeSessions = (sessionsRes.data || []).length;
    const activeShows = (showsRes.data || []).length;

    const formattedDate = todayWIB.toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    const msg = `📊 *LAPORAN HARIAN REALTIME48*\n` +
      `📅 ${escapeMarkdown(formattedDate)}\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n\n` +
      `🪙 *ORDER KOIN HARI INI:*\n` +
      `  Total: *${coinOrders.length}* order\n` +
      `  ⏳ Pending: *${coinPending}*\n` +
      `  ✅ Dikonfirmasi: *${coinConfirmed}*\n` +
      `  ❌ Ditolak: *${coinRejected}*\n` +
      `  💰 Pendapatan: *Rp ${totalRevenue.toLocaleString()}*\n` +
      `  🪙 Koin terjual: *${totalCoinsSold.toLocaleString()}*\n\n` +
      `🎬 *SUBSCRIPTION HARI INI:*\n` +
      `  Total: *${subOrders.length}* order\n` +
      `  ⏳ Pending: *${subPending}*\n` +
      `  ✅ Dikonfirmasi: *${subConfirmed}*\n` +
      `  ❌ Ditolak: *${subRejected}*\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n\n` +
      `👥 *STATISTIK PLATFORM:*\n` +
      `  Total user: *${totalUsers}*\n` +
      `  User baru hari ini: *${newUsers}*\n` +
      `  Session aktif: *${activeSessions}*\n` +
      `  Koin beredar: *${totalCoinsCirculating.toLocaleString()}*\n\n` +
      `🔑 *TOKEN:*\n` +
      `  Aktif: *${activeTokens}* \\| Diblokir: *${blockedTokens}*\n\n` +
      `🎭 Show aktif: *${activeShows}*\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🤖 _Laporan otomatis \\- Realtime48 Bot_`;

    await fetch(`${TELEGRAM_API}${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: ADMIN_CHAT_ID, text: msg, parse_mode: 'MarkdownV2' }),
    });

    // Also send to WhatsApp admins
    const FONNTE_TOKEN = Deno.env.get('FONNTE_API_TOKEN');
    if (FONNTE_TOKEN) {
      const { data: settings } = await supabase.from('site_settings').select('value').eq('key', 'whatsapp_admin_numbers').maybeSingle();
      const adminNums = (settings?.value || '').split(',').map((n: string) => n.trim()).filter(Boolean);

      const waMsg = `📊 *LAPORAN HARIAN REALTIME48*\n` +
        `📅 ${formattedDate}\n\n` +
        `🪙 *Order Koin:* ${coinOrders.length} (⏳${coinPending} ✅${coinConfirmed} ❌${coinRejected})\n` +
        `💰 Pendapatan: Rp ${totalRevenue.toLocaleString()}\n` +
        `🪙 Koin terjual: ${totalCoinsSold.toLocaleString()}\n\n` +
        `🎬 *Subscription:* ${subOrders.length} (⏳${subPending} ✅${subConfirmed} ❌${subRejected})\n\n` +
        `👥 User: ${totalUsers} (+${newUsers} baru)\n` +
        `🔑 Token aktif: ${activeTokens} | Diblokir: ${blockedTokens}\n` +
        `👁️ Session aktif: ${activeSessions}\n` +
        `🪙 Koin beredar: ${totalCoinsCirculating.toLocaleString()}\n\n` +
        `🤖 _Laporan otomatis - Realtime48 Bot_`;

      for (const num of adminNums) {
        try {
          await fetch('https://api.fonnte.com/send', {
            method: 'POST',
            headers: { 'Authorization': FONNTE_TOKEN },
            body: new URLSearchParams({ target: num, message: waMsg }),
          });
        } catch {}
      }
    }

    return new Response(JSON.stringify({ ok: true, date: dateStr }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('daily-report error:', e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'Unknown' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

function escapeMarkdown(text: string): string {
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}
