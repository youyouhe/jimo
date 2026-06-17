/**
 * AI 实体生成器 tool 定义。
 * arguments schema 与 AutoCodeDto 对齐，AI 产出的 JSON 可直接用于 POST /autocode/generate。
 */

/** 单个字段的 JSON Schema（用于 fields[] 和 detailFields[] 复用） */
const FIELD_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'snake_case 字段名' },
    type: {
      type: 'string',
      enum: [
        'varchar', 'text', 'integer', 'bigint', 'decimal',
        'boolean', 'timestamp', 'uuid', 'image', 'file', 'relation', 'dict',
      ],
    },
    length: { type: 'number', description: 'varchar 长度(可选)' },
    required: { type: 'boolean' },
    unique: { type: 'boolean' },
    description: { type: 'string', description: '中文说明' },
    searchable: { type: 'boolean' },
    listable: { type: 'boolean' },
    creatable: { type: 'boolean' },
    editable: { type: 'boolean' },
    // relation 字段
    relationType: { type: 'string', enum: ['many-to-one', 'many-to-many', 'one-to-many'] },
    relationTable: { type: 'string', description: '目标表 snake_case' },
    relationDisplayField: { type: 'string' },
    // one-to-many 子表字段（子子表，第三层）
    detailFields: {
      type: 'array',
      description: 'one-to-many 孙子表字段（第三层），结构同父级字段，不含 id',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'snake_case 字段名' },
          type: {
            type: 'string',
            enum: [
              'varchar', 'text', 'integer', 'bigint', 'decimal',
              'boolean', 'timestamp', 'uuid', 'image', 'file', 'relation', 'dict',
            ],
          },
          length: { type: 'number' },
          required: { type: 'boolean' },
          unique: { type: 'boolean' },
          description: { type: 'string' },
          searchable: { type: 'boolean' },
          listable: { type: 'boolean' },
          creatable: { type: 'boolean' },
          editable: { type: 'boolean' },
          relationType: { type: 'string', enum: ['many-to-one', 'many-to-many', 'one-to-many'] },
          relationTable: { type: 'string' },
          relationDisplayField: { type: 'string' },
          dictType: { type: 'string' },
        },
        required: ['name', 'type', 'required', 'unique', 'description'],
      },
    },
    // dict 字段
    dictType: { type: 'string', description: '字典类型 key' },
  },
  required: ['name', 'type', 'required', 'unique', 'description'],
};

export const PROPOSE_ENTITY_TOOL = {
  type: 'function' as const,
  function: {
    name: 'propose_entity',
    description:
      '提议一个实体表的完整定义(AutoCodeDto)。用户确认后系统会据此生成全栈代码。支持：独立表、主表+子表(1:N，fields 含 one-to-many 字段，子表字段放 detailFields)、主表+子表+孙子表(三层，子表字段的 detailFields 里再嵌 detailFields)。',
    parameters: {
      type: 'object',
      properties: {
        tableName: {
          type: 'string',
          description: '表名，snake_case 复数，如 orders / order_items',
        },
        description: {
          type: 'string',
          description: '中文表说明',
        },
        packageId: {
          type: 'string',
          description: '模板包 UUID（可选，通过 list_packages 查询或 create_package 创建后获取）',
        },
        generateWeb: {
          type: 'boolean',
          description: '是否同时生成前端页面，默认 true',
        },
        fields: {
          type: 'array',
          description: '字段定义数组。不要含 id / created_at / updated_at 等系统字段。one-to-many 字段的子表字段放 detailFields。',
          items: FIELD_SCHEMA,
        },
      },
      required: ['tableName', 'description', 'fields'],
    },
  },
};

export const CREATE_DICT_TOOL = {
  type: 'function' as const,
  function: {
    name: 'create_dict',
    description:
      '创建系统字典（大类+明细项）。调用前请先用 list_dicts 确认该类型不存在，避免重复创建。创建成功后返回 dictType，可在 propose_entity 中引用。',
    parameters: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          description: '字典类型 key（snake_case 英文），如 gender、employee_status',
        },
        name: {
          type: 'string',
          description: '字典显示名称，如 性别、在职状态',
        },
        items: {
          type: 'array',
          description: '字典明细项列表',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string', description: '项显示名，如 男' },
              value: { type: 'string', description: '项值，如 male' },
            },
            required: ['label', 'value'],
          },
        },
      },
      required: ['type', 'name', 'items'],
    },
  },
};

export const CREATE_PACKAGE_TOOL = {
  type: 'function' as const,
  function: {
    name: 'create_package',
    description:
      '创建新的模板包（Package）。调用前请先用 list_packages 确认同名 package 不存在。创建成功后返回 packageId，可在 propose_entity 中引用。',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Package 名称（如 电商系统、用户中心）' },
        description: { type: 'string', description: 'Package 描述（可选）' },
      },
      required: ['name'],
    },
  },
};

export const LIST_TABLES_TOOL = {
  type: 'function' as const,
  function: {
    name: 'list_tables',
    description:
      '查询系统中已生成的实体表列表（来自代码生成历史）。在 propose_entity 前调用，确认目标表是否已存在，已存在的表可直接被 relation 字段引用。',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
};

export const LIST_DICTS_TOOL = {
  type: 'function' as const,
  function: {
    name: 'list_dicts',
    description:
      '查询系统中现有的字典列表（type + name）。在使用 dict 字段前调用，优先匹配已有 dictType；只有在确认不存在时才调 create_dict。',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
};

export const LIST_PACKAGES_TOOL = {
  type: 'function' as const,
  function: {
    name: 'list_packages',
    description:
      '查询系统中现有的 Package 列表（id + name）。在关联 package 前调用，按名称匹配；只有在确认不存在时才调 create_package。',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
};

export const ALL_TOOLS = [
  PROPOSE_ENTITY_TOOL,
  CREATE_DICT_TOOL,
  CREATE_PACKAGE_TOOL,
  LIST_TABLES_TOOL,
  LIST_DICTS_TOOL,
  LIST_PACKAGES_TOOL,
];
