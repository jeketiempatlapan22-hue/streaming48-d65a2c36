# Investigasi Mendalam Error Halaman Live

## Temuan Audit

Screenshot menunjukkan ErrorBoundary muncul (`Terjadi Kesalahan`) di `/live?t=MBR-47E1E2`. Token `MBR-47E1E2` **tidak ada** di tabel `tokens` maupun `replay_tokens` (sudah saya cek DB), jadi alur seharusnya jatuh ke `setError("Akses Ditolak")` — **bukan** ErrorBoundary. Artinya ada *exception* yang lolos dari try/catch di salah satu titik.

Setelah audit baris demi baris pada `LivePage.tsx`, komponen anak (LivePoll, LiveQuizSlot, LiveChat, LineupAvatars, ConnectionStatus, ViewerBroadcast, SecurityAlert, VideoPlayer), dan hooks (`useSignedStreamUrl`, `useProxyStream`, `useLiveQuiz`), berikut titik rawan yang ditemukan:

### 1. Bukan dari Quiz / Poll / Chat secara langsung
LivePoll, LiveQuizBanner, LiveChat **tidak** memakai `localStorage`/`crypto` langsung dan punya try/catch di semua RPC. Quiz & poll **bukan penyebab utama**.

### 2. Penyebab utama yang sangat mungkin
- **a. `useState` initializer di LivePage**: `safeStorageGet` aman, tapi blok `JSON.parse(raw)` di `DeviceLimitScreen` dan beberapa tempat lain masih bisa throw kalau `raw` korup → state init throw → ErrorBoundary.
- **b. `lazy()` di-deklarasikan di module-scope**: bila satu chunk gagal di-fetch (browser dalam-app Mi/Telegram dengan koneksi flaky), `Suspense` akan throw error setelah retry timeout → ErrorBoundary. Saat ini **tidak ada `errorElement` per route** dan `Suspense` tidak punya `ErrorBoundary` per-komponen.
- **c. Edge function `stream-proxy` melempar non-2xx**: `useSignedStreamUrl` me-`throw` di catch tapi `setSignedUrl(null)` tetap dijalankan — ini aman. Namun bila `supabase.functions.invoke` throw karena CORS/network di in-app browser, `response.error` tidak terbaca dengan benar di beberapa edge case → unhandled promise.
- **d. Race condition `validate_token` → `validate_replay_access`**: kalau user akses token live yang sudah dimigrasi → kode redirect `window.location.replace(...)` di baris 544. Tapi *sebelum* redirect terjadi, hook lain (`useSignedStreamUrl`) sudah dipanggil dengan `tokenCode` lama → bisa throw async setelah unmount.
- **e. `LiveQuizSlot` import via `lazy` lalu di-render di `Suspense fallback={null}`**: `useLiveQuiz` me-subscribe realtime + interval. Jika `loadActive` mendapat `null`/error tak terduga, `setActiveQuiz` masih aman. Tapi `loadWinners` memakai `toast.success` — kalau `Sonner` belum ter-mount karena race lazy chunk, tidak masalah. Aman.
- **f. `motion`/`AnimatePresence` di FlipDigit**: jika `value` kebetulan `NaN` (misal `countdown.s = NaN` saat `target` invalid) → render string `"NaN"` → tetap render (aman). Tapi `padStart` pada `NaN.toString()` masih aman.
- **g. `ErrorBoundary` global sekarang menangkap *semua* error termasuk error yang seharusnya jadi UI inline**, sehingga "Akses Ditolak" tidak pernah terlihat user.

### 3. Penyebab sekunder
- `ViewerBroadcast` & `SecurityAlert` membuat realtime channel tanpa try/catch di subscribe — kalau Supabase realtime down, `removeChannel` di cleanup bisa throw.
- `LineupAvatars` memanggil `supabase.rpc("get_public_shows")` tanpa error handling — kalau RPC timeout di koneksi lemah, promise reject → unhandled.
- `useLiveQuiz` polling 2 detik untuk winners + 15 detik untuk active state, **tanpa try/catch** di pemanggilan langsung — bila Supabase 503/429, throw terus-menerus.

## Rencana Perbaikan

### A. Membungkus Setiap Sub-Region dengan ErrorBoundary Lokal
Buat `SectionBoundary` (varian dari `ErrorBoundary` dengan `fallback={null}` atau pesan kecil) lalu bungkus tiap area di LivePage:
- `<SectionBoundary><LivePoll /></SectionBoundary>`
- `<SectionBoundary><LiveQuizSlot /></SectionBoundary>`
- `<SectionBoundary><LiveChat /></SectionBoundary>`
- `<SectionBoundary><LineupAvatars /></SectionBoundary>`
- `<SectionBoundary><ViewerBroadcast /></SectionBoundary>`
- `<SectionBoundary><SecurityAlert /></SectionBoundary>`
- `<SectionBoundary><VideoPlayer /></SectionBoundary>`

