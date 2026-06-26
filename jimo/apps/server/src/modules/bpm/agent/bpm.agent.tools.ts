import { ConfigService } from '@nestjs/config';

export type LfNode = {
  id: string;
  type: string;
  x: number;
  y: number;
  text?: { value: string } | string;
  properties?: Record<string, unknown>;
};

export type LfEdge = {
  id: string;
  type: string;
  sourceNodeId: string;
  targetNodeId: string;
  text?: { value: string } | string;
  properties?: Record<string, unknown>;
};

export type LfGraphData = {
  nodes: LfNode[];
  edges: LfEdge[];
};

function makeId(): string {
  return `node_${Math.random().toString(36).slice(2, 10)}`;
}

function edgeId(): string {
  return `edge_${Math.random().toString(36).slice(2, 10)}`;
}

function makeNode(
  type: string,
  x: number,
  y: number,
  label: string,
  properties: Record<string, unknown> = {},
): LfNode {
  return {
    id: makeId(),
    type,
    x,
    y,
    text: { value: label },
    properties,
  };
}

function makeEdge(
  sourceNodeId: string,
  targetNodeId: string,
  label = '',
  properties: Record<string, unknown> = {},
): LfEdge {
  return {
    id: edgeId(),
    type: 'bpmn:sequenceFlow',
    sourceNodeId,
    targetNodeId,
    ...(label ? { text: { value: label } } : {}),
    properties,
  };
}

/**
 * Build the 4 BPM agent tools.
 * config is only used by list_resolution_rules (for BPM_SERVICE_URL).
 */
