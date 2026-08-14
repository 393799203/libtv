import { useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { App } from 'antd';
import { CloseOutlined, CameraOutlined, LockOutlined } from '@ant-design/icons';
import { useAuthStore } from '@/stores/authStore';
import { userApi } from '@/services/userApi';
import { uploadAvatar } from '@/services/uploadApi';
import { getUserAvatarSrc } from '@/utils/avatar';

interface ProfileSettingsModalProps {
  onClose: () => void;
}

export function ProfileSettingsModal({ onClose }: ProfileSettingsModalProps) {
  const { message } = App.useApp();
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const logout = useAuthStore((s) => s.logout);
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
      if (newPassword.length < 6) {
        message.error('新密码至少 6 位');
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
        logout();
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

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => { if (e.target === e.currentTarget && !saving) onClose(); }}
    >
      <div
        className="relative w-full max-w-[420px] mx-4 max-h-[85vh] overflow-auto"
        style={{ background: '#fff', borderRadius: 16, boxShadow: '0 20px 60px rgba(0,0,0,0.15)' }}
      >
        <button
          onClick={(e) => { e.stopPropagation(); if (!saving) onClose(); }}
          className="absolute top-4 right-4 z-10 w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors cursor-pointer"
        >
          <CloseOutlined style={{ fontSize: 14 }} />
        </button>

        <div className="px-8 pt-8 pb-8">
          <h2 className="text-xl font-semibold text-gray-800 mb-6">个人设置</h2>

          {/* 头像 */}
          <div className="flex items-center gap-4 mb-6">
            <div
              className="relative w-16 h-16 rounded-full overflow-hidden border border-gray-200 cursor-pointer group"
              onClick={() => fileInputRef.current?.click()}
            >
              <img
                src={avatarUrl || getUserAvatarSrc(user)}
                alt="头像"
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <CameraOutlined style={{ color: '#fff', fontSize: 18 }} />
              </div>
              {avatarUploading && (
                <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                  <div className="animate-spin rounded-full w-5 h-5 border-b-2 border-white" />
                </div>
              )}
            </div>
            <div className="text-[12px] text-gray-400">
              <div className="text-gray-600 text-[13px] mb-1">点击头像更换</div>
              支持 JPG/PNG/WebP，不超过 5MB
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleSelectAvatar(f);
                  e.target.value = '';
                }}
              />
            </div>
          </div>

          {/* 昵称 */}
          <label className="block text-[13px] text-gray-500 mb-1.5">用户名（昵称）</label>
          <input
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            maxLength={50}
            placeholder="请输入昵称"
            className="w-full px-3 py-2 text-[13px] border border-gray-200 rounded-lg focus:border-blue-400 outline-none mb-1"
          />
          <div className="text-[11px] text-gray-400 mb-6">邮箱：{user?.email}</div>

          {/* 修改密码 */}
          <div className="flex items-center gap-2 text-[13px] text-gray-600 font-medium mb-3">
            <LockOutlined style={{ fontSize: 13 }} />
            修改密码
            <span className="text-[11px] text-gray-400 font-normal">（不填则不修改）</span>
          </div>
          <div className="space-y-3 mb-6">
            <input
              type="password"
              value={oldPassword}
              onChange={(e) => setOldPassword(e.target.value)}
              placeholder="原密码"
              className="w-full px-3 py-2 text-[13px] border border-gray-200 rounded-lg focus:border-blue-400 outline-none"
            />
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="新密码（至少 6 位）"
              className="w-full px-3 py-2 text-[13px] border border-gray-200 rounded-lg focus:border-blue-400 outline-none"
            />
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="确认新密码"
              className="w-full px-3 py-2 text-[13px] border border-gray-200 rounded-lg focus:border-blue-400 outline-none"
            />
          </div>

          {/* 保存按钮 */}
          <button
            onClick={handleSave}
            disabled={saving || avatarUploading}
            className="w-full py-2.5 text-sm text-white rounded-lg transition-all duration-200 hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            style={{
              background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
              border: '1px solid rgba(255,255,255,0.1)',
            }}
          >
            {saving ? '保存中...' : '保存修改'}
          </button>
        </div>
      </div>
    </div>
  );
}
