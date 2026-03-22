import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { motion } from "framer-motion";
import SharedNavbar from "@/components/SharedNavbar";
import { HelpCircle, ChevronDown, MessageCircle } from "lucide-react";

interface FaqItem {
  q: string;
  a: string;
}

const DEFAULT_FAQS: FaqItem[] = [
  { q: "Bagaimana cara menonton live streaming?", a: "Kamu perlu token akses untuk menonton. Token bisa didapat dari membeli show dengan koin atau tiket. Setelah punya token, masukkan di halaman /live." },
  { q: "Bagaimana cara membeli koin?", a: "Buka halaman Coin Shop (/coins), pilih paket koin, scan QRIS untuk pembayaran, lalu upload bukti transfer. Admin akan mengkonfirmasi dan koin otomatis masuk ke saldo kamu." },
  { q: "Apa itu token dan bagaimana cara menggunakannya?", a: "Token adalah kode akses untuk menonton live streaming. Setelah membeli show, kamu akan mendapatkan token. Salin token tersebut dan masukkan di halaman /live untuk mulai menonton." },
  { q: "Berapa perangkat yang bisa digunakan untuk 1 token?", a: "Secara default, 1 token hanya bisa digunakan di 1 perangkat. Jika kamu ingin menonton di perangkat lain, kamu perlu menutup sesi di perangkat sebelumnya." },
  { q: "Bagaimana cara kerja sistem referral?", a: "Buka halaman profil kamu, salin kode referral unik kamu dan bagikan ke teman. Saat teman mendaftar dan menggunakan kode kamu, kalian berdua mendapatkan bonus koin gratis!" },
  { q: "Token saya tidak berfungsi, apa yang harus dilakukan?", a: "Pastikan token belum expired dan belum diblokir. Cek juga apakah batas perangkat sudah tercapai. Jika masih bermasalah, hubungi admin via WhatsApp." },
  { q: "Apakah bisa nonton ulang (replay)?", a: "Ya! Show yang sudah selesai bisa ditonton ulang dengan membeli replay menggunakan koin. Buka halaman Replay untuk melihat show yang tersedia." },
  { q: "Bagaimana cara bergabung membership?", a: "Buka halaman Membership, pilih paket yang diinginkan, lakukan pembayaran via QRIS atau koin, lalu tunggu konfirmasi admin. Setelah dikonfirmasi, kamu akan mendapat akses ke grup eksklusif." },
];

const FaqPage = () => {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [settings, setSettings] = useState<Record<string, string>>({});

  useEffect(() => {
    supabase.from("site_settings").select("key, value").then(({ data }) => {
      if (data) {
        const s: Record<string, string> = {};
        data.forEach(r => { s[r.key] = r.value; });
        setSettings(s);
      }
    });
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <SharedNavbar />
      <div className="mx-auto max-w-2xl px-4 pt-20 pb-16">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-10 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 border border-primary/20">
            <HelpCircle className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-3xl font-extrabold text-foreground">Pertanyaan Umum</h1>
          <p className="mt-2 text-sm text-muted-foreground">Temukan jawaban untuk pertanyaan yang sering diajukan</p>
        </motion.div>

        <div className="space-y-3">
          {DEFAULT_FAQS.map((faq, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
            >
              <button
                onClick={() => setOpenIndex(openIndex === i ? null : i)}
                className={`flex w-full items-start gap-3 rounded-xl border p-4 text-left transition-all ${
                  openIndex === i
                    ? "border-primary/40 bg-primary/5 shadow-sm"
                    : "border-border bg-card hover:border-primary/20"
                }`}
              >
                <div className="flex-1">
                  <p className="text-sm font-semibold text-foreground">{faq.q}</p>
                  {openIndex === i && (
                    <motion.p
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      className="mt-2 text-sm leading-relaxed text-muted-foreground"
                    >
                      {faq.a}
                    </motion.p>
                  )}
                </div>
                <ChevronDown className={`mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform ${openIndex === i ? "rotate-180" : ""}`} />
              </button>
            </motion.div>
          ))}
        </div>

        {settings.whatsapp_number && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="mt-10 rounded-xl border border-border bg-card p-6 text-center"
          >
            <p className="mb-3 text-sm font-medium text-foreground">Masih punya pertanyaan?</p>
            <a
              href={`https://wa.me/${settings.whatsapp_number}?text=${encodeURIComponent("Halo admin, saya ada pertanyaan")}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-xl bg-[hsl(var(--success))] px-6 py-3 text-sm font-semibold text-primary-foreground transition hover:bg-[hsl(var(--success))]/90 active:scale-[0.97]"
            >
              <MessageCircle className="h-4 w-4" /> Hubungi Admin
            </a>
          </motion.div>
        )}
      </div>
    </div>
  );
};

export default FaqPage;
