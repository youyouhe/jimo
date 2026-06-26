import { useState, useEffect, useCallback } from 'react';
import {
  Timeline,
  Tag,
  Typography,
  Button,
  Space,
  Spin,
  Empty,
  Tooltip,
  message,
} from 'antd';
import { CloudUploadOutlined, ExportOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  getVersions,
  deployProcess,
  exportBpmnXml,
  type BpmProcessVersion,
} from '@/services/bpm';

interface VersionTimelineProps {
  definitionId: string;
  currentVersionId?: string | null;
}

/**
 * Timeline component that displays version history for a process
 * definition. Each version shows number, name, change log, creation
 * date, deployment status, and action buttons (deploy, export XML).
 */
export default function VersionTimeline({
  definitionId,
  currentVersionId,
}: VersionTimelineProps) {
  const [versions, setVersions] = useState<BpmProcessVersion[]>([]);
  const [loading, setLoading] = useState(false);
  const [deployingId, setDeployingId] = useState<string | null>(null);
  const [exportingId, setExportingId] = useState<string | null>(null);

  const loadVersions = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getVersions(definitionId);
      setVersions(data ?? []);
    } catch (err: any) {
      message.error(err?.message || 'Failed to load versions');
    } finally {
      setLoading(false);
    }
  }, [definitionId]);

  useEffect(() => {
    loadVersions();
  }, [loadVersions]);

  const handleDeploy = async (versionId: string) => {
    setDeployingId(versionId);
    try {
      const result = await deployProcess(definitionId, versionId);
      message.success(
        `Deployment successful: ${result.deploymentId}`,
      );
      loadVersions();
    } catch (err: any) {
      message.error(err?.message || 'Deployment failed');
    } finally {
      setDeployingId(null);
    }
  };

  const handleExport = async (versionId: string) => {
    setExportingId(versionId);
    try {
      const xml = await exportBpmnXml(definitionId, versionId);
      const version = versions.find((v) => v.id === versionId);
      const filename = `${version?.name || 'process'}-v${version?.version || ''}.bpmn20.xml`;
      const blob = new Blob([xml], { type: 'application/xml' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      message.success('BPMN XML exported');
    } catch (err: any) {
      message.error(err?.message || 'Export failed');
    } finally {
      setExportingId(null);
    }
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 40 }}>
        <Spin />
      </div>
    );
  }

  if (!versions || versions.length === 0) {
    return (
      <Empty description="No versions yet. Save a version from the designer first." />
    );
  }

  return (
    <Timeline
      items={versions.map((v) => {
        const isCurrent = v.id === currentVersionId;
        const dotColor = v.isDeployed
          ? 'green'
          : isCurrent
            ? 'blue'
            : 'gray';

        return {
          color: dotColor,
          children: (
            <div>
              <Space wrap size={[8, 4]}>
                <Tag color={isCurrent ? 'blue' : 'default'}>
                  v{v.version}
                  {isCurrent ? ' (Current)' : ''}
                </Tag>
                {v.isDeployed && <Tag color="green">Deployed</Tag>}
              </Space>
              {(v.name || v.changeLog) && (
                <Typography.Paragraph
                  style={{ margin: '4px 0 0', fontSize: 13 }}
                  type="secondary"
                  ellipsis={{ rows: 2, expandable: true, symbol: 'more' }}
                >
                  {v.name && <span>{v.name}</span>}
                  {v.name && v.changeLog && <span>{' - '}</span>}
                  {v.changeLog && <span>{v.changeLog}</span>}
                </Typography.Paragraph>
              )}
              <div style={{ marginTop: 4, fontSize: 12 }}>
                <Typography.Text type="secondary">
                  {dayjs(v.createdAt).format('YYYY-MM-DD HH:mm')}
                </Typography.Text>
              </div>
              <div style={{ marginTop: 8 }}>
                <Space size={4}>
                  {!v.isDeployed && (
                    <Tooltip title="Deploy this version to BPM engine">
                      <Button
                        size="small"
                        type="primary"
                        ghost
                        icon={<CloudUploadOutlined />}
                        loading={deployingId === v.id}
                        onClick={() => handleDeploy(v.id)}
                      >
                        Deploy
                      </Button>
                    </Tooltip>
                  )}
                  <Tooltip title="Export BPMN XML">
                    <Button
                      size="small"
                      icon={<ExportOutlined />}
                      loading={exportingId === v.id}
                      onClick={() => handleExport(v.id)}
                    >
                      Export
                    </Button>
                  </Tooltip>
                </Space>
              </div>
            </div>
          ),
        };
      })}
    />
  );
}
