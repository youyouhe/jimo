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
        'boolean', 'timestamp', 'uuid', 'image', 'file', 'relation', 'dict', 'point',
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
    relationType: { type: 'string', enum: ['many-to-one', 'one-to-many'] },
    relationTable: { type: 'string', description: '目标表 snake_case' },
    relationDisplayField: { type: 'string' },
    // one-to-many: 'new' 新建子表（默认）; 'existing' 挂载已有表作为子表
    detailMode: { type: 'string', enum: ['new', 'existing'] },
    // one-to-many + existing: 目标已有表的 snake_case 名称（不含 lc_ 前缀）
    relationExistingTable: { type: 'boolean', description: 'detailMode=existing 时设为 true' },
    // one-to-many + existing: 已有子表上指向当前主表的 FK 列名（snake_case）
    relationFkColumn: { type: 'string', description: '已有子表上的 FK 列名，如 student_id' },
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
              'boolean', 'timestamp', 'uuid', 'image', 'file', 'relation', 'dict', 'point',
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
          relationType: { type: 'string', enum: ['many-to-one', 'one-to-many'] },
          relationTable: { type: 'string' },
          relationDisplayField: { type: 'string' },
          dictType: { type: 'string' },
        },
        required: ['name', 'type', 'required', 'unique', 'description'],
      },
    },
    // dict 字段
    dictType: { type: 'string', description: '字典类型 key' },
    // point 字段
    geoConfig: {
      type: 'object',
      description: 'GIS 字段配置，仅 point 类型使用',
      properties: {
        coordinateSystem: {
          type: 'string',
          description: '坐标系，默认 WGS84',
          enum: ['WGS84', 'GCJ02'],
        },
        mapProvider: {
          type: 'string',
          description: '地图库，默认 leaflet',
          enum: ['leaflet', 'amap'],
        },
      },
    },
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
        approvalFlow: {
          type: 'object',
          description: '审批流配置（可选）。enabled=true 时生成的表自动写入审批链配置(sys_approval_flows)+前端带「提交审批」按钮。用户提交审批后按 defaultChain 逐级流转，审批人由 BPM 按组织动态解析。仅当用户明确要求审批流时设置。',
          properties: {
            enabled: { type: 'boolean', description: '是否启用，默认 false' },
            defaultChain: {
              type: 'array',
              items: { type: 'string' },
              description: '审批链规则名数组。可选值：deptHead(发起人部门负责人)、divHead(分管领导)、ceo(总裁/首席执行官)、deptFinance(财务负责人D003)、legalReview(法务负责人D002)。如 ["deptHead"] 或 ["deptHead","ceo"]',
            },
          },
        },
        visibilityStrategy: {
          type: 'string',
          enum: ['private', 'department', 'shared', 'public'],
          description:
            "数据可见性策略（可选，默认 private）。private=仅 owner；department=owner 所在部门含子部门；shared=owner+显式 shared_with（仅此模式查 shared_with）；public=所有登录用户。admin 永远旁路。用户未指定则不设。",
        },
        agentConfig: {
          type: 'object',
          description: '实体伴随agent配置(可选)',
          properties: {
            enabled: { type: 'boolean', description: '是否启用agent,默认false' },
            tools: {
              type: 'array',
              items: { type: 'string', enum: ['query', 'create', 'update', 'delete', 'search', 'mock'] },
            },
            systemPrompt: { type: 'string', description: 'agent自定义系统提示词' },
          },
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
      '创建新的模板包（Package）。⚠️ 默认不要调用：Package 是对一类业务表的归集容器（菜单父节点），强调兼容性/包容性，应能容纳多张相关表。用户没明确要求建 Package 时，propose_entity 的 packageId 留空即可（表落入「未分类」）。绝不为单张表创建同名 Package（建 students 表不要建「学生」Package）。只有用户明确要求归类、且现有 Package 都不匹配时才调用，命名要体现业务线包容性。调用前先用 list_packages 确认同名不存在。创建成功后返回 packageId。',
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
      '查询系统中现有的 Package 列表（id + name）。在关联 package 前调用，按名称匹配。注意：默认不创建 Package，只有用户明确要求归类且现有都不匹配时才考虑 create_package。',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
};

export const GENERATE_MOCK_TOOL = {
  type: 'function' as const,
  function: {
    name: 'generate_mock',
    description:
      '为已生成的实体表插入 mock 测试数据。表必须已通过 propose_entity 确认并生成代码后才可调用。count 默认 10，最大 100。',
    parameters: {
      type: 'object',
      properties: {
        tableName: {
          type: 'string',
          description: '目标表名（snake_case，不含 lc_ 前缀），如 employees',
        },
        count: {
          type: 'number',
          description: '插入条数，默认 10，最大 100',
        },
      },
      required: ['tableName'],
    },
  },
};

export const LIST_HISTORY_TOOL = {
  type: 'function' as const,
  function: {
    name: 'list_history',
    description:
      '查询最近生成的实体表历史记录，返回 id、tableName、changeLog、operation、createdAt。用于找到需要删除的记录的 id。',
    parameters: {
      type: 'object',
      properties: {
        tableName: {
          type: 'string',
          description: '按表名过滤（可选，模糊匹配）',
        },
        limit: {
          type: 'number',
          description: '返回条数，默认 20，最大 50',
        },
      },
      required: [],
    },
  },
};

