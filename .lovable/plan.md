# Bulk Import Show dari Pesan WhatsApp

Tambahkan fitur di **Show Manager** agar admin bisa membuat banyak show sekaligus hanya dengan menempelkan blok pesan format WhatsApp (judul, tanggal, jam, lineup). Show otomatis dibuat sebagai draft, lalu admin tinggal melengkapi harga, koin, dan tim untuk masing-masing.

## Yang akan dibangun

1. **Tombol baru "Impor Cepat"** di header daftar show (di samping tombol "Tambah Show").
2. **Dialog Impor**: textarea besar untuk paste pesan, tombol **Pratinjau**, lalu daftar hasil parsing yang bisa di-edit/buang sebelum disimpan.
3. **Parser** yang mengenali baris berformat:
   - `🎪 <Judul> [- Team Love/Dream/Passion]` (judul wajib; team opsional, di-deteksi dari kata "Team Love/Dream/Passion")
   - `🗓️ <Hari, DD Bulan YYYY>` → disimpan apa adanya ke `schedule_date` (mengikuti pola yang dipakai sekarang, mis. "1 Mei 2026" atau "Jumat, 1 Mei 2026")
   - `🕖 / 🕑 <HH.MM WIB>` → `schedule_time` apa adanya
   - `👥 <nama1, nama2, ...>` atau `👥 -` → `lineup` (kalau "-" jadi string kosong)
   - Pemisah antar show: baris kosong **atau** kemunculan emoji 🎪 berikutnya. Tanda `*...*` (bold WhatsApp) di-strip.
4. **Pratinjau editable**: tiap show muncul sebagai card kecil dengan field Judul, Tanggal, Jam, Lineup, dan dropdown **Team** (Passion/Dream/Love/–) yang sudah di-prefill jika terdeteksi dari judul. Admin bisa centang/uncentang show yang akan dibuat.
5. **Aksi "Buat Semua"**: insert batch ke tabel `shows` memakai default yang sama dengan `createShow` saat ini (`price: "Rp 0"`, `coin_price: 0`, `replay_coin_price: 0`, `qris_price: 0`, `replay_qris_price: 0`, `category: "regular"`, `is_active: true`, dst). Field harga/koin sengaja **tidak** ditanyakan di dialog—admin mengisinya lewat editor show seperti biasa.
6. **Setelah sukses**: dialog ditutup, daftar show di-refresh, toast "X show berhasil dibuat. Lengkapi harga & koin di tiap show."

## Aturan parser (detail teknis)

- Strip karakter bold `*` dan whitespace berlebih per baris.
- Deteksi judul: baris yang diawali `🎪`. Jika mengandung ` - Team <X>` di akhir, ekstrak team (`love|dream|passion`, case-insensitive) → set `team`, dan buang potongan team dari judul.
- Tanggal: baris diawali `🗓️`.
- Jam: baris diawali jam emoji apapun di rentang 🕐–🕧 (regex `/^[\u{1F550}-\u{1F567}]/u`) → ambil teks setelah emoji.
- Lineup: baris diawali `👥`. Jika isi `-` → kosong. Selain itu disimpan sebagai teks (koma-separated).
- Show dianggap valid jika minimal punya judul. Tanggal/jam/lineup boleh kosong (akan ditandai kuning di pratinjau sebagai pengingat).
- Tidak ada show yang di-skip diam-diam—blok yang gagal di-parse tetap ditampilkan dengan pesan error agar admin bisa perbaiki manual.

## Alur singkat

```text
[Tombol "Impor Cepat"]
        |
        v
[Dialog: textarea pesan WA] ---Pratinjau--> [List card editable + checkbox]
                                                   |
                                                   v
                                         [Buat Semua] --> insert batch --> refresh
```

## File yang diubah

- `src/components/admin/ShowManager.tsx` — tambah state dialog, tombol header, dialog pratinjau, dan handler insert batch.
- `src/lib/parseShowImport.ts` *(baru)* — fungsi murni `parseShowImport(text): ParsedShow[]` + tipe, mudah diuji ulang.

## Yang TIDAK termasuk

- Tidak menambah field DB baru.
- Tidak menyentuh alur reseller / WhatsApp bot.
- Tidak mengisi harga/koin/QRIS otomatis—itu tetap dilakukan admin per-show seperti sekarang (sesuai permintaan).
