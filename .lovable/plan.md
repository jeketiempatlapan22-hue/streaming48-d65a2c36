## Tujuan

1. Pastikan setiap token akses replay memiliki durasi **14 hari** sejak pembelian/aktivasi, dan otomatis terhapus dari database setelah expired.
2. Pastikan user tetap dapat mengakses replay menggunakan token link lama (dari halaman live) tanpa perlu link baru.
3. Pindahkan posisi player video ke **atas** kartu lineup member di halaman `/replay-play`.

---

## Status saat ini (hasil audit)

- Trigger `migrate_tokens_on_replay_flip` **sudah** memindahkan token live aktif ke `replay_tokens` dengan masa berlaku **14 hari** ketika show diubah ke replay.
- `LivePage` **sudah** mendeteksi token yang sudah dimigrasikan dan otomatis redirect ke `/replay-play?token=...`.
- Cron `replay-cleanup-daily` (01:00 WIB) **sudah** menjalankan `cleanup_replay_artifacts()` yang menghapus `replay_tokens` setelah `expires_at`.
- **Masalah ditemukan:** fungsi `redeem_coins_for_replay` masih membuat token replay dengan durasi **7 hari** (tidak konsisten dengan kebijakan 14 hari).
- **Masalah UI:** di `ReplayPlayPage.tsx`, lineup member ditampilkan di atas player; user ingin player di atas.

---

## Perubahan yang akan dilakukan

### 1. Database — konsistensi durasi 14 hari (migrasi baru)

- Update `redeem_coins_for_replay`: ubah `_duration_days := 7` menjadi `14`.
- Tambahkan safety net: update one-time semua `replay_tokens` aktif yang `expires_at`-nya kurang dari 14 hari setelah `created_at` (hanya yang dibuat via `coin`) agar disesuaikan ke `created_at + 14 hari` jika belum lewat.
- Verifikasi `migrate_tokens_on_replay_flip` tetap memakai `now() + interval '14 days'` (tidak diubah, hanya dikonfirmasi).
- Verifikasi `cleanup_replay_artifacts` dijadwalkan harian (sudah ada — tidak diubah).

### 2. Player di atas Lineup — `src/pages/ReplayPlayPage.tsx`

Restruktur urutan render saat `access.success && has_media`:

```text
[Header: judul + badge akses + jadwal]
[Selector sumber tonton (Auto / M3U8 / YouTube)]   ← dipindah ke atas player
[Player M3U8 / YouTube]                             ← naik di atas lineup
[Kartu Lineup Member]                               ← turun di bawah player
[Info "Akses berlaku sampai ..."]
```

- Lineup avatars dipindah keluar dari header card menjadi card terpisah di bawah player.
- Header card tetap menampilkan judul + jadwal + badge akses (tanpa lineup di dalamnya).

### 3. Tidak ada perubahan pada alur token live

Token link lama (`/live?t=CODE`) tetap berfungsi karena `LivePage` sudah otomatis mendeteksi & redirect ke `/replay-play?token=CODE`. Jadwal cleanup juga tetap berjalan sehingga token expired terhapus dari DB.

---

## Detail teknis

**Migrasi SQL:**
- `CREATE OR REPLACE FUNCTION public.redeem_coins_for_replay(...)` dengan `_duration_days := 14`.
- One-time `UPDATE public.replay_tokens SET expires_at = created_at + interval '14 days' WHERE created_via = 'coin' AND status = 'active' AND expires_at < created_at + interval '14 days'` agar token koin existing yang masih aktif diperpanjang menjadi 14 hari.

**File yang dimodifikasi:**
- `supabase/migrations/<new>.sql` (baru) — fix durasi `redeem_coins_for_replay` + backfill expiry.
- `src/pages/ReplayPlayPage.tsx` — re-order layout (player di atas lineup, selector source di atas player).

**File yang TIDAK diubah** (sudah benar):
- `migrate_tokens_on_replay_flip` (sudah 14 hari).
- `cleanup_replay_artifacts` & cron (sudah harian).
- `LivePage.tsx` redirect logic (sudah ada).