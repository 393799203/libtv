import { useCallback, useEffect, useState } from 'react';
import { App, Button, Input, Pagination, Popover, Select, Table, Tag, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  ReloadOutlined,
  SafetyOutlined,
  WarningOutlined,
  LinkOutlined,
  PlayCircleOutlined,
} from '@ant-design/icons';
import { MediaPreviewModal } from '@/components/canvas/MediaPreviewModal';
import {
  providerTaskApi,
  type ProviderTask,
  type ProviderTaskStats,
} from '@/services/providerTaskApi';

/**
 * 上游任务对账：每一次下发到上游的视频任务一行。
 *
 * 为什么需要这一页：任务号是跟渠道对账的唯一凭据，但它以前只存在 Redis 任务登记里
 * （24 小时、退费后即被消费），事后既查不了「上游到底有没有接单、有没有计费」，
 * 也找不回上游可能已产出的成片（10-03 00:04 那次创建超时中断就是这个教训）。
 *
 * 列表按时间倒序（最近发生的在最上面），不按状态插队 —— 需要对账的具体某类行，
 * 用状态筛选或「只看异常」去收窄，排序本身只负责时间线。
 */
// 状态就四种（含旧数据的 failed/已退费兜底）：
// 进行中 → 已交付 / 上游报失败自动退费 / 上游没返回待人工决定
const STATUS_META: Record<string, { text: string; color: string }> = {
  submitted: { text: '进行中', color: 'blue' },
  delivered: { text: '已交付', color: 'green' },
  pending_review: { text: '待人工决定', color: 'orange' },
  failed: { text: '待人工决定', color: 'orange' },
  refunded: { text: '已退费', color: 'default' },
};

/** 一致性自检的异常代码 → 中文标签（与后端 audit.AlertLabel 对齐） */
const ALERT_LABEL: Record<string, string> = {
  no_result: '无产物地址',
  no_history: '无交付凭据',
  stuck: '卡在进行中',
  refund_delivered: '既退费又交付',
  amount_mismatch: '金额对不上',
  dup_charge: '疑似重复扣费',
  no_user: '无归属用户',
  orphan_exec: '执行记录缺失',
};

/** 任务类型：视频是异步任务（有上游任务号），其余是同步调用（用本地编号记账） */
const KIND_LABEL: Record<string, string> = {
  'ai.video': '视频',
  'ai.image': '图片',
  'ai.story': '故事',
  'ai.script': '剧本',
  'ai.audio': '音频',
  'ai.previz_analyze': '白模解析',
  'prompt.generate': '提示词',
};

const providerText = (p: string) => (p === 'dianxin' ? '电信' : p === 'wasu' ? '华数' : p || '-');

