function buildNavigationGraph(data) {
  const nodes = [], adj = [], grid = new Map();
  const CELL = 3.2;
  const cellKey = (cx, cn) => cx + ',' + cn;
  function nearestNode(x, n, maxDist, filter) {
    const cx = Math.floor(x / CELL), cn = Math.floor(n / CELL), reach = Math.max(1, Math.ceil(maxDist / CELL));
    let best = -1, bestDist = maxDist;
    for (let a = -reach; a <= reach; a++) for (let b = -reach; b <= reach; b++) {
      const arr = grid.get(cellKey(cx + a, cn + b)); if (!arr) continue;
      for (const i of arr) { if (filter && !filter(i)) continue; const d = Math.hypot(nodes[i].x - x, nodes[i].n - n); if (d < bestDist) { bestDist = d; best = i; } }
    }
    return best;
  }
  function addNode(x, n) {
    // 只吸附到 0.9m 内的既有节点：采样间距为 3m，阈值过大会把同一条路的相邻采样点并成一串。
    let i = nearestNode(x, n, .9);
    if (i >= 0) return i;
    i = nodes.length; nodes.push({ x, n }); adj.push([]);
    const k = cellKey(Math.floor(x / CELL), Math.floor(n / CELL));
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i);
    return i;
  }
  function addEdge(i, j, road) {
    if (i === j) return;
    const w = Math.hypot(nodes[i].x - nodes[j].x, nodes[i].n - nodes[j].n) || .01;
    adj[i].push({ to: j, w, road }); adj[j].push({ to: i, w, road });
  }
  data.roads.forEach((road, ri) => {
    const pts = road.points;
    for (let s = 0; s < pts.length - 1; s++) {
      const a = pts[s], b = pts[s + 1], length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (length < .01) continue;
      const steps = Math.max(1, Math.ceil(length / 3));
      let prev = addNode(a[0], a[1]);
      for (let k = 1; k <= steps; k++) {
        const t = k / steps, cur = addNode(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t);
        // B94 的 OSM 道路穿过实体建筑：此段不能作为可步行道路。
        if (cur !== prev && !crossesB94(nodes[prev], nodes[cur])) addEdge(prev, cur, ri);
        prev = cur;
      }
    }
  });
  function components() {
    const parent = nodes.map((_, i) => i);
    function find(i) { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; }
    for (let i = 0; i < adj.length; i++) for (const e of adj[i]) if (i < e.to) { const a = find(i), b = find(e.to); if (a !== b) parent[b] = a; }
    const comp = new Int32Array(nodes.length), sizes = new Map();
    for (let i = 0; i < nodes.length; i++) { const r = find(i); comp[i] = r; sizes.set(r, (sizes.get(r) || 0) + 1); }
    let mainComp = -1, mainSize = 0;
    for (const [r, s] of sizes) if (s > mainSize) { mainSize = s; mainComp = r; }
    return { comp, sizes, mainComp, find };
  }
  let state = components(), seamCount = 0;
  // 断点两侧多为同一路口被 OSM 支路切碎；每轮把孤立分量缝回主网，直到没有新的断点。
  const MAIN_CELL = 16;
  for (let pass = 0; pass < 4; pass++) {
    const mainGrid = new Map();
    for (let i = 0; i < nodes.length; i++) if (state.comp[i] === state.mainComp) {
      const k = cellKey(Math.floor(nodes[i].x / MAIN_CELL), Math.floor(nodes[i].n / MAIN_CELL));
      if (!mainGrid.has(k)) mainGrid.set(k, []);
      mainGrid.get(k).push(i);
    }
    const seams = new Map();
    for (let i = 0; i < nodes.length; i++) {
      const root = state.comp[i]; if (root === state.mainComp) continue;
      // 西北山体步道在 OSM 中与主路网断开约 105m，仅该大分量放宽到 130m；其余仍限 40m。
      const limit = state.sizes.get(root) >= 200 ? 130 : 40, reach = Math.ceil(limit / MAIN_CELL);
      const cx = Math.floor(nodes[i].x / MAIN_CELL), cn = Math.floor(nodes[i].n / MAIN_CELL);
      for (let a = -reach; a <= reach; a++) for (let b = -reach; b <= reach; b++) {
        const arr = mainGrid.get(cellKey(cx + a, cn + b)); if (!arr) continue;
        for (const j of arr) {
          const d = Math.hypot(nodes[i].x - nodes[j].x, nodes[i].n - nodes[j].n), cur = seams.get(root);
          if (d > limit || (cur && d >= cur.d)) continue;
          // 远距离缝合不能跨湖/跨楼，否则会生成一条“水上直线”路线。
          if (lineCrossesWater(nodes[i], nodes[j]) || lineCrossesBuilding(nodes[i], nodes[j])) continue;
          seams.set(root, { d, a: i, b: j });
        }
      }
    }
    if (!seams.size) break;
    for (const { a, b } of seams.values()) addEdge(a, b, -1);
    seamCount += seams.size;
    state = components();
  }
  const segments = [];
  data.roads.forEach((road, ri) => { for (let i = 0; i < road.points.length - 1; i++) segments.push({ a: road.points[i], b: road.points[i + 1], road: ri }); });
  const S_CELL = 24, segGrid = new Map();
  for (const s of segments) {
    const x0 = Math.floor(Math.min(s.a[0], s.b[0]) / S_CELL), x1 = Math.floor(Math.max(s.a[0], s.b[0]) / S_CELL);
    const n0 = Math.floor(Math.min(s.a[1], s.b[1]) / S_CELL), n1 = Math.floor(Math.max(s.a[1], s.b[1]) / S_CELL);
    for (let x = x0; x <= x1; x++) for (let n = n0; n <= n1; n++) {
      const k = cellKey(x, n); if (!segGrid.has(k)) segGrid.set(k, []); segGrid.get(k).push(s);
    }
  }
  function projectNearest(x, n, filter) {
    const cx = Math.floor(x / S_CELL), cn = Math.floor(n / S_CELL);
    for (const reach of [4, 14]) {
      let best = null;
      for (let a = -reach; a <= reach; a++) for (let b = -reach; b <= reach; b++) {
        const arr = segGrid.get(cellKey(cx + a, cn + b)); if (!arr) continue;
        for (const s of arr) {
          const vx = s.b[0] - s.a[0], vn = s.b[1] - s.a[1], l2 = vx * vx + vn * vn;
          let t = l2 ? ((x - s.a[0]) * vx + (n - s.a[1]) * vn) / l2 : 0;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const px = s.a[0] + vx * t, pn = s.a[1] + vn * t, d = Math.hypot(x - px, n - pn);
          if (filter && !filter(px, pn)) continue;
          if (!best || d < best.d) best = { x: px, n: pn, d, road: s.road };
        }
      }
      if (best) return best;
    }
    return null;
  }
  function ringSamples(ring) {
    const out = [];
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length], length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const steps = Math.max(1, Math.ceil(length / 4));
      for (let k = 0; k < steps; k++) out.push([a[0] + (b[0] - a[0]) * k / steps, a[1] + (b[1] - a[1]) * k / steps]);
    }
    return out;
  }
  function pointInRing(x, n, ring) {
    let hit = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i], b = ring[j];
      if ((a[1] > n) !== (b[1] > n) && x < (b[0] - a[0]) * (n - a[1]) / (b[1] - a[1]) + a[0]) hit = !hit;
    }
    return hit;
  }
  // 兼容 {x,n} 节点对象和 [x,n] 数组两种入参（函数声明提升，缝合循环里可先用）。
  function ax(a) { return Array.isArray(a) ? a[0] : a.x; }
  function an(a) { return Array.isArray(a) ? a[1] : a.n; }
  function pointInAnyWater(x, n) {
    if (!data.water) return false;
    for (const ring of data.water) if (pointInRing(x, n, ring)) return true;
    return false;
  }
  function lineCrossesWater(a, b) {
    if (!data.water || !data.water.length) return false;
    const ax0 = ax(a), an0 = an(a), ax1 = ax(b), an1 = an(b);
    const steps = Math.max(1, Math.ceil(Math.hypot(ax1 - ax0, an1 - an0) / 4));
    for (let k = 1; k < steps; k++) {
      if (pointInAnyWater(ax0 + (ax1 - ax0) * k / steps, an0 + (an1 - an0) * k / steps)) return true;
    }
    return false;
  }
  function crossesB94(a, b) {
    const building = data.buildings.find(b => b.s === "B94");
    if (!building) return false;
    const x0 = ax(a), n0 = an(a), x1 = ax(b), n1 = an(b);
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, n1 - n0)));
    for (let i = 0; i <= steps; i++)
      if ((building.parts || [building.r]).some(r => pointInRing(x0 + (x1 - x0) * i / steps, n0 + (n1 - n0) * i / steps, r))) return true;
    return false;
  }
  function pointInAnyBuilding(x, n, skipId) {
    for (const b of data.buildings) {
      if (b.s === skipId) continue;
      for (const ring of (b.parts || [b.r])) if (pointInRing(x, n, ring)) return true;
    }
    return false;
  }
  function lineCrossesBuilding(a, b, skipId) {
    const ax0 = ax(a), an0 = an(a), ax1 = ax(b), an1 = an(b);
    const steps = Math.max(1, Math.ceil(Math.hypot(ax1 - ax0, an1 - an0) / 2));
    for (let k = 1; k < steps; k++) if (pointInAnyBuilding(ax0 + (ax1 - ax0) * k / steps, an0 + (an1 - an0) * k / steps, skipId)) return true;
    return false;
  }
  // OSM 的路口常被拆成多条 way，端点留 1–6m 缝隙；只缝断头端点，避免在路中间造捷径。
  let proxCount = 0;
  const dangling = [];
  for (let i = 0; i < nodes.length; i++) if (adj[i].length <= 1) dangling.push(i);
  for (const i of dangling) {
    let best = -1, bestD = 6;
    const cx = Math.floor(nodes[i].x / CELL), cn = Math.floor(nodes[i].n / CELL);
    for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) {
      const arr = grid.get(cellKey(cx + a, cn + b)); if (!arr) continue;
      for (const j of arr) {
        if (j === i || adj[i].some(e => e.to === j)) continue;
        const d = Math.hypot(nodes[i].x - nodes[j].x, nodes[i].n - nodes[j].n);
        if (d >= bestD || d < .01) continue;
        if (lineCrossesWater(nodes[i], nodes[j]) || lineCrossesBuilding(nodes[i], nodes[j])) continue;
        bestD = d; best = j;
      }
    }
    if (best >= 0) { addEdge(i, best, -1); proxCount++; }
  }
  if (proxCount) state = components();
  const entries = {};
  for (const b of data.buildings) {
    let best = null, bestClear = null;
    const inner = (x, n) => { for (const ring of (b.parts || [b.r])) if (pointInRing(x, n, ring)) return true; return false; };
    for (const ring of (b.parts || [b.r])) for (const p of ringSamples(ring)) {
      // 优先找“路面锚点不在自身轮廓内”的道路（避免入口停在内廊/院落里），找不到再退回最近路。
      const validAnchor = (qx, qn) => {
        if (b.s !== "B94") return true;
        const node = nearestNode(qx, qn, 12, i => state.comp[i] === state.mainComp && adj[i].length > 0 && !crossesB94(nodes[i], [qx, qn]));
        return node >= 0 && !crossesB94([qx, qn], [qx, qn]);
      };
      const q = projectNearest(p[0], p[1], (qx, qn) => !inner(qx, qn) && validAnchor(qx, qn)) || projectNearest(p[0], p[1], validAnchor);
      if (!q) continue;
      const candidate = { x: q.x, n: q.n, d: q.d, entry: p, road: q.road };
      if (!best || q.d < best.d) best = candidate;
      // 入口连线不能穿过相邻楼或水面：否则会出现“从体育馆穿 J5 座出来”的 30m 穿楼段。
      // 路边锚点落在自身轮廓内（院落内步道/近似轮廓）优先级最低，避免终点停在楼体内部。
      const clear = !lineCrossesBuilding(p, [q.x, q.n], b.s), dry = !lineCrossesWater(p, [q.x, q.n]), outer = !inner(q.x, q.n);
      const key = (outer ? 0 : 4) + (clear ? 0 : 2) + (dry ? 0 : 1);
      if (!bestClear || key < bestClear.key || (key === bestClear.key && q.d < bestClear.d)) bestClear = { ...candidate, key };
    }
    const chosen = bestClear || best;
    if (!chosen) continue;
    let node = b.s === "B94"
      ? nearestNode(chosen.x, chosen.n, 12, i => state.comp[i] === state.mainComp && adj[i].length > 0 && !crossesB94(nodes[i], [chosen.x, chosen.n]))
      : nearestNode(chosen.x, chosen.n, 12);
    if (node < 0) node = addNode(chosen.x, chosen.n);
    const entry = [chosen.entry[0], chosen.entry[1]], anchor = [chosen.x, chosen.n];
    const via = findDetour(entry, anchor, b.s);
    entries[b.s] = { node, anchor, entry, approach: chosen.d, via, road: chosen.road };
  }
  // 入口到路边直线若穿楼/穿水（如体育馆被 J5 围住），用栅格 A* 找一条绕行通道。
  function findDetour(entry, anchor, skipId) {
    if (!lineCrossesBuilding(entry, anchor, skipId) && !lineCrossesWater(entry, anchor)) return null;
    const margin = 70, step = 2.5;
    const x0 = Math.min(entry[0], anchor[0]) - margin, x1 = Math.max(entry[0], anchor[0]) + margin;
    const n0 = Math.min(entry[1], anchor[1]) - margin, n1 = Math.max(entry[1], anchor[1]) + margin;
    const cols = Math.floor((x1 - x0) / step) + 1, rows = Math.floor((n1 - n0) / step) + 1;
    const cellX = i => x0 + i * step, cellN = j => n0 + j * step;
    const blocked = (x, n) => {
      for (const [dx, dn] of [[0, 0], [1.2, 0], [-1.2, 0], [0, 1.2], [0, -1.2]]) if (pointInAnyBuilding(x + dx, n + dn, skipId)) return true;
      return pointInAnyWater(x, n);
    };
    const start = [Math.round((entry[0] - x0) / step), Math.round((entry[1] - n0) / step)];
    const goal = [Math.round((anchor[0] - x0) / step), Math.round((anchor[1] - n0) / step)];
    if (start[0] < 0 || start[1] < 0 || goal[0] < 0 || goal[1] < 0 || start[0] >= cols || start[1] >= rows || goal[0] >= cols || goal[1] >= rows) return null;
    const open = new Map(), closed = new Set(), key = (i, j) => i + ',' + j;
    const h = (i, j) => Math.hypot(i - goal[0], j - goal[1]);
    const heap = [[h(start[0], start[1]), 0, start[0], start[1], -1]];
    open.set(key(start[0], start[1]), { g: 0, prev: null });
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    let done = null, guard = 0;
    while (heap.length && guard++ < 60000) {
      heap.sort((a, b) => a[0] - b[0]);
      const [, g, i, j] = heap.shift();
      const k = key(i, j), rec = open.get(k);
      if (!rec || g > rec.g + 1e-9) continue;
      if (i === goal[0] && j === goal[1]) { done = [i, j]; break; }
      closed.add(k);
      for (const [di, dj] of dirs) {
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue;
        const nk = key(ni, nj);
        if (closed.has(nk)) continue;
        const px = cellX(ni), pn = cellN(nj);
        if (!(ni === goal[0] && nj === goal[1]) && !(ni === start[0] && nj === start[1]) && blocked(px, pn)) continue;
        const ng = g + Math.hypot(di, dj);
        const prev = open.get(nk);
        if (prev && prev.g <= ng + 1e-9) continue;
        open.set(nk, { g: ng, prev: [i, j] });
        heap.push([ng + h(ni, nj), ng, ni, nj, i]);
      }
    }
    if (!done) return null;
    const cells = [];
    for (let cur = done; cur; ) { cells.push([cellX(cur[0]), cellN(cur[1])]); const rec = open.get(key(cur[0], cur[1])); cur = rec && rec.prev; }
    cells.reverse();
    cells[0] = entry; cells[cells.length - 1] = anchor;
    // 拉直：保留视线无遮挡的最远点，路线更自然。
    const out = [entry];
    for (let i = 1; i < cells.length - 1; i++) {
      const last = out[out.length - 1];
      if (!lineCrossesBuilding(last, cells[i + 1], skipId) && !lineCrossesWater(last, cells[i + 1])) continue;
      out.push(cells[i]);
    }
    out.push(anchor);
    let len = 0; for (let i = 1; i < out.length; i++) len += Math.hypot(out[i][0] - out[i - 1][0], out[i][1] - out[i - 1][1]);
    const direct = Math.hypot(anchor[0] - entry[0], anchor[1] - entry[1]);
    if (len > direct * 3 + 60) return null;
    return out;
  }
  const gates = (data.gates || []).map(g => {
    const q = projectNearest(g.x, g.n), anchor = q ? [q.x, q.n] : [g.x, g.n];
    let node = q ? nearestNode(q.x, q.n, 12) : -1;
    if (node < 0) node = addNode(anchor[0], anchor[1]);
    return { id: g.id, name: g.name, node, anchor, point: [g.x, g.n], approach: q ? q.d : 0, road: q?.road };
  });
  function MinHeap() { this.a = []; }
  MinHeap.prototype.push = function (d, i) {
    const a = this.a; a.push([d, i]); let k = a.length - 1;
    while (k > 0) { const p = (k - 1) >> 1; if (a[p][0] <= a[k][0]) break; const t = a[p]; a[p] = a[k]; a[k] = t; k = p; }
  };
  MinHeap.prototype.pop = function () {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last;
      for (let k = 0; ;) {
        const l = k * 2 + 1, r = l + 1; let m = k;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === k) break;
        const t = a[m]; a[m] = a[k]; a[k] = t; k = m;
      }
    }
    return top;
  };
  // Start and finish on the actual road edge, with both directions available.
  function projectRoadEdge(x, n, radius, filter) {
    const cx = Math.floor(x / CELL), cn = Math.floor(n / CELL), reach = Math.ceil((radius + 4) / CELL);
    let best = null;
    for (let ix = cx - reach; ix <= cx + reach; ix++) for (let iy = cn - reach; iy <= cn + reach; iy++) {
      for (const i of grid.get(cellKey(ix, iy)) || []) for (const edge of adj[i]) {
        if (edge.road < 0 || i >= edge.to || !filter(i, edge)) continue;
        const a = nodes[i], b = nodes[edge.to], dx = b.x - a.x, dn = b.n - a.n;
        const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (n - a.n) * dn) / (dx * dx + dn * dn)));
        const point = [a.x + dx * t, a.n + dn * t];
        const distance = Math.hypot(x - point[0], n - point[1]);
        if (distance > radius || (best && distance >= best.distance)) continue;
        best = { point, road: edge.road, distance, links: [[i, edge.w * t], [edge.to, edge.w * (1 - t)]] };
      }
    }
    return best;
  }
  function shortest(start, goal, requireMapped) {
    const total = nodes.length, dist = new Float64Array(total).fill(Infinity), prev = new Int32Array(total).fill(-1), prevRoad = new Int32Array(total).fill(-1);
    const heap = new MinHeap();
    const goals = new Map(goal.links);
    for (const [node, cost] of start.links) { dist[node] = cost; heap.push(cost, node); }
    let end = -1, best = Infinity;
    while (heap.a.length) {
      const [d, u] = heap.pop();
      if (d > dist[u] + 1e-9) continue;
      if (d >= best) break;
      if (goals.has(u) && d + goals.get(u) < best) { end = u; best = d + goals.get(u); }
      for (const e of adj[u]) {
        if (requireMapped && e.road < 0 && e.w > 6) continue;
        const nd = d + e.w + (e.road < 0 && e.w > 6 ? 6 * (e.w - 6) : 0);
        if (nd < dist[e.to] - 1e-9) { dist[e.to] = nd; prev[e.to] = u; prevRoad[e.to] = e.road; heap.push(nd, e.to); }
      }
    }
    const sameEdge = start.links.length === 2 && goal.links.length === 2 && start.road === goal.road
      && start.links.every(([node], i) => node === goal.links[i][0]);
    const direct = Math.hypot(start.point[0] - goal.point[0], start.point[1] - goal.point[1]);
    if (sameEdge && direct <= best + 1e-6) return { path: [], edgeRoads: [] };
    if (end < 0) return null;
    const path = [], edgeRoads = [];
    for (let v = end; v >= 0; v = prev[v]) {
      path.push(v);
      if (prev[v] >= 0) edgeRoads.push(prevRoad[v]);
    }
    path.reverse(); edgeRoads.reverse();
    return { path, edgeRoads };
  }
  function roadAnchor({ anchor, road, node }) {
    const projected = projectRoadEdge(...anchor, 1.1, (i, edge) => edge.road === road && state.comp[i] === state.comp[node]);
    return projected || { point: anchor, road, links: [[node, Math.hypot(anchor[0] - nodes[node].x, anchor[1] - nodes[node].n)]] };
  }
  function endpoint({ type, id, point }) {
    if (type === 'position') {
      if (!Array.isArray(point) || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) return null;
      const inWater = pointInAnyWater(point[0], point[1]);
      const anchor = projectRoadEdge(point[0], point[1], 18, (i, edge) => state.comp[i] === state.mainComp
        && (!inWater || data.roads[edge.road].bridge));
      if (!anchor || (!data.roads[anchor.road].bridge && lineCrossesWater(point, anchor.point))) return null;
      return { label: '当前位置', anchor, approach: anchor.distance };
    }
    if (type === 'gate') {
      const g = gates.find(g => g.id === id);
      return g && { label: g.name, approach: g.approach, anchor: roadAnchor(g), access: [g.point] };
    }
    const e = entries[id], b = data.buildings.find(b => b.s === id);
    return e && { label: b ? (b.n || b.s) : id, approach: e.approach, anchor: roadAnchor(e), access: e.via ? e.via.slice(0, -1) : [e.entry] };
  }
  function mappedCorridor(x, n) {
    const cx = Math.floor(x / S_CELL), cn = Math.floor(n / S_CELL);
    for (let dx = -1; dx <= 1; dx++) for (let dn = -1; dn <= 1; dn++) {
      for (const segment of segGrid.get(cellKey(cx + dx, cn + dn)) || []) {
        const road = data.roads[segment.road];
        if (road.bridge) continue;
        const [x0, n0] = segment.a, vx = segment.b[0] - x0, vn = segment.b[1] - n0;
        const t = Math.max(0, Math.min(1, ((x - x0) * vx + (n - n0) * vn) / (vx * vx + vn * vn || 1)));
        if (Math.hypot(x - x0 - vx * t, n - n0 - vn * t) <= road.width / 2 - .3) return true;
      }
    }
    return false;
  }
  function removeJunctionJogs(points, seams) {
    for (const index of seams.reverse()) {
      let best = null, saved = 1;
      for (let i = Math.max(0, index - 2); i <= index; i++) {
        const a = points[i];
        let distance = 0;
        for (let j = i + 1; j <= Math.min(points.length - 1, index + 3); j++) {
          const b = points[j], previous = points[j - 1];
          if (previous[2] || b[2]) break;
          distance += Math.hypot(b[0] - previous[0], b[1] - previous[1]);
          if (distance > 12) break;
          if (j <= index || j < i + 2) continue;
          const chord = Math.hypot(b[0] - a[0], b[1] - a[1]);
          if (distance - chord <= saved || chord < .15) continue;
          const count = Math.ceil(chord / .45);
          let onRoad = true;
          for (let k = 0; k <= count; k++) {
            const x = a[0] + (b[0] - a[0]) * k / count, n = a[1] + (b[1] - a[1]) * k / count;
            if (!mappedCorridor(x, n) || pointInAnyWater(x, n) || pointInAnyBuilding(x, n)) { onRoad = false; break; }
          }
          if (onRoad) { best = [i, j]; saved = distance - chord; }
        }
      }
      if (best) points.splice(best[0] + 1, best[1] - best[0] - 1);
    }
  }
  function route(from, to, { mappedOnly = false } = {}) {
    const requireMapped = mappedOnly || from.type === 'position' || to.type === 'position';
    // B54 的路中心线穿过楼体；B63 的末段穿过 B 座。入口实测前，不用作实地导航起终点。
    if (requireMapped && [from, to].some(({ type, id }) => type === 'building' && (id === 'B54' || id === 'B63'))) return null;
    const A = endpoint(from), B = endpoint(to);
    if (!A || !B) return null;
    // 路网不连通时不绘制跨越障碍物的猜测直线。
    if (state.comp[A.anchor.links[0][0]] !== state.comp[B.anchor.links[0][0]]) return null;
    const pathInfo = shortest(A.anchor, B.anchor, true) || (!requireMapped && shortest(A.anchor, B.anchor, false));
    if (!pathInfo) return null;
    const points = [], seams = [];
    let uncertainRoadMeters = 0;
    const pushPoint = (x, n, bridge) => {
      const p = points[points.length - 1];
      if (!p || Math.hypot(p[0] - x, p[1] - n) > .15) points.push([x, n, bridge ? 1 : 0]);
      else p[2] = bridge ? 1 : 0;
    };
    for (const point of A.access || []) pushPoint(...point, false);
    pushPoint(...A.anchor.point, edgeRoad(A.anchor.road)?.bridge);
    for (let k = 0; k < pathInfo.path.length; k++) {
      const road = edgeRoad(pathInfo.edgeRoads[k] ?? B.anchor.road);
      pushPoint(nodes[pathInfo.path[k]].x, nodes[pathInfo.path[k]].n, road?.bridge);
      if (pathInfo.edgeRoads[k] === -1) {
        const a = nodes[pathInfo.path[k]], b = nodes[pathInfo.path[k + 1]];
        const meters = Math.hypot(a.x - b.x, a.n - b.n);
        if (meters <= 6) seams.push(points.length - 1);
        else uncertainRoadMeters += meters;
      }
    }
    pushPoint(...B.anchor.point, false);
    for (const point of (B.access || []).slice().reverse()) pushPoint(...point, false);
    removeJunctionJogs(points, seams);
    let distance = 0;
    for (let i = 1; i < points.length; i++) distance += Math.hypot(points[i][0] - points[i-1][0], points[i][1] - points[i-1][1]);
    const roads = [];
    for (const ri of [A.anchor.road, ...pathInfo.edgeRoads, B.anchor.road]) {
      const road = edgeRoad(ri);
      if (!road || !road.name || road.name === roads[roads.length - 1]) continue;
      if (!roads.includes(road.name)) roads.push(road.name);
    }
    return {
      points, distance, minutes: Math.max(1, Math.round(distance / 1.25 / 60)), roads, offroad: uncertainRoadMeters,
      approach: B.approach,
      from: A.label, to: B.label
    };
  }
  function edgeRoad(ri) { return ri >= 0 ? data.roads[ri] : null; }
  return { nodes, adj, entries, gates, route, nearestNode, components: state, stats: { nodes: nodes.length, edges: adj.reduce((s, a) => s + a.length, 0) / 2, components: state.sizes.size, mainComponent: state.sizes.get(state.mainComp), seams: seamCount, proximity: proxCount, entries: Object.keys(entries).length, gates: gates.length } };
}

