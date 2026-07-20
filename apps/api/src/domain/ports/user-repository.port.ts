import type { UserRow } from '@ai-quiz/shared';

export type InternalUserId = string & { readonly __brand: 'InternalUserId' };

export interface UserRepositoryPort {
  upsertByExternalId(externalId: string): Promise<Readonly<UserRow>>;
}
