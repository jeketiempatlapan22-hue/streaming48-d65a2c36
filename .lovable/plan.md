

# DVR Seekbar untuk Live Player

## Jawaban Pertanyaan

**Apakah fitur ini akan mengganggu fitur lain?**
Tidak, jika diimplementasikan dengan benar. Fitur ini hanya menambahkan UI seekbar dan tracking waktu di sisi klien — tidak mengubah cara stream dimuat atau diputar.

**Apakah bisa digunakan untuk M3U8 dan API Hanabira (proxy)?**
- **M3U8 (HLS)**: Ya, **bisa**. HLS.js menyimpan buffer segmen yang sudah diunduh. User bisa seek mundur dalam buffer yang tersedia (biasanya 20-60 detik tergantung konfigurasi server). Namun, seek mundur hanya bisa sejauh buffer HLS yang tersedia — bukan seluruh durasi menonton.
- **Proxy (Hanabira)**: Ya, **sama seperti M3U8** karena proxy juga menggunakan HLS.js. Batasan buffer yang sama berlaku.
- **YouTube**: Terbatas. YouTube API tidak mengekspos buffered range secara detail untuk live stream.
- **Cloudflare**: Tidak bisa — menggunakan iframe dengan kontrol sendiri.

**Batasan penting**: Untuk live stream, seek mundur hanya bisa dilakukan dalam jangkauan buffer HLS (biasanya 20-60 detik). Tidak mungkin mundur ke "awal menonton" karena segmen lama sudah dibuang dari buffer. Ini adalah limitasi teknis HLS, bukan bug.

## Rencana Implementasi

### Apa yang akan dibuat
Seekbar di control bar player yang menunjukkan:
- Durasi user telah menonton (timer dari awal join)
- Progress bar yang menunjukkan posisi relatif terhadap live edge
- Kemampuan seek mundur/maju dalam buffer HLS yang tersedia
- Label waktu: elapsed time dan jarak dari live edge

### Perubahan file

**`src/components/VideoPlayer.tsx`**
1. Tambah state: `watchStartTime` (timestamp saat player dimulai), `currentLiveOffset` (detik dari live edge), `seekableRange` (range buffer yang tersedia)
2. Tambah interval (setiap 500ms) yang membaca `video.buffered`, `video.currentTime`, dan `hls.liveSyncPosition` untuk menghitung seekable range dan posisi saat ini
3. Tambah seekbar (Slider dari Radix) di antara tombol LIVE dan spacer di control bar
4. Tampilkan label waktu: durasi menonton (format `HH:MM:SS`) dan offset dari live (`-Xs`)
5. Handler `onSeek`: gunakan `video.currentTime = targetTime` untuk seek dalam buffer
6. Seekbar hanya tampil untuk tipe `m3u8` (termasuk proxy) — hidden untuk YouTube/Cloudflare

### Detail teknis
- Seekbar range: `buffered.start(0)` sampai `buffered.end(last)` 
- Thumb position: `video.currentTime` relatif terhadap range
- Elapsed timer: `Date.now() - watchStartTime` (pure client-side, tidak perlu database)
- Saat user seek, update `isBehindLive` state sesuai jarak dari live edge
- Tidak mengubah konfigurasi HLS buffer yang sudah ada

