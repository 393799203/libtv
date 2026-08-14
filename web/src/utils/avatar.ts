/** 用户头像地址：设置过头像后固定使用，未设置时用占位图 */
export function getUserAvatarSrc(user: { id?: string; nickname?: string; avatarUrl?: string } | null): string {
  if (user?.avatarUrl) return user.avatarUrl;
  return `https://picsum.photos/32/32?random=${user?.id || user?.nickname || 'user'}`;
}
