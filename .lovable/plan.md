## Tujuan
Merapikan admin panel dengan **mengelompokkan 25 menu** ke dalam grup-grup logis dengan label pemisah dan akordeon yang dapat diciutkan, tanpa mengubah komponen atau routing tab yang sudah ada.

## Pengelompokan Menu

```text
🎬 OPERASIONAL LIVE
   • Live & Playlist          → live
   • Monitor, Poll & Quiz      → monitor
   • Halaman Restream          → restream

🎭 SHOW & KONTEN
   • Show Manager              → shows
   • Deskripsi LP              → descriptions
   • Foto Member               → member-photos
   • Media Library             → media

🎫 TOKEN & AKSES
   • Token Factory             → tokens
   • Token Manual + WA         → manual-token
   • Reset Password            → password-resets

🛒 ORDER & PEMBAYARAN
   • Order Show                → show-orders
   • Order Membership          → orders
   • Order Koin                → coin-orders
   • Paket Koin                → coin-packages

👥 USER & TIM
   • Manajemen User            → users
   • Akun Moderator            → moderators
   • Reseller                  → resellers
   • Audit Token Reseller      → reseller-audit

🛡️ KEAMANAN & MONITORING
   • Security Log              → security
   • System Health             → health
   • Live Logs                 → logs
   • Auth Metrics              → auth-metrics
   • Traffic Monitor           → traffic
   • Rate Limits               → rate-limits

⚙️ PENGATURAN
   • Pengaturan                → site
```

## Perubahan UI

**File yang diubah:** `src/components/admin/AdminSidebar.tsx` (file tunggal — komponen lain & state tidak terpengaruh)

1. **Restruktur konstanta `sections`** menjadi array grup:
   ```ts
   const sectionGroups = [
     { label: "Operasional Live", icon: Radio, items: [...] },
     { label: "Show & Konten", icon: Theater, items: [...] },
     ...
   ]
   ```

2. **Render per grup** dengan:
   - Header grup: label uppercase kecil + ikon + tombol toggle (chevron)
   - Konten grup: daftar menu yang bisa diciutkan (default terbuka untuk grup yang berisi `activeSection`)
   - Pemisah tipis (`border-t border-border/40`) di antara grup

3. **State akordeon lokal** — `useState<Record<string, boolean>>` menyimpan status expand/collapse per grup, tersimpan di `localStorage` agar preferensi admin terjaga lintas sesi.

4. **Auto-expand grup aktif** — saat `activeSection` berubah, grup yang berisinya otomatis terbuka.

5. **Highlight tetap konsisten** — gaya `bg-primary/10 text-primary` untuk menu aktif tidak berubah.

## Detail Teknis

- Tidak ada perubahan ke `AdminDashboard.tsx`, routing, atau komponen tab — hanya `AdminSidebar.tsx` yang disentuh.
- ID section (`live`, `tokens`, dll) tetap identik agar `switch (activeSection)` di `AdminDashboard.tsx` bekerja tanpa perubahan.
- Mobile drawer (`Sheet`) menggunakan render yang sama, jadi pengelompokan otomatis ikut tampil di mobile.
- Tinggi sidebar dengan grup terciut akan jauh lebih pendek; scroll tetap tersedia jika dibutuhkan.
- Ikon grup memakai lucide-react yang sudah di-import (Radio, Theater, Key, ShoppingBag, UsersRound, Shield, Settings).

## Hasil Akhir

- Sidebar berkurang dari **25 baris menu datar** menjadi **7 grup kolaps** yang lebih mudah dipindai.
- Admin bisa fokus pada grup yang relevan saja (misal saat moderasi live, hanya buka grup "Operasional Live").
- Preferensi expand/collapse tersimpan otomatis.
