import { useState, useEffect, forwardRef } from "react";
import { X, Download, Share } from "lucide-react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const PWA_BANNER_KEY = "pwa-banner-dismissed";

const InstallBanner = forwardRef<HTMLDivElement>((_, ref) => {
  const [show, setShow] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    const isStandalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as any).standalone === true;
    if (isStandalone) return;
    const dismissed = localStorage.getItem(PWA_BANNER_KEY);
    if (dismissed && Date.now() - parseInt(dismissed, 10) < 7 * 24 * 60 * 60 * 1000) return;

    setIsIOS(/iPad|iPhone|iPod/.test(navigator.userAgent));
    const handler = (e: Event) => { e.preventDefault(); setDeferredPrompt(e as BeforeInstallPromptEvent); setShow(true); };
    window.addEventListener("beforeinstallprompt", handler);
    const iosTimer = setTimeout(() => { if (/iPad|iPhone|iPod/.test(navigator.userAgent)) setShow(true); }, 3000);
    return () => { window.removeEventListener("beforeinstallprompt", handler); clearTimeout(iosTimer); };
  }, []);

  const dismiss = () => { setShow(false); localStorage.setItem(PWA_BANNER_KEY, Date.now().toString()); };

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") dismiss();
    setDeferredPrompt(null);
  };

  if (!show) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-[90] p-3 animate-in slide-in-from-bottom duration-300">
      <div className="mx-auto max-w-md rounded-2xl border border-border bg-card/95 p-4 shadow-xl backdrop-blur-md">
        <div className="flex items-start gap-3">
          <img src="/logo.png" alt="" className="h-12 w-12 shrink-0 rounded-xl border border-primary/30" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-foreground">Install RealTime48</p>
            {isIOS && !deferredPrompt ? (
              <p className="mt-0.5 text-xs text-muted-foreground">
                Ketuk <Share className="inline h-3 w-3 text-primary" /> lalu pilih <span className="font-medium text-foreground">"Add to Home Screen"</span>
              </p>
            ) : (
              <p className="mt-0.5 text-xs text-muted-foreground">Akses lebih cepat langsung dari home screen HP kamu</p>
            )}
          </div>
          <button onClick={dismiss} className="shrink-0 rounded-lg p-1 text-muted-foreground transition hover:bg-secondary hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        <div className="mt-3 flex gap-2">
          {deferredPrompt ? (
            <button onClick={handleInstall} className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground transition hover:bg-primary/90 active:scale-[0.98]">
              <Download className="h-4 w-4" /> Install
            </button>
          ) : (
            <a href="/install" className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground transition hover:bg-primary/90">
              <Download className="h-4 w-4" /> Cara Install
            </a>
          )}
          <button onClick={dismiss} className="rounded-xl bg-secondary px-4 py-2.5 text-sm font-medium text-secondary-foreground transition hover:bg-secondary/80">Nanti</button>
        </div>
      </div>
    </div>
  );
});

InstallBanner.displayName = "InstallBanner";
export default InstallBanner;
