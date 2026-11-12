import { App, Button, Select } from 'antd';
import { DownOutlined } from '@ant-design/icons';
import { userApi, type UserItem } from '@/services/userApi';
import { channelApi } from '@/services/channelApi';
import { recordCount, recordTime } from './recordFormat';

interface Props {
  users: UserItem[];
  currentUserId?: string;
  onRecharge: (user: UserItem) => void;
  onBilling: (user: UserItem) => void;
  onChanged: () => void;
}

export function MobileUserList({ users, currentUserId, onRecharge, onBilling, onChanged }: Props) {
  const { message, modal } = App.useApp();
  const remove = (user: UserItem) => modal.confirm({
    title: '删除用户',
    content: `确定要删除用户「${user.email}」吗？`,
    okText: '确认', cancelText: '取消', okButtonProps: { danger: true },
    onOk: () => {
      modal.confirm({
        title: '永久删除用户及其数据',
        content: '将删除此用户的项目、画布、工作流执行记录及风格收藏。此操作不可恢复。',
        okText: '确认删除', cancelText: '取消', okButtonProps: { danger: true },
        onOk: async () => { await userApi.delete(user.id); onChanged(); },
      });
    },
  });
  return <div className="admin-record-list" aria-label="用户列表">
    {users.map(user => <article className="admin-user-item admin-record-item" key={user.id}>
      <header className="admin-record-heading">
        <div className="admin-record-identity">
          <div className="admin-record-name">
            <h2>{user.nickname || '未设置昵称'}</h2>
            {user.role === 'admin' && <span className="admin-record-badge">管理员</span>}
            {user.id === currentUserId && <span className="admin-record-muted">本人</span>}
          </div>
          <p className="admin-record-email">{user.email}</p>
        </div>
        <div className="admin-record-balance"><span>剩余积分</span><strong>{recordCount(user.credits)}</strong></div>
      </header>
      <div className="admin-record-caption">
        <span>{user.channel === 'dianxin' ? '电信渠道' : '华数渠道'} · {user.project_count || 0} 个项目</span>
        <span>最后操作 {recordTime(user.last_active_at)}</span>
      </div>
      <div className="admin-record-actions">
        <Button onClick={() => onRecharge(user)}>充值</Button>
        <Button onClick={() => onBilling(user)}>积分明细</Button>
      </div>
      <details className="admin-record-details">
        <summary>账户设置与详情<DownOutlined aria-hidden /></summary>
        <div className="admin-record-detail-body">
          <div className="admin-account-settings">
            <label><span>角色</span><Select aria-label={`${user.nickname || user.email}的角色`}
              value={user.role} disabled={user.id === currentUserId}
              options={[{ value: 'user', label: '普通用户' }, { value: 'admin', label: '管理员' }]}
              onChange={value => {
                void userApi.updateRole(user.id, value as 'user' | 'admin').then(() => {
                  message.success('角色已更新'); onChanged();
                }).catch(() => {});
              }} /></label>
            <label><span>渠道商</span><Select aria-label={`${user.nickname || user.email}的渠道`}
              value={user.channel || 'wasu'}
              options={[{ value: 'wasu', label: '华数' }, { value: 'dianxin', label: '电信' }]}
              onChange={value => {
                void channelApi.updateUserChannel(user.id, value as 'wasu' | 'dianxin').then(() => {
                  message.success('渠道已更新'); onChanged();
                }).catch(() => {});
              }} /></label>
          </div>
          <dl className="admin-record-facts">
            <div><dt>用户 ID</dt><dd>{user.id}</dd></div>
            <div><dt>注册时间</dt><dd>{recordTime(user.created_at, true)}</dd></div>
            <div><dt>最后操作</dt><dd>{recordTime(user.last_active_at, true)}</dd></div>
            <div><dt>资产</dt><dd>图片 {user.asset_image_count || 0} · 视频 {user.asset_video_count || 0}</dd></div>
            {user.inviter_id && <div><dt>邀请者</dt><dd>{user.inviter_nickname || user.inviter_email || '已注销用户'}</dd></div>}
          </dl>
          {user.id !== currentUserId && <Button danger type="text" onClick={() => remove(user)}>删除用户</Button>}
        </div>
      </details>
    </article>)}
  </div>;
}
