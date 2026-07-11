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
    category: '后端',
    icon: <CloudServerOutlined />,
    items: [
      { name: 'NestJS', version: '11.x', link: 'https://nestjs.com' },
      { name: 'Drizzle ORM', version: 'latest', link: 'https://orm.drizzle.team' },
      { name: 'PostgreSQL', version: '16', link: 'https://www.postgresql.org' },
      { name: 'Redis', version: '7', link: 'https://redis.io' },
      { name: 'MinIO', version: 'latest', link: 'https://min.io' },
      { name: 'Casbin', version: 'v2', link: 'https://casbin.org' },
    ],
  },
  {
    category: '前端',
    icon: <ApiOutlined />,
    items: [
      { name: 'React', version: '18.x', link: 'https://react.dev' },
      { name: 'Umi 4', version: '4.x', link: 'https://umijs.org' },
      { name: 'Ant Design Pro', version: '6.x', link: 'https://pro.ant.design' },
      { name: 'Zustand', version: 'latest', link: 'https://docs.pmnd.rs/zustand' },
    ],
  },
  {
    category: 'BPM / 工作流',
    icon: <DatabaseOutlined />,
    items: [
      { name: 'Spring Boot', version: '2.7', link: 'https://spring.io/projects/spring-boot' },
      { name: 'Flowable', version: '6.8', link: 'https://www.flowable.com' },
      { name: 'MySQL', version: '8', link: 'https://www.mysql.com' },
    ],
  },
  {
    category: '基础设施',
    icon: <DatabaseOutlined />,
    items: [
      { name: 'Docker', version: '', link: 'https://www.docker.com' },
      { name: 'pnpm', version: '9.x', link: 'https://pnpm.io' },
      { name: 'Turborepo', version: '', link: 'https://turbo.build' },
    ],
  },
  {
    category: '安全',
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
    <PageContainer header={{ title: '关于' }}>
      <ProCard title="Jimo Platform" style={{ marginBottom: 24 }}>
        <Paragraph>
          自研低代码管理平台 —— pnpm monorepo（NestJS + React + Java BPM +
          共享类型）。内置代码生成器(autocode)、RBAC 权限体系(Casbin)、
          Flowable 审批流引擎、组织架构管理等企业级能力, 加速后台系统开发。
        </Paragraph>
        <Descriptions column={1} size="small" bordered style={{ marginTop: 16 }}>
          <Descriptions.Item label="Project Name">
            Jimo Platform
          </Descriptions.Item>
          <Descriptions.Item label="Version">
            v1.0.0
          </Descriptions.Item>
          <Descriptions.Item label="License">
            MIT
          </Descriptions.Item>
          <Descriptions.Item label="Repository">
            <Link
              href="https://github.com/youyouhe/jimo"
              target="_blank"
            >
              <GithubOutlined /> github.com/youyouhe/jimo
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
