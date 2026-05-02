# Perbaikan Player m3u8 Patah-Patah / Stuttering

## Masalah

Pada halaman `/live`, stream m3u8 sering patah-patah (stalling, buffering berulang). Setelah investigasi `VideoPlayer.tsx`, `useSignedStreamUrl.ts`, dan edge function `stream-proxy`, ditemukan beberapa penyebab gabungan yang memperburuk satu sama lain:

### Akar Masalah

1. **Sub-playlist proxy terlalu sering hit upstream**
   - `M3U8_CACHE_TTL_MS = 2000ms` di edge function. Live segment biasanya 4–6 detik, jadi setiap poll dari HLS.js (tiap ~target-duration / 2) selalu meleset cache → fetch ulang ke origin + rewrite + HMAC sign per URI.
   - Cache key memakai `ipH`, sehingga viewer dengan IP berbeda tidak berbagi cache → beban origin berlipat saat banyak viewer.

2. **`lowLatencyMode: true` dipaksa untuk Chrome/Edge**
   - Upstream m3u8 yang dipakai adalah HLS standar (bukan LL-HLS / CMAF). Dengan lowLatencyMode aktif, HLS.js terus mencoba mengejar live edge → seek mundur/maju → stall.
   - Ditambah latency proxy ~300–800 ms per refresh, viewer hampir selalu "behind live" → trigger nudge berulang.

3. **`progressive: true` pada Chromium**
   - Beberapa response dari edge function tidak set `Content-Length` dan dilayani dengan caching headers ketat. Mode progressive di HLS.js kadang menutup stream sebelum selesai → fragment parse error → flicker.

4. **Buffer terlalu kecil dibanding latency proxy**
   - `maxBufferLength: 30 / 60` dengan TTFB proxy yang variabel menyebabkan buffer cepat habis kalau ada satu segment lambat.
   - `liveSyncDurationCount: 3` membuat player tetap di ujung live tanpa toleransi, langsung stall begitu 1 segment terlambat.

5. **Sub-playlist tidak di-cache lebih panjang**
   - Sub-playlist (rendition) di-rewrite tiap poll, tapi konten biasanya hanya berubah tiap ~target-duration. Cache 2 dt menyia-nyiakan CPU edge function dan memperlambat respons.

6. **Edge function selalu re-sign URL segment tiap poll**
   - `generateSubPlaylistSignedUrl` dipanggil per baris URI tiap rewrite. HMAC SHA-256 dilakukan puluhan kali per request. Saat traffic naik, ini menyebabkan respons sub-playlist melebihi 1 detik → HLS.js timeout/retry.

## Rencana Perbaikan

### A. Edge function `stream-proxy`

1. Naikkan `M3U8_CACHE_TTL_MS` untuk **manifest utama & sub-playlist** menjadi adaptif:
   - Default 4 detik (dari 2 dt) untuk shared cache lebih efektif.
   - Khusus mode `sub` (rendition): cache 3 dt dengan kunci tanpa `ipH` (signed URL segment kadaluarsanya 30 menit, jadi aman dishare antar viewer).
2. Pisahkan kunci cache `play` (master) dari `sub` (rendition) supaya tidak overlap.
3. Tambah header `Cache-Control: public, max-age=2` pada respons sub-playlist agar CDN/edge bisa ikut menyimpan.
4. Skip HMAC sign berulang untuk URI segment yang sama dalam satu request (memo lokal `Map<encoded, signed>` per request).

### B. `src/components/VideoPlayer.tsx` — tuning HLS.js

1. **Matikan `lowLatencyMode` total** (`false`) — tidak ada manifest LL-HLS upstream, jadi mode ini hanya merugikan.
2. **Set `progressive: false`** untuk semua browser ketika sumber adalah proxy m3u8 (deteksi via URL `/stream-proxy?mode=play`).
3. **Naikkan toleransi live edge**:
   - `liveSyncDurationCount: 4` (dari 3)
   - `liveMaxLatencyDurationCount: 12` (dari 8)
   - `maxLiveSyncPlaybackRate: 1.1` agar player bisa percepat sedikit jika tertinggal alih-alih seek.
4. **Perbesar buffer minimum**:
   - `maxBufferLength: 40` (dari 30) untuk desktop, tetap 20 untuk low-end.
   - `maxMaxBufferLength: 90` (dari 60).
   - `highBufferWatchdogPeriod: 3` (dari 2) supaya tidak terlalu agresif menandai stall.
5. **Toleransi buffer hole lebih besar** untuk segment yang datang sedikit telat:
   - `maxBufferHole: 1.0` (dari 0.5)
   - `nudgeOffset: 0.2` (dari 0.1)
6. **Naikkan retry/back-off jaringan**:
   - `fragLoadingMaxRetry: 10`
   - `manifestLoadingRetryDelay: 1000`
   - `fragLoadingTimeOut: 20000`
7. **Auto-recover yang lebih halus** — di handler `Hls.Events.ERROR` untuk fatal media error, lakukan `recoverMediaError()` dua kali sebelum `swapAudioCodec()`+`recover` (saat ini langsung destroy).

### C. Verifikasi

1. Deploy ulang `stream-proxy`.
2. Cek `/live` di preview: stream harus mulai < 4 dt dan tidak ada loading spinner berulang dalam 60 dt.
3. Cek edge function logs: tidak ada timeout `fetch m3u8` dan rata-rata response sub-playlist < 600 ms.
4. Cek network tab: respons `mode=sub` mendapat status 200 konsisten dan content `.m3u8` valid.

## File yang Diubah

- `supabase/functions/stream-proxy/index.ts` — adjust cache TTL, dedupe HMAC per request, kunci cache.
- `src/components/VideoPlayer.tsx` — tuning konfigurasi HLS.js dan recovery handler.

## Catatan

- Tidak menyentuh halaman lain (replay, restream, admin preview) selain efek tuning HLS.js yang berlaku global; perubahan ini bersifat konservatif (hanya naikkan toleransi, tidak ubah logic auth/security).
- Tidak ada perubahan skema database atau RPC.
