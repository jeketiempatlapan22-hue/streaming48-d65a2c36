# Token Reseller Mengikuti Jadwal Show + 14 Hari Replay

## Masalah Saat Ini
Pada `reseller_create_token` (DB function), untuk show reguler:
- `_final_duration` dipaksa **1 hari**
- Jika jadwal show di masa depan → `expires_at = schedule_ts + 1 hari`
- Jika jadwal show sudah lewat → `expires_at = now() + 1 hari`

Akibatnya: jika reseller membuat token hari ini untuk show lusa, token **kedaluwarsa hanya 1 hari setelah show mulai**, sehingga user tidak bisa menonton replay yang otomatis tersedia setelah show selesai.

UI card di `ResellerShowCard.tsx` juga sudah salah info ("Berlaku: jadwal show + 1 hari"), padahal seharusnya mencakup window replay.

## Tujuan
Token reseller (non-membership, non-bundle, non-replay show) harus:
1. Bisa dipakai sejak dibuat sampai jadwal live tiba (tetap pakai `valid_from = schedule_ts` agar tidak bisa dipakai lebih awal — sesuai perilaku saat ini).
2. Tetap valid saat show live.
3. **Tetap valid 14 hari setelah jadwal show**, sehingga ketika show diarsipkan menjadi replay, user yang sudah punya token tidak perlu beli lagi.

Link otomatis berpindah dari `/live?t=` ke `/replay-play?token=` karena `buildTokenWatchUrl` sudah membaca flag `is_replay_show`/`archived_to_replay` (sudah berfungsi, tidak perlu diubah).

## Perubahan

### 1. Migrasi DB — perbarui `reseller_create_token`
Untuk cabang non-membership:
- Ganti `_final_duration := 1` menjadi `_final_duration := 14`
- Perhitungan `_expires`:
  - Jika `_schedule_ts > now()`:  
    `_valid_from := _schedule_ts`  
    `_expires := _schedule_ts + INTERVAL '14 days'`
  - Jika jadwal sudah lewat:  
    `_valid_from := NULL`  
    `_expires := GREATEST(now(), _schedule_ts) + INTERVAL '14 days'` (memastikan tetap dapat 14 hari window replay terhitung dari jadwal show, bukan dari pembuatan)
- `duration_type` diset `'replay_window'` agar mudah dilacak di audit/list.
- Membership & bundle tidak berubah.

Catatan: validasi `_duration_days <= 90` tetap aman karena 14 ≤ 90, dan parameter input dari client sudah diabaikan untuk non-membership.

### 2. `src/components/reseller/ResellerShowCard.tsx`
- Update label durasi non-membership dari **"1 hari (otomatis)"** menjadi **"jadwal show + 14 hari replay"**.
- Update keterangan box biru:
  - "Berlaku: sejak jadwal show, sampai **14 hari setelah show** (otomatis berlanjut sebagai akses replay)."
  - Sertakan tanggal & jam jadwal jika ada.
- Tidak ada perubahan pada pemanggilan RPC; `_duration_days` boleh tetap dikirim 1 (server abaikan untuk non-membership).

### 3. Pesan WhatsApp — `src/lib/showMessageBuilder.ts` → `buildRegularShowMessage`
- Tambahkan baris ringkas: "Token tetap berlaku sebagai replay sampai 14 hari setelah show." agar reseller bisa menjelaskan ke pembeli.
- Jika show punya `access_password` (sandi replay), pesan existing sudah menampilkan info replay; tidak perlu duplikasi.

## Yang TIDAK Berubah
- Membership (MBR-) tetap pakai `membership_duration_days` admin.
- Bundle dilarang dibuat reseller.
- Token replay langsung dilarang.
- Endpoint admin `ManualTokenGenerator` dan flow pembelian QRIS tidak disentuh — hanya alur reseller.
- `valid_from` tetap mencegah penonton login sebelum jadwal live.

## Verifikasi
- Buat ulang token reseller untuk show dengan jadwal lusa → cek di DB: `valid_from = schedule_ts`, `expires_at = schedule_ts + 14 hari`.
- Setelah show diarsipkan jadi replay (`archived_to_replay = true`), buka `/live?t=...` → otomatis redirect / `buildTokenWatchUrl` mengarah ke `/replay-play?token=...` dan token tetap aktif sampai 14 hari pasca jadwal.
