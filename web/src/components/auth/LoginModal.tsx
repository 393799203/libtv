import { lazy, Suspense, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { App, Form, Input } from 'antd';
import {
  CloseOutlined,
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
import { Z } from '@/utils/zLayers';

const ForestCabinScene = lazy(() => import('@/components/auth/ForestCabinScene'));

type AuthFormValues = LoginRequest &
  Partial<RegisterRequest> & {
    confirmPassword?: string;
  };

export function LoginModal() {
  const { message } = App.useApp();
  const showLoginModal = useAuthStore((s) => s.showLoginModal);
  const authMode = useAuthStore((s) => s.authMode);
  const setAuth = useAuthStore((s) => s.setAuth);
  const closeLoginModal = useAuthStore((s) => s.closeLoginModal);
  const setAuthMode = useAuthStore((s) => s.setAuthMode);
  const navigate = useNavigate();
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
        });
      }

      setAuth(response);
      message.success(authMode === 'login' ? '登录成功' : '注册成功');
      closeLoginModal();
      form.resetFields();
      const redirect = sessionStorage.getItem('auth_redirect');
      if (redirect) {
        sessionStorage.removeItem('auth_redirect');
        navigate(redirect, { replace: true });
      }
    } catch {
      // HTTP 错误已由 api.ts 拦截器统一 message.error()
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (showLoginModal) {
      form.resetFields();
      setLoading(false);
    } else {
      // 登录框关了就把找回密码弹窗一起收起，免得下次打开时它还悬在上层
      setForgotOpen(false);
    }
  }, [authMode, form, showLoginModal]);

  useEffect(() => {
    if (!showLoginModal) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      // forgotOpen 时不响应 Esc：那个弹窗自己会处理（两个监听器都挂在 window 上，
      // 不加这个判断会一次 Esc 把两个框一起关掉）
      if (event.key === 'Escape' && !loading && !forgotOpen) closeLoginModal();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [closeLoginModal, forgotOpen, loading, showLoginModal]);

  if (!showLoginModal) return null;

  return createPortal(
    <div
      className="forest-auth-overlay fixed inset-0 flex items-center justify-center overflow-y-auto p-2 sm:p-4"
      style={{ zIndex: Z.modalTop }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !loading) closeLoginModal();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="forest-auth-title"
        className="forest-auth-dialog relative my-auto min-h-[640px] w-full max-w-[1100px] overflow-hidden rounded-[22px] border border-white/10 md:h-[min(720px,calc(100vh-40px))]"
      >
        <div className="absolute inset-0" aria-hidden="true">
          <Suspense fallback={<div className="forest-auth-scene-fallback h-full w-full" />}>
            <ForestCabinScene />
          </Suspense>
        </div>
        <div className="forest-auth-vignette pointer-events-none absolute inset-0" aria-hidden="true" />

        <button
          type="button"
          aria-label="关闭登录窗口"
          onClick={() => {
            if (!loading) closeLoginModal();
          }}
          className="forest-auth-close absolute right-3 top-3 z-30 flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-black/35 text-white/60 md:right-4 md:top-4"
        >
          <CloseOutlined />
        </button>

        <div className="relative z-10 flex min-h-[640px] flex-col md:grid md:h-full md:min-h-0 md:grid-cols-[minmax(0,1fr)_438px]">
          <aside className="hidden flex-col p-10 lg:p-12 md:flex">
            <div>
              <BrandLogo size={34} wordClass="h-[22px]" />
              <div className="forest-auth-kicker mt-10">
                <span className="forest-auth-live-dot" aria-hidden="true" />
                Live scene 01
                <span className="text-white/25">/</span>
                Cabin in the rain
              </div>
              <p className="mb-3 mt-10 font-mono text-[9px] uppercase tracking-[0.24em] text-amber-100/50">
                Somewhere beyond the signal
              </p>
              <h2 className="forest-auth-story-title">
                在雨声里，
                <br />
                让想象亮起来。
              </h2>
              <p className="mt-5 max-w-[420px] text-[13px] leading-7 text-white/55">
                林间的小屋、未熄的烛火和一场轻柔的雨。安静下来，然后开始下一段故事。
              </p>
            </div>

            <div className="forest-auth-scene-status mt-auto">
              <div>
                <span className="mb-1 block font-mono text-[9px] uppercase tracking-[0.18em] text-white/35">
                  Atmosphere
                </span>
                <span className="text-[12px] text-white/70">雨声持续 · 烛光微亮</span>
              </div>
              <div className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.16em] text-amber-100/55">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-300 shadow-[0_0_12px_rgba(253,186,116,0.8)]" />
                Candle on
              </div>
            </div>
          </aside>

          <div className="forest-auth-panel flex min-h-[640px] flex-1 flex-col md:min-h-0">
            <div className="flex items-center justify-between px-6 pt-6 md:hidden">
              <BrandLogo size={28} wordClass="h-[18px]" />
              <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-white/35">
                Rain / 01
              </span>
            </div>

            <div className="flex-1 overflow-y-auto px-5 pb-7 pt-7 sm:px-8 md:px-10 md:pt-12">
              <div className="mx-auto w-full max-w-[350px]">
                <div className="forest-auth-tabs mb-8" role="tablist" aria-label="登录或注册">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={authMode === 'login'}
                    onClick={() => setAuthMode('login')}
                    className={authMode === 'login' ? 'is-active' : ''}
                  >
                    登录
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={authMode === 'register'}
                    onClick={() => setAuthMode('register')}
                    className={authMode === 'register' ? 'is-active' : ''}
                  >
                    注册
                  </button>
                </div>

                <div className="mb-7">
                  <p className="mb-2 font-mono text-[9px] uppercase tracking-[0.2em] text-amber-200/45">
                    {authMode === 'login' ? 'Welcome back' : 'New journey'}
                  </p>
                  <h1 id="forest-auth-title" className="text-[26px] font-semibold tracking-[-0.03em] text-white">
                    {authMode === 'login' ? '欢迎回来' : '创建你的账号'}
                  </h1>
                  <p className="mt-2 text-[13px] leading-6 text-white/42">
                    {authMode === 'login'
                      ? '登录漫蛙，继续你的 AI 视频创作。'
                      : '登记一个名字，从林间的小屋开始创作。'}
                  </p>
                </div>

                <Form<AuthFormValues>
                  form={form}
                  layout="vertical"
                  onFinish={handleSubmit}
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
                        className="text-[12px] text-white/38 transition-colors hover:text-amber-200/80"
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

                  <Form.Item className={authMode === 'login' ? '!mb-0 !mt-7' : '!mb-0 !mt-5'}>
                    <button
                      type="submit"
                      disabled={loading}
                      className="forest-auth-submit flex h-12 w-full items-center justify-center gap-2 rounded-xl text-sm font-medium tracking-[0.08em] text-[#21150c]"
                    >
                      {loading && <LoadingOutlined spin />}
                      {loading
                        ? authMode === 'login'
                          ? '正在进入小屋…'
                          : '正在点亮烛火…'
                        : authMode === 'login'
                          ? '进入创作空间'
                          : '创建账号'}
                    </button>
                  </Form.Item>
                </Form>

                <div className="mt-5 flex items-center justify-center gap-1 text-[12px] text-white/35">
                  <span>{authMode === 'login' ? '还没有账号？' : '已经有账号？'}</span>
                  <button
                    type="button"
                    onClick={() => setAuthMode(authMode === 'login' ? 'register' : 'login')}
                    className="font-medium text-amber-200/80 transition-colors hover:text-amber-100"
                  >
                    {authMode === 'login' ? '立即注册' : '直接登录'}
                  </button>
                </div>

                <div className="mt-8 flex items-start gap-2 border-t border-white/[0.06] pt-5 text-[10px] leading-5 text-white/28">
                  <SafetyCertificateOutlined className="mt-0.5 shrink-0 text-amber-200/45" />
                  <span>账号信息仅用于身份验证和创作空间同步，我们会妥善保护你的数据。</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 找回密码弹窗。放在这里只是逻辑上的从属关系 —— 它内部自己
          createPortal 到 document.body，DOM 上是登录框的兄弟节点，
          既不受这层 flex 居中的影响，也不会被外层遮罩的点击关闭逻辑误伤。
          用条件挂载而非 open 属性：关闭即卸载，下次打开是全新实例 */}
      {forgotOpen && (
        <ForgotPasswordModal
          onClose={() => setForgotOpen(false)}
          defaultEmail={forgotEmail}
        />
      )}
    </div>,
    document.body,
  );
}
