export type Shape = 'box' | 'round' | 'pill' | 'diamond' | 'parallelogram' | 'circle' | 'text';
export type Direction = 'LR' | 'TB';

export interface FlowNode {
  id: string;
  label: string;
  detail?: string;
  shape?: Shape;
  emphasis?: boolean;
}
export interface FlowEdge {
  from: string;
  to: string;
  label?: string;
  emphasis?: boolean;
  dashed?: boolean;
  arrow?: boolean;
}
export interface Flowchart {
  direction?: Direction;
  nodes: FlowNode[];
  edges: FlowEdge[];
  path?: string[];
}

const FONT = 13;
const SMALL = 11;
const CHAR = 0.6;
const SMALL_CHAR = 7 / 11;
const PAD_X = 12;
const LINE = 16;
const GAP_LAYER = 50;
const GAP_SLOT = 46;
const MARGIN = 18;
const BAR = 9;
const PX = 2;
const HEAD = 4 * PX;
const CUT = 3;
const TRACK = 4 * PX;
const isWindow = (n: FlowNode) => (n.shape ?? 'box') === 'box' || n.shape === 'round';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const textW = (s: string, size: number) => s.length * size * (size === SMALL ? SMALL_CHAR : CHAR);

function nodeSize(n: FlowNode): { w: number; h: number } {
  const details = n.detail ? n.detail.split('\n') : [];
  let w = Math.max(textW(n.label, FONT), ...details.map((d) => textW(d, SMALL))) + 2 * PAD_X;
  let h = 24 + LINE * details.length;
  h = Math.max(h, 40);
  if (isWindow(n)) h += BAR;
  switch (n.shape ?? 'box') {
    case 'diamond':
      w = w * 1.7;
      h = h * 1.6;
      break;
    case 'parallelogram':
      w += h * 0.5;
      break;
    case 'pill':
      w += h * 0.4;
      break;
    case 'circle':
      w = h = Math.max(w, h);
      break;
    case 'text':
      h = Math.max(24, h - 16);
      break;
  }
  return { w: Math.ceil(w), h: Math.ceil(h) };
}

interface Placed {
  id: string;
  node?: FlowNode;
  layer: number;
  slot: number;
  w: number;
  h: number;
  x: number;
  y: number;
}
interface Route {
  edge: FlowEdge;
  points: string[];
  back: boolean;
  arc?: boolean;
  arcSide?: -1 | 1;
  arcLevel?: number;
}
export interface Layout {
  width: number;
  height: number;
  placed: Map<string, Placed>;
  routes: Route[];
  direction: Direction;
}

function check(chart: Flowchart): Map<string, FlowNode> {
  const byId = new Map<string, FlowNode>();
  for (const n of chart.nodes) {
    if (byId.has(n.id)) throw new Error(`flowchart: node ${n.id} defined twice`);
    byId.set(n.id, n);
  }
  for (const e of chart.edges) {
    for (const end of [e.from, e.to]) {
      if (!byId.has(end))
        throw new Error(`flowchart: edge ${e.from} -> ${e.to} names an unknown node`);
    }
  }
  for (const id of chart.path ?? []) {
    if (!byId.has(id)) throw new Error(`flowchart: path names unknown node ${id}`);
  }
  return byId;
}

