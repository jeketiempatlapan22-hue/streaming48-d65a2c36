# Perbaiki Embed YouTube di Halaman Replay Play

## Masalah

Pada halaman `/replay-play`, ketika sumber YouTube dipilih, area player tampak hitam atau menampilkan teks error "Link YouTube tidak valid" / overlay "Menghubungkan ke YouTube…" yang tidak pernah hilang. Embed YouTube tidak benar-benar muncul.

Penyebab di `src/components/replay/YoutubeReplayPlayer.tsx`:

1. **Overlay loading tidak pernah ditutup.** `setLoading(false)` hanya dipanggil setelah event `onReady`/`infoDelivery` dari YouTube IFrame API. Pada banyak kondisi (mobile, autoplay diblok, latensi tinggi), event ini telat atau tidak terkirim, sehingga overlay z-[16] menutupi iframe selamanya.
2. **Watchdog 8 detik me-reload iframe terus-menerus** lewat `setReloadKey`, sehingga thumbnail YouTube selalu di-reset sebelum sempat tampil dan event `onReady` tidak pernah selesai.
3. **Validasi ID terlalu ketat.** Jika `youtube_url` kosong / format aneh, langsung tampil teks "Link YouTube tidak valid" tanpa pesan yang jelas atau fallback.

User minta perbaikan yang **mempertahankan**:
- Overlay click-blocker (mencegah klik tembus ke kontrol asli YouTube / link "Watch on YouTube").
- Custom controls (play, pause, mute, fullscreen, quality) tetap berfungsi.

## Solusi

Refactor `YoutubeReplayPlayer` agar embed pasti tampil, sambil menjaga proteksi & custom controls:

1. **Iframe selalu render dan terlihat sejak awal** — hapus dependensi tampilan iframe pada event `onReady`. Loading hanya ditampilkan **maksimum 1.5 detik** sebagai transisi visual; setelah itu otomatis disembunyikan walaupun event API belum diterima.
2. **Hapus watchdog reload 8 detik** yang me-reset iframe. Iframe YouTube pasti load sendiri jika ID valid; reload otomatis justru menyebabkan loop.
3. **Pertahankan overlay click-blocker** (z-10) untuk mencegah user mengklik link YouTube di dalam iframe — overlay tetap menjadi target klik untuk tombol play/pause via tap, persis seperti perilaku saat ini.
4. **Pertahankan custom controls bottom bar** (z-20): play/pause, mute/unmute, AUTO/MAX quality, fullscreen — semuanya tetap mengirim postMessage ke iframe seperti sebelumnya.
5. **Perbaiki UX validasi ID**: ID 11 karakter dari DB (mis. `aP2MdnWW4Do`) maupun URL penuh sama-sama jalan via `parseYoutubeId` yang sudah ada. Jika benar-benar invalid, tampilkan pesan yang lebih jelas: "URL/ID YouTube belum dikonfigurasi untuk show ini" — bukan generic.
6. **Mute=true pada parameter awal iframe** dihilangkan; tetap pakai default unmuted, tapi tombol play custom akan memanggil `playVideo` setelah user-gesture (klik overlay) — ini kondisi yang diizinkan browser.

Tidak ada perubahan di:
- `src/pages/ReplayPlayPage.tsx` — logika selektor sumber, RPC, dan rendering tetap.
- `src/lib/youtubeUrl.ts` — parser ID sudah benar.
- RPC `validate_replay_access` — sudah mengembalikan `youtube_url` & `has_media` dengan benar.
- Komponen / halaman lain di luar replay play.

## Detail Teknis

File yang diubah: **`src/components/replay/YoutubeReplayPlayer.tsx`** (rewrite ~260 baris → lebih ringkas, ~200 baris).

Perubahan kunci:

```text
- iframe src: tetap https://www.youtube.com/embed/{id}?enablejsapi=1&controls=0&modestbranding=1
            &rel=0&showinfo=0&fs=0&iv_load_policy=3&disablekb=1&playsinline=1
            &origin={window.location.origin}
            (controls=0 wajib karena kita pakai custom controls)
- HAPUS: useEffect watchdog readyTimeoutRef + setReloadKey
- HAPUS: ketergantungan setLoading(false) hanya pada onReady
- TAMBAH: setTimeout 1500ms di mount → setLoading(false) sebagai fallback
- TETAP: overlay click-blocker z-10 (transparent, capture click → togglePlay)
- TETAP: bottom controls z-20 (play/pause/mute/quality/fullscreen)
- TETAP: adaptive quality watcher (downgrade saat buffering >3s)
- TETAP: postMessage bridge untuk infoDelivery (sinkron status playing/muted/quality)
```

Struktur layering tetap:
```text
z-0  : <iframe> (visible sejak load, kontrol native disembunyikan via controls=0)
z-10 : click-blocker overlay (transparent, mencegah klik ke iframe + capture togglePlay)
z-15 : overlay "Menyesuaikan kualitas" (muncul hanya saat switching quality)
z-16 : overlay loading (HANYA muncul ≤1.5 detik di awal mount)
z-20 : custom controls bar (play, pause, mute, AUTO/MAX, fullscreen)
```

CSP di `index.html` sudah mengizinkan `frame-src https://www.youtube.com` — tidak perlu diubah.

## Verifikasi

1. Buka `/replay-play?show={short_id}` untuk show yang punya `replay_youtube_url` (mis. "Passion 200%" → ID `aP2MdnWW4Do`).
2. Pilih tab **YouTube** atau biarkan **Auto** (jika hanya YouTube tersedia).
3. Embed YouTube langsung tampil dalam ≤1.5 detik dengan thumbnail/poster.
4. Klik area video → video play (custom button). Klik lagi → pause.
5. Tombol mute, AUTO/MAX quality, dan fullscreen semua tetap berfungsi.
6. Coba klik logo YouTube atau judul di dalam iframe → tetap tertahan oleh overlay (klik di-capture untuk play/pause), user tidak bisa berpindah ke youtube.com.
