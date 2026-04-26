# Rencana: Kritik & Saran Global + Perbaikan Tombol Rotasi

## 1. Fitur "Kritik & Saran"

### Tabel baru (Lovable Cloud)
Buat tabel `feedback_messages` lewat migration:
- `id` (uuid, pk)
- `message` (text, max 1000 chars)
- `category` (text, opsional: "kritik" | "saran" | "bug" | "lainnya", default "saran")
- `page_url` (text, halaman saat dikirim)
- `user_id` (uuid, nullable — null untuk pengunjung anonim)
- `username` (text, opsional)
- `user_agent` (text)
- `is_read` (boolean, default false)
- `is_archived` (boolean, default false)
- `created_at` (timestamptz, default now())

**RLS policies:**
- INSERT: anon + authenticated boleh kirim (validasi length 5–1000, rate-limit via trigger pengecekan IP/created_at: maksimal 5 submission per user/IP per jam)
- SELECT/UPDATE/DELETE: hanya admin (`has_role(auth.uid(), 'admin')`)

### Komponen FAB global: `FeedbackFab.tsx`
- **Lokasi**: floating button bulat kecil (40×40px) di pojok kanan-bawah, `position: fixed`, `z-index` di bawah toaster.
- **Tidak mengganggu**:
  - Default state semi-transparan (`opacity-60`) → jadi 100% saat hover/tap.
  - Auto-hide saat fullscreen aktif (deteksi `document.fullscreenElement`).
  - Sembunyikan otomatis di route `/adpan*` dan `/restream` (admin & partner punya UI sendiri).
  - Offset bottom otomatis menyesuaikan keberadaan `MobileBottomNav` (cek viewport `<sm`).
  - Bisa di-collapse/dimatikan per-sesi via `sessionStorage` (tombol "X" kecil saat dibuka).
- **Dialog form** (Radix Dialog):
  - Pilih kategori (Saran / Kritik / Laporan Bug / Lainnya).
  - Textarea pesan (5–1000 char, counter live, validasi Zod).
  - Optional: nama tampilan (auto-isi dari profil bila login).
  - Tombol Kirim → insert ke `feedback_messages`, `page_url = window.location.pathname + search`.
  - Toast sukses + reset form.

### Pasang FAB di `App.tsx`
- Render `<FeedbackFab />` satu kali di dalam `MaintenanceGate` (di luar `<Suspense>`) sehingga muncul di **semua halaman** otomatis tanpa perlu mengedit tiap page.

### Admin panel: `FeedbackManager.tsx`
- Komponen baru di `src/components/admin/`.
- Daftar feedback dengan filter: kategori, status (baru/dibaca/diarsipkan), pencarian teks.
- Setiap kartu: kategori + badge baru, pesan, halaman asal, user/username, user-agent ringkas, waktu relatif, tombol "Tandai dibaca" / "Arsipkan" / "Hapus".
- Realtime subscription `postgres_changes` → notifikasi badge baru tanpa refresh.
- Counter "feedback baru" muncul di tombol sidebar.

**Integrasi sidebar admin** (`AdminSidebar.tsx`):
- Tambah item baru `{ id: "feedback", label: "Kritik & Saran", icon: MessageSquare }` di grup "Keamanan & Monitoring" atau grup baru "Komunitas".

**Integrasi router admin** (`AdminDashboard.tsx`):
- Tambah `case "feedback": return <FeedbackManager />;` ke switch `renderSection`.

## 2. Perbaikan Tombol Rotasi Player

### Masalah saat ini (`VideoPlayer.tsx` baris 884–889)
```ts
const o = screen.orientation;
if (o.type.includes("portrait")) await (o as any).lock("landscape");
else await (o as any).lock("portrait");
```
Cuma jalan di Chrome Android **dalam mode fullscreen**. Di iOS Safari, Firefox desktop, banyak browser mobile → langsung gagal diam-diam (try/catch kosong) → user kira tombol rusak.

### Strategi perbaikan

**Refactor `toggleOrientation`** dengan urutan fallback yang andal:

1. **Auto-fullscreen dulu jika belum**: Screen Orientation Lock API (W3C) **mensyaratkan** elemen sedang fullscreen di banyak browser. Kalau belum fullscreen, panggil `el.requestFullscreen()` dulu, tunggu event `fullscreenchange`, lalu coba `lock()`.

2. **Coba `screen.orientation.lock()`** (Chrome/Edge Android, Samsung Internet).

3. **Fallback CSS rotation** (untuk iOS Safari, Firefox, browser yang menolak `lock()`):
   - Toggle state `manualLandscape` di komponen.
   - Bungkus container player dengan kelas yang menerapkan `transform: rotate(90deg)` + swap `width/height` via `100vh`/`100vw` saat aktif.
   - Sembunyikan scrollbar body saat aktif.
   - Tap tombol lagi untuk kembali normal.

4. **Deteksi kapabilitas saat mount**: cek `'orientation' in screen && typeof screen.orientation.lock === 'function'` → set capability flag, gunakan untuk pilih jalur native vs CSS.

5. **Listener `orientationchange`** untuk update icon (portrait ↔ landscape) sehingga user mendapat feedback visual.

6. **Toast informatif** saat semua fallback gagal: "Browser Anda tidak mendukung rotasi otomatis. Putar perangkat secara manual atau aktifkan auto-rotate di pengaturan."

### Perubahan di `VideoPlayer.tsx`
- Tambah `useState` untuk `manualLandscape` & `currentOrientation`.
- Refactor `toggleOrientation` jadi async dengan urutan: auto-fullscreen → coba native lock → CSS fallback → toast error.
- Tambah class CSS dinamis di `containerRef` saat `manualLandscape` aktif.
- Tambah CSS utility di `index.css`:
  ```css
  .force-landscape {
    transform: rotate(90deg) translate(0, -100%);
    transform-origin: top left;
    width: 100vh; height: 100vw;
    position: fixed; top: 0; left: 0; z-index: 9999;
  }
  ```
- Update icon tombol agar berubah saat sudah landscape (RotateCw vs RotateCcw).

## Detail Teknis

**File baru:**
- `src/components/viewer/FeedbackFab.tsx`
- `src/components/admin/FeedbackManager.tsx`
- 1 migration SQL untuk tabel `feedback_messages` + RLS + trigger rate-limit.

**File diubah:**
- `src/App.tsx` — render `<FeedbackFab />`.
- `src/components/admin/AdminSidebar.tsx` — tambah item menu "Kritik & Saran".
- `src/pages/AdminDashboard.tsx` — tambah case `feedback`.
- `src/components/VideoPlayer.tsx` — refactor `toggleOrientation` + state baru + class kondisional.
- `src/index.css` — utility `.force-landscape`.

**Tidak dirilis sebagai edge function** — semua operasi (insert + admin read) cukup lewat RLS langsung.

**Memory yang akan diperbarui:**
- Tambah `mem://features/feedback-system` mendokumentasikan FAB + admin panel.
- Update player UI memory dengan strategi rotasi multi-fallback.
