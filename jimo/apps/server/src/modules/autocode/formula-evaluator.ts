/**
 * Safe expression evaluator for autocode "calculated" fields.
 *
 * SECURITY: This is a hand-written tokenizer + precedence-climbing parser.
 * It NEVER uses eval() / new Function() / the VM module. Only literals,
 * same-row field references, a fixed operator set, and a CURATED function
 * allowlist can be evaluated — anything else throws. This makes it safe to
 * run user/AI-authored formulas over real rows.
 *
 * Grammar (lowest → highest precedence):
 *   compare  := concat ( (==|!=|>|<|>=|<=) concat )*
 *   concat   := add     ( '||' add )*
 *   add      := mul     ( (+|-) mul )*
 *   mul      := unary   ( (*|/|%) unary )*
 *   unary    := (+|-)? primary
 *   primary  := number | string | true|false|null | funcCall | fieldRef | '(' compare ')'
 *   funcCall := id '(' (compare (',' compare)*)? ')'
 *   fieldRef := id            // resolved from the row by (snake_case) name
 *
 * Null propagation: arithmetic with any null operand → null; division by zero
 * → null; string concat coerces null → ''. Missing field references throw
 * (a config error that should surface during preview/mock, not silently null).
 */

export type FormulaValue = number | string | boolean | null;

export class FormulaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FormulaError';
  }
}

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

type TokenType = 'num' | 'str' | 'id' | 'op' | 'lparen' | 'rparen' | 'comma' | 'eof';
interface Token {
  type: TokenType;
  value: string;
  pos: number;
}

const TWO_CHAR_OPS = new Set(['==', '!=', '>=', '<=', '||']);
const ONE_CHAR_OPS = new Set(['+', '-', '*', '/', '%', '>', '<']);
const isIdStart = (c: string) => /[a-zA-Z_]/.test(c);
const isIdPart = (c: string) => /[a-zA-Z0-9_]/.test(c);
const isDigit = (c: string) => c >= '0' && c <= '9';

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    // whitespace
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i++;
      continue;
    }
    // number (int or decimal, single dot)
    if (isDigit(c) || (c === '.' && isDigit(src[i + 1]))) {
      let j = i;
      while (j < n && isDigit(src[j])) j++;
      if (src[j] === '.') {
        j++;
        while (j < n && isDigit(src[j])) j++;
      }
      tokens.push({ type: 'num', value: src.slice(i, j), pos: i });
      i = j;
      continue;
    }
    // string literal (single or double quotes, backslash escapes)
    if (c === "'" || c === '"') {
      const quote = c;
      let j = i + 1;
      let buf = '';
      while (j < n && src[j] !== quote) {
        if (src[j] === '\\' && j + 1 < n) {
          buf += src[j + 1];
          j += 2;
        } else {
          buf += src[j];
          j++;
        }
      }
      if (j >= n) throw new FormulaError(`Unterminated string starting at ${i}`);
      tokens.push({ type: 'str', value: buf, pos: i });
      i = j + 1;
      continue;
    }
    // identifier (field ref, function name, or literal keyword)
    if (isIdStart(c)) {
      let j = i + 1;
      while (j < n && isIdPart(src[j])) j++;
      tokens.push({ type: 'id', value: src.slice(i, j), pos: i });
      i = j;
      continue;
    }
    // two-char operator
    const two = src.slice(i, i + 2);
    if (TWO_CHAR_OPS.has(two)) {
      tokens.push({ type: 'op', value: two, pos: i });
      i += 2;
      continue;
    }
    // one-char operator
    if (ONE_CHAR_OPS.has(c)) {
      tokens.push({ type: 'op', value: c, pos: i });
      i++;
      continue;
    }
    if (c === '(') {
      tokens.push({ type: 'lparen', value: c, pos: i });
      i++;
      continue;
    }
    if (c === ')') {
      tokens.push({ type: 'rparen', value: c, pos: i });
      i++;
      continue;
    }
    if (c === ',') {
      tokens.push({ type: 'comma', value: c, pos: i });
      i++;
      continue;
    }
    throw new FormulaError(`Unexpected character '${c}' at ${i}`);
  }
  tokens.push({ type: 'eof', value: '', pos: n });
  return tokens;
}

// ---------------------------------------------------------------------------
// Coercion helpers
// ---------------------------------------------------------------------------

const isNull = (v: FormulaValue): v is null => v === null || v === undefined;

function toNum(v: FormulaValue): number | null {
  if (isNull(v)) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  const s = String(v).trim();
  if (s === '') return null;
  const x = Number(s);
  return Number.isFinite(x) ? x : null;
}

