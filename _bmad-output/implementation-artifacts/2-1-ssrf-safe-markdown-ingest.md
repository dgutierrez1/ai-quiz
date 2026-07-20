# Story 2.1: SSRF-safe markdown ingest

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want an arbitrary Markdown URL fetched safely,
so that I can quiz on real docs without the server being tricked into hitting internal networks.

## Acceptance Criteria

_(FR-1, AD-10)_

1. **Scheme allowlist.** Given a non-`http(s)` scheme (`file:`, `gopher:`, `ftp:`, or any other), then the fetch is rejected with `SsrfBlockedError` before any network call.
2. **Blocklisted host/IP rejected.** Given a blocklisted host or IP (localhost, `0.0.0.0`, IMDS hostnames, RFC1918, loopback, link-local, CGN `100.64/10`, Oracle IMDS `192.0.0/24`, benchmarking `198.18/15`, multicast, reserved, IPv6 ULA, 6to4), then it is rejected — including short-form IPv4 literals (`127.1`, `0`, decimal `2130706433`) via `net.isIP()`, and IPv4-mapped IPv6 (`::ffff:a.b.c.d`) normalized to `a.b.c.d` before the check.
3. **DNS-pin-then-validate.** Given DNS resolution, the validated IP is pinned and the actual socket connects to that literal IP (defeats DNS rebinding — no second lookup at connect time), and redirects are disabled entirely.
4. **Protocol/content edge cases.** Given an IDN homograph (punycode mismatch), an HTTP/0.9 response, or a response whose `Content-Type` is not `text/markdown` or `text/plain`, then it is rejected.
5. **GitHub blob rewrite.** Given a GitHub `blob` URL, it is rewritten to the `raw` form before the SSRF validation pipeline runs (so the validated/pinned target is the URL actually fetched).
6. **Streaming size + time cap.** Given an HTTP body larger than 10 MB or 10 s elapsed, the fetch aborts, and the 10 MB cap is enforced **during streaming decode**, never read from the `Content-Length` header — a server under-reporting its body size is still cut off mid-stream.
7. **Security suite.** Given the SSRF suite in `apps/api/test/security/`, it covers RFC1918 × IPv4/IPv6, loopback, IMDS hostnames, all non-`http(s)` schemes, and IDN homograph, with no real network calls.

## Tasks / Subtasks

