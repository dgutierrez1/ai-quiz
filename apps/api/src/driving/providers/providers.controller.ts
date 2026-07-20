import { ProviderListResponseSchema } from '@ai-quiz/shared';
import { Controller, Get } from '@nestjs/common';

import { PROVIDER_MATRIX, type ProviderId } from '../../adapters/llm/provider-matrix.js';

@Controller('config')
export class ProvidersController {
  @Get('providers')
  public list(): ReturnType<typeof ProviderListResponseSchema.parse> {
    const out: { [K in ProviderId]?: string[] } = {};
    for (const provider of Object.keys(PROVIDER_MATRIX) as ProviderId[]) {
      out[provider] = PROVIDER_MATRIX[provider].map((model) => model.id);
    }
    return ProviderListResponseSchema.parse(out);
  }
}
