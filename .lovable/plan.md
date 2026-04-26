
# Sistem Replay Terintegrasi (In-App)

Membangun fitur replay lengkap di dalam aplikasi: admin tinggal isi link M3U8 + link YouTube pada kartu show; user yang sudah membeli show otomatis bisa menonton replay tanpa keluar dari domain; ada sandi global per bulan; token replay terpisah agar tidak tercampur token live aktif; single-device lock dengan reset 3x/hari + auto-reset 24 jam.

---

## 1. Halaman Pemutar Replay Baru (`/replay-play`)

Halaman pemain replay internal (tidak lagi membuka `replaytime.lovable.app`).

**Cara akses:**
- Otomatis dibuka dari kartu show di `/replay` setelah user beli (koin / QRIS / token live yang menjadi replay).
- Bisa juga dibuka via URL token (mis. `/replay-play?token=ABC123` atau `/replay-play?show=<short_id>&password=...`).

**Behavior pemutar:**
- M3U8 → pakai HLS.js dengan **selector kualitas** (auto / 240p / 360p / 480p / 720p / 1080p, sesuai level dari manifest).
- YouTube → embed dengan parameter `controls=0&modestbranding=1&rel=0&fs=0&iv_load_policy=3&disablekb=1`, **overlay transparan menutup iframe** sehingga klik tidak menembus ke YouTube; play/pause/volume/fullscreen dihandle tombol custom; minta resolusi tertinggi (`vq=hd1080`).
- Fallback: kalau show belum punya M3U8/YouTube → arahkan ke `https://replaytime.lovable.app` (perilaku lama).

**Single-device lock:**
- Sebelum playback, panggil `create_replay_session(_token, _fingerprint, _user_agent)`.
- Tampilkan pesan user-friendly:
  - 🔒 "Sesi terkunci di perangkat lain. Reset perangkat (sisa N/3 hari ini)."
  - ⏰ "Akses replay sudah berakhir."
  - ❌ "Sandi/token salah."
- Tombol "Reset perangkat" → panggil `self_reset_replay_session` (limit 3x/24 jam, auto-reset window 24 jam).

---

## 2. Perubahan Database (kolom & tabel baru)

**Tambahan kolom di `shows`:**
- `replay_m3u8_url text` — link M3U8 untuk replay
- `replay_youtube_url text` — link YouTube untuk replay
- `replay_month text` — format `YYYY-MM` (mis. `2026-04`); auto-isi dari `schedule_date` saat show dijadikan replay, bisa diedit admin.

**Tabel baru `replay_tokens`:**
Token replay terpisah dari tabel `tokens` agar tidak terlihat di Admin TokenFactory.
- `code text unique`, `show_id uuid`, `password text`, `expires_at timestamptz`, `created_via text` (`coin` / `qris` / `live_upgrade` / `manual`), `user_id uuid nullable`, `phone text nullable`, `created_at`.
- RLS: `service_role` & admin bisa baca, anon `false`.

**Tabel baru `replay_token_sessions`:**
Single-device lock khusus replay (terpisah dari `token_sessions`).
- `token_code text`, `fingerprint text`, `user_agent text`, `created_at`, `last_seen_at`, `is_active`.
- Index unik (token_code, is_active=true).

**Tambahan `site_settings` (key/value):**
- `replay_global_password__YYYY-MM` → sandi global untuk bulan tersebut (mis. `replay_global_password__2026-04 = REPLAY-APR26`).
- `replay_global_password_default` (fallback bila bulan tertentu tidak diatur).
- Admin UI menyediakan editor jadwal sandi (per bulan/tahun atau range tanggal).

---

## 3. RPC Baru / Update

- `validate_replay_access(_token text, _password text, _show_id uuid, _fingerprint text)` → returns `{ success, m3u8_url, youtube_url, show_title, expires_at, error }`.
  - Validasi prioritas: (a) token replay aktif & belum expired, (b) sandi show, (c) sandi global bulan, (d) token live aktif yang show-nya sudah `is_replay=true`.
- `create_replay_session(_token, _fingerprint, _user_agent)` → enforce 1 fingerprint aktif/token.
- `self_reset_replay_session(_token, _fingerprint)` → 3x per 24 jam via `check_rate_limit`.
- `redeem_coins_for_replay` di-update: selain return password, juga **buat row di `replay_tokens`** dengan expires sesuai durasi (default 7 hari, configurable).
- `create_show_order` callback (`pakasir-callback`) untuk replay → buat `replay_tokens` saat status `paid`.
- Trigger pada `shows`: ketika `is_replay` berubah false→true → semua token live aktif untuk show itu di-migrate ke `replay_tokens` (tetap valid sampai `expires_at`), dan **harga QRIS di tampilan otomatis pakai `replay_qris_price`**.
- `get_public_shows` → tambahkan `has_replay_media boolean` (true jika M3U8/YouTube terisi) supaya frontend tahu pakai pemain internal vs external.

