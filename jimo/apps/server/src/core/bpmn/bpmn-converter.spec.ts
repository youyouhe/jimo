import { Test, TestingModule } from '@nestjs/testing';
import * as fs from 'fs';
import * as path from 'path';
import { BpmnConverterService, LfGraphData } from './bpmn-converter.service';

const TEMPLATES_DIR = path.resolve(
  __dirname,
  '../../../../../../bpm/bpm-service/src/main/resources/processes',
);

const TEMPLATE_FILES = [
  'generic-approval.bpmn20.xml',
  'contract-approval.bpmn20.xml',
  'contract-approval-candidate.bpmn20.xml',
  'contract-approval-chain.bpmn20.xml',
  'contract-approval-dynamic.bpmn20.xml',
  'contract-approval-universal.bpmn20.xml',
];

function loadTemplate(name: string): string {
  const filePath = path.join(TEMPLATES_DIR, name);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Template not found: ${filePath}`);
  }
  return fs.readFileSync(filePath, 'utf-8');
}

function expectDefined<T>(val: T | null | undefined, msg?: string): asserts val is T {
  expect(val).toBeDefined();
  if (val === null || val === undefined) {
    throw new Error(msg || 'Expected value to be defined');
  }
}

describe('BpmnConverterService', () => {
  let service: BpmnConverterService;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [BpmnConverterService],
    }).compile();
    service = module.get<BpmnConverterService>(BpmnConverterService);
  });

  // ════════════════════════════════════════════
  // bpmnXmlToLfJson: basic parsing
  // ════════════════════════════════════════════

  describe('bpmnXmlToLfJson', () => {
    it('parses a minimal process with start and end event', async () => {
      const xml = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"',
        '  targetNamespace="http://flowable.org/bpmn">',
        '  <process id="minimal" name="Minimal" isExecutable="true">',
        '    <startEvent id="start" name="Start"/>',
        '    <endEvent id="end" name="End"/>',
        '    <sequenceFlow id="f1" sourceRef="start" targetRef="end"/>',
        '  </process>',
        '</definitions>',
      ].join('\n');

      const result = await service.bpmnXmlToLfJson(xml);

      expect(result.nodes).toHaveLength(2);
      expect(result.edges).toHaveLength(1);

      const startNode = result.nodes.find((n) => n.id === 'start');
      expectDefined(startNode);
      expect(startNode.type).toBe('start-event');
      expect(startNode.text.value).toBe('Start');
    });

    it('parses userTask with flowable:assignee', async () => {
      const xml = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"',
        '  xmlns:flowable="http://flowable.org/bpmn"',
        '  targetNamespace="http://flowable.org/bpmn">',
        '  <process id="test" name="Test" isExecutable="true">',
        '    <startEvent id="start" name="Start"/>',
        '    <userTask id="task1" name="Review" flowable:assignee="${initiator}"/>',
        '    <endEvent id="end" name="End"/>',
        '    <sequenceFlow id="f1" sourceRef="start" targetRef="task1"/>',
        '    <sequenceFlow id="f2" sourceRef="task1" targetRef="end"/>',
        '  </process>',
        '</definitions>',
      ].join('\n');

      const result = await service.bpmnXmlToLfJson(xml);
      const task = result.nodes.find((n) => n.id === 'task1');
      expectDefined(task);
      expect(task.type).toBe('user-task');
      expect(task.properties.assignee).toBe('${initiator}');
    });

    it('parses candidateGroups attribute', async () => {
      const xml = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"',
        '  xmlns:flowable="http://flowable.org/bpmn"',
        '  targetNamespace="http://flowable.org/bpmn">',
        '  <process id="test" name="Test" isExecutable="true">',
        '    <startEvent id="start" name="Start"/>',
        '    <userTask id="task1" name="Review" flowable:candidateGroups="managers"/>',
        '    <endEvent id="end" name="End"/>',
        '    <sequenceFlow id="f1" sourceRef="start" targetRef="task1"/>',
        '    <sequenceFlow id="f2" sourceRef="task1" targetRef="end"/>',
        '  </process>',
        '</definitions>',
      ].join('\n');

      const result = await service.bpmnXmlToLfJson(xml);
      const task = result.nodes.find((n) => n.id === 'task1');
      expectDefined(task);
      expect(task.properties.candidateGroups).toBe('managers');
    });

    it('parses taskListener inside extensionElements', async () => {
      const xml = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"',
        '  xmlns:flowable="http://flowable.org/bpmn"',
        '  targetNamespace="http://flowable.org/bpmn">',
        '  <process id="test" name="Test" isExecutable="true">',
        '    <startEvent id="start" name="Start"/>',
        '    <userTask id="task1" name="Review">',
        '      <extensionElements>',
        '        <flowable:taskListener event="create" delegateExpression="${myListener}"/>',
        '      </extensionElements>',
        '    </userTask>',
        '    <endEvent id="end" name="End"/>',
        '    <sequenceFlow id="f1" sourceRef="start" targetRef="task1"/>',
        '    <sequenceFlow id="f2" sourceRef="task1" targetRef="end"/>',
        '  </process>',
        '</definitions>',
      ].join('\n');

      const result = await service.bpmnXmlToLfJson(xml);
      const task = result.nodes.find((n) => n.id === 'task1');
      expectDefined(task);
      expect(Array.isArray(task.properties.taskListener)).toBe(true);
      const listeners = task.properties.taskListener as any[];
      expect(listeners).toHaveLength(1);
      expect(listeners[0].event).toBe('create');
      expect(listeners[0].delegateExpression).toBe('${myListener}');
    });

    it('parses scriptTask with script CDATA', async () => {
      const xml = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"',
        '  targetNamespace="http://flowable.org/bpmn">',
        '  <process id="test" name="Test" isExecutable="true">',
        '    <startEvent id="start" name="Start"/>',
        '    <scriptTask id="script1" name="Compute" scriptFormat="groovy">',
        '      <script><![CDATA[def x = 1 + 1]]></script>',
        '    </scriptTask>',
        '    <endEvent id="end" name="End"/>',
        '    <sequenceFlow id="f1" sourceRef="start" targetRef="script1"/>',
        '    <sequenceFlow id="f2" sourceRef="script1" targetRef="end"/>',
        '  </process>',
        '</definitions>',
      ].join('\n');

      const result = await service.bpmnXmlToLfJson(xml);
      const task = result.nodes.find((n) => n.id === 'script1');
      expectDefined(task);
      expect(task.type).toBe('script-task');
      expect(task.properties.scriptFormat).toBe('groovy');
      expect(task.properties.script).toBe('def x = 1 + 1');
    });

    it('parses sequenceFlow with conditionExpression', async () => {
      const xml = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"',
        '  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"',
        '  targetNamespace="http://flowable.org/bpmn">',
        '  <process id="test" name="Test" isExecutable="true">',
        '    <startEvent id="start" name="Start"/>',
        '    <exclusiveGateway id="gw" name="Gate"/>',
        '    <endEvent id="end1" name="Approved"/>',
        '    <endEvent id="end2" name="Rejected"/>',
        '    <sequenceFlow id="f1" sourceRef="start" targetRef="gw"/>',
        '    <sequenceFlow id="f2" sourceRef="gw" targetRef="end1" name="Yes">',
        '      <conditionExpression xsi:type="tFormalExpression">${approved}</conditionExpression>',
        '    </sequenceFlow>',
        '    <sequenceFlow id="f3" sourceRef="gw" targetRef="end2" name="No">',
        '      <conditionExpression xsi:type="tFormalExpression">${!approved}</conditionExpression>',
        '    </sequenceFlow>',
        '  </process>',
        '</definitions>',
      ].join('\n');

      const result = await service.bpmnXmlToLfJson(xml);

      const gwNode = result.nodes.find((n) => n.id === 'gw');
      expectDefined(gwNode);
      expect(gwNode.type).toBe('exclusive-gateway');

      const f2 = result.edges.find((e) => e.id === 'f2');
      expectDefined(f2);
      expect(f2.properties.condition).toBe('${approved}');

      const f3 = result.edges.find((e) => e.id === 'f3');
      expectDefined(f3);
      expect(f3.properties.condition).toBe('${!approved}');
    });

    it('parses exclusiveGateway and parallelGateway', async () => {
      const xml = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"',
        '  targetNamespace="http://flowable.org/bpmn">',
        '  <process id="test" name="Test" isExecutable="true">',
        '    <startEvent id="start" name="Start"/>',
        '    <exclusiveGateway id="gw1" name="Decision"/>',
        '    <parallelGateway id="gw2" name="Fork"/>',
        '    <endEvent id="end" name="End"/>',
        '    <sequenceFlow id="f1" sourceRef="start" targetRef="gw1"/>',
        '    <sequenceFlow id="f2" sourceRef="gw1" targetRef="gw2"/>',
        '    <sequenceFlow id="f3" sourceRef="gw2" targetRef="end"/>',
        '  </process>',
        '</definitions>',
      ].join('\n');

      const result = await service.bpmnXmlToLfJson(xml);
      expect(result.nodes.some((n) => n.type === 'exclusive-gateway' && n.id === 'gw1')).toBe(true);
      expect(result.nodes.some((n) => n.type === 'parallel-gateway' && n.id === 'gw2')).toBe(true);
    });

    it('throws on invalid XML', async () => {
      await expect(service.bpmnXmlToLfJson('not xml at all')).rejects.toThrow();
    });

    it('throws on XML without definitions element', async () => {
      await expect(
        service.bpmnXmlToLfJson('<root><child/></root>'),
      ).rejects.toThrow('missing <definitions>');
    });
  });

  // ════════════════════════════════════════════
  // lfJsonToBpmnXml: basic generation
  // ════════════════════════════════════════════

  describe('lfJsonToBpmnXml', () => {
    it('generates valid BPMN XML for a start-to-end flow', async () => {
      const graph: LfGraphData = {
        nodes: [
          { id: 'start', type: 'start-event', x: 100, y: 80, properties: {}, text: { x: 100, y: 120, value: 'Start' } },
          { id: 'end', type: 'end-event', x: 400, y: 80, properties: {}, text: { x: 400, y: 120, value: 'End' } },
        ],
        edges: [
          { id: 'f1', type: 'sequence-flow', sourceNodeId: 'start', targetNodeId: 'end', properties: {} },
        ],
      };

      const xml = await service.lfJsonToBpmnXml(graph, 'testProcess', 'Test Process');

      expect(xml).toContain('<definitions');
      expect(xml).toContain('xmlns:flowable="http://flowable.org/bpmn"');
      expect(xml).toContain('id="testProcess"');
      expect(xml).toContain('isExecutable="true"');
      expect(xml).toContain('startEvent');
      expect(xml).toContain('endEvent');
      expect(xml).toContain('sequenceFlow');
      expect(xml).toContain('<bpmndi:BPMNDiagram');
    });

    it('generates userTask with assignee', async () => {
      const graph: LfGraphData = {
        nodes: [
          { id: 'start', type: 'start-event', x: 100, y: 80, properties: {}, text: { x: 100, y: 120, value: 'Start' } },
          { id: 'approve', type: 'user-task', x: 100, y: 200, properties: { assignee: '${initiator}' }, text: { x: 100, y: 260, value: 'Approve' } },
          { id: 'end', type: 'end-event', x: 400, y: 80, properties: {}, text: { x: 400, y: 120, value: 'End' } },
        ],
        edges: [
          { id: 'f1', type: 'sequence-flow', sourceNodeId: 'start', targetNodeId: 'approve', properties: {} },
          { id: 'f2', type: 'sequence-flow', sourceNodeId: 'approve', targetNodeId: 'end', properties: {} },
        ],
      };

      const xml = await service.lfJsonToBpmnXml(graph, 'approval', 'Approval');
      expect(xml).toContain('flowable:assignee="${initiator}"');
      expect(xml).toContain('userTask');
    });

    it('generates userTask with taskListener in extensionElements', async () => {
      const graph: LfGraphData = {
        nodes: [
          { id: 'start', type: 'start-event', x: 100, y: 80, properties: {}, text: { x: 100, y: 120, value: 'Start' } },
          { id: 'task', type: 'user-task', x: 100, y: 200,
            properties: { taskListener: [{ event: 'create', delegateExpression: '${reviewListener}' }] },
            text: { x: 100, y: 260, value: 'Review' } },
          { id: 'end', type: 'end-event', x: 400, y: 80, properties: {}, text: { x: 400, y: 120, value: 'End' } },
        ],
        edges: [
          { id: 'f1', type: 'sequence-flow', sourceNodeId: 'start', targetNodeId: 'task', properties: {} },
          { id: 'f2', type: 'sequence-flow', sourceNodeId: 'task', targetNodeId: 'end', properties: {} },
        ],
      };

      const xml = await service.lfJsonToBpmnXml(graph, 'review', 'Review');
      expect(xml).toContain('extensionElements');
      expect(xml).toContain('flowable:taskListener');
      expect(xml).toContain('delegateExpression="${reviewListener}"');
    });

    it('generates scriptTask with CDATA', async () => {
      const graph: LfGraphData = {
        nodes: [
          { id: 'start', type: 'start-event', x: 100, y: 80, properties: {}, text: { x: 100, y: 120, value: 'Start' } },
          { id: 'script', type: 'script-task', x: 100, y: 200,
            properties: { scriptFormat: 'groovy', script: 'println "hello"' },
            text: { x: 100, y: 260, value: 'Logic' } },
          { id: 'end', type: 'end-event', x: 400, y: 80, properties: {}, text: { x: 400, y: 120, value: 'End' } },
        ],
        edges: [
          { id: 'f1', type: 'sequence-flow', sourceNodeId: 'start', targetNodeId: 'script', properties: {} },
          { id: 'f2', type: 'sequence-flow', sourceNodeId: 'script', targetNodeId: 'end', properties: {} },
        ],
      };

      const xml = await service.lfJsonToBpmnXml(graph, 'scriptProcess', 'Script Process');
      expect(xml).toContain('scriptFormat="groovy"');
      expect(xml).toContain('println');
    });

    it('generates exclusiveGateway with conditional sequenceFlows', async () => {
      const graph: LfGraphData = {
        nodes: [
          { id: 'start', type: 'start-event', x: 100, y: 80, properties: {}, text: { x: 100, y: 120, value: 'Start' } },
          { id: 'gw', type: 'exclusive-gateway', x: 100, y: 200, properties: {}, text: { x: 100, y: 260, value: 'Decision' } },
          { id: 'end1', type: 'end-event', x: 60, y: 350, properties: {}, text: { x: 60, y: 390, value: 'Approved' } },
          { id: 'end2', type: 'end-event', x: 160, y: 350, properties: {}, text: { x: 160, y: 390, value: 'Rejected' } },
        ],
        edges: [
          { id: 'f1', type: 'sequence-flow', sourceNodeId: 'start', targetNodeId: 'gw', properties: {} },
          { id: 'fApproved', type: 'sequence-flow', sourceNodeId: 'gw', targetNodeId: 'end1',
            properties: { name: 'Approved', condition: '${approved == true}' } },
          { id: 'fRejected', type: 'sequence-flow', sourceNodeId: 'gw', targetNodeId: 'end2',
            properties: { name: 'Rejected', condition: '${approved != true}' } },
        ],
      };

      const xml = await service.lfJsonToBpmnXml(graph, 'gatewayProcess', 'Gateway');
      expect(xml).toContain('exclusiveGateway');
      expect(xml).toContain('conditionExpression');
      expect(xml).toContain('${approved == true}');
      expect(xml).toContain('${approved != true}');
    });

    it('escapes XML special characters in names', async () => {
      const graph: LfGraphData = {
        nodes: [
          { id: 'start', type: 'start-event', x: 100, y: 80, properties: {},
            text: { x: 100, y: 120, value: 'A & B < C > D' } },
          { id: 'end', type: 'end-event', x: 400, y: 80, properties: {},
            text: { x: 400, y: 120, value: 'End' } },
        ],
        edges: [
          { id: 'f1', type: 'sequence-flow', sourceNodeId: 'start', targetNodeId: 'end', properties: {} },
        ],
      };

      const xml = await service.lfJsonToBpmnXml(graph, 'safe', 'Safe');
      expect(xml).toContain('&amp;');
      expect(xml).toContain('&lt;');
      expect(xml).toContain('&gt;');
    });

    it('handles empty graph', async () => {
      const graph: LfGraphData = { nodes: [], edges: [] };
      const xml = await service.lfJsonToBpmnXml(graph, 'empty', 'Empty Process');
      expect(xml).toContain('id="empty"');
      expect(xml).toContain('</process>');
      expect(xml).toContain('</definitions>');
      expect(xml).toContain('<bpmndi:BPMNDiagram');
    });

    it('validates generated XML is parseable', async () => {
      const graph: LfGraphData = {
        nodes: [
          { id: 'start', type: 'start-event', x: 100, y: 80, properties: {}, text: { x: 100, y: 120, value: 'S' } },
          { id: 'end', type: 'end-event', x: 400, y: 80, properties: {}, text: { x: 400, y: 120, value: 'E' } },
        ],
        edges: [
          { id: 'f1', type: 'sequence-flow', sourceNodeId: 'start', targetNodeId: 'end', properties: {} },
        ],
      };

      const xml = await service.lfJsonToBpmnXml(graph, 'test', 'Test');
      const { XMLParser } = require('fast-xml-parser');
      const doc = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' }).parse(xml);
      expect(doc.definitions).toBeDefined();
      expect(doc.definitions.process['@_id']).toBe('test');
    });
  });

  // ════════════════════════════════════════════
  // Round-trip tests against all 6 templates
  // ════════════════════════════════════════════

  describe('round-trip conversion (all 6 BPMN templates)', () => {
    for (const templateFile of TEMPLATE_FILES) {
      it(`round-trips ${templateFile} preserving node/edge counts and structure`, async () => {
        const xml = loadTemplate(templateFile);

        const lf = await service.bpmnXmlToLfJson(xml);
        expect(lf.nodes.length).toBeGreaterThan(0);

        // Extract process key/name from original
        const { XMLParser } = require('fast-xml-parser');
        const doc = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' }).parse(xml);
        const proc = doc.definitions.process;
        const key = proc['@_id'] || 'process';
        const name = proc['@_name'] || 'Process';

        const regenerated = await service.lfJsonToBpmnXml(lf, key, name);

        // Parse regenerated and count
        const regenDoc = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' }).parse(regenerated);
        const regenProc = regenDoc.definitions.process;

        const nodeTypes = ['startEvent', 'endEvent', 'userTask', 'scriptTask', 'exclusiveGateway', 'parallelGateway'];
        let regenNodeCount = 0;
        let regenFlowCount = 0;
        for (const k of Object.keys(regenProc)) {
          if (k.startsWith('@_') || k === '#text') continue;
          const tag = k.includes(':') ? k.split(':')[1] : k;
          if (nodeTypes.includes(tag)) {
            const val = regenProc[k];
            regenNodeCount += Array.isArray(val) ? val.length : 1;
          } else if (tag === 'sequenceFlow') {
            const val = regenProc[k];
            regenFlowCount += Array.isArray(val) ? val.length : 1;
          }
        }

        expect(regenNodeCount).toBe(lf.nodes.length);
        expect(regenFlowCount).toBe(lf.edges.length);

        // Verify all node IDs survive
        for (const node of lf.nodes) {
          expect(regenerated).toContain(`id="${node.id}"`);
        }

        // Flowable namespace present
        expect(regenerated).toContain('xmlns:flowable="http://flowable.org/bpmn"');
        // BPMN DI present
        expect(regenerated).toContain('<bpmndi:BPMNDiagram');
      });
    }
  });

  // ════════════════════════════════════════════
  // Flowable extension preservation
  // ════════════════════════════════════════════

  describe('Flowable extension preservation', () => {
    it('preserves assignee through round-trip', async () => {
      const xml = loadTemplate('contract-approval.bpmn20.xml');
      const lf = await service.bpmnXmlToLfJson(xml);
      const userTask = lf.nodes.find((n) => n.type === 'user-task' && n.properties.assignee);
      expectDefined(userTask, 'Expected userTask with assignee');
      const regenerated = await service.lfJsonToBpmnXml(lf, 'contractApproval', 'Contract Approval');
      expect(regenerated).toContain('flowable:assignee=');
    });

    it('preserves taskListener through round-trip', async () => {
      const xml = loadTemplate('contract-approval-candidate.bpmn20.xml');
      const lf = await service.bpmnXmlToLfJson(xml);
      const nodeWithListener = lf.nodes.find((n) => n.properties.taskListener !== undefined);
      expectDefined(nodeWithListener, 'Expected node with taskListener');
      const regenerated = await service.lfJsonToBpmnXml(lf, 'contractApprovalCandidate', 'Candidate');
      expect(regenerated).toContain('<flowable:taskListener');
      expect(regenerated).toContain('<extensionElements>');
    });

    it('preserves scriptTask script through round-trip', async () => {
      const xml = loadTemplate('generic-approval.bpmn20.xml');
      const lf = await service.bpmnXmlToLfJson(xml);
      const scriptTask = lf.nodes.find((n) => n.type === 'script-task');
      expectDefined(scriptTask, 'Expected scriptTask');
      expect(scriptTask.properties.scriptFormat).toBeDefined();
      expect(scriptTask.properties.script).toBeDefined();

      const regenerated = await service.lfJsonToBpmnXml(lf, 'genericApproval', 'Generic Approval');
      expect(regenerated).toContain('scriptFormat="groovy"');
      expect(regenerated).toContain('<script>');
    });

    it('preserves sequenceFlow conditions through round-trip', async () => {
      const xml = loadTemplate('contract-approval.bpmn20.xml');
      const lf = await service.bpmnXmlToLfJson(xml);
      const conditionalEdges = lf.edges.filter((e) => e.properties.condition);
      expect(conditionalEdges.length).toBeGreaterThan(0);

      const regenerated = await service.lfJsonToBpmnXml(lf, 'contractApproval', 'Contract Approval');
      expect(regenerated).toContain('conditionExpression');
    });

    it('preserves candidateGroups through round-trip', async () => {
      const xml = loadTemplate('contract-approval-candidate.bpmn20.xml');
      const lf = await service.bpmnXmlToLfJson(xml);
      const candidateNode = lf.nodes.find((n) => n.properties.candidateGroups);
      expectDefined(candidateNode, 'Expected node with candidateGroups');

      const regenerated = await service.lfJsonToBpmnXml(lf, 'contractApprovalCandidate', 'Candidate');
      expect(regenerated).toContain('flowable:candidateGroups=');
    });

    it('preserves multiple taskListeners', async () => {
      // contract-approval-universal has 2 task listeners on approvalStep
      const xml = loadTemplate('contract-approval-universal.bpmn20.xml');
      const lf = await service.bpmnXmlToLfJson(xml);
      const approvalNode = lf.nodes.find((n) => n.id === 'approvalStep');
      expectDefined(approvalNode, 'Expected approvalStep node');

      const listeners = approvalNode.properties.taskListener as any[] | undefined;
      expectDefined(listeners, 'Expected taskListener array');
      expect(listeners.length).toBeGreaterThanOrEqual(2);

      const regenerated = await service.lfJsonToBpmnXml(lf, 'contractApprovalUniversal', 'Universal');
      // Should contain both taskListener elements
      const tlCount = (regenerated.match(/<flowable:taskListener/g) || []).length;
      expect(tlCount).toBeGreaterThanOrEqual(2);
    });
  });

  // ════════════════════════════════════════════
  // Edge cases
  // ════════════════════════════════════════════

  describe('edge cases', () => {
    it('handles empty process (no nodes)', async () => {
      const xml = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"',
        '  targetNamespace="http://flowable.org/bpmn">',
        '  <process id="empty" name="Empty" isExecutable="true">',
        '  </process>',
        '</definitions>',
      ].join('\n');

      const result = await service.bpmnXmlToLfJson(xml);
      expect(result.nodes).toHaveLength(0);
      expect(result.edges).toHaveLength(0);
    });

    it('handles LF graph with no edges', async () => {
      const graph: LfGraphData = {
        nodes: [
          { id: 'n1', type: 'start-event', x: 100, y: 80, properties: {}, text: { x: 100, y: 120, value: 'X' } },
        ],
        edges: [],
      };
      const xml = await service.lfJsonToBpmnXml(graph, 'test', 'Test');
      expect(xml).toContain('startEvent');
      expect(xml).not.toContain('sequenceFlow');
      expect(xml).toContain('<bpmndi:BPMNDiagram');
    });

    it('handles process with many userTasks (chain template)', async () => {
      const xml = loadTemplate('contract-approval-chain.bpmn20.xml');
      const lf = await service.bpmnXmlToLfJson(xml);
      const userTasks = lf.nodes.filter((n) => n.type === 'user-task');
      expect(userTasks.length).toBeGreaterThanOrEqual(4);
    });

    it('skips unknown LF node types gracefully', async () => {
      const graph: LfGraphData = {
        nodes: [
          { id: 'n1', type: 'start-event', x: 100, y: 80, properties: {}, text: { x: 100, y: 120, value: 'S' } },
          { id: 'n2', type: 'unknown-custom-type', x: 200, y: 80, properties: {}, text: { x: 200, y: 120, value: 'X' } },
          { id: 'n3', type: 'end-event', x: 100, y: 200, properties: {}, text: { x: 100, y: 240, value: 'E' } },
        ],
        edges: [
          { id: 'f1', type: 'sequence-flow', sourceNodeId: 'n1', targetNodeId: 'n3', properties: {} },
        ],
      };
      const xml = await service.lfJsonToBpmnXml(graph, 'test', 'Test');
      expect(xml).toContain('startEvent');
      expect(xml).toContain('endEvent');
      const roundTrip = await service.bpmnXmlToLfJson(xml);
      expect(roundTrip.nodes).toHaveLength(2);
    });

    it('generates valid XML schema-compatible namespace declarations', async () => {
      const graph: LfGraphData = {
        nodes: [
          { id: 'start', type: 'start-event', x: 100, y: 80, properties: {}, text: { x: 100, y: 120, value: 'S' } },
          { id: 'end', type: 'end-event', x: 400, y: 80, properties: {}, text: { x: 400, y: 120, value: 'E' } },
        ],
        edges: [
          { id: 'f1', type: 'sequence-flow', sourceNodeId: 'start', targetNodeId: 'end', properties: {} },
        ],
      };
      const xml = await service.lfJsonToBpmnXml(graph, 'nsTest', 'NS Test');

      // All required namespaces present
      expect(xml).toContain('xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"');
      expect(xml).toContain('xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"');
      expect(xml).toContain('xmlns:flowable="http://flowable.org/bpmn"');
      expect(xml).toContain('xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"');
      expect(xml).toContain('xmlns:omgdc="http://www.omg.org/spec/DD/20100524/DC"');
      expect(xml).toContain('xmlns:omgdi="http://www.omg.org/spec/DD/20100524/DI"');
      expect(xml).toContain('targetNamespace="http://flowable.org/bpmn"');
    });
  });
});
