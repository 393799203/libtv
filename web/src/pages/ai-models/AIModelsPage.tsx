import { Typography, Card, Tag, Table, Button, Space, Badge } from 'antd';
import {
  RobotOutlined,
  PlusOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import type { MenuProps } from 'antd';

const { Title, Text } = Typography;

interface AIModel {
  id: string;
  name: string;
  type: 'llm' | 'image' | 'video' | 'audio';
  provider: string;
  status: 'active' | 'inactive';
  description: string;
}

const modelTypeConfig: Record<string, { color: string; label: string }> = {
  llm: { color: 'purple', label: 'LLM' },
  image: { color: 'blue', label: '图像' },
  video: { color: 'red', label: '视频' },
  audio: { color: 'green', label: '音频' },
};

const mockModels: AIModel[] = [
  {
    id: '1',
    name: 'GPT-4o',
    type: 'llm',
    provider: 'OpenAI',
    status: 'active',
    description: '脚本解析、分镜拆解',
  },
  {
    id: '2',
    name: 'Stable Diffusion XL',
    type: 'image',
    provider: 'ComfyUI',
    status: 'active',
    description: 'AI 生图',
  },
  {
    id: '3',
    name: '可灵 3.0',
    type: 'video',
    provider: '快手',
    status: 'active',
    description: 'AI 生视频',
  },
  {
    id: '4',
    name: 'Edge TTS',
    type: 'audio',
    provider: 'Microsoft',
    status: 'active',
    description: 'TTS 语音合成',
  },
];

const columns = [
  {
    title: '模型名称',
    dataIndex: 'name',
    key: 'name',
    render: (name: string) => (
      <span className="font-medium">{name}</span>
    ),
  },
  {
    title: '类型',
    dataIndex: 'type',
    key: 'type',
    render: (type: string) => {
      const config = modelTypeConfig[type];
      return <Tag color={config.color}>{config.label}</Tag>;
    },
  },
  {
    title: '提供商',
    dataIndex: 'provider',
    key: 'provider',
  },
  {
    title: '状态',
    dataIndex: 'status',
    key: 'status',
    render: (status: string) => (
      <Badge
        status={status === 'active' ? 'success' : 'default'}
        text={status === 'active' ? '已启用' : '未启用'}
      />
    ),
  },
  {
    title: '用途',
    dataIndex: 'description',
    key: 'description',
    render: (desc: string) => <Text type="secondary">{desc}</Text>,
  },
  {
    title: '操作',
    key: 'action',
    render: () => (
      <Button type="text" size="small" icon={<SettingOutlined />}>
        配置
      </Button>
    ),
  },
];

export default function AIModelsPage() {
  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <Title level={4} className="!mb-0">AI 模型管理</Title>
        <Button type="primary" icon={<PlusOutlined />}>
          添加模型
        </Button>
      </div>

      <Card bordered={false} className="!rounded-lg">
        <Table
          dataSource={mockModels}
          columns={columns}
          rowKey="id"
          pagination={false}
        />
      </Card>
    </div>
  );
}
