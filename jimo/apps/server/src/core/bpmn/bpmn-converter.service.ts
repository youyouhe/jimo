import { Injectable, Logger } from '@nestjs/common';
import { XMLParser } from 'fast-xml-parser';

// ──────────────────────────────────────────────
// Type definitions: LogicFlow graph structure
// ──────────────────────────────────────────────

export interface LfNode {
  id: string;
  type: string;
  x: number;
  y: number;
  properties: Record<string, unknown>;
  text: { x: number; y: number; value: string };
}

export interface LfEdge {
  id: string;
  type: string;
  sourceNodeId: string;
  targetNodeId: string;
  properties: Record<string, unknown>;
  text?: { x: number; y: number; value: string };
}

export interface LfGraphData {
  nodes: LfNode[];
  edges: LfEdge[];
}

// ──────────────────────────────────────────────
// Internal mapping types
// ──────────────────────────────────────────────

interface BpmnShapeInfo {
  bpmnElement: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

// ──────────────────────────────────────────────
// BPMN element ↔ LF type mapping
// ──────────────────────────────────────────────

const BPMN_TO_LF_TYPE: Record<string, string> = {
  startEvent: 'start-event',
  endEvent: 'end-event',
  userTask: 'user-task',
  scriptTask: 'script-task',
  serviceTask: 'service-task',
  exclusiveGateway: 'exclusive-gateway',
  parallelGateway: 'parallel-gateway',
  inclusiveGateway: 'inclusive-gateway',
};

const LF_TO_BPMN_TYPE: Record<string, string> = {
  'start-event': 'startEvent',
  'end-event': 'endEvent',
  'user-task': 'userTask',
  'script-task': 'scriptTask',
  'service-task': 'serviceTask',
  'exclusive-gateway': 'exclusiveGateway',
  'parallel-gateway': 'parallelGateway',
  'inclusive-gateway': 'inclusiveGateway',
  // Also accept namespaced and camelCase variants
  'bpmn:startEvent': 'startEvent',
  'bpmn:endEvent': 'endEvent',
  'bpmn:userTask': 'userTask',
  'bpmn:scriptTask': 'scriptTask',
  'bpmn:exclusiveGateway': 'exclusiveGateway',
  'bpmn:parallelGateway': 'parallelGateway',
  startEvent: 'startEvent',
  endEvent: 'endEvent',
  userTask: 'userTask',
  scriptTask: 'scriptTask',
  exclusiveGateway: 'exclusiveGateway',
  parallelGateway: 'parallelGateway',
  sequenceFlow: 'sequenceFlow',
  'sequence-flow': 'sequenceFlow',
};

const FLOW_NODE_TAGS = new Set([
  'startEvent', 'endEvent', 'userTask', 'scriptTask',
  'serviceTask', 'exclusiveGateway', 'parallelGateway', 'inclusiveGateway',
]);

// XML namespaces
const BPMN_NS = 'http://www.omg.org/spec/BPMN/20100524/MODEL';
const FLOWABLE_NS = 'http://flowable.org/bpmn';
const BPMNDI_NS = 'http://www.omg.org/spec/BPMN/20100524/DI';
const OMGDC_NS = 'http://www.omg.org/spec/DD/20100524/DC';
const OMGDI_NS = 'http://www.omg.org/spec/DD/20100524/DI';
const XSI_NS = 'http://www.w3.org/2001/XMLSchema-instance';

// ──────────────────────────────────────────────
// fast-xml-parser options
// ──────────────────────────────────────────────

function createParser() {
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    preserveOrder: false,
    removeNSPrefix: false,
    allowBooleanAttributes: true,
    cdataPropName: '#text',
    processEntities: false,
    htmlEntities: false,
  });
}

// ──────────────────────────────────────────────
// Escape helpers
// ──────────────────────────────────────────────

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ──────────────────────────────────────────────
// Service
// ──────────────────────────────────────────────

