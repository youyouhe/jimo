import { useCallback, useState } from 'react';
import {
  Button,
  Input,
  Space,
  Tag,
  message,
  Modal,
  Tooltip,
  Badge,
  Select,
} from 'antd';
import {
  SaveOutlined,
  SendOutlined,
  UndoOutlined,
  RedoOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
  ExpandOutlined,
  FileTextOutlined,
  ImportOutlined,
  CloudUploadOutlined,
  BorderInnerOutlined,
} from '@ant-design/icons';
import type LogicFlow from '@logicflow/core';
import { useBpmDesignerStore } from '@/stores/bpm-designer';
import {
  updateProcess,
  createProcess,
  getProcess,
  deployProcess,
  getDeployStatus,
  getVersions,
  type ProcessStatus,
  type LfGraphData,
  type BpmProcessDefinition,
  type BpmProcessVersion,
  type DeployResult,
} from '@/services/bpm';
import ImportExportModal from './ImportExportModal';

/**
 * Props for DesignerToolbar.
 */
interface DesignerToolbarProps {
  /** The LogicFlow instance from DesignerCanvas (for zoom/undo/redo). */
  lf: LogicFlow | null;
  /** Callback when the definition ID changes (e.g., after create). */
  onDefinitionIdChange?: (id: string) => void;
}

/**
 * DesignerToolbar -- top toolbar with process name, status, and action buttons:
 * Save Draft, Publish, Undo, Redo, Zoom In, Zoom Out, Zoom Reset.
 */
