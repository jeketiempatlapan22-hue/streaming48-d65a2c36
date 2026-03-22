import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const AdminOrderNotifications = () => {
  useEffect(() => {
    // Listen for new coin orders
    const coinChannel = supabase
      .channel("admin-coin-order-notif")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "coin_orders" }, (payload) => {
        const order = payload.new as any;
        toast.info(`🪙 Order koin baru: ${order.coin_amount} koin`, {
          description: `ID: ${order.short_id || order.id.slice(0, 8)}`,
          duration: 8000,
        });
      })
      .subscribe();

    // Listen for new subscription orders
    const subChannel = supabase
      .channel("admin-sub-order-notif")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "subscription_orders" }, (payload) => {
        const order = payload.new as any;
        toast.info("📦 Order langganan baru masuk!", {
          description: `ID: ${order.short_id || order.id.slice(0, 8)}`,
          duration: 8000,
        });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(coinChannel);
      supabase.removeChannel(subChannel);
    };
  }, []);

  return null;
};

export default AdminOrderNotifications;