const formatTime = (iso: string) => {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

export default function ProviderTaskReconciliation() {
  const { message, modal } = App.useApp();
  const [items, setItems] = useState<ProviderTask[]>([]);
  const [stats, setStats] = useState<ProviderTaskStats | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(true);
  const [refunding, setRefunding] = useState<number | null>(null);
  // 默认「全部状态」：一进来就看全貌（排序仍是待人工退费 → 已退费 → 时间倒序，
  // 需要动手的那类依然排在最上面，想看单一状态再切下拉）
  const [status, setStatus] = useState<string>('');
  const [taskKind, setTaskKind] = useState<string>('');
  const [taskIdInput, setTaskIdInput] = useState('');
  const [taskId, setTaskId] = useState('');
  const [projectIdInput, setProjectIdInput] = useState('');
  const [projectId, setProjectId] = useState('');
  const [userIdInput, setUserIdInput] = useState('');
  const [userId, setUserId] = useState('');
  // 刷新令牌：点击「刷新」时自增，保证即使筛选值没变也真的重新请求一次
  const [refreshToken, setRefreshToken] = useState(0);
  const [onlyAlert, setOnlyAlert] = useState(false);
  const [auditing, setAuditing] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    providerTaskApi
      .list({
        status,
        task_kind: taskKind,
        task_id: taskId,
        project_id: projectId,
        user_id: userId,
        only_alert: onlyAlert ? '1' : undefined,
        page,
        page_size: pageSize,
      })
      .then((res) => {
        setItems(res.items || []);
        setTotal(res.total || 0);
        setStats(res.stats || null);
      })
      .catch(() => {
        // HTTP 错误已由 api.ts 拦截器统一提示
      })
      .finally(() => setLoading(false));
  }, [status, taskKind, taskId, projectId, userId, onlyAlert, page, pageSize, refreshToken]);

  useEffect(() => {
    load();
  }, [load]);

  // 手动退费：先确认（金额、用户、任务号都摆出来），再调接口；成功后刷新列表
  const refund = (row: ProviderTask) => {
    modal.confirm({
      title: '确认退费？',
      content: (
        <div className="text-[13px] leading-6">
          <div>用户：{row.user_id || '-'}</div>
          <div>
            退还积分：<span className="text-red-600 font-medium">{row.charged_amount}</span>
            {row.charge_resolution
              ? `（${row.charge_resolution} / ${row.charge_seconds} 秒${
                  row.charge_ref_seconds ? `，其中参考视频 ${row.charge_ref_seconds} 秒` : ''
                }）`
              : ''}
          </div>
          <div className="break-all">任务号：{row.task_id}</div>
          <div className="text-gray-500 mt-1">
            退费立即到账、会写进用户的费用明细；同一笔只能退一次（已交付/已退费会被拦住）
          </div>
        </div>
      ),
      okText: '确认退费',
      okButtonProps: { danger: true },
      onOk: async () => {
        setRefunding(row.id);
        try {
          await providerTaskApi.refund(row.id, '对账页手动退费');
          message.success('已退费');
          load();
        } finally {
          setRefunding(null);
        }
      },
    });
  };

  /**
   * 在线预览：产物存在对象存储上，存储对 mp4 返回 Content-Disposition: attachment，
   * 直接点链接只会下载。这里先向后台要一张 10 分钟票据，再用票据地址喂给播放器 ——
   * 后台会把响应头改成 inline 并原样转发 Range，所以视频点开就能看、进度条也能拖。
   */
  const [preview, setPreview] = useState<{
    url: string;
    kind: 'video' | 'image';
    title: string;
    meta: string;
  } | null>(null);
  /**
   * 「产物地址」气泡改成受控。
   *
   * 原因：antd 的气泡层级（1030）比 Modal（1000）高，所以点气泡里的「在线查看」打开全屏预览后，
   * 气泡会**浮在预览遮罩之上**继续挡着画面。打开预览/下载时主动收起它。
   */
  const [artifactPopover, setArtifactPopover] = useState<number | null>(null);

  const artifactKind = (row: ProviderTask, url: string): 'video' | 'image' | 'audio' | 'other' => {
    const path = url.split('?')[0].toLowerCase();
    if (row.task_kind === 'ai.video' || /\.(mp4|mov|webm|m4v)$/.test(path)) return 'video';
    if (row.task_kind === 'ai.image' || /\.(png|jpe?g|webp|gif)$/.test(path)) return 'image';
    if (row.task_kind === 'ai.audio' || /\.(mp3|wav|m4a)$/.test(path)) return 'audio';
    return 'other';
  };

  const openPreview = (row: ProviderTask, source: 'result' | 'provider') => {
    setArtifactPopover(null); // 先收起产物气泡，否则它会浮在全屏预览上面
    const artifact = source === 'provider' ? row.provider_url : row.result_url || row.provider_url;
    const url = (artifact || '').trim();
    if (!url) {
      message.error('这一行没有产物地址');
      return;
    }
    // 播放地址就用存储上的原始视频地址（和首页视频、画布视频节点同一套）：
    // <video> 取流不受 Content-Disposition: attachment 影响，能直接播；
    // 绕后台代理转发反而把 4 核机器的带宽也搭进去，大视频容易卡。后台的代理接口留着做兜底。
    const kind = artifactKind(row, url);
    if (kind === 'video' || kind === 'image') {
      setPreview({
        url,
        kind,
        title: `${KIND_LABEL[row.task_kind] || row.task_kind || '产物'} · ${row.model || '-'}`,
        meta: source === 'provider' ? '上游原始产物（未转存成功）' : '交付产物',
      });
    } else {
      window.open(url, '_blank', 'noreferrer');
    }
  };

  /** 产物地址：优先交付地址（我们的存储），其次上游原始地址（转存失败时仍可打开） */
  const artifactOf = (row: ProviderTask) => {
    if (row.result_url) return { url: row.result_url, label: '交付产物', own: true };
    if (row.provider_url) return { url: row.provider_url, label: '上游产物（未转存成功）', own: false };
    return null;
  };

  /** 悬停/点击「已交付」时给出的产物面板：地址 + 在线查看（这条路是唯一的产物入口） */
  const artifactPanel = (row: ProviderTask) => {
    const rows = [
      row.result_url ? { label: '交付产物', url: row.result_url } : null,
      row.provider_url ? { label: '上游原始产物', url: row.provider_url } : null,
    ].filter(Boolean) as { label: string; url: string }[];
    return (
      // 气泡只负责「看地址」：标签 + 完整地址（break-all 换行，不截断，这是排查问题的凭据）。
      // 「在线查看」已经挪到外面状态行的链接图标后面，这里不再重复放按钮。
      <div className="max-w-[420px] text-[12px] leading-6">
        {rows.map((r) => (
          <div key={r.label} className="mb-1">
            <div className="text-gray-500">{r.label}</div>
            <a href={r.url} target="_blank" rel="noreferrer" className="break-all text-blue-600">
              {r.url}
            </a>
          </div>
        ))}
        {!rows.length && <div className="text-gray-400">这条没有产物地址</div>}
      </div>
    );
  };

  /** 只有「待人工退费」且确实扣过钱的行才给退费按钮 */
  const canRefund = (row: ProviderTask) =>
    (row.status === 'pending_review' || row.status === 'failed') && row.charged_amount > 0;

  const columns: ColumnsType<ProviderTask> = [
    {
      title: '时间 / 状态',
      dataIndex: 'status',
      // 150：够放状态标签 + 产物链接图标 + 在线查看图标（退费按钮/异常标记长了会折到第二行，flex-wrap 已开）
      width: 150,
      render: (s: string, row: ProviderTask) => {
        const meta = STATUS_META[s] || { text: s || '-', color: 'default' };
        // 已退费要分清是谁退的：自动退 = 上游明确拒绝（上游不计费）；人工退 = 可能已计费
        const auto = s === 'refunded' && row.refund_source === 'auto';
        const manual = s === 'refunded' && row.refund_source === 'manual';
        const tagText = auto ? '自动退费' : manual ? '人工退费' : meta.text;
        const tag = <Tag color={auto ? 'blue' : manual ? 'red' : meta.color}>{tagText}</Tag>;
        const artifact = artifactOf(row);
        // 悬停解释「为什么这条要人工看」/「为什么这条的钱退不回来」
        const tip =
          auto
            ? '上游明确拒绝了这次任务（参数不合法 / 不过审 / 任务被判失败），已自动退还用户扣费。上游不计费，我们没有成本'
            : manual
              ? '管理员判断后退还了用户扣费。上游当时没明确拒绝，很可能已经生成并计费 —— 这是真实成本'
              : s === 'refunded'
                ? '用户积分已退还（这次退费发生在上线「退费来源」之前，未能区分自动/人工）'
                : s === 'pending_review' || s === 'failed'
              ? '上游没有明确报错（超时 / 没拿到结果等），按规则不自动退费，需要人工判断'
              : '';
        // 有产物就做成可点开的面板：交付的看交付地址，没转存成功的看上游地址
        const body = artifact ? (
          <Popover
            content={artifactPanel(row)}
            title="产物地址"
            trigger="click"
            placement="bottomLeft"
            open={artifactPopover === row.id}
            onOpenChange={(v) => setArtifactPopover(v ? row.id : null)}
          >
            <span className="cursor-pointer inline-flex items-center gap-0.5">
              {tag}
              <LinkOutlined className="text-[12px] text-blue-500" />
            </span>
          </Popover>
        ) : (
          <span className={tip ? 'cursor-help' : undefined}>{tag}</span>
        );
        // 操作按钮跟在状态后面（有产物时就在那个链接图标后面）：行内一眼能对上，不用去最右边找。
        // 注意按钮是 Popover 的**兄弟**而不是子节点 —— 放里面点一下会连带把产物气泡也切出来。
        // artifact 在上面（body 那段）已经算过，这里复用，别重复声明
        const artifactSource: 'result' | 'provider' = artifact?.own ? 'result' : 'provider';
        const viewBtn = artifact ? (
          <Tooltip
            // 预览打开时强制收起：Tooltip 的层级（1070）比 Modal（1000）高，
            // 鼠标停在图标上时它会一直浮在全屏播放器上面
            open={preview ? false : undefined}
            title={artifact.own ? '在线查看交付产物' : '在线查看上游原始产物（未转存成功）'}
          >
            <Button
              type="text"
              size="small"
              className="!px-0"
              icon={<PlayCircleOutlined />}
              onClick={() => openPreview(row, artifactSource)}
            />
          </Tooltip>
        ) : null;
        const refundBtn = canRefund(row) ? (
          <Button size="small" danger loading={refunding === row.id} onClick={() => refund(row)}>
            退费
          </Button>
        ) : null;
        const tagNode = tip ? (
          <Tooltip title={tip}>
            <span>{body}</span>
          </Tooltip>
        ) : (
          body
        );
        // 一致性自检标记出来的异常：在状态旁边挂一个红色标记，悬停看原因（原因同时写进了备注）
        const alertNode = row.alert ? (
          <Tooltip
            title={`一致性自检：${ALERT_LABEL[row.alert] || row.alert} —— 原因已写入备注，请人工核查（自检只做标记，不会自动退费）`}
          >
            <Tag color="red" className="ml-1">
              ⚠ {ALERT_LABEL[row.alert] || row.alert}
            </Tag>
          </Tooltip>
        ) : null;
        return (
          <div className="leading-5">
            <div className="text-[12px] text-gray-600">{formatTime(row.created_at)}</div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
              {tagNode}
              {viewBtn}
              {refundBtn}
              {alertNode}
            </div>
          </div>
        );
      },
    },
    {
      title: '用户',
      dataIndex: 'user_name',
      width: 150,
      render: (_: string, r) => (
        <div className="text-[12px] leading-5">
          <div className="text-gray-800 line-clamp-1 break-all" title={r.user_name || r.user_email || ''}>
            {r.user_name || '（无昵称）'}
          </div>
          <div className="text-[11px] text-gray-400 line-clamp-1 break-all" title={r.user_email || ''}>
            {r.user_email || '-'}
          </div>
        </div>
      ),
    },
    {
      title: '项目',
      dataIndex: 'project_name',
      width: 150,
      render: (_: string, r) => (
        <div className="text-[12px] leading-5">
          <div className="text-gray-800 line-clamp-1 break-all" title={r.project_name || r.project_id || ''}>
            {/* 三种情况分清楚（对账行是永久记录，项目不是）：
                · 实时查得到名字 → 直接显示（项目改名会跟着变）；
                · 查不到但这一行写入了名称快照 → 显示「原名（项目已删除）」，
                  管理员至少知道是哪个项目，不用去别处翻；
                · 连快照都没有（上线快照之前的历史行）→ 带上项目号前 8 位，便于追溯；
                · 压根没带项目（提示词/白模解析这类直连接口）→ 显示「-」。 */}
            {r.project_name ? (
              r.project_name
            ) : r.project_id ? (
              r.project_name_snapshot ? (
                <span>
                  {r.project_name_snapshot}
                  <span className="text-gray-400">（项目已删除）</span>
                </span>
              ) : (
                <span className="text-gray-500">
                  （项目已删除 · {r.project_id.slice(0, 8)}）
                </span>
              )
            ) : (
              '-'
            )}
          </div>
          <div className="text-[10px] text-gray-400 line-clamp-1 break-all" title={r.project_id}>
            {r.project_id || '-'}
          </div>
        </div>
      ),
    },
    {
      title: '渠道 / 模型',
      dataIndex: 'model',
      // 224 → 160：渠道名 + 口径标签一行、模型名折行，用不了那么宽；腾出来的给备注
      width: 160,
      render: (_: string, r) => (
        <div className="text-[12px] leading-5">
          {/* 口径（模型参数：分辨率 · 计费时长）跟在渠道名后面：模型名很长，跟在它后面会被挤掉 */}
          {/* 第一行只放「渠道 + 口径」：口径就是这次调用用的模型参数，紧贴渠道名最省地方 */}
          <div className="flex items-center gap-1 flex-nowrap overflow-hidden">
            <span className="text-gray-800 whitespace-nowrap shrink-0">{providerText(r.provider)}</span>
            {(r.charge_resolution || r.charge_seconds > 0) && (
              <Tag
                bordered={false}
                className="!text-[9px] !px-1 !py-0 !mr-0 !leading-none shrink-0 text-gray-500 bg-gray-100"
              >
                {(r.charge_resolution || '').replace('x', '×')}
                {r.charge_seconds > 0 ? `${r.charge_resolution ? ' · ' : ''}${r.charge_seconds}s` : ''}
                {r.charge_ref_seconds > 0 ? ` · 参考${r.charge_ref_seconds}s` : ''}
              </Tag>
            )}
          </div>
          {/* 第二行放「类型 + 模型名」：模型名最长，单独一行折行显示，不跟口径抢宽度 */}
          <div className="text-[11px] text-gray-500 break-all" title={r.model}>
            {r.task_kind && (
              <span className="text-[10px] text-gray-400 mr-1">{KIND_LABEL[r.task_kind] || r.task_kind}</span>
            )}
            {r.model || '-'}
          </div>
        </div>
      ),
    },
    {
      title: '积分',
      dataIndex: 'charged_amount',
      width: 96,
      render: (_: number, r) => (
        <div className="text-[12px] leading-5">
          <div className="text-gray-800">-{r.charged_amount}</div>
          {r.refunded_amount > 0 && <div className="text-green-600">+{r.refunded_amount}</div>}
        </div>
      ),
    },
    {
      title: '执行 / 节点',
      dataIndex: 'exec_id',
      width: 176,
      render: (_: number, r) =>
        r.exec_id > 0 ? (
          <div className="text-[11px] leading-5 text-gray-500">
            <div className="text-gray-700">exec {r.exec_id}</div>
            {/* 节点 ID 常常很长（节点名 + 时间戳），放宽这一列并允许折行，别截断 */}
            <div className="break-all" title={r.node_id || ''}>
              {r.node_id || '-'}
            </div>
          </div>
        ) : (
          // 提示词生成、白模解析这类前端直连接口不跑工作流，没有执行号也没有节点 ——
          // 显示「-」，不要显示 "exec 0"（那不是执行号，看着像数据错了）
          <span className="text-[11px] text-gray-300">-</span>
        ),
    },
    {
      title: '上游任务号',
      dataIndex: 'upstream_task_id',
      width: 150,
      render: (v: string) =>
        v ? (
          <span className="text-[11px] text-gray-700 break-all">{v}</span>
        ) : (
          // 同步调用（图片/故事/剧本/音频/白模解析）没有上游任务号，
          // 创建阶段就失败、还没拿到号的视频也没有 —— 一律留「-」，
          // 不拿我们自己造的编号冒充（那种编号拿到渠道后台查不到）
          <span className="text-[11px] text-gray-300">-</span>
        ),
    },
    {
      title: '备注',
      dataIndex: 'note',
      // 160 → 224：自检写的原因+上游报错都在这列，两行装得下更多
      width: 224,
      render: (v: string) =>
        v ? (
          // 备注常常很长（上游原始报错 + 自检写的原因），这里最多显示两行，超出部分放浮层看全文
          <Tooltip
            // 浮层限宽 + 超高可滚动：上游原始报错很长，默认的窄气泡会竖成一条
            title={<div className="text-[12px] leading-5 break-all max-w-[520px] max-h-[320px] overflow-auto">{v}</div>}
          >
            {/* 用 line-clamp-2 + break-all 而不是 truncate：
                truncate 是 white-space: nowrap，一旦表格不是固定布局（列宽之和 ≠ scroll.x 时
                表体就会退回自动布局），不会换行的长文本会把整列顶宽、把表格挤乱。
                line-clamp-2 自己内部允许换行，长任务号/长英文也不会撑开，视觉上「最多两行 + 省略号」。 */}
            {/* 注意：这里**不能**再写 block —— line-clamp-2 靠 display:-webkit-box 生效，
                而构建出来的 CSS 里 .block 排在 .line-clamp-2 后面，同权重下会把 -webkit-box
                覆盖回 block，截断直接失效（表现为备注照样铺满好几行）。 */}
            <span className="text-[11px] text-gray-500 line-clamp-2 break-all cursor-help leading-4">
              {v}
            </span>
          </Tooltip>
        ) : (
          <span className="text-[11px] text-gray-300">-</span>
        ),
    },
  ];

  return (
    <div className="flex-1 overflow-auto p-6">
      {/* 在线预览：产物地址带后台签发的短期票据，后台代理转发并把响应头改成 inline
          （存储本身返回 attachment，直接点地址只能下载）；播放器复用画布那套沉浸式预览。
          这里刻意是**单击**触发，画布上才是双击。 */}
      <MediaPreviewModal
        open={!!preview}
        kind={preview?.kind || 'video'}
        url={preview?.url}
        title={preview?.title}
        meta={preview?.meta}
        onClose={() => setPreview(null)}
      />

      {/* 汇总条：一眼看清「要动手的有几条」和「白付上游多少钱」 */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="px-3 py-2 rounded bg-gray-50 border border-gray-100 text-[12px] text-gray-600">
          共 <span className="text-gray-900 font-medium">{stats?.total ?? 0}</span> 条
        </div>
        <div className="px-3 py-2 rounded bg-green-50 border border-green-100 text-[12px] text-green-700">
          已交付 {stats?.delivered ?? 0}
        </div>
        <div className="px-3 py-2 rounded bg-orange-50 border border-orange-200 text-[12px] text-orange-800 flex items-center gap-1">
          <WarningOutlined />
          待人工决定 {stats?.pending_review ?? 0} 条（上游没返回，退不退你定）
        </div>
        <div className="px-3 py-2 rounded bg-red-50 border border-red-100 text-[12px] text-red-700">
          已退费 {stats?.refunded ?? 0} 条
          <span className="text-gray-500">
            （自动 {stats?.auto_refunded ?? 0} · 人工 {stats?.manual_refunded ?? 0}）
          </span>
          {/* 真成本只算「人工退费」：自动退费的触发条件就是上游明确拒绝了这次任务，
              上游不会计费，我们没花钱；以前这里错用了所有退费的合计，2 条自动退费被当成
              「真成本 9060 积分」，跟这行字自己说的「人工那部分」自相矛盾。 */}
          <div className="mt-0.5">
            真成本 <span className="font-medium">{stats?.manual_refunded_credits ?? 0}</span> 积分
            <span className="text-gray-500">
              （只有人工退费那部分上游可能已计费
              {(stats?.auto_refunded_credits ?? 0) > 0
                ? `；自动退费的 ${stats?.auto_refunded_credits} 积分是上游明确拒绝、上游不计费，不算成本`
                : ''}
              {(stats?.unknown_refunded_credits ?? 0) > 0
                ? `；另有 ${stats?.unknown_refunded_credits} 积分是上线前退的、来源分不清，未计入`
                : ''}
              ）
            </span>
          </div>
        </div>
        <div className="px-3 py-2 rounded bg-gray-50 border border-gray-100 text-[12px] text-gray-600">
          扣费合计 {stats?.charged_credits ?? 0}
        </div>
      </div>

      {/* 筛选 */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <Select
          value={status}
          onChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
          style={{ width: 150 }}
          options={[
            { value: '', label: '全部状态' },
            { value: 'pending_review', label: '待人工决定' },
            { value: 'delivered', label: '已交付' },
            { value: 'submitted', label: '进行中' },
            { value: 'refunded', label: '已退费' },
          ]}
        />
        <Select
          value={taskKind}
          onChange={(v) => {
            setTaskKind(v);
            setPage(1);
          }}
          style={{ width: 130 }}
          options={[
            { value: '', label: '全部类型' },
            { value: 'ai.video', label: '视频' },
            { value: 'ai.image', label: '图片' },
            { value: 'ai.story', label: '故事' },
            { value: 'ai.script', label: '剧本' },
            { value: 'ai.audio', label: '音频' },
            { value: 'ai.previz_analyze', label: '白模解析' },
          ]}
        />
        <Input
          value={userIdInput}
          onChange={(e) => setUserIdInput(e.target.value)}
          onPressEnter={() => {
            setUserId(userIdInput.trim());
            setPage(1);
          }}
          placeholder="昵称 / 邮箱 / 用户ID（支持部分输入）"
          style={{ width: 200 }}
          allowClear
          onClear={() => {
            setUserId('');
            setPage(1);
          }}
        />
        <Input
          value={projectIdInput}
          onChange={(e) => setProjectIdInput(e.target.value)}
          onPressEnter={() => {
            setProjectId(projectIdInput.trim());
            setPage(1);
          }}
          placeholder="项目名 / 项目ID（支持部分输入）"
          style={{ width: 300 }}
          allowClear
          onClear={() => {
            setProjectId('');
            setPage(1);
          }}
        />
        <Input
          value={taskIdInput}
          onChange={(e) => setTaskIdInput(e.target.value)}
          onPressEnter={() => {
            setTaskId(taskIdInput.trim());
            setPage(1);
          }}
          placeholder="上游任务号（支持部分匹配）"
          style={{ width: 260 }}
          allowClear
          onClear={() => {
            setTaskId('');
            setPage(1);
          }}
        />
        <Select
          value={onlyAlert ? 'alert' : ''}
          onChange={(v) => {
            setOnlyAlert(v === 'alert');
            setPage(1);
          }}
          style={{ width: 132 }}
          options={[
            { value: '', label: '全部记录' },
            { value: 'alert', label: `只看异常${stats?.alerted ? ` (${stats.alerted})` : ''}` },
          ]}
        />
        <Button
          icon={<SafetyOutlined />}
          loading={auditing}
          onClick={async () => {
            setAuditing(true);
            try {
              const rep = await providerTaskApi.runAudit();
              // 自检只做标记、不动钱；结果如实汇报（新标记/恢复/无主问题）
              if (rep.marked > 0) {
                message.warning(
                  `发现 ${rep.marked} 条异常数据，已自动标记并写入备注（可在「只看异常」里查看）`
                );
              } else {
                message.success(`一致性核对通过（耗时 ${rep.duration}）`);
              }
              if (rep.orphans?.length) {
                message.warning(
                  `另有 ${rep.orphans.length} 条「有扣费流水但无对账记录」的问题，已写入服务端日志`
                );
              }
              load();
            } catch {
              // HTTP 错误已由 api.ts 拦截器统一提示
            } finally {
              setAuditing(false);
            }
          }}
        >
          立即核对
        </Button>
        <Button
          icon={<ReloadOutlined />}
          loading={loading}
          onClick={() => {
            // 关键：把输入框里的当前值提交为筛选条件再拉取。
            // 原来直接 load()，用的是「回车时提交过的旧值」，所以填了项目点刷新列表不动、回车才生效。
            setTaskId(taskIdInput.trim());
            setProjectId(projectIdInput.trim());
            setUserId(userIdInput.trim());
            setPage(1);
            setRefreshToken((v) => v + 1); // 值没变时也强制刷新一次
          }}
          title="刷新列表（会把输入框里的筛选条件一起提交）"
        />
      </div>

      <Table<ProviderTask>
        rowKey="id"
        size="small"
        loading={loading}
        columns={columns}
        dataSource={items}
        pagination={false}
        // 必须等于各列 width 之和（150+150+150+160+96+176+150+224=1256）：
        // 不一致时 antd 的表头和表体宽度算法会对不上，列会错位
        scroll={{ x: 1256 }}
        locale={{ emptyText: '暂无记录（对账表从本次上线开始记录）' }}
      />

      <div className="flex justify-end mt-4">
        <Pagination
          current={page}
          pageSize={pageSize}
          total={total}
          showSizeChanger
          pageSizeOptions={[20, 50, 100]}
          onChange={(p, s) => {
            setPage(p);
            setPageSize(s);
          }}
          showTotal={(t) => `共 ${t} 条`}
        />
      </div>
    </div>
  );
}