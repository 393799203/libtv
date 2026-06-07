import { Typography, Card, Form, Input, Button, Divider, App } from 'antd';
import { UserOutlined, MailOutlined } from '@ant-design/icons';
import { useAuthStore } from '@/stores/authStore';

const { Title, Text } = Typography;

export default function SettingsPage() {
  const { message } = App.useApp();
  const user = useAuthStore((s) => s.user);

  const handleSave = () => {
    message.success('设置已保存');
  };

  return (
    <div className="max-w-3xl mx-auto">
      <Title level={4} className="!mb-6">系统设置</Title>

      {/* 个人信息 */}
      <Card title="个人信息" bordered={false} className="!rounded-lg mb-4">
        <Form layout="vertical" onFinish={handleSave}>
          <Form.Item
            label="昵称"
            initialValue={user?.nickname ?? ''}
            name="nickname"
          >
            <Input prefix={<UserOutlined />} />
          </Form.Item>
          <Form.Item
            label="邮箱"
            initialValue={user?.email ?? ''}
            name="email"
          >
            <Input prefix={<MailOutlined />} disabled />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit">
              保存修改
            </Button>
          </Form.Item>
        </Form>
      </Card>

      {/* 修改密码 */}
      <Card title="修改密码" bordered={false} className="!rounded-lg mb-4">
        <Form layout="vertical">
          <Form.Item label="当前密码" name="currentPassword">
            <Input.Password />
          </Form.Item>
          <Form.Item label="新密码" name="newPassword">
            <Input.Password />
          </Form.Item>
          <Form.Item label="确认新密码" name="confirmPassword">
            <Input.Password />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit">
              修改密码
            </Button>
          </Form.Item>
        </Form>
      </Card>

      {/* 关于 */}
      <Card title="关于" bordered={false} className="!rounded-lg">
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <Text type="secondary">版本</Text>
            <Text>MVP v1.0.0</Text>
          </div>
          <div className="flex justify-between">
            <Text type="secondary">构建时间</Text>
            <Text>2026-06-06</Text>
          </div>
        </div>
      </Card>
    </div>
  );
}
