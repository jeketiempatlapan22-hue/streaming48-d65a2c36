## Goals

1. Player m3u8 tidak terpause saat layar tidak sengaja tersentuh — hanya tombol pause di navbar yang menjeda.
2. Hapus tombol skip ±10s di seekbar DVR. Seekbar dan navbar lain tetap dipertahankan.
3. Tambahkan animasi loading saat berpindah halaman (route transition) agar lebih menarik.

---

## 1. M3U8: Layar tidak sensitif terhadap tap

File: `src/components/VideoPlayer.tsx`

- Hapus `onClick={handlePlayPause}` dari elemen `<video>` m3u8 (line 1165) sehingga tap di area video TIDAK lagi memicu pause/play.
- Ganti `cursor-pointer` → `cursor-default` pada className video m3u8 (line 1166) supaya UI sesuai.
- Tetap tambahkan `onContextMenu` & `onDragStart` blocker (sudah ada di container) untuk anti-pencurian.
- Tombol play/pause besar di overlay loading/error (sekitar line 1319) tetap berfungsi karena pengguna eksplisit mengkliknya.
- Untuk YouTube/Cloudflare overlay tetap memakai `handlePlayPause` (tidak diubah) — perubahan hanya berlaku untuk `playlistType === "m3u8"`.
- Catatan: `handlePlayPause` di tempat lain (tombol di navbar bawah, line 1196 & 1225, dan tombol kontrol line 1319) tetap dipertahankan; ini satu-satunya cara user menjeda.

## 2. Hapus tombol skip ±10s di DVR seekbar

File: `src/components/VideoPlayer.tsx` (blok line 1349-1425)

- Hapus tombol "Skip back 10s" (line 1351-1366) dan "Skip forward 10s" (line 1404-1423).
- Pertahankan:
  - Elapsed watch time (line 1368-1371)
  - Slider seekbar (line 1373-1397) — masih bisa di-drag manual untuk navigasi.
  - Live offset indicator (line 1399-1402)
- Sesuaikan `flex` gap container agar layout tetap rapi setelah tombol dihapus.

## 3. Animasi loading saat berpindah halaman

File: `src/App.tsx`

- Buat komponen baru `RouteTransitionLoader` yang:
  - Memantau `useLocation().pathname` dan menampilkan overlay loading singkat (~400ms) setiap kali path berubah.
  - Menggunakan style yang konsisten dengan `PageLoader` existing (logo + dots neon cyan/magenta) namun versi overlay full-screen dengan `animate-fade-in`/`animate-fade-out`.
  - Menggunakan `position: fixed inset-0 z-[9999]` dengan backdrop blur agar terlihat menarik tetapi cepat hilang.
- Pasang komponen ini di dalam `<BrowserRouter>` bersama `VisitorTracker`, sebelum `MaintenanceGate`.
- Suspense fallback `PageLoader` yang sudah ada tetap dipertahankan untuk lazy-load chunk pertama; overlay baru ini menambah feedback visual untuk navigasi antar route yang sudah ter-cache.

### Detail animasi
- Durasi tampil: 350-500ms (cukup untuk efek polesan, tidak mengganggu navigasi).
- Animasi: kombinasi `animate-fade-in` + dot pulse (sudah tersedia di tailwind config).
- Ringan: tidak memblokir route render — overlay muncul di atas content baru.

---

## Files Affected

- `src/components/VideoPlayer.tsx` — hapus tap-to-pause m3u8, hapus tombol ±10s.
- `src/App.tsx` — tambah `RouteTransitionLoader` overlay.

Tidak ada perubahan database, edge function, atau dependency baru.
