/**
 * Helper terpusat builder pesan WhatsApp/Telegram untuk show.
 *
 * Empat tipe pesan yang didukung:
 *  - buildRegularShowMessage: show reguler (non-membership, non-bundle, non-replay)
 *  - buildMembershipMessage: show membership
 *  - buildBundleMessage: paket bundle
 *  - buildReplayMessage: show replay
 *
 * Semua fungsi mengembalikan string mentah TANPA footer "Jangan bagikan...".
 * Pemanggil bertanggung jawab menambahkan footer bila perlu.
 *
 * Untuk menjaga konsistensi lintas environment, file ini DIDUPLIKASI di
 * supabase/functions/_shared/showMessageBuilder.ts. Bila mengubah salah satu,
 * SELALU sinkronkan dengan yang lain.
 */

export const REPLAY_PORTAL_URL = "https://replaytime.lovable.app";
export const DEFAULT_SITE_URL = "realtime48stream.my.id";

/* ------------------------------------------------------------------ */
/* Regular show                                                        */
/* ------------------------------------------------------------------ */

export interface RegularShowMessageOpts {
  showTitle: string;
  scheduleDate?: string | null;
  scheduleTime?: string | null;
  /** Jika sudah punya schedule pre-formatted, lewati scheduleDate/Time. */
  schedule?: string | null;
  liveLink: string;
  maxDevices?: number;
  replayPassword?: string | null;
}

export function buildRegularShowMessage(opts: RegularShowMessageOpts): string {
  const schedule =
    opts.schedule ??
    (opts.scheduleDate
      ? `${opts.scheduleDate}${opts.scheduleTime ? " " + opts.scheduleTime : ""}`
      : "-");
  const maxDevices = opts.maxDevices ?? 1;
  let msg = `━━━━━━━━━━━━━━━━━━
✅ *Token Berhasil Dibuat!*
━━━━━━━━━━━━━━━━━━

🎬 Show: *${opts.showTitle}*
📅 Jadwal: ${schedule}
📱 Max Device: *${maxDevices}*

📺 *Link Nonton LIVE & REPLAY:*
${opts.liveLink}

🔄 *Info Replay:*
  *Dapat gunakan link live diatas kembali untuk mengakses replay ketika show telah menjadi replay dengan batas waktu 14 hari*

> ATAU GUNAKAN :
> 🔗 Link: ${REPLAY_PORTAL_URL}`;
  if (opts.replayPassword) {
    msg += `\n> 🔐 Sandi Replay: ${opts.replayPassword}`;
  }
  msg += `\n━━━━━━━━━━━━━━━━━━`;
  return msg;
}

/* ------------------------------------------------------------------ */
/* Membership show                                                     */
/* ------------------------------------------------------------------ */

export interface MembershipMessageOpts {
  showTitle: string;
  tokenCode?: string | null;
  liveLink?: string | null;
  durationLabel?: string | null;
  groupLink?: string | null;
  replayLink?: string | null;
  replayPassword?: string | null;
  /** Optional metode pembayaran ditampilkan di bagian header (mis. "Koin", "QRIS"). */
  paymentMethod?: string | null;
}

export function buildMembershipMessage(opts: MembershipMessageOpts): string {
  const replayLink = opts.replayLink || REPLAY_PORTAL_URL;
  let msg = `━━━━━━━━━━━━━━━━━━\n✅ *Token Membership*\n━━━━━━━━━━━━━━━━━━\n\n🎭 Show: *${opts.showTitle}*\n📦 Tipe: *Membership*`;
  if (opts.paymentMethod) {
    msg += `\n💳 Metode: *${opts.paymentMethod}*`;
  }
  if (opts.durationLabel) {
    msg += `\n⏰ Durasi: *${opts.durationLabel}*`;
  }
  msg += `\n`;
  if (opts.tokenCode) {
    msg += `\n🎫 *Token Membership:* ${opts.tokenCode}\n`;
  }
  if (opts.liveLink) {
    msg += `📺 *Link Nonton:*\n${opts.liveLink}\n`;
  }
  if (opts.groupLink) {
    msg += `\n🔗 *Link Grup:*\n${opts.groupLink}\n`;
  }
  msg += `\n🔄 *Info Replay:*\n🔗 Link: ${replayLink}\n`;
  if (opts.replayPassword) {
    msg += `🔑 Sandi Replay: ${opts.replayPassword}\n`;
  }
  return msg;
}

/* ------------------------------------------------------------------ */
/* Bundle show                                                         */
/* ------------------------------------------------------------------ */

