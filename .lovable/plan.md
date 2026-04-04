

# Rencana: Membership Token 30 Hari + Kuota Realtime + Notifikasi WhatsApp

## Ringkasan
1. Membership purchase menghasilkan token dengan durasi yang bisa diatur admin (default 30 hari)
2. Kuota membership di-enforce di backend (QRIS + coin) dan UI realtime
3. WhatsApp notifikasi otomatis berisi token + info replay + sandi
4. Format nomor internasional di admin panel
5. Badge sisa durasi membership di player
6. Admin toggle untuk fitur membership token

---

## 1. Database Changes

### A. Tambah kolom `membership_duration_days` di tabel `shows`
- Default: 30 (hari)
- Admin bisa atur per-show berapa hari durasi membership

### B. Buat RPC `confirm_membership_order(_order_id uuid)`
Logika:
- Validasi order pending + show `is_subscription = true`
- Cek kuota: `get_order_count(show_id)` vs `max_subscribers` → tolak jika penuh
- Generate token `MBR-xxxx` dengan `expires_at = now() + membership_duration_days days`
- Update order → confirmed, payment_status → paid
- Return `{ success, token_code, expires_at, access_password, group_link, replay_password }`

### C. Update RPC `redeem_coins_for_membership`
- Tambah cek kuota sebelum redeem
- Generate token `MBR-xxxx` dengan durasi sesuai `membership_duration_days`
- Return token_code + expires_at + access_password + group_link

### D. Insert site_settings: `membership_token_enabled` = "true"

---

## 2. Edge Function: `create-dynamic-qris` — Cek Kuota Membership

Sebelum generate QRIS untuk show `is_subscription = true`:
- Query `get_order_count` + `shows.max_subscribers`
- Jika penuh → return error 400, QRIS tidak dibuat

---

## 3. Edge Function: `pakasir-callback` — Membership Flow

Saat show `is_subscription = true`:
- Panggil `confirm_membership_order` (bukan `confirm_regular_order`)
- Cek apakah `membership_token_enabled` aktif
- Kirim WhatsApp ke buyer:
  - ✅ Berhasil membeli membership
  - 🎫 Token + link live
  - ⏰ Durasi X hari
  - 🔄 Info replay + sandi replay
  - 🔗 Link grup (jika ada)

---

## 4. Frontend: `MembershipPage.tsx` — Realtime Kuota + Token Display

- Realtime subscribe ke `subscription_orders` INSERT → refresh count otomatis
- Disable tombol + hide QRIS/coin saat kuota penuh (realtime)
- Dynamic QRIS flow: wajib isi phone + email sebelum generate QRIS
- Coin flow: setelah sukses, tampilkan token + info replay + sandi di UI "done"
- Kirim notifikasi WhatsApp via edge function setelah coin purchase berhasil

---

## 5. Admin Panel: Format Nomor Internasional

**File:** `src/components/admin/SubscriptionOrderManager.tsx`
- Deteksi nomor non-Indonesia (tidak awali 08/62/+62)
- Tampilkan badge "🌍 Internasional" di samping nomor
- Format Indonesia: `+62xxx`, lainnya: as-is

---

## 6. Player: Sisa Durasi Membership

**File:** `src/pages/LivePage.tsx`
- Setelah validate token, cek prefix `MBR-` dan `expires_at`
- Tampilkan floating badge: "Membership: X hari tersisa"

---

## 7. Admin Toggle + Durasi

**File:** `src/components/admin/SiteSettingsManager.tsx`
- Toggle `membership_token_enabled` (ON/OFF)
- Jika OFF → membership berfungsi seperti sekarang (tanpa token otomatis)

**File:** `src/components/admin/ShowManager.tsx`
- Tambah input `membership_duration_days` pada show yang `is_subscription = true`
- Default 30 hari

---

## Alur Lengkap

```text
QRIS Dinamis:
  User pilih membership → Cek kuota (penuh? tolak)
  → Input phone+email → Generate QRIS
  → Scan → Pakasir callback → confirm_membership_order
  → Token MBR-xxx (30 hari) → WhatsApp: token+replay+sandi
  → UI: success

Koin:
  User pilih koin → Cek kuota (penuh? tolak)
  → Input phone+email → redeem_coins_for_membership
  → Token MBR-xxx (30 hari) → WhatsApp: token+replay+sandi
  → UI: success + token display

Realtime:
  Order INSERT → refresh count → kuota penuh → disable UI instantly

Player:
  Token MBR- → badge "Membership: X hari tersisa"
```

## File yang akan diubah/dibuat

1. **Migration SQL** — kolom `membership_duration_days`, RPC `confirm_membership_order`, update `redeem_coins_for_membership`
2. `supabase/functions/create-dynamic-qris/index.ts` — kuota check untuk membership
3. `supabase/functions/pakasir-callback/index.ts` — membership flow + WhatsApp token
4. `src/pages/MembershipPage.tsx` — realtime kuota, token display, phone/email wajib, WhatsApp notif coin
5. `src/components/admin/SubscriptionOrderManager.tsx` — badge nomor internasional
6. `src/pages/LivePage.tsx` — badge sisa membership
7. `src/components/admin/SiteSettingsManager.tsx` — toggle membership_token_enabled
8. `src/components/admin/ShowManager.tsx` — input membership_duration_days