@Injectable()
export class BpmnConverterService {
  private readonly logger = new Logger(BpmnConverterService.name);

  // ============================================================
  // BPMN XML  →  LogicFlow JSON
  // ============================================================

  /**
   * Convert a BPMN 2.0 XML string to LogicFlow graph data.
   * Extracts Flowable extension attributes (assignee, candidateGroups,
   * taskListener, executionListener, formKey) into node.properties,
   * and BPMN DI coordinates into node positions.
   */
  async bpmnXmlToLfJson(xml: string): Promise<LfGraphData> {
    const parser = createParser();
    let doc: any;
    try {
      doc = parser.parse(xml);
    } catch (err: any) {
      throw new Error(`Failed to parse BPMN XML: ${err.message}`);
    }

    const definitions = doc.definitions;
    if (!definitions) {
      throw new Error('Invalid BPMN XML: missing <definitions> root element');
    }

    // Extract process element
    const process = this.findByLocalName(definitions, 'process');
    if (!process) {
      throw new Error('Invalid BPMN XML: missing <process> element');
    }

    // Collect flow nodes and sequence flows (with their tag names)
    const flowNodes: Array<{ el: any; tag: string }> = [];
    const sequenceFlows: any[] = [];

    for (const key of Object.keys(process)) {
      if (key.startsWith('@_') || key === '#text') continue;
      const tag = this.localName(key);
      const element = process[key];
      if (!element) continue;

      if (FLOW_NODE_TAGS.has(tag)) {
        const items = Array.isArray(element) ? element : [element];
        for (const item of items) {
          flowNodes.push({ el: item, tag });
        }
      } else if (tag === 'sequenceFlow') {
        const items = Array.isArray(element) ? element : [element];
        sequenceFlows.push(...items);
      }
    }

    // Parse BPMN DI for coordinates
    const bpmnDiagram = this.findByLocalName(definitions, 'BPMNDiagram');
    const shapeMap = this.parseBpmnShapes(bpmnDiagram);

    // Convert flow nodes to LF nodes
    const nodes: LfNode[] = flowNodes.map(({ el, tag: tagName }) => {
      const id = el['@_id'] || '';
      const name = el['@_name'] || '';
      const lfType = BPMN_TO_LF_TYPE[tagName] || tagName;
      const shape = shapeMap.get(id);

      const node: LfNode = {
        id,
        type: lfType,
        x: shape?.x ?? 100,
        y: shape?.y ?? 100,
        properties: this.extractFlowableProperties(el, tagName),
        text: {
          x: shape?.x ?? 100,
          y: shape ? shape.y + shape.height + 16 : 140,
          value: name || id,
        },
      };

      if (shape) {
        (node as any).width = shape.width;
        (node as any).height = shape.height;
      }

      return node;
    });

    // Convert sequence flows to LF edges
    const edges: LfEdge[] = sequenceFlows.map((el) => {
      const id = el['@_id'] || '';
      const sourceRef = el['@_sourceRef'] || '';
      const targetRef = el['@_targetRef'] || '';
      const name = el['@_name'] || '';

      const properties: Record<string, unknown> = {};
      const ce = this.findByLocalName(el, 'conditionExpression');
      if (ce) {
        const text = ce['#text'];
        if (text !== undefined && text !== null) {
          properties.condition = String(text).trim();
        }
      }

      return {
        id,
        type: 'sequence-flow',
        sourceNodeId: sourceRef,
        targetNodeId: targetRef,
        properties,
        text: name
          ? { x: 0, y: 0, value: name }
          : undefined,
      };
    });

    return { nodes, edges };
  }

  // ============================================================
  // LogicFlow JSON  →  BPMN XML
  // ============================================================

