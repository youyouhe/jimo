import { ProCard } from '@ant-design/pro-components';
import { useUserStore } from '@/stores/user';

export default function DashboardPage() {
  const userInfo = useUserStore((s) => s.userInfo);

  return (
    <ProCard title="欢迎使用 LowCode Admin" style={{ margin: 24 }}>
      <p>欢迎回来，{userInfo?.nickname || userInfo?.username || '管理员'}！</p>
      <p>这是 Phase 1 基础框架，后续将集成完整的低代码功能。</p>
    </ProCard>
  );
}
