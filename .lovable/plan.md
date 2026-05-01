## Masalah

Reseller tidak bisa membuat token (baik via bot WhatsApp `/Otoken` maupun via dashboard web) untuk show yang sebenarnya **sudah memiliki tanggal & jam lengkap**. Contoh nyata di database:

- `Jumat,  1 Mei 2026` + `19.00 WIB`
- `Sabtu, 2 Mei 2026` + `19.00 WIB`
- `Minggu, 3 Mei 2026` + `19.00 WIB`

Sistem tetap menolak dengan pesan **"Show belum punya jadwal lengkap (tanggal & jam). Token tidak dapat dibuat."**

## Akar Penyebab

Fungsi database `parse_show_datetime(_date, _time)` dipanggil oleh kedua RPC `reseller_create_token` (web) dan `reseller_create_token_by_id` (bot WA). Jika fungsi mengembalikan `NULL`, RPC menolak pembuatan token.

Fungsi tersebut hanya mengenali dua format tanggal:
1. Format ISO `YYYY-MM-DD` (misal `2026-05-01`)
2. Format Indonesia *tanpa* nama hari, persis 3 token: `DD Bulan YYYY` (misal `1 Mei 2026`)

Tanggal yang berisi prefix nama hari + koma (format yang dipakai admin di Show Manager: `Jumat, 1 Mei 2026`, `Sabtu, 2 Mei 2026`, dst) **gagal di kedua cabang**:
- Cabang ISO melempar exception lalu di-swallow → variabel jam/menit tetap NULL
- Cabang fallback memecah string jadi 4 elemen (`["jumat,","1","mei","2026"]`), bukan 3 → kondisi `array_length = 3` gagal → return NULL

Hasilnya RPC mengira show tidak punya jadwal, padahal jadwal lengkap.

Bukti dari log audit: 7 penolakan terakhir semua bertipe `show_no_schedule` untuk show yang jadwalnya sudah diisi admin.

Show kedua yang juga gagal — `SPESIAL SHOW JKT48 WITH POCKY` — memang `schedule_time`-nya kosong; itu kasus terpisah dan benar ditolak. Yang harus diperbaiki adalah show dengan jadwal lengkap tapi pakai prefix nama hari.

## Perbaikan

### 1. Migrasi database — perbaiki `parse_show_datetime`

Tulis ulang fungsi agar tahan banting terhadap variasi format tanggal Indonesia:

- **Normalisasi input**: lower-case, hapus prefix nama hari Indonesia opsional (`senin/selasa/rabu/kamis/jumat/sabtu/minggu/ahad`) beserta koma di depannya, rapikan whitespace ganda.
- **Parse jam dulu** (sekali) sebelum mencoba kombinasi format tanggal, supaya nilai `_hour`/`_minute` tersedia di semua cabang.
- **Coba format ISO** `YYYY-MM-DD`.
- **Coba format Indonesia 3-token** `D[D] Bulan YYYY` setelah dinormalisasi, dengan map bulan yang sudah ada (`januari`–`desember`). Toleran pada spasi ganda dan zero-pad opsional pada hari.
- Tetap return `NULL` hanya jika tanggal/jam benar-benar kosong atau tidak bisa dipahami sama sekali.

Karena fungsi ini `IMMUTABLE` dan dipakai banyak RPC lain (`reseller_create_token`, `reseller_create_token_by_id`, kemungkinan logic show aktif), perubahan dilakukan via `CREATE OR REPLACE FUNCTION` tanpa mengubah signature.

### 2. Validasi pasca-migrasi

Setelah migrasi:
- Jalankan `SELECT parse_show_datetime(...)` untuk seluruh sampel: `Jumat, 1 Mei 2026`, `Sabtu, 2 Mei 2026`, `Minggu, 3 Mei 2026` dengan `19.00 WIB` → harus mengembalikan timestamp valid.
- Pastikan format ISO `2026-05-01` + `19:00` tetap bekerja (regression).
- Pastikan input kosong tetap mengembalikan `NULL`.
- Coba simulasikan satu pemanggilan `reseller_create_token_by_id` (read-only via `SELECT` ke RPC) untuk show "Cara Meminum Ramune" → harus sukses, bukan `show_no_schedule`.

### 3. Tidak ada perubahan di sisi UI/edge function

Webhook WhatsApp dan komponen reseller di front-end tidak perlu diubah — mereka sudah meneruskan error apa adanya. Begitu fungsi parse benar, alur `/Otoken` dan tombol "Buat Token Baru" akan langsung berfungsi untuk show-show ini.

## Catatan untuk admin

Untuk show `SPESIAL SHOW JKT48 WITH POCKY` yang `schedule_time`-nya memang masih kosong, admin tetap perlu mengisi jam di Show Manager — itu validasi yang benar dan tidak akan diubah.

## File yang diubah

- Migrasi baru di `supabase/migrations/` yang me-replace fungsi `public.parse_show_datetime(text, text)`.