export function layout(chart: Flowchart): Layout {
  const byId = check(chart);
  const direction = chart.direction ?? 'TB';
  const nodes = chart.nodes;
  const out = new Map<string, FlowEdge[]>(nodes.map((n) => [n.id, []]));
  for (const e of chart.edges) out.get(e.from)!.push(e);

  const back = new Set<FlowEdge>();
  const state = new Map<string, 1 | 2>();
  const dfs = (id: string) => {
    state.set(id, 1);
    for (const e of out.get(id)!) {
      if (e.from === e.to || state.get(e.to) === 1) back.add(e);
      else if (!state.has(e.to)) dfs(e.to);
    }
    state.set(id, 2);
  };
  for (const n of nodes) if (!state.has(n.id)) dfs(n.id);
  const forward = chart.edges.filter((e) => !back.has(e));

  const layer = new Map<string, number>();
  const depth = (id: string): number => {
    if (layer.has(id)) return layer.get(id)!;
    const d = Math.max(0, ...forward.filter((e) => e.to === id).map((e) => depth(e.from) + 1));
    layer.set(id, d);
    return d;
  };
  nodes.forEach((n) => depth(n.id));

  const placed = new Map<string, Placed>();
  for (const n of nodes) {
    placed.set(n.id, {
      id: n.id,
      node: n,
      layer: layer.get(n.id)!,
      slot: 0,
      ...nodeSize(n),
      x: 0,
      y: 0,
    });
  }
  const routes: Route[] = [];
  let way = 0;
  const adj: Array<[string, string]> = [];
  for (const e of forward) {
    const pts = [e.from];
    for (let l = layer.get(e.from)! + 1; l < layer.get(e.to)!; l++) {
      const id = `\0w${way++}`;
      placed.set(id, { id, layer: l, slot: 0, w: 0, h: 0, x: 0, y: 0 });
      pts.push(id);
    }
    pts.push(e.to);
    for (let i = 1; i < pts.length; i++) adj.push([pts[i - 1], pts[i]]);
    routes.push({ edge: e, points: pts, back: false });
  }
  for (const e of back) routes.push({ edge: e, points: [e.from, e.to], back: true });

  const layers = Math.max(0, ...[...placed.values()].map((p) => p.layer)) + 1;
  const rows: string[][] = Array.from({ length: layers }, () => []);
  for (const p of placed.values()) rows[p.layer].push(p.id);
  const pinned = new Set(chart.path ?? nodes.filter((n) => n.emphasis).map((n) => n.id));
  if (chart.path?.length) {
    const lead = (id: string, into: boolean): string | undefined => {
      const layer = placed.get(id)!.layer + (into ? -1 : 1);
      if ([...pinned].some((q) => placed.get(q)!.layer === layer)) return undefined;
      const e = chart.edges.find(
        (e) =>
          !e.dashed &&
          (into ? e.to === id : e.from === id) &&
          placed.get(into ? e.from : e.to)!.layer === layer,
      );
      return e && (into ? e.from : e.to);
    };
    for (const into of [true, false]) {
      let id: string | undefined = into ? chart.path[0] : chart.path[chart.path.length - 1];
      while ((id = lead(id, into))) pinned.add(id);
    }
  }
  const pos = new Map<string, number>();
  const index = () => rows.forEach((r) => r.forEach((id, i) => pos.set(id, i)));
  index();
  const sweep = (down: boolean) => {
    const order = down ? rows.keys() : [...rows.keys()].reverse();
    for (const l of order) {
      const bary = new Map<string, number>();
      for (const id of rows[l]) {
        const near = adj
          .filter(([a, b]) => (down ? b === id : a === id))
          .map(([a, b]) => pos.get(down ? a : b)!);
        bary.set(id, near.length ? near.reduce((s, v) => s + v, 0) / near.length : pos.get(id)!);
      }
      rows[l].sort(
        (a, b) => (pinned.has(b) ? 1 : 0) - (pinned.has(a) ? 1 : 0) || bary.get(a)! - bary.get(b)!,
      );
      rows[l].forEach((id, i) => pos.set(id, i));
    }
  };
  for (let i = 0; i < 4; i++) {
    sweep(true);
    sweep(false);
  }
  for (const r of rows) r.forEach((id, i) => (placed.get(id)!.slot = i));

  const realAt = (l: number, slot: number) =>
    rows[l].some((id) => placed.get(id)!.node && placed.get(id)!.slot === slot);
  for (const r of routes) {
    if (r.back || r.points.length <= 2) continue;
    const a = placed.get(r.edge.from)!;
    const b = placed.get(r.edge.to)!;
    if (a.slot !== b.slot) continue;
    const blocked = r.points.slice(1, -1).some((id) => realAt(placed.get(id)!.layer, a.slot));
    if (blocked && a.slot !== 0) continue;
    for (const id of r.points.slice(1, -1)) {
      const l = placed.get(id)!.layer;
      rows[l].splice(rows[l].indexOf(id), 1);
      placed.delete(id);
    }
    r.points = [r.edge.from, r.edge.to];
    if (blocked) r.arc = true;
    for (const row of rows) row.forEach((id, i) => (placed.get(id)!.slot = i));
  }

  type Span = { r: Route; lo: number; hi: number };
  const arcs: Span[] = routes
    .filter((r) => r.arc)
    .map((r) => ({ r, lo: placed.get(r.edge.from)!.layer, hi: placed.get(r.edge.to)!.layer }))
    .sort((u, v) => v.hi - v.lo - (u.hi - u.lo));
  const interleave = (u: Span, v: Span) =>
    (u.lo < v.lo && v.lo <= u.hi && u.hi < v.hi) || (v.lo < u.lo && u.lo <= v.hi && v.hi < u.hi);
  const overlap = (u: Span, v: Span) => u.lo <= v.hi && v.lo <= u.hi;
  const outside: Span[] = [];
  const under: Span[] = [];
  for (const u of arcs) {
    const flip = outside.some((v) => interleave(u, v)) && !under.some((v) => interleave(u, v));
    u.r.arcSide = flip ? 1 : -1;
    (flip ? under : outside).push(u);
  }
  for (const side of [outside, under]) {
    const done: Span[] = [];
    for (const u of [...side].reverse()) {
      u.r.arcLevel =
        Math.max(-1, ...done.filter((v) => overlap(u, v)).map((v) => v.r.arcLevel!)) + 1;
      done.push(u);
    }
  }
  const outerLevels = Math.max(0, ...outside.map((u) => u.r.arcLevel!));

  const before = new Map<string, string>();
  for (const r of routes)
    if (!r.back && !r.arc) r.points.slice(1, -1).forEach((id, k) => before.set(id, r.points[k]));
  for (const row of rows) {
    let next = 0;
    for (const id of row) {
      const p = placed.get(id)!;
      const prev = before.get(id);
      p.slot = Math.max(next, prev ? placed.get(prev)!.slot : p.slot);
      next = p.slot + 1;
    }
  }

  const LR = direction === 'LR';
  const along = (p: Placed) => (LR ? p.w : p.h);
  const across = (p: Placed) => (LR ? p.h : p.w);
  const layerSize = rows.map((r) => Math.max(0, ...r.map((id) => along(placed.get(id)!))));
  const slots = Math.max(...[...placed.values()].map((p) => p.slot)) + 1;
  const slotSize = Array.from({ length: slots }, (_, s) =>
    Math.max(20, ...[...placed.values()].filter((p) => p.slot === s).map(across)),
  );
  const layerPos: number[] = [];
  let a = MARGIN;
  for (const s of layerSize) {
    layerPos.push(a + s / 2);
    a += s + GAP_LAYER;
  }
  const slotPos: number[] = [];
  let c = MARGIN + outerLevels * TRACK;
  for (const s of slotSize) {
    slotPos.push(c + s / 2);
    c += s + GAP_SLOT;
  }
  for (const p of placed.values()) {
    const u = layerPos[p.layer];
    const v = slotPos[p.slot];
    p.x = LR ? u : v;
    p.y = LR ? v : u;
  }
  const extentAlong = a - GAP_LAYER + MARGIN;
  const extentAcross = c - GAP_SLOT + MARGIN + (back.size || under.length ? MARGIN : 0);
  return {
    width: Math.ceil(LR ? extentAlong : extentAcross),
    height: Math.ceil(LR ? extentAcross : extentAlong),
    placed,
    routes,
    direction,
  };
}

