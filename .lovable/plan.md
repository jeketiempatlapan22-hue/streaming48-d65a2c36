## Masalah Saat Ini

1. **Link `/live?t=...` masih dipakai untuk show yang sudah jadi replay.**
   Sebenarnya `LivePage` sudah punya auto-redirect ke `/replay-play?token=...`, tapi:
   - Tombol "Salin Link" di dashboard reseller selalu menyalin URL `/live?t=...` (tanpa cek status replay show).
   - Saat user buka link `/live?t=...`, redirect baru terjadi setelah `validate_token_access` GAGAL — menambah delay & kadang menampilkan layar error sekejap.

2. **Token reseller HILANG dari riwayat saat show menjadi replay/non-aktif.**
   - Fungsi `validate_replay_access` melakukan `DELETE FROM public.tokens WHERE id = _live_token.id` lalu memindah row ke tabel `replay_tokens`.
   - Migrasi backfill `20260426233449_*` juga `DELETE FROM public.tokens` untuk semua token yang menempel ke show `is_replay=true`.
   - Akibatnya:
     - `reseller_list_my_tokens` (web) — hanya baca dari `public.tokens`, jadi token hilang dari tab "Token" reseller.
     - `reseller_list_recent_tokens_by_id` (WhatsApp `/{prefix}mytokens`) — sama, hilang dari riwayat WA bot.
     - Statistik per-show, hitungan paid/unpaid, dan filter ikut hilang.

3. **`reseller_get_active_shows` memfilter `is_replay = false`** — show replay tidak muncul di tab Show (ini OK karena reseller tidak boleh bikin token baru), tapi kombinasi dengan #2 membuat reseller kehilangan jejak total.

4. **Durasi 14 hari sudah ada** di `validate_replay_access` (auto-upgrade), tapi belum ada jaminan bahwa token yang DIBUAT reseller untuk show yang langsung berstatus replay juga mengikuti aturan yang sama (saat ini direject — bagus untuk penjualan baru, jangan diubah).

## Tujuan

A. Link token otomatis "tahu" diri saat show flip ke replay → langsung arahkan ke `/replay-play?token=<code>` (tanpa mampir ke `/live`).
B. Durasi akses replay = **14 hari** (sudah benar; pastikan konsisten di semua jalur).
C. Riwayat token reseller (web + WhatsApp) tetap kelihatan walau show jadi replay atau non-aktif.

## Rencana Perubahan

### 1. Migrasi DB — Pertahankan jejak token di `public.tokens`

Ubah `validate_replay_access` agar **tidak menghapus** row di `tokens`. Cukup:
- Tambah kolom `tokens.archived_to_replay boolean DEFAULT false` + `tokens.archived_at timestamptz`.
- Saat upgrade: `UPDATE tokens SET archived_to_replay = true, archived_at = now(), status = 'archived'` (jangan DELETE).
- Tetap `INSERT/UPSERT` ke `replay_tokens` (sumber kebenaran untuk akses replay & pemain internal).

Alasan: dua tabel terpisah tetap dipertahankan (RLS replay_tokens dikunci ketat untuk service_role saja), tapi `tokens` jadi **catatan historis** yang aman dibaca reseller via RPC.

Tambahkan juga RPC baru / patch yang sudah ada:

- `reseller_list_my_tokens(_session_token, _limit)` — patch:
  - Tambahkan field `is_replay_show boolean` (cek `s.is_replay`).
  - Tambahkan field `is_archived boolean` = `tk.archived_to_replay OR tk.status = 'archived'`.
  - Tambahkan field `effective_link_kind text` ∈ `'live' | 'replay'` (kalau show `is_replay=true` atau token sudah di-archive → `'replay'`, lain `'live'`).
  - Tambahkan field `replay_expires_at` (lookup `replay_tokens.expires_at` by `code`) — jadi reseller lihat expiry replay 14 hari.
  - Tetap baca dari `tokens` (bukan replay_tokens), karena row tidak lagi dihapus.

- `reseller_list_recent_tokens_by_id(_reseller_id, _limit)` — patch sama (untuk WA `/mytokens`).

### 2. Backfill data yang sudah terlanjur dihapus

Migrasi backfill 1x: untuk setiap row di `replay_tokens` dengan `created_via IN ('auto_backfill','live_upgrade_validate')`, **re-insert** placeholder ke `tokens`:
- `code` = `replay_tokens.code`
- `show_id` = `replay_tokens.show_id`
- `reseller_id` = lookup via `reseller_token_audit` (cocokkan `token_code`) — kalau ketemu, tulis `reseller_id`.
- `status = 'archived'`, `archived_to_replay = true`, `archived_at = replay_tokens.created_at`, `expires_at = replay_tokens.expires_at`, `max_devices = 1`.
- `ON CONFLICT (code) DO NOTHING` (token aktif yang masih hidup tidak ditimpa).

