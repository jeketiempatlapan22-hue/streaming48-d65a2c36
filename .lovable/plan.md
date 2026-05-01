## Hasil investigasi

Saya periksa seluruh alur pembuatan token membership oleh reseller (DB → RPC → bot WA → web) dan data nyata di tabel `tokens`. Hasilnya:

**Logika di database sudah benar.** Kedua RPC `reseller_create_token` (web) dan `reseller_create_token_by_id` (bot WhatsApp) memang **selalu mengabaikan** `_duration_days` dari pemanggil bila show adalah membership, dan memakai `_show.membership_duration_days` dari Show Manager:

```
IF _is_membership THEN
  _final_duration := GREATEST(1, COALESCE(_show.membership_duration_days, 30));
```

Saya verifikasi 6 token MBR- terbaru milik reseller di DB: semuanya memang `expires_at - created_at = 35 hari`, sesuai `membership_duration_days = 35` yang diatur admin. Token yang tersimpan **sudah betul mengikuti admin**.

**Yang salah adalah tampilan pesan WhatsApp balasan ke reseller**, sehingga reseller mengira durasi tidak ikut admin. Lokasi bug:

- `supabase/functions/whatsapp-webhook/index.ts` baris 446-489, fungsi `handleResellerToken`. Variabel `safeDays` diisi dari input reseller (`requestedDays`), lalu pesan WA menampilkan `⏰ Durasi: *${safeDays} hari*`. RPC sebenarnya mengembalikan `duration_days` (nilai admin yang dipakai di DB), tapi pesan tidak memakainya.
  - Akibat: kalau reseller tidak menyertakan durasi (default 1) atau menyertakan durasi berbeda dari admin, pesan WA menampilkan angka yang tidak match isi DB. Reseller mengira sistem tidak mengikuti admin.

Tidak ada masalah di alur web reseller (`ResellerShowCard.tsx` sudah membaca `show.membership_duration_days` dan menampilkannya konsisten). Tidak ada masalah di pembelian membership user (sudah pakai admin value). Bot Telegram tidak punya command reseller membership.

## Perubahan yang dilakukan

### 1. `supabase/functions/whatsapp-webhook/index.ts` — fungsi `handleResellerToken`

- Setelah RPC sukses, ambil durasi efektif dari respons RPC: `effectiveDays = res.duration_days ?? safeDays`.
- Untuk show membership, paksa label dari `show.membership_duration_days` (sumber admin) sebagai sumber kebenaran tampilan, sehingga konsisten dengan `expires_at` dari RPC.
- Update baris pesan menjadi:
  - `⏰ Durasi: *${effectiveDays} hari*` (untuk regular)
  - `⏰ Durasi Membership: *${effectiveDays} hari* _(diatur admin)_` (untuk membership)
- Hapus / sesuaikan `durationNote` yang membandingkan `days` input dengan 1 hari, agar tidak menyesatkan. Untuk membership, kalau reseller mengirim durasi berbeda, tampilkan catatan ringan: `_Catatan: durasi membership selalu mengikuti pengaturan admin (X hari)._`

### 2. (Opsional, agar konsisten) `src/components/reseller/ResellerShowCard.tsx`

Sudah benar memakai `membership_duration_days`. Saya hanya perlu memastikan `buildRegularShowMessage` tidak dipanggil untuk membership — jika ya, swap ke `buildMembershipMessage` agar pesan share yang disalin reseller juga menampilkan label "Membership" + durasi admin. Ini perubahan kecil di fungsi `buildShareMessage` di file tersebut.

## Tidak perlu diubah

- RPC `reseller_create_token` & `reseller_create_token_by_id`: sudah benar.
- Skema tabel `shows` / `tokens`: tidak ada migrasi schema.
- Alur QRIS / koin / bot Telegram: sudah memakai `membership_duration_days` dengan benar.

## Verifikasi setelah implementasi

1. Reseller mengirim `/<prefix>token <show membership>` tanpa durasi → pesan balasan WA harus menampilkan durasi sesuai `membership_duration_days` admin (mis. 35 hari), dan `expires_at` di DB juga 35 hari sejak sekarang.
2. Reseller mengirim `/<prefix>token <show membership> 7hari 1` → pesan WA tetap menampilkan durasi admin (mis. 35 hari) plus catatan "durasi membership selalu mengikuti admin", token DB tetap 35 hari.
3. Reseller membuat token membership via dashboard web → kartu hasil dan tombol "Salin Pesan" menampilkan durasi membership admin.
4. Reseller membuat token regular (non-membership) → tetap 1 hari otomatis (tidak berubah).
