import { describe, expect, it } from 'vitest';
import { geometry, layout, parseFlowchart, renderFlowchart, type Flowchart } from './flowchart';

describe('parseFlowchart', () => {
  it('reads every shape, and a bare id as a box', () => {
    const c = parseFlowchart(
      'A[box] --> B(round) --> C([pill]) --> D{diamond?} --> E[/io/] --> F((circle)) --> G',
    );
    expect(c.nodes.map((n) => [n.id, n.shape, n.label])).toEqual([
      ['A', 'box', 'box'],
      ['B', 'round', 'round'],
      ['C', 'pill', 'pill'],
      ['D', 'diamond', 'diamond?'],
      ['E', 'parallelogram', 'io'],
      ['F', 'circle', 'circle'],
      ['G', 'box', 'G'],
    ]);
    expect(c.edges).toHaveLength(6);
  });

  it('reads edge labels both ways, and every arrow kind', () => {
    const c = parseFlowchart(`flowchart LR
A{x == 0?} -- yes --> B
A -->|no| C
B ==> D
C -.-> D
D --- E`);
    expect(c.direction).toBe('LR');
    expect(c.edges).toEqual([
      { from: 'A', to: 'B', label: 'yes' },
      { from: 'A', to: 'C', label: 'no' },
      { from: 'B', to: 'D', emphasis: true },
      { from: 'C', to: 'D', dashed: true },
      { from: 'D', to: 'E', arrow: false },
    ]);
  });

  it('keeps arrows and punctuation inside a quoted label, and splits off detail lines', () => {
    const c = parseFlowchart('A["x --> y, (z)"] --> B["sbb\\n1 cycle"]:::em');
    expect(c.nodes[0].label).toBe('x --> y, (z)');
    expect(c.nodes[1]).toMatchObject({ label: 'sbb', detail: '1 cycle', emphasis: true });
    expect(c.edges).toEqual([{ from: 'A', to: 'B' }]);
  });

  it('says what it could not read', () => {
    expect(() => parseFlowchart('A[unclosed --> B')).toThrow(/line 1/);
    expect(() => parseFlowchart('A -->')).toThrow(/nothing after it/);
    expect(() => parseFlowchart('')).toThrow(/no nodes/);
  });
});

