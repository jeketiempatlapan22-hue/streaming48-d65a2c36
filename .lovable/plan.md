## Tujuan
Menambahkan bar seek (progress bar) pada `YoutubeReplayPlayer` agar user dapat maju/mundur replay YouTube, mirip dengan kontrol pada `HlsReplayPlayer`.

## Perubahan
File: `src/components/replay/YoutubeReplayPlayer.tsx`

### 1. Tambah state waktu
- `currentTime: number`, `duration: number`, `seeking: boolean`

### 2. Polling waktu via YT IFrame API
Karena `infoDelivery` tidak otomatis mengirim `currentTime`/`duration`, gunakan `setInterval` 500ms yang memanggil:
- `getCurrentTime` → via postMessage `{event:"command", func:"getCurrentTime"}`
- `getDuration` → via postMessage `{event:"command", func:"getDuration"}`

YT membalas via `infoDelivery` dengan field `currentTime` dan `duration` setelah kita subscribe ke `listening` channel (sudah dilakukan). Tangkap field tersebut di handler `onMessage` yang sudah ada dan update state (skip update saat `seeking=true` untuk hindari jitter).

### 3. UI seek bar
Tambahkan baris baru di atas baris kontrol bawah (di dalam div `bottom-0 z-20`):
- `<input type="range" min=0 max={duration} step={0.1} value={currentTime}>` dengan styling tipis (h-1, accent primary).
- `onChange` → update `currentTime` lokal + set `seeking=true`.
- `onMouseDown/onTouchStart` → `seeking=true`.
- `onMouseUp/onTouchEnd/onChange commit` → `post("seekTo", [value, true])` lalu `seeking=false`.
- Tampilkan label waktu kiri (`mm:ss`) dan kanan (`mm:ss / mm:ss`) menggunakan helper `formatTime`.

### 4. Tombol skip ±10 detik (opsional kecil)
Di toolbar kontrol kiri, tambah dua tombol:
- ⟲ 10s: `post("seekTo", [Math.max(0, currentTime - 10), true])`
- ⟳ 10s: `post("seekTo", [Math.min(duration, currentTime + 10), true])`

### 5. Cleanup
Bersihkan interval polling pada unmount.

## Catatan teknis
- YT IFrame API mengirim `currentTime` & `duration` di `infoDelivery` setelah pesan `listening` dikirim (sudah di-subscribe).
- `seekTo(seconds, allowSeekAhead=true)` adalah fungsi standar YT IFrame.
- Click-blocker overlay (z-10) tidak perlu diubah; seek bar berada di z-20 sehingga tetap interaktif.
- Tidak ada perubahan database/edge function.
