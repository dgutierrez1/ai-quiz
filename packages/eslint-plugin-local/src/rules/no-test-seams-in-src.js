/**
 * `@ai-quiz/local/no-test-seams-in-src`
 *
 * Keeps test scaffolding out of production source.
 *
 * WHY THIS EXISTS
 * The api's LLM and ingestion adapters used to carry their own test doubles:
 * module-global mutable state (`setMockLlmResponse`, `getLastChatParams`) plus
 * `NODE_ENV === 'test'` branches that short-circuited the real implementation.
 * Two concrete failures came out of that arrangement:
 *   1. The mock fallback also fired on a missing API key, and that branch was
 *      NOT test-gated — so a misconfigured production deploy silently served
 *      invented quiz questions as though grounded in the user's document.
 *   2. The ingestion test branch returned before `validateAndResolveTarget`,
 *      so the SSRF / DNS-rebind guard was never exercised end-to-end by any
 *      suite that booted the app.
 * Neither was a coding mistake in isolation; both followed from having no seam
 * to substitute an implementation. The seam now exists (port tokens bound in
 * `adapters.module.ts`, fakes in `@ai-quiz/test-doubles`, selected by
 * `AI_QUIZ_FAKE_ADAPTERS`), and this rule stops the old shape coming back.
 *
 * WHAT IT FLAGS
 *   1. `process.env.NODE_ENV === 'test'` (and `!==`, `==`, `!=`).
 *   2. An exported `setXMock` / `getXFake` / `resetXStub`-shaped function.
 *
 * WHAT IT DELIBERATELY ALLOWS
 * Comparisons against `'production'` — e.g. `NODE_ENV !== 'production'` gating
 * the dev CORS regex in `main.ts` or the memory block in the health response.
 * Those describe production behavior, not test behavior, and are legitimate.
 */

/**
 * A seam is a `set`/`get`/`reset` accessor whose name mentions a double.
 *
 * Split into two tests rather than one regex on purpose. The obvious
 * `/^(set|get|reset)[A-Z].*(Mock|Fake|Stub)/` is WRONG: `[A-Z]` consumes the
 * `M` of `setMockLlmResponse`, leaving `ockLlmResponse`, which contains no
 * `Mock` — so the single-regex form fails to match the precise identifier this
 * rule was written to outlaw. Caught by the fixture; keep them separate.
 */
const SEAM_PREFIX = /^(set|get|reset)[A-Z]/;
const SEAM_NOUN = /(Mock|Fake|Stub)/;

function isTestSeamName(name) {
  return SEAM_PREFIX.test(name) && SEAM_NOUN.test(name);
}

/** Matches `process.env.NODE_ENV`, in dot or bracket form. */
function isNodeEnvAccess(node) {
  if (!node || node.type !== 'MemberExpression') return false;
  const property =
    node.property.type === 'Identifier'
      ? node.property.name
      : node.property.type === 'Literal'
        ? node.property.value
        : undefined;
  if (property !== 'NODE_ENV') return false;

  const object = node.object;
  if (!object || object.type !== 'MemberExpression') return false;
  const envProperty =
    object.property.type === 'Identifier'
      ? object.property.name
      : object.property.type === 'Literal'
        ? object.property.value
        : undefined;
  return (
    envProperty === 'env' && object.object.type === 'Identifier' && object.object.name === 'process'
  );
}

function isTestLiteral(node) {
  return node && node.type === 'Literal' && node.value === 'test';
}

const EQUALITY = new Set(['===', '!==', '==', '!=']);

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow test-only branches and mock seams in production source; substitute implementations at the composition root instead.',
    },
    schema: [],
    messages: {
      nodeEnvTest:
        "Production code must not branch on NODE_ENV === 'test'. A test branch here means the real code path is never exercised, and the branch can fire in production. Substitute the implementation at the composition root instead (see AI_QUIZ_FAKE_ADAPTERS in adapters.module.ts).",
      mockExport:
        "'{{name}}' is a test seam exported from production source. Module-global mock state is readable and writable by anything in the process and keeps the real implementation untested. Put the double in @ai-quiz/test-doubles and bind it to a port token instead.",
    },
  },

  create(context) {
    return {
      BinaryExpression(node) {
        if (!EQUALITY.has(node.operator)) return;
        const matches =
          (isNodeEnvAccess(node.left) && isTestLiteral(node.right)) ||
          (isNodeEnvAccess(node.right) && isTestLiteral(node.left));
        if (matches) context.report({ node, messageId: 'nodeEnvTest' });
      },

      ExportNamedDeclaration(node) {
        const declaration = node.declaration;
        if (!declaration) return;

        if (declaration.type === 'FunctionDeclaration' && declaration.id) {
          if (isTestSeamName(declaration.id.name)) {
            context.report({
              node: declaration.id,
              messageId: 'mockExport',
              data: { name: declaration.id.name },
            });
          }
          return;
        }

        if (declaration.type === 'VariableDeclaration') {
          for (const declarator of declaration.declarations) {
            if (
              declarator.id.type === 'Identifier' &&
              isTestSeamName(declarator.id.name)
            ) {
              context.report({
                node: declarator.id,
                messageId: 'mockExport',
                data: { name: declarator.id.name },
              });
            }
          }
        }
      },
    };
  },
};
