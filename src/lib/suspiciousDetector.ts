import { reportSuspiciousActivity } from './suspiciousActivity';

// Auto-detect suspicious frontend activity
const trackers = new Map<string, number[]>();

function track(key: string, windowMs: number, maxCount: number): boolean {
  const now = Date.now();
  const times = trackers.get(key) || [];
  const recent = times.filter(t => now - t < windowMs);
  recent.push(now);
  trackers.set(key, recent);
  return recent.length > maxCount;
}

/** Call on every failed login attempt */
export function trackFailedLogin(userId?: string) {
  const key = 'failed_login';
  if (track(key, 600_000, 8)) { // 8 fails in 10 min
    if (userId) {
      reportSuspiciousActivity({
        userId,
        activityType: 'rapid_login_attempts',
        severity: 'high',
        description: 'Terlalu banyak percobaan login gagal dalam waktu singkat',
        metadata: { count: trackers.get(key)?.length },
      });
    }
    return true;
  }
  return false;
}

/** Call when rapid API calls are detected */
export function trackRapidApiCalls(userId: string) {
  const key = `api_${userId}`;
  if (track(key, 60_000, 50)) { // 50 calls in 1 min
    reportSuspiciousActivity({
      userId,
      activityType: 'rapid_api_calls',
      severity: 'medium',
      description: 'Jumlah request API sangat tinggi dalam waktu singkat',
      metadata: { count: trackers.get(key)?.length },
    });
    return true;
  }
  return false;
}

/** Call when multiple tabs are detected */
export function trackMultipleTabs(userId: string) {
  const key = `tabs_${userId}`;
  if (track(key, 60_000, 20)) {
    reportSuspiciousActivity({
      userId,
      activityType: 'multiple_tab_abuse',
      severity: 'low',
      description: 'Membuka terlalu banyak tab secara bersamaan',
    });
    return true;
  }
  return false;
}

let _tabCheckInitialized = false;

/** Initialize passive suspicious activity detectors */
export function initSuspiciousDetectors(userId: string) {
  if (_tabCheckInitialized) return;
  _tabCheckInitialized = true;

  // Detect rapid page visibility changes (multiple tab switching)
  let visChanges = 0;
  document.addEventListener('visibilitychange', () => {
    visChanges++;
    if (visChanges > 30) {
      trackMultipleTabs(userId);
      visChanges = 0; // reset to avoid spamming
    }
  });

  // Detect copy attempts on sensitive data (passwords, tokens)
  document.addEventListener('copy', () => {
    // benign — just track frequency
    const key = `copy_${userId}`;
    track(key, 60_000, 100); // only flag extreme cases
  });
}
