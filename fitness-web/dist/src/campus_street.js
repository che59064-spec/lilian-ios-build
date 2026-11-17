function createCampusStreet(THREE, env, aspect) {
  const camera = new THREE.PerspectiveCamera(58, 1, .08, 3400);
  const speed = 4;
  const eyeHeight = 1.65;
  let points = [];
  let lengths = [];
  let total = 0;
  let traveled = 0;
  let paused = false;
  let lastFrame = null;

  function resize(nextAspect) {
    if (!Number.isFinite(nextAspect) || nextAspect <= 0) return;
    camera.aspect = nextAspect;
    camera.fov = 58 + 16 * Math.max(0, 1 - nextAspect);
    camera.updateProjectionMatrix();
  }

  function sample(distance) {
    const meters = THREE.MathUtils.clamp(distance, 0, total);
    let low = 0;
    let high = points.length - 1;
    while (high - low > 1) {
      const mid = (low + high) >>> 1;
      if (meters < lengths[mid]) high = mid;
      else low = mid;
    }
    const a = points[low];
    const b = points[high];
    const fraction = (meters - lengths[low]) / (lengths[high] - lengths[low]);
    return {
      x: THREE.MathUtils.lerp(a[0], b[0], fraction),
      north: THREE.MathUtils.lerp(a[1], b[1], fraction),
      bridge: Boolean(a[2]),
      segment: low
    };
  }

  function placeCamera() {
    const position = sample(traveled);
    const before = sample(traveled - 1.5);
    const ahead = sample(traveled + 4);
    // A short chord eases the heading into a bend while the camera stays on the route.
    let east = ahead.x - before.x;
    let north = ahead.north - before.north;
    if (Math.hypot(east, north) < .1) {
      const [a, b] = [points[position.segment], points[position.segment + 1]];
      east = b[0] - a[0];
      north = b[1] - a[1];
    }
    const ground = position.bridge ? .25 : env.heightAt(position.x, position.north);
    camera.position.set(position.x, ground + eyeHeight + .12, -position.north);
    camera.lookAt(position.x + east, camera.position.y - Math.hypot(east, north) * .055, -position.north - north);
    camera.updateMatrixWorld();
  }

  function start(route) {
    if (!Array.isArray(route?.points)) return false;
    const routePoints = [];
    const routeLengths = [0];
    for (const point of route.points) {
      if (!point || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) return false;
      const previous = routePoints.at(-1);
      if (previous) {
        const length = Math.hypot(point[0] - previous[0], point[1] - previous[1]);
        if (!length) {
          routePoints[routePoints.length - 1] = point;
          continue;
        }
        routeLengths.push(routeLengths.at(-1) + length);
      }
      routePoints.push(point);
    }
    if (routePoints.length < 2 || !Number.isFinite(routeLengths.at(-1))) return false;
    points = routePoints;
    lengths = routeLengths;
    total = lengths.at(-1);
    traveled = 0;
    paused = false;
    lastFrame = null;
    placeCamera();
    return true;
  }

  function update(timestamp) {
    if (!points.length || paused || traveled >= total || !Number.isFinite(timestamp)) return false;
    const elapsed = lastFrame === null ? 0 : (timestamp - lastFrame) / 1000;
    lastFrame = timestamp;
    if (elapsed <= 0) return false;
    // Cap jumps when a device is slow or the tab returns from the background.
    traveled = Math.min(total, traveled + Math.min(elapsed, .25) * speed);
    placeCamera();
    return true;
  }

  function stop() {
    points = [];
    lengths = [];
    total = 0;
    traveled = 0;
    paused = false;
    lastFrame = null;
  }

  function togglePause() {
    if (!points.length) return;
    if (traveled >= total) {
      traveled = 0;
      paused = false;
      placeCamera();
    } else {
      paused = !paused;
    }
    lastFrame = null;
  }

  function step(meters) {
    if (!points.length || !Number.isFinite(meters)) return false;
    traveled = THREE.MathUtils.clamp(traveled + meters, 0, total);
    paused = true;
    lastFrame = null;
    placeCamera();
    return true;
  }

  function getState() {
    const active = points.length > 0;
    return {
      active, paused, complete: active && traveled >= total,
      traveled, remaining: total - traveled, total,
      progress: active ? traveled / total : 0
    };
  }

  resize(aspect);
  return { camera, resize, start, update, stop, togglePause, step, getState };
}

if (typeof module !== 'undefined' && module.exports) module.exports = createCampusStreet;
