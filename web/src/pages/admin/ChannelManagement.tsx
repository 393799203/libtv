import { useCallback, useEffect, useState } from 'react';
import { Button } from 'antd';
import { CheckCircleFilled, LoadingOutlined, ReloadOutlined } from '@ant-design/icons';
import { message } from '@/utils/antdApp';
import { channelApi, type ChannelPolicy } from '@/services/channelApi';

// 策略说明
const POLICY_OPTIONS: Array<{ value: ChannelPolicy; label: string; desc: string }> = [
  { value: 'all_wasu', label: '全部走华数（A）', desc: '所有用户的 AI 请求统一走华数 Token 渠道' },
  { value: 'all_dianxin', label: '全部走电信（B）', desc: '所有用户的 AI 请求统一走电信 Token 渠道' },
  { value: 'per_user', label: '按各自渠道', desc: '华数用户走华数，电信用户走电信（各自用户来源渠道）' },
];

/**
 * 渠道管理：全局 AI Token 渠道策略切换（华数/电信）
 * 三档：全A（all_wasu）/ 全B（all_dianxin）/ 按各自渠道（per_user）
 */
export default function ChannelManagement() {
  const [policy, setPolicy] = useState<ChannelPolicy>('per_user');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // 正在切换的目标档位：只给这一张卡显示转圈，而不是整列一起转
  const [pending, setPending] = useState<ChannelPolicy | null>(null);

  // 拉取当前策略。注意这里不打开 loading：进页面那次靠 loading 初值（true）就够，
  // 在 effect 里同步 setState 会被 react-hooks/set-state-in-effect 拦下来
  const load = useCallback(() => {
    channelApi
      .getPolicy()
      .then((res: any) => {
        if (res?.policy) setPolicy(res.policy);
      })
      .catch(() => {
        // HTTP 错误已由 api.ts 拦截器统一提示
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // 刷新：手动把 loading 打开（点击事件里 setState 不受上面那条规则限制）
  const handleRefresh = () => {
    setLoading(true);
    load();
  };

  const handleSwitch = (value: ChannelPolicy) => {
    setSaving(true);
    setPending(value);
    channelApi
      .setPolicy(value)
      .then(() => {
        setPolicy(value);
        message.success(`渠道策略已切换为「${POLICY_OPTIONS.find(p => p.value === value)?.label}」`);
      })
      .catch(() => {
        // HTTP 错误已由 api.ts 拦截器统一提示
      })
      .finally(() => {
        setSaving(false);
        setPending(null);
      });
  };

  const activeOpt = POLICY_OPTIONS.find(p => p.value === policy);

  return (
    <div className="flex-1 overflow-y-auto">
      {/* 工具栏：与价格管理/套餐管理同一套（说明在左、按钮统一在右；刷新只留图标） */}
      <div className="bg-white px-6 py-3 border-b border-gray-100 flex items-center gap-3 sticky top-0 z-10">
        <div className="flex-1 min-w-0 text-[11px] text-gray-400">
          控制全局 AI 生成走哪个 Token 渠道（华数 / 电信）。切换后对新的生成请求立即生效（最多 5 秒）
        </div>
        <Button icon={<ReloadOutlined />} title="刷新" loading={loading} disabled={saving} onClick={handleRefresh} />
      </div>

      <div className="p-6">
        <div className="max-w-3xl space-y-5">
          {/* 当前生效：一眼看到现在走的是哪档，不用在下面三张卡里找高亮 */}
          <div className="rounded-xl border border-cyan-200 bg-cyan-500/10 px-5 py-4 flex items-start gap-3">
            <CheckCircleFilled className="text-cyan-500 text-[15px] mt-0.5 shrink-0" />
            <div className="min-w-0">
              <div className="text-[13px] font-semibold text-gray-800">
                当前生效：<span className="text-cyan-700">{loading ? '读取中…' : activeOpt?.label || policy}</span>
              </div>
              <div className="text-[12px] text-gray-500 mt-1">
                {activeOpt?.desc}
              </div>
            </div>
          </div>

          {/* 策略选择 */}
          <div>
            <div className="text-[13px] font-medium text-gray-700 mb-2">切换策略</div>
            <div className="space-y-2.5">
              {POLICY_OPTIONS.map(opt => {
                const active = policy === opt.value;
                return (
                  <div
                    key={opt.value}
                    role="radio"
                    aria-checked={active}
                    onClick={() => !saving && !active && handleSwitch(opt.value)}
                    className={`flex items-start gap-3 rounded-xl border px-4 py-3 transition-all ${
                      active
                        ? 'border-cyan-400 bg-cyan-500/10 shadow-sm'
                        : 'border-gray-200 bg-white hover:border-blue-300 hover:shadow-sm cursor-pointer'
                    } ${saving ? 'opacity-60 pointer-events-none' : ''}`}
                  >
                    <div
                      className={`mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                        active ? 'border-cyan-500' : 'border-gray-300'
                      }`}
                    >
                      {active && <div className="w-2 h-2 rounded-full bg-cyan-500" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`text-[13px] font-medium ${active ? 'text-cyan-700' : 'text-gray-700'}`}>
                          {opt.label}
                        </span>
                        {active && (
                          <span className="text-[11px] text-cyan-700 bg-cyan-100 rounded px-1.5 py-0.5">当前生效</span>
                        )}
                      </div>
                      <div className="text-[12px] text-gray-500 mt-0.5">{opt.desc}</div>
                    </div>
                    {pending === opt.value && <LoadingOutlined className="text-cyan-500 text-[12px] mt-1 shrink-0" />}
                  </div>
                );
              })}
            </div>
          </div>

          {/* 说明 */}
          <div className="rounded-xl bg-gray-50 border border-gray-200 px-5 py-4 text-[12px] text-gray-500 leading-relaxed">
            <div className="font-medium text-gray-700 mb-1.5">说明</div>
            <ul className="list-disc pl-4 space-y-1">
              <li>「按各自渠道」为默认策略：用户注册/后台标记的渠道决定其 AI 请求走向</li>
              <li>单个用户的渠道可在「用户管理」页签的 <b>渠道商</b> 列调整（华数/电信）</li>
              <li>全局切换用于临时分流/故障切换：如某渠道 Token 额度耗尽，可一键切到另一渠道</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}