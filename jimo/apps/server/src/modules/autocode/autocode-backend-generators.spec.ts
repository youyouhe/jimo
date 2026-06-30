/**
 * L0+ — Generated *service* contract: relation-update guards.
 *
 * Locks the invariant the grid's per-cell auto-save relies on for relation-
 * bearing tables: a single-field PATCH must NOT wipe one-to-many children or
 * replace many-to-many relations. The generated `update()` guards every O2M/M2M
 * write behind `if (dto.<field> !== undefined)`, so a partial body (one changed
 * field) leaves relations untouched.
 *
 * We assert this on the generated source rather than against a live module
 * (there is no relation-bearing generated module in the repo) — the guard string
 * IS the contract.
 */
jest.mock('@faker-js/faker', () => {
  const callable = () => 'mock';
  const make = (): any => new Proxy(callable, { get: () => make(), apply: () => 'mock' });
  return { fakerZH_CN: make() };
});

import { generateService, generateSchema, generateCreateDto } from './autocode-backend-generators';
import { activeFields } from './autocode-field-utils';
import { generateServiceContractSpec, generateHttpContractSpec } from './autocode-test-generators';

describe('L0+ contract: generated update() guards relation writes', () => {
  const dto: any = {
    tableName: 'orders',
    description: '订单',
    generateWeb: true,
    pageType: 'list',
    fields: [
      { name: 'title', type: 'varchar', description: '标题', editable: true, creatable: true, required: true, length: 255 },
      {
        name: 'items',
        type: 'relation',
        description: '明细',
        relationType: 'one-to-many',
        relationTable: 'order_items',
        relationExistingTable: true,
        relationFkColumn: 'order_id',
        relationDisplayField: 'name',
        editable: true,
        creatable: true,
        detailFields: [
          { name: 'qty', type: 'integer', description: '数量', required: false },
          { name: 'price', type: 'decimal', description: '单价', required: false },
        ],
      },
    ],
  };

  it('one-to-many children are only rewritten when dto.items is explicitly provided', () => {
    const src = generateService(dto);
    // Without this guard, a per-cell PATCH (single field) would call updateItems
    // with undefined and wipe the children.
    expect(src).toMatch(/if \(dto\.items !== undefined\)/);
  });

  it('generated service source is well-formed (non-empty, has update method)', () => {
    const src = generateService(dto);
    expect(src).toContain('async update(');
    expect(src).toContain('class OrderService'); // pascalSingular + 'Service'
    expect(src.length).toBeGreaterThan(500);
  });
});

