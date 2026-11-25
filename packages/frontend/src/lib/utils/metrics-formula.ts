/**
 * Client side check of a formula expression (numbers, query ids, + - * / and
 * parentheses). Mirrors what the backend parser accepts so the builder can
 * show a hint before running the query. Returns null when valid, else a
 * short human message.
 */
export function validateFormula(expression: string, queryIds: string[]): string | null {
  const src = expression.trim();
  if (src === '') return 'Enter an expression, for example A / B * 100';

  const tokens: string[] = [];
  const re = /\s*(\d+(?:\.\d+)?|[A-Za-z][A-Za-z0-9]*|[-+*/()]|\S)/gy;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) tokens.push(m[1]);

  let pos = 0;
  const peek = () => tokens[pos];
  let error: string | null = null;
  const fail = (msg: string) => {
    if (!error) error = msg;
  };

  function primary() {
    const t = peek();
    if (t === undefined) return fail('Expression ends too early');
    if (t === '(') {
      pos++;
      expr();
      if (peek() !== ')') return fail('Missing closing parenthesis');
      pos++;
      return;
    }
    if (t === '-') {
      pos++;
      return primary();
    }
    if (/^\d/.test(t)) {
      pos++;
      return;
    }
    if (/^[A-Za-z]/.test(t)) {
      if (!queryIds.includes(t)) return fail(`Unknown query ${t}`);
      pos++;
      return;
    }
    return fail(`Unexpected "${t}"`);
  }
  function term() {
    primary();
    while (!error && (peek() === '*' || peek() === '/')) {
      pos++;
      primary();
    }
  }
  function expr() {
    term();
    while (!error && (peek() === '+' || peek() === '-')) {
      pos++;
      term();
    }
  }

  expr();
  if (!error && pos < tokens.length) fail(`Unexpected "${tokens[pos]}"`);
  return error;
}
