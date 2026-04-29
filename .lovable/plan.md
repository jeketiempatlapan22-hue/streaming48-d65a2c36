# Audit: Konversi Token Show → Replay & Status Fitur

## Ringkasan Temuan

**Jawaban langsung:** Sistem **sudah** mengkonversi token live menjadi akses replay 14 hari **secara otomatis** ketika admin menandai show sebagai replay (`is_replay = true`) — tetapi **hanya jika user menggunakan token-nya dari halaman replay** (`/replay`). Jika user masih membuka `/live`, mereka akan melihat layar "Show Telah Berakhir" tanpa auto-redirect membawa token ke replay player.

Saya juga menemukan beberapa fitur yang **masih utuh** (tidak terhapus) dan satu **gap UX** yang perlu diperbaiki.

---

## Bagaimana Konversi Replay Bekerja Sekarang

### Alur otomatis (sudah ada di `validate_replay_access` RPC)

```text
User punya token live (tabel: tokens) → admin set show.is_replay = true
                              ↓
User akses /replay + masukkan token
                              ↓
RPC validate_replay_access mendeteksi token live + show.is_replay = true
                              ↓
1. INSERT ke replay_tokens dengan expires_at = now() + 14 days
2. created_via = 'live_upgrade_validate'
3. DELETE token dari tabel tokens (token live dihapus)
                              ↓
User dapat akses replay selama 14 hari penuh
```

**Bukti kode (`validate_replay_access` baris 110-138):**
- Cek apakah token ada di `tokens` + show punya `is_replay = true`
- Jika ya: buat entry `replay_tokens` dengan `expires_at = now() + interval '14 days'`
- Hapus token live dari tabel `tokens` (mencegah dipakai lagi sebagai live)

### Alur jika sudah ada di `replay_tokens` (baris 84-91)
- Jika `expires_at` masih NULL → di-set jadi `now() + 14 days` saat akses pertama
- Jika sudah punya `expires_at` → tetap dipakai (tidak di-reset)

### Pengamanan tambahan (`validate_token` baris 47-50)
- Token live yang show-nya sudah jadi replay → diblokir di `/live` dengan pesan "Show ini telah dijadikan replay"
- Pengecualian: token universal (MBR-, BDL-, RT48-) dan token bundle tetap boleh

---

## Gap yang Ditemukan

### 1. Tidak ada auto-redirect dari /live → /replay
Di `LivePage.tsx` baris 870-872 + 1123, ketika realtime subscription mendeteksi `is_replay = true`, UI langsung tampilkan layar "Show Telah Berakhir" + tombol "Ke Beranda". **Token user tidak otomatis di-upgrade** kecuali user inisiatif sendiri ke `/replay`.

Padahal di baris 587-590 sudah ada logika: saat validasi token live gagal karena show jadi replay, kode mencoba `validate_replay_access`. Tapi ini **hanya jalan saat first-load**, bukan saat live subscription mendeteksi perubahan show real-time.

### 2. Tidak ada notifikasi 14-hari ke user
Saat token di-upgrade ke replay, user tidak diberitahu bahwa mereka punya **akses 14 hari** dengan token yang sama. Mereka harus tebak sendiri atau buka halaman replay.

---

## Status Fitur (Audit Lengkap)

| Fitur | Status | Catatan |
|---|---|---|
| Konversi token live → replay 14 hari | ✅ Aktif | Via `validate_replay_access` RPC |
| Token live diblokir di /live saat show jadi replay | ✅ Aktif | `validate_token` baris 47-50 |
| Realtime detection saat admin flip is_replay | ✅ Aktif | `LivePage.tsx` baris 870-872 |
| Universal tokens (MBR/BDL/RT48) bypass blokir | ✅ Aktif | Logic `_is_universal` |
| Bundle tokens akses multi-show + replay | ✅ Aktif | Logic `_is_bundle` |
| Reseller audit log lengkap (rejection reasons) | ✅ Pulih | Di-restore migration 20260429135646 |
| Token `valid_from` mengikuti jadwal show | ✅ Aktif | Migration 20260429135231 |
| Countdown "Token Belum Aktif" di LivePage | ✅ Aktif | tokenNotStarted state |
| Side-by-side mismatch overlay (token vs show aktif) | ✅ Aktif | LivePage |
| Admin pilih active_show_id manual | ✅ Aktif | LiveControl.tsx |
| Auto-redirect /live → /replay player | ❌ Tidak ada | Gap yang perlu diperbaiki |
| Notifikasi "14 hari akses replay" ke user | ❌ Tidak ada | Gap UX |
| WhatsApp bot toggle is_replay | ✅ Aktif | whatsapp-webhook baris 1206 |

**Tidak ada fitur yang terhapus** dari hasil audit ini. Semua perubahan terbaru bersifat additive.

---

## Rencana Perbaikan (Yang Akan Diimplementasikan)

### A. Auto-upgrade & redirect di LivePage
Modifikasi `LivePage.tsx`:
- Saat realtime subscription mendeteksi `is_replay` berubah jadi `true` **dan** user punya `tokenCode` aktif:
  1. Panggil `supabase.rpc('validate_replay_access', { _token: tokenCode })` otomatis
  2. Jika berhasil: tampilkan dialog "🎬 Show telah berakhir — token kamu sudah otomatis berlaku untuk replay 14 hari" dengan tombol "Tonton Replay Sekarang" → redirect ke `/replay/{show_short_id}` dengan token pre-filled
  3. Jika gagal (token universal/bundle): tetap tampilkan layar "Show Telah Berakhir" lama

### B. Notifikasi durasi replay
- Tambah informasi `expires_at` di response upgrade dialog: "Berlaku sampai: 13 Mei 2026 14:00 WIB"
- Toast sukses saat upgrade berhasil

### C. Pre-fill token di ReplayPlayPage
- Pastikan `/replay/{short_id}?token={code}` mengisi otomatis input token (cek apakah sudah ada)

### Files yang dimodifikasi
- `src/pages/LivePage.tsx` — auto-upgrade flow saat realtime detect is_replay
- `src/pages/ReplayPlayPage.tsx` — pre-fill token dari query string (jika belum)
- Tidak perlu migration database — RPC `validate_replay_access` sudah handle semua logika 14-hari

### Yang TIDAK diubah
- RPC `validate_replay_access` — sudah benar, expires_at = 14 hari
- RPC `validate_token` — blokir token live saat show jadi replay sudah benar
- Tabel `replay_tokens` — schema sudah lengkap
- Logika token universal & bundle — tetap bypass seperti sekarang
