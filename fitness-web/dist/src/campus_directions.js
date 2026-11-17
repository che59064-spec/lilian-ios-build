function createCampusDirections(points) {
  const route = [];
  let totalMeters = 0;
  for (const [x, north] of points) {
    const previous = route[route.length - 1];
    const length = previous ? Math.hypot(x - previous.x, north - previous.north) : 0;
    if (previous && length < 1e-6) continue;
    totalMeters += length;
    route.push({ x, north, meters: totalMeters });
  }

  // Simplify the route for turn detection only. Distances still use the original route.
  function simplify(first, last, corners) {
    const a = route[first], b = route[last];
    const dx = b.x - a.x, dn = b.north - a.north;
    const lengthSquared = dx * dx + dn * dn;
    let farthest = -1;
    let toleranceSquared = 2 ** 2;
    for (let i = first + 1; i < last; i++) {
      const px = route[i].x - a.x, pn = route[i].north - a.north;
      const fraction = lengthSquared ? Math.max(0, Math.min(1, (px * dx + pn * dn) / lengthSquared)) : 0;
      const distanceSquared = (px - dx * fraction) ** 2 + (pn - dn * fraction) ** 2;
      if (distanceSquared > toleranceSquared) {
        farthest = i;
        toleranceSquared = distanceSquared;
      }
    }
    if (farthest !== -1) {
      simplify(first, farthest, corners);
      simplify(farthest, last, corners);
    } else {
      corners.push(last);
    }
  }

  const corners = [0];
  if (route.length > 1) simplify(0, route.length - 1, corners);
  const turns = [];
  for (let i = 1; i < corners.length - 1; i++) {
    const a = route[corners[i - 1]], b = route[corners[i]], c = route[corners[i + 1]];
    if (b.meters < 5 || totalMeters - b.meters < 4) continue;
    const eastIn = b.x - a.x, northIn = b.north - a.north;
    const eastOut = c.x - b.x, northOut = c.north - b.north;
    const angle = Math.atan2(eastIn * northOut - northIn * eastOut, eastIn * eastOut + northIn * northOut);
    const strength = Math.abs(angle);
    if (strength < Math.PI / 6) continue;
    const kind = strength >= 5 * Math.PI / 6 ? 'uturn' : angle > 0 ? 'left' : 'right';
    const previous = turns[turns.length - 1];
    const gap = previous ? b.meters - previous.meters : Infinity;
    // Short, opposing bends can be artifacts of joining two mapped paths.
    if (gap < 6 && Math.abs(previous.angle + angle) < Math.PI / 6) {
      turns.pop();
    } else if (previous?.kind === kind && gap < 8) {
      if (strength > Math.abs(previous.angle)) Object.assign(previous, { meters: b.meters, angle });
    } else {
      turns.push({ kind, meters: b.meters, angle });
    }
  }

  const names = { left: '前方左转', right: '前方右转', uturn: '前方掉头' };
  function at(progressMeters) {
    const progress = Math.max(0, Math.min(totalMeters, Number(progressMeters) || 0));
    if (progress >= totalMeters) {
      return { kind: 'arrive', text: '已到达目的地', meters: 0, nextMeters: totalMeters };
    }
    const turn = turns.find(maneuver => maneuver.meters > progress);
    const nextMeters = turn?.meters ?? totalMeters;
    const meters = nextMeters - progress;
    if (turn && meters <= 70) return { kind: turn.kind, text: names[turn.kind], meters, nextMeters };
    return { kind: 'straight', text: turn ? '继续直行' : '沿路线前往目的地', meters, nextMeters };
  }

  return { at, totalMeters };
}

if (typeof module !== 'undefined' && module.exports) module.exports = createCampusDirections;
