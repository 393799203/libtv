/** Read expiry only for scheduling; signature validation belongs to the server. */
export function tokenExpiresAt(token: string): number | null {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.exp === 'number' && Number.isFinite(payload.exp) ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

export const PASSWORD_HINT = '密码需至少 8 个字符，且不能超过 72 字节';

export function validNewPassword(password: string): boolean {
  return Array.from(password).length >= 8 && new TextEncoder().encode(password).length <= 72;
}
