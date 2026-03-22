import { useState, useEffect } from "react";
import { Download, CheckCircle, Share, MoreVertical, Smartphone } from "lucide-react";
import SharedNavbar from "@/components/SharedNavbar";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const InstallPage = () => {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    setIsIOS(/iPad|iPhone|iPod/.test(navigator.userAgent));
    setIsStandalone(window.matchMedia("(display-mode: standalone)").matches || (navigator as any).standalone === true);
    const handler = (e: Event) => { e.preventDefault(); setDeferredPrompt(e as BeforeInstallPromptEvent); };
    window.addEventListener("beforeinstallprompt", handler);
    window.addEventListener("appinstalled", () => setInstalled(true));
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") setInstalled(true);
    setDeferredPrompt(null);
  };

  if (isStandalone) {
    return (
      <div className="min-h-screen bg-background">
        <SharedNavbar />
        <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
          <CheckCircle className="h-16 w-16 text-[hsl(var(--success))] mb-4" />
          <h1 className="text-2xl font-bold text-foreground">Sudah Ter-install!</h1>
          <p className="mt-2 text-muted-foreground">Kamu sudah menggunakan RealTime48 sebagai aplikasi.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <SharedNavbar />
      <div className="mx-auto max-w-md px-4 py-10 pt-20">
        <div className="flex flex-col items-center text-center mb-8">
          <div className="h-20 w-20 rounded-2xl border border-primary/30 shadow-[0_0_20px_hsl(var(--primary)/0.3)] mb-4 flex items-center justify-center bg-primary/10">
            <span className="text-3xl font-black text-primary">R48</span>
          </div>
          <h1 className="text-2xl font-bold text-foreground">Install RealTime48</h1>
          <p className="mt-2 text-sm text-muted-foreground">Dapatkan pengalaman terbaik dengan menginstall aplikasi ke HP kamu</p>
        </div>

        <div className="space-y-3 mb-8">
          {[
            { icon: "⚡", title: "Akses Cepat", desc: "Buka langsung dari home screen tanpa browser" },
            { icon: "📱", title: "Fullscreen", desc: "Tampilan fullscreen seperti aplikasi native" },
            { icon: "🔔", title: "Notifikasi", desc: "Dapatkan update terbaru tentang show" },
            { icon: "💾", title: "Offline Ready", desc: "Beberapa fitur tetap bisa diakses offline" },
          ].map((item, i) => (
            <div key={i} className="flex items-start gap-3 rounded-xl border border-border bg-card p-4">
              <span className="text-2xl">{item.icon}</span>
              <div><p className="text-sm font-semibold text-foreground">{item.title}</p><p className="text-xs text-muted-foreground">{item.desc}</p></div>
            </div>
          ))}
        </div>

        {installed ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-primary/30 bg-primary/10 p-6 text-center">
            <CheckCircle className="h-10 w-10 text-primary" />
            <p className="font-semibold text-foreground">Berhasil Di-install!</p>
            <p className="text-sm text-muted-foreground">Buka RealTime48 dari home screen kamu</p>
          </div>
        ) : deferredPrompt ? (
          <button onClick={handleInstall} className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-6 py-4 text-base font-bold text-primary-foreground shadow-lg shadow-primary/25 transition hover:bg-primary/90 active:scale-[0.98]">
            <Download className="h-5 w-5" /> Install Sekarang
          </button>
        ) : isIOS ? (
          <div className="rounded-xl border border-border bg-card p-6">
            <p className="mb-4 text-center text-sm font-semibold text-foreground">Cara Install di iPhone/iPad:</p>
            <div className="space-y-3">
              {[
                <><span>Ketuk tombol</span> <Share className="inline h-4 w-4 text-primary" /> <span className="font-medium text-foreground">Share</span> <span>di Safari</span></>,
                <>Pilih <span className="font-medium text-foreground">"Add to Home Screen"</span></>,
                <>Ketuk <span className="font-medium text-foreground">"Add"</span></>,
              ].map((content, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">{i + 1}</div>
                  <p className="text-sm text-muted-foreground">{content}</p>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-card p-6">
            <p className="mb-4 text-center text-sm font-semibold text-foreground">Cara Install di Android:</p>
            <div className="space-y-3">
              {[
                <><span>Ketuk</span> <MoreVertical className="inline h-4 w-4 text-primary" /> <span className="font-medium text-foreground">menu browser</span></>,
                <>Pilih <span className="font-medium text-foreground">"Install app"</span> atau <span className="font-medium text-foreground">"Add to Home Screen"</span></>,
                <>Ketuk <span className="font-medium text-foreground">"Install"</span></>,
              ].map((content, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">{i + 1}</div>
                  <p className="text-sm text-muted-foreground">{content}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-6 flex items-center justify-center gap-2 text-center">
          <Smartphone className="h-4 w-4 text-muted-foreground" />
          <p className="text-xs text-muted-foreground">Gratis, tanpa download dari App Store</p>
        </div>
      </div>
    </div>
  );
};

export default InstallPage;
