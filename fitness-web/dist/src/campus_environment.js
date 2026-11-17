function createCampusEnvironment(THREE, data, assets = {}) {
  const root = new THREE.Group(); root.name = 'Campus_environment';
  root.userData.evidence = '卫星植被分布和OSM湖岸；丘陵形态与高程为照片辅助近似，非DEM测绘';
  const waterGroup = new THREE.Group(); waterGroup.name = 'Lakes_and_shorelines';
  const roadsGroup = new THREE.Group(); roadsGroup.name = 'Campus_roads';
  const treesGroup = new THREE.Group(); treesGroup.name = 'Satellite_guided_trees';
  root.add(waterGroup, roadsGroup, treesGroup);
  const xmin = -780, xmax = 780, nmin = -760, nmax = 740, step = 8;
  const cols = Math.ceil((xmax - xmin) / step), rows = Math.ceil((nmax - nmin) / step);
  const dx = (xmax - xmin) / cols, dn = (nmax - nmin) / rows;
  const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  function inside(x, n, ring) {
    let hit = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i], b = ring[j];
      if ((a[1] > n) !== (b[1] > n) && x < (b[0] - a[0]) * (n - a[1]) / (b[1] - a[1]) + a[0]) hit = !hit;
    }
    return hit;
  }
  function segmentDistance(x, n, a, b) {
    const vx = b[0] - a[0], vn = b[1] - a[1], length2 = vx * vx + vn * vn;
    const t = length2 ? Math.max(0, Math.min(1, ((x - a[0]) * vx + (n - a[1]) * vn) / length2)) : 0;
    return Math.hypot(x - a[0] - t * vx, n - a[1] - t * vn);
  }
  function ringDistance(x, n, ring) {
    let distance = Infinity;
    for (let i = 0; i < ring.length; i++) distance = Math.min(distance, segmentDistance(x, n, ring[i], ring[(i + 1) % ring.length]));
    return inside(x, n, ring) ? -distance : distance;
  }
  function index(items, margin, points) {
    const cells = new Map(), size = 64;
    for (const item of items) {
      const ps = points(item), xs = ps.map(p => p[0]), ns = ps.map(p => p[1]);
      const x0 = Math.floor((Math.min(...xs) - margin) / size), x1 = Math.floor((Math.max(...xs) + margin) / size);
      const n0 = Math.floor((Math.min(...ns) - margin) / size), n1 = Math.floor((Math.max(...ns) + margin) / size);
      for (let i = x0; i <= x1; i++) for (let j = n0; j <= n1; j++) {
        const key = i + ',' + j;
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(item);
      }
    }
    return (x, n) => cells.get(Math.floor(x / size) + ',' + Math.floor(n / size)) || [];
  }
  function clip(ring) {
    let result = ring.slice();
    for (const [axis, bound, sign] of [[0, xmin, 1], [0, xmax, -1], [1, nmin, 1], [1, nmax, -1]]) {
      const source = result; result = [];
      for (let i = 0; i < source.length; i++) {
        const a = source[i], b = source[(i + 1) % source.length], ai = (a[axis] - bound) * sign >= 0, bi = (b[axis] - bound) * sign >= 0;
        if (ai) result.push(a);
        if (ai !== bi) { const t = (bound - a[axis]) / (b[axis] - a[axis]); result.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
      }
    }
    return result.filter((p, i) => i === 0 || Math.hypot(p[0] - result[i - 1][0], p[1] - result[i - 1][1]) > .01).filter((p, i, r) => i !== r.length - 1 || Math.hypot(p[0] - r[0][0], p[1] - r[0][1]) > .01);
  }
  const waters = data.water.map(clip).filter(r => r.length >= 3);
  const footprints = data.buildings.flatMap(b => b.parts || [b.r]);
  const buildingIndex = index(footprints, 40, r => r), waterIndex = index(waters, 25, r => r);
  const roadSegments = data.roads.flatMap((r, ri) => r.points.slice(1).map((p, i) => ({ a: r.points[i], b: p, width: r.width, bridge: r.bridge, kind: r.kind, ri })));
  const roadIndex = index(roadSegments, 38, s => [s.a, s.b]);
  function junctionDistance(x, n, self) {
    let d = Infinity;
    for (const s of roadIndex(x, n)) if (s.ri !== self && s.width >= 4) d = Math.min(d, segmentDistance(x, n, s.a, s.b) - s.width / 2);
    return d;
  }
  function buildingDistance(x, n) {
    let d = Infinity;
    for (const r of buildingIndex(x, n)) d = Math.min(d, ringDistance(x, n, r));
    return d;
  }
  function waterDistance(x, n) {
    let d = Infinity;
    for (const r of waterIndex(x, n)) d = Math.min(d, ringDistance(x, n, r));
    return d;
  }
  function roadDistance(x, n) {
    let d = Infinity;
    for (const s of roadIndex(x, n)) d = Math.min(d, segmentDistance(x, n, s.a, s.b) - s.width / 2);
    return d;
  }
  function sportDistance(x, n) {
    const sp = data.sport, px = x - sp.x, pn = n - sp.n;
    const u = px * sp.ux + pn * sp.un, v = -px * sp.un + pn * sp.ux;
    return Math.hypot(Math.max(0, Math.abs(u) - sp.straight / 2), v) - sp.radius - 9;
  }
  function ground(x, n) {
    let h = 0;
    for (const hill of data.hills) {
      const r2 = ((x - hill.x) / hill.rx) ** 2 + ((n - hill.n) / hill.rn) ** 2;
      if (r2 < 9) h += hill.h * Math.exp(-r2 * 1.7);
    }
    h *= 1 + .045 * Math.sin(x * .038 + n * .016) + .035 * Math.cos(n * .047 - x * .02);
    const plateau = Math.min(smooth(7, 36, buildingDistance(x, n)), smooth(5, 28, roadDistance(x, n)), smooth(6, 30, sportDistance(x, n)));
    h = h * plateau * smooth(0, 65, Math.min(x - xmin, xmax - x, n - nmin, nmax - n)) - .12;
    const water = waterDistance(x, n);
    if (water < 0) return -1.4 - smooth(0, 14, -water) * 1.2;
    if (water < 17) h = -1.4 + (h + 1.4) * smooth(4, 17, water);
    return h;
  }
  const heights = new Float32Array((cols + 1) * (rows + 1));
  const positions = new Float32Array(heights.length * 3), colors = new Float32Array(heights.length * 3), indices = [];
  const color = new THREE.Color();
  for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) {
    const k = j * (cols + 1) + i, x = xmin + i * dx, n = nmin + j * dn, h = ground(x, n);
    heights[k] = h; positions.set([x, h, -n], k * 3);
    const variation = Math.sin(x * .027 + n * .017) * .018 + Math.cos(n * .056 - x * .02) * .009;
    color.setHSL(.225 + variation * .6, .23 + Math.min(Math.max(h, 0) / 400, .1), .43 + variation - Math.min(Math.max(h, 0) / 1100, .04));
    color.multiplyScalar(.68).toArray(colors, k * 3);
    if (i < cols && j < rows) { const a = k, b = k + 1, c = k + cols + 1, d = c + 1; indices.push(a, b, d, a, d, c); }
  }
  function heightAt(x, n) {
    const u = Math.max(0, Math.min(cols - .000001, (x - xmin) / dx)), v = Math.max(0, Math.min(rows - .000001, (n - nmin) / dn));
    const i = Math.floor(u), j = Math.floor(v), a = j * (cols + 1) + i, fu = u - i, fv = v - j;
    const h0 = heights[a], h1 = heights[a + 1], h2 = heights[a + cols + 1], h3 = heights[a + cols + 2];
    return fu >= fv ? h0 + (h1 - h0) * fu + (h3 - h1) * fv : h0 + (h3 - h2) * fu + (h2 - h0) * fv;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3)); geo.setAttribute('color', new THREE.BufferAttribute(colors, 3)); geo.setIndex(indices); geo.computeVertexNormals();
  const terrain = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ name: 'Grass_terrain', color: 0xffffff, vertexColors: true, roughness: 1 }));
  terrain.name = 'Photo_inferred_hills_not_surveyed'; terrain.receiveShadow = true; terrain.castShadow = true; root.add(terrain);
  const contact = typeof document !== 'undefined' ? new THREE.CanvasTexture(document.createElement('canvas')) : null;
  if (contact) {
    const grass = assets.grass ? new THREE.TextureLoader().load(assets.grass) : null;
    if (grass) {
      grass.wrapS = grass.wrapT = THREE.RepeatWrapping;
      grass.colorSpace = THREE.SRGBColorSpace;
      grass.anisotropy = 8;
    }
    terrain.material.extensions = { ...(terrain.material.extensions || {}), derivatives: true };
    // Replace the water color baked into the aerial photo with an inferred lake bed.
    terrain.material.onBeforeCompile = shader => {
      shader.uniforms.turfPhoto = { value: grass };
      shader.uniforms.groundContact = { value: contact };
      shader.uniforms.groundBounds = { value: new THREE.Vector4(xmin,nmin,1/(xmax-xmin),1/(nmax-nmin)) };
      shader.vertexShader = 'varying vec3 vLakeBedPosition;\n' + shader.vertexShader.replace('#include <begin_vertex>', `
        #include <begin_vertex>
        vLakeBedPosition = position;
      `);
      shader.fragmentShader = `varying vec3 vLakeBedPosition;
        uniform sampler2D turfPhoto;
        uniform sampler2D groundContact;
        uniform vec4 groundBounds;
        float turfSeed(vec2 p) {return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
        float turfNoise(vec2 p) {
          vec2 cell=floor(p), f=fract(p);
          f=f*f*(3.0-2.0*f);
          return mix(mix(turfSeed(cell),turfSeed(cell+vec2(1.,0.)),f.x),
            mix(turfSeed(cell+vec2(0.,1.)),turfSeed(cell+vec2(1.,1.)),f.x),f.y);
        }
      ` + shader.fragmentShader.replace('#include <color_fragment>', `
        #include <color_fragment>
        float lakeBed = smoothstep(0.01, 0.38, -1.0 - vLakeBedPosition.y);
        vec2 bed = vLakeBedPosition.xz;
        float broadPattern = sin(bed.x * 0.31 + sin(bed.y * 0.24)) * cos(bed.y * 0.29 - bed.x * 0.08);
        float finePattern = sin(bed.x * 3.7 + bed.y * 2.6) * sin(bed.y * 4.0 - bed.x * 3.1);
        vec3 sediment = vec3(0.32, 0.29, 0.20) * (1.0 + 0.12 * broadPattern + 0.03 * finePattern);
        diffuseColor.rgb = mix(diffuseColor.rgb, sediment, lakeBed * 0.94);
      `);
      // Keep the aerial image for placement, but add metre-scale lawn detail in close views.
      // Fade the small grains when a pixel covers them to avoid shimmering at map scale.
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
        #include <map_fragment>
        vec2 turf = vLakeBedPosition.xz;
        float land = smoothstep(-1.1, -0.65, vLakeBedPosition.y);
        float greenness = (diffuseColor.g - (diffuseColor.r + diffuseColor.b) * .5) / max(.18,diffuseColor.g);
        float green = smoothstep(-.06,.23,greenness);
        // On the irregular fringe, blend from exposed wet soil into lawn above the lake.
        float fringe = smoothstep(-1.23,-.91,vLakeBedPosition.y) * (1.0-smoothstep(-.72,-.30,vLakeBedPosition.y));
        green = max(green,fringe*.97);
        vec2 turfWidth = fwidth(turf);
        float footprint = max(turfWidth.x, turfWidth.y);
        float clumps = mix(turfNoise(turf*.54),turfNoise(turf*1.9+14.2),.36)-.5;
        vec3 lawn = mix(diffuseColor.rgb, vec3(.105,.186,.069), .28+.17*fringe);
        lawn *= 1.0 + 0.28 * clumps;
        lawn += clumps * vec3(.018,.010,-.015);
        ${grass ? `
          // The 2 m photograph brings out individual blades nearby. Its detail fades at map scale.
          vec3 photo = texture2D(turfPhoto,turf*.5).rgb;
          vec3 photoTurned = texture2D(turfPhoto,mat2(.8,.6,-.6,.8)*turf*.5+.17).rgb;
          photo = mix(photo,photoTurned,smoothstep(.19,.87,turfNoise(turf*.16)));
          float photoContrast = dot(photo,vec3(.2126,.7152,.0722));
          float close = 1.0-smoothstep(.07,.38,footprint);
          vec3 blades = lawn * (.60 + photoContrast*4.3);
          blades = mix(blades,photo*vec3(.71,1.12,.65),.25);
          lawn = mix(lawn,blades,close*.86);
        ` : ''}
        lawn = mix(lawn,lawn*vec3(.81,1.07,.78),fringe*.56);
        diffuseColor.rgb = mix(diffuseColor.rgb, lawn, green * land);
      `);
      if (grass) shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `
        #include <normal_fragment_maps>
        float relief = photoContrast * .045 * green * land * close;
        vec3 dx = dFdx(-vViewPosition), dy = dFdy(-vViewPosition);
        vec3 tx = cross(dy,normal), ty = cross(normal,dx);
        float det = dot(dx,tx);
        vec3 slope = sign(det) * (dFdx(relief)*tx + dFdy(relief)*ty);
        normal = normalize(max(abs(det),.00001)*normal - slope);
      `);
      shader.fragmentShader = shader.fragmentShader.replace('#include <aomap_fragment>', `
        #include <aomap_fragment>
        vec2 groundUV = (vec2(vLakeBedPosition.x,-vLakeBedPosition.z)-groundBounds.xy)*groundBounds.zw;
        float contactLight = texture2D(groundContact,groundUV).r;
        reflectedLight.indirectDiffuse *= mix(1.0,contactLight,land*.94);
      `);
    };
  }
  if (typeof document !== 'undefined' && assets.ground) {
    const uv = new Float32Array(heights.length * 2);
    for (let i = 0; i < heights.length; i++) {
      uv[i * 2] = (positions[i * 3] - xmin) / (xmax - xmin);
      uv[i * 2 + 1] = (-positions[i * 3 + 2] - nmin) / (nmax - nmin);
    }
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    const texture = new THREE.TextureLoader().load(assets.ground, () => {
      terrain.material.map = texture;
      terrain.material.vertexColors = false;
      terrain.material.needsUpdate = true;

    });
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
  } else if (typeof document !== 'undefined') {
    const uv = new Float32Array(heights.length * 2);
    for (let i = 0; i < heights.length; i++) { uv[i * 2] = positions[i * 3] / 32; uv[i * 2 + 1] = positions[i * 3 + 2] / 32; }
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d'), pixels = ctx.createImageData(128, 128); let seed = 7451;
    for (let i = 0; i < 128 * 128; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const v = 230 + Math.floor(seed / 4294967296 * 20);
      pixels.data.set([v, v, v, 255], i * 4);
    }
    ctx.putImageData(pixels, 0, 0);
    const texture = new THREE.CanvasTexture(canvas); texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.colorSpace = THREE.SRGBColorSpace;
    terrain.material.map = texture; terrain.material.needsUpdate = true;
  }
  function meshFrom(name, points, material, parent, uvs) {
    if (!points.length) return;
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    if (uvs && uvs.length === points.length / 3 * 2) g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, material); mesh.name = name; mesh.receiveShadow = true; parent.add(mesh); return mesh;
  }
  const skirt = [], edge = [];
  for (let i = 0; i <= cols; i++) edge.push([xmin + i * dx, nmin]);
  for (let j = 1; j <= rows; j++) edge.push([xmax, nmin + j * dn]);
  for (let i = cols - 1; i >= 0; i--) edge.push([xmin + i * dx, nmax]);
  for (let j = rows - 1; j >= 1; j--) edge.push([xmin, nmin + j * dn]);
  for (let i = 0; i < edge.length; i++) {
    const a = edge[i], b = edge[(i + 1) % edge.length], p = [a[0], heightAt(...a), -a[1]], q = [b[0], heightAt(...b), -b[1]], r = [b[0], -9, -b[1]], s = [a[0], -9, -a[1]];
    skirt.push(...p, ...q, ...r, ...p, ...r, ...s);
  }
  meshFrom('Terrain_edge', skirt, new THREE.MeshStandardMaterial({ name: 'Earth_edge', color: 0x89927a, roughness: 1, side: THREE.DoubleSide }), root);
  const waterMaterial = new THREE.MeshStandardMaterial({ name: 'Jade_lake_water', color: 0x668782, roughness: .57, metalness: 0, side: THREE.DoubleSide });
  // Tileable, multi-scale value noise creates subdued irregular ripples without a heavy water shader.
  if (typeof document !== 'undefined') {
    const size = 256, heights = new Float32Array(size * size);
    let waterSeed = 41173;
    const rand = () => { waterSeed = (Math.imul(waterSeed, 1664525) + 1013904223) >>> 0; return waterSeed / 4294967296; };
    for (const [cells, amplitude] of [[4, .48], [9, .28], [19, .15], [37, .09]]) {
      const values = Array.from({length: cells * cells}, rand);
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const px = x * cells / size, py = y * cells / size, ix = Math.floor(px), iy = Math.floor(py);
        const fx = px - ix, fy = py - iy, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
        const at = (a, b) => values[((b + cells) % cells) * cells + (a + cells) % cells];
        const a = at(ix, iy) * (1 - u) + at(ix + 1, iy) * u;
        const b = at(ix, iy + 1) * (1 - u) + at(ix + 1, iy + 1) * u;
        heights[y * size + x] += (a * (1 - v) + b * v) * amplitude;
      }
    }
    const colorCanvas = document.createElement('canvas'), normalCanvas = document.createElement('canvas');
    colorCanvas.width = colorCanvas.height = normalCanvas.width = normalCanvas.height = size;
    const cc = colorCanvas.getContext('2d'), nc = normalCanvas.getContext('2d');
    const colors = cc.createImageData(size, size), normals = nc.createImageData(size, size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const i = y * size + x, o = i * 4, h = heights[i];
      const dx = heights[y * size + (x + 1) % size] - heights[y * size + (x + size - 1) % size];
      const dy = heights[((y + 1) % size) * size + x] - heights[((y + size - 1) % size) * size + x];
      const c = Math.round(236 + (h - .5) * 10);
      colors.data.set([c, c + 2, c, 255], o);
      normals.data.set([128 - dx * 115, 128 - dy * 115, 255, 255], o);
    }
    cc.putImageData(colors, 0, 0); nc.putImageData(normals, 0, 0);
    const map = new THREE.CanvasTexture(colorCanvas), normal = new THREE.CanvasTexture(normalCanvas);
    for (const t of [map, normal]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
    map.colorSpace = THREE.SRGBColorSpace;
    waterMaterial.map = map; waterMaterial.normalMap = normal; waterMaterial.normalScale.set(.36, .36);
  }
  const bankMaterial = new THREE.MeshStandardMaterial({ name: 'Soft_earthen_lake_bank', color: 0x858f78, roughness: 1, side: THREE.DoubleSide, vertexColors: true, transparent: true, depthWrite: false });
  const bankPoints = [], bankColors = [];
  waters.forEach((r, index) => {
    const shape = new THREE.Shape(r.map(p => new THREE.Vector2(...p))); shape.closePath();
    const g = new THREE.ShapeGeometry(shape); g.rotateX(-Math.PI / 2); g.translate(0, -1, 0);
    const uv = g.attributes.uv, pos = g.attributes.position;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / 70, pos.getZ(i) / 70);
    uv.needsUpdate = true;
    const water = new THREE.Mesh(g, waterMaterial); water.name = 'Lake_' + (index + 1); water.receiveShadow = true; waterGroup.add(water);
    let area = 0; r.forEach((a, i) => { const b = r[(i + 1) % r.length]; area += a[0] * b[1] - b[0] * a[1]; });
    const sign = area > 0 ? 1 : -1;
    const outer = r.map((p, i) => {
      const a = r[(i + r.length - 1) % r.length], b = r[(i + 1) % r.length];
      const l1 = Math.hypot(p[0] - a[0], p[1] - a[1]) || 1, l2 = Math.hypot(b[0] - p[0], b[1] - p[1]) || 1;
      const nx1 = sign * (p[1] - a[1]) / l1, nn1 = -sign * (p[0] - a[0]) / l1;
      const nx2 = sign * (b[1] - p[1]) / l2, nn2 = -sign * (b[0] - p[0]) / l2;
      const length = Math.hypot(nx1 + nx2, nn1 + nn2) || 1, nx = (nx1 + nx2) / length, nn = (nn1 + nn2) / length;
      const width = 4.2 / Math.max(.65, nx * nx1 + nn * nn1);
      return [Math.max(xmin, Math.min(xmax, p[0] + nx * width)), Math.max(nmin, Math.min(nmax, p[1] + nn * width))];
    });
    r.forEach((a, i) => {
      const j = (i + 1) % r.length, b = r[j], c = outer[j], d = outer[i];
      const steps = Math.max(1, Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/5));
      const point = (t, band) => {
        const x = a[0] + (b[0]-a[0])*t, n = a[1] + (b[1]-a[1])*t;
        const ox = d[0] + (c[0]-d[0])*t, on = d[1] + (c[1]-d[1])*t;
        // Mild natural variation breaks the straight outer edge while keeping the shoreline fixed.
        const waviness = .89 + .11 * Math.sin(x*.19 + n*.13) * Math.cos(n*.11);
        const px = x + (ox-x)*band*waviness, pn = n + (on-n)*band*waviness;
        return [px, band === 0 ? -.965 : heightAt(px,pn) + .045, -pn];
      };
      const vertex = (p, alpha) => { bankPoints.push(...p); bankColors.push(1,1,1,alpha); };
      for(let k=0;k<steps;k++) for(const [inner,outerBand,alpha0,alpha1] of [[0,.45,.86,.72],[.45,1,.72,0]]) {
        const t0=k/steps,t1=(k+1)/steps,p=point(t0,inner),q=point(t1,inner),u=point(t1,outerBand),v=point(t0,outerBand);
        vertex(p,alpha0);vertex(q,alpha0);vertex(u,alpha1);vertex(p,alpha0);vertex(u,alpha1);vertex(v,alpha1);
      }
    });
  });
  // A narrow earthen edge, flecked with grass and small soil variations.
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d'), pixels = ctx.createImageData(128, 128); let seed = 98123;
    for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const noise = seed / 4294967296, patch = Math.sin(x * .19 + Math.sin(y * .11)) * Math.cos(y * .16);
      const v = Math.max(190, Math.min(255, 229 + patch * 9 + (noise - .5) * 21));
      pixels.data.set([v, Math.min(255, v + 3), v * .91, 255], (y * 128 + x) * 4);
    }
    ctx.putImageData(pixels, 0, 0);
    const texture = new THREE.CanvasTexture(canvas); texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4;
    bankMaterial.map = texture; bankMaterial.bumpMap = texture; bankMaterial.bumpScale = .012;
  }
  const bankUVs = [];
  for (let i = 0; i < bankPoints.length; i += 3) bankUVs.push(bankPoints[i] / 5, bankPoints[i + 2] / 5);
  const bankMesh = meshFrom('Lake_banks', bankPoints, bankMaterial, waterGroup, bankUVs);
  if (bankMesh) bankMesh.geometry.setAttribute('color', new THREE.Float32BufferAttribute(bankColors, 4));
  const roadBins = {
    road: { p: [], uv: [] }, external: { p: [], uv: [] }, foot: { p: [], uv: [] },
    curb: { p: [], uv: [] }, mark: { p: [], uv: [] }, walk: { p: [], uv: [] }, edge: { p: [], uv: [] }
  };
  const roadMaterials = {
    road: new THREE.MeshStandardMaterial({ name: 'Campus_asphalt', color: 0x777876, roughness: .97, side: THREE.DoubleSide }),
    external: new THREE.MeshStandardMaterial({ name: 'Public_asphalt', color: 0x6a6b69, roughness: .97, side: THREE.DoubleSide }),
    foot: new THREE.MeshStandardMaterial({ name: 'Walking_path', color: 0xb3ac98, roughness: 1, side: THREE.DoubleSide }),
    curb: new THREE.MeshStandardMaterial({ name: 'Pale_road_edges', color: 0xb0aca0, roughness: 1, side: THREE.DoubleSide }),
    mark: new THREE.MeshStandardMaterial({ name: 'Road_markings', color: 0xd5d1c4, roughness: .91, side: THREE.DoubleSide }),
    walk: new THREE.MeshStandardMaterial({ name: 'Pavement', color: 0xaaa99a, roughness: 1, side: THREE.DoubleSide }),
    edge: new THREE.MeshStandardMaterial({ name: 'Earth_at_path_edges', color: 0x8e8c76, roughness: 1, side: THREE.DoubleSide })
  };
  if (typeof document !== 'undefined') {
    const asphaltCanvas = document.createElement('canvas'); asphaltCanvas.width = asphaltCanvas.height = 256;
    const asphaltContext = asphaltCanvas.getContext('2d'), asphaltPixels = asphaltContext.createImageData(256, 256);
    let asphaltSeed = 112358;
    const asphaltBlocks = new Float32Array(32 * 32);
    let blockSeed = 8675309;
    for (let i = 0; i < asphaltBlocks.length; i++) { blockSeed = (Math.imul(blockSeed, 1664525) + 1013904223) >>> 0; asphaltBlocks[i] = blockSeed / 4294967296; }
    for (let i = 0; i < 256 * 256; i++) {
      asphaltSeed = (Math.imul(asphaltSeed, 1664525) + 1013904223) >>> 0;
      const r = asphaltSeed / 4294967296, speck = r > .993 ? -46 : r < .007 ? 26 : 0;
      const block = (asphaltBlocks[((i >> 8) >> 3) * 32 + ((i % 256) >> 3)] - .5) * 18;
      const v = Math.max(150, Math.min(255, 230 + Math.round(block + (r - .5) * 34) + speck));
      asphaltPixels.data[i * 4] = v; asphaltPixels.data[i * 4 + 1] = v; asphaltPixels.data[i * 4 + 2] = v; asphaltPixels.data[i * 4 + 3] = 255;
    }
    asphaltContext.putImageData(asphaltPixels, 0, 0);
    const asphaltTexture = new THREE.CanvasTexture(asphaltCanvas);
    asphaltTexture.wrapS = asphaltTexture.wrapT = THREE.RepeatWrapping; asphaltTexture.colorSpace = THREE.SRGBColorSpace;
    asphaltTexture.anisotropy = 8;
    roadMaterials.road.map = asphaltTexture; roadMaterials.external.map = asphaltTexture;
    roadMaterials.road.bumpMap = asphaltTexture; roadMaterials.external.bumpMap = asphaltTexture;
    roadMaterials.road.bumpScale = .008; roadMaterials.external.bumpScale = .008;
    roadMaterials.road.needsUpdate = true; roadMaterials.external.needsUpdate = true;
    if (assets.asphalt) new THREE.TextureLoader().load(assets.asphalt, photo => {
      photo.wrapS = photo.wrapT = THREE.RepeatWrapping;
      photo.colorSpace = THREE.SRGBColorSpace;
      photo.anisotropy = 8;
      photo.repeat.set(2,2);
      for (const [material,tint] of [[roadMaterials.road,0xadafb1],[roadMaterials.external,0xa2a5aa]]) {
        material.map = photo;
        material.bumpMap = photo;
        material.bumpScale = .019;
        material.color.setHex(tint);
        material.needsUpdate = true;
      }
      asphaltTexture.dispose();
    });
    // Fine aggregate and faint joints make footpaths readable from walking height.
    const pavingCanvas = document.createElement('canvas'); pavingCanvas.width = pavingCanvas.height = 128;
    const pavingContext = pavingCanvas.getContext('2d'), pavingPixels = pavingContext.createImageData(128, 128);
    let pavingSeed = 31841;
    for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
      pavingSeed = (Math.imul(pavingSeed, 1664525) + 1013904223) >>> 0;
      const joint = y % 16 === 0 || (x + (Math.floor(y / 16) % 2) * 8) % 16 === 0;
      const v = Math.max(0, Math.min(255, 236 + (pavingSeed / 4294967296 - .5) * 16 - (joint ? 16 : 0)));
      pavingPixels.data.set([v, v, v, 255], (y * 128 + x) * 4);
    }
    pavingContext.putImageData(pavingPixels, 0, 0);
    const paving = new THREE.CanvasTexture(pavingCanvas); paving.wrapS = paving.wrapT = THREE.RepeatWrapping;
    paving.colorSpace = THREE.SRGBColorSpace; paving.anisotropy = 4;
    for (const material of [roadMaterials.foot, roadMaterials.walk, roadMaterials.curb, roadMaterials.edge]) {
      material.map = paving; material.bumpMap = paving; material.bumpScale = .008; material.needsUpdate = true;
    }
  }
  const library = data.buildings.find(b => b.s === 'B84');
  if (library && typeof document !== 'undefined') {
    // The library's south forecourt joins the broad entrance stairs to the existing road.
    const a = library.r[0], b = library.r.at(-1);
    const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const ux = Math.cos(angle), un = Math.sin(angle);
    const cx = (a[0] + b[0]) / 2, cn = (a[1] + b[1]) / 2;
    const plaza = {p: [], uv: []};
    function tile(u, v, h) {
      const x = cx + ux*u - un*v, n = cn + un*u + ux*v;
      plaza.p.push(x, heightAt(x,n) + h, -n);
      plaza.uv.push(u/6,v/6);
    }
    for (const [left,right,near,far,h] of [[-22,22,3.4,34,.035],[-22,22,32.8,34,.049],[-22,-21,4,32.8,.049],[21,22,4,32.8,.049]]) {
      for (const [u,v] of [[left,near],[right,near],[right,far],[left,near],[right,far],[left,far]]) tile(u,v,h);
    }
    meshFrom('Library_south_forecourt',plaza.p,roadMaterials.walk,roadsGroup,plaza.uv);
  }
  let roadQuads = 0, omittedWetRoadQuads = 0, markQuads = 0;
  function ribbon(a, b, na, nb, low, high, bridge, offset, target, t0 = 0, t1 = 1) {
    const A = [a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0], B = [a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1];
    const NA = [na[0] + (nb[0] - na[0]) * t0, na[1] + (nb[1] - na[1]) * t0], NB = [na[0] + (nb[0] - na[0]) * t1, na[1] + (nb[1] - na[1]) * t1];
    const p = [A[0] + NA[0] * low, A[1] + NA[1] * low], q = [B[0] + NB[0] * low, B[1] + NB[1] * low], r = [B[0] + NB[0] * high, B[1] + NB[1] * high], s = [A[0] + NA[0] * high, A[1] + NA[1] * high];
    const P = v => [v[0], (bridge ? .25 : heightAt(...v)) + offset, -v[1]];
    for (const v of [P(p), P(q), P(r), P(p), P(r), P(s)]) { target.p.push(...v); target.uv.push(v[0] / 6, v[2] / 6); }
  }
  const strip = (a, b, na, nb, low, high, bridge, offset, target) => ribbon(a, b, na, nb, low, high, bridge, offset, target, 0, 1);
  data.roads.forEach((road, roadNumber) => {
    const points = road.points.filter((p,i,r) => i === 0 || Math.hypot(p[0]-r[i-1][0],p[1]-r[i-1][1]) > .01);
    if (points.length < 2) return;
    const closed = Math.hypot(points[0][0]-points[points.length-1][0],points[0][1]-points[points.length-1][1]) < .01;
    const normals = points.slice(1).map((p,i) => { const a=points[i],length=Math.hypot(p[0]-a[0],p[1]-a[1]);return [-(p[1]-a[1])/length,(p[0]-a[0])/length]; });
    const joins = points.map((p,i) => {
      const a=normals[i-1]||(closed?normals[normals.length-1]:normals[0]),b=normals[i]||(closed?normals[0]:normals[normals.length-1]);
      const length=Math.hypot(a[0]+b[0],a[1]+b[1]);if(length<.01)return b;
      const nx=(a[0]+b[0])/length,nn=(a[1]+b[1])/length,scale=1/Math.max(.5,nx*a[0]+nn*a[1]);return [nx*scale,nn*scale];
    });
    // Slightly separated road layers prevent coplanar crossings from producing black ray-tracing artifacts.
    const offset = roadNumber * .0005;
    const cum = [0];
    for (let i = 1; i < points.length; i++) cum.push(cum[i-1] + Math.hypot(points[i][0]-points[i-1][0], points[i][1]-points[i-1][1]));
    const marked = road.kind !== 'foot' && (road.kind === 'external' || !!road.name);
    for(let j=0;j<points.length-1;j++){
      const start=points[j],end=points[j+1],vx=end[0]-start[0],vn=end[1]-start[1],segLength=Math.hypot(vx,vn),count=Math.ceil(segLength/3);
      const at=t=>[start[0]+vx*t,start[1]+vn*t],normal=t=>joins[j].map((v,k)=>v+(joins[j+1][k]-v)*t);
      for(let i=0;i<count;i++){
        const a=at(i/count),b=at((i+1)/count),na=normal(i/count),nb=normal((i+1)/count);
        if(!road.bridge&&waterDistance((a[0]+b[0])/2,(a[1]+b[1])/2)<0){omittedWetRoadQuads++;continue;}
        const mx=(a[0]+b[0])/2,mn=(a[1]+b[1])/2,nmx=(na[0]+nb[0])/2,nmn=(na[1]+nb[1])/2;
        // 路口范围内不再铺路缘/人行道/边线，避免浅色铺装横穿主路。
        const clear=(side,dist)=>junctionDistance(mx+nmx*side*dist,mn+nmn*side*dist,roadNumber)>.4;
        strip(a,b,na,nb,-road.width/2,road.width/2,road.bridge,.11+offset,roadBins[road.kind]);
        if(road.kind!=='foot')for(const side of [-1,1])if(clear(side,road.width/2+.18))strip(a,b,na,nb,side*road.width/2,side*(road.width/2+.35),road.bridge,.16+offset,roadBins.curb);
        const walkTo=road.kind==='external'?1.5:road.kind==='road'&&(road.name||road.width>=6)?1.2:0;
        if(walkTo)for(const side of [-1,1])if(clear(side,road.width/2+.7)){const e0=side*(road.width/2+.35),e1=side*(road.width/2+walkTo);strip(a,b,na,nb,Math.min(e0,e1),Math.max(e0,e1),road.bridge,.145+offset,roadBins.walk);}
        // A narrow worn shoulder joins path or sidewalk to grass; avoid junctions and buildings.
        if(!road.bridge)for(const side of [-1,1]) {
          const outside = road.width/2 + (walkTo || 0), px=mx+nmx*side*(outside+.16), pn=mn+nmn*side*(outside+.16);
          if(clear(side,outside+.16) && buildingDistance(px,pn)>.6 && waterDistance(px,pn)>1) {
            const e0=side*outside,e1=side*(outside+.28);
            strip(a,b,na,nb,Math.min(e0,e1),Math.max(e0,e1),false,.075+offset,roadBins.edge);
          }
        }
        // 中心虚线按累计里程切段（3.2m 实线 + 3.8m 间隔），避免在每 3m 分段处断开。
        if (marked && segLength > .01) {
          const c0 = cum[j] + segLength * i / count, c1 = cum[j] + segLength * (i + 1) / count;
          if (junctionDistance(mx, mn, roadNumber) > .35) for (let k = Math.floor((c0 - 3.2) / 7); k * 7 < c1; k++) {
            const lo = Math.max(c0, k * 7), hi = Math.min(c1, k * 7 + 3.2);
            if (hi - lo < .01) continue;
            ribbon(a, b, na, nb, -.085, .085, road.bridge, .132 + offset, roadBins.mark, (lo - c0) / (c1 - c0), (hi - c0) / (c1 - c0));
            markQuads++;
          }
          if (road.kind === 'external') for (const side of [-1, 1]) if (clear(side, road.width / 2 - .22)) {
            const e0 = side * (road.width / 2 - .27), e1 = side * (road.width / 2 - .17);
            strip(a, b, na, nb, Math.min(e0, e1), Math.max(e0, e1), road.bridge, .132 + offset, roadBins.mark);
            markQuads++;
          }
        }
        roadQuads++;
      }
    }
  });

  // 校门口的斑马线：按最近车行道方向横向铺 4 条白色条带。
  if (data.gates) for (const gate of data.gates) {
    let best = null;
    data.roads.forEach(road => {
      if (road.kind === 'foot' || road.width < 5) return;
      for (let i = 0; i < road.points.length - 1; i++) {
        const a = road.points[i], b = road.points[i + 1], vx = b[0] - a[0], vn = b[1] - a[1], l2 = vx * vx + vn * vn;
        if (l2 < .01) continue;
        let t = ((gate.x - a[0]) * vx + (gate.n - a[1]) * vn) / l2; t = Math.max(0, Math.min(1, t));
        const px = a[0] + vx * t, pn = a[1] + vn * t, d = Math.hypot(gate.x - px, gate.n - pn);
        if (!best || d < best.d) best = { d, road, a, b, x: px, n: pn };
      }
    });
    if (!best || best.d > 35) continue;
    const road = best.road, dx = best.b[0] - best.a[0], dn = best.b[1] - best.a[1], len = Math.hypot(dx, dn);
    if (len < .1) continue;
    const ux = dx / len, un = dn / len, nx = -un, nn = ux, half = road.width / 2 - .4;
    for (let s = -1.65; s <= 1.7; s += 1.1) {
      const corners = [
        [best.x + ux * (s - .22) + nx * half, best.n + un * (s - .22) + nn * half],
        [best.x + ux * (s + .22) + nx * half, best.n + un * (s + .22) + nn * half],
        [best.x + ux * (s + .22) - nx * half, best.n + un * (s + .22) - nn * half],
        [best.x + ux * (s - .22) - nx * half, best.n + un * (s - .22) - nn * half]
      ].map(([x, n]) => [x, (road.bridge ? .25 : heightAt(x, n)) + .148, -n]);
      roadBins.mark.p.push(...corners[0], ...corners[1], ...corners[2], ...corners[0], ...corners[2], ...corners[3]);
      for (const c of [0, 1, 2, 0, 2, 3]) roadBins.mark.uv.push(corners[c][0] / 6, corners[c][2] / 6);
      markQuads += 2;
    }
  }
  for (const [kind, bin] of Object.entries(roadBins)) meshFrom('Roads_' + kind, bin.p, roadMaterials[kind], roadsGroup, bin.uv);
  let seed = 713042;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const vegetation = data.vegetation;
  const isTeachingForecourt = (x,n) => x >= -350 && x <= -278 && n >= 32 && n <= 57;
  function vegetated(x, n) {
    const lon = x / 102400 + 113.0216, lat = n / 110950 + 23.14195, b = vegetation.bounds;
    const u = Math.floor((lon - b.minLon) / (b.maxLon - b.minLon) * vegetation.width), v = Math.floor((b.maxLat - lat) / (b.maxLat - b.minLat) * vegetation.height);
    return u >= 0 && u < vegetation.width && v >= 0 && v < vegetation.height && vegetation.values[v * vegetation.width + u] === 1;
  }
  const treeGroups = [[], [], []], treeCells = new Map(), spacing = 6.5;
  let treeCount = 0;
  for (let attempt = 0; attempt < 100000 && treeCount < 3800; attempt++) {
    const x = xmin + 15 + random() * (xmax - xmin - 30), n = nmin + 15 + random() * (nmax - nmin - 30), radius = 3.7 + random() * 3.5;
    if (!vegetated(x, n) || buildingDistance(x, n) < radius + 2 || waterDistance(x, n) < radius + 2 || roadDistance(x, n) < 3.5 || sportDistance(x, n) < radius + 3) continue;
    const ix = Math.floor(x / spacing), iz = Math.floor(n / spacing);
    let close = false;
    for (let a = ix - 1; a <= ix + 1 && !close; a++) for (let b = iz - 1; b <= iz + 1 && !close; b++) {
      for (const p of treeCells.get(a + ',' + b) || []) if (Math.hypot(x - p[0], n - p[1]) < spacing) { close = true; break; }
    }
    if (close) continue;
    const type = Math.floor(random() * 3), height = 7 + random() * 8.5, angle = random() * Math.PI * 2, tone = random();
    if (isTeachingForecourt(x,n)) continue;
    const key = ix + ',' + iz; if (!treeCells.has(key)) treeCells.set(key, []); treeCells.get(key).push([x, n]);
    treeGroups[type].push({ x, n, radius, height, angle, color: tone }); treeCount++;
  }
  const webTrees = typeof document !== 'undefined';
  const leavesMaterial = new THREE.MeshStandardMaterial({
    name: 'Broadleaf_canopies', color: 0xffffff, roughness: 1, vertexColors: webTrees,
    side: webTrees ? THREE.DoubleSide : THREE.FrontSide, alphaTest: webTrees ? .44 : 0
  });
  const trunkMaterial = new THREE.MeshStandardMaterial({ name: 'Tree_bark', color: 0x8c8370, roughness: 1 });
  const treePalette = [0x65834e, 0x739052, 0x859454, 0x597b4b, 0x738553];
  if (webTrees) {
    // The left tile shades the crown volumes. The right tile adds gaps and leaf tips at their edges.
    const atlas = document.createElement('canvas'); atlas.width = 256; atlas.height = 128;
    const atlasContext = atlas.getContext('2d');
    const leafTile = document.createElement('canvas'); leafTile.width = leafTile.height = 128;
    const leafContext = leafTile.getContext('2d');
    const cutout = document.createElement('canvas'); cutout.width = cutout.height = 128;
    const mask = cutout.getContext('2d');
    let leafSeed = 286319;
    const leafRandom = () => { leafSeed = (Math.imul(leafSeed, 1664525) + 1013904223) >>> 0; return leafSeed / 4294967296; };
    mask.fillStyle = '#fff';
    for (let i = 0; i < 205; i++) {
      const angle = leafRandom() * Math.PI * 2;
      const spread = Math.sqrt(leafRandom());
      const radius = spread * (48 + 6 * Math.cos(angle * 5));
      mask.beginPath();
      mask.ellipse(64 + Math.cos(angle) * radius, 65 + Math.sin(angle) * radius * .91,
        2.8 + leafRandom() * 6.7, 1.7 + leafRandom() * 3.8, angle + leafRandom(), 0, Math.PI * 2);
      mask.fill();
    }
    const leafMap = new THREE.CanvasTexture(atlas);
    leafMap.colorSpace = THREE.SRGBColorSpace;
    leafMap.anisotropy = 4;
    leavesMaterial.map = leafMap;
    function drawLeafAtlas(photo) {
      leafContext.clearRect(0, 0, 128, 128);
      leafContext.fillStyle = '#b8c4a4';
      leafContext.fillRect(0, 0, 128, 128);
      if (photo) {
        leafContext.drawImage(photo, 0, 0, 128, 128);
        const pixels = leafContext.getImageData(0, 0, 128, 128);
        for (let i = 0; i < pixels.data.length; i += 4) {
          const value = 95 + (.21 * pixels.data[i] + .72 * pixels.data[i + 1] + .07 * pixels.data[i + 2]) * 1.1;
          pixels.data[i] = value * .96; pixels.data[i + 1] = value; pixels.data[i + 2] = value * .90;
        }
        leafContext.putImageData(pixels, 0, 0);
      }
      atlasContext.clearRect(0, 0, 256, 128);
      atlasContext.drawImage(leafTile, 0, 0);
      leafContext.globalCompositeOperation = 'destination-in';
      leafContext.drawImage(cutout, 0, 0);
      leafContext.globalCompositeOperation = 'source-over';
      atlasContext.drawImage(leafTile, 128, 0);
      leafMap.needsUpdate = true;
    }
    drawLeafAtlas();
    // Foliage crop from 建筑参考图/03_图书馆/08_校园街景.jpg, embedded for offline use.
    new THREE.ImageLoader().load('data:image/jpeg;base64,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', drawLeafAtlas);
    const bark = document.createElement('canvas'); bark.width = bark.height = 64;
    const barkContext = bark.getContext('2d'), barkPixels = barkContext.createImageData(64, 64);
    const veins = Array.from({ length: 64 }, () => leafRandom());
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      const channel = Math.floor(x + 2 * Math.sin(y / 11 + x * .2) + 64) % 64;
      const value = 162 + 72 * veins[channel] + 18 * leafRandom();
      barkPixels.data.set([value, value * .95, value * .89, 255], (y * 64 + x) * 4);
    }
    barkContext.putImageData(barkPixels, 0, 0);
    trunkMaterial.map = new THREE.CanvasTexture(bark);
    trunkMaterial.map.colorSpace = THREE.SRGBColorSpace;
    trunkMaterial.bumpMap = trunkMaterial.map;
    trunkMaterial.bumpScale = .075;
  }
  function mergeTreeGeometry(parts, colored = false) {
    const vertexCount = parts.reduce((sum, part) => sum + part.attributes.position.count, 0);
    const positions = new Float32Array(vertexCount * 3), normals = new Float32Array(vertexCount * 3);
    const uvs = new Float32Array(vertexCount * 2), colors = colored ? new Float32Array(vertexCount * 3) : null;
    let start = 0;
    for (const part of parts) {
      const { position, normal, uv } = part.attributes;
      positions.set(position.array, start * 3); normals.set(normal.array, start * 3); uvs.set(uv.array, start * 2);
      if (colors) for (let i = 0; i < position.count; i++) {
        // Less diffuse light reaches the underside of a dense leaf canopy.
        const tone = .70 + .30 * smooth(.33, .96, position.getY(i));
        colors.set([tone, tone, tone], (start + i) * 3);
      }
      start += position.count;
      part.dispose();
    }
    const mesh = new THREE.BufferGeometry();
    mesh.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    mesh.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    mesh.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    if (colors) mesh.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return mesh;
  }
  function crownParts(type) {
    if (!webTrees) {
      // Keep existing exports compatible. Alpha cutouts are rendered in the web viewer only.
      return [[0, .72, 0, 1, .39, .87, 1], [.54, .65, .17, .56, .25, .57, 0], [-.4, .82, -.23, .6, .26, .57, 0]]
        .map(([x, y, z, sx, sy, sz, detail]) => new THREE.IcosahedronGeometry(1, detail)
          .scale(sx * (type === 1 ? .83 : 1), sy * (type === 2 ? .84 : 1), sz).translate(x, y, z));
    }
    const profiles = [
      [[-.07, .70, .04, .77, .33, .71], [.55, .61, .18, .45, .23, .48], [-.47, .81, -.22, .46, .23, .45]],
      [[.10, .78, -.09, .62, .32, .65], [-.44, .67, .08, .43, .24, .41], [.33, .61, .40, .48, .19, .39]],
      [[0, .72, .07, .79, .26, .64], [.55, .61, -.24, .45, .22, .48], [-.42, .70, .35, .48, .24, .42]]
    ];
    const pieces = profiles[type].map(([x,y,z,sx,sy,sz], i) => {
      // A few more radial segments remove the flat hexagonal skyline at walking height.
      const sphere = new THREE.SphereGeometry(1, i ? 6 : 10, i ? 4 : 6);
      const part = sphere.toNonIndexed(); sphere.dispose();
      const { position, uv } = part.attributes;
      for (let vertex = 0; vertex < position.count; vertex++) {
        const px = position.getX(vertex), py = position.getY(vertex), pz = position.getZ(vertex);
        const wave = 1 + .12 * Math.sin(px * 4.8 + pz * 5.7 + i + type) * Math.cos(py * 5.1 - pz * 3.9);
        position.setXYZ(vertex, px * wave, py * wave, pz * wave);
        uv.setX(vertex, .013 + .474 * uv.getX(vertex));
      }
      // A smaller shaded core gives depth behind the cutout foliage without
      // exposing a solid low-poly shell along the tree's silhouette.
      return part.scale(sx * .79, sy * .78, sz * .79).translate(x * .83,y,z * .83);
    });
    for (let i = 0; i < 16; i++) {
      const azimuth = i * 2.399963 + type * .49;
      const distance = .55 + .12 * Math.sin(i * 3.41 + type);
      const centerX = Math.cos(azimuth) * distance, centerZ = Math.sin(azimuth) * distance;
      const centerY = .71 + .14 * Math.sin(i * 2.47 + type);
      const plane = new THREE.PlaneGeometry(.43 + .13 * (i % 3) / 2, .27 + .08 * (i % 2));
      const part = plane.toNonIndexed(); plane.dispose();
      part.rotateX((i % 4 - 1.5) * .43).rotateY(Math.PI / 2 - azimuth + (i % 2 ? -.29 : .29)).translate(centerX, centerY, centerZ);
      const { normal, uv } = part.attributes;
      const direction = new THREE.Vector3(centerX, (centerY - .68) * 3 + .22, centerZ).normalize();
      for (let vertex = 0; vertex < uv.count; vertex++) {
        uv.setX(vertex, .502 + .496 * uv.getX(vertex));
        normal.setXYZ(vertex, direction.x, direction.y, direction.z);
      }
      pieces.push(part);
    }
    return pieces;
  }
  function treeBranch(a, b, base, tip, sides, segments = 1) {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b), direction = end.clone().sub(start);
    const cylinder = new THREE.CylinderGeometry(tip, base, direction.length(), sides, segments, true);
    const branch = cylinder.toNonIndexed(); cylinder.dispose();
    branch.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()));
    branch.translate(...start.lerp(end, .5).toArray());
    return branch;
  }
  const dummy = new THREE.Object3D();
  treeGroups.forEach((group, type) => {
    if (!group.length) return;
    const crownGeo = mergeTreeGeometry(crownParts(type), webTrees);
    const lean = [.03, -.09, .11][type];
    const trunkGeo = webTrees ? mergeTreeGeometry([
      treeBranch([0, -.025, 0], [lean, .67, .015], .081, .032, 7, 2),
      treeBranch([lean * .54, .34, 0], [.56, .67, .17], .043, .015, 5),
      treeBranch([lean * .62, .39, .01], [-.43, .74, -.23], .037, .013, 5)
    ]) : new THREE.CylinderGeometry(.045, .065, .64, 6, 1).translate(0, .32, 0);
    const crowns = new THREE.InstancedMesh(crownGeo, leavesMaterial, group.length), trunks = new THREE.InstancedMesh(trunkGeo, trunkMaterial, group.length);
    crowns.name = 'Tree_crowns_' + type; trunks.name = 'Tree_trunks_' + type; crowns.castShadow = true; crowns.receiveShadow = true; trunks.castShadow = true;
    group.forEach((tree, i) => {
      dummy.position.set(tree.x, heightAt(tree.x, tree.n), -tree.n); dummy.rotation.set(0, tree.angle, 0); dummy.scale.set(tree.radius, tree.height, tree.radius); dummy.updateMatrix();
      crowns.setMatrixAt(i, dummy.matrix); trunks.setMatrixAt(i, dummy.matrix);
      color.setHex(treePalette[Math.floor(tree.color * treePalette.length)]); crowns.setColorAt(i, color);
      if (webTrees) trunks.setColorAt(i, color.setScalar(.78 + tree.color * .22));
    });
    crowns.instanceMatrix.needsUpdate = true; crowns.instanceColor.needsUpdate = true; trunks.instanceMatrix.needsUpdate = true;
    if (trunks.instanceColor) trunks.instanceColor.needsUpdate = true;
    crowns.computeBoundingSphere(); trunks.computeBoundingSphere(); treesGroup.add(crowns, trunks);
  });
  if (webTrees) {
    // Low shrubs soften the bare lake edge without creating individual draw calls.
    // They stay clear of roads and walls; the lake and routing geometry are unchanged.
    const shrubs = [], crown = treesGroup.getObjectByName('Tree_crowns_0');
    for (let attempt = 0; crown && attempt < 3500 && shrubs.length < 120; attempt++) {
      const ring = waters[Math.floor(random() * waters.length)];
      if (!ring) break;
      const point = ring[Math.floor(random() * ring.length)], angle = random() * Math.PI * 2, distance = 2 + random() * 9;
      const x = point[0] + Math.cos(angle) * distance, n = point[1] + Math.sin(angle) * distance;
      const shore = waterDistance(x, n);
      if (x < xmin + 2 || x > xmax - 2 || n < nmin + 2 || n > nmax - 2 || shore < 1 || shore > 9 || buildingDistance(x, n) < 3 || roadDistance(x, n) < 3 || sportDistance(x, n) < 3) continue;
      shrubs.push({x, n, scale: 1.1 + random() * 1.2, angle: random() * Math.PI * 2, color: random()});
    }
    if (shrubs.length) {
      const bushes = new THREE.InstancedMesh(crown.geometry, leavesMaterial, shrubs.length);
      bushes.name = 'Lakeside_shrubs'; bushes.castShadow = true; bushes.receiveShadow = true;
      shrubs.forEach((shrub, i) => {
        dummy.position.set(shrub.x, heightAt(shrub.x, shrub.n), -shrub.n);
        dummy.rotation.set(0, shrub.angle, 0); dummy.scale.set(shrub.scale, shrub.scale * .7, shrub.scale); dummy.updateMatrix();
        bushes.setMatrixAt(i, dummy.matrix); bushes.setColorAt(i, color.setHex(treePalette[Math.floor(shrub.color * treePalette.length)]));
      });
      bushes.instanceMatrix.needsUpdate = true; bushes.instanceColor.needsUpdate = true; bushes.computeBoundingSphere(); treesGroup.add(bushes);
    }
  }
  if (webTrees) {
    // Short lawn grasses are concentrated around the lakeside foreground and
    // path edges. Taller plants appear only in small clusters on exposed banks.
    const bladeCanvas = document.createElement('canvas'); bladeCanvas.width = bladeCanvas.height = 96;
    const bladeContext = bladeCanvas.getContext('2d');
    for (let i = 0; i < 15; i++) {
      const rootX = 32 + random() * 32, tipX = 6 + random() * 84, tipY = 8 + random() * 39;
      bladeContext.fillStyle = ['#617949', '#758c53', '#839458', '#506b43'][i % 4];
      bladeContext.beginPath(); bladeContext.moveTo(rootX - 2, 94);
      bladeContext.quadraticCurveTo(rootX + (tipX - rootX) * .27, 50, tipX, tipY);
      bladeContext.quadraticCurveTo(rootX + (tipX - rootX) * .48, 51, rootX + 2, 94);
      bladeContext.closePath(); bladeContext.fill();
    }
    const bladeTexture = new THREE.CanvasTexture(bladeCanvas); bladeTexture.colorSpace = THREE.SRGBColorSpace;
    const bladeMaterial = new THREE.MeshStandardMaterial({name:'Shore_and_lawn_grasses', map:bladeTexture, color:0xffffff, roughness:1, side:THREE.DoubleSide, alphaTest:.3});
    const planes = [];
    for (const angle of [0, Math.PI / 2]) {
      const indexed = new THREE.PlaneGeometry(1, 1), plane = indexed.toNonIndexed(); indexed.dispose();
      plane.translate(0, .5, 0); plane.rotateY(angle); planes.push(plane);
    }
    const bladeGeometry = mergeTreeGeometry(planes), plants = [];
    const library = data.buildings.find(b => b.s === 'B84');
    const libraryCenter = library && library.r.reduce((p,v)=>[p[0]+v[0]/library.r.length,p[1]+v[1]/library.r.length],[0,0]);
    function placePlant(x, n, height, width, shoreline = false) {
      const ground = heightAt(x,n);
      if (x < xmin + 2 || x > xmax - 2 || n < nmin + 2 || n > nmax - 2 || ground <= (shoreline ? -1.1 : -.9) || waterDistance(x, n) < 1 || buildingDistance(x, n) < 2 || roadDistance(x, n) < 1.1 || sportDistance(x, n) < 3 || isTeachingForecourt(x,n) || (libraryCenter && Math.hypot(x-libraryCenter[0],n-libraryCenter[1]) < 40)) return;
      plants.push({x,n,y:Math.max(-.981,ground+.015),height,width,angle:random()*Math.PI*2,color:.8 + random()*.2});
    }
    // Dense low blades in the existing lakeside lawn; jitter and patchiness avoid a grid.
    for(let x=-483;x<=-387;x+=.8) for(let n=-88;n<=8;n+=.8) {
      const px=x+(random()-.5)*.7, pn=n+(random()-.5)*.7;
      const patch = Math.sin(px*.17+Math.sin(pn*.09))*Math.cos(pn*.13-px*.06);
      if (random() < THREE.MathUtils.smoothstep(patch,-.55,.56)*.83) {
        const atWater = waterDistance(px,pn) < 13;
        placePlant(px,pn,atWater?.28+random()*.36:.12+random()*.18,.32+random()*.30,atWater);
      }
    }
    const foregroundCount = plants.length;
    // Short strips along real path shoulders, set back from the walkable surface.
    for (let attempt=0; attempt<8000 && plants.length<foregroundCount+3200; attempt++) {
      const segment=roadSegments[Math.floor(random()*roadSegments.length)]; if(!segment || segment.bridge) continue;
      const dx=segment.b[0]-segment.a[0], dn=segment.b[1]-segment.a[1], length=Math.hypot(dx,dn); if(length<.1)continue;
      const t=random(), side=random()<.5?-1:1, setback=segment.width/2+1.3+random()*2.2;
      placePlant(segment.a[0]+dx*t-dn/length*side*setback,segment.a[1]+dn*t+dx/length*side*setback,.12+random()*.18,.3+random()*.23);
    }
    const pathCount = plants.length;
    for (let attempt = 0; attempt < 18000 && plants.length < pathCount+1600; attempt++) {
      const ring = waters[Math.floor(random()*waters.length)]; if (!ring) break;
      const point = ring[Math.floor(random()*ring.length)], angle = random()*Math.PI*2, distance = 9 + random()*15;
      const x = point[0] + Math.cos(angle)*distance, n = point[1] + Math.sin(angle)*distance, shore = waterDistance(x,n);
      if (shore > 2 && shore < 22) {
        const reed = random()<.22;
        placePlant(x,n,reed ? .5+random()*.3 : .12+random()*.18, reed ? .34+random()*.25 : .3+random()*.25,true);
      }
    }
    const trees = treeGroups.flat();
    const shoreCount = plants.length;
    for (let attempt = 0; trees.length && attempt < 4000 && plants.length < shoreCount+1600; attempt++) {
      const tree = trees[Math.floor(random()*trees.length)], angle = random()*Math.PI*2, distance = .7 + random()*3.5;
      placePlant(tree.x + Math.cos(angle)*distance, tree.n + Math.sin(angle)*distance, .12 + random()*.18, .3 + random()*.25);
    }
    if (plants.length) {
      const grass = new THREE.InstancedMesh(bladeGeometry, bladeMaterial, plants.length); grass.name = 'Shore_and_lawn_plants';
      plants.forEach((plant,i) => {
        dummy.position.set(plant.x, plant.y, -plant.n); dummy.rotation.set(0,plant.angle,0);
        dummy.scale.set(plant.width,plant.height,plant.width); dummy.updateMatrix(); grass.setMatrixAt(i,dummy.matrix);
        grass.setColorAt(i,color.setScalar(plant.color));
      });
      grass.instanceMatrix.needsUpdate = true; grass.instanceColor.needsUpdate = true; grass.computeBoundingSphere(); treesGroup.add(grass);
      grass.receiveShadow=true;
    }
    // Break up the perfectly clean seam at trunks with a small, irregular soil patch.
    const soilCanvas = document.createElement('canvas'); soilCanvas.width = soilCanvas.height = 64;
    const soilContext = soilCanvas.getContext('2d'), soilPixels = soilContext.createImageData(64,64);
    for (let y=0;y<64;y++) for(let x=0;x<64;x++) {
      const dx=(x-31.5)/31.5, dy=(y-31.5)/31.5, d=Math.hypot(dx,dy), noise=random();
      const alpha=Math.max(0,Math.min(1,(.88-d)*3.1))*(.20+noise*.15), off=(y*64+x)*4;
      soilPixels.data.set([99+noise*21,91+noise*18,67+noise*15,alpha*255],off);
    }
    soilContext.putImageData(soilPixels,0,0);
    const soilTexture = new THREE.CanvasTexture(soilCanvas); soilTexture.colorSpace=THREE.SRGBColorSpace;
    const soilMaterial = new THREE.MeshStandardMaterial({name:'Tree_base_leaf_litter', map:soilTexture, transparent:true, depthWrite:false, roughness:1, side:THREE.DoubleSide});
    const selected = trees.filter((tree,i)=>i%4===0 && roadDistance(tree.x,tree.n)>3 && waterDistance(tree.x,tree.n)>2).slice(0,600);
    if (selected.length) {
      const discs = new THREE.InstancedMesh(new THREE.PlaneGeometry(1,1).rotateX(-Math.PI/2), soilMaterial, selected.length); discs.name='Grounded_tree_bases';
      selected.forEach((tree,i)=>{
        dummy.position.set(tree.x,heightAt(tree.x,tree.n)+.025,-tree.n); dummy.rotation.set(0,tree.angle,0);
        const size=1.6+tree.radius*.14; dummy.scale.set(size,1,size); dummy.updateMatrix(); discs.setMatrixAt(i,dummy.matrix);
      });
      discs.instanceMatrix.needsUpdate=true; discs.computeBoundingSphere(); root.add(discs);
    }
  }
  if (contact) {
    // Fixed ambient occlusion around trunks and foundations complements the changing sun shadows.
    const size=1024, image=contact.image;
    image.width=image.height=size;
    const paint=image.getContext('2d'), scale=size/(xmax-xmin);
    const pixel=(x,n)=>[(x-xmin)*scale,(nmax-n)*size/(nmax-nmin)];
    paint.fillStyle='#fff';paint.fillRect(0,0,size,size);
    paint.lineJoin='round';
    for (const outline of footprints) {
      paint.beginPath();
      const [first,...next]=outline.map(([x,n])=>pixel(x,n));
      paint.moveTo(...first);
      for(const point of next)paint.lineTo(...point);
      paint.closePath();
      paint.lineWidth=4;paint.strokeStyle='rgba(0,0,0,.10)';paint.stroke();
      paint.lineWidth=1.5;paint.strokeStyle='rgba(0,0,0,.24)';paint.stroke();
    }
    for(const {x,n,radius} of treeGroups.flat()){
      const [px,py]=pixel(x,n), r=radius*scale*.92;
      const fade=paint.createRadialGradient(px,py,0,px,py,r);
      fade.addColorStop(0,'rgba(0,0,0,.42)');fade.addColorStop(.4,'rgba(0,0,0,.19)');fade.addColorStop(1,'rgba(0,0,0,0)');
      paint.fillStyle=fade;paint.fillRect(px-r,py-r,2*r,2*r);
    }
    contact.needsUpdate=true;
  }
  const stats = { treeCount, waterBodies: waters.length, roadRuns: data.roads.length, roadQuads, markQuads, omittedWetRoadQuads, terrainVertices: heights.length, terrainMaxHeight: Math.max(...heights) };
  return { root, terrain, waterGroup, roadsGroup, treesGroup, heightAt, stats,
    terrainGrid: { heights, cols, rows, xmin, xmax, nmin, nmax } };
}
if (typeof module !== 'undefined') module.exports = createCampusEnvironment;
