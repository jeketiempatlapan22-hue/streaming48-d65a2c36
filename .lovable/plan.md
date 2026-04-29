## Masalah

Saat ini durasi token tidak konsisten mengikuti jadwal show:

- **`reseller_create_token` & `reseller_create_token_by_id`**: kalau jadwal show ada di masa depan, `expires_at = schedule + N hari` (benar). Tapi kalau jadwal di masa lalu / kosong, fallback ke `now() + N hari` — token tetap aktif walau show sudah lewat.
- **`confirm_regular_order` & `redeem_coins_for_token`**: `expires_at` di-set ke akhir hari (23:59 WIB) dari `schedule_date`. Kalau jadwal lusa, ini sudah dekat dengan benar, tapi **start time tidak dibatasi** — token bisa dipakai sebelum jadwal mulai. Selain itu fallback `now() + 24h` membuat token aktif walau show belum/tidak punya jadwal.
- Tidak ada kolom `valid_from` / `starts_at` pada tabel `tokens`, jadi sistem hanya cek `expires_at < now()`. Token yang dibuat hari ini untuk show lusa tetap "aktif" sekarang dan, kalau admin memilih show lain sebagai active show, sudah ditolak (oleh patch sebelumnya) — tapi kalau show jadwal lusa itu yang dipilih admin sekarang, token bisa dipakai lebih awal.

User minta: **durasi token harus persis mengikuti jadwal show** — token untuk show lusa hanya valid mulai jadwal lusa tsb, bukan sejak dibuat.

## Solusi

### 1. Tambah kolom `valid_from` di tabel `tokens` (migrasi)

```sql
ALTER TABLE public.tokens ADD COLUMN IF NOT EXISTS valid_from timestamptz;
CREATE INDEX IF NOT EXISTS idx_tokens_valid_from ON public.tokens(valid_from);
```

Backfill untuk token existing non-universal yang punya `show_id`:
- Set `valid_from = parse_show_datetime(schedule_date, schedule_time)` jika ada.
- Untuk membership/bundle/RT48-/MBR-/MRD-/BDL- tetap NULL (universal, langsung berlaku).

### 2. Update RPC pembuat token agar selalu anchor ke jadwal show

**`reseller_create_token` & `reseller_create_token_by_id`** (non-membership):
- Wajibkan show punya `schedule_date` + `schedule_time` valid; kalau tidak, tolak (`error: 'Show belum punya jadwal lengkap, tidak bisa membuat token.'`).
- Set `valid_from = parse_show_datetime(...)`.
- Set `expires_at = valid_from + N hari` (atau `schedule + 24h` default reseller).
- Hapus fallback `now() + N hari`.

**`confirm_regular_order` & `redeem_coins_for_token`**:
- Sama: hitung `valid_from` dari schedule; `expires_at = end of show day (23:59 WIB)`.
- Hapus fallback `now() + 24h` untuk show non-bundle yang tidak punya schedule (tolak/log error).
- Untuk bundle: tetap `now() + bundle_duration_days` (universal), `valid_from = NULL`.

### 3. Update `validate_token` agar enforce `valid_from`

Tambah blok setelah cek expired:

```sql
IF NOT _is_universal AND t.valid_from IS NOT NULL AND t.valid_from > now() THEN
  RETURN jsonb_build_object(
    'valid', false,
    'error', 'Token belum berlaku. Akses dimulai sesuai jadwal show.',
    'starts_at', t.valid_from,
    'show_title', (SELECT title FROM shows WHERE id = t.show_id),
    'schedule_date', (SELECT schedule_date FROM shows WHERE id = t.show_id),
    'schedule_time', (SELECT schedule_time FROM shows WHERE id = t.show_id)
  );
END IF;
```

Universal tokens (MBR-/MRD-/BDL-/RT48-) di-skip seperti sebelumnya.

### 4. UI feedback di `LivePage.tsx`

Saat `validate_token` mengembalikan `starts_at`:
- Tampilkan card "Token belum aktif" dengan countdown ke `starts_at` (gunakan komponen countdown yang sudah ada).
- Tampilkan judul show + jadwal yang ditunggu.
- Toast informatif: "Token kamu untuk *{show}*, baru aktif {tanggal} {jam}."

### 5. Admin panel — tampilkan `valid_from`

Di komponen daftar token (`TokenManagement` / panel reseller), tampilkan kolom "Aktif Mulai" agar admin bisa lihat token belum berlaku.

## Detail teknis

**Files yang berubah:**
- Migrasi SQL baru: tambah kolom `valid_from` + backfill + update 4 RPC + `validate_token`.
- `src/pages/LivePage.tsx`: handle response `starts_at`, render countdown "menunggu jadwal".
- `src/components/admin/TokenManagement.tsx` (atau yang relevan): kolom "Aktif Mulai".
- `src/components/reseller/*` jika ada list token reseller: tampilkan `valid_from`.

**Aturan ringkasan durasi token setelah perubahan:**

| Tipe token | valid_from | expires_at |
|---|---|---|
| Reseller regular (RSL-) | schedule_ts | schedule_ts + N hari |
| Order regular (TKN-) | schedule_ts | end of schedule day 23:59 WIB |
| Coin redeem regular | schedule_ts | end of schedule day 23:59 WIB |
| Membership (MBR-/MRD-) | NULL (universal) | now() + membership_duration_days |
| Bundle (BDL-) | NULL (universal) | now() + bundle_duration_days |
| Custom bot (RT48-) | NULL (universal) | sesuai input admin |

**Edge cases:**
- Show tanpa schedule → tolak pembuatan token regular (paksa admin lengkapi jadwal).
- Schedule lewat saat token dibuat → `valid_from = now()` (bisa langsung dipakai, expires sesuai schedule day).
- Admin ubah `schedule_date` setelah token dibuat → token existing **tidak** ikut bergerak (immutable). Catat ini di rilis notes; kalau perlu, sediakan tombol admin "Sinkronkan ulang token ke jadwal" di kemudian hari.

## Hasil akhir

Token yang dibuat hari ini untuk show lusa akan: 
1. Tersimpan dengan `valid_from = lusa 19:00 WIB` (misal), `expires_at = lusa 23:59 WIB`. 
2. Kalau dipakai sekarang → ditolak oleh `validate_token` dengan pesan + countdown "Aktif mulai lusa 19:00". 
3. Otomatis aktif tepat saat jadwal show dimulai. 
4. Otomatis expired di akhir hari show.
