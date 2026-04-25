
# Plan: AI Auto-Tag Chat + Quiz Game dengan Hadiah Koin

Dua fitur baru untuk meningkatkan engagement live chat: (1) **AI Auto-Tag** untuk klasifikasi pesan otomatis, dan (2) **Quiz Game** dengan pertanyaan dari AI atau manual, dengan hadiah koin otomatis ke pemenang.

---

## Fitur 1: AI Auto-Tag Chat

Setiap pesan chat otomatis ditandai oleh AI dengan label: `question` (pertanyaan ke admin/host), `support` (dukungan/cheer), `spam` (promosi/iklan/link berbahaya), `toxic` (kasar/SARA), atau `normal`. Tag ditampilkan sebagai badge kecil di samping pesan, hanya terlihat oleh **admin & moderator**.

**Manfaat:**
- Admin cepat melihat pertanyaan penting (badge ❓ kuning)
- Spam/toxic otomatis di-highlight (badge merah) → moderator klik 1x untuk hapus
- Filter chat: tampilkan hanya pesan ber-tag tertentu

**Tampilan badge (admin only):**
```
[username] [❓ TANYA] Halo kak kapan show mulai?
[username] [🚫 SPAM] beli followers murah klik...
[username] Mantap banget!  ← normal, tanpa badge
```

**Pengaturan (di Site Settings admin):**
- Toggle on/off auto-tag
- Threshold confidence (default 0.7) untuk menampilkan badge

---

## Fitur 2: Live Quiz Game

Admin bisa membuat **sesi quiz** kapan saja saat live. Pertanyaan bisa di-generate AI (dengan tema yang dipilih admin) atau ditulis manual. Pemenang pertama yang menjawab benar di chat mendapat koin otomatis.

### Alur Admin

**Tab baru: "Live Quiz" di sidebar admin**

1. **Buat Quiz baru:**
   - **Sumber pertanyaan:**
     - 🤖 **AI Generate** → admin pilih tema (Umum / JKT48 / Musik / Anime / Trivia / custom prompt) + tingkat kesulitan (mudah/sedang/sulit) → AI generate 1 atau lebih pertanyaan dengan jawaban
     - ✍️ **Manual** → admin tulis pertanyaan + jawaban (bisa multi jawaban valid: "jakarta, jkt, dki")
   - **Setting hadiah:**
     - Jumlah pemenang (1-10)
     - Koin per pemenang (mis. 50 koin)
     - Durasi quiz (default 60 detik, bisa 30/60/120/300s)
   - Preview pertanyaan & jawaban → klik "Mulai Quiz"

2. **Saat quiz aktif:**
   - Banner quiz muncul di atas chat untuk semua viewer
   - Countdown timer berjalan
   - Sistem otomatis cek setiap pesan chat baru — jika cocok dengan jawaban (case-insensitive, fuzzy match), user masuk daftar pemenang sampai kuota terpenuhi
   - Admin lihat panel real-time: daftar pemenang yang sudah masuk + sisa kuota
   - Admin bisa **End Early** atau biarkan timer habis

3. **Setelah quiz selesai:**
   - Sistem otomatis kreditkan koin ke balance pemenang (insert ke `coin_transactions` + update `coin_balances`)
   - Banner "🏆 Pemenang Quiz" tampil di chat: "Selamat @user1, @user2 mendapat 50 koin!"
   - Histori quiz tersimpan untuk dilihat ulang

### Alur Viewer

- Banner quiz neon di atas chat: pertanyaan + countdown + hadiah
- Viewer ketik jawaban di chat seperti biasa (atau tombol khusus "Jawab Quiz" untuk submit privat — opsional, default chat publik)
- Jika menang, toast "🎉 Selamat! Kamu menang 50 koin" + koin masuk balance
- Viewer non-login (token-only) tidak bisa menang (hanya user terdaftar dapat koin)

---

## Perubahan Database

**3 tabel baru + kolom tambahan:**

1. **`chat_messages`** — tambah kolom:
   - `ai_tag text` (nullable): question/support/spam/toxic/normal
   - `ai_tag_confidence numeric` (nullable, 0-1)

2. **`live_quizzes`** — sesi quiz:
   - `id, created_at, created_by, status` (draft/active/ended/cancelled)
   - `source` (ai/manual), `question text, answers text[]` (multi jawaban valid)
   - `theme text, difficulty text` (untuk AI)
   - `max_winners int, coin_reward int, duration_seconds int`
   - `started_at, ends_at, ended_at`