Tujuan: history reseller pre-existing kembali muncul setelah migrasi.

### 3. Frontend — Auto-arahkan link salin & tombol watch ke replay

- `src/components/reseller/ResellerShowCard.tsx`:
  - Saat membangun `link` untuk pesan WA & tombol salin: kalau `show.is_replay === true`, gunakan `REPLAY_BASE` (`/replay-play?token=...`) — bukan `/live?t=...`. (Saat ini reseller tidak bisa create token baru untuk replay show, jadi efeknya hanya saat menampilkan token yang sudah ada — relevan setelah perubahan #4.)
- `src/components/reseller/ResellerDashboard.tsx`:
  - Tombol "Salin" gunakan field baru `effective_link_kind`:
    - `'replay'` → salin `https://realtime48stream.my.id/replay-play?token=<code>`.
    - `'live'` → tetap `/live?t=<code>`.
  - Badge baru "🔁 Replay (14 hari)" untuk token yang `is_archived || is_replay_show`.
  - Hapus filter yang otomatis menyembunyikan token "expired"-tapi-archived; archived token boleh tampil di tab "Semua".
  - Update label mentah `expires_at` → tampilkan `replay_expires_at` jika `effective_link_kind = 'replay'`.

### 4. Frontend — Buyer side (ViewerProfile, MembershipDetailCard)

- `src/pages/ViewerProfile.tsx` (3 tempat `/live?t=`) & `MembershipDetailCard onWatchLive`: saat token punya flag (akan ditambah ke RPC `get_my_active_tokens` / `usePurchasedShows`) `is_replay_show=true`, navigate ke `/replay-play?token=...` bukan `/live?t=...`.
- Patch RPC sumber data di `usePurchasedShows` agar ikut bawa flag yang sama (tidak perlu RPC baru — cukup join sederhana).

### 5. Edge functions — Pesan template

- `supabase/functions/whatsapp-webhook/index.ts` & `telegram-poll/index.ts`:
  - Pada saat membangun pesan token (bagian `liveLink = ${siteUrl}/live?t=${code}`), tambahkan note default:
    > "🎬 Setelah show selesai, link yang sama otomatis berlaku sebagai REPLAY selama 14 hari."
  - Tidak perlu mengubah URL — `LivePage` sudah meng-redirect; tapi kita bisa tambah satu baris untuk URL alternatif `${siteUrl}/replay-play?token=${code}` agar user yang share link manual juga punya rute langsung.

## File Yang Disentuh

- `supabase/migrations/<new>__keep_reseller_history_and_replay_routing.sql` (baru)
- `src/components/reseller/ResellerDashboard.tsx`
- `src/components/reseller/ResellerShowCard.tsx`
- `src/pages/ViewerProfile.tsx`
- `src/components/viewer/MembershipDetailCard.tsx`
- `src/hooks/usePurchasedShows.ts` (jika perlu propagate `is_replay_show`)
- `supabase/functions/whatsapp-webhook/index.ts` (pesan + opsi link replay)
- `supabase/functions/telegram-poll/index.ts` (pesan + opsi link replay)

## Hal Yang TIDAK Diubah

- Aturan "reseller dilarang membuat token baru untuk show `is_replay=true`" dipertahankan (tetap di `reseller_create_token` & `_by_id`).
- `reseller_get_active_shows` tetap filter `is_replay=false` (tab "Show" hanya untuk show yang bisa dijual).
- Skema `replay_tokens` tetap tertutup untuk public/anon (RLS tidak diubah).
- Durasi default 14 hari di `validate_replay_access` sudah benar — tidak diubah.

## Hasil yang Diharapkan

- Link token (`/live?t=<code>`) untuk show yang sudah jadi replay otomatis dialihkan ke `/replay-play?token=<code>` dengan akses 14 hari.
- Tombol "Salin" di dashboard reseller langsung memberi link `/replay-play?token=...` untuk show replay (tidak perlu redirect manual).
- Tab "Token" reseller (web) & command `/{prefix}mytokens` (WA) tetap menampilkan SEMUA token historis — termasuk yang shownya sudah replay/non-aktif — dengan label jelas "🔁 Replay 14 hari" + expiry yang akurat.
