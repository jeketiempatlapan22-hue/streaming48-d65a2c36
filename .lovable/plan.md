## Masalah

Form sandi pada kartu replay (di bawah tombol beli) tidak benar-benar membuka kartu lain ketika user mengetik sandi **bulanan / global / master** yang sudah diatur admin. Akar masalahnya ada di **database**, bukan di frontend.

### Akar masalah

- Admin panel (`ReplayGlobalPasswordManager.tsx`) menyimpan sandi global di `site_settings` dengan key berpola:
  - `replay_global_password__all` (master)
  - `replay_global_password__YYYY-MM` (bulanan)
  - `replay_global_password__YYYY-MM-DD` (harian)
- Tetapi RPC `validate_replay_access` **hanya mengecek satu key lama** `replay_global_password` (tanpa suffix). Akibatnya:
  - Sandi bulanan/master/harian dari admin panel **tidak pernah terdeteksi** sebagai global → response `success:false`.
  - Frontend menampilkan toast "Sandi salah", padahal sandi benar.
  - Logika bulk-unlock di `submitReplayPassword` (yang sudah ada) tidak pernah dieksekusi karena RPC menolak sandi.

Frontend `ReplayPage.submitReplayPassword` sebenarnya sudah benar: jika RPC mengembalikan `access_via='global_password'` dengan `global_scope` master/monthly/daily, ia memanggil `addReplayPassword` ke semua show yang cocok scope-nya. Yang perlu diperbaiki hanyalah **RPC** agar mengenali key-key baru.

---

## Rencana Perbaikan

### 1) Migration: perluas RPC `validate_replay_access`

Tambah block baru sebelum block "global password" lama, urutan pengecekan sandi global:

1. **Master** — ambil `site_settings.value` untuk key `replay_global_password__all`. Jika cocok dengan `_password`, return `access_via='global_password'`, `global_scope='master'`.
2. **Daily** — hitung `day_key = to_char(schedule_date::date, 'YYYY-MM-DD')` dari `_show`. Cek key `replay_global_password__{day_key}`. Jika cocok → `global_scope='daily'`.
3. **Monthly** — hitung `month_key`:
   - Pakai `_show.replay_month` jika sudah berformat `YYYY-MM`, else turunkan dari `schedule_date`.
   - Cek key `replay_global_password__{month_key}`. Jika cocok → `global_scope='monthly'`.
4. Block lama (`replay_global_password` tanpa suffix) tetap dipertahankan sebagai fallback `global_scope='default'` agar kompatibel.

Semua hasil mengembalikan field yang sama (`show_id`, `show_title`, `m3u8_url`, `youtube_url`, `has_media`, `global_scope`) sehingga frontend tidak perlu diubah.

Catatan keamanan: masih `SECURITY DEFINER`, `search_path = public`. Tetap mensyaratkan `_show.id IS NOT NULL` (sandi global divalidasi dalam konteks satu show, tetapi frontend lalu menyebarkan ke shows lain di scope yang sama).

### 2) Tidak perlu mengubah frontend

`src/pages/ReplayPage.tsx` sudah memiliki:
- Field input sandi per kartu di bawah tombol beli.
- Logika bulk-unlock `monthly` / `master` / `daily` setelah RPC sukses.
- Toast "Sandi global aktif — N replay terbuka...".
- Redirect ke `/replay-play?show=...&password=...` untuk show yang diklik.

Setelah RPC diperbaiki, alur ini langsung berfungsi: input sandi bulanan di kartu A → RPC return `monthly` → semua kartu di bulan yang sama tersimpan password-nya di `replayPasswords` (localStorage) → tombol "Tonton Replay" muncul tanpa perlu input ulang.

### 3) (Opsional) Hint UI lebih jelas

Jika perlu, perjelas placeholder pada input sandi: "Sandi show / bulanan / master" — sebagian sudah ada. Tidak wajib untuk perbaikan ini.

---

## File yang akan diubah

- **Migration baru** — `ALTER FUNCTION public.validate_replay_access(...)` (CREATE OR REPLACE) untuk mendeteksi tiga pola key baru.

Tidak ada perubahan TypeScript yang diperlukan.

---

## Verifikasi

1. Admin → ReplayGlobalPasswordManager: buat sandi bulanan untuk bulan show "Pajama Drive" (mis. `2026-04` = `RT48-APR`).
2. Halaman `/replay`: pada kartu Pajama Drive, input `RT48-APR` → submit.
3. Toast "Sandi global aktif — N replay terbuka untuk bulan ini." muncul.
4. Kartu lain di bulan yang sama langsung menampilkan tombol **Tonton Replay** (tanpa input ulang) dan membuka `/replay-play` dengan password tersebut.
5. Test sandi master (key `__all`) → semua kartu replay terbuka.
6. Sandi salah → tetap menampilkan toast "Sandi salah".
