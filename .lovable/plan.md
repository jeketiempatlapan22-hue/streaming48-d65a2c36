## Masalah & Rencana Perbaikan

### 1) Halaman Restream tidak menampilkan player IDN/Hanabira (proxy)

**Akar masalah:**
- `RestreamPage` memanggil `useProxyStream(isProxy, externalShowId, refreshKey)` untuk playlist tipe `proxy`.
- `useProxyStream` memanggil edge function `idn-stream-token`, yang **mewajibkan**: user login (Bearer JWT) ATAU `token_code` viewer aktif. Halaman restream publik tidak punya keduanya → respon 401, header tidak pernah didapat → player blank.
- Selain itu, untuk tipe `m3u8`/`youtube` di restream page sudah berjalan via `stream-proxy` + `restream_code`. Tapi pada player IDN belum ada jalur autentikasi via restream code.

**Perbaikan:**
1. **Edge function `idn-stream-token`**: tambah jalur autentikasi via `restream_code`.
   - Jika body berisi `restream_code`, validasi via RPC `validate_restream_code`.
   - Jika valid → `authorized = true`, `authMode = "restream"`. Tetap pakai logic resolve `external_show_id` yang sama (dari `site_settings.active_show_id` → `shows.external_show_id`).
   - Best-effort `touch_restream_code_usage`.
2. **Hook `useProxyStream`**: tambah parameter opsional `restreamCode`. Jika ada, kirim ke body request (`restream_code`).
3. **`RestreamPage.tsx`**: teruskan `code` (kode restream) ke `useProxyStream(isProxy, externalShowId, refreshKey, undefined, code)`.
4. Tambah log/error handling agar `proxyShowError` menampilkan pesan jelas saat 401/404.

**Verifikasi:**
- Test ketiga tipe playlist di /restream: m3u8 (signed), youtube (encrypted), proxy/IDN (xhr header injection).
- Cek Network: request ke `idn-stream-token` harus 200 dengan headers `x-api-token` dll, lalu request ke `proxy.mediastream48.workers.dev/api/stream/v2/playback` mendapat 200.

---

### 2) Kartu replay: input sandi master/bulanan/global membuka semua replay sesuai bulannya

**Saat ini:** input "Sudah punya sandi replay?" pada `ReplayPage.tsx` memanggil `validate_replay_access` dengan `_show_id` spesifik. Walau RPC sudah mendukung `global_password` (master/monthly/daily), efeknya hanya membuka **satu show** saja.

**Perilaku baru yang diinginkan:**
Jika sandi yang dimasukkan terbukti valid sebagai `global_password` (scope `master` atau `monthly`), maka **semua replay show** yang masuk dalam scope tersebut harus terbuka otomatis (tidak perlu input ulang per kartu).

**Perbaikan:**
1. **`ReplayPage.tsx` → `submitReplayPassword(show)`:**
   - Setelah menerima respons sukses dari `validate_replay_access`, periksa `access_via === "global_password"`:
     - `global_scope === "master"` → loop semua replay shows yang dimuat (yang punya `has_replay_media`/m3u8/yt) dan `addReplayPassword(s.id, raw)` untuk semuanya.
     - `global_scope === "monthly"` → tentukan target month: gunakan `_show.replay_month` jika ada, kalau tidak gunakan `YYYY-MM` dari `schedule_date` show terkait. Filter shows yang `replay_month === target` ATAU bila `replay_month` kosong, fallback ke bulan dari `schedule_date`. Terapkan `addReplayPassword` ke semua yang cocok.
     - `global_scope === "daily"` → buka semua show yang `schedule_date` = hari ini.
   - Tampilkan toast: "Sandi global aktif — N replay terbuka untuk bulan/periode ini."
   - Tetap navigasi ke show yang user klik (perilaku sekarang dipertahankan).
2. UI kartu: tambahkan helper text kecil di bawah input: "Bisa juga diisi sandi global/bulanan" agar user tahu fitur ini.
3. Tidak perlu mengubah RPC (`validate_replay_access`) — sudah mengembalikan `global_scope`. Kita hanya panggil RPC sekali untuk cek validitas, lalu kreditkan ke localStorage via `addReplayPassword` untuk semua show yang cocok.

**Edge case:**
- Jika user belum login (anonim), `addReplayPassword` mungkin no-op untuk persist di DB; minimal di-cache pada state lokal session sehingga klik "Tonton Replay" pada kartu lain langsung membuka via `/replay-play?password=...` tanpa harus mengetik ulang.
- Pastikan tidak menambah password ke show yang `is_replay=false` atau yang belum punya `has_replay_media`.

---

### File yang akan diubah
- `supabase/functions/idn-stream-token/index.ts` — tambah jalur `restream_code`.
- `src/hooks/useProxyStream.ts` — tambah param `restreamCode`.
- `src/pages/RestreamPage.tsx` — kirim `code` ke `useProxyStream`.
- `src/pages/ReplayPage.tsx` — perluas `submitReplayPassword` untuk membuka semua replay sesuai scope; perbarui copy UI input sandi.

### Test plan
- /restream: input kode aktif → switcher menampilkan IDN; pilih IDN → video play.
- /replay: input sandi bulanan pada satu kartu → semua kartu bulan tsb. menampilkan tombol "Tonton Replay" tanpa input ulang.
- /replay: input sandi master → semua kartu replay terbuka.
- Sandi salah → toast tetap "Sandi salah".
