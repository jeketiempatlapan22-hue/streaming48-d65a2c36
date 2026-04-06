

## Plan: Player 4 (Direct M3U8), Proxy Toggle, dan Admin Playlist Reorder

### Ringkasan
1. **Player 4 (Direct M3U8)** — Tipe playlist baru `"direct"` yang memutar link M3U8 langsung tanpa proxy/edge function/signed URL. Contoh: `https://playlist.crxanode.com/playback/percin22/master.m3u8?key=realtime_on_live`
2. **Toggle Proxy per Player** — Admin bisa mengaktifkan/menonaktifkan proxy pada setiap playlist entry
3. **Reorder Playlist** — Admin bisa mengatur urutan player dengan tombol atas/bawah (sort order)

---

### Detail Teknis

#### 1. Tipe Playlist Baru: `direct`

**Database**: Tidak perlu migrasi — tabel `playlists` sudah punya kolom `type` (text) dan `url` (text). Tipe `"direct"` cukup disimpan sebagai value baru.

**`LiveControl.tsx`** — Tambah opsi `<SelectItem value="direct">Direct M3U8</SelectItem>` di dropdown tipe saat tambah/edit playlist. Tampilkan hint bahwa link M3U8 diputar langsung tanpa proxy.

**`PlaylistManager.tsx`** — Tambah opsi yang sama di dropdown tipe.

**`LivePage.tsx`** — Perlakukan `direct` sama seperti `m3u8` tapi **bypass** `useSignedStreamUrl` (tidak perlu signed URL). Langsung gunakan `playlist.url` sebagai `effectiveStreamUrl` tanpa edge function. Tidak perlu `customHeadersRef`.

**`AdminMonitor.tsx`** — Perlakukan `direct` sama seperti `m3u8`, bypass `useAdminSignedStreamUrl`. Langsung pakai URL dari playlist.

**`VideoPlayer.tsx`** — Tidak perlu perubahan, karena tipe `"m3u8"` sudah menangani HLS. LivePage akan mengirim `type: "m3u8"` ke VideoPlayer untuk playlist `direct`.

#### 2. Toggle Proxy per Player (Opsional per Playlist)

Ini menggabungkan Player 3 (proxy) dan Player 4 (direct) menjadi satu konsep: admin bisa toggle apakah playlist tertentu menggunakan proxy atau tidak.

**Implementasi**: Tidak menambah kolom DB baru. Cukup gunakan tipe playlist yang ada:
- `proxy` = pakai proxy (hanabira48 API + header injection)
- `direct` = M3U8 langsung tanpa proxy
- `m3u8` = melalui signed URL edge function
- `youtube` = embed YouTube

Di UI admin, tampilkan label yang jelas:
- `M3U8 (Signed)` — lewat edge function
- `Direct M3U8` — langsung tanpa proxy
- `Proxy Stream` — hanabira48 proxy
- `YouTube` — embed

#### 3. Admin Playlist Reorder (Tombol Atas/Bawah)

**`LiveControl.tsx`** — Tambah tombol panah atas (↑) dan bawah (↓) di setiap playlist row. Klik akan swap `sort_order` antara dua playlist yang bersebelahan, lalu update ke DB dan refresh list.

Fungsi `movePlaylist(index, direction)`:
- Swap `sort_order` antara `playlists[index]` dan `playlists[index + direction]`
- `supabase.from("playlists").update({ sort_order }).eq("id", ...)`
- Re-fetch playlists

Urutan prioritas otomatis (M3U8 → YouTube → Proxy) di `sortPlaylists()` di `LivePage.tsx` dan `AdminMonitor.tsx` akan **dihapus** karena admin sekarang mengatur urutan sendiri. Playlist akan ditampilkan sesuai `sort_order` dari DB.

---

### File yang Diubah

| File | Perubahan |
|------|-----------|
| `src/components/admin/LiveControl.tsx` | Tambah tipe `direct`, tombol reorder ↑↓, update hint |
| `src/components/admin/PlaylistManager.tsx` | Tambah tipe `direct` di dropdown |
| `src/pages/LivePage.tsx` | Handle tipe `direct` (bypass signed URL), hapus `sortPlaylists` |
| `src/components/admin/AdminMonitor.tsx` | Handle tipe `direct` (bypass admin signed URL), hapus `sortPlaylists` |
| `src/components/viewer/PlaylistSwitcher.tsx` | Tidak berubah |

