

# Tambah Badge Tim (Passion/Dream/Love) di Show Card, Replay, dan Lineup

## Ringkasan
Menambahkan kolom `team` pada tabel shows dan menampilkan badge tim dengan warna dan ikon khas di kartu show, halaman replay, dan section lineup di halaman live.

## Tim yang didukung
| Tim | Warna | Ikon/Tema |
|-----|-------|-----------|
| Passion | Merah (`red-500`) | 🔥 Api |
| Dream | Biru (`blue-500`) | ☁️ Awan |
| Love | Pink (`pink-500`) | 💗 Hati |

## Perubahan

### 1. Database Migration
Tambah kolom `team` (text, nullable) ke tabel `shows`:
```sql
ALTER TABLE public.shows ADD COLUMN team text;
```
Update juga RPC `get_public_shows` agar mengembalikan field `team`.

### 2. `src/types/show.ts`
- Tambah `team?: string` ke interface `Show`
- Tambah constant `SHOW_TEAMS` dengan config warna, label, dan ikon per tim

### 3. `src/components/viewer/TeamBadge.tsx` (baru)
Komponen reusable badge tim:
- Banner kecil rounded dengan background gradient sesuai tim
- Ikon tema (flame/cloud/heart SVG atau emoji)
- Nama tim
- Ukuran kecil (`text-[10px]`) agar muat di kartu

### 4. `src/components/viewer/ShowCard.tsx`
- Import `TeamBadge`
- Tampilkan badge tim di area image (sebelah badge kategori, atau di bawahnya)

### 5. `src/pages/ReplayPage.tsx`
- Tampilkan `TeamBadge` di kartu replay (sudah ada badge kategori, tambah badge tim di samping/bawahnya)

### 6. `src/components/viewer/LineupAvatars.tsx`
- Terima prop `team?: string`
- Tampilkan `TeamBadge` di header section lineup, di samping label "Lineup"

### 7. `src/pages/LivePage.tsx`
- Pass `team` dari show data ke `LineupAvatars`

### 8. `src/components/admin/ShowManager.tsx`
- Tambah dropdown/pilihan tim (Passion/Dream/Love/kosong) di form edit show

## Tidak ada dampak ke fitur lain
Kolom baru nullable, default null — show tanpa tim tidak menampilkan badge.