  /**
   * Convert LogicFlow graph data to Flowable-compatible BPMN 2.0 XML.
   * Includes BPMN DI diagram with shape/edge coordinates.
   *
   * @param graph - LogicFlow graph data (nodes + edges)
   * @param processKey - BPMN process id (alphanumeric identifier)
   * @param processName - Human-readable process name
   * @returns Valid BPMN 2.0 XML string
   */
  async lfJsonToBpmnXml(
    graph: LfGraphData,
    processKey: string,
    processName: string,
  ): Promise<string> {
    const { nodes, edges } = graph;

    const safeKey = xmlEscape(processKey);
    const safeName = xmlEscape(processName || processKey);

    // Build flow elements
    const flowElements: string[] = [];
    const shapes: string[] = [];
    const diEdges: string[] = [];

    // Build node index for waypoint generation
    const nodesById = new Map<string, LfNode>();
    for (const node of nodes) {
      nodesById.set(node.id, node);
    }

    for (const node of nodes) {
      const bpmnType = this.lfTypeToBpmn(node.type);
      if (!bpmnType) {
        this.logger.warn(`Unknown LF node type "${node.type}", skipping node ${node.id}`);
        continue;
      }
      flowElements.push(this.buildBpmnNodeElement(node, bpmnType));
      shapes.push(this.buildBpmnShape(node, bpmnType));
    }

    for (const edge of edges) {
      flowElements.push(this.buildSequenceFlowElement(edge));
      diEdges.push(this.buildBpmnEdge(edge, nodesById));
    }

    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      `<definitions`,
      `  xmlns="${BPMN_NS}"`,
      `  xmlns:xsi="${XSI_NS}"`,
      `  xmlns:flowable="${FLOWABLE_NS}"`,
      `  xmlns:bpmndi="${BPMNDI_NS}"`,
      `  xmlns:omgdc="${OMGDC_NS}"`,
      `  xmlns:omgdi="${OMGDI_NS}"`,
      `  targetNamespace="${FLOWABLE_NS}">`,
      '',
      `  <process id="${safeKey}" name="${safeName}" isExecutable="true">`,
      ...flowElements.map((el) => `    ${el}`),
      `  </process>`,
      '',
      `  <bpmndi:BPMNDiagram id="BPMNDiagram_${safeKey}">`,
      `    <bpmndi:BPMNPlane id="BPMNPlane_${safeKey}" bpmnElement="${safeKey}">`,
      ...shapes.map((s) => `      ${s}`),
      ...diEdges.map((e) => `      ${e}`),
      `    </bpmndi:BPMNPlane>`,
      `  </bpmndi:BPMNDiagram>`,
      `</definitions>`,
    ].join('\n');

    // Validate output is parseable XML
    try {
      const parser = createParser();
      parser.parse(xml);
    } catch (err: any) {
      throw new Error(`Generated BPMN XML is not valid XML: ${err.message}`);
    }

