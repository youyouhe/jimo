import { useState } from 'react';
import { Button, Modal, Select, message, Typography, Space, Tag, Spin } from 'antd';
import { CloudUploadOutlined } from '@ant-design/icons';
import {
  deployProcess,
  getVersions,
  type BpmProcessVersion,
} from '@/services/bpm';

interface DeployButtonProps {
  definitionId: string;
  onSuccess: () => void;
}

/**
 * Self-contained deploy action component. Renders a button that, when
 * clicked, fetches available versions and opens a modal for the user
 * to select and confirm deployment to the BPM engine.
 */
export default function DeployButton({
  definitionId,
  onSuccess,
}: DeployButtonProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [versions, setVersions] = useState<BpmProcessVersion[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [selectedVersionId, setSelectedVersionId] = useState<string>('');
  const [deploying, setDeploying] = useState(false);

  const hasVersions = versions && versions.length > 0;
  const selectedVersion = versions?.find((v) => v.id === selectedVersionId);

  const handleOpen = async () => {
    setModalOpen(true);
    setSelectedVersionId('');
    setVersions([]);
    setVersionsLoading(true);
    try {
      const data = await getVersions(definitionId);
      const vs = data ?? [];
      setVersions(vs);
      if (vs.length > 0) {
        setSelectedVersionId(vs[0].id);
      }
    } catch {
      setVersions([]);
    } finally {
      setVersionsLoading(false);
    }
  };

  const handleDeploy = async () => {
    if (!selectedVersionId) {
      message.warning('Please select a version to deploy');
      return;
    }
    setDeploying(true);
    try {
      const result = await deployProcess(definitionId, selectedVersionId);
      message.success(`Deployment successful: ${result.deploymentId}`);
      onSuccess();
      setModalOpen(false);
    } catch (err: any) {
      message.error(err?.message || 'Deployment failed');
    } finally {
      setDeploying(false);
    }
  };

  return (
    <>
      <Button
        type="link"
        size="small"
        icon={<CloudUploadOutlined />}
        onClick={handleOpen}
      >
        Deploy
      </Button>

      <Modal
        title="Deploy Process to BPM"
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleDeploy}
        confirmLoading={deploying}
        okText="Deploy"
        cancelText="Cancel"
        okButtonProps={{ disabled: !hasVersions }}
        destroyOnClose
      >
        {versionsLoading ? (
          <div style={{ textAlign: 'center', padding: 30 }}>
            <Spin />
          </div>
        ) : !hasVersions ? (
          <Typography.Text type="secondary">
            No versions available. Save a version from the designer
            first.
          </Typography.Text>
        ) : (
          <>
            <div style={{ marginBottom: 16 }}>
              <Typography.Text strong>Select Version</Typography.Text>
              <Select
                style={{ width: '100%', marginTop: 8 }}
                value={selectedVersionId}
                onChange={(val) => setSelectedVersionId(val)}
                options={versions.map((v) => ({
                  label: `v${v.version} - ${v.name || 'Untitled'}${v.isDeployed ? ' (deployed)' : ''}`,
                  value: v.id,
                  disabled: v.isDeployed,
                }))}
              />
            </div>
            {selectedVersion && (
              <div>
                <Space direction="vertical" size={4}>
                  <div>
                    <Typography.Text type="secondary">
                      Version:{' '}
                    </Typography.Text>
                    <Tag color="blue">v{selectedVersion.version}</Tag>
                  </div>
                  {selectedVersion.changeLog && (
                    <div>
                      <Typography.Text type="secondary">
                        Change Log:{' '}
                      </Typography.Text>
                      <Typography.Text>
                        {selectedVersion.changeLog}
                      </Typography.Text>
                    </div>
                  )}
                  {selectedVersion.isDeployed && (
                    <Tag color="green">Already Deployed</Tag>
                  )}
                </Space>
              </div>
            )}
          </>
        )}
      </Modal>
    </>
  );
}
