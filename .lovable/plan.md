## Tujuan

1. **Foto kartu show & replay**: Pastikan foto yang sudah diatur admin (`background_image_url`) selalu muncul, walau fitur "Auto" (cocok nama foto) tidak digunakan / gagal cocok. Tidak boleh ada kondisi di mana auto-match menimpa pilihan manual atau membersihkan foto admin.
2. **Command WhatsApp jeda/aktifkan membership**: Pastikan command `/pausemember`, `/resumemember`, `/memberstatus` muncul di `/help`, dapat dieksekusi, dan memberi balasan jelas — termasuk alias yang lebih intuitif (Bahasa Indonesia).

## Temuan Investigasi

### Foto show
- Viewer (`ShowCard.tsx`, `ReplayPage.tsx`, `MembershipPage.tsx`, `BundleShowCard.tsx`) **sudah benar** menggunakan `show.background_image_url` dengan fallback placeholder/`bundleBg`. Tidak ada logika auto-match runtime di sisi viewer yang menimpa.
- DB (cek 20 row terbaru): mayoritas show punya URL valid. Tetapi:
  - 1 row (`Show Baru`) dengan `background_image_url = NULL` — terjadi setelah create show baru tanpa pilih gambar.
  - "Itadaki❤Love (SONICHI)" punya URL `...y1rskk.webp` tapi nama file random (slug 6 char) → `fileNameToLabel` mengembalikan string kosong. Ini **tidak menghapus URL**, tapi membuat fitur "Auto" tidak akan pernah memilihnya kembali (skor cocok = 0).
- `autoDetectBackground` (admin) menimpa `background_image_url` **hanya jika** ditemukan match. Bila tidak ada match → toast error, draft tidak diubah. Aman.
- `MediaPickerDialog` `handleAutoPick` langsung memanggil `onSelect(best.url)` → menimpa pilihan saat ini bila admin tidak sengaja klik tombol "Pakai ...". Risiko menimpa tidak disengaja.
- `createShow` & bulk import selalu set `background_image_url: null`. Bila admin lupa pilih, kartu jadi kosong.

### WhatsApp pause/resume membership
- RPC `set_membership_pause_bot(_paused, _source)` sudah ada, men-set `site_settings.membership_paused` + memutus session MBR-/MRD- + audit log. Aman.
- Handler `handleMembershipPauseWa` & `handleMembershipStatusWa` sudah benar dan terdaftar di `processCommand` (line 800-806).
- Command sudah tertulis di `/help` (line 946-949).
- Kemungkinan masalah pengguna:
  1. Hanya tersedia dalam English (`/pausemember`, `/resumemember`) — admin kemungkinan mencoba `/jedamember`, `/aktifkanmember` (Bahasa Indonesia) dan tidak ada balasan.
  2. Tidak ada konfirmasi error yang ramah jika RPC gagal (mis. `_source` tidak valid menghasilkan error mentah).
  3. Help message panjang; admin mungkin melewatkan section "Kontrol Membership Global".

## Rencana Perubahan

### A. Foto show — fail-safe fallback (FE)

**`src/components/admin/ShowManager.tsx`**
- Tambahkan auto-detect ringan **hanya saat membuat show baru** (`createShow` & `handleImportCreate`):
  - Setelah insert, panggil `findBestMediaMatch(title, candidates, 0.5)` untuk tiap show.
  - Jika cocok (≥ threshold), update kolom `background_image_url` show baru tersebut.
  - Bila tidak cocok → biarkan `null` (tidak menimpa).
- `MediaPickerDialog.handleAutoPick`: Tambahkan konfirmasi jika `background_image_url` admin sudah terisi dengan URL berbeda (cegah penimpaan tidak sengaja). Tombol berlabel "Saran" + tampilkan URL agar lebih jelas.
- Auto-detect manual (tombol "Auto") tetap tidak menimpa kalau gagal — ini sudah benar; tambahkan log/toast ramah: "Tetap memakai foto yang sudah ada" jika `draft.background_image_url` sudah terisi.

**`src/components/viewer/ShowCard.tsx`**
- Tambahkan fallback bila `background_image_url` ada tapi gagal load (`onError` → tampilkan placeholder gradient + ikon Ticket), mencegah area hitam kosong saat URL admin invalid (mis. file dihapus dari storage).

