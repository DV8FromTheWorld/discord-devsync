/**
 * ESLint rule: prefer async/await over .then()/.catch()/.finally() chains.
 *
 * Flags calls to .then(), .catch(), and .finally() on expressions.
 * Use async/await with try/catch/finally instead.
 */
export const preferAsyncAwait = {
  meta: {
    type: 'suggestion',
    messages: {
      preferAwait: 'Prefer async/await over .{{method}}(). Use try/catch/finally instead.',
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        if (
          node.callee.type === 'MemberExpression' &&
          node.callee.property.type === 'Identifier' &&
          ['then', 'catch', 'finally'].includes(node.callee.property.name)
        ) {
          context.report({
            node: node.callee.property,
            messageId: 'preferAwait',
            data: { method: node.callee.property.name },
          });
        }
      },
    };
  },
};
