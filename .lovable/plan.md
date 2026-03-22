
Masalah ini kemungkinan besar terjadi karena **penguncian device hanya kuat di halaman `/live`**, tetapi jalur pengambilan stream masih punya celah.

Ringkasan temuan dari kode saat ini:
1. `create_token_session` sudah membatasi `max_devices`, tapi pembangkitan URL stream di `stream-proxy` masih hanya cek `validate_token` (belum ikat ketat ke sesi device aktif).
2. Ada pelepasan sesi via event `pagehide` di `LivePage`, yang berpotensi melepas lock terlalu cepat di kondisi tertentu (mobile/tab switch), sehingga device lain bisa masuk.
3. Token koin memang `max_devices=1`, tetapi jika lock sesi terlepas terlalu cepat, hasilnya terlihat seperti bisa dipakai di banyak browser/device.

Rencana perbaikan mendalam (tanpa mengganggu user saat menonton):

1) Kunci akses stream ke sesi device aktif (server-side)
- File: `supabase/functions/stream-proxy/index.ts`
- Ubah endpoint generate signed URL agar **wajib menerima fingerprint** dari client.
- Di endpoint generate, panggil RPC sesi (`create_token_session`) sebelum memberi `signed_url`.
- Jika hasil `device_limit`, balikan 403 (supaya device tambahan benar-benar ditolak).
- Ini menutup celah akses stream langsung yang tidak lewat validasi lock device.

2) Perkuat lifecycle sesi agar tidak “longgar” dan tidak bikin user tiba-tiba keluar
- File: `src/pages/LivePage.tsx`
- Kurangi pelepasan sesi agresif: evaluasi `pagehide` agar tidak melepas lock saat user masih di konteks menonton (mis. transisi/tab behavior tertentu).
- Pertahankan heartbeat berkala untuk menjaga sesi aktif selama user benar-benar menonton.
- Pastikan error heartbeat transient tidak langsung kick user (stabilitas playback tetap prioritas).

3) Sinkronkan fingerprint end-to-end
- File: `src/hooks/useSignedStreamUrl.ts`, `src/pages/LivePage.tsx`
- `useSignedStreamUrl` ditambah parameter fingerprint dan kirim ke `stream-proxy`.
- Fingerprint yang dipakai untuk lock di `/live` dan fingerprint untuk generate URL stream harus sama.

4) Hardening database untuk konsistensi lock
- Migration SQL baru:
  - Tambah index performa untuk lookup sesi aktif (`token_id`, `is_active`, `fingerprint`, `last_seen_at`).
  - (Opsional tapi direkomendasikan) partial unique index untuk mencegah duplikasi sesi aktif fingerprint yang sama per token.
  - Review `create_token_session` agar tetap tegas:
    - token publik unlimited,
    - token koin 1 device,
    - token manual sesuai `max_devices`.

5) Validasi end-to-end (wajib)
- Skenario uji:
  - Token manual `max_devices=1`: buka di 3 browser/device, hanya 1 boleh aktif.
  - Token manual `max_devices=2`: device ke-3 harus ditolak.
  - Token koin: hanya 1 device aktif.
  - Token publik: tetap unlimited.
  - User menonton 30–60 menit: tidak keluar tiba-tiba, heartbeat stabil, stream tetap lancar.

Detail teknis (inti akar masalah):
- Saat ini lock device kuat di layer sesi halaman live, tapi distribusi URL stream perlu diikat ke sesi aktif yang sama.
- Dengan mengikat `stream-proxy` ke fingerprint + sesi aktif, akses paralel lintas browser/device akan terkunci konsisten sesuai aturan token.
