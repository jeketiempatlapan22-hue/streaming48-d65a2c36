# Fitur: Akses Replay via Sandi Langsung di Kartu Show

## Tujuan
User dapat memasukkan sandi (yang sudah diatur admin di `access_password` show, atau global password) langsung di kartu replay tanpa harus pergi ke halaman `/replay-play` terlebih dahulu. Fitur ini hanya muncul di kartu replay yang punya media (m3u8 atau YouTube).

## Lokasi UI
- File: `src/components/viewer/ShowCard.tsx`
- Posisi: **di bawah tombol "Beli Replay (Koin)" / "Beli via QRIS"** pada bagian action buttons.
- Kondisi tampil: `isReplayMode === true` **DAN** `show.is_replay === true` **DAN** `show.has_replay_media === true` **DAN** user belum punya token (`!showToken`).

## Komponen Baru: `ReplayPasswordEntry`
Sub-komponen kecil di file yang sama (`ShowCard.tsx`) berisi:

1. Tombol toggle "🔓 Sudah punya sandi? Masuk di sini" (collapsed by default agar tidak crowded).
2. Saat dibuka:
   - Input field `password` (type=password, max 50 char, trim).
   - Tombol **"Tonton Replay"** (loading state saat submit).
3. Validasi via RPC `validate_replay_access`:
   ```ts
   supabase.rpc('validate_replay_access', {
     _password: pw,
     _short_id: show.short_id || null,
     _show_id: show.short_id ? null : show.id,
   })
   ```
4. Jika `success: true` → redirect ke `/replay-play?show={short_id}&password={encoded_pw}` (ReplayPlayPage sudah auto-attempt saat ada `?show=&password=` di URL — sudah dicek di useEffect baris 143-148).
5. Jika gagal → toast error "Sandi salah atau tidak berlaku untuk show ini".

## Validasi & Keamanan
- Trim & length check (1-50 char) sebelum submit (zod-style inline check).
- Tidak menyimpan password di localStorage.
- Tidak log password ke console.
- Encoding URL: `encodeURIComponent(pw)` saat redirect.
- Rate limit sudah di-handle server-side oleh RPC `validate_replay_access`.

## Aturan yang DIPATUHI
- **Tidak muncul di kartu live** (hanya `isReplayMode`).
- **Tidak muncul di kartu replay tanpa media** (`has_replay_media` filter).
- **Tidak muncul jika user sudah pegang token** untuk show tersebut (`!showToken`).
- **Tidak mengubah** flow tombol beli yang sudah ada.

## Testing Checklist (Setelah Implementasi)
- [ ] Kartu replay dengan media → tombol "Sudah punya sandi?" muncul di bawah tombol beli.
- [ ] Kartu replay tanpa media → fitur tidak muncul.
- [ ] Kartu live (regular show) → fitur tidak muncul.
- [ ] User dengan token aktif → fitur tidak muncul (sudah pakai token).
- [ ] Password benar → redirect sukses ke ReplayPlayPage dan langsung play.
- [ ] Password salah → toast error, input tetap terbuka.

## Files yang Dimodifikasi
- `src/components/viewer/ShowCard.tsx` — tambah sub-komponen `ReplayPasswordEntry` + integrasi ke action buttons.

## Files yang TIDAK Diubah
- Database (RPC `validate_replay_access` sudah lengkap menerima password).
- `ReplayPlayPage.tsx` (sudah auto-attempt dari query string).
- `Show` type (`has_replay_media` & `short_id` sudah ada).
- `get_public_shows()` RPC (sudah return `has_replay_media`).
