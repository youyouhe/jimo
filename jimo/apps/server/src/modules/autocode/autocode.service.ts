import {
  Injectable,
  Inject,
  BadRequestException,
  ConflictException,
  NotFoundException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { eq, and, isNull, desc, sql, count, inArray } from 'drizzle-orm';
import { DATABASE_CONNECTION, DrizzleDb } from '../../db/connection';
import { CASBIN_SERVICE_TOKEN, ICasbinService } from '../role/role.service';
import { DictionaryDetailService } from '../dictionary-detail/dictionary-detail.service';
import { EncodingRuleService } from '../encoding-rule/encoding-rule.service';
import { AutoCodeDto, AutoCodeField } from './dto/autocode.dto';
import { UpdateModuleDto } from './dto/update-module.dto';
import { CreatePackageDto, UpdatePackageDto, SaveFromConfigDto } from './dto/package.dto';
import { buildErGraph, type ErGraph, type ErHistoryInput } from './er-graph.util';
import { resolveProjectRoot } from './autocode.utils';

// Re-export job types for backward compatibility
export type { GenerateJobStatus, GenerateStep, GenerateStepStatus } from './autocode-field-utils';

// Pure helpers
import {
  toKebabCase,
  activeFields,
  deriveNames,
  deriveMasterSingular,
  singularize,
  type GenerateJobStatus,
  type GenerateStep,
  type GenerateStepStatus,
} from './autocode-field-utils';

// Code generators
import {
  generateSchema,
  generateCreateDto,
  generateQueryDto,
  generateUpdateDto,
  generateService,
  generateController,
  generateModule,
  generateAgentService,
  generateAgentModule,
} from './autocode-backend-generators';
import { generateServiceContractSpec, generateHttpContractSpec } from './autocode-test-generators';

import {
  generateFrontendService,
  generateFrontendPage,
  generateFrontendDocumentListPage,
  generateFrontendDocumentPage,
  generateFrontendGridPage,
  generateFrontendMapPage,
} from './autocode-frontend-generators';

// Extracted services
import { ReservedNamesService } from './reserved-names.service';
import { MockDataService } from './mock-data.service';
import { EntrypointService } from './entrypoint.service';
import { MenuService } from './menu.service';
import { PackageService } from './package.service';
import { HistoryService } from './history.service';

// Schema imports (for ER graph and approval flows)
import { sysAutoCodeHistories, type SysAutoCodeHistory } from '../../db/schema/auto-code-histories';
import { sysGenerateJobs } from '../../db/schema/generate-jobs';
import { sysAutoCodePackages, type SysAutoCodePackage } from '../../db/schema/auto-code-packages';
import { sysMenus } from '../../db/schema/menus';
import { sysApprovalFlows } from '../../db/schema/sys-approval-flows';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractMenuName(description: string | undefined, fallback: string): string {
  if (!description) return fallback;
  const paren = description.indexOf('（');
  if (paren > 0) return description.slice(0, paren).trim();
  const parenAscii = description.indexOf('(');
  if (parenAscii > 0) return description.slice(0, parenAscii).trim();
  return description;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class AutocodeService {
  private readonly logger = new Logger(AutocodeService.name);

  // Step definitions for progress reporting (kept here for async generate/update)
  static readonly GENERATE_STEPS = [
    { key: 'generate', label: '正在生成代码...' },
    { key: 'write', label: '正在写入文件...' },
    { key: 'schema-sync', label: '正在同步数据库表...' },
    { key: 'mock-data', label: '正在生成 mock 数据...' },
    { key: 'menu', label: '正在创建菜单...' },
    { key: 'history', label: '正在保存历史记录...' },
    { key: 'entrypoints', label: '正在更新入口文件...' },
  ] as const;

  static readonly UPDATE_STEPS = [
    { key: 'generate', label: '正在生成代码...' },
    { key: 'write', label: '正在覆盖文件...' },
    { key: 'schema-sync', label: '正在同步数据库...' },
    { key: 'history', label: '正在保存版本...' },
    { key: 'entrypoints', label: '正在更新入口文件...' },
  ] as const;

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
    @Inject(CASBIN_SERVICE_TOKEN) private readonly casbin: ICasbinService,
    private readonly dictionaryDetailService: DictionaryDetailService,
    private readonly encodingRuleService: EncodingRuleService,
    // Extracted services
    private readonly reservedNamesService: ReservedNamesService,
    private readonly mockDataService: MockDataService,
    private readonly entrypointService: EntrypointService,
    private readonly menuService: MenuService,
    private readonly packageService: PackageService,
    private readonly historyService: HistoryService,
  ) {}

  // =========================================================================
  // Preview & Generate (sync)
  // =========================================================================

  preview(dto: AutoCodeDto): Record<string, string> {
    const n = deriveNames(dto.tableName, dto._packageSlug);
    const files: Record<string, string> = {};

    files[`release/jimo/apps/server/src/db/schema/lc-${n.kebabName}.ts`] = generateSchema(dto);

    const activeDto: AutoCodeDto = { ...dto, fields: activeFields(dto.fields) };

    files[`release/jimo/apps/server/src/modules/${n.moduleDir}/dto/create-${n.lcKebabSingular}.dto.ts`] = generateCreateDto(activeDto);
    files[`release/jimo/apps/server/src/modules/${n.moduleDir}/dto/query-${n.lcKebabSingular}.dto.ts`] = generateQueryDto(activeDto);
    files[`release/jimo/apps/server/src/modules/${n.moduleDir}/dto/update-${n.lcKebabSingular}.dto.ts`] = generateUpdateDto(activeDto);
    files[`release/jimo/apps/server/src/modules/${n.moduleDir}/${n.lcKebabSingular}.service.ts`] = generateService(activeDto);
    files[`release/jimo/apps/server/src/modules/${n.moduleDir}/${n.lcKebabSingular}.controller.ts`] = generateController(activeDto);
    files[`release/jimo/apps/server/src/modules/${n.moduleDir}/${n.lcKebabSingular}.module.ts`] = generateModule(activeDto);

    // Table-level L2 contract specs (auto-generated; gated by RUN_L2_DB=1 at runtime).
    files[`release/jimo/apps/server/src/modules/${n.moduleDir}/${n.lcKebabSingular}.service.contract.spec.ts`] = generateServiceContractSpec(activeDto);
    files[`release/jimo/apps/server/src/modules/${n.moduleDir}/${n.lcKebabSingular}.http.contract.spec.ts`] = generateHttpContractSpec(activeDto);

    if (dto.agentConfig?.enabled) {
      files[`release/jimo/apps/server/src/modules/${n.moduleDir}/agent/${n.lcKebabSingular}.agent.service.ts`] = generateAgentService(activeDto);
      files[`release/jimo/apps/server/src/modules/${n.moduleDir}/agent/${n.lcKebabSingular}.agent.module.ts`] = generateAgentModule(activeDto);
    }

    if (dto.generateWeb) {
      files[`release/jimo/apps/web/src/services/${n.serviceRelDir}.ts`] = generateFrontendService(activeDto);
      if (dto.pageType === 'document') {
        files[`release/jimo/apps/web/src/pages/${n.pageDir}/index.tsx`] = generateFrontendDocumentListPage(activeDto);
        files[`release/jimo/apps/web/src/pages/${n.pageDir}/detail.tsx`] = generateFrontendDocumentPage(activeDto);
      } else if (dto.pageType === 'grid') {
        files[`release/jimo/apps/web/src/pages/${n.pageDir}/index.tsx`] = generateFrontendGridPage(activeDto);
      } else {
        files[`release/jimo/apps/web/src/pages/${n.pageDir}/index.tsx`] = generateFrontendPage(activeDto);
      }
      if (activeDto.fields.some((f) => !f.removed && f.type === 'point')) {
        files[`release/jimo/apps/web/src/pages/${n.pageDir}/map.tsx`] = generateFrontendMapPage(activeDto);
      }
    }

    return files;
  }

  private async lookupRelationDisplayDictTypes(fields: AutoCodeField[]): Promise<Map<string, string | null>> {
    const result = new Map<string, string | null>();
    const relationFields = fields.filter((f) => f.type === 'relation' && (f.relationType === 'many-to-one' || f.relationType === 'many-to-many') && f.relationTable);
    await Promise.all(relationFields.map(async (f) => {
      const displayField = f.relationDisplayField || 'name';
      try {
        const rows = await this.db
          .select({ fields: sysAutoCodeHistories.fields })
          .from(sysAutoCodeHistories)
          .where(eq(sysAutoCodeHistories.tableName, f.relationTable!))
          .orderBy(desc(sysAutoCodeHistories.createdAt))
          .limit(1);
        if (rows.length === 0 || !rows[0].fields) { result.set(f.name, null); return; }
        const historyFields = rows[0].fields as AutoCodeField[];
        const target = historyFields.find((hf) => hf.name === displayField && hf.type === 'dict');
        result.set(f.name, target?.dictType ?? null);
      } catch {
        result.set(f.name, null);
      }
    }));
    return result;
  }

  private assertNoApprovalStatusField(dto: {
    fields: { name?: string; removed?: boolean }[];
    approvalFlow?: { enabled?: boolean };
  }): void {
    if (!dto.approvalFlow?.enabled) return;
    const offenders = dto.fields
      .filter((f) => !f.removed && /^status$|^(approval|approve)/i.test(f.name ?? ''))
      .map((f) => f.name);
    if (offenders.length > 0) {
      throw new BadRequestException(
        `审批状态由平台用 business_approvals 表 + BPM 托管，业务表上不得包含审批状态字段：${offenders.join(', ')}。` +
          `请删除该字段；若确为审批之后的下游业务状态，请改用语义明确的名字（如 payment_status、shipped_at）。`,
      );
    }
  }

  async generate(dto: AutoCodeDto): Promise<{ createdFiles: string[] }> {
    this.assertNoApprovalStatusField(dto);

    // Normalize tableName and resolve _packageSlug before preview/deriveNames calls
    if (dto.tableName && !dto.tableName.startsWith('lc_')) {
      dto.tableName = 'lc_' + dto.tableName;
    }
    if (dto.packageId) {
      try {
        const pkg = await this.packageService.findOnePackage(dto.packageId);
        dto._packageSlug = pkg.slug ?? 'default';
      } catch { dto._packageSlug = 'default'; }
    } else {
      dto._packageSlug = 'default';
    }

    const files = this.preview(dto);
    const projectRoot = resolveProjectRoot();

    // Infer dict types for many-to-one display fields
    if (dto.generateWeb) {
      const n = deriveNames(dto.tableName, dto._packageSlug);
      const activeDto: AutoCodeDto = { ...dto, fields: activeFields(dto.fields) };
      const relationDictTypes = await this.lookupRelationDisplayDictTypes(activeDto.fields);
      if ([...relationDictTypes.values()].some((v) => v !== null)) {
        files[`release/jimo/apps/web/src/services/${n.serviceRelDir}.ts`] = generateFrontendService(activeDto, relationDictTypes);
        if (dto.pageType === 'document') {
          files[`release/jimo/apps/web/src/pages/${n.pageDir}/index.tsx`] = generateFrontendDocumentListPage(activeDto, relationDictTypes);
          files[`release/jimo/apps/web/src/pages/${n.pageDir}/detail.tsx`] = generateFrontendDocumentPage(activeDto, relationDictTypes);
        } else if (dto.pageType === 'grid') {
          files[`release/jimo/apps/web/src/pages/${n.pageDir}/index.tsx`] = generateFrontendGridPage(activeDto, relationDictTypes);
        } else {
          files[`release/jimo/apps/web/src/pages/${n.pageDir}/index.tsx`] = generateFrontendPage(activeDto, relationDictTypes);
        }
      }
    }
    const createdFiles: string[] = [];

    for (const [relativePath, content] of Object.entries(files)) {
      const absolutePath = path.join(projectRoot, relativePath);
      const dir = path.dirname(absolutePath);
      await fs.mkdir(dir, { recursive: true });
      try {
        await fs.access(absolutePath);
        throw new ConflictException(
          `File already exists: ${relativePath}. Remove the existing file first or use a different table name.`,
        );
      } catch (err: unknown) {
        if (err instanceof ConflictException) throw err;
      }
      await fs.writeFile(absolutePath, content, 'utf-8');
      createdFiles.push(relativePath);
    }

    const hasPointFields = dto.generateWeb && dto.fields.some((f) => !f.removed && f.type === 'point');

    await this.entrypointService.updateSchemaIndex(dto, projectRoot);
    await this.entrypointService.updateAppModule(dto, projectRoot);
    if (dto.generateWeb) {
      await this.entrypointService.updateUmiRoutes(dto, projectRoot);
      if (hasPointFields) {
        await this.entrypointService.updateUmiRoutesMap(dto, projectRoot);
      }
    }

    let menuParentId: string | null = null;
    let packageName = '';
    if (dto.packageId) {
      try {
        const pkg = await this.packageService.findOnePackage(dto.packageId);
        menuParentId = pkg.menuId ?? null;
        packageName = pkg.name;
      } catch { /* package not found */ }
    }

    try {
      const templates: Record<string, any> = { ...files };
      if (dto.agentConfig?.enabled) {
        templates.__agent = this.buildAgentConfigMetadata(dto);
      }
      await this.db.insert(sysAutoCodeHistories).values({
        packageName,
        packageSlug: dto._packageSlug ?? 'default',
        tableName: dto.tableName,
        businessDB: (dto as any).businessDB || '',
        templates,
        visibilityStrategy: dto.visibilityStrategy ?? 'private',
        hasApprovalFlow: dto.approvalFlow?.enabled ?? false,
        hasAgent: dto.agentConfig?.enabled ?? false,
      });
    } catch (historyErr: unknown) {
      this.logger.error('[AutocodeService] Failed to save generation history:', historyErr);
    }

    try {
      const { exec } = await import('node:child_process');
      const { promisify } = await import('node:util');
      const execAsync = promisify(exec);
      const serverDir = path.join(projectRoot, 'release', 'jimo', 'apps', 'server');
      await execAsync('npx --no-install drizzle-kit push --force', {
        cwd: serverDir, timeout: 30000,
        env: { ...process.env, DRIZZLE_SILENT: '1' },
      });
      this.logger.log(` drizzle-kit push completed for '${dto.tableName}'`);
    } catch (pushErr: unknown) {
      this.logger.error(` drizzle-kit push FAILED for '${dto.tableName}':`, pushErr);
    }

    await this.verifyPhysicalSchema(dto.tableName, dto.fields);

    try {
      await this.menuService.autoCreateMenu(dto, menuParentId);
      if (hasPointFields) {
        await this.menuService.autoCreateMapMenu(dto, menuParentId);
      }
    } catch (menuErr: unknown) {
      this.logger.error(` Auto-create menu FAILED for '${dto.tableName}':`, menuErr);
    }

    if (dto.approvalFlow?.enabled) {
      try {
        await this.upsertApprovalFlowConfig(dto.tableName, dto.approvalFlow.defaultChain ?? []);
      } catch (afErr: unknown) {
        this.logger.error(` approval flow config write FAILED for '${dto.tableName}':`, afErr);
      }
    }

    return { createdFiles };
  }

  // =========================================================================
  // Async generate / update
  // =========================================================================

  async startGenerate(dto: AutoCodeDto): Promise<string> {
    this.assertNoApprovalStatusField(dto);
    const jobId = randomUUID();
    const steps = AutocodeService.GENERATE_STEPS.map((s) => ({
      key: s.key, label: s.label, status: 'pending' as const,
    }));
    // Enqueue for the standalone generate-worker (runs outside the NestJS watch
    // process, immune to dev watch restarts). The worker polls sys_generate_jobs.
    await this.db.insert(sysGenerateJobs).values({
      id: jobId,
      tableName: dto.tableName,
      status: 'pending',
      jobType: 'generate',
      payload: { dto, steps, progress: 0, currentStepLabel: '准备中...' },
    });
    return jobId;
  }

  async startUpdate(dto: UpdateModuleDto): Promise<string> {
    this.assertNoApprovalStatusField(dto);
    const latest = await this.historyService.getLatestVersion(dto.tableName);
    if (!latest) {
      throw new NotFoundException(`No existing version found for table '${dto.tableName}'.`);
    }

    const oldFields = (latest.fields as AutoCodeField[]) ?? [];
    if (!this.historyService.hasStructuralChange(oldFields, dto.fields) && !dto.force) {
      throw new ConflictException('没有检测到表结构变更。');
    }

    const hardRemovedFields = this.historyService.getRemovedFields(oldFields, dto.fields);
    if (hardRemovedFields.length > 0 && !dto.force) {
      const fieldNames = hardRemovedFields.map((f) => `${f.name}(${f.type})`).join(', ');
      throw new ConflictException(`检测到字段硬删除: ${fieldNames}。请勾选"确认删除字段"后重新提交。`);
    }

    const jobId = randomUUID();
    const steps = AutocodeService.UPDATE_STEPS.map((s) => ({
      key: s.key, label: s.label, status: 'pending' as const,
    }));
    // Enqueue for the standalone generate-worker (it dispatches job_type='update'
    // to processUpdateJob). Runs outside the watch process, immune to watch restarts.
    await this.db.insert(sysGenerateJobs).values({
      id: jobId,
      tableName: dto.tableName,
      status: 'pending',
      jobType: 'update',
      payload: { dto, steps, progress: 0, currentStepLabel: '准备更新...' },
    });
    return jobId;
  }

  async getJobStatus(jobId: string): Promise<GenerateJobStatus | null> {
    // Generate jobs now live in sys_generate_jobs (written by generate-worker).
    const rows = await this.db
      .select()
      .from(sysGenerateJobs)
      .where(eq(sysGenerateJobs.id, jobId))
      .limit(1);
    const job = rows[0];
    if (!job) return this.readJobStatus(jobId); // fallback: update jobs still use .tmp files
    const payload = (job.payload as any) ?? {};
    // Worker writes steps into payload jsonb. Tolerate either an array or a
    // JSON-encoded string (older worker versions double-encoded via ::jsonb).
    const rawSteps = payload.steps;
    let steps: GenerateStep[];
    if (Array.isArray(rawSteps)) steps = rawSteps;
    else if (typeof rawSteps === 'string') {
      try { steps = JSON.parse(rawSteps) as GenerateStep[]; } catch { steps = []; }
    } else {
      steps = AutocodeService.GENERATE_STEPS.map((s) => ({ key: s.key, label: s.label, status: 'pending' as const }));
    }
    const completed = steps.filter((s) => s.status === 'completed').length;
    const progress = Math.round((completed / steps.length) * 100);
    const status = job.status === 'done' ? 'completed' : job.status === 'failed' ? 'failed' : 'processing';
    return {
      jobId,
      status,
      steps,
      progress,
      currentStepLabel: payload.currentStepLabel ?? '',
      error: (job.error as string) ?? undefined,
      completedAt: (job.finishedAt as Date | null)?.toISOString(),
    };
  }

  // =========================================================================
  // Tables / Templates / ER Graph
  // =========================================================================

  async getTables(): Promise<string[]> {
    const rows = await this.db
      .selectDistinct({ tableName: sysAutoCodeHistories.tableName })
      .from(sysAutoCodeHistories)
      .orderBy(sysAutoCodeHistories.tableName);
    return rows.map((r) => r.tableName);
  }

  getTemplates(): Record<string, unknown> {
    return {
      fieldTypes: [
        { value: 'varchar', label: 'String (varchar)', tsType: 'string', defaultLength: 255 },
        { value: 'text', label: 'Long Text (text)', tsType: 'string' },
        { value: 'integer', label: 'Integer (integer)', tsType: 'number' },
        { value: 'bigint', label: 'Big Integer (bigint)', tsType: 'number' },
        { value: 'decimal', label: 'Decimal (numeric)', tsType: 'string' },
        { value: 'boolean', label: 'Boolean (boolean)', tsType: 'boolean' },
        { value: 'timestamp', label: 'Timestamp (timestamp)', tsType: 'string' },
        { value: 'uuid', label: 'UUID (uuid)', tsType: 'string' },
        { value: 'image', label: 'Image (upload)', tsType: 'string', defaultLength: 512 },
        { value: 'file', label: 'Attachment (upload)', tsType: 'string', defaultLength: 512 },
        { value: 'dict', label: 'Dictionary (dict)', tsType: 'string', defaultLength: 64 },
        { value: 'code', label: 'Auto Code (code)', tsType: 'string', defaultLength: 100 },
        { value: 'point', label: 'GIS Point (point)', tsType: 'string' },
        { value: 'calculated', label: 'Calculated (formula)', tsType: 'string' },
        { value: 'relation', label: 'Relation (foreign key)', tsType: 'string', relationTypes: ['many-to-one', 'many-to-many'] },
      ],
      files: [
        { key: 'schema', label: 'Drizzle Schema', path: 'db/schema/{kebab-name}.ts' },
        { key: 'createDto', label: 'Create DTO', path: 'modules/{kebab-singular}/dto/create-{kebab-singular}.dto.ts' },
        { key: 'queryDto', label: 'Query DTO', path: 'modules/{kebab-singular}/dto/query-{kebab-singular}.dto.ts' },
        { key: 'updateDto', label: 'Update DTO', path: 'modules/{kebab-singular}/dto/update-{kebab-singular}.dto.ts' },
        { key: 'service', label: 'Service', path: 'modules/{kebab-singular}/{kebab-singular}.service.ts' },
        { key: 'controller', label: 'Controller', path: 'modules/{kebab-singular}/{kebab-singular}.controller.ts' },
        { key: 'module', label: 'Module', path: 'modules/{kebab-singular}/{kebab-singular}.module.ts' },
        { key: 'frontendService', label: 'Frontend Service', path: 'web/src/services/lc/{kebab-singular}.ts' },
        { key: 'frontendPage', label: 'Frontend Page', path: 'web/src/pages/lc/{kebab-name}/index.tsx' },
      ],
    };
  }

  async getErGraph(packageId?: string): Promise<ErGraph> {
    const rows = await this.db
      .select()
      .from(sysAutoCodeHistories)
      .orderBy(desc(sysAutoCodeHistories.tableName), desc(sysAutoCodeHistories.version), desc(sysAutoCodeHistories.createdAt));

    const latestByTable = new Map<string, SysAutoCodeHistory>();
    for (const row of rows) {
      if (!row.tableName) continue;
      const prev = latestByTable.get(row.tableName);
      if (!prev || (row.version ?? 0) > (prev.version ?? 0)) {
        latestByTable.set(row.tableName, row);
      }
    }
    let histories = Array.from(latestByTable.values());

    if (packageId) {
      let pkgName: string | undefined;
      try { const pkg = await this.packageService.findOnePackage(packageId); pkgName = pkg.name; } catch { /* not found */ }
      histories = pkgName ? histories.filter((h) => h.packageName === pkgName) : [];
    }

    if (histories.length === 0) return { nodes: [], edges: [] };

    const componentPaths = histories.map((h) => `./${deriveNames(h.tableName!, '').kebabName}/index`);
    const menuRows = await this.db
      .select({ component: sysMenus.component, name: sysMenus.name })
      .from(sysMenus)
      .where(and(inArray(sysMenus.component, componentPaths), isNull(sysMenus.deletedAt)));
    const menuNameByComponent = new Map(menuRows.map((m) => [m.component, m.name]));

    const inputs: ErHistoryInput[] = histories.map((h) => {
      const componentPath = `./${deriveNames(h.tableName!, '').kebabName}/index`;
      return {
        tableName: h.tableName!,
        description: menuNameByComponent.get(componentPath) || h.tableName!,
        packageName: h.packageName,
        fields: (h.fields as AutoCodeField[]) || null,
      };
    });

    return buildErGraph(inputs);
  }

  // =========================================================================
  // Package delegates
  // =========================================================================

  async findAllPackages(params: { page?: number; pageSize?: number; name?: string; includeDeleted?: boolean }) {
    return this.packageService.findAllPackages(params);
  }

  async createPackage(dto: CreatePackageDto) { return this.packageService.createPackage(dto); }
  async findOnePackage(id: string) { return this.packageService.findOnePackage(id); }
  async updatePackage(id: string, dto: UpdatePackageDto) { return this.packageService.updatePackage(id, dto); }
  async deletePackage(id: string) { return this.packageService.deletePackage(id); }
  async listMenusByPackage() { return this.packageService.listMenusByPackage(); }
  async assignToPackage(tableName: string, packageId: string) { return this.packageService.assignToPackage(tableName, packageId); }
  async getPackageConfig(id: string) { return this.packageService.getPackageConfig(id); }
  async listAllPackages() { return this.packageService.listAllPackages(); }

  async saveFromConfig(dto: SaveFromConfigDto): Promise<SysAutoCodePackage> {
    const menuId = await this.menuService.ensureDirectoryMenu(dto.name);
    let templates: Record<string, string> = {};
    if (dto.generateTemplates) {
      const autoCodeDto: AutoCodeDto = {
        tableName: dto.tableName,
        description: dto.description || dto.name,
        fields: dto.fields,
        generateWeb: dto.generateWeb,
      };
      templates = this.preview(autoCodeDto);
    }

    const rows = await this.db
      .insert(sysAutoCodePackages)
      .values({
        name: dto.name,
        description: dto.description ?? '',
        templates,
        tableName: dto.tableName,
        fields: dto.fields,
        generateWeb: dto.generateWeb,
        menuId,
      })
      .returning();

    const kebabDirName = toKebabCase(dto.name).replace(/[^a-z0-9-]/g, '') || 'untitled';
    this.logger.log(` Saved package '${dto.name}' with menu /pkg/${kebabDirName} (menuId=${menuId})`);
    return rows[0]!;
  }

  // =========================================================================
  // History delegates
  // =========================================================================

  async findAllHistory(params: { page?: number; pageSize?: number; tableName?: string }) {
    return this.historyService.findAllHistory(params);
  }
  async findOneHistory(id: string) { return this.historyService.findOneHistory(id); }
  async rollbackHistory(id: string) { return this.historyService.rollbackHistory(id); }
  async deleteHistory(id: string) { return this.historyService.deleteHistory(id); }
  async startDeleteHistory(id: string, cascade = false) { return this.historyService.startDeleteHistory(id, cascade); }
  async analyzeImpact(tableName: string, cascade = false) { return this.historyService.analyzeImpact(tableName, cascade); }
  async getLatestVersion(tableName: string) { return this.historyService.getLatestVersion(tableName); }
  async getHistoryVersions(tableName: string) { return this.historyService.getHistoryVersions(tableName); }
  async computeChangeLog(oldFields: AutoCodeField[], newFields: AutoCodeField[]) { return this.historyService.computeChangeLog(oldFields, newFields); }

  // =========================================================================
  // Reserved names delegates
  // =========================================================================

  async getReservedNames() { return this.reservedNamesService.getReservedNames(); }
  async addReservedNames(names: string[]) { return this.reservedNamesService.addReservedNames(names); }

  // =========================================================================
  // Mock data
  // =========================================================================

  async generateMockForTable(tableName: string, count: number, userId?: string): Promise<{ inserted: number }> {
    const latest = await this.historyService.getLatestVersion(tableName);
    if (!latest) throw new Error(`表 '${tableName}' 不存在（无生成历史）`);
    const fields = (latest.fields as any[]) ?? [];
    if (fields.length === 0) throw new Error(`表 '${tableName}' 无字段信息，无法生成 mock 数据`);

    const dto = {
      tableName,
      description: '',
      fields,
      generateWeb: false,
      mockData: { enabled: true, count },
    };
    await this.mockDataService.insertMockData(dto as any, userId);
    return { inserted: count };
  }

  // =========================================================================
  // Private: async generate execution
  // =========================================================================

  private async executeGenerateAsync(jobId: string, dto: AutoCodeDto): Promise<void> {
    const totalSteps = AutocodeService.GENERATE_STEPS.length;
    let createdFiles: string[] = [];
    let files: Record<string, string> = {};
    let projectRoot = '';

    const updateStep = async (stepIndex: number, stepStatus: string, message?: string) => {
      const steps: GenerateStep[] = AutocodeService.GENERATE_STEPS.map((s, i) => ({
        key: s.key, label: s.label,
        status: i < stepIndex ? 'completed' as const : i === stepIndex ? stepStatus as any : 'pending' as const,
      }));
      const progress = stepStatus === 'completed' ? Math.round(((stepIndex + 1) / totalSteps) * 100) : Math.round(((stepIndex + 0.5) / totalSteps) * 100);
      await this.writeJobStatus(jobId, { jobId, status: stepStatus === 'failed' ? 'failed' : 'processing', steps, progress, currentStepLabel: message || AutocodeService.GENERATE_STEPS[stepIndex]!.label, error: stepStatus === 'failed' ? message : undefined });
    };

    try {
      // Normalize tableName and resolve _packageSlug before any deriveNames calls
      if (dto.tableName && !dto.tableName.startsWith('lc_')) {
        dto.tableName = 'lc_' + dto.tableName;
      }
      if (dto.packageId) {
        try {
          const pkg = await this.packageService.findOnePackage(dto.packageId);
          dto._packageSlug = pkg.slug ?? 'default';
        } catch { dto._packageSlug = 'default'; }
      } else {
        dto._packageSlug = 'default';
      }

      // Force mode cleanup
      if (dto.force) {
        this.historyService.ensureNotReservedTable(dto.tableName);
        const n = deriveNames(dto.tableName, dto._packageSlug);
        const root = resolveProjectRoot();
        const expectedPaths = [
          `release/jimo/apps/server/src/db/schema/lc-${n.kebabName}.ts`,
          `release/jimo/apps/server/src/modules/${n.moduleDir}/${n.lcKebabSingular}.service.ts`,
          `release/jimo/apps/server/src/modules/${n.moduleDir}/${n.lcKebabSingular}.controller.ts`,
          `release/jimo/apps/server/src/modules/${n.moduleDir}/${n.lcKebabSingular}.module.ts`,
          `release/jimo/apps/server/src/modules/${n.moduleDir}/dto/create-${n.lcKebabSingular}.dto.ts`,
          `release/jimo/apps/server/src/modules/${n.moduleDir}/dto/query-${n.lcKebabSingular}.dto.ts`,
          `release/jimo/apps/server/src/modules/${n.moduleDir}/dto/update-${n.lcKebabSingular}.dto.ts`,
          `release/jimo/apps/server/src/modules/${n.moduleDir}/agent/${n.lcKebabSingular}.agent.service.ts`,
          `release/jimo/apps/server/src/modules/${n.moduleDir}/agent/${n.lcKebabSingular}.agent.module.ts`,
          `release/jimo/apps/web/src/services/${n.serviceRelDir}.ts`,
          `release/jimo/apps/web/src/pages/${n.pageDir}/index.tsx`,
          `release/jimo/apps/server/src/modules/${n.moduleDir}/${n.lcKebabSingular}.service.contract.spec.ts`,
          `release/jimo/apps/server/src/modules/${n.moduleDir}/${n.lcKebabSingular}.http.contract.spec.ts`,
        ];
        const { existsSync } = await import('node:fs');
        for (const p of expectedPaths) {
          const fullPath = path.join(root, p);
          if (existsSync(fullPath)) await fs.rm(fullPath, { force: true });
        }
        // Remove module dir (including agent/ and dto/ subdirs)
        const moduleDir = path.join(root, `release/jimo/apps/server/src/modules/${n.moduleDir}`);
        if (existsSync(moduleDir)) {
          try { await fs.rm(path.join(moduleDir, 'dto'), { recursive: true, force: true }); } catch { /* */ }
          try { await fs.rm(path.join(moduleDir, 'agent'), { recursive: true, force: true }); } catch { /* */ }
          try { await fs.rmdir(moduleDir); } catch { /* */ }
        }
        const pageDir = path.join(root, `release/jimo/apps/web/src/pages/${n.pageDir}`);
        if (existsSync(pageDir)) { try { await fs.rm(pageDir, { recursive: true, force: true }); } catch { /* */ } }
        await this.entrypointService.removeSchemaExport(n);
        await this.entrypointService.removeDanglingSchemaImports(n);
        await this.entrypointService.removeModuleRegistration(n);
        await this.entrypointService.removeRouteFromUmirc(n);
        this.logger.log(` Force mode: cleaned up existing files for '${dto.tableName}'`);
      }

      // Step 1: Generate code
      await updateStep(0, 'running');
      files = this.preview(dto);
      projectRoot = resolveProjectRoot();

      if (dto.generateWeb) {
        const n = deriveNames(dto.tableName, dto._packageSlug);
        const activeDto: AutoCodeDto = { ...dto, fields: activeFields(dto.fields) };
        const relationDictTypes = await this.lookupRelationDisplayDictTypes(activeDto.fields);
        if ([...relationDictTypes.values()].some((v) => v !== null)) {
          files[`release/jimo/apps/web/src/services/${n.serviceRelDir}.ts`] = generateFrontendService(activeDto, relationDictTypes);
          if (dto.pageType === 'document') {
            files[`release/jimo/apps/web/src/pages/${n.pageDir}/index.tsx`] = generateFrontendDocumentListPage(activeDto, relationDictTypes);
            files[`release/jimo/apps/web/src/pages/${n.pageDir}/detail.tsx`] = generateFrontendDocumentPage(activeDto, relationDictTypes);
          } else if (dto.pageType === 'grid') {
            files[`release/jimo/apps/web/src/pages/${n.pageDir}/index.tsx`] = generateFrontendGridPage(activeDto, relationDictTypes);
          } else {
            files[`release/jimo/apps/web/src/pages/${n.pageDir}/index.tsx`] = generateFrontendPage(activeDto, relationDictTypes);
          }
        }
        if (activeDto.fields.some((f) => !f.removed && f.type === 'point')) {
          files[`release/jimo/apps/web/src/pages/${n.pageDir}/map.tsx`] = generateFrontendMapPage(activeDto);
        }
      }
      await updateStep(0, 'completed');

      // Step 2: Write files
      await updateStep(1, 'running');
      for (const [relativePath, content] of Object.entries(files)) {
        const absolutePath = path.join(projectRoot, relativePath);
        const dir = path.dirname(absolutePath);
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(absolutePath, content, 'utf-8');
        createdFiles.push(relativePath);
      }
      await this.entrypointService.updateSchemaIndex(dto, projectRoot);
      await this.entrypointService.updateAppModule(dto, projectRoot);
      if (dto.generateWeb) await this.entrypointService.updateUmiRoutes(dto, projectRoot);
      await updateStep(1, 'completed');

      // Step 3: drizzle-kit push
      await updateStep(2, 'running', '正在同步数据库表...');
      let pushSucceeded = false;
      try {
        const { exec } = await import('node:child_process');
        const { promisify } = await import('node:util');
        const execAsync = promisify(exec);
        const serverDir = path.join(projectRoot, 'release', 'jimo', 'apps', 'server');
        await execAsync('npx --no-install drizzle-kit push --force', {
          cwd: serverDir, timeout: 60000,
          env: { ...process.env, DRIZZLE_SILENT: '1' },
        });
        pushSucceeded = true;
        this.logger.log(` drizzle-kit push completed for '${dto.tableName}'`);
      } catch (pushErr: unknown) {
        this.logger.error(` drizzle-kit push FAILED for '${dto.tableName}':`, pushErr);
      }
      await updateStep(2, 'completed');

      // Step 4: Mock data
      await updateStep(3, 'running');
      try {
        if (dto.mockData?.enabled && pushSucceeded) {
          await this.mockDataService.insertMockData(dto);
        }
      } catch (mockErr: unknown) {
        const msg = mockErr instanceof Error ? mockErr.message : String(mockErr);
        this.logger.warn(` mock insert skipped for '${dto.tableName}': ${msg}`);
      } finally {
        await updateStep(3, 'completed');
      }

      // Step 5: Create menu
      await updateStep(4, 'running');
      const asyncHasPointFields = dto.generateWeb && dto.fields.some((f) => !f.removed && f.type === 'point');
      let asyncMenuParentId: string | null = null;
      let asyncPackageName = '';
      if (dto.packageId) {
        try {
          const pkg = await this.packageService.findOnePackage(dto.packageId);
          asyncMenuParentId = pkg.menuId ?? null;
          asyncPackageName = pkg.name;
        } catch { /* */ }
      }
      try {
        await this.menuService.autoCreateMenu(dto, asyncMenuParentId);
        if (asyncHasPointFields) await this.menuService.autoCreateMapMenu(dto, asyncMenuParentId);
      } catch (menuErr: unknown) {
        this.logger.error(` Auto-create menu FAILED for '${dto.tableName}':`, menuErr);
      }
      if (dto.approvalFlow?.enabled) {
        try {
          await this.upsertApprovalFlowConfig(dto.tableName, dto.approvalFlow.defaultChain ?? []);
        } catch (afErr: unknown) {
          this.logger.error(` approval flow config write FAILED for '${dto.tableName}':`, afErr);
        }
      }
      await updateStep(4, 'completed');

      // Step 6: Save history
      await updateStep(5, 'running');
      try {
        const existing = await this.historyService.getLatestVersion(dto.tableName);
        const nextVersion = existing ? (existing.version ?? 1) + 1 : 1;
        const asyncTemplates: Record<string, any> = { ...files };
        if (dto.agentConfig?.enabled) asyncTemplates.__agent = this.buildAgentConfigMetadata(dto);
        await this.db.insert(sysAutoCodeHistories).values({
          packageName: asyncPackageName,
          packageSlug: dto._packageSlug ?? 'default',
          tableName: dto.tableName,
          businessDB: (dto as any).businessDB || '',
          templates: asyncTemplates,
          version: nextVersion,
          fields: dto.fields,
          changeLog: dto.force ? '强制重新生成' : '初始创建',
          operation: 'create',
          parentId: existing?.id ?? null,
          visibilityStrategy: dto.visibilityStrategy ?? existing?.visibilityStrategy ?? 'private',
          hasApprovalFlow: dto.approvalFlow?.enabled ?? existing?.hasApprovalFlow ?? false,
          hasAgent: dto.agentConfig?.enabled ?? existing?.hasAgent ?? false,
        });
      } catch (historyErr: unknown) {
        this.logger.error('[AutocodeService] Failed to save generation history:', historyErr);
      }
      await updateStep(5, 'completed');

      // Step 7: Enqueue entrypoints
      await updateStep(6, 'running');
      await this.entrypointService.enqueueEntrypointJob(jobId, dto, asyncHasPointFields, createdFiles);
    } catch (err: any) {
      const errorMsg = err?.message || 'Unknown error during generation';
      this.logger.error(` Generate job ${jobId} FAILED:`, errorMsg);
      await this.writeJobStatus(jobId, {
        jobId, status: 'failed',
        steps: AutocodeService.GENERATE_STEPS.map(() => ({ key: '', label: '', status: 'pending' as const })),
        progress: 0, currentStepLabel: `失败: ${errorMsg}`, error: errorMsg,
      });
    }
  }

  private async executeUpdateAsync(jobId: string, dto: UpdateModuleDto): Promise<void> {
    const totalSteps = AutocodeService.UPDATE_STEPS.length;
    let files: Record<string, string> = {};
    let projectRoot = '';

    const updateStep = async (stepIndex: number, stepStatus: string, message?: string) => {
      const steps: GenerateStep[] = AutocodeService.UPDATE_STEPS.map((s, i) => ({
        key: s.key, label: s.label,
        status: i < stepIndex ? 'completed' as const : i === stepIndex ? stepStatus as any : 'pending' as const,
      }));
      const progress = stepStatus === 'completed' ? Math.round(((stepIndex + 1) / totalSteps) * 100) : Math.round(((stepIndex + 0.5) / totalSteps) * 100);
      await this.writeJobStatus(jobId, { jobId, status: stepStatus === 'failed' ? 'failed' : 'processing', steps, progress, currentStepLabel: message || AutocodeService.UPDATE_STEPS[stepIndex]!.label, error: stepStatus === 'failed' ? message : undefined });
    };

    try {
      const latest = await this.historyService.getLatestVersion(dto.tableName);
      if (!latest) throw new Error(`Version record for '${dto.tableName}' not found`);

      const oldFields = (latest.fields as AutoCodeField[]) ?? [];
      const oldVersion = latest.version ?? 1;
      const changeLog = this.historyService.computeChangeLog(oldFields, dto.fields);

      // Normalize tableName and resolve _packageSlug for update path
      if (dto.tableName && !dto.tableName.startsWith('lc_')) {
        dto.tableName = 'lc_' + dto.tableName;
      }
      let updatePackageSlug = 'default';
      if (dto.packageId) {
        try {
          const pkg = await this.packageService.findOnePackage(dto.packageId);
          updatePackageSlug = pkg.slug ?? 'default';
        } catch { /* */ }
      } else if ((latest as any).packageSlug) {
        updatePackageSlug = (latest as any).packageSlug;
      }

      const autoCodeDto: AutoCodeDto = {
        tableName: dto.tableName,
        description: dto.description || '',
        fields: dto.fields,
        generateWeb: dto.generateWeb ?? true,
        pageType: dto.pageType ?? (latest as any).pageType ?? 'list',
        approvalFlow: dto.approvalFlow ?? (latest.hasApprovalFlow ? { enabled: true } : undefined),
        agentConfig: dto.agentConfig ?? (latest.hasAgent ? { enabled: true } : undefined),
        visibilityStrategy: dto.visibilityStrategy ?? (latest.visibilityStrategy as any) ?? 'private',
        packageId: dto.packageId,
        force: dto.force,
        _packageSlug: updatePackageSlug,
      };

      // Step 1: Generate
      await updateStep(0, 'running');
      files = this.preview(autoCodeDto);
      projectRoot = resolveProjectRoot();

      if (autoCodeDto.generateWeb) {
        const n2 = deriveNames(autoCodeDto.tableName, autoCodeDto._packageSlug);
        const activeDto2: AutoCodeDto = { ...autoCodeDto, fields: activeFields(autoCodeDto.fields) };
        const relationDictTypes2 = await this.lookupRelationDisplayDictTypes(activeDto2.fields);
        if ([...relationDictTypes2.values()].some((v) => v !== null)) {
          files[`release/jimo/apps/web/src/services/${n2.serviceRelDir}.ts`] = generateFrontendService(activeDto2, relationDictTypes2);
          if (autoCodeDto.pageType === 'document') {
            files[`release/jimo/apps/web/src/pages/${n2.pageDir}/index.tsx`] = generateFrontendDocumentListPage(activeDto2, relationDictTypes2);
            files[`release/jimo/apps/web/src/pages/${n2.pageDir}/detail.tsx`] = generateFrontendDocumentPage(activeDto2, relationDictTypes2);
          } else if (autoCodeDto.pageType === 'grid') {
            files[`release/jimo/apps/web/src/pages/${n2.pageDir}/index.tsx`] = generateFrontendGridPage(activeDto2, relationDictTypes2);
          } else {
            files[`release/jimo/apps/web/src/pages/${n2.pageDir}/index.tsx`] = generateFrontendPage(activeDto2, relationDictTypes2);
          }
        }
      }
      await updateStep(0, 'completed');

      // Step 2: Write
      await updateStep(1, 'running');
      for (const [relativePath, content] of Object.entries(files)) {
        const absolutePath = path.join(projectRoot, relativePath);
        const dir = path.dirname(absolutePath);
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(absolutePath, content, 'utf-8');
      }
      await this.entrypointService.updateSchemaIndex(autoCodeDto, projectRoot);
      await this.entrypointService.updateAppModule(autoCodeDto, projectRoot);
      if (autoCodeDto.generateWeb) await this.entrypointService.updateUmiRoutes(autoCodeDto, projectRoot);
      await updateStep(1, 'completed');

      // Step 3: drizzle-kit push
      await updateStep(2, 'running', '正在同步数据库...');
      try {
        const { exec } = await import('node:child_process');
        const { promisify } = await import('node:util');
        const execAsync = promisify(exec);
        const serverDir = path.join(projectRoot, 'release', 'jimo', 'apps', 'server');
        await execAsync('npx --no-install drizzle-kit push --force', {
          cwd: serverDir, timeout: 60000,
          env: { ...process.env, DRIZZLE_SILENT: '1' },
        });
      } catch (pushErr: unknown) {
        this.logger.error(` drizzle-kit push FAILED for update '${dto.tableName}':`, pushErr);
      }
      await this.verifyPhysicalSchema(dto.tableName, dto.fields);
      await updateStep(2, 'completed');

      // Step 4: Save version history
      await updateStep(3, 'running');
      const updatePackageName = (dto as any).packageId
        ? await this.packageService.getPackageName((dto as any).packageId).catch(() => '')
        : '';
      try {
        const updateTemplates: Record<string, any> = { ...files };
        if (autoCodeDto.agentConfig?.enabled) updateTemplates.__agent = this.buildAgentConfigMetadata(autoCodeDto);
        await this.db.insert(sysAutoCodeHistories).values({
          packageName: updatePackageName,
          packageSlug: autoCodeDto._packageSlug ?? 'default',
          tableName: dto.tableName,
          businessDB: '',
          templates: updateTemplates,
          version: oldVersion + 1,
          fields: dto.fields,
          changeLog,
          operation: 'update',
          parentId: latest.id,
          visibilityStrategy: dto.visibilityStrategy ?? latest.visibilityStrategy ?? 'private',
          hasApprovalFlow: dto.approvalFlow?.enabled ?? latest.hasApprovalFlow ?? false,
          hasAgent: dto.agentConfig?.enabled ?? latest.hasAgent ?? false,
        });
      } catch (historyErr: unknown) {
        this.logger.error('[AutocodeService] Failed to save update history:', historyErr);
      }
      await updateStep(3, 'completed');

      // Step 5: Enqueue entrypoints
      await updateStep(4, 'running');
      await this.entrypointService.enqueueEntrypointJob(jobId, autoCodeDto, false);
    } catch (err: any) {
      const errorMsg = err?.message || 'Unknown error during update';
      this.logger.error(` Update job ${jobId} FAILED:`, errorMsg);
      await this.writeJobStatus(jobId, {
        jobId, status: 'failed',
        steps: AutocodeService.UPDATE_STEPS.map(() => ({ key: '', label: '', status: 'pending' as const })),
        progress: 0, currentStepLabel: `失败: ${errorMsg}`, error: errorMsg,
      });
    }
  }

  // =========================================================================
  // Private: helpers
  // =========================================================================

  private buildAgentConfigMetadata(dto: AutoCodeDto): Record<string, any> {
    const activeFieldsArray = activeFields(dto.fields);
    const subTableFkMap: Record<string, Record<string, string>> = {};
    for (const f of activeFieldsArray) {
      if (f.type !== 'relation' || f.relationType !== 'one-to-many') continue;
      if (!f.detailFields || f.detailFields.length === 0) continue;
      const singularMain = deriveMasterSingular(dto.tableName);
      const singularField = singularize(f.name);
      const subLcTable = (f.relationExistingTable && f.relationTable)
        ? `lc_${f.relationTable}`
        : `lc_${singularMain}_${singularField}`;
      const fkMap: Record<string, string> = {};
      const isExistingSubTable = !!(f.relationExistingTable && f.relationTable);
      const parentFkCol = isExistingSubTable ? (f.relationFkColumn || `${singularMain}_id`) : `${singularMain}_id`;
      fkMap[parentFkCol] = dto.tableName;
      for (const df of f.detailFields) {
        if (df.type === 'relation' && (df.relationType === 'many-to-one' || df.relationType === 'many-to-many') && df.relationTable) {
          fkMap[df.name] = `lc_${df.relationTable}`;
        }
      }
      subTableFkMap[subLcTable] = fkMap;
    }

    return {
      tableName: dto.tableName,
      visibilityStrategy: dto.visibilityStrategy ?? 'private',
      enabledTools: dto.agentConfig?.tools ?? ['query', 'create', 'update', 'delete', 'search', 'mock'],
      systemPrompt: dto.agentConfig?.systemPrompt ?? '',
      // 'code' is server-auto-generated; 'calculated' is virtual (computed on
      // read). Neither is ever user/agent-settable, so exclude them from the
      // agent's create/update/search field sets — otherwise the agent would
      // advertise computed fields as inputs and try to assign them (the values
      // get silently stripped by the DTO, but the behavior model would be wrong).
      creatableFields: activeFieldsArray.filter((f) => f.creatable && !(f.type === 'relation' && f.relationType === 'one-to-many') && f.type !== 'code' && f.type !== 'calculated'),
      editableFields: activeFieldsArray.filter((f) => f.editable && !(f.type === 'relation' && f.relationType === 'one-to-many') && f.type !== 'code' && f.type !== 'calculated'),
      searchableFields: activeFieldsArray.filter((f) => f.searchable && f.type !== 'calculated'),
      subTableFkMap,
    };
  }

  private async upsertApprovalFlowConfig(tableName: string, defaultChain: string[]): Promise<void> {
    const chain = defaultChain.length ? defaultChain : ['deptHead'];
    const config = { defaultChain: chain };
    const existing = await this.db
      .select()
      .from(sysApprovalFlows)
      .where(and(eq(sysApprovalFlows.businessType, tableName), isNull(sysApprovalFlows.deletedAt)))
      .limit(1);
    if (existing.length > 0) {
      await this.db
        .update(sysApprovalFlows)
        .set({ name: `${tableName} 审批`, config, enabled: true, updatedAt: new Date() })
        .where(eq(sysApprovalFlows.id, existing[0]!.id));
    } else {
      await this.db
        .insert(sysApprovalFlows)
        .values({ businessType: tableName, name: `${tableName} 审批`, config, enabled: true });
    }
  }

  private async verifyPhysicalSchema(
    tableName: string,
    fields: { name: string; type: string; relationType?: string; removed?: boolean }[],
  ): Promise<void> {
    const lcTable = `lc_${tableName}`;
    const SYSTEM_COLS = ['id', 'created_at', 'updated_at', 'deleted_at', 'created_by', 'updated_by', 'owner_id', 'shared_with'];
    const expected = new Set<string>(SYSTEM_COLS);
    for (const f of fields) {
      if (f.type === 'relation' && f.relationType === 'one-to-many') continue;
      if (f.removed) continue;
      if (f.name === 'id') continue;
      expected.add(f.name);
    }

    let actual: string[] = [];
    try {
      const res = await this.db.execute(
        sql`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ${lcTable} ORDER BY ordinal_position`,
      );
      actual = Array.from(res as any[]).map((r: any) => String(r.column_name));
    } catch (e: any) {
      this.logger.warn(` verifyPhysicalSchema: 读取 ${lcTable} 列失败,跳过校验: ${e?.message}`);
      return;
    }

    if (actual.length === 0) {
      throw new InternalServerErrorException(
        `drizzle-kit push 后物理表 ${lcTable} 不存在。请检查 push 输出,或在 server 目录手动执行 npx drizzle-kit push --force 后重试。`,
      );
    }

    const actualSet = new Set(actual);
    const missing = [...expected].filter((c) => !actualSet.has(c));
    const extra = actual.filter((c) => !expected.has(c));

    if (missing.length > 0) {
      throw new InternalServerErrorException(
        `drizzle-kit push 未将对齐物理表 ${lcTable}: 缺少期望列 [${missing.join(', ')}]` +
          (extra.length > 0 ? `;同时存在残留列 [${extra.join(', ')}]` : '') +
          `。建议确认数据可丢弃后手动执行 DROP TABLE ${lcTable},再重新触发生成。`,
      );
    }
    if (extra.length > 0) {
      this.logger.warn(` 物理表 ${lcTable} 存在 schema 未声明的列 [${extra.join(', ')}](可能为历史残留,已忽略)。`);
    }
  }

  // ── Job file persistence ──

  private get jobsDir(): string {
    return path.join(resolveProjectRoot(), '.tmp', 'generate-jobs');
  }

  private async writeJobStatus(jobId: string, status: GenerateJobStatus): Promise<void> {
    const dir = this.jobsDir;
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, `${jobId}.json`), JSON.stringify(status, null, 2), 'utf-8');
  }

  private async readJobStatus(jobId: string): Promise<GenerateJobStatus | null> {
    try {
      const data = await fs.readFile(path.join(this.jobsDir, `${jobId}.json`), 'utf-8');
      return JSON.parse(data) as GenerateJobStatus;
    } catch { return null; }
  }
}