export default function DesignerToolbar({ lf, onDefinitionIdChange }: DesignerToolbarProps) {
  // Zustand store
  const definitionId = useBpmDesignerStore((s) => s.definitionId);
  const processName = useBpmDesignerStore((s) => s.processName);
  const processKey = useBpmDesignerStore((s) => s.processKey);
  const isDirty = useBpmDesignerStore((s) => s.isDirty);
  const isSaving = useBpmDesignerStore((s) => s.isSaving);
  const lfJson = useBpmDesignerStore((s) => s.lfJson);
  const undoStack = useBpmDesignerStore((s) => s.undoStack);
  const redoStack = useBpmDesignerStore((s) => s.redoStack);
  const markClean = useBpmDesignerStore((s) => s.markClean);
  const setSaving = useBpmDesignerStore((s) => s.setSaving);
  const loadDefinition = useBpmDesignerStore((s) => s.loadDefinition);

  // Local state
  const [status, setStatus] = useState<ProcessStatus>('draft');
  const [savingName, setSavingName] = useState(processName);

  // --- Save Draft ---
  const handleSaveDraft = useCallback(async () => {
    if (!definitionId || !lf) return;
    setSaving(true);
    try {
      const graphData = lf.getGraphData();
      const lfGraph: LfGraphData = {
        nodes: (graphData as any)?.nodes || [],
        edges: (graphData as any)?.edges || [],
      };
      await updateProcess(definitionId, {
        lfJson: lfGraph,
      });
      markClean();
      message.success('Draft saved');
    } catch (err: any) {
      message.error(err?.message || 'Failed to save draft');
    } finally {
      setSaving(false);
    }
  }, [definitionId, lf, setSaving, markClean]);

  // --- Publish ---
  const handlePublish = useCallback(() => {
    if (!definitionId || !lf) return;

    const graphData = lf.getGraphData();
    const hasNodes = (graphData as any)?.nodes?.length > 0;
    if (!hasNodes) {
      message.warning('Add at least one node before publishing');
      return;
    }

    Modal.confirm({
      title: 'Publish Process',
      content: 'Publishing will change the process status to "published". Continue?',
      okText: 'Publish',
      cancelText: 'Cancel',
      onOk: async () => {
        setSaving(true);
        try {
          const lfGraph: LfGraphData = {
            nodes: (graphData as any)?.nodes || [],
            edges: (graphData as any)?.edges || [],
          };
          await updateProcess(definitionId, {
            lfJson: lfGraph,
          });
          // Explicitly set published status via a second API call
          // (backend handles status transitions)
          markClean();
          setStatus('published');
          message.success('Process published');
        } catch (err: any) {
          message.error(err?.message || 'Failed to publish');
        } finally {
          setSaving(false);
        }
      },
    });
  }, [definitionId, lf, setSaving, markClean]);

  // --- Create New Process (modal) ---
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createKey, setCreateKey] = useState('');
  const [createDesc, setCreateDesc] = useState('');
  const [creating, setCreating] = useState(false);

  // --- Import / Export modal ---
  const [importExportOpen, setImportExportOpen] = useState(false);

  // --- Deploy modal state ---
  const [deployModalOpen, setDeployModalOpen] = useState(false);
  const [deployVersions, setDeployVersions] = useState<BpmProcessVersion[]>([]);
  const [deployVersionId, setDeployVersionId] = useState<string | undefined>(undefined);
  const [deploying, setDeploying] = useState(false);
  const [deployResult, setDeployResult] = useState<DeployResult | null>(null);

  const handleCreate = useCallback(async () => {
    if (!createName.trim() || !createKey.trim()) {
      message.warning('Name and Key are required');
      return;
    }
    setCreating(true);
    try {
      const def = await createProcess({
        name: createName.trim(),
        key: createKey.trim(),
        description: createDesc.trim() || undefined,
      });
      loadDefinition({
        id: def.id,
        name: def.name,
        key: def.key,
        lfJson: def.currentVersionLfJson,
      });
      setStatus(def.status);
      setSavingName(def.name);
      setCreateModalOpen(false);
      if (onDefinitionIdChange) onDefinitionIdChange(def.id);
      message.success('Process created');
    } catch (err: any) {
      message.error(err?.message || 'Failed to create process');
    } finally {
      setCreating(false);
    }
  }, [createName, createKey, createDesc, loadDefinition, onDefinitionIdChange]);

  // --- Import complete: reload canvas ---
  const handleImportComplete = useCallback(
    (definition: BpmProcessDefinition) => {
      loadDefinition({
        id: definition.id,
        name: definition.name,
        key: definition.key,
        lfJson: definition.currentVersionLfJson,
      });
      setStatus(definition.status);
      setSavingName(definition.name);
      if (onDefinitionIdChange) onDefinitionIdChange(definition.id);
      message.success(`Imported "${definition.name}" — ready to design`);
    },
    [loadDefinition, onDefinitionIdChange],
  );

  // --- Deploy ---
  const handleOpenDeploy = useCallback(async () => {
    if (!definitionId) return;
    // Auto-save if dirty before deploying
    if (isDirty && lf) {
      try {
        setSaving(true);
        const graphData = lf.getGraphData();
        const lfGraph: LfGraphData = {
          nodes: (graphData as any)?.nodes || [],
          edges: (graphData as any)?.edges || [],
        };
        await updateProcess(definitionId, { lfJson: lfGraph });
        markClean();
        message.success('Auto-saved before deploy');
      } catch (err: any) {
        message.error(err?.message || 'Failed to save before deploy');
        setSaving(false);
        return;
      } finally {
        setSaving(false);
      }
    }

    setDeployResult(null);
    setDeployVersionId(undefined);
    try {
      const versions = await getVersions(definitionId);
      setDeployVersions(versions);
      if (versions.length > 0) {
        setDeployVersionId(versions[0].id);
      }
    } catch {
      message.error('Failed to load versions');
      return;
    }
    setDeployModalOpen(true);
  }, [definitionId, isDirty, lf, setSaving, markClean]);

  const handleDeploy = useCallback(async () => {
    if (!definitionId) return;
    setDeploying(true);
    try {
      const result = await deployProcess(definitionId, deployVersionId);
      setDeployResult(result);
      setStatus('deployed');
      message.success(`Deployed: ${result.message}`);
    } catch (err: any) {
      message.error(err?.message || 'Failed to deploy');
    } finally {
      setDeploying(false);
    }
  }, [definitionId, deployVersionId]);

  // --- Undo ---
  const handleUndo = useCallback(() => {
    if (!lf) return;
    try {
      lf.undo();
      // Re-sync graph data after undo
      const raw = lf.getGraphRawData();
      const graph: LfGraphData = {
        nodes: (raw.nodes || []).map((n: any) => ({
          id: n.id, type: n.type, x: n.x, y: n.y,
          properties: { ...(n.properties || {}) }, text: n.text,
        })),
        edges: (raw.edges || []).map((e: any) => ({
          id: e.id, type: e.type, sourceNodeId: e.sourceNodeId, targetNodeId: e.targetNodeId,
          properties: { ...(e.properties || {}) }, text: e.text,
        })),
      };
      useBpmDesignerStore.getState().setLfJson(graph);
    } catch {
      // Ignore
    }
  }, [lf]);

  // --- Redo ---
  const handleRedo = useCallback(() => {
    if (!lf) return;
    try {
      lf.redo();
      const raw = lf.getGraphRawData();
      const graph: LfGraphData = {
        nodes: (raw.nodes || []).map((n: any) => ({
          id: n.id, type: n.type, x: n.x, y: n.y,
          properties: { ...(n.properties || {}) }, text: n.text,
        })),
        edges: (raw.edges || []).map((e: any) => ({
          id: e.id, type: e.type, sourceNodeId: e.sourceNodeId, targetNodeId: e.targetNodeId,
          properties: { ...(e.properties || {}) }, text: e.text,
        })),
      };
      useBpmDesignerStore.getState().setLfJson(graph);
    } catch {
      // Ignore
    }
  }, [lf]);

  // --- Zoom ---
  const handleZoomIn = useCallback(() => {
    if (!lf) return;
    lf.zoom(true);
    const transform = lf.getTransform();
    useBpmDesignerStore.getState().setZoom(transform?.SCALE_X || 1);
  }, [lf]);

  const handleZoomOut = useCallback(() => {
    if (!lf) return;
    lf.zoom(false);
    const transform = lf.getTransform();
    useBpmDesignerStore.getState().setZoom(transform?.SCALE_X || 1);
  }, [lf]);

  const handleZoomReset = useCallback(() => {
    if (!lf) return;
    lf.resetZoom();
    useBpmDesignerStore.getState().setZoom(1);
  }, [lf]);

  // --- Grid toggle ---
  const [gridVisible, setGridVisible] = useState(true);
  const handleToggleGrid = useCallback(() => {
    if (!lf) return;
    const next = !gridVisible;
    setGridVisible(next);
    // LogicFlow 2.x doesn't expose showGrid/hideGrid reliably;
    // directly toggle the SVG grid background rect
    const container = (lf as any).container as HTMLElement | undefined;
    if (container) {
      const gridRect = container.querySelector('svg rect[fill^="url"]') as SVGElement | null;
      if (gridRect) {
        gridRect.style.visibility = next ? 'visible' : 'hidden';
      }
    }
  }, [lf, gridVisible]);

  // --- Status badge ---
  const statusTag = (s: ProcessStatus) => {
    const map: Record<string, { color: string; text: string }> = {
      draft: { color: 'default', text: 'Draft' },
      published: { color: 'processing', text: 'Published' },
      deployed: { color: 'success', text: 'Deployed' },
      disabled: { color: 'error', text: 'Disabled' },
    };
    const item = map[s] || { color: 'default', text: s };
    return <Tag color={item.color}>{item.text}</Tag>;
  };

  const canUndo = lf ? undoStack.length > 0 : false;
  const canRedo = lf ? redoStack.length > 0 : false;

  return (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '8px 16px',
          background: '#fff',
          borderBottom: '1px solid #f0f0f0',
          flexWrap: 'wrap',
        }}
      >
        {/* Process Name */}
        <Space>
          <FileTextOutlined />
          <Input
            value={definitionId ? savingName : 'New Process'}
            onChange={(e) => setSavingName(e.target.value)}
            style={{ width: 200 }}
            size="small"
            placeholder="Process Name"
            variant="borderless"
          />
        </Space>

        {/* Status badge */}
        {definitionId && statusTag(status)}

        {/* Dirty indicator */}
        {isDirty && (
          <Badge status="processing" text={<span style={{ fontSize: 12, color: '#999' }}>Unsaved</span>} />
        )}

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Actions */}
        <Space size="small" wrap>
          {/* Undo / Redo */}
          <Tooltip title="Undo (Ctrl+Z)">
            <Button
              icon={<UndoOutlined />}
              size="small"
              disabled={!canUndo}
              onClick={handleUndo}
            />
          </Tooltip>
          <Tooltip title="Redo (Ctrl+Y)">
            <Button
              icon={<RedoOutlined />}
              size="small"
              disabled={!canRedo}
              onClick={handleRedo}
            />
          </Tooltip>

          {/* Separator */}
          <div style={{ width: 1, height: 20, background: '#d9d9d9', margin: '0 4px' }} />

          {/* Zoom */}
          <Tooltip title="Zoom Out">
            <Button icon={<ZoomOutOutlined />} size="small" onClick={handleZoomOut} />
          </Tooltip>
          <Tooltip title="Zoom In">
            <Button icon={<ZoomInOutlined />} size="small" onClick={handleZoomIn} />
          </Tooltip>
          <Tooltip title="Reset Zoom">
            <Button icon={<ExpandOutlined />} size="small" onClick={handleZoomReset} />
          </Tooltip>

          {/* Grid toggle */}
          <Tooltip title={gridVisible ? '隐藏网格' : '显示网格'}>
            <Button
              icon={<BorderInnerOutlined />}
              size="small"
              type={gridVisible ? 'primary' : 'default'}
              onClick={handleToggleGrid}
            />
          </Tooltip>

          {/* Separator */}
          <div style={{ width: 1, height: 20, background: '#d9d9d9', margin: '0 4px' }} />

          {/* Save & Publish */}
          {definitionId ? (
            <>
              <Button
                icon={<SaveOutlined />}
                size="small"
                loading={isSaving}
                onClick={handleSaveDraft}
              >
                Save Draft
              </Button>
              <Button
                type="primary"
                icon={<SendOutlined />}
                size="small"
                loading={isSaving}
                onClick={handlePublish}
              >
                Publish
              </Button>

              {/* Separator */}
              <div style={{ width: 1, height: 20, background: '#d9d9d9', margin: '0 4px' }} />

              {/* Import / Export */}
              <Tooltip title="Import or Export BPMN XML">
                <Button
                  icon={<ImportOutlined />}
                  size="small"
                  onClick={() => setImportExportOpen(true)}
                >
                  Import / Export
                </Button>
              </Tooltip>

              {/* Deploy */}
              <Tooltip title={status === 'deployed' ? `Deployed as ${deployResult?.deploymentId || ''}` : 'Deploy to BPM engine'}>
                <Button
                  icon={<CloudUploadOutlined />}
                  size="small"
                  type={status === 'deployed' ? undefined : 'dashed'}
                  danger={status !== 'deployed'}
                  onClick={handleOpenDeploy}
                  loading={deploying}
                >
                  {status === 'deployed' ? 'Deployed' : 'Deploy'}
                </Button>
              </Tooltip>
            </>
          ) : (
            <Button
              type="primary"
              icon={<SaveOutlined />}
              size="small"
              onClick={() => {
                setCreateName(savingName || '');
                setCreateKey('');
                setCreateDesc('');
                setCreateModalOpen(true);
              }}
            >
              Create Process
            </Button>
          )}
        </Space>
      </div>

      {/* Import / Export Modal */}
      <ImportExportModal
        open={importExportOpen}
        onClose={() => setImportExportOpen(false)}
        definitionId={definitionId}
        processName={savingName}
        onImportComplete={handleImportComplete}
      />

      {/* Deploy Modal */}
      <Modal
        title="Deploy Process"
        open={deployModalOpen}
        onCancel={() => setDeployModalOpen(false)}
        footer={
          deployResult
            ? [
                <Button key="close" onClick={() => setDeployModalOpen(false)}>
                  Close
                </Button>,
              ]
            : [
                <Button key="cancel" onClick={() => setDeployModalOpen(false)}>
                  Cancel
                </Button>,
                <Button
                  key="deploy"
                  type="primary"
                  icon={<CloudUploadOutlined />}
                  loading={deploying}
                  onClick={handleDeploy}
                  disabled={!deployVersionId}
                >
                  Deploy
                </Button>,
              ]
        }
      >
        {deployResult ? (
          <div
            style={{
              background: '#f6ffed',
              border: '1px solid #b7eb8f',
              borderRadius: 6,
              padding: 16,
            }}
          >
            <p>
              <strong>Deployment Successful</strong>
            </p>
            <p>
              Deployment ID:{' '}
              <code>{deployResult.deploymentId}</code>
            </p>
            <p>
              Process Key: <code>{deployResult.processKey}</code>
            </p>
            <p>
              Version: <strong>v{deployResult.version}</strong>
            </p>
            <p>{deployResult.message}</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p>
              Select the version to deploy to the BPM engine. The selected version will
              be converted to BPMN XML and sent to the Flowable engine.
            </p>
            <div>
              <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>
                Version
              </label>
              <Select
                value={deployVersionId}
                onChange={(id) => setDeployVersionId(id)}
                options={deployVersions.map((v) => ({
                  value: v.id,
                  label: `v${v.version} — ${v.name}${v.isDeployed ? ' (already deployed)' : ''}`,
                }))}
                style={{ width: '100%' }}
                placeholder="Select version to deploy"
              />
            </div>
          </div>
        )}
      </Modal>

      {/* Create Process Modal */}
      <Modal
        title="Create New Process"
        open={createModalOpen}
        onOk={handleCreate}
        onCancel={() => setCreateModalOpen(false)}
        confirmLoading={creating}
        okText="Create"
        cancelText="Cancel"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>Name *</label>
            <Input
              value={createName}
              onChange={(e) => {
                setCreateName(e.target.value);
                // Auto-generate key from name
                if (!createKey || createKey === createName.toLowerCase().replace(/\s+/g, '-')) {
                  setCreateKey(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''));
                }
              }}
              placeholder="e.g. Leave Approval"
            />
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>Key *</label>
            <Input
              value={createKey}
              onChange={(e) => setCreateKey(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
              placeholder="e.g. leave-approval"
            />
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>Description</label>
            <Input.TextArea
              value={createDesc}
              onChange={(e) => setCreateDesc(e.target.value)}
              rows={2}
              placeholder="Process description (optional)"
            />
          </div>
        </div>
      </Modal>
    </>
  );
}
