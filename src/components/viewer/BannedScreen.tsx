import { Shield, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";

interface BannedScreenProps {
  reason?: string;
  onSignOut: () => void;
}

const BannedScreen = ({ reason, onSignOut }: BannedScreenProps) => (
  <div className="flex min-h-screen items-center justify-center bg-background px-4">
    <div className="w-full max-w-sm text-center space-y-4">
      <Shield className="mx-auto h-14 w-14 text-destructive" />
      <h1 className="text-xl font-bold text-foreground">Akun Diblokir</h1>
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 space-y-2">
        <p className="text-sm text-foreground font-medium">Akun kamu telah diblokir oleh admin.</p>
        {reason && <p className="text-xs text-muted-foreground">Alasan: {reason}</p>}
      </div>
      <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
        <MessageSquare className="h-3.5 w-3.5" />
        <span>Hubungi admin jika merasa ini kesalahan.</span>
      </div>
      <Button variant="outline" onClick={onSignOut} className="w-full">Keluar</Button>
    </div>
  </div>
);

export default BannedScreen;
