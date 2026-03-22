import { motion } from "framer-motion";
import { Radio, Zap } from "lucide-react";

const LiveNowBanner = ({ isLive }: { isLive: boolean }) => {
  if (!isLive) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      className="fixed top-[57px] left-0 right-0 z-30"
    >
      <a
        href="/schedule"
        className="flex items-center justify-center gap-3 bg-destructive px-4 py-2.5 text-destructive-foreground transition hover:bg-destructive/90"
      >
        <span className="relative flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-white" />
        </span>
        <span className="text-xs font-bold uppercase tracking-wider sm:text-sm">
          🔴 Sedang Live Sekarang!
        </span>
        <Zap className="h-3.5 w-3.5" />
        <span className="hidden rounded-full bg-white/20 px-3 py-0.5 text-[10px] font-bold sm:inline">
          Tonton Sekarang →
        </span>
      </a>
    </motion.div>
  );
};

export default LiveNowBanner;
