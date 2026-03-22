import { useLocation } from "react-router-dom";
import { useEffect } from "react";
import { motion } from "framer-motion";
import { Home, ArrowLeft, Search, Radio } from "lucide-react";
import logo from "@/assets/logo.png";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="w-full max-w-md text-center"
      >
        <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full border border-primary/30 bg-primary/10 shadow-[0_0_30px_hsl(var(--primary)/0.15)]">
          <img src={logo} alt="RT48" className="h-10 w-10 rounded-full object-cover" />
        </div>

        <h1 className="mb-2 text-7xl font-black text-foreground" style={{ lineHeight: 1 }}>
          4<span className="text-primary">0</span>4
        </h1>
        <p className="mb-6 text-sm text-muted-foreground">
          Halaman <span className="font-mono text-foreground">{location.pathname}</span> tidak ditemukan
        </p>

        <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
          <a
            href="/"
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 active:scale-[0.97]"
          >
            <Home className="h-4 w-4" /> Beranda
          </a>
          <a
            href="/schedule"
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-card px-6 py-3 text-sm font-semibold text-foreground transition hover:bg-secondary active:scale-[0.97]"
          >
            <Radio className="h-4 w-4 text-primary" /> Jadwal Show
          </a>
        </div>
      </motion.div>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4 }}
        className="mt-12 text-xs text-muted-foreground"
      >
        Real<span className="text-primary font-semibold">Time48</span> • Secure Streaming
      </motion.p>
    </div>
  );
};

export default NotFound;
