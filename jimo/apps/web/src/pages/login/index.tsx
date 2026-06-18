import { Form, Input, Button, Card, message } from 'antd';
import { UserOutlined, LockOutlined } from '@ant-design/icons';
import { login } from '@/services/auth';
import { getAccessibleMenus } from '@/services/menu';
import { useUserStore } from '@/stores/user';
import styles from './index.module.css';

export default function LoginPage() {
  const [form] = Form.useForm();
  const setTokens = useUserStore((s) => s.setTokens);
  const setUser = useUserStore((s) => s.setUser);
  const setMenuTree = useUserStore((s) => s.setMenuTree);

  const handleLogin = async (values: { username: string; password: string }) => {
    try {
      const data = await login(values);
      setTokens(data.access_token, data.refresh_token);
      const jwtPayload = JSON.parse(atob(data.access_token.split('.')[1]!));
      setUser({
        id: jwtPayload.sub as string,
        username: values.username,
        nickname: (jwtPayload.username as string) || values.username,
        status: 1,
        role: (jwtPayload.role as string) || undefined,
      });

      // Fetch accessible menus NOW and persist to localStorage.
      // patchClientRoutes reads menuTree synchronously on the next page load.
      try {
        const menus = await getAccessibleMenus();
        setMenuTree(menus);
      } catch {
        // Non-fatal: static routes from .umirc.ts will still render.
      }

      message.success('登录成功');
      // Hard reload so that getInitialState() + patchClientRoutes() both re-run
      // with the authenticated user's data & permission-filtered menus.
      window.location.href = '/dashboard';
    } catch (err: any) {
      message.error(err.message || '用户名或密码错误');
    }
  };

  return (
    <div className={styles.container}>
      <Card className={styles.card} title="Jimo">
        <Form form={form} onFinish={handleLogin} size="large">
          <Form.Item name="username" rules={[{ required: true, message: '请输入用户名' }]}>
            <Input prefix={<UserOutlined />} placeholder="用户名" />
          </Form.Item>
          <Form.Item name="password" rules={[{ required: true, message: '请输入密码' }]}>
            <Input.Password prefix={<LockOutlined />} placeholder="密码" />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" block>
              登录
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
}