    return xml;
  }

  // ============================================================
  // Private: XML parsing helpers
  // ============================================================

  /** Get the local name of a namespaced key (e.g. "flowable:taskListener" → "taskListener"). */
  private localName(key: string): string {
    const colon = key.indexOf(':');
    return colon >= 0 ? key.slice(colon + 1) : key;
  }

  /** Find a child element by local tag name. Single-element arrays are unwrapped. */
  private findByLocalName(parent: any, localName: string): any | null {
    for (const key of Object.keys(parent)) {
      if (key.startsWith('@_') || key === '#text') continue;
      if (this.localName(key) === localName) {
        const val = parent[key];
        return Array.isArray(val) && val.length === 1 ? val[0] : val;
      }
    }
    return null;
  }

  /** Find all children by local tag name. */
  private findAllByLocalName(parent: any, localName: string): any[] {
    for (const key of Object.keys(parent)) {
      if (key.startsWith('@_') || key === '#text') continue;
      if (this.localName(key) === localName) {
        const val = parent[key];
        return Array.isArray(val) ? val : [val];
      }
    }
    return [];
  }

  /** Determine the BPMN element tag name from its parsed object. */
  private tagNameOf(el: any): string {
    for (const key of Object.keys(el)) {
      if (key.startsWith('@_') || key === '#text') continue;
      return this.localName(key);
    }
    return '';
  }

  // ============================================================
  // Private: BPMN DI parsing
  // ============================================================

  private parseBpmnShapes(diagram: any): Map<string, BpmnShapeInfo> {
    const map = new Map<string, BpmnShapeInfo>();
    if (!diagram) return map;

    const plane = this.findByLocalName(diagram, 'BPMNPlane');
    if (!plane) return map;

    const shapes = this.findAllByLocalName(plane, 'BPMNShape');
    for (const shape of shapes) {
      const bpmnElement = shape['@_bpmnElement'];
      if (!bpmnElement) continue;

      const bounds = this.findByLocalName(shape, 'Bounds');
      if (!bounds) continue;

      const x = parseFloat(bounds['@_x'] ?? '0');
      const y = parseFloat(bounds['@_y'] ?? '0');
      const width = parseFloat(bounds['@_width'] ?? '100');
      const height = parseFloat(bounds['@_height'] ?? '60');

      map.set(String(bpmnElement), { bpmnElement: String(bpmnElement), x, y, width, height });
    }
    return map;
  }

  // ============================================================
  // Private: Flowable extension extraction (XML → LF)
  // ============================================================

  private extractFlowableProperties(el: any, tagName: string): Record<string, unknown> {
    const props: Record<string, unknown> = {};

    // Direct Flowable attributes
    const directAttrs: [string, string][] = [
      ['flowable:assignee', 'assignee'],
      ['flowable:candidateGroups', 'candidateGroups'],
      ['flowable:formKey', 'formKey'],
      ['flowable:dueDate', 'dueDate'],
      ['flowable:priority', 'priority'],
      ['flowable:category', 'category'],
    ];

    for (const [attrKey, propKey] of directAttrs) {
      const val = el[`@_${attrKey}`];
      if (val !== undefined) props[propKey] = String(val);
    }

    // flowable:formFieldValidation → boolean
    const ffv = el['@_flowable:formFieldValidation'];
    if (ffv !== undefined) {
      props.formFieldValidation = String(ffv) === 'true';
    }

    // default flow reference (for gateways)
    const defaultFlow = el['@_default'];
    if (defaultFlow !== undefined) props.defaultFlow = String(defaultFlow);

    // Process extensionElements
    const extElements = this.findByLocalName(el, 'extensionElements');
    if (extElements) {
      this.extractTaskListeners(extElements, props);
      this.extractExecutionListeners(extElements, props);
      this.extractFormProperties(extElements, props);
    }

    // Script task: <script> CDATA + scriptFormat
    if (tagName === 'scriptTask') {
      const scriptFormat = el['@_scriptFormat'];
      if (scriptFormat) props.scriptFormat = String(scriptFormat);

      const scriptEl = this.findByLocalName(el, 'script');
      if (scriptEl) {
        // fast-xml-parser may wrap CDATA content in an array; handle both.
        const scriptItems = Array.isArray(scriptEl) ? scriptEl : [scriptEl];
        const text = scriptItems[0]?.['#text'];
        if (text !== undefined && text !== null) {
          props.script = typeof text === 'string' ? text.trim() : String(text);
        }
      }
    }

    // Service task attributes
    if (tagName === 'serviceTask') {
      const rv = el['@_flowable:resultVariable'];
      if (rv) props.resultVariable = String(rv);
      const fc = el['@_flowable:class'];
      if (fc) props.flowableClass = String(fc);
    }

    return props;
  }

  private extractTaskListeners(extElements: any, props: Record<string, unknown>): void {
    const listeners = this.findAllByLocalName(extElements, 'taskListener');
    if (listeners.length === 0) return;

    props.taskListener = listeners.map((tl: any) => {
      const item: Record<string, string | undefined> = {
        event: tl['@_event'] || 'create',
        delegateExpression: tl['@_delegateExpression'],
        class: tl['@_class'],
        expression: tl['@_expression'],
      };
      // Remove undefined fields
      const clean: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(item)) {
        if (v !== undefined) clean[k] = v;
      }
      return clean;
    });
  }

  private extractExecutionListeners(extElements: any, props: Record<string, unknown>): void {
    const listeners = this.findAllByLocalName(extElements, 'executionListener');
    if (listeners.length === 0) return;

    props.executionListener = listeners.map((elr: any) => {
      const item: Record<string, string | undefined> = {
        event: elr['@_event'] || 'start',
        delegateExpression: elr['@_delegateExpression'],
        class: elr['@_class'],
        expression: elr['@_expression'],
      };
      const clean: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(item)) {
        if (v !== undefined) clean[k] = v;
      }
      return clean;
    });
  }

  private extractFormProperties(extElements: any, props: Record<string, unknown>): void {
    const formProps = this.findAllByLocalName(extElements, 'formProperty');
    if (formProps.length === 0) return;

    props.formProperty = formProps.map((fp: any) => {
      const item: Record<string, string | undefined> = {
        id: fp['@_id'] || '',
        name: fp['@_name'],
        type: fp['@_type'],
        value: fp['@_value'],
        variable: fp['@_variable'],
      };
      const clean: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(item)) {
        if (v !== undefined) clean[k] = v;
      }
      return clean;
    });
  }

  // ============================================================
  // Private: LF → BPMN element builders
  // ============================================================

  private lfTypeToBpmn(type: string): string | undefined {
    return LF_TO_BPMN_TYPE[type];
  }

  private buildBpmnNodeElement(node: LfNode, bpmnType: string): string {
    const attrs: string[] = [];
    attrs.push(`id="${xmlEscape(node.id)}"`);

    const name = (node.properties?.name as string) ||
      node.text?.value ||
      node.id;
    if (name) {
      attrs.push(`name="${xmlEscape(name)}"`);
    }

    // Flowable extension attributes
    this.addAttrIf(attrs, 'flowable:assignee', node.properties?.assignee as string | undefined);
    this.addAttrIf(attrs, 'flowable:candidateGroups', node.properties?.candidateGroups as string | undefined);
    this.addAttrIf(attrs, 'flowable:formKey', node.properties?.formKey as string | undefined);
    this.addAttrIf(attrs, 'flowable:dueDate', node.properties?.dueDate as string | undefined);
    this.addAttrIf(attrs, 'flowable:priority', node.properties?.priority as string | undefined);
    this.addAttrIf(attrs, 'flowable:category', node.properties?.category as string | undefined);

    if (node.properties?.formFieldValidation === true) {
      attrs.push('flowable:formFieldValidation="true"');
    }

    if (node.properties?.defaultFlow) {
      attrs.push(`default="${xmlEscape(String(node.properties.defaultFlow))}"`);
    }

    // Script format
    if (bpmnType === 'scriptTask') {
      const fmt = node.properties?.scriptFormat as string || 'groovy';
      attrs.push(`scriptFormat="${xmlEscape(fmt)}"`);
    }

    // Service task
    if (bpmnType === 'serviceTask') {
      if (node.properties?.resultVariable) {
        attrs.push(`flowable:resultVariable="${xmlEscape(String(node.properties.resultVariable))}"`);
      }
      if (node.properties?.flowableClass) {
        attrs.push(`flowable:class="${xmlEscape(String(node.properties.flowableClass))}"`);
      }
    }

    // Build extension elements and script body
    const extChildren = this.buildExtensionElements(node.properties);
    const scriptBody = (bpmnType === 'scriptTask' && node.properties?.script)
      ? this.buildScriptBody(String(node.properties.script))
      : null;

    if (extChildren.length === 0 && !scriptBody) {
      return `<${bpmnType} ${attrs.join(' ')}/>`;
    }

    const inner: string[] = [];

    if (extChildren.length > 0) {
      inner.push('    <extensionElements>');
      for (const child of extChildren) {
        inner.push(`      ${child}`);
      }
      inner.push('    </extensionElements>');
    }

    if (scriptBody) {
      inner.push(`    ${scriptBody}`);
    }

    return `<${bpmnType} ${attrs.join(' ')}>\n${inner.join('\n')}\n</${bpmnType}>`;
  }

  private addAttrIf(attrs: string[], attrName: string, value: string | undefined): void {
    if (value !== undefined && value !== null && value !== '') {
      attrs.push(`${attrName}="${xmlEscape(value)}"`);
    }
  }

  private buildExtensionElements(props: Record<string, unknown>): string[] {
    const children: string[] = [];

    const taskListeners = props.taskListener as any[] | undefined;
    if (taskListeners && Array.isArray(taskListeners)) {
      for (const tl of taskListeners) {
        const parts: string[] = [];
        parts.push(`event="${xmlEscape(tl.event || 'create')}"`);
        if (tl.delegateExpression) parts.push(`delegateExpression="${xmlEscape(tl.delegateExpression)}"`);
        if (tl.class) parts.push(`class="${xmlEscape(tl.class)}"`);
        if (tl.expression) parts.push(`expression="${xmlEscape(tl.expression)}"`);
        children.push(`<flowable:taskListener ${parts.join(' ')}/>`);
      }
    }

    const execListeners = props.executionListener as any[] | undefined;
    if (execListeners && Array.isArray(execListeners)) {
      for (const elr of execListeners) {
        const parts: string[] = [];
        parts.push(`event="${xmlEscape(elr.event || 'start')}"`);
        if (elr.delegateExpression) parts.push(`delegateExpression="${xmlEscape(elr.delegateExpression)}"`);
        if (elr.class) parts.push(`class="${xmlEscape(elr.class)}"`);
        if (elr.expression) parts.push(`expression="${xmlEscape(elr.expression)}"`);
        children.push(`<flowable:executionListener ${parts.join(' ')}/>`);
      }
    }

    const formProperties = props.formProperty as any[] | undefined;
    if (formProperties && Array.isArray(formProperties)) {
      for (const fp of formProperties) {
        const parts: string[] = [];
        parts.push(`id="${xmlEscape(fp.id || '')}"`);
        if (fp.name) parts.push(`name="${xmlEscape(fp.name)}"`);
        if (fp.type) parts.push(`type="${xmlEscape(fp.type)}"`);
        if (fp.value) parts.push(`value="${xmlEscape(fp.value)}"`);
        if (fp.variable) parts.push(`variable="${xmlEscape(fp.variable)}"`);
        children.push(`<flowable:formProperty ${parts.join(' ')}/>`);
      }
    }

    return children;
  }

  private buildScriptBody(script: string): string {
    const isMultiline = script.includes('\n');
    if (isMultiline) {
      return `<script><![CDATA[${script}]]></script>`;
    }
    return `<script>${xmlEscape(script)}</script>`;
  }

  private buildSequenceFlowElement(edge: LfEdge): string {
    const attrs: string[] = [];
    attrs.push(`id="${xmlEscape(edge.id)}"`);
    attrs.push(`sourceRef="${xmlEscape(edge.sourceNodeId)}"`);
    attrs.push(`targetRef="${xmlEscape(edge.targetNodeId)}"`);

    const name = (edge.properties?.name as string) || edge.text?.value;
    if (name) {
      attrs.push(`name="${xmlEscape(name)}"`);
    }

    const condition = edge.properties?.condition as string | undefined;
    if (!condition) {
      return `<sequenceFlow ${attrs.join(' ')}/>`;
    }

    return (
      `<sequenceFlow ${attrs.join(' ')}>\n` +
      `  <conditionExpression xsi:type="tFormalExpression">${xmlEscape(condition)}</conditionExpression>\n` +
      `</sequenceFlow>`
    );
  }

  // ============================================================
  // Private: BPMN DI generation
  // ============================================================

  private buildBpmnShape(node: LfNode, bpmnType: string): string {
    const x = node.x;
    const y = node.y;
    const nodeW = (node as any).width as number | undefined;
    const nodeH = (node as any).height as number | undefined;

    let shapeW: number;
    let shapeH: number;

    switch (node.type) {
      case 'start-event':
      case 'end-event':
        shapeW = 36;
        shapeH = 36;
        break;
      case 'exclusive-gateway':
      case 'parallel-gateway':
      case 'inclusive-gateway':
        shapeW = 50;
        shapeH = 50;
        break;
      case 'user-task':
      case 'script-task':
      case 'service-task':
        shapeW = (nodeW && nodeW > 0) ? nodeW : 80;
        shapeH = (nodeH && nodeH > 0) ? nodeH : 60;
        break;
      default:
        shapeW = (nodeW && nodeW > 0) ? nodeW : 100;
        shapeH = (nodeH && nodeH > 0) ? nodeH : 60;
    }

    const labelText = (node.properties?.name as string) || node.text?.value || '';

    const lines: string[] = [];
    lines.push(`<bpmndi:BPMNShape id="shape_${xmlEscape(node.id)}" bpmnElement="${xmlEscape(node.id)}">`);
    lines.push(`  <omgdc:Bounds x="${x}" y="${y}" width="${shapeW}" height="${shapeH}"/>`);
    if (labelText) {
      lines.push(`  <bpmndi:BPMNLabel>`);
      lines.push(`    <omgdc:Bounds x="${x}" y="${y + shapeH + 4}" width="80" height="14"/>`);
      lines.push(`  </bpmndi:BPMNLabel>`);
    }
    lines.push(`</bpmndi:BPMNShape>`);
    return lines.join('\n');
  }

  private buildBpmnEdge(edge: LfEdge, nodesById: Map<string, LfNode>): string {
    const src = nodesById.get(edge.sourceNodeId);
    const tgt = nodesById.get(edge.targetNodeId);

    let waypoints: { x: number; y: number }[];

    if (src && tgt) {
      const srcW = (src as any).width ?? 36;
      const srcH = (src as any).height ?? 36;
      const tgtW = (tgt as any).width ?? 36;
      const tgtH = (tgt as any).height ?? 36;

      const srcCX = Math.round(src.x + srcW / 2);
      const srcCY = Math.round(src.y + srcH);
      const tgtCX = Math.round(tgt.x + tgtW / 2);
      const tgtCY = Math.round(tgt.y);

      // If target is above source, draw from source top to target bottom
      if (tgt.y < src.y) {
        waypoints = [
          { x: srcCX, y: src.y },
          { x: tgtCX, y: tgt.y + tgtH },
        ];
      } else {
        waypoints = [
          { x: srcCX, y: srcCY },
          { x: tgtCX, y: tgtCY },
        ];
      }
    } else {
      waypoints = [
        { x: 100, y: 100 },
        { x: 200, y: 200 },
      ];
    }

    const lines: string[] = [];
    lines.push(`<bpmndi:BPMNEdge id="edge_${xmlEscape(edge.id)}" bpmnElement="${xmlEscape(edge.id)}">`);
    for (const wp of waypoints) {
      lines.push(`  <omgdi:waypoint x="${wp.x}" y="${wp.y}"/>`);
    }
    if (edge.text?.value) {
      const midX = Math.round((waypoints[0].x + waypoints[waypoints.length - 1].x) / 2);
      const midY = Math.round((waypoints[0].y + waypoints[waypoints.length - 1].y) / 2) - 16;
      lines.push(`  <bpmndi:BPMNLabel>`);
      lines.push(`    <omgdc:Bounds x="${midX}" y="${midY}" width="60" height="14"/>`);
      lines.push(`  </bpmndi:BPMNLabel>`);
    }
    lines.push(`</bpmndi:BPMNEdge>`);
    return lines.join('\n');
  }
}
