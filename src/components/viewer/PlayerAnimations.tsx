import { useEffect, useState } from "react";

export type AnimationType = "none" | "snow" | "stars" | "rain" | "leaves" | "bubbles" | "fireflies" | "confetti" | "hearts" | "sakura";

export const ANIMATION_OPTIONS: { value: AnimationType; label: string; emoji: string }[] = [
  { value: "none", label: "Tidak Ada", emoji: "🚫" },
  { value: "snow", label: "Salju Turun", emoji: "❄️" },
  { value: "stars", label: "Bintang", emoji: "🌟" },
  { value: "rain", label: "Hujan", emoji: "🌧️" },
  { value: "leaves", label: "Daun Berguguran", emoji: "🍂" },
  { value: "bubbles", label: "Gelembung", emoji: "🫧" },
  { value: "fireflies", label: "Kunang-kunang", emoji: "✨" },
  { value: "confetti", label: "Confetti", emoji: "🎊" },
  { value: "hearts", label: "Hati", emoji: "💖" },
  { value: "sakura", label: "Bunga Sakura", emoji: "🌸" },
];

interface Particle { id: number; x: number; y: number; size: number; speed: number; opacity: number; delay: number; color?: string; }

const CONFETTI_COLORS = ["hsl(var(--primary))", "hsl(var(--destructive))", "hsl(38, 92%, 50%)", "hsl(142, 71%, 45%)", "hsl(280, 70%, 60%)"];
const LEAF_EMOJIS = ["🍂", "🍁", "🍃", "🌿"];
const HEART_EMOJIS = ["💖", "💕", "💗", "💝", "❤️"];
const SAKURA_EMOJIS = ["🌸", "🏵️", "💮"];

const PlayerAnimations = ({ type, backgroundOnly = false }: { type: AnimationType; backgroundOnly?: boolean }) => {
  const [particles, setParticles] = useState<Particle[]>([]);

  useEffect(() => {
    if (type === "none") { setParticles([]); return; }
    const count = type === "rain" ? 60 : type === "confetti" ? 40 : 30;
    setParticles(Array.from({ length: count }, (_, i) => ({
      id: i, x: Math.random() * 100, y: Math.random() * 100, size: 4 + Math.random() * 10,
      speed: 3 + Math.random() * 8, opacity: 0.35 + Math.random() * 0.5, delay: Math.random() * 5,
      color: type === "confetti" ? CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)] : undefined,
    })));
  }, [type]);

  if (type === "none" || particles.length === 0) return null;

  const getStyle = (p: Particle): React.CSSProperties => {
    const base: React.CSSProperties = { position: "absolute", left: `${p.x}%`, pointerEvents: "none", opacity: p.opacity, animationDelay: `${p.delay}s`, animationDuration: `${p.speed}s`, animationTimingFunction: "linear", animationIterationCount: "infinite" };
    switch (type) {
      case "snow": return { ...base, top: `-${p.size}px`, width: p.size, height: p.size, borderRadius: "50%", background: "white", animationName: "anim-fall" };
      case "stars": return { ...base, top: `${p.y}%`, width: p.size, height: p.size, borderRadius: "50%", background: "white", animationName: "anim-twinkle", boxShadow: `0 0 ${p.size * 2}px white` };
      case "rain": return { ...base, top: `-10px`, width: 1.5, height: p.size * 3, background: "hsl(var(--primary) / 0.4)", animationName: "anim-rain", animationDuration: `${p.speed * 0.4}s` };
      case "leaves": return { ...base, top: `-${p.size * 2}px`, fontSize: `${p.size + 6}px`, animationName: "anim-leaf" };
      case "bubbles": return { ...base, bottom: `-${p.size}px`, width: p.size * 2, height: p.size * 2, borderRadius: "50%", border: "1px solid hsl(var(--primary) / 0.3)", background: "hsl(var(--primary) / 0.05)", animationName: "anim-rise" };
      case "fireflies": return { ...base, top: `${p.y}%`, width: p.size * 0.8, height: p.size * 0.8, borderRadius: "50%", background: "hsl(50, 100%, 70%)", boxShadow: `0 0 ${p.size * 3}px hsl(50, 100%, 60%)`, animationName: "anim-firefly" };
      case "confetti": return { ...base, top: `-${p.size}px`, width: p.size * 0.8, height: p.size * 1.5, background: p.color, borderRadius: "1px", animationName: "anim-confetti" };
      case "hearts": return { ...base, bottom: `-20px`, top: "auto", fontSize: `${p.size + 10}px`, animationName: "anim-float-up", animationDuration: `${p.speed * 1.2}s` };
      case "sakura": return { ...base, top: `-20px`, fontSize: `${p.size + 8}px`, animationName: "anim-sakura", animationDuration: `${p.speed * 1.1}s` };
      default: return base;
    }
  };

  const getEmoji = (p: Particle) => {
    switch (type) {
      case "leaves": return LEAF_EMOJIS[p.id % LEAF_EMOJIS.length];
      case "hearts": return HEART_EMOJIS[p.id % HEART_EMOJIS.length];
      case "sakura": return SAKURA_EMOJIS[p.id % SAKURA_EMOJIS.length];
      default: return null;
    }
  };

  return (
    <>
      <style>{`
        @keyframes anim-fall { 0% { transform: translateY(-10px) translateX(0); } 50% { transform: translateY(50vh) translateX(20px); } 100% { transform: translateY(100vh) translateX(-10px); } }
        @keyframes anim-twinkle { 0%,100% { opacity: 0.2; transform: scale(0.8); } 50% { opacity: 1; transform: scale(1.3); } }
        @keyframes anim-rain { 0% { transform: translateY(-10px); } 100% { transform: translateY(100vh); } }
        @keyframes anim-leaf { 0% { transform: translateY(-20px) rotate(0deg) translateX(0); } 33% { transform: translateY(33vh) rotate(120deg) translateX(30px); } 66% { transform: translateY(66vh) rotate(240deg) translateX(-20px); } 100% { transform: translateY(100vh) rotate(360deg) translateX(10px); } }
        @keyframes anim-rise { 0% { transform: translateY(0); opacity: 0.5; } 100% { transform: translateY(-100vh); opacity: 0; } }
        @keyframes anim-firefly { 0% { transform: translate(0, 0); opacity: 0.2; } 25% { transform: translate(15px, -20px); opacity: 1; } 50% { transform: translate(-10px, -40px); opacity: 0.3; } 75% { transform: translate(20px, -15px); opacity: 0.8; } 100% { transform: translate(0, 0); opacity: 0.2; } }
        @keyframes anim-confetti { 0% { transform: translateY(-10px) rotate(0deg); } 100% { transform: translateY(100vh) rotate(720deg); } }
        @keyframes anim-float-up { 0% { transform: translateY(0) scale(0.5); opacity: 0; } 10% { opacity: 0.8; transform: translateY(-10vh) scale(1); } 100% { transform: translateY(-100vh) scale(0.8); opacity: 0; } }
        @keyframes anim-sakura { 0% { transform: translateY(-20px) rotate(0deg) translateX(0); } 50% { transform: translateY(50vh) rotate(180deg) translateX(-20px); } 100% { transform: translateY(100vh) rotate(360deg); opacity: 0.2; } }
      `}</style>
      <div className={`pointer-events-none fixed inset-0 overflow-hidden ${backgroundOnly ? "z-0" : "z-[1]"}`}>
        {particles.map((p) => <div key={p.id} style={getStyle(p)}>{getEmoji(p)}</div>)}
      </div>
    </>
  );
};

export default PlayerAnimations;
