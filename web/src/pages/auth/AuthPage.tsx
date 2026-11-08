import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { App, Form, Input } from 'antd';
import {
  LoadingOutlined,
  LockOutlined,
  MailOutlined,
  SafetyCertificateOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { BrandLogo } from '@/components/layout/BrandLogo';
import { ForgotPasswordModal } from '@/components/auth/ForgotPasswordModal';
import { useAuthStore } from '@/stores/authStore';
import { authApi } from '@/services/authApi';
import type { AuthResponse, LoginRequest, RegisterRequest } from '@/types/api';
import { savedReferralCode, clearReferralCode, normalizeReferralCode, REFERRAL_CODE_PATTERN } from '@/utils/referral';
import { authPagePath, safeAuthReturnPath } from '@/utils/authNavigation';
import { usePageMeta } from '@/hooks/usePageMeta';
import { AuthBackgroundVideo } from '@/components/auth/AuthBackgroundVideo';
import './authPage.css';

type AuthFormValues = LoginRequest &
  Partial<RegisterRequest> & {
    confirmPassword?: string;
  };

export default function AuthPage() {
  const { message } = App.useApp();
  const location = useLocation();
  const authMode = location.pathname === '/register' ? 'register' : 'login';
  const authenticated = useAuthStore((s) => s.isAuthenticated);
  const initialized = useAuthStore((s) => s.isInitialized);
  const setAuth = useAuthStore((s) => s.setAuth);
  const navigate = useNavigate();
  const params = new URLSearchParams(location.search);
  const returnPath = safeAuthReturnPath(params.get('redirect') || sessionStorage.getItem('auth_redirect'));
  const loginPath = authPagePath('login', returnPath, location.search);
  const registerPath = authPagePath('register', returnPath, location.search);
  usePageMeta({ title: authMode === 'login' ? '登录' : '注册', noindex: true });
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm<AuthFormValues>();
  // 「忘记密码」弹窗：叠在登录框之上（zIndex 更高），关掉后仍回到登录框
  const [forgotOpen, setForgotOpen] = useState(false);
  // 打开时把登录框里已填的邮箱存下来带过去。存成 state 而不是每次渲染现取，
  // 是为了让这个值只在「打开的那一刻」确定 —— 否则登录框因别的原因重渲染时，
  // 新值会顺着 props 变化触发子组件重置表单，把用户正在输入的邮箱冲掉
  const [forgotEmail, setForgotEmail] = useState('');

  const handleSubmit = async (values: AuthFormValues) => {
    setLoading(true);
    try {
      let response: AuthResponse;
      if (authMode === 'login') {
        response = await authApi.login({
          email: values.email,
          password: values.password,
        });
      } else {
        const source = new URLSearchParams(window.location.search).get('source');
        response = await authApi.register({
          email: values.email,
          password: values.password,
          nickname: values.nickname || '',
          channel: source === 'wasu' ? 'wasu' : 'dianxin',
          referralCode: normalizeReferralCode(values.referralCode || '') || undefined,
        });
      }

      setAuth(response);
      clearReferralCode();
      message.success(authMode === 'login' ? '登录成功' : '注册成功');
      form.resetFields();
      sessionStorage.removeItem('auth_redirect');
      navigate(returnPath, { replace: true });
    } catch {
      // HTTP 错误已由 api.ts 拦截器统一 message.error()
    } finally {
      setLoading(false);
    }
  };

  if (initialized && authenticated) return <Navigate to={returnPath} replace />;

  return (
    <main className="auth-page">
      <aside className="auth-page-scene" aria-label="创作影像">
        <AuthBackgroundVideo />
        <div className="auth-page-scene-content">
          <Link to="/" aria-label="漫蛙首页" className="auth-page-brand">
            <BrandLogo size={36} wordClass="h-[24px]" />
          </Link>
          <div className="auth-page-story">
            <h2>让想象，<br />成为下一幕。</h2>
            <p>从一句灵感开始，写下故事、构建分镜，让画面继续发生。</p>
          </div>
        </div>
      </aside>
      <section className="auth-page-panel forest-auth-panel" aria-labelledby="forest-auth-title">
        <header className="auth-page-header">
          <Link to="/" aria-label="漫蛙首页" className="auth-page-mobile-brand">
            <BrandLogo size={30} wordClass="h-[20px]" />
          </Link>
        </header>
        <div className="auth-page-form-area">
          <div className="auth-page-form-shell">
                <div className="forest-auth-tabs mb-8" role="tablist" aria-label="登录或注册">
                  <Link
                    to={loginPath}
                    replace
                    role="tab"
                    aria-selected={authMode === 'login'}
                    className={authMode === 'login' ? 'is-active' : ''}
                  >
                    登录
                  </Link>
                  <Link
                    to={registerPath}
                    replace
                    role="tab"
                    aria-selected={authMode === 'register'}
                    className={authMode === 'register' ? 'is-active' : ''}
                  >
                    注册
                  </Link>
                </div>

                <div className="mb-7">
                  <h1 id="forest-auth-title" className="text-[26px] font-semibold tracking-[-0.03em] text-white">
                    {authMode === 'login' ? '欢迎回来' : '创建你的账号'}
                  </h1>
                  <p className="auth-page-description mt-3 text-[14px] leading-7">
                    {authMode === 'login'
                      ? '登录漫蛙，继续你的 AI 视频创作。'
                      : '创建漫蛙账号，开始你的 AI 视频创作。'}
                  </p>
                </div>

                <Form<AuthFormValues>
                  form={form}
                  layout="vertical"
                  onFinish={handleSubmit}
                  initialValues={{ referralCode: normalizeReferralCode(params.get('ref') || savedReferralCode()) }}
                  requiredMark={false}
                  className="forest-auth-form"
                >
                  <Form.Item
                    label="邮箱地址"
                    name="email"
                    rules={[
                      { required: true, message: '请输入邮箱' },
                      { type: 'email', message: '请输入有效的邮箱地址' },
                    ]}
                  >
                    <Input
                      prefix={<MailOutlined />}
                      placeholder="name@example.com"
                      size="large"
                      autoComplete="email"
                    />
                  </Form.Item>

                  {authMode === 'register' && (
                    <Form.Item
                      label="昵称"
                      name="nickname"
                      rules={[{ required: true, message: '请输入昵称' }]}
                    >
                      <Input
                        prefix={<UserOutlined />}
                        placeholder="你希望被怎样称呼"
                        size="large"
                        autoComplete="nickname"
                      />
                    </Form.Item>
                  )}

                  <Form.Item
                    label="密码"
                    name="password"
                    rules={
                      authMode === 'login'
                        ? [{ required: true, message: '请输入密码' }]
                        : [
                            { required: true, message: '请输入密码' },
                            { min: 6, message: '密码至少 6 位' },
                          ]
                    }
                  >
                    <Input.Password
                      prefix={<LockOutlined />}
                      placeholder={authMode === 'login' ? '输入密码' : '至少 6 位字符'}
                      size="large"
                      autoComplete={authMode === 'login' ? 'current-password' : 'new-password'}
                    />
                  </Form.Item>

                  {/* 忘记密码入口：只在登录态出现（注册时还没有密码可忘）。
                      -mt-3 抵掉 Form.Item 的下外边距，避免密码框与按钮之间空出一大块 */}
                  {authMode === 'login' && (
                    <div className="-mt-3 mb-1 flex justify-end">
                      <button
                        type="button"
                        onClick={() => {
                          setForgotEmail(form.getFieldValue('email') || '');
                          setForgotOpen(true);
                        }}
                        className="auth-page-forgot"
                      >
                        忘记密码？
                      </button>
                    </div>
                  )}

                  {authMode === 'register' && (
                    <Form.Item
                      label="确认密码"
                      name="confirmPassword"
                      dependencies={['password']}
                      rules={[
                        { required: true, message: '请确认密码' },
                        ({ getFieldValue }) => ({
                          validator(_, value) {
                            if (!value || getFieldValue('password') === value) return Promise.resolve();
                            return Promise.reject(new Error('两次密码不一致'));
                          },
                        }),
                      ]}
                    >
                      <Input.Password
                        prefix={<SafetyCertificateOutlined />}
                        placeholder="再次输入密码"
                        size="large"
                        autoComplete="new-password"
                      />
                    </Form.Item>
                  )}

                  {authMode === 'register' && (
                    <Form.Item label="推荐码（选填）" name="referralCode" normalize={normalizeReferralCode}
                      rules={[{ pattern: REFERRAL_CODE_PATTERN, message: '请输入16位推荐码，或留空直接注册' }]}>
                      <Input maxLength={16} placeholder="由好友提供，邀请链接会自动填入" autoComplete="off" />
                    </Form.Item>
                  )}
                  <Form.Item className={authMode === 'login' ? '!mb-0 !mt-7' : '!mb-0 !mt-5'}>
                    <button
                      type="submit"
                      disabled={loading || !initialized}
                      className="forest-auth-submit flex h-12 w-full items-center justify-center gap-2 rounded-xl text-sm font-medium tracking-[0.08em] text-[#21150c]"
                    >
                      {loading && <LoadingOutlined spin />}
                      {loading
                        ? authMode === 'login'
                          ? '正在登录…'
                          : '正在创建账号…'
                        : authMode === 'login'
                          ? '进入创作空间'
                          : '创建账号'}
                    </button>
                  </Form.Item>
                </Form>

                <div className="auth-page-switch mt-6 flex items-center justify-center gap-1 text-[13px]">
                  <span>{authMode === 'login' ? '还没有账号？' : '已经有账号？'}</span>
                  <Link
                    to={authMode === 'login' ? registerPath : loginPath}
                    replace
                    className="font-medium text-amber-200/80 transition-colors hover:text-amber-100"
                  >
                    {authMode === 'login' ? '立即注册' : '直接登录'}
                  </Link>
                </div>

                <div className="auth-page-security mt-9 flex items-start gap-2 border-t border-white/[0.08] pt-5 text-[12px] leading-6">
                  <SafetyCertificateOutlined className="mt-0.5 shrink-0 text-amber-200/45" />
                  <span>账号信息仅用于身份验证和创作空间同步，我们会妥善保护你的数据。</span>
                </div>
          </div>
        </div>
      </section>

      {/* 找回密码仍保留为独立流程，关闭后回到当前登录页面。 */}
      {forgotOpen && (
        <ForgotPasswordModal
          onClose={() => setForgotOpen(false)}
          defaultEmail={forgotEmail}
        />
      )}
    </main>
  );
}