3. **`quiz_winners`** — pemenang per quiz:
   - `id, quiz_id, user_id, username, message_id, answered_at, coins_awarded int, rank int`
   - Unique `(quiz_id, user_id)` agar 1 user 1 menang per quiz

**RLS:** admin manage all; viewer SELECT quiz aktif + winner mereka sendiri; INSERT winner hanya via edge function (service role).

---

## Edge Functions Baru (4)

1. **`ai-tag-chat`** — dipanggil dari trigger DB (atau worker) untuk tag setiap pesan baru. Pakai Lovable AI (`google/gemini-3-flash-preview`) dengan tool calling structured output. Update `chat_messages.ai_tag` & confidence.

2. **`quiz-generate`** — admin only. Input: `{ theme, difficulty, count }`. Output: array `{ question, answers[] }`. Pakai Lovable AI + tool calling. Admin bisa accept/edit hasil.

3. **`quiz-start`** — admin only. Input: `{ question, answers[], max_winners, coin_reward, duration_seconds, source }`. Buat row `live_quizzes` status active, broadcast realtime.

4. **`quiz-check-answer`** — dipanggil otomatis dari DB trigger atau realtime listener saat ada pesan baru. Cek apakah quiz aktif & jawaban cocok. Insert winner jika cocok & belum penuh. Saat winner masuk → kredit koin (transaksi atomik via RPC `award_quiz_coins`). Saat quiz berakhir (timer/manual/penuh) → set status ended, post pesan pemenang ke chat.

   Implementasi efisien: alih-alih trigger DB pemanggil edge function (mahal), pakai **client-side realtime listener** di komponen LiveChat yang juga berjalan di session admin/moderator → dia memanggil edge function ketika quiz aktif. Lebih sederhana: edge function `quiz-tick` dipanggil tiap pesan via subscribe loop pada admin.

   **Pendekatan final yang dipilih**: pakai **Postgres function `submit_quiz_answer`** yang dipanggil otomatis lewat trigger `AFTER INSERT ON chat_messages` — semua logic match jawaban + insert winner + kredit koin terjadi di DB (cepat & atomik). Edge function hanya untuk AI tagging & generate.

---

## Perubahan File

**Baru:**
- `supabase/functions/ai-tag-chat/index.ts`
- `supabase/functions/quiz-generate/index.ts`
- `src/components/admin/QuizManager.tsx` — UI buat quiz, lihat aktif, histori
- `src/components/viewer/LiveQuizBanner.tsx` — banner quiz untuk viewer
- `src/hooks/useLiveQuiz.ts` — hook subscribe quiz aktif

**Diubah:**
- `src/components/viewer/LiveChat.tsx` — tampilkan badge AI tag (admin/mod only), trigger `ai-tag-chat` setelah kirim pesan
- `src/components/admin/AdminSidebar.tsx` — tambah menu "Live Quiz" (icon Sparkles/Trophy)
- `src/pages/AdminDashboard.tsx` — register section `quiz` → `<QuizManager />`
- `src/pages/Index.tsx` — render `<LiveQuizBanner />` di atas chat saat live
- Migration: tambah kolom `chat_messages.ai_tag/ai_tag_confidence`, buat tabel `live_quizzes` + `quiz_winners`, buat function `submit_quiz_answer` + trigger, buat function `award_quiz_coins`

---

## Catatan Teknis

- **AI provider:** Lovable AI Gateway (sudah ada `LOVABLE_API_KEY`), model default `google/gemini-3-flash-preview` (cepat & murah untuk klasifikasi).
- **Auto-tag performa:** debounce/batch — tag pesan dipanggil async tanpa blocking kirim chat. Pesan tetap tampil instant, badge muncul beberapa detik kemudian via realtime UPDATE.
- **Hemat token:** auto-tag hanya jalan saat `chat_enabled=true` AND ada show live. Bisa di-disable total via setting.
- **Match jawaban:** normalisasi (lowercase, trim, hapus tanda baca), exact match terhadap salah satu `answers[]`. Tidak pakai fuzzy untuk hindari false positive.
- **Anti-cheat:** user hanya bisa menang 1x per quiz; pesan dikirim setelah `started_at` baru valid; user dengan role admin/moderator tidak bisa menang.
- **Hadiah koin:** function `award_quiz_coins(user_id, amount, quiz_id)` — atomik insert ke `coin_transactions` (type='quiz_reward') + UPDATE `coin_balances`.

