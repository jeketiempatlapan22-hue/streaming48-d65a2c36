import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

const AdminLogin = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      toast({ title: "Login gagal", description: error.message, variant: "destructive" });
      setLoading(false);
      return;
    }

    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) {
      toast({ title: "Error", description: "User not found", variant: "destructive" });
      setLoading(false);
      return;
    }

    const { data } = await supabase.rpc("has_role", { _user_id: session.user.id, _role: "admin" });
    if (!data) {
      await supabase.auth.signOut();
      toast({ title: "Akses ditolak", description: "Anda tidak memiliki akses admin.", variant: "destructive" });
      setLoading(false);
      return;
    }

    navigate("/admin/dashboard");
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-primary/15 border-2 border-primary/40 shadow-[0_0_20px_hsl(var(--primary)/0.3)] animate-float">
            <span className="text-2xl font-bold text-primary">RT</span>
          </div>
          <h1 className="text-2xl font-bold text-foreground">
            Real<span className="text-primary">Time48</span>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">Admin Panel</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4 rounded-xl border border-border bg-card p-6">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Email</label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@realtime48.com"
              required
              className="bg-background"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Password</label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              className="bg-background"
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Logging in..." : "Login"}
          </Button>
        </form>
      </div>
    </div>
  );
};

export default AdminLogin;
