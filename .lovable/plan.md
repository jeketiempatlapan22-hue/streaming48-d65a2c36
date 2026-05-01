# Migrasi Server IDN ke endpoint `/api/stream/v2/playback` dengan JWT generated di backend

## Tujuan
- Pindah endpoint playback dari `https://proxy.mediastream48.workers.dev/api/proxy/playback` → `https://proxy.mediastream48.workers.dev/api/stream/v2/playback` khusus playlist tipe `proxy` (server IDN).
- Generate `x-api-token` (JWT HS256) **di server kita** sesuai dokumentasi `playback_baru.txt`. Tidak lagi memanggil `https://hanabira48.com/api/stream-token`.
- `x-token-id` & `x-sec-key` statis (dari dokumentasi).
- `x-showid` diambil dari `shows.external_show_id` show yang ditandai aktif di Admin Panel (`site_settings.active_show_id`).
- **Wajib user login & punya akses ke show aktif** sebelum token dibuat. Frontend hanya menerima header lalu inject via `xhr.setRequestHeader` (alur sama seperti sebelumnya).

## Perubahan

### 1. Edge Function baru: `supabase/functions/idn-stream-token/index.ts`
Membuat & mengembalikan 4 header siap pakai. Alur:
1. CORS handler.
2. Validasi JWT user (verify_jwt). Jika tidak login → 401.
3. (Opsional `show_id` di body) — kalau kosong, ambil `site_settings.active_show_id` lalu `shows.external_show_id`.
4. Validasi akses show ke user (reuse logic yang sama dengan LivePage: cek `usePurchasedShows`-equivalent di server lewat tabel `tokens`/membership/bundle/coin purchase). Jika tidak punya akses & bukan admin → 403.
5. Generate JWT:
   - `secretBase = "{x-sec-key}:{x-token-id}:{PARTNER_SECRET}"`
   - `jwtSecret = SHA-256(secretBase)` lalu **HEX** string (sesuai dok Langkah A — bukan raw bytes).
   - Payload: `{ sid: externalShowId, tid: TOKEN_ID, exp: now + 7200 }`.
   - Sign HS256 menggunakan `jwtSecret` (string HEX) sebagai key — pakai Deno `crypto.subtle` (HMAC-SHA-256) + base64url encode (header + payload + signature).
6. Response JSON:
   ```json
   { "success": true,
     "headers": {
       "x-api-token": "...",
       "x-sec-key": "49c647f3-...",
       "x-token-id": "114e0e89-...",
       "x-showid": "<external_show_id>"
     },
     "show_id": "<external_show_id>",
     "expires_at": <unix-seconds>
   }
   ```

### 2. Secret baru
- Tambahkan `HANABIRA_PARTNER_SECRET` via tool secret (default ke `Hanabirastream2026` per dokumentasi, tapi tetap disimpan sebagai secret supaya bisa dirotasi).
- `x-token-id` dan `x-sec-key` hard-coded sebagai konstanta di edge function (sesuai dokumentasi).

### 3. Update `src/hooks/useProxyStream.ts`
- Hapus call ke `https://hanabira48.com/api/stream-token`.
- Ganti dengan `supabase.functions.invoke("idn-stream-token", { body: { show_id: externalShowId } })`.
- `PLAYBACK_URL` → `https://proxy.mediastream48.workers.dev/api/stream/v2/playback`.
- Refresh tetap ~115 menit (token JWT exp 2 jam = 7200 detik).
- Handler error: jika 401/403 dari edge → tampilkan pesan "Anda harus login & memiliki akses show untuk menonton stream IDN".
- Header injection ke HLS (`xhrSetup` via `customHeadersRef`) tidak berubah — VideoPlayer/HLS code sudah pakai ref ini.

### 4. (Opsional bersih-bersih) `supabase/functions/proxy-token/index.ts` & bagian `stream-proxy` yang fetch `hanabira48.com/api/stream-token`
- Tetap dibiarkan (untuk fallback/legacy admin preview), TAPI tambahkan komentar bahwa untuk server IDN sudah pindah ke `idn-stream-token`. Tidak menghapus supaya tidak memecah preview admin yang masih memakainya. (Bisa dihapus di langkah lanjutan kalau dikonfirmasi tidak terpakai.)

### 5. Verifikasi setelah implementasi
- Cek edge function logs `idn-stream-token` saat user buka `/live` dengan playlist tipe `proxy`.
- Pastikan request ke `/api/stream/v2/playback` mengandung 4 header benar (Network tab).
- Test:
  - User belum login → toast/error "harus login".
  - User login tanpa akses show → 403.
  - User login + token valid → stream play, refresh diam-diam tiap ~115 menit.

## Detail Teknis JWT (sesuai dokumentasi)
```
Header  = {"alg":"HS256","typ":"JWT"}
Payload = {"sid": externalShowId, "tid": TOKEN_ID, "exp": nowSec + 7200}
secret  = hexLower( SHA256( SEC_KEY + ":" + TOKEN_ID + ":" + PARTNER_SECRET ) )
token   = base64url(header) + "." + base64url(payload) + "." + base64url( HMAC_SHA256(secret, signingInput) )
```
- Semua base64url **tanpa padding**.
- Implementasi pakai `crypto.subtle.digest("SHA-256", ...)` + `crypto.subtle.importKey("raw", new TextEncoder().encode(hexSecret), { name:"HMAC", hash:"SHA-256" }, false, ["sign"])` lalu `crypto.subtle.sign("HMAC", ...)`.

## File yang akan disentuh
- **CREATE**: `supabase/functions/idn-stream-token/index.ts`
- **EDIT**: `src/hooks/useProxyStream.ts`
- **SECRET**: tambah `HANABIRA_PARTNER_SECRET`

## Catatan
- Validasi akses pakai pattern yang sudah ada (cek `tokens` aktif untuk show + `redeem_*` membership/bundle, juga admin role). Akan reuse SQL helper / RPC yang ada bila tersedia agar konsisten dengan `LivePage` access control.
- Jika user mau, alur akses bisa diperketat (mis. perlu token aktif spesifik) atau dilonggarkan (cukup login). Default plan: **harus login DAN punya akses ke show aktif (atau admin)**.
