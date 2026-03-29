/**
 * Evaluates a boolean tag filter expression (AND/OR/NOT with parentheses)
 * against a list of tags using the Shunting Yard algorithm.
 */
export const evaluateAdvancedRule = (rule: string, tags: string[]): boolean => {
  if (!rule.trim()) return true;
  const tokens = rule.match(/\(|\)|\bAND\b|\bOR\b|\bNOT\b|[^\s()]+/gi) || [];
  const outputQueue: string[] = [];
  const operatorStack: string[] = [];
  const precedence: { [key: string]: number } = { 'OR': 1, 'AND': 2, 'NOT': 3 };
  const associativity: { [key: string]: string | undefined } = { 'NOT': 'Right' };
  for (const token of tokens) {
    const upperToken = token.toUpperCase();
    if (upperToken === 'AND' || upperToken === 'OR' || upperToken === 'NOT') {
      while (
        operatorStack.length > 0 &&
        operatorStack[operatorStack.length - 1] !== '(' &&
        (precedence[operatorStack[operatorStack.length - 1].toUpperCase()] > precedence[upperToken] ||
         (precedence[operatorStack[operatorStack.length - 1].toUpperCase()] === precedence[upperToken] && associativity[upperToken] !== 'Right'))
      ) {
        outputQueue.push(operatorStack.pop()!);
      }
      operatorStack.push(token);
    } else if (token === '(') {
      operatorStack.push(token);
    } else if (token === ')') {
      while (operatorStack.length > 0 && operatorStack[operatorStack.length - 1] !== '(') {
        outputQueue.push(operatorStack.pop()!);
      }
      if (operatorStack.length === 0) throw new Error("Mismatched parentheses");
      operatorStack.pop();
    } else {
      outputQueue.push(token);
    }
  }
  while (operatorStack.length > 0) {
    if (operatorStack[operatorStack.length - 1] === '(') throw new Error("Mismatched parentheses");
    outputQueue.push(operatorStack.pop()!);
  }
  const evalStack: boolean[] = [];
  for (const token of outputQueue) {
    const upperToken = token.toUpperCase();
    if (upperToken === 'AND') {
      const b = evalStack.pop();
      const a = evalStack.pop();
      if (a === undefined || b === undefined) throw new Error("Invalid syntax");
      evalStack.push(a && b);
    } else if (upperToken === 'OR') {
      const b = evalStack.pop();
      const a = evalStack.pop();
      if (a === undefined || b === undefined) throw new Error("Invalid syntax");
      evalStack.push(a || b);
    } else if (upperToken === 'NOT') {
      const a = evalStack.pop();
      if (a === undefined) throw new Error("Invalid syntax");
      evalStack.push(!a);
    } else {
      evalStack.push(tags.some(t => t.toLowerCase() === token.toLowerCase()));
    }
  }
  if (evalStack.length !== 1) throw new Error("Invalid syntax");
  return evalStack[0];
};