export interface BundleReplayPasswordEntry {
  show_name?: string;
  password?: string;
  [key: string]: unknown;
}

export interface BundleMessageOpts {
  bundleTitle: string;
  tokenCode?: string | null;
  liveLink?: string | null;
  durationLabel?: string | null;
  scheduleDate?: string | null;
  scheduleTime?: string | null;
  bundleReplayPasswords?: BundleReplayPasswordEntry[] | null;
  bundleReplayInfo?: string | null;
  replayLink?: string | null;
  /** Sandi akses tunggal (jika ada). */
  accessPassword?: string | null;
  paymentMethod?: string | null;
}

export function buildBundleMessage(opts: BundleMessageOpts): string {
  const replayLink = opts.replayLink || REPLAY_PORTAL_URL;
  let msg = `━━━━━━━━━━━━━━━━━━\n📦 *Token Bundle Show*\n━━━━━━━━━━━━━━━━━━\n\n🎭 Paket: *${opts.bundleTitle}*`;
  if (opts.paymentMethod) {
    msg += `\n💳 Metode: *${opts.paymentMethod}*`;
  }
  if (opts.durationLabel) {
    msg += `\n⏰ Durasi Token: *${opts.durationLabel}*`;
  }
  msg += `\n`;
  if (opts.tokenCode) {
    msg += `\n🎫 *Token Akses:* ${opts.tokenCode}\n`;
  }
  if (opts.liveLink) {
    msg += `📺 *Link Nonton:*\n${opts.liveLink}\n`;
  }
  if (opts.scheduleDate) {
    msg += `📅 *Jadwal:* ${opts.scheduleDate}${opts.scheduleTime ? " " + opts.scheduleTime : ""}\n`;
  }
  const passwords = Array.isArray(opts.bundleReplayPasswords) ? opts.bundleReplayPasswords : [];
  if (passwords.length > 0) {
    msg += `\n📦 *Sandi Replay Bundle:*\n`;
    for (const entry of passwords) {
      if (entry?.show_name && entry?.password) {
        msg += `  🎭 ${entry.show_name}: *${entry.password}*\n`;
      }
    }
  }
  if (opts.bundleReplayInfo) {
    msg += `\n🎬 *Info Replay:*\n🔗 ${opts.bundleReplayInfo}\n`;
  } else {
    msg += `\n🎬 *Link Replay:*\n🔗 ${replayLink}\n`;
  }
  if (opts.accessPassword) {
    msg += `🔑 Sandi Akses: *${opts.accessPassword}*\n`;
  }
  return msg;
}

/* ------------------------------------------------------------------ */
/* Replay show                                                         */
/* ------------------------------------------------------------------ */

export interface ReplayMessageOpts {
  showTitle: string;
  tokenCode?: string | null;
  /** Tampilkan baris token hanya jika replay punya media internal. */
  hasReplayMedia?: boolean;
  replayLink?: string | null;
  replayPassword?: string | null;
  durationLabel?: string | null;
  paymentMethod?: string | null;
}

export function buildReplayMessage(opts: ReplayMessageOpts): string {
  const replayLink = opts.replayLink || REPLAY_PORTAL_URL;
  let msg = `━━━━━━━━━━━━━━━━━━\n✅ *Token Replay Show*\n━━━━━━━━━━━━━━━━━━\n\n🎭 Show: *${opts.showTitle}*\n📦 Tipe: *Replay*`;
  if (opts.paymentMethod) {
    msg += `\n💳 Metode: *${opts.paymentMethod}*`;
  }
  if (opts.durationLabel) {
    msg += `\n⏰ Durasi: *${opts.durationLabel}*`;
  }
  msg += `\n`;
  msg += `\n🔗 *Link Replay:*\n${replayLink}\n`;
  if (opts.tokenCode && opts.hasReplayMedia) {
    msg += `🎫 *Token Replay:* ${opts.tokenCode}\n`;
  }
  if (opts.replayPassword) {
    msg += `🔐 *Sandi Replay:* ${opts.replayPassword}\n`;
  }
  return msg;
}

/* ------------------------------------------------------------------ */
/* Footer helper                                                       */
/* ------------------------------------------------------------------ */

export const SHARE_WARNING_FOOTER = `\n⚠️ _Jangan bagikan token/link ini ke orang lain._\n━━━━━━━━━━━━━━━━━━\n_Terima kasih!_ 🙏`;
export const PURCHASE_FOOTER = `\n⚠️ _Jangan bagikan token/link ini ke orang lain._\n━━━━━━━━━━━━━━━━━━\n_Terima kasih telah membeli!_ 🙏`;
