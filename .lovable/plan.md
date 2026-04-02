

# Rencana: Global Search Mobile, Optimasi, & Auto-Schedule Live

## Ringkasan
1. **Global Search mobile-friendly** — pastikan AdminGlobalSearch accessible di mobile header (sudah ada di line 214, tinggal pastikan responsif)
2. **Optimasi website & database** — perbaiki query patterns, tambah error boundary, dan stabilkan auth flow
3. **Auto-schedule live ON/OFF** — admin bisa set jadwal kapan live otomatis ON dan OFF

---

## 1. Global Search di Mobile

**File:** `src/components/admin/AdminGlobalSearch.tsx`, `src/pages/AdminDashboard.tsx`

AdminGlobalSearch sudah dirender di mobile header (line 214). Perbaikan:
- Pada mobile, tampilkan hanya icon search (tanpa teks "Cari menu...") agar hemat ruang
- Pastikan CommandDialog full-width di mobile
- Sudah ada `hidden sm:inline` pada teks — ini sudah benar. Verifikasi tampilan.

## 2. Optimasi Website & Stabilitas

**File:** `src/pages/ViewerAuth.tsx`, `src/pages/LivePage.tsx`, `src/components/admin/LiveControl.tsx`

Perbaikan:
- **ViewerAuth**: Pastikan `submitRef.current = false` di semua exit paths (sudah ada di finally block — OK). Tambahkan guard agar loading state selalu di-reset.
- **LivePage**: Kurangi jumlah realtime channel yang di-subscribe bersamaan. Gunakan satu channel gabungan untuk `streams` + `site_settings` + `shows`.
- **LiveControl**: Tambahkan error handling pada setiap Supabase call (saat ini banyak yang tidak di-handle).
- **General**: Pastikan cleanup effect pada unmount untuk menghindari memory leak.

## 3. Auto-Schedule Live ON/OFF (Fitur Baru)

### Konsep
Admin mengatur jadwal: "Live ON jam 19:00, Live OFF jam 22:00" → sistem otomatis toggle `is_live` pada stream.

### Implementasi

**A. Database** — Tambah 2 site_settings keys:
- `auto_live_on_time` — waktu live ON (format "HH:mm", timezone WIB)  
- `auto_live_off_time` — waktu live OFF (format "HH:mm", timezone WIB)
- `auto_live_enabled` — "true"/"false"

**B. Edge Function baru:** `supabase/functions/auto-live-toggle/index.ts`
- Dipanggil oleh cron job setiap menit
- Cek waktu WIB saat ini vs `auto_live_on_time` dan `auto_live_off_time`
- Jika cocok, toggle `streams.is_live`
- Hanya toggle jika status saat ini berbeda (hindari update berulang)

**C. Cron Job** — Setup `pg_cron` untuk memanggil edge function setiap menit

**D. UI Admin:** `src/components/admin/LiveControl.tsx`
- Tambah section "⏰ Jadwal Live Otomatis" di bawah Live Toggle
- Toggle enable/disable auto-schedule
- Input waktu ON dan waktu OFF (format HH:mm WIB)
- Simpan ke `site_settings`

### Alur
```text
Admin set: ON=19:00, OFF=22:00, enabled=true
  ↓
pg_cron → setiap menit → call auto-live-toggle
  ↓
Edge function cek waktu WIB:
  - 19:00 → SET is_live=true (jika belum ON)
  - 22:00 → SET is_live=false (jika belum OFF)
  - Lainnya → skip
```

---

## File yang akan diubah/dibuat

1. `src/components/admin/AdminGlobalSearch.tsx` — Optimasi mobile view
2. `src/components/admin/LiveControl.tsx` — Tambah UI auto-schedule live
3. `src/pages/ViewerAuth.tsx` — Guard tambahan untuk stabilitas
4. `src/pages/LivePage.tsx` — Konsolidasi realtime subscriptions
5. `supabase/functions/auto-live-toggle/index.ts` — Edge function baru
6. Database: Setup `pg_cron` job untuk auto-live-toggle
7. Database: Insert `auto_live_enabled`, `auto_live_on_time`, `auto_live_off_time` ke `site_settings`

