## Tujuan

1. Monitor & Quiz di Admin Panel kembali bisa dibuka dengan stabil — tidak nge-blank.
2. Halaman Live tetap lancar, tidak terganggu oleh perubahan ini.
3. Halaman Restream menampilkan player **IDN (proxy/Hanabira)** dan **Resolusi B (direct)** dengan benar.
4. Tampilan halaman Restream disamakan dengan layout Monitor (preview player + tab switcher), tetapi **tanpa** Live Poll, Live Quiz, Live Chat, dan Live Viewer Count.

---

## Masalah yang diperbaiki

### A. Monitor & Quiz nge-blank / tidak terbuka
- `AdminMonitor.tsx` saat ini memuat **banyak komponen berat sekaligus** (VideoPlayer, LiveChat, PollManager, QuizManager, LivePoll, LiveQuizSlot, ChatModeratorManager) di satu tree. Bila salah satu child melempar error, seluruh halaman ikut blank karena tidak ada ErrorBoundary.
- Channel realtime `monitor-stream-rt` dibuat ulang setiap `activePlaylist?.type` berubah → memicu warning "subscribe multiple times" + race condition.
- Section `quiz` di `AdminDashboard.tsx` mengarah ke `AdminMonitor` (tidak ada panel khusus quiz).

### B. Restream tidak menampilkan IDN & Resolusi B
- **IDN (proxy)**: `RestreamPage` selalu memakai `useRestreamSignedStreamUrl` (server-side proxy via edge function). Untuk tipe `proxy`, edge function butuh `site_settings.active_show_id` **dan** show tersebut harus punya `external_show_id`. Jika belum diset → error 400 "Tidak ada show aktif" dan player tidak tampil.
- **Resolusi B (direct)**: di-handle dengan benar oleh kode tapi tidak tampil karena layout Restream saat ini fullscreen + spinner sampai `effectiveUrl` siap, dan tidak menampilkan pesan error yang jelas saat URL kosong/rusak.

### C. Layout Restream tidak konsisten dengan Monitor
- Restream saat ini hanya player fullscreen + bar switcher di bawah. User minta dibuat seperti card Monitor: header info, card preview player dengan border, switcher di bawah card.

---

## Yang akan diubah

### 1. `src/components/admin/AdminMonitor.tsx` — Stabilisasi
- Bungkus konten utama dengan `ErrorBoundary` (sudah ada di `src/components/ErrorBoundary.tsx`) supaya 1 error tidak nge-blank semua section.
- Ubah child berat (`PollManager`, `QuizManager`, `LiveChat`, `ChatModeratorManager`, `LivePoll`, `LiveQuizSlot`) menjadi **lazy import** + `Suspense` lokal supaya halaman bisa render parsial walau salah satu lambat / gagal.
- Stabilkan channel realtime: gunakan nama unik per session (`monitor-stream-rt-${randomId}`) dan **hapus** `activePlaylist?.type` dari dependency array `useEffect` agar channel tidak di-resubscribe saat ganti playlist.
- Pisahkan blok Poll dan Quiz menjadi 2 child component file kecil (`MonitorPollSection.tsx`, `MonitorQuizSection.tsx`) agar lebih mudah lazy + isolasi error.

### 2. `src/pages/AdminDashboard.tsx`
- Bungkus `renderSection()` dengan `ErrorBoundary` di dalam `<Suspense>` supaya error sebuah section tidak menjatuhkan seluruh dashboard.
- Tetap pertahankan mapping `case "monitor": case "quiz": return <AdminMonitor />` (tidak breaking).

### 3. `src/pages/RestreamPage.tsx` — Perbaikan player + Layout baru
- **Layout baru** (mirror Monitor, tanpa chat/poll/quiz/viewer):
  - Header kecil: judul "Halaman Restream" + status koneksi.
  - Card preview player dengan border (sama style seperti Monitor): info "Preview Player" di atas, video di tengah, `PlaylistSwitcher` di bawah card.
  - Tombol fullscreen tetap ada di pojok kanan atas player.
  - Tombol kecil "Logout kode" untuk reset kode akses.
