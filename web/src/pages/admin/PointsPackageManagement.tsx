import { useCallback, useEffect, useState } from 'react';
import { App, Button, Input, InputNumber, Modal, Switch, Tag } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, LoadingOutlined, GoldOutlined } from '@ant-design/icons';
import { pointsPackageApi, type PointsPackage, type PointsPackagePayload } from '@/services/pointsPackageApi';

/** 编辑表单（editing=null 为新建） */
interface EditState {
  editing: PointsPackage | null;
  name: string;
  price: number;
  points: number;
  badge: string;
  recommended: boolean;
  features: string;
  sort_order: number;
  enabled: boolean;
}

const emptyForm = (): EditState => ({
  editing: null,
  name: '',
  price: 99,
  points: 10000,
  badge: '',
  recommended: false,
  features: '',
  sort_order: 0,
  enabled: true,
});

/**
 * 套餐管理：维护积分超市的套餐卡片（名称 / 售价 / 积分 / 角标 / 推荐 / 特点 / 排序 / 启用）
 * 特点每行一条，前台卡片按行展示
 */
export default function PointsPackageManagement() {
  const { message, modal } = App.useApp();
  const [packages, setPackages] = useState<PointsPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [editState, setEditState] = useState<EditState | null>(null);
  const [saving, setSaving] = useState(false);

  // 拉取套餐列表（setState 均在异步回调中，供 effect 与「刷新」按钮复用）
  const fetchPackages = useCallback(() => {
    pointsPackageApi
      .listAll()
      .then((res) => setPackages(res.items || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchPackages();
  }, [fetchPackages]);

  const load = useCallback(() => {
    setLoading(true);
    fetchPackages();
  }, [fetchPackages]);

  const openCreate = () => setEditState(emptyForm());

  const openEdit = (pkg: PointsPackage) =>
    setEditState({
      editing: pkg,
      name: pkg.name,
      price: pkg.price,
      points: pkg.points,
      badge: pkg.badge || '',
      recommended: pkg.recommended,
      features: pkg.features || '',
      sort_order: pkg.sort_order,
      enabled: pkg.enabled,
    });

  const handleSave = async () => {
    if (!editState) return;
    if (!editState.name.trim()) {
      message.error('请填写套餐名称');
      return;
    }
    if (!editState.price || editState.price <= 0 || !editState.points || editState.points <= 0) {
      message.error('售价与积分必须大于 0');
      return;
    }
    const payload: PointsPackagePayload = {
      name: editState.name.trim(),
      price: editState.price,
      points: editState.points,
      badge: editState.badge.trim(),
      recommended: editState.recommended,
      features: editState.features,
      sort_order: editState.sort_order,
      enabled: editState.enabled,
    };
    setSaving(true);
    try {
      if (editState.editing) {
        await pointsPackageApi.update(editState.editing.id, payload);
        message.success('套餐已更新');
      } else {
        await pointsPackageApi.create(payload);
        message.success('套餐已创建');
      }
      setEditState(null);
      load();
    } catch {
      // HTTP 错误已由 api.ts 拦截器统一 message.error()
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (pkg: PointsPackage) => {
    modal.confirm({
      title: '确认删除',
      content: `确定要删除套餐「${pkg.name}」吗？此操作不可恢复。`,
      okText: '确定删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await pointsPackageApi.remove(pkg.id);
          message.success('删除成功');
          load();
        } catch {
          // HTTP 错误已由 api.ts 拦截器统一 message.error()
        }
      },
    });
  };

  const handleToggleEnabled = async (pkg: PointsPackage) => {
    try {
      await pointsPackageApi.update(pkg.id, {
        name: pkg.name,
        price: pkg.price,
        points: pkg.points,
        badge: pkg.badge,
        recommended: pkg.recommended,
        features: pkg.features,
        sort_order: pkg.sort_order,
        enabled: !pkg.enabled,
      });
      message.success(pkg.enabled ? '已下架' : '已上架');
      load();
    } catch {
      // HTTP 错误已由 api.ts 拦截器统一 message.error()
    }
  };

  return (
    <div className="flex-1 overflow-y-auto">
      {/* 工具栏 */}
      <div className="bg-white px-6 py-3 border-b border-gray-100 flex items-center gap-3 sticky top-0 z-10">
        <div className="text-[11px] text-gray-400">
          维护积分超市的套餐卡片；特点每行一条，卡片按行展示；「推荐」的套餐高亮显示
        </div>
        <div className="flex-1" />
        <Button size="small" onClick={load} disabled={saving}>
          刷新
        </Button>
        <Button type="primary" size="small" icon={<PlusOutlined />} onClick={openCreate}>
          新建套餐
        </Button>
      </div>

      {/* 套餐列表 */}
      <div className="p-6">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-gray-400">
            <LoadingOutlined className="mr-2" /> 加载中...
          </div>
        ) : packages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-gray-400">
            <GoldOutlined style={{ fontSize: 36 }} className="mb-3 opacity-40" />
            <div className="text-[14px]">暂无套餐，点击右上角「新建套餐」创建</div>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-left">
              <thead>
                <tr className="text-gray-400 text-[12px] border-b border-gray-100 bg-gray-50/60">
                  <th className="px-4 py-2.5 font-normal">套餐名称</th>
                  <th className="px-4 py-2.5 font-normal text-right">售价（元）</th>
                  <th className="px-4 py-2.5 font-normal text-right">积分</th>
                  <th className="px-4 py-2.5 font-normal">角标</th>
                  <th className="px-4 py-2.5 font-normal text-center">推荐</th>
                  <th className="px-4 py-2.5 font-normal text-center">排序</th>
                  <th className="px-4 py-2.5 font-normal text-center">状态</th>
                  <th className="px-4 py-2.5 font-normal text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {packages.map((pkg) => (
                  <tr key={pkg.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 text-[13px] text-gray-700 font-medium">{pkg.name}</td>
                    <td className="px-4 py-3 text-[13px] text-gray-600 text-right">¥{pkg.price}</td>
                    <td className="px-4 py-3 text-[13px] text-amber-600 text-right font-medium">
                      {pkg.points.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-[12px] text-gray-500">{pkg.badge || '-'}</td>
                    <td className="px-4 py-3 text-center">
                      {pkg.recommended ? <Tag color="gold" className="!m-0">推荐</Tag> : <span className="text-gray-300">-</span>}
                    </td>
                    <td className="px-4 py-3 text-[13px] text-gray-500 text-center">{pkg.sort_order}</td>
                    <td className="px-4 py-3 text-center">
                      <Switch size="small" checked={pkg.enabled} onChange={() => handleToggleEnabled(pkg)} />
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <Button size="small" type="text" icon={<EditOutlined />} onClick={() => openEdit(pkg)}>
                        编辑
                      </Button>
                      <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => handleDelete(pkg)}>
                        删除
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 新建 / 编辑弹窗 */}
      <Modal
        title={editState?.editing ? `编辑套餐「${editState.editing.name}」` : '新建套餐'}
        open={editState !== null}
        onCancel={() => setEditState(null)}
        onOk={handleSave}
        okText={editState?.editing ? '保存' : '创建'}
        cancelText="取消"
        confirmLoading={saving}
        destroyOnClose
        width={480}
      >
        {editState && (
          <div className="space-y-4 py-2">
            <div className="flex items-center gap-3">
              <span className="w-20 shrink-0 text-[13px] text-gray-600">套餐名称</span>
              <Input
                value={editState.name}
                onChange={(e) => setEditState({ ...editState, name: e.target.value })}
                placeholder="如：尝鲜包"
                maxLength={20}
              />
            </div>
            <div className="flex items-center gap-3">
              <span className="w-20 shrink-0 text-[13px] text-gray-600">售价（元）</span>
              <InputNumber
                className="flex-1"
                min={1}
                precision={0}
                value={editState.price}
                onChange={(v) => setEditState({ ...editState, price: v ?? 0 })}
              />
            </div>
            <div className="flex items-center gap-3">
              <span className="w-20 shrink-0 text-[13px] text-gray-600">积分数量</span>
              <InputNumber
                className="flex-1"
                min={1}
                precision={0}
                value={editState.points}
                onChange={(v) => setEditState({ ...editState, points: v ?? 0 })}
              />
            </div>
            <div className="flex items-center gap-3">
              <span className="w-20 shrink-0 text-[13px] text-gray-600">角标文案</span>
              <Input
                value={editState.badge}
                onChange={(e) => setEditState({ ...editState, badge: e.target.value })}
                placeholder="如：最受欢迎（留空无角标）"
                maxLength={10}
              />
            </div>
            <div className="flex items-center gap-3">
              <span className="w-20 shrink-0 text-[13px] text-gray-600">排序</span>
              <InputNumber
                className="flex-1"
                precision={0}
                value={editState.sort_order}
                onChange={(v) => setEditState({ ...editState, sort_order: v ?? 0 })}
              />
              <span className="text-[11px] text-gray-400">越小越靠前</span>
            </div>
            <div className="flex items-start gap-3">
              <span className="w-20 shrink-0 pt-1 text-[13px] text-gray-600">套餐特点</span>
              <Input.TextArea
                value={editState.features}
                onChange={(e) => setEditState({ ...editState, features: e.target.value })}
                placeholder={'每行一条，如：\n约 101 积分 / 元\n积分永久有效'}
                rows={5}
              />
            </div>
            <div className="flex items-center gap-6">
              <label className="flex items-center gap-2 text-[13px] text-gray-600">
                <Switch
                  size="small"
                  checked={editState.recommended}
                  onChange={(v) => setEditState({ ...editState, recommended: v })}
                />
                推荐（卡片高亮）
              </label>
              <label className="flex items-center gap-2 text-[13px] text-gray-600">
                <Switch
                  size="small"
                  checked={editState.enabled}
                  onChange={(v) => setEditState({ ...editState, enabled: v })}
                />
                上架展示
              </label>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