function toStr(v: FormulaValue): string {
  if (isNull(v)) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return String(v);
}

function isTruthy(v: FormulaValue): boolean {
  if (isNull(v)) return false;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  return v !== '';
}

function parseDate(v: FormulaValue): number | null {
  if (isNull(v)) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const ms = Date.parse(String(v));
  return Number.isNaN(ms) ? null : ms;
}

// ---------------------------------------------------------------------------
// Operators
// ---------------------------------------------------------------------------

function arith(op: string, a: FormulaValue, b: FormulaValue): FormulaValue {
  const x = toNum(a);
  const y = toNum(b);
  if (x === null || y === null) return null;
  switch (op) {
    case '+':
      return x + y;
    case '-':
      return x - y;
    case '*':
      return x * y;
    case '/':
      return y === 0 ? null : x / y;
    case '%':
      return y === 0 ? null : x % y;
    default:
      return null;
  }
}

function compare(op: string, a: FormulaValue, b: FormulaValue): boolean {
  const x = toNum(a);
  const y = toNum(b);
  let eq: boolean;
  let ord: number;
  if (x !== null && y !== null) {
    eq = x === y;
    ord = x < y ? -1 : x > y ? 1 : 0;
  } else {
    const sa = toStr(a);
    const sb = toStr(b);
    eq = sa === sb;
    ord = sa < sb ? -1 : sa > sb ? 1 : 0;
  }
  switch (op) {
    case '==':
      return eq;
    case '!=':
      return !eq;
    case '>':
      return ord > 0;
    case '<':
      return ord < 0;
    case '>=':
      return ord >= 0;
    case '<=':
      return ord <= 0;
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Curated function allowlist (case-insensitive names)
// ---------------------------------------------------------------------------

const DATE_DIVISORS: Record<string, number> = {
  day: 86400000,
  hour: 3600000,
  minute: 60000,
  second: 1000,
};

const FUNCTIONS: Record<string, (args: FormulaValue[]) => FormulaValue> = {
  ROUND: (a) => {
    const x = toNum(a[0]);
    if (x === null) return null;
    const d = toNum(a[1]);
    const digits = d === null ? 0 : Math.max(0, Math.min(10, Math.floor(d)));
    const f = 10 ** digits;
    return Math.round((x + Number.EPSILON) * f) / f;
  },
  ABS: (a) => {
    const x = toNum(a[0]);
    return x === null ? null : Math.abs(x);
  },
  FLOOR: (a) => {
    const x = toNum(a[0]);
    return x === null ? null : Math.floor(x);
  },
  CEIL: (a) => {
    const x = toNum(a[0]);
    return x === null ? null : Math.ceil(x);
  },
  MIN: (a) => {
    const ns = a.map(toNum).filter((x): x is number => x !== null);
    return ns.length ? Math.min(...ns) : null;
  },
  MAX: (a) => {
    const ns = a.map(toNum).filter((x): x is number => x !== null);
    return ns.length ? Math.max(...ns) : null;
  },
  IF: (a) => (isTruthy(a[0]) ? a[1] ?? null : a[2] ?? null),
  COALESCE: (a) => {
    for (const v of a) if (!isNull(v)) return v;
    return null;
  },
  LEN: (a) => {
    if (isNull(a[0])) return null;
    return toStr(a[0]).length;
  },
  UPPER: (a) => {
    if (isNull(a[0])) return null;
    return toStr(a[0]).toUpperCase();
  },
  LOWER: (a) => {
    if (isNull(a[0])) return null;
    return toStr(a[0]).toLowerCase();
  },
  CONCAT: (a) => a.map(toStr).join(''),
  DATE_DIFF: (a) => {
    const pa = parseDate(a[0]);
    const pb = parseDate(a[1]);
    if (pa === null || pb === null) return null;
    const unit = (toStr(a[2]) || 'day').toLowerCase();
    const div = DATE_DIVISORS[unit] ?? DATE_DIVISORS.day;
    return Math.round((pa - pb) / div);
  },
};

// ---------------------------------------------------------------------------
// Parser (precedence climbing)
// ---------------------------------------------------------------------------

type FieldResolver = (name: string, pos: number) => FormulaValue;

class Parser {
  private pos = 0;
  constructor(
    private readonly tokens: Token[],
    private readonly resolve: FieldResolver,
  ) {}

  parse(): FormulaValue {
    const v = this.parseCompare();
    const t = this.peek();
    if (t.type !== 'eof') throw new FormulaError(`Unexpected token '${t.value}' at ${t.pos}`);
    return v;
  }

  private peek(): Token {
    return this.tokens[this.pos];
  }

  private parseCompare(): FormulaValue {
    let left = this.parseConcat();
    while (this.peek().type === 'op' && ['==', '!=', '>', '<', '>=', '<='].includes(this.peek().value)) {
      const op = this.next().value;
      const right = this.parseConcat();
      left = compare(op, left, right);
    }
    return left;
  }

  private parseConcat(): FormulaValue {
    let left = this.parseAdd();
    while (this.peek().type === 'op' && this.peek().value === '||') {
      this.next();
      const right = this.parseAdd();
      left = toStr(left) + toStr(right);
    }
    return left;
  }

  private parseAdd(): FormulaValue {
    let left = this.parseMul();
    while (this.peek().type === 'op' && (this.peek().value === '+' || this.peek().value === '-')) {
      const op = this.next().value;
      const right = this.parseMul();
      left = arith(op, left, right);
    }
    return left;
  }

  private parseMul(): FormulaValue {
    let left = this.parseUnary();
    while (this.peek().type === 'op' && ['*', '/', '%'].includes(this.peek().value)) {
      const op = this.next().value;
      const right = this.parseUnary();
      left = arith(op, left, right);
    }
    return left;
  }

  private parseUnary(): FormulaValue {
    const t = this.peek();
    if (t.type === 'op' && (t.value === '-' || t.value === '+')) {
      this.next();
      const v = this.parseUnary();
      const x = toNum(v);
      if (x === null) return null;
      return t.value === '-' ? -x : x;
    }
    return this.parsePrimary();
  }

  private parsePrimary(): FormulaValue {
    const t = this.peek();
    switch (t.type) {
      case 'num':
        this.next();
        return Number(t.value);
      case 'str':
        this.next();
        return t.value;
      case 'lparen': {
        this.next();
        const v = this.parseCompare();
        const close = this.peek();
        if (close.type !== 'rparen') throw new FormulaError(`Expected ')' at ${close.pos}`);
        this.next();
        return v;
      }
      case 'id': {
        this.next();
        // function call?
        if (this.peek().type === 'lparen') {
          this.next();
          const args: FormulaValue[] = [];
          if (this.peek().type !== 'rparen') {
            args.push(this.parseCompare());
            while (this.peek().type === 'comma') {
              this.next();
              args.push(this.parseCompare());
            }
          }
          const close = this.peek();
          if (close.type !== 'rparen') throw new FormulaError(`Expected ')' in function args at ${close.pos}`);
          this.next();
          return this.callFunction(t.value, args);
        }
        // literal keywords
        if (t.value === 'true') return true;
        if (t.value === 'false') return false;
        if (t.value === 'null') return null;
        // field reference
        return this.resolve(t.value, t.pos);
      }
      default:
        throw new FormulaError(`Unexpected token '${t.value || '<eof>'}' at ${t.pos}`);
    }
  }

  private next(): Token {
    return this.tokens[this.pos++];
  }

  private callFunction(name: string, args: FormulaValue[]): FormulaValue {
    const fn = FUNCTIONS[name.toUpperCase()];
    if (!fn) throw new FormulaError(`Unknown function '${name}'`);
    return fn(args);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Evaluate a formula against a row. Field names in the formula are resolved
 * against `row`'s OWN keys (snake_case business column names). Throws
 * FormulaError on malformed syntax, unknown functions, or references to
 * absent fields. Uses hasOwnProperty so inherited names (constructor, etc.)
 * never leak in from Object.prototype.
 */
export function evaluateFormula(formula: string, row: Record<string, unknown>): FormulaValue {
  if (formula === null || formula === undefined || formula.trim() === '') return null;
  const tokens = tokenize(formula);
  if (tokens.length === 1 && tokens[0].type === 'eof') return null;
  const resolve: FieldResolver = (name, pos) => {
    if (!Object.prototype.hasOwnProperty.call(row, name)) {
      throw new FormulaError(`Unknown field reference '${name}' at ${pos}`);
    }
    const v = row[name];
    if (v === null || v === undefined) return null;
    if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') return v;
    // objects/arrays are not evaluable — treat as null
    return null;
  };
  return new Parser(tokens, resolve).parse();
}

/**
 * Syntax-only validation: parses the formula without requiring real fields.
 * Field references are accepted (resolved to null) so only structural errors,
 * unknown functions, and malformed tokens are reported.
 */
export function validateFormula(formula: string): { ok: true } | { ok: false; error: string } {
  if (formula === null || formula === undefined || formula.trim() === '') return { ok: true };
  try {
    const tokens = tokenize(formula);
    if (tokens.length === 1 && tokens[0].type === 'eof') return { ok: true };
    // Resolve every field reference to null — we only validate structure here.
    new Parser(tokens, () => null).parse();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
