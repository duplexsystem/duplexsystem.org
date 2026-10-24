// @license magnet:?xt=urn:btih:0b31508aeb0634b347b8270c7bee4d411b5d4109&dn=agpl-3.0.txt AGPL-3.0-or-later
(() => {
  document.documentElement.classList.add('has-copy');
  const status = document.createElement('div');
  status.className = 'vh';
  status.setAttribute('role', 'status');
  (document.getElementById('main') ?? document.body).appendChild(status);
  function codeText(pre) {
    const code = (pre.querySelector('code') || pre).cloneNode(true);
    for (const v of code.querySelectorAll('.runval')) v.remove();
    for (const line of code.querySelectorAll('.line.remove')) {
      if (line.nextSibling?.nodeType === 3 && line.nextSibling.data.startsWith('\n')) {
        line.nextSibling.data = line.nextSibling.data.slice(1);
      }
      line.remove();
    }
    return code.textContent;
  }
  for (const pre of document.querySelectorAll('#main pre')) {
    const wrap = document.createElement('div');
    wrap.className = 'codewrap';
    pre.parentNode.insertBefore(wrap, pre);
    wrap.appendChild(pre);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'copy';
    btn.textContent = 'copy';
    btn.setAttribute('aria-label', 'Copy code to clipboard');

    let reset = 0;
    btn.addEventListener('click', async () => {
      const text = codeText(pre);
      let ok = false;
      try {
        if (navigator.clipboard) {
          await navigator.clipboard.writeText(text);
          ok = true;
        }
      } catch {
      }
      if (!ok) {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.cssText =
          'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;border:0;padding:0';
        document.body.appendChild(ta);
        ta.select();
        ta.setSelectionRange(0, text.length);
        try {
          ok = document.execCommand('copy');
        } catch {
        }
        ta.remove();
      }
      if (document.activeElement !== btn) btn.focus({ preventScroll: true });
      if (!ok) {
        const range = document.createRange();
        range.selectNodeContents(pre.querySelector('code') || pre);
        const selection = getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
      }
      btn.textContent = ok ? 'copied' : 'selected';
      status.textContent = ok
        ? 'Code copied to clipboard'
        : 'Copying failed, so the code has been selected. Copy it with Ctrl+C';
      clearTimeout(reset);
      reset = setTimeout(() => {
        btn.textContent = 'copy';
        status.textContent = '';
      }, 1600);
    });

    wrap.appendChild(btn);
  }
})();

