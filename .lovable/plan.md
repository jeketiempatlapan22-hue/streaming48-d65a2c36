

## Reset Sesi Token Reseller + Command Statistik WhatsApp

Menambah kemampuan reseller untuk reset sesi token miliknya (web & WhatsApp), command stats per-reseller via WA, dan memastikan isolasi data antar reseller serta sinkronisasi hapus.

---

### 1. Database — RPC Baru

**`reseller_reset_token_sessions(_session_token, _token_code_or_4digit)`** (web)
- Validasi sesi reseller via `validate_reseller_session`
- Cari token milik reseller ini saja (`WHERE reseller_id = _me AND (code = _input OR right(code, 4) = upper(_input))`)
- Jika tidak ditemukan → reject + audit `rejection_reason = 'token_not_owned'`
- DELETE dari `token_sessions WHERE token_id = _token.id`
- Insert audit `status = 'success'`, `metadata = { action: 'reset_session', token_code }`
- Return `{ success, deleted_count, token_code }`

**`reseller_reset_token_sessions_by_id(_reseller_id, _input)`** (WhatsApp — same logic, uses reseller_id setelah lookup phone)

**`reseller_my_stats(_session_token)`** (web — opsional untuk dashboard)
- Return `{ total, active, expired, blocked, per_show: [{show_id, show_title, count}] }` HANYA token milik reseller ini

**`reseller_my_stats_by_id(_reseller_id)`** (WhatsApp version)

**Penting (isolasi data)**: setiap RPC reseller WAJIB filter `reseller_id = _me`. Tidak ada query lintas reseller. Hapus token oleh admin sudah otomatis menghapus baris di `tokens` → realtime channel di dashboard reseller (`reseller_id=eq.{me}`) langsung sync.

**Sinkronisasi hapus admin → reseller**: tambahkan trigger `BEFORE DELETE ON tokens` yang juga `DELETE FROM token_sessions WHERE token_id = OLD.id` (jika belum ada CASCADE) untuk pastikan tidak ada sesi yatim.

---

### 2. Halaman Reseller — Tombol Reset Sesi

`src/components/reseller/ResellerDashboard.tsx` di tab "Token":
- Tambah tombol **Reset Sesi** (ikon `RefreshCw`) per token aktif (sebelahnya tombol Salin)
- Konfirmasi dialog ringan → panggil `reseller_reset_token_sessions(session_token, token.code)`
- Toast: "X sesi direset" / error message dari RPC
- Broadcast force-logout: setelah sukses, kirim ke channel `token-reset-${token_id}` (sama seperti TokenFactory) supaya device aktif di-kick

Tambah panel statistik per-show kecil di tab "Token":
- Group `tokens` lokal by `show_id` → tampilkan list "Show X: 12 token (8 aktif)"
- Tidak butuh request baru, gunakan data `loadTokens` yang sudah dipanggil

---

### 3. WhatsApp — Command Reseller Baru

Di `processPublicCommand` dalam `whatsapp-webhook/index.ts`, setelah blok `/${prefix}token`:

**`/${prefix}reset <4digit>`** — reset sesi token milik reseller
- Regex: `^\/${prefix}reset\s+(\S+)$`
- Panggil `reseller_reset_token_sessions_by_id(reseller.id, code)`
- Jika token bukan milik reseller → balasan: "⚠️ Token tidak ditemukan atau bukan milik Anda" + audit
- Sukses → balasan format ala admin reset:
  ```
  ━━━━━━━━━━━━━━━━━━
  ✅ Sesi Token Direset
  Token: RSL-W-AB12CD
  Show: <show_title>
  Sesi dihapus: N
  ━━━━━━━━━━━━━━━━━━
  ```
- Broadcast force-logout via Supabase Realtime ke channel `token-reset-${token_id}` (panggil dari edge function dengan service role)

**`/${prefix}stats`** — statistik token reseller ini saja
- Panggil `reseller_my_stats_by_id(reseller.id)`
- Balasan:
  ```
  📊 Statistik Token Anda (${reseller.name})
  Total: 45 | Aktif: 30 | Expired: 12 | Blokir: 3
  
  📋 Per Show:
  • JKT48 Show A: 18 token
  • JKT48 Show B: 12 token
  • ...
  ```

**`/${prefix}mytokens`** — list 20 token terakhir reseller (kode 4 digit, show, status, expires)
- Untuk memudahkan reseller pilih token mana yang mau di-reset

Update `handleResellerHelp` untuk include 3 command baru.

**Isolasi**: tiap command lookup reseller dari `senderPhone` lewat `get_reseller_by_phone`, lalu RPC strictly filter by `reseller_id`. Reseller A tidak bisa reset/lihat token Reseller B walau tahu kodenya.

---

### 4. Sinkronisasi Hapus Admin → Reseller (sudah berjalan, dipastikan)

- `TokenFactory.tsx` `deleteTokens()` → `DELETE FROM tokens` → CASCADE/trigger hapus `token_sessions`
- Halaman reseller subscribe `postgres_changes DELETE` di `tokens filter reseller_id=eq.{me}` → row hilang real-time
- `admin_reset_reseller_tokens` (sudah ada) → admin tetap bisa wipe semua token reseller dari `ResellerManager`

---

### Detail Teknis

**File baru/edit**:
- Migration SQL: 4 RPC baru + (opsional) trigger cleanup `token_sessions`
- `src/components/reseller/ResellerDashboard.tsx` — tombol Reset Sesi + panel stats per-show
- `supabase/functions/whatsapp-webhook/index.ts` — handler `/Wreset`, `/Wstats`, `/Wmytokens` + update help text

**Audit**: setiap aksi reset (web & WA) tercatat di `reseller_token_audit` dengan `status=success/rejected`, `metadata.action='reset_session'`, dan `token_code`. Admin bisa lihat di menu "Audit Reseller".

**Keamanan**:
- RPC reseller WAJIB validasi `session_token` (web) atau filter strict `reseller_id` (WA setelah phone lookup)
- Rate limit reset: max 30/jam per reseller via `check_rate_limit('reseller_reset_' || id, 30, 3600)`
- Tidak ada path RPC yang membiarkan reseller akses token milik orang lain (filter di WHERE clause, bukan post-filter di app)

