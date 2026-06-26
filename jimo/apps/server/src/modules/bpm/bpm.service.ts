import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, asc, desc, eq, ilike, isNull, or, sql } from 'drizzle-orm';
import { DATABASE_CONNECTION, DrizzleDb } from '../../db/connection';
import {
  bpmProcessDefinitions,
  BpmProcessDefinition,
} from '../../db/schema/bpm-process-definitions';
import {
  bpmProcessVersions,
} from '../../db/schema/bpm-process-versions';
import {
  BpmnConverterService,
  LfGraphData,
} from '../../core/bpmn/bpmn-converter.service';
import { CreateProcessDto } from './dto/create-process.dto';
import { UpdateProcessDto } from './dto/update-process.dto';
import { QueryProcessDto } from './dto/query-process.dto';

export interface DeployResult {
  deploymentId: string;
  processKey: string;
  version: number;
  changeLog?: string;
  message: string;
}

export interface DeployStatusInfo {
  isDeployed: boolean;
  deployedVersionId: string | null;
  deployedVersionNumber: number | null;
  deployedAt: string | null;
  deploymentId: string | null;
  currentVersionId: string | null;
}

@Injectable()
export class BpmService {
  private readonly logger = new Logger(BpmService.name);
  private readonly bpmUrl: string;

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
    private readonly config: ConfigService,
    private readonly bpmnConverter: BpmnConverterService,
  ) {
    this.bpmUrl = (this.config.get<string>('BPM_SERVICE_URL') || 'http://localhost:8090').replace(/\/$/, '');
  }

  // ===================== CRUD =====================

  async create(dto: CreateProcessDto, createdBy: string): Promise<BpmProcessDefinition> {
    const rows = await this.db
      .insert(bpmProcessDefinitions)
      .values({
        name: dto.name,
        key: dto.key,
        description: dto.description ?? null,
        category: dto.category ?? null,
        icon: dto.icon ?? null,
        status: 'draft',
      })
      .returning();

    const created = rows[0]!;
    this.logger.log(`Created process definition ${created.id} (key=${created.key}) by user ${createdBy}`);
    return created;
  }

  async findAll(query: QueryProcessDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 10;
    const offset = (page - 1) * pageSize;

    const conditions: ReturnType<typeof and>[] = [];
    conditions.push(isNull(bpmProcessDefinitions.deletedAt));

    if (query.keyword) {
      const kw = `%${query.keyword}%`;
      conditions.push(
        or(
          ilike(bpmProcessDefinitions.name, kw),
          ilike(bpmProcessDefinitions.key, kw),
        )!,
      );
    }

    if (query.status) {
      conditions.push(eq(bpmProcessDefinitions.status, query.status));
    }

    if (query.category) {
      conditions.push(eq(bpmProcessDefinitions.category, query.category));
    }

    const orderFn = query.sortOrder === 'asc' ? asc : desc;
    let orderColumn;
    switch (query.sortBy) {
      case 'updatedAt':
        orderColumn = bpmProcessDefinitions.updatedAt;
        break;
      case 'name':
        orderColumn = bpmProcessDefinitions.name;
        break;
      case 'status':
        orderColumn = bpmProcessDefinitions.status;
        break;
      default:
        orderColumn = bpmProcessDefinitions.createdAt;
    }

    const [list, countRows] = await Promise.all([
      this.db
        .select()
        .from(bpmProcessDefinitions)
        .where(and(...conditions))
        .orderBy(orderFn(orderColumn))
        .limit(pageSize)
        .offset(offset),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(bpmProcessDefinitions)
        .where(and(...conditions)),
    ]);

    const total = countRows[0]?.count ?? 0;

    return { list, total, page, pageSize };
  }

  async findOne(id: string) {
    const rows = await this.db
      .select()
      .from(bpmProcessDefinitions)
      .where(and(eq(bpmProcessDefinitions.id, id), isNull(bpmProcessDefinitions.deletedAt)))
      .limit(1);

    if (!rows[0]) {
      throw new BadRequestException(`Process definition ${id} not found`);
    }

    const def = rows[0];

    // Join current version's lf_json if it exists
    let currentVersionLfJson: unknown = null;
    if (def.currentVersionId) {
      const verRows = await this.db
        .select({ lfJson: bpmProcessVersions.lfJson })
        .from(bpmProcessVersions)
        .where(and(eq(bpmProcessVersions.id, def.currentVersionId), isNull(bpmProcessVersions.deletedAt)))
        .limit(1);
      currentVersionLfJson = verRows[0]?.lfJson ?? null;
    }

    return { ...def, currentVersionLfJson };
  }

  async update(id: string, dto: UpdateProcessDto) {
    const existing = await this.findOne(id);

    // Update metadata fields
    const setData: Record<string, unknown> = { updatedAt: new Date() };
    if (dto.name !== undefined) setData.name = dto.name;
    if (dto.key !== undefined) setData.key = dto.key;
    if (dto.description !== undefined) setData.description = dto.description;
    if (dto.category !== undefined) setData.category = dto.category;
    if (dto.icon !== undefined) setData.icon = dto.icon;

    // If lfJson is provided, create a new version automatically
    if (dto.lfJson !== undefined) {
      const definitionName = (dto.name !== undefined ? dto.name : undefined) ?? existing.name;
      const version = await this.createVersion(id, { lfJson: dto.lfJson, name: definitionName, changeLog: 'Auto-saved via update' });
      setData.currentVersionId = version.id;
    }

    const updated = await this.db
      .update(bpmProcessDefinitions)
      .set(setData)
      .where(eq(bpmProcessDefinitions.id, id))
      .returning();

    this.logger.log(`Updated process definition ${id}`);
    return updated[0]!;
  }

  async remove(id: string) {
    const existing = await this.findOne(id);

    await this.db
      .update(bpmProcessDefinitions)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(bpmProcessDefinitions.id, id));

    this.logger.log(`Soft-deleted process definition ${id} (key=${existing.key})`);
    return { deleted: true };
  }

  // ===================== Versions =====================

  async getVersions(definitionId: string) {
    await this.findOne(definitionId); // ensures definition exists (not soft-deleted)

    const rows = await this.db
      .select()
      .from(bpmProcessVersions)
      .where(
        and(
          eq(bpmProcessVersions.definitionId, definitionId),
          isNull(bpmProcessVersions.deletedAt),
        ),
      )
      .orderBy(desc(bpmProcessVersions.version));

    return rows;
  }

  async createVersion(
    definitionId: string,
    dto: { lfJson: Record<string, unknown>; name?: string; changeLog?: string },
  ) {
    await this.findOne(definitionId); // ensures definition exists (not soft-deleted)

    // Auto-increment version: find current max, add 1
    const maxRes = await this.db
      .select({ maxVer: sql<number>`coalesce(max(${bpmProcessVersions.version}), 0)` })
      .from(bpmProcessVersions)
      .where(eq(bpmProcessVersions.definitionId, definitionId));

    const nextVersion = (maxRes[0]?.maxVer ?? 0) + 1;

    // Use the definition's current name if not provided
    let versionName = dto.name;
    if (!versionName) {
      const defRes = await this.db
        .select({ name: bpmProcessDefinitions.name })
        .from(bpmProcessDefinitions)
        .where(and(eq(bpmProcessDefinitions.id, definitionId), isNull(bpmProcessDefinitions.deletedAt)))
        .limit(1);
      versionName = defRes[0]?.name ?? 'Untitled';
    }

    const rows = await this.db
      .insert(bpmProcessVersions)
      .values({
        definitionId,
        version: nextVersion,
        name: versionName,
        lfJson: dto.lfJson,
        changeLog: dto.changeLog ?? null,
      })
      .returning();

    const created = rows[0]!;
    this.logger.log(`Created version ${created.version} for definition ${definitionId}`);
    return created;
  }

  async getVersion(definitionId: string, versionId: string) {
    const rows = await this.db
      .select()
      .from(bpmProcessVersions)
      .where(
        and(
          eq(bpmProcessVersions.id, versionId),
          eq(bpmProcessVersions.definitionId, definitionId),
          isNull(bpmProcessVersions.deletedAt),
        ),
      )
      .limit(1);

    if (!rows[0]) {
      throw new BadRequestException(`Version ${versionId} not found for definition ${definitionId}`);
    }

    return rows[0];
  }

  // ===================== Deploy =====================

  /**
   * Deploy a process version to the BPM Java engine.
   *
   * Converts the version's LF JSON to BPMN XML, posts it to the BPM Java
   * `/api/admin/deploy` endpoint, and records the deployment result on the
   * version and definition rows.
   *
   * @param definitionId  The process definition to deploy
   * @param versionId     Optional specific version id; if omitted, uses currentVersionId
   * @returns The deploy result including the Flowable deploymentId
   */
  async deployVersion(
    definitionId: string,
    versionId?: string,
  ): Promise<DeployResult> {
    const def = await this.findOne(definitionId);

    // Determine which version to deploy
    const targetVersionId = versionId ?? def.currentVersionId;
    if (!targetVersionId) {
      throw new BadRequestException(
        `Process definition "${def.name}" has no current version to deploy. Save the designer first.`,
      );
    }

    const version = await this.getVersion(definitionId, targetVersionId);

    // Guard: already deployed
    if (version.isDeployed) {
      throw new BadRequestException(
        `Version ${version.version} is already deployed (deploymentId=${version.deploymentId}). ` +
        `Create a new version to deploy changes.`,
      );
    }

    // Guard: must have LF JSON with at least one node
    if (!version.lfJson || typeof version.lfJson !== 'object') {
      throw new BadRequestException(
        `Version ${version.version} has no LogicFlow graph data. Save the designer before deploying.`,
      );
    }
    const graph = version.lfJson as unknown as LfGraphData;
    if (!graph.nodes?.length) {
      throw new BadRequestException(
        `Version ${version.version} has an empty canvas. Add at least a start event before deploying.`,
      );
    }

    // Convert LF JSON to BPMN XML
    let bpmnXml: string;
    try {
      bpmnXml = await this.bpmnConverter.lfJsonToBpmnXml(
        version.lfJson as unknown as LfGraphData,
        def.key,
        def.name,
      );
    } catch (err) {
      this.logger.error(`BPMN conversion failed for definition ${definitionId} version ${version.id}`, err);
      throw new BadRequestException(
        `Failed to convert process to BPMN XML: ${(err as Error).message}`,
      );
    }

    // Store the generated BPMN XML on the version for audit / retry
    await this.db
      .update(bpmProcessVersions)
      .set({ bpmnXml, updatedAt: new Date() })
      .where(eq(bpmProcessVersions.id, version.id));

    // Deploy to BPM Java
    const changeLog = version.changeLog ?? `Deploy v${version.version} of ${def.key}`;
    try {
      const res = await this.callBpm(
        'POST',
        `admin/deploy?processKey=${encodeURIComponent(def.key)}&changeLog=${encodeURIComponent(changeLog)}`,
        bpmnXml,
        'application/xml',
      );

      const deploymentId: string | undefined =
        res?.data?.deploymentId ?? res?.deploymentId;
      if (!deploymentId) {
        throw new BadRequestException(
          `BPM engine returned success but no deploymentId: ${JSON.stringify(res).slice(0, 200)}`,
        );
      }

      const now = new Date();

      // Mark version as deployed
      await this.db
        .update(bpmProcessVersions)
        .set({
          isDeployed: true,
          deployedAt: now,
          deploymentId,
          updatedAt: now,
        })
        .where(eq(bpmProcessVersions.id, version.id));

      // Update definition to point to this deployed version
      await this.db
        .update(bpmProcessDefinitions)
        .set({
          deployedVersionId: version.id,
          status: 'deployed',
          updatedAt: now,
        })
        .where(eq(bpmProcessDefinitions.id, definitionId));

      this.logger.log(
        `Deployed definition ${definitionId} key=${def.key} version=${version.version} -> deploymentId=${deploymentId}`,
      );

      return {
        deploymentId,
        processKey: def.key,
        version: version.version,
        changeLog,
        message: `Process ${def.key} v${version.version} deployed`,
      };
    } catch (err) {
      // If it's already a BadRequestException, re-throw directly
      if (err instanceof BadRequestException) throw err;

      const msg = (err as Error).message ?? String(err);
      this.logger.error(`Deploy failed for definition ${definitionId} version ${version.id}: ${msg}`);

      throw new BadRequestException(
        `Deploy to BPM engine failed: ${msg.slice(0, 200)}`,
      );
    }
  }

  /**
   * Get the current deployment status for a process definition.
   *
   * Returns whether any version is deployed, which version is active,
   * and the Flowable deployment identifier.
   */
  async getDeployStatus(definitionId: string): Promise<DeployStatusInfo> {
    const def = await this.findOne(definitionId);

    if (!def.deployedVersionId) {
      return {
        isDeployed: false,
        deployedVersionId: null,
        deployedVersionNumber: null,
        deployedAt: null,
        deploymentId: null,
        currentVersionId: def.currentVersionId ?? null,
      };
    }

    // Fetch the deployed version to get details
    const verRows = await this.db
      .select({
        version: bpmProcessVersions.version,
        deployedAt: bpmProcessVersions.deployedAt,
        deploymentId: bpmProcessVersions.deploymentId,
      })
      .from(bpmProcessVersions)
      .where(
        and(
          eq(bpmProcessVersions.id, def.deployedVersionId),
          isNull(bpmProcessVersions.deletedAt),
        ),
      )
      .limit(1);

    const ver = verRows[0];

    return {
      isDeployed: true,
      deployedVersionId: def.deployedVersionId,
      deployedVersionNumber: ver?.version ?? null,
      deployedAt: ver?.deployedAt?.toISOString() ?? null,
      deploymentId: ver?.deploymentId ?? null,
      currentVersionId: def.currentVersionId ?? null,
    };
  }

  // ===================== Import / Export =====================

  /**
   * Import a BPMN 2.0 XML string, parse it into LogicFlow JSON,
   * and create a new process definition with an initial version.
   *
   * Extracts the process name and key from the XML unless overridden
   * by the caller.
   */
  async importXml(
    dto: { xml: string; name?: string; key?: string; category?: string },
    createdBy: string,
  ): Promise<BpmProcessDefinition & { currentVersionLfJson?: unknown }> {
    const xml = dto.xml.trim();
    if (!xml) {
      throw new BadRequestException('XML content is required');
    }

    // Try to extract name and key from the BPMN XML process element
    const nameMatch = xml.match(/<process[^>]*\sname="([^"]*)"[^>]*>/i);
    const extractedName = nameMatch ? nameMatch[1] : undefined;

    const keyMatch = xml.match(/<process[^>]*\sid="([^"]*)"[^>]*>/i);
    const extractedKey = keyMatch ? keyMatch[1] : undefined;

    const name = dto.name || extractedName || 'Imported Process';
    let key = dto.key;

    if (!key) {
      // Try to use extracted key, or auto-generate from name
      key = extractedKey || name.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_|_$/g, '').slice(0, 100);
      // Ensure it starts with a letter
      if (key && !/^[a-z]/.test(key)) {
        key = 'proc_' + key;
      }
      if (!key || key.length < 1) {
        key = 'imported_process';
      }
      // Deduplicate: find all active keys matching "key" or "key_N" in one query
      const baseKey = key;
      const conflicts = await this.db
        .select({ key: bpmProcessDefinitions.key })
        .from(bpmProcessDefinitions)
        .where(
          and(
            or(
              eq(bpmProcessDefinitions.key, baseKey),
              ilike(bpmProcessDefinitions.key, `${baseKey}\\_%`),
            )!,
            isNull(bpmProcessDefinitions.deletedAt),
          ),
        );
      if (conflicts.length > 0) {
        const taken = new Set(conflicts.map((r) => r.key));
        let suffix = 1;
        while (suffix < 1000) {
          const candidate = `${baseKey}_${suffix}`.slice(0, 100);
          if (!taken.has(candidate)) { key = candidate; break; }
          suffix++;
        }
      }
    }

    // Convert XML to LogicFlow JSON
    let lfGraph: LfGraphData;
    try {
      lfGraph = await this.bpmnConverter.bpmnXmlToLfJson(xml);
    } catch (err: any) {
      throw new BadRequestException(`Failed to parse BPMN XML: ${err.message}`);
    }

    // Create the process definition
    const defRows = await this.db
      .insert(bpmProcessDefinitions)
      .values({
        name,
        key,
        description: null,
        category: dto.category ?? null,
        status: 'draft',
      })
      .returning();

    const def = defRows[0]!;

    // Create the initial version with the LF JSON and original BPMN XML
    const verRows = await this.db
      .insert(bpmProcessVersions)
      .values({
        definitionId: def.id,
        version: 1,
        name,
        lfJson: lfGraph as unknown as Record<string, unknown>,
        bpmnXml: xml,
        changeLog: 'Imported from BPMN XML',
      })
      .returning();

    const version = verRows[0]!;

    // Update the definition's current version pointer
    await this.db
      .update(bpmProcessDefinitions)
      .set({ currentVersionId: version.id, updatedAt: new Date() })
      .where(eq(bpmProcessDefinitions.id, def.id));

    this.logger.log(`Imported process definition ${def.id} (key=${key}) from BPMN XML, ${lfGraph.nodes.length} nodes, ${lfGraph.edges.length} edges`);

    return { ...def, currentVersionId: version.id, currentVersionLfJson: lfGraph };
  }

  /**
   * Export a process definition (or specific version) as BPMN 2.0 XML.
   *
   * If the version already has stored `bpmnXml`, returns it directly.
   * Otherwise, converts the version's `lfJson` to BPMN XML on the fly.
   *
   * @param definitionId  The process definition id
   * @param versionId     Optional specific version; if omitted, uses currentVersionId
   * @returns BPMN 2.0 XML string
   */
  async exportXml(definitionId: string, versionId?: string): Promise<string> {
    const def = await this.findOne(definitionId);

    const targetVersionId = versionId ?? def.currentVersionId;
    if (!targetVersionId) {
      throw new BadRequestException(
        `Process definition "${def.name}" has no versions to export. Save the designer first.`,
      );
    }

    const version = await this.getVersion(definitionId, targetVersionId);

    // Return stored BPMN XML if available
    if (version.bpmnXml) {
      return version.bpmnXml;
    }

    // Convert LF JSON to BPMN XML on the fly
    if (!version.lfJson || typeof version.lfJson !== 'object') {
      throw new BadRequestException(
        `Version ${version.version} has no graph data to export. Save the designer first.`,
      );
    }

    let bpmnXml: string;
    try {
      bpmnXml = await this.bpmnConverter.lfJsonToBpmnXml(
        version.lfJson as unknown as LfGraphData,
        def.key,
        def.name,
      );
    } catch (err: any) {
      throw new BadRequestException(
        `Failed to convert process to BPMN XML: ${err.message}`,
      );
    }

    // Store the generated XML for future exports
    await this.db
      .update(bpmProcessVersions)
      .set({ bpmnXml, updatedAt: new Date() })
      .where(eq(bpmProcessVersions.id, version.id));

    return bpmnXml;
  }

  // ==================== Private: BPM HTTP client ====================

  /**
   * Call the BPM Java service.
   *
   * Follows the same pattern as ApprovalService.callBpm() with AbortController
   * timeout, x-user-id header, and error normalization.
   *
   * @param method  HTTP method
   * @param path    URL path relative to /bpm/api/
   * @param body    Request body (string for XML, object for JSON)
   * @param contentType  Content-Type header (defaults to application/json)
   */
  private async callBpm(
    method: string,
    path: string,
    body: unknown,
    contentType: string = 'application/json',
  ): Promise<any> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000); // 30s timeout for deploy
    try {
      const res = await fetch(`${this.bpmUrl}/bpm/api/${path}`, {
        method,
        headers: {
          'Content-Type': contentType,
          'x-user-id': 'system',
        },
        body: typeof body === 'string' ? body : body ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
      const text = await res.text();
      let json: any = null;
      try {
        json = JSON.parse(text);
      } catch {
        /* non-JSON response */
      }
      if (!res.ok) {
        throw new BadRequestException(
          `BPM ${method} ${path} -> ${res.status} ${text.slice(0, 160)}`,
        );
      }
      return json;
    } finally {
      clearTimeout(timer);
    }
  }
}