- **Fix player IDN (proxy)**:
  - Tambah RPC publik baru `get_active_show_external_id()` (SECURITY DEFINER) yang hanya mengembalikan `external_show_id` dari show aktif — aman dipanggil dari client tanpa expose data lain.
  - Di RestreamPage, bila `activePlaylist.type === "proxy"`, panggil RPC ini untuk dapat `externalShowId`, lalu gunakan **client-side `useProxyStream`** (sama seperti AdminMonitor & LivePage) — tidak lewat edge function. Header auth langsung di-inject via `xhrSetup` di HLS.js. Ini menghilangkan ketergantungan pada konfigurasi `active_show_id` di sisi server proxy.
  - Bila RPC mengembalikan null (admin belum pilih show), tampilkan pesan: "Belum ada show aktif yang dipilih admin."
- **Fix player Resolusi B (direct)**:
  - Tambah handling error eksplisit di VideoPlayer slot: kalau direct URL gagal load, tampilkan banner error dengan tombol "Coba lagi".
  - Pastikan `key` VideoPlayer berubah saat ganti playlist supaya tidak ada cached state error dari playlist sebelumnya.
- Tambahkan ErrorBoundary di sekeliling player slot.

### 4. `src/hooks/useRestreamSignedStreamUrl.ts`
- Skip pemanggilan untuk tipe `proxy` (sekarang ditangani client-side). Hanya proses tipe `m3u8`/`youtube`/`cloudflare`.

### 5. Migration baru: `get_active_show_external_id` RPC
```sql
CREATE OR REPLACE FUNCTION public.get_active_show_external_id()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.external_show_id
  FROM site_settings ss
  JOIN shows s ON s.id::text = ss.value
  WHERE ss.key = 'active_show_id'
  LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION public.get_active_show_external_id() TO anon, authenticated;
```
- Tidak menyentuh tabel/skema lain. Tidak mengubah RLS.

### 6. Halaman Live (`LivePage.tsx`)
- **Tidak diubah**. Logika streaming yang sama tetap dipakai. Perubahan client-side proxy untuk Restream menggunakan hook yang sama (`useProxyStream`) yang sudah dipakai LivePage, jadi tidak ada efek samping.

---

## Layout Halaman Restream (sesudah)

```text
┌─────────────────────────────────────────────────────┐
│  📺 Halaman Restream            [logout kode] [●LIVE]│
├─────────────────────────────────────────────────────┤
│  ┌───────────────────────────────────────────────┐  │
│  │  Preview Player                               │  │
│  │  Pilih resolusi/server di bawah.              │  │
│  │  ┌─────────────────────────────────────────┐  │  │
│  │  │                                         │  │  │
│  │  │            [VIDEO PLAYER]   [⛶]         │  │  │
│  │  │                                         │  │  │
│  │  └─────────────────────────────────────────┘  │  │
│  │  [▶ IDN]  [▶ Resolusi A]  [▶ Resolusi B]     │  │
│  └───────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

---

## Files yang akan dibuat / diubah

- `src/components/admin/AdminMonitor.tsx` — ErrorBoundary + lazy children + stable channel
- `src/components/admin/MonitorPollSection.tsx` *(baru)*
- `src/components/admin/MonitorQuizSection.tsx` *(baru)*
- `src/pages/AdminDashboard.tsx` — ErrorBoundary di sekitar section
- `src/pages/RestreamPage.tsx` — layout mirror Monitor + fix proxy/direct
- `src/hooks/useRestreamSignedStreamUrl.ts` — skip type proxy
- Database migration: tambah RPC `get_active_show_external_id`

## Yang TIDAK diubah

- `LivePage.tsx`, `VideoPlayer.tsx`, `useProxyStream.ts`, `stream-proxy` edge function (selain RPC baru).
- Tidak ada perubahan RLS/skema tabel.