function port(p: Placed, o: number, out: boolean, LR: boolean): [number, number] {
  if (!p.node) return [p.x, p.y];
  const s = out ? 1 : -1;
  const hw = p.w / 2;
  const hh = p.h / 2;
  const half = LR ? hw : hh;
  const span = LR ? hh : hw;
  const r = (a: number) => Math.sqrt(Math.max(0, a * a - o * o));
  let d: number;
  switch (p.node.shape ?? 'box') {
    case 'diamond':
      d = half * (1 - Math.abs(o) / span);
      break;
    case 'circle':
      d = r(hw);
      break;
    case 'pill':
      d = LR ? hw - hh + r(hh) : hh;
      break;
    case 'parallelogram':
      d = LR ? hw - (p.h * 0.25 * (out ? o + hh : hh - o)) / p.h : hh;
      break;
    default:
      d = half;
  }
  return LR ? [p.x + s * d, p.y + o] : [p.x + o, p.y + s * d];
}

const PORT_ROOM: Partial<Record<Shape, number>> = { diamond: 0.35, circle: 0.6, pill: 0.6 };
const PORT_STEP = 4 * PX;

function shapeSvg(p: Placed, bar: string): string {
  const n = p.node!;
  const { x, y, w, h } = p;
  const l = x - w / 2;
  const t = y - h / 2;
  if (isWindow(n)) {
    const r = n.shape === 'round' ? 8 : 4;
    const k = Math.min(r, BAR);
    return (
      `<rect class="fc-win" x="${l}" y="${t}" width="${w}" height="${h}" rx="${r}"/>` +
      `<path class="fc-bar" fill="url(#${bar})" d="M${l + 0.5},${t + BAR} V${t + k} Q${l + 0.5},${t + 0.5} ${l + k},${t + 0.5} H${l + w - k} Q${l + w - 0.5},${t + 0.5} ${l + w - 0.5},${t + k} V${t + BAR} Z"/>` +
      `<path class="fc-rule" d="M${l},${t + BAR} h${w}"/>`
    );
  }
  switch (n.shape ?? 'box') {
    case 'text':
      return '';
    case 'round':
      return `<rect x="${l}" y="${t}" width="${w}" height="${h}" rx="10"/>`;
    case 'pill':
      return `<rect x="${l}" y="${t}" width="${w}" height="${h}" rx="${h / 2}"/>`;
    case 'circle':
      return `<circle cx="${x}" cy="${y}" r="${w / 2}"/>`;
    case 'diamond':
      return `<polygon points="${x},${t} ${l + w},${y} ${x},${t + h} ${l},${y}"/>`;
    case 'parallelogram': {
      const k = h * 0.25;
      return `<polygon points="${l + k},${t} ${l + w},${t} ${l + w - k},${t + h} ${l},${t + h}"/>`;
    }
    default:
      return `<rect x="${l}" y="${t}" width="${w}" height="${h}" rx="4"/>`;
  }
}

