import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Form, Input, App } from 'antd';
import { MailOutlined, LockOutlined, UserOutlined, VideoCameraOutlined, CloseOutlined } from '@ant-design/icons';
import { useAuthStore } from '@/stores/authStore';
import { authApi } from '@/services/authApi';
import type { LoginRequest, RegisterRequest } from '@/types/api';

export function LoginModal() {
  const { message } = App.useApp();
  const showLoginModal = useAuthStore((s) => s.showLoginModal);
  const authMode = useAuthStore((s) => s.authMode);
  const setAuth = useAuthStore((s) => s.setAuth);
  const closeLoginModal = useAuthStore((s) => s.closeLoginModal);
  const setAuthMode = useAuthStore((s) => s.setAuthMode);
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);

  const [form] = Form.useForm<LoginRequest & RegisterRequest>();

  const handleLogin = async (values: LoginRequest) => {
    setLoading(true);
    try {
      const response = await authApi.login(values);
      setAuth(response as unknown as import('@/types/api').AuthResponse);
      message.success('登录成功');
      closeLoginModal();
      form.resetFields();
      const redirect = sessionStorage.getItem('auth_redirect');
      if (redirect) {
        sessionStorage.removeItem('auth_redirect');
        navigate(redirect, { replace: true });
      }
    } catch {
      message.error('登录失败，请检查邮箱和密码');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (values: RegisterRequest) => {
    setLoading(true);
    try {
      const response = await authApi.register(values);
      setAuth(response as unknown as import('@/types/api').AuthResponse);
      message.success('注册成功');
      closeLoginModal();
      form.resetFields();
      const redirect = sessionStorage.getItem('auth_redirect');
      if (redirect) {
        sessionStorage.removeItem('auth_redirect');
        navigate(redirect, { replace: true });
      }
    } catch {
      message.error('注册失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (showLoginModal) {
      form.resetFields();
      setLoading(false);
    }
  }, [authMode, showLoginModal, form]);

  if (!showLoginModal) return null;

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) closeLoginModal(); }}
    >
      <div
        className="relative w-full max-w-[400px] mx-4"
        style={{
          background: '#fff',
          borderRadius: 16,
          boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
        }}
      >
        {/* 关闭按钮 - z-index 确保在最上层 */}
        <button
          onClick={(e) => { e.stopPropagation(); closeLoginModal(); }}
          className="absolute top-4 right-4 z-10 w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
        >
          <CloseOutlined style={{ fontSize: 14 }} />
        </button>

        <div className="px-8 pt-10 pb-8">
          {/* Logo + 标题 */}
          <div className="text-center mb-8">
            <div
              className="inline-flex items-center justify-center w-12 h-12 rounded-2xl mb-4"
              style={{
                background: 'linear-gradient(135deg, #667eea, #764ba2)',
              }}
            >
              <VideoCameraOutlined style={{ fontSize: 22, color: '#fff' }} />
            </div>
            <h2 className="text-gray-900 text-xl font-semibold mb-1">
              {authMode === 'login' ? '欢迎回来' : '创建账号'}
            </h2>
            <p className="text-gray-400 text-xs">
              {authMode === 'login' ? '登录 LibTV，开启 AI 视频创作' : '注册账号，开始你的创作之旅'}
            </p>
          </div>

          {authMode === 'login' ? (
            <Form form={form} layout="vertical" onFinish={handleLogin} requiredMark={false}>
              <Form.Item
                name="email"
                rules={[
                  { required: true, message: '请输入邮箱' },
                  { type: 'email', message: '请输入有效的邮箱地址' },
                ]}
              >
                <Input
                  prefix={<MailOutlined style={{ color: '#bbb' }} />}
                  placeholder="邮箱地址"
                  size="large"
                  style={{ borderRadius: 10, height: 46 }}
                />
              </Form.Item>
              <Form.Item
                name="password"
                rules={[{ required: true, message: '请输入密码' }]}
              >
                <Input.Password
                  prefix={<LockOutlined style={{ color: '#bbb' }} />}
                  placeholder="密码"
                  size="large"
                  style={{ borderRadius: 10, height: 46 }}
                />
              </Form.Item>
              <Form.Item className="!mb-0 !mt-6">
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full h-[46px] text-white text-sm font-medium tracking-wider rounded-xl transition-all duration-200 disabled:opacity-50"
                  style={{
                    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                    border: 'none',
                    cursor: loading ? 'not-allowed' : 'pointer',
                    boxShadow: '0 4px 16px rgba(102,126,234,0.35)',
                  }}
                >
                  {loading ? '登录中...' : '登 录'}
                </button>
              </Form.Item>
            </Form>
          ) : (
            <Form form={form} layout="vertical" onFinish={handleRegister} requiredMark={false}>
              <Form.Item
                name="email"
                rules={[
                  { required: true, message: '请输入邮箱' },
                  { type: 'email', message: '请输入有效的邮箱地址' },
                ]}
              >
                <Input
                  prefix={<MailOutlined style={{ color: '#bbb' }} />}
                  placeholder="邮箱地址"
                  size="large"
                  style={{ borderRadius: 10, height: 46 }}
                />
              </Form.Item>
              <Form.Item
                name="nickname"
                rules={[{ required: true, message: '请输入昵称' }]}
              >
                <Input
                  prefix={<UserOutlined style={{ color: '#bbb' }} />}
                  placeholder="昵称"
                  size="large"
                  style={{ borderRadius: 10, height: 46 }}
                />
              </Form.Item>
              <Form.Item
                name="password"
                rules={[
                  { required: true, message: '请输入密码' },
                  { min: 6, message: '密码至少6位' },
                ]}
              >
                <Input.Password
                  prefix={<LockOutlined style={{ color: '#bbb' }} />}
                  placeholder="密码（至少6位）"
                  size="large"
                  style={{ borderRadius: 10, height: 46 }}
                />
              </Form.Item>
              <Form.Item
                name="confirmPassword"
                dependencies={['password']}
                rules={[
                  { required: true, message: '请确认密码' },
                  ({ getFieldValue }) => ({
                    validator(_, value) {
                      if (!value || getFieldValue('password') === value) {
                        return Promise.resolve();
                      }
                      return Promise.reject(new Error('两次密码不一致'));
                    },
                  }),
                ]}
              >
                <Input.Password
                  prefix={<LockOutlined style={{ color: '#bbb' }} />}
                  placeholder="确认密码"
                  size="large"
                  style={{ borderRadius: 10, height: 46 }}
                />
              </Form.Item>
              <Form.Item className="!mb-0 !mt-6">
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full h-[46px] text-white text-sm font-medium tracking-wider rounded-xl transition-all duration-200 disabled:opacity-50"
                  style={{
                    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                    border: 'none',
                    cursor: loading ? 'not-allowed' : 'pointer',
                    boxShadow: '0 4px 16px rgba(102,126,234,0.35)',
                  }}
                >
                  {loading ? '注册中...' : '注 册'}
                </button>
              </Form.Item>
            </Form>
          )}

          {/* 底部切换 */}
          <div className="text-center mt-6 pt-5 border-t border-gray-100">
            <span className="text-gray-400 text-sm">
              {authMode === 'login' ? '还没有账号？' : '已有账号？'}
            </span>
            <span
              className="text-sm ml-1 cursor-pointer font-medium"
              style={{ color: '#667eea' }}
              onClick={() => setAuthMode(authMode === 'login' ? 'register' : 'login')}
            >
              {authMode === 'login' ? '立即注册' : '立即登录'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
