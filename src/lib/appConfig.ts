/** Canonical public URL for the app — used in all generated links */
export const APP_URL = 'https://realtime48stream.my.id';
/** Canonical replay URL */
export const REPLAY_URL = 'https://replaytime.lovable.app';
export const url = (path = '/') => `${APP_URL}/${path.replace(/^\/+/, '')}`;

/**
 * Build a replay URL with optional auto-fill password (legacy, fallback).
 * The replay site reads ?password=...&auto=1 and auto-submits the form.
 */
export const buildReplayUrl = (password?: string | null): string => {
  if (!password || password === "__purchased__") return REPLAY_URL;
  const params = new URLSearchParams({ password, auto: "1" });
  return `${REPLAY_URL}/?${params.toString()}`;
};

/**
 * Build a replay URL using a one-time access token (Solusi 2: Shared Backend).
 * Replay site reads ?access_token=... and exchanges it via verify-replay-access edge fn.
 */
export const buildReplayAccessUrl = (accessToken: string): string => {
  const params = new URLSearchParams({ access_token: accessToken, auto: "1" });
  return `${REPLAY_URL}/?${params.toString()}`;
};