export type Point = [number, number];

export function geometry(chart: Flowchart): { layout: Layout; routes: Point[][] } {
  const L = layout(chart);
  const LR = L.direction === 'LR';
  const at = (f: number, c: number): Point => (LR ? [f, c] : [c, f]);
  const snap = (v: number) => Math.round(v / PX) * PX;

  const cross = (id: string) => (LR ? L.placed.get(id)!.y : L.placed.get(id)!.x);
  const sides = new Map<string, Array<{ key: string; at: number }>>();
  const onSide = (side: string, key: string, at: number) => {
    if (!sides.has(side)) sides.set(side, []);
    sides.get(side)!.push({ key, at });
  };
  const taken = new Set<string>();
  for (const r of L.routes) {
    const side = r.back ? '+' : r.arc ? (r.arcSide === 1 ? '+' : '-') : '';
    if (side) for (const id of [r.points[0], r.points[r.points.length - 1]]) taken.add(id + side);
  }
  const sideways = new Set<number>();
  L.routes.forEach((r, i) => {
    const a = L.placed.get(r.points[0])!;
    const half = (LR ? a.h : a.w) / 2;
    const off = cross(r.points[1]) - cross(a.id);
    if (!r.back && !r.arc && a.node?.shape === 'diamond' && Math.abs(off) >= half)
      if (!taken.has(a.id + (off > 0 ? '+' : '-'))) sideways.add(i);
  });
  L.routes.forEach((r, i) => {
    if (r.back || r.arc) return;
    const n = r.points.length;
    if (!sideways.has(i)) onSide(`${r.points[0]}>`, `${i}>`, cross(r.points[1]));
    onSide(`${r.points[n - 1]}<`, `${i}<`, cross(r.points[n - 2]));
  });
  const ports = new Map<string, number>();
  for (const [side, list] of sides) {
    const p = L.placed.get(side.slice(0, -1))!;
    const mid = cross(p.id);
    const straight = list.filter((u) => Math.abs(u.at - mid) < 1);
    const above = list.filter((u) => u.at <= mid - 1).sort((u, v) => v.at - u.at);
    const below = list.filter((u) => u.at >= mid + 1).sort((u, v) => u.at - v.at);
    const slot = new Map<string, number>();
    if (straight.length) {
      const m = straight.length;
      straight.forEach((u, k) => slot.set(u.key, k - (m - 1) / 2));
      above.forEach((u, k) => slot.set(u.key, -((m - 1) / 2 + 1 + k)));
      below.forEach((u, k) => slot.set(u.key, (m - 1) / 2 + 1 + k));
    } else {
      const all = [...above.reverse(), ...below];
      all.forEach((u, k) => slot.set(u.key, k - (all.length - 1) / 2));
    }
    const widest = Math.max(...[...slot.values()].map(Math.abs));
    const room = (LR ? p.h : p.w) * (PORT_ROOM[p.node?.shape ?? 'box'] ?? 0.7);
    const step = widest ? Math.min(PORT_STEP, room / 2 / widest) : 0;
    for (const [key, k] of slot) ports.set(key, k * step);
  }

  const lo = new Map<number, number>();
  const hi = new Map<number, number>();
  for (const p of L.placed.values()) {
    const f = LR ? p.x : p.y;
    const half = (LR ? p.w : p.h) / 2;
    lo.set(p.layer, Math.min(lo.get(p.layer) ?? Infinity, f - half));
    hi.set(p.layer, Math.max(hi.get(p.layer) ?? -Infinity, f + half));
  }

  type Hop = { gap: number; c0: number; c1: number; track?: number };
  const anchors: Point[][] = [];
  const jogs: Hop[][] = [];
  const byGap = new Map<number, Hop[]>();
  L.routes.forEach((r, ri) => {
    if (r.back || r.arc) return;
    const pts = r.points.map((id) => L.placed.get(id)!);
    const last = pts.length - 1;
    const fc = (q: Point): Point => (LR ? q : [q[1], q[0]]);
    const a: Point[] = pts.map((p) => fc([p.x, p.y]));
    if (sideways.has(ri)) {
      const [f, c] = a[0];
      a[0] = [f, c + (Math.sign(a[1][1] - c) * (LR ? pts[0].h : pts[0].w)) / 2];
    } else a[0] = fc(port(pts[0], ports.get(`${ri}>`)!, true, LR));
    a[last] = fc(port(pts[last], ports.get(`${ri}<`)!, false, LR));
    if (r.edge.arrow !== false) a[last][0] -= HEAD;
    anchors[ri] = a.map(([f, c]) => [snap(f), snap(c)]);
    jogs[ri] = [];
    for (let k = 1; k <= last; k++) {
      const [c0, c1] = [anchors[ri][k - 1][1], anchors[ri][k][1]];
      if (c0 === c1 || (k === 1 && sideways.has(ri))) continue;
      const hop: Hop = { gap: pts[k].layer - 1, c0, c1 };
      jogs[ri][k] = hop;
      if (!byGap.has(hop.gap)) byGap.set(hop.gap, []);
      byGap.get(hop.gap)!.push(hop);
    }
  });
  for (const [gap, hops] of byGap) {
    const down = hops.filter((h) => h.c1 > h.c0).sort((u, v) => v.c0 - u.c0);
    const up = hops.filter((h) => h.c1 < h.c0).sort((u, v) => u.c0 - v.c0);
    const lanes = [...down, ...up];
    const from = hi.get(gap)! + 2 * PX;
    const to = lo.get(gap + 1)! - HEAD - 2 * PX;
    const step = Math.min(TRACK, lanes.length > 1 ? (to - from) / (lanes.length - 1) : 0);
    const mid = (from + to) / 2;
    lanes.forEach((h, k) => (h.track = snap(mid + (k - (lanes.length - 1) / 2) * step)));
  }

  const routes = L.routes.map((r, ri): Point[] => {
    const e = r.edge;
    const pts = r.points.map((id) => L.placed.get(id)!);
    const [a, b] = [pts[0], pts[pts.length - 1]];
    const end = e.arrow === false ? 0 : HEAD;
    const fOf = (p: Placed) => (LR ? p.x : p.y);
    const cOf = (p: Placed) => (LR ? p.y : p.x);
    const cHalf = (p: Placed) => (LR ? p.h : p.w) / 2;
    let line: Point[];
    if (r.arc) {
      const between = [...L.placed.values()].filter(
        (p) => p.node && p.layer >= a.layer && p.layer <= b.layer && p.slot === a.slot,
      );
      const s = r.arcSide ?? -1;
      const lane = (r.arcLevel ?? 0) * TRACK;
      const out =
        s < 0
          ? Math.min(...between.map((p) => cOf(p) - cHalf(p))) - MARGIN + 6 - lane
          : Math.max(...between.map((p) => cOf(p) + cHalf(p))) + 12 + lane;
      line = [
        at(fOf(a), cOf(a) + s * cHalf(a)),
        at(fOf(a), out),
        at(fOf(b), out),
        at(fOf(b), cOf(b) + s * (cHalf(b) + end)),
      ];
    } else if (r.back) {
      const out = Math.max(cOf(a) + cHalf(a), cOf(b) + cHalf(b)) + MARGIN * 0.8;
      line = [
        at(fOf(a), cOf(a) + cHalf(a)),
        at(fOf(a), out),
        at(fOf(b), out),
        at(fOf(b), cOf(b) + cHalf(b) + end),
      ];
    } else {
      const anc = anchors[ri];
      const fc: Point[] = [anc[0]];
      if (sideways.has(ri)) fc.push([anc[0][0], anc[1][1]]);
      for (let k = 1; k < anc.length; k++) {
        const hop = jogs[ri][k];
        if (hop) fc.push([hop.track!, hop.c0], [hop.track!, hop.c1]);
        fc.push(anc[k]);
      }
      line = fc.map(([f, c]) => at(f, c));
    }
    line = line.map(([x, y]) => [snap(x), snap(y)]);
    return line.filter((q, k) => {
      const p = line[k - 1];
      const n = line[k + 1];
      if (p && p[0] === q[0] && p[1] === q[1]) return false;
      return !(p && n && ((p[0] === q[0] && q[0] === n[0]) || (p[1] === q[1] && q[1] === n[1])));
    });
  });
  return { layout: L, routes };
}

