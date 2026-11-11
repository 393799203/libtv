/** Real avatars stay unchanged; a local initial avoids unrelated random photos
 * and a third-party request for every user without an uploaded avatar. */
export function getUserAvatarSrc(user: { id?: string; nickname?: string; avatarUrl?: string } | null): string {
  if (user?.avatarUrl) return user.avatarUrl;
  const initial = Array.from(user?.nickname?.trim() || '用户')[0]
    .replace(/[<>&"']/g, char => `&#${char.charCodeAt(0)};`);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" rx="32" fill="#303b42"/><text x="32" y="33" dy=".35em" text-anchor="middle" fill="#e5edf0" font-family="system-ui,sans-serif" font-size="28">${initial}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** Only our storage host gets a /media fallback. Preserve third-party and
 * signed URLs exactly, including their query parameters. */
export function avatarRequestSrc(source: string, attempt: number, retryKey: string): string {
  if (attempt === 0 || !source || /^(data:|blob:)/i.test(source)) return source;
  let candidate = source;
  try {
    const url = new URL(source, 'https://avatar.invalid');
    if (url.hostname === 'manwa.huadong-1.ctyunzos.cn') candidate = `/media${url.pathname}`;
  } catch { return source; }
  if (!candidate.startsWith('/media/')) return candidate;
  const url = new URL(candidate, 'https://avatar.invalid');
  url.searchParams.set('_avatar_retry', `${retryKey}-${attempt}`);
  return url.pathname + url.search;
}
