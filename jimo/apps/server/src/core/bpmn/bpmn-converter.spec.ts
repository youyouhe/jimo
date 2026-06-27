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
      expect(startNode.type).toBe('bpmn:startEvent');
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
      expect(task.type).toBe('bpmn:userTask');
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
      expect(task.type).toBe('bpmn:scriptTask');
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
      expect(gwNode.type).toBe('bpmn:exclusiveGateway');

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
      expect(result.nodes.some((n) => n.type === 'bpmn:exclusiveGateway' && n.id === 'gw1')).toBe(true);
      expect(result.nodes.some((n) => n.type === 'bpmn:parallelGateway' && n.id === 'gw2')).toBe(true);
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
          { id: 'start', type: 'bpmn:startEvent', x: 100, y: 80, properties: {}, text: { x: 100, y: 120, value: 'Start' } },
          { id: 'end', type: 'bpmn:endEvent', x: 400, y: 80, properties: {}, text: { x: 400, y: 120, value: 'End' } },
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
          { id: 'start', type: 'bpmn:startEvent', x: 100, y: 80, properties: {}, text: { x: 100, y: 120, value: 'Start' } },
          { id: 'approve', type: 'bpmn:userTask', x: 100, y: 200, properties: { assignee: '${initiator}' }, text: { x: 100, y: 260, value: 'Approve' } },
          { id: 'end', type: 'bpmn:endEvent', x: 400, y: 80, properties: {}, text: { x: 400, y: 120, value: 'End' } },
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
          { id: 'start', type: 'bpmn:startEvent', x: 100, y: 80, properties: {}, text: { x: 100, y: 120, value: 'Start' } },
          { id: 'task', type: 'bpmn:userTask', x: 100, y: 200,
            properties: { taskListener: [{ event: 'create', delegateExpression: '${reviewListener}' }] },
            text: { x: 100, y: 260, value: 'Review' } },
          { id: 'end', type: 'bpmn:endEvent', x: 400, y: 80, properties: {}, text: { x: 400, y: 120, value: 'End' } },
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
          { id: 'start', type: 'bpmn:startEvent', x: 100, y: 80, properties: {}, text: { x: 100, y: 120, value: 'Start' } },
          { id: 'script', type: 'bpmn:scriptTask', x: 100, y: 200,
            properties: { scriptFormat: 'groovy', script: 'println "hello"' },
            text: { x: 100, y: 260, value: 'Logic' } },
          { id: 'end', type: 'bpmn:endEvent', x: 400, y: 80, properties: {}, text: { x: 400, y: 120, value: 'End' } },
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
          { id: 'start', type: 'bpmn:startEvent', x: 100, y: 80, properties: {}, text: { x: 100, y: 120, value: 'Start' } },
          { id: 'gw', type: 'bpmn:exclusiveGateway', x: 100, y: 200, properties: {}, text: { x: 100, y: 260, value: 'Decision' } },
          { id: 'end1', type: 'bpmn:endEvent', x: 60, y: 350, properties: {}, text: { x: 60, y: 390, value: 'Approved' } },
          { id: 'end2', type: 'bpmn:endEvent', x: 160, y: 350, properties: {}, text: { x: 160, y: 390, value: 'Rejected' } },
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
          { id: 'start', type: 'bpmn:startEvent', x: 100, y: 80, properties: {},
            text: { x: 100, y: 120, value: 'A & B < C > D' } },
          { id: 'end', type: 'bpmn:endEvent', x: 400, y: 80, properties: {},
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
          { id: 'start', type: 'bpmn:startEvent', x: 100, y: 80, properties: {}, text: { x: 100, y: 120, value: 'S' } },
          { id: 'end', type: 'bpmn:endEvent', x: 400, y: 80, properties: {}, text: { x: 400, y: 120, value: 'E' } },
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
      const userTask = lf.nodes.find((n) => n.type === 'bpmn:userTask' && n.properties.assignee);
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
      const scriptTask = lf.nodes.find((n) => n.type === 'bpmn:scriptTask');
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
          { id: 'n1', type: 'bpmn:startEvent', x: 100, y: 80, properties: {}, text: { x: 100, y: 120, value: 'X' } },
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
      const userTasks = lf.nodes.filter((n) => n.type === 'bpmn:userTask');
      expect(userTasks.length).toBeGreaterThanOrEqual(4);
    });

    it('skips unknown LF node types gracefully', async () => {
      const graph: LfGraphData = {
        nodes: [
          { id: 'n1', type: 'bpmn:startEvent', x: 100, y: 80, properties: {}, text: { x: 100, y: 120, value: 'S' } },
          { id: 'n2', type: 'unknown-custom-type', x: 200, y: 80, properties: {}, text: { x: 200, y: 120, value: 'X' } },
          { id: 'n3', type: 'bpmn:endEvent', x: 100, y: 200, properties: {}, text: { x: 100, y: 240, value: 'E' } },
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
          { id: 'start', type: 'bpmn:startEvent', x: 100, y: 80, properties: {}, text: { x: 100, y: 120, value: 'S' } },
          { id: 'end', type: 'bpmn:endEvent', x: 400, y: 80, properties: {}, text: { x: 400, y: 120, value: 'E' } },
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

  // ════════════════════════════════════════════
  // New element types
  // ════════════════════════════════════════════

  describe('new element types', () => {
    // ── import: intermediateCatchEvent ──
    it('parses intermediateCatchEvent with timerEventDefinition (duration)', async () => {
      const xml = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"',
        '  targetNamespace="http://flowable.org/bpmn">',
        '  <process id="test" name="Test" isExecutable="true">',
        '    <startEvent id="start" name="Start"/>',
        '    <intermediateCatchEvent id="timer1" name="Wait 1 Hour">',
        '      <timerEventDefinition>',
        '        <timeDuration>PT1H</timeDuration>',
        '      </timerEventDefinition>',
        '    </intermediateCatchEvent>',
        '    <endEvent id="end" name="End"/>',
        '    <sequenceFlow id="f1" sourceRef="start" targetRef="timer1"/>',
        '    <sequenceFlow id="f2" sourceRef="timer1" targetRef="end"/>',
        '  </process>',
        '</definitions>',
      ].join('\n');

      const result = await service.bpmnXmlToLfJson(xml);
      expect(result.nodes).toHaveLength(3);

      const timer = result.nodes.find((n) => n.id === 'timer1');
      expectDefined(timer);
      expect(timer.type).toBe('bpmn:intermediateCatchEvent');
      expect(timer.properties.definitionType).toBe('bpmn:timerEventDefinition');
      expect(timer.properties.timerType).toBe('duration');
      expect(timer.properties.timerValue).toBe('PT1H');
    });

    it('parses intermediateCatchEvent with timerEventDefinition (cycle)', async () => {
      const xml = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"',
        '  targetNamespace="http://flowable.org/bpmn">',
        '  <process id="test" name="Test" isExecutable="true">',
        '    <startEvent id="start" name="Start"/>',
        '    <intermediateCatchEvent id="timerRepeat" name="Repeat">',
        '      <timerEventDefinition>',
        '        <timeCycle>R3/PT10M</timeCycle>',
        '      </timerEventDefinition>',
        '    </intermediateCatchEvent>',
        '    <endEvent id="end" name="End"/>',
        '    <sequenceFlow id="f1" sourceRef="start" targetRef="timerRepeat"/>',
        '    <sequenceFlow id="f2" sourceRef="timerRepeat" targetRef="end"/>',
        '  </process>',
        '</definitions>',
      ].join('\n');

      const result = await service.bpmnXmlToLfJson(xml);
      const timer = result.nodes.find((n) => n.id === 'timerRepeat');
      expectDefined(timer);
      expect(timer.properties.timerType).toBe('cycle');
      expect(timer.properties.timerValue).toBe('R3/PT10M');
    });

    it('parses intermediateCatchEvent with messageEventDefinition', async () => {
      const xml = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"',
        '  targetNamespace="http://flowable.org/bpmn">',
        '  <process id="test" name="Test" isExecutable="true">',
        '    <startEvent id="start" name="Start"/>',
        '    <intermediateCatchEvent id="msg1" name="Wait Message">',
        '      <messageEventDefinition messageRef="orderMessage"/>',
        '    </intermediateCatchEvent>',
        '    <endEvent id="end" name="End"/>',
        '    <sequenceFlow id="f1" sourceRef="start" targetRef="msg1"/>',
        '    <sequenceFlow id="f2" sourceRef="msg1" targetRef="end"/>',
        '  </process>',
        '</definitions>',
      ].join('\n');

      const result = await service.bpmnXmlToLfJson(xml);
      const msg = result.nodes.find((n) => n.id === 'msg1');
      expectDefined(msg);
      expect(msg.type).toBe('bpmn:intermediateCatchEvent');
      expect(msg.properties.definitionType).toBe('bpmn:messageEventDefinition');
      expect(msg.properties.messageRef).toBe('orderMessage');
    });

    // ── import: boundaryEvent ──
    it('parses boundaryEvent with timerEventDefinition', async () => {
      const xml = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"',
        '  targetNamespace="http://flowable.org/bpmn">',
        '  <process id="test" name="Test" isExecutable="true">',
        '    <startEvent id="start" name="Start"/>',
        '    <userTask id="task1" name="Review"/>',
        '    <boundaryEvent id="timeout" name="Timeout" attachedToRef="task1" cancelActivity="true">',
        '      <timerEventDefinition>',
        '        <timeDuration>PT48H</timeDuration>',
        '      </timerEventDefinition>',
        '    </boundaryEvent>',
        '    <endEvent id="end1" name="Done"/>',
        '    <endEvent id="end2" name="Timeout"/>',
        '    <sequenceFlow id="f1" sourceRef="start" targetRef="task1"/>',
        '    <sequenceFlow id="f2" sourceRef="task1" targetRef="end1"/>',
        '    <sequenceFlow id="f3" sourceRef="timeout" targetRef="end2"/>',
        '  </process>',
        '</definitions>',
      ].join('\n');

      const result = await service.bpmnXmlToLfJson(xml);
      const boundary = result.nodes.find((n) => n.id === 'timeout');
      expectDefined(boundary);
      expect(boundary.type).toBe('bpmn:boundaryEvent');
      expect(boundary.properties.attachedToRef).toBe('task1');
      expect(boundary.properties.cancelActivity).toBe(true);
      expect(boundary.properties.definitionType).toBe('bpmn:timerEventDefinition');
      expect(boundary.properties.timerType).toBe('duration');
      expect(boundary.properties.timerValue).toBe('PT48H');
    });

    it('parses boundaryEvent with errorEventDefinition', async () => {
      const xml = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"',
        '  targetNamespace="http://flowable.org/bpmn">',
        '  <process id="test" name="Test" isExecutable="true">',
        '    <startEvent id="start" name="Start"/>',
        '    <serviceTask id="svc1" name="Call API"/>',
        '    <boundaryEvent id="errBound" name="API Error" attachedToRef="svc1">',
        '      <errorEventDefinition errorRef="apiError"/>',
        '    </boundaryEvent>',
        '    <endEvent id="end1" name="OK"/>',
        '    <endEvent id="end2" name="Error"/>',
        '    <sequenceFlow id="f1" sourceRef="start" targetRef="svc1"/>',
        '    <sequenceFlow id="f2" sourceRef="svc1" targetRef="end1"/>',
        '    <sequenceFlow id="f3" sourceRef="errBound" targetRef="end2"/>',
        '  </process>',
        '</definitions>',
      ].join('\n');

      const result = await service.bpmnXmlToLfJson(xml);
      const errNode = result.nodes.find((n) => n.id === 'errBound');
      expectDefined(errNode);
      expect(errNode.type).toBe('bpmn:boundaryEvent');
      expect(errNode.properties.attachedToRef).toBe('svc1');
      expect(errNode.properties.definitionType).toBe('bpmn:errorEventDefinition');
      expect(errNode.properties.errorRef).toBe('apiError');
    });

    // ── import: callActivity ──
    it('parses callActivity with calledElement', async () => {
      const xml = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"',
        '  targetNamespace="http://flowable.org/bpmn">',
        '  <process id="test" name="Test" isExecutable="true">',
        '    <startEvent id="start" name="Start"/>',
        '    <callActivity id="call1" name="Call Sub" calledElement="subApproval"/>',
        '    <endEvent id="end" name="End"/>',
        '    <sequenceFlow id="f1" sourceRef="start" targetRef="call1"/>',
        '    <sequenceFlow id="f2" sourceRef="call1" targetRef="end"/>',
        '  </process>',
        '</definitions>',
      ].join('\n');

      const result = await service.bpmnXmlToLfJson(xml);
      const callNode = result.nodes.find((n) => n.id === 'call1');
      expectDefined(callNode);
      expect(callNode.type).toBe('bpmn:callActivity');
      expect(callNode.properties.calledElement).toBe('subApproval');
    });

    // ── import: manualTask ──
    it('parses manualTask', async () => {
      const xml = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"',
        '  targetNamespace="http://flowable.org/bpmn">',
        '  <process id="test" name="Test" isExecutable="true">',
        '    <startEvent id="start" name="Start"/>',
        '    <manualTask id="m1" name="Manual Step"/>',
        '    <endEvent id="end" name="End"/>',
        '    <sequenceFlow id="f1" sourceRef="start" targetRef="m1"/>',
        '    <sequenceFlow id="f2" sourceRef="m1" targetRef="end"/>',
        '  </process>',
        '</definitions>',
      ].join('\n');

      const result = await service.bpmnXmlToLfJson(xml);
      const manualNode = result.nodes.find((n) => n.id === 'm1');
      expectDefined(manualNode);
      expect(manualNode.type).toBe('bpmn:manualTask');
      expect(manualNode.text.value).toBe('Manual Step');
    });

    // ── import: subProcess with inner elements ──
    it('parses subProcess with inner flow elements', async () => {
      const xml = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"',
        '  targetNamespace="http://flowable.org/bpmn">',
        '  <process id="test" name="Test" isExecutable="true">',
        '    <startEvent id="start" name="Start"/>',
        '    <subProcess id="sub1" name="Sub Process">',
        '      <startEvent id="subStart" name="Inner Start"/>',
        '      <userTask id="subTask" name="Inner Task"/>',
        '      <endEvent id="subEnd" name="Inner End"/>',
        '      <sequenceFlow id="sf1" sourceRef="subStart" targetRef="subTask"/>',
        '      <sequenceFlow id="sf2" sourceRef="subTask" targetRef="subEnd"/>',
        '    </subProcess>',
        '    <endEvent id="end" name="End"/>',
        '    <sequenceFlow id="f1" sourceRef="start" targetRef="sub1"/>',
        '    <sequenceFlow id="f2" sourceRef="sub1" targetRef="end"/>',
        '  </process>',
        '</definitions>',
      ].join('\n');

      const result = await service.bpmnXmlToLfJson(xml);
      const sub = result.nodes.find((n) => n.id === 'sub1');
      expectDefined(sub);
      expect(sub.type).toBe('bpmn:subProcess');
      expect(sub.text.value).toBe('Sub Process');

      // Inner elements stored as children — not flattened into top-level
      const children = sub.properties.children as any;
      expectDefined(children);
      expect(children.nodes).toHaveLength(3);
      expect(children.edges).toHaveLength(2);
    });

    // ── export: intermediateCatchEvent from LF JSON ──
    it('exports intermediateCatchEvent with timer definition', async () => {
      const graph: LfGraphData = {
        nodes: [
          { id: 'start', type: 'bpmn:startEvent', x: 100, y: 80, properties: {}, text: { x: 100, y: 120, value: 'Start' } },
          { id: 'timer1', type: 'bpmn:intermediateCatchEvent', x: 100, y: 200,
            properties: { definitionType: 'bpmn:timerEventDefinition', timerType: 'duration', timerValue: 'PT1H' },
            text: { x: 100, y: 240, value: 'Wait 1h' } },
          { id: 'end', type: 'bpmn:endEvent', x: 400, y: 200, properties: {}, text: { x: 400, y: 240, value: 'End' } },
        ],
        edges: [
          { id: 'f1', type: 'sequence-flow', sourceNodeId: 'start', targetNodeId: 'timer1', properties: {} },
          { id: 'f2', type: 'sequence-flow', sourceNodeId: 'timer1', targetNodeId: 'end', properties: {} },
        ],
      };

      const xml = await service.lfJsonToBpmnXml(graph, 'timerTest', 'Timer Test');
      expect(xml).toContain('intermediateCatchEvent');
      expect(xml).toContain('timerEventDefinition');
      expect(xml).toContain('<timeDuration>PT1H</timeDuration>');

      // Verify parseable
      const { XMLParser } = require('fast-xml-parser');
      const doc = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' }).parse(xml);
      expect(doc.definitions).toBeDefined();
    });

    // ── export: boundaryEvent from LF JSON ──
    it('exports boundaryEvent with error definition', async () => {
      const graph: LfGraphData = {
        nodes: [
          { id: 'start', type: 'bpmn:startEvent', x: 100, y: 80, properties: {}, text: { x: 100, y: 120, value: 'Start' } },
          { id: 'svc1', type: 'bpmn:serviceTask', x: 100, y: 200,
            properties: { name: 'Call API' }, text: { x: 100, y: 260, value: 'Call API' } },
          { id: 'err1', type: 'bpmn:boundaryEvent', x: 150, y: 240,
            properties: { definitionType: 'bpmn:errorEventDefinition', errorRef: 'apiError', attachedToRef: 'svc1', cancelActivity: true },
            text: { x: 150, y: 280, value: 'API Error' } },
          { id: 'endOk', type: 'bpmn:endEvent', x: 400, y: 80, properties: {}, text: { x: 400, y: 120, value: 'OK' } },
          { id: 'endErr', type: 'bpmn:endEvent', x: 400, y: 240, properties: {}, text: { x: 400, y: 280, value: 'Error' } },
        ],
        edges: [
          { id: 'f1', type: 'sequence-flow', sourceNodeId: 'start', targetNodeId: 'svc1', properties: {} },
          { id: 'f2', type: 'sequence-flow', sourceNodeId: 'svc1', targetNodeId: 'endOk', properties: {} },
          { id: 'f3', type: 'sequence-flow', sourceNodeId: 'err1', targetNodeId: 'endErr', properties: {} },
        ],
      };

      const xml = await service.lfJsonToBpmnXml(graph, 'boundTest', 'Boundary Test');
      expect(xml).toContain('boundaryEvent');
      expect(xml).toContain('attachedToRef="svc1"');
      expect(xml).toContain('cancelActivity="true"');
      expect(xml).toContain('errorEventDefinition');
      expect(xml).toContain('errorRef="apiError"');
    });

    // ── export: callActivity from LF JSON ──
    it('exports callActivity with calledElement', async () => {
      const graph: LfGraphData = {
        nodes: [
          { id: 'start', type: 'bpmn:startEvent', x: 100, y: 80, properties: {}, text: { x: 100, y: 120, value: 'Start' } },
          { id: 'call1', type: 'bpmn:callActivity', x: 100, y: 200,
            properties: { calledElement: 'mySubProcess', name: 'Call Sub' },
            text: { x: 100, y: 260, value: 'Call Sub' } },
          { id: 'end', type: 'bpmn:endEvent', x: 400, y: 200, properties: {}, text: { x: 400, y: 240, value: 'End' } },
        ],
        edges: [
          { id: 'f1', type: 'sequence-flow', sourceNodeId: 'start', targetNodeId: 'call1', properties: {} },
          { id: 'f2', type: 'sequence-flow', sourceNodeId: 'call1', targetNodeId: 'end', properties: {} },
        ],
      };

      const xml = await service.lfJsonToBpmnXml(graph, 'callTest', 'Call Test');
      expect(xml).toContain('callActivity');
      expect(xml).toContain('calledElement="mySubProcess"');
    });

    // ── round-trip: intermediateCatchEvent ──
    it('round-trips intermediateCatchEvent with timer preserving properties', async () => {
      const xml = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"',
        '  targetNamespace="http://flowable.org/bpmn">',
        '  <process id="rtTimer" name="RT Timer" isExecutable="true">',
        '    <startEvent id="start" name="Start"/>',
        '    <intermediateCatchEvent id="timer1" name="Wait">',
        '      <timerEventDefinition>',
        '        <timeDuration>PT2H</timeDuration>',
        '      </timerEventDefinition>',
        '    </intermediateCatchEvent>',
        '    <endEvent id="end" name="End"/>',
        '    <sequenceFlow id="f1" sourceRef="start" targetRef="timer1"/>',
        '    <sequenceFlow id="f2" sourceRef="timer1" targetRef="end"/>',
        '  </process>',
        '</definitions>',
      ].join('\n');

      const lf = await service.bpmnXmlToLfJson(xml);
      const regenerated = await service.lfJsonToBpmnXml(lf, 'rtTimer', 'RT Timer');

      // Verify structure preserved
      const timerNode = lf.nodes.find((n) => n.id === 'timer1');
      expectDefined(timerNode);
      expect(timerNode.properties.definitionType).toBe('bpmn:timerEventDefinition');
      expect(timerNode.properties.timerValue).toBe('PT2H');

      // Verify re-generated XML
      expect(regenerated).toContain('intermediateCatchEvent');
      expect(regenerated).toContain('timerEventDefinition');
      expect(regenerated).toContain('<timeDuration>PT2H</timeDuration>');

      // Re-parse and verify
      const lf2 = await service.bpmnXmlToLfJson(regenerated);
      const timer2 = lf2.nodes.find((n) => n.id === 'timer1');
      expectDefined(timer2);
      expect(timer2.type).toBe('bpmn:intermediateCatchEvent');
      expect(timer2.properties.definitionType).toBe('bpmn:timerEventDefinition');
      expect(timer2.properties.timerType).toBe('duration');
      expect(timer2.properties.timerValue).toBe('PT2H');
    });

    // ── round-trip: boundaryEvent ──
    it('round-trips boundaryEvent preserving attachedToRef and error definition', async () => {
      const xml = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"',
        '  targetNamespace="http://flowable.org/bpmn">',
        '  <process id="rtBound" name="RT Boundary" isExecutable="true">',
        '    <startEvent id="start" name="Start"/>',
        '    <userTask id="task1" name="Review"/>',
        '    <boundaryEvent id="b1" name="Timeout" attachedToRef="task1" cancelActivity="false">',
        '      <timerEventDefinition>',
        '        <timeDuration>P3D</timeDuration>',
        '      </timerEventDefinition>',
        '    </boundaryEvent>',
        '    <endEvent id="end1" name="Done"/>',
        '    <endEvent id="end2" name="Escalated"/>',
        '    <sequenceFlow id="f1" sourceRef="start" targetRef="task1"/>',
        '    <sequenceFlow id="f2" sourceRef="task1" targetRef="end1"/>',
        '    <sequenceFlow id="f3" sourceRef="b1" targetRef="end2"/>',
        '  </process>',
        '</definitions>',
      ].join('\n');

      const lf = await service.bpmnXmlToLfJson(xml);
      const regenerated = await service.lfJsonToBpmnXml(lf, 'rtBound', 'RT Boundary');

      const bNode = lf.nodes.find((n) => n.id === 'b1');
      expectDefined(bNode);
      expect(bNode.type).toBe('bpmn:boundaryEvent');
      expect(bNode.properties.attachedToRef).toBe('task1');
      expect(bNode.properties.cancelActivity).toBe(false);
      expect(bNode.properties.definitionType).toBe('bpmn:timerEventDefinition');
      expect(bNode.properties.timerValue).toBe('P3D');

      // Re-parse regenerated XML
      const lf2 = await service.bpmnXmlToLfJson(regenerated);
      const b2 = lf2.nodes.find((n) => n.id === 'b1');
      expectDefined(b2);
      expect(b2.type).toBe('bpmn:boundaryEvent');
      expect(b2.properties.attachedToRef).toBe('task1');
      expect(b2.properties.definitionType).toBe('bpmn:timerEventDefinition');
      expect(b2.properties.timerValue).toBe('P3D');
    });

    // ── round-trip: callActivity ──
    it('round-trips callActivity preserving calledElement', async () => {
      const xml = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"',
        '  targetNamespace="http://flowable.org/bpmn">',
        '  <process id="rtCall" name="RT Call" isExecutable="true">',
        '    <startEvent id="start" name="Start"/>',
        '    <callActivity id="call1" name="Sub Process" calledElement="childProcess"/>',
        '    <endEvent id="end" name="End"/>',
        '    <sequenceFlow id="f1" sourceRef="start" targetRef="call1"/>',
        '    <sequenceFlow id="f2" sourceRef="call1" targetRef="end"/>',
        '  </process>',
        '</definitions>',
      ].join('\n');

      const lf = await service.bpmnXmlToLfJson(xml);
      const regenerated = await service.lfJsonToBpmnXml(lf, 'rtCall', 'RT Call');

      const callNode = lf.nodes.find((n) => n.id === 'call1');
      expectDefined(callNode);
      expect(callNode.type).toBe('bpmn:callActivity');
      expect(callNode.properties.calledElement).toBe('childProcess');

      // Re-parse
      const lf2 = await service.bpmnXmlToLfJson(regenerated);
      const call2 = lf2.nodes.find((n) => n.id === 'call1');
      expectDefined(call2);
      expect(call2.type).toBe('bpmn:callActivity');
      expect(call2.properties.calledElement).toBe('childProcess');
    });

    // ── export: messageEventDefinition ──
    it('exports intermediateCatchEvent with messageEventDefinition', async () => {
      const graph: LfGraphData = {
        nodes: [
          { id: 'start', type: 'bpmn:startEvent', x: 100, y: 80, properties: {}, text: { x: 100, y: 120, value: 'Start' } },
          { id: 'msg1', type: 'bpmn:intermediateCatchEvent', x: 100, y: 200,
            properties: { definitionType: 'bpmn:messageEventDefinition', messageRef: 'orderMsg' },
            text: { x: 100, y: 240, value: 'Wait Msg' } },
          { id: 'end', type: 'bpmn:endEvent', x: 400, y: 200, properties: {}, text: { x: 400, y: 240, value: 'End' } },
        ],
        edges: [
          { id: 'f1', type: 'sequence-flow', sourceNodeId: 'start', targetNodeId: 'msg1', properties: {} },
          { id: 'f2', type: 'sequence-flow', sourceNodeId: 'msg1', targetNodeId: 'end', properties: {} },
        ],
      };

      const xml = await service.lfJsonToBpmnXml(graph, 'msgTest', 'Msg Test');
      expect(xml).toContain('messageEventDefinition');
      expect(xml).toContain('messageRef="orderMsg"');
    });

    // ── export: signalEventDefinition ──
    it('exports intermediateThrowEvent with signalEventDefinition', async () => {
      const graph: LfGraphData = {
        nodes: [
          { id: 'start', type: 'bpmn:startEvent', x: 100, y: 80, properties: {}, text: { x: 100, y: 120, value: 'Start' } },
          { id: 'sig1', type: 'bpmn:intermediateThrowEvent', x: 100, y: 200,
            properties: { definitionType: 'bpmn:signalEventDefinition', signalRef: 'orderSignal' },
            text: { x: 100, y: 240, value: 'Send Signal' } },
          { id: 'end', type: 'bpmn:endEvent', x: 400, y: 200, properties: {}, text: { x: 400, y: 240, value: 'End' } },
        ],
        edges: [
          { id: 'f1', type: 'sequence-flow', sourceNodeId: 'start', targetNodeId: 'sig1', properties: {} },
          { id: 'f2', type: 'sequence-flow', sourceNodeId: 'sig1', targetNodeId: 'end', properties: {} },
        ],
      };

      const xml = await service.lfJsonToBpmnXml(graph, 'sigTest', 'Sig Test');
      expect(xml).toContain('intermediateThrowEvent');
      expect(xml).toContain('signalEventDefinition');
      expect(xml).toContain('signalRef="orderSignal"');
    });

    // ── export: subProcess with children ──
    it('exports subProcess preserving inner flow elements', async () => {
      const graph: LfGraphData = {
        nodes: [
          { id: 'start', type: 'bpmn:startEvent', x: 100, y: 80, properties: {}, text: { x: 100, y: 120, value: 'Start' } },
          { id: 'sub1', type: 'bpmn:subProcess', x: 100, y: 200,
            properties: {
              name: 'Sub Process',
              children: {
                nodes: [
                  { id: 'subStart', type: 'bpmn:startEvent', x: 120, y: 220, properties: {}, text: { x: 120, y: 260, value: 'Inner Start' } },
                  { id: 'subEnd', type: 'bpmn:endEvent', x: 300, y: 220, properties: {}, text: { x: 300, y: 260, value: 'Inner End' } },
                ],
                edges: [
                  { id: 'sfInner', type: 'sequence-flow', sourceNodeId: 'subStart', targetNodeId: 'subEnd', properties: {} },
                ],
              },
            },
            text: { x: 100, y: 360, value: 'Sub Process' } },
          { id: 'end', type: 'bpmn:endEvent', x: 400, y: 80, properties: {}, text: { x: 400, y: 120, value: 'End' } },
        ],
        edges: [
          { id: 'f1', type: 'sequence-flow', sourceNodeId: 'start', targetNodeId: 'sub1', properties: {} },
          { id: 'f2', type: 'sequence-flow', sourceNodeId: 'sub1', targetNodeId: 'end', properties: {} },
        ],
      };

      const xml = await service.lfJsonToBpmnXml(graph, 'subTest', 'Sub Test');
      expect(xml).toContain('subProcess');
      expect(xml).toContain('id="subStart"');
      expect(xml).toContain('id="subEnd"');
      expect(xml).toContain('id="sfInner"');
    });
  });
});
