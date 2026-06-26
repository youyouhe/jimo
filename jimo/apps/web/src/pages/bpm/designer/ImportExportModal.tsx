import { useState, useCallback } from 'react';
import {
  Modal,
  Tabs,
  Radio,
  Input,
  Button,
  Upload,
  Select,
  Space,
  message,
  Spin,
  Typography,
  Divider,
} from 'antd';
import {
  ImportOutlined,
  ExportOutlined,
  CopyOutlined,
  DownloadOutlined,
  FileTextOutlined,
  InboxOutlined,
} from '@ant-design/icons';
import { importBpmnXml, importBpmnFile, exportBpmnXml, getVersions } from '@/services/bpm';
import type { BpmProcessDefinition, BpmProcessVersion } from '@/services/bpm';

const { TextArea } = Input;
const { Dragger } = Upload;
const { Text } = Typography;

/**
 * Props for ImportExportModal.
 */
interface ImportExportModalProps {
  /** Whether the modal is visible. */
  open: boolean;
  /** Callback to close the modal. */
  onClose: () => void;
  /** Current definition ID (for export). Null means no process loaded yet. */
  definitionId: string | null;
  /** Process name (for export filename). */
  processName?: string;
  /** Callback when import completes successfully. Receives the new definition. */
  onImportComplete?: (definition: BpmProcessDefinition) => void;
}

/** Import mode: paste XML or upload file. */
type ImportMode = 'paste' | 'file';

/**
 * ImportExportModal -- full-featured modal for BPMN XML import and export.
 *
 * Import tab: Paste XML or upload .bpmn/.xml file.
 * Export tab: Download as .bpmn20.xml or copy to clipboard.
 */
