import { Injectable, Logger } from '@nestjs/common';

import type { LlmGenerationTrace, TracingPort } from '../../domain/ports/tracing.port.js';

export interface LangfuseConfig {
  readonly publicKey: string;
  readonly secretKey: string;
  readonly baseUrl: string;
}

/**
 * Langfuse ingestion over plain `fetch` (NFR-3 / spine AD-N9).
 *
 * Deliberately NOT the `langfuse` SDK: this adapter needs three HTTP calls, and
 * the SDK would add a dependency that must be dynamically imported anyway to
 * stay inside the 256 MB Fly free-tier footprint (AD-18).
 *
 * Two invariants hold for every method here:
 *   1. **It never throws.** Observability failing must never fail a quiz. Every
 *      network path is wrapped and downgraded to a debug log.
 *   2. **It never receives a raw user id.** Callers pass `userIdHash`
 *      (SHA-256). The credentials are used only for the Authorization header
 *      and are never logged — pino's redaction list covers `*_KEY`/`*_SECRET`,
 *      but the cheapest guarantee is simply not to put them in a log call.
 */
@Injectable()
export class LangfuseAdapter implements TracingPort {
  private readonly logger = new Logger(LangfuseAdapter.name);
  private readonly authHeader: string;
  private readonly baseUrl: string;
  private pending: Promise<unknown>[] = [];

  public constructor(private readonly config: LangfuseConfig) {
    this.authHeader = `Basic ${Buffer.from(`${config.publicKey}:${config.secretKey}`).toString('base64')}`;
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
  }

  public async recordGeneration(trace: LlmGenerationTrace): Promise<void> {
    // Fire-and-collect: we do not await the network here so a slow Langfuse
    // never lands on the user's critical path. `flush()` drains the batch.
    const body = {
      batch: [
        {
          id: `${Date.now()}-${Math.round(Math.random() * 1e9)}`,
          type: 'generation-create',
          timestamp: new Date().toISOString(),
          body: {
            name: trace.name,
            model: trace.model,
            input: trace.input,
            output: trace.output,
            metadata: {
              provider: trace.provider,
              latencyMs: trace.latencyMs,
              cacheHit: trace.cacheHit,
              sessionId: trace.sessionId,
              // SHA-256 hash only — never the raw users.id.
              userIdHash: trace.userIdHash,
              error: trace.error,
            },
            usage: {
              promptTokens: trace.promptTokens,
              completionTokens: trace.completionTokens,
            },
          },
        },
      ],
    };

    this.pending.push(this.post('/api/public/ingestion', body));
  }

  public async flush(): Promise<void> {
    const inFlight = this.pending;
    this.pending = [];
    await Promise.allSettled(inFlight);
  }

  public async deleteTracesOlderThan(cutoff: Date): Promise<{ readonly deletedCount: number }> {
    // Story 4.4: raw chat content captured in traces is scrubbed on the same
    // 7-day boundary as chat_messages, leaving trace metadata intact.
    try {
      const url = `${this.baseUrl}/api/public/traces?toTimestamp=${encodeURIComponent(cutoff.toISOString())}&limit=100`;
      const response = await fetch(url, {
        headers: { authorization: this.authHeader },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) return { deletedCount: 0 };

      const payload = (await response.json()) as { data?: { id?: string }[] };
      const ids = (payload.data ?? [])
        .map((row) => row.id)
        .filter((id): id is string => Boolean(id));
      if (ids.length === 0) return { deletedCount: 0 };

      // Langfuse caps bulk deletes; batch conservatively.
      let deleted = 0;
      for (let i = 0; i < ids.length; i += 30) {
        const batch = ids.slice(i, i + 30);
        const ok = await this.delete('/api/public/traces', { traceIds: batch });
        if (ok) deleted += batch.length;
      }
      return { deletedCount: deleted };
    } catch (error) {
      this.logger.debug(`langfuse retention sweep failed: ${String(error)}`);
      return { deletedCount: 0 };
    }
  }

  private async post(path: string, body: unknown): Promise<void> {
    try {
      await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: this.authHeader },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      // Swallow deliberately — see the class doc comment.
      this.logger.debug(`langfuse ingestion failed: ${String(error)}`);
    }
  }

  private async delete(path: string, body: unknown): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json', authorization: this.authHeader },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
      return response.ok;
    } catch (error) {
      this.logger.debug(`langfuse delete failed: ${String(error)}`);
      return false;
    }
  }
}
