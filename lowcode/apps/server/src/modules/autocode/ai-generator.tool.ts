/**
 * propose_entity function-calling 工具定义。
 * arguments schema 与 AutoCodeDto 对齐,AI 产出的 JSON 可直接用于 POST /autocode/generate。
 */
export const PROPOSE_ENTITY_TOOL = {
  type: 'function' as const,
  function: {
    name: 'propose_entity',
    description:
      '提议一个实体表的完整定义(AutoCodeDto)。用户确认后系统会据此生成全栈代码(schema/dto/service/controller/module/前端)。',
    parameters: {
      type: 'object',
      properties: {
        tableName: {
          type: 'string',
          description: '表名,snake_case 复数,如 employees / orders / order_details',
        },
        description: {
          type: 'string',
          description: '中文表说明',
        },
        packageId: {
          type: 'string',
          description: '模板包 UUID(可选,通过 create_package 工具获取或从现有 Package 列表匹配)',
        },
        generateWeb: {
          type: 'boolean',
          description: '是否同时生成前端页面,默认 true',
        },
        fields: {
          type: 'array',
          description: '字段定义数组。不要含 id / created_at / updated_at 等系统字段。',
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
              detailFields: {
                type: 'array',
                description: 'one-to-many 子表字段定义(结构同 field,不含 id)',
                items: { type: 'object' },
              },
              // dict 字段
              dictType: { type: 'string' },
            },
            required: ['name', 'type', 'required', 'unique', 'description'],
          },
        },
      },
      required: ['tableName', 'description', 'fields'],
    },
  },
};

/**
 * create_dict — 创建系统字典(大类+明细项)。
 * 当需要的 dict 类型在现有列表中不存在时,AI 先调此工具创建字典,
 * 再用 propose_entity 引用刚创建的 dictType。
 */
export const CREATE_DICT_TOOL = {
  type: 'function' as const,
  function: {
    name: 'create_dict',
    description:
      '创建系统字典(大类+明细项)。当需要的字典类型在系统中不存在时调用。创建成功后返回 dictType,可在 propose_entity 中引用。',
    parameters: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          description: '字典类型 key(snake_case 英文),如 gender、employee_status',
        },
        name: {
          type: 'string',
          description: '字典显示名称,如 性别、在职状态',
        },
        items: {
          type: 'array',
          description: '字典明细项列表',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string', description: '项显示名,如 男' },
              value: { type: 'string', description: '项值,如 male' },
            },
            required: ['label', 'value'],
          },
        },
      },
      required: ['type', 'name', 'items'],
    },
  },
};

/**
 * create_package — 创建模板包(Package)。
 * 当用户指定了 package 名称但系统中不存在匹配项时,AI 先调此工具创建,
 * 再用 propose_entity 引用新创建的 packageId。
 */
export const CREATE_PACKAGE_TOOL = {
  type: 'function' as const,
  function: {
    name: 'create_package',
    description:
      '创建新的模板包(Package)。当用户在提示词中指定了 package 名称但系统中不存在匹配的 package 时调用。创建成功后返回 packageId 和 name,可在后续 propose_entity 中引用。',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Package 名称(中文,如 电商系统、用户中心)' },
        description: { type: 'string', description: 'Package 描述(可选)' },
      },
      required: ['name'],
    },
  },
};

export const ALL_TOOLS = [PROPOSE_ENTITY_TOOL, CREATE_DICT_TOOL, CREATE_PACKAGE_TOOL];