function pixelLine(line: Point[], dashed: boolean, head: boolean): string {
  const g: Point[] = line.map(([x, y]) => [Math.round(x / PX), Math.round(y / PX)]);
  const dir = (p: Point, q: Point): Point => [Math.sign(q[0] - p[0]), Math.sign(q[1] - p[1])];
  const len = (p: Point, q: Point) => Math.max(Math.abs(q[0] - p[0]), Math.abs(q[1] - p[1]));
  const v: Point[] = [g[0]];
  for (let i = 1; i < g.length - 1; i++) {
    const [p, q, n] = [g[i - 1], g[i], g[i + 1]];
    const k = Math.min(CUT, Math.floor(len(p, q) / 2), Math.floor(len(q, n) / 2));
    const [di, dout] = [dir(p, q), dir(q, n)];
    v.push([q[0] - di[0] * k, q[1] - di[1] * k], [q[0] + dout[0] * k, q[1] + dout[1] * k]);
  }
  v.push(g[g.length - 1]);
  const cells: Point[] = [g[0]];
  for (let i = 1; i < v.length; i++) {
    const [p, q] = [v[i - 1], v[i]];
    const [dx, dy] = dir(p, q);
    for (let s = 1; s <= len(p, q); s++) cells.push([p[0] + dx * s, p[1] + dy * s]);
  }
  const on = dashed ? cells.filter((_, i) => i % 6 < 3) : cells;
  if (head && g.length > 1) {
    const [fx, fy] = dir(g[g.length - 2], g[g.length - 1]);
    const [ex, ey] = cells[cells.length - 1];
    for (let k = 0; k < 4; k++)
      for (let o = -(3 - k); o <= 3 - k; o++) on.push([ex + fx * k - fy * o, ey + fy * k + fx * o]);
  }
  const key = ([x, y]: Point) => `${x},${y}`;
  const all = new Map(on.map((c) => [key(c), c]));
  const rects: string[] = [];
  const rect = (x: number, y: number, w: number, h: number) =>
    rects.push(`M${x * PX},${y * PX}h${w * PX}v${h * PX}h-${w * PX}z`);
  for (const [x, y] of [...all.values()].sort((a, b) => a[1] - b[1] || a[0] - b[0])) {
    if (!all.has(key([x, y])) || all.has(key([x - 1, y]))) continue;
    let w = 1;
    while (all.has(key([x + w, y]))) w++;
    if (w < 2) continue;
    for (let i = 0; i < w; i++) all.delete(key([x + i, y]));
    rect(x, y, w, 1);
  }
  for (const [x, y] of [...all.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1])) {
    if (!all.has(key([x, y])) || all.has(key([x, y - 1]))) continue;
    let h = 1;
    while (all.has(key([x, y + h]))) h++;
    for (let i = 0; i < h; i++) all.delete(key([x, y + i]));
    rect(x, y, 1, h);
  }
  return rects.join('');
}

