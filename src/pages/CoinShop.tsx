import { useState, useEffect, useRef } from "react";
import MobileBottomNav from "@/components/viewer/MobileBottomNav";
import { useActiveLiveAccess } from "@/hooks/useActiveLiveAccess";
import { useNavigate } from "react-router-dom";
import { compressImage } from "@/lib/imageCompressor";
import logo from "@/assets/logo.png";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { withTimeout, cachedQuery, fetchCachedEndpoint } from "@/lib/queryCache";
import { Coins, Upload, CheckCircle, ArrowLeft, Ticket, Copy, Sparkles, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { motion } from "framer-motion";
import SharedNavbar from "@/components/SharedNavbar";
import BannedScreen from "@/components/viewer/BannedScreen";
import { useProtectedAuth } from "@/hooks/useProtectedAuth";

interface CoinPackage { id: string; name: string; coin_amount: number; price: string; qris_image_url: string | null; }

const CoinShop = () => {
  const { isBanned, banReason, signOut } = useProtectedAuth();
  const { isLive: liveActive, liveAccessToken } = useActiveLiveAccess();
  const [user, setUser] = useState<any>(null);
  const [username, setUsername] = useState("");
  const [balance, setBalance] = useState(0);
  const [packages, setPackages] = useState<CoinPackage[]>([]);
  const [shows, setShows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"buy" | "redeem" | "history">("buy");
  const [selectedPkg, setSelectedPkg] = useState<CoinPackage | null>(null);
  const [purchaseStep, setPurchaseStep] = useState<"phone" | "qris" | "upload" | "done">("phone");
  const [buyerPhone, setBuyerPhone] = useState("");
  const [uploading, setUploading] = useState(false);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const [redeemingShow, setRedeemingShow] = useState<string | null>(null);
  const [redeemResult, setRedeemResult] = useState<{ token_code: string; remaining_balance: number; access_password?: string } | null>(null);
  const [redeemPhoneDialog, setRedeemPhoneDialog] = useState<string | null>(null);
  const [redeemPhone, setRedeemPhone] = useState("");
  const [transactions, setTransactions] = useState<any[]>([]);
  const [useDynamicQris, setUseDynamicQris] = useState(false);
  const [dynamicQrString, setDynamicQrString] = useState("");
  const [dynamicOrderId, setDynamicOrderId] = useState("");
  const [dynamicLoading, setDynamicLoading] = useState(false);
  const [dynamicPaid, setDynamicPaid] = useState(false);
  const [waFallbackEnabled, setWaFallbackEnabled] = useState(false);
  const [adminWaNumber, setAdminWaNumber] = useState("");
  const [QRCodeSVG, setQRCodeSVG] = useState<any>(null);
  const navigate = useNavigate();
  const { toast } = useToast();

  // Load QR component
  useEffect(() => {
    import("qrcode.react").then(mod => setQRCodeSVG(() => mod.QRCodeSVG));
  }, []);

  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      try {
        const { data: { session } } = await withTimeout(
          supabase.auth.getSession(),
          10_000,
          "Session timeout"
        );

        if (!session?.user) { navigate("/auth"); return; }
        if (cancelled) return;

        setUser(session.user);

        const profileRes = await withTimeout(
          (async () => await supabase.from("profiles").select("username").eq("id", session.user.id).maybeSingle())(),
          8_000,
          "Profile timeout"
        ).catch(() => null);

        if (cancelled) return;
        setUsername(profileRes?.data?.username || "User");

        // Check site settings: dynamic QRIS + WA fallback + admin number
        const { data: settingsRows } = await supabase
          .from("site_settings")
          .select("key,value")
          .in("key", ["use_dynamic_qris", "wa_fallback_enabled", "whatsapp_number"]);
        if (settingsRows) {
          for (const r of settingsRows as any[]) {
            if (r.key === "use_dynamic_qris" && r.value === "true") setUseDynamicQris(true);
            if (r.key === "wa_fallback_enabled" && r.value === "true") setWaFallbackEnabled(true);
            if (r.key === "whatsapp_number") setAdminWaNumber(r.value || "");
          }
        }

        await fetchData(session.user.id);
      } catch {
        if (!cancelled) {
          setLoading(false);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    init();
    return () => { cancelled = true; };
  }, [navigate]);

  useEffect(() => {
    if (!user) return;
    const balCh = supabase.channel(`coinshop-bal-${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "coin_balances", filter: `user_id=eq.${user.id}` }, (p: any) => {
        if (p.new?.balance !== undefined) {
          const oldBal = p.old?.balance ?? 0;
          setBalance(p.new.balance);
          if (p.new.balance > oldBal) toast({ title: `💰 +${p.new.balance - oldBal} koin ditambahkan!` });
        }
      }).subscribe();
    const txCh = supabase.channel(`coinshop-tx-${user.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "coin_transactions", filter: `user_id=eq.${user.id}` }, () => {
        fetchData(user.id);
      }).subscribe();
    return () => { supabase.removeChannel(balCh); supabase.removeChannel(txCh); };
  }, [user]);

  // Poll dynamic QRIS payment status for coin orders
  useEffect(() => {
    if (!dynamicOrderId || dynamicPaid) return;
    const interval = setInterval(async () => {
      const { data } = await supabase
        .from("coin_orders")
        .select("status")
        .eq("id", dynamicOrderId)
        .maybeSingle();
      if (data && data.status === "confirmed") {
        setDynamicPaid(true);
        clearInterval(interval);
        toast({ title: "✅ Pembayaran koin berhasil dikonfirmasi!" });
        setTimeout(() => {
          setPurchaseStep("done");
        }, 1500);
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [dynamicOrderId, dynamicPaid]);

  const fetchData = async (userId: string) => {
    const cachedShows = fetchCachedEndpoint("shows").catch(() => null);

    const [balRes, pkgRes, txRes, showsRes] = await Promise.allSettled([
      withTimeout((async () => await supabase.from("coin_balances").select("balance").eq("user_id", userId).maybeSingle())(), 8_000, "Balance timeout"),
      withTimeout((async () => await supabase.from("coin_packages").select("*").eq("is_active", true).order("sort_order"))(), 8_000, "Packages timeout"),
      withTimeout((async () => await supabase.from("coin_transactions").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(30))(), 8_000, "Transactions timeout"),
      cachedShows,
    ]);

    setBalance(balRes.status === "fulfilled" ? (balRes.value.data?.balance || 0) : 0);
    setPackages(pkgRes.status === "fulfilled" ? (pkgRes.value.data || []) : []);
    setTransactions(txRes.status === "fulfilled" ? (txRes.value.data || []) : []);

    let showsData: any[] | null = null;
    if (showsRes.status === "fulfilled" && Array.isArray(showsRes.value)) {
      showsData = showsRes.value;
    } else {
      const { data } = await supabase.rpc("get_public_shows");
      showsData = data as any[] | null;
    }
    setShows((showsData || []).filter((s: any) => s.coin_price > 0 && s.is_active));
  };

  const handleBuyPackage = (pkg: CoinPackage) => {
    setSelectedPkg(pkg);
    setPurchaseStep("phone");
    setBuyerPhone("");
    setDynamicQrString("");
    setDynamicOrderId("");
    setDynamicPaid(false);
    setDynamicLoading(false);
  };

  const handleStartDynamicQris = async () => {
    if (!selectedPkg || !user) return;
    setDynamicLoading(true);
    setPurchaseStep("qris");

    try {
      const priceNum = parseInt(selectedPkg.price.replace(/[^\d]/g, "")) || 0;
      if (priceNum <= 0) {
        toast({ title: "Harga tidak valid", variant: "destructive" });
        setDynamicLoading(false);
        return;
      }

      const { data, error } = await supabase.functions.invoke("create-dynamic-qris", {
        body: {
          order_type: "coin",
          amount: priceNum,
          phone: buyerPhone.replace(/^0/, "62").replace(/[^0-9]/g, ""),
          coin_amount: selectedPkg.coin_amount,
          package_id: selectedPkg.id,
        },
      });

      if (error || !data?.success) {
        toast({ title: data?.error || "Gagal membuat QRIS", variant: "destructive" });
        setPurchaseStep("phone");
        setDynamicLoading(false);
        return;
      }

      setDynamicQrString(data.qr_string);
      setDynamicOrderId(data.order_id);
    } catch (err: any) {
      toast({ title: "Gagal membuat QRIS", description: err?.message, variant: "destructive" });
      setPurchaseStep("phone");
    }
    setDynamicLoading(false);
  };

  const handleUploadProof = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawFile = e.target.files?.[0];
    if (!rawFile || !selectedPkg || !user) return;
    if (rawFile.size > 5 * 1024 * 1024) { toast({ title: "Maksimal 5 MB", variant: "destructive" }); return; }
    setUploading(true);
    const file = await compressImage(rawFile);
    const ext = file.name.split(".").pop();
    const fileName = `${user.id}/${crypto.randomUUID()}.${ext}`;
    const { error: uploadErr } = await supabase.storage.from("coin-proofs").upload(fileName, file);
    let proofUrl: string | null = null;
    if (!uploadErr) {
      const { data: urlData } = await supabase.storage.from("coin-proofs").createSignedUrl(fileName, 86400);
      proofUrl = urlData?.signedUrl || null;
    }
    const { data: orderData, error } = await supabase.from("coin_orders").insert({
      user_id: user.id, package_id: selectedPkg.id, coin_amount: selectedPkg.coin_amount,
      payment_proof_url: proofUrl, phone: buyerPhone.replace(/^0/, "62").replace(/[^0-9]/g, ""),
      price: selectedPkg.price, status: "pending",
    }).select("id").single();
    if (error) {
      toast({ title: "Gagal mengirim pesanan", variant: "destructive" });
    } else {
      setPurchaseStep("done");
      toast({ title: "Order terkirim!", description: "Menunggu konfirmasi admin." });
      if (orderData?.id) {
        supabase.functions.invoke("notify-coin-order", {
          body: { order_id: orderData.id, username, package_name: selectedPkg.name, coin_amount: selectedPkg.coin_amount, price: selectedPkg.price, proof_file_path: fileName },
        }).catch(() => {});
      }
    }
    setUploading(false);
  };

  const startRedeem = (showId: string) => {
    setRedeemPhoneDialog(showId);
    setRedeemPhone("");
  };

  const handleRedeem = async (showId: string) => {
    if (!redeemPhone.trim() || redeemPhone.replace(/[\s-]/g, "").length < 10) {
      toast({ title: "Masukkan nomor WhatsApp yang valid", variant: "destructive" }); return;
    }
    setRedeemPhoneDialog(null);
    setRedeemingShow(showId);
    const { data, error } = await supabase.rpc("redeem_coins_for_token", { _show_id: showId });
    const result = data as any;
    if (error || !result?.success) {
      toast({ title: "Gagal menukar koin", description: result?.error || error?.message, variant: "destructive" });
      setRedeemingShow(null); return;
    }
    setRedeemResult({ token_code: result.token_code, remaining_balance: result.remaining_balance, access_password: result.access_password });
    setBalance(result.remaining_balance);
    setRedeemingShow(null);
    if (user) {
      const stored = JSON.parse(localStorage.getItem(`redeemed_tokens_${user.id}`) || "{}");
      stored[showId] = result.token_code;
      localStorage.setItem(`redeemed_tokens_${user.id}`, JSON.stringify(stored));

      // Find show title for notification
      const targetShow = shows.find((s: any) => s.id === showId);
      supabase.functions.invoke("notify-coin-show-purchase", {
        body: {
          user_id: user.id,
          show_id: showId,
          token_code: result.token_code,
          access_password: result.access_password,
          show_title: targetShow?.title || "",
          purchase_type: targetShow?.is_bundle ? "bundle" : targetShow?.is_replay ? "replay" : (targetShow?.is_subscription ? "membership" : "regular"),
          phone: redeemPhone.replace(/[\s-]/g, ""),
        },
      }).then(res => { if (res.error) console.warn("Notify WA error:", res.error); }).catch(e => console.warn("Notify WA failed:", e));
    }
  };

  const copyToken = (code: string) => {
    navigator.clipboard.writeText(`https://realtime48stream.my.id/live?t=${code}`);
    toast({ title: "Link disalin!" });
  };

  const openWaFallback = (info: { type: "coin_package" | "show_redeem"; details: string }) => {
    if (!adminWaNumber) {
      toast({ title: "Nomor admin belum disetel", variant: "destructive" });
      return;
    }
    const cleanNum = adminWaNumber.replace(/[^0-9]/g, "");
    const headline = info.type === "coin_package"
      ? "Konfirmasi Pembelian Koin"
      : "Konfirmasi Pembelian Show";
    const text =
      `Halo Admin RealTime48 👋\n\n` +
      `Saya ingin konfirmasi *${headline}* berikut (cadangan jika notifikasi WA otomatis tidak terkirim):\n\n` +
      `${info.details}\n\n` +
      `Username: ${username || "-"}\n` +
      `Mohon dicek & dibantu prosesnya. Terima kasih 🙏`;
    const url = `https://wa.me/${cleanNum}?text=${encodeURIComponent(text)}`;
    window.open(url, "_blank");
  };

  if (loading) return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <img src={logo} alt="Loading" className="h-12 w-12 animate-pulse rounded-full" />
      <MobileBottomNav loading />
    </div>
  );
  if (isBanned) return <BannedScreen reason={banReason} onSignOut={signOut} />;

  return (
    <div className="min-h-screen bg-background">
      <SharedNavbar />
      <div className="mx-auto max-w-2xl px-4 py-6 pt-20">
        {/* Tabs */}
        <div className="mb-6 flex gap-2">
          {([
            { key: "buy" as const, label: "Beli Koin", icon: Coins },
            { key: "redeem" as const, label: "Tukar Koin", icon: Ticket },
            { key: "history" as const, label: "Riwayat", icon: Sparkles },
          ]).map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)} className={`flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-medium transition-all ${tab === t.key ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground hover:bg-secondary/80"}`}>
              <t.icon className="h-3.5 w-3.5" /> {t.label}
            </button>
          ))}
        </div>

        {tab === "buy" && (
          <div className="space-y-3">
            <h2 className="text-lg font-bold text-foreground">🪙 Pilih Paket Koin</h2>
            {packages.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">Belum ada paket tersedia</p>}
            <div className="grid gap-3 sm:grid-cols-2">
              {packages.map((pkg) => (
                <motion.div key={pkg.id} whileHover={{ scale: 1.02 }} className="rounded-xl border border-border bg-card p-4 cursor-pointer active:scale-[0.97] transition-transform" onClick={() => handleBuyPackage(pkg)}>
                  <div className="mb-3 flex items-center gap-2"><Coins className="h-5 w-5 text-[hsl(var(--warning))]" /><span className="text-lg font-bold text-foreground">{pkg.coin_amount} Koin</span></div>
                  <p className="mb-1 text-sm font-semibold text-primary">{pkg.price}</p>
                  <p className="text-xs text-muted-foreground">{pkg.name}</p>
                </motion.div>
              ))}
            </div>
          </div>
        )}

        {tab === "redeem" && (
          <div className="space-y-3">
            <h2 className="text-lg font-bold text-foreground">🎟️ Tukar Koin untuk Akses Show</h2>
            {shows.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">Tidak ada show tersedia</p>}
            {shows.map((show: any) => (
              <div key={show.id} className="flex items-center justify-between rounded-xl border border-border bg-card p-4">
                <div>
                  <p className="font-semibold text-foreground">{show.title}</p>
                  <p className="text-xs text-muted-foreground">{show.schedule_date} · {show.schedule_time}</p>
                  <div className="mt-1 flex items-center gap-1 text-sm font-bold text-[hsl(var(--warning))]"><Coins className="h-3.5 w-3.5" /> {show.coin_price} Koin</div>
                </div>
                <Button size="sm" disabled={balance < show.coin_price || redeemingShow === show.id} onClick={() => startRedeem(show.id)}>
                  {redeemingShow === show.id ? "..." : balance < show.coin_price ? "Kurang" : "Tukar"}
                </Button>
              </div>
            ))}
          </div>
        )}

        {tab === "history" && (
          <div className="space-y-3">
            <h2 className="text-lg font-bold text-foreground">📜 Riwayat Transaksi</h2>
            {transactions.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">Belum ada transaksi</p>}
            {transactions.map((tx: any) => (
              <div key={tx.id} className="flex items-center justify-between rounded-xl border border-border bg-card p-3">
                <div><p className="text-sm font-medium text-foreground">{tx.description}</p><p className="text-[10px] text-muted-foreground">{new Date(tx.created_at).toLocaleString("id-ID")}</p></div>
                <span className={`text-sm font-bold ${tx.amount > 0 ? "text-[hsl(var(--success))]" : "text-destructive"}`}>{tx.amount > 0 ? "+" : ""}{tx.amount}</span>
              </div>
            ))}
          </div>
        )}

        <button onClick={() => navigate("/")} className="mt-8 flex w-full items-center justify-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Kembali ke Beranda
        </button>
      </div>

      {/* Purchase Dialog */}
      <Dialog open={!!selectedPkg && purchaseStep !== "done"} onOpenChange={() => setSelectedPkg(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Beli {selectedPkg?.coin_amount} Koin</DialogTitle><DialogDescription>{selectedPkg?.price}</DialogDescription></DialogHeader>

          {purchaseStep === "phone" && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Masukkan nomor WhatsApp untuk notifikasi status order</p>
              <Input type="tel" placeholder="08xxxxxxxxxx" value={buyerPhone} onChange={(e) => setBuyerPhone(e.target.value)} />
              <Button
                className="w-full"
                disabled={!buyerPhone.trim() || buyerPhone.trim().length < 10}
                onClick={() => {
                  if (useDynamicQris) {
                    handleStartDynamicQris();
                  } else {
                    setPurchaseStep("qris");
                  }
                }}
              >
                Lanjut →
              </Button>
            </div>
          )}

          {purchaseStep === "qris" && useDynamicQris && (
            <div className="space-y-3">
              {dynamicLoading ? (
                <div className="flex flex-col items-center gap-3 py-8">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  <p className="text-sm text-muted-foreground">Membuat QRIS...</p>
                </div>
              ) : dynamicPaid ? (
                <div className="space-y-3 text-center py-4">
                  <CheckCircle className="mx-auto h-12 w-12 text-[hsl(var(--success))]" />
                  <p className="font-semibold text-foreground">Pembayaran Berhasil!</p>
                  <p className="text-sm text-muted-foreground">Koin sedang ditambahkan ke akun Anda...</p>
                </div>
              ) : dynamicQrString && QRCodeSVG ? (
                <>
                  <p className="text-sm text-muted-foreground">Scan QRIS di bawah untuk membayar:</p>
                  <div className="flex justify-center rounded-lg border border-border bg-white p-4">
                    <QRCodeSVG value={dynamicQrString} size={240} level="M" />
                  </div>
                  <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Menunggu pembayaran...
                  </div>
                </>
              ) : (
                <div className="rounded-lg border border-border bg-secondary/50 p-8 text-center text-sm text-muted-foreground">
                  QRIS gagal dimuat. Coba lagi.
                </div>
              )}
            </div>
          )}

          {purchaseStep === "qris" && !useDynamicQris && (
            <div className="space-y-3">
              {selectedPkg?.qris_image_url ? (
                <img src={selectedPkg.qris_image_url} alt="QRIS" className="mx-auto w-64 rounded-lg" />
              ) : (
                <div className="mx-auto flex h-48 w-48 items-center justify-center rounded-xl border-2 border-dashed border-border"><p className="text-sm text-muted-foreground text-center px-4">QRIS belum tersedia</p></div>
              )}
              <p className="text-center text-sm text-foreground">Scan QRIS untuk pembayaran</p>
              <Button className="w-full" onClick={() => setPurchaseStep("upload")} disabled={!selectedPkg?.qris_image_url}>✅ Sudah Bayar → Upload Bukti</Button>
            </div>
          )}

          {purchaseStep === "upload" && (
            <div className="space-y-3">
              <input ref={galleryInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e: any) => { handleUploadProof(e); if (galleryInputRef.current) galleryInputRef.current.value = ""; }} />
              <button type="button" className="flex w-full cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-border p-8 hover:border-primary transition-colors" onClick={() => galleryInputRef.current?.click()} disabled={uploading}>
                <Upload className={`h-8 w-8 ${uploading ? "animate-pulse text-primary" : "text-muted-foreground"}`} />
                <span className="text-sm text-muted-foreground">{uploading ? "Mengupload..." : "Upload Bukti Pembayaran"}</span>
              </button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Done Dialog */}
      <Dialog open={purchaseStep === "done" && !!selectedPkg} onOpenChange={() => { setSelectedPkg(null); setPurchaseStep("phone"); }}>
        <DialogContent className="max-w-sm">
          <div className="space-y-3 text-center py-4">
            <CheckCircle className="mx-auto h-12 w-12 text-[hsl(var(--success))]" />
            <p className="font-semibold text-foreground">
              {dynamicPaid ? "Pembayaran Berhasil!" : "Order Terkirim!"}
            </p>
            <p className="text-sm text-muted-foreground">
              {dynamicPaid
                ? "Koin telah ditambahkan ke akun Anda secara otomatis."
                : "Koin akan ditambahkan setelah admin konfirmasi."}
            </p>
            {waFallbackEnabled && adminWaNumber && dynamicPaid && selectedPkg && (
              <div className="rounded-lg border border-primary/30 bg-primary/10 p-3 text-left">
                <p className="text-xs text-foreground mb-2">
                  💬 <span className="font-semibold">Cadangan:</span> Jika notifikasi WA otomatis belum masuk, kirim konfirmasi manual ke admin.
                </p>
                <Button
                  variant="outline"
                  className="w-full border-primary/50 text-primary hover:bg-primary/10"
                  onClick={() => openWaFallback({
                    type: "coin_package",
                    details: `Paket: ${selectedPkg.name}\nJumlah Koin: ${selectedPkg.coin_amount}\nHarga: ${selectedPkg.price}\nNomor HP: ${buyerPhone}\nStatus: Sudah dibayar (Pak Kasir terkonfirmasi)`,
                  })}
                >
                  📱 Kirim Konfirmasi via WA
                </Button>
              </div>
            )}
            <Button className="w-full" onClick={() => { setSelectedPkg(null); setPurchaseStep("phone"); setDynamicPaid(false); }}>Tutup</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Phone input before redeem */}
      <Dialog open={!!redeemPhoneDialog} onOpenChange={() => setRedeemPhoneDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>📱 Nomor WhatsApp</DialogTitle><DialogDescription>Masukkan nomor HP untuk menerima token & info show</DialogDescription></DialogHeader>
          <div className="space-y-3">
            <Input type="tel" placeholder="08xxxxxxxxxx" value={redeemPhone} onChange={(e) => setRedeemPhone(e.target.value)} />
            <Button className="w-full" disabled={!redeemPhone.trim() || redeemPhone.replace(/[\s-]/g, "").length < 10} onClick={() => handleRedeem(redeemPhoneDialog!)}>
              Lanjut Tukar Koin
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Redeem Result */}
      <Dialog open={!!redeemResult} onOpenChange={() => setRedeemResult(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>🎉 Token Berhasil!</DialogTitle><DialogDescription>Gunakan token ini untuk menonton</DialogDescription></DialogHeader>
          {redeemResult && (
            <div className="space-y-4 text-center">
              <div className="rounded-lg bg-secondary p-4"><p className="font-mono text-lg font-bold text-primary">{redeemResult.token_code}</p></div>
              {redeemResult.access_password && (
                <div className="rounded-lg border border-[hsl(var(--warning))]/30 bg-[hsl(var(--warning))]/10 p-3">
                  <p className="text-xs font-medium text-muted-foreground mb-1">🔐 Sandi Replay</p>
                  <p className="font-mono text-lg font-bold text-[hsl(var(--warning))]">{redeemResult.access_password}</p>
                </div>
              )}
              <div className="flex gap-2">
                <Button className="flex-1 gap-2" variant="outline" onClick={() => copyToken(redeemResult.token_code)}><Copy className="h-4 w-4" /> Salin Link</Button>
                <Button className="flex-1 gap-2" onClick={() => navigate(`/live?t=${redeemResult.token_code}`)}><Sparkles className="h-4 w-4" /> Tonton</Button>
              </div>
              {waFallbackEnabled && adminWaNumber && (
                <Button
                  variant="outline"
                  className="w-full gap-2 border-primary/50 text-primary hover:bg-primary/10"
                  onClick={() => openWaFallback({
                    type: "show_redeem",
                    details: `Token: ${redeemResult.token_code}${redeemResult.access_password ? `\nSandi Replay: ${redeemResult.access_password}` : ""}\nNomor HP: ${redeemPhone}\nStatus: Sudah ditukar dengan koin`,
                  })}
                >
                  📱 Konfirmasi via WA (cadangan)
                </Button>
              )}
              <p className="text-xs text-muted-foreground">Sisa saldo: <span className="font-bold text-[hsl(var(--warning))]">{redeemResult.remaining_balance} koin</span></p>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <MobileBottomNav />
    </div>
  );
};

export default CoinShop;
