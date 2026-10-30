/**
 * Where to draw a Sankey diagram: each node a bar in its column, as tall as the money through it, and each link a band from its
 * source to its target, as wide as its amount. Links leave a node in the order of their targets and arrive in the order of their
 * sources, so bands cross as little as possible. Columns are spread over the width; a node is never shorter than `minNode` so a small
 * amount stays visible and clickable. Pure: no I/O, no DOM.
 */
export interface SankeyNodeIn {
  id: string;
  column: number;
  value: number;
}
export interface SankeyLinkIn {
  source: string;
  target: string;
  amount: number;
}

export interface SankeyNodeOut {
  id: string;
  column: number;
  x: number;
  y: number;
  width: number;
  height: number;
  value: number;
}
export interface SankeyLinkOut {
  index: number;
  source: string;
  target: string;
  /** the band's left end (top and bottom) and right end */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  width: number;
}
export interface SankeyLayout {
  width: number;
  height: number;
  columns: number;
  nodes: SankeyNodeOut[];
  links: SankeyLinkOut[];
}

export interface SankeyOptions {
  width: number;
  /** the height the tallest column is drawn in (it grows when the nodes need more room) */
  height: number;
  nodeWidth?: number;
  /** space between nodes of a column */
  gap?: number;
  minNode?: number;
  minLink?: number;
}

export function sankeyLayout(
  nodesIn: SankeyNodeIn[],
  linksIn: SankeyLinkIn[],
  opts: SankeyOptions,
): SankeyLayout {
  const nodeWidth = opts.nodeWidth ?? 12;
  const gap = opts.gap ?? 10;
  const minNode = opts.minNode ?? 4;
  const minLink = opts.minLink ?? 1.5;
  const known = new Set(nodesIn.map((n) => n.id));
  const linksAll = linksIn.filter(
    (l) => known.has(l.source) && known.has(l.target) && l.amount > 0,
  );
  // columns renumbered 0.. in order, so a gap in numbering leaves no empty column
  const colNos = [...new Set(nodesIn.map((n) => n.column))].sort((a, b) => a - b);
  const colOf = new Map(colNos.map((c, i) => [c, i]));
  const columns = Math.max(1, colNos.length);
  const byCol: SankeyNodeIn[][] = Array.from({ length: columns }, () => []);
  for (const n of nodesIn) byCol[colOf.get(n.column)!]!.push(n);

  // money to pixels: the column with the most money (less its gaps) fills the height
  const busiest = Math.max(...byCol.map((ns) => ns.length), 1);
  const height = Math.max(opts.height, busiest * (minNode + gap));
  const k = Math.min(
    ...byCol.map(
      (ns) =>
        (height - Math.max(0, ns.length - 1) * gap) /
        Math.max(
          1,
          ns.reduce((s, n) => s + n.value, 0),
        ),
    ),
  );

  const step = columns > 1 ? (opts.width - nodeWidth) / (columns - 1) : 0;
  const pos = new Map<string, SankeyNodeOut>();
  const place = (ns: SankeyNodeIn[], c: number) => {
    let y = 0;
    for (const n of ns) {
      const h = Math.max(minNode, n.value * k);
      pos.set(n.id, {
        id: n.id,
        column: c,
        x: c * step,
        y,
        width: nodeWidth,
        height: h,
        value: n.value,
      });
      y += h + gap;
    }
  };
  // first column largest first; each next column in the order of where its money comes from (the weighted middle of its sources)
  byCol[0]!.sort((a, b) => b.value - a.value);
  place(byCol[0]!, 0);
  const centre = (id: string) => {
    const p = pos.get(id)!;
    return p.y + p.height / 2;
  };
  for (let c = 1; c < columns; c++) {
    const weight = (n: SankeyNodeIn) => {
      let w = 0;
      let s = 0;
      for (const l of linksAll)
        if (l.target === n.id && pos.has(l.source)) {
          w += l.amount;
          s += l.amount * centre(l.source);
        }
      return w > 0 ? s / w : Infinity;
    };
    const ws = new Map(byCol[c]!.map((n) => [n.id, weight(n)]));
    byCol[c]!.sort((a, b) => ws.get(a.id)! - ws.get(b.id)! || b.value - a.value);
    place(byCol[c]!, c);
  }
  // the first column again, in the order of where its money goes
  if (columns > 1) {
    const ws = new Map(
      byCol[0]!.map((n) => {
        let w = 0;
        let s = 0;
        for (const l of linksAll)
          if (l.source === n.id) {
            w += l.amount;
            s += l.amount * centre(l.target);
          }
        return [n.id, w > 0 ? s / w : Infinity] as const;
      }),
    );
    byCol[0]!.sort((a, b) => ws.get(a.id)! - ws.get(b.id)! || b.value - a.value);
    place(byCol[0]!, 0);
  }

  // bands: out of each node in the order of their targets, into each node in the order of their sources
  const outY = new Map<string, number>();
  const inY = new Map<string, number>();
  const order = linksAll.map((l, index) => ({ l, index }));
  const out: SankeyLinkOut[] = new Array(linksAll.length);
  for (const { l, index } of [...order].sort((a, b) => centre(a.l.target) - centre(b.l.target))) {
    const s = pos.get(l.source)!;
    const w = Math.max(minLink, l.amount * k);
    const y0 = (outY.get(l.source) ?? s.y) + w / 2;
    outY.set(l.source, (outY.get(l.source) ?? s.y) + w);
    out[index] = {
      index,
      source: l.source,
      target: l.target,
      x0: s.x + nodeWidth,
      y0,
      x1: 0,
      y1: 0,
      width: w,
    };
  }
  for (const { l, index } of [...order].sort((a, b) => centre(a.l.source) - centre(b.l.source))) {
    const t = pos.get(l.target)!;
    const w = out[index]!.width;
    out[index]!.x1 = t.x;
    out[index]!.y1 = (inY.get(l.target) ?? t.y) + w / 2;
    inY.set(l.target, (inY.get(l.target) ?? t.y) + w);
  }
  const nodes = [...pos.values()];
  const bottom = Math.max(...nodes.map((n) => n.y + n.height), 0);
  return { width: opts.width, height: Math.max(bottom, 1), columns, nodes, links: out };
}

/** The centre line of a band, as an SVG path (drawn with the band's width as its stroke). */
export function bandPath(l: SankeyLinkOut): string {
  const mx = (l.x0 + l.x1) / 2;
  return `M${l.x0.toFixed(1)},${l.y0.toFixed(1)}C${mx.toFixed(1)},${l.y0.toFixed(1)} ${mx.toFixed(1)},${l.y1.toFixed(1)} ${l.x1.toFixed(1)},${l.y1.toFixed(1)}`;
}