function createCampusNavigation(THREE, data, scene, env) {
  const graph = buildNavigationGraph(data);
  const group = new THREE.Group(); group.name = 'Campus_navigation';
  scene.add(group);
  const flowCanvas = document.createElement('canvas'); flowCanvas.width = 128; flowCanvas.height = 32;
  const flowContext = flowCanvas.getContext('2d');
  flowContext.clearRect(0, 0, 128, 32);
  flowContext.fillStyle = 'rgba(255,244,224,.95)'; flowContext.fillRect(6, 12, 38, 8);
  flowContext.fillStyle = 'rgba(255,255,255,.97)'; flowContext.beginPath(); flowContext.moveTo(100, 5); flowContext.lineTo(121, 16); flowContext.lineTo(100, 27); flowContext.closePath(); flowContext.fill();
  const flowTexture = new THREE.CanvasTexture(flowCanvas);
  flowTexture.wrapS = flowTexture.wrapT = THREE.RepeatWrapping; flowTexture.colorSpace = THREE.SRGBColorSpace;
  const shellMaterial = new THREE.MeshBasicMaterial({ name: 'Route_case', color: 0x2b3330, transparent: true, opacity: .5, depthWrite: false, side: THREE.DoubleSide });
  const ribbonMaterial = new THREE.MeshBasicMaterial({ name: 'Route_orange', color: 0xe2762f, transparent: true, opacity: .95, depthWrite: false, side: THREE.DoubleSide });
  const flowMaterial = new THREE.MeshBasicMaterial({ name: 'Route_flow', map: flowTexture, transparent: true, opacity: .95, depthWrite: false, side: THREE.DoubleSide });
  let meshes = [], route = null, walker = null;
  const ringMaterials = {
    start: new THREE.MeshBasicMaterial({ name: 'Route_start', color: 0x3c8a5e, transparent: true, opacity: .95, side: THREE.DoubleSide }),
    end: new THREE.MeshBasicMaterial({ name: 'Route_end', color: 0xd3542f, transparent: true, opacity: .95, side: THREE.DoubleSide })
  };
  function deckY(p) { return (p[2] ? .25 : env.heightAt(p[0], p[1])) + .2; }
  function ribbonGeometry(points, width) {
    const positions = [], uvs = [], indices = [];
    let cum = 0;
    for (let i = 0; i < points.length; i++) {
      const p = points[i], prev = points[i - 1] || p, next = points[i + 1] || p;
      const ax = p[0] - prev[0], an = p[1] - prev[1], bx = next[0] - p[0], bn = next[1] - p[1];
      const la = Math.hypot(ax, an) || 1, lb = Math.hypot(bx, bn) || 1;
      let nx = -(an / la + bn / lb), nn = ax / la + bx / lb;
      const nl = Math.hypot(nx, nn) || 1; nx /= nl; nn /= nl;
      const scale = Math.min(1.8, 1 / Math.max(.45, Math.abs(nx * (-an / la) + nn * (ax / la))));
      if (i > 0) cum += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
      const y = deckY(p), w = width / 2 * scale;
      positions.push(p[0] + nx * w, y, -(p[1] + nn * w), p[0] - nx * w, y, -(p[1] - nn * w));
      uvs.push(cum / 8, 0, cum / 8, 1);
      if (i > 0) { const k = (i - 1) * 2; indices.push(k, k + 1, k + 3, k, k + 3, k + 2); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(indices);
    return g;
  }
  function marker(point, material, radius) {
    const g = new THREE.Group();
    const y = (env.heightAt(point[0], point[1])) + .42;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, .3, 8, 40), material);
    ring.rotation.x = -Math.PI / 2; ring.position.set(point[0], y, -point[1]); g.add(ring);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(.18, .18, 6.5, 8, 1, true), new THREE.MeshBasicMaterial({ color: material.color, transparent: true, opacity: .32, depthWrite: false, side: THREE.DoubleSide }));
    beam.position.set(point[0], y + 3.2, -point[1]); g.add(beam);
    return g;
  }
  function clear() {
    for (const m of meshes) { group.remove(m); m.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }
    meshes = []; route = null; walker = null;
  }
  function show(result, { street = false } = {}) {
    clear();
    if (!result || result.points.length < 2) return null;
    flowTexture.offset.x = 0;
    const shell = new THREE.Mesh(ribbonGeometry(result.points, street ? .86 : 3.1), shellMaterial);
    shell.position.y = .06; shell.renderOrder = 3; group.add(shell);
    const ribbon = new THREE.Mesh(ribbonGeometry(result.points, street ? .65 : 2.35), ribbonMaterial);
    ribbon.position.y = .1; ribbon.renderOrder = 4; group.add(ribbon);
    const flow = new THREE.Mesh(ribbonGeometry(result.points, street ? .48 : 1.15), flowMaterial);
    flow.position.y = .13; flow.renderOrder = 5; group.add(flow);
    const start = marker(result.points[0], ringMaterials.start, 2.6);
    const end = marker(result.points[result.points.length - 1], ringMaterials.end, 2.6);
    group.add(start, end);
    walker = new THREE.Mesh(new THREE.SphereGeometry(.95, 14, 10), new THREE.MeshBasicMaterial({ color: 0xffd9a8 }));
    walker.renderOrder = 6; group.add(walker);
    if (street) { start.visible = false; walker.visible = false; }
    meshes = [shell, ribbon, flow, start, end, walker];
    route = result;
    return result;
  }
  function update(time) {
    if (!route) return;
    flowTexture.offset.x = -((time * .0016) % 1);
    const end = meshes[4];
    if (end) { const s = 1 + Math.sin(time * .004) * .09; end.scale.setScalar(s); }
    if (walker && route.points.length > 1) {
      let total = 0; const cum = [0];
      for (let i = 1; i < route.points.length; i++) { total += Math.hypot(route.points[i][0] - route.points[i-1][0], route.points[i][1] - route.points[i-1][1]); cum.push(total); }
      const target = ((time * .012) % Math.max(total, 1));
      let i = 1; while (i < cum.length - 1 && cum[i] < target) i++;
      const t = (target - cum[i-1]) / ((cum[i] - cum[i-1]) || 1), p = route.points[i-1], q = route.points[i];
      walker.position.set(p[0] + (q[0] - p[0]) * t, deckY(p) + .9, -(p[1] + (q[1] - p[1]) * t));
    }
  }
  return { graph, show, clear, update, active: () => !!route, route: () => route };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { buildNavigationGraph, createCampusNavigation };
else window.createCampusNavigation = createCampusNavigation;
