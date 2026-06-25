import { memo, useCallback, useMemo, useRef } from 'react';
import { Table, Tag, Input, Select, Dropdown } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  MoreOutlined,
  CopyOutlined,
  DeleteOutlined,
  ArrowUpOutlined,
  ArrowDownOutlined,
} from '@ant-design/icons';
import type { ScriptShot } from '@/types/canvas';

interface ShotTableProps {
  shots: ScriptShot[];
  onChange?: (shots: ScriptShot[]) => void;
  readOnly?: boolean;
}

// 镜别选项 — 模块级常量，永不重建
const SHOT_SIZE_OPTIONS = [
  { label: '远景', value: '远景' },
  { label: '全景', value: '全景' },
  { label: '中景', value: '中景' },
  { label: '近景', value: '近景' },
  { label: '特写', value: '特写' },
  { label: '大特写', value: '大特写' },
] as const;

// ============================================================
// 子组件：全部 memo，避免单元格级重复渲染
// ============================================================

/** 画面提示词高亮（识别 · 标签） */
const HighlightedPrompt = memo(function HighlightedPrompt({ text }: { text: string }) {
  if (!text) return <span className="text-gray-300">-</span>;
  const parts = text.split(/(·[^·]+·)/g);
  return (
    <span className="text-[11px] leading-relaxed">
      {parts.map((part, i) =>
        part.startsWith('·') && part.endsWith('·') ? (
          <mark key={i} className="bg-cyan-100 text-cyan-700 px-0.5 rounded">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </span>
  );
});

/** 可编辑单元格 — memo + 稳定 props */
interface EditableCellProps {
  value: string | number;
  onChange: (val: string | number) => void;
  editable: boolean;
  component?: 'input' | 'select' | 'number';
  options?: readonly { label: string; value: string }[];
}

const EditableCell = memo<EditableCellProps>(function EditableCell({
  value,
  onChange,
  editable,
  component = 'input',
  options,
}) {
  if (!editable) {
    if (component === 'select' && options) {
      const opt = options.find((o) => o.value === value);
      return opt ? <Tag color="blue" style={{ fontSize: 12, margin: 0 }}>{opt.label}</Tag> : <span style={{ fontSize: 12 }}>{value || '-'}</span>;
    }
    return <span style={{ fontSize: 12 }}>{value || '-'}</span>;
  }

  if (component === 'select') {
    return (
      <Select
        size="small"
        value={value}
        onChange={onChange}
        options={options as { label: string; value: string }[]}
        variant="borderless"
        className="w-full"
        popupMatchSelectWidth={false}
        style={{ fontSize: 11 }}
      />
    );
  }

  if (component === 'number') {
    return (
      <Input
        size="small"
        type="number"
        value={value as number}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (!Number.isNaN(n)) onChange(n);
        }}
        min={1}
        max={60}
        variant="borderless"
        // 时长输入框：紧凑 + 居中，与列宽对齐
        // 强制覆盖 antd Input 内部的 14px 默认字号
        className="!w-10 text-center !px-1"
        style={{ fontSize: 11 }}
      />
    );
  }

  return (
    <Input
      size="small"
      value={value as string}
      onChange={(e) => onChange(e.target.value)}
      variant="borderless"
      className="w-full"
      style={{ fontSize: 11 }}
    />
  );
});

// ============================================================
// 主组件
// ============================================================

export const ShotTable = memo<ShotTableProps>(function ShotTable({
  shots,
  onChange,
  readOnly = false,
}) {
  // 用 ref 存储 shots/onChange 的最新值，让内部回调保持稳定引用
  const shotsRef = useRef(shots);
  shotsRef.current = shots;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  /** 统一的 cell 变更处理 — 引用稳定 */
  const handleCellChange = useCallback(
    (shotId: string, field: keyof ScriptShot, val: any) => {
      const fn = onChangeRef.current;
      if (!fn) return;
      fn(
        shotsRef.current.map((s) => (s.id === shotId ? { ...s, [field]: val } : s))
      );
    },
    [] // 永不变化
  );

  /** 行操作菜单生成器 — 引用稳定 */
  const getRowMenuItems = useCallback((shot: ScriptShot) => {
    return [
      {
        key: 'copy',
        label: '复制镜头',
        icon: <CopyOutlined />,
        onClick: () => {
          const fn = onChangeRef.current;
          if (!fn) return;
          const currentShots = shotsRef.current;
          const newShot: ScriptShot = {
            ...shot,
            id: `shot-${Date.now()}`,
            shotNumber: currentShots.length + 1,
          };
          const idx = currentShots.findIndex((s) => s.id === shot.id);
          fn([...currentShots.slice(0, idx + 1), newShot, ...currentShots.slice(idx + 1)]);
        },
      },
      {
        key: 'moveUp',
        label: '上移',
        icon: <ArrowUpOutlined />,
        disabled: shot.shotNumber <= 1,
        onClick: () => {
          const fn = onChangeRef.current;
          if (!fn || shot.shotNumber <= 1) return;
          const currentShots = shotsRef.current;
          const idx = currentShots.findIndex((s) => s.id === shot.id);
          if (idx <= 0) return;
          const newShots = [...currentShots];
          [newShots[idx - 1], newShots[idx]] = [newShots[idx], newShots[idx - 1]];
          fn(newShots.map((s, i) => ({ ...s, shotNumber: i + 1 })));
        },
      },
      {
        key: 'moveDown',
        label: '下移',
        icon: <ArrowDownOutlined />,
        disabled: shot.shotNumber >= shotsRef.current.length,
        onClick: () => {
          const fn = onChangeRef.current;
          const currentShots = shotsRef.current;
          if (!fn || shot.shotNumber >= currentShots.length) return;
          const idx = currentShots.findIndex((s) => s.id === shot.id);
          if (idx >= currentShots.length - 1) return;
          const newShots = [...currentShots];
          [newShots[idx], newShots[idx + 1]] = [newShots[idx + 1], newShots[idx]];
          fn(newShots.map((s, i) => ({ ...s, shotNumber: i + 1 })));
        },
      },
      { type: 'divider' as const },
      {
        key: 'delete',
        label: '删除镜头',
        icon: <DeleteOutlined />,
        danger: true,
        onClick: () => {
          const fn = onChangeRef.current;
          if (!fn) return;
          const currentShots = shotsRef.current;
          fn(
            currentShots.filter((s) => s.id !== shot.id).map((s, i) => ({ ...s, shotNumber: i + 1 }))
          );
        },
      },
    ];
  }, []); // 永不变化，内部通过 ref 读最新值

  // ============================================================
  // columns 用 useMemo 缓存 — 只在 readOnly 变化时重建
  // 内部 render 函数通过闭包捕获稳定的 handleCellChange / getRowMenuItems
  // ============================================================
  const columns: ColumnsType<ScriptShot> = useMemo(() => [
    {
      title: '序号',
      dataIndex: 'shotNumber',
      width: 50,
      align: 'center',
      render: (v: number) => <span className="text-[11px] text-gray-500 font-mono">{v}</span>,
    },
    {
      title: '时长(s)',
      dataIndex: 'duration',
      width: 40,
      align: 'center',
      render: (v: number, record) =>
        !readOnly ? (
          <EditableCell
            value={v}
            onChange={(val) => handleCellChange(record.id, 'duration', val)}
            editable
            component="number"
          />
        ) : (
          <span className="text-[11px]">{v}s</span>
        ),
    },
    {
      title: '画面提示词',
      dataIndex: 'visualPrompt',
      width: 250,
      render: (text: string, record) =>
        !readOnly ? (
          <Input.TextArea
            size="small"
            value={text}
            onChange={(e) => handleCellChange(record.id, 'visualPrompt', e.target.value)}
            variant="borderless"
            className="w-full"
            style={{ fontSize: 11 }}
            autoSize={{ maxRows: 3 }}
          />
        ) : (
          <HighlightedPrompt text={text} />
        ),
    },
    {
      title: '镜别',
      dataIndex: 'shotSize',
      width: 80,
      render: (v: string, record) => (
        <EditableCell
          value={v}
          onChange={(val) => handleCellChange(record.id, 'shotSize', val)}
          editable={!readOnly}
          component="select"
          options={SHOT_SIZE_OPTIONS}
        />
      ),
    },
    {
      title: '角度',
      dataIndex: 'cameraAngle',
      width: 80,
      render: (v: string, record) => (
        <EditableCell
          value={v}
          onChange={(val) => handleCellChange(record.id, 'cameraAngle', val)}
          editable={!readOnly}
        />
      ),
    },
    {
      title: '对白/旁白',
      dataIndex: 'dialogue',
      width: 220,
      render: (v: string, record) =>
        !readOnly ? (
          <Input.TextArea
            size="small"
            value={v}
            onChange={(e) => handleCellChange(record.id, 'dialogue', e.target.value)}
            variant="borderless"
            className="w-full"
            style={{ fontSize: 11 }}
            autoSize={{ minRows: 1, maxRows: 4 }}
          />
        ) : (
          <span className="text-[11px] whitespace-pre-wrap">{v || '-'}</span>
        ),
    },
    {
      title: '音效',
      dataIndex: 'soundEffect',
      width: 120,
      render: (v: string, record) =>
        !readOnly ? (
          <Input.TextArea
            size="small"
            value={v}
            onChange={(e) => handleCellChange(record.id, 'soundEffect', e.target.value)}
            variant="borderless"
            className="w-full"
            style={{ fontSize: 11 }}
            autoSize={{ minRows: 1, maxRows: 3 }}
          />
        ) : (
          <span className="text-[11px] whitespace-pre-wrap">{v || '-'}</span>
        ),
    },
    {
      title: '运镜',
      dataIndex: 'cameraMovement',
      width: 100,
      render: (v: string, record) =>
        !readOnly ? (
          <Input.TextArea
            size="small"
            value={v}
            onChange={(e) => handleCellChange(record.id, 'cameraMovement', e.target.value)}
            variant="borderless"
            className="w-full"
            style={{ fontSize: 11 }}
            autoSize={{ minRows: 1, maxRows: 3 }}
          />
        ) : (
          <span className="text-[11px] whitespace-pre-wrap">{v || '-'}</span>
        ),
    },
    {
      title: '基调提示方式',
      dataIndex: 'toneHint',
      width: 140,
      render: (v: string, record) =>
        !readOnly ? (
          <Input.TextArea
            size="small"
            value={v}
            onChange={(e) => handleCellChange(record.id, 'toneHint', e.target.value)}
            variant="borderless"
            className="w-full"
            style={{ fontSize: 11 }}
            autoSize={{ minRows: 1, maxRows: 3 }}
          />
        ) : (
          <span className="text-[11px] whitespace-pre-wrap">{v || '-'}</span>
        ),
    },
    {
      title: '操作',
      key: 'action',
      width: 50,
      align: 'center',
      render: (_: unknown, record) =>
        !readOnly ? (
          <Dropdown menu={{ items: getRowMenuItems(record) }} trigger={['click']}>
            <MoreOutlined className="text-gray-400 hover:text-gray-600 cursor-pointer text-[11px]" />
          </Dropdown>
        ) : null,
    },
  ], [readOnly, handleCellChange, getRowMenuItems]); // 三个都是稳定引用

  return (
    <Table<ScriptShot>
      dataSource={shots}
      columns={columns}
      rowKey="id"
      pagination={false}
      size="small"
      // 不设 scroll.y：让外层 wrapper 用原生 overflow-auto 滚动整个表格
      // 保留 scroll.x 处理列宽超过 1100px 时的横向滚动
      scroll={{ x: 1100 }}
      bordered
      // [!] 字号缩到 11px + padding 收紧
      // 深度选择器覆盖 antd Input/TextArea/Select 内部 14px 硬编码
      className="[&_.ant-table-cell]:!p-1.5 [&_.ant-table-thead>tr>th]:!bg-gray-50 [&_.ant-table-thead>tr>th]:!font-medium [&_.ant-table-thead>tr>th]:!text-[11px] [&_.ant-table-cell]:!text-[11px] [&_.ant-table-cell_input]:!text-[11px] [&_.ant-table-cell_input>_input]:!text-[11px] [&_.ant-table-cell_textarea]:!text-[11px] [&_.ant-table-cell_textarea>_textarea]:!text-[11px]"
      locale={{ emptyText: '暂无分镜数据，请从上游文本节点生成或手动添加' }}
    />
  );
});
