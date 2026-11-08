import { normalizeReferralCode, REFERRAL_CODE_PATTERN } from './referral';

export type AuthMode = 'login' | 'register';
const PARSE_ORIGIN = 'https://manwa.invalid';

export function isAuthPath(pathname: string): boolean {
  return ['/login', '/register'].includes(pathname.replace(/\/+$/, ''));
}

/** 登录成功只返回本站页面，拒绝外部地址和认证页面循环。 */
export function safeAuthReturnPath(path?: string | null): string {
  if (!path?.startsWith('/') || path.startsWith('//') || path.includes('\\')) return '/';
  if (Array.from(path).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) return '/';
  try {
    const url = new URL(path, PARSE_ORIGIN);
    if (url.origin !== PARSE_ORIGIN || isAuthPath(url.pathname) || url.pathname === '/reset-password') return '/';
    return url.pathname + url.search + url.hash;
  } catch {
    return '/';
  }
}

/** 登录/注册切换时保留返回位置、渠道和邀请信息。 */
export function authPagePath(mode: AuthMode, returnPath = '/', search = ''): string {
  const redirect = safeAuthReturnPath(returnPath);
  const current = new URLSearchParams(search);
  const destination = new URL(redirect, PARSE_ORIGIN).searchParams;
  const params = new URLSearchParams();
  if (redirect !== '/') params.set('redirect', redirect);
  if ((current.get('source') || destination.get('source')) === 'wasu') params.set('source', 'wasu');
  const referral = normalizeReferralCode(current.get('ref') || destination.get('ref') || '');
  if (REFERRAL_CODE_PATTERN.test(referral)) params.set('ref', referral);
  return `/${mode}${params.size ? `?${params}` : ''}`;
}
