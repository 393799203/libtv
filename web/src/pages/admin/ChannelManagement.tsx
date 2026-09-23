import { useState, useEffect } from 'react';
import { message } from 'antd';
import { channelApi, type ChannelPolicy } from '@/services/channelApi';

// 策略说明
const POLICY_OPTIONS: Array<{ value: ChannelPolicy; label: string; desc: string }> = [
  { value: 'all_wasu', label: '全部走华数（A）', desc: '所有用户的 AI 请求统一走华数 Token 渠道' },
  { value: 'all_dianxin', label: '全部走电信（B）', desc: '所有用户的 AI 请求统一走电信 Token 渠道' },
  { value: 'per_user', label: '按各自渠道', desc: '华数用户走华数，电信用户走电信（各自用户来源渠道）' },
];

const CHANNEL_LABEL: Record<string, string> = { wasu: '华数', dianxin: '电信' };

/**
 * 渠道管理：全局 AI Token 渠道策略切换（华数/电信）
 * 三档：全A（all_wasu）/ 全B（all_dianxin）/ 按各自渠道（per_user）
 */
export default function ChannelManagement() {
  const [policy, setPolicy] = useState<ChannelPolicy>('per_user');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
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

  const handleSwitch = (value: ChannelPolicy) => {
    setSaving(true);
    channelApi
      .setPolicy(value)
      .then(() => {
        setPolicy(value);
        message.success(`渠道策略已切换为「${POLICY_OPTIONS.find(p => p.value === value)?.label}」`);
      })
      .catch(() => {
        // HTTP 错误已由 api.ts 拦截器统一提示
      })
      .finally(() => setSaving(false));
  };

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-2xl">
        <div className="mb-1 text-[15px] font-semibold text-gray-800">AI Token 渠道策略</div>
        <div className="mb-5 text-[12px] text-gray-400">
          控制全局 AI 生成走哪个 Token 渠道（华数 / 电信）。切换后对新的生成请求立即生效（最多 5 秒）。
        </div>

        {loading ? (
          <div className="py-16 text-center text-gray-400 text-[13px]">加载中...</div>
        ) : (
          <div className="space-y-3">
            {POLICY_OPTIONS.map(opt => {
              const active = policy === opt.value;
              return (
                <div
                  key={opt.value}
                  onClick={() => !saving && !active && handleSwitch(opt.value)}
                  className={`flex items-start gap-3 rounded-xl border p-4 cursor-pointer transition-all ${
                    active
                      ? 'border-blue-500 bg-blue-50/60 shadow-sm'
                      : 'border-gray-200 bg-white hover:border-blue-300 hover:shadow-sm'
                  } ${saving ? 'opacity-60 pointer-events-none' : ''}`}
                >
                  <div
                    className={`mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                      active ? 'border-blue-500' : 'border-gray-300'
                    }`}
                  >
                    {active && <div className="w-2 h-2 rounded-full bg-blue-500" />}
                  </div>
                  <div className="flex-1">
                    <div className={`text-[13px] font-medium ${active ? 'text-blue-700' : 'text-gray-700'}`}>
                      {opt.label}
                    </div>
                    <div className="text-[12px] text-gray-500 mt-0.5">{opt.desc}</div>
                  </div>
                  {active && (
                    <span className="text-[11px] text-blue-600 bg-blue-100 rounded px-1.5 py-0.5 shrink-0">当前生效</span>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-6 rounded-xl bg-gray-50 border border-gray-200 p-4 text-[12px] text-gray-500 leading-relaxed">
          <div className="font-medium text-gray-700 mb-1.5">说明</div>
          <ul className="list-disc pl-4 space-y-1">
            <li>「按各自渠道」为默认策略：用户注册/后台标记的渠道决定其 AI 请求走向</li>
            <li>单个用户的渠道可在「用户管理」页签的 <b>AI渠道</b> 列调整（华数/电信）</li>
            <li>全局切换用于临时分流/故障切换：如某渠道 Token 额度耗尽，可一键切到另一渠道</li>
          </ul>
        </div>
      </div>
    </div>
  );
}