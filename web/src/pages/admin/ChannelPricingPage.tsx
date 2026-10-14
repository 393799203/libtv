import { useCallback, useEffect, useRef, useState } from 'react';
import { App } from 'antd';
import { channelApi, type ChannelName, type ChannelPolicy } from '@/services/channelApi';
import { pricingApi } from '@/services/pricingApi';
import { userApi } from '@/services/userApi';
import PricingManagement, { type PricingManagementHandle } from './PricingManagement';

/**
 * 渠道与价格（后台一级菜单）
 *
 * 为什么把原来「商务配置」下的价格管理 + 渠道管理合成一页：
 * 渠道本来就是同一个维度，却分散在两处 —— 价格按渠道独立配置（页内一套华数/电信 Tab），
 * 渠道管理页又单独管「全局把请求路由到哪个渠道」。结果判断链要跨三次跳转：
 * 想问「切成全电信会怎样」，得先去渠道管理看策略、回价格管理切渠道、数一遍模型、再切回来。
 * 这是个改动全局流量与计费的操作，恰恰最需要一眼看清。
 *
 * 所以这一页以**渠道为主轴**：上方渠道栏给出每个渠道的「承载多少用户 / 有多少模型 /
 * 缺哪些节点」，下方沿用原来的价格明细。渠道状态由本页持有，渠道栏与价格区共用一个渠道，
 * 切渠道时统一走 switchChannel（有未保存改动会先拦截）。
 *
 * 线上真实风险（写这个页面的直接动机）：策略是「按各自渠道」时 8 个用户走电信，
 * 而电信在 models.yaml 里一个语音模型都没有 —— 这件事以前在任何一屏上都看不到。
 */
const CHANNELS: Array<{ value: ChannelName; label: string }> = [
  { value: 'wasu', label: '华数' },
  { value: 'dianxin', label: '电信' },
];

const POLICY_OPTIONS: Array<{ value: ChannelPolicy; label: string; desc: string }> = [
  { value: 'all_wasu', label: '全部走华数', desc: '所有用户的 AI 请求统一走华数' },
  { value: 'all_dianxin', label: '全部走电信', desc: '所有用户的 AI 请求统一走电信' },
  { value: 'per_user', label: '按各自渠道', desc: '用户注册/后台标记在哪个渠道就走哪个' },
];

interface ChannelStat {
  /** 有可用模型的节点数 */
  nodes: number;
  /** 模型数（同一模型服务多个节点只算一次） */
  models: number;
  /** 一个可用模型都没有的节点名（切到这个渠道时这些节点会没模型可选） */
  missingNodes: string[];
  /** 该渠道的用户数（按 users.channel 统计） */
  users: number;
}

/**
 * 策略切换的影响面文案：把「切完之后会发生什么」说进确认框，
 * 尤其是目标渠道缺节点的情况（否则切完才发现某类节点没模型可选）。
 *
 * 放在模块级是刻意的：纯函数不参与依赖数组，省掉一层 useCallback ——
 * 组件内的 useCallback 会因依赖 stats 被 React Compiler 判为
 * 「could not preserve existing memoization」，进而跳过整个组件的优化。
 */
function buildPolicyImpact(
  next: ChannelPolicy,
  stats: Partial<Record<ChannelName, ChannelStat>>,
  totalUsers: number,
): string {
  if (next === 'per_user') {
    const w = stats.wasu?.users ?? 0;
    const d = stats.dianxin?.users ?? 0;
    return `切换后各用户走自己所属渠道：华数 ${w} 人、电信 ${d} 人。`;
  }
  const target: ChannelName = next === 'all_wasu' ? 'wasu' : 'dianxin';
  const label = CHANNELS.find((c) => c.value === target)?.label || target;
  const stat = stats[target];
  const miss = stat?.missingNodes ?? [];
  const base = `切换后全部 ${totalUsers} 个用户的 AI 请求都走${label}（${stat?.models ?? 0} 个模型）。`;
  return miss.length > 0
    ? `${base}注意：${label}当前没有可用模型的节点是「${miss.join('、')}」，这些节点切换后将没有模型可选。`
    : base;
}

