## Tujuan

Mengganti kartu "👑 Membership" sederhana di `ViewerProfile.tsx` dengan kartu detail bergaya seperti gambar referensi — khusus untuk token bertipe **MBR-/MRD-** (membership murni). Kartu Bundle (BDL-) dan Custom (RT48-) tetap pakai tampilan ringkas yang sudah ada.

## Tampilan yang akan dibangun

```text
┌─ Membership Aktif ───────────────────[AKTIF]┐
│ 👑  Nikmati akses premium ke semua show!    │
│                                              │
│ Sisa waktu                       29 / 33 hari│
│ ████████████████████████████░░░░             │
│                                              │
│ ┌──────┐ ┌──────┐ ┌──────────┐ ┌──────────┐ │
│ │📅    │ │⏰    │ │🎬        │ │🛡️        │ │
│ │Durasi│ │ Sisa │ │Akses Show│ │ Status    │ │
│ │33 hr │ │29 hr │ │  4 show  │ │ Premium   │ │
│ └──────┘ └──────┘ └──────────┘ └──────────┘ │
│                                              │
│ ┌────────┐ ┌────────┐ ┌──────────┐          │
│ │ Mulai  │ │Berakhir│ │  Harga   │          │
│ │26 Apr  │ │28 Mei  │ │Rp 28.000 │          │
│ └────────┘ └────────┘ └──────────┘          │
│                                              │
│ [▶  Tonton Live Sekarang]                    │
└──────────────────────────────────────────────┘
```

Warna: gradient kuning/emas (mirip yang sudah dipakai untuk membership), glassmorphism, dengan 7 sub-kartu kecil bergaya "stat tile" (border halus + bg gelap).

## Komponen baru

`src/components/viewer/MembershipDetailCard.tsx`
- Props: `token` (row dari tabel `tokens`), `showCount: number`, `purchasePrice?: string | null`, `onWatchLive: () => void`.
- Hitung:
  - `durationDays` = `(expires_at - issued_at)` dalam hari (jatuh balik `created_at` jika `issued_at` kosong)
  - `daysLeft` = `(expires_at - now)` dalam hari (clamp >= 0)
  - `progress` = `daysLeft / durationDays` (untuk lebar bar)
  - Format tanggal Indonesia (`toLocaleDateString("id-ID", ...)`)
  - Format harga via util yang ada (atau format manual `Rp xx.xxx`)
- Badge status: hijau "AKTIF" bila `daysLeft > 0`, merah "KEDALUWARSA" bila habis.
- Bar warna: kuning (`>7 hari`), oranye (`3–7 hari`), merah (`<=3 hari`).
- Tombol "Tonton Live Sekarang" → memanggil `onWatchLive` (navigate ke `/live?t=<code>`).

## Perubahan di `src/pages/ViewerProfile.tsx`

1. **Ambil data tambahan** saat load:
   - Hitung `membershipShowCount`: jumlah baris dari `get_public_shows()` yang punya `is_subscription = true` DAN `is_active`. Bisa dipakai juga `get_membership_show_passwords()` length untuk hitung "akses show" (lebih akurat karena cocok dgn akses nyata).
   - Cari `purchasePrice` membership: query `subscription_orders` `(price, coin_amount, payment_method)` paling baru `status='confirmed'` untuk show membership terkait token tsb. Fallback: ambil `coin_orders` baru bila membership dibeli via koin (tampilkan `xxx koin`).
2. **Refactor blok "Membership/Bundle Duration Card"** (baris 256–322):
   - Pisahkan token jadi 3 bucket:
     - Membership murni → render `<MembershipDetailCard />` baru (besar, kaya info).
     - Bundle (BDL-) → tetap render kartu kompak yang sudah ada.
     - Custom (RT48-) → tetap render kartu kompak yang sudah ada.
   - Bila user punya >1 membership aktif, tampilkan semua kartu detail berurutan.
3. **Pertahankan**:
   - Logika realtime token (DELETE/UPDATE) yang sudah ada.
   - Tab `Membership` di TabBar (tidak diubah).

## Detail teknis

- File baru: `src/components/viewer/MembershipDetailCard.tsx` (lazy-load via `React.lazy` agar konsisten dgn pola di profil).
- Gunakan token yg sudah ada di state `tokens`. Tidak perlu query baru kecuali untuk `purchasePrice` & `showCount` (1 query masing-masing, dijalankan paralel di `Promise.allSettled` yang sudah ada).
- Data `issued_at` ada di tabel `tokens` (cek; jika tidak, fallback ke `created_at`).
- Tetap pakai util `framer-motion` + class `glass` agar selaras tema neon/cyberpunk.
- Tidak perlu migrasi DB.
- Tidak perlu perubahan di `MembershipPage.tsx`, edge function, atau RPC.

## Yang TIDAK berubah

- Halaman `/membership` (pembelian).
- Tab navigasi profil & isi tab lain (Riwayat, Order, Token, Statistik).
- Logika redeem/expiry/notifikasi WhatsApp.
- Bundle & Custom token tetap kartu kompak.

## QA singkat setelah implementasi

- User tanpa membership → kartu tidak muncul (sama spt sekarang).
- User dgn membership aktif → kartu detail muncul, progress bar sesuai, tombol tonton live navigasi benar.
- User dgn membership <=3 hari → progress bar merah + label warning.
- User dgn membership kedaluwarsa → badge "Kedaluwarsa", tombol disable.
- User dgn membership + bundle → 1 kartu detail + 1 kartu bundle kompak.
