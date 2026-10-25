import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_AST_BYTES = 512 * 1024 * 1024;

export function findSysroot() {
  const roots = [
    process.env.WASI_SYSROOT,
    '/usr/wasm32-wasi',
    '/usr',
    '/usr/share/wasi-sysroot',
    '/opt/wasi-sdk/share/wasi-sysroot',
  ].filter(Boolean);
  for (const root of roots) {
    for (const triple of ['wasm32-wasi', 'wasm32-wasip1']) {
      const lib = join(root, 'lib', triple);
      const inc = [join(root, 'include', triple), join(root, 'include')].find((d) =>
        existsSync(join(d, 'math.h')),
      );
      if (existsSync(join(lib, 'libc.a')) && inc) return { root, lib, include: inc };
    }
  }
  throw new Error(
    'runnable: wasi-libc not found. Install it (Fedora: wasi-libc-static wasi-libc-devel; ' +
      'Debian/Ubuntu: wasi-libc) or set WASI_SYSROOT.',
  );
}

const INCLUDE = join(dirname(fileURLToPath(import.meta.url)), 'include');
export const includeKey = () =>
  readdirSync(INCLUDE)
    .sort()
    .map((f) => readFileSync(join(INCLUDE, f), 'utf8'))
    .join('\0');

export function clangFlags(sys) {
  return [
    '--target=wasm32-wasi',
    '-Wno-deprecated',
    `--sysroot=${sys.root}`,
    '-nostdlibinc',
    '-isystem',
    sys.include,
    '-idirafter',
    INCLUDE,
  ];
}

let wasmOptVersion;
export function wasmOpt() {
  if (wasmOptVersion === undefined) {
    try {
      wasmOptVersion = execFileSync('wasm-opt', ['--version']).toString().trim();
    } catch {
      wasmOptVersion = null;
    }
  }
  return wasmOptVersion;
}

export function shrink(path) {
  if (!wasmOpt()) return;
  execFileSync(
    'wasm-opt',
    ['-Oz', '--strip-debug', '--strip-producers', '--strip-target-features', path, '-o', path],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
}

let clangVer;
export function clangVersion() {
  clangVer ??= execFileSync('clang', ['--version']).toString().split('\n')[0];
  return clangVer;
}

export const hashKey = (parts) =>
  createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 16);

