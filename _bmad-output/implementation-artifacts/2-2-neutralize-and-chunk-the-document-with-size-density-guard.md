# Story 2.2: Neutralize & chunk the document, with size/density guard

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want my document cleaned of injection vectors and size-checked before generation,
so that untrusted markdown can't steer the model and oversized/tiny docs fail fast with a clear hint.

## Acceptance Criteria

_(FR-15 ingest-side, FR-16 doc-size, AD-N1, AD-N3)_

1. **Neutralization strips genuine injection vectors.** Given the raw decoded markdown handed off by Story 2.1's ingestion adapter (`IngestedDocumentDto.content`), `neutralize(rawMarkdown)` NFKC-normalizes the text and strips: C0/C1 control characters (all except `\t`/`\n`/`\r`); zero-width characters (U+200B, U+200C, U+200D, U+FEFF); bidi control characters (U+202A–U+202E, U+2066–U+2069); `<script>` blocks; HTML event-handler attributes (`onclick=`, `onerror=`, `onload=`, etc.); `<iframe>`/`<frame>`/`<object>`/`<embed>`/`<applet>` tags; `<meta http-equiv="refresh">` / `<meta http-equiv="set-cookie">`; `javascript:`/`data:text/html` URIs in `href`/`src`; and base64 data-URI blobs (`data:image/...;base64,...`, `data:application/pdf;base64,...`).
2. **Neutralization preserves quiz material.** Given the same input, HTML comments, link titles (`title="..."`), image alt text (`alt="..."`), all other raw HTML (`<kbd>`, `<sup>`, `<sub>`, `<details>`, etc.), inline markdown/list/table syntax, and **code blocks** are preserved byte-for-byte, and the source is **never** LLM-rewritten — this story makes zero LLM calls.
3. **Oversized doc rejected (hard byte cap).** Given raw decoded markdown larger than 2 MiB, then the shared `DocTooLargeError` (Story 2.1's class, reused — not recreated — here) is thrown before neutralization, chunking, or any LLM call.
4. **Oversized doc rejected (token-estimate cap).** Given the raw decoded markdown's estimated token count exceeds ~125,000 (≈500 KB of text at the 4-bytes/token heuristic), then `DocTooLargeError` is thrown — a UX shortcut that rejects clearly-too-large docs cheaply, before the more expensive neutralize/chunk work.
5. **Per-model context-window check.** Given the raw decoded markdown's estimated token count exceeds the **chosen model's** context window (supplied by the caller as a parameter — this story does not resolve providers), then `DocTooLargeError` is thrown with a detail message equivalent to `"switch provider/model — e.g. MiniMax-M3 supports 1M tokens"`. No silent fallback, no map-reduce.
6. **Content-density guard (doc too short).** Given the **neutralized** text's estimated tokens divided by `questionCount` is less than ~500, then `DocTooShortError` (new in this story) is thrown with a detail message equivalent to `"reduce questionCount — this document has ~Xk tokens of quiz-able content"`.
7. **Chunk splitting is deterministic given `neutralizedText`.** Given a valid (post-guard) neutralized document, the chunker splits it by `##`/`###` headings synchronously into an ordered array of section strings; calling it twice with byte-identical `neutralizedText` yields a byte-identical `string[]` — no `Math.random()`, no wall-clock, no locale-dependent ordering. **Selecting which of these chunks fit the ~8k-token prompt budget is Story 2.4's `selectChunkBudget` step, not this story's** (see Dev Notes → "Chunk splitting vs. chunk-budget selection").
8. **No-headings fallback.** Given a document with zero `##`/`###` headings, the chunker still returns an array with **at least one element** — the whole document — rather than an empty array.
9. **Empty-after-neutralization doc rejected.** Given a document that becomes empty or near-empty after neutralization (e.g. one consisting entirely of `<script>` blocks), it is rejected as `DocTooShortError` before any LLM call. This is not a special case — it is the content-density guard's zero-content boundary (AC #6 with `estimatedTokens ≈ 0`), covered by an explicit regression test.
10. **Domain purity holds.** Every file this story adds lives under `apps/api/src/domain/**`, imports nothing from `@nestjs/*`, `drizzle-orm`, `mastra`, `undici`, or `node:fetch`, and the existing Story 1.1 `no-restricted-imports` ESLint rule passes with zero new violations. All unit tests for this story run in well under 100 ms each (pure functions, no I/O — AD-2).

## Tasks / Subtasks

- [ ] **Task 1 — Domain errors** (AC: #3, #4, #5, #6)
  - [ ] **Reuse, do not recreate,** `DocTooLargeError` from `apps/api/src/domain/quiz/errors/doc-too-large.error.ts` — Story 2.1 already creates it (`DocTooLargeError(detail: string) extends Error`, used there for its 10 MB streaming-body cap) and explicitly documents that this story reuses the same class for the 2 MB / ~125k-token / per-model tiers. Import it; do not define a second "too large" error type.
  - [ ] Create `apps/api/src/domain/quiz/errors/doc-too-short.error.ts` — `DocTooShortError(detail: string) extends Error`, `this.name = 'DocTooShortError'`, matching the exact shape of Story 2.1's `DocTooLargeError`/`SsrfBlockedError`/`IngestTimeoutError` (plain `Error` subclass, single `detail: string` constructor arg, **no** `code`/`hint` fields baked into the class).
  - [ ] Neither error class does any HTTP-status/code/hint JSON-shaping. Per Story 2.1's explicit ruling, that mapping is wired where `GenerateQuizUseCase` catches these errors (**Story 2.4**), not in the error classes and not in `SafeExceptionFilter`. This story does not touch `SafeExceptionFilter`.
  - [ ] If Story 2.1 has not landed yet when this story starts, stub a minimal `DocTooLargeError(detail: string)` matching the documented shape in the same file path Story 2.1 will use, and flag it for reconciliation rather than inventing a different shape.

- [ ] **Task 2 — Token estimator** (AC: #4, #5, #6)
  - [ ] `apps/api/src/domain/quiz/services/token-estimate.ts` — `estimateTokens(text: string): number`, computed as `Math.ceil(Buffer.byteLength(text, 'utf8') / 4)`. `Buffer` is a Node global, not in the AD-2 forbidden-import list.
  - [ ] Export `TOKEN_ESTIMATE_BYTES_PER_TOKEN = 4` as a named constant so the heuristic is documented in one place, not a magic number.
  - [ ] Story 2.4's `selectChunkBudget(chunks, tokenBudget)` needs a per-chunk token estimate too — export `estimateTokens` cleanly enough that Story 2.4 can import and reuse it instead of re-deriving its own heuristic (a note for whoever implements 2.4; this story cannot edit that file).

- [ ] **Task 3 — `neutralize()`** (AC: #1, #2)
  - [ ] `apps/api/src/domain/quiz/services/neutralize.ts` — `neutralize(rawMarkdown: string): string`.
  - [ ] Apply `.normalize('NFKC')` first.
  - [ ] Strip C0 controls (U+0000-U+0008, U+000B, U+000C, U+000E-U+001F) and C1 controls (U+0080-U+009F) - never strip U+0009 (tab), U+000A (LF), or U+000D (CR).
  - [ ] Strip zero-width chars U+200B (ZWSP), U+200C (ZWNJ), U+200D (ZWJ), U+FEFF (BOM/ZWNBSP), and bidi control chars U+202A-U+202E and U+2066-U+2069.
  - [ ] Strip `<script[^>]*>.*?</script>` (case-insensitive, `s` flag for multiline content).
  - [ ] Strip event-handler attributes matching `\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)` wherever they appear inside a tag.
  - [ ] Strip `<iframe|frame|object|embed|applet ...>` tags (and their closing tags/content for the paired ones).
  - [ ] Strip `<meta[^>]+http-equiv\s*=\s*["'](refresh|set-cookie)["'][^>]*>`.
  - [ ] Strip/neutralize `href=` / `src=` values whose scheme is `javascript:` or `data:text/html`.
  - [ ] Strip base64 data-URI values (`data:(image|application)/[^;]+;base64,[A-Za-z0-9+/=]+`).
  - [ ] Do **not** touch: HTML comments (`<!-- ... -->`), `title="..."` / `alt="..."` attributes, any other tag not named above, fenced/indented code blocks, or plain markdown syntax.

- [ ] **Task 4 — Doc-size + content-density guards** (AC: #3, #4, #5, #6, #9)
  - [ ] `apps/api/src/domain/quiz/services/doc-size-guard.ts` exporting:
    - `MAX_DECODED_MARKDOWN_BYTES = 2 * 1024 * 1024` (2 MiB)
    - `MAX_TOKEN_ESTIMATE = 125_000`
    - `MIN_TOKENS_PER_QUESTION = 500`
    - `assertDocByteSize(rawMarkdown: string): void` — throws `DocTooLargeError` (imported from Story 2.1) if `Buffer.byteLength(rawMarkdown, 'utf8') > MAX_DECODED_MARKDOWN_BYTES`.
    - `assertTokenEstimateCeiling(estimatedTokens: number): void` — throws `DocTooLargeError` if `estimatedTokens > MAX_TOKEN_ESTIMATE`.
    - `assertModelContextWindow(estimatedTokens: number, contextWindowTokens: number): void` — throws `DocTooLargeError` with detail `"switch provider/model — e.g. MiniMax-M3 supports 1M tokens"` if `estimatedTokens > contextWindowTokens`.
    - `assertContentDensity(estimatedTokens: number, questionCount: number): void` — throws `DocTooShortError` with detail `` `reduce questionCount — this document has ~${Math.round(estimatedTokens / 1000)}k tokens of quiz-able content` `` if `estimatedTokens / questionCount < MIN_TOKENS_PER_QUESTION`.

- [ ] **Task 5 — Chunker** (AC: #7, #8)
  - [ ] `apps/api/src/domain/quiz/services/chunker.ts` exporting `chunkDocument(neutralizedText: string): string[]`.
  - [ ] Split on `##`/`###` ATX heading lines only (never `#`, never `####`+). Any content before the first `##`/`###` heading becomes the first element (a preamble section) if non-empty.
  - [ ] Return **every** heading-bounded section as a separate array element, in document order — this function does **not** select a token-budgeted subset. Selecting the ~8k-token subset is Story 2.4's `selectChunkBudget(chunks, tokenBudget)`, layered on top of this function's output.
  - [ ] Zero headings anywhere → return a single-element array containing the whole `neutralizedText`.
  - [ ] No `questionCount` parameter — this function's determinism depends only on `neutralizedText` (see Dev Notes for why this narrower scope was chosen over an earlier draft that also did budget selection).

- [ ] **Task 6 — Orchestrator** (AC: #3–#9, wiring/ordering)
  - [ ] `apps/api/src/domain/quiz/services/document-preparation.ts` exporting `prepareDocumentForGeneration(rawMarkdown: string, params: { questionCount: number; contextWindowTokens: number }): { neutralizedText: string; estimatedTokens: number; chunks: string[] }`.
  - [ ] Pipeline, in this exact order (see Dev Notes → "Order of operations — a resolved spec ambiguity" for why): `assertDocByteSize(raw)` → `estimateTokens(raw)` → `assertTokenEstimateCeiling(rawTokens)` → `assertModelContextWindow(rawTokens, contextWindowTokens)` → `neutralize(raw)` → `estimateTokens(neutralized)` → `assertContentDensity(neutralizedTokens, questionCount)` → `chunkDocument(neutralized)`.
  - [ ] This function stops at "chunk" — it deliberately does **not** call anything resembling `selectChunkBudget`. Story 2.4's `GenerateQuizUseCase` calls this function first, then separately calls its own `selectChunkBudget(prepared.chunks, ~8000)` before building the LLM prompt. Do not re-implement that step here.
  - [ ] `prepareDocumentForGeneration` is a plain exported function, not a NestJS-injectable port — it is pure domain composition with no I/O, so Story 2.4's use-case calls it directly rather than through dependency injection.

- [ ] **Task 7 — Vitest suite** (AC: all)
  - [ ] `apps/api/test/domain/neutralize.test.ts` — one test per stripped construct (script, event handler, iframe/object/embed/applet, meta http-equiv, javascript: URI, data:text/html URI, base64 data-URI, C0/C1 controls, zero-width chars, bidi controls) and one test per preserved construct (HTML comment, link title, alt text, `<kbd>`/`<sup>`/`<details>`, fenced code block).
  - [ ] `apps/api/test/domain/token-estimate.test.ts` — the 500 KB ≈ 125k-token conversion at the documented ratio.
  - [ ] `apps/api/test/domain/doc-size-guard.test.ts` — each of the four guards at and around its threshold (just under passes, just over throws the right error class with the right detail text); the exact detail strings for the per-model and density guards; import `DocTooLargeError` from Story 2.1's actual file path (not a local duplicate).
  - [ ] `apps/api/test/domain/chunker.test.ts` — determinism (`chunkDocument(text)` called twice → `toEqual`), no-headings fallback, correct splitting at `##`/`###` only (not `#`, not `####`), preamble captured as the first element when present.
  - [ ] `apps/api/test/domain/document-preparation.test.ts` — full pipeline happy path; the "empty after neutralization" edge case (AC #9) as an explicit regression test; ordering proof — a doc that is oversized on the raw estimate but would pass density after neutralization still gets `DocTooLargeError`, never reaches neutralization's output; assert the returned `chunks` array is the **full** heading-split set (not budget-limited) so a downstream consumer calling `selectChunkBudget` on it has the whole document available to select from.
  - [ ] Run `pnpm --filter @ai-quiz/api test` and `pnpm verify` before marking the story done.

## Dev Notes

### Scope boundary — read this first

This story is **pure domain functions only** — no NestJS module, no controller, no route, no DB, no LLM call, no network I/O. It ends when a validated, neutralized, fully-chunked (unbudgeted) document exists in memory. The following are explicitly **NOT** in scope, are owned by named sibling Epic 2 stories, and building them here creates merge conflicts:

| Do NOT build here                                                                                                                                                                                                                                                                                                                                                                                                                          | Owned by                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| SSRF-safe fetch, `IngestionPort`, `HttpMarkdownAdapter`, GitHub blob→raw rewrite, the `DocTooLargeError` **class itself** (this story imports/reuses it, does not define it)                                                                                                                                                                                                                                                               | **Story 2.1** — this story's `rawMarkdown` input is `IngestedDocumentDto.content` from that adapter                                                                                                                |
| `adapters/llm/capabilities.ts`, the provider capability matrix, resolving a model's context window from a provider/model string                                                                                                                                                                                                                                                                                                            | **Story 2.3** — this story only _consumes_ a `contextWindowTokens: number` parameter; never import from `adapters/llm/*` (AD-2 forbids domain→adapter imports anyway)                                              |
| `POST /api/sessions` request contract (`strategy`, `questionCount`, `topic` Zod validation, defaults, range checks), **`selectChunkBudget` (the ~8k-token chunk-budget selection)**, the single structured-output LLM call, pool validation (grounding check + secret-shaped-token check per AD-N1 output-side), the AD-4 retry budget, and the HTTP-status/code/hint mapping for `DocTooLargeError`/`DocTooShortError`/`SsrfBlockedError` | **Story 2.4** — this story assumes `questionCount` arrives already validated ∈ `[5,8]`; it does not re-validate the range, does not select a token-budgeted chunk subset, and does not touch `SafeExceptionFilter` |
| Category feasibility search, stratified sampling                                                                                                                                                                                                                                                                                                                                                                                           | **Story 2.5**                                                                                                                                                                                                      |
| `documents` table + RLS, persisting `chunks` as jsonb, `status='failed'` write-outside-transaction pattern, async `enrich()`                                                                                                                                                                                                                                                                                                               | **Story 2.6** — this story returns an in-memory `string[]` of chunks; it never touches Postgres                                                                                                                    |
| Landing page, provider dropdown, Start button, `error-copy.ts` (FE `code` → human copy)                                                                                                                                                                                                                                                                                                                                                    | **Story 2.7**                                                                                                                                                                                                      |

### Cross-story interface, verified against Stories 2.1 and 2.4 as they actually exist

Epic 2's seven story files were authored concurrently by different agents in the same sprint pass, and two real interface conflicts were found and reconciled while writing this story (not left for a later merge):

1. **`DocTooLargeError` is Story 2.1's class, not this story's.** An earlier draft of this story planned to define both `DocTooLargeError` and `DocTooShortError` from scratch, each carrying `code`/`hint` fields. Story 2.1's Task 2 already creates `DocTooLargeError(detail: string)` for its own 10 MB streaming cap and explicitly states _"Story 2.2 reuses this same class ... do not create a second 'too large' error type"_ — and further states neither class carries HTTP-status/code mapping, which is wired in `GenerateQuizUseCase` (Story 2.4). This story's error classes were revised to match: plain `Error(detail: string)` subclasses, no `code`/`hint` fields, no filter-wiring task.
2. **Chunk-budget selection is Story 2.4's `selectChunkBudget`, not this story's chunker.** Story 2.4's Task 4 defines `selectChunkBudget(chunks: readonly string[], tokenBudget: number): string[]` and states _"Story 2.2 already guarantees deterministic chunking; this function's job is deterministic selection within the ~8k-token ceiling."_ This story's `chunkDocument` was narrowed accordingly: it returns **every** heading-split section (plain `string[]`, no `questionCount` parameter, no token-budget logic, no `DocumentChunk` object wrapper) — the full document, chunked but unbudgeted. Story 2.4 layers its own budget selection on top.

If a dev agent encounters this story before either 2.1 or 2.4 has actually landed, re-verify against the real files rather than this story's description of them — they were correct as of this story's authoring but code, not prose, is the final authority once it exists.

### Order of operations — a resolved spec ambiguity (read before implementing Task 6)

The source documents disagree on where the size checks sit relative to neutralization:

- `architecture-spec.md §A.7` numbers the sync steps explicitly: **1. Ingestion (fetch + tiered size limits) → 2. Per-model context-window check → 3. Neutralization → 4. Chunking → 5. LLM call.** Size checks run on the _raw_ decoded markdown, before neutralization.
- The abbreviated pipeline strings in FR-16 / AD-N2 / `project-context.md` ("fetch → neutralize → chunk → select budget → 1 LLM call") don't state where the size checks fall relative to neutralize — they're silent, not contradictory, but easy to misread as "check size after neutralizing."
- This story's own AC set requires the **"empty after neutralization"** edge case (AC #9) to reject via the _content-density_ guard, which by definition must run on **post-neutralization** text (you cannot measure "empty after neutralization" on the raw text).

**Resolution applied (Task 6's pipeline order):** the three "too large" guards (byte cap, token-estimate cap, per-model context window) run on the **raw** pre-neutralization text — matching `architecture-spec.md §A.7`'s explicit ordering and the "fail fast before burning cycles on neutralization" rationale behind the token-estimate tier being described as a "UX shortcut." The **content-density** guard runs on the **neutralized** text, because it is specifically measuring how much quiz-able content survives neutralization (AC #9 depends on this). Get the order wrong and either AC #9 becomes untestable, or large docs waste a full neutralization pass before being rejected.

### A known tension worth flagging upstream (non-blocking, implement as specified)

`AD-N3` describes the ~125k-token-estimate cap (tier 3) as "well below all current model context windows" and separately describes the per-model context-window check (tier 4) as letting a user "switch to a larger-context model" (e.g. MiniMax-M3's 1M tokens) to fit a bigger document. In practice, because tier 3 is a **fixed** 125k-token ceiling applied regardless of which model is chosen, it fires _before_ tier 4 ever gets a chance to allow a larger document through on a large-context model — a user who deliberately picks MiniMax-M3 for its 1M-token window still gets rejected at ~125k tokens by tier 3. Tier 4 is not dead code — it remains the operative (and stricter) check for small-context OpenRouter free models whose context window is below 125k — but for MiniMax-M3 specifically, tier 3 is always the binding constraint, and the "switch to a bigger model" detail text (tier 4's message) can never actually be reached for a MiniMax-M3 user. **Implemented exactly as specified in both tiers** (this is what the ACs require and it is not this story's place to silently redesign the guard), but flagged for the PM/architect: the "switch to MiniMax-M3 for 1M tokens" hint may be misleading for documents in the 125k–1M token range, since those are already rejected by the fixed cap before the per-model check runs.

### Chunk splitting vs. chunk-budget selection (why the responsibility line sits where it does)

This story's chunker answers "what are the document's sections?" — a pure function of the neutralized text alone. Story 2.4's `selectChunkBudget` answers "which of those sections fit an ~8k-token prompt?" — a pure function of `(chunks, tokenBudget)`. Splitting these two concerns across the two stories (rather than this story doing both, as an earlier draft attempted) keeps each function single-purpose and matches what Story 2.4 already committed to in its own task list. `questionCount` therefore does **not** flow into this story's chunker at all; it only matters two steps later, when Story 2.5 draws the final quiz from the LLM's output pool.

### Architecture compliance (binding)

- **AD-1 / AD-2 — hexagonal, domain purity.** Every file lands under `apps/api/src/domain/quiz/{services,errors}/`. No import from `@nestjs/*`, `drizzle-orm`, `mastra`, `undici`, `node:fetch`, or `apps/api/src/adapters/*` / `apps/api/src/driving/*`. `Buffer` (Node global) is fine — it is not in the forbidden list. Story 1.1's `no-restricted-imports` rule is the enforcement; if it fires, move the file, don't relax the rule.
- **AD-N1 — ingest-side neutralization only.** This story implements _only_ the ingest-side half of FR-15 (deterministic scrub + NFKC normalize). The output-side half (structured-output containment, plain-text Q/A rendering, grounding check, secret-shaped-token check) is Story 2.4/2.6's territory — do not build a grounding check or secret-token scanner here.
- **AD-N3 — doc-size guard.** All four size/density tiers from the spine are implemented here except the 10 MB HTTP body cap (Story 2.1, enforced during streaming decode before this story's input even exists).
- **AD-N2 — chunking stays synchronous.** No `async`/`await` anywhere in this story's functions; the whole pipeline is a pure, synchronous CPU-bound pass, consistent with "chunking is a prerequisite for generation and costs milliseconds."
- **Never LLM-rewrite the source (AD-N1).** This story makes zero LLM calls, has no `LlmPort` dependency, and never imports anything from `adapters/llm/*`.

### Error handling (revised — do not touch `SafeExceptionFilter`)

Unlike Story 1.4's `NotFoundError` (which is mapped generically because it can originate from many different use-cases/routes), `DocTooLargeError` and `DocTooShortError` only ever originate from the single generation pipeline. Per Story 2.1's explicit ruling, their HTTP-status/`code`/hint JSON-shaping is wired **inside `GenerateQuizUseCase`** (Story 2.4), not in the generic `SafeExceptionFilter`. This story's error classes are plain `Error` subclasses carrying only a `detail: string` — construct that string with the PRD's exact wording (see AC #5/#6) so whatever Story 2.4 does with it (reuse directly, or build its own `code`/`hint` pair keyed on error type) has good content available, but do not presume or build the JSON envelope shape yourself.

### Data-shape forward-compatibility note (for Story 2.6, informational only)

`chunkDocument` returns `string[]`. Story 2.4's `selectChunkBudget` narrows this to the subset that fits the ~8k-token prompt budget (also `string[]`), and that narrowed array is what Story 2.6 ultimately persists as `documents.chunks` jsonb (per `architecture-spec.md §A.5` and Story 2.6's own `DocumentRowSchema` with a `chunks: z.array(...)` field). This story does not define a `DocumentChunkSchema` or any Zod schema — no DB/HTTP boundary exists at this layer (AD-3's "one schema per boundary" rule only bites once there's an actual boundary to cross), and Story 2.6 already owns `DocumentRowSchema`.

### File Structure

All paths are **NEW** unless marked otherwise:

```
apps/api/src/domain/quiz/
  errors/
    doc-too-large.error.ts        REUSE (Story 2.1 creates it; this story imports it, does not add to this file)
    doc-too-short.error.ts        NEW
  services/
    token-estimate.ts             NEW
    neutralize.ts                 NEW
    doc-size-guard.ts             NEW
    chunker.ts                    NEW
    document-preparation.ts       NEW — the orchestrator Story 2.4 calls
apps/api/test/domain/             NEW subfolder — this story establishes the
                                   convention for pure apps/api domain-layer
                                   unit tests (parallel to packages/shared/test/);
                                   later domain-pure-function stories (e.g. 2.5's
                                   feasibility search) should follow it
  neutralize.test.ts
  token-estimate.test.ts
  doc-size-guard.test.ts
  chunker.test.ts
  document-preparation.test.ts
```

[Source: architecture-spec.md#A.4 Repo Layout — `domain/quiz/{dto,entities,services,errors}/`; Story 1.1 skeleton already creates these directories empty]

### Testing Requirements

- **Framework:** Vitest 4.1.10. All tests here are pure unit tests — no Postgres, no supertest, no NestJS test app.
- **Location:** `apps/api/test/domain/` (new subfolder this story introduces; distinct from `apps/api/test/security/` and `apps/api/test/integration/` established in Stories 1.4/1.5).
- **Coverage floor:** NFR-4 / AD-N10 name three floors explicitly — scoring ≥95%, use-cases ≥80%, adapters ≥60% — and do not name a floor for apps/api domain _services_ distinct from use-cases. **Ruling applied:** hold this story's code to the ≥80% use-case floor, since it is pure, dependency-free business logic with no excuse for gaps (same reasoning Story 1.2 applied to `packages/shared`, which aimed for 100% against a 95% floor). Flag for PM/architect confirmation that domain services should formally share the use-case floor.
- Domain unit tests must run in **<100 ms** each, no I/O (AD-2).
- Every stripped/preserved construct in AC #1/#2 needs its own test — a single "kitchen sink" fixture that asserts everything at once will pass even if one construct's regex is subtly wrong.
- `pnpm verify` = `lint:check && typecheck && test && test:e2e && build` is the gate; run `pnpm --filter @ai-quiz/api test` first.

### Anti-pattern watchlist

- ❌ Defining a second `DocTooLargeError` class — Story 2.1 owns it; import from its file path.
- ❌ Putting `code`/`hint` fields on `DocTooLargeError`/`DocTooShortError`, or adding branches to `SafeExceptionFilter` for them — that mapping belongs inside `GenerateQuizUseCase` (Story 2.4).
- ❌ Adding a `questionCount` parameter or token-budget logic to `chunkDocument` — that is Story 2.4's `selectChunkBudget`, layered on top of this story's output.
- ❌ Running the LLM output-side checks (grounding, secret-shaped-token) here — that's Story 2.4/2.6, and this story has no `LlmPort` dependency at all.
- ❌ Measuring content-density on the raw (pre-neutralization) text — breaks AC #9.
- ❌ Importing `adapters/llm/capabilities.ts` to resolve a model's context window instead of accepting it as a parameter — breaks AD-2 domain purity and couples this story to Story 2.3's implementation.
- ❌ Using `Math.random()`, `Date.now()`, or object-key iteration order for anything in the chunker — breaks AC #7's determinism requirement, which Story 2.4/2.5 depend on for stable retries and reproducible sessions.
- ❌ Re-validating `questionCount`'s `[5,8]` range here — that's Story 2.4's Zod boundary; this story assumes it already holds.
- ❌ Persisting anything to Postgres, or defining a Drizzle table/Zod row schema for `documents.chunks` — that's Story 2.6.
- ❌ Stripping HTML comments, link titles, or alt text "to be safe" — the spec is explicit these are legitimate quiz material and must survive.

### Previous story intelligence

No prior Epic 2 story files existed as implementation code (this is a greenfield project, planning-artifact stage only), but the **other six Epic 2 story files were authored concurrently in this same sprint pass** and were read in full while writing this one specifically to catch interface conflicts before they became merge conflicts. Two were found and reconciled (see "Cross-story interface" above): `DocTooLargeError` ownership (Story 2.1) and chunk-budget-selection ownership (Story 2.4). What else carries forward:

- **Hexagonal layout + domain purity enforcement** (Story 1.1) — the `domain/quiz/{services,errors}/` directories already exist (empty, `.gitkeep`d) from Story 1.1's skeleton; this story populates them for the first time alongside Story 2.1.
- **Domain error class shape** (Story 1.4's `not-found.error.ts`, confirmed by Story 2.1's `SsrfBlockedError`/`DocTooLargeError`/`IngestTimeoutError`) — plain `Error` subclasses with a single `detail`/message string constructor arg and a set `name`; no HTTP-status mapping baked in. This story's `DocTooShortError` follows the same shape.
- **Canonical adapter pattern / Zod-at-boundaries** (Story 1.2, 1.3, 1.4) — deliberately **not** invoked in this story, since nothing here crosses an HTTP, DB, or LLM boundary. The first boundary `string[]` chunks cross is Story 2.6's persistence layer.
- **`pnpm verify` gate and `packages/shared` vs `apps/api` test-location split** (Stories 1.1–1.5) — this story's tests live in `apps/api/test/domain/`, a new subfolder alongside the `security/`/`integration/` pattern Stories 1.4–1.5 established.

If Story 2.1's `IngestionPort`/`HttpMarkdownAdapter` lands with an output shape other than `IngestedDocumentDto { url, content, contentType, byteSize }`, treat `.content` (the raw, not-yet-neutralized string) as this story's `rawMarkdown` input — do not change this story's function signatures to accept the whole DTO, which would leak an adapter-shaped concern into the domain layer.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.2: Neutralize & chunk the document, with size/density guard] — the ACs
- [Source: _bmad-output/planning-artifacts/epics.md#Epic 2: Generate a grounded quiz from any URL] — epic boundary note, sibling story list
- [Source: _bmad-output/planning-artifacts/prds/prd-ai-quiz-2026-07-16/prd.md#FR-15 Ingest neutralization + output grounding] — exact strip/preserve list, rationale for no LLM-rewrite
- [Source: prd.md#FR-16 Bounded critical path + doc-size guard] — the four tiered caps with exact hint text quoted in this story
- [Source: .../ARCHITECTURE-SPINE.md#AD-N1 — FR-15] — ingest-side vs output-side split
- [Source: .../ARCHITECTURE-SPINE.md#AD-N2 — FR-16] — sync critical path ordering, closed-world generation
- [Source: .../ARCHITECTURE-SPINE.md#AD-N3 — FR-16 doc-size guard] — the four tiers, byte/token thresholds
- [Source: .../ARCHITECTURE-SPINE.md#AD-2 — Domain purity] — forbidden imports, <100ms domain test budget
- [Source: _bmad-output/planning-artifacts/specs/architecture-spec.md#A.7 Agent Flows] — the explicit numbered sync-step ordering this story's Task 6 follows (steps 1–4)
- [Source: architecture-spec.md#A.4 Repo Layout] — `domain/quiz/{services,errors}/` directory names
- [Source: architecture-spec.md#A.5 Data Model] — `documents.chunks` jsonb column (forward-compat note)
- [Source: _bmad-output/project-context.md#Quiz generation flow] — sync/async split, "never LLM-rewrite the source"
- [Source: _bmad-output/project-context.md#Security Rules, rule 4] — ingest neutralization detail, removed heuristic regex
- [Source: _bmad-output/implementation-artifacts/1-1-monorepo-scaffold-and-tooling-gate.md] — hexagonal layer table, domain directory skeleton
- [Source: _bmad-output/implementation-artifacts/1-4-per-session-ownership-walking-skeleton-sessions-endpoint.md] — `NotFoundError` shape this story's error classes mirror
- [Source: _bmad-output/implementation-artifacts/2-1-ssrf-safe-markdown-ingest.md] — `DocTooLargeError` ownership/shape, `IngestedDocumentDto` shape, error-mapping-lives-in-2.4 ruling (sibling story, read for interface reconciliation)
- [Source: _bmad-output/implementation-artifacts/2-4-generate-the-question-pool-single-structured-call-and-validate-it.md] — `selectChunkBudget` ownership, scope-boundary table row naming Story 2.2 (sibling story, read for interface reconciliation)

### Open questions / spec gaps (resolve-in-place decisions taken above)

1. **Size-check ordering relative to neutralization** was silent/ambiguous across FR-16, AD-N2, and `architecture-spec.md §A.7`. **Decision applied:** size guards (tiers 2–4) run on raw text per §A.7's explicit numbering; density guard (tier 5) runs on neutralized text, required by AC #9.
2. **Tier-3 (fixed 125k-token cap) vs tier-4 (per-model context window) interaction** means MiniMax-M3's 1M-token advantage is never reachable for documents above ~125k tokens — tier 3 always fires first. Implemented as specified; flagged for PM/architect — the "switch to a bigger model" message may mislead MiniMax-M3 users specifically.
3. **Chunk-vs-budget-selection split** was not stated by any planning artifact (epics.md/PRD/spine all describe "chunk → select budget" as one abbreviated pipeline phrase). **Resolved by reading Story 2.4 as it already exists**: Story 2.4 explicitly owns `selectChunkBudget` and expects this story's chunker to hand it the full, unbudgeted `string[]`. This is the single most important reconciliation in this story — an earlier draft had this story doing both steps and using an object-shaped chunk type, which would have produced a real integration break against Story 2.4's committed interface.
4. **2 MiB vs 2,000,000 bytes** for the "2 MB" decoded-markdown cap — resolved to binary MiB (2,097,152 bytes), consistent with common engineering convention for size caps. The ~500 KB → 125k-token conversion is implemented directly as a token-count comparison (`estimateTokens(text) > 125_000`) rather than a separate byte threshold, since 125,000 is the number every source document actually states.
5. **Domain-service coverage floor** is not explicitly named by NFR-4/AD-N10 (only scoring/use-cases/adapters are). Applied the ≥80% use-case floor by analogy; flag for confirmation.
6. **Exact final HTTP `{code, message, hint}` shape for `DOC_TOO_LARGE`/`DOC_TOO_SHORT`** is Story 2.4's decision (it owns the error-to-HTTP mapping per Story 2.1's ruling), not resolved here. This story supplies well-formed `detail` strings using the PRD's exact wording so Story 2.4 has good content to work with either way.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