(() => {
  const LIMIT = 10000;
  const modules = new Map();
  const libcs = new Map();

  const RANGES = {
    u64: [0n, 2n ** 64n - 1n],
    i64: [-(2n ** 63n), 2n ** 63n - 1n],
    u32: [0n, 2n ** 32n - 1n],
    i32: [-(2n ** 31n), 2n ** 31n - 1n],
  };

  function parseInt64(text) {
    const src = text.replace(/[_\s]/g, '');
    let i = 0;
    const expect = (c) => {
      if (src[i] !== c) throw new Error(`is missing a ${c}`);
      i++;
    };
    function atom() {
      if (src[i] === '(') {
        i++;
        const v = sum();
        expect(')');
        return v;
      }
      const m = /^(0x[0-9a-f]+|\d+)/i.exec(src.slice(i));
      if (!m) throw new Error("isn't a number");
      i += m[0].length;
      return BigInt(m[0]);
    }
    function power() {
      const base = atom();
      if (src[i] === '^') {
        i++;
        const exp = unary();
        if (exp < 0n || exp > 4096n) throw new Error("'s exponent is too big");
        const bits = BigInt((base < 0n ? -base : base).toString(2).length);
        if (bits > 1n && bits * exp > 4096n) throw new Error('is too big');
        return base ** exp;
      }
      return base;
    }
    function unary() {
      if (src[i] === '-') {
        i++;
        return -unary();
      }
      return power();
    }
    function product() {
      let v = unary();
      while (src[i] === '*') {
        i++;
        v *= unary();
      }
      return v;
    }
    function sum() {
      let v = product();
      while (src[i] === '+' || src[i] === '-') {
        const op = src[i++];
        const r = product();
        v = op === '+' ? v + r : v - r;
      }
      return v;
    }
    const v = sum();
    if (i !== src.length) throw new Error(`has a stray ${src[i]}`);
    return v;
  }

  function parseArg(text, kind) {
    if (kind === 'f64' || kind === 'f32') {
      const v = Number(text.replace(/[_\s]/g, ''));
      if (text.trim() === '' || Number.isNaN(v)) throw new Error("isn't a number");
      return v;
    }
    const v = parseInt64(text);
    const [lo, hi] = RANGES[kind];
    if (v < lo || v > hi) throw new Error(`must be ${lo} to ${hi}`);
    return kind === 'u64' || kind === 'i64' ? BigInt.asIntN(64, v) : Number(BigInt.asIntN(32, v));
  }

  function show(v, kind) {
    if (kind === 'r64') {
      const s = BigInt.asIntN(64, v);
      return (s < 0n && s >= -(2n ** 32n) ? s : BigInt.asUintN(64, v)).toString();
    }
    if (kind === 'r32') return String(BigInt.asIntN(32, BigInt(v)));
    if (typeof v === 'bigint') {
      return (kind === 'i64' ? BigInt.asIntN(64, v) : BigInt.asUintN(64, v)).toString();
    }
    if (kind === 'u32') return String(v >>> 0);
    return String(v);
  }

  const el = (tag, props = {}, ...children) => {
    const node = document.createElement(tag);
    Object.assign(node, props);
    node.append(...children);
    return node;
  };

  const cached = (cache, url, make) => {
    if (!cache.has(url)) {
      cache.set(
        url,
        make().catch((e) => {
          cache.delete(url);
          throw e;
        }),
      );
    }
    return cache.get(url);
  };
  const load = (url) =>
    cached(modules, url, () =>
      fetch(url)
        .then((r) => {
          if (!r.ok) throw new Error(`couldn't load the code (${r.status})`);
          return r.arrayBuffer();
        })
        .then((b) => WebAssembly.compile(b)),
    );
  const shared = (url) =>
    url
      ? cached(libcs, url, () =>
          load(url).then((m) => WebAssembly.instantiate(m, {}).then((i) => i.exports)),
        )
      : Promise.resolve({});

  function setup(bar) {
    const spec = JSON.parse(bar.dataset.spec);
    const code = bar.nextElementSibling;
    const pre = code?.matches('pre') ? code : code?.querySelector('pre');
    const box = code?.nextElementSibling;
    const foot = box?.classList.contains('runfoot') ? box.querySelector('.runfoot__text') : null;
    const count = box?.querySelector('.runfoot__count');
    if (!pre || !foot || !count || !bar.dataset.wasm) return;
    const lines = [...pre.querySelectorAll('code > .line:not(.remove)')];
    const scrolledFromStart = pre.scrollWidth > pre.clientWidth;
    const roomForScrollbar = parseFloat(getComputedStyle(pre).paddingBottom);
    function keepHeight() {
      if (scrolledFromStart) return;
      pre.style.removeProperty('padding-bottom');
      if (pre.scrollWidth <= pre.clientWidth) return;
      const cs = getComputedStyle(pre);
      const scrollbar =
        pre.offsetHeight -
        pre.clientHeight -
        parseFloat(cs.borderTopWidth) -
        parseFloat(cs.borderBottomWidth);
      if (scrollbar > 0) {
        pre.style.paddingBottom = `${Math.max(0, roomForScrollbar - scrollbar)}px`;
      }
    }
    const inputs = [...bar.querySelectorAll('.runbar__arg')];
    const btn = (name) => bar.querySelector(`.runbar__btn--${name}`);
    const reset = btn('reset');
    const back = btn('back');
    const step = btn('step');
    const run = btn('run');

    let trace = null;
    let at = -1;
    let error = '';
    let pending = null;

    const name = (id) => (id < 0 ? (spec.ret.name ?? 'return') : spec.names[id]);
    const kindOf = (x) => (x.id < 0 ? (spec.ret.kind ?? x.kind) : x.kind);

    async function compute() {
      const args = spec.params.map((p, i) => {
        try {
          const v = parseArg(inputs[i].value, p.kind);
          inputs[i].removeAttribute('aria-invalid');
          return v;
        } catch (e) {
          inputs[i].setAttribute('aria-invalid', 'true');
          throw new Error(`${p.name}${e.message.startsWith("'") ? '' : ' '}${e.message}`);
        }
      });
      const steps = [];
      const record = (kind) => (line, id, v) => {
        if (!steps.length) steps.push({ line, set: [] });
        steps.at(-1).set.push({ id, v, kind });
      };
      const rt = {
        line(line) {
          if (steps.length >= LIMIT)
            throw new Error(`gave up after ${LIMIT.toLocaleString('en')} steps`);
          steps.push({ line, set: [] });
        },
        u64: record('u64'),
        i64: record('i64'),
        f64: record('f64'),
        r64: record('r64'),
        r32: record('r32'),
        fault(line) {
          throw new Error(`line ${line} reads outside its table`);
        },
      };
      const instance = await WebAssembly.instantiate(await load(bar.dataset.wasm), {
        rt,
        libc: await shared(bar.dataset.libc),
        x86: await shared(bar.dataset.x86),
        arm64: await shared(bar.dataset.arm64),
      });
      instance.exports[spec.fn](...args);
      return steps;
    }

    function ensure() {
      if (trace || error) return Promise.resolve();
      const mine = (pending ??= compute().then(
        (t) => {
          if (pending === mine) trace = t;
        },
        (e) => {
          if (pending === mine) error = e.message;
        },
      ));
      return pending;
    }

    function paint() {
      for (const l of lines) {
        l.classList.remove('is-current');
        l.querySelector('.runval')?.remove();
      }
      if (!trace || at < 0) return;
      const byLine = new Map();
      trace.slice(0, at + 1).forEach((s, i) => {
        const m = byLine.get(s.line) ?? new Map();
        for (const x of s.set) m.set(x.id, { ...x, fresh: i === at });
        byLine.set(s.line, m);
      });
      for (const [line, m] of byLine) {
        if (spec.ret.name && m.has(-1)) {
          for (const [id] of m) if (id >= 0 && name(id) === spec.ret.name) m.delete(id);
        }
        if (m.size === 0) continue;
        const span = el('span', { className: 'runval' });
        span.setAttribute('aria-hidden', 'true');
        [...m.values()].forEach((x, k) => {
          if (k) span.append(', ');
          span.append(
            `${name(x.id)} = `,
            el('b', {
              className: x.id < 0 ? 'is-ret' : x.fresh ? 'is-fresh' : '',
              textContent: show(x.v, kindOf(x)),
            }),
          );
        });
        lines[line - 1]?.append(span);
      }
      lines[trace[at].line - 1]?.classList.add('is-current');
    }

    function render() {
      paint();
      keepHeight();
      const done = trace !== null && at >= trace.length - 1;
      reset.disabled = at < 0 && !error;
      back.disabled = at <= 0;
      step.disabled = run.disabled = done || !!error;
      count.textContent = trace && at >= 0 ? `${at + 1} / ${trace.length}` : '';
      box.classList.toggle('is-error', !!error);
      foot.removeAttribute('title');
      foot.replaceChildren();
      if (error) {
        foot.textContent = error;
        foot.title = error;
        return;
      }
      if (!trace || at < 0) {
        foot.textContent = 'step or run';
        return;
      }
      const cur = trace[at];
      const ret = cur.set.find((x) => x.id < 0);
      if (ret) {
        foot.append(
          spec.ret.name ? `${spec.ret.name} = ` : 'returns ',
          el('b', { className: 'is-ret', textContent: show(ret.v, kindOf(ret)) }),
        );
        return;
      }
      foot.append(`line ${cur.line}`);
      cur.set.forEach((x, k) => {
        foot.append(
          k ? ', ' : ' · ',
          `${name(x.id)} = `,
          el('b', { textContent: show(x.v, kindOf(x)) }),
        );
      });
    }

    const clear = () => {
      pending = null;
      trace = null;
      error = '';
      at = -1;
      render();
    };
    step.addEventListener('click', async () => {
      await ensure();
      if (trace && at < trace.length - 1) at++;
      render();
    });
    back.addEventListener('click', () => {
      if (at > 0) at--;
      render();
    });
    run.addEventListener('click', async () => {
      await ensure();
      if (trace) at = trace.length - 1;
      render();
    });
    reset.addEventListener('click', clear);
    for (const input of inputs) {
      input.addEventListener('input', clear);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') run.click();
      });
    }
    bar.classList.add('is-ready');
    render();
  }

  for (const bar of document.querySelectorAll('.runbar[data-spec]')) setup(bar);
})();
// @license-end