export function renderFlowchart(chart: Flowchart, title: string): string {
  const { layout: L, routes } = geometry(chart);
  const path = chart.path ?? [];
  const onPath = new Set(path);
  const pathEdge = new Set(path.slice(1).map((id, i) => `${path[i]}\0${id}`));

  let hash = 0;
  for (const ch of title) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const mid = `fc${hash.toString(36)}`;

  const edges: string[] = [];
  const labels: string[] = [];
  L.routes.forEach((r, ri) => {
    const e = r.edge;
    const em = e.emphasis || pathEdge.has(`${e.from}\0${e.to}`);
    const line = routes[ri];
    edges.push(
      `<path class="fc-edge${em ? ' is-em' : ''}" d="${pixelLine(line, !!e.dashed, e.arrow !== false)}"/>`,
    );
    if (e.label) {
      let best = 1;
      const runLen = (k: number) =>
        Math.abs(line[k][0] - line[k - 1][0]) + Math.abs(line[k][1] - line[k - 1][1]);
      for (let k = 2; k < line.length; k++) if (runLen(k) > runLen(best)) best = k;
      const lx = (line[best - 1][0] + line[best][0]) / 2 + PX / 2;
      const ly = (line[best - 1][1] + line[best][1]) / 2 + PX / 2;
      const w = textW(e.label, SMALL) + 6;
      labels.push(
        `<rect class="fc-chip" x="${lx - w / 2}" y="${ly - 7}" width="${w}" height="14" rx="3"/>` +
          `<text class="fc-elabel" x="${lx}" y="${ly + 3.5}" text-anchor="middle">${esc(e.label)}</text>`,
      );
    }
  });

  const shapes: string[] = [];
  for (const p of L.placed.values()) {
    if (!p.node) continue;
    const n = p.node;
    const em = n.emphasis || onPath.has(n.id);
    const details = n.detail ? n.detail.split('\n') : [];
    const cy = p.y + (isWindow(n) ? BAR / 2 : 0);
    const top = cy - (details.length * LINE) / 2 + 4.5;
    shapes.push(
      `<g class="fc-node fc-${n.shape ?? 'box'}${em ? ' is-em' : ''}">${shapeSvg(p, `${mid}-bar${em ? '-em' : ''}`)}` +
        `<text class="fc-label" x="${p.x}" y="${top}" text-anchor="middle">${esc(n.label)}</text>` +
        details
          .map(
            (dl, i) =>
              `<text class="fc-detail" x="${p.x}" y="${top + LINE * (i + 1) - 2}" text-anchor="middle">${esc(dl)}</text>`,
          )
          .join('') +
        `</g>`,
    );
  }

  const name = (id: string) => L.placed.get(id)!.node!.label;
  const desc =
    (path.length ? `Highlighted: ${path.map(name).join(', then ')}. ` : '') +
    chart.edges
      .map((e) => `${name(e.from)} to ${name(e.to)}${e.label ? ` (${e.label})` : ''}`)
      .join('; ') +
    '.';
  const gradient = (id: string, cls: string) =>
    `<linearGradient id="${id}"><stop class="${cls}" offset="0"/><stop class="${cls} is-end" offset="1"/></linearGradient>`;
  return (
    `<svg class="flowchart" viewBox="0 0 ${L.width} ${L.height}" width="${L.width}" height="${L.height}" style="max-width:${L.width}px;min-width:min(${L.width}px,34rem)" role="img" aria-label="${esc(title)}">` +
    `<desc>${esc(desc)}</desc>` +
    `<defs>${gradient(`${mid}-bar`, 'fc-stop')}${gradient(`${mid}-bar-em`, 'fc-stop is-em')}</defs>` +
    edges.join('') +
    shapes.join('') +
    labels.join('') +
    `</svg>`
  );
}

