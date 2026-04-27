## Tujuan

Membuat alur pembelian (Show & Koin) via QRIS Dinamis benar-benar otomatis — tanpa membebani admin WhatsApp — sementara QRIS Statis tetap menjadi jalur cadangan yang dikonfirmasi manual. Order pending yang tidak dibayar dalam 10 menit akan dihapus otomatis dari database & panel admin.

---

## 1. Hilangkan Notifikasi Admin saat QRIS Dinamis Dibuat

**File:** `supabase/functions/create-dynamic-qris/index.ts`

- Hapus blok "Notify admin (Telegram + WhatsApp) that a dynamic QRIS order was created" (baris ~245-280) yang mengirim pesan `🟡 QRIS Dinamis Dibuat (menunggu bayar)`.
- Tetap simpan order ke DB untuk polling status oleh client.
- Tambahkan kolom `expires_at` (lihat bagian 3) saat insert ke `subscription_orders` / `coin_orders`: `now() + 10 menit`.

**File:** `supabase/functions/pakasir-callback/index.ts`

- Tetap kirim notifikasi WhatsApp ke **user** (sudah ada).
- **Pertahankan** notifikasi Telegram ke admin saat pembayaran berhasil (sebagai log otomatis), tapi **hapus** notifikasi WhatsApp admin pada jalur QRIS dinamis. (Telegram = log internal; WhatsApp admin hanya untuk yang butuh aksi manual = QRIS statis.)

---

## 2. QRIS Statis tetap melalui WhatsApp Admin

Jalur yang sudah ada via `notify-coin-order` & `notify-subscription-order` (dipanggil dari `CoinShop.tsx` `handleUploadProof` & `useShowPurchase.ts` `handleSubmitSubscription`) **tidak diubah**. Ini adalah satu-satunya jalur yang mengirim ke admin WhatsApp untuk konfirmasi manual.

Tambahkan flag `payment_method = 'qris_static'` saat order dari upload bukti agar admin panel bisa membedakan jelas antara dinamis (otomatis) vs statis (manual).

---

## 3. Expiry 10 Menit + Auto-Cleanup

### 3a. Migration database

Tambahkan kolom dan index:

```sql
ALTER TABLE public.subscription_orders 
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

ALTER TABLE public.coin_orders 
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_sub_orders_expires 
  ON public.subscription_orders(expires_at) 
  WHERE payment_status = 'pending';

CREATE INDEX IF NOT EXISTS idx_coin_orders_expires 
  ON public.coin_orders(expires_at) 
  WHERE status = 'pending';
```

Buat function cleanup:

```sql
CREATE OR REPLACE FUNCTION public.cleanup_expired_qris_orders()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _sub INT; _coin INT;
BEGIN
  -- Hanya hapus QRIS dinamis yang pending & sudah expired
  WITH d AS (
    DELETE FROM subscription_orders
    WHERE payment_status = 'pending'
      AND payment_method = 'qris_dynamic'
      AND expires_at IS NOT NULL
      AND expires_at < now()
    RETURNING 1
  ) SELECT count(*) INTO _sub FROM d;

  WITH d AS (
    DELETE FROM coin_orders
    WHERE status = 'pending'
      AND expires_at IS NOT NULL
      AND expires_at < now()
    RETURNING 1
  ) SELECT count(*) INTO _coin FROM d;

  RETURN jsonb_build_object('subscription_deleted', _sub, 'coin_deleted', _coin);
END $$;
```

Jadwalkan cron tiap menit:

```sql
SELECT cron.schedule(
  'cleanup-expired-qris-orders',
  '* * * * *',
  $$ SELECT public.cleanup_expired_qris_orders(); $$
);
```

### 3b. Update edge function

`create-dynamic-qris/index.ts`:
- Saat insert order, set `expires_at = new Date(Date.now() + 10*60*1000).toISOString()` dan `payment_method = 'qris_dynamic'`.

`pakasir-callback/index.ts`:
- Saat order ditemukan, tolak konfirmasi jika `expires_at < now()` (karena baris sudah dihapus, kasus ini akan jadi "Order not found" — fallback aman).

### 3c. UI countdown 10 menit

`src/components/viewer/PurchaseModal.tsx` (DynamicQrisView) & `src/pages/CoinShop.tsx` (dynamic QRIS screen):
- Tampilkan countdown `MM:SS` di bawah QR.
- Saat habis: hentikan polling, tampilkan tombol "Buat QRIS Baru" (panggil `tryCreate` lagi → membuat order baru) dan tombol "Gunakan QRIS Statis".
- Pesan: "QRIS dinamis berlaku 10 menit. Jika tidak dibayar, akan kadaluarsa otomatis."

---

## 4. Hapus Order saat User Tutup Modal Tanpa Bayar (opsional cepat)

Saat user menutup modal QRIS dinamis (event `onClose`) sebelum membayar, kirim DELETE ke order pending mereka:
- Tambah RPC `cancel_pending_qris_order(_order_id uuid)` yang menghapus baris jika masih `pending` dan `payment_method = 'qris_dynamic'`.
- Panggil dari handler `onClose` di `PurchaseModal.tsx` & `CoinShop.tsx` jika `orderId` ada dan `paid === false`.

Ini memastikan data tidak menumpuk meski cron belum berjalan.

---

## 5. Admin Panel — Bersihkan Tampilan

`src/components/admin/SubscriptionOrderManager.tsx`:
- Tambah filter/badge: "QRIS Dinamis" (otomatis, tidak butuh aksi) vs "QRIS Statis" (perlu konfirmasi).
- Default tampilan order pending: hanya yang `payment_method != 'qris_dynamic'` agar admin tidak melihat noise QRIS dinamis yang akan auto-expire / auto-confirm.
- Sediakan toggle "Tampilkan semua" untuk debugging.

---

## Ringkasan Perubahan File

**Edge Functions**
- `supabase/functions/create-dynamic-qris/index.ts` — hapus admin notify; set `expires_at` + `payment_method`
- `supabase/functions/pakasir-callback/index.ts` — hapus WhatsApp admin (Telegram tetap sebagai log)

**Database (migration baru)**
- Kolom `expires_at` di `subscription_orders` & `coin_orders`
- Function `cleanup_expired_qris_orders()`
- Function `cancel_pending_qris_order(_order_id uuid)`
- Cron job `* * * * *`

**Frontend**
- `src/components/viewer/PurchaseModal.tsx` — countdown 10 menit, tombol "QRIS Baru", cancel-on-close
- `src/pages/CoinShop.tsx` — countdown 10 menit, tombol "QRIS Baru", cancel-on-close, set `payment_method` saat upload bukti = `qris_static`
- `src/hooks/useShowPurchase.ts` — set `payment_method='qris_static'` saat insert order dari bukti
- `src/components/admin/SubscriptionOrderManager.tsx` — filter sembunyikan QRIS dinamis pending dari list utama

---

## Hasil Akhir

| Kondisi | Notif Admin WA | Notif Admin TG | Notif User WA | Order tersisa di DB |
|---|---|---|---|---|
| QRIS dinamis dibuat (belum bayar) | ❌ | ❌ | ❌ | Pending, expire 10 min |
| QRIS dinamis dibayar (Pak Kasir callback) | ❌ | ✅ (log) | ✅ (token+akses) | Confirmed |
| QRIS dinamis tidak dibayar 10 menit | ❌ | ❌ | ❌ | Auto-deleted |
| User tutup modal tanpa bayar | ❌ | ❌ | ❌ | Langsung deleted |
| QRIS statis upload bukti | ✅ | ✅ | (setelah admin konfirmasi) | Pending sampai admin proses |
