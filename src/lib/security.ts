/**
 * Client-side security hardening.
 * Disables DevTools, right-click inspect, and common pentest shortcuts.
 * Note: These are deterrents, not foolproof protections.
 */

export function initSecurityGuard() {
  // Disable right-click context menu globally
  document.addEventListener("contextmenu", (e) => {
    e.preventDefault();
  });

  // Block common DevTools keyboard shortcuts
  document.addEventListener("keydown", (e) => {
    // F12
    if (e.key === "F12") { e.preventDefault(); return; }
    // Ctrl+Shift+I / Cmd+Opt+I (Inspect)
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "I" || e.key === "i")) { e.preventDefault(); return; }
    // Ctrl+Shift+J / Cmd+Opt+J (Console)
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "J" || e.key === "j")) { e.preventDefault(); return; }
    // Ctrl+Shift+C / Cmd+Opt+C (Element picker)
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "C" || e.key === "c")) { e.preventDefault(); return; }
    // Ctrl+U / Cmd+U (View source)
    if ((e.ctrlKey || e.metaKey) && (e.key === "U" || e.key === "u")) { e.preventDefault(); return; }
    // Ctrl+S / Cmd+S (Save page)
    if ((e.ctrlKey || e.metaKey) && (e.key === "S" || e.key === "s")) { e.preventDefault(); return; }
  });

  // NOTE: Aggressive devtools detection (debugger timing / window-size diff) caused
  // false positives for normal viewers on slow devices, mobile browsers with collapsing
  // address bars, tablets with split view, and high-DPR screens. The VideoPlayer has its
  // own conservative detector that pauses playback if devtools are truly opened.
  // Here we keep only the keyboard/context-menu deterrents above — no auto-blocking.
  const interval: ReturnType<typeof setInterval> | null = null;

  // Disable drag (prevents dragging images/elements to inspect)
  document.addEventListener("dragstart", (e) => e.preventDefault());

  // Disable text selection on the page (optional layer)
  document.addEventListener("selectstart", (e) => {
    const target = e.target as HTMLElement;
    // Allow selection in input/textarea
    if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
    e.preventDefault();
  });

  // Disable copy
  document.addEventListener("copy", (e) => {
    const target = e.target as HTMLElement;
    if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
    e.preventDefault();
  });

  return () => {
    if (interval) clearInterval(interval);
  };
}
