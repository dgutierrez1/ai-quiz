import { BadRequestException, type PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';
export class ZodValidationPipe implements PipeTransform {
  public constructor(private readonly schema: ZodType) {}
  public transform(value: unknown): unknown {
    const result = this.schema.safeParse(value);
    if (!result.success)
      throw new BadRequestException(result.error.issues.map((issue) => issue.message).join('; '));
    return Object.freeze(result.data as object);
  }
}
