import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { User, Shield } from "lucide-react";

interface UsernameModalProps {
  onSubmit: (name: string) => void;
}

const UsernameModal = ({ onSubmit }: UsernameModalProps) => {
  const [name, setName] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim()) onSubmit(name.trim());
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
      <form onSubmit={handleSubmit} className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 space-y-4">
        <div className="text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
            <Shield className="h-7 w-7 text-primary" />
          </div>
          <h2 className="text-lg font-bold text-foreground">Selamat Datang!</h2>
          <p className="mt-1 text-xs text-muted-foreground">Masukkan username untuk live chat</p>
        </div>
        <div className="relative">
          <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Username kamu"
            maxLength={30}
            className="bg-background pl-10"
            autoFocus
          />
        </div>
        <Button type="submit" className="w-full" disabled={!name.trim()}>
          Mulai Nonton
        </Button>
      </form>
    </div>
  );
};

export default UsernameModal;
