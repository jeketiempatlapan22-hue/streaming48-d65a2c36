

## Plan: Loading Animation + Quality Lock + Integrasi QRIS Dinamis Pak Kasir

### 1. Perbaikan Loading Animation (VideoPlayer.tsx)

**Masalah**: `isLoading` dimulai `false` — untuk YouTube tidak pernah di-set `true` di awal, sehingga tidak ada animasi loading saat player memuat.

**Perubahan**:
- Set `isLoading = true` saat efek YouTube dimulai (sebelum `loadYTApi`)
- Set `isLoading = true` saat efek Cloudflare dimulai, baru `false` setelah iframe load
- Tambahkan event `onLoad` pada iframe Cloudflare untuk menghilangkan loading

### 2. Quality Lock (VideoPlayer.tsx)

**Status saat ini**: Logika sudah benar — `__setUserLocked` menangani `userLocked` vs `autoLocked` dengan tepat, dan `hls.autoLevelEnabled = false` sudah diterapkan saat lock. Tidak perlu perubahan.

### 3. Integrasi QRIS Dinamis Pak Kasir

**Arsitektur**:

```text
User Beli Show → Edge Function → Pak Kasir API → Return QRIS String
                                                → User scan QR
                                                → Pak Kasir Callback → Edge Function → Update Order Status
```

**Langkah**:

1. **Simpan API Key Pak Kasir** sebagai secret (`PAKASIR_API_KEY`) + `PAKASIR_MERCHANT_CODE` (nama merchant di Pak Kasir)

2. **Edge Function `create-dynamic-qris`**:
   - Terima `{ show_id, amount, order_type }` dari frontend
   - Panggil Pak Kasir API: `POST https://app.pakasir.com/api/transactioncreate/qris` dengan body `{ api_key, merchant_code, amount, order_id }`
   - Simpan `order_id` + `qr_string` ke database (kolom baru di `subscription_orders`)
   - Return QR string ke frontend untuk ditampilkan sebagai QR code

3. **Edge Function `pakasir-callback`**:
   - Menerima webhook callback dari Pak Kasir saat pembayaran berhasil
   - Validasi signature/data
   - Update order status ke `confirmed` otomatis
   - Panggil `confirm_regular_order` RPC jika show reguler
   - Kirim notifikasi Telegram + WhatsApp ke admin

4. **Database migration**:
   - Tambah kolom `qr_string TEXT` dan `payment_gateway_order_id TEXT` ke `subscription_orders`
   - Tambah kolom `payment_status TEXT DEFAULT 'pending'` untuk tracking status dari gateway

5. **Frontend (PurchaseModal, SchedulePage, dll)**:
   - Jika QRIS dinamis aktif (ada setting di `site_settings`), tampilkan QR code dari `qr_string` menggunakan library QR code generator (bukan gambar statis)
   - Polling status pembayaran setiap 3 detik sampai confirmed
   - Otomatis lanjut ke step "done" saat pembayaran terkonfirmasi

6. **Site Settings**: Tambah toggle `use_dynamic_qris` di admin settings agar bisa switch antara QRIS statis (gambar) dan QRIS dinamis (Pak Kasir API)

### Yang Diperlukan dari Anda

Untuk integrasi Pak Kasir, saya memerlukan:
1. **API Key Pak Kasir** — didapat dari dashboard pakasir.com setelah mendaftar
2. **Merchant Code** — nama merchant yang terdaftar di Pak Kasir

Jika Anda belum punya akun, daftar dulu di [pakasir.com](https://pakasir.com). Setelah siap, saya akan minta Anda memasukkan API Key dan Merchant Code.

### Files yang Diubah/Dibuat

| File | Perubahan |
|------|-----------|
| `src/components/VideoPlayer.tsx` | Set `isLoading=true` di awal YouTube & Cloudflare init |
| `supabase/functions/create-dynamic-qris/index.ts` | Baru — panggil Pak Kasir API |
| `supabase/functions/pakasir-callback/index.ts` | Baru — terima webhook callback |
| `src/components/viewer/PurchaseModal.tsx` | Tampilkan QR dari string (bukan gambar) + polling status |
| Database migration | Tambah kolom `qr_string`, `payment_gateway_order_id` |
| Admin settings | Toggle `use_dynamic_qris` |

