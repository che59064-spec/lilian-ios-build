function createCampusLocation(onUpdate) {
  const maxAccuracy = 25;
  const maxFixAge = 20_000;
  let state = { status: 'idle', point: null, routePoint: null, progress: null, accuracy: null, distanceFromRoute: null };
  let geolocation;
  let watchId = null;
  let generation = 0;
  let staleTimer;
  let segments = [];
  let lastFix = null;
  let lastMatch = null;

  function publish(status, values = {}) {
    state = { status, point: null, routePoint: null, progress: null, accuracy: null, distanceFromRoute: null, ...values };
    onUpdate(state);
  }

  function projectToRoute(fix) {
    const { point, accuracy, timestamp } = fix;
    const tolerance = Math.max(12, accuracy + 7);
    const elapsed = lastMatch ? Math.max(0, timestamp - lastMatch.timestamp) / 1000 : 0;
    const reach = Math.max(14, accuracy + 3) + 4 * elapsed;
    let closest = Infinity;
    let best = null;

    for (const segment of segments) {
      const { x, north, dx, dn, length, start } = segment;
      const offset = ((point[0] - x) * dx + (point[1] - north) * dn) / (length * length);
      const fraction = Math.max(0, Math.min(1, offset));
      const routePoint = [x + dx * fraction, north + dn * fraction];
      const distance = Math.hypot(point[0] - routePoint[0], point[1] - routePoint[1]);
      closest = Math.min(closest, distance);
      const progress = start + length * fraction;
      const change = lastMatch ? Math.abs(progress - lastMatch.progress) : 0;
      // At a crossing, favor the section reachable from the last accepted fix.
      if (distance > tolerance || change > reach) continue;
      const score = distance + (lastMatch ? change * .18 : 0);
      if (!best || score < best.score) best = { routePoint, progress, distance, score };
    }

    if (!best) {
      publish('offroute', { point, accuracy, distanceFromRoute: closest });
      return;
    }
    const change = lastMatch ? best.progress - lastMatch.progress : Infinity;
    const jitter = Math.max(2, Math.min(6, accuracy * .45));
    const reverseThreshold = lastMatch?.backtracking ? jitter : Math.max(8, accuracy * 1.25);
    const backtracking = change < -reverseThreshold;
    if (change >= jitter) {
      lastMatch = { progress: best.progress, routePoint: best.routePoint, timestamp, backtracking: false };
    } else {
      // Hold the last confirmed position through GPS wobble and real backtracking.
      lastMatch.backtracking = backtracking;
      if (!backtracking) lastMatch.timestamp = timestamp;
    }
    publish(backtracking ? 'backtracking' : 'tracking', {
      point, accuracy, routePoint: lastMatch.routePoint, progress: lastMatch.progress, distanceFromRoute: best.distance
    });
  }

  function publishFix() {
    if (!lastFix || Date.now() - lastFix.timestamp > maxFixAge) return;
    if (segments.length) projectToRoute(lastFix);
    else publish('ready', { point: lastFix.point, accuracy: lastFix.accuracy });
  }

  function setRoute(route) {
    const points = route?.points ?? [];
    const next = [];
    let start = 0;
    for (let i = 1; i < points.length; i++) {
      const [x, north] = points[i - 1];
      const dx = points[i][0] - x, dn = points[i][1] - north;
      const length = Math.hypot(dx, dn);
      if (!Number.isFinite(length) || length === 0) continue;
      next.push({ x, north, dx, dn, length, start });
      start += length;
    }
    segments = next;
    lastMatch = null;
    publishFix();
    return segments.length > 0;
  }

  function clearPositionWatch() {
    generation++;
    clearTimeout(staleTimer);
    if (watchId !== null) geolocation.clearWatch(watchId);
    watchId = null;
    lastFix = null;
    lastMatch = null;
    segments = [];
  }

  function start(route = null) {
    clearPositionWatch();
    if (globalThis.isSecureContext === false) {
      publish('insecure');
      return false;
    }
    geolocation = globalThis.navigator?.geolocation;
    if (!geolocation) {
      publish('unsupported');
      return false;
    }
    const session = generation;
    setRoute(route);
    publish('locating');
    if (session !== generation) return false;
    try {
      const id = geolocation.watchPosition(position => {
        if (session !== generation) return;
        const { longitude, latitude, accuracy } = position.coords;
        const { timestamp } = position;
        if (lastFix && timestamp < lastFix.timestamp) return;
        clearTimeout(staleTimer);
        lastFix = null;
        if (![longitude, latitude, accuracy].every(Number.isFinite) || accuracy < 0 || accuracy > maxAccuracy) {
          publish('inaccurate', { accuracy: Number.isFinite(accuracy) ? accuracy : null });
          return;
        }
        const age = Date.now() - timestamp;
        if (!Number.isFinite(age) || age > maxFixAge || age < -5000) {
          publish('stale', { accuracy });
          return;
        }
        // Keep this WGS84 projection in sync with ll() in gen_refined.js.
        lastFix = { point: [(longitude - 113.0216) * 102400, (latitude - 23.14195) * 110950], accuracy, timestamp };
        staleTimer = setTimeout(() => {
          if (session !== generation) return;
          lastFix = null;
          publish('stale', { accuracy });
        }, maxFixAge - age);
        publishFix();
      }, error => {
        if (session !== generation) return;
        if (error.code === 1) clearPositionWatch();
        else {
          clearTimeout(staleTimer);
          lastFix = null;
        }
        publish(error.code === 1 ? 'denied' : error.code === 3 ? 'timeout' : 'unavailable');
      }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 15_000 });
      if (session !== generation) {
        geolocation.clearWatch(id);
        return false;
      }
      watchId = id;
      return true;
    } catch (error) {
      clearPositionWatch();
      publish(error.name === 'SecurityError' ? 'denied' : 'unavailable');
      return false;
    }
  }

  function stop() {
    clearPositionWatch();
    publish('idle');
  }

  return { start, stop, setRoute, getState: () => state };
}

if (typeof module !== 'undefined' && module.exports) module.exports = createCampusLocation;
