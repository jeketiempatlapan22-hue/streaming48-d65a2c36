/**
 * PWA Push Notification helper
 * Uses the browser Notification API to send local notifications
 * for show reminders. No server-side push needed.
 */

const REMINDER_KEY = "rt48-show-reminders";

interface ShowReminder {
  showId: string;
  title: string;
  scheduleTime: number; // epoch ms
  notified: boolean;
}

export function isNotificationSupported(): boolean {
  return "Notification" in window;
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (!isNotificationSupported()) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  const result = await Notification.requestPermission();
  return result === "granted";
}

export function getNotificationPermission(): NotificationPermission | "unsupported" {
  if (!isNotificationSupported()) return "unsupported";
  return Notification.permission;
}

function getReminders(): ShowReminder[] {
  try {
    return JSON.parse(localStorage.getItem(REMINDER_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveReminders(reminders: ShowReminder[]) {
  localStorage.setItem(REMINDER_KEY, JSON.stringify(reminders));
}

export function addShowReminder(showId: string, title: string, scheduleTime: number): boolean {
  const reminders = getReminders();
  if (reminders.some(r => r.showId === showId)) return false; // already set
  reminders.push({ showId, title, scheduleTime, notified: false });
  saveReminders(reminders);
  return true;
}

export function removeShowReminder(showId: string) {
  const reminders = getReminders().filter(r => r.showId !== showId);
  saveReminders(reminders);
}

export function hasReminder(showId: string): boolean {
  return getReminders().some(r => r.showId === showId);
}

export function sendNotification(title: string, body: string, icon?: string) {
  if (Notification.permission !== "granted") return;
  try {
    new Notification(title, {
      body,
      icon: icon || "/logo.png",
      badge: "/logo.png",
      tag: `rt48-${Date.now()}`,
    });
  } catch {
    // Some browsers don't support Notification constructor from page context
  }
}

/**
 * Check all pending reminders and fire notifications for shows
 * starting within the next 30 minutes
 */
export function checkAndFireReminders() {
  if (Notification.permission !== "granted") return;
  const reminders = getReminders();
  const now = Date.now();
  let changed = false;

  reminders.forEach(r => {
    if (r.notified) return;
    const timeUntil = r.scheduleTime - now;
    // Notify 30 minutes before
    if (timeUntil > 0 && timeUntil <= 30 * 60 * 1000) {
      const mins = Math.round(timeUntil / 60000);
      sendNotification(
        `🎬 ${r.title}`,
        `Show dimulai dalam ${mins} menit! Siapkan dirimu.`,
      );
      r.notified = true;
      changed = true;
    }
    // Notify at start time
    if (timeUntil <= 0 && timeUntil > -5 * 60 * 1000 && !r.notified) {
      sendNotification(
        `🔴 ${r.title} LIVE!`,
        `Show sedang berlangsung sekarang!`,
      );
      r.notified = true;
      changed = true;
    }
  });

  if (changed) {
    // Clean up old reminders (>1 hour past)
    const cleaned = reminders.filter(r => r.scheduleTime > now - 3600000);
    saveReminders(cleaned);
  }
}

/**
 * Start a periodic reminder checker (every 60s)
 */
let reminderInterval: ReturnType<typeof setInterval> | null = null;

export function startReminderChecker() {
  if (reminderInterval) return;
  checkAndFireReminders();
  reminderInterval = setInterval(checkAndFireReminders, 60_000);
}

export function stopReminderChecker() {
  if (reminderInterval) {
    clearInterval(reminderInterval);
    reminderInterval = null;
  }
}
