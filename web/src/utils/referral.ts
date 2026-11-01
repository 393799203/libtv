const REFERRAL_KEY = 'libtv_referral_code';
export const REFERRAL_CODE_PATTERN = /^[0-9A-F]{16}$/;
export const normalizeReferralCode = (value: string) => value.trim().toUpperCase();

export function captureReferralCode(search: string): string {
  const code = normalizeReferralCode(new URLSearchParams(search).get('ref') || '');
  if (!REFERRAL_CODE_PATTERN.test(code)) return '';
  try { sessionStorage.setItem(REFERRAL_KEY, code); } catch { /* Manual entry remains available. */ }
  return code;
}
export function savedReferralCode(): string {
  try { return sessionStorage.getItem(REFERRAL_KEY) || ''; } catch { return ''; }
}
export function clearReferralCode(): void {
  try { sessionStorage.removeItem(REFERRAL_KEY); } catch { /* No stored attribution. */ }
}
export function referralLink(code: string, origin = window.location.origin): string {
  const url = new URL('/', origin);
  url.searchParams.set('ref', code);
  return url.href;
}
