'use strict';

// Bound every recursive walker, including callers passing an AST directly.
// This hard limit cannot be disabled by options supplied with an input pattern.
const MAX_DEPTH = 100;
const MAX_NODES = 50000;

const checkStack = length => {
  if (length >= MAX_DEPTH) {
    throw new SyntaxError('Brace pattern exceeds the nesting safety limit (100)');
  }
};

const checkAst = ast => {
  const pending = [[ast, 0]];
  let count = 1;
  while (pending.length) {
    const [node, depth] = pending.pop();
    if (depth > MAX_DEPTH) {
      throw new SyntaxError('Brace pattern exceeds the nesting safety limit (100)');
    }
    if (node && Array.isArray(node.nodes)) {
      count += node.nodes.length;
      if (count > MAX_NODES) {
        throw new SyntaxError('Brace AST exceeds the node safety limit (50000)');
      }
      for (const child of node.nodes) pending.push([child, depth + 1]);
    }
  }
};

module.exports = { checkStack, checkAst };
