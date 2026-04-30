## Ringkasan Masalah

**1. Duplikasi riwayat transaksi** — Cek DB menunjukkan tiap redeem koin tersimpan **dua baris dengan timestamp & reference_id identik** di `coin_transactions`. Penyebab: trigger `on_token_created_log` pada tabel `tokens` insert otomatis ke `coin_transactions`, sementara RPC redeem (`redeem_show_with_coins`, `redeem_replay_with_coins`, `redeem_membership_with_coins`) juga insert sendiri → 2 baris per transaksi.

**2. Layout** — Kartu "Membership Aktif" (`MembershipDetailCard`) berada di **bawah** kartu "Akses Live Aktif". Harus dipindah ke atas.

**3. Visibilitas "Akses Live Aktif"** — Saat ini muncul untuk semua user yang punya token aktif. Aturan baru:
- User **membership** (punya token `MBR-`/`MRD-` aktif) → kartu "Akses Live Aktif" **disembunyikan**, karena sudah punya `MembershipDetailCard` dengan tombol Tonton Live.
- User **non-membership** → kartu "Akses Live Aktif" **tetap muncul** seperti sekarang.
- Untuk semua user, daftar token tetap dapat dilihat di tab **Token**.

---

## Rencana Implementasi

### A. Perbaikan duplikasi transaksi

**Migration baru** — drop trigger penyebab duplikasi:
```sql
DROP TRIGGER IF EXISTS on_token_created_log ON public.tokens;
```
RPC redeem yang ada sudah mencatat sendiri, sehingga setelah trigger di-drop tiap transaksi baru hanya menghasilkan **1 baris**. Tidak ada perubahan saldo (tabel `coin_balances` dikelola RPC, bukan oleh trigger ini). Data lama tidak diubah.

**Dedup defensif di client** — `src/components/viewer/UserTransactionHistory.tsx`:
Setelah merge ketiga sumber (coin_transactions, subscription_orders, coin_orders), tambahkan filter dedup berdasarkan kombinasi (kind + amount + title + detik created_at) sebelum di-render. Ini menyembunyikan baris kembar **lama** yang sudah terlanjur tercatat di DB tanpa menghapus apapun:
```ts
const seen = new Set<string>();
const deduped = merged.filter(tx => {
  const key = `${tx.kind}|${tx.amount ?? ""}|${tx.title}|${new Date(tx.created_at).toISOString().slice(0,19)}`;
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
});
```

### B. Layout & visibilitas — `src/pages/ViewerProfile.tsx`

1. Tambah satu derivasi:
   ```ts
   const hasActiveMembership = tokens.some(t => {
     const c = (t.code || "").toUpperCase();
     const notExpired = !t.expires_at || new Date(t.expires_at) > new Date();
     return t.status === "active" && notExpired && (c.startsWith("MBR-") || c.startsWith("MRD-"));
   });
   ```

2. **Pindahkan** blok `MembershipDetailCard` (lines ~291–385) ke posisi **di atas** blok "Akses Live Aktif" (lines ~228–289).

3. **Sembunyikan blok "Akses Live Aktif" untuk user membership** dengan menambah guard:
   ```ts
   if (liveTokens.length === 0 || hasActiveMembership) return null;
   ```
   - User membership: tidak melihat kartu "Akses Live Aktif" sama sekali (sudah ada CTA Tonton Live di `MembershipDetailCard`).
   - User non-membership dengan token aktif: kartu tetap tampil seperti sekarang.
   - Tab **Token** tidak diubah — semua user tetap bisa lihat & masuk live dari sana.

---

## File yang Disentuh

- **Migration baru** — `DROP TRIGGER on_token_created_log`.
- `src/pages/ViewerProfile.tsx` — tukar urutan dua kartu + sembunyikan "Akses Live Aktif" jika user membership.
- `src/components/viewer/UserTransactionHistory.tsx` — dedup defensif di client.

## Verifikasi setelah deploy

- Redeem koin baru → cek `coin_transactions`: hanya 1 baris baru per redeem.
- Riwayat di profil tidak menampilkan baris dobel (data lama disembunyikan dedup).
- User membership: lihat `MembershipDetailCard` paling atas, tanpa kartu "Akses Live Aktif".
- User non-membership dengan token: lihat "Akses Live Aktif" seperti biasa (tanpa `MembershipDetailCard`).
