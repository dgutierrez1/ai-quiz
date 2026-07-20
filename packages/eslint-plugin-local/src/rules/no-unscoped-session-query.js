/**
 * `@ai-quiz/local/no-unscoped-session-query`
 *
 * Companion dev-time half of the four-layer ownership model (spine AD-9,
 * constitution rule 2). Postgres RLS catches an unscoped session query at
 * runtime; this rule catches it at author time, before it can ever ship.
 * BOTH are required — neither alone is sufficient, because RLS cannot see raw
 * SQL assembled outside Drizzle and lint cannot see a bypassed connection.
 *
 * WHAT IT FLAGS
 * A query filtering on `session_id` / `sessionId` that is NOT inside an
 * ownership-establishing context. Concretely, it reports:
 *   - `eq(x.sessionId, …)` / `eq(x.session_id, …)`
 *   - a raw SQL template containing `session_id =` / `session_id IN`
 * unless one of the following holds for the enclosing function:
 *   - its name starts with `forUser` (e.g. `forUserSession`), or
 *   - `assertUserOwns(...)` is called somewhere in that function, or
 *   - the same function also filters on `userId` / `user_id` — a query already
 *     scoped by the owning user is by definition not unscoped.
 *
 * WHY NAME-BASED AND NOT TYPE-BASED
 * The rule is deliberately syntactic. A type-aware version would need the full
 * Drizzle query builder types to conclude anything, would be far slower, and
 * would still miss raw `sql` templates — which are exactly the case RLS also
 * cannot help with, and therefore the case this rule most needs to catch.
 */

const OWNERSHIP_PREFIX = 'forUser';
const ASSERT_HELPER = 'assertUserOwns';
/**
 * Only Drizzle COMPARISON helpers count as a filter. This deliberately excludes
 * schema-definition calls like `index().on(table.sessionId)` and
 * `foreignKey({ columns: [table.sessionId] })`, which name the same column but
 * are DDL, not a query — flagging those was pure noise and would have pushed
 * someone to silence the rule.
 */
const FILTER_FNS = new Set([
  'eq',
  'ne',
  'gt',
  'gte',
  'lt',
  'lte',
  'inArray',
  'notInArray',
  'like',
  'ilike',
]);
const SESSION_KEYS = new Set(['sessionId', 'session_id']);
const USER_KEYS = new Set(['userId', 'user_id']);
const RAW_SESSION_FILTER = /session_id\s*(=|in\b)/i;
const RAW_USER_FILTER = /user_id\s*(=|in\b)/i;

/** Walk up to the nearest enclosing function-ish node. */
function enclosingFunction(node) {
  let current = node.parent;
  while (current) {
    if (
      current.type === 'FunctionDeclaration' ||
      current.type === 'FunctionExpression' ||
      current.type === 'ArrowFunctionExpression' ||
      current.type === 'MethodDefinition' ||
      current.type === 'PropertyDefinition'
    ) {
      return current;
    }
    current = current.parent;
  }
  return null;
}

/** Best-effort name for a function node, covering `const forUserX = () => {}`. */
function functionName(fn) {
  if (!fn) return '';
  if (fn.id && typeof fn.id.name === 'string') return fn.id.name;
  if (fn.key && typeof fn.key.name === 'string') return fn.key.name;
  const parent = fn.parent;
  if (parent) {
    if (parent.type === 'VariableDeclarator' && parent.id && typeof parent.id.name === 'string') {
      return parent.id.name;
    }
    if (parent.type === 'MethodDefinition' && parent.key && typeof parent.key.name === 'string') {
      return parent.key.name;
    }
    if (parent.type === 'Property' && parent.key && typeof parent.key.name === 'string') {
      return parent.key.name;
    }
  }
  return '';
}

function isSessionMember(node) {
  if (!node) return false;
  if (node.type === 'MemberExpression' && node.property) {
    if (node.property.type === 'Identifier' && SESSION_KEYS.has(node.property.name)) return true;
    if (node.property.type === 'Literal' && SESSION_KEYS.has(String(node.property.value)))
      return true;
  }
  return false;
}

function isUserMember(node) {
  if (!node) return false;
  if (node.type === 'MemberExpression' && node.property) {
    if (node.property.type === 'Identifier' && USER_KEYS.has(node.property.name)) return true;
    if (node.property.type === 'Literal' && USER_KEYS.has(String(node.property.value))) return true;
  }
  return false;
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require every session-scoped query to sit in an ownership-establishing context (forUser* / assertUserOwns / a user_id filter).',
    },
    schema: [],
    messages: {
      unscoped:
        'Unscoped session query: filtering on `{{key}}` outside a `forUser*` function, without an `assertUserOwns(...)` call, and without a `user_id` filter. This is the failure mode the four-layer ownership model exists to prevent (spine AD-9) — rename the function to `forUser*`, add `assertUserOwns(sessionId, userId)`, or scope the query by user.',
    },
  },

  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode();
    // Collected first, reported at Program:exit, because a qualifying
    // `assertUserOwns(...)` or `user_id` filter may appear textually AFTER the
    // session filter inside the same function.
    const candidates = [];
    const safeFunctions = new Set();

    function markSafe(node) {
      const fn = enclosingFunction(node);
      if (fn) safeFunctions.add(fn);
    }

    return {
      CallExpression(node) {
        const callee = node.callee;
        const calleeName =
          callee.type === 'Identifier'
            ? callee.name
            : callee.type === 'MemberExpression' && callee.property.type === 'Identifier'
              ? callee.property.name
              : '';

        if (calleeName === ASSERT_HELPER) {
          markSafe(node);
          return;
        }

        // `eq(table.sessionId, …)` and friends — comparison helpers only.
        if (FILTER_FNS.has(calleeName) && node.arguments.length > 0) {
          const first = node.arguments[0];
          if (isUserMember(first)) markSafe(node);
          if (isSessionMember(first)) {
            const fn = enclosingFunction(node);
            candidates.push({
              node,
              fn,
              key: first.property.name ?? String(first.property.value),
            });
          }
        }
      },

      // Raw `sql` template literals — the case RLS also cannot rescue.
      TemplateLiteral(node) {
        const text = sourceCode.getText(node);
        if (RAW_USER_FILTER.test(text)) markSafe(node);
        if (RAW_SESSION_FILTER.test(text)) {
          candidates.push({ node, fn: enclosingFunction(node), key: 'session_id' });
        }
      },

      'Program:exit'() {
        for (const candidate of candidates) {
          const name = functionName(candidate.fn);
          if (name.startsWith(OWNERSHIP_PREFIX)) continue;
          if (candidate.fn && safeFunctions.has(candidate.fn)) continue;
          context.report({
            node: candidate.node,
            messageId: 'unscoped',
            data: { key: candidate.key },
          });
        }
      },
    };
  },
};

export default rule;
