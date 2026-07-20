import { existsSync, readFileSync } from 'node:fs';

import { z } from 'zod';

const ACCEPTED_SSLMODES = new Set(['require', 'verify-ca', 'verify-full']);
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

function loadDotEnvIfPresent(environment: Record<string, unknown>): void {
  // Minimal `.env` loader. `@nestjs/config` loads `.env` from cwd but
  // `validateEnv` is the single entry point used by `main.ts` / `migrate.ts`
  // BEFORE NestFactory creates the app — so we load it here. Format:
  // `KEY=VALUE` lines, no quoting, no expansion. Future stories may
  // promote this to `@nestjs/config`'s loader, but this story keeps the
  // dependency surface minimal.
  if (existsSync('.env')) {
    const text = readFileSync('.env', 'utf8');
    for (const rawLine of text.split('\n')) {
      const line = rawLine.trim();
      if (line === '' || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      const value = line.slice(eq + 1).trim();
      if (!(key in environment)) {
        environment[key] = value;
      }
    }
  }
}

// Zod schema: only the keys this story owns. Unknown env keys (provider
// keys, WEB_ORIGIN, etc. — Epic 2 onward) MUST pass through untouched;
// `.passthrough()` keeps them at runtime AND lets the static inferred type
// carry them so later stories can read them without TS errors.
const EnvironmentSchema = z
  .object({
    DATABASE_URL: z
      .string()
      .min(1, 'DATABASE_URL is required')
      .url('DATABASE_URL must be a valid URL')
      .refine((u) => /^postgres(ql)?:\/\//.test(u), {
        message: 'DATABASE_URL must start with postgres:// or postgresql://',
      }),
    API_PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    // Test-only seam. Comma-separated ports to serve from `@ai-quiz/test-doubles`
    // instead of the real adapter. This is the ONLY way a fake reaches the
    // container — `apps/api/src` contains no mock code and no `NODE_ENV==='test'`
    // branch, so an unset value can never silently degrade a real call.
    // An unrecognised name fails the boot rather than being ignored: a typo'd
    // `AI_QUIZ_FAKE_ADAPTERS=llmm` that quietly used the real adapter would burn
    // provider credits from a test run.
    AI_QUIZ_FAKE_ADAPTERS: z
      .string()
      .optional()
      .transform((raw) =>
        (raw ?? '')
          .split(',')
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0),
      )
      .pipe(z.array(z.enum(['llm', 'ingestion']))),
  })
  .passthrough();

export type FakeAdapterPort = 'llm' | 'ingestion';

export type AppEnvironment = z.infer<typeof EnvironmentSchema>;

export function validateEnv(environment: Record<string, unknown> = process.env): AppEnvironment {
  // If caller passed the default `process.env` (i.e. didn't pre-populate it),
  // load `.env` first so DATABASE_URL etc. resolve when run from the repo root.
  if (environment === process.env) {
    loadDotEnvIfPresent(environment);
  }

  const parsed = EnvironmentSchema.safeParse(environment);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'environment'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${details}`);
  }

  // Fake adapters fabricate content. Serving that to a real user is the worst
  // failure this system has — it looks entirely normal. Refuse to boot rather
  // than trusting a deploy to have got the env right. Checked here (imperative,
  // like the sslmode rule below) so it fires in `bootstrap()` BEFORE
  // `NestFactory.create`, and the process exits without handling one request.
  if (parsed.data.NODE_ENV === 'production' && parsed.data.AI_QUIZ_FAKE_ADAPTERS.length > 0) {
    throw new Error(
      `Invalid environment configuration: AI_QUIZ_FAKE_ADAPTERS is set to ` +
        `"${parsed.data.AI_QUIZ_FAKE_ADAPTERS.join(',')}" while NODE_ENV=production. ` +
        `Fake adapters fabricate quiz and chat content and must never serve real users.`,
    );
  }

  const databaseUrl = new URL(parsed.data.DATABASE_URL);

  if (databaseUrl.hostname === '') {
    throw new Error('Invalid DATABASE_URL: missing host');
  }

  const isLocalhost = LOCAL_HOSTS.has(databaseUrl.hostname);

  if (!isLocalhost) {
    const sslmode = (databaseUrl.searchParams.get('sslmode') ?? '').toLowerCase();
    if (!ACCEPTED_SSLMODES.has(sslmode)) {
      throw new Error(
        `Invalid DATABASE_URL: sslmode=${sslmode || '<missing>'} is required for non-local database hosts (accepted: ${[...ACCEPTED_SSLMODES].join(', ')})`,
      );
    }
  }

  return Object.freeze(parsed.data) as AppEnvironment;
}
