## Tujuan

Memungkinkan admin menandai show sebagai **eksklusif**, di mana pemilik token membership (MBR-/MRD-), bundle (BDL-), dan custom (RT48-) **TIDAK otomatis mendapat akses**. Akses hanya melalui pembelian show satuan (token per-show, ORD-, koin redeem, dsb).

## Perubahan Database (migration)

1. **Tambah kolom baru di `public.shows`**:
   - `exclude_from_membership boolean NOT NULL DEFAULT false` — jika `true`, show ini tidak bisa diakses pakai MBR/MRD/BDL/RT48.

2. **Update RPC `get_membership_show_passwords()`**:
   - Tambah filter `AND s.exclude_from_membership = false` saat memilih `access_password` show.
   - Hasilnya: token universal tidak akan menerima password show eksklusif.

3. **Update RPC `get_public_shows()`**:
   - Sertakan kolom `exclude_from_membership` agar UI viewer bisa menampilkan badge "Eksklusif — tidak include membership".

4. **(Opsional safety) Update logic di `confirm_membership_order` / fungsi pembuatan token MBR/BDL** — tidak perlu diubah karena pengecekan dilakukan di `get_membership_show_passwords`. Cukup di satu titik.

## Perubahan Frontend

### `src/components/admin/ShowManager.tsx`
- Tambah toggle/Switch **"Eksklusif (tidak include membership/bundle)"** pada form create/edit show.
- Field disimpan ke kolom `exclude_from_membership`.
- Tampilkan badge kecil di list show admin saat aktif.

### `src/hooks/usePurchasedShows.ts`
- Tetap memanggil `get_membership_show_passwords` (sudah otomatis filter di sisi DB), tidak perlu perubahan logic — DB sudah jadi source of truth.

### `src/components/viewer/ShowCard.tsx` & `BundleShowCard.tsx`
- Jika `show.exclude_from_membership === true`, tampilkan badge **"Eksklusif"** (warna magenta neon) pada card.
- Jika user punya membership tapi show eksklusif → tetap tampilkan tombol "Beli" (bukan "Tonton"), karena `accessPasswords[show.id]` tidak akan berisi password.

### `src/types/show.ts`
- Tambah `exclude_from_membership?: boolean` pada interface Show.

### Memory update
- Update `mem://index.md` Core: "Show dengan `exclude_from_membership=true` tidak diakses MBR/MRD/BDL/RT48 — wajib beli satuan."

## Perilaku Akhir

| Token | Show normal | Show eksklusif |
|-------|-------------|----------------|
| MBR-/MRD- (membership) | ✅ akses | ❌ harus beli satuan |
| BDL- (bundle) | ✅ akses | ❌ harus beli satuan |
| RT48- (custom) | ✅ akses | ❌ harus beli satuan |
| ORD-/redeem koin per-show | ✅ akses | ✅ akses |

Admin cukup centang satu toggle saat membuat/edit show.
