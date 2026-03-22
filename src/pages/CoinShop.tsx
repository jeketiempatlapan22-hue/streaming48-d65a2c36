import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Shield, Coins, Upload, CheckCircle } from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";

const CoinShop = () => {
  const [user, setUser] = useState<any>(null);
  const [balance, setBalance] = useState(0);
  const [packages, setPackages] = useState<any[]>([]);
  const [selectedPkg, setSelectedPkg] = useState<any>(null);
  const [uploading, setUploading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        setUser(session.user);
        const { data: bal } = await supabase.from("coin_balances").select("balance").eq("user_id", session.user.id).maybeSingle();
        setBalance(bal?.balance || 0);
      }
      const { data: pkgs } = await supabase.from("coin_packages").select("*").eq("is_active", true).order("sort_order");
      if (pkgs) setPackages(pkgs);
    };
    load();
  }, []);

  // Realtime balance
  useEffect(() => {
    if (!user) return;
    const ch = supabase.channel(`coin-bal-${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "coin_balances", filter: `user_id=eq.${user.id}` }, (payload: any) => {
        if (payload.new?.balance !== undefined) {
          const oldBal = balance;
          setBalance(payload.new.balance);
          if (payload.new.balance > oldBal) {
            toast.success(`💰 +${payload.new.balance - oldBal} koin ditambahkan!`);
          }
        }
      }).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user, balance]);

  const handleUploadProof = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedPkg || !user) return;
    if (file.size > 5 * 1024 * 1024) { toast.error("Maksimal 5 MB"); return; }

    setUploading(true);
    // For now, create coin order without file upload (simplified)
    const { error } = await supabase.from("coin_orders").insert({
      user_id: user.id,
      package_id: selectedPkg.id,
      coin_amount: selectedPkg.coin_amount,
      status: "pending",
    });
    if (error) {
      toast.error("Gagal mengirim pesanan");
    } else {
      setSubmitted(true);
      toast.success("Pesanan berhasil dikirim! Admin akan mengkonfirmasi.");
    }
    setUploading(false);
  };

  if (!user) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <div className="text-center">
          <div className="mx-auto mb-4 h-16 w-16 rounded-full bg-[hsl(var(--warning))]/15 border-2 border-[hsl(var(--warning))]/50 flex items-center justify-center">
            <Coins className="h-8 w-8 text-[hsl(var(--warning))]" />
          </div>
          <h2 className="text-xl font-bold text-foreground mb-2">Coin Shop</h2>
          <p className="text-muted-foreground text-sm mb-6">Login terlebih dahulu untuk membeli koin</p>
          <a href="/auth" className="inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 font-semibold text-primary-foreground hover:bg-primary/90 active:scale-[0.97]">
            Login / Daftar
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <nav className="sticky top-0 z-40 border-b border-border/50 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
          <a href="/" className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-full bg-primary/20 border border-primary/40 flex items-center justify-center">
              <Shield className="h-4 w-4 text-primary" />
            </div>
            <span className="text-sm font-bold">Real<span className="text-primary">Time48</span></span>
          </a>
          <div className="flex items-center gap-1.5 rounded-lg bg-[hsl(var(--warning))]/10 px-3 py-1.5">
            <Coins className="h-4 w-4 text-[hsl(var(--warning))]" />
            <span className="text-sm font-bold text-[hsl(var(--warning))]">{balance} Koin</span>
          </div>
        </div>
      </nav>

      <div className="mx-auto max-w-4xl px-4 py-10">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-10"
        >
          <p className="text-sm font-bold uppercase tracking-widest text-[hsl(var(--warning))] mb-2">Coin Shop</p>
          <h1 className="text-3xl font-extrabold text-foreground">Beli <span className="text-[hsl(var(--warning))]">Koin</span></h1>
          <p className="text-muted-foreground mt-2 text-sm">Tukarkan koin untuk akses nonton show</p>
        </motion.div>

        {/* Purchase modal */}
        {selectedPkg && !submitted && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4"
          >
            <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6">
              <h3 className="text-lg font-bold mb-1">{selectedPkg.name}</h3>
              <p className="text-muted-foreground text-sm mb-4">{selectedPkg.coin_amount} Koin — {selectedPkg.price}</p>

              {selectedPkg.qris_image_url ? (
                <img src={selectedPkg.qris_image_url} alt="QRIS" className="mx-auto w-full max-w-sm rounded-lg mb-4" />
              ) : (
                <div className="rounded-lg border border-border bg-secondary/50 p-8 text-center text-sm text-muted-foreground mb-4">QRIS belum tersedia</div>
              )}

              <p className="text-xs text-muted-foreground text-center mb-4">Scan QRIS lalu upload bukti pembayaran</p>

              <button
                onClick={() => {
                  const input = document.createElement("input");
                  input.type = "file"; input.accept = "image/*";
                  input.onchange = (e: any) => handleUploadProof(e);
                  input.click();
                }}
                disabled={uploading}
                className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-primary/30 bg-primary/5 px-4 py-4 text-sm font-medium text-primary hover:border-primary hover:bg-primary/10 transition-all"
              >
                <Upload className="h-4 w-4" />
                {uploading ? "Mengupload..." : "Upload Bukti Pembayaran"}
              </button>

              <button onClick={() => setSelectedPkg(null)} className="mt-3 w-full rounded-xl bg-secondary py-3 text-sm font-medium text-secondary-foreground hover:bg-secondary/80">
                Batal
              </button>
            </div>
          </motion.div>
        )}

        {submitted && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4"
          >
            <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 text-center">
              <CheckCircle className="mx-auto h-12 w-12 text-[hsl(var(--success))] mb-4" />
              <h4 className="text-lg font-bold mb-2">Pesanan Dikirim!</h4>
              <p className="text-sm text-muted-foreground mb-4">Admin akan mengkonfirmasi pembayaran Anda dan koin akan ditambahkan otomatis.</p>
              <button onClick={() => { setSubmitted(false); setSelectedPkg(null); }} className="w-full rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 active:scale-[0.97]">
                OK
              </button>
            </div>
          </motion.div>
        )}

        {packages.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground text-sm">Belum ada paket koin tersedia.</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {packages.map((pkg, i) => (
              <motion.button
                key={pkg.id}
                onClick={() => { setSelectedPkg(pkg); setSubmitted(false); }}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.1 }}
                className="rounded-2xl border border-border bg-card p-6 text-left transition-all hover:border-[hsl(var(--warning))]/50 hover:shadow-xl hover:shadow-[hsl(var(--warning))]/5 active:scale-[0.97] group"
              >
                <div className="flex items-center gap-3 mb-3">
                  <div className="h-10 w-10 rounded-xl bg-[hsl(var(--warning))]/15 flex items-center justify-center">
                    <Coins className="h-5 w-5 text-[hsl(var(--warning))]" />
                  </div>
                  <div>
                    <h3 className="font-bold text-foreground">{pkg.name}</h3>
                    <p className="text-xs text-muted-foreground">{pkg.coin_amount} Koin</p>
                  </div>
                </div>
                <p className="text-lg font-bold text-[hsl(var(--warning))]">{pkg.price}</p>
              </motion.button>
            ))}
          </div>
        )}

        <p className="text-center text-xs text-muted-foreground mt-8">
          <a href="/" className="text-primary hover:underline">← Kembali ke beranda</a>
        </p>
      </div>
    </div>
  );
};

export default CoinShop;