const SHAPES: Array<[string, string, Shape]> = [
  ['([', '])', 'pill'],
  ['((', '))', 'circle'],
  ['[/', '/]', 'parallelogram'],
  ['[', ']', 'box'],
  ['(', ')', 'round'],
  ['{', '}', 'diamond'],
];

function parseNode(text: string, nodes: Map<string, FlowNode>, line: number): string {
  const m = /^([A-Za-z_][\w-]*)(.*?)(:::em)?$/.exec(text.trim());
  if (!m) throw new Error(`flowchart: line ${line}: can't read the node "${text.trim()}"`);
  const [, id, rest, em] = m;
  let node = nodes.get(id);
  if (rest) {
    const shape = SHAPES.find(([open, close]) => rest.startsWith(open) && rest.endsWith(close));
    if (!shape)
      throw new Error(`flowchart: line ${line}: can't read the shape of "${text.trim()}"`);
    let body = rest.slice(shape[0].length, rest.length - shape[1].length).trim();
    if (/^".*"$/.test(body)) body = body.slice(1, -1);
    const [label, ...detail] = body.split('\\n');
    node = { id, label, shape: shape[2], ...(detail.length ? { detail: detail.join('\n') } : {}) };
    if (nodes.has(id) && nodes.get(id)!.emphasis) node.emphasis = true;
    nodes.set(id, node);
  } else if (!node) {
    node = { id, label: id, shape: 'box' };
    nodes.set(id, node);
  }
  if (em) nodes.get(id)!.emphasis = true;
  return id;
}

