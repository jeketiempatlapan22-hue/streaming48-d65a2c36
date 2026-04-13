export interface Show {
  id: string;
  title: string;
  price: string;
  lineup: string;
  schedule_date: string;
  schedule_time: string;
  background_image_url: string | null;
  qris_image_url: string | null;
  is_subscription: boolean;
  max_subscribers: number;
  subscription_benefits: string;
  group_link?: string;
  is_order_closed: boolean;
  category?: string;
  category_member?: string;
  coin_price: number;
  replay_coin_price: number;
  is_replay: boolean;
  access_password?: string;
  replay_qris_price?: number;
  team?: string;
}

export const SHOW_CATEGORIES: Record<string, { label: string; color: string }> = {
  regular: { label: "🎭 Reguler", color: "bg-primary/20 text-primary" },
  birthday: { label: "🎂 Ulang Tahun/STS", color: "bg-pink-500/20 text-pink-400" },
  special: { label: "⭐ Spesial", color: "bg-yellow-500/20 text-yellow-400" },
  anniversary: { label: "🎉 Anniversary", color: "bg-purple-500/20 text-purple-400" },
  last_show: { label: "👋 Last Show", color: "bg-red-500/20 text-red-400" },
};

export const SHOW_TEAMS: Record<string, { label: string; gradient: string; icon: string; borderColor: string }> = {
  passion: { label: "Passion", gradient: "from-red-600 to-orange-500", icon: "🔥", borderColor: "border-red-500/40" },
  dream: { label: "Dream", gradient: "from-blue-600 to-cyan-400", icon: "☁️", borderColor: "border-blue-500/40" },
  love: { label: "Love", gradient: "from-pink-600 to-rose-400", icon: "💗", borderColor: "border-pink-500/40" },
};
