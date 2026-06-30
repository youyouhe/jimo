import { evaluateFormula, validateFormula, FormulaError } from './formula-evaluator';

describe('formula-evaluator', () => {
  describe('arithmetic & precedence', () => {
    it('respects * before +', () => {
      expect(evaluateFormula('2 + 3 * 4', {})).toBe(14);
    });
    it('respects parentheses', () => {
      expect(evaluateFormula('(2 + 3) * 4', {})).toBe(20);
    });
    it('handles unary minus', () => {
      expect(evaluateFormula('-5 + 2', {})).toBe(-3);
    });
    it('supports modulo', () => {
      expect(evaluateFormula('10 % 3', {})).toBe(1);
    });
    it('division by zero yields null', () => {
      expect(evaluateFormula('10 / 0', {})).toBeNull();
    });
    it('decimals', () => {
      expect(evaluateFormula('1.5 * 2', {})).toBe(3);
    });
  });

  describe('string concat & comparison', () => {
    it('concatenates with ||', () => {
      expect(evaluateFormula("'foo' || 'bar'", {})).toBe('foobar');
    });
    it('concat coerces null to empty', () => {
      expect(evaluateFormula("first || ' ' || last", { first: 'Ada', last: 'Lovelace' })).toBe(
        'Ada Lovelace',
      );
      expect(evaluateFormula("first || ' ' || last", { first: 'Ada', last: null })).toBe('Ada ');
    });
    it('numeric comparison', () => {
      expect(evaluateFormula('a > b', { a: 5, b: 3 })).toBe(true);
      expect(evaluateFormula('a < b', { a: 5, b: 3 })).toBe(false);
    });
    it('string comparison fallback', () => {
      expect(evaluateFormula("a == 'paid'", { a: 'paid' })).toBe(true);
      expect(evaluateFormula("a != 'paid'", { a: 'draft' })).toBe(true);
    });
  });

  describe('functions', () => {
    it('ROUND', () => {
      expect(evaluateFormula('ROUND(1.2345, 2)', {})).toBe(1.23);
      expect(evaluateFormula('ROUND(1.5)', {})).toBe(2);
    });
    it('IF', () => {
      expect(evaluateFormula('IF(qty > 0, qty * price, 0)', { qty: 3, price: 2 })).toBe(6);
      expect(evaluateFormula('IF(qty > 0, qty * price, 0)', { qty: 0, price: 2 })).toBe(0);
    });
    it('COALESCE', () => {
      expect(evaluateFormula('COALESCE(a, b, c)', { a: null, b: null, c: 'x' })).toBe('x');
      expect(evaluateFormula('COALESCE(a, b)', { a: 5, b: 9 })).toBe(5);
    });
    it('DATE_DIFF in days', () => {
      const diff = evaluateFormula("DATE_DIFF(a, b)", {
        a: '2026-06-27',
        b: '2026-06-20',
      });
      expect(diff).toBe(7);
    });
    it('UPPER / LOWER / LEN', () => {
      expect(evaluateFormula("UPPER('hi')", {})).toBe('HI');
      expect(evaluateFormula("LOWER('HI')", {})).toBe('hi');
      expect(evaluateFormula("LEN('hello')", {})).toBe(5);
    });
    it('ABS / FLOOR / CEIL / MIN / MAX', () => {
      expect(evaluateFormula('ABS(-4)', {})).toBe(4);
      expect(evaluateFormula('FLOOR(2.9)', {})).toBe(2);
      expect(evaluateFormula('CEIL(2.1)', {})).toBe(3);
      expect(evaluateFormula('MIN(3, 1, 2)', {})).toBe(1);
      expect(evaluateFormula('MAX(3, 1, 2)', {})).toBe(3);
    });
    it('nested function calls', () => {
      expect(evaluateFormula('ROUND(ABS(a - b) / 2, 2)', { a: 10, b: 3 })).toBe(3.5);
    });
  });

  describe('field references', () => {
    it('resolves snake_case fields', () => {
      expect(evaluateFormula('unit_price * quantity', { unit_price: 9.5, quantity: 4 })).toBe(38);
    });
    it('null source propagates to null', () => {
      expect(evaluateFormula('a * b', { a: 5, b: null })).toBeNull();
    });
    it('string-valued numeric field parses', () => {
      expect(evaluateFormula('a + 1', { a: '41' })).toBe(42);
    });
  });

  describe('literals & keywords', () => {
    it('true/false/null', () => {
      expect(evaluateFormula('IF(true, 1, 0)', {})).toBe(1);
      expect(evaluateFormula('COALESCE(null, 7)', {})).toBe(7);
    });
  });

  describe('error handling — injection rejection', () => {
    // No eval/Function: anything outside the grammar + allowlist must throw.
    it('rejects unknown function', () => {
      expect(() => evaluateFormula('EVIL(1)', {})).toThrow(FormulaError);
    });
    it('rejects member access / prototype tricks', () => {
      expect(() => evaluateFormula('constructor', {})).toThrow(FormulaError);
    });
    it('rejects unknown field reference', () => {
      expect(() => evaluateFormula('nonexistent_field + 1', {})).toThrow(FormulaError);
    });
    it('rejects unterminated string', () => {
      expect(() => evaluateFormula("'oops", {})).toThrow(FormulaError);
    });
    it('rejects unexpected character', () => {
      expect(() => evaluateFormula('1 # 2', {})).toThrow(FormulaError);
    });
    it('rejects trailing garbage', () => {
      expect(() => evaluateFormula('1 + 2 )', {})).toThrow(FormulaError);
    });
  });

  describe('validateFormula', () => {
    it('accepts syntactically valid formula with field refs', () => {
      expect(validateFormula('ROUND(quantity * unit_price, 2)')).toEqual({ ok: true });
    });
    it('rejects unknown function without throwing', () => {
      const r = validateFormula('BOGUS(1)');
      expect(r.ok).toBe(false);
    });
    it('rejects malformed formula without throwing', () => {
      const r = validateFormula('1 +');
      expect(r.ok).toBe(false);
    });
    it('empty formula is valid (null result)', () => {
      expect(validateFormula('')).toEqual({ ok: true });
    });
  });
});