---

## 4. Perubahan Admin Panel (`ShowManager`)

Pada form edit show, tambahkan **section "🎬 Replay Media"** yang **selalu tampil** (tidak menunggu toggle replay aktif):
- Input `Link M3U8 Replay`
- Input `Link YouTube Replay`
- Tombol "Buka Pemain Replay" (preview)

Section "Sandi Replay Global per Bulan":
- Tabel: bulan (YYYY-MM) → sandi.
- Tombol tambah, edit, hapus per entri.
- Field opsional "Berlaku dari tanggal" untuk membuat sandi yang aktif mulai tanggal tertentu.

**Kartu show admin:**
- Bila M3U8 / YouTube belum diisi → badge "🔗 Eksternal" + tetap arahkan tombol preview ke `replaytime.lovable.app`.
- Bila sudah diisi → badge "🎬 In-App Player".

---

## 5. Perubahan ReplayPage Frontend

- Untuk show `is_replay`:
  - Bila punya media internal → tombol berubah menjadi "▶️ Tonton Replay (In-App)" → buka `/replay-play?show=<id>` (autofill sandi dari `replayPasswords[show.id]` atau token user).
  - Bila tidak ada media internal → perilaku lama (salin sandi & buka `replaytime.lovable.app`).
- Daftar dipisah per bulan (group by `replay_month` dari `schedule_date`):
  - Header: "🗓️ April 2026", "Maret 2026", dll. (dari terbaru).
  - Tampilkan info "Sandi Global Bulan Ini: ******" (hanya tombol "Lihat" untuk user yang sudah punya akses bulan tsb).

---

## 6. Token Live → Akses Replay

Saat admin men-toggle `is_replay = true`:
- Trigger DB memindahkan semua `tokens` aktif untuk `show_id` itu menjadi entry `replay_tokens` (kode sama, expires sama).
- Token live tersebut **dihapus dari tabel `tokens`** (atau status di-set `archived_replay`) sehingga tidak muncul di Admin TokenFactory.
- User yang punya link `/live?token=XXX` masih bisa menonton: `LivePage` akan deteksi token sudah dipindah → redirect otomatis ke `/replay-play?token=XXX`.

---

## 7. Perubahan Pesan & Bot

- Pesan WhatsApp di `whatsapp-webhook` (admin reply purchase, fulfilment) di-update:
  - Ganti `https://replaytime.lovable.app` → `https://realtime48stream.my.id/replay-play?token=<code>` bila token tersedia, atau tetap fallback eksternal.
  - Tambahkan info "Sandi Global Bulan: …" untuk user dengan akses bulanan.
- `ResellerShowCard.tsx` → ganti link & deskripsi sesuai pemain internal.
- Update teks di FAQ singkat tentang replay.

---

## 8. Detail Teknis (untuk developer)

```
File baru:
  src/pages/ReplayPlayPage.tsx          ← halaman pemain
  src/components/replay/HlsReplayPlayer.tsx   ← M3U8 + quality selector
  src/components/replay/YoutubeReplayPlayer.tsx  ← iframe + overlay anti-klik
  src/components/admin/ReplayGlobalPasswordManager.tsx
  supabase/migrations/<ts>_replay_system.sql

File diubah:
  src/App.tsx                           ← route /replay-play
  src/pages/ReplayPage.tsx              ← group bulan, tombol in-app
  src/pages/LivePage.tsx                ← redirect token archived ke /replay-play
  src/components/admin/ShowManager.tsx  ← input M3U8/YouTube + month
  src/components/admin/TokenFactory.tsx ← filter agar replay_tokens tidak muncul (sudah otomatis karena tabel terpisah)
  src/components/reseller/ResellerShowCard.tsx
  supabase/functions/whatsapp-webhook/index.ts
  supabase/functions/pakasir-callback/index.ts
  supabase/functions/notify-coin-show-purchase/index.ts
```

**HLS quality selector**: pakai `hls.levels` + dropdown set `hls.currentLevel`.
**YouTube anti-click overlay**: `<div class="absolute inset-0 z-10 pointer-events-auto">` di atas iframe + tombol kontrol custom yang panggil `postMessage` ke YouTube IFrame API.
**Cron**: tambahkan ke maintenance cron untuk hapus `replay_tokens` yang `expires_at < now() - 7 days` dan `replay_token_sessions` lebih dari 24 jam tidak aktif.

---

## 9. Pertanyaan yang akan diasumsikan (revisi bila perlu)

- Durasi default token replay (saat dibuat dari koin/QRIS): **7 hari**.
- Sandi global bulan default: kosong (admin harus set; jika kosong, jatuh ke sandi per-show).
- Token live yang sudah expired tidak ikut dipindah ke `replay_tokens`.
- Replay group per bulan menggunakan `schedule_date` show.
