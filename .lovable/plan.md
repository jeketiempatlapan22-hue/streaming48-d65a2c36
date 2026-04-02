

# Rencana Implementasi: 5 Fitur Perbaikan & Penambahan

## Ringkasan
1. Pisahkan show aktif dan replay di admin panel
2. Urutkan kartu show berdasarkan jadwal terdekat
3. Tambahkan tombol PiP di halaman live
4. Perbaiki error login/signup
5. Tambahkan global search di admin panel

---

## 1. Pisahkan Show Aktif & Replay di Admin Panel

**File:** `src/components/admin/ShowManager.tsx`

- Tambahkan tab/filter di atas daftar show: **"Show Aktif"** dan **"Replay"**
- Tab "Show Aktif" menampilkan show yang `is_replay === false`
- Tab "Replay" menampilkan show yang `is_replay === true`
- Urutkan show dalam tiap tab berdasarkan jadwal terdekat (menggunakan fungsi `parseShowSchedule` yang sama dengan Index.tsx)
- Show dengan jadwal terdekat di paling atas

## 2. Urutkan Kartu Show Berdasarkan Jadwal Terdekat

**File:** `src/pages/Index.tsx` (sudah ada `sortBySchedule`), `src/pages/SchedulePage.tsx`

- Landing page sudah memiliki sorting — pastikan konsisten
- Verifikasi bahwa `sortBySchedule` juga diterapkan di SchedulePage jika belum
- Show yang jadwalnya paling dekat (upcoming) di paling atas, lalu show yang sudah lewat diurutkan terbaru dulu

## 3. Tombol PiP di Halaman Live

**File:** `src/pages/LivePage.tsx`, `src/components/viewer/PipButton.tsx`

- PipButton sudah ada dan sudah dirender di LivePage header (line 524)
- Namun saat ini PiP hanya bekerja untuk `<video>` element (HLS/m3u8)
- Untuk YouTube embed (iframe), PiP native tidak didukung browser
- Perbaikan: tambahkan fallback untuk YouTube — gunakan `Document Picture-in-Picture API` jika tersedia, atau tampilkan tooltip "PiP tidak tersedia untuk YouTube"
- Update PipButton agar mendeteksi apakah player aktif adalah YouTube dan menyesuaikan behavior

## 4. Perbaiki Error Login/Signup

**File:** `src/pages/ViewerAuth.tsx`, `supabase/functions/signup-simple/index.ts`

Masalah yang sering terjadi:
- **Signup error saat edge function timeout** — Sudah ada retry, tapi perlu perkuat
- **"Email not confirmed" error** — auto_confirm sudah diaktifkan, tapi jika edge function gagal dan user mendaftar ulang via SDK langsung, bisa terjadi
- **Race condition pada submitRef** — Jika error terjadi di catch block, submitRef tidak selalu di-reset

Perbaikan:
- Tambahkan fallback: jika `signup-simple` gagal dengan network error, coba direct `supabase.auth.signUp()` sebagai fallback
- Pastikan `submitRef.current = false` selalu di-reset di semua path
- Tambahkan auto-retry login setelah signup sukses dengan delay yang lebih panjang (2 detik) untuk menunggu trigger `handle_new_user` selesai
- Tambahkan penanganan error "Email not confirmed" yang lebih baik — langsung coba signup-simple lagi untuk re-confirm

## 5. Global Search di Admin Panel

**File baru:** `src/components/admin/AdminGlobalSearch.tsx`
**File diubah:** `src/pages/AdminDashboard.tsx`, `src/components/admin/AdminSidebar.tsx`

- Tambahkan search bar di header admin panel (dan di sidebar)
- Search mencari di nama section admin (Live, Token, Show, Orders, dll)
- Ketik keyword → tampilkan section yang cocok → klik untuk navigasi
- Menggunakan komponen `Command` (cmdk) yang sudah ada di project
- Trigger: tombol di header + shortcut `Ctrl+K`
- Pencarian lokal (client-side) berdasarkan label dan keyword section

---

## Detail Teknis

### ShowManager — Tab Filter + Sort
```text
[Show Aktif] [Replay]     ← Tab buttons
┌─────────────────────┐
│ Show terdekat        │   ← sorted by schedule
│ Show berikutnya      │
│ Show yang sudah lewat│
└─────────────────────┘
```

### AdminGlobalSearch — Command Palette
- Buka dengan `Ctrl+K` atau klik icon search
- Gunakan `CommandDialog` dari `src/components/ui/command.tsx`
- Sections array dari AdminSidebar di-reuse sebagai data source
- Setiap section memiliki keywords tambahan (misal "shows" → "show, pertunjukan, replay")

### File yang akan diubah/dibuat:
1. `src/components/admin/ShowManager.tsx` — Tab filter + sort
2. `src/components/admin/AdminGlobalSearch.tsx` — Baru: command palette
3. `src/pages/AdminDashboard.tsx` — Integrasikan global search
4. `src/components/admin/AdminSidebar.tsx` — Tambah search trigger
5. `src/pages/ViewerAuth.tsx` — Perbaikan error handling login/signup
6. `src/components/viewer/PipButton.tsx` — Fallback untuk YouTube

