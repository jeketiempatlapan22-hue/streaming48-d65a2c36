import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";

const QUICK_EMOJIS = ["❤️", "🔥", "😂", "👏", "😍", "🎉", "💯", "😮"];

interface FloatingEmoji {
  id: number;
  emoji: string;
  x: number;
}

interface EmojiReactionsProps {
  onSend?: (emoji: string) => void;
}

let emojiCounter = 0;

const EmojiReactions = ({ onSend }: EmojiReactionsProps) => {
  const [floating, setFloating] = useState<FloatingEmoji[]>([]);
  const [expanded, setExpanded] = useState(false);

  const handleEmoji = useCallback((emoji: string) => {
    const id = emojiCounter++;
    const x = 20 + Math.random() * 60;
    setFloating((prev) => [...prev.slice(-12), { id, emoji, x }]);
    onSend?.(emoji);

    setTimeout(() => {
      setFloating((prev) => prev.filter((e) => e.id !== id));
    }, 2000);
  }, [onSend]);

  return (
    <>
      {/* Floating emojis overlay */}
      <div className="pointer-events-none fixed inset-0 z-[60] overflow-hidden">
        <AnimatePresence>
          {floating.map((e) => (
            <motion.div
              key={e.id}
              initial={{ opacity: 1, y: 0, x: `${e.x}vw`, scale: 0.5 }}
              animate={{ opacity: 0, y: -300, scale: 1.5 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 2, ease: "easeOut" }}
              className="absolute bottom-20 text-3xl"
            >
              {e.emoji}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Emoji picker bar */}
      <div className="flex items-center gap-1 px-3 py-1.5 border-t border-border bg-card/50">
        <AnimatePresence>
          {expanded ? (
            <motion.div
              initial={{ opacity: 0, width: 0 }}
              animate={{ opacity: 1, width: "auto" }}
              exit={{ opacity: 0, width: 0 }}
              className="flex items-center gap-1 overflow-hidden"
            >
              {QUICK_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => handleEmoji(emoji)}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-lg transition-transform hover:scale-125 active:scale-90"
                >
                  {emoji}
                </button>
              ))}
            </motion.div>
          ) : null}
        </AnimatePresence>
        <button
          onClick={() => setExpanded(!expanded)}
          className={`flex h-8 items-center justify-center rounded-lg px-2 text-xs font-medium transition ${
            expanded
              ? "bg-primary/10 text-primary"
              : "bg-secondary text-muted-foreground hover:text-foreground"
          }`}
        >
          {expanded ? "✕" : "😀"}
        </button>
      </div>
    </>
  );
};

export default EmojiReactions;
