

## Diagnosis

1. **Update tidak terlihat di beberapa device** → Service worker masih `autoUpdate` tanpa skipWaiting agresif untuk navigasi langsung; cache `index.html` ter-revalidate lambat di mobile (Safari iOS, Chrome Android dengan PWA terinstall). Beberapa user yang sudah install PWA pakai cache lama berhari-hari.

2. **DevTools tidak terdeteksi di mobile** → `VideoPlayer.tsx` line 998 sengaja `return` lebih awal kalau `isTouch || isSmallScreen` (untuk hindari false-positive dari address bar collapse). Tidak ada deteksi alternatif untuk mobile.

3. **PWA standalone untuk nonton live** → Sudah ada PWA install. Tapi tidak ada handler khusus untuk membuka link token (`/live?t=...`) langsung di app standalone — saat user klik link, browser yang terbuka, bukan PWA.

4. **QRIS wajib login** → Di `Index.tsx` `handleCoinBuy` & `MembershipPage.handleBuy` ada cek `session?.user`. Tapi `handleSubmitRegular` (QRIS reguler) sudah pakai `create_show_order` RPC + RLS `subscription_orders` allow `anon` insert (lihat policy "Anon can create guest orders"). Yang masih force login: dynamic QRIS (`create-dynamic-qris` edge function check `auth.getUser`) + tombol coin/membership.

5. **Reset token batas 3x/hari** → DB function `self_reset_token_session` saat ini pakai `check_rate_limit('self_reset:...', 2, 86400)` = **2x per 24 jam**. Frontend pakai `MAX_RESET_ATTEMPTS = 3`. Mismatch.

6. **Sesi lama tidak otomatis keluar saat reset** → `self_reset_token_session` SUDAH `DELETE FROM token_sessions WHERE token_id = t.id AND is_active = true` (line 206), tapi device lama tidak tahu sesinya dihapus karena tidak ada realtime subscription ke `token_sessions`. Polling baru jalan tiap 180s.

## Perubahan

### A. PWA & Update Distribution
- **`vite.config.ts`**: Ubah `runtimeCaching` untuk navigasi: tambah rule `NetworkFirst` untuk dokumen HTML dengan `networkTimeoutSeconds: 3` agar update langsung diambil. Tambah `globIgnores: ["index.html"]` agar HTML tidak ter-precache.
- **`src/main.tsx`**: Bump `CACHE_RESET_VERSION` ke `v12`. Saat user buka app standalone, paksa SW update + reload sekali kalau version baru terdeteksi (kecuali di `/live`).
- **`index.html`**: Tambah `<meta http-equiv="Cache-Control" content="no-cache">` agar HTML tidak di-cache browser.

### B. PWA Token Link Handler
- **`vite.config.ts` manifest**: Tambah `"protocol_handlers"` & `"share_target"` opsional, dan paling penting tambahkan `"launch_handler": { "client_mode": "focus-existing" }` agar buka link token di PWA yang sudah running.
- **`src/main.tsx`**: Saat app berjalan dalam mode standalone, intercept link `?t=TOKEN` dari URL launch dan langsung navigate ke `/live?t=...`.
- **`src/pages/LivePage.tsx`** atau hook baru: Saat user di browser biasa (bukan standalone) DAN PWA terinstall (deteksi via `getInstalledRelatedApps()`) DAN ada `?t=` di URL → tampilkan banner kecil "Buka di Aplikasi RT48" dengan link `web+rt48://live?t=...` atau intent URL untuk Chrome Android.

### C. DevTools Detection di Mobile (Konservatif)
- **`src/components/VideoPlayer.tsx`**: Hapus early-return untuk mobile. Ganti dengan deteksi mobile-specific:
  - Pakai `console.log` + `Object.defineProperty` trick: definisikan getter di object yang di-log; jika getter dipanggil = devtools terbuka membaca object.
  - Threshold tinggi (10 hits / 15s) untuk hindari false-positive dari Eruda/devtools mobile remote debugging.
  - Tetap skip jika di iframe/preview.

### D. QRIS Tanpa Login
- **`src/pages/Index.tsx` `handleBuy`** (regular show QRIS): hapus cek session — sudah jalan via `create_show_order` RPC yang handle anon.
- **`supabase/functions/create-dynamic-qris/index.ts`**: Buat `auth.getUser()` jadi optional untuk `order_type: "regular"` & "subscription" non-coin. Hanya wajib login untuk `coin` order (karena harus credit ke user).
- **`src/pages/MembershipPage.tsx` `handleBuy`** mode `qris`: skip cek session, izinkan anon submit dengan phone+email.
- **`src/components/SharedNavbar.tsx`**: Pastikan tombol "Beli QRIS" tidak trigger login popup.

### E. Reset Token: 3x/hari + Force Logout Multi-Device
- **Migration baru**: Update `self_reset_token_session` → `check_rate_limit('self_reset:...', 3, 86400)` (2 → 3).
- **`src/pages/LivePage.tsx`**: Tambah realtime subscription ke `token_sessions` filtered by `token_id=eq.${tokenData.id}`. Jika fingerprint device ini tidak ada lagi di sesi aktif setelah event DELETE → tampilkan layar "Sesi dihentikan" + tombol kembali.
  - Karena RLS `token_sessions` block anon SELECT, buat RPC baru `check_my_session_active(_token_code, _fingerprint)` SECURITY DEFINER yang return boolean. Polling tiap 30s jika realtime tidak available; pakai broadcast channel sebagai trigger ringan.
  - Alternatif lebih ringan: buat broadcast channel `token-reset-${tokenId}` — saat reset (manual atau admin via `TokenFactory.resetSessions`), kirim broadcast `{ type: "force_logout" }`. Semua device subscribed langsung tahu.

### F. Admin Reset Broadcast
- **`src/components/admin/TokenFactory.tsx` `resetSessions`**: Setelah delete session, kirim broadcast `supabase.channel('token-reset-${id}').send({ type: 'broadcast', event: 'force_logout' })`.
- **`src/pages/LivePage.tsx`**: Subscribe ke channel ini, on event → set state `forcedOut = true` → tampilkan layar "Sesi dihentikan oleh admin/perangkat lain. Klaim ulang dengan tombol di bawah." + reload.

## File yang Diedit

1. `vite.config.ts` — runtime cache HTML, manifest launch_handler
2. `src/main.tsx` — bump version v12, standalone link redirect
3. `index.html` — Cache-Control meta
4. `src/components/VideoPlayer.tsx` — devtools detection mobile via getter trap
5. `src/pages/Index.tsx` — hapus cek session pada QRIS regular
6. `src/pages/MembershipPage.tsx` — anon QRIS allowed
7. `supabase/functions/create-dynamic-qris/index.ts` — optional auth untuk regular/subscription
8. `src/pages/LivePage.tsx` — broadcast subscription, force logout screen
9. `src/components/admin/TokenFactory.tsx` — broadcast saat reset
10. **Migration SQL** baru — update `self_reset_token_session` rate limit 2 → 3

## Catatan

- Cache distribution paling efektif **setelah user buka app sekali** (SW update); user yang lama offline tetap perlu open + close sekali.
- DevTools detection mobile tidak 100% reliable; pakai conservative threshold supaya tidak ganggu user normal.
- Admin reset broadcast pakai Supabase Realtime broadcast (bukan postgres_changes) — lebih cepat & tidak butuh RLS pada `token_sessions`.