export function buildBpmAgentTools(config: ConfigService): Record<string, any> {
  const bpmUrl = (config.get<string>('BPM_SERVICE_URL') || 'http://localhost:8090').replace(/\/$/, '');

  return {
    get_canvas_state: {
      description: '获取当前画布状态，返回所有节点和边的列表',
      parameters: {
        type: 'object',
        properties: {
          lfJson: {
            type: 'object',
            description: '当前LogicFlow画布JSON',
            properties: {
              nodes: { type: 'array', items: { type: 'object' } },
              edges: { type: 'array', items: { type: 'object' } },
            },
          },
        },
      },
      execute: async (args: { lfJson?: LfGraphData }) => {
        const graph = args.lfJson ?? { nodes: [], edges: [] };
        const nodes = (graph.nodes ?? []).map((n: LfNode) => {
          const label =
            typeof n.text === 'string'
              ? n.text
              : n.text?.value ?? '';
          return { id: n.id, type: n.type, label, x: n.x, y: n.y };
        });
        const edges = (graph.edges ?? []).map((e: LfEdge) => ({
          id: e.id,
          source: e.sourceNodeId,
          target: e.targetNodeId,
        }));
        return {
          nodeCount: nodes.length,
          edgeCount: edges.length,
          nodes,
          edges,
        };
      },
    },

    generate_approval_chain: {
      description:
        '根据描述生成完整的N级串行审批链流程，自动创建所有节点和连线',
      parameters: {
        type: 'object',
        properties: {
          steps: {
            type: 'array',
            description: '审批步骤列表',
            items: {
              type: 'object',
              properties: {
                label: { type: 'string', description: '审批步骤名称' },
                assigneeRule: {
                  type: 'string',
                  description: '审批人规则名，如deptHead/ceo/deptFinance',
                },
              },
              required: ['label', 'assigneeRule'],
            },
          },
          processName: { type: 'string', description: '流程名称' },
        },
        required: ['steps', 'processName'],
      },
      execute: async (args: {
        steps: Array<{ label: string; assigneeRule: string }>;
        processName: string;
      }) => {
        const { steps, processName } = args;
        const cx = 200;

        const nodes: LfNode[] = [];
        const edges: LfEdge[] = [];

        // Start event
        const startNode = makeNode('bpmn:startEvent', cx, 100, '开始');
        nodes.push(startNode);

        // Script task: parse assignee rules
        const scriptNode = makeNode('bpmn:scriptTask', cx, 220, '解析审批规则', {
          script: 'execution.setVariable("approvalResolved", true)',
          scriptFormat: 'groovy',
        });
        nodes.push(scriptNode);
        edges.push(makeEdge(startNode.id, scriptNode.id));

        // User tasks for each approval step
        let prevNodeId = scriptNode.id;
        const userTaskNodes: LfNode[] = [];
        steps.forEach((step, i) => {
          const y = 340 + 120 * i;
          const userTask = makeNode('bpmn:userTask', cx, y, step.label, {
            name: step.label,
            assigneeRule: step.assigneeRule,
            taskListener: 'dynamicAssigneeListener',
          });
          nodes.push(userTask);
          userTaskNodes.push(userTask);
          edges.push(makeEdge(prevNodeId, userTask.id));
          prevNodeId = userTask.id;
        });

        const gwY = 340 + 120 * steps.length;
        const gw2Y = 480 + 120 * steps.length;

        // ExclusiveGateway: approval result
        const gwResult = makeNode(
          'bpmn:exclusiveGateway',
          cx,
          gwY,
          '审批结果',
        );
        nodes.push(gwResult);
        edges.push(makeEdge(prevNodeId, gwResult.id));

        // End event: rejected
        const endRejected = makeNode(
          'bpmn:endEvent',
          cx + 250,
          gwY,
          '已驳回',
        );
        nodes.push(endRejected);
        edges.push(
          makeEdge(gwResult.id, endRejected.id, '驳回', {
            conditionExpression: '${approved == false}',
          }),
        );

        // ExclusiveGateway: has next step
        const gwNext = makeNode(
          'bpmn:exclusiveGateway',
          cx,
          gw2Y,
          '是否有下一步',
        );
        nodes.push(gwNext);
        edges.push(
          makeEdge(gwResult.id, gwNext.id, '通过', {
            conditionExpression: '${approved == true}',
          }),
        );

        // End event: approved
        const endApproved = makeNode(
          'bpmn:endEvent',
          cx,
          gw2Y + 120,
          '已通过',
        );
        nodes.push(endApproved);
        edges.push(
          makeEdge(gwNext.id, endApproved.id, '结束', {
            conditionExpression: '${hasNextStep == false}',
          }),
        );

        const generatedGraph: LfGraphData = { nodes, edges };

        return {
          type: 'canvas_update',
          lfJson: generatedGraph,
          message: `已生成 ${steps.length} 级串行审批链：${processName}`,
        };
      },
    },

    add_node: {
      description: '在画布上添加一个BPMN节点',
      parameters: {
        type: 'object',
        properties: {
          lfJson: {
            type: 'object',
            description: '当前画布JSON（含nodes和edges数组）',
            properties: {
              nodes: { type: 'array', items: { type: 'object' } },
              edges: { type: 'array', items: { type: 'object' } },
            },
          },
          type: {
            type: 'string',
            enum: [
              'bpmn:startEvent',
              'bpmn:endEvent',
              'bpmn:userTask',
              'bpmn:scriptTask',
              'bpmn:exclusiveGateway',
              'bpmn:parallelGateway',
            ],
            description: 'BPMN节点类型',
          },
          x: { type: 'number', description: '节点X坐标' },
          y: { type: 'number', description: '节点Y坐标' },
          properties: {
            type: 'object',
            description: '节点属性',
            properties: {
              name: { type: 'string', description: '节点名称/标签' },
              assigneeRule: {
                type: 'string',
                description: '审批人规则（UserTask专用）',
              },
            },
            required: ['name'],
          },
        },
        required: ['type', 'x', 'y', 'properties'],
      },
      execute: async (args: {
        lfJson?: LfGraphData;
        type: string;
        x: number;
        y: number;
        properties: { name: string; assigneeRule?: string };
      }) => {
        const current = args.lfJson ?? { nodes: [], edges: [] };
        const nodeProps: Record<string, unknown> = {};
        if (args.properties.assigneeRule) {
          nodeProps.assigneeRule = args.properties.assigneeRule;
          nodeProps.taskListener = 'dynamicAssigneeListener';
        }
        const newNode = makeNode(
          args.type,
          args.x,
          args.y,
          args.properties.name,
          nodeProps,
        );
        const updatedGraph: LfGraphData = {
          nodes: [...(current.nodes ?? []), newNode],
          edges: current.edges ?? [],
        };
        return {
          type: 'canvas_update',
          lfJson: updatedGraph,
          message: `已添加节点: ${args.properties.name} (${args.type})`,
        };
      },
    },

    list_resolution_rules: {
      description:
        '列出所有可用的审批人解析规则，供配置UserTask的assigneeRule时参考',
      parameters: {
        type: 'object',
        properties: {},
      },
      execute: async () => {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 5000);
        try {
          const res = await fetch(`${bpmUrl}/bpm/api/dict/rules`, {
            signal: ctrl.signal,
            headers: { 'x-user-id': 'system' },
          });
          clearTimeout(timer);
          if (!res.ok) {
            return {
              rules: [
                { name: 'deptHead', label: '部门负责人' },
                { name: 'ceo', label: '总裁' },
                { name: 'deptFinance', label: '财务总监' },
              ],
              note: 'BPM服务未响应，返回默认规则列表',
            };
          }
          const data = await res.json().catch(() => null);
          return data ?? { rules: [], note: '无法解析响应' };
        } catch {
          clearTimeout(timer);
          return {
            rules: [
              { name: 'deptHead', label: '部门负责人' },
              { name: 'ceo', label: '总裁' },
              { name: 'deptFinance', label: '财务总监' },
            ],
            note: 'BPM服务不可达，返回默认规则列表',
          };
        }
      },
    },
  };
}