export function inWorkDir(prefix, fn) {
  const work = mkdtempSync(join(tmpdir(), prefix));
  try {
    return fn(work);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

export function linkWasm(sys, out, { exports = [], inputs, flags = [] }) {
  execFileSync(
    'clang',
    [
      ...clangFlags(sys),
      ...flags,
      '-nostdlib',
      '-Wl,--no-entry',
      ...(wasmOpt() ? [] : ['-Wl,--strip-all']),
      ...exports.map((n) => `-Wl,--export=${n}`),
      '-o',
      out,
      ...inputs,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
}

export function foreignImports(bytes, allowed) {
  return WebAssembly.Module.imports(new WebAssembly.Module(bytes))
    .filter((i) => !allowed.includes(i.module))
    .map((i) => `${i.module}.${i.name}`);
}

export function buildShared(prefix, names, { cacheDir, keyParts, link }) {
  const list = [...new Set(names)].sort();
  if (list.length === 0) return null;
  const sys = findSysroot();
  const key = hashKey([list, wasmOpt(), clangVersion(), ...keyParts(sys)]);
  const path = join(cacheDir, `${prefix}.${key}.wasm`);
  if (existsSync(path)) return { key, path, names: list };
  mkdirSync(cacheDir, { recursive: true });
  return inWorkDir('runnable-', (work) => {
    const out = join(work, `${prefix}.wasm`);
    link(out, sys, list);
    shrink(out);
    const bytes = readFileSync(out);
    const foreign = foreignImports(bytes, []);
    if (foreign.length) {
      throw new Error(
        `runnable: the shared ${prefix} module needs ${foreign.join(', ')}, which the page cannot provide`,
      );
    }
    writeFileSync(path, bytes);
    return { key, path, names: list };
  });
}

const PRELUDE = `__attribute__((import_module("rt"), import_name("line"))) void __rt_line(int);
__attribute__((import_module("rt"), import_name("u64"))) void __rt_u64(int, int, unsigned long long);
__attribute__((import_module("rt"), import_name("i64"))) void __rt_i64(int, int, long long);
__attribute__((import_module("rt"), import_name("f64"))) void __rt_f64(int, int, double);
#define __RT_V(l, i, v) _Generic((v), float: __rt_f64, double: __rt_f64, signed char: __rt_i64, \\
  short: __rt_i64, int: __rt_i64, long: __rt_i64, long long: __rt_i64, default: __rt_u64)((l), (i), (v))
#line 1
`;

export function kindOf(type) {
  const t = type
    .replace(/\b(const|volatile|restrict)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (/^(unsigned long long|unsigned long long int)$/.test(t)) return 'u64';
  if (/^(long long|long long int|signed long long)$/.test(t)) return 'i64';
  if (t === 'double' || t === 'long double') return 'f64';
  if (t === 'float') return 'f32';
  if (/^(unsigned|unsigned (int|long|short|char)|_Bool|bool)$/.test(t)) return 'u32';
  if (/^(int|long|short|char|signed char|signed|signed int|long int)$/.test(t)) return 'i32';
  return null;
}

const loc = (l) => l?.expansionLoc ?? l?.spellingLoc ?? l;

function ast(file, sys) {
  const json = execFileSync(
    'clang',
    [...clangFlags(sys), '-Xclang', '-ast-dump=json', '-fsyntax-only', file],
    { maxBuffer: MAX_AST_BYTES, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  return JSON.parse(json);
}

function ownFunctions(tu, file) {
  let current = null;
  const out = [];
  for (const node of tu.inner ?? []) {
    const l = loc(node.loc);
    if (l?.file) current = l.file;
    if (
      node.kind === 'FunctionDecl' &&
      current === file &&
      node.inner?.some((n) => n.kind === 'CompoundStmt')
    ) {
      out.push(node);
    }
  }
  return out;
}

const SCALAR =
  /^(void|_Bool|(un)?signed|(unsigned |signed )?(char|short|int|long|long long)( int)?|float|double|long double)$/;

function scalarSignature(type) {
  const m = /^(.*?)\s*\((.*)\)$/.exec(type);
  if (!m || m[2].includes('...')) return null;
  const params =
    m[2].trim() === '' || m[2].trim() === 'void' ? [] : m[2].split(',').map((p) => p.trim());
  if (![m[1].trim(), ...params].every((t) => SCALAR.test(t.replace(/\bconst\b\s*/g, '').trim())))
    return null;
  return { ret: m[1].trim(), params };
}

const callCache = new Map();

export function libraryCalls(source, { cacheDir } = {}) {
  const sys = findSysroot();
  const key = hashKey([source, clangVersion(), sys.lib, includeKey()]);
  const file = cacheDir && join(cacheDir, `calls.${key}.json`);
  let calls = callCache.get(key);
  if (!calls && file && existsSync(file)) {
    try {
      calls = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
    }
  }
  calls ??= inWorkDir('runnable-', (work) => scanCalls(source, sys, work));
  callCache.set(key, calls);
  if (file && !existsSync(file)) {
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(file, JSON.stringify(calls));
  }
  return calls;
}

function scanCalls(source, sys, work) {
  const file = join(work, 'block.c');
  writeFileSync(file, source);
  const tu = ast(file, sys);
  const fns = ownFunctions(tu, file);
  const own = new Set(fns.map((f) => f.name));
  const found = new Map();
  const walk = (n) => {
    if (!n || typeof n !== 'object') return;
    const d = n.kind === 'DeclRefExpr' ? n.referencedDecl : null;
    if (
      d?.kind === 'FunctionDecl' &&
      !own.has(d.name) &&
      !found.has(d.name) &&
      !d.name.startsWith('__builtin_')
    ) {
      const sig = scalarSignature(d.type?.desugaredQualType ?? d.type?.qualType ?? '');
      if (sig && /^[A-Za-z_]\w*$/.test(d.name)) found.set(d.name, { name: d.name, ...sig });
    }
    for (const c of n.inner ?? []) walk(c);
  };
  for (const f of fns) walk(f);
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function buildSharedLibc(names, { cacheDir }) {
  return buildShared('libc', names, {
    cacheDir,
    keyParts: (sys) => [sys.lib, 2],
    link: (out, sys, list) =>
      linkWasm(sys, out, {
        flags: list.map((n) => `-Wl,-u,${n}`),
        exports: list,
        inputs: [join(sys.lib, 'libm.a'), join(sys.lib, 'libc.a')],
      }),
  });
}

export function buildRunnable(source, call, { cacheDir, shared = [] } = {}) {
  const m = /^\s*([A-Za-z_]\w*)\s*\((.*)\)\s*$/.exec(call);
  if (!m) throw new Error(`runnable: run="${call}" should look like run="fn(arg, ...)"`);
  const [, fnName, argText] = m;
  const defaults = argText.trim() ? argText.split(',').map((a) => a.trim()) : [];

  const sys = findSysroot();
  const key = hashKey([
    source,
    call,
    clangVersion(),
    wasmOpt(),
    sys.lib,
    PRELUDE,
    shared,
    includeKey(),
    6,
  ]);
  if (cacheDir) {
    const cached = join(cacheDir, `${key}.json`);
    if (existsSync(cached) && existsSync(join(cacheDir, `${key}.wasm`))) {
      return {
        ...JSON.parse(readFileSync(cached, 'utf8')),
        wasmPath: join(cacheDir, `${key}.wasm`),
      };
    }
  }

  return inWorkDir('runnable-', (work) => {
    const file = join(work, 'block.c');
    const buf = Buffer.from(source, 'utf8');
    writeFileSync(file, buf);

    const tu = ast(file, sys);
    const fns = ownFunctions(tu, file);
    const target = fns.find((f) => f.name === fnName);
    if (!target) {
      throw new Error(`runnable: run="${call}" names ${fnName}, which this block does not define`);
    }

    const lineOf = (offset) => {
      let n = 1;
      for (let i = 0; i < offset; i++) if (buf[i] === 0x0a) n++;
      return n;
    };
    const text = (a, b) => buf.subarray(a, b).toString('utf8');
    const endOf = (node) => {
      const e = loc(node.range.end);
      return e.offset + (e.tokLen ?? 0);
    };
    const semicolonAfter = (node) => {
      const last = loc(node.range.end).offset;
      if (buf[last] === 0x3b) return last + 1;
      let i = endOf(node);
      while (i < buf.length && buf[i] !== 0x3b) i++;
      if (i >= buf.length) throw new Error('runnable: could not find the end of a statement');
      return i + 1;
    };

    const names = [];
    const idOf = (name) => {
      let i = names.indexOf(name);
      if (i < 0) i = names.push(name) - 1;
      return i;
    };
    const edits = [];

    const assigned = (expr) => {
      let e = expr;
      while (e && (e.kind === 'ImplicitCastExpr' || e.kind === 'ParenExpr')) e = e.inner?.[0];
      if (!e) return null;
      if (e.kind === 'BinaryOperator' && e.opcode === '=') return refName(e.inner[0]);
      if (e.kind === 'CompoundAssignOperator') return refName(e.inner[0]);
      if (e.kind === 'UnaryOperator' && /^(\+\+|--)$/.test(e.opcode)) return refName(e.inner[0]);
      return null;
    };
    const refName = (e) => {
      while (e && (e.kind === 'ImplicitCastExpr' || e.kind === 'ParenExpr')) e = e.inner?.[0];
      return e?.kind === 'DeclRefExpr' ? e.referencedDecl?.name : null;
    };

    const returnType = (fn) => fn.type.qualType.slice(0, fn.type.qualType.indexOf('(')).trim();
    const typedefs = new Map();
    for (const n of tu.inner ?? []) {
      if (n.kind === 'TypedefDecl' && n.name)
        typedefs.set(n.name, n.type.desugaredQualType ?? n.type.qualType);
    }
    const resolve = (t) => {
      for (let i = 0; i < 8 && typedefs.has(t); i++) t = typedefs.get(t);
      return t;
    };

    function block(compound, fn) {
      for (const stmt of compound.inner ?? []) {
        const begin = loc(stmt.range.begin).offset;
        const line = lineOf(begin);
        if (stmt.kind === 'ReturnStmt') {
          const value = stmt.inner?.[0];
          const end = semicolonAfter(stmt);
          if (value) {
            const expr = text(loc(value.range.begin).offset, endOf(value));
            edits.push({
              from: begin,
              to: end,
              text: `{ __rt_line(${line}); ${returnType(fn)} __rt_r = (${expr}); __RT_V(${line}, -1, __rt_r); return __rt_r; }`,
            });
          } else {
            edits.push({ at: begin, text: `__rt_line(${line}); ` });
          }
          continue;
        }
        edits.push({ at: begin, text: `__rt_line(${line}); ` });
        if (stmt.kind === 'DeclStmt') {
          const after = semicolonAfter(stmt);
          for (const d of stmt.inner ?? []) {
            if (d.kind === 'VarDecl' && d.name && d.inner?.length) {
              edits.push({ at: after, text: ` __RT_V(${line}, ${idOf(d.name)}, ${d.name});` });
            }
          }
        } else if (/Operator$/.test(stmt.kind)) {
          const name = assigned(stmt);
          if (name) {
            edits.push({
              at: semicolonAfter(stmt),
              text: ` __RT_V(${line}, ${idOf(name)}, ${name});`,
            });
          }
        }
        for (const child of stmt.inner ?? []) {
          if (child?.kind === 'CompoundStmt') block(child, fn);
        }
      }
    }

    for (const fn of fns) {
      const body = fn.inner.find((n) => n.kind === 'CompoundStmt');
      const open = loc(body.range.begin).offset + 1;
      const line = lineOf(loc(fn.loc).offset);
      const params = (fn.inner ?? []).filter((n) => n.kind === 'ParmVarDecl' && n.name);
      edits.push({
        at: open,
        text: ` __rt_line(${line});${params.map((p) => ` __RT_V(${line}, ${idOf(p.name)}, ${p.name});`).join('')}`,
      });
      block(body, fn);
    }

    const ordered = edits
      .map((e, i) => ({ ...e, pos: e.at ?? e.from, i }))
      .sort((a, b) => b.pos - a.pos || b.i - a.i);
    let out = buf;
    for (const e of ordered) {
      const to = e.from !== undefined ? e.to : e.at;
      out = Buffer.concat([out.subarray(0, e.pos), Buffer.from(e.text), out.subarray(to)]);
    }

    const instrumented = join(work, 'instrumented.c');
    const libcImports = shared
      .map(
        (f) =>
          `${f.ret} __rt_libc_${f.name}(${f.params.join(', ') || 'void'}) ` +
          `__attribute__((import_module("libc"), import_name("${f.name}")));\n#define ${f.name} __rt_libc_${f.name}\n`,
      )
      .join('');
    writeFileSync(
      instrumented,
      PRELUDE.replace('#line 1\n', `${libcImports}#line 1\n`) + out.toString('utf8'),
    );
    const wasm = join(work, 'out.wasm');
    try {
      linkWasm(sys, wasm, {
        flags: ['-O2'],
        exports: [fnName],
        inputs: [instrumented, join(sys.lib, 'libm.a'), join(sys.lib, 'libc.a')],
      });
    } catch (err) {
      const msg = String(err.stderr ?? err.message).replace(
        new RegExp(instrumented, 'g'),
        'block.c',
      );
      throw new Error(`runnable: the block did not compile for WebAssembly:\n${msg}`);
    }

    shrink(wasm);
    const bytes = readFileSync(wasm);
    const needed = WebAssembly.Module.imports(new WebAssembly.Module(bytes));
    const foreign = foreignImports(bytes, ['rt', 'libc']);
    if (foreign.length) {
      throw new Error(
        `runnable: the block needs ${foreign.join(', ')}, ` +
          'which the page cannot provide (no I/O: printf, files and the like are out).',
      );
    }

    const params = (target.inner ?? [])
      .filter((n) => n.kind === 'ParmVarDecl')
      .map((p, i) => {
        const type = p.type.desugaredQualType ?? p.type.qualType;
        const kind = kindOf(type);
        if (!kind)
          throw new Error(
            `runnable: parameter ${p.name} has type ${p.type.qualType}, which cannot be typed in`,
          );
        return {
          name: p.name ?? `arg${i}`,
          type: p.type.qualType,
          kind,
          default: defaults[i] ?? '0',
        };
      });
    if (defaults.length !== params.length) {
      throw new Error(
        `runnable: run="${call}" gives ${defaults.length} argument(s), ${fnName} takes ${params.length}`,
      );
    }
    const retRaw = returnType(target);
    const spec = {
      fn: fnName,
      params,
      ret: { type: retRaw, kind: kindOf(resolve(retRaw)) },
      names,
      libc: needed.some((i) => i.module === 'libc'),
    };

    const result = { key, spec, bytes };
    if (cacheDir) {
      mkdirSync(cacheDir, { recursive: true });
      writeFileSync(join(cacheDir, `${key}.wasm`), bytes);
      writeFileSync(join(cacheDir, `${key}.json`), JSON.stringify({ key, spec }));
      result.wasmPath = join(cacheDir, `${key}.wasm`);
    }
    return result;
  });
}