**`src/pages/ReplayPage.tsx`**
- Tambahkan `onError` handler yang sama pada `<img>` kartu replay (line 366) → ganti ke fallback gradient + ikon Play, hindari area hitam.

**`src/pages/MembershipPage.tsx`**
- Tambahkan `onError` handler pada `<img>` membership card (line 450).

**Skrip data perbaikan (one-time, opsional)**
- Migration: untuk show dengan `background_image_url IS NULL`, tidak menulis apa-apa (admin tetap kontrol). Tidak menyentuh data existing.

### B. WhatsApp Bot — alias & UX (BE)

**`supabase/functions/whatsapp-webhook/index.ts`**
1. Tambahkan alias regex untuk command pause/resume:
   - `isPauseMember`: `/^\/(pause|jeda|stop)(member|membership)$/i`
   - `isResumeMember`: `/^\/(resume|unpause|aktifkan|lanjut|start)(member|membership)$/i`
   - `isMemberStatus`: `/^\/(memberstatus|statusmember|cekmember)$/i`
2. Update `handleHelp()` agar section "👑 Kontrol Membership Global" diletakkan lebih atas (di bawah Order Management) supaya tidak terpotong di tampilan WA, dan tampilkan alias:
   ```
   /pausemember atau /jedamember — Jeda akses membership
   /resumemember atau /aktifkanmember — Aktifkan kembali
   /memberstatus atau /statusmember — Cek status
   ```
3. Tambahkan validasi & balasan ramah di `handleMembershipPauseWa`:
   - Bila `_source` ditolak DB → tangkap error code `22023` dan balas: "⚠️ Bot belum dikonfigurasi sebagai sumber valid. Hubungi developer."
   - Bila pause sudah dalam state yang sama, balas: "ℹ️ Membership memang sudah dijeda" / "ℹ️ Membership memang sudah aktif" — cek `site_settings.membership_paused` dulu.
4. Tambahkan command pause/resume juga ke handler `processPublicCommand` **DITOLAK** (tetap admin-only) — cukup pastikan whitelist admin di env `WHATSAPP_ADMIN_NUMBERS` sudah memuat nomor admin (tidak diubah).

## Rincian Teknis

### Pola onError image fallback
```tsx
const [imgError, setImgError] = useState(false);
{show.background_image_url && !imgError ? (
  <img src={show.background_image_url} onError={() => setImgError(true)} ... />
) : (
  <div className="flex h-full items-center justify-center bg-gradient-to-br ...">
    <Ticket className="h-12 w-12 text-primary/20" />
  </div>
)}
```

### Auto-detect saat create
```ts
// setelah insert show baru
const candidates = await listAdminMedia();
const best = findBestMediaMatch(created.title, candidates, 0.5);
if (best) {
  await supabase.from("shows").update({ background_image_url: best.file.url }).eq("id", created.id);
  setShows(prev => prev.map(s => s.id === created.id ? { ...s, background_image_url: best.file.url } : s));
}
```

### Status check sebelum toggle (WA)
```ts
const { data: cur } = await supabase.from('site_settings')
  .select('value').eq('key','membership_paused').maybeSingle();
const already = (cur?.value === 'true') === paused;
if (already) return paused
  ? 'ℹ️ Membership memang sudah dijeda. Tidak ada perubahan.'
  : 'ℹ️ Membership memang sudah aktif. Tidak ada perubahan.';
```

## File yang Akan Dimodifikasi
- `src/components/admin/ShowManager.tsx` — auto-detect saat create + import, toast aman
- `src/components/admin/MediaPickerDialog.tsx` — label tombol "Saran", konfirmasi penimpaan
- `src/components/viewer/ShowCard.tsx` — `onError` fallback gambar
- `src/pages/ReplayPage.tsx` — `onError` fallback gambar
- `src/pages/MembershipPage.tsx` — `onError` fallback gambar
- `supabase/functions/whatsapp-webhook/index.ts` — alias regex + status-aware response + help reorder

## Hasil Akhir
- Kartu show & replay tidak akan pernah hitam-kosong: foto admin selalu prioritas, fallback gradient + ikon bila URL admin invalid/null.
- Show baru otomatis dapat foto bila ada nama file yang cocok di galeri, tanpa menimpa pilihan manual admin di sesi edit.
- Admin bisa pakai `/jedamember` / `/aktifkanmember` di WhatsApp dan dapat balasan jelas, termasuk peringatan bila state tidak berubah.
