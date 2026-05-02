## Akar Masalah

### Masalah 1 — YouTube Error 153 di halaman Replay
`src/components/replay/YoutubeReplayPlayer.tsx` membangun URL embed dengan parameter bermasalah:
```
?enablejsapi=1&controls=0&modestbranding=1&rel=0&showinfo=0&fs=0
&iv_load_policy=3&disablekb=1&playsinline=1&vq=hd1080
&origin=...&widgetid=1
```
- `widgetid=1` bukan parameter resmi YouTube IFrame API → memicu validasi konfigurasi yang gagal pada beberapa video.
- `vq=hd1080` sudah deprecated sejak 2018 (kualitas dipilih otomatis oleh YT).
- `showinfo` & `fs=0` tertentu menyebabkan rejection pada video tertentu (terutama yang sumbernya restricted).
- Kombinasi parameter ini → **YouTube Player Error 153** ("Terjadi error pada konfigurasi pemutar video").

### Masalah 2 — Token replay ditolak, tidak otomatis dialihkan ke replay
Saat show dijadikan replay (`is_replay=true`), trigger `migrate_tokens_on_replay_flip` seharusnya menyalin token aktif dari tabel `tokens` → `replay_tokens`. Tetapi pada beberapa kasus (mis. token dibuat **setelah** show flip, atau show dibuat sebagai replay sejak awal), token tetap tertinggal di `tokens` saja.

Konsekuensi: ketika user membuka `/live?t=RT48-XXXXX`:
1. `validate_active_live_token` mengembalikan `replay_redirect: true` + error "Show ini sudah menjadi replay…"
2. Frontend `LivePage.tsx` (baris 598-606) mencoba `validate_replay_access({ _token: tokenCode })` untuk auto-redirect.
3. RPC `validate_replay_access` **hanya** mengecek tabel `replay_tokens` untuk path token. Token live (`RT48-...`) tidak ditemukan → return `success: false`.
4. Frontend gagal redirect → tampil layar merah "Akses Ditolak" dengan teks "Show ini sudah menjadi replay. Mengalihkan ke halaman replay." (yang ironisnya tidak benar-benar mengalihkan).

Verifikasi langsung di DB: token `RT48-642D6A1C52F5` (dari screenshot) ada di `tokens` (active, expires hari ini) tapi **tidak ada** di `replay_tokens`.

## Perubahan

### A. Perbaiki Player YouTube — `src/components/replay/YoutubeReplayPlayer.tsx`
1. Buang parameter bermasalah dari URL embed:
   - Hapus `widgetid=1` (non-standar).
   - Hapus `vq=hd1080` (deprecated, diabaikan YT).
   - Hapus `showinfo=0`, `fs=0`, `disablekb=1` yang menjadi penyebab umum Error 153.
2. Pertahankan parameter yang valid: `enablejsapi=1`, `controls=0`, `modestbranding=1`, `rel=0`, `iv_load_policy=3`, `playsinline=1`, `origin=...`.
3. Tambahkan `<iframe>` attribute `allowFullScreen` dan `allow="autoplay; encrypted-media; fullscreen; picture-in-picture"` (sudah ada).
4. Tetap kontrol kualitas via postMessage `setPlaybackQuality` setelah `onReady`.
5. Tambahkan **fallback link "Tonton di YouTube"** jika player tetap menolak setelah 8 detik (sebagai safety net untuk video restricted).

### B. Perbaiki RPC `validate_replay_access` — Migration baru
Tambahkan path baru: terima **token live** (`RT48-`/`MR-`/`RPL-`/dll) yang masih ada di tabel `tokens` ketika show-nya sudah `is_replay=true`. Logikanya:
1. Cek `tokens` table untuk `_token` dengan `status='active'` dan `expires_at > now()`.
2. Jika ditemukan dan `shows.is_replay = true`:
   - **Auto-migrate**: insert ke `replay_tokens` (mirroring trigger), set `expires_at = now() + 14 days`.
   - Hapus dari `tokens`.
   - Return `success: true` dengan akses replay.
3. Ini menyelamatkan kasus token yatim yang tertinggal di `tokens`.

Tidak mengubah logika RPC lainnya, hanya menambahkan branch baru di awal sebelum return error.

### C. Frontend redirect lebih robust — `src/pages/LivePage.tsx`
1. Setelah validate_replay_access, jika **gagal** TAPI server mengembalikan `replay_redirect: true`, tetap redirect user ke `/replay-play?token=...` agar form replay terisi otomatis & user bisa coba kombinasi sandi show.
2. Tambahkan auto-redirect timer (1.5 detik) untuk pesan "Mengalihkan ke halaman replay" sehingga benar-benar mengalihkan, bukan hanya menampilkan teks.

### D. Tambahan kecil — `src/pages/ReplayPlayPage.tsx`
Pastikan ketika datang dari `/replay-play?token=RT48-...` (token live yang sudah dimigrasikan oleh RPC), tampilan loading muncul rapi & error message lebih informatif jika tetap gagal.

## File yang Diubah
- `src/components/replay/YoutubeReplayPlayer.tsx`
- `src/pages/LivePage.tsx`
- `src/pages/ReplayPlayPage.tsx` (penyesuaian kecil)
- 1 migration baru: update fungsi `validate_replay_access`

## Hasil yang Diharapkan
- **YouTube Error 153 hilang** — video replay tampil normal dengan kontrol kustom.
- **Token live yatim** (`RT48-...` di show is_replay=true) otomatis diterima dan dimigrasikan saat user mengaksesnya, lalu dialihkan ke `/replay-play` dan langsung memutar replay.
- Tidak ada lagi layar "Akses Ditolak — Mengalihkan ke halaman replay" yang menyesatkan.