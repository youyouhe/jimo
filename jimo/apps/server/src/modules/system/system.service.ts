import {
  Injectable,
  Inject,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { eq, and, isNull, like, sql, count, inArray } from 'drizzle-orm';
import * as os from 'os';
import { DATABASE_CONNECTION, DrizzleDb } from '../../db/connection';
import { sysSystemConfigs, SysSystemConfig } from '../../db/schema/system-configs';
import { sysCleanupJobs } from '../../db/schema/cleanup-jobs';
import { CreateSystemConfigDto } from './dto/create-system-config.dto';
import { UpdateSystemConfigDto } from './dto/update-system-config.dto';
import { QuerySystemConfigDto } from './dto/query-system-config.dto';
import { DatabaseInfoDto } from './dto/database-info.dto';
import { MinioConfigDto, SaveMinioConfigDto } from './dto/minio-config.dto';
import { MinioService } from '../../core/minio/minio.service';
import { ApiErrorCode, PaginatedData } from '@jimo/shared';
import { SQL } from 'drizzle-orm';

export interface ServerInfo {
  platform: string;
  hostname: string;
  arch: string;
  release: string;
  uptime: number;
  cpus: {
    model: string;
    cores: number;
    speed: number;
  };
  memory: {
    total: number;
    free: number;
    used: number;
  };
  nodeVersion: string;
  loadavg: number[];
}

@Injectable()
export class SystemService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
    private readonly minioService: MinioService,
  ) {}

  async findAll(query: QuerySystemConfigDto): Promise<PaginatedData<SysSystemConfig>> {
    const { page, pageSize, key } = query;
    const offset = (page - 1) * pageSize;

    const conditions: SQL[] = [isNull(sysSystemConfigs.deletedAt)];

    if (key) {
      conditions.push(like(sysSystemConfigs.key, `%${key}%`));
    }

    const whereClause = and(...conditions);

    const [rows, totalRows] = await Promise.all([
      this.db
        .select()
        .from(sysSystemConfigs)
        .where(whereClause)
        .limit(pageSize)
        .offset(offset),
      this.db
        .select({ count: count() })
        .from(sysSystemConfigs)
        .where(whereClause),
    ]);

    const total = totalRows[0]?.count ?? 0;

    return { list: rows, total, page, pageSize };
  }

  async findOne(id: string): Promise<SysSystemConfig> {
    const rows = await this.db
      .select()
      .from(sysSystemConfigs)
      .where(and(eq(sysSystemConfigs.id, id), isNull(sysSystemConfigs.deletedAt)))
      .limit(1);

    if (rows.length === 0) {
      throw new NotFoundException({
        code: ApiErrorCode.RESOURCE_NOT_FOUND,
        message: `System config with id ${id} not found`,
      });
    }

    return rows[0]!;
  }

  async create(dto: CreateSystemConfigDto): Promise<SysSystemConfig> {
    const existing = await this.db
      .select()
      .from(sysSystemConfigs)
      .where(and(eq(sysSystemConfigs.key, dto.key), isNull(sysSystemConfigs.deletedAt)))
      .limit(1);

    if (existing.length > 0) {
      throw new ConflictException({
        code: ApiErrorCode.PARAM_ERROR,
        message: `System config key '${dto.key}' is already taken`,
      });
    }

    const rows = await this.db
      .insert(sysSystemConfigs)
      .values({
        key: dto.key,
        value: dto.value,
        desc: dto.desc ?? '',
      })
      .returning();

    return rows[0]!;
  }

  async update(id: string, dto: UpdateSystemConfigDto): Promise<SysSystemConfig> {
    const existing = await this.findOne(id);

    if (dto.key && dto.key !== existing.key) {
      const keyConflict = await this.db
        .select()
        .from(sysSystemConfigs)
        .where(and(eq(sysSystemConfigs.key, dto.key), isNull(sysSystemConfigs.deletedAt)))
        .limit(1);

      if (keyConflict.length > 0) {
        throw new ConflictException({
          code: ApiErrorCode.PARAM_ERROR,
          message: `System config key '${dto.key}' is already taken`,
        });
      }
    }

    type ConfigUpdateFields = {
      key?: string;
      value?: string;
      desc?: string;
      updatedAt?: Date;
    };

    const updateData: ConfigUpdateFields = {
      updatedAt: new Date(),
    };

    if (dto.key !== undefined) updateData.key = dto.key;
    if (dto.value !== undefined) updateData.value = dto.value;
    if (dto.desc !== undefined) updateData.desc = dto.desc;

    const rows = await this.db
      .update(sysSystemConfigs)
      .set(updateData)
      .where(and(eq(sysSystemConfigs.id, id), isNull(sysSystemConfigs.deletedAt)))
      .returning();

    return rows[0]!;
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);

    await this.db
      .update(sysSystemConfigs)
      .set({ deletedAt: sql`NOW()` })
      .where(and(eq(sysSystemConfigs.id, id), isNull(sysSystemConfigs.deletedAt)));
  }

  async batchRemove(ids: string[]): Promise<{ count: number }> {
    const rows = await this.db
      .update(sysSystemConfigs)
      .set({ deletedAt: sql`NOW()` })
      .where(and(inArray(sysSystemConfigs.id, ids), isNull(sysSystemConfigs.deletedAt)))
      .returning({ id: sysSystemConfigs.id });

    return { count: rows.length };
  }

  private async findByKey(key: string): Promise<SysSystemConfig | null> {
    const rows = await this.db
      .select()
      .from(sysSystemConfigs)
      .where(and(eq(sysSystemConfigs.key, key), isNull(sysSystemConfigs.deletedAt)))
      .limit(1);
    return rows[0] ?? null;
  }

  async getMinioConfig(): Promise<MinioConfigDto> {
    const get = async (key: string, envFallback: string): Promise<string> => {
      const row = await this.findByKey(key);
      if (row) return row.value;
      return process.env[envFallback] ?? '';
    };

    const endpoint = await get('minio.endpoint', 'MINIO_ENDPOINT');
    const portStr = await get('minio.port', 'MINIO_PORT');
    const accessKey = await get('minio.accessKey', 'MINIO_ACCESS_KEY');
    // secretKey is always masked
    await get('minio.secretKey', 'MINIO_SECRET_KEY');
    const bucket = await get('minio.bucket', 'MINIO_BUCKET');
    const useSSLStr = await get('minio.useSSL', 'MINIO_USE_SSL');

    return {
      endpoint,
      port: portStr ? parseInt(portStr, 10) : 9000,
      accessKey,
      secretKey: '******',
      bucket: bucket || 'jimo-dev',
      useSSL: useSSLStr === 'true',
    };
  }

  async saveMinioConfig(dto: SaveMinioConfigDto): Promise<void> {
    const fieldToKey: Record<string, string> = {
      endpoint: 'minio.endpoint',
      port: 'minio.port',
      accessKey: 'minio.accessKey',
      secretKey: 'minio.secretKey',
      bucket: 'minio.bucket',
      useSSL: 'minio.useSSL',
    };

    for (const [field, configKey] of Object.entries(fieldToKey)) {
      // Skip secretKey when the placeholder value is passed — do not overwrite DB
      if (field === 'secretKey' && dto.secretKey === '******') {
        continue;
      }

      const value = String((dto as unknown as Record<string, unknown>)[field]);
      const existing = await this.findByKey(configKey);

      if (existing) {
        await this.update(existing.id, { value });
      } else {
        await this.create({ key: configKey, value });
      }
    }

    // Resolve the actual secretKey for hot-reload
    let resolvedSecretKey: string;
    if (dto.secretKey !== '******') {
      resolvedSecretKey = dto.secretKey;
    } else {
      const row = await this.findByKey('minio.secretKey');
      resolvedSecretKey = row?.value ?? process.env['MINIO_SECRET_KEY'] ?? '';
    }

    await this.minioService.reinitialize({
      endpoint: dto.endpoint,
      port: dto.port,
      accessKey: dto.accessKey,
      secretKey: resolvedSecretKey,
      bucket: dto.bucket,
      useSSL: dto.useSSL,
    });
  }

  getDatabaseInfo(): DatabaseInfoDto {
    try {
      const url = process.env['DATABASE_URL'];
      if (!url) {
        return { host: '', port: 0, database: '', username: '', status: 'unavailable' };
      }
      const parsed = new URL(url);
      return {
        host: parsed.hostname,
        port: parseInt(parsed.port) || 5432,
        database: parsed.pathname.slice(1),
        username: parsed.username,
        status: 'connected',
      };
    } catch {
      return { host: '', port: 0, database: '', username: '', status: 'unavailable' };
    }
  }

  getServerInfo(): ServerInfo {
    const cpus = os.cpus();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();

    return {
      platform: os.platform(),
      hostname: os.hostname(),
      arch: os.arch(),
      release: os.release(),
      uptime: Math.floor(os.uptime()),
      cpus: {
        model: cpus[0]?.model || 'unknown',
        cores: cpus.length,
        speed: cpus[0]?.speed || 0,
      },
      memory: {
        total: totalMem,
        free: freeMem,
        used: totalMem - freeMem,
      },
      nodeVersion: process.version,
      loadavg: os.loadavg(),
    };
  }

  async getCleanupQueueStatus(): Promise<CleanupQueueStatus> {
    try {
      const [pending, running, failed, done] = await Promise.all([
        this.db.select({ cnt: count() }).from(sysCleanupJobs).where(eq(sysCleanupJobs.status, 'pending')).then(r => Number(r[0]?.cnt ?? 0)),
        this.db.select({ cnt: count() }).from(sysCleanupJobs).where(eq(sysCleanupJobs.status, 'running')).then(r => Number(r[0]?.cnt ?? 0)),
        this.db.select({ cnt: count() }).from(sysCleanupJobs).where(eq(sysCleanupJobs.status, 'failed')).then(r => Number(r[0]?.cnt ?? 0)),
        this.db.select({ cnt: count() }).from(sysCleanupJobs).where(eq(sysCleanupJobs.status, 'done')).then(r => Number(r[0]?.cnt ?? 0)),
      ]);

      const pendingJobs = await this.db
        .select({ id: sysCleanupJobs.id, tableName: sysCleanupJobs.tableName, jobType: sysCleanupJobs.jobType, createdAt: sysCleanupJobs.createdAt })
        .from(sysCleanupJobs).where(eq(sysCleanupJobs.status, 'pending')).orderBy(sysCleanupJobs.createdAt).limit(20);

      const failedJobs = await this.db
        .select({ id: sysCleanupJobs.id, tableName: sysCleanupJobs.tableName, jobType: sysCleanupJobs.jobType, error: sysCleanupJobs.error, createdAt: sysCleanupJobs.createdAt })
        .from(sysCleanupJobs).where(eq(sysCleanupJobs.status, 'failed')).orderBy(sysCleanupJobs.createdAt).limit(10);

      return { pending, running, failed, done, pendingJobs, failedJobs };
    } catch {
      return { pending: 0, running: 0, failed: 0, done: 0, pendingJobs: [], failedJobs: [] };
    }
  }
}

export interface CleanupQueueStatus {
  pending: number;
  running: number;
  failed: number;
  done: number;
  pendingJobs: { id: string; tableName: string; jobType: string; createdAt: Date }[];
  failedJobs: { id: string; tableName: string; jobType: string; error: string | null; createdAt: Date }[];
}
