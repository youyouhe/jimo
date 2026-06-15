import { Controller, Get, Inject } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { DATABASE_CONNECTION, DrizzleDb } from '../db/connection';
import { sql } from 'drizzle-orm';

interface HealthStatus {
  status: string;
  timestamp: string;
  uptime: number;
  db: string;
}

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
  ) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Health check' })
  async check(): Promise<HealthStatus> {
    let dbStatus = 'connected';

    try {
      await this.db.execute(sql`SELECT 1`);
    } catch {
      dbStatus = 'disconnected';
    }

    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      db: dbStatus,
    };
  }
}