export const DELETE_ENTITY_TOOL = {
  type: 'function' as const,
  function: {
    name: 'delete_entity',
    description:
      '删除一条代码生成历史记录及其所有生成物（代码文件、数据库表、菜单注册）。调用前必须先用 list_history 确认 id。此操作不可逆，仅用于撤销错误建表。',
    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: '历史记录 UUID，从 list_history 结果中获取',
        },
        cascade: {
          type: 'boolean',
          description: '是否级联删除引用该表的外键表，默认 false',
        },
      },
      required: ['id'],
    },
  },
};

export const LIST_MENUS_BY_PACKAGE_TOOL = {
  type: 'function' as const,
  function: {
    name: 'list_menus_by_package',
    description:
      '查询所有 Package 及各自包含的实体表列表，用于了解当前菜单分类现状。返回 [{id, name, tables:[tableName,...]}]，id 为空表示未分类。',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
};

export const ASSIGN_TO_PACKAGE_TOOL = {
  type: 'function' as const,
  function: {
    name: 'assign_to_package',
    description:
      '将一张已生成的实体表重新归属到指定 Package（同时更新菜单父节点和历史记录）。调用前先用 list_menus_by_package 确认 packageId。',
    parameters: {
      type: 'object',
      properties: {
        tableName: {
          type: 'string',
          description: '要移动的实体表名（snake_case，不含 lc_ 前缀）',
        },
        packageId: {
          type: 'string',
          description: '目标 Package 的 UUID，从 list_menus_by_package 或 list_packages 结果中获取',
        },
      },
      required: ['tableName', 'packageId'],
    },
  },
};

export const DESCRIBE_TABLE_TOOL = {
  type: 'function' as const,
  function: {
    name: 'describe_table',
    description:
      '查询一张已生成实体表的完整字段结构（AutoCodeField[]），包含字段名、类型、说明、relation/dict 配置等。在需要了解已有表结构、建立关联关系或扩展已有表时调用。tableName 不含 lc_ 前缀。',
    parameters: {
      type: 'object',
      properties: {
        tableName: {
          type: 'string',
          description: '目标表名（snake_case，不含 lc_ 前缀），如 companies',
        },
      },
      required: ['tableName'],
    },
  },
};

export const LIST_BTN_PERMS_TOOL = {
  type: 'function' as const,
  function: {
    name: 'list_btn_perms',
    description:
      '查询一张已生成业务表当前拥有的所有按钮（系统按钮 + 自定义按钮），以及每个按钮已授权的角色 id 列表。在 add_custom_btn 前调用，确认按钮名不重复。tableName 不含 lc_ 前缀。',
    parameters: {
      type: 'object',
      properties: {
        tableName: {
          type: 'string',
          description: '目标表名（snake_case，不含 lc_ 前缀），如 contracts',
        },
      },
      required: ['tableName'],
    },
  },
};

export const ADD_CUSTOM_BTN_TOOL = {
  type: 'function' as const,
  function: {
    name: 'add_custom_btn',
    description:
      '为已生成的业务表在操作列添加一个自定义导航按钮。点击后跳转到目标表列表页并通过 ?id= 参数自动弹出对应记录。调用前先用 list_btn_perms 确认按钮名不重复，用 list_tables 确认 targetTable 存在。',
    parameters: {
      type: 'object',
      properties: {
        tableName: {
          type: 'string',
          description: '要添加按钮的业务表名（不含 lc_ 前缀），如 contracts',
        },
        btnName: {
          type: 'string',
          description: '按钮唯一标识（snake_case），如 view_party_a',
        },
        label: {
          type: 'string',
          description: '按钮显示文字（中文），如 查看甲方',
        },
        targetTable: {
          type: 'string',
          description: '点击后跳转到的目标表名（不含 lc_ 前缀），如 companies',
        },
        sourceField: {
          type: 'string',
          description: '本表上存储目标记录 id 的字段名（snake_case），如 party_a_id',
        },
        roles: {
          type: 'array',
          items: { type: 'string', enum: ['super_admin', 'admin', 'editor', 'viewer'] },
          description: '授权可见此按钮的角色 code 列表，如 ["editor","admin"]',
        },
      },
      required: ['tableName', 'btnName', 'label', 'targetTable', 'sourceField', 'roles'],
    },
  },
};

export const REMOVE_CUSTOM_BTN_TOOL = {
  type: 'function' as const,
  function: {
    name: 'remove_custom_btn',
    description:
      '删除一张业务表上的自定义按钮及其所有角色授权。系统内置按钮（edit/delete/add/query 等）无法通过此接口删除。调用前先用 list_btn_perms 确认按钮存在且 isCustom=true。',
    parameters: {
      type: 'object',
      properties: {
        tableName: {
          type: 'string',
          description: '目标表名（不含 lc_ 前缀）',
        },
        btnName: {
          type: 'string',
          description: '要删除的按钮名称',
        },
      },
      required: ['tableName', 'btnName'],
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
  GENERATE_MOCK_TOOL,
  LIST_HISTORY_TOOL,
  DELETE_ENTITY_TOOL,
  LIST_MENUS_BY_PACKAGE_TOOL,
  ASSIGN_TO_PACKAGE_TOOL,
  DESCRIBE_TABLE_TOOL,
  LIST_BTN_PERMS_TOOL,
  ADD_CUSTOM_BTN_TOOL,
  REMOVE_CUSTOM_BTN_TOOL,
];
