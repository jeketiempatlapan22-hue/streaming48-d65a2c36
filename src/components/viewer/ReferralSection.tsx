import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Copy, Gift, Users, Share2 } from "lucide-react";
import { motion } from "framer-motion";

const ReferralSection = () => {
  const [referralCode, setReferralCode] = useState("");
  const [uses, setUses] = useState(0);
  const [rewardCoins, setRewardCoins] = useState(5);
  const [claimCode, setClaimCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    const fetch = async () => {
      const { data } = await supabase.rpc("get_or_create_referral_code");
      const result = data as any;
      if (result) {
        setReferralCode(result.code);
        setUses(result.uses);
        setRewardCoins(result.reward_coins);
      }
      setLoading(false);
    };
    fetch();
  }, []);

  const handleCopy = () => {
    navigator.clipboard.writeText(referralCode);
    toast({ title: "Kode disalin!" });
  };

  const handleShare = () => {
    const text = `🎬 Yuk nonton streaming di RealTime48! Pakai kode referral ${referralCode} dan dapatkan ${rewardCoins} koin gratis! ${window.location.origin}/auth?ref=${referralCode}`;
    if (navigator.share) {
      navigator.share({ text });
    } else {
      navigator.clipboard.writeText(text);
      toast({ title: "Link referral disalin!" });
    }
  };

  const handleClaim = async () => {
    if (!claimCode.trim()) return;
    setClaiming(true);
    const { data, error } = await supabase.rpc("claim_referral", { _code: claimCode.trim().toUpperCase() });
    setClaiming(false);
    const result = data as any;
    if (error || !result?.success) {
      toast({ title: "Gagal", description: result?.error || "Kode tidak valid", variant: "destructive" });
    } else {
      toast({ title: `🎉 Berhasil! +${result.reward} koin` });
      setClaimCode("");
    }
  };

  if (loading) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.3 }}
      className="rounded-xl border border-border bg-card p-5"
    >
      <div className="mb-4 flex items-center gap-2">
        <Gift className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold text-foreground">Referral Program</h3>
      </div>

      <div className="rounded-lg bg-primary/5 border border-primary/20 p-3 mb-3">
        <p className="text-[10px] text-muted-foreground mb-1">Kode Referral Kamu</p>
        <div className="flex items-center gap-2">
          <span className="font-mono text-lg font-bold text-primary flex-1">{referralCode}</span>
          <button onClick={handleCopy} className="rounded-lg bg-secondary p-2 hover:bg-secondary/80 transition-colors">
            <Copy className="h-3.5 w-3.5 text-foreground" />
          </button>
          <button onClick={handleShare} className="rounded-lg bg-primary p-2 hover:bg-primary/90 transition-colors">
            <Share2 className="h-3.5 w-3.5 text-primary-foreground" />
          </button>
        </div>
        <div className="mt-2 flex items-center gap-3 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1"><Users className="h-3 w-3" /> {uses} pengguna</span>
          <span>· {rewardCoins} koin per referral</span>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-[10px] text-muted-foreground">Punya kode referral teman?</p>
        <div className="flex gap-2">
          <Input
            value={claimCode}
            onChange={(e) => setClaimCode(e.target.value.toUpperCase())}
            placeholder="Masukkan kode"
            className="text-sm font-mono uppercase"
            maxLength={10}
          />
          <Button size="sm" onClick={handleClaim} disabled={claiming || !claimCode.trim()}>
            {claiming ? "..." : "Klaim"}
          </Button>
        </div>
      </div>
    </motion.div>
  );
};

export default ReferralSection;
