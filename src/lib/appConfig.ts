/** Canonical public URL for the app — used in all generated links */
export const APP_URL = 'https://realtime48stream.my.id';
export const url = (path = '/') => `${APP_URL}/${path.replace(/^\/+/, '')}`;
