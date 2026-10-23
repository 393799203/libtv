import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { App, Form, Input } from 'antd';
import {
  CheckCircleFilled,
  LoadingOutlined,
  LockOutlined,
  SafetyCertificateOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { BrandLogo } from '@/components/layout/BrandLogo';
import { authApi } from '@/services/authApi';
import { useAuthStore } from '@/stores/authStore';

type ResetFormValues = { password: string; confirmPassword: string };

/**
 * 重置密码页：邮件里的链接指向这里（/reset-password?token=…）。
 *
 * 全屏公开页，和 /videos/:id 一样挂在 AppLayout 之外 —— 用户可能是从邮件点进来的，
 * 此时没登录、也没有回来的上下文，套一层带导航的后台外壳只会让人更困惑。
 *
 * 令牌只在内存里经手一次：读出来就交给后端换密码，不落到 localStorage。
 */
export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const openLoginModal = useAuthStore((s) => s.openLoginModal);
  const [form] = Form.useForm<ResetFormValues>();
  const [loading, setLoading] = useState(false);
  /** 改密成功：切到成功态，引导去登录 */
  const [done, setDone] = useState(false);
  /** 令牌被后端拒绝（无效/过期/已用过）：给出「重新获取」的出路 */
  const [rejected, setRejected] = useState(false);

  const token = (searchParams.get('token') || '').trim();

  const handleSubmit = async (values: ResetFormValues) => {
    setLoading(true);
    try {
      await authApi.resetPassword({ token, password: values.password });
      setDone(true);
      setRejected(false);
      message.success('密码已重置');
    } catch {
      // 具体原因（链接无效/已过期/过于频繁）已由 api.ts 拦截器统一提示，
      // 这里只负责把界面切到「这条路走不通，去重新获取」的状态
      setRejected(true);
    } finally {
      setLoading(false);
    }
  };

  const goHomeAndLogin = () => {
    navigate('/', { replace: true });
    openLoginModal();
  };

  return (
    <div className="forest-auth-overlay flex min-h-screen items-center justify-center p-4">
      <section className="forest-auth-dialog w-full max-w-[430px] overflow-hidden rounded-[22px] border border-white/10">
        <div className="forest-auth-panel px-6 py-8 sm:px-8 sm:py-10">
          <div className="mx-auto w-full max-w-[350px]">
            <BrandLogo size={28} wordClass="h-[18px]" />

            {/* ---- 情况一：链接里根本没有令牌（多半是被邮件客户端截断了）---- */}
            {!token ? (
              <>
                <p className="mb-2 mt-7 font-mono text-[9px] uppercase tracking-[0.2em] text-amber-200/45">
                  Link incomplete
                </p>
                <h1 className="text-[24px] font-semibold tracking-[-0.03em] text-white">
                  链接不完整
                </h1>
                <p className="mt-3 text-[13px] leading-6 text-white/50">
                  这个重置链接缺少必要参数，可能是被邮件客户端截断了。请回到登录页重新获取一封。
                </p>
                <button
                  type="button"
                  onClick={goHomeAndLogin}
                  className="forest-auth-submit mt-6 flex h-12 w-full items-center justify-center rounded-xl text-sm font-medium tracking-[0.08em] text-[#21150c]"
                >
                  去登录页重新获取
                </button>
              </>
            ) : done ? (
              /* ---- 情况二：重置成功 ---- */
              <>
                <div className="mt-7 flex items-center gap-2 text-emerald-300">
                  <CheckCircleFilled />
                  <span className="font-mono text-[9px] uppercase tracking-[0.2em]">Done</span>
                </div>
                <h1 className="mt-3 text-[24px] font-semibold tracking-[-0.03em] text-white">
                  密码已重置
                </h1>
                <p className="mt-3 text-[13px] leading-6 text-white/50">
                  请用新密码重新登录。出于安全考虑，你在其它设备上的登录状态已全部失效。
                </p>
                <button
                  type="button"
                  onClick={goHomeAndLogin}
                  className="forest-auth-submit mt-6 flex h-12 w-full items-center justify-center rounded-xl text-sm font-medium tracking-[0.08em] text-[#21150c]"
                >
                  去登录
                </button>
              </>
            ) : (
              /* ---- 情况三：填新密码 ---- */
              <>
                <p className="mb-2 mt-7 font-mono text-[9px] uppercase tracking-[0.2em] text-amber-200/45">
                  New password
                </p>
                <h1 className="text-[24px] font-semibold tracking-[-0.03em] text-white">
                  设置新密码
                </h1>
                <p className="mt-2 text-[13px] leading-6 text-white/42">
                  为你的漫蛙账号设置一个新密码。
                </p>

                {rejected && (
                  <div className="mt-5 flex items-start gap-2 rounded-xl border border-rose-400/20 bg-rose-500/[0.08] px-4 py-3 text-[12px] leading-6 text-rose-200/85">
                    <WarningOutlined className="mt-0.5 shrink-0" />
                    <span>
                      这个链接可能已失效或已被使用过。请回登录页重新获取一封重置邮件。
                    </span>
                  </div>
                )}

                <Form<ResetFormValues>
                  form={form}
                  layout="vertical"
                  onFinish={handleSubmit}
                  requiredMark={false}
                  className="forest-auth-form mt-6"
                >
                  <Form.Item
                    label="新密码"
                    name="password"
                    rules={[
                      { required: true, message: '请输入新密码' },
                      { min: 6, message: '密码至少 6 位' },
                    ]}
                  >
                    <Input.Password
                      prefix={<LockOutlined />}
                      placeholder="至少 6 位字符"
                      size="large"
                      autoComplete="new-password"
                    />
                  </Form.Item>

                  <Form.Item
                    label="确认新密码"
                    name="confirmPassword"
                    dependencies={['password']}
                    rules={[
                      { required: true, message: '请再次输入新密码' },
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
                      prefix={<SafetyCertificateOutlined />}
                      placeholder="再次输入新密码"
                      size="large"
                      autoComplete="new-password"
                    />
                  </Form.Item>

                  <Form.Item className="!mb-0 !mt-6">
                    <button
                      type="submit"
                      disabled={loading}
                      className="forest-auth-submit flex h-12 w-full items-center justify-center gap-2 rounded-xl text-sm font-medium tracking-[0.08em] text-[#21150c]"
                    >
                      {loading && <LoadingOutlined spin />}
                      {loading ? '正在保存…' : '保存新密码'}
                    </button>
                  </Form.Item>
                </Form>

                <div className="mt-5 flex items-center justify-center gap-1 text-[12px] text-white/35">
                  <span>不想改了？</span>
                  <button
                    type="button"
                    onClick={goHomeAndLogin}
                    className="font-medium text-amber-200/80 transition-colors hover:text-amber-100"
                  >
                    返回登录
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
