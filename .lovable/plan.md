

## Fitur Reseller — Halaman, Admin Manajemen, & Bot WhatsApp

Sistem multi-reseller dengan login terpisah, panel pembuatan token per show aktif, tracking jumlah token per reseller, perintah WhatsApp unik per reseller, dan sinkronisasi 2-arah dengan admin panel.

---

### 1. Database Schema (Migration Baru)

**Tabel `resellers`** — daftar reseller yang dikelola admin:
- `id` (uuid) | `name` (text) | `phone` (text, unique) — nomor login
- `password_hash` (text) — sandi login (bcrypt/sha256)
- `wa_command_prefix` (text, unique) — contoh: `W`, `C`, `D` → menjadi `/Wtoken`, `/Ctoken`
- `is_active` (boolean) | `created_at` | `notes` (text)

**Kolom baru di `tokens`**:
- `reseller_id` (uuid, nullable) — penanda token milik reseller mana

**RLS**: hanya admin yang boleh akses tabel `resellers`. Login reseller lewat RPC `reseller_login(phone, password)` yang return session token (disimpan di `localStorage` reseller).

**RPC baru**:
- `reseller_login(_phone, _password)` → return `{ success, reseller_id, token, name, prefix }`
- `reseller_create_token(_session_token, _show_id, _max_devices, _duration_days)` → bikin token baru unik (kode `RSL-{prefix}-{rand}`), set `reseller_id`, return token+link
- `reseller_list_my_tokens(_session_token)` → list token milik reseller (untuk halaman reseller)
- `reseller_stats()` → admin: jumlah token per reseller per show
- `admin_reset_reseller_tokens(_reseller_id)` → admin: hapus semua token milik reseller (atau set `reseller_id=null` lalu trim — kita pilih HAPUS sesuai requirement "agar tidak menumpuk")

---

### 2. Halaman Reseller (`/reseller`)

**Login screen**: input nomor HP + sandi → simpan session token di `localStorage`.

**Dashboard reseller** (setelah login):
- **Header**: nama reseller, total token dibuat, prefix command WA
- **Daftar Show Aktif** (dari `get_public_shows`): tiap card menampilkan
  - Judul, jadwal, harga, lineup
  - **Info Replay**: sandi replay (jika ada) + deskripsi replay show
  - Form: max device, durasi (hari)
  - Tombol **"Buat Token Baru"** → memanggil RPC, menampilkan kode + link `realtime48stream.my.id/live?t=...`
  - Tombol **"Salin Link"**
- **Riwayat Token Saya**: list token reseller ini (kode, show, expires_at, status, tombol copy)
- Realtime sync: jika admin hapus token, baris hilang otomatis (subscribe `postgres_changes` di `tokens` filter `reseller_id`)
- Tombol logout

**Token uniqueness**: tiap call `reseller_create_token` insert row baru ke `tokens` dengan `code` random — TIDAK pernah menyalin token lama. Constraint UNIQUE pada `tokens.code` mencegah duplikasi.

---

### 3. Admin Panel — Menu "Reseller Info" Baru

Komponen baru `src/components/admin/ResellerManager.tsx`, masuk ke `AdminSidebar` (id: `resellers`, label: "Reseller").

**Section Manajemen Reseller**:
- Form tambah reseller: Nama, Nomor HP, Sandi, Prefix Command (1-3 huruf, unique)
- Tabel reseller: Nama | HP | Prefix | Total Token | Aktif (toggle) | Aksi
- Aksi per reseller:
  - **"Lihat Detail"** → modal: rincian token per show (Show A: 12 token, Show B: 5 token...)
  - **"Reset Token"** → konfirmasi → hapus semua token milik reseller (juga membersihkan `token_sessions` & `chat_messages` terkait)
  - **"Edit Sandi"** / **"Hapus Reseller"**

**Sinkronisasi**: token yang dihapus admin di `TokenFactory` atau via "Reset Token" akan hilang dari halaman reseller via realtime subscription.

---

### 4. Bot WhatsApp — Command Per-Reseller

**Pattern dinamis** di `whatsapp-webhook/index.ts`:
- Sebelum cek admin command, lookup `resellers` table by `sender_phone`
- Jika sender = reseller aktif, parse: `^\/${prefix}token\s+(.+?)(?:\s+(\d+)(?:hari)?)?(?:\s+(\d+))?$`
  - Contoh reseller W: `/Wtoken showABC 7hari 1`
  - Contoh reseller C: `/Ctoken #abc123 30hari 2`
- Handler `handleResellerToken(supabase, reseller, showInput, durationDays, maxDevices)`:
  - findShowByInput → bikin token unik `RSL-{prefix}-{rand}` dengan `reseller_id = reseller.id`
  - Reply WA: kode token + link nonton + info replay show (sandi + deskripsi replay)
- **Public help**: tambah `/resellerhelp` untuk reseller lihat command miliknya
- Tiap reseller cuma bisa pakai prefix-nya sendiri (validasi nomor pengirim cocok dengan reseller pemilik prefix)

**Token uniqueness via WA**: sama seperti web — selalu generate kode random baru, INSERT row baru. Tidak ada path yang menyalin token existing.

---

### 5. Sinkronisasi Hapus 2-Arah

- Admin hapus token (TokenFactory atau Reset Reseller) → row di `tokens` hilang → halaman reseller (subscribe realtime `DELETE` event pada `tokens` filter `reseller_id=eq.{me}`) langsung update list
- Reseller TIDAK bisa hapus token (hanya copy & lihat) — hindari konflik
- Saat admin "Reset Token" reseller, broadcast force-logout ke `token-reset-{id}` untuk tiap token agar device aktif keluar

---

### 6. Routing & Akses

- Tambah route `<Route path="/reseller" element={<ResellerPage />} />` di `App.tsx`
- ResellerPage internal switch: belum login → `<ResellerLogin />`, sudah login → `<ResellerDashboard />`
- Tombol akses dari navbar: TIDAK ditampilkan publik (URL langsung saja, sesuai requirement "admin harus memasukkan nomor & sandi reseller agar reseller dapat mengakses")

---

### Detail Teknis Singkat

**File baru**:
- `src/pages/ResellerPage.tsx` (login + dashboard)
- `src/components/reseller/ResellerLogin.tsx`
- `src/components/reseller/ResellerDashboard.tsx`
- `src/components/reseller/ResellerShowCard.tsx` (card show aktif + form bikin token)
- `src/components/admin/ResellerManager.tsx`
- Migration SQL untuk tabel `resellers`, kolom `tokens.reseller_id`, dan semua RPC

**File diedit**:
- `src/App.tsx` — route `/reseller`
- `src/pages/AdminDashboard.tsx` + `AdminSidebar.tsx` — section "Reseller"
- `supabase/functions/whatsapp-webhook/index.ts` — handler reseller dinamis
- `src/components/admin/TokenFactory.tsx` — kolom badge "RSL-{prefix}" untuk identifikasi token reseller

**Keamanan**:
- Sandi reseller di-hash (sha256 + salt) di RPC
- Session token reseller (random 32-byte hex) divalidasi di setiap RPC call
- Rate limit pembuatan token: max 50 token/jam per reseller (via `check_rate_limit`)
- Reseller tidak bisa lihat/manipulasi token reseller lain

