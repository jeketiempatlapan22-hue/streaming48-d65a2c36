import { useState } from "react";
import { KeyRound, X } from "lucide-react";

interface PasswordResetBannerProps {
  message?: string;
}

const PasswordResetBanner = ({ message }: PasswordResetBannerProps) => {
  const [visible, setVisible] = useState(true);

  if (!visible) return null;

  return (
    <div className="relative mx-auto mb-4 max-w-md animate-in fade-in slide-in-from-top-2 duration-300">
      <div className="flex items-start gap-3 rounded-lg border border-[hsl(var(--success))]/30 bg-[hsl(var(--success))]/10 p-3">
        <KeyRound className="mt-0.5 h-5 w-5 shrink-0 text-[hsl(var(--success))]" />
        <div className="flex-1">
          <p className="text-sm font-medium text-foreground">Password Berhasil Direset</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {message || "Password baru kamu sudah aktif."}
          </p>
        </div>
        <button onClick={() => setVisible(false)} className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground transition-colors">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
};

export default PasswordResetBanner;
