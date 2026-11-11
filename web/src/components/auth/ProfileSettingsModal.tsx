import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import { App } from 'antd';
import { CloseOutlined, CameraOutlined, LockOutlined } from '@ant-design/icons';
import { useAuthStore } from '@/stores/authStore';
import { userApi } from '@/services/userApi';
import { uploadAvatar } from '@/services/uploadApi';
import { UserAvatar } from '@/components/common/UserAvatar';
import { Z } from '@/utils/zLayers';
import { ReferralCard } from './ReferralCard';
import { PASSWORD_HINT, validNewPassword } from '@/utils/authSession';
import './profile.css';

interface ProfileSettingsModalProps {
  onClose: () => void;
}

export function ProfileSettingsModal({ onClose }: ProfileSettingsModalProps) {
  const { message } = App.useApp();
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const clearAuth = useAuthStore((s) => s.clearAuth);
  const openLoginModal = useAuthStore((s) => s.openLoginModal);
  const location = useLocation();

  // 组件由父组件条件挂载，初始值直接取当前用户信息
  const [nickname, setNickname] = useState(user?.nickname || '');
  const [avatarUrl, setAvatarUrl] = useState(user?.avatarUrl || '');
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 选择头像文件并上传
  const handleSelectAvatar = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      message.error('请选择图片文件');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      message.error('头像图片不能超过 5MB');
      return;
    }
    setAvatarUploading(true);
    try {
      const url = await uploadAvatar(file);
      setAvatarUrl(url);
    } catch {
      // HTTP 错误已由 api.ts 拦截器统一 message.error()
    } finally {
      setAvatarUploading(false);
    }
  };

  const handleSave = async () => {
    const trimmedNickname = nickname.trim();
    if (!trimmedNickname) {
      message.error('昵称不能为空');
      return;
    }

    const wantChangePassword = oldPassword || newPassword || confirmPassword;
    if (wantChangePassword) {
      if (!oldPassword) {
        message.error('请输入原密码');
        return;
      }
      if (!validNewPassword(newPassword)) {
        message.error(PASSWORD_HINT);
        return;
      }
      if (newPassword !== confirmPassword) {
        message.error('两次输入的新密码不一致');
        return;
      }
    }

    const profileChanged = trimmedNickname !== (user?.nickname || '') || avatarUrl !== (user?.avatarUrl || '');
    if (!profileChanged && !wantChangePassword) {
      message.info('没有需要保存的修改');
      return;
    }

    setSaving(true);
    try {
      // 1. 保存昵称/头像
      if (profileChanged) {
        const updated = await userApi.updateProfile({
          nickname: trimmedNickname,
          avatar_url: avatarUrl,
        });
        setUser({ nickname: updated.nickname, avatarUrl: updated.avatar_url });
      }
      // 2. 修改密码
      if (wantChangePassword) {
        await userApi.changePassword(oldPassword, newPassword);
        // 改密码后服务端已使所有旧 token 失效（含当前会话），强制重新登录
        message.success('密码已修改，请重新登录');
        sessionStorage.setItem('auth_redirect', location.pathname);
        onClose();
        clearAuth();
        openLoginModal();
        return;
      }
      message.success('保存成功');
      onClose();
    } catch {
      // HTTP 错误已由 api.ts 拦截器统一 message.error()
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ zIndex: Z.modalInline, background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => { if (e.target === e.currentTarget && !saving) onClose(); }}
    >
      <section className="profile-dialog" role="dialog" aria-modal="true" aria-labelledby="profile-title">
        <header className="profile-header">
          <div><h2 id="profile-title">个人中心</h2><p>管理资料、邀请好友与账号安全</p></div>
          <button type="button" className="profile-close" aria-label="关闭个人中心"
            onClick={() => { if (!saving) onClose(); }}><CloseOutlined /></button>
        </header>
        <div className="profile-columns">
          <section className="profile-details" aria-label="个人资料">
            <h3>个人资料</h3>
            <button type="button" className="profile-avatar" aria-label="更换头像"
              disabled={avatarUploading} onClick={() => fileInputRef.current?.click()}>
              <UserAvatar src={avatarUrl} name={nickname} alt="头像" className="h-full w-full" style={{ borderRadius: 'inherit' }} />
              <span><CameraOutlined />{avatarUploading ? '上传中' : '更换头像'}</span>
            </button>
            <p className="profile-hint">JPG / PNG / WebP · 不超过 5MB</p>
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={e => {
              const file = e.target.files?.[0]; if (file) void handleSelectAvatar(file); e.target.value = '';
            }} />
            <label htmlFor="profile-nickname">用户名（昵称）</label>
            <input id="profile-nickname" value={nickname} onChange={e => setNickname(e.target.value)}
              maxLength={50} placeholder="请输入昵称" />
            <label htmlFor="profile-email">邮箱</label>
            <input id="profile-email" value={user?.email || ''} readOnly />
            <div className="profile-balance"><span>当前积分</span><strong>{(user?.credits || 0).toLocaleString('zh-CN')}</strong></div>
          </section>
          <div className="profile-settings">
            <ReferralCard />
            <section className="profile-security" aria-label="账号安全">
              <h3><LockOutlined /> 账号安全 <span>不填则不修改密码</span></h3>
              <input type="password" value={oldPassword} onChange={e => setOldPassword(e.target.value)}
                placeholder="原密码" aria-label="原密码" autoComplete="current-password" />
              <div className="profile-password-pair">
                <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)}
                  placeholder="新密码（至少 8 个字符）" aria-label="新密码" autoComplete="new-password" />
                <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
                  placeholder="确认新密码" aria-label="确认新密码" autoComplete="new-password" />
              </div>
            </section>
          </div>
        </div>
        <footer className="profile-footer">
          <span>修改密码后需要重新登录</span>
          <button type="button" className="profile-save" onClick={() => void handleSave()} disabled={saving || avatarUploading}>
            {saving ? '保存中…' : '保存修改'}
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