Tujuan: bila satu komponen gagal, halaman **tetap tampil** (player tetap jalan, error hanya di sidebar/komponen yang gagal).

### B. Hardening Hook & Komponen
1. **`useLiveQuiz`** — bungkus semua `await supabase.*` di `loadActive`/`loadWinners` dengan try/catch agar interval polling tidak melempar.
2. **`LineupAvatars`** — try/catch + early return saat RPC gagal.
3. **`ViewerBroadcast` & `SecurityAlert`** — try/catch di `subscribe()` dan `removeChannel()`.
4. **`useSignedStreamUrl`** — tangkap `supabase.functions.invoke` yang throw (network, CORS) sebagai `error state`, jangan biarkan `unhandled rejection`.
5. **`useProxyStream`** — pastikan tidak throw saat `externalShowId` null/undefined; tambahkan guard.
6. **LivePage validate flow** — saat redirect ke `/replay-play`, segera `return` *dan* set flag agar render berikutnya tidak memanggil hook stream (saat ini hook tetap berjalan sebelum unmount).
7. **`safeStorageGet`/`safeJsonParse`** — tambahkan helper `safeJsonParse` di `clientId.ts` untuk membungkus `JSON.parse` agar konsisten.

### C. Menampilkan Pesan Error yang Bermakna (bukan ErrorBoundary)
- Pastikan `setError("Token tidak valid")` terpasang sebagai fallback terakhir di catch global `validate()`.
- Tambahkan logging tracing (`console.warn("[LivePage] validate failed:", e)`) — sudah otomatis terambil oleh sistem agar jika kasus ini berulang kita bisa lihat di log Lovable.

### D. Watchdog Anti-Reload Loop
Tambahkan `try/catch` di sekitar `componentDidCatch` ErrorBoundary untuk **mengirim event** ke `security_events` (supaya admin bisa lihat berapa kali error muncul) — namun *tidak* memicu reload otomatis (karena reload bisa loop).

### E. Validasi via Browser Setelah Implementasi
Setelah semua perubahan, akan saya:
1. Buka `/live?t=MBR-47E1E2` (token tidak valid) — harus tampil "Akses Ditolak", bukan ErrorBoundary.
2. Buka `/live` tanpa token — harus tampil "Beli token".
3. Buka `/live?t=<token-valid>` — harus tampil player normal.

## File yang Akan Diubah

| File | Perubahan |
|---|---|
| `src/components/ErrorBoundary.tsx` | Tambah varian `SectionBoundary` (silent fallback) + opsi log-to-DB |
| `src/lib/clientId.ts` | Tambah `safeJsonParse<T>(raw, fallback)` |
| `src/pages/LivePage.tsx` | Bungkus 7 sub-region dengan `SectionBoundary`; pakai `safeJsonParse`; perbaiki redirect race |
| `src/hooks/useLiveQuiz.ts` | try/catch menyeluruh di `loadActive`/`loadWinners` |
| `src/hooks/useSignedStreamUrl.ts` | Hardening try/catch invoke |
| `src/hooks/useProxyStream.ts` | Guard null + try/catch |
| `src/components/viewer/LineupAvatars.tsx` | try/catch + cleanup setLoaded saat unmount |
| `src/components/viewer/ViewerBroadcast.tsx` | try/catch subscribe & removeChannel |
| `src/components/viewer/SecurityAlert.tsx` | try/catch subscribe & removeChannel |

## Detail Teknis

- `SectionBoundary` adalah class component sederhana mirip `ErrorBoundary` tapi mengembalikan `null` (atau pesan compact) saat error, **tanpa** memblokir seluruh halaman.
- `safeJsonParse(raw, fallback)` melakukan `try { JSON.parse(raw) } catch { return fallback }` agar localStorage rusak tidak menjatuhkan komponen.
- Untuk redirect `/replay-play`, akan ditambah `setLoading(true) + setShouldRedirect(true)` lalu `return null` di render, supaya tidak ada hook stream yang dipanggil dengan token yang sebentar lagi pindah halaman.
- ErrorBoundary global tetap dipertahankan sebagai jaring pengaman terakhir, namun karena tiap section sudah punya boundary sendiri, peluang ia muncul mendekati 0%.

## Hasil yang Diharapkan
- Halaman `/live` **tidak akan pernah** menampilkan layar "Terjadi Kesalahan" lagi — selalu ada UI yang relevan: player, countdown, "Akses Ditolak", atau "Token Tidak Valid".
- Bila salah satu fitur (quiz/poll/chat) bermasalah, hanya bagian itu yang hilang, sisa halaman tetap berfungsi.
- Log error per-section dikirim ke `security_events` sehingga regresi di masa depan terdeteksi cepat.
