// Shared edge function rate limiting and origin validation utilities
// Used by edge functions for consistent protection

export const ALLOWED_ORIGINS = [
  'https://streaming48.lovable.app',
  'https://id-preview--4387c5bf-8d85-41f4-b11e-91993da6d859.lovable.app',
  'http://localhost:5173',
  'http://localhost:8080',
];

export function validateOrigin(req: Request, origins: string[]): boolean {
  const origin = req.headers.get('origin') || req.headers.get('referer') || '';
  if (!origin) return true; // Allow non-browser requests (e.g. cron, bots)
  return origins.some(o => origin.startsWith(o));
}
