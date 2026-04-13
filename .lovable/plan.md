

# Auto-Reset Token, Command Reset/Maketoken, Bundle Show, dan Multi-Device Token

## Ringkasan
Implementasi 5 fitur: (1) auto-reset sesi token >3 hari setiap 24 jam, (2) command `/resettoken` sudah berfungsi — hanya verifikasi, (3) command `/maketoken` untuk token custom durasi, (4) kartu bundle show dengan tampilan berbeda dan multi-replay password, (5) token multi-device yang tidak bisa di-reset user.

---

## 1. Auto-Reset Sesi Token >3 Hari

### Database Migration
- Buat function `auto_reset_long_token_sessions()` yang menghapus `token_sessions` aktif dari token berusia >3 hari
- Tambahkan ke cron job harian (jam 01:00 UTC)

```sql
CREATE OR REPLACE FUNCTION public.auto_reset_long_token_sessions()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  DELETE FROM public.token_sessions 
  WHERE is_active = true 
  AND token_id IN (
    SELECT id FROM public.tokens 
    WHERE status = 'active' 
    AND created_at < now() - interval '3 days'
  );
END; $$;
```

- Cron: `SELECT cron.schedule('auto-reset-long-tokens', '0 1 * * *', 'SELECT public.auto_reset_long_token_sessions();');`

---

## 2. Command `/resettoken` — Sudah Ada
Command `/resettoken <4digit>` sudah bekerja via `handleTokenCmd` + `findTokenByInput`. Tidak perlu perubahan.

---

## 3. Bundle Show

### Database Migration
Tambah kolom ke tabel `shows`:
- `is_bundle boolean DEFAULT false`
- `bundle_description text` — deskripsi show yang didapat
- `bundle_duration_days integer DEFAULT 30` — durasi token bundle
- `bundle_replay_passwords jsonb DEFAULT '[]'::jsonb` — array `[{"show_name":"...", "password":"..."}]`
- `bundle_replay_info text` — info replay khusus

Update `get_public_shows` RPC untuk menyertakan kolom baru (kecuali `bundle_replay_passwords` yang di-null-kan untuk publik).

### Frontend
- **`src/types/show.ts`** — Tambah field bundle ke interface Show
- **`src/components/viewer/BundleShowCard.tsx`** (baru) — Kartu dengan border gradient emas, badge "📦 BUNDLE", deskripsi bundle, info durasi, tombol beli coin/QRIS
- **`src/pages/Index.tsx`**, **`SchedulePage.tsx`**, **`ReplayPage.tsx`** — Filter `is_bundle` shows, render di section terpisah paling bawah
- **`src/components/admin/ShowManager.tsx`** — Toggle bundle, field deskripsi, durasi, editor multi sandi replay (tambah/hapus baris)

### Token & Pembelian
- Update `redeem_coins_for_token` dan `confirm_regular_order`: jika show `is_bundle`, gunakan `bundle_duration_days` untuk `expires_at`
- Notifikasi WhatsApp (`notify-coin-show-purchase`, `notify-subscription-order`): sertakan semua sandi replay dari `bundle_replay_passwords`
- Dynamic QRIS tetap berfungsi (sudah ada)

---

## 4. Command `/maketoken` — Token Custom Durasi

### Format
```
/maketoken <show> <durasi> [sandi_replay]
```

Contoh: `/maketoken BundleA 30hari sandiABC`, `/maketoken BundleA 1minggu`

### Logika
- Parse: `Xhari`, `Xminggu`, `Xbulan` → konversi ke hari
- Durasi >30 hari → wajib parameter sandi replay, ditampilkan di output
- Durasi ≤7 hari → tanpa sandi, hanya link `replaytime.lovable.app`
- Selalu buat token BARU (tidak menyalin existing)

### WhatsApp Webhook
- Tambah regex `/maketoken` di `processCommand`
- Buat function `handleMakeTokenWa(supabase, showInput, durationStr, replayPassword)`
- Max device default 1

---

## 5. Token Multi-Device Custom + Proteksi Self-Reset

### Command `/maketoken` upgrade
Extend format: `/maketoken <show> <durasi> <max_device> [sandi_replay]`
Contoh: `/maketoken BundleA 30hari 100 sandiABC`

### Admin Panel — TokenFactory
- Naikkan batas max device dari 10 menjadi 9999 (untuk token multi-user)
- Tampilkan jumlah device di list token

### Proteksi Self-Reset
- Update `self_reset_token_session` RPC: **tolak reset** jika token memiliki `max_devices > 5` (multi-user token)
- Ini mencegah satu user mereset sesi semua user lain
- Admin tetap bisa reset via `/resettoken` atau dashboard

### WhatsApp Command Update
- Update `/createtoken` dan `/bulktoken` max device limit dari 10 → 9999
- Update help text dengan command baru

---

## File yang Diubah

| File | Perubahan |
|------|-----------|
| **Migration SQL** | Kolom bundle di `shows`, function auto-reset, update `get_public_shows`, update `confirm_regular_order` & `redeem_coins_for_token`, update `self_reset_token_session`, cron job |
| `src/types/show.ts` | Field bundle di interface |
| `src/components/viewer/BundleShowCard.tsx` | **Baru** — kartu bundle |
| `src/pages/Index.tsx` | Section bundle di bawah |
| `src/pages/SchedulePage.tsx` | Section bundle di bawah |
| `src/pages/ReplayPage.tsx` | Section bundle di bawah |
| `src/components/admin/ShowManager.tsx` | UI bundle: toggle, deskripsi, durasi, multi sandi replay |
| `src/components/admin/TokenFactory.tsx` | Naikkan max device limit |
| `supabase/functions/whatsapp-webhook/index.ts` | Command `/maketoken`, update help, update max device limits |
| `supabase/functions/notify-coin-show-purchase/index.ts` | Sertakan bundle replay passwords |
| `supabase/functions/notify-subscription-order/index.ts` | Sertakan bundle replay passwords |