export default function ChannelPricingPage() {
  const { message, modal } = App.useApp();
  // 当前查看/编辑价格的渠道。默认电信，与原价格管理页一致（原来默认华数，后来改成电信）
  const [channel, setChannel] = useState<ChannelName>('dianxin');
  const [policy, setPolicy] = useState<ChannelPolicy>('per_user');
  const [stats, setStats] = useState<Partial<Record<ChannelName, ChannelStat>>>({});
  // 初值就是 true：进页面这次不必在 effect 里同步 setState（会被 react-hooks/set-state-in-effect 拦）
  const [statsLoading, setStatsLoading] = useState(true);
  const [policySaving, setPolicySaving] = useState(false);
  // 价格区把 save / getDirtyCount 挂在这里，供本页拦截未保存改动与「保存并切换」
  const pricingRef = useRef<PricingManagementHandle>(null);

  /** 渠道概览：模型覆盖来自 /pricing（节点分组本来就带「该节点暂无可用模型」这个状态，前端算得出来），
   *  用户数借 /users 的 total。两者都是现成接口，后端零改动 */
  const loadStats = useCallback(() => {
    Promise.all(
      CHANNELS.map(async ({ value }) => {
        const [priceRes, userRes] = await Promise.all([
          pricingApi.list(value).catch(() => null),
          userApi.listPaged(1, 1, undefined, undefined, value).catch(() => null),
        ]);
        const groups = priceRes?.nodes || [];
        const withModels = groups.filter((g) => g.models.length > 0);
        const modelIds = new Set<string>();
        withModels.forEach((g) => g.models.forEach((m) => modelIds.add(m.model_id)));
        const stat: ChannelStat = {
          nodes: withModels.length,
          models: modelIds.size,
          missingNodes: groups.filter((g) => g.models.length === 0).map((g) => g.node_name),
          users: userRes?.total ?? 0,
        };
        return [value, stat] as const;
      })
    )
      .then((pairs) => setStats(Object.fromEntries(pairs) as Record<ChannelName, ChannelStat>))
      .finally(() => setStatsLoading(false));
  }, []);

  const loadPolicy = useCallback(() => {
    channelApi
      .getPolicy()
      .then((res) => {
        if (res?.policy) setPolicy(res.policy);
      })
      .catch(() => {
        // HTTP 错误已由 api.ts 拦截器统一提示
      });
  }, []);

  useEffect(() => {
    loadStats();
    loadPolicy();
  }, [loadStats, loadPolicy]);

  // 原来这里有个「刷新渠道概览与策略」按钮（手动 handleRefresh）：
  // 渠道概览进页面就自动加载，页面下方价格区本来也有独立的「刷新」，
  // 这一行最右边单独飘一个图标按钮没必要，已去掉。

  const totalUsers = CHANNELS.reduce((sum, c) => sum + (stats[c.value]?.users ?? 0), 0);

  /** 该渠道「实际承载」多少用户：这取决于全局策略 —— all_X 时另一个渠道其实是空的，
   *  卡片上直接体现出来，省得人去心算「按各自渠道」意味着什么 */
  const effectiveUsers = (ch: ChannelName) => {
    if (policy === 'all_wasu') return ch === 'wasu' ? totalUsers : 0;
    if (policy === 'all_dianxin') return ch === 'dianxin' ? totalUsers : 0;
    return stats[ch]?.users ?? 0;
  };

  /** 切换价格区渠道：有未保存改动先拦截 —— 原来切 Tab 会静默 setEdits({}) 把改动丢掉，没有任何提示 */
  const switchChannel = useCallback((next: ChannelName) => {
    if (next === channel) return;
    const dirty = pricingRef.current?.getDirtyCount() ?? 0;
    if (dirty === 0) {
      setChannel(next);
      return;
    }
    const nextLabel = CHANNELS.find((c) => c.value === next)?.label || next;
    modal.confirm({
      title: `当前渠道还有 ${dirty} 项未保存的价格改动`,
      content: `直接切到${nextLabel}会丢失这些改动。「保存并切换」会先把当前渠道保存好再切换；「取消」保持现状 —— 想丢弃改动可先点价格区的刷新。`,
      okText: '保存并切换',
      cancelText: '取消',
      onOk: async () => {
        const ok = await pricingRef.current?.save();
        if (!ok) {
          message.error('保存失败，未切换渠道');
          return;
        }
        setChannel(next);
      },
    });
  }, [channel, modal, message]);

  // 策略切换：确认框里带上影响面。这里刻意不用 useCallback ——
  // 本页是页面级组件，少一层 memo 不影响性能，也免得 React Compiler 因依赖不稳定而跳过整组件优化
  const requestPolicyChange = (next: ChannelPolicy) => {
    if (next === policy) return;
    const opt = POLICY_OPTIONS.find((p) => p.value === next);
    modal.confirm({
      title: `切换渠道策略为「${opt?.label}」？`,
      content: `${buildPolicyImpact(next, stats, totalUsers)}切换后对新请求生效（最多 5 秒）。`,
      okText: '确认切换',
      cancelText: '取消',
      onOk: async () => {
        setPolicySaving(true);
        try {
          await channelApi.setPolicy(next);
          setPolicy(next);
          message.success(`渠道策略已切换为「${opt?.label}」`);
          // 承载关系变了，概览跟着重算（两渠道各承载多少用户）
          loadStats();
        } catch {
          // HTTP 错误已由 api.ts 拦截器统一提示
        } finally {
          setPolicySaving(false);
        }
      },
    });
  };

  const activePolicy = POLICY_OPTIONS.find((p) => p.value === policy);

  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      {/* ========== 渠道栏（常驻，不随下方价格区滚动）========== */}
      <div className="bg-white border-b border-gray-100 shrink-0 px-6 pt-3.5 pb-3">
        <div className="flex items-center gap-2 mb-2.5">
          <span className="text-[13px] font-semibold text-gray-800">渠道概览</span>
          <span className="text-[11px] text-gray-400">
            渠道决定 AI 请求的走向，价格也按渠道独立配置
          </span>
        </div>

        {/* 两张渠道卡：点卡片即切换下方价格区查看的渠道，与价格区 Tab 是同一个状态 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {CHANNELS.map(({ value, label }) => {
            const stat = stats[value];
            const active = channel === value;
            const users = effectiveUsers(value);
            return (
              <button
                key={value}
                onClick={() => switchChannel(value)}
                className={`text-left rounded-xl border px-4 py-3 transition-all cursor-pointer ${
                  active
                    ? 'border-cyan-400 bg-cyan-500/10 shadow-sm'
                    : 'border-gray-200 bg-white hover:border-blue-300 hover:shadow-sm'
                }`}
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-[13px] font-semibold ${active ? 'text-cyan-700' : 'text-gray-800'}`}>
                    {label}
                  </span>
                  {active && (
                    <span className="text-[11px] text-cyan-700 bg-cyan-100 rounded px-1.5 py-0.5">
                      正在查看价格
                    </span>
                  )}
                  <span className={`ml-auto text-[11px] ${users > 0 ? 'text-gray-500' : 'text-gray-300'}`}>
                    承载 {users} 个用户
                  </span>
                </div>

                <div className="text-[12px] text-gray-500 mt-1.5">
                  {statsLoading && !stat
                    ? '读取中…'
                    : `${stat?.models ?? 0} 个模型 · 覆盖 ${stat?.nodes ?? 0} 个节点`}
                </div>

                <div className="text-[11px] mt-1">
                  {(stat?.missingNodes?.length ?? 0) === 0 ? (
                    <span className="text-emerald-600">✓ 所有节点都有可用模型</span>
                  ) : (
                    <span className="text-amber-600">
                      ⚠ 无可用模型：{stat?.missingNodes?.join('、')}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {/* 全局路由策略 */}
        <div className="flex items-start gap-3 mt-3">
          <div className="shrink-0 pt-2">
            <div className="text-[12px] font-medium text-gray-700 whitespace-nowrap">流量路由</div>
            <div className="text-[11px] text-gray-400 whitespace-nowrap mt-0.5">
              当前：{activePolicy?.label || policy}
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 flex-1 min-w-0">
            {POLICY_OPTIONS.map((opt) => {
              const active = policy === opt.value;
              return (
                <button
                  key={opt.value}
                  onClick={() => requestPolicyChange(opt.value)}
                  disabled={policySaving}
                  className={`text-left rounded-lg border px-3 py-2 transition-all cursor-pointer disabled:opacity-60 ${
                    active
                      ? 'border-cyan-400 bg-cyan-500/10'
                      : 'border-gray-200 bg-white hover:border-blue-300'
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`w-3 h-3 rounded-full border-2 shrink-0 ${
                        active ? 'border-cyan-500 bg-cyan-500' : 'border-gray-300'
                      }`}
                    />
                    <span className={`text-[12px] font-medium ${active ? 'text-cyan-700' : 'text-gray-700'}`}>
                      {opt.label}
                    </span>
                  </div>
                  <div className="text-[11px] text-gray-400 mt-0.5 leading-tight">{opt.desc}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* 原「渠道管理」页里的操作说明，合并后保留在这儿（删了页面不能把操作知识也删掉） */}
        <div className="text-[11px] text-gray-400 mt-2 leading-relaxed">
          单个用户的渠道在「用户管理 → 渠道商」列单独调整；这里的全局切换用于临时分流 / 故障切换
          （例如某渠道 Token 额度耗尽），切换后最多 5 秒对新请求生效。价格为 0 表示该模型暂不扣费。
        </div>
      </div>

      {/* ========== 价格明细（沿用原价格管理页的交互）========== */}
      <PricingManagement ref={pricingRef} channel={channel} />
    </div>
  );
}