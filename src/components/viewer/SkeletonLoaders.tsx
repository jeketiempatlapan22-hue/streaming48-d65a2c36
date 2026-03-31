import { motion } from "framer-motion";

export const ShowCardSkeleton = () => (
  <div className="rounded-2xl border border-border/50 overflow-hidden">
    <div className="h-48 skeleton" />
    <div className="p-4 space-y-3">
      <div className="h-5 w-3/4 skeleton" />
      <div className="h-4 w-1/2 skeleton" />
      <div className="h-4 w-2/3 skeleton" />
      <div className="h-10 w-full skeleton rounded-xl" />
    </div>
  </div>
);

export const ProfileSkeleton = () => (
  <div className="min-h-screen bg-background">
    <div className="h-14 skeleton" />
    <div className="mx-auto max-w-lg px-4 py-6 space-y-5">
      <div className="rounded-xl border border-border/50 p-6 space-y-4">
        <div className="flex flex-col items-center gap-3">
          <div className="h-16 w-16 rounded-full skeleton" />
          <div className="h-3 w-32 skeleton" />
        </div>
        <div className="h-10 skeleton rounded-lg" />
        <div className="h-10 skeleton rounded-lg" />
      </div>
      <div className="grid grid-cols-3 gap-3">
        {[1, 2, 3].map(i => <div key={i} className="h-20 skeleton rounded-xl" />)}
      </div>
      <div className="h-24 skeleton rounded-xl" />
    </div>
  </div>
);

export const LandingShowsSkeleton = () => (
  <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
    {[1, 2, 3].map(i => (
      <motion.div
        key={i}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: i * 0.1 }}
      >
        <ShowCardSkeleton />
      </motion.div>
    ))}
  </div>
);

export const StatsSkeleton = () => (
  <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
    {[1, 2, 3, 4].map(i => (
      <div key={i} className="rounded-2xl border border-border/50 p-5 space-y-3">
        <div className="mx-auto h-11 w-11 rounded-xl skeleton" />
        <div className="h-6 w-16 mx-auto skeleton" />
        <div className="h-3 w-20 mx-auto skeleton" />
      </div>
    ))}
  </div>
);