export default function ImportExportModal({
  open,
  onClose,
  definitionId,
  processName,
  onImportComplete,
}: ImportExportModalProps) {
  // --- Import state ---
  const [importMode, setImportMode] = useState<ImportMode>('paste');
  const [importXml, setImportXml] = useState('');
  const [importing, setImporting] = useState(false);
  const [importPreview, setImportPreview] = useState<{
    nodeCount: number;
    edgeCount: number;
    definition: BpmProcessDefinition;
  } | null>(null);

  // --- Export state ---
  const [exportVersions, setExportVersions] = useState<BpmProcessVersion[]>([]);
  const [exportVersionId, setExportVersionId] = useState<string | undefined>(undefined);
  const [exporting, setExporting] = useState(false);
  const [versionsLoaded, setVersionsLoaded] = useState(false);

  // --- Reset state when modal opens/closes ---
  const handleClose = useCallback(() => {
    setImportXml('');
    setImportMode('paste');
    setImportPreview(null);
    setImporting(false);
    setExportVersions([]);
    setExportVersionId(undefined);
    setExporting(false);
    setVersionsLoaded(false);
    onClose();
  }, [onClose]);

  // --- Load versions on export tab activation ---
  const loadVersions = useCallback(async () => {
    if (!definitionId || versionsLoaded) return;
    try {
      const versions = await getVersions(definitionId);
      setExportVersions(versions);
      // Default to latest version (first in list, sorted desc)
      if (versions.length > 0 && !exportVersionId) {
        setExportVersionId(versions[0].id);
      }
    } catch {
      // Silently fail; user will see empty select
    }
    setVersionsLoaded(true);
  }, [definitionId, versionsLoaded, exportVersionId]);

  // --- Import: Paste XML ---
  const handleImportPaste = useCallback(async () => {
    const xml = importXml.trim();
    if (!xml) {
      message.warning('Please paste BPMN XML content');
      return;
    }
    setImporting(true);
    try {
      const definition = await importBpmnXml(xml);
      const lfJson = definition.currentVersionLfJson;
      const nodeCount = lfJson?.nodes?.length ?? 0;
      const edgeCount = lfJson?.edges?.length ?? 0;
      setImportPreview({ nodeCount, edgeCount, definition });
      message.success(`Imported: ${nodeCount} nodes, ${edgeCount} edges`);
    } catch (err: any) {
      message.error(err?.message || 'Failed to import BPMN XML. Please check the XML is valid BPMN 2.0.');
    } finally {
      setImporting(false);
    }
  }, [importXml]);

  // --- Import: Confirm and load into canvas ---
  const handleConfirmImport = useCallback(() => {
    if (!importPreview) return;
    if (onImportComplete) {
      onImportComplete(importPreview.definition);
    }
    handleClose();
  }, [importPreview, onImportComplete, handleClose]);

  // --- Import: File upload ---
  const handleFileImport = useCallback(async (file: File): Promise<false> => {
    setImporting(true);
    try {
      const definition = await importBpmnFile(file);
      const lfJson = definition.currentVersionLfJson;
      const nodeCount = lfJson?.nodes?.length ?? 0;
      const edgeCount = lfJson?.edges?.length ?? 0;
      setImportPreview({ nodeCount, edgeCount, definition });
      message.success(`Imported: ${nodeCount} nodes, ${edgeCount} edges`);
    } catch (err: any) {
      message.error(err?.message || 'Failed to import BPMN file. Please check the file is valid BPMN 2.0 XML.');
    } finally {
      setImporting(false);
    }
    // Return false to prevent default upload behavior
    return false;
  }, []);

  // --- Export: Download ---
  const handleExportDownload = useCallback(async () => {
    if (!definitionId) return;
    setExporting(true);
    try {
      const xml = await exportBpmnXml(definitionId, exportVersionId);
      const blob = new Blob([xml], { type: 'application/xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const safeName = (processName || 'process').replace(/[^a-zA-Z0-9_-]/g, '_');
      a.download = `${safeName}.bpmn20.xml`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      message.success('BPMN XML downloaded');
    } catch (err: any) {
      message.error(err?.message || 'Failed to export BPMN XML');
    } finally {
      setExporting(false);
    }
  }, [definitionId, exportVersionId, processName]);

  // --- Export: Copy to clipboard ---
  const handleExportCopy = useCallback(async () => {
    if (!definitionId) return;
    setExporting(true);
    try {
      const xml = await exportBpmnXml(definitionId, exportVersionId);
      await navigator.clipboard.writeText(xml);
      message.success('BPMN XML copied to clipboard');
    } catch (err: any) {
      message.error('Failed to copy to clipboard. Please use the Download option instead.');
    } finally {
      setExporting(false);
    }
  }, [definitionId, exportVersionId]);

  // --- Build version select options ---
  const versionOptions = exportVersions.map((v) => ({
    value: v.id,
    label: `v${v.version} — ${v.name}${v.isDeployed ? ' (deployed)' : ''}`,
  }));

  return (
    <Modal
      title={
        <Space>
          <ImportOutlined />
          <span>BPMN Import / Export</span>
        </Space>
      }
      open={open}
      onCancel={handleClose}
      width={640}
      footer={null}
      destroyOnClose
    >
      <Tabs
        defaultActiveKey="import"
        items={[
          // ======================== Import Tab ========================
          {
            key: 'import',
            label: (
              <span>
                <ImportOutlined /> Import BPMN
              </span>
            ),
            children: (
              <div style={{ padding: '8px 0' }}>
                {/* Mode selector */}
                <Radio.Group
                  value={importMode}
                  onChange={(e) => {
                    setImportMode(e.target.value);
                    setImportPreview(null);
                  }}
                  style={{ marginBottom: 16 }}
                >
                  <Radio.Button value="paste">Paste XML</Radio.Button>
                  <Radio.Button value="file">Upload File</Radio.Button>
                </Radio.Group>

                {/* Paste XML mode */}
                {importMode === 'paste' && !importPreview && (
                  <div>
                    <TextArea
                      value={importXml}
                      onChange={(e) => setImportXml(e.target.value)}
                      rows={10}
                      placeholder={`Paste your BPMN 2.0 XML here...

Example:
<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" ...>
  <process id="myProcess" name="My Process">
    <startEvent id="start" name="Start"/>
    <userTask id="task1" name="Review" flowable:assignee="admin"/>
    <endEvent id="end" name="End"/>
    <sequenceFlow id="flow1" sourceRef="start" targetRef="task1"/>
    <sequenceFlow id="flow2" sourceRef="task1" targetRef="end"/>
  </process>
</definitions>`}
                      style={{ fontFamily: 'monospace', fontSize: 12 }}
                    />
                    <Button
                      type="primary"
                      icon={<ImportOutlined />}
                      loading={importing}
                      onClick={handleImportPaste}
                      style={{ marginTop: 12 }}
                      block
                    >
                      Import XML
                    </Button>
                  </div>
                )}

                {/* Upload File mode */}
                {importMode === 'file' && !importPreview && (
                  <div>
                    <Dragger
                      accept=".bpmn,.xml,.bpmn20.xml"
                      maxCount={1}
                      beforeUpload={(file) => {
                        handleFileImport(file);
                        return false;
                      }}
                      showUploadList={false}
                    >
                      <p className="ant-upload-drag-icon">
                        <InboxOutlined />
                      </p>
                      <p className="ant-upload-text">Click or drag a BPMN XML file to this area</p>
                      <p className="ant-upload-hint">Supports .bpmn, .xml, .bpmn20.xml files</p>
                    </Dragger>
                    {importing && (
                      <div style={{ textAlign: 'center', marginTop: 16 }}>
                        <Spin /> <Text type="secondary">Importing...</Text>
                      </div>
                    )}
                  </div>
                )}

                {/* Import preview (shown after successful import) */}
                {importPreview && (
                  <div>
                    <div
                      style={{
                        background: '#f6ffed',
                        border: '1px solid #b7eb8f',
                        borderRadius: 6,
                        padding: 16,
                        marginBottom: 16,
                      }}
                    >
                      <Text strong style={{ color: '#52c41a' }}>
                        Import Successful
                      </Text>
                      <div style={{ marginTop: 8 }}>
                        <Text>
                          Process: <Text strong>{importPreview.definition.name}</Text>
                        </Text>
                        <br />
                        <Text>
                          Key: <Text code>{importPreview.definition.key}</Text>
                        </Text>
                        <br />
                        <Text>
                          Graph: {importPreview.nodeCount} nodes, {importPreview.edgeCount} edges
                        </Text>
                      </div>
                    </div>

                    <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
                      <Button onClick={() => setImportPreview(null)}>Import Another</Button>
                      <Button type="primary" icon={<ImportOutlined />} onClick={handleConfirmImport}>
                        Load into Designer
                      </Button>
                    </Space>
                  </div>
                )}
              </div>
            ),
          },

          // ======================== Export Tab ========================
          {
            key: 'export',
            label: (
              <span>
                <ExportOutlined /> Export BPMN
              </span>
            ),
            children: (
              <div style={{ padding: '8px 0' }}>
                {!definitionId ? (
                  <div style={{ textAlign: 'center', padding: '24px 0', color: '#999' }}>
                    <FileTextOutlined style={{ fontSize: 48, marginBottom: 12 }} />
                    <br />
                    <Text type="secondary">
                      No process loaded. Create or open a process first to export.
                    </Text>
                  </div>
                ) : (
                  <div>
                    {/* Version selector */}
                    <div style={{ marginBottom: 16 }}>
                      <Text strong>Version to export:</Text>
                      <Select
                        value={exportVersionId}
                        onChange={(id) => setExportVersionId(id)}
                        options={versionOptions}
                        loading={!versionsLoaded}
                        onDropdownVisibleChange={(visible) => {
                          if (visible) loadVersions();
                        }}
                        style={{ width: '100%', marginTop: 8 }}
                        placeholder="Select a version"
                      />
                    </div>

                    <Divider />

                    {/* Export actions */}
                    <Text strong style={{ display: 'block', marginBottom: 12 }}>
                      Export Actions:
                    </Text>
                    <Space direction="vertical" style={{ width: '100%' }} size="middle">
                      <Button
                        icon={<DownloadOutlined />}
                        loading={exporting}
                        onClick={handleExportDownload}
                        block
                        size="large"
                      >
                        Download .bpmn20.xml File
                      </Button>
                      <Button
                        icon={<CopyOutlined />}
                        loading={exporting}
                        onClick={handleExportCopy}
                        block
                      >
                        Copy XML to Clipboard
                      </Button>
                    </Space>
                  </div>
                )}
              </div>
            ),
          },
        ]}
      />
    </Modal>
  );
}
