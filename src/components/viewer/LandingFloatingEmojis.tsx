import { motion } from "framer-motion";
import { useMemo } from "react";

interface FloatingEmoji {
  id: number;
  emoji: string;
  x: number;
  y: number;
  size: number;
  duration: number;
  delay: number;
}

const EMOJIS = [
  "🌳", "🌲", "🌴", "🌵", "🌿", "🍀", "🍃",
  "☀️", "🌙", "⭐", "🌈",
  "🐰", "🦊", "🐻", "🐸", "🦋", "🐦", "🐧", "🐼", "🦉", "🐿️",
  "⛄", "❄️", "🌸", "🌺", "🌻", "🍄",
  "☁️", "💫", "✨", "🎵",
];

const LandingFloatingEmojis = () => {
  const emojis = useMemo<FloatingEmoji[]>(() => {
    return Array.from({ length: 18 }, (_, i) => ({
      id: i,
      emoji: EMOJIS[i % EMOJIS.length],
      x: 2 + Math.random() * 96,
      y: Math.random() * 100,
      size: 16 + Math.random() * 20,
      duration: 8 + Math.random() * 12,
      delay: Math.random() * 6,
    }));
  }, []);

  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      {emojis.map((e) => (
        <motion.div
          key={e.id}
          className="absolute select-none"
          style={{
            left: `${e.x}%`,
            top: `${e.y}%`,
            fontSize: `${e.size}px`,
          }}
          animate={{
            y: [0, -20, 0, 15, 0],
            x: [0, 10, -8, 5, 0],
            rotate: [0, 10, -10, 5, 0],
            opacity: [0.12, 0.25, 0.15, 0.22, 0.12],
          }}
          transition={{
            duration: e.duration,
            repeat: Infinity,
            delay: e.delay,
            ease: "easeInOut",
          }}
        >
          {e.emoji}
        </motion.div>
      ))}
    </div>
  );
};

export default LandingFloatingEmojis;