describe('layout', () => {
  it('layers by longest path; a long edge along the first slot arcs round the outside', () => {
    const L = layout(parseFlowchart('A --> B --> C --> D\nA --> D'));
    expect(['A', 'B', 'C', 'D'].map((id) => L.placed.get(id)!.layer)).toEqual([0, 1, 2, 3]);
    const long = L.routes.find((r) => r.edge.from === 'A' && r.edge.to === 'D')!;
    expect(long).toMatchObject({ points: ['A', 'D'], arc: true });
  });

  it('routes a long edge between different slots through waypoints', () => {
    const L = layout(parseFlowchart('A --> B --> C --> D\nE --> D'));
    const long = L.routes.find((r) => r.edge.from === 'E')!;
    expect(long.points).toHaveLength(4);
    expect(long.arc).toBeUndefined();
  });

  it("pins the path's solid lead-in to its row, not a dashed one", () => {
    const L = layout({
      ...parseFlowchart('flowchart LR\nx[xor] -.-> a\nr[rdi] --> a\na --> b --> c'),
      path: ['a', 'b', 'c'],
    });
    expect(L.placed.get('r')!.slot).toBe(L.placed.get('a')!.slot);
  });

  it('keeps a long edge level on its own row, turning only where it lands', () => {
    const { layout: L, routes } = geometry(
      parseFlowchart('flowchart LR\nx -.-> a\nr --> a\nm --> s\nq --> t\na --> b --> c --> s'),
    );
    const line = routes[L.routes.findIndex((e) => e.edge.from === 'm')];
    const m = L.placed.get('m')!;
    expect(line[1][1]).toBe(line[0][1]);
    expect(line[1][0]).toBeGreaterThan(L.placed.get('c')!.x);
    expect(Math.abs(line[0][1] - m.y)).toBeLessThan(m.h / 2);
  });

  it('sends an arc that would cross another under the row instead, and stacks nested ones', () => {
    const route = (L: ReturnType<typeof layout>, from: string, to: string) =>
      L.routes.find((r) => r.edge.from === from && r.edge.to === to)!;
    const L = layout({
      ...parseFlowchart('flowchart LR\nx --> a --> b --> s --> d --> f\nx --> d\ns --> f'),
      path: ['a', 'b', 's', 'd', 'f'],
    });
    expect(route(L, 'x', 'd')).toMatchObject({ arc: true, arcSide: -1 });
    expect(route(L, 's', 'f')).toMatchObject({ arc: true, arcSide: 1 });
    const N = layout({
      ...parseFlowchart('flowchart LR\nx --> a --> b --> c --> d\nx --> c\nx --> d'),
      path: ['a', 'b', 'c', 'd'],
    });
    expect(route(N, 'x', 'c')).toMatchObject({ arcSide: -1, arcLevel: 0 });
    expect(route(N, 'x', 'd')).toMatchObject({ arcSide: -1, arcLevel: 1 });
  });

  it('draws a long edge straight when nothing sits between its ends', () => {
    const L = layout({
      direction: 'LR',
      nodes: ['a', 'b', 'c', 'd', 'm', 's'].map((id) => ({ id, label: id })),
      edges: [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'c' },
        { from: 'c', to: 'd' },
        { from: 'c', to: 's' },
        { from: 'm', to: 's' },
      ],
      path: ['a', 'b', 'c', 'd'],
    });
    const ms = L.routes.find((r) => r.edge.from === 'm')!;
    expect(ms.points).toEqual(['m', 's']);
    expect(ms.arc).toBeUndefined();
  });

  it('sets a loop aside so the rest stays layered', () => {
    const L = layout(parseFlowchart('A --> B{done?}\nB -- no --> C --> B\nB -- yes --> D'));
    const loop = L.routes.filter((r) => r.back);
    expect(loop.map((r) => `${r.edge.from}->${r.edge.to}`)).toEqual(['C->B']);
    expect(L.placed.get('D')!.layer).toBe(2);
  });

  it('keeps an emphasised path in the first slot of every layer', () => {
    const chart: Flowchart = {
      direction: 'LR',
      nodes: ['a', 'b', 'c', 'm', 's'].map((id) => ({ id, label: id })),
      edges: [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'c' },
        { from: 'm', to: 's' },
        { from: 'a', to: 's' },
        { from: 's', to: 'c' },
      ],
      path: ['a', 'b', 'c'],
    };
    const L = layout(chart);
    for (const id of chart.path!) expect(L.placed.get(id)!.slot).toBe(0);
  });

  it('rejects unknown names and duplicate nodes', () => {
    expect(() =>
      layout({ nodes: [{ id: 'a', label: 'a' }], edges: [{ from: 'a', to: 'b' }] }),
    ).toThrow(/unknown/);
    expect(() =>
      layout({
        nodes: [
          { id: 'a', label: 'a' },
          { id: 'a', label: 'b' },
        ],
        edges: [],
      }),
    ).toThrow(/twice/);
  });
});

