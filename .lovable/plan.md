
## Tujuan

Tambahkan **toggle global di admin panel** untuk menjeda seluruh akses token membership (MBR-/MRD-) dengan tiga efek bersamaan:

1. User membership yang sedang menonton di `/live` langsung ter-eject.
2. User membership yang mencoba masuk `/live` dengan token MBR-/MRD- akan ditolak.
3. Di landing page (`/`) & schedule, semua kartu show kembali tampil seperti show berbayar normal — tombol "Tonton Live"/"Tonton Replay" dari membership menghilang dan diganti tombol "Beli". Saat admin menonaktifkan jeda, semuanya kembali normal otomatis.

## Pendekatan

Pakai **flag global** `membership_paused` di tabel `site_settings` (sudah ada). Tidak menyentuh `tokens.status` per-token, sehingga aktivasi kembali instan tanpa perlu re-issue token.

## Perubahan

### 1. Database — RPC `set_membership_pause(_paused boolean)` (BARU)

`SECURITY DEFINER`, hanya admin yang bisa memanggil. Aksinya:
- Upsert `site_settings.membership_paused = 'true' | 'false'`.
- Jika di-pause: `UPDATE token_sessions SET is_active=false` untuk semua sesi token MBR-/MRD- (memutus sesi aktif).
- Insert ke `admin_notifications` untuk audit.

### 2. Database — perbarui RPC `validate_token`

Tambahkan pengecekan di awal:
```text
IF code LIKE 'MBR-%' OR code LIKE 'MRD-%' THEN
  IF site_settings.membership_paused = 'true' THEN
    RETURN { valid: false, error: 'Akses membership sedang dijeda admin' }
```

### 3. Database — perbarui RPC `get_membership_show_passwords`

Tambahkan cek yang sama. Jika `membership_paused = 'true'`, kembalikan **array kosong** sehingga frontend tidak menerima password universal apa pun → kartu show otomatis kembali ke mode "harus beli".

### 4. Frontend admin — komponen baru `MembershipPauseControl`

Ditempatkan di **Token Factory tab → bagian atas saat sub-tab Membership aktif** (lokasi paling natural karena admin sudah ada di sana saat mengelola membership).

Isi:
- Switch besar dengan label dinamis: "Membership Aktif" / "Membership Dijeda".
- Badge status warna (hijau aktif / merah dijeda).
- Counter "X token membership aktif terdampak".
- Konfirmasi modal saat akan menjeda: "Semua holder membership akan kehilangan akses live & kartu show kembali ke mode beli. Lanjutkan?"
- Subscribe realtime ke `site_settings` (filter `key=eq.membership_paused`) agar status sinkron.

Saat toggle ON:
- Panggil RPC `set_membership_pause(true)`.
- Kirim broadcast `membership_paused` ke channel global `membership-control` agar perangkat live ter-eject instan.

Saat toggle OFF:
- Panggil RPC `set_membership_pause(false)`.
- Kirim broadcast `membership_resumed` agar UI landing/schedule yang sedang terbuka langsung refresh password universal.

### 5. Frontend `LivePage.tsx` — eject membership saat dijeda

Tambahkan:
- Subscribe ke channel broadcast `membership-control`. Jika menerima `membership_paused` DAN token saat ini adalah MBR-/MRD- (sudah ada flag `tokenData.is_membership`) → set `membershipPaused = true`, hentikan player.
- Realtime `postgres_changes` pada `site_settings` filter `key=eq.membership_paused` sebagai cadangan.
- Tampilkan layar khusus saat `membershipPaused = true`:
  - Ikon Pause warna warning.
  - Judul "Akses Membership Sedang Dijeda".
  - Pesan: "Admin sedang menjeda layanan membership. Token kamu tetap aktif dan akan otomatis bisa dipakai kembali ketika admin mengaktifkan layanan."
  - Tombol "Hubungi Admin" (WhatsApp) & "Lihat Jadwal".

### 6. Frontend `Index.tsx` & `SchedulePage.tsx` — kartu show kembali ke mode beli

Saat `membership_paused = true`:
- RPC `get_membership_show_passwords` sudah otomatis return kosong (perubahan #3) → state `redeemedTokens` tidak menerima password universal untuk membership.
- Tambahkan flag `isMembershipPaused` (di-fetch dari `site_settings` saat mount + listen realtime).
- Modifikasi `universalToken`:
  ```ts
  const universalToken = isMembershipPaused 
    ? (bundleToken || customToken || null)  // bundle & custom tetap jalan
    : (membershipToken || bundleToken || customToken || null);
  ```
- Subscribe ke broadcast `membership-control` agar perubahan langsung terdeteksi tanpa reload.
- Untuk membership shows (`is_subscription = true`), kartu otomatis menampilkan tombol "Beli Membership" sebagai gantinya — logika sudah ada (`hasMembershipOpen`), tinggal `universalToken` jadi null untuk membership.

### 7. Hook `useShowPurchase` & `usePurchasedShows`

Cek apakah ada caching token membership di sisi client yang perlu di-invalidate saat broadcast `membership_paused` diterima. Jika ada — clear cache & re-fetch.

## Detail Teknis

**Tabel yang dipakai:** `site_settings` (key baru: `membership_paused`), `tokens`, `token_sessions`. **Tidak ada perubahan schema** — hanya tambah RPC & baris setting.

**Yang TIDAK diubah:**
- Kolom `tokens.status` per-token. Tombol blokir individual di TokenFactory tetap untuk kasus blokir spesifik.
- Token bundle (BDL-) dan custom (RT48-) — tetap berfungsi normal saat membership dijeda.
- Flow pembelian membership (user tetap bisa beli token baru, tapi token baru itu pun belum bisa dipakai sampai admin aktifkan kembali — ini perilaku yang diinginkan).

**Aliran lengkap:**
```text
Admin toggle ON di Token Factory > Membership
    ↓
RPC set_membership_pause(true)
    ├─ site_settings.membership_paused = 'true'
    ├─ token_sessions (MBR-/MRD-) → is_active=false
    └─ admin_notifications insert
    ↓
Broadcast 'membership_paused' ke channel membership-control
    ↓
┌─────────────────────────────┬─────────────────────────────┐
│ User di /live (membership)  │ User di / atau /schedule    │
│ ─→ ter-eject ke layar       │ ─→ universalToken jadi null │
│    "Membership dijeda"      │ ─→ kartu show jadi "Beli"   │
└─────────────────────────────┴─────────────────────────────┘
    ↓
User coba masuk lagi /live?t=MBR-XXX → validate_token tolak
    ↓
Admin toggle OFF
    ↓
RPC set_membership_pause(false) → site_settings = 'false'
    ↓
Broadcast 'membership_resumed'
    ↓
User membership langsung bisa akses /live & kartu show kembali normal
```

## Hasil Akhir

- Satu toggle besar di admin panel untuk jeda/aktifkan seluruh akses membership.
- Saat dijeda: holder MBR-/MRD- tidak bisa masuk /live (yang aktif ter-eject < 2 detik), dan kartu show di landing/schedule kembali ke tombol "Beli" untuk semua user (kecuali mereka punya token bundle/custom/per-show).
- Saat diaktifkan: semua kembali ke normal otomatis tanpa perlu refresh.
- Token tidak perlu di-issue ulang, sesi sebelumnya yang dipotong akan dibuat baru saat user masuk lagi.
