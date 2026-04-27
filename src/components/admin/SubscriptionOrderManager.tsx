import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle, XCircle, Clock, Trash2, Send, Image, SendHorizonal, Coins, Copy, Mail, Save, Search, UserPlus, Phone } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { buildRegularShowMessage } from "@/lib/showMessageBuilder";

interface Order {
  id: string;
  short_id: string | null;
  show_id: string;
  phone: string;
  email: string;
  payment_proof_url: string;
  payment_method: string;
  status: string;
  created_at: string;
  user_id: string | null;
}

interface ShowInfo {
  title: string;
  group_link: string;
  is_subscription: boolean;
  access_password: string;
  is_replay: boolean;
  schedule_date: string;
  schedule_time: string;
}

interface SubscriptionOrderManagerProps {
  mode?: "membership" | "regular";
}

// Helper buildRegularShowMessage diimpor dari "@/lib/showMessageBuilder".


const SubscriptionOrderManager = ({ mode = "membership" }: SubscriptionOrderManagerProps) => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [shows, setShows] = useState<Record<string, ShowInfo>>({});
  const [orderTokens, setOrderTokens] = useState<Record<string, { code: string; expires_at: string | null; created_at: string | null }>>({});
  const [filter, setFilter] = useState<"all" | "pending" | "confirmed" | "rejected">("all");
  const [showFilter, setShowFilter] = useState<string>("all");
  const [waMessages, setWaMessages] = useState<Record<string, string>>({});
  const [editEmails, setEditEmails] = useState<Record<string, string>>({});
  const [editPhones, setEditPhones] = useState<Record<string, string>>({});
  const [savingEmail, setSavingEmail] = useState<string | null>(null);
  const [savingPhone, setSavingPhone] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [bulkMessage, setBulkMessage] = useState("");
  const [showBulk, setShowBulk] = useState(false);
  const [bulkShowTarget, setBulkShowTarget] = useState("__current__");
  const [copiedField, setCopiedField] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [newOrder, setNewOrder] = useState({ show_id: "", phone: "", email: "" });
  const [addingOrder, setAddingOrder] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkProcessing, setBulkProcessing] = useState(false);
  const [sendingWaAction, setSendingWaAction] = useState<string | null>(null);
  const [deleteSelectedIds, setDeleteSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleteMode, setBulkDeleteMode] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const { toast } = useToast();

  const [showDynamicPending, setShowDynamicPending] = useState(false);

  const fetchOrders = async () => {
    const { data: ordersData } = await (supabase as any).from("subscription_orders").select("*").order("created_at", { ascending: false });
    const { data: showsData } = await supabase.from("shows").select("id, title, group_link, is_subscription, access_password, is_replay, schedule_date, schedule_time");
    const showMap: Record<string, ShowInfo> = {};
    showsData?.forEach((s: any) => { showMap[s.id] = { title: s.title, group_link: s.group_link || "", is_subscription: s.is_subscription, access_password: s.access_password || "", is_replay: s.is_replay || false, schedule_date: s.schedule_date || "", schedule_time: s.schedule_time || "" }; });
    setShows(showMap);
    // Default: sembunyikan QRIS dinamis pending dari list (otomatis akan auto-confirm
    // via callback Pak Kasir atau auto-delete setelah 10 menit). Admin bisa toggle.
    const filtered = ((ordersData as Order[]) || []).filter((o: any) => {
      if (showDynamicPending) return true;
      const isPendingDynamic = o.payment_method === "qris_dynamic" && (o.status === "pending" || o.payment_status === "pending");
      return !isPendingDynamic;
    });
    setOrders(filtered);

    // Fetch tokens for confirmed orders to enable quick-send buttons
    const confirmedOrders = (ordersData as Order[] || []).filter(o => o.status === "confirmed");
    if (confirmedOrders.length > 0) {
      const tokenMap: Record<string, { code: string; expires_at: string | null; created_at: string | null }> = {};

      // Fetch tokens for orders with user_id
      const withUser = confirmedOrders.filter(o => o.user_id);
      if (withUser.length > 0) {
        const userIds = [...new Set(withUser.map(o => o.user_id!))];
        const showIds = [...new Set(withUser.map(o => o.show_id))];
        const { data: tokensData } = await supabase.from("tokens").select("code, show_id, user_id, expires_at, created_at, status").in("user_id", userIds).in("show_id", showIds);
        if (tokensData) {
          for (const order of withUser) {
            const token = tokensData.find((t: any) => t.user_id === order.user_id && t.show_id === order.show_id && t.status === "active");
            if (token) {
              tokenMap[order.id] = { code: token.code, expires_at: token.expires_at, created_at: token.created_at };
            }
          }
        }
      }

      // Fetch tokens for guest/manual orders (user_id is null) — match by show_id + null user_id
      const guestOrders = confirmedOrders.filter(o => !o.user_id);
      if (guestOrders.length > 0) {
        const guestShowIds = [...new Set(guestOrders.map(o => o.show_id))];
        const { data: guestTokens } = await supabase.from("tokens").select("code, show_id, user_id, expires_at, created_at, status").in("show_id", guestShowIds).is("user_id", null);
        if (guestTokens) {
          for (const order of guestOrders) {
            const token = guestTokens.find((t: any) => t.show_id === order.show_id && t.status === "active");
            if (token && !tokenMap[order.id]) {
              tokenMap[order.id] = { code: token.code, expires_at: token.expires_at, created_at: token.created_at };
            }
          }
        }
      }

      setOrderTokens(tokenMap);
    }
  };

  useEffect(() => { fetchOrders(); }, [showDynamicPending]);

  const updateStatus = async (id: string, status: string) => {
    if (status === "confirmed") {
      setConfirmingId(id);
      const order = orders.find((o) => o.id === id);
      const showInfo = order ? shows[order.show_id] : null;
      const confirmFn = (mode === "membership" || showInfo?.is_subscription) ? "confirm_membership_order" : "confirm_regular_order";
      const { data, error } = await supabase.rpc(confirmFn as any, { _order_id: id });
      setConfirmingId(null);
      const result = data as any;
      if (error || !result?.success) {
        toast({ title: result?.error || error?.message || "Gagal mengkonfirmasi", variant: "destructive" });
        return;
      }

      // Use already-fetched order and showInfo from above
      const siteUrl = "https://realtime48stream.my.id";
      const replayUrl = "https://replaytime.lovable.app";

      // Save token to state immediately so it shows in the panel
      if (result.token_code) {
        setOrderTokens(prev => ({ ...prev, [id]: { code: result.token_code, expires_at: result.expires_at || null, created_at: new Date().toISOString() } }));
      }

      if (result.token_code && order?.phone && showInfo) {
        const liveLink = `${siteUrl}/live?t=${result.token_code}`;
        const isMembership = showInfo.is_subscription;

        if (isMembership) {
          const durationDays = result.duration_days || 30;
          let message = `✅ *Membership Dikonfirmasi!*\n\n🎭 Paket: *${showInfo.title}*\n`;
          message += `🎫 Token: \`${result.token_code}\`\n📺 Link Nonton: ${liveLink}\n`;
          message += `⏳ Durasi: *${durationDays} hari*\n`;
          if (result.expires_at) {
            const expDate = new Date(result.expires_at);
            message += `📅 Berlaku hingga: *${expDate.toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })}*\n`;
          }
          if (showInfo.group_link) message += `\n👥 *Link Grup:*\n🔗 ${showInfo.group_link}\n`;
          if (showInfo.access_password || result.access_password) {
            const pw = result.access_password || showInfo.access_password;
            message += `\n🔄 *Akses Replay:*\n🔗 Link Replay: ${replayUrl}\n🔑 Sandi Replay: \`${pw}\`\n`;
          }
          message += `\n✨ Dengan membership ini kamu bisa akses *semua show* selama masa aktif.\n`;
          message += `⚠️ Token berlaku untuk *1 perangkat*.\nTerima kasih! 🎉`;
          sendWhatsApp(order.phone, message);
        } else {
          // Ambil max_devices aktual dari token yang baru dibuat
          const { data: tokRow } = await supabase
            .from("tokens")
            .select("max_devices")
            .eq("code", result.token_code)
            .maybeSingle();
          const message = buildRegularShowMessage({
            showTitle: showInfo.title,
            scheduleDate: showInfo.schedule_date,
            scheduleTime: showInfo.schedule_time,
            // liveLink sudah dibangun di atas
            liveLink,
            replayPassword: showInfo.access_password,
            maxDevices: tokRow?.max_devices ?? 1,
          });
          sendWhatsApp(order.phone, message);
        }
        toast({ title: `Order dikonfirmasi! Token: ${result.token_code} — WA dikirim` });
      } else if (result.token_code) {
        toast({ title: `Order dikonfirmasi! Token: ${result.token_code}` });
      } else {
        // Membership without token
        if (order?.phone && showInfo) {
          const message = `✅ *Membership Dikonfirmasi!*\n\n🎭 Paket: *${showInfo.title}*\n` +
            (showInfo.group_link ? `🔗 Link Grup: ${showInfo.group_link}\n` : "") +
            `\nTerima kasih! 🎉`;
          sendWhatsApp(order.phone, message);
        }
        toast({ title: "Order dikonfirmasi" });
      }

      // Send bot notification about confirmation
      const shortId = order?.short_id || id.slice(0, 8);
      const statusEmoji = "✅";
      supabase.functions.invoke("notify-subscription-order", {
        body: {
          order_id: id,
          show_title: showInfo?.title || "Unknown",
          phone: order?.phone || "",
          email: order?.email || "",
          order_type: showInfo?.is_subscription ? "membership" : "show",
          schedule_date: showInfo?.schedule_date || null,
          schedule_time: showInfo?.schedule_time || null,
          is_confirmation: true,
        },
      }).catch(() => {});
    } else {
      await (supabase as any).from("subscription_orders").update({ status }).eq("id", id);
      toast({ title: `Order ${status === "rejected" ? "ditolak" : status}` });
    }
    await fetchOrders();
  };

  const deleteOrder = async (id: string) => {
    await (supabase as any).from("subscription_orders").delete().eq("id", id);
    await fetchOrders();
    toast({ title: "Order dihapus" });
  };

  const toggleDeleteSelect = (id: string) => {
    setDeleteSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleDeleteSelectAll = (orderList: Order[]) => {
    if (orderList.every(o => deleteSelectedIds.has(o.id))) {
      setDeleteSelectedIds(new Set());
    } else {
      setDeleteSelectedIds(new Set(orderList.map(o => o.id)));
    }
  };

  const bulkDeleteOrders = async () => {
    if (deleteSelectedIds.size === 0) return;
    const count = deleteSelectedIds.size;
    if (!window.confirm(`Yakin hapus ${count} order yang dipilih? Tindakan ini tidak bisa dibatalkan.`)) return;
    setBulkDeleting(true);
    try {
      const ids = Array.from(deleteSelectedIds);
      for (let i = 0; i < ids.length; i += 50) {
        const batch = ids.slice(i, i + 50);
        await (supabase as any).from("subscription_orders").delete().in("id", batch);
      }
      setDeleteSelectedIds(new Set());
      setBulkDeleteMode(false);
      await fetchOrders();
      toast({ title: `${count} order berhasil dihapus` });
    } catch {
      toast({ title: "Gagal menghapus", variant: "destructive" });
    } finally {
      setBulkDeleting(false);
    }
  };

  const sendWhatsApp = async (phone: string, message: string) => {
    let cleanPhone = phone.replace(/[^0-9+]/g, "");
    if (cleanPhone.startsWith("+")) {
      cleanPhone = cleanPhone.substring(1);
    } else if (cleanPhone.startsWith("0")) {
      cleanPhone = "62" + cleanPhone.substring(1);
    }
    const isIndonesian = cleanPhone.startsWith("62");
    const target = isIndonesian ? cleanPhone : "+" + cleanPhone;
    try {
      const { data, error } = await supabase.functions.invoke("send-whatsapp", {
        body: { target, message },
      });
      if (error || !data?.success) {
        toast({ title: "Gagal mengirim WA", variant: "destructive" });
      } else {
        toast({ title: "Pesan WA terkirim!" });
      }
    } catch {
      toast({ title: "Gagal mengirim WA", variant: "destructive" });
    }
  };

  const sendAllLinks = async (order: Order) => {
    const showInfo = shows[order.show_id];
    let token = orderTokens[order.id];
    if (!order.phone || !showInfo) { toast({ title: "Data tidak lengkap", variant: "destructive" }); return; }
    setSendingWaAction("all-" + order.id);
    const siteUrl = "https://realtime48stream.my.id";

    // If no token exists and it's a regular (non-subscription) show, create one
    if (!token && !showInfo.is_subscription) {
      const newCode = "ADM-" + Math.random().toString(36).slice(2, 14).toUpperCase();

      // Calculate expires_at based on show schedule
      let expiresAt: string | null = null;
      if (showInfo.schedule_date) {
        try {
          const { data: parsedDt } = await supabase.rpc("parse_show_datetime" as any, {
            _date: showInfo.schedule_date,
            _time: showInfo.schedule_time || "23.59 WIB",
          });
          if (parsedDt) {
            const showDate = new Date(parsedDt as string);
            // Set to end of show day (23:59:59 WIB)
            showDate.setHours(23, 59, 59, 0);
            // If already past, give 24h from now
            if (showDate.getTime() < Date.now()) {
              expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
            } else {
              expiresAt = showDate.toISOString();
            }
          }
        } catch { /* fallback to 24h */ }
      }
      if (!expiresAt) {
        expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      }

      const insertData: any = {
        code: newCode,
        show_id: order.show_id,
        max_devices: 1,
        expires_at: expiresAt,
        user_id: order.user_id || null,
      };

      const { error: tokenErr } = await supabase.from("tokens").insert(insertData);
      if (!tokenErr) {
        token = { code: newCode, expires_at: expiresAt, created_at: new Date().toISOString() };
        setOrderTokens(prev => ({ ...prev, [order.id]: token! }));
      } else {
        toast({ title: "Gagal membuat token: " + tokenErr.message, variant: "destructive" });
      }
    }

    let message = `📺 *Info Show: ${showInfo.title}*\n`;
    if (showInfo.schedule_date) {
      message += `📅 Jadwal: ${showInfo.schedule_date}${showInfo.schedule_time ? " " + showInfo.schedule_time : ""}\n`;
    }
    message += "\n";

    if (token) {
      const liveLink = `${siteUrl}/live?t=${token.code}`;
      message += `🎫 Token: \`${token.code}\`\n📺 Link Nonton: ${liveLink}\n`;
    } else if (showInfo.is_subscription && showInfo.group_link) {
      message += `🔗 Link Grup: ${showInfo.group_link}\n`;
    }

    if (showInfo.access_password) {
      message += `\n🔄 *Akses Replay:*\n🔗 Link Replay: ${siteUrl}/replay\n🔑 Sandi Replay: \`${showInfo.access_password}\`\n`;
    }

    if (token) {
      message += `\n⚠️ Token hanya berlaku untuk *1 perangkat*. Jangan bagikan link ini.`;
    }
    message += `\nTerima kasih! 🎉`;

    await sendWhatsApp(order.phone, message);
    setSendingWaAction(null);
  };

  const savePhone = async (id: string) => {
    const newPhone = editPhones[id]?.trim();
    if (!newPhone) return;
    setSavingPhone(id);
    await (supabase as any).from("subscription_orders").update({ phone: newPhone }).eq("id", id);
    await fetchOrders();
    setSavingPhone(null);
    setEditPhones((prev) => { const n = { ...prev }; delete n[id]; return n; });
    toast({ title: "Nomor HP berhasil diperbarui" });
  };

  const saveEmail = async (id: string) => {
    const newEmail = editEmails[id]?.trim();
    if (!newEmail) return;
    setSavingEmail(id);
    await (supabase as any).from("subscription_orders").update({ email: newEmail }).eq("id", id);
    await fetchOrders();
    setSavingEmail(null);
    setEditEmails((prev) => { const n = { ...prev }; delete n[id]; return n; });
    toast({ title: "Email berhasil diperbarui" });
  };

  const copyBulkData = (field: "phone" | "email") => {
    const data = filteredOrders.map((o) => field === "phone" ? o.phone : o.email).filter(Boolean).join("\n");
    navigator.clipboard.writeText(data);
    setCopiedField(field);
    setTimeout(() => setCopiedField(""), 2000);
    toast({ title: `${filteredOrders.length} ${field === "phone" ? "nomor HP" : "email"} disalin` });
  };

  const addManualOrder = async () => {
    if (!newOrder.show_id || !newOrder.phone.trim()) {
      toast({ title: "Show dan nomor HP wajib diisi", variant: "destructive" });
      return;
    }
    setAddingOrder(true);
    // Insert as pending first, then confirm via RPC to create a unique token
    const { data: insertData, error: insertErr } = await (supabase as any).from("subscription_orders").insert({
      show_id: newOrder.show_id,
      phone: newOrder.phone.trim(),
      email: newOrder.email.trim() || null,
      payment_method: "manual",
      status: "pending",
      user_id: null,
    }).select("id").single();
    if (insertErr || !insertData?.id) {
      toast({ title: "Gagal menambahkan order", variant: "destructive" });
      setAddingOrder(false);
      return;
    }
    // Confirm via RPC to auto-create unique token
    const manualShowInfo = shows[newOrder.show_id];
    const manualConfirmFn = (mode === "membership" || manualShowInfo?.is_subscription) ? "confirm_membership_order" : "confirm_regular_order";
    const { data: confirmData, error: confirmErr } = await supabase.rpc(manualConfirmFn as any, { _order_id: insertData.id });
    const result = confirmData as any;
    if (confirmErr || !result?.success) {
      toast({ title: "Order dibuat tapi gagal membuat token: " + (result?.error || confirmErr?.message), variant: "destructive" });
    } else {
      const showInfo = shows[newOrder.show_id];
      const tokenMsg = result.token_code ? ` | Token: ${result.token_code}` : "";
      toast({ title: `Order manual berhasil ditambahkan${tokenMsg}` });

      // Auto-send WhatsApp with full membership/regular info
      if (newOrder.phone.trim() && showInfo) {
        const siteUrl = "https://realtime48stream.my.id";
        const replayUrl = "https://replaytime.lovable.app";
        const isMembership = showInfo.is_subscription;

        if (isMembership && result.token_code) {
          // Membership order - include duration, group link, replay info
          const liveLink = `${siteUrl}/live?t=${result.token_code}`;
          const durationDays = result.duration_days || 30;
          let message = `✅ *Membership Dikonfirmasi!*\n\n🎭 Paket: *${showInfo.title}*\n`;
          message += `🎫 Token: \`${result.token_code}\`\n`;
          message += `📺 Link Nonton: ${liveLink}\n`;
          message += `⏳ Durasi: *${durationDays} hari*\n`;
          if (result.expires_at) {
            const expDate = new Date(result.expires_at);
            message += `📅 Berlaku hingga: *${expDate.toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })}*\n`;
          }
          if (showInfo.group_link) {
            message += `\n👥 *Link Grup:*\n🔗 ${showInfo.group_link}\n`;
          }
          if (showInfo.access_password || result.access_password) {
            const pw = result.access_password || showInfo.access_password;
            message += `\n🔄 *Akses Replay:*\n🔗 Link Replay: ${replayUrl}\n🔑 Sandi Replay: \`${pw}\`\n`;
          }
          message += `\n✨ Dengan membership ini kamu bisa akses *semua show* selama masa aktif.\n`;
          message += `⚠️ Token hanya berlaku untuk *1 perangkat*.\nTerima kasih! 🎉`;
          sendWhatsApp(newOrder.phone.trim(), message);
        } else if (isMembership && !result.token_code) {
          // Membership without token (token feature disabled)
          let message = `✅ *Membership Dikonfirmasi!*\n\n🎭 Paket: *${showInfo.title}*\n`;
          if (showInfo.group_link) message += `🔗 Link Grup: ${showInfo.group_link}\n`;
          message += `\nTerima kasih! 🎉`;
          sendWhatsApp(newOrder.phone.trim(), message);
        } else if (result.token_code) {
          // Regular order
          const liveLink = `${siteUrl}/live?t=${result.token_code}`;
          const { data: tokRow } = await supabase
            .from("tokens")
            .select("max_devices")
            .eq("code", result.token_code)
            .maybeSingle();
          const message = buildRegularShowMessage({
            showTitle: showInfo.title,
            scheduleDate: showInfo.schedule_date,
            scheduleTime: showInfo.schedule_time,
            // liveLink sudah dibangun di atas
            liveLink,
            replayPassword: showInfo.access_password,
            maxDevices: tokRow?.max_devices ?? 1,
          });
          sendWhatsApp(newOrder.phone.trim(), message);
        }
      }
    }
    setNewOrder({ show_id: "", phone: "", email: "" });
    setShowAddDialog(false);
    await fetchOrders();
    setAddingOrder(false);
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    const pendingIds = filteredOrders.filter((o) => o.status === "pending").map((o) => o.id);
    if (pendingIds.every((id) => selectedIds.has(id))) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        pendingIds.forEach((id) => next.delete(id));
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        pendingIds.forEach((id) => next.add(id));
        return next;
      });
    }
  };

  const bulkUpdateStatus = async (status: "confirmed" | "rejected") => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setBulkProcessing(true);
    let successCount = 0;
    let failCount = 0;

    for (const id of ids) {
      try {
        if (status === "confirmed") {
          const bulkOrder = orders.find((o) => o.id === id);
          const bulkShowInfo = bulkOrder ? shows[bulkOrder.show_id] : null;
          const bulkConfirmFn = (mode === "membership" || bulkShowInfo?.is_subscription) ? "confirm_membership_order" : "confirm_regular_order";
          const { data, error } = await supabase.rpc(bulkConfirmFn as any, { _order_id: id });
          const result = data as any;
          if (error || !result?.success) { failCount++; continue; }

          const order = orders.find((o) => o.id === id);
          const showInfo = order ? shows[order.show_id] : null;
          const siteUrl = "https://realtime48stream.my.id";

          if (result.token_code && order?.phone && showInfo) {
            const liveLink = `${siteUrl}/live?t=${result.token_code}`;
            const isMembership = showInfo.is_subscription;
            if (isMembership) {
              const durationDays = result.duration_days || 30;
              let message = `✅ *Membership Dikonfirmasi!*\n\n🎭 Paket: *${showInfo.title}*\n`;
              message += `🎫 Token: \`${result.token_code}\`\n📺 Link Nonton: ${liveLink}\n`;
              message += `⏳ Durasi: *${durationDays} hari*\n`;
              if (result.expires_at) {
                const expDate = new Date(result.expires_at);
                message += `📅 Berlaku hingga: *${expDate.toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })}*\n`;
              }
              if (showInfo.group_link) message += `\n👥 *Link Grup:*\n🔗 ${showInfo.group_link}\n`;
              if (showInfo.access_password || result.access_password) {
                const pw = result.access_password || showInfo.access_password;
                message += `\n🔄 *Akses Replay:*\n🔗 Link Replay: ${siteUrl}/replay\n🔑 Sandi Replay: \`${pw}\`\n`;
              }
              message += `\n✨ Akses *semua show* selama masa aktif.\n⚠️ Token berlaku untuk *1 perangkat*.\nTerima kasih! 🎉`;
              sendWhatsApp(order.phone, message);
            } else {
              const { data: tokRow } = await supabase
                .from("tokens")
                .select("max_devices")
                .eq("code", result.token_code)
                .maybeSingle();
              const message = buildRegularShowMessage({
                showTitle: showInfo.title,
                scheduleDate: showInfo.schedule_date,
                scheduleTime: showInfo.schedule_time,
                // liveLink sudah dibangun di atas
                liveLink,
                replayPassword: showInfo.access_password,
                maxDevices: tokRow?.max_devices ?? 1,
              });
              sendWhatsApp(order.phone, message);
            }
          } else if (!result.token_code && order?.phone && showInfo) {
            const message = `✅ *Membership Dikonfirmasi!*\n\n🎭 Show: *${showInfo.title}*\n${showInfo.group_link ? `🔗 Link Grup: ${showInfo.group_link}\n` : ""}\nTerima kasih! 🎉`;
            sendWhatsApp(order.phone, message);
          }
          successCount++;
        } else {
          await (supabase as any).from("subscription_orders").update({ status }).eq("id", id);
          successCount++;
        }
      } catch {
        failCount++;
      }
    }

    setSelectedIds(new Set());
    setBulkProcessing(false);
    await fetchOrders();
    toast({
      title: `${status === "confirmed" ? "Dikonfirmasi" : "Ditolak"}: ${successCount} berhasil${failCount > 0 ? `, ${failCount} gagal` : ""}`,
    });
  };

  // Filter orders by mode (membership vs regular)
  const modeOrders = orders.filter((o) => {
    const showInfo = shows[o.show_id];
    if (!showInfo) {
      return mode === "regular";
    }
    return mode === "membership" ? showInfo.is_subscription : !showInfo.is_subscription;
  });

  // Get available shows for this mode
  const modeShows = Object.entries(shows).filter(([, s]) =>
    (mode === "membership" ? s.is_subscription : !s.is_subscription) && !s.is_replay
  );

  // Apply show filter
  const showFiltered = showFilter === "all" ? modeOrders : modeOrders.filter((o) => o.show_id === showFilter);

  // Apply status filter
  const statusFiltered = filter === "all" ? showFiltered : showFiltered.filter((o) => o.status === filter);

  // Apply search
  const filteredOrders = searchQuery.trim()
    ? statusFiltered.filter((o) => {
        const q = searchQuery.toLowerCase();
        return (o.short_id?.toLowerCase().includes(q)) || (o.email?.toLowerCase().includes(q)) || (o.phone?.toLowerCase().includes(q)) || (shows[o.show_id]?.title?.toLowerCase().includes(q));
      })
    : statusFiltered;

  const confirmedCount = showFiltered.filter((o) => o.status === "confirmed").length;
  const pendingInView = filteredOrders.filter((o) => o.status === "pending");
  const selectedPendingCount = pendingInView.filter((o) => selectedIds.has(o.id)).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-xl font-bold text-foreground">
          {mode === "membership" ? "📋 Order Membership" : "🎫 Order Show"}
        </h2>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setShowAddDialog(true)} className="gap-1.5">
            <UserPlus className="h-3.5 w-3.5" /> Tambah Manual
          </Button>
          {confirmedCount > 0 && (
            <Button size="sm" variant="outline" onClick={() => setShowBulk(true)} className="gap-1.5">
              <SendHorizonal className="h-3.5 w-3.5" /> Kirim Massal ({confirmedCount})
            </Button>
          )}
        </div>
      </div>

      {/* Show filter for regular shows */}
      {mode === "regular" && modeShows.length > 1 && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setShowFilter("all")}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${showFilter === "all" ? "bg-accent text-accent-foreground" : "bg-secondary text-secondary-foreground hover:bg-secondary/80"}`}
          >
            Semua Show ({modeOrders.length})
          </button>
          {modeShows.map(([id, s]) => {
            const count = modeOrders.filter((o) => o.show_id === id).length;
            return (
              <button
                key={id}
                onClick={() => setShowFilter(id)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${showFilter === id ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground hover:bg-secondary/80"}`}
              >
                {s.title}{s.schedule_date ? ` (${s.schedule_date})` : ""} ({count})
              </button>
            );
          })}
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={mode === "membership" ? "Cari email, nomor HP, atau nama show..." : "Cari nomor HP atau nama show..."}
          className="pl-9"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {(["pending", "confirmed", "rejected", "all"] as const).map((f) => (
          <button key={f} onClick={() => { setFilter(f); setDeleteSelectedIds(new Set()); }}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${filter === f ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground hover:bg-secondary/80"}`}>
            {f === "pending" ? "Menunggu" : f === "confirmed" ? "Dikonfirmasi" : f === "rejected" ? "Ditolak" : "Semua"}
            {f !== "all" && ` (${showFiltered.filter((o) => o.status === f).length})`}
          </button>
        ))}
      </div>

      {/* Bulk action bar - always visible when there are orders */}
      {filteredOrders.length > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-3 flex-wrap">
          <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-foreground">
            <input
              type="checkbox"
              checked={filteredOrders.length > 0 && filteredOrders.every(o => deleteSelectedIds.has(o.id))}
              onChange={() => toggleDeleteSelectAll(filteredOrders)}
              className="rounded border-input"
            />
            Pilih Semua ({filteredOrders.length})
          </label>
          {deleteSelectedIds.size > 0 && (
            <div className="flex items-center gap-2 ml-auto">
              <span className="text-xs text-muted-foreground">{deleteSelectedIds.size} dipilih</span>
              {/* Bulk confirm/reject for pending */}
              {filter === "pending" && (
                <>
                  <Button size="sm" onClick={() => {
                    setSelectedIds(new Set(deleteSelectedIds));
                    bulkUpdateStatus("confirmed");
                  }} disabled={bulkProcessing} className="h-7 text-xs gap-1">
                    <CheckCircle className="h-3 w-3" /> {bulkProcessing ? "Proses..." : "Konfirmasi"}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => {
                    setSelectedIds(new Set(deleteSelectedIds));
                    bulkUpdateStatus("rejected");
                  }} disabled={bulkProcessing} className="h-7 text-xs gap-1">
                    <XCircle className="h-3 w-3" /> Tolak
                  </Button>
                </>
              )}
              <Button size="sm" variant="destructive" onClick={bulkDeleteOrders} disabled={bulkDeleting} className="h-7 text-xs gap-1">
                <Trash2 className="h-3 w-3" /> {bulkDeleting ? "Menghapus..." : `Hapus (${deleteSelectedIds.size})`}
              </Button>
            </div>
          )}
        </div>
      )}

      {filteredOrders.length > 0 && (
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => copyBulkData("phone")} className="gap-1.5 text-xs">
            <Copy className="h-3 w-3" /> {copiedField === "phone" ? "✓ Disalin!" : `Salin Semua HP (${filteredOrders.length})`}
          </Button>
          {mode === "membership" && (
            <Button size="sm" variant="outline" onClick={() => copyBulkData("email")} className="gap-1.5 text-xs">
              <Copy className="h-3 w-3" /> {copiedField === "email" ? "✓ Disalin!" : `Salin Semua Email (${filteredOrders.length})`}
            </Button>
          )}
        </div>
      )}

      <div className="space-y-3">
        {filteredOrders.map((order) => (
          <div key={order.id} className={`rounded-xl border bg-card p-3 sm:p-4 ${selectedIds.has(order.id) ? "border-primary bg-primary/5" : deleteSelectedIds.has(order.id) ? "border-destructive bg-destructive/5" : "border-border"}`}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
              <div className="flex items-start gap-3 flex-1 min-w-0">
                <input
                  type="checkbox"
                  checked={deleteSelectedIds.has(order.id)}
                  onChange={() => toggleDeleteSelect(order.id)}
                  className="mt-1 rounded border-input cursor-pointer shrink-0"
                />
                <div className="flex-1 space-y-1.5 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  {order.short_id && (
                    <button
                      onClick={() => { navigator.clipboard.writeText(order.short_id!); setCopiedField("sid-" + order.id); setTimeout(() => setCopiedField(""), 1500); }}
                      className="inline-flex items-center gap-1 rounded bg-primary/15 px-1.5 py-0.5 text-[11px] font-mono font-bold text-primary cursor-pointer hover:bg-primary/25 transition-colors"
                      title="Klik untuk menyalin ID"
                    >
                      {order.short_id} {copiedField === "sid-" + order.id ? "✓" : <Copy className="h-2.5 w-2.5" />}
                    </button>
                  )}
                  <p className="font-semibold text-foreground">{shows[order.show_id]?.title || "Unknown"}</p>
                  {shows[order.show_id]?.schedule_date && (
                    <span className="text-[10px] text-muted-foreground">📅 {shows[order.show_id].schedule_date}{shows[order.show_id].schedule_time ? ` ${shows[order.show_id].schedule_time}` : ""}</span>
                  )}
                  <span className={`flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[10px] font-bold ${
                    order.status === "pending" ? "bg-[hsl(var(--warning))]/20 text-[hsl(var(--warning))]"
                    : order.status === "confirmed" ? "bg-[hsl(var(--success))]/20 text-[hsl(var(--success))]"
                    : "bg-destructive/20 text-destructive"}`}>
                    {order.status === "pending" ? <Clock className="h-2.5 w-2.5" />
                    : order.status === "confirmed" ? <CheckCircle className="h-2.5 w-2.5" />
                    : <XCircle className="h-2.5 w-2.5" />}
                    {order.status.toUpperCase()}
                  </span>
                  {order.payment_method === "coin" && (
                    <span className="flex items-center gap-1 rounded-sm bg-primary/20 px-1.5 py-0.5 text-[10px] font-bold text-primary">
                      <Coins className="h-2.5 w-2.5" /> KOIN
                    </span>
                  )}
                  {order.payment_method === "manual" && (
                    <span className="flex items-center gap-1 rounded-sm bg-accent/60 px-1.5 py-0.5 text-[10px] font-bold text-accent-foreground">
                      <UserPlus className="h-2.5 w-2.5" /> MANUAL
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <Phone className="h-3 w-3 text-muted-foreground shrink-0" />
                  {editPhones[order.id] !== undefined ? (
                    <div className="flex flex-wrap items-center gap-1">
                      <Input
                        value={editPhones[order.id]}
                        onChange={(e) => setEditPhones((prev) => ({ ...prev, [order.id]: e.target.value }))}
                        placeholder="+628xx / +60xx"
                        className="h-7 text-xs w-full max-w-[12rem]"
                      />
                      <Button size="sm" variant="outline" className="h-7 px-2" disabled={savingPhone === order.id}
                        onClick={() => savePhone(order.id)}>
                        <Save className="h-3 w-3" />
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs"
                        onClick={() => setEditPhones((prev) => { const n = { ...prev }; delete n[order.id]; return n; })}>
                        Batal
                      </Button>
                    </div>
                  ) : (
                    <>
                      <button
                        onClick={() => setEditPhones((prev) => ({ ...prev, [order.id]: order.phone || "" }))}
                        className="text-xs text-muted-foreground hover:text-foreground hover:underline transition-colors">
                        {order.phone || <span className="italic text-muted-foreground/60">Belum ada HP — klik untuk isi</span>}
                      </button>
                      {order.phone && !/^(\+?62|62|08)/.test(order.phone.replace(/[^0-9+]/g, "")) && (
                        <span className="rounded-sm bg-accent/20 px-1.5 py-0.5 text-[10px] font-bold text-accent-foreground">🌍 Internasional</span>
                      )}
                    </>
                  )}
                </div>
                {mode === "membership" && (
                  <div className="flex items-center gap-1.5">
                    <Mail className="h-3 w-3 text-muted-foreground shrink-0" />
                    {editEmails[order.id] !== undefined ? (
                      <div className="flex flex-wrap items-center gap-1">
                        <Input
                          value={editEmails[order.id]}
                          onChange={(e) => setEditEmails((prev) => ({ ...prev, [order.id]: e.target.value }))}
                          placeholder="Ketik email user..."
                          className="h-7 text-xs w-full max-w-[12rem]"
                        />
                        <Button size="sm" variant="outline" className="h-7 px-2" disabled={savingEmail === order.id}
                          onClick={() => saveEmail(order.id)}>
                          <Save className="h-3 w-3" />
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs"
                          onClick={() => setEditEmails((prev) => { const n = { ...prev }; delete n[order.id]; return n; })}>
                          Batal
                        </Button>
                      </div>
                    ) : (
                      <>
                        <button
                          onClick={() => setEditEmails((prev) => ({ ...prev, [order.id]: order.email || "" }))}
                          className="text-xs text-muted-foreground hover:text-foreground hover:underline transition-colors">
                          {order.email || <span className="italic text-muted-foreground/60">Belum ada email — klik untuk isi</span>}
                        </button>
                        {order.email && (
                          <button
                            onClick={() => { navigator.clipboard.writeText(order.email); setCopiedField("email-" + order.id); setTimeout(() => setCopiedField(""), 1500); }}
                            className="ml-1 text-xs text-primary hover:underline"
                          >
                            {copiedField === "email-" + order.id ? "✓" : <Copy className="h-3 w-3 inline" />}
                          </button>
                        )}
                      </>
                    )}
                  </div>
                )}
                <p className="text-[10px] text-muted-foreground">{new Date(order.created_at).toLocaleString("id-ID")}</p>
                {/* Membership join date & duration for confirmed orders */}
                {order.status === "confirmed" && orderTokens[order.id] && shows[order.show_id]?.is_subscription && (() => {
                  const tk = orderTokens[order.id];
                  const joinDate = tk.created_at ? new Date(tk.created_at) : new Date(order.created_at);
                  const expiryDate = tk.expires_at ? new Date(tk.expires_at) : null;
                  const daysLeft = expiryDate ? Math.max(0, Math.ceil((expiryDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24))) : null;
                  return (
                    <div className="mt-1 rounded-md bg-yellow-500/10 border border-yellow-500/20 px-2 py-1.5 space-y-0.5">
                      <p className="text-[10px] font-semibold text-yellow-600">👑 Info Membership</p>
                      <p className="text-[10px] text-muted-foreground">Bergabung: {joinDate.toLocaleDateString("id-ID")}</p>
                      {expiryDate && (
                        <p className="text-[10px] text-muted-foreground">
                          Berakhir: {expiryDate.toLocaleDateString("id-ID")} ({daysLeft} hari tersisa)
                        </p>
                      )}
                      {tk.code && <p className="text-[10px] font-mono text-primary">{tk.code}</p>}
                    </div>
                  );
                })()}
              </div>
              </div>
              <div className="flex flex-col gap-2 sm:items-end w-full sm:w-auto">
                <div className="flex gap-1">
                  {order.payment_method !== "coin" && order.payment_method !== "manual" && order.payment_proof_url && (
                    <button onClick={() => setPreviewImage(order.payment_proof_url)}
                      className="flex items-center gap-1 rounded-lg bg-secondary px-3 py-1.5 text-xs font-medium text-secondary-foreground hover:bg-secondary/80">
                      <Image className="h-3 w-3" /> Lihat Bukti
                    </button>
                  )}
                  <button onClick={() => deleteOrder(order.id)}
                    className="flex items-center gap-1 rounded-lg bg-destructive/10 px-2 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/20">
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
                {order.status === "pending" && (
                  <div className="flex gap-1">
                    <Button size="sm" variant="default" onClick={() => updateStatus(order.id, "confirmed")} disabled={confirmingId === order.id} className="h-7 text-xs">
                      <CheckCircle className="mr-1 h-3 w-3" /> {confirmingId === order.id ? "..." : "Konfirmasi"}
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => updateStatus(order.id, "rejected")} className="h-7 text-xs">
                      <XCircle className="mr-1 h-3 w-3" /> Tolak
                    </Button>
                  </div>
                )}
                {order.status === "confirmed" && (
                  <div className="w-full space-y-1.5">
                    {/* Single quick-send button for all links */}
                    <Button size="sm" variant="outline" className="h-7 w-full text-xs gap-1"
                      disabled={sendingWaAction === "all-" + order.id || !order.phone}
                      onClick={() => sendAllLinks(order)}>
                      <Send className="h-3 w-3" /> {sendingWaAction === "all-" + order.id ? "Mengirim..." : "Kirim Link & Info Show"}
                    </Button>
                    {/* Custom message */}
                    <Textarea value={waMessages[order.id] || ""} onChange={(e) => setWaMessages((prev) => ({ ...prev, [order.id]: e.target.value }))}
                      placeholder="Tulis pesan kustom untuk user ini..." className="h-16 bg-background text-xs" />
                    <Button size="sm" variant="outline" className="h-7 w-full gap-1 text-xs" disabled={!waMessages[order.id]?.trim()}
                      onClick={() => sendWhatsApp(order.phone, waMessages[order.id])}>
                      <Send className="h-3 w-3" /> Kirim via WA
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
        {filteredOrders.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">{searchQuery ? "Tidak ditemukan hasil pencarian" : "Tidak ada order"}</p>}
      </div>

      {/* Preview bukti */}
      <Dialog open={!!previewImage} onOpenChange={() => setPreviewImage(null)}>
        <DialogContent className="max-w-lg w-[95vw] max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Bukti Pembayaran</DialogTitle><DialogDescription>Preview bukti transfer</DialogDescription></DialogHeader>
          {previewImage && <img src={previewImage} alt="Bukti" className="w-full rounded-lg" />}
          <Button variant="outline" onClick={() => setPreviewImage(null)} className="w-full mt-2">
            Tutup
          </Button>
        </DialogContent>
      </Dialog>

      {/* Kirim massal per show */}
      <Dialog open={showBulk} onOpenChange={setShowBulk}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Kirim Pesan Massal per Show</DialogTitle>
            <DialogDescription>Pilih show, lalu kirim pesan ke semua pembeli yang telah dikonfirmasi via WhatsApp.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-foreground mb-1 block">Pilih Show *</label>
              <select
                value={bulkShowTarget}
                onChange={(e) => setBulkShowTarget(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
              >
                <option value="__current__">
                  {showFilter !== "all" && shows[showFilter]
                    ? `${shows[showFilter].title}${shows[showFilter].schedule_date ? ` (${shows[showFilter].schedule_date})` : ""} (filter saat ini)`
                    : "Semua show (filter saat ini)"}
                </option>
                {modeShows.map(([id, s]) => {
                  const cnt = modeOrders.filter((o) => o.show_id === id && o.status === "confirmed" && o.phone).length;
                  return (
                    <option key={id} value={id}>{s.title}{s.schedule_date ? ` (${s.schedule_date})` : ""} ({cnt} user)</option>
                  );
                })}
              </select>
            </div>
            {(() => {
              const targetOrders = bulkShowTarget === "__current__"
                ? showFiltered.filter((o) => o.status === "confirmed" && o.phone)
                : modeOrders.filter((o) => o.show_id === bulkShowTarget && o.status === "confirmed" && o.phone);
              const targetCount = targetOrders.length;
              return (
                <>
                  <p className="text-xs text-muted-foreground">📱 {targetCount} user dengan nomor HP akan menerima pesan.</p>
                  <Textarea value={bulkMessage} onChange={(e) => setBulkMessage(e.target.value)} placeholder="Tulis pesan untuk semua pembeli show ini..." className="bg-background" rows={4} />
                  <Button
                    onClick={() => {
                      targetOrders.forEach((o) => { if (bulkMessage.trim()) sendWhatsApp(o.phone, bulkMessage); });
                      toast({ title: `Mengirim ke ${targetCount} user` });
                      setShowBulk(false);
                    }}
                    disabled={!bulkMessage.trim() || targetCount === 0}
                    className="w-full gap-2"
                  >
                    <SendHorizonal className="h-4 w-4" /> Kirim ke {targetCount} User
                  </Button>
                </>
              );
            })()}
          </div>
        </DialogContent>
      </Dialog>

      {/* Tambah manual */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{mode === "membership" ? "Tambah Member Manual" : "Tambah Order Manual"}</DialogTitle>
            <DialogDescription>{mode === "membership" ? "Tambahkan user baru ke daftar membership secara manual (langsung dikonfirmasi)." : "Tambahkan order show secara manual (langsung dikonfirmasi)."}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-foreground mb-1 block">Show *</label>
              <select
                value={newOrder.show_id}
                onChange={(e) => setNewOrder((p) => ({ ...p, show_id: e.target.value }))}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
              >
                <option value="">Pilih show...</option>
                {modeShows.map(([id, s]) => (
                  <option key={id} value={id}>{s.title}{s.schedule_date ? ` — ${s.schedule_date}` : ""}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-foreground mb-1 block">
                <Phone className="inline h-3 w-3 mr-1" />Nomor WhatsApp *
              </label>
              <Input
                value={newOrder.phone}
                onChange={(e) => setNewOrder((p) => ({ ...p, phone: e.target.value }))}
                placeholder="+628xxxxxxxxxx atau +60xxxxxxxxxx"
              />
            </div>
            {mode === "membership" && (
              <div>
                <label className="text-xs font-medium text-foreground mb-1 block">
                  <Mail className="inline h-3 w-3 mr-1" />Email (opsional)
                </label>
                <Input
                  value={newOrder.email}
                  onChange={(e) => setNewOrder((p) => ({ ...p, email: e.target.value }))}
                  placeholder="user@email.com"
                />
              </div>
            )}
            <Button onClick={addManualOrder} disabled={addingOrder || !newOrder.show_id || !newOrder.phone.trim()} className="w-full gap-2">
              <UserPlus className="h-4 w-4" /> {addingOrder ? "Menyimpan..." : mode === "membership" ? "Tambah Member" : "Tambah Order"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default SubscriptionOrderManager;
