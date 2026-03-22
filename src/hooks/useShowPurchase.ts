import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { Show } from "@/types/show";

export function useShowPurchase() {
  const [selectedShow, setSelectedShow] = useState<Show | null>(null);
  const [purchaseStep, setPurchaseStep] = useState<"qris" | "upload" | "info" | "done">("info");
  const [uploadingProof, setUploadingProof] = useState(false);
  const [proofFilePath, setProofFilePath] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");

  const [coinUser, setCoinUser] = useState<any>(null);
  const [coinBalance, setCoinBalance] = useState(0);
  const [coinUsername, setCoinUsername] = useState("");
  const [coinShowTarget, setCoinShowTarget] = useState<Show | null>(null);
  const [coinRedeeming, setCoinRedeeming] = useState(false);
  const [coinResult, setCoinResult] = useState<{
    token_code: string;
    remaining_balance: number;
    access_password?: string;
  } | null>(null);
  const [redeemedTokens, setRedeemedTokens] = useState<Record<string, string>>({});
  const [accessPasswords, setAccessPasswords] = useState<Record<string, string>>({});

  useEffect(() => {
    let balChannel: any;
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return;
      const user = session.user;
      setCoinUser(user);

      const [balRes, profileRes] = await Promise.all([
        supabase.from("coin_balances").select("balance").eq("user_id", user.id).maybeSingle(),
        supabase.from("profiles").select("username").eq("id", user.id).maybeSingle(),
      ]);
      setCoinBalance(balRes.data?.balance || 0);
      setCoinUsername(profileRes.data?.username || "");

      try {
        const stored = JSON.parse(localStorage.getItem(`redeemed_tokens_${user.id}`) || "{}");
        setRedeemedTokens(stored);
      } catch {}

      try {
        setAccessPasswords(JSON.parse(localStorage.getItem(`access_passwords_${user.id}`) || "{}"));
      } catch {}

      balChannel = supabase
        .channel(`purchase-balance-${user.id}`)
        .on("postgres_changes", {
          event: "*", schema: "public", table: "coin_balances",
          filter: `user_id=eq.${user.id}`,
        }, (payload: any) => {
          if (payload.new?.balance !== undefined) {
            const oldBal = payload.old?.balance ?? 0;
            const newBal = payload.new.balance;
            setCoinBalance(newBal);
            if (newBal > oldBal) {
              toast.success(`💰 +${newBal - oldBal} koin ditambahkan! Saldo: ${newBal}`);
            }
          }
        })
        .subscribe();
    };
    init();
    return () => { if (balChannel) supabase.removeChannel(balChannel); };
  }, []);

  const handleBuy = (show: Show) => {
    setSelectedShow(show);
    setPurchaseStep(show.is_subscription ? "qris" : "info");
    setProofFilePath(""); setPhone(""); setEmail("");
  };

  const handleCoinBuy = (show: Show) => {
    if (!coinUser) {
      toast.error("Login terlebih dahulu di /auth");
      return;
    }
    setCoinShowTarget(show);
    setCoinResult(null);
  };

  const handleCoinRedeem = async () => {
    if (!coinShowTarget) return;
    setCoinRedeeming(true);
    const { data, error } = await supabase.rpc("redeem_coins_for_token", { _show_id: coinShowTarget.id });
    setCoinRedeeming(false);
    const result = data as any;
    if (error || !result?.success) {
      toast.error(result?.error || error?.message || "Gagal menukar koin");
      return;
    }
    setCoinResult({
      token_code: result.token_code,
      remaining_balance: result.remaining_balance,
      access_password: result.access_password,
    });
    setCoinBalance(result.remaining_balance);

    if (coinUser) {
      const stored = JSON.parse(localStorage.getItem(`redeemed_tokens_${coinUser.id}`) || "{}");
      stored[coinShowTarget.id] = result.token_code;
      localStorage.setItem(`redeemed_tokens_${coinUser.id}`, JSON.stringify(stored));
      setRedeemedTokens(prev => ({ ...prev, [coinShowTarget.id]: result.token_code }));

      if (result.access_password) {
        const sa = JSON.parse(localStorage.getItem(`access_passwords_${coinUser.id}`) || "{}");
        sa[coinShowTarget.id] = result.access_password;
        localStorage.setItem(`access_passwords_${coinUser.id}`, JSON.stringify(sa));
        setAccessPasswords(prev => ({ ...prev, [coinShowTarget.id]: result.access_password }));
      }
    }
  };

  const handleUploadProof = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedShow) return;
    if (file.size > 5 * 1024 * 1024) { toast.error("File terlalu besar (max 5MB)"); return; }
    setUploadingProof(true);
    try {
      const ext = file.name.split(".").pop();
      const path = `${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
      const { error: upErr } = await supabase.storage.from("payment-proofs").upload(path, file);
      if (upErr) throw upErr;
      setProofFilePath(path);
      if (selectedShow.is_subscription) setPurchaseStep("info");
    } catch (err: any) {
      toast.error("Upload gagal: " + (err?.message || "Coba lagi"));
    }
    setUploadingProof(false);
  };

  const handleSubmitSubscription = async () => {
    if (!selectedShow || !proofFilePath) return;
    // Get signed URL for storing in DB
    const { data: urlData } = await supabase.storage.from("payment-proofs").createSignedUrl(proofFilePath, 86400);
    const signedUrl = urlData?.signedUrl || "";
    const { data: orderData } = await supabase.from("subscription_orders").insert({
      show_id: selectedShow.id, phone, email, payment_proof_url: signedUrl,
    }).select("id").single();
    setPurchaseStep("done");
    if (orderData?.id) {
      supabase.functions.invoke("notify-subscription-order", {
        body: { order_id: orderData.id, show_title: selectedShow.title, phone, email, proof_file_path: proofFilePath, proof_bucket: "payment-proofs", order_type: "membership" },
      }).catch(() => {});
    }
  };

  return {
    selectedShow, setSelectedShow, purchaseStep, setPurchaseStep,
    uploadingProof, proofFilePath, phone, setPhone, email, setEmail,
    handleBuy, handleUploadProof, handleSubmitSubscription,
    coinUser, coinBalance, coinUsername, coinShowTarget, setCoinShowTarget,
    coinRedeeming, coinResult, setCoinResult, handleCoinBuy, handleCoinRedeem,
    redeemedTokens, accessPasswords,
  };
}
