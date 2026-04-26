const fallbackRandom = () =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;

export const createClientId = (prefix = "id") => {
  try {
    if (typeof crypto !== "undefined") {
      if (typeof crypto.randomUUID === "function") {
        return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
      }

      if (typeof crypto.getRandomValues === "function") {
        const bytes = new Uint8Array(16);
        crypto.getRandomValues(bytes);
        return `${prefix}_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
      }
    }
  } catch {
    // Fall through to Math.random fallback for older/in-app browsers.
  }

  return `${prefix}_${fallbackRandom()}`;
};

export const safeStorageGet = (storage: Storage | undefined, key: string) => {
  try {
    return storage?.getItem(key) || null;
  } catch {
    return null;
  }
};

export const safeStorageSet = (storage: Storage | undefined, key: string, value: string) => {
  try {
    storage?.setItem(key, value);
  } catch {
    // Storage can be unavailable in strict/private mobile browsers.
  }
};

/**
 * Safe JSON.parse that never throws.
 * Returns the fallback when the input is null, empty, or malformed.
 */
export const safeJsonParse = <T,>(raw: string | null | undefined, fallback: T): T => {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return (parsed ?? fallback) as T;
  } catch {
    return fallback;
  }
};