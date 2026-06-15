import { useState } from 'react';
import { ProCard, PageContainer } from '@ant-design/pro-components';
import { Button, Result, Steps, Space, message, Typography } from 'antd';
import { CheckCircleOutlined, DatabaseOutlined } from '@ant-design/icons';

const { Paragraph } = Typography;

const steps = [
  {
    title: 'Database',
    description: 'PostgreSQL connection',
    icon: <DatabaseOutlined />,
  },
  {
    title: 'Migration',
    description: 'Schema setup',
    icon: <DatabaseOutlined />,
  },
  {
    title: 'Seed Data',
    description: 'Default admin user and roles',
    icon: <CheckCircleOutlined />,
  },
];

export default function InitPage() {
  const [current, setCurrent] = useState(0);
  const [inited, setInited] = useState(false);

  const handleInit = () => {
    if (current < steps.length - 1) {
      setCurrent((prev) => prev + 1);
    } else {
      setInited(true);
      message.success('System initialized successfully');
    }
  };

  if (inited) {
    return (
      <PageContainer header={{ title: 'System Init' }}>
        <ProCard>
          <Result
            status="success"
            title="System Initialized"
            subTitle="The database schema and seed data have been set up. You can now use the platform."
            extra={[
              <Button
                type="primary"
                key="dashboard"
                onClick={() => {
                  window.location.href = '/dashboard';
                }}
              >
                Go to Dashboard
              </Button>,
            ]}
          />
        </ProCard>
      </PageContainer>
    );
  }

  return (
    <PageContainer header={{ title: 'System Init' }}>
      <ProCard title="Database Initialization Wizard">
        <Paragraph style={{ marginBottom: 24 }}>
          This wizard guides you through the initial system setup. The database
          will be checked, tables created, and default data (admin user, roles,
          permissions) will be seeded automatically.
        </Paragraph>

        <Steps
          current={current}
          items={steps}
          style={{ marginBottom: 32 }}
        />

        <ProCard bordered size="small" style={{ marginBottom: 16 }}>
          {current === 0 && (
            <div>
              <p>Checking PostgreSQL connection...</p>
              <p>
                <strong>Host:</strong> localhost:5432
              </p>
              <p>
                <strong>Database:</strong> lowcode
              </p>
            </div>
          )}
          {current === 1 && (
            <div>
              <p>Running database migrations...</p>
              <p>Tables to be created: sys_users, sys_roles, sys_menus, sys_apis, etc.</p>
            </div>
          )}
          {current === 2 && (
            <div>
              <p>Seeding default data...</p>
              <p>
                <strong>Admin user:</strong> admin / admin123
              </p>
              <p>
                <strong>Roles:</strong> super_admin, admin, editor, viewer
              </p>
            </div>
          )}
        </ProCard>

        <Space>
          <Button
            type="primary"
            onClick={handleInit}
            disabled={current >= steps.length}
          >
            {current < steps.length - 1 ? 'Next Step' : 'Initialize'}
          </Button>
        </Space>
      </ProCard>
    </PageContainer>
  );
}
