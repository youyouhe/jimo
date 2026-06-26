import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UpsertRuleDto } from './dto/upsert-rule.dto';

@Injectable()
export class BpmRulesService {
  private readonly logger = new Logger(BpmRulesService.name);
  private readonly bpmUrl: string;

  constructor(private readonly config: ConfigService) {
    this.bpmUrl = (this.config.get<string>('BPM_SERVICE_URL') || 'http://localhost:8090').replace(/\/$/, '');
  }

  async listRules(): Promise<unknown[]> {
    const res = await this.call('GET', 'dict/rules');
    return (res?.data ?? res) as unknown[];
  }

  async getRule(ruleName: string): Promise<unknown> {
    const res = await this.call('GET', `dict/rules/${encodeURIComponent(ruleName)}`);
    return res?.data ?? res;
  }

  async createRule(dto: UpsertRuleDto): Promise<unknown> {
    const res = await this.call('POST', 'dict/rules', dto);
    return res?.data ?? res;
  }

  async updateRule(ruleName: string, dto: UpsertRuleDto): Promise<unknown> {
    const res = await this.call('PUT', `dict/rules/${encodeURIComponent(ruleName)}`, dto);
    return res?.data ?? res;
  }

  async deleteRule(ruleName: string): Promise<void> {
    await this.call('DELETE', `dict/rules/${encodeURIComponent(ruleName)}`);
  }

  // ── HTTP helper ──────────────────────────────────────────────────────────────

  private async call(method: string, path: string, body?: unknown): Promise<any> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    try {
      const res = await fetch(`${this.bpmUrl}/bpm/api/${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', 'x-user-id': 'system' },
        body: body ? JSON.stringify(body) : undefined,
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
        const message = json?.message ?? json?.msg ?? text.slice(0, 200);
        this.logger.warn(`BPM ${method} ${path} -> ${res.status}: ${message}`);
        throw new BadRequestException(message || `BPM error ${res.status}`);
      }
      return json;
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      const msg = (err as Error).message;
      this.logger.warn(`BPM ${method} ${path} failed: ${msg}`);
      throw new BadRequestException(`BPM service unavailable: ${msg}`);
    } finally {
      clearTimeout(timer);
    }
  }
}
