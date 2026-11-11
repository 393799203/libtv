import { useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Alert, App, Checkbox, Form, Input } from 'antd';
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
import { clearReferralCode, normalizeReferralCode } from '@/utils/referral';
import { authPagePath } from '@/utils/authNavigation';
import { usePageMeta } from '@/hooks/usePageMeta';
import { AuthBackgroundVideo } from '@/components/auth/AuthBackgroundVideo';
import { PASSWORD_HINT, validNewPassword } from '@/utils/authSession';
import './authPage.css';

type AuthFormValues = LoginRequest &
  Partial<RegisterRequest> & {
    confirmPassword?: string;
  };

export default function AuthPage() {
  const { pathname } = useLocation();
  return <AuthPageForm key={pathname} />;
}

function AuthPageForm() {
  const { message } = App.useApp();
  const location = useLocation();
  const authMode = location.pathname === '/register' ? 'register' : 'login';
  const authenticated = useAuthStore((s) => s.isAuthenticated);
  const initialized = useAuthStore((s) => s.isInitialized);
  const setAuth = useAuthStore((s) => s.setAuth);
  const navigate = useNavigate();
  const params = new URLSearchParams(location.search);
  const returnPath = '/';
  const loginPath = authPagePath('login', returnPath, location.search);
  const registerPath = authPagePath('register', returnPath, location.search);
  usePageMeta({ title: authMode === 'login' ? '登录' : '注册', noindex: true });
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm<AuthFormValues>();
  const [error, setError] = useState('');
  const [sendingCode, setSendingCode] = useState(false);
  const [resendAt, setResendAt] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(0);
  useEffect(() => {
    if (!resendAt) return;
    const update = () => setSecondsLeft(Math.max(0, Math.ceil((resendAt - Date.now()) / 1000)));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [resendAt]);
  // 「忘记密码」弹窗：叠在登录框之上（zIndex 更高），关掉后仍回到登录框
  const [forgotOpen, setForgotOpen] = useState(false);
  // 打开时把登录框里已填的邮箱存下来带过去。存成 state 而不是每次渲染现取，
  // 是为了让这个值只在「打开的那一刻」确定 —— 否则登录框因别的原因重渲染时，
  // 新值会顺着 props 变化触发子组件重置表单，把用户正在输入的邮箱冲掉
  const [forgotEmail, setForgotEmail] = useState('');

  const handleSubmit = async (values: AuthFormValues) => {
    setLoading(true);
    setError('');
    try {
      let response: AuthResponse;
      if (authMode === 'login') {
        response = await authApi.login({
          email: values.email.trim(),
          password: values.password,
          remember_me: values.remember_me ?? false,
        });
      } else {
        const source = new URLSearchParams(window.location.search).get('source');
        const registration = await authApi.register({
          email: values.email.trim(),
          password: values.password,
          nickname: values.nickname || '',
          channel: source === 'wasu' ? 'wasu' : 'dianxin',
          referralCode: normalizeReferralCode(params.get('ref') || '') || undefined,
          code: values.code || '',
        });
        if ('login_required' in registration) {
          message.success('账号已创建，请使用新账号登录');
          navigate(loginPath, { replace: true });
          return;
        }
        response = registration;
      }

      setAuth(response);
      clearReferralCode();
      message.success(authMode === 'login' ? '登录成功' : '注册成功');
      form.resetFields();
      sessionStorage.removeItem('auth_redirect');
      navigate(returnPath, { replace: true });
    } catch (cause) {
      const failure = cause as { response?: { data?: { msg?: string } }; message?: string };
      setError(failure.response?.data?.msg || failure.message || '暂时无法提交，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  const sendCode = async () => {
    try {
      await form.validateFields(['email']);
    } catch { return; }
    setSendingCode(true);
    setError('');
    try {
      const result = await authApi.sendRegistrationCode(form.getFieldValue('email').trim());
      setResendAt(Date.now() + result.retry_after * 1000);
      message.success('验证码已发送，10 分钟内有效，请查收邮箱');
      form.getFieldInstance('code')?.focus();
    } catch (cause) {
      const failure = cause as { response?: { data?: { msg?: string } }; message?: string };
      setError(failure.response?.data?.msg || failure.message || '验证码发送失败，请重试');
    } finally {
      setSendingCode(false);
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
                  initialValues={{ remember_me: false }}
                  onValuesChange={changed => {
                    setError('');
                    if ('email' in changed) form.setFieldValue('code', '');
                  }}
                  requiredMark={false}
                  className="forest-auth-form"
                >
                  <Form.Item
                    label="邮箱地址"
                    name="email"
                    normalize={value => value.trim()}
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
                      inputMode="email"
                      maxLength={255}
                    />
                  </Form.Item>

                  {authMode === 'register' && (
                    <Form.Item label="邮箱验证码" required>
                      <div className="auth-code-row">
                        <Form.Item
                          name="code"
                          noStyle
                          rules={[{ required: true, message: '请输入邮箱验证码' }, { pattern: /^\d{6}$/, message: '请输入 6 位数字验证码' }]}
                        >
                          <Input
                            aria-label="邮箱验证码"
                            placeholder="6 位数字"
                            inputMode="numeric"
                            autoComplete="one-time-code"
                            maxLength={6}
                            size="large"
                          />
                        </Form.Item>
                        <button type="button" className="auth-code-send" onClick={sendCode}
                          disabled={sendingCode || secondsLeft > 0 || loading}>
                          {sendingCode ? '正在发送…' : secondsLeft > 0 ? `${secondsLeft} 秒后重发` : '发送验证码'}
                        </button>
                      </div>
                      <span className="auth-field-hint">验证码 10 分钟内有效；未收到时请检查垃圾邮件。</span>
                    </Form.Item>
                  )}

                  {authMode === 'register' && (
                    <Form.Item
                      label="昵称"
                      name="nickname"
                      normalize={value => value.trim()}
                      rules={[{ required: true, message: '请输入昵称' }, { max: 50, message: '昵称不能超过 50 个字符' }]}
                    >
                      <Input
                        prefix={<UserOutlined />}
                        placeholder="你希望被怎样称呼"
                        size="large"
                        autoComplete="nickname"
                        maxLength={50}
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
                            { validator: (_, value) => !value || validNewPassword(value)
                              ? Promise.resolve() : Promise.reject(new Error(PASSWORD_HINT)) },
                          ]
                    }
                  >
                    <Input.Password
                      prefix={<LockOutlined />}
                      placeholder={authMode === 'login' ? '输入密码' : '至少 8 个字符'}
                      size="large"
                      autoComplete={authMode === 'login' ? 'current-password' : 'new-password'}
                    />
                  </Form.Item>

                  {/* 忘记密码入口：只在登录态出现（注册时还没有密码可忘）。
                      -mt-3 抵掉 Form.Item 的下外边距，避免密码框与按钮之间空出一大块 */}
                  {authMode === 'login' && (
                    <div className="auth-login-options">
                      <Form.Item name="remember_me" valuePropName="checked" noStyle>
                        <Checkbox>记住我 30 天</Checkbox>
                      </Form.Item>
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
                  {authMode === 'login' && <p className="auth-field-hint">未勾选时登录最长保留 24 小时。请勿在公共设备上勾选。</p>}

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

                  {error && <Alert type="error" title={error} showIcon role="alert" className="auth-form-error" />}
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
