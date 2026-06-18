import { ProCard, PageContainer } from '@ant-design/pro-components';
import { Descriptions, Tag, Space, Typography } from 'antd';
import {
  GithubOutlined,
  ApiOutlined,
  DatabaseOutlined,
  CloudServerOutlined,
  SafetyOutlined,
} from '@ant-design/icons';

const { Paragraph, Link } = Typography;

const techStack = [
  {
    category: 'Backend',
    icon: <CloudServerOutlined />,
    items: [
      { name: 'NestJS', version: '11.x', link: 'https://nestjs.com' },
      { name: 'Drizzle ORM', version: 'latest', link: 'https://orm.drizzle.team' },
      { name: 'PostgreSQL', version: '16', link: 'https://www.postgresql.org' },
      { name: 'MinIO', version: 'latest', link: 'https://min.io' },
      { name: 'Casbin', version: 'v2', link: 'https://casbin.org' },
    ],
  },
  {
    category: 'Frontend',
    icon: <ApiOutlined />,
    items: [
      { name: 'React', version: '18.x', link: 'https://react.dev' },
      { name: 'Umi 4', version: '4.x', link: 'https://umijs.org' },
      { name: 'Ant Design Pro', version: '5.x', link: 'https://pro.ant.design' },
      { name: 'Zustand', version: 'latest', link: 'https://docs.pmnd.rs/zustand' },
    ],
  },
  {
    category: 'Infrastructure',
    icon: <DatabaseOutlined />,
    items: [
      { name: 'Docker', version: 'latest', link: 'https://www.docker.com' },
      { name: 'pnpm', version: 'latest', link: 'https://pnpm.io' },
      { name: 'Turborepo', version: 'latest', link: 'https://turbo.build' },
    ],
  },
  {
    category: 'Security',
    icon: <SafetyOutlined />,
    items: [
      { name: 'JWT', version: '', link: 'https://jwt.io' },
      { name: 'RBAC', version: '', link: '' },
      { name: 'Casbin', version: '', link: 'https://casbin.org' },
    ],
  },
];

export default function AboutPage() {
  return (
    <PageContainer header={{ title: 'About' }}>
      <ProCard title="Jimo Platform" style={{ marginBottom: 24 }}>
        <Paragraph>
          A full-stack jimo administration platform built with modern
          technologies. This platform provides role-based access control,
          code generation, form building, multi-database support, and a
          flexible plugin system to accelerate enterprise application
          development.
        </Paragraph>
        <Descriptions column={1} size="small" bordered style={{ marginTop: 16 }}>
          <Descriptions.Item label="Project Name">
            Jimo Platform
          </Descriptions.Item>
          <Descriptions.Item label="Version">
            v1.0.0
          </Descriptions.Item>
          <Descriptions.Item label="License">
            BSL 1.1
          </Descriptions.Item>
          <Descriptions.Item label="Repository">
            <Link
              href="https://github.com/flipped-aurora/gin-vue-admin"
              target="_blank"
            >
              <GithubOutlined /> gin-vue-admin
            </Link>
          </Descriptions.Item>
        </Descriptions>
      </ProCard>

      <ProCard title="Technology Stack">
        <Space
          direction="vertical"
          size="large"
          style={{ width: '100%' }}
        >
          {techStack.map((group) => (
            <div key={group.category}>
              <ProCard
                title={
                  <Space>
                    {group.icon}
                    <span>{group.category}</span>
                  </Space>
                }
                size="small"
                bordered
                style={{ marginBottom: 8 }}
              >
                <Space wrap>
                  {group.items.map((item) => (
                    <Tag
                      key={item.name}
                      color="blue"
                      style={{ fontSize: 14, padding: '4px 12px' }}
                    >
                      {item.link ? (
                        <Link
                          href={item.link}
                          target="_blank"
                          style={{ color: 'inherit' }}
                        >
                          {item.name}
                          {item.version ? ` ${item.version}` : ''}
                        </Link>
                      ) : (
                        <>
                          {item.name}
                          {item.version ? ` ${item.version}` : ''}
                        </>
                      )}
                    </Tag>
                  ))}
                </Space>
              </ProCard>
            </div>
          ))}
        </Space>
      </ProCard>
    </PageContainer>
  );
}
