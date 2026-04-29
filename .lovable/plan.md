
## Tujuan

1. **Kunci jadwal hanya untuk token non-universal** (reseller `RSL-` & regular tanpa prefix khusus). Token-token ini hanya boleh menonton ketika `show_id` token = `active_show_id` admin.
2. **Membership (`MBR-`/`MRD-`), Custom bot (`RT48-`), dan Bundle (`BDL-`) TETAP universal** — boleh menonton show apa pun yang sedang live (sesuai desain awal membership/bundle).
3. **Kembalikan countdown + judul + jadwal show** di tampilan offline halaman `/live` untuk semua user (termasuk membership), seperti sebelumnya.

## Perubahan Database (migration baru)

### `validate_token(_code)`
Logika sudah hampir benar — saat ini sudah memblokir token non-universal yang `show_id`-nya beda dengan `active_show_id`. Yang perlu dipastikan/diperbaiki:

- Daftar prefix **universal** dipertahankan: `MBR-`, `MRD-`, `BDL-`, `RT48-`, plus token tanpa `show_id`.
- Tidak ada perubahan logika mismatch — sudah sesuai permintaan.
- (Tidak perlu migration baru jika logika ini sudah sama persis seperti versi terakhir; akan diverifikasi saat eksekusi. Jika sudah identik, skip.)

## Perubahan Frontend — `src/pages/LivePage.tsx`

### A. Bersihkan logika mismatch client (defense-in-depth)
Logika client di sekitar baris 651 sudah benar (mengecualikan membership/bundle/custom). Pastikan tetap konsisten dengan server: hanya tampilkan `setShowMismatch` ketika `!isMembershipToken && !isBundleToken && !isCustomToken`. Tidak perlu diubah, hanya dipastikan.

### B. Kembalikan countdown saat offline untuk user membership/custom
Akar masalah: ketika user membership login, `active_show_id` mungkin kosong (admin belum pilih show), sehingga `applyActiveShowMetadata(activeShow)` tidak men-set `activeShowDate/activeShowTime`. Akibatnya `useEffect` countdown (baris 907–941) tidak punya target waktu → countdown hilang.

Perbaikan:

1. **Tambah fallback show milik token** sebagai sumber jadwal countdown. Setelah `applyActiveShowMetadata(activeShow)` di sekitar baris 613, jika `activeShow` kosong/tanpa schedule, pakai `tokenShow` (hasil fetch by id di baris 615–629) untuk set `activeShowTitle/Date/Time/Image`.

   ```text
   if (!activeShow && tokenShow) {
     applyActiveShowMetadata(tokenShow);
   } else if (activeShow && !activeShow.schedule_date && tokenShow?.schedule_date) {
     // lengkapi metadata jadwal dari show milik token
     setActiveShowDate(tokenShow.schedule_date);
     setActiveShowTime(tokenShow.schedule_time);
   }
   ```

2. **Pastikan `fetchDisplayShow` mengembalikan show terdekat** untuk user membership ketika `active_show_id` kosong — sudah benar via `resolveDisplayShow` (PRIORITAS 2). Tidak perlu diubah.

3. **Verifikasi efek countdown** (baris 907) tidak menonaktifkan diri ketika token universal — saat ini hanya bergantung pada `activeShowDate/activeShowTime` dan `nextShowTime`, jadi cukup pastikan minimal salah satu ter-isi (lihat poin 1).

### C. Tampilan offline (player area)
Block render countdown di baris 1244–1308 sudah ada dan tidak perlu diubah — selama state `countdown`, `activeShowTitle`, `activeShowDate`, `activeShowTime` ter-isi (dijamin oleh poin B), tampilannya akan kembali muncul seperti sebelumnya: judul show, tanggal & jam, plus digital countdown HARI/JAM/MENIT/DETIK.

## Detail Teknis Tambahan

- **Tidak menyentuh** RPC pause membership, RPC reseller, alur token bot, atau pembuatan token.
- **Tidak menyentuh** layar `ShowMismatch` yang sudah ada — tetap dipakai untuk token reseller/regular yang salah show.
- **Bundle (`BDL-`)** tetap universal (sesuai desain bundle multi-show); jika nanti diinginkan bundle dikunci ke daftar show tertentu, itu pekerjaan terpisah.

## File yang Diubah

1. **`src/pages/LivePage.tsx`** — tambahkan fallback metadata show dari `tokenShow` ketika `activeShow` kosong/tidak punya jadwal, supaya countdown offline tetap muncul untuk user membership/custom.
2. **(Opsional)** Migration verifikasi `validate_token` — hanya jika ditemukan deviasi dari logika yang diinginkan saat verifikasi.

## Hasil Akhir

- Token reseller/regular: dikunci ke `show_id` masing-masing — tidak bisa dipakai untuk show lain (server + client).
- Token Membership / Custom (RT48) / Bundle: tetap bisa menonton show apa pun yang sedang live.
- Halaman `/live` saat offline: kembali menampilkan judul show, tanggal, jam, dan countdown digital untuk semua user.
