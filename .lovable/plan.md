## Masalah

1. **Tidak ada input sandi di kartu replay.** Di `src/pages/ReplayPage.tsx`, jika user belum punya tokens/sandi tersimpan, satu-satunya tombol adalah "Beli Replay". User yang sudah punya sandi (dari WhatsApp, dari teman, atau dari pembelian sebelumnya tapi tidak login) tidak bisa langsung memakainya — mereka harus copy sandi lalu pergi ke `/replay-play`.

2. **User yang sudah beli show saat live, harus beli ulang ketika show jadi replay.** Penyebabnya:
   - `validate_replay_access` (RPC) hanya menerima:
     - kode `replay_tokens` (RT-…), atau
     - sandi global situs.
   - Kode tersebut **tidak memeriksa** `tokens` aktif (RT48-show, MBR-, BDL-) milik user yang sudah membeli show saat live.
   - `get_purchased_show_passwords` sudah benar mengambil sandi show yang dibeli (lewat `coin_transactions` + `tokens`), tapi sandi itu adalah `shows.access_password` (sandi live), **bukan** `replay_password`. Setelah show jadi replay, sandi live tidak otomatis valid di endpoint replay karena `validate_replay_access` tidak men-cross-check `tokens`.
   - Akibatnya user yang sudah punya token live untuk show tersebut tidak bisa login replay tanpa membeli lagi.

## Solusi

### 1. Tambah panel "Punya sandi? Masukkan di sini" di kartu replay
Di `src/pages/ReplayPage.tsx`, untuk setiap kartu show yang **belum** punya `replayPasswords[show.id]` dan **belum** `hasPurchased`, tampilkan di bawah tombol "Beli Replay":

```
┌──────────────────────────────┐
│  Beli Replay                 │  ← tombol existing
├──────────────────────────────┤
│  Sudah punya sandi?          │
│  [_________] [Tonton]        │
└──────────────────────────────┘
```

- Input controlled per-show (state `Record<showId, string>`).
- Tombol "Tonton" memanggil `validate_replay_access({ _password, _show_id: show.id })`. Jika sukses:
  - simpan sandi via `addReplayPassword(show.id, sandi)` agar persist,
  - redirect ke `buildReplayTarget(show, sandi)`.
- Jika gagal: tampilkan toast error "Sandi salah".
- Tampilkan juga panel ini di `BundleShowCard` versi replay (opsional, bila user request).

### 2. Akses replay otomatis untuk user yang sudah beli show live

Update RPC `validate_replay_access` agar mengenali user authenticated yang sudah punya:
- `tokens` aktif untuk `show_id` (per-show token), ATAU
- token universal aktif (`MBR-`, `MRD-`, `BDL-`, `RT48-`) yang berlaku untuk show tersebut, ATAU
- `coin_transactions` dengan `type IN ('redeem','replay_redeem')` dan `reference_id = show.id`.

Ketika `_show_id`/`_short_id` diberikan dan `auth.uid()` punya salah satu hak akses di atas → return `success: true` dengan `access_via='purchased_live_token'` dan `m3u8_url`/`youtube_url` show. Tidak perlu beli ulang.

Tambahkan juga di `ReplayPlayPage.tsx` (`tryAccess`): jika user login dan `_show_id`/`_short_id` ada di URL, cukup panggil RPC tanpa password — RPC otomatis cek token milik user.

### 3. Auto-detect saat membuka kartu di ReplayPage
Saat `usePurchasedShows` sudah load, jika `redeemedTokens[show.id]` ada (artinya user pernah beli show tersebut) tapi `replayPasswords[show.id]` belum, ubah tombol kartu jadi langsung **"Tonton Replay"** (mode `hasPurchased`) yang akan membuka `/replay-play?show=<short_id>` — RPC baru akan menerima akses berdasarkan token aktif user.

## Perubahan File

- `src/pages/ReplayPage.tsx` — tambah panel input sandi di kartu (state per-show, handler validate→redirect); tambah cabang tampilkan "Tonton Replay" bila `redeemedTokens[show.id]` ada.
- `src/pages/ReplayPlayPage.tsx` — saat user login + `show`/`token` di URL kosong-password, panggil RPC tanpa password (RPC akan auto-grant via token aktif).
- `supabase/migrations/<timestamp>_replay_access_recognize_live_purchases.sql` — `CREATE OR REPLACE FUNCTION validate_replay_access` yang memperluas logika: cek `tokens` milik `auth.uid()` (per-show + universal) dan `coin_transactions` (redeem/replay_redeem) untuk show terkait.

## Verifikasi & Checklist

Setelah build, jalankan checklist manual berikut (akan saya tuliskan di komentar PR / chat):

1. **Input sandi di kartu**
   - [ ] Buka `/replay`, kartu show belum dibeli menampilkan field "Sudah punya sandi?"
   - [ ] Masukkan sandi salah → toast error, tetap di halaman.
   - [ ] Masukkan sandi benar → redirect ke `/replay-play` dan video play.

2. **Akses otomatis untuk pembeli live**
   - [ ] User A beli show via koin saat live (token RT48-, dapat sandi access).
   - [ ] Show ditandai `is_replay=true` admin.
   - [ ] User A buka `/replay`, kartu show muncul tombol "Tonton Replay" (bukan "Beli Replay").
   - [ ] Klik → langsung play tanpa minta sandi/beli ulang.

3. **Akses untuk membership/bundle**
   - [ ] User dengan `MBR-` aktif, buka kartu replay → langsung "Tonton Replay" (bila show tidak `exclude_from_membership`).
   - [ ] User dengan `BDL-` aktif untuk show bundle → sama.

4. **Replay token tetap berfungsi**
   - [ ] Token `RT-` lama via link `?token=…` tetap bisa play.
   - [ ] Sandi global tetap berlaku untuk show lain.

5. **Build & test**
   - [ ] `bun run build` sukses tanpa error baru.
   - [ ] `bunx vitest run` hijau (tidak ada test baru yang gagal).
