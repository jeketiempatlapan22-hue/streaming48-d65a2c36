## Akar Masalah

### Verifikasi DB Langsung
- Show **Pajama Drive** versi replay (`a2f90d9c…`) memang ada dan `is_replay=true`, tapi **tidak ada token reseller** untuk show tersebut di tabel `tokens`.
- Riwayat audit (`reseller_token_audit`) untuk Pajama Drive masih utuh: **28 entry sukses**.
- Token reseller untuk show **Pajama Drive lama** (yang sudah dihapus admin) **terhapus permanen** karena trigger `cascade_delete_tokens_on_show_delete` melakukan `DELETE FROM tokens WHERE show_id = OLD.id`.

### Penyebab Utama
1. **Trigger cascade-delete pada show**: ketika admin menghapus show (atau merefresh menjadi show baru), semua token (termasuk token reseller) dihapus permanen → tampil hilang di:
   - Dashboard reseller (`reseller_list_my_tokens`)
   - Bot WhatsApp `/cektoken` (`reseller_list_recent_tokens_by_id`)
   - Tetapi **audit log admin tetap ada** (tabel `reseller_token_audit` independen).
2. **Tidak ada perlindungan**: tidak ada batasan eksplisit yang mencegah penghapusan riwayat reseller di tabel `tokens` selain RLS policy admin (yang memang bisa DELETE).
3. **RPC bot/dashboard** hanya membaca dari tabel `tokens` — tidak fallback ke `reseller_token_audit` ketika token aslinya sudah hilang.

### Audit Panel
Komponen `ResellerAuditLog.tsx` **sudah memiliki** search box yang mencari berdasarkan `reseller_name`, `reseller_prefix`, `show_title`, `token_code`, dll (baris 73-88). Yang masih kurang: filter dropdown khusus per-reseller untuk navigasi lebih cepat saat melihat riwayat satu reseller tertentu.

## Perubahan

### A. Migration — Lindungi Riwayat Token Reseller
1. **Ubah trigger `cascade_delete_tokens_on_show_delete`** agar tidak menghapus token reseller. Sebagai gantinya:
   - Untuk token reseller (`reseller_id IS NOT NULL`) → **archive saja** (`status='archived'`, `archived_to_replay=true`) dan set `show_id = NULL` (karena show-nya sudah dihapus). Simpan judul show terakhir di kolom yang sudah ada (atau via metadata di audit).
   - Untuk token non-reseller → tetap dihapus seperti semula.
2. **Tambah kolom `archived_show_title TEXT`** di `tokens` (nullable) untuk menyimpan judul show terakhir saat show-nya dihapus, agar reseller dan bot tetap bisa melihat token milik show mana.
3. **Update RPC `reseller_list_my_tokens`** & `reseller_list_recent_tokens_by_id` agar:
   - `COALESCE(s.title, t.archived_show_title, '(Show dihapus)')` sebagai `show_title`.
   - Tetap menampilkan token dengan `show_id IS NULL`.
4. **Tambah RLS policy eksplisit di `reseller_token_audit`**:
   - `DELETE` hanya boleh oleh admin (sudah implisit via "Admins manage reseller audit", tapi tambahkan policy `Block non-admin delete` agar jelas).
   - Bahkan admin **tidak boleh** menghapus audit lewat client SDK kecuali via RPC khusus (opsional — saya pilih: tambah policy yang block `DELETE` untuk semua role kecuali admin yang akan punya RPC `admin_delete_reseller_audit_entry` — tapi ini overkill; RLS admin saat ini sudah cukup. Saya akan **tetap fokus pada bagian yang user minta secara eksplisit**: hanya admin yang boleh delete riwayat).
   - Verifikasi & dokumentasikan policy DELETE untuk `tokens` reseller — hanya admin atau service_role yang bisa hard-delete.

### B. Frontend — Audit Panel `ResellerAuditLog.tsx`
1. Tambah dropdown **"Filter Reseller"** yang menampilkan daftar reseller unik dari entries; saat dipilih, list otomatis terfilter ke reseller tersebut.
2. Tambah tombol kecil di setiap row untuk "Lihat Semua dari Reseller Ini" (klik → set filter).
3. Tampilkan **counter per reseller** dalam dropdown (mis. "Andi (24 entries)") supaya admin tahu siapa yang paling aktif.
4. Tetap pertahankan search box bebas yang sudah ada.

### C. Frontend — Dashboard Reseller `ResellerDashboard.tsx`
1. Tampilkan token archived (status='archived') dengan badge khusus "Show Telah Berakhir/Dihapus" + judul fallback.
2. Tetap tampilkan link replay jika token punya pasangan di `replay_tokens` (sudah ada `replay_expires_at`).

## File yang Diubah
- 1 migration baru: ubah trigger `cascade_delete_tokens_on_show_delete` (soft-archive untuk reseller token), tambah kolom `tokens.archived_show_title`, update 2 RPC reseller list, perketat policy.
- `src/components/admin/ResellerAuditLog.tsx` — tambah filter reseller dropdown.
- `src/components/reseller/ResellerDashboard.tsx` — tampilkan token archived dengan judul fallback.

## Hasil yang Diharapkan
- Saat admin menghapus show, **riwayat token reseller tetap aman** (di-archive, tidak dihapus). Reseller masih lihat token-nya di dashboard & bot WA dengan label "Show telah dihapus" + judul terakhir.
- **Tidak ada lagi riwayat hilang otomatis** karena flow show flip atau show delete.
- Admin dapat mencari/memfilter audit log per-reseller dengan dropdown khusus, sangat mudah melacak siapa membuat token apa.
- RLS dipastikan: hanya admin yang bisa DELETE audit & token reseller secara langsung.