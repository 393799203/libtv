import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Form, Input } from 'antd';
import {
  CloseOutlined,
  LoadingOutlined,
  MailOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import { authApi } from '@/services/authApi';
import { Z } from '@/utils/zLayers';

interface ForgotPasswordModalProps {
  onClose: () => void;
  /** 登录框里已经填过的邮箱：带过来省得用户再打一遍 */
  defaultEmail?: string;
}

type ForgotFormValues = { email: string };

/**
 * 「忘记密码」弹窗：输入邮箱 → 后端发一封带重置链接的邮件。
 *
 * 刻意做成独立组件、而不是塞进 LoginModal：LoginModal 里已经有登录/注册两套表单，
 * 再加一套会把它撑得很难读；而且找回密码是「未登录 + 独立流程」，分开更清楚。
 *
 * 复用 LoginModal 那套 forest-auth-* 样式类（不新增 CSS），保证视觉一致。
 *
 * 没有 open 属性：由父组件决定挂载与卸载（`{forgotOpen && <ForgotPasswordModal … />}`）。
 * 这样每次打开都是一个全新实例，「已发送」提示与 loading 残留都不可能带到下次，
 * 也就不需要在 effect 里手动重置状态。
 */
export function ForgotPasswordModal({ onClose, defaultEmail }: ForgotPasswordModalProps) {
  const [form] = Form.useForm<ForgotFormValues>();
  const [loading, setLoading] = useState(false);
  /** sent=true 表示已提交成功，切到「去邮箱查收」的提示态 */
  const [sent, setSent] = useState(false);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !loading) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [loading, onClose]);

  const handleSubmit = async (values: ForgotFormValues) => {
    setLoading(true);
    try {
      await authApi.forgotPassword({ email: values.email });
      setSent(true);
    } catch {
      // HTTP 错误已由 api.ts 拦截器统一 message.error()，这里不重复提示
    } finally {
      setLoading(false);
    }
  };

  return createPortal(
    <div
      className="forest-auth-overlay fixed inset-0 flex items-center justify-center overflow-y-auto p-2 sm:p-4"
      style={{ zIndex: Z.modalTopAbove }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !loading) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="forgot-password-title"
        className="forest-auth-dialog relative my-auto w-full max-w-[430px] overflow-hidden rounded-[22px] border border-white/10"
      >
        <button
          type="button"
          aria-label="关闭找回密码窗口"
          onClick={() => {
            if (!loading) onClose();
          }}
          className="forest-auth-close absolute right-3 top-3 z-30 flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-black/35 text-white/60"
        >
          <CloseOutlined />
        </button>

        <div className="forest-auth-panel px-6 py-8 sm:px-8 sm:py-10">
          <div className="mx-auto w-full max-w-[350px]">
            <p className="mb-2 font-mono text-[9px] uppercase tracking-[0.2em] text-amber-200/45">
              Reset access
            </p>
            <h1
              id="forgot-password-title"
              className="text-[24px] font-semibold tracking-[-0.03em] text-white"
            >
              找回密码
            </h1>

            {sent ? (
              <>
                <p className="mt-3 text-[13px] leading-6 text-white/50">
                  如果该邮箱已注册，我们已发送一封重置邮件，请查收。
                </p>
                <div className="mt-6 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-[12px] leading-6 text-white/45">
                  · 重置链接 <span className="text-white/70">30 分钟内</span>有效，且只能使用一次
                  <br />· 没收到？看看垃圾邮件，或稍后重新发送
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="forest-auth-submit mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-xl text-sm font-medium tracking-[0.08em] text-[#21150c]"
                >
                  返回登录
                </button>
              </>
            ) : (
              <>
                <p className="mt-2 text-[13px] leading-6 text-white/42">
                  输入注册时用的邮箱，我们会发送一条重置链接给你。
                </p>

                <Form<ForgotFormValues>
                  form={form}
                  layout="vertical"
                  onFinish={handleSubmit}
                  requiredMark={false}
                  className="forest-auth-form mt-7"
                  initialValues={{ email: defaultEmail || '' }}
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

                  <Form.Item className="!mb-0 !mt-6">
                    <button
                      type="submit"
                      disabled={loading}
                      className="forest-auth-submit flex h-12 w-full items-center justify-center gap-2 rounded-xl text-sm font-medium tracking-[0.08em] text-[#21150c]"
                    >
                      {loading && <LoadingOutlined spin />}
                      {loading ? '正在发送…' : '发送重置链接'}
                    </button>
                  </Form.Item>
                </Form>

                <div className="mt-5 flex items-center justify-center gap-1 text-[12px] text-white/35">
                  <span>想起来了？</span>
                  <button
                    type="button"
                    onClick={onClose}
                    className="font-medium text-amber-200/80 transition-colors hover:text-amber-100"
                  >
                    返回登录
                  </button>
                </div>
              </>
            )}

            <div className="mt-7 flex items-start gap-2 border-t border-white/[0.06] pt-5 text-[10px] leading-5 text-white/28">
              <SafetyCertificateOutlined className="mt-0.5 shrink-0 text-amber-200/45" />
              <span>为保护账号安全，我们不会提示该邮箱是否已注册。</span>
            </div>
          </div>
        </div>
      </section>
    </div>,
    document.body,
  );
}