const ARROW =
  /\s*(?:--\s+(.+?)\s+(-->|---)|==\s+(.+?)\s+==>|(-->|---|==>|-\.->))(?:\|([^|]*)\|)?\s*/y;

function findArrow(s: string): RegExpExecArray | null {
  let depth = 0;
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"') quoted = !quoted;
    if (quoted) continue;
    if ('[({'.includes(ch)) depth++;
    else if ('])}'.includes(ch)) depth--;
    else if (depth === 0 && /[\s=-]/.test(ch)) {
      ARROW.lastIndex = i;
      const m = ARROW.exec(s);
      if (m && m[0].trim()) return m;
    }
  }
  return null;
}

export function parseFlowchart(source: string): Flowchart {
  const nodes = new Map<string, FlowNode>();
  const edges: FlowEdge[] = [];
  let direction: Direction = 'TB';
  source.split('\n').forEach((raw, i) => {
    const line = i + 1;
    const s = raw.replace(/%%.*$/, '').trim();
    if (!s) return;
    const head = /^(?:flowchart|graph)\s+(LR|TB|TD)\s*$/i.exec(s);
    if (head) {
      direction = head[1].toUpperCase() === 'LR' ? 'LR' : 'TB';
      return;
    }
    let rest = s;
    let from: string | null = null;
    let pending: Omit<FlowEdge, 'from' | 'to'> | null = null;
    while (rest) {
      const m = findArrow(rest);
      const nodeText = m ? rest.slice(0, m.index) : rest;
      const id = parseNode(nodeText, nodes, line);
      if (from !== null && pending) edges.push({ from, to: id, ...pending });
      if (!m) break;
      const kind = m[2] ?? (m[3] !== undefined ? '==>' : m[4]);
      const label = m[1] ?? m[3] ?? m[5];
      pending = {
        ...(label ? { label: label.trim() } : {}),
        ...(kind === '==>' ? { emphasis: true } : {}),
        ...(kind === '-.->' ? { dashed: true } : {}),
        ...(kind === '---' ? { arrow: false } : {}),
      };
      from = id;
      rest = rest.slice(m.index + m[0].length);
      if (!rest) throw new Error(`flowchart: line ${line}: an arrow with nothing after it`);
    }
  });
  if (!nodes.size) throw new Error('flowchart: no nodes');
  return { direction, nodes: [...nodes.values()], edges };
}
