

## Plan: Player 3 — Proxy Stream dari hanabira48.com

### Ringkasan
Menambahkan tipe player baru "proxy" yang mengambil stream HLS dari `proxy.mediastream48.workers.dev` dengan header autentikasi yang didapat dari API `hanabira48.com`. Admin dapat menyimpan "External Show ID" di setiap show melalui Show Manager.

### Arsitektur

```text
┌──────────────┐     POST /stream-token     ┌──────────────────┐
│  Edge Func   │ ──────────────────────────► │ hanabira48.com   │
│ proxy-stream │ ◄────────────────────────── │ (xapi,xsec,etc)  │
│              │                             └──────────────────┘
│              │     GET /playback + headers  ┌──────────────────┐
│              │ ──────────────────────────► │ proxy.media...   │
│              │ ◄────────── m3u8 content ── │ workers.dev      │
│              │                             └──────────────────┘
└──────┬───────┘
       │ rewrite m3u8 URLs → signed proxy
       ▼
  ┌──────────┐
  │ Browser  │  (sama seperti m3u8 biasa via HLS.js)
  └──────────┘
```

Browser **tidak bisa** langsung memasang custom headers di HLS.js request ke domain berbeda (CORS), jadi dibutuhkan edge function sebagai proxy server-side.

---

### Langkah Implementasi

#### 1. Database — Tambah kolom `external_show_id` di tabel `shows`
- Migrasi: `ALTER TABLE public.shows ADD COLUMN external_show_id text DEFAULT NULL;`
- Update fungsi `get_public_shows` untuk menyertakan kolom baru

#### 2. Admin Panel — Input External Show ID di Show Manager
- Tambah field input "External Show ID (hanabira48)" di form edit show (`ShowManager.tsx`)
- Field muncul di bawah "Custom ID" yang sudah ada
- Auto-save on blur seperti field lainnya

#### 3. Admin Panel — Tipe playlist baru "proxy"
- Di `LiveControl.tsx` dan `PlaylistManager.tsx`, tambah opsi `<SelectItem value="proxy">Proxy Stream</SelectItem>` pada dropdown tipe
- Untuk tipe "proxy", URL field tidak diperlukan (akan otomatis menggunakan endpoint proxy). Bisa diisi placeholder atau dikosongkan

#### 4. Edge Function — `proxy-stream/index.ts` (baru)
Edge function ini menangani:

**POST (generate mode):**
1. Validasi token (sama seperti stream-proxy)
2. Cari playlist tipe "proxy" → ambil `active_show_id` dari `site_settings`
3. Cari show → ambil `external_show_id`
4. Fetch token dari `https://hanabira48.com/api/stream-token?showId={external_show_id}`
5. Gunakan response headers (xapi, xsec, xshowid, xtoken) untuk fetch manifest dari `https://proxy.mediastream48.workers.dev/api/proxy/playback`
6. Cache manifest, rewrite segment URLs → signed proxy URLs
7. Return signed manifest URL ke client

**GET mode=play:** Fetch & rewrite manifest dengan headers yang sudah di-cache
**GET mode=seg:** Proxy segment request dengan headers yang benar

#### 5. Stream Proxy Integration — Update `stream-proxy/index.ts`
- Tambah handler untuk `playlist.type === "proxy"`:
  - Ambil `active_show_id` dari site_settings
  - Cari `external_show_id` dari show
  - Fetch token headers dari hanabira48 API
  - Fetch manifest dari proxy.mediastream48 dengan headers
  - Rewrite manifest URLs → signed proxy URLs (segment proxy)
  - Return signed URL untuk manifest
- Tambah mode `proxyseg` untuk GET requests yang memproxy segment dengan custom headers

#### 6. VideoPlayer — Tidak perlu perubahan besar
- Tipe "proxy" akan di-treat sama seperti "m3u8" di sisi frontend karena edge function sudah menghasilkan M3U8 yang valid
- Di `useSignedStreamUrl`, proxy type "proxy" akan dikembalikan sebagai type "m3u8" dari edge function
- Tidak perlu perubahan di `VideoPlayer.tsx`

---

### Detail Teknis

**Token caching di edge function:**
- Header dari hanabira48 API di-cache selama 5 menit (in-memory) per show ID untuk menghindari request berlebihan
- Manifest di-cache selama 3 detik (sama seperti m3u8 biasa)

**Segment proxying:**
- Setiap segment URL di manifest di-rewrite ke signed proxy URL
- Edge function mem-proxy segment request ke workers.dev dengan header yang benar
- HMAC signature + IP binding + expiry (sama seperti m3u8 proxy yang sudah ada)

**File yang akan diubah/dibuat:**
1. `supabase/migrations/` — Tambah kolom `external_show_id`
2. `src/components/admin/ShowManager.tsx` — Input field external_show_id
3. `src/components/admin/LiveControl.tsx` — Tambah opsi "Proxy Stream" di dropdown tipe playlist
4. `src/components/admin/PlaylistManager.tsx` — Tambah opsi "Proxy Stream"
5. `supabase/functions/stream-proxy/index.ts` — Tambah handler tipe "proxy"

