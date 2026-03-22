import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { motion } from "framer-motion";
import { Crown, Sparkles, CheckCircle, Star, Upload, Users, Calendar, Coins } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import SharedNavbar from "@/components/SharedNavbar";

interface Show {
  id: string;
  title: string;
  price: string;
  lineup: string;
  schedule_date: string;
  schedule_time: string;
  background_image_url: string | null;
  qris_image_url: string | null;
  is_subscription: boolean;
  max_subscribers: number;
  subscription_benefits: string;
  group_link?: string;
  is_order_closed: boolean;
  coin_price: number;
}

const MembershipPage = () => {
  const { toast } = useToast();
  const [shows, setShows] = useState<Show[]>([]);
  const [subscriberCounts, setSubscriberCounts] = useState<Record<string, number>>({});
  const [selectedShow, setSelectedShow] = useState<Show | null>(null);
  const [purchaseMethod, setPurchaseMethod] = useState<"qris" | "coin" | null>(null);
  const [purchaseStep, setPurchaseStep] = useState<"choose" | "qris" | "upload" | "info" | "coin_info" | "coin_insufficient" | "done">("choose");
  const [uploadingProof, setUploadingProof] = useState(false);
  const [proofUrl, setProofUrl] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [coinBalance, setCoinBalance] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [resultGroupLink, setResultGroupLink] = useState("");
  const [coinOnly, setCoinOnly] = useState(false);

  const fetchData = async () => {
    const { data: allShows } = await supabase.rpc("get_public_shows");
    const data = (allShows || []).filter((s: any) => s.is_subscription);
    const subShows = (data as Show[]) || [];
    setShows(subShows);
    const counts: Record<string, number> = {};
    for (const s of subShows) {
      const { data: count } = await supabase.rpc("get_order_count" as any, { _show_id: s.id });
      counts[s.id] = (count as number) || 0;
    }
    setSubscriberCounts(counts);
  };

  const fetchBalance = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      const { data } = await supabase.from("coin_balances").select("balance").eq("user_id", session.user.id).maybeSingle();
      setCoinBalance(data?.balance || 0);
    }
  };

  useEffect(() => {
    fetchData();
    fetchBalance();
    supabase.from("site_settings").select("value").eq("key", "membership_coin_only").maybeSingle()
      .then(({ data }) => { if (data?.value === "true") setCoinOnly(true); });

    const showChannel = supabase.channel("membership-shows")
      .on("postgres_changes", { event: "*", schema: "public", table: "shows" }, () => fetchData())
      .subscribe();

    return () => { supabase.removeChannel(showChannel); };
  }, []);

  const handleBuy = async (show: Show) => {
    setSelectedShow(show);
    setPurchaseMethod(null);
    setProofUrl("");
    setPhone("");
    setEmail("");
    setResultGroupLink("");
    await fetchBalance();
    if (coinOnly && show.coin_price > 0) {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) { toast({ title: "Silakan login terlebih dahulu", variant: "destructive" }); return; }
      const { data: bal } = await supabase.from("coin_balances").select("balance").eq("user_id", session.user.id).maybeSingle();
      const currentBalance = bal?.balance || 0;
      setCoinBalance(currentBalance);
      setPurchaseMethod("coin");
      setPurchaseStep(currentBalance < show.coin_price ? "coin_insufficient" : "coin_info");
      return;
    }
    setPurchaseStep("choose");
  };

  const handleChooseQris = () => { setPurchaseMethod("qris"); setPurchaseStep("qris"); };

  const handleChooseCoin = () => {
    if (coinBalance < (selectedShow?.coin_price || 0)) { setPurchaseMethod("coin"); setPurchaseStep("coin_insufficient"); return; }
    setPurchaseMethod("coin"); setPurchaseStep("coin_info");
  };

  const handleUploadProof = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedShow) return;
    if (file.size > 5 * 1024 * 1024) { toast({ title: "File terlalu besar (max 5MB)", variant: "destructive" }); return; }
    setUploadingProof(true);
    const filePath = `membership/${selectedShow.id}/${Date.now()}_${file.name}`;
    const { error } = await supabase.storage.from("coin-proofs").upload(filePath, file);
    if (error) { toast({ title: "Upload gagal", variant: "destructive" }); setUploadingProof(false); return; }
    const { data: urlData } = supabase.storage.from("coin-proofs").getPublicUrl(filePath);
    setProofUrl(urlData.publicUrl);
    setPurchaseStep("info");
    setUploadingProof(false);
  };

  const handleSubmitSubscription = async () => {
    if (!selectedShow || !proofUrl) return;
    setSubmitting(true);
    await supabase.from("subscription_orders").insert({
      show_id: selectedShow.id,
      phone, email,
      payment_proof_url: proofUrl,
      payment_method: "qris",
    } as any);
    setResultGroupLink(selectedShow.group_link || "");
    setPurchaseStep("done");
    setSubmitting(false);
  };

  const handleCoinPurchase = async () => {
    if (!selectedShow || !phone || !email) return;
    setSubmitting(true);
    const { data, error } = await supabase.rpc("redeem_coins_for_membership", {
      _show_id: selectedShow.id, _phone: phone, _email: email,
    } as any);
    setSubmitting(false);
    if (error || !(data as any)?.success) {
      toast({ title: (data as any)?.error || "Gagal menukar koin", variant: "destructive" }); return;
    }
    setResultGroupLink((data as any).group_link || selectedShow.group_link || "");
    setCoinBalance((data as any).remaining_balance || 0);
    setPurchaseStep("done");
  };

  return (
    <div className="min-h-screen bg-background">
      <SharedNavbar />
      <section className="px-4 pt-24 pb-8 text-center">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <Crown className="mx-auto mb-4 h-16 w-16 text-yellow-500" />
          <h1 className="text-3xl font-extrabold text-foreground md:text-5xl">
            Paket <span className="text-yellow-500">Membership</span>
          </h1>
          <p className="mx-auto mt-3 max-w-md text-muted-foreground">Bergabung dengan membership untuk akses eksklusif streaming</p>
        </motion.div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-16">
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {shows.map((show, i) => {
            const confirmed = subscriberCounts[show.id] || 0;
            const spotsLeft = show.max_subscribers > 0 ? show.max_subscribers - confirmed : null;
            const isFull = (spotsLeft !== null && spotsLeft <= 0) || show.is_order_closed;
            return (
              <motion.div key={show.id} initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.15 }}
                className={`group relative overflow-hidden rounded-2xl border-2 transition-all ${isFull ? "border-muted bg-muted/30 opacity-75" : "border-yellow-500/50 bg-gradient-to-b from-yellow-500/5 to-card hover:border-yellow-500 hover:shadow-2xl hover:shadow-yellow-500/10"}`}>
                <div className={`absolute right-3 top-3 z-10 flex items-center gap-1 rounded-full px-3 py-1 text-xs font-black ${isFull ? "bg-destructive text-destructive-foreground" : "bg-yellow-500 text-background"}`}>
                  <Sparkles className="h-3 w-3" />
                  {show.is_order_closed ? "PENDAFTARAN DITUTUP" : isFull ? "MEMBERSHIP PENUH" : "MEMBERSHIP"}
                </div>
                <div className="relative h-48 overflow-hidden">
                  {show.background_image_url ? (
                    <img src={show.background_image_url} alt={show.title} loading="lazy" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110" />
                  ) : (
                    <div className="flex h-full items-center justify-center bg-gradient-to-br from-yellow-500/20 to-primary/10"><Crown className="h-16 w-16 text-yellow-500/30" /></div>
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-card via-card/50 to-transparent" />
                  <div className="absolute bottom-3 left-4 right-4"><h3 className="text-xl font-bold text-foreground">{show.title}</h3></div>
                </div>
                <div className="space-y-3 p-4">
                  <div className="flex items-center justify-between">
                    <span className="rounded-full bg-yellow-500/15 px-3 py-1 text-sm font-bold text-yellow-500">{show.price}</span>
                    {spotsLeft !== null && <span className="text-xs text-muted-foreground">{confirmed}/{show.max_subscribers} terdaftar</span>}
                  </div>
                  {show.coin_price > 0 && (
                    <div className="flex items-center gap-1.5 rounded-lg bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary">
                      <Coins className="h-3.5 w-3.5" /> {coinOnly ? `${show.coin_price} Koin` : `atau ${show.coin_price} Koin`}
                    </div>
                  )}
                  {show.max_subscribers > 0 && (
                    <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
                      <div className={`h-full rounded-full transition-all duration-500 ${isFull ? "bg-destructive" : "bg-yellow-500"}`} style={{ width: `${Math.min((confirmed / show.max_subscribers) * 100, 100)}%` }} />
                    </div>
                  )}
                  {show.subscription_benefits && (
                    <div className="space-y-1.5">
                      {show.subscription_benefits.split("\n").filter(Boolean).map((b, idx) => (
                        <div key={idx} className="flex items-start gap-2 text-sm text-muted-foreground">
                          <CheckCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-yellow-500" /><span>{b}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {show.schedule_date && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Calendar className="h-4 w-4 text-yellow-500" />{show.schedule_date}</div>}
                  {show.lineup && <div className="flex items-start gap-2 text-sm text-muted-foreground"><Users className="mt-0.5 h-4 w-4 text-yellow-500" /><span className="line-clamp-2">{show.lineup}</span></div>}
                  <button onClick={() => handleBuy(show)} disabled={isFull}
                    className={`mt-2 flex w-full items-center justify-center gap-2 rounded-xl py-3 font-bold transition-all ${isFull ? "bg-muted text-muted-foreground cursor-not-allowed" : "bg-gradient-to-r from-yellow-500 to-yellow-600 text-background hover:shadow-lg hover:shadow-yellow-500/25"}`}>
                    <Star className="h-4 w-4" />
                    {show.is_order_closed ? "🔒 Pendaftaran Ditutup" : isFull ? "🔒 Membership Penuh" : "Berlangganan"}
                  </button>
                </div>
              </motion.div>
            );
          })}
        </div>
        {shows.length === 0 && (
          <div className="rounded-2xl border border-border bg-card p-12 text-center">
            <Crown className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
            <p className="text-lg font-medium text-foreground">Belum ada paket membership</p>
          </div>
        )}
      </section>

      {selectedShow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl border border-border bg-card p-6">
            <h3 className="mb-1 text-lg font-bold text-foreground">{selectedShow.title}</h3>
            <p className="mb-4 text-sm text-muted-foreground">{selectedShow.price}</p>

            {purchaseStep === "choose" && (
              <div className="space-y-3">
                <p className="text-sm font-medium text-foreground">Pilih metode pembayaran:</p>
                {!coinOnly && (
                  <button onClick={handleChooseQris} className="flex w-full items-center gap-3 rounded-xl border-2 border-border bg-background p-4 text-left transition hover:border-yellow-500 hover:bg-yellow-500/5">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-yellow-500/15"><Upload className="h-5 w-5 text-yellow-500" /></div>
                    <div><p className="text-sm font-bold text-foreground">Bayar via QRIS</p><p className="text-xs text-muted-foreground">Scan QRIS & upload bukti pembayaran</p></div>
                  </button>
                )}
                {selectedShow.coin_price > 0 && (
                  <button onClick={handleChooseCoin} className="flex w-full items-center gap-3 rounded-xl border-2 border-border bg-background p-4 text-left transition hover:border-primary hover:bg-primary/5">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/15"><Coins className="h-5 w-5 text-primary" /></div>
                    <div><p className="text-sm font-bold text-foreground">Bayar dengan Koin</p><p className="text-xs text-muted-foreground">{selectedShow.coin_price} koin · Saldo: {coinBalance} koin</p></div>
                  </button>
                )}
              </div>
            )}

            {purchaseStep === "qris" && (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">Scan QRIS untuk pembayaran:</p>
                {selectedShow.qris_image_url ? (
                  <img src={selectedShow.qris_image_url} alt="QRIS" className="mx-auto w-full max-w-sm rounded-lg" />
                ) : (
                  <div className="rounded-lg border border-border bg-secondary/50 p-8 text-center text-sm text-muted-foreground">QRIS belum tersedia</div>
                )}
                <p className="text-xs text-muted-foreground">Setelah transfer, upload bukti pembayaran</p>
                <label className={`flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-primary/30 py-4 text-sm font-medium text-primary transition hover:bg-primary/5 ${uploadingProof ? "opacity-50" : ""}`}>
                  <Upload className="h-4 w-4" /> {uploadingProof ? "Mengupload..." : "Upload Bukti Pembayaran"}
                  <input type="file" accept="image/*" className="hidden" onChange={handleUploadProof} disabled={uploadingProof} />
                </label>
              </div>
            )}

            {purchaseStep === "info" && (
              <div className="space-y-4">
                <div className="rounded-lg bg-[hsl(var(--success))]/10 p-3 text-sm text-[hsl(var(--success))]">✅ Bukti pembayaran berhasil diupload</div>
                <div><label className="mb-1 block text-xs font-medium text-muted-foreground">No. WhatsApp</label><Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="08xxxxxxxx" /></div>
                <div><label className="mb-1 block text-xs font-medium text-muted-foreground">Email</label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@contoh.com" /></div>
                <Button onClick={handleSubmitSubscription} disabled={submitting || !phone} className="w-full">{submitting ? "Mengirim..." : "Kirim Pendaftaran"}</Button>
              </div>
            )}

            {purchaseStep === "coin_info" && (
              <div className="space-y-4">
                <div className="rounded-lg bg-primary/10 p-3 text-sm text-primary">💰 Saldo koin: {coinBalance} · Harga: {selectedShow.coin_price} koin</div>
                <div><label className="mb-1 block text-xs font-medium text-muted-foreground">No. WhatsApp</label><Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="08xxxxxxxx" /></div>
                <div><label className="mb-1 block text-xs font-medium text-muted-foreground">Email</label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@contoh.com" /></div>
                <Button onClick={handleCoinPurchase} disabled={submitting || !phone || !email} className="w-full">{submitting ? "Memproses..." : `Bayar ${selectedShow.coin_price} Koin`}</Button>
              </div>
            )}

            {purchaseStep === "coin_insufficient" && (
              <div className="space-y-4 text-center">
                <div className="rounded-lg bg-destructive/10 p-4 text-sm text-destructive">❌ Koin tidak cukup. Saldo: {coinBalance}, Butuh: {selectedShow.coin_price}</div>
                <a href="/coins" className="inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 font-semibold text-primary-foreground hover:bg-primary/90"><Coins className="h-4 w-4" /> Beli Koin</a>
              </div>
            )}

            {purchaseStep === "done" && (
              <div className="space-y-4 text-center">
                <div className="text-4xl">🎉</div>
                <h4 className="text-lg font-bold text-foreground">Pendaftaran Berhasil!</h4>
                <p className="text-sm text-muted-foreground">{purchaseMethod === "coin" ? "Koin berhasil ditukar" : "Admin akan memverifikasi pembayaran Anda"}</p>
                {resultGroupLink && (
                  <a href={resultGroupLink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-xl bg-[hsl(var(--success))] px-6 py-3 font-semibold text-primary-foreground hover:opacity-90">
                    📱 Gabung Grup
                  </a>
                )}
              </div>
            )}

            <button onClick={() => setSelectedShow(null)} className="mt-4 w-full rounded-xl border border-border py-2.5 text-sm font-medium text-muted-foreground hover:bg-secondary transition">Tutup</button>
          </motion.div>
        </div>
      )}
    </div>
  );
};

export default MembershipPage;
