import { useState } from "react";
import logo from "@/assets/logo.png";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { LogIn, Eye, EyeOff, Shield } from "lucide-react";
import { toast } from "sonner";
import { motion } from "framer-motion";

const Login = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) return;
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      toast.error("Login gagal: " + error.message);
    } else {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data } = await supabase.rpc("has_role", { _user_id: user.id, _role: "admin" });
        if (data) {
          toast.success("Berhasil login sebagai admin");
          navigate("/admin");
        } else {
          await supabase.auth.signOut();
          toast.error("Anda bukan admin");
        }
      }
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <motion.div
          className="text-center mb-8"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          <div className="w-16 h-16 rounded-full bg-primary/15 border-2 border-primary/50 flex items-center justify-center mx-auto mb-4 shadow-[0_0_16px_hsl(var(--primary)/0.3)]">
            <img src={logo} alt="RT48" className="w-7 h-7 rounded-full object-cover" />
          </div>
           <h1 className="text-2xl font-extrabold tracking-tight font-display" style={{ lineHeight: "1.1" }}>
             Real<span className="text-primary">Time48</span>
           </h1>
          <p className="text-muted-foreground text-sm mt-2">Login admin untuk mengelola streaming</p>
        </motion.div>

        <motion.form
          onSubmit={handleLogin}
          className="space-y-4"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.15 }}
        >
          <div className="bg-card border border-border rounded-2xl p-6 space-y-4 shadow-xl shadow-black/20">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@example.com"
                className="w-full bg-muted border border-border rounded-lg px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/50 transition-shadow"
                required
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-muted border border-border rounded-lg px-4 py-3 pr-11 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/50 transition-shadow"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || !email.trim() || !password.trim()}
              className="w-full px-6 py-3 bg-primary text-primary-foreground rounded-lg font-medium text-sm hover:brightness-110 active:scale-[0.97] transition-all disabled:opacity-40 disabled:pointer-events-none flex items-center justify-center gap-2 shadow-lg shadow-primary/20"
            >
              <LogIn className="w-4 h-4" />
              {loading ? "Memproses..." : "Masuk"}
            </button>
          </div>
        </motion.form>

        <motion.p
          className="text-center text-xs text-muted-foreground mt-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.3 }}
        >
          <a href="/" className="text-primary hover:underline">← Kembali ke beranda</a>
        </motion.p>
      </div>
    </div>
  );
};

export default Login;