describe('unique → required normalization (bug-5 root-cause fix)', () => {
  // A unique column must carry a value; otherwise the generated partial unique
  // index collides on the empty default ('') once two non-deleted rows share it.
  // The generator must force required=true for any unique field.
  const dto: any = {
    tableName: 'members',
    description: '会员',
    generateWeb: false,
    pageType: 'list',
    fields: [
      { name: 'name', type: 'varchar', description: '姓名', required: true, length: 50, editable: true, creatable: true },
      // unique but optional on purpose — generator must promote it to required
      { name: 'id_card', type: 'varchar', description: '身份证号', unique: true, required: false, length: 18, editable: true, creatable: true },
    ],
  };

  it('activeFields promotes a unique+optional field to required', () => {
    const idCard = activeFields(dto.fields).find((f: any) => f.name === 'id_card')!;
    expect(idCard.required).toBe(true);
  });

  it('generateSchema: unique column is NOT NULL, has no empty default, keeps the unique index', () => {
    const src = generateSchema(dto);
    const idCardLine = src.split('\n').find((l) => l.includes("varchar('id_card'")) ?? '';
    expect(idCardLine).toContain('.notNull()');
    expect(idCardLine).not.toContain(".default('')");
    expect(src).toContain("uniqueIndex('idx_members_id_card_active')");
  });

  it('generateCreateDto: unique column is required (@IsNotEmpty, declared with `!`)', () => {
    const activeDto = { ...dto, fields: activeFields(dto.fields) };
    const src = generateCreateDto(activeDto as any);
    expect(src).toContain('id_card!'); // required → non-optional property
    expect(src).not.toContain('id_card?');
    // both name and id_card are required now → at least two @IsNotEmpty
    expect(src.match(/@IsNotEmpty\(\)/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it('optional NON-unique column is left untouched (still .default(\'\'), optional)', () => {
    const optDto: any = {
      ...dto,
      fields: [
        { name: 'name', type: 'varchar', description: '姓名', required: true, length: 50, editable: true, creatable: true },
        { name: 'nickname', type: 'varchar', description: '昵称', required: false, length: 30, editable: true, creatable: true },
      ],
    };
    const src = generateSchema(optDto);
    const nickLine = src.split('\n').find((l) => l.includes("varchar('nickname'")) ?? '';
    expect(nickLine).toContain(".default('')");
    expect(nickLine).not.toContain('.notNull()');
  });
});

describe('auto-generated L2 contract specs (generateServiceContractSpec / generateHttpContractSpec)', () => {
  const studentsDto: any = {
    tableName: 'students',
    description: '学生',
    generateWeb: false,
    pageType: 'list',
    fields: [
      { name: 'student_no', type: 'varchar', length: 32, unique: true, required: false, creatable: true, editable: true, description: '学号' },
      { name: 'name', type: 'varchar', length: 100, required: true, creatable: true, editable: true, description: '姓名' },
      { name: 'phone', type: 'varchar', length: 20, required: false, creatable: true, editable: true, description: '电话' },
    ],
  };

  it('generateServiceContractSpec: StudentService spec wired to lc_students, gated by RUN_L2_DB', () => {
    const src = generateServiceContractSpec(studentsDto);
    expect(src).toContain("import { StudentService } from './student.service'");
    expect(src).toContain('lc_students');
    expect(src).toContain('TRUNCATE TABLE lc_students');
    expect(src).toContain("process.env.RUN_L2_DB === '1'");
    expect(src).toContain('describe.skip');
    expect(src).toContain('new StudentService(');
    // unique (student_no) → duplicate-rejection case is emitted
    expect(src).toContain('rejects on a duplicate (unique)');
    // unique field's value uses the per-case token, not the empty default
    expect(src).toContain("student_no: 'A'");
  });

  it('generateHttpContractSpec: StudentController HTTP spec at /api/v1/lc/students', () => {
    const src = generateHttpContractSpec(studentsDto);
    expect(src).toContain("import { StudentController } from './student.controller'");
    expect(src).toContain("import { StudentService } from './student.service'");
    expect(src).toContain('/api/v1/lc/students');
    expect(src).toContain("from 'supertest'");
    expect(src).toContain('new ValidationPipe(');
    expect(src).toContain('skipMissingProperties: false'); // mirrors main.ts
    expect(src).toContain('pageSize=9999');
  });

  it('generateService: boolean searchable field coerces string query param to boolean', () => {
    const src = generateService({
      tableName: 'flags',
      description: '标志',
      generateWeb: false,
      pageType: 'list',
      fields: [
        { name: 'name', type: 'varchar', length: 50, required: true, searchable: true, creatable: true, editable: true },
        { name: 'active', type: 'boolean', searchable: true, creatable: true, editable: true },
      ],
    } as any);
    expect(src).toMatch(/active === 'true'/);
  });

  it('generateService: optional decimal field uses null-guard (not bare String())', () => {
    const src = generateService({
      tableName: 'items',
      description: '项目',
      generateWeb: false,
      pageType: 'list',
      fields: [
        { name: 'name', type: 'varchar', length: 50, required: true, searchable: true, creatable: true, editable: true },
        { name: 'price', type: 'decimal', required: false, searchable: true, creatable: true, editable: true },
      ],
    } as any);
    // must guard undefined before String() to avoid "invalid input syntax for type numeric"
    expect(src).toContain('price != null ? String');
    expect(src).not.toContain('price: String(dto.price)');
  });
});
