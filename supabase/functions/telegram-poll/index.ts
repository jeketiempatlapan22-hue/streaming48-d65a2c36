import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const TELEGRAM_API = 'https://api.telegram.org/bot';
const MAX_RUNTIME_MS = 50_000;
const MIN_REMAINING_MS = 5_000;
const POLL_INTERVAL_MS = 30_000;
const LOCK_WINDOW_MS = 60_000;
const TOUCH_STATE_INTERVAL_MS = 30_000;
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

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'cron';
  if (!edgeRL(`tg_poll:${ip}`, 120, 60_000)) {
    return new Response(JSON.stringify({ error: 'Rate limited' }), {
      status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Handle token block notification from admin panel
  if (req.method === 'POST') {
    try {
      const body = await req.clone().json();
      if (body?.notify_token_block) {
        const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN');
        const ADMIN_CHAT_ID = Deno.env.get('ADMIN_TELEGRAM_CHAT_ID');
        if (BOT_TOKEN && ADMIN_CHAT_ID) {
          const action = body.action === 'block' ? 'diblokir' : 'dibuka blokirnya';
          const emoji = body.action === 'block' ? '🚫' : '✅';
          await sendTelegramMessage(BOT_TOKEN, ADMIN_CHAT_ID, `${emoji} Token \`${escapeMarkdown(body.token_code)}\` telah *${action}* dari admin panel\\.`);
          // Also notify WhatsApp
          const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
          const FONNTE_TOKEN = Deno.env.get('FONNTE_API_TOKEN');
          if (FONNTE_TOKEN) {
            const { data: settings } = await supabase.from('site_settings').select('value').eq('key', 'whatsapp_admin_numbers').maybeSingle();
            const adminNums = settings?.value?.split(',').map((n: string) => n.trim()).filter(Boolean) || [];
            for (const num of adminNums) {
              await sendFonnteWhatsApp(num, `${emoji} Token ${body.token_code} telah *${action}* dari admin panel.`);
            }
          }
        }
        return jsonResponse({ ok: true, notified: true });
      }
    } catch {}
  }

  const startTime = Date.now();
  const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN');
  if (!BOT_TOKEN) return errorResponse('TELEGRAM_BOT_TOKEN is not configured');

  const ADMIN_CHAT_ID = Deno.env.get('ADMIN_TELEGRAM_CHAT_ID');
  if (!ADMIN_CHAT_ID) return errorResponse('ADMIN_TELEGRAM_CHAT_ID is not configured');

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // Persistent DB-level rate limit: 600 polls per hour (cron fires every minute)
  const { data: dbAllowed } = await supabase.rpc("check_rate_limit", {
    _key: "tg_poll_ip:" + ip, _max_requests: 600, _window_seconds: 3600,
  });
  if (dbAllowed === false) {
    return new Response(JSON.stringify({ error: 'Rate limited' }), {
      status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const lock = await acquireLock(supabase);
  if (!lock.acquired) return jsonResponse({ ok: true, skipped: true, reason: 'previous run still active' });

  let currentOffset = lock.update_offset;
  let totalProcessed = 0;

  try {
    await ensureNoWebhook(BOT_TOKEN);
    let pollCount = 0;
    let lastTouchAt = Date.now();

    while (true) {
      const elapsed = Date.now() - startTime;
      const remainingMs = MAX_RUNTIME_MS - elapsed;
      if (remainingMs < MIN_REMAINING_MS) break;

      if (Date.now() - lastTouchAt >= TOUCH_STATE_INTERVAL_MS) {
        await touchState(supabase);
        lastTouchAt = Date.now();
      }

      const response = await fetch(`${TELEGRAM_API}${BOT_TOKEN}/getUpdates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ offset: currentOffset, timeout: 25, allowed_updates: ['message', 'callback_query'] }),
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

        // Handle callback queries (inline keyboard button presses)
        const callbackUpdates = updates.filter((u: any) => u.callback_query);
        for (const cu of callbackUpdates) {
          const cb = cu.callback_query;
          // Answer callback ASAP to avoid Telegram client timeout spinner
          await fetch(`${TELEGRAM_API}${BOT_TOKEN}/answerCallbackQuery`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ callback_query_id: cb.id, text: 'Memproses...' }),
          });

          const callbackChatId = String(cb.message?.chat?.id ?? '').trim();
          const adminChatId = String(ADMIN_CHAT_ID).trim();
          if (callbackChatId === adminChatId) {
            await processCallbackQuery(supabase, BOT_TOKEN, ADMIN_CHAT_ID, cb);
            totalProcessed++;
          } else {
            console.warn('Ignored callback from non-admin chat:', callbackChatId);
          }
        }

        const adminMessages = rows.filter((r: any) => String(r.chat_id) === ADMIN_CHAT_ID && r.text);
        for (const msg of adminMessages) {
          const cmdText = (msg.text as string).trim();
          await processAdminMessage(supabase, BOT_TOKEN, ADMIN_CHAT_ID, msg);
          totalProcessed++;
          await supabase.from('telegram_messages').update({ processed: true }).eq('update_id', msg.update_id);
          
          // Cross-notify to WhatsApp (skip read-only commands)
          const readOnly = /^\/(help|start|status|balance|users|replay|shows|showinfo)$/i;
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
  const isShows = /^\/shows$/i.test(rawText);
  const isMembers = /^\/members$/i.test(rawText);
  const msgmembersMatch = rawText.match(/^\/msgmembers\s+(.+)$/is);
  const deductCoinMatch = rawText.match(/^\/deductcoin\s+(\S+)\s+(\d+)(?:\s+(.+))?$/i);
  const broadcastMatch = rawText.match(/^\/broadcast\s+(.+)$/is);
  const replayMatch = rawText.match(/^\/replay\s+#([a-f0-9]{6})$/i);
  const isReplayList = /^\/replay$/i.test(rawText);
  const setliveMatch = rawText.match(/^\/setlive(?:\s+#([a-f0-9]{6}))?$/i);
  const setofflineMatch = rawText.match(/^\/setoffline(?:\s+#([a-f0-9]{6}))?$/i);
  const isSetOffline = /^\/setoffline$/i.test(rawText);
  const isShowInfo = /^\/showinfo$/i.test(rawText);
  const msgshowMatch = rawText.match(/^\/msgshow\s+(.+?)\s*\|\s*(.+)$/is);
  const resetMatch = text.match(/^RESET\s+(\S+)$/);
  const tolakResetMatch = text.match(/^TOLAK_RESET\s+(\S+)$/);
  const setactiveMatch = rawText.match(/^\/setactive\s+#([a-f0-9]{6})$/i);
  const blocktokenMatch = rawText.match(/^\/blocktoken\s+(\S+)$/i);
  const unblocktokenMatch = rawText.match(/^\/unblocktoken\s+(\S+)$/i);
  const resettokenMatch = rawText.match(/^\/resettoken\s+(\S+)$/i);
  const deletetokenMatch = rawText.match(/^\/deletetoken\s+(\S+)$/i);
  const isTokensList = /^\/tokens$/i.test(rawText);
  const isStats = /^\/stats$/i.test(rawText);
  const cekuserMatch = rawText.match(/^\/cekuser\s+(\S+)$/i);
  const announceMatch = rawText.match(/^\/announce\s+(.+)$/is);
  const isShowList = /^\/showlist$/i.test(rawText);
  const isPendapatan = /^\/pendapatan$/i.test(rawText);
  const isOrderToday = /^\/ordertoday$/i.test(rawText);
  const isTopUsers = /^\/topusers$/i.test(rawText);
  const setpriceMatch = rawText.match(/^\/setprice\s+#([a-f0-9]{6})\s+(coin|replay)\s+(\d+)$/i);
  const banuserMatch = rawText.match(/^\/banuser\s+(\S+)(?:\s+(.+))?$/i);
  const unbanuserMatch = rawText.match(/^\/unbanuser\s+(\S+)$/i);
  const isBanlist = /^\/banlist$/i.test(rawText);
  const suspiciousMatch = rawText.match(/^\/suspicious(?:\s+(\S+))?$/i);
  const createtokenMatch = rawText.match(/^\/createtoken\s+(.+?)(?:\s+(\d+))?$/i);
  const givetokenMatch = rawText.match(/^\/givetoken\s+(\S+)\s+(.+?)(?:\s+(\d+))?$/i);
  const bulktokenMatch = rawText.match(/^\/bulktoken\s+(.+?)\s+(\d+)(?:\s+(\d+))?$/i);
  const setshortidMatch = rawText.match(/^\/setshortid\s+#([a-f0-9]{6})\s+(\S+)$/i);
  const resendMatch = rawText.match(/^\/resend\s+(\S+)$/i);
  const tokenallMatch = rawText.match(/^\/tokenall\s+(\d+\s*(?:hari|minggu|bulan|tahun))(?:\s+(\d+))?$/i);
  const maketokenMatch = rawText.match(/^\/maketoken\s+(.+?)\s+(\d+\s*(?:hari|minggu|bulan|tahun))(?:\s+(\d+))?(?:\s+(.+))?$/i);
  const perpanjangMatch = rawText.match(/^\/perpanjang\s+(\S+)\s+(\d+\s*(?:hari|minggu|bulan|tahun))$/i);

  if (isHelp) {
    await handleHelpCommand(botToken, chatId);
  } else if (isShows) {
    await handleShowsCommand(supabase, botToken, chatId);
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
  } else if (isMembers) {
    await handleMembersCommand(supabase, botToken, chatId);
  } else if (msgmembersMatch) {
    await handleMsgMembersCommand(supabase, botToken, chatId, msgmembersMatch[1].trim());
  } else if (broadcastMatch) {
    await handleBroadcastCommand(supabase, botToken, chatId, broadcastMatch[1].trim());
  } else if (replayMatch) {
    await handleReplayToggle(supabase, botToken, chatId, `#${replayMatch[1]}`);
  } else if (isReplayList) {
    await handleReplayList(supabase, botToken, chatId);
  } else if (setactiveMatch) {
    await handleSetActiveCommand(supabase, botToken, chatId, `#${setactiveMatch[1]}`);
  } else if (setliveMatch) {
    await handleSetLiveCommand(supabase, botToken, chatId, setliveMatch[1] ? `#${setliveMatch[1]}` : null);
  } else if (isSetOffline) {
    await handleSetOfflineCommand(supabase, botToken, chatId);
  } else if (isShowInfo) {
    await handleShowInfoCommand(supabase, botToken, chatId);
  } else if (msgshowMatch) {
    await handleMsgShowCommand(supabase, botToken, chatId, msgshowMatch[1].trim(), msgshowMatch[2].trim());
  } else if (isTokensList) {
    await handleTokensListCommand(supabase, botToken, chatId);
  } else if (blocktokenMatch) {
    await handleTokenCommand(supabase, botToken, chatId, blocktokenMatch[1], 'block');
  } else if (unblocktokenMatch) {
    await handleTokenCommand(supabase, botToken, chatId, unblocktokenMatch[1], 'unblock');
  } else if (resettokenMatch) {
    await handleTokenCommand(supabase, botToken, chatId, resettokenMatch[1], 'reset');
  } else if (deletetokenMatch) {
    await handleTokenCommand(supabase, botToken, chatId, deletetokenMatch[1], 'delete');
  } else if (resetMatch) {
    await handlePasswordResetCommand(supabase, botToken, chatId, resetMatch[1].toLowerCase(), 'approve');
  } else if (tolakResetMatch) {
    await handlePasswordResetCommand(supabase, botToken, chatId, tolakResetMatch[1].toLowerCase(), 'reject');
  } else if (isStats) {
    await handleStatsCommand(supabase, botToken, chatId);
  } else if (cekuserMatch) {
    await handleCekUserCommand(supabase, botToken, chatId, cekuserMatch[1]);
  } else if (announceMatch) {
    await handleAnnounceCommand(supabase, botToken, chatId, announceMatch[1].trim());
  } else if (isShowList) {
    await handleShowListCommand(supabase, botToken, chatId);
  } else if (isPendapatan) {
    await handlePendapatanCommand(supabase, botToken, chatId);
  } else if (isOrderToday) {
    await handleOrderTodayCommand(supabase, botToken, chatId);
  } else if (isTopUsers) {
    await handleTopUsersCommand(supabase, botToken, chatId);
  } else if (setpriceMatch) {
    await handleSetPriceCommand(supabase, botToken, chatId, `#${setpriceMatch[1]}`, setpriceMatch[2].toLowerCase() as 'coin' | 'replay', parseInt(setpriceMatch[3], 10));
  } else if (banuserMatch) {
    await handleBanUserCommand(supabase, botToken, chatId, banuserMatch[1], banuserMatch[2]?.trim() || 'Diblokir oleh admin');
  } else if (unbanuserMatch) {
    await handleUnbanUserCommand(supabase, botToken, chatId, unbanuserMatch[1]);
  } else if (isBanlist) {
    await handleBanlistCommand(supabase, botToken, chatId);
  } else if (suspiciousMatch) {
    await handleSuspiciousCommand(supabase, botToken, chatId, suspiciousMatch[1] || null);
  } else if (createtokenMatch) {
    await handleCreateTokenCommand(supabase, botToken, chatId, createtokenMatch[1], createtokenMatch[2] ? parseInt(createtokenMatch[2], 10) : 1);
  } else if (givetokenMatch) {
    await handleGiveTokenCommand(supabase, botToken, chatId, givetokenMatch[1], givetokenMatch[2].trim(), givetokenMatch[3] ? parseInt(givetokenMatch[3], 10) : 1);
  } else if (bulktokenMatch) {
    await handleBulkTokenCommand(supabase, botToken, chatId, bulktokenMatch[1].trim(), parseInt(bulktokenMatch[2], 10), bulktokenMatch[3] ? parseInt(bulktokenMatch[3], 10) : 1);
  } else if (setshortidMatch) {
    await handleSetShortIdCommand(supabase, botToken, chatId, setshortidMatch[1], setshortidMatch[2]);
  } else if (resendMatch) {
    await handleResendCommand(supabase, botToken, chatId, resendMatch[1]);
  } else if (maketokenMatch) {
    await handleMakeTokenCommand(supabase, botToken, chatId, maketokenMatch[1].trim(), maketokenMatch[2].trim(), maketokenMatch[3] ? parseInt(maketokenMatch[3], 10) : 1, maketokenMatch[4]?.trim() || null);
  } else if (tokenallMatch) {
    await handleTokenAllCommand(supabase, botToken, chatId, tokenallMatch[1].trim(), tokenallMatch[2] ? parseInt(tokenallMatch[2], 10) : 1);
  } else if (perpanjangMatch) {
    await handlePerpanjangCommand(supabase, botToken, chatId, perpanjangMatch[1], perpanjangMatch[2].trim());
  } else if (yaMatch) {
    const ids = yaMatch[1].split(',').map((s: string) => s.trim().toLowerCase()).filter(Boolean);
    await processBulkOrders(supabase, botToken, chatId, ids, 'approve');
  } else if (tidakMatch) {
    const ids = tidakMatch[1].split(',').map((s: string) => s.trim().toLowerCase()).filter(Boolean);
    await processBulkOrders(supabase, botToken, chatId, ids, 'reject');
  }
}

// Helper: find show by short ID, custom short_id, hex prefix, or name
async function findShowByIdOrName(supabase: any, input: string, activeOnly = true): Promise<{ show: any | null; multiple: any[] | null; error: string | null }> {
  const cleanInput = input.replace(/^#/, '').trim();
  
  // First try matching by custom short_id
  const query0 = supabase.from('shows').select('id, title, is_replay, replay_coin_price, access_password, schedule_date, schedule_time, coin_price, is_active, category, short_id, is_bundle, bundle_duration_days, bundle_replay_passwords, bundle_replay_info');
  if (activeOnly) query0.eq('is_active', true);
  const { data: allShows } = await query0;
  
  const shortIdMatch = (allShows || []).find((s: any) => s.short_id && s.short_id.toLowerCase() === cleanInput.toLowerCase());
  if (shortIdMatch) return { show: shortIdMatch, multiple: null, error: null };
  
  // Try matching by UUID (full or partial)
  const hexOnly = cleanInput.replace(/-/g, '').toLowerCase();
  const isHexId = /^[a-f0-9]{6,32}$/i.test(hexOnly);
  
  if (isHexId) {
    // First try exact full UUID match
    const exactMatch = (allShows || []).find((s: any) => s.id.replace(/-/g, '').toLowerCase() === hexOnly);
    if (exactMatch) return { show: exactMatch, multiple: null, error: null };
    
    // Then try prefix match (6+ chars)
    if (hexOnly.length >= 6) {
      const prefixMatches = (allShows || []).filter((s: any) => s.id.replace(/-/g, '').toLowerCase().startsWith(hexOnly));
      if (prefixMatches.length === 1) return { show: prefixMatches[0], multiple: null, error: null };
      if (prefixMatches.length > 1) return { show: null, multiple: prefixMatches, error: null };
    }
    
    return { show: null, multiple: null, error: `Show dengan ID #${hexOnly.slice(0, 6)} tidak ditemukan.` };
  }
  
  // Search by name
  const nameMatches = (allShows || []).filter((s: any) => s.title.toLowerCase().includes(cleanInput.toLowerCase()));
  if (nameMatches.length === 0) return { show: null, multiple: null, error: `Show "${cleanInput}" tidak ditemukan.` };
  if (nameMatches.length === 1) return { show: nameMatches[0], multiple: null, error: null };
  return { show: null, multiple: nameMatches, error: null };
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
    `\`/users\` \\- Daftar semua user\n` +
    `\`/members\` \\- Daftar member langganan\n\n` +
    `🎬 *Show Management:*\n` +
    `\`/shows\` \\- Lihat semua show aktif \\+ ID\n` +
    `\`/replay\` \\- Lihat daftar show replay\n` +
    `\`/replay #ID\` \\- Toggle replay by ID\n` +
    `\`/setactive #ID\` \\- Set show aktif by ID\n\n` +
    `📡 *Live Stream:*\n` +
    `\`/showinfo\` \\- Info stream \\& show aktif saat ini\n` +
    `\`/setlive\` \\- Set stream jadi LIVE\n` +
    `\`/setlive #ID\` \\- Set LIVE \\+ pilih show aktif\n` +
    `\`/setoffline\` \\- Set semua stream jadi OFFLINE\n\n` +
    `🔑 *Token Management:*\n` +
    `\`/tokens\` \\- Lihat daftar token \\+ 4 digit\n` +
    `\`/blocktoken <4digit>\` \\- Blokir token \\(4 digit belakang\\)\n` +
    `\`/unblocktoken <4digit>\` \\- Buka blokir token\n` +
    `\`/resettoken <4digit>\` \\- Reset sesi token\n` +
    `\`/deletetoken <4digit>\` \\- Hapus token\n` +
    `\`/createtoken #ID\` \\- Buat token untuk show \\(1 device\\)\n` +
    `\`/createtoken #ID <max>\` \\- Buat token \\+ max device\n` +
    `\`/createtoken show1,show2 <max>\` \\- Multi\\-show token\n` +
    `\`/bulktoken <show> <jumlah>\` \\- Buat banyak token sekaligus\n` +
    `\`/bulktoken <show> <jumlah> <max>\` \\- Bulk token \\+ max device\n` +
    `\`/givetoken <user> <show>\` \\- Beri token ke user\n` +
    `\`/givetoken <user> <show> <max>\` \\- Beri token \\+ max device\n\n` +
    `🔐 *Password Reset:*\n` +
    `\`RESET <id>\` \\- Setujui reset password\n` +
    `\`TOLAK\\_RESET <id>\` \\- Tolak reset password\n\n` +
    `📨 *Messaging:*\n` +
    `\`/msgshow <nama/ID> | <pesan>\` \\- Kirim WA ke pemesan show\n` +
    `\`/msgmembers <pesan>\` \\- Kirim WA ke semua member\n` +
    `\`/resend <order\\_id>\` \\- Kirim ulang token \\& info replay ke pembeli\n\n` +
    `📢 *Lainnya:*\n` +
    `\`/broadcast <pesan>\` \\- Kirim notifikasi ke semua user\n` +
    `\`/setshortid #ID <nama>\` \\- Set custom ID untuk show\n` +
    `\`/help\` \\- Tampilkan daftar command ini\n\n` +
    `📊 *Statistik & Analitik:*\n` +
    `\`/stats\` \\- Statistik lengkap platform\n` +
    `\`/cekuser <username>\` \\- Detail info user\n` +
    `\`/showlist\` \\- Daftar semua show \\+ status\n` +
    `\`/pendapatan\` \\- Ringkasan pendapatan\n` +
    `\`/ordertoday\` \\- Order hari ini\n` +
    `\`/topusers\` \\- Top user berdasarkan saldo\n` +
    `\`/announce <pesan>\` \\- Kirim WA ke semua user\n` +
    `\`/setprice #ID coin <harga>\` \\- Set harga koin show\n` +
    `\`/setprice #ID replay <harga>\` \\- Set harga replay show\n\n` +
    `🎫 *Token Custom:*\n` +
    `\`/maketoken <show> <durasi>\` \\- Token durasi custom \\(1 device\\)\n` +
    `\`/maketoken <show> <durasi> <max>\` \\- Token durasi \\+ max device\n` +
    `\`/maketoken <show> <durasi> <max> <sandi>\` \\- Token \\+ sandi replay\n` +
    `\`/tokenall <durasi>\` \\- Token ALL show \\(1 device\\)\n` +
    `\`/tokenall <durasi> <max>\` \\- Token ALL show \\+ max device\n` +
    `\`/perpanjang <4digit> <durasi>\` \\- Perpanjang durasi token\n` +
    `  Durasi: 30hari, 1minggu, 2bulan, 1tahun\n\n` +
    `💡 _Gunakan \\#ID \\(6 digit hex\\) atau custom ID untuk show, 4 digit belakang untuk token\\._`;
  await sendTelegramMessage(botToken, chatId, msg);
}

async function handleShowsCommand(supabase: any, botToken: string, chatId: string) {
  try {
    const { data: shows } = await supabase
      .from('shows')
      .select('id, title, schedule_date, schedule_time, is_replay, is_active, coin_price, replay_coin_price, short_id')
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(30);

    if (!shows || shows.length === 0) {
      await sendTelegramMessage(botToken, chatId, '🎬 Tidak ada show aktif\\.');
      return;
    }

    let message = `🎬 *DAFTAR SHOW AKTIF \\(${shows.length}\\)*\n\n`;
    for (const s of shows) {
      const sid = s.short_id || showShortId(s.id);
      const replay = s.is_replay ? ' 🔁 REPLAY' : '';
      const schedule = s.schedule_date ? `📅 ${escapeMarkdown(s.schedule_date)} ${escapeMarkdown(s.schedule_time || '')}` : '📅 \\-';
      message += `\`${s.short_id ? s.short_id : '#' + showShortId(s.id)}\` *${escapeMarkdown(s.title)}*${replay}\n   ${schedule} \\| 🪙 ${s.coin_price}/${s.replay_coin_price}\n\n`;
    }
    message += `💡 Gunakan ID untuk aksi:\n\`/setlive #ID\` \\| \`/replay #ID\` \\| \`/setactive #ID\``;
    await sendTelegramMessage(botToken, chatId, message);
  } catch (e) {
    await sendTelegramMessage(botToken, chatId, `⚠️ Error: ${e instanceof Error ? escapeMarkdown(e.message) : 'Unknown'}`);
  }
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
  const normalizedId = shortId.trim().toLowerCase();
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalizedId);

  let coinQuery = supabase.from('coin_orders').select('id, user_id, coin_amount, status, package_id, phone, short_id').eq('status', 'pending');
  coinQuery = isUuid ? coinQuery.eq('id', normalizedId) : coinQuery.eq('short_id', normalizedId);
  const { data: coinOrder } = await coinQuery.maybeSingle();
  if (coinOrder) { await processCoinOrder(supabase, botToken, chatId, coinOrder, action, shortId.length <= 5); return `${action === 'approve' ? '✅' : '❌'} ${escapeMarkdown(shortId)} \\(koin\\)`; }

  let subQuery = supabase.from('subscription_orders').select('id, show_id, phone, email, status, short_id').eq('status', 'pending');
  subQuery = isUuid ? subQuery.eq('id', normalizedId) : subQuery.eq('short_id', normalizedId);
  const { data: subOrder } = await subQuery.maybeSingle();
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

async function processCoinOrder(supabase: any, botToken: string, chatId: string, order: any, action: 'approve' | 'reject', isBulk: boolean): Promise<{ success: boolean; message: string }> {
  try {
    const sid = order.short_id || order.id.substring(0, 6);
    console.log(`processCoinOrder: ${action} order ${sid}, isBulk=${isBulk}`);
    if (action === 'approve') {
      // Use atomic RPC to prevent double-credit race conditions
      const { data: rpcResult, error: rpcError } = await supabase.rpc('confirm_coin_order', { _order_id: order.id });
      console.log('confirm_coin_order RPC result:', JSON.stringify(rpcResult), 'error:', rpcError?.message);
      const parsedRpcResult = typeof rpcResult === 'string'
        ? (() => { try { return JSON.parse(rpcResult); } catch { return null; } })()
        : rpcResult;

      if (rpcError || !parsedRpcResult?.success) {
        const errMsg = parsedRpcResult?.error || rpcError?.message || 'Gagal konfirmasi';
        const msg = `⚠️ Order koin \`${escapeMarkdown(sid)}\`: ${escapeMarkdown(errMsg)}`;
        if (!isBulk) await sendTelegramMessage(botToken, chatId, msg);
        return { success: false, message: errMsg };
      }

      const { data: profile } = await supabase.from('profiles').select('username').eq('id', order.user_id).single();
      const newBalance = parsedRpcResult.new_balance ?? order.coin_amount;

      if (order.phone) {
        const waMsg = `✅ Pembayaran kamu untuk *${order.coin_amount} koin* telah dikonfirmasi!\n\n💰 Saldo saat ini: ${newBalance} koin.\n\nTerima kasih! 🎉`;
        await sendFonnteWhatsApp(order.phone, waMsg);
      }

      const successMsg = `✅ Order koin \`${escapeMarkdown(sid)}\` berhasil dikonfirmasi\\!\n👤 ${escapeMarkdown(profile?.username || 'User')}\n💰 \\+${order.coin_amount} koin\n🏦 Saldo: ${newBalance}`;
      if (!isBulk) await sendTelegramMessage(botToken, chatId, successMsg);
      return { success: true, message: `✅ Order koin ${sid} berhasil dikonfirmasi! +${order.coin_amount} koin, saldo: ${newBalance}` };
    } else {
      await supabase.from('coin_orders').update({ status: 'rejected' }).eq('id', order.id).eq('status', 'pending');
      if (order.phone) await sendFonnteWhatsApp(order.phone, '❌ Maaf, pembayaran kamu untuk pembelian koin tidak dapat dikonfirmasi.\n\nSilakan hubungi admin jika ada pertanyaan.');
      if (!isBulk) await sendTelegramMessage(botToken, chatId, `❌ Order koin \`${escapeMarkdown(sid)}\` telah ditolak\\.`);
      return { success: true, message: `❌ Order koin ${sid} ditolak.` };
    }
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : 'Unknown';
    console.error('processCoinOrder error:', errMsg);
    await sendTelegramMessage(botToken, chatId, `⚠️ Error: ${escapeMarkdown(errMsg)}`);
    return { success: false, message: errMsg };
  }
}

async function processSubscriptionOrder(supabase: any, botToken: string, chatId: string, order: any, action: 'approve' | 'reject', isBulk: boolean): Promise<{ success: boolean; message: string }> {
  try {
    const sid = order.short_id || order.id.substring(0, 6);
    const { data: show } = await supabase.from('shows').select('title, group_link, is_subscription, access_password, is_bundle, bundle_duration_days, bundle_replay_passwords, bundle_replay_info, schedule_date, schedule_time').eq('id', order.show_id).single();
    const showTitle = show?.title || 'Unknown Show';

    if (action === 'approve') {
      // Use correct RPC based on show type
      const confirmFn = show?.is_subscription ? 'confirm_membership_order' : 'confirm_regular_order';
      const { data: rpcResult, error: rpcError } = await supabase.rpc(confirmFn, { _order_id: order.id });
      const result = typeof rpcResult === 'string' ? (() => { try { return JSON.parse(rpcResult); } catch { return null; } })() : rpcResult;

      if (rpcError || !result?.success) {
        const errMsg = result?.error || rpcError?.message || 'Gagal konfirmasi';
        if (!isBulk) await sendTelegramMessage(botToken, chatId, `⚠️ Order \`${escapeMarkdown(sid)}\`: ${escapeMarkdown(errMsg)}`);
        return { success: false, message: errMsg };
      }

      // Send WhatsApp notification to user
      if (order.phone) {
        const siteUrl = 'https://realtime48stream.my.id';
        if (result.type === 'regular' && result.token_code) {
          const liveLink = `${siteUrl}/live?t=${result.token_code}`;

          if (show?.is_bundle) {
            // Bundle show confirmation
            const bundleDays = show.bundle_duration_days || 30;
            let waMsg = `━━━━━━━━━━━━━━━━━━\n📦 *Pembelian Bundle Berhasil!*\n━━━━━━━━━━━━━━━━━━\n\n🎭 Paket: *${showTitle}*\n⏰ Durasi Token: *${bundleDays} hari*\n`;
            waMsg += `\n🎫 *Token Akses:* ${result.token_code}\n📺 *Link Nonton:*\n${liveLink}\n`;
            if (show.schedule_date) {
              waMsg += `📅 *Jadwal:* ${show.schedule_date} ${show.schedule_time || ''}\n`;
            }
            const bundlePasswords = Array.isArray(show.bundle_replay_passwords) ? show.bundle_replay_passwords : [];
            if (bundlePasswords.length > 0) {
              waMsg += `\n📦 *Sandi Replay Bundle:*\n`;
              for (const entry of bundlePasswords) {
                if (entry.show_name && entry.password) {
                  waMsg += `  🎭 ${entry.show_name}: *${entry.password}*\n`;
                }
              }
            }
            if (show.bundle_replay_info) {
              waMsg += `\n🎬 *Info Replay:*\n🔗 ${show.bundle_replay_info}\n`;
            } else {
              waMsg += `\n🎬 *Link Replay:*\n🔗 https://replaytime.lovable.app\n`;
            }
            if (show.access_password) {
              waMsg += `🔑 Sandi Akses: *${show.access_password}*\n`;
            }
            waMsg += `\n⚠️ _Jangan bagikan token/link ini ke orang lain._\n━━━━━━━━━━━━━━━━━━\n_Terima kasih telah membeli!_ 🙏`;
            await sendFonnteWhatsApp(order.phone, waMsg);
          } else {
            // Regular show: send live link + token + replay info
            let waMsg = `✅ *Pesanan Dikonfirmasi!*\n\n🎭 Show: *${showTitle}*\n🎫 Token: ${result.token_code}\n📺 Link Nonton: ${liveLink}\n`;
            if (show?.access_password) {
              waMsg += `\n🔄 *Akses Replay:*\n🔗 Link Replay: https://replaytime.lovable.app\n🔑 Sandi: ${show.access_password}\n`;
            }
            waMsg += `\n⚠️ Token hanya berlaku untuk *1 perangkat*. Jangan bagikan link ini.\n\nTerima kasih! 🎉`;
            await sendFonnteWhatsApp(order.phone, waMsg);
          }
        } else if (result.type === 'subscription') {
          // Membership: send group link
          let waMsg = `✅ *Membership Dikonfirmasi!*\n\n🎭 Show: *${showTitle}*\n`;
          if (show?.group_link) waMsg += `🔗 Link Grup: ${show.group_link}\n`;
          waMsg += `\nTerima kasih telah berlangganan! 🎉`;
          await sendFonnteWhatsApp(order.phone, waMsg);
        }
      }

      const tokenInfo = result.token_code ? ` Token: \`${escapeMarkdown(result.token_code)}\`` : '';
      if (!isBulk) await sendTelegramMessage(botToken, chatId, `✅ Order \`${escapeMarkdown(sid)}\` untuk "${escapeMarkdown(showTitle)}" dikonfirmasi\\!${tokenInfo}`);
      return { success: true, message: `✅ Order ${sid} untuk "${showTitle}" dikonfirmasi!${result.token_code ? ` Token: ${result.token_code}` : ''}` };
    } else {
      await supabase.from('subscription_orders').update({ status: 'rejected' }).eq('id', order.id).eq('status', 'pending');
      if (order.phone) {
        await sendFonnteWhatsApp(order.phone, `❌ Maaf, pesanan kamu untuk *${showTitle}* tidak dapat dikonfirmasi.\n\nSilakan hubungi admin jika ada pertanyaan.`);
      }
      if (!isBulk) await sendTelegramMessage(botToken, chatId, `❌ Order \`${escapeMarkdown(sid)}\` untuk "${escapeMarkdown(showTitle)}" ditolak\\.`);
      return { success: true, message: `❌ Order ${sid} ditolak.` };
    }
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : 'Unknown';
    await sendTelegramMessage(botToken, chatId, `⚠️ Error: ${escapeMarkdown(errMsg)}`);
    return { success: false, message: errMsg };
  }
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
      const sid = showShortId(s.id);
      message += `${status} *${escapeMarkdown(s.title)}* \\(\`#${sid}\`\\)\n   📅 ${escapeMarkdown(s.schedule_date || '-')} \\| 🪙 ${s.replay_coin_price} koin \\| ${pw}\n\n`;
    }
    message += `💡 Toggle replay: \`/replay <nama>\` atau \`/replay #ID\``;
    await sendTelegramMessage(botToken, chatId, message);
  } catch (e) {
    await sendTelegramMessage(botToken, chatId, `⚠️ Error: ${e instanceof Error ? escapeMarkdown(e.message) : 'Unknown'}`);
  }
}

async function handleReplayToggle(supabase: any, botToken: string, chatId: string, showName: string) {
  try {
    const result = await findShowByIdOrName(supabase, showName);
    if (result.error) {
      await sendTelegramMessage(botToken, chatId, `⚠️ ${escapeMarkdown(result.error)}`);
      return;
    }
    if (result.multiple) {
      let msg = `⚠️ Ditemukan ${result.multiple.length} show:\n\n`;
      for (const s of result.multiple) {
        const status = s.is_replay ? '🟢 ON' : '🔴 OFF';
        const sid = showShortId(s.id);
        msg += `${status} ${escapeMarkdown(s.title)} \\(\`#${sid}\`\\)\n`;
      }
      msg += `\n💡 Gunakan ID: \`/replay #${showShortId(result.multiple[0].id)}\``;
      await sendTelegramMessage(botToken, chatId, msg);
      return;
    }

    const show = result.show;
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
    let { data: stream } = await supabase.from('streams').select('id, title').eq('is_active', true).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (!stream) {
      const { data: newStream } = await supabase.from('streams').insert({ title: 'RealTime48', type: 'youtube', url: '', is_active: true, is_live: false }).select().single();
      stream = newStream;
    }
    if (!stream) { await sendTelegramMessage(botToken, chatId, '⚠️ Gagal membuat stream\\.'); return; }

    await supabase.from('streams').update({ is_live: true }).eq('id', stream.id);

    // If title provided, try to set active show by ID or name
    let showInfo = '';
    if (title) {
      const result = await findShowByIdOrName(supabase, title);
      if (result.show) {
        if (result.show.is_bundle) {
          await sendTelegramMessage(botToken, chatId, `⚠️ Bundle show tidak bisa dijadikan show aktif\\.`);
          return;
        }
        await supabase.from('site_settings').upsert({ key: 'active_show_id', value: result.show.id }, { onConflict: 'key' });
        showInfo = `\n🎭 Show aktif: *${escapeMarkdown(result.show.title)}* \\(\`#${showShortId(result.show.id)}\`\\)`;
      } else if (result.multiple) {
        let msg = `🟢 Stream LIVE\\! Tapi ada ${result.multiple.length} show ditemukan:\n\n`;
        for (const s of result.multiple) msg += `• ${escapeMarkdown(s.title)} \\(\`#${showShortId(s.id)}\`\\)\n`;
        msg += `\n💡 Gunakan: \`/setactive #ID\``;
        await sendTelegramMessage(botToken, chatId, msg);
        return;
      }
    } else {
      const { data: settings } = await supabase.from('site_settings').select('value').eq('key', 'active_show_id').maybeSingle();
      if (settings?.value) {
        const { data: show } = await supabase.from('shows').select('title').eq('id', settings.value).maybeSingle();
        if (show) showInfo = `\n🎭 Show aktif: *${escapeMarkdown(show.title)}*`;
      }
    }

    await sendTelegramMessage(botToken, chatId, `🟢 *Stream LIVE\\!*\n\n📡 ${escapeMarkdown(stream.title)} sekarang LIVE\\!${showInfo}`);
  } catch (e) { await sendTelegramMessage(botToken, chatId, `⚠️ Error: ${e instanceof Error ? escapeMarkdown(e.message) : 'Unknown'}`); }
}

async function handleSetActiveCommand(supabase: any, botToken: string, chatId: string, input: string) {
  try {
    const result = await findShowByIdOrName(supabase, input);
    if (result.error) {
      await sendTelegramMessage(botToken, chatId, `⚠️ ${escapeMarkdown(result.error)}`);
      return;
    }
    if (result.multiple) {
      let msg = `⚠️ Ditemukan ${result.multiple.length} show:\n\n`;
      for (const s of result.multiple) msg += `• ${escapeMarkdown(s.title)} \\(\`#${showShortId(s.id)}\`\\)\n`;
      msg += `\n💡 Gunakan ID: \`/setactive #${showShortId(result.multiple[0].id)}\``;
      await sendTelegramMessage(botToken, chatId, msg);
      return;
    }
    const show = result.show;
    if (show.is_bundle) {
      await sendTelegramMessage(botToken, chatId, `⚠️ Bundle show tidak bisa dijadikan show aktif\\.`);
      return;
    }
    await supabase.from('site_settings').upsert({ key: 'active_show_id', value: show.id }, { onConflict: 'key' });
    await sendTelegramMessage(botToken, chatId, `✅ *Show Aktif Diubah\\!*\n\n🎭 ${escapeMarkdown(show.title)} \\(\`#${showShortId(show.id)}\`\\)\n📅 ${escapeMarkdown(show.schedule_date || '-')}`);
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
    const result = await findShowByIdOrName(supabase, showName);
    if (result.error) {
      await sendTelegramMessage(botToken, chatId, `⚠️ ${escapeMarkdown(result.error)}`);
      return;
    }
    if (result.multiple) {
      let msg = `⚠️ Ditemukan ${result.multiple.length} show:\n\n`;
      for (const s of result.multiple) msg += `• ${escapeMarkdown(s.title)} \\(\`#${showShortId(s.id)}\`\\)\n`;
      msg += `\n💡 Gunakan ID: \`/msgshow #${showShortId(result.multiple[0].id)} | pesan\``;
      await sendTelegramMessage(botToken, chatId, msg);
      return;
    }

    const show = result.show;
    const phones = await collectShowBuyerPhones(supabase, show.id);

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

    const summaryMessage = `✅ *Pesan Terkirim\\!*\n\n🎬 Show: ${escapeMarkdown(show.title)}\n📨 Terkirim: ${sent} nomor${failed > 0 ? `\n⚠️ Gagal: ${failed}` : ''}\n\n📝 Pesan: ${escapeMarkdown(message)}`;
    await sendTelegramMessage(botToken, chatId, summaryMessage);
  } catch (e) {
    await sendTelegramMessage(botToken, chatId, `⚠️ Error: ${e instanceof Error ? escapeMarkdown(e.message) : 'Unknown'}`);
  }
}

async function handlePasswordResetCommand(supabase: any, botToken: string, chatId: string, shortId: string, action: 'approve' | 'reject') {
  try {
    const { data: request } = await supabase.from('password_reset_requests').select('id, user_id, identifier, phone, short_id, secure_token').eq('short_id', shortId).eq('status', 'pending').maybeSingle();
    if (!request) { await sendTelegramMessage(botToken, chatId, `⚠️ Request reset ${escapeMarkdown(shortId)} tidak ditemukan\\.`); return; }
    if (action === 'approve') {
      await supabase.from('password_reset_requests').update({ status: 'approved', processed_at: new Date().toISOString() }).eq('id', request.id);
      const FONNTE_TOKEN = Deno.env.get('FONNTE_API_TOKEN');
      if (FONNTE_TOKEN && request.phone) {
        const resetLink = `https://realtime48stream.my.id/reset-password?token=${request.secure_token || request.short_id}`;
        await sendFonnteWhatsApp(request.phone, `🔑 *Reset Password Disetujui*\n\nKlik link berikut untuk membuat password baru:\n${resetLink}\n\n⏰ Link berlaku 2 jam.`);
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

  // 4. Collect all unique user_ids from both sources
  const allUserIds = new Set<string>();
  for (const o of (subOrders || [])) { if (o.user_id) allUserIds.add(o.user_id); }
  for (const uid of coinUserIds) { allUserIds.add(uid); }

  // 5. Extract phone from login email (format: <phone>@rt48.user)
  if (allUserIds.size > 0) {
    const { data: profiles } = await supabase
      .from('profiles').select('id')
      .in('id', [...allUserIds]);
    // We can't query auth.users directly, but the email pattern is <phone>@rt48.user
    // The phone is already captured from orders above. For users without order phone,
    // try to get from their coin_orders or subscription_orders
    const userIdsWithoutPhone = [...allUserIds].filter(uid => {
      const hasPhone = (subOrders || []).some((o: any) => o.user_id === uid && o.phone) ||
                       (coinUserIds.includes(uid));
      return !hasPhone;
    });
    if (userIdsWithoutPhone.length > 0) {
      // Try coin_orders for these users
      const { data: extraOrders } = await supabase
        .from('coin_orders').select('phone')
        .in('user_id', userIdsWithoutPhone)
        .neq('phone', '').not('phone', 'is', null).limit(100);
      for (const o of (extraOrders || [])) {
        if (o.phone) phones.add(o.phone);
      }
    }
  }

  return [...phones].filter(Boolean);
}

async function sendFonnteWhatsApp(phone: string, message: string) {
  const FONNTE_TOKEN = Deno.env.get('FONNTE_API_TOKEN');
  if (!FONNTE_TOKEN) return;
  let cleanPhone = phone.replace(/[^0-9]/g, '');
  if (cleanPhone.startsWith('0')) cleanPhone = '62' + cleanPhone.slice(1);
  if (!cleanPhone.startsWith('62')) cleanPhone = '62' + cleanPhone;
  if (!cleanPhone || cleanPhone.length < 10) return;
  try {
    const res = await fetch('https://api.fonnte.com/send', {
      method: 'POST', headers: { Authorization: FONNTE_TOKEN },
      body: new URLSearchParams({ target: cleanPhone, message }),
    });
    const resText = await res.text();
    console.log('Fonnte WA send result:', resText);
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

async function processCallbackQuery(supabase: any, botToken: string, chatId: string, cb: any) {
  const data = cb.data as string;
  const messageId = cb.message?.message_id;
  const targetChatId = cb.message?.chat?.id ?? chatId;

  try {
    console.log('Callback received:', data, 'from chat:', targetChatId, 'messageId:', messageId);
    // Parse callback: approve_coin_<shortId>, reject_coin_<shortId>, approve_sub_<shortId>, reject_sub_<shortId>
    const match = data.match(/^(approve|reject)_(coin|sub)_(.+)$/);
    if (!match) {
      console.warn('Callback data did not match pattern:', data);
      return;
    }

    const [, actionStr, orderType, rawOrderId] = match;
    const action = actionStr === 'approve' ? 'approve' : 'reject';
    const orderId = rawOrderId.trim().toLowerCase();
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(orderId);

    let resultText = '';

    if (orderType === 'coin') {
      let coinQuery = supabase.from('coin_orders').select('id, user_id, coin_amount, status, package_id, phone, short_id');
      coinQuery = isUuid ? coinQuery.eq('id', orderId) : coinQuery.eq('short_id', orderId);
      const { data: coinOrder, error: coinErr } = await coinQuery.maybeSingle();
      console.log('Coin order lookup:', orderId, 'found:', !!coinOrder, 'status:', coinOrder?.status, 'error:', coinErr?.message);
      if (!coinOrder) {
        resultText = `⚠️ Order koin ${orderId} tidak ditemukan.`;
      } else if (coinOrder.status !== 'pending') {
        resultText = `⚠️ Order koin ${orderId} sudah diproses (${coinOrder.status}).`;
      } else {
        const result = await processCoinOrder(supabase, botToken, chatId, coinOrder, action, true);
        console.log('processCoinOrder result:', JSON.stringify(result));
        resultText = result.success
          ? result.message
          : `⚠️ Gagal: ${result.message}`;
      }
    } else {
      let subQuery = supabase.from('subscription_orders').select('id, show_id, phone, email, status, short_id');
      subQuery = isUuid ? subQuery.eq('id', orderId) : subQuery.eq('short_id', orderId);
      const { data: subOrder, error: subErr } = await subQuery.maybeSingle();
      console.log('Sub order lookup:', orderId, 'found:', !!subOrder, 'status:', subOrder?.status, 'error:', subErr?.message);
      if (!subOrder) {
        resultText = `⚠️ Order subscription ${orderId} tidak ditemukan.`;
      } else if (subOrder.status !== 'pending') {
        resultText = `⚠️ Order subscription ${orderId} sudah diproses (${subOrder.status}).`;
      } else {
        const result = await processSubscriptionOrder(supabase, botToken, chatId, subOrder, action, true);
        resultText = result.success
          ? result.message
          : `⚠️ Gagal: ${result.message}`;
      }
    }

    console.log('Callback resultText:', resultText);

    // Always send a separate response message first (guaranteed delivery)
    try {
      await sendTelegramMessage(botToken, targetChatId, escapeMarkdown(resultText));
    } catch (sendErr) {
      console.error('Failed to send callback result message:', sendErr);
    }

    // Then try to edit the original message to remove buttons (best effort)
    if (messageId) {
      try {
        if (cb.message?.photo) {
          const originalCaption = cb.message?.caption || '';
          await fetch(`${TELEGRAM_API}${botToken}/editMessageCaption`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: targetChatId, message_id: messageId, caption: originalCaption + `\n\n${resultText}`, reply_markup: { inline_keyboard: [] } }),
          });
        } else {
          const originalText = cb.message?.text || '';
          await fetch(`${TELEGRAM_API}${botToken}/editMessageText`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: targetChatId, message_id: messageId, text: originalText + `\n\n${resultText}`, reply_markup: { inline_keyboard: [] } }),
          });
        }
      } catch (editErr) {
        console.warn('Failed to edit original message (non-critical):', editErr);
      }
    }

    // Cross-notify WhatsApp
    await notifyWhatsAppAdmins(supabase, `${action === 'approve' ? 'YA' : 'TIDAK'} ${orderId} (via tombol)`);
  } catch (e) {
    console.error('processCallbackQuery error:', e);
    try {
      await sendTelegramMessage(botToken, chatId, `⚠️ Error callback: ${e instanceof Error ? escapeMarkdown(e.message) : 'Unknown'}`);
    } catch (sendErr) {
      console.error('Failed to send error message:', sendErr);
    }
  }
}


async function sendTelegramMessage(botToken: string, chatId: string | number, text: string) {
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
  const { data, error } = await supabase
    .from('telegram_bot_state')
    .update({ updated_at: nowIso })
    .eq('id', 1)
    .lt('updated_at', staleBeforeIso)
    .select('update_offset')
    .maybeSingle();

  if (error) {
    if (!isTimeoutLikeError(error)) {
      console.error('acquireLock non-timeout error:', error);
    }
    return { acquired: false, update_offset: 0 };
  }

  if (!data) return { acquired: false, update_offset: 0 };
  return { acquired: true, update_offset: Number(data.update_offset ?? 0) };
}

async function touchState(supabase: any) {
  try {
    await supabase.from('telegram_bot_state').update({ updated_at: new Date().toISOString() }).eq('id', 1);
  } catch {}
}

async function releaseLock(supabase: any) {
  try {
    await supabase.from('telegram_bot_state').update({ updated_at: new Date(0).toISOString() }).eq('id', 1);
  } catch {}
}

function isTimeoutLikeError(error: any): boolean {
  const code = String(error?.code ?? error?.status ?? '').toUpperCase();
  const message = String(error?.message ?? error ?? '').toLowerCase();
  return code === '504' || message.includes('timeout') || message.includes('deadline exceeded') || message.includes('upstream request timeout');
}

function sleep(ms: number): Promise<void> { return new Promise(resolve => setTimeout(resolve, ms)); }

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

async function handleMembersCommand(supabase: any, botToken: string, chatId: string) {
  try {
    const { data: orders } = await supabase
      .from('subscription_orders')
      .select('phone, email, show_id, created_at')
      .eq('status', 'confirmed')
      .order('created_at', { ascending: false });

    if (!orders || orders.length === 0) {
      await sendTelegramMessage(botToken, chatId, '👥 Belum ada member langganan\\.');
      return;
    }

    const { data: shows } = await supabase.from('shows').select('id, title').eq('is_subscription', true);
    const showMap: Record<string, string> = {};
    (shows || []).forEach((s: any) => { showMap[s.id] = s.title; });

    const grouped: Record<string, any[]> = {};
    for (const o of orders) {
      const title = showMap[o.show_id] || 'Unknown';
      if (!grouped[title]) grouped[title] = [];
      grouped[title].push(o);
    }

    let msg = `👥 *DAFTAR MEMBER LANGGANAN \\(${orders.length}\\)*\n\n`;
    for (const [title, members] of Object.entries(grouped)) {
      msg += `🎬 *${escapeMarkdown(title)}* \\(${members.length}\\)\n`;
      for (const m of members) {
        msg += `  📞 ${escapeMarkdown(m.phone || '-')} \\| 📧 ${escapeMarkdown(m.email || '-')}\n`;
      }
      msg += '\n';
    }
    msg += `💡 Kirim pesan massal: \`/msgmembers <pesan>\``;
    await sendTelegramMessage(botToken, chatId, msg);
  } catch (e) {
    await sendTelegramMessage(botToken, chatId, `⚠️ Error: ${e instanceof Error ? escapeMarkdown(e.message) : 'Unknown'}`);
  }
}

async function handleMsgMembersCommand(supabase: any, botToken: string, chatId: string, message: string) {
  try {
    const { data: orders } = await supabase
      .from('subscription_orders')
      .select('phone')
      .eq('status', 'confirmed');

    if (!orders || orders.length === 0) {
      await sendTelegramMessage(botToken, chatId, '⚠️ Tidak ada member untuk dikirimi pesan\\.');
      return;
    }

    const phones = [...new Set(orders.map((o: any) => o.phone).filter(Boolean))];
    if (phones.length === 0) {
      await sendTelegramMessage(botToken, chatId, '⚠️ Tidak ada nomor HP member yang tersedia\\.');
      return;
    }

    let sent = 0;
    for (const phone of phones) {
      await sendFonnteWhatsApp(phone, message);
      sent++;
    }

    await sendTelegramMessage(botToken, chatId, `✅ Pesan berhasil dikirim ke ${sent} member\\!`);
  } catch (e) {
    await sendTelegramMessage(botToken, chatId, `⚠️ Error: ${e instanceof Error ? escapeMarkdown(e.message) : 'Unknown'}`);
  }
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
      const { data: show } = await supabase.from('shows').select('id, title, schedule_date, schedule_time, is_replay').eq('id', settingsMap.active_show_id).maybeSingle();
      if (show) {
        msg += `🎭 Show aktif: *${escapeMarkdown(show.title)}* \\(\`#${showShortId(show.id)}\`\\)\n`;
        if (show.schedule_date) msg += `📅 Jadwal: ${escapeMarkdown(show.schedule_date)} ${escapeMarkdown(show.schedule_time || '')}\n`;
        if (show.is_replay) msg += `🔁 Mode: Replay\n`;
      }
    } else {
      msg += '🎭 Show aktif: _Belum dipilih_\n';
      msg += `💡 Set show: \`/setactive #ID\`\n`;
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

async function findTokenByInputTg(supabase: any, input: string): Promise<{ token: any | null; error: string | null; multiple: any[] | null }> {
  const { data: exact } = await supabase.from('tokens').select('id, code, status').eq('code', input).maybeSingle();
  if (exact) return { token: exact, error: null, multiple: null };

  const suffix = input.toLowerCase();
  const { data: all } = await supabase.from('tokens').select('id, code, status').in('status', ['active', 'blocked']).order('created_at', { ascending: false }).limit(500);
  if (!all) return { token: null, error: 'Gagal mencari token.', multiple: null };

  const matches = all.filter((t: any) => t.code.toLowerCase().endsWith(suffix));
  if (matches.length === 0) return { token: null, error: `Token dengan akhiran "${input}" tidak ditemukan.`, multiple: null };
  if (matches.length === 1) return { token: matches[0], error: null, multiple: null };
  return { token: null, error: null, multiple: matches };
}

async function handleTokensListCommand(supabase: any, botToken: string, chatId: string) {
  const { data: tokens } = await supabase.from('tokens').select('code, status, expires_at, duration_type').order('created_at', { ascending: false }).limit(30);
  if (!tokens || tokens.length === 0) { await sendTelegramMessage(botToken, chatId, '📋 Tidak ada token\\.'); return; }
  const now = new Date();
  const lines = tokens.map((t: any) => {
    const last4 = t.code.slice(-4);
    const expired = t.expires_at && new Date(t.expires_at) < now;
    const statusIcon = t.status === 'blocked' ? '🔴' : expired ? '🟡' : '🟢';
    return `${statusIcon} \\.\\.\\.${escapeMarkdown(last4)} \\[${escapeMarkdown(t.status)}\\] ${escapeMarkdown(t.duration_type || '')}`;
  });
  await sendTelegramMessage(botToken, chatId, `🔑 *Daftar Token \\(${tokens.length}\\):*\n${lines.join('\n')}\n\n💡 _Gunakan 4 digit belakang untuk aksi token\\._`);
}

async function handleTokenCommand(supabase: any, botToken: string, chatId: string, tokenInput: string, action: 'block' | 'unblock' | 'reset' | 'delete') {
  try {
    const { token, error, multiple } = await findTokenByInputTg(supabase, tokenInput);
    if (error) { await sendTelegramMessage(botToken, chatId, `⚠️ ${escapeMarkdown(error)}`); return; }
    if (multiple) {
      const list = multiple.map((t: any) => `• \`${escapeMarkdown(t.code)}\` \\[${escapeMarkdown(t.status)}\\]`).join('\n');
      await sendTelegramMessage(botToken, chatId, `⚠️ Ditemukan ${multiple.length} token dengan akhiran "${escapeMarkdown(tokenInput)}":\n${list}\n\nGunakan kode lengkap\\.`);
      return;
    }

    const code = token.code;
    if (action === 'block') {
      await supabase.from('tokens').update({ status: 'blocked' }).eq('id', token.id);
      await supabase.from('token_sessions').update({ is_active: false }).eq('token_id', token.id);
      await sendTelegramMessage(botToken, chatId, `🚫 Token \`${escapeMarkdown(code)}\` telah *diblokir*\\! Semua sesi dimatikan\\.`);
    } else if (action === 'unblock') {
      await supabase.from('tokens').update({ status: 'active' }).eq('id', token.id);
      await sendTelegramMessage(botToken, chatId, `✅ Token \`${escapeMarkdown(code)}\` telah *dibuka blokirnya*\\.`);
    } else if (action === 'reset') {
      await supabase.from('token_sessions').delete().eq('token_id', token.id);
      await sendTelegramMessage(botToken, chatId, `🔄 Semua sesi untuk token \`${escapeMarkdown(code)}\` telah *direset*\\.`);
    } else if (action === 'delete') {
      await supabase.from('chat_messages').delete().eq('token_id', token.id);
      await supabase.from('token_sessions').delete().eq('token_id', token.id);
      await supabase.from('tokens').delete().eq('id', token.id);
      await sendTelegramMessage(botToken, chatId, `🗑️ Token \`${escapeMarkdown(code)}\` telah *dihapus* beserta semua sesi dan pesan chat\\.`);
    }
  } catch (e) {
    await sendTelegramMessage(botToken, chatId, `⚠️ Error: ${e instanceof Error ? escapeMarkdown(e.message) : 'Unknown'}`);
  }
}

// ======== NEW COMMANDS ========

async function handleStatsCommand(supabase: any, botToken: string, chatId: string) {
  try {
    const [usersRes, balRes, tokensRes, coinOrdersRes, subOrdersRes, showsRes, sessionsRes] = await Promise.all([
      supabase.from('profiles').select('id', { count: 'exact', head: true }),
      supabase.from('coin_balances').select('balance'),
      supabase.from('tokens').select('id, status, expires_at', { count: 'exact' }),
      supabase.from('coin_orders').select('id, status, coin_amount, price'),
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

    const msg = `📊 *STATISTIK PLATFORM REALTIME48*\n\n` +
      `👥 *User:*\n` +
      `  Total user: *${totalUsers}*\n` +
      `  Session aktif: *${activeSessions}*\n\n` +
      `💰 *Koin:*\n` +
      `  Total koin beredar: *${totalCoins.toLocaleString()}*\n\n` +
      `🔑 *Token:*\n` +
      `  Aktif: *${activeTokens}* \\| Diblokir: *${blockedTokens}*\n\n` +
      `🪙 *Order Koin:*\n` +
      `  Pending: *${pendingCoin}* \\| Dikonfirmasi: *${confirmedCoin}*\n\n` +
      `🎬 *Subscription:*\n` +
      `  Pending: *${pendingSub}* \\| Dikonfirmasi: *${confirmedSub}*\n\n` +
      `🎭 Show aktif: *${(showsRes.data || []).length}*`;
    await sendTelegramMessage(botToken, chatId, msg);
  } catch (e) {
    await sendTelegramMessage(botToken, chatId, `⚠️ Error: ${e instanceof Error ? escapeMarkdown(e.message) : 'Unknown'}`);
  }
}

async function handleCekUserCommand(supabase: any, botToken: string, chatId: string, username: string) {
  try {
    const { data: profile } = await supabase.from('profiles').select('id, username, created_at').ilike('username', username).maybeSingle();
    if (!profile) {
      await sendTelegramMessage(botToken, chatId, `⚠️ User "${escapeMarkdown(username)}" tidak ditemukan\\.`);
      return;
    }
    const [balRes, coinOrdersRes, subOrdersRes, tokensRes] = await Promise.all([
      supabase.from('coin_balances').select('balance').eq('user_id', profile.id).maybeSingle(),
      supabase.from('coin_orders').select('id, coin_amount, status, created_at').eq('user_id', profile.id).order('created_at', { ascending: false }).limit(5),
      supabase.from('subscription_orders').select('id, show_id, status, created_at').eq('user_id', profile.id).order('created_at', { ascending: false }).limit(5),
      supabase.from('tokens').select('code, status, expires_at, duration_type').eq('user_id', profile.id).order('created_at', { ascending: false }).limit(10),
    ]);

    const balance = balRes.data?.balance ?? 0;
    const regDate = new Date(profile.created_at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
    const now = new Date();

    let msg = `🔍 *DETAIL USER: ${escapeMarkdown(profile.username || 'Unknown')}*\n\n`;
    msg += `📅 Terdaftar: ${escapeMarkdown(regDate)}\n`;
    msg += `💰 Saldo koin: *${balance}*\n\n`;

    // Tokens
    const userTokens = tokensRes.data || [];
    if (userTokens.length > 0) {
      msg += `🔑 *Token \\(${userTokens.length}\\):*\n`;
      for (const t of userTokens) {
        const expired = t.expires_at && new Date(t.expires_at) < now;
        const icon = t.status === 'blocked' ? '🔴' : expired ? '🟡' : '🟢';
        msg += `  ${icon} \`\\.\\.\\.${escapeMarkdown(t.code.slice(-4))}\` ${escapeMarkdown(t.status)} ${escapeMarkdown(t.duration_type || '')}\n`;
      }
      msg += '\n';
    }

    // Coin orders
    const coinOrders = coinOrdersRes.data || [];
    if (coinOrders.length > 0) {
      msg += `🪙 *Order Koin Terakhir:*\n`;
      for (const o of coinOrders) {
        const time = new Date(o.created_at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short' });
        const icon = o.status === 'confirmed' ? '✅' : o.status === 'rejected' ? '❌' : '⏳';
        msg += `  ${icon} ${o.coin_amount} koin \\- ${escapeMarkdown(time)}\n`;
      }
      msg += '\n';
    }

    // Subscriptions
    const subOrders = subOrdersRes.data || [];
    if (subOrders.length > 0) {
      msg += `🎬 *Subscription Terakhir:*\n`;
      for (const o of subOrders) {
        const icon = o.status === 'confirmed' ? '✅' : o.status === 'rejected' ? '❌' : '⏳';
        msg += `  ${icon} ${escapeMarkdown(o.status)}\n`;
      }
    }

    await sendTelegramMessage(botToken, chatId, msg);
  } catch (e) {
    await sendTelegramMessage(botToken, chatId, `⚠️ Error: ${e instanceof Error ? escapeMarkdown(e.message) : 'Unknown'}`);
  }
}

async function handleAnnounceCommand(supabase: any, botToken: string, chatId: string, message: string) {
  try {
    // Get all unique phone numbers from coin_orders and subscription_orders
    const [coinRes, subRes] = await Promise.all([
      supabase.from('coin_orders').select('phone').not('phone', 'is', null),
      supabase.from('subscription_orders').select('phone').not('phone', 'is', null),
    ]);

    const phones = new Set<string>();
    for (const o of (coinRes.data || [])) { if (o.phone?.trim()) phones.add(o.phone.trim()); }
    for (const o of (subRes.data || [])) { if (o.phone?.trim()) phones.add(o.phone.trim()); }

    if (phones.size === 0) {
      await sendTelegramMessage(botToken, chatId, '⚠️ Tidak ada nomor HP user yang tersedia\\.');
      return;
    }

    let sent = 0;
    for (const phone of phones) {
      try { await sendFonnteWhatsApp(phone, `📢 *PENGUMUMAN REALTIME48*\n\n${message}`); sent++; } catch {}
    }

    await sendTelegramMessage(botToken, chatId, `✅ Pengumuman terkirim ke *${sent}*/${phones.size} nomor\\!`);
  } catch (e) {
    await sendTelegramMessage(botToken, chatId, `⚠️ Error: ${e instanceof Error ? escapeMarkdown(e.message) : 'Unknown'}`);
  }
}

async function handleShowListCommand(supabase: any, botToken: string, chatId: string) {
  try {
    const { data: shows } = await supabase.from('shows').select('id, title, is_active, is_replay, is_subscription, is_order_closed, coin_price, replay_coin_price, schedule_date, schedule_time, category').order('created_at', { ascending: false }).limit(50);
    if (!shows || shows.length === 0) {
      await sendTelegramMessage(botToken, chatId, '🎬 Tidak ada show\\.');
      return;
    }

    let msg = `🎬 *DAFTAR SEMUA SHOW \\(${shows.length}\\)*\n\n`;
    for (const s of shows) {
      const sid = showShortId(s.id);
      const status: string[] = [];
      if (!s.is_active) status.push('❌ Nonaktif');
      else status.push('✅ Aktif');
      if (s.is_replay) status.push('🔁 Replay');
      if (s.is_subscription) status.push('👑 Member');
      if (s.is_order_closed) status.push('🔒 Tutup');

      // Get order count
      const { count } = await supabase.from('subscription_orders').select('id', { count: 'exact', head: true }).eq('show_id', s.id).eq('status', 'confirmed');

      msg += `\`#${sid}\` *${escapeMarkdown(s.title)}*\n`;
      msg += `   ${status.join(' \\| ')}\n`;
      msg += `   🪙 ${s.coin_price}/${s.replay_coin_price} \\| 📦 ${count || 0} order\n`;
      if (s.schedule_date) msg += `   📅 ${escapeMarkdown(s.schedule_date)} ${escapeMarkdown(s.schedule_time || '')}\n`;
      msg += '\n';
    }
    await sendTelegramMessage(botToken, chatId, msg);
  } catch (e) {
    await sendTelegramMessage(botToken, chatId, `⚠️ Error: ${e instanceof Error ? escapeMarkdown(e.message) : 'Unknown'}`);
  }
}

async function handlePendapatanCommand(supabase: any, botToken: string, chatId: string) {
  try {
    const { data: coinOrders } = await supabase.from('coin_orders').select('coin_amount, price, status, created_at').eq('status', 'confirmed');
    const { data: subOrders } = await supabase.from('subscription_orders').select('id, show_id, status, created_at').eq('status', 'confirmed');

    const totalCoinRevenue = (coinOrders || []).reduce((sum: number, o: any) => {
      const price = parseInt((o.price || '0').replace(/[^0-9]/g, ''), 10);
      return sum + price;
    }, 0);
    const totalCoinsSold = (coinOrders || []).reduce((sum: number, o: any) => sum + (o.coin_amount || 0), 0);

    // Monthly breakdown
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
      msg += `📅 *Per Bulan \\(6 terakhir\\):*\n`;
      for (const [month, data] of months) {
        msg += `  ${escapeMarkdown(month)}: Rp ${data.coin.toLocaleString()} \\| ${data.sub} sub\n`;
      }
    }

    await sendTelegramMessage(botToken, chatId, msg);
  } catch (e) {
    await sendTelegramMessage(botToken, chatId, `⚠️ Error: ${e instanceof Error ? escapeMarkdown(e.message) : 'Unknown'}`);
  }
}

async function handleOrderTodayCommand(supabase: any, botToken: string, chatId: string) {
  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayIso = todayStart.toISOString();

    const [coinRes, subRes] = await Promise.all([
      supabase.from('coin_orders').select('id, user_id, coin_amount, price, status, short_id, created_at').gte('created_at', todayIso).order('created_at', { ascending: false }),
      supabase.from('subscription_orders').select('id, show_id, phone, email, status, short_id, created_at').gte('created_at', todayIso).order('created_at', { ascending: false }),
    ]);

    const coinOrders = coinRes.data || [];
    const subOrders = subRes.data || [];

    if (coinOrders.length === 0 && subOrders.length === 0) {
      await sendTelegramMessage(botToken, chatId, '📋 Tidak ada order hari ini\\.');
      return;
    }

    let msg = `📋 *ORDER HARI INI*\n\n`;

    if (coinOrders.length > 0) {
      const pending = coinOrders.filter((o: any) => o.status === 'pending').length;
      const confirmed = coinOrders.filter((o: any) => o.status === 'confirmed').length;
      const rejected = coinOrders.filter((o: any) => o.status === 'rejected').length;
      msg += `🪙 *Koin \\(${coinOrders.length}\\):* ⏳${pending} ✅${confirmed} ❌${rejected}\n`;
      for (const o of coinOrders.slice(0, 10)) {
        const icon = o.status === 'confirmed' ? '✅' : o.status === 'rejected' ? '❌' : '⏳';
        const time = new Date(o.created_at).toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' });
        msg += `  ${icon} \`${o.short_id || '\\-'}\` ${o.coin_amount} koin \\- ${escapeMarkdown(time)}\n`;
      }
      msg += '\n';
    }

    if (subOrders.length > 0) {
      const pending = subOrders.filter((o: any) => o.status === 'pending').length;
      const confirmed = subOrders.filter((o: any) => o.status === 'confirmed').length;
      const rejected = subOrders.filter((o: any) => o.status === 'rejected').length;
      msg += `🎬 *Subscription \\(${subOrders.length}\\):* ⏳${pending} ✅${confirmed} ❌${rejected}\n`;
      for (const o of subOrders.slice(0, 10)) {
        const icon = o.status === 'confirmed' ? '✅' : o.status === 'rejected' ? '❌' : '⏳';
        const time = new Date(o.created_at).toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' });
        msg += `  ${icon} \`${o.short_id || '\\-'}\` ${escapeMarkdown(o.email || '-')} \\- ${escapeMarkdown(time)}\n`;
      }
    }

    await sendTelegramMessage(botToken, chatId, msg);
  } catch (e) {
    await sendTelegramMessage(botToken, chatId, `⚠️ Error: ${e instanceof Error ? escapeMarkdown(e.message) : 'Unknown'}`);
  }
}

async function handleTopUsersCommand(supabase: any, botToken: string, chatId: string) {
  try {
    const { data: balances } = await supabase.from('coin_balances').select('user_id, balance').order('balance', { ascending: false }).limit(15);
    if (!balances || balances.length === 0) {
      await sendTelegramMessage(botToken, chatId, '👥 Belum ada user dengan saldo koin\\.');
      return;
    }

    let msg = `🏆 *TOP USERS \\(SALDO KOIN\\)*\n\n`;
    let rank = 0;
    for (const b of balances) {
      rank++;
      const { data: profile } = await supabase.from('profiles').select('username').eq('id', b.user_id).maybeSingle();
      const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `${rank}\\.`;
      msg += `${medal} *${escapeMarkdown(profile?.username || 'Unknown')}* \\- ${b.balance.toLocaleString()} koin\n`;
    }

    await sendTelegramMessage(botToken, chatId, msg);
  } catch (e) {
    await sendTelegramMessage(botToken, chatId, `⚠️ Error: ${e instanceof Error ? escapeMarkdown(e.message) : 'Unknown'}`);
  }
}

async function handleSetPriceCommand(supabase: any, botToken: string, chatId: string, showInput: string, priceType: 'coin' | 'replay', price: number) {
  try {
    if (price < 0 || price > 999999) {
      await sendTelegramMessage(botToken, chatId, '⚠️ Harga harus antara 0\\-999\\.999');
      return;
    }
    const { show, error } = await findShowByIdOrName(supabase, showInput, false);
    if (error || !show) {
      await sendTelegramMessage(botToken, chatId, `⚠️ ${escapeMarkdown(error || 'Show tidak ditemukan')}`);
      return;
    }
    const field = priceType === 'coin' ? 'coin_price' : 'replay_coin_price';
    const oldPrice = priceType === 'coin' ? show.coin_price : (show.replay_coin_price ?? 0);
    await supabase.from('shows').update({ [field]: price }).eq('id', show.id);
    const label = priceType === 'coin' ? 'Harga Koin' : 'Harga Replay';
    await sendTelegramMessage(botToken, chatId,
      `✅ *${label}* untuk *${escapeMarkdown(show.title)}* berhasil diubah\\!\n\n` +
      `🔄 ${oldPrice} → *${price}* koin`
    );
  } catch (e) {
    await sendTelegramMessage(botToken, chatId, `⚠️ Error: ${e instanceof Error ? escapeMarkdown(e.message) : 'Unknown'}`);
  }
}

async function handleBanUserCommand(supabase: any, botToken: string, chatId: string, usernameOrId: string, reason: string) {
  try {
    const { data: profile } = await supabase.from('profiles').select('id, username').ilike('username', usernameOrId).maybeSingle();
    if (!profile) { await sendTelegramMessage(botToken, chatId, `⚠️ User "${escapeMarkdown(usernameOrId)}" tidak ditemukan\\.`); return; }
    const { error } = await supabase.from('user_bans').upsert({ user_id: profile.id, reason, banned_by: 'admin', is_active: true }, { onConflict: 'user_id' });
    if (error) { await sendTelegramMessage(botToken, chatId, `⚠️ Gagal ban: ${escapeMarkdown(error.message)}`); return; }
    await sendTelegramMessage(botToken, chatId, `🚫 User *${escapeMarkdown(profile.username || usernameOrId)}* berhasil *DIBLOKIR*\\!\n📝 Alasan: ${escapeMarkdown(reason)}`);
  } catch (e) { await sendTelegramMessage(botToken, chatId, `⚠️ Error: ${e instanceof Error ? escapeMarkdown(e.message) : 'Unknown'}`); }
}

async function handleUnbanUserCommand(supabase: any, botToken: string, chatId: string, usernameOrId: string) {
  try {
    const { data: profile } = await supabase.from('profiles').select('id, username').ilike('username', usernameOrId).maybeSingle();
    if (!profile) { await sendTelegramMessage(botToken, chatId, `⚠️ User "${escapeMarkdown(usernameOrId)}" tidak ditemukan\\.`); return; }
    await supabase.from('user_bans').update({ is_active: false, unbanned_at: new Date().toISOString() }).eq('user_id', profile.id);
    await sendTelegramMessage(botToken, chatId, `✅ User *${escapeMarkdown(profile.username || usernameOrId)}* berhasil *DIBUKA BLOKIR*\\!`);
  } catch (e) { await sendTelegramMessage(botToken, chatId, `⚠️ Error: ${e instanceof Error ? escapeMarkdown(e.message) : 'Unknown'}`); }
}

async function handleBanlistCommand(supabase: any, botToken: string, chatId: string) {
  try {
    const { data: bans } = await supabase.from('user_bans').select('user_id, reason, created_at').eq('is_active', true).order('created_at', { ascending: false }).limit(20);
    if (!bans || bans.length === 0) { await sendTelegramMessage(botToken, chatId, '✅ Tidak ada user yang diblokir\\.'); return; }
    const userIds = bans.map((b: any) => b.user_id);
    const { data: profiles } = await supabase.from('profiles').select('id, username').in('id', userIds);
    const profileMap = new Map((profiles || []).map((p: any) => [p.id, p.username || 'Unknown']));
    let msg = `🚫 *DAFTAR USER DIBLOKIR \\(${bans.length}\\)*\n\n`;
    for (const b of bans) {
      const name = profileMap.get(b.user_id) || 'Unknown';
      msg += `👤 ${escapeMarkdown(name)}\n📝 ${escapeMarkdown(b.reason)}\n\n`;
    }
    msg += `Gunakan \`/unbanuser <username>\` untuk buka blokir`;
    await sendTelegramMessage(botToken, chatId, msg);
  } catch (e) { await sendTelegramMessage(botToken, chatId, `⚠️ Error: ${e instanceof Error ? escapeMarkdown(e.message) : 'Unknown'}`); }
}

async function handleSuspiciousCommand(supabase: any, botToken: string, chatId: string, username: string | null) {
  try {
    let query = supabase.from('suspicious_activity_log').select('user_id, activity_type, severity, description, created_at').eq('resolved', false).order('created_at', { ascending: false }).limit(10);
    if (username) {
      const { data: profile } = await supabase.from('profiles').select('id').ilike('username', username).maybeSingle();
      if (profile) query = query.eq('user_id', profile.id);
    }
    const { data: logs } = await query;
    if (!logs || logs.length === 0) { await sendTelegramMessage(botToken, chatId, '✅ Tidak ada aktivitas mencurigakan\\.'); return; }
    const userIds = [...new Set(logs.map((l: any) => l.user_id).filter(Boolean))];
    const { data: profiles } = await supabase.from('profiles').select('id, username').in('id', userIds);
    const profileMap = new Map((profiles || []).map((p: any) => [p.id, p.username || 'Unknown']));
    const sevEmoji: Record<string, string> = { low: '🟡', medium: '🟠', high: '🔴', critical: '🚨' };
    let msg = `⚠️ *AKTIVITAS MENCURIGAKAN \\(${logs.length}\\)*\n\n`;
    for (const l of logs) {
      msg += `${sevEmoji[l.severity] || '🟠'} ${escapeMarkdown(profileMap.get(l.user_id) || '?')} \\- ${escapeMarkdown(l.activity_type)}\n📝 ${escapeMarkdown(l.description || '-')}\n\n`;
    }
    await sendTelegramMessage(botToken, chatId, msg);
  } catch (e) { await sendTelegramMessage(botToken, chatId, `⚠️ Error: ${e instanceof Error ? escapeMarkdown(e.message) : 'Unknown'}`); }
}

async function handleCreateTokenCommand(supabase: any, botToken: string, chatId: string, showInput: string, maxDevices: number) {
  try {
    if (maxDevices < 1 || maxDevices > 9999) {
      await sendTelegramMessage(botToken, chatId, '⚠️ Max device harus antara 1\\-9999');
      return;
    }

    // Support comma-separated shows
    const showInputs = showInput.split(',').map((s: string) => s.trim()).filter(Boolean);

    if (showInputs.length > 1) {
      let allMessages: string[] = [];
      for (const input of showInputs) {
        const { show, error } = await findShowByIdOrName(supabase, input, false);
        if (error || !show) { allMessages.push(`⚠️ "${escapeMarkdown(input)}": ${escapeMarkdown(error || 'Tidak ditemukan')}`); continue; }

        const code = (show.is_bundle ? 'BDL-' : 'RT48-') + Array.from(crypto.getRandomValues(new Uint8Array(6))).map((b: number) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
        const expiresAt = await calculateShowTokenExpiry(supabase, show);

        const { error: insertErr } = await supabase.from('tokens').insert({
          code, show_id: show.id, max_devices: maxDevices, expires_at: expiresAt, status: 'active',
        });

        if (insertErr) { allMessages.push(`⚠️ "${escapeMarkdown(show.title)}": ${escapeMarkdown(insertErr.message)}`); continue; }

        const expDate = new Date(expiresAt).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
        let msg = `✅ *${escapeMarkdown(show.title)}*\n🔑 \`${escapeMarkdown(code)}\`\n📱 Max: ${maxDevices} ⏰ ${escapeMarkdown(expDate)}`;
        if (show.is_bundle) msg += `\n📦 Bundle: ${show.bundle_duration_days || 30} hari`;
        msg += `\n💡 https://realtime48stream\\.my\\.id/live?t\\=${escapeMarkdown(code)}`;
        allMessages.push(msg);
      }

      await sendTelegramMessage(botToken, chatId, `📋 *Multi\\-Token \\(${showInputs.length} show\\)*\n\n${allMessages.join('\n\n')}`);
      return;
    }

    // Single show
    const { show, error } = await findShowByIdOrName(supabase, showInput, false);
    if (error || !show) {
      await sendTelegramMessage(botToken, chatId, `⚠️ ${escapeMarkdown(error || 'Show tidak ditemukan')}`);
      return;
    }

    const code = (show.is_bundle ? 'BDL-' : 'RT48-') + Array.from(crypto.getRandomValues(new Uint8Array(6))).map((b: number) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
    const expiresAt = await calculateShowTokenExpiry(supabase, show);

    const { error: insertErr } = await supabase.from('tokens').insert({
      code,
      show_id: show.id,
      max_devices: maxDevices,
      expires_at: expiresAt,
      status: 'active',
    });

    if (insertErr) {
      await sendTelegramMessage(botToken, chatId, `⚠️ Gagal membuat token: ${escapeMarkdown(insertErr.message)}`);
      return;
    }

    const last4 = code.slice(-4);
    const expDate = new Date(expiresAt).toLocaleString('id-ID', {
      timeZone: 'Asia/Jakarta',
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    });
    const schedule = show.schedule_date ? `${show.schedule_date}${show.schedule_time ? ' ' + show.schedule_time : ''}` : '-';

    let msg = `✅ *Token Berhasil Dibuat\\!*\n\n` +
      `🎬 Show: *${escapeMarkdown(show.title)}*\n` +
      `📅 Jadwal: ${escapeMarkdown(schedule)}\n` +
      `🔑 Kode: \`${escapeMarkdown(code)}\`\n` +
      `📱 Max Device: *${maxDevices}*\n` +
      `⏰ Kedaluwarsa: ${escapeMarkdown(expDate)}\n` +
      `🔢 4 Digit: \`${escapeMarkdown(last4)}\``;

    if (show.is_bundle) {
      msg += `\n📦 Durasi Bundle: *${escapeMarkdown(String(show.bundle_duration_days || 30))} hari*`;
    }

    msg += `\n\n💡 Link: https://realtime48stream\\.my\\.id/live?t\\=${escapeMarkdown(code)}`;
    msg += buildReplayInfoMessageTelegram(show);

    await sendTelegramMessage(botToken, chatId, msg);
  } catch (e) {
    await sendTelegramMessage(botToken, chatId, `⚠️ Error: ${e instanceof Error ? escapeMarkdown(e.message) : 'Unknown'}`);
  }
}

async function handleGiveTokenCommand(supabase: any, botToken: string, chatId: string, usernameInput: string, showInput: string, maxDevices: number) {
  try {
    if (maxDevices < 1 || maxDevices > 10) {
      await sendTelegramMessage(botToken, chatId, '⚠️ Max device harus antara 1\\-10');
      return;
    }

    const { data: profiles } = await supabase.from('profiles').select('id, username').ilike('username', usernameInput).limit(5);
    if (!profiles || profiles.length === 0) {
      await sendTelegramMessage(botToken, chatId, `⚠️ User "${escapeMarkdown(usernameInput)}" tidak ditemukan`);
      return;
    }
    const profile = profiles.find((p: any) => p.username?.toLowerCase() === usernameInput.toLowerCase()) || profiles[0];

    const { show, error } = await findShowByIdOrName(supabase, showInput, false);
    if (error || !show) {
      await sendTelegramMessage(botToken, chatId, `⚠️ ${escapeMarkdown(error || 'Show tidak ditemukan')}`);
      return;
    }

    const code = 'RT48-' + Array.from(crypto.getRandomValues(new Uint8Array(6))).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
    const expiresAt = await calculateShowTokenExpiry(supabase, show);

    const { error: insertErr } = await supabase.from('tokens').insert({
      code,
      show_id: show.id,
      user_id: profile.id,
      max_devices: maxDevices,
      expires_at: expiresAt,
      status: 'active',
    });

    if (insertErr) {
      await sendTelegramMessage(botToken, chatId, `⚠️ Gagal membuat token: ${escapeMarkdown(insertErr.message)}`);
      return;
    }

    const expDate = new Date(expiresAt).toLocaleString('id-ID', {
      timeZone: 'Asia/Jakarta',
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    });
    const schedule = show.schedule_date ? `${show.schedule_date}${show.schedule_time ? ' ' + show.schedule_time : ''}` : '-';

    let msg = `✅ *Token Diberikan ke User\\!*\n\n` +
      `👤 User: *${escapeMarkdown(profile.username || 'Unknown')}*\n` +
      `🎬 Show: *${escapeMarkdown(show.title)}*\n` +
      `📅 Jadwal: ${escapeMarkdown(schedule)}\n` +
      `🔑 Kode: \`${escapeMarkdown(code)}\`\n` +
      `📱 Max Device: *${maxDevices}*\n` +
      `⏰ Kedaluwarsa: ${escapeMarkdown(expDate)}`;

    if (show.is_bundle) {
      msg += `\n📦 Durasi Bundle: *${escapeMarkdown(String(show.bundle_duration_days || 30))} hari*`;
    }

    msg += `\n\n💡 Link: https://realtime48stream\\.my\\.id/live?t\\=${escapeMarkdown(code)}`;
    msg += buildReplayInfoMessageTelegram(show);

    await sendTelegramMessage(botToken, chatId, msg);
  } catch (e) {
    await sendTelegramMessage(botToken, chatId, `⚠️ Error: ${e instanceof Error ? escapeMarkdown(e.message) : 'Unknown'}`);
  }
}

async function handleBulkTokenCommand(supabase: any, botToken: string, chatId: string, showInput: string, count: number, maxDevices: number) {
  try {
    if (count < 1 || count > 100) {
      await sendTelegramMessage(botToken, chatId, '⚠️ Jumlah token harus antara 1\\-100');
      return;
    }
    if (maxDevices < 1 || maxDevices > 10) {
      await sendTelegramMessage(botToken, chatId, '⚠️ Max device harus antara 1\\-10');
      return;
    }

    const { show, error } = await findShowByIdOrName(supabase, showInput, false);
    if (error || !show) {
      await sendTelegramMessage(botToken, chatId, `⚠️ ${escapeMarkdown(error || 'Show tidak ditemukan')}`);
      return;
    }

    const expiresAt = await calculateShowTokenExpiry(supabase, show);

    await sendTelegramMessage(botToken, chatId, `⏳ Membuat ${count} token untuk *${escapeMarkdown(show.title)}*\\.\\.\\.`);

    const tokens: { code: string; last4: string }[] = [];
    const rows = [];
    for (let i = 0; i < count; i++) {
      const code = 'RT48-' + Array.from(crypto.getRandomValues(new Uint8Array(6))).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
      tokens.push({ code, last4: code.slice(-4) });
      rows.push({ code, show_id: show.id, max_devices: maxDevices, expires_at: expiresAt, status: 'active' });
    }

    const { error: insertErr } = await supabase.from('tokens').insert(rows);
    if (insertErr) {
      await sendTelegramMessage(botToken, chatId, `⚠️ Gagal membuat token: ${escapeMarkdown(insertErr.message)}`);
      return;
    }

    const expDate = new Date(expiresAt).toLocaleString('id-ID', {
      timeZone: 'Asia/Jakarta',
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    });

    let msg = `✅ *${count} Token Berhasil Dibuat\\!*\n\n`;
    msg += `🎬 Show: *${escapeMarkdown(show.title)}*\n`;
    msg += `📱 Max Device: *${maxDevices}*\n`;
    msg += `⏰ Kedaluwarsa: ${escapeMarkdown(expDate)}\n`;
    if (show.is_bundle) {
      msg += `📦 Durasi Bundle: *${escapeMarkdown(String(show.bundle_duration_days || 30))} hari*\n`;
    }
    msg += buildReplayInfoMessageTelegram(show);
    msg += `\n\n🔑 *Daftar Token:*\n`;

    const chunkSize = 30;
    const chunks: typeof tokens[] = [];
    for (let i = 0; i < tokens.length; i += chunkSize) {
      chunks.push(tokens.slice(i, i + chunkSize));
    }

    const firstChunk = chunks[0];
    for (const t of firstChunk) {
      msg += `\`${escapeMarkdown(t.code)}\`\n`;
    }

    if (chunks.length === 1) {
      msg += `\n📺 *Link Nonton \\(contoh\\):*\nhttps://realtime48stream\\.my\\.id/live?t\\=${escapeMarkdown(firstChunk[0].code)}`;
    }

    await sendTelegramMessage(botToken, chatId, msg);

    for (let i = 1; i < chunks.length; i++) {
      let chunkMsg = `🔑 *Token \\(lanjutan ${i + 1}/${chunks.length}\\):*\n`;
      for (const t of chunks[i]) {
        chunkMsg += `\`${escapeMarkdown(t.code)}\`\n`;
      }
      await sendTelegramMessage(botToken, chatId, chunkMsg);
    }

  } catch (e) {
    await sendTelegramMessage(botToken, chatId, `⚠️ Error: ${e instanceof Error ? escapeMarkdown(e.message) : 'Unknown'}`);
  }
}

function buildReplayInfoMessageTelegram(show: any): string {
  if (show?.is_bundle) {
    let msg = '';
    const bundlePasswords = Array.isArray(show.bundle_replay_passwords) ? show.bundle_replay_passwords : [];
    if (bundlePasswords.length > 0) {
      msg += `\n\n📦 *Sandi Replay Bundle:*`;
      for (const entry of bundlePasswords) {
        if (entry?.show_name && entry?.password) {
          msg += `\n🎭 ${escapeMarkdown(entry.show_name)}: *${escapeMarkdown(entry.password)}*`;
        }
      }
    }
    if (show.bundle_replay_info) {
      msg += `\n\n🎬 *Info Replay:*\n🔗 ${escapeMarkdown(show.bundle_replay_info)}`;
    } else {
      msg += `\n\n🎬 *Link Replay:*\n🔗 https://replaytime\\.lovable\\.app`;
    }
    if (show.access_password) {
      msg += `\n🔑 Sandi Akses: *${escapeMarkdown(show.access_password)}*`;
    }
    return msg;
  }

  let msg = `\n\n🔄 *Info Replay:*\n🔗 Link: https://replaytime\\.lovable\\.app`;
  if (show?.access_password) {
    msg += `\n🔐 Sandi Replay: ${escapeMarkdown(show.access_password)}`;
  }
  return msg;
}

async function calculateShowTokenExpiry(supabase: any, show: any): Promise<string> {
  if (show?.is_bundle && (show.bundle_duration_days || 0) > 0) {
    return new Date(Date.now() + show.bundle_duration_days * 86400000).toISOString();
  }

  if (show?.schedule_date) {
    const { data: parsed } = await supabase.rpc('parse_show_datetime', {
      _date: show.schedule_date,
      _time: show.schedule_time || '23.59 WIB',
    });

    if (parsed) {
      const showDt = new Date(parsed);
      const endOfDay = new Date(showDt);
      endOfDay.setHours(23, 59, 59, 0);
      if (endOfDay > new Date()) {
        return endOfDay.toISOString();
      }
    }
  }

  return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
}

async function handleSetShortIdCommand(supabase: any, botToken: string, chatId: string, hexId: string, shortId: string) {
  try {
    const { show, error } = await findShowByIdOrName(supabase, `#${hexId}`, false);
    if (error || !show) {
      await sendTelegramMessage(botToken, chatId, `⚠️ ${escapeMarkdown(error || 'Show tidak ditemukan')}`);
      return;
    }

    // Validate short_id format
    if (!/^[a-zA-Z0-9_-]{2,30}$/.test(shortId)) {
      await sendTelegramMessage(botToken, chatId, '⚠️ Custom ID hanya boleh huruf, angka, \\- dan \\_ \\(2\\-30 karakter\\)');
      return;
    }

    // Check uniqueness
    const { data: existing } = await supabase.from('shows').select('id').eq('short_id', shortId).neq('id', show.id).maybeSingle();
    if (existing) {
      await sendTelegramMessage(botToken, chatId, `⚠️ ID "${escapeMarkdown(shortId)}" sudah dipakai show lain\\.`);
      return;
    }

    await supabase.from('shows').update({ short_id: shortId }).eq('id', show.id);
    await sendTelegramMessage(botToken, chatId,
      `✅ Custom ID berhasil diset\\!\n\n` +
      `🎬 Show: *${escapeMarkdown(show.title)}*\n` +
      `🏷️ Custom ID: \`${escapeMarkdown(shortId)}\`\n\n` +
      `💡 Sekarang bisa gunakan ID ini di semua command, contoh:\n` +
      `\`/createtoken ${escapeMarkdown(shortId)}\`\n` +
      `\`/bulktoken ${escapeMarkdown(shortId)} 10\``
    );
  } catch (e) {
    await sendTelegramMessage(botToken, chatId, `⚠️ Error: ${e instanceof Error ? escapeMarkdown(e.message) : 'Unknown'}`);
  }
}

async function handleResendCommand(supabase: any, botToken: string, chatId: string, shortId: string) {
  try {
    // Strip leading # if present
    const cleanId = shortId.trim().replace(/^#/, '');
    const normalizedId = cleanId.toLowerCase();
    const siteUrl = 'https://realtime48stream.my.id';

    // Try subscription_orders first
    const { data: subOrder } = await supabase
      .from('subscription_orders')
      .select('id, show_id, phone, email, status, short_id, user_id, created_at')
      .or(`short_id.ilike.${normalizedId},id.eq.${normalizedId}`)
      .maybeSingle();

    if (subOrder) {
      if (subOrder.status !== 'confirmed') {
        await sendTelegramMessage(botToken, chatId, `⚠️ Order \`${escapeMarkdown(cleanId)}\` belum dikonfirmasi \\(status: ${escapeMarkdown(subOrder.status)}\\)\\.`);
        return;
      }

      const { data: show } = await supabase
        .from('shows')
        .select('title, access_password, is_subscription, is_replay, group_link, schedule_date, schedule_time, is_bundle, bundle_duration_days, bundle_replay_passwords, bundle_replay_info')
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
        // Fallback: find token by show_id created around the same time (within 5 min)
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
        await sendTelegramMessage(botToken, chatId, `⚠️ Order \`${escapeMarkdown(cleanId)}\` tidak memiliki nomor telepon\\. Tidak bisa mengirim ulang\\.`);
        return;
      }

      let waMsg = '';

      if (show?.is_bundle) {
        const bundleDays = show.bundle_duration_days || 30;
        waMsg = `━━━━━━━━━━━━━━━━━━\n📦 *Info Paket Bundle Anda*\n━━━━━━━━━━━━━━━━━━\n\n🎭 Paket: *${show?.title || 'Show'}*\n⏰ Durasi Token: *${bundleDays} hari*\n`;
        if (token?.code) {
          waMsg += `\n🎫 *Token Akses:* ${token.code}\n📺 *Link Nonton:*\n${siteUrl}/live?t=${token.code}\n`;
        }
        if (show.schedule_date) {
          waMsg += `📅 *Jadwal:* ${show.schedule_date} ${show.schedule_time || ''}\n`;
        }
        const bundlePasswords = Array.isArray(show.bundle_replay_passwords) ? show.bundle_replay_passwords : [];
        if (bundlePasswords.length > 0) {
          waMsg += `\n📦 *Sandi Replay Bundle:*\n`;
          for (const entry of bundlePasswords) {
            if (entry.show_name && entry.password) {
              waMsg += `  🎭 ${entry.show_name}: *${entry.password}*\n`;
            }
          }
        }
        if (show.bundle_replay_info) {
          waMsg += `\n🎬 *Info Replay:*\n🔗 ${show.bundle_replay_info}\n`;
        } else {
          waMsg += `\n🎬 *Link Replay:*\n🔗 https://replaytime.lovable.app\n`;
        }
        if (show.access_password) {
          waMsg += `🔑 Sandi Akses: *${show.access_password}*\n`;
        }
      } else {
        waMsg = `━━━━━━━━━━━━━━━━━━\n🔄 *Info Pesanan Anda*\n━━━━━━━━━━━━━━━━━━\n\n🎭 Show: *${show?.title || 'Show'}*\n`;
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
      }

      waMsg += `\n⚠️ _Jangan bagikan token/link ini ke orang lain._\n━━━━━━━━━━━━━━━━━━\n_Terima kasih!_ 🎉`;

      await sendFonnteWhatsApp(subOrder.phone, waMsg);

      await sendTelegramMessage(botToken, chatId,
        `✅ *Info berhasil dikirim ulang\\!*\n\n` +
        `🆔 Order: \`${escapeMarkdown(subOrder.short_id || cleanId)}\`\n` +
        `🎬 Show: ${escapeMarkdown(show?.title || '-')}\n` +
        `📱 Phone: ${escapeMarkdown(subOrder.phone)}\n` +
        `${token?.code ? `🎫 Token: \`${escapeMarkdown(token.code)}\`` : '⚠️ Token tidak ditemukan'}`
      );
      return;
    }

    // Try coin_orders
    const { data: coinOrder } = await supabase
      .from('coin_orders')
      .select('id, user_id, coin_amount, phone, status, short_id')
      .or(`short_id.ilike.${normalizedId},id.eq.${normalizedId}`)
      .maybeSingle();

    if (coinOrder) {
      if (coinOrder.status !== 'confirmed') {
        await sendTelegramMessage(botToken, chatId, `⚠️ Order koin \`${escapeMarkdown(cleanId)}\` belum dikonfirmasi \\(status: ${escapeMarkdown(coinOrder.status)}\\)\\.`);
        return;
      }

      if (!coinOrder.phone) {
        await sendTelegramMessage(botToken, chatId, `⚠️ Order koin \`${escapeMarkdown(cleanId)}\` tidak memiliki nomor telepon\\.`);
        return;
      }

      const { data: balData } = await supabase.from('coin_balances').select('balance').eq('user_id', coinOrder.user_id).maybeSingle();
      const balance = balData?.balance ?? 0;

      const waMsg = `━━━━━━━━━━━━━━━━━━\n🔄 *Info Pembelian Koin*\n━━━━━━━━━━━━━━━━━━\n\n🪙 Jumlah: *${coinOrder.coin_amount} koin*\n💎 Saldo saat ini: *${balance} koin*\n\n🛒 Koin dapat digunakan untuk membeli akses show.\n🌐 realtime48stream.my.id\n\n_Terima kasih!_ 🙏\n━━━━━━━━━━━━━━━━━━`;

      await sendFonnteWhatsApp(coinOrder.phone, waMsg);

      await sendTelegramMessage(botToken, chatId,
        `✅ *Info koin dikirim ulang\\!*\n\n` +
        `🆔 Order: \`${escapeMarkdown(coinOrder.short_id || cleanId)}\`\n` +
        `📱 Phone: ${escapeMarkdown(coinOrder.phone)}\n` +
        `🪙 ${coinOrder.coin_amount} koin`
      );
      return;
    }

    await sendTelegramMessage(botToken, chatId, `⚠️ Order \`${escapeMarkdown(cleanId)}\` tidak ditemukan\\.`);
  } catch (e) {
    await sendTelegramMessage(botToken, chatId, `⚠️ Error resend: ${e instanceof Error ? escapeMarkdown(e.message) : 'Unknown'}`);
  }
}

function parseDurationTg(durationStr: string): number {
  const match = durationStr.match(/^(\d+)\s*(hari|minggu|bulan|tahun)$/i);
  if (!match) return 0;
  const num = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  if (unit === 'hari') return num;
  if (unit === 'minggu') return num * 7;
  if (unit === 'bulan') return num * 30;
  if (unit === 'tahun') return num * 365;
  return 0;
}

async function handleTokenAllCommand(supabase: any, botToken: string, chatId: string, durationStr: string, maxDevices: number) {
  try {
    if (maxDevices < 1 || maxDevices > 9999) {
      await sendTelegramMessage(botToken, chatId, '⚠️ Max device harus antara 1\\-9999');
      return;
    }
    const durationDays = parseDurationTg(durationStr);
    if (durationDays <= 0) {
      await sendTelegramMessage(botToken, chatId, '⚠️ Format durasi salah\\. Contoh: 30hari, 1minggu, 2bulan, 1tahun');
      return;
    }

    const code = 'RT48-' + Array.from(crypto.getRandomValues(new Uint8Array(6))).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
    const expiresAt = new Date(Date.now() + durationDays * 86400000).toISOString();

    const { error: insertErr } = await supabase.from('tokens').insert({
      code, show_id: null, max_devices: maxDevices, expires_at: expiresAt, status: 'active',
    });
    if (insertErr) {
      await sendTelegramMessage(botToken, chatId, `⚠️ Gagal membuat token: ${escapeMarkdown(insertErr.message)}`);
      return;
    }

    const expDate = new Date(expiresAt).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', day: '2-digit', month: 'long', year: 'numeric' });
    const liveLink = `realtime48stream.my.id/live?t=${code}`;

    await sendTelegramMessage(botToken, chatId,
      `✅ *Token ALL Show Berhasil\\!*\n\n` +
      `🔑 Token: \`${escapeMarkdown(code)}\`\n` +
      `📱 Max Device: *${maxDevices}*\n` +
      `⏰ Durasi: *${durationDays} hari*\n` +
      `📅 Kedaluwarsa: ${escapeMarkdown(expDate)}\n` +
      `🎬 Akses: *SEMUA SHOW*\n\n` +
      `📺 Link: \`${escapeMarkdown(liveLink)}\``
    );
  } catch (e) {
    await sendTelegramMessage(botToken, chatId, `⚠️ Error: ${e instanceof Error ? escapeMarkdown(e.message) : 'Unknown'}`);
  }
}

async function handleMakeTokenCommand(supabase: any, botToken: string, chatId: string, showInput: string, durationStr: string, maxDevices: number, replayPassword: string | null) {
  try {
    if (maxDevices < 1 || maxDevices > 9999) {
      await sendTelegramMessage(botToken, chatId, '⚠️ Max device harus antara 1\\-9999');
      return;
    }
    const durationDays = parseDurationTg(durationStr);
    if (durationDays <= 0) {
      await sendTelegramMessage(botToken, chatId, '⚠️ Format durasi salah\\. Contoh: 30hari, 1minggu, 2bulan');
      return;
    }
    if (durationDays > 30 && !replayPassword) {
      await sendTelegramMessage(botToken, chatId, '⚠️ Durasi \\>30 hari wajib menyertakan sandi replay\\.\nContoh: `/maketoken ShowA 60hari 1 sandiABC`');
      return;
    }

    const { show, error, multiple } = await findShowByIdOrName(supabase, showInput, false);
    if (error) { await sendTelegramMessage(botToken, chatId, `⚠️ ${escapeMarkdown(error)}`); return; }
    if (multiple) {
      let msg = `⚠️ Ditemukan ${multiple.length} show:\n\n`;
      for (const s of multiple) msg += `• ${escapeMarkdown(s.title)} \\(\`${s.short_id || '#' + showShortId(s.id)}\`\\)\n`;
      msg += `\n💡 Gunakan ID: \`/maketoken #<id> \\.\\.\\.\``;
      await sendTelegramMessage(botToken, chatId, msg);
      return;
    }
    if (!show) { await sendTelegramMessage(botToken, chatId, `⚠️ Show "${escapeMarkdown(showInput)}" tidak ditemukan\\.`); return; }

    const code = 'RT48-' + Array.from(crypto.getRandomValues(new Uint8Array(6))).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
    const expiresAt = new Date(Date.now() + durationDays * 86400000).toISOString();

    const { error: insertErr } = await supabase.from('tokens').insert({
      code, show_id: show.id, max_devices: maxDevices, expires_at: expiresAt, status: 'active',
    });
    if (insertErr) { await sendTelegramMessage(botToken, chatId, `⚠️ Gagal: ${escapeMarkdown(insertErr.message)}`); return; }

    const expDate = new Date(expiresAt).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', day: '2-digit', month: 'long', year: 'numeric' });
    let msg = `✅ *Token Custom Berhasil\\!*\n\n` +
      `🎬 Show: *${escapeMarkdown(show.title)}*\n` +
      `🔑 Token: \`${escapeMarkdown(code)}\`\n` +
      `📱 Max Device: *${maxDevices}*\n` +
      `⏰ Durasi: *${durationDays} hari*\n` +
      `📅 Kedaluwarsa: ${escapeMarkdown(expDate)}\n\n` +
      `📺 Link: \`realtime48stream\\.my\\.id/live?t=${escapeMarkdown(code)}\``;
    if (durationDays > 7 && replayPassword) {
      msg += `\n🔐 Sandi Replay: ${escapeMarkdown(replayPassword)}`;
    }
    await sendTelegramMessage(botToken, chatId, msg);
  } catch (e) {
    await sendTelegramMessage(botToken, chatId, `⚠️ Error: ${e instanceof Error ? escapeMarkdown(e.message) : 'Unknown'}`);
  }
}

async function handlePerpanjangCommand(supabase: any, botToken: string, chatId: string, tokenSuffix: string, durationStr: string) {
  try {
    const durationDays = parseDurationTg(durationStr);
    if (durationDays <= 0) {
      await sendTelegramMessage(botToken, chatId, '⚠️ Format durasi salah\\. Contoh: 30hari, 1minggu, 2bulan, 1tahun');
      return;
    }

    const suffix = tokenSuffix.toLowerCase();
    const { data: allTokens } = await supabase.from('tokens').select('id, code, expires_at, status, show_id').eq('status', 'active');
    const matches = (allTokens || []).filter((t: any) => t.code.toLowerCase().endsWith(suffix) || t.code.toLowerCase().includes(suffix));

    if (matches.length === 0) {
      await sendTelegramMessage(botToken, chatId, `⚠️ Token "${escapeMarkdown(tokenSuffix)}" tidak ditemukan\\.`);
      return;
    }
    if (matches.length > 1) {
      let msg = `⚠️ Ditemukan ${matches.length} token:\n\n`;
      for (const t of matches) msg += `• \`${escapeMarkdown(t.code)}\`\n`;
      msg += `\n💡 Gunakan kode yang lebih spesifik\\.`;
      await sendTelegramMessage(botToken, chatId, msg);
      return;
    }

    const token = matches[0];
    const currentExpiry = token.expires_at ? new Date(token.expires_at) : new Date();
    const baseDate = currentExpiry > new Date() ? currentExpiry : new Date();
    const newExpiry = new Date(baseDate.getTime() + durationDays * 86400000);

    const { error: updateErr } = await supabase.from('tokens').update({
      expires_at: newExpiry.toISOString(),
    }).eq('id', token.id);

    if (updateErr) {
      await sendTelegramMessage(botToken, chatId, `⚠️ Gagal: ${escapeMarkdown(updateErr.message)}`);
      return;
    }

    const expDate = newExpiry.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    await sendTelegramMessage(botToken, chatId,
      `✅ *Token Berhasil Diperpanjang\\!*\n\n` +
      `🔑 Token: \`${escapeMarkdown(token.code)}\`\n` +
      `⏰ Ditambah: *${durationDays} hari*\n` +
      `📅 Kedaluwarsa baru: ${escapeMarkdown(expDate)}`
    );
  } catch (e) {
    await sendTelegramMessage(botToken, chatId, `⚠️ Error: ${e instanceof Error ? escapeMarkdown(e.message) : 'Unknown'}`);
  }
}

function errorResponse(msg: string) {
  console.error('telegram-poll error:', msg);
  return jsonResponse({ error: msg }, 500);
}