describe('renderFlowchart', () => {
  it('gives each edge a head-on port: a straight one keeps the middle, the rest stack outward', () => {
    const chart = parseFlowchart(
      'flowchart LR\nshr ==> cmp ==> sbb\nshr --> sub --> sbb\nm[mov] --> sub',
    );
    const { layout: L, routes } = geometry(chart);
    const route = (from: string, to: string) =>
      routes[L.routes.findIndex((r) => r.edge.from === from && r.edge.to === to)];
    for (const line of routes) {
      for (const [x, y] of line) expect([x % 2, y % 2]).toEqual([0, 0]);
      for (let k = 1; k < line.length; k++)
        expect(line[k][0] === line[k - 1][0] || line[k][1] === line[k - 1][1]).toBe(true);
    }
    for (const [a, b] of [
      ['shr', 'cmp'],
      ['cmp', 'sbb'],
    ]) {
      const line = route(a, b);
      expect(line).toHaveLength(2);
      expect(line[0][1]).toBe(line[1][1]);
    }
    const toCmp = route('shr', 'cmp');
    const toSub = route('shr', 'sub');
    expect(toSub[0][0]).toBe(toCmp[0][0]);
    expect(toSub[0][1]).toBeGreaterThan(toCmp[0][1]);
    for (const line of [toSub, route('sub', 'sbb')]) {
      expect(line[1][1]).toBe(line[0][1]);
      expect(line[line.length - 2][1]).toBe(line[line.length - 1][1]);
    }
  });

  it("sends a decision's sideways branch out of its side corner, unless a loop uses it", () => {
    const first = (src: string, from: string, to: string) => {
      const { layout: L, routes } = geometry(parseFlowchart(src));
      const line = routes[L.routes.findIndex((r) => r.edge.from === from && r.edge.to === to)];
      return { line, d: L.placed.get(from)! };
    };
    const side = first(
      'flowchart TB\nZ{z?} -- yes --> O\nZ -- no --> N\nO --> E\nN --> E',
      'Z',
      'O',
    );
    const other = first(
      'flowchart TB\nZ{z?} -- yes --> O\nZ -- no --> N\nO --> E\nN --> E',
      'Z',
      'N',
    );
    const sideways = [side, other].find(({ line, d }) => line[0][1] === Math.round(d.y / 2) * 2)!;
    expect(sideways).toBeDefined();
    expect(Math.abs(sideways.line[0][0] - sideways.d.x)).toBeCloseTo(sideways.d.w / 2, -1);
    const loop = 'flowchart TB\nC{c?} -- no --> E\nC -- yes --> L\nL --> C';
    const { line, d } = first(loop, 'C', 'L');
    expect(line[0][1]).toBeGreaterThan(d.y);
  });

  it('draws edges as pixels on a 2px grid, with a pixel arrowhead', () => {
    const edge = (arrow: string) => {
      const svg = renderFlowchart(parseFlowchart(`flowchart LR\nA ${arrow} B\nA --> C`), 't');
      return /<path class="fc-edge[^"]*" d="([^"]*)"/.exec(svg)![1];
    };
    const solid = edge('-->');
    expect(solid).toMatch(/^(M\d*[02468],\d*[02468]h\d*[02468]v\d*[02468]h-\d*[02468]z)+$/);
    const cells = (d: string) =>
      [...d.matchAll(/h(\d+)v(\d+)/g)].reduce((n, [, w, h]) => n + (+w / 2) * (+h / 2), 0);
    expect(cells(solid) - cells(edge('---'))).toBe(16 - 1 - 4);
    const dashed = cells(edge('-.->')) - 15;
    const line = cells(solid) - 15;
    expect(dashed).toBeGreaterThanOrEqual(Math.floor(line / 2));
    expect(dashed).toBeLessThan(line);
  });
  const chart = parseFlowchart(
    'flowchart LR\nA[lzcnt] ==> B[lea] ==> C[shr]\nM[mov] --> S[sub]\nC --> S',
  );
  const svg = renderFlowchart({ ...chart, path: ['A', 'B', 'C'] }, 'a chart');
  it('marks emphasis, and describes the chart for a screen reader', () => {
    expect(svg.match(/class="fc-node fc-box is-em"/g)).toHaveLength(3);
    expect(svg).toContain('<desc>Highlighted: lzcnt, then lea, then shr.');
    expect(svg).toContain('role="img" aria-label="a chart"');
  });
  it('gives each chart its own marker ids', () => {
    const ids = (s: string) => [...s.matchAll(/<marker id="([^"]+)"/g)].map((m) => m[1]);
    const other = renderFlowchart(chart, 'another chart');
    expect(ids(svg).some((id) => ids(other).includes(id))).toBe(false);
  });
});
