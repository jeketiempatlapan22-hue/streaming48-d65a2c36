

## Diagnosis

Dari screenshot: "Jadwal: 17 April 2026 | 19.00 WIB" muncul TANPA judul "Dream Bakudan" dan TANPA background. Ini berarti `activeShowTitle` & `activeShowImage` kosong → countdown jatuh ke fallback `next_show_time` (yang tersimpan di `site_settings` = 17 April, sisa dari pengaturan lama admin).

**Root cause utama:** `fetchDisplayShow` mengandalkan `get_public_shows()` RPC + fallback select `shows`. Jika RPC timeout / show admin punya `is_active=false` / cache stale → resolved show jadi `null` → metadata aktif kosong → UI menampilkan `next_show_time` lama (17 April), tanpa background. Realtime subscription untuk `active_show_id` juga hanya memanggil `refreshPlaylists()` yang sama → loop kegagalan sama.

**Sekunder:** Tidak ada cara admin mengoverride background offline jika gambar show belum di-set.

## Solusi (sesuai jawaban Anda)

1. **Satu pilihan saja** di LiveControl: dropdown "Show yang Akan Live / Sedang Live" dipakai untuk LIVE + COUNTDOWN + BACKGROUND offline secara konsisten.
2. **Admin bisa upload background offline override** (opsional) — jika diisi, dipakai sebagai background blur saat offline; jika kosong, fallback ke `background_image_url` show terpilih; jika kosong juga, gradient.
3. **Sumber data show aktif disederhanakan** — fetch langsung dari tabel `shows` by `active_show_id` (bukan via filter `get_public_shows`), agar admin bisa pilih show meski sementara `is_active=false`.
4. **Buang prioritas `next_show_time`** — gunakan hanya sebagai fallback terakhir jika tidak ada show aktif sama sekali. Tampilkan label "Belum ada show aktif" jika kosong.

## Perubahan File

**`src/pages/LivePage.tsx`**
- `fetchDisplayShow`: kalau `activeShowId` ada, **selalu** fetch langsung dari `shows` by id (lewati filter `is_replay`/`is_active`) — admin yang pilih, admin yang tahu.
- Tambah state `offlineBackgroundOverride` dari `site_settings.key='offline_background_url'`.
- Background offline pakai urutan: `offlineBackgroundOverride` → `activeShowImage` → gradient.
- Realtime: tambah handler untuk key `offline_background_url` agar live-update.
- Countdown `useEffect`: prioritas → `activeShowDate/Time` (selalu). `next_show_time` jadi fallback terakhir.

**`src/components/admin/LiveControl.tsx`**
- Section "Show yang Sedang Live" diperjelas: copy diubah jadi "Show yang sedang/akan live — countdown, jadwal, dan background otomatis ikut show ini."
- Hapus section terpisah "Jadwal Show Berikutnya" (datetime-local) — atau ubah jadi opsional/legacy override label kecil. (Pilih: hapus, karena sudah ikut show.)
- Tambah section baru "Background Player Offline (Opsional)" dengan upload gambar ke bucket `show-images` + tombol Hapus. Simpan URL ke `site_settings.key='offline_background_url'`.
- Show selector tetap filter `!is_replay && !is_bundle` tapi **buang filter `is_active`** sehingga admin bisa pilih show yang baru dibuat / di-archive.

**`src/main.tsx`**
- Bump `CACHE_RESET_VERSION` ke `rt48-cache-reset-v9` untuk paksa SW lama bersih.

## Catatan Migrasi

Tidak butuh migration SQL baru — `site_settings` adalah key/value bebas, tinggal upsert key `offline_background_url`. Bucket `show-images` sudah ada (dipakai ShowManager).

## Verifikasi

Setelah implementasi, buka `/live?t=…` dengan token aktif dan konfirmasi:
- Background = gambar Dream Bakudan (blur).
- Judul = "Dream Bakudan".
- Tanggal = 18 April 2026 (atau "Jadwal asli: 19:00 WIB" + zona lokal user).
- Toggle live ON di admin → player otomatis switch ke video tanpa reload.

