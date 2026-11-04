/*
 * FINSMART – Évaluateur de formules Excel (sous-ensemble utilisé par le moteur SEN_ETAFI).
 * Rejoue les formules du classeur SEN_ETAFI _DGID.xlsx extraites dans engine.json.
 * Fonctionne dans le navigateur et sous Node (module ES, sans dépendance).
 */

// ---------------------------------------------------------------- valeurs
export class XErr { constructor(code) { this.err = code; } toString() { return this.err; } }
const E = {
  NA: new XErr('#N/A'), VALUE: new XErr('#VALUE!'), DIV0: new XErr('#DIV/0!'),
  REF: new XErr('#REF!'), NAME: new XErr('#NAME?'), NUM: new XErr('#NUM!'), CALC: new XErr('#CALC!'),
};
const isErr = v => v instanceof XErr;
const isArr = v => v && v.t === 'arr';
const isRange = v => v && v.t === 'rng';
const mkArr = rows => ({ t: 'arr', rows });

// ---------------------------------------------------------------- utilitaires A1
export function colToNum(s) { let n = 0; for (const ch of s) n = n * 26 + ch.charCodeAt(0) - 64; return n; }
export function numToCol(n) { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
export function parseAddr(a) { const m = /^([A-Z]+)(\d+)$/.exec(a); return { r: +m[2], c: colToNum(m[1]) }; }

// ---------------------------------------------------------------- tokenizer
function tokenize(src) {
  const s = src.startsWith('=') ? src.slice(1) : src;
  const toks = []; let i = 0;
  const refRe = /^(\$?)([A-Z]{1,3})(\$?)(\d+)(?::(\$?)([A-Z]{1,3})(\$?)(\d+))?/;
  const colRe = /^(\$?)([A-Z]{1,3}):(\$?)([A-Z]{1,3})(?![A-Za-z0-9(])/;
  while (i < s.length) {
    const ch = s[i];
    if (ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t') { i++; continue; }
    if (ch === '"') {
      let j = i + 1, str = '';
      while (j < s.length) { if (s[j] === '"') { if (s[j + 1] === '"') { str += '"'; j += 2; continue; } break; } str += s[j++]; }
      toks.push({ k: 'str', v: str }); i = j + 1; continue;
    }
    if (ch === '#') {
      const m = /^#(N\/A|VALUE!|DIV\/0!|REF!|NAME\?|NUM!|NULL!|CALC!)/.exec(s.slice(i));
      if (m) { toks.push({ k: 'err', v: m[0] }); i += m[0].length; continue; }
    }
    if ('+-*/^&(),{};%'.includes(ch)) { toks.push({ k: 'op', v: ch }); i++; continue; }
    if (ch === '<' || ch === '>' || ch === '=') {
      const two = s.slice(i, i + 2);
      if (two === '<=' || two === '>=' || two === '<>') { toks.push({ k: 'op', v: two }); i += 2; continue; }
      toks.push({ k: 'op', v: ch }); i++; continue;
    }
    // préfixe de feuille
    let sheet = null, rest = s.slice(i), adv = 0;
    if (ch === "'") {
      let j = i + 1, nm = '';
      while (j < s.length) { if (s[j] === "'") { if (s[j + 1] === "'") { nm += "'"; j += 2; continue; } break; } nm += s[j++]; }
      if (s[j + 1] === '!') { sheet = nm; adv = j + 2 - i; rest = s.slice(i + adv); }
    } else {
      const m = /^([A-Za-z_][A-Za-z0-9_\.]*)!/.exec(rest);
      if (m) { sheet = m[1]; adv = m[0].length; rest = rest.slice(adv); }
    }
    let m = colRe.exec(rest);
    if (m) {
      toks.push({ k: 'ref', sheet, a: { r: 1, c: colToNum(m[2]), ra: true, ca: !!m[1] }, b: { r: 1048576, c: colToNum(m[4]), ra: true, ca: !!m[3] }, fullCol: true });
      i += adv + m[0].length; continue;
    }
    m = refRe.exec(rest);
    if (m && !/^[A-Za-z0-9_(]/.test(rest.slice(m[0].length))) {
      const a = { r: +m[4], c: colToNum(m[2]), ra: !!m[3], ca: !!m[1] };
      const b = m[6] ? { r: +m[8], c: colToNum(m[6]), ra: !!m[7], ca: !!m[5] } : null;
      toks.push({ k: 'ref', sheet, a, b }); i += adv + m[0].length; continue;
    }
    if (sheet) throw new Error('Référence non reconnue : ' + s.slice(i, i + 30));
    m = /^\d+(\.\d+)?([eE][+-]?\d+)?/.exec(rest);
    if (m) { toks.push({ k: 'num', v: parseFloat(m[0]) }); i += m[0].length; continue; }
    m = /^[A-Za-z_][A-Za-z0-9_\.]*/.exec(rest);
    if (m) {
      const name = m[0].toUpperCase().replace(/^_XLFN\._XLWS\.|^_XLFN\./, '');
      if (s[i + m[0].length] === '(') toks.push({ k: 'fn', v: name });
      else if (name === 'TRUE' || name === 'FALSE') toks.push({ k: 'bool', v: name === 'TRUE' });
      else toks.push({ k: 'name', v: name });
      i += m[0].length; continue;
    }
    throw new Error('Caractère inattendu « ' + ch + ' » dans ' + src);
  }
  return toks;
}

// ---------------------------------------------------------------- parser (Pratt)
const BIN = { '=': 1, '<>': 1, '<': 1, '>': 1, '<=': 1, '>=': 1, '&': 2, '+': 3, '-': 3, '*': 4, '/': 4, '^': 5 };
export function parse(src) {
  const toks = tokenize(src); let p = 0;
  const peek = () => toks[p]; const next = () => toks[p++];
  const expect = v => { const t = next(); if (!t || t.v !== v) throw new Error('Attendu ' + v + ' dans ' + src); };
  function primary() {
    const t = next();
    if (!t) throw new Error('Fin inattendue : ' + src);
    if (t.k === 'num') return { n: 'lit', v: t.v };
    if (t.k === 'str') return { n: 'lit', v: t.v };
    if (t.k === 'bool') return { n: 'lit', v: t.v };
    if (t.k === 'err') return { n: 'lit', v: new XErr(t.v) };
    if (t.k === 'ref') return { n: 'ref', sheet: t.sheet, a: t.a, b: t.b, fullCol: !!t.fullCol };
    if (t.k === 'name') return { n: 'lit', v: E.NAME };
    if (t.k === 'op' && t.v === '(') { const e = expr(0); expect(')'); return e; }
    if (t.k === 'op' && (t.v === '-' || t.v === '+')) { const e = unary(); return t.v === '-' ? { n: 'neg', e } : { n: 'pos', e }; }
    if (t.k === 'op' && t.v === '{') {
      const rows = [[]];
      while (true) {
        let neg = false; let tk = next();
        if (tk.k === 'op' && tk.v === '-') { neg = true; tk = next(); }
        let v = tk.k === 'num' ? (neg ? -tk.v : tk.v) : tk.k === 'err' ? new XErr(tk.v) : tk.v;
        rows[rows.length - 1].push(v);
        const sep = next();
        if (sep.v === '}') break;
        if (sep.v === ';') rows.push([]);
      }
      return { n: 'lit', v: mkArr(rows) };
    }
    if (t.k === 'fn') {
      expect('('); const args = [];
      if (!(peek().k === 'op' && peek().v === ')')) {
        while (true) {
          if (peek().k === 'op' && (peek().v === ',' || peek().v === ')')) args.push({ n: 'lit', v: null });
          else args.push(expr(0));
          const sep = next();
          if (sep.v === ')') break;
          if (sep.v !== ',') throw new Error('Séparateur inattendu dans ' + src);
        }
      } else next();
      return { n: 'fn', f: t.v, args };
    }
    throw new Error('Jeton inattendu ' + JSON.stringify(t) + ' dans ' + src);
  }
  function unary() {
    const t = peek();
    if (t && t.k === 'op' && (t.v === '-' || t.v === '+')) { next(); const e = unary(); return t.v === '-' ? { n: 'neg', e } : { n: 'pos', e }; }
    let e = primary();
    while (peek() && peek().k === 'op' && peek().v === '%') { next(); e = { n: 'pct', e }; }
    return e;
  }
  function expr(minP) {
    let left = unary();
    while (true) {
      const t = peek();
      if (!t || t.k !== 'op' || !(t.v in BIN)) break;
      const pr = BIN[t.v]; if (pr < minP) break;
      next();
      const right = expr(t.v === '^' ? pr : pr + 1);
      left = { n: 'bin', op: t.v, l: left, r: right };
    }
    return left;
  }
  const ast = expr(0);
  if (p < toks.length) throw new Error('Jetons restants dans ' + src);
  return ast;
}

// ---------------------------------------------------------------- coercitions
function toNum(v) {
  if (isErr(v)) return v;
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string') {
    const s = v.trim().replace(/ /g, '');
    if (s === '') return E.VALUE;
    const n = Number(s);
    return isNaN(n) ? E.VALUE : n;
  }
  return E.VALUE;
}
function fmtNum(n) {
  if (Number.isInteger(n)) return String(n);
  let s = n.toPrecision(15); if (s.includes('e')) return String(n);
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s;
}
function toStr(v) {
  if (isErr(v)) return v;
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return fmtNum(v);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return String(v);
}
function toBool(v) {
  if (isErr(v)) return v;
  if (v === null || v === undefined) return false;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  const s = String(v).toUpperCase();
  if (s === 'TRUE' || s === 'VRAI') return true;
  if (s === 'FALSE' || s === 'FAUX') return false;
  return E.VALUE;
}
const typeRank = v => (typeof v === 'number' ? 1 : typeof v === 'string' ? 2 : typeof v === 'boolean' ? 3 : 0);
function cmp(a, b) {
  if (a === null || a === undefined) a = typeof b === 'string' ? '' : typeof b === 'boolean' ? false : 0;
  if (b === null || b === undefined) b = typeof a === 'string' ? '' : typeof a === 'boolean' ? false : 0;
  const ra = typeRank(a), rb = typeRank(b);
  if (ra !== rb) return ra < rb ? -1 : 1;
  if (ra === 2) { const x = a.toLowerCase(), y = b.toLowerCase(); return x < y ? -1 : x > y ? 1 : 0; }
  if (ra === 3) return a === b ? 0 : a ? 1 : -1;
  return a < b ? -1 : a > b ? 1 : 0;
}
function wildcardRe(pat) {
  let re = '';
  for (let i = 0; i < pat.length; i++) {
    const ch = pat[i];
    if (ch === '~' && i + 1 < pat.length) { re += pat[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); continue; }
    if (ch === '*') re += '[\\s\\S]*'; else if (ch === '?') re += '[\\s\\S]';
    else re += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + re + '$', 'i');
}
// critère SUMIFS / COUNTIF
function makeCriterion(crit) {
  if (isErr(crit)) return v => isErr(v) && v.err === crit.err;
  if (crit === null || crit === undefined) crit = 0;
  if (typeof crit === 'number') return v => (typeof v === 'number' && v === crit) || (typeof v === 'string' && v.trim() !== '' && Number(v) === crit);
  if (typeof crit === 'boolean') return v => v === crit;
  let s = String(crit), op = '=';
  const m = /^(<=|>=|<>|<|>|=)/.exec(s);
  if (m) { op = m[1]; s = s.slice(m[1].length); }
  const num = s.trim() !== '' && !isNaN(Number(s)) ? Number(s) : null;
  if (op === '=' || op === '<>') {
    let test;
    if (s === '') test = v => v === null || v === undefined || v === '';
    else if (num !== null) test = v => (typeof v === 'number' && v === num) || (typeof v === 'string' && v.trim() !== '' && Number(v) === num);
    else if (/[*?~]/.test(s)) { const re = wildcardRe(s); test = v => typeof v === 'string' && re.test(v); }
    else { const ls = s.toLowerCase(); test = v => typeof v === 'string' && v.toLowerCase() === ls; }
    if (op === '=') return test;
    return v => !test(v);
  }
  return v => {
    if (num !== null) { if (typeof v !== 'number') return false; return op === '<' ? v < num : op === '>' ? v > num : op === '<=' ? v <= num : v >= num; }
    if (typeof v !== 'string') return false;
    const c = cmp(v, s); return op === '<' ? c < 0 : op === '>' ? c > 0 : op === '<=' ? c <= 0 : c >= 0;
  };
}

// ---------------------------------------------------------------- moteur
export class Workbook {
  /** @param {object} engine  contenu de engine.json */
  constructor(engine) {
    this.engine = engine;
    this.sheets = {};
    this.asts = engine.templates.map(() => null);
    for (const [name, sh] of Object.entries(engine.sheets)) {
      const formulas = new Map();
      for (const [col, r1, r2, tpl] of sh.f) for (let r = r1; r <= r2; r++) formulas.set(r * 16384 + col, tpl);
      const consts = new Map();
      for (const [addr, v] of Object.entries(sh.c)) {
        const { r, c } = parseAddr(addr);
        consts.set(r * 16384 + c, (v && typeof v === 'object' && 'b' in v) ? v.b : v);
      }
      this.sheets[name] = { maxRow: sh.maxRow, formulas, consts };
    }
    this.cache = new Map(); // feuille -> Map(clé -> valeur)
    this.inProgress = new Set();
    this.warnings = [];
  }
  /** écrit une valeur saisie (remplace constante ou formule) */
  setValue(sheet, addr, value) {
    const sh = this.sheets[sheet]; if (!sh) throw new Error('Feuille inconnue ' + sheet);
    const { r, c } = typeof addr === 'string' ? parseAddr(addr) : addr;
    const k = r * 16384 + c;
    sh.formulas.delete(k);
    if (value === null || value === undefined || value === '') sh.consts.delete(k); else sh.consts.set(k, value);
    sh.maxRow = Math.max(sh.maxRow, r);
    this.cache.clear();
  }
  /** Limite les plages des balances à la dernière ligne saisie (accélère SUMIFS/SUMPRODUCT). */
  setUsedRow(sheet, row) { this.sheets[sheet].usedRow = row; this.cache.clear(); }
  clearRange(sheet, r1, c1, r2, c2) {
    const sh = this.sheets[sheet];
    for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) sh.consts.delete(r * 16384 + c);
    this.cache.clear();
  }
  hasFormula(sheet, r, c) { const sh = this.sheets[sheet]; return !!sh && sh.formulas.has(r * 16384 + c); }
  getAddr(sheet, addr) { const { r, c } = parseAddr(addr); return this.get(sheet, r, c); }
  /** valeur scalaire d'une cellule */
  get(sheet, r, c) {
    const sh = this.sheets[sheet];
    if (!sh) return E.REF;
    const k = r * 16384 + c;
    const tpl = sh.formulas.get(k);
    if (tpl === undefined) { const v = sh.consts.get(k); return v === undefined ? null : v; }
    let sc = this.cache.get(sheet); if (!sc) { sc = new Map(); this.cache.set(sheet, sc); }
    const hit = sc.get(k); if (hit !== undefined) return hit;
    const ck = sheet + '|' + k;
    if (this.inProgress.has(ck)) { this.warnings.push('Référence circulaire : ' + sheet + '!' + numToCol(c) + r); return 0; }
    this.inProgress.add(ck);
    let v;
    try {
      const [text, tr, tc, isArray] = this.engine.templates[tpl];
      if (!this.asts[tpl]) this.asts[tpl] = parse(text);
      const ctx = { sheet, dr: r - tr, dc: c - tc, arr: !!isArray, r, c };
      v = this.eval(this.asts[tpl], ctx);
      v = this.scalarize(v, ctx, true);
      if (v === null || v === undefined) v = 0; // formule pointant sur vide => 0
    } catch (e) {
      this.warnings.push('Erreur ' + sheet + '!' + numToCol(c) + r + ' : ' + e.message);
      v = E.VALUE;
    }
    this.inProgress.delete(ck);
    sc.set(k, v);
    return v;
  }
  // ----- références
  resolveRef(node, ctx) {
    const sheet = node.sheet || ctx.sheet;
    const sh = this.sheets[sheet]; if (!sh) return E.REF;
    const pos = p => ({ r: p.ra ? p.r : p.r + ctx.dr, c: p.ca ? p.c : p.c + ctx.dc });
    const a = pos(node.a);
    if (!node.b) return { t: 'rng', sheet, r1: a.r, c1: a.c, r2: a.r, c2: a.c };
    const b = node.fullCol ? { r: 1048576, c: node.b.ca ? node.b.c : node.b.c + ctx.dc } : pos(node.b);
    let r1 = Math.min(a.r, b.r), r2 = Math.max(a.r, b.r);
    if (node.fullCol) { r1 = 1; r2 = sh.usedRow || sh.maxRow; }
    return { t: 'rng', sheet, r1, c1: Math.min(a.c, b.c), r2, c2: Math.max(a.c, b.c) };
  }
  rangeToArr(rg) {
    const sh = this.sheets[rg.sheet];
    const r2 = Math.min(rg.r2, Math.max(sh.usedRow || sh.maxRow, rg.r1));
    const rows = [];
    for (let r = rg.r1; r <= r2; r++) { const row = []; for (let c = rg.c1; c <= rg.c2; c++) row.push(this.get(rg.sheet, r, c)); rows.push(row); }
    // lignes au-delà de maxRow : vides
    for (let r = r2 + 1; r <= rg.r2 && rows.length < 20000; r++) rows.push(new Array(rg.c2 - rg.c1 + 1).fill(null));
    return mkArr(rows);
  }
  // valeur "array-able" : plage -> tableau
  toArray(v) { if (isRange(v)) return this.rangeToArr(v); if (isArr(v)) return v; return mkArr([[v]]); }
  scalarize(v, ctx, final = false) {
    if (isRange(v)) {
      if (v.r1 === v.r2 && v.c1 === v.c2) return this.get(v.sheet, v.r1, v.c1);
      if (ctx.arr && !final) return this.rangeToArr(v);
      // intersection implicite
      if (v.c1 === v.c2 && ctx.r >= v.r1 && ctx.r <= v.r2) return this.get(v.sheet, ctx.r, v.c1);
      if (v.r1 === v.r2 && ctx.c >= v.c1 && ctx.c <= v.c2) return this.get(v.sheet, v.r1, ctx.c);
      if (ctx.arr) return this.get(v.sheet, v.r1, v.c1);
      return E.VALUE;
    }
    if (isArr(v) && final) return v.rows.length && v.rows[0].length ? v.rows[0][0] : E.CALC;
    return v;
  }
  // valeur pour un argument scalaire (tableau conservé en mode matriciel)
  val(node, ctx) {
    const v = this.eval(node, ctx);
    if (isRange(v)) {
      if (v.r1 === v.r2 && v.c1 === v.c2) return this.get(v.sheet, v.r1, v.c1);
      return ctx.arr ? this.rangeToArr(v) : this.scalarize(v, ctx);
    }
    return v;
  }
  // ----- évaluation
  eval(node, ctx) {
    switch (node.n) {
      case 'lit': return node.v;
      case 'ref': return this.resolveRef(node, ctx);
      case 'neg': return lift1(this.val(node.e, ctx), x => { const n = toNum(x); return isErr(n) ? n : -n; });
      case 'pos': return this.val(node.e, ctx);
      case 'pct': return lift1(this.val(node.e, ctx), x => { const n = toNum(x); return isErr(n) ? n : n / 100; });
      case 'bin': return lift2(this.val(node.l, ctx), this.val(node.r, ctx), (a, b) => binop(node.op, a, b));
      case 'fn': {
        const f = FN[node.f];
        if (!f) { this.warnings.push('Fonction non gérée : ' + node.f); return E.NAME; }
        return f.call(this, node.args, ctx);
      }
    }
    throw new Error('Nœud inconnu');
  }
}

function binop(op, a, b) {
  if (isErr(a)) return a; if (isErr(b)) return b;
  switch (op) {
    case '+': case '-': case '*': case '/': case '^': {
      const x = toNum(a), y = toNum(b);
      if (isErr(x)) return x; if (isErr(y)) return y;
      if (op === '+') return x + y; if (op === '-') return x - y; if (op === '*') return x * y;
      if (op === '/') return y === 0 ? E.DIV0 : x / y;
      return Math.pow(x, y);
    }
    case '&': return toStr(a) + toStr(b);
    case '=': return cmp(a, b) === 0; case '<>': return cmp(a, b) !== 0;
    case '<': return cmp(a, b) < 0; case '>': return cmp(a, b) > 0;
    case '<=': return cmp(a, b) <= 0; case '>=': return cmp(a, b) >= 0;
  }
}
function lift1(v, fn) { if (isArr(v)) return mkArr(v.rows.map(r => r.map(fn))); return fn(v); }
function lift2(a, b, fn) {
  if (!isArr(a) && !isArr(b)) return fn(a, b);
  const A = isArr(a) ? a.rows : [[a]], B = isArr(b) ? b.rows : [[b]];
  const R = Math.max(A.length, B.length), C = Math.max(A[0].length, B[0].length);
  const get = (M, r, c) => {
    const rr = M.length === 1 ? 0 : r, cc = M[0].length === 1 ? 0 : c;
    if (rr >= M.length || cc >= M[0].length) return E.NA;
    return M[rr][cc];
  };
  const rows = [];
  for (let r = 0; r < R; r++) { const row = []; for (let c = 0; c < C; c++) row.push(fn(get(A, r, c), get(B, r, c))); rows.push(row); }
  return mkArr(rows);
}
function liftN(vals, fn) {
  if (!vals.some(isArr)) return fn(...vals);
  let acc = null; // broadcast successif
  const R = Math.max(...vals.map(v => isArr(v) ? v.rows.length : 1));
  const C = Math.max(...vals.map(v => isArr(v) ? v.rows[0].length : 1));
  const rows = [];
  for (let r = 0; r < R; r++) {
    const row = [];
    for (let c = 0; c < C; c++) row.push(fn(...vals.map(v => {
      if (!isArr(v)) return v;
      const rr = v.rows.length === 1 ? 0 : r, cc = v.rows[0].length === 1 ? 0 : c;
      return rr < v.rows.length && cc < v.rows[0].length ? v.rows[rr][cc] : E.NA;
    })));
    rows.push(row);
  }
  return mkArr(rows);
}
const flat = a => a.rows.flat();

// fonctions scalaires génériques (diffusées sur tableaux)
function scalarFn(fn) {
  return function (args, ctx) { return liftN(args.map(a => this.val(a, ctx)), fn); };
}
// valeurs numériques d'arguments agrégés (SUM, MAX, MIN…)
function aggNums(self, args, ctx, out) {
  for (const a of args) {
    const v = self.eval(a, ctx);
    if (isRange(v) || isArr(v)) {
      for (const x of flat(self.toArray(v))) { if (isErr(x)) return x; if (typeof x === 'number') out.push(x); }
    } else {
      const s = self.scalarize(v, ctx);
      if (s === null) continue;
      const n = toNum(s); if (isErr(n)) return n; out.push(n);
    }
  }
  return null;
}
function excelRound(x, d, mode) {
  const f = Math.pow(10, d);
  const y = x * f;
  const r = mode === 'down' ? Math.trunc(y) : mode === 'up' ? (y < 0 ? Math.floor(y) : Math.ceil(y)) : Math.sign(y) * Math.round(Math.abs(y) + 1e-9);
  return r / f;
}
function serialToDate(n) { const ms = Math.round((n - 25569) * 86400000); return new Date(ms); }
function textFmt(v, fmt) {
  if (typeof v === 'string' && isNaN(Number(v))) return v;
  const n = toNum(v); if (isErr(n)) return n;
  const f = fmt.toLowerCase();
  if (/^0+$/.test(fmt)) return String(Math.round(Math.abs(n))).padStart(fmt.length, '0').replace(/^/, n < 0 ? '-' : '');
  if (/[dmy]/.test(f)) {
    const d = serialToDate(n);
    const dd = String(d.getUTCDate()).padStart(2, '0'), mm = String(d.getUTCMonth() + 1).padStart(2, '0'), yy = String(d.getUTCFullYear());
    return f.replace('yyyy', yy).replace('aaaa', yy).replace('mm', mm).replace('dd', dd).replace('jj', dd);
  }
  if (fmt.includes('#,##0')) return Math.round(n).toLocaleString('fr-FR').replace(/ | /g, ' ');
  return fmtNum(n);
}

const FN = {
  IF(args, ctx) {
    const c = this.val(args[0], ctx);
    const pick = b => args[b ? 1 : 2] ? this.eval(args[b ? 1 : 2], ctx) : (b ? true : false);
    if (isArr(c)) {
      const t = args[1] ? this.val(args[1], ctx) : true, f = args[2] ? this.val(args[2], ctx) : false;
      return liftN([c, t, f], (cc, tt, ff) => { const b = toBool(cc); return isErr(b) ? b : b ? tt : ff; });
    }
    const b = toBool(c); if (isErr(b)) return b;
    const r = pick(b);
    return r === null && args[b ? 1 : 2] && args[b ? 1 : 2].n === 'lit' ? 0 : r;
  },
  IFERROR(args, ctx) {
    const v = this.val(args[0], ctx);
    if (isArr(v)) { const alt = this.val(args[1], ctx); return lift2(v, alt, (x, y) => isErr(x) ? y : x); }
    return isErr(v) ? this.eval(args[1], ctx) : v;
  },
  ISERROR: scalarFn(v => isErr(v)),
  ISNUMBER: scalarFn(v => typeof v === 'number'),
  ISTEXT: scalarFn(v => typeof v === 'string'),
  NOT: scalarFn(v => { const b = toBool(v); return isErr(b) ? b : !b; }),
  AND(args, ctx) { return logical(this, args, ctx, true); },
  OR(args, ctx) { return logical(this, args, ctx, false); },
  N(args, ctx) {
    const v = this.eval(args[0], ctx);
    const one = x => typeof x === 'number' ? x : typeof x === 'boolean' ? (x ? 1 : 0) : isErr(x) ? x : 0;
    if (isRange(v)) { if (ctx.arr && !(v.r1 === v.r2 && v.c1 === v.c2)) return lift1(this.rangeToArr(v), one); return one(this.get(v.sheet, v.r1, v.c1)); }
    return lift1(v, one);
  },
  ABS: scalarFn(v => { const n = toNum(v); return isErr(n) ? n : Math.abs(n); }),
  ROUND: scalarFn((v, d) => { const n = toNum(v), k = toNum(d ?? 0); return isErr(n) ? n : excelRound(n, k, 'half'); }),
  ROUNDDOWN: scalarFn((v, d) => { const n = toNum(v), k = toNum(d ?? 0); return isErr(n) ? n : excelRound(n, k, 'down'); }),
  ROUNDUP: scalarFn((v, d) => { const n = toNum(v), k = toNum(d ?? 0); return isErr(n) ? n : excelRound(n, k, 'up'); }),
  INT: scalarFn(v => { const n = toNum(v); return isErr(n) ? n : Math.floor(n); }),
  LEFT: scalarFn((s, n) => { const t = toStr(s); if (isErr(t)) return t; const k = n === undefined || n === null ? 1 : toNum(n); if (isErr(k)) return k; if (k < 0) return E.VALUE; return t.slice(0, Math.floor(k)); }),
  RIGHT: scalarFn((s, n) => { const t = toStr(s); if (isErr(t)) return t; const k = n === undefined || n === null ? 1 : toNum(n); if (isErr(k)) return k; return k <= 0 ? '' : t.slice(-Math.floor(k)); }),
  MID: scalarFn((s, st, n) => { const t = toStr(s); if (isErr(t)) return t; const a = toNum(st), b = toNum(n); if (isErr(a)) return a; if (isErr(b)) return b; if (a < 1 || b < 0) return E.VALUE; return t.substr(Math.floor(a) - 1, Math.floor(b)); }),
  LEN: scalarFn(s => { const t = toStr(s); return isErr(t) ? t : t.length; }),
  TRIM: scalarFn(s => { const t = toStr(s); return isErr(t) ? t : t.replace(/ +/g, ' ').trim(); }),
  UPPER: scalarFn(s => { const t = toStr(s); return isErr(t) ? t : t.toUpperCase(); }),
  SUBSTITUTE: scalarFn((s, o, n, k) => {
    const t = toStr(s), a = toStr(o), b = toStr(n); if (isErr(t)) return t;
    if (a === '') return t;
    if (k === undefined || k === null) return t.split(a).join(b);
    let idx = -1; for (let i = 0; i < toNum(k); i++) { idx = t.indexOf(a, idx + 1); if (idx < 0) return t; }
    return t.slice(0, idx) + b + t.slice(idx + a.length);
  }),
  SEARCH: scalarFn((f, w, st) => {
    const a = toStr(f), b = toStr(w); if (isErr(a)) return a; if (isErr(b)) return b;
    const s0 = st === undefined || st === null ? 1 : toNum(st);
    const re = new RegExp(wildcardRe(a).source.slice(1, -1), 'i');
    const m = re.exec(b.slice(s0 - 1)); return m ? m.index + s0 : E.VALUE;
  }),
  FIND: scalarFn((f, w, st) => { const a = toStr(f), b = toStr(w); const s0 = st === undefined || st === null ? 1 : toNum(st); const i = b.indexOf(a, s0 - 1); return i < 0 ? E.VALUE : i + 1; }),
  TEXT: scalarFn((v, f) => textFmt(v, toStr(f))),
  VALUE: scalarFn(v => toNum(v)),
  CONCATENATE: scalarFn((...xs) => { let s = ''; for (const x of xs) { const t = toStr(x); if (isErr(t)) return t; s += t; } return s; }),
  DATEDIF: scalarFn((a, b, u) => {
    const x = toNum(a), y = toNum(b); if (isErr(x)) return x; if (isErr(y)) return y; if (x > y) return E.NUM;
    const d1 = serialToDate(x), d2 = serialToDate(y), unit = toStr(u).toUpperCase();
    if (unit === 'D') return Math.floor(y) - Math.floor(x);
    let m = (d2.getUTCFullYear() - d1.getUTCFullYear()) * 12 + d2.getUTCMonth() - d1.getUTCMonth();
    if (d2.getUTCDate() < d1.getUTCDate()) m--;
    if (unit === 'M') return m; if (unit === 'Y') return Math.floor(m / 12);
    return E.NUM;
  }),
  YEAR: scalarFn(v => { const n = toNum(v); return isErr(n) ? n : serialToDate(n).getUTCFullYear(); }),
  MONTH: scalarFn(v => { const n = toNum(v); return isErr(n) ? n : serialToDate(n).getUTCMonth() + 1; }),
  DAY: scalarFn(v => { const n = toNum(v); return isErr(n) ? n : serialToDate(n).getUTCDate(); }),
  SUM(args, ctx) { const out = []; const e = aggNums(this, args, ctx, out); return e || out.reduce((a, b) => a + b, 0); },
  MAX(args, ctx) { const out = []; const e = aggNums(this, args, ctx, out); return e || (out.length ? Math.max(...out) : 0); },
  MIN(args, ctx) { const out = []; const e = aggNums(this, args, ctx, out); return e || (out.length ? Math.min(...out) : 0); },
  AVERAGE(args, ctx) { const out = []; const e = aggNums(this, args, ctx, out); return e || (out.length ? out.reduce((a, b) => a + b, 0) / out.length : E.DIV0); },
  COUNT(args, ctx) { let n = 0; for (const a of args) { const v = this.eval(a, ctx); for (const x of flat(this.toArray(v))) if (typeof x === 'number') n++; } return n; },
  COUNTA(args, ctx) { let n = 0; for (const a of args) { const v = this.eval(a, ctx); for (const x of flat(this.toArray(v))) if (x !== null && x !== undefined) n++; } return n; },
  COUNTBLANK(args, ctx) { let n = 0; for (const a of args) { const v = this.eval(a, ctx); for (const x of flat(this.toArray(v))) if (x === null || x === undefined || x === '') n++; } return n; },
  SUMPRODUCT(args, ctx) {
    const c2 = { ...ctx, arr: true };
    const arrs = args.map(a => this.toArray(this.val(a, c2)));
    const n = arrs[0].rows.length, m = arrs[0].rows[0].length;
    for (const a of arrs) if (a.rows.length !== n || a.rows[0].length !== m) return E.VALUE;
    let s = 0;
    for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) {
      let p = 1;
      for (const a of arrs) { const x = a.rows[i][j]; if (isErr(x)) return x; p *= typeof x === 'number' ? x : 0; }
      s += p;
    }
    return s;
  },
  SUMIF(args, ctx) {
    const rg = this.toArray(this.eval(args[0], ctx));
    const crit = this.scalarize(this.val(args[1], ctx), ctx);
    const sum = args[2] ? this.toArray(this.eval(args[2], ctx)) : rg;
    const test = makeCriterion(crit); let s = 0;
    rg.rows.forEach((row, i) => row.forEach((v, j) => { if (test(v)) { const x = sum.rows[i] && sum.rows[i][j]; if (typeof x === 'number') s += x; } }));
    return s;
  },
  SUMIFS(args, ctx) { return ifs(this, args, ctx, true); },
  COUNTIFS(args, ctx) { return ifs(this, [null, ...args], ctx, false); },
  COUNTIF(args, ctx) {
    const rg = this.toArray(this.eval(args[0], ctx));
    const critV = this.val(args[1], ctx);
    const count = crit => { const test = makeCriterion(crit); let n = 0; for (const v of flat(rg)) if (test(v)) n++; return n; };
    if (isArr(critV)) return lift1(critV, count);
    return count(critV);
  },
  INDEX(args, ctx) {
    const src = this.eval(args[0], ctx);
    const r = args[1] ? toNum(this.scalarize(this.val(args[1], ctx), ctx)) : 0;
    const c = args[2] ? toNum(this.scalarize(this.val(args[2], ctx), ctx)) : 0;
    if (isErr(r)) return r; if (isErr(c)) return c;
    if (isRange(src)) {
      const nr = src.r2 - src.r1 + 1, nc = src.c2 - src.c1 + 1;
      let rr = r, cc = c;
      if (nr === 1 && args.length === 2) { cc = r; rr = 1; }
      if (rr > nr || cc > nc || rr < 0 || cc < 0) return E.REF;
      return { t: 'rng', sheet: src.sheet, r1: rr ? src.r1 + rr - 1 : src.r1, r2: rr ? src.r1 + rr - 1 : src.r2, c1: cc ? src.c1 + cc - 1 : src.c1, c2: cc ? src.c1 + cc - 1 : src.c2 };
    }
    const a = this.toArray(src); const nr = a.rows.length, nc = a.rows[0].length;
    let rr = r, cc = c;
    if (nr === 1 && args.length === 2) { cc = r; rr = 1; }
    if (rr > nr || cc > nc) return E.REF;
    if (rr && cc) return a.rows[rr - 1][cc - 1];
    if (rr) return mkArr([a.rows[rr - 1]]);
    if (cc) return mkArr(a.rows.map(row => [row[cc - 1]]));
    return a;
  },
  MATCH(args, ctx) {
    const lv = this.val(args[0], ctx);
    const arr = flat(this.toArray(this.eval(args[1], { ...ctx, arr: true })));
    const type = args[2] ? toNum(this.scalarize(this.val(args[2], ctx), ctx)) : 1;
    const one = v => {
      if (isErr(v)) return v;
      if (type === 0) {
        if (typeof v === 'string' && /[*?~]/.test(v)) { const re = wildcardRe(v); const i = arr.findIndex(x => typeof x === 'string' && re.test(x)); return i < 0 ? E.NA : i + 1; }
        const i = arr.findIndex(x => x !== null && !isErr(x) && typeRank(x) === typeRank(v) && cmp(x, v) === 0);
        return i < 0 ? E.NA : i + 1;
      }
      let best = -1;
      for (let i = 0; i < arr.length; i++) {
        const x = arr[i]; if (x === null || isErr(x) || typeRank(x) !== typeRank(v)) continue;
        const c = cmp(x, v);
        if (type > 0 ? c <= 0 : c >= 0) best = i; else break;
      }
      return best < 0 ? E.NA : best + 1;
    };
    return isArr(lv) ? lift1(lv, one) : one(this.scalarize(lv, ctx));
  },
  VLOOKUP(args, ctx) {
    const v = this.scalarize(this.val(args[0], ctx), ctx);
    const t = this.toArray(this.eval(args[1], ctx));
    const col = toNum(this.scalarize(this.val(args[2], ctx), ctx));
    const approx = args[3] ? toBool(this.scalarize(this.val(args[3], ctx), ctx)) : true;
    if (isErr(v)) return v;
    if (col < 1 || col > t.rows[0].length) return E.REF;
    if (!approx) {
      const re = typeof v === 'string' && /[*?~]/.test(v) ? wildcardRe(v) : null;
      for (const row of t.rows) { const x = row[0]; if (re ? (typeof x === 'string' && re.test(x)) : (x !== null && typeRank(x) === typeRank(v) && cmp(x, v) === 0)) return row[col - 1] ?? 0; }
      return E.NA;
    }
    let best = null;
    for (const row of t.rows) { const x = row[0]; if (x === null || typeRank(x) !== typeRank(v)) continue; if (cmp(x, v) <= 0) best = row; else break; }
    return best ? (best[col - 1] ?? 0) : E.NA;
  },
  CHOOSE(args, ctx) {
    const idx = this.val(args[0], ctx);
    if (isArr(idx)) {
      const opts = args.slice(1).map(a => this.toArray(this.val(a, { ...ctx, arr: true })));
      // CHOOSE({1,2,3}, col1, col2, col3) => assemble horizontalement
      const n = Math.max(...opts.map(o => o.rows.length));
      const ks = flat(idx);
      const rows = [];
      for (let i = 0; i < n; i++) rows.push(ks.map(k => { const o = opts[toNum(k) - 1]; if (!o) return E.VALUE; const rr = o.rows.length === 1 ? 0 : i; return o.rows[rr] ? o.rows[rr][0] : E.NA; }));
      return mkArr(rows);
    }
    const k = toNum(this.scalarize(idx, ctx)); if (isErr(k)) return k;
    if (k < 1 || k >= args.length) return E.VALUE;
    return this.eval(args[k], ctx);
  },
  FILTER(args, ctx) {
    const c2 = { ...ctx, arr: true };
    const a = this.toArray(this.val(args[0], c2));
    const inc = this.toArray(this.val(args[1], c2));
    const rows = a.rows.filter((_, i) => { const x = inc.rows[i] ? inc.rows[i][0] : false; const b = toBool(x); return b === true; });
    if (!rows.length) return args[2] ? this.val(args[2], ctx) : E.CALC;
    return mkArr(rows);
  },
  ISFORMULA(args, ctx) {
    const v = this.eval(args[0], ctx);
    if (!isRange(v)) return E.VALUE;
    return this.hasFormula(v.sheet, v.r1, v.c1);
  },
  ROW(args, ctx) { if (!args.length) return ctx.r; const v = this.eval(args[0], ctx); return isRange(v) ? v.r1 : E.VALUE; },
  COLUMN(args, ctx) { if (!args.length) return ctx.c; const v = this.eval(args[0], ctx); return isRange(v) ? v.c1 : E.VALUE; },
  ROWS(args, ctx) { const v = this.eval(args[0], ctx); return isRange(v) ? v.r2 - v.r1 + 1 : this.toArray(v).rows.length; },
  TODAY() { const d = new Date(); return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000) + 25569; },
};
function logical(self, args, ctx, isAnd) {
  let seen = false;
  for (const a of args) {
    const v = self.eval(a, ctx);
    const items = isRange(v) || isArr(v) ? flat(self.toArray(v)).filter(x => typeof x === 'number' || typeof x === 'boolean' || isErr(x)) : [self.scalarize(v, ctx)];
    for (const x of items) {
      if (isErr(x)) return x;
      if (x === null) continue;
      const b = toBool(x); if (isErr(b)) { if (typeof x === 'string') continue; return b; }
      seen = true;
      if (isAnd && !b) return false;
      if (!isAnd && b) return true;
    }
  }
  if (!seen) return E.VALUE;
  return isAnd;
}
function ifs(self, args, ctx, isSum) {
  const sumRg = isSum ? self.eval(args[0], ctx) : null;
  const rgs = [], crits = [];
  for (let i = 1; i < args.length; i += 2) {
    rgs.push(self.eval(args[i], ctx));
    const cv = self.val(args[i + 1], ctx);
    crits.push(isArr(cv) ? cv : self.scalarize(cv, ctx));
  }
  if (crits.some(isArr)) return liftN(crits, (...cs) => ifsCore(self, sumRg, rgs, cs, isSum));
  return ifsCore(self, sumRg, rgs, crits, isSum);
}
function ifsCore(self, sumRg, rgs, crits, isSum) {
  const pairs = rgs.map((rg, k) => ({ rg, test: makeCriterion(crits[k]) }));
  const base = sumRg || pairs[0].rg;
  if (!isRange(base)) return E.VALUE;
  const nr = base.r2 - base.r1 + 1, nc = base.c2 - base.c1 + 1;
  const sh = self.sheets[base.sheet];
  const lastRow = Math.min(base.r2, sh.usedRow || sh.maxRow);
  let acc = 0;
  for (let i = 0; i < nr && base.r1 + i <= lastRow; i++) {
    for (let j = 0; j < nc; j++) {
      let ok = true;
      for (const p of pairs) {
        if (!isRange(p.rg)) return E.VALUE;
        const v = self.get(p.rg.sheet, p.rg.r1 + i, p.rg.c1 + j);
        if (!p.test(v)) { ok = false; break; }
      }
      if (!ok) continue;
      if (isSum) { const x = self.get(base.sheet, base.r1 + i, base.c1 + j); if (typeof x === 'number') acc += x; else if (isErr(x)) return x; }
      else acc++;
    }
  }
  return acc;
}

export { E as Errors, isErr };
