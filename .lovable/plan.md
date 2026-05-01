## Masalah

Tombol "Upload Bukti Pembayaran" untuk QRIS statis **tidak merespons sama sekali** di banyak perangkat (terutama mobile/PWA). Akibatnya:
- File picker tidak terbuka saat tombol diklik.
- Tidak ada satupun pesanan QRIS statis (`payment_method = 'qris_static'` / `'qris'`) tersimpan di database — semua order yang masuk hanya dari `qris_dynamic`, `coin`, `reseller_bot`, atau `admin_bot`.
- Tidak ada error log di edge function `upload-payment-proof` karena request tidak pernah terkirim.

## Akar Penyebab

1. **`MembershipPage.tsx`** memakai pola lama `<label><input type="file" disabled={...} /></label>`. Pada Android Chrome / WebView / iOS PWA, klik pada `<label>` sering **tidak men-trigger file picker** ketika child input pernah berstatus `disabled`. Atribut `disabled` di `<input type="file">` juga memblokir interaksi tap di iOS bahkan setelah berubah ke `false`.
2. **`Index.tsx`, `SchedulePage.tsx`, `ReplayPage.tsx`, `CoinShop.tsx`** memakai `<button onClick={() => ref.current?.click()}>` + `<input style={{display:"none"}}>`. Pola `display: none` pada `<input type="file">` menyebabkan beberapa engine WebView (terutama Android WebView versi lama dan PWA standalone) **tidak mau membuka native file picker** karena dianggap tidak visible/interactive.
3. Tidak ada feedback ke user saat tombol gagal — sehingga terlihat "tombol mati".

## Rencana Perbaikan

### 1. Buat komponen reusable `PaymentProofUploadButton`
File baru: `src/components/payment/PaymentProofUploadButton.tsx`

- Render `<button type="button">` dengan label & disabled state yang fleksibel.
- Render `<input type="file" accept="image/*">` **off-screen** (bukan `display:none`):
  ```css
  position: absolute; width: 1px; height: 1px;
  opacity: 0; pointer-events: none;
  left: -9999px; top: 0;
  ```
- `onClick` tombol → `inputRef.current?.click()` di dalam handler synchronous (penting untuk user-gesture context iOS).
- Jangan pernah set `disabled` pada `<input type="file">`; alih-alih, blokir lewat state pada `<button>`.
- Reset `input.value = ""` setelah `onChange` agar bisa pilih file yang sama berulang kali.
- Tambah `aria-label` & `data-testid` untuk QA.

### 2. Ganti semua pemakaian pola lama
- `src/pages/MembershipPage.tsx` (line 582-585): ganti `<label>...<input disabled.../></label>` dengan komponen baru. Validasi `phone`/`email` dipindah ke `onClick` tombol (tampilkan toast jika belum diisi) bukan via `disabled`.
- `src/pages/Index.tsx` (line 993, 1095-1102, 1155-1162): hapus pola `galleryInputRef + display:none`, ganti dengan komponen baru yang inputnya off-screen.
- `src/pages/SchedulePage.tsx` (line 395 + tombol pemicu): sama.
- `src/pages/ReplayPage.tsx` (line 620 + tombol pemicu): sama.
- `src/pages/CoinShop.tsx`: cek pola serupa, samakan.

### 3. Tambah error logging client-side
Di `src/lib/uploadPaymentProof.ts`, tambah `console.warn` saat invoke gagal supaya kita bisa lihat error di console logs jika masalah upload muncul lagi setelah perbaikan UI.

### 4. (Opsional) Verifikasi
Setelah deploy, minta user coba sekali — lalu periksa table `subscription_orders` apakah ada baris dengan `payment_method='qris_static'` & `payment_proof_url IS NOT NULL`.

## Yang TIDAK diubah

- Edge function `upload-payment-proof` (sudah benar; pakai service role, validasi MIME dengan fallback HEIC, rate limit per user/IP).
- RPC `create_show_order`.
- Storage RLS (bucket `payment-proofs` & policy sudah benar).
- Flow QRIS dinamis.

## Hasil Diharapkan

Tombol "Upload Bukti Pembayaran" merespons di semua perangkat (Android/iOS/Desktop/PWA), file picker terbuka, bukti tersimpan, dan order QRIS statis kembali masuk ke admin panel.