- [ ] **Task 1 — Boundary schema + port** (AC: #1–#6)
  - [ ] In `packages/shared/src/schemas.ts`, add `IngestedDocumentSchema` (`.strict()`): `url` (string, url), `content` (string — raw, **not yet neutralized**), `contentType` (`z.enum(['text/markdown','text/plain'])`), `byteSize` (nonnegative int). Name it distinctly from the future `DocumentRowSchema` that Stories 2.2/2.6 will define for the `documents` table (AD-3 — one schema per _boundary_, not per entity; do not let this DTO become the DB row schema).
  - [ ] `apps/api/src/domain/ports/ingestion.port.ts` — `IngestionPort { fetchMarkdown(requestedUrl: string): Promise<IngestedDocumentDto> }`. Pure interface — no imports beyond the shared type.
- [ ] **Task 2 — Domain errors** (AC: #1, #2, #4, #6)
  - [ ] `apps/api/src/domain/quiz/errors/ssrf-blocked.error.ts` — `SsrfBlockedError(reason: string)`. Covers scheme rejection, blocklist hits, IDN homograph, HTTP/0.9.
  - [ ] `apps/api/src/domain/quiz/errors/doc-too-large.error.ts` — `DocTooLargeError(detail: string)`. Covers the 10 MB streaming-cap abort here; Story 2.2 reuses this same class for its 2 MB decoded / ~500 KB token-estimate / per-model-context checks (AD-N3) — do not create a second "too large" error type.
  - [ ] `apps/api/src/domain/quiz/errors/ingest-timeout.error.ts` — `IngestTimeoutError(detail: string)`. New in this story (not pre-named in the architecture source tree); covers the 10 s elapsed case distinctly from size.
  - [ ] All three extend `Error`, set `name`, contain no HTTP-status/code mapping — that mapping is wired where `GenerateQuizUseCase` catches them (**Story 2.4**), not here.
- [ ] **Task 3 — Blocklist contract** (AC: #2)
  - [ ] `apps/api/src/adapters/ingestion/ip-blocklist.ts` — export the CIDR ranges and hostname list verbatim from the Blocklist Contract table below as named constants, plus `isBlockedIpv4(ip)`, `isBlockedIpv6(ip)`, `normalizeIpv4MappedIpv6(ip)`, `isBlockedHostname(hostname)`. Hand-rolled bitwise/prefix matching — **no new npm dependency** for CIDR matching (consistent with the project's "no new infra unless load-bearing" posture; see Open Questions #1 for the one genuinely new dependency this story does need).
  - [ ] Unit-test every range from the Blocklist Contract table with an in-range and an adjacent out-of-range address (off-by-one boundary tests, e.g. `172.15.255.255` allowed vs `172.16.0.0` blocked).
- [ ] **Task 4 — `validate-and-resolve-target`** (AC: #1, #2, #3, #4)
  - [ ] `apps/api/src/adapters/ingestion/validate-and-resolve-target.ts` — `validateAndResolveTarget(url: string, deps?: { resolveHostname?: typeof dns.promises.lookup }): Promise<{ ip: string; hostname: string; port: number; protocol: 'http:'|'https:' }>`.
  - [ ] Scheme check first (AC #1) — reject anything but `http:`/`https:` with zero DNS work.
  - [ ] Hostname blocklist check (case-insensitive exact match against `localhost`, `0.0.0.0`, `metadata.google.internal`, `metadata.amazonaws.com`) **before** DNS resolution.
  - [ ] If the hostname is itself an IP literal, parse with `net.isIP()` (handles short-form/decimal) and validate directly — no DNS call.
  - [ ] Otherwise resolve **all** A/AAAA records (`{ all: true }`) and validate **every** returned address — reject if any is blocklisted (an attacker-controlled domain can round-robin one benign + one internal IP).
  - [ ] Normalize IPv4-mapped IPv6 (`::ffff:a.b.c.d` → `a.b.c.d`) before applying the IPv4 blocklist, for both literals and DNS answers.
  - [ ] IDN homograph check on the hostname (AC #4) — see Dev Notes for the recommended heuristic; this is a security-sensitive judgment call flagged in Open Questions #2.
  - [ ] `deps.resolveHostname` defaults to `dns.promises.lookup`; accepting an override is what makes the security suite (Task 8) able to inject fixture DNS answers (e.g. "resolves to `169.254.169.254`") **without any real network or DNS call**.
  - [ ] On any violation, throw `SsrfBlockedError` with a specific (but non-leaky) reason.
- [ ] **Task 5 — GitHub blob → raw rewrite** (AC: #5)
  - [ ] `apps/api/src/adapters/ingestion/github-blob-to-raw.ts` — `rewriteGithubBlobUrl(url: string): string`. Matches `https://github.com/{owner}/{repo}/blob/{ref}/{path}` → `https://raw.githubusercontent.com/{owner}/{repo}/{ref}/{path}`; non-matching URLs pass through unchanged.
  - [ ] Runs **before** `validateAndResolveTarget` in the composed adapter (Task 7) — the validated/pinned target must be the URL that is actually fetched, not the original `github.com` blob URL.
- [ ] **Task 6 — `stream-fetch-with-cap`** (AC: #3, #4, #6)
  - [ ] `apps/api/src/adapters/ingestion/stream-fetch-with-cap.ts` — `streamFetchWithCap(target: {ip, hostname, port, protocol}, originalUrl: string): Promise<{content: string; contentType: string; byteSize: number}>`.
  - [ ] Use `undici.request()` (not the global `fetch()` — see Dev Notes for why) with a `dispatcher`/`Agent` connected to the **literal validated IP** from `target.ip`, while sending `Host: target.hostname` explicitly so TLS SNI and virtual-hosted targets (e.g. GitHub's raw CDN) still resolve correctly.
  - [ ] `maxRedirections: 0` (AC #3 — redirects disabled entirely, no exceptions).
  - [ ] `headersTimeout: 10_000` and `bodyTimeout: 10_000` (AC #6 — see Open Questions #5 on the exact 10 s semantics).
  - [ ] Reject if the response has no parseable HTTP status line (HTTP/0.9) — see Dev Notes.
  - [ ] Reject if `Content-Type` is not exactly `text/markdown` or `text/plain` (ignoring `; charset=...` suffix) — check **before** consuming the body.
  - [ ] Stream the body via the async-iterable interface, accumulating bytes and aborting with `DocTooLargeError` the instant accumulated bytes exceed 10 MB — **never** trust `Content-Length` as the authority (a value under 10 MB there does not exempt the stream from the check).
  - [ ] On the 10 s deadline firing, abort and throw `IngestTimeoutError`.
- [ ] **Task 7 — `HttpMarkdownAdapter`** (AC: #1–#6)
  - [ ] `apps/api/src/adapters/ingestion/http-markdown.adapter.ts` — `HttpMarkdownAdapter implements IngestionPort`. `fetchMarkdown(requestedUrl)` composes: `rewriteGithubBlobUrl` → `validateAndResolveTarget` → `streamFetchWithCap` → `Object.freeze(IngestedDocumentSchema.parse(raw))` (AD-3 canonical adapter pattern).
  - [ ] No NestJS `@Injectable()` registration or module wiring in this story — see Scope Boundary. The class is exported and unit-testable standalone; Story 2.4 registers it in the DI graph when `GenerateQuizUseCase` first needs it.
- [ ] **Task 8 — Security suite** (AC: #7)
  - [ ] `apps/api/test/security/ssrf.security.test.ts` — using the `resolveHostname` injection point from Task 4, assert rejection for: every scheme in AC #1; every CIDR range in the Blocklist Contract (IPv4 and IPv6 forms, plus the IPv4-mapped-IPv6 variant of each); all four blocklisted hostnames; an IDN homograph fixture (e.g. a Cyrillic-`а` domain punycode-decoding to something visually confusable with a Latin domain). **No test in this file makes a real DNS or network call.**
  - [ ] Also assert the redirect-disabled and HTTP/0.9 behaviors here if they can be expressed without real network I/O; otherwise place them in Task 9 against a local server.
- [ ] **Task 9 — Plumbing tests against a local server** (AC: #3, #4, #6)
  - [ ] `apps/api/test/ingestion/stream-fetch-with-cap.test.ts` — spin up `http.createServer()` on `127.0.0.1` (ephemeral port) and call `streamFetchWithCap` **directly** with that literal IP as the pre-validated target (this function does not re-run SSRF checks, so pointing it at loopback in a test is legitimate and does not weaken the adapter — see Dev Notes "Testability design"). Cover: >10 MB streamed body aborts before completion regardless of a lying `Content-Length`; a response that never completes within 10 s aborts; non-markdown `Content-Type` rejected; a raw-socket HTTP/0.9-style response (no status line) rejected; a `301` response is **not** followed (`maxRedirections: 0`).
  - [ ] `apps/api/test/ingestion/github-blob-to-raw.test.ts` — matching and non-matching URL fixtures.
  - [ ] `apps/api/test/ingestion/http-markdown.adapter.test.ts` — composition test proving the pipeline order (rewrite → validate → stream) and that a successful fetch returns a frozen `IngestedDocumentDto`.
  - [ ] Adapter coverage floor ≥ 60% (NFR-4/AD-N10). Run `pnpm --filter @ai-quiz/shared test && pnpm --filter @ai-quiz/api test`, then `pnpm verify`.

## Dev Notes

### Scope boundary — read this first

This story delivers **one adapter, one port, three domain errors, and their tests — nothing else.** Epic 2's remaining six stories are being written and implemented concurrently; the table below exists to stop scope bleed in both directions.

| Do NOT build here                                                                                                                                                                                                                                  | Owned by                                                                                    |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Neutralization (`neutralize.ts` — strip injection vectors, NFKC normalize)                                                                                                                                                                         | **Story 2.2**                                                                               |
| Chunking by headings (`chunker.ts`)                                                                                                                                                                                                                | **Story 2.2**                                                                               |
| 2 MB decoded-markdown cap, ~500 KB token-estimate cap, per-model context-window check, content-density (`DOC_TOO_SHORT`) check (AD-N3)                                                                                                             | **Story 2.2** — this story's only size cap is the 10 MB **HTTP body streaming** cap (AC #6) |
| Provider/model capability matrix, `MastraLlmAdapter`, `GET /api/config/providers`                                                                                                                                                                  | **Story 2.3**                                                                               |
| `POST /api/sessions` request contract (`strategy`, `questionCount`, `topic`, `provider`, `model` validation) — the Story 1.4 stub only accepts `sourceUrl`                                                                                         | **Story 2.4**                                                                               |
| `GenerateQuizUseCase` orchestration — wiring this adapter into the `fetch → neutralize → chunk → …` critical path, and the HTTP-status/error-code mapping for `SsrfBlockedError`/`DocTooLargeError`/`IngestTimeoutError` (e.g. `400 SSRF_BLOCKED`) | **Story 2.4**                                                                               |
| LLM question-pool generation, grounding check, secret-shaped-token check (FR-15 output-side)                                                                                                                                                       | **Story 2.4**                                                                               |
| `documents` table, migration, RLS policy, persistence of `content_markdown`/`chunks`/`content_hash`/`byte_size`/`token_estimate`                                                                                                                   | **Story 2.6**                                                                               |
| Category selection, stratified draw, `knowledge_categories`                                                                                                                                                                                        | **Story 2.5**                                                                               |
| Landing page, provider dropdown, any `apps/web` work                                                                                                                                                                                               | **Story 2.7**                                                                               |

This story also does **not** touch `apps/web`, the DB, NestJS module registration, or the `documents` schema in any form. `HttpMarkdownAdapter` is a plain exported class — Story 2.4 is responsible for `@Injectable()`-wrapping it (if needed) and adding it to a module's providers.

### Architecture compliance (binding)

- **AD-1/AD-2 — hexagonal + domain purity.** `IngestionPort` and the three error classes live under `domain/` and must not import `undici`, `node:fetch`, `@nestjs/*`, or `drizzle-orm` — Story 1.1's `no-restricted-imports` ESLint rule enforces this. All actual I/O (`undici`, `node:dns`, `node:net`) lives under `adapters/ingestion/`.
- **AD-3 — Zod DTOs at every boundary.** `HttpMarkdownAdapter.fetchMarkdown` must return `Object.freeze(IngestedDocumentSchema.parse(raw))` — this is a genuine adapter boundary (raw undici response → domain), not just a DB/HTTP-request boundary; AD-3's canonical pattern applies to every adapter, not only repositories.
- **AD-10 — the binding rule for this entire story.** Re-read it in full before starting; the Blocklist Contract below is a literal transcription of its enumerated ranges plus the PRD §10.1 hostname list, not a paraphrase.
- **AD-N3 (pointer, not owned here)** — the tiered doc-size guard's _other two_ tiers (2 MB decoded, ~500 KB token estimate) are Story 2.2's. Do not implement them here even though they share the "size guard" theme with AC #6.
- **Consistency Conventions** — kebab-case filenames, `*.port.ts`/`*.adapter.ts` suffixes, PascalCase classes. `@ai-quiz/no-console-log` applies outside `apps/api/src/adapters/` — this story's adapter code is exempt from that rule but should still avoid stray `console.log`; use the Nest `Logger` only where a NestJS context actually exists (it doesn't in this story — plain classes only).

### Blocklist Contract (transcribed from AD-10 / PRD §10.1 — implement exactly this)

**IPv4 CIDR blocklist:**

| Range            | Reason                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------- |
| `0.0.0.0/8`      | "this network"                                                                              |
| `10.0.0.0/8`     | RFC1918                                                                                     |
| `100.64.0.0/10`  | CGN (RFC6598)                                                                               |
| `127.0.0.0/8`    | loopback                                                                                    |
| `169.254.0.0/16` | link-local — **includes cloud IMDS `169.254.169.254`** (AWS + GCP both use this literal IP) |
| `172.16.0.0/12`  | RFC1918                                                                                     |
| `192.0.0.0/24`   | IETF protocol assignments — **includes Oracle Cloud IMDS `192.0.0.192`**                    |
| `192.168.0.0/16` | RFC1918                                                                                     |
| `198.18.0.0/15`  | benchmarking                                                                                |
| `224.0.0.0/4`    | multicast                                                                                   |
| `240.0.0.0/4`    | reserved/future-use (also covers `255.255.255.255` broadcast)                               |

**IPv6 CIDR blocklist:**

| Range           | Reason                                                                                                                                       |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `::1/128`       | loopback                                                                                                                                     |
| `fc00::/7`      | ULA                                                                                                                                          |
| `fe80::/10`     | link-local                                                                                                                                   |
| `ff00::/8`      | multicast                                                                                                                                    |
| `2002::/16`     | 6to4                                                                                                                                         |
| `::ffff:0:0/96` | IPv4-mapped IPv6 — **normalize to the embedded IPv4 address and re-check against the IPv4 table above; do not treat this range as terminal** |

**Hostname blocklist** (case-insensitive exact match, checked before DNS resolution): `localhost`, `0.0.0.0`, `metadata.google.internal`, `metadata.amazonaws.com`.

### Testability design (read before implementing — this is the load-bearing structural decision)

There is a genuine tension: the adapter must **refuse** loopback/private targets, but the plumbing tests (streaming cap, timeout, HTTP/0.9, redirect-disabled, content-type) need a **controllable local server**, which necessarily lives at `127.0.0.1` — a blocklisted address. Splitting the adapter into two independently-testable functions resolves this cleanly and is the required shape, not just a suggestion:

1. **`validateAndResolveTarget`** (Task 4) — does _only_ SSRF validation and DNS resolution. It never makes an HTTP request. Its `resolveHostname` dependency is injectable, so the security suite (Task 8, AC #7) can fabricate "this hostname resolves to `169.254.169.254`" or "this hostname resolves to `10.0.0.5`" fixtures with **zero real DNS or network calls** — fast, deterministic, and exhaustive over the Blocklist Contract table.
2. **`streamFetchWithCap`** (Task 6) — takes an **already-validated** `{ip, hostname, port, protocol}` and does _only_ the streaming HTTP mechanics. It performs no SSRF checks of its own — that would be redundant re-validation of a decision already made. Because of this, its tests (Task 9) are free to legitimately point it at a local `http.createServer()` on `127.0.0.1` to exercise the streaming-cap/timeout/content-type/HTTP-0.9/redirect behaviors, since in production this function is never reachable with an unvalidated target.
3. **`HttpMarkdownAdapter.fetchMarkdown`** (Task 7) composes the two in order, plus the GitHub rewrite. This is the only piece integration-tested end-to-end (Task 9's `http-markdown.adapter.test.ts`), and it's where AC #7's "no real network calls" guarantee lives for the _security_ suite specifically — the composition test may use a local server since it's proving wiring, not blocklist coverage.

Do not collapse these into one function — it either makes the security suite unable to run without a real network, or it makes the plumbing tests unable to run at all without weakening the production blocklist.

### Why `undici.request()`, not the global `fetch()`

Pinning the TCP connection to a pre-validated literal IP while still sending the correct `Host` header (required for TLS SNI and virtual-hosted origins like GitHub's raw CDN) needs direct control over the connection dispatcher. The global `fetch()` global does not offer this cleanly. `undici.request()` accepts a `dispatcher`/custom `Agent` whose connector can be pinned to a literal IP, plus first-class `maxRedirections`, `headersTimeout`, and `bodyTimeout` options, and a streaming body you can accumulate and abort manually — exactly what AC #3 and #6 require. This is also why AD-2 explicitly forbids `undici` (and `node:fetch`) from the domain layer: the project's adapters are expected to import `undici` directly, which only makes sense if this story (the first ingestion adapter) actually does so.

### HTTP/0.9 rejection

HTTP/0.9 responses have no status line and no headers at all — they predate both. `undici.request()` expects a well-formed status line and will error on a true HTTP/0.9 response rather than silently accepting it; treat any such low-level parse failure as a rejection (`SsrfBlockedError`), and add a raw-socket test fixture (a `net.createServer` that writes body bytes with no `HTTP/1.1 200 …` line at all) to prove the rejection path is real rather than assumed — do not accept "undici probably throws" as sufficient without the test.

### IDN homograph detection

No planning artifact specifies the exact algorithm, only the outcome: "reject punycode mismatch." Node's `URL` class auto-converts non-ASCII hostnames to their `xn--` punycode form. The standard mitigation (same approach browsers use) is: if a hostname label starts with `xn--`, decode it back to Unicode and reject if the decoded label mixes characters from more than one Unicode script (e.g. Latin + Cyrillic) — a legitimate IDN is almost always single-script. This needs either the `punycode` npm package's `.decode()` or a hand-rolled Unicode-script-range check; no version is pinned anywhere (see Open Questions #2) — treat the exact library choice as an implementation-time decision, not a blocker, but do not ship the AC unenforced.

### Anti-pattern watchlist

- ❌ Trusting `Content-Length` as the size-cap authority — must count actual streamed bytes (AC #6 is explicit that a lying header must not exempt the stream).
- ❌ Letting the connection's own DNS resolution happen at connect time after validation — this is the exact TOCTOU that DNS rebinding exploits. Pin the literal validated IP for the socket connect.
- ❌ Forgetting the `Host` header when connecting to the pinned IP — breaks TLS SNI and produces false negatives against multi-tenant/CDN targets (GitHub's raw CDN in particular).
- ❌ Checking only the first DNS answer — validate every resolved A/AAAA record.
- ❌ Normalizing IPv4-mapped IPv6 for literal-IP input but forgetting to do it for DNS-resolved answers too (or vice versa).
- ❌ Implementing the 2 MB decoded cap, content-density check, or neutralization here — out of scope (Story 2.2).
- ❌ Wiring this adapter into `POST /api/sessions` or `GenerateQuizUseCase`, or adding NestJS module registration — out of scope (Story 2.4).
- ❌ Creating the `documents` table or any migration — out of scope (Story 2.6).
- ❌ Using the global `fetch()` instead of `undici.request()` — makes IP-pinning-with-correct-Host materially harder to get right.
- ❌ Re-running SSRF validation inside `streamFetchWithCap` "for safety" — it is redundant by design and is precisely what breaks the local-server plumbing tests (see Testability design).

### Testing Requirements

- **Framework:** Vitest (`4.1.10`). Security tests in `apps/api/test/security/` (AC #7); plumbing/unit tests in `apps/api/test/ingestion/`.
- **No real network or DNS calls anywhere in this story's tests** — the security suite uses the injectable `resolveHostname`; the plumbing suite uses local `http.createServer()`/`net.createServer()` instances on ephemeral `127.0.0.1` ports called _directly_ against `streamFetchWithCap` (which performs no SSRF check of its own — see Testability design).
- **Coverage floor:** adapters ≥ 60% (NFR-4/AD-N10) — this story's code is 100% adapter-layer, so hold it well above the floor given how security-critical it is.
- Run before completing: `pnpm --filter @ai-quiz/shared test && pnpm --filter @ai-quiz/api test`, then `pnpm verify` (`lint:check && typecheck && test && test:e2e && build`).
- No Playwright work — no web surface exists yet (first UI is Story 2.7).

### Project Structure Notes

New files only — this is a greenfield addition on top of the Story 1.1–1.5 skeleton; no existing files require reading beyond confirming `apps/api/src/domain/{ports,quiz/errors}/` and `apps/api/src/adapters/` exist as empty directories from Story 1.1.

```
apps/api/src/
  domain/
    ports/
      ingestion.port.ts                      NEW
    quiz/errors/
      ssrf-blocked.error.ts                  NEW
      doc-too-large.error.ts                 NEW
      ingest-timeout.error.ts                NEW
  adapters/ingestion/
    ip-blocklist.ts                          NEW
    validate-and-resolve-target.ts           NEW
    github-blob-to-raw.ts                    NEW
    stream-fetch-with-cap.ts                 NEW
    http-markdown.adapter.ts                 NEW
apps/api/test/
  security/
    ssrf.security.test.ts                    NEW
  ingestion/
    github-blob-to-raw.test.ts               NEW
    stream-fetch-with-cap.test.ts            NEW
    http-markdown.adapter.test.ts            NEW
packages/shared/src/schemas.ts               UPDATE — add IngestedDocumentSchema
apps/api/package.json                        UPDATE — add `undici` dependency (version TBD, see Open Questions #1)
```

Aligns with the spine's Minimal Source Tree (`adapters/ingestion/ssrf-safe-fetch.ts`, `GithubBlobToRaw.ts`) with two deliberate variances recorded here: (1) kebab-case filenames per the Consistency Conventions table and the precedent Story 1.4 already set when it resolved the same PascalCase-vs-kebab-case tension in the spine's own source tree; (2) the single `ssrf-safe-fetch.ts` file named in the spine is split into `validate-and-resolve-target.ts` + `stream-fetch-with-cap.ts` + `http-markdown.adapter.ts` for the testability reasons above — the spine names the _capability_, not a mandated single-file layout.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.1: SSRF-safe markdown ingest] — the 7 ACs
- [Source: _bmad-output/planning-artifacts/epics.md#Epic 2: Generate a grounded quiz from any URL] — epic boundary note, sibling-story scope
- [Source: _bmad-output/planning-artifacts/architecture/architecture-ai-quiz-2026-07-16/ARCHITECTURE-SPINE.md#AD-10 — SSRF defense with expanded IP blocklist] — the binding rule
- [Source: .../ARCHITECTURE-SPINE.md#AD-1, #AD-2] — hexagonal + domain purity
- [Source: .../ARCHITECTURE-SPINE.md#AD-3] — canonical adapter pattern, per-boundary schema naming
- [Source: .../ARCHITECTURE-SPINE.md#AD-N3] — the two size-guard tiers this story does NOT own
- [Source: .../ARCHITECTURE-SPINE.md#Consistency Conventions] — naming, `pnpm verify` gate
- [Source: .../ARCHITECTURE-SPINE.md#Minimal source tree] — `adapters/ingestion/` file names (spine baseline; variance recorded above)
- [Source: .../ARCHITECTURE-SPINE.md#Structural Seed → Container/module view] — `IngAd[adapters/ingestion/ HttpMarkdownAdapter, GithubBlobToRaw]`
- [Source: _bmad-output/planning-artifacts/prds/prd-ai-quiz-2026-07-16/prd.md#FR-1] — SSRF-safe markdown ingest
- [Source: prd.md#10.1 Security] — full blocklist enumeration, hostname list
- [Source: _bmad-output/planning-artifacts/specs/architecture-spec.md#A.4 Repo Layout] — `adapters/ingestion/{ssrf-safe-fetch.ts, GithubBlobToRaw.ts}`
- [Source: architecture-spec.md#A.7 Agent Flows step 1] — ingestion is step 1 of the sync critical path (owned end-to-end by Story 2.4; this story is a prerequisite building block)
- [Source: _bmad-output/project-context.md#Security Rules 1] — SSRF defense rule, restated
- [Source: AGENTS.md#Security] — SSRF summary, "stop and ask before changing security controls"
- [Source: _bmad-output/implementation-artifacts/1-1-monorepo-scaffold-and-tooling-gate.md] — hexagonal layer contract, kebab-case naming precedent, `no-restricted-imports` enforcement
- [Source: _bmad-output/implementation-artifacts/1-3-api-skeleton-db-foundation-and-health-endpoints.md] — sub-check extensibility pattern, testing conventions
- [Source: _bmad-output/implementation-artifacts/1-4-per-session-ownership-walking-skeleton-sessions-endpoint.md] — `SsrfBlockedError`/`DocTooLargeError` naming source (domain/quiz/errors/ listing), kebab-case-wins ruling, AD-3 per-boundary schema naming precedent
- [Source: _bmad-output/implementation-artifacts/1-5-network-hardening-rate-limiting-cors-helmet-error-shape.md] — `{error:{code,message,requestId}}` envelope (consumed by Story 2.4 when it maps these errors, not by this story)

### Open Questions / Spec Gaps (non-blocking — flagged for the human)

1. **`undici` version is unpinned.** No planning artifact lists a version for the `undici` npm package in any Stack table, despite AD-2 forbidding its import from `domain/` (which only makes sense if adapters use it directly — this story is the first to do so). Verify the current stable version at implementation time (`pnpm view undici version`), following the exact precedent Story 1.1 set for `pnpm`/`typescript`/`eslint`.
2. **IDN homograph algorithm is unspecified.** AD-10 mandates the outcome ("reject punycode mismatch") but no artifact names a library or exact heuristic. This story recommends the standard mixed-script-confusable check (see Dev Notes) but the exact implementation (hand-rolled vs. the `punycode` npm package) is left open.
3. **`documents.content_hash` (SHA-256) ownership is unassigned.** The spine's Consistency Conventions table says hashing happens "at ingest" for tamper detection, but this story never touches the `documents` table (Story 2.6 owns persistence) and no artifact names which story computes the hash. Recommendation: do **not** compute it here; flag for Story 2.2 or 2.6 (whichever first holds both the raw bytes and a DB write) to resolve explicitly.
4. **`IngestTimeoutError` is a new name, not pre-existing.** The architecture source tree names only `SsrfBlockedError` and `DocTooLargeError` under `domain/quiz/errors/`. This story introduces a third error for the 10 s-elapsed case since it is a distinct, independently-testable failure mode from either SSRF or size — confirm the name survives code review rather than being folded into one of the other two.
5. **10 s timeout semantics.** AD-10 states "10s timeout" without specifying whether it is a single wall-clock budget for the whole request or applies per-phase. This story's ruling: apply the same 10,000 ms budget to both `headersTimeout` and `bodyTimeout` independently (undici's two native knobs) rather than hand-rolling a combined wall-clock timer — simpler, and a reasonable reading of "10s timeout," but flagged in case a stricter single-budget interpretation is intended.

## Dev Agent Record

### Agent Model Used

_(to be filled by the dev agent)_

### Debug Log References

### Completion Notes List

### File List
