import { Injectable } from '@nestjs/common';

import type { LlmGenerationTrace, TracingPort } from '../../domain/ports/tracing.port.js';

/**
 * The binding used whenever Langfuse credentials are absent — i.e. every local
 * run and the whole test suite.
 *
 * This exists so that "no observability configured" is a supported, silent
 * state rather than a boot failure or a stream of warnings. Tracing is an
 * optimization, never a correctness dependency.
 */
@Injectable()
export class NoopTracingAdapter implements TracingPort {
  public async recordGeneration(_trace: LlmGenerationTrace): Promise<void> {
    // Intentionally empty.
  }

  public async flush(): Promise<void> {
    // Intentionally empty.
  }

  public async deleteTracesOlderThan(_cutoff: Date): Promise<{ readonly deletedCount: number }> {
    return { deletedCount: 0 };
  }
}
