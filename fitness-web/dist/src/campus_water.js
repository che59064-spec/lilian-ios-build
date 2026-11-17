function createCampusWater(THREE, renderer, scene, waterGroup, env) {
  const surfaces = waterGroup.children.filter(object => object.isMesh && /^Lake_\d+$/.test(object.name));
  if (!surfaces.length) return { update() {}, invalidate() {}, setSky() {} };

  const height = -1;
  const target = new THREE.WebGLRenderTarget(1, 1, {
    type: renderer.capabilities.isWebGL2 && renderer.extensions.has('EXT_color_buffer_float')
      ? THREE.HalfFloatType : THREE.UnsignedByteType,
    colorSpace: THREE.LinearSRGBColorSpace,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter
  });
  const reflectionMatrix = new THREE.Matrix4();
  const { heights, cols, rows, xmin, xmax, nmin, nmax } = env.terrainGrid;
  const depthRange = 2.5;
  const depthChannels = renderer.capabilities.isWebGL2 ? 1 : 4;
  const depthFormat = depthChannels === 1 ? THREE.RedFormat : THREE.RGBAFormat;
  const depthPixels = new Uint8Array(heights.length * depthChannels);
  for (let i = 0; i < heights.length; i++) {
    depthPixels[i * depthChannels] = Math.round(255 * THREE.MathUtils.clamp((height - heights[i]) / depthRange, 0, 1));
  }
  const lakeDepth = new THREE.DataTexture(depthPixels, cols + 1, rows + 1, depthFormat);
  lakeDepth.minFilter = lakeDepth.magFilter = THREE.LinearFilter;
  lakeDepth.needsUpdate = true;
  const depthGrid = new THREE.Vector4(
    1 / (xmax - xmin), 1 / (nmax - nmin), -xmin / (xmax - xmin), -nmin / (nmax - nmin)
  );
  const depthTexel = new THREE.Vector2(1 / (cols + 1), 1 / (rows + 1));
  const material = surfaces[0].material;
  material.color.setHex(0x31584b);
  material.roughness = .25;
  material.normalScale.set(.62, .49);
  material.transparent = true;
  material.depthWrite = false;
  material.forceSinglePass = true;
  for (const surface of surfaces) surface.renderOrder = -1;
  material.onBeforeCompile = shader => {
    shader.uniforms.lakeReflection = { value: target.texture };
    shader.uniforms.lakeReflectionMatrix = { value: reflectionMatrix };
    shader.uniforms.lakeDepth = { value: lakeDepth };
    shader.uniforms.lakeDepthGrid = { value: depthGrid };
    shader.uniforms.lakeDepthTexel = { value: depthTexel };
    shader.uniforms.lakeDepthRange = { value: depthRange };
    shader.vertexShader = `
uniform mat4 lakeReflectionMatrix;
varying vec4 vLakeReflection;
varying vec2 vLakeEastNorth;
` + shader.vertexShader.replace('#include <project_vertex>', `
  #include <project_vertex>
  vec4 lakeWorldPosition = modelMatrix * vec4(transformed, 1.0);
  vLakeReflection = lakeReflectionMatrix * lakeWorldPosition;
  vLakeEastNorth = vec2(lakeWorldPosition.x, -lakeWorldPosition.z);
`);
    shader.fragmentShader = `
uniform sampler2D lakeReflection;
uniform sampler2D lakeDepth;
uniform vec4 lakeDepthGrid;
uniform vec2 lakeDepthTexel;
uniform float lakeDepthRange;
varying vec4 vLakeReflection;
varying vec2 vLakeEastNorth;
` + shader.fragmentShader.replace('#include <opaque_fragment>', `
  vec2 lakeUV = vLakeReflection.xy / vLakeReflection.w * 0.5 + 0.5;
  lakeUV += (normal.xy - nonPerturbedNormal.xy) * 0.065;
  float rippleA = dot(vLakeEastNorth, vec2(2.1, 5.7));
  float rippleB = dot(vLakeEastNorth, vec2(-3.8, 8.4));
  // Suppress ripples below pixel size so the far bank does not shimmer.
  float rippleFade = 1.0 - smoothstep(0.8, 3.0, max(fwidth(rippleA), fwidth(rippleB)));
  vec2 ripples = vec2(sin(rippleA + 0.65 * sin(rippleB * 0.19)), cos(rippleB + 0.7 * cos(rippleA * 0.37)));
  lakeUV += vec2(0.004, 0.0025) * ripples * rippleFade;
  vec2 lakeEdge = min(lakeUV, vec2(1.0) - lakeUV);
  float lakeCoverage = smoothstep(0.0, 0.015, min(lakeEdge.x, lakeEdge.y));
  vec2 spread = vec2(0.0035, 0.0015) * (0.85 + 0.3 * ripples.y * rippleFade);
  vec3 reflectedLake = texture2D(lakeReflection, lakeUV).rgb * 0.5
    + (texture2D(lakeReflection, lakeUV + spread).rgb + texture2D(lakeReflection, lakeUV - spread).rgb) * 0.25;
  vec2 depthUV = vLakeEastNorth * lakeDepthGrid.xy + lakeDepthGrid.zw;
  depthUV = mix(lakeDepthTexel * 0.5, 1.0 - lakeDepthTexel * 0.5, depthUV);
  float depth = texture2D(lakeDepth, depthUV).r * lakeDepthRange;
  float viewCos = saturate(dot(normal, geometryViewDir));
  float waterCos = sqrt(1.0 - 0.5625 * (1.0 - viewCos * viewCos));
  float scattering = 1.0 - 0.97 * exp(-0.72 * max(0.0, depth - 0.12) / waterCos);
  float fresnel = 0.02 + 0.98 * pow(1.0 - viewCos, 5.0);
  float reflection = (0.02 + 0.62 * fresnel) * lakeCoverage;
  float tint = (1.0 - reflection) * scattering;
  diffuseColor.a = reflection + tint;
  // Preserve warm silt in the shoal and let the blue-green cast build with depth.
  vec3 waterLight = outgoingLight * mix(vec3(1.25, 1.10, 0.79), vec3(0.76, 0.91, 0.99), smoothstep(0.22, 1.50, depth));
  outgoingLight = (tint * waterLight + reflection * reflectedLake * vec3(0.76, 0.81, 0.86)) / diffuseColor.a;
  #include <opaque_fragment>
`);
  };

  waterGroup.updateWorldMatrix(true, true);
  const lakeBounds = surfaces.map(surface => new THREE.Box3().setFromObject(surface));
  const sky = new THREE.Color(0xb6c8d6);
  const size = new THREE.Vector2();
  const direction = new THREE.Vector3();
  const clipPlane = new THREE.Plane();
  const clip = new THREE.Vector4();
  const corner = new THREE.Vector4();
  const viewProjection = new THREE.Matrix4();
  const frustum = new THREE.Frustum();
  const lastCameraWorld = new THREE.Matrix4();
  const lastCameraProjection = new THREE.Matrix4();
  let reflectedCamera;
  let valid = false;

  function update(camera) {
    camera.updateMatrixWorld();
    renderer.getSize(size);
    const limit = size.x <= 720 ? 360 : 768;
    const scale = Math.min(1, limit / Math.max(size.x, size.y));
    const width = Math.max(1, Math.round(size.x * scale));
    const screenHeight = Math.max(1, Math.round(size.y * scale));
    if (valid && width === target.width && screenHeight === target.height
      && lastCameraWorld.equals(camera.matrixWorld)
      && lastCameraProjection.equals(camera.projectionMatrix)) return;

    frustum.setFromProjectionMatrix(viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    if (!lakeBounds.some(box => frustum.intersectsBox(box))) return;

    if (!reflectedCamera || reflectedCamera.type !== camera.type) reflectedCamera = camera.clone();
    reflectedCamera.position.setFromMatrixPosition(camera.matrixWorld);
    reflectedCamera.position.y = 2 * height - reflectedCamera.position.y;
    camera.getWorldDirection(direction);
    direction.y *= -1;
    reflectedCamera.up.setFromMatrixColumn(camera.matrixWorld, 1);
    reflectedCamera.up.y *= -1;
    reflectedCamera.lookAt(direction.add(reflectedCamera.position));
    reflectedCamera.updateMatrixWorld();
    reflectedCamera.projectionMatrix.copy(camera.projectionMatrix);

    // Replace the near plane with the lake plane in reflected-camera coordinates.
    // This clips submerged objects and works for both orthographic and perspective views.
    clipPlane.setComponents(0, 1, 0, -height + .06).applyMatrix4(reflectedCamera.matrixWorldInverse);
    clip.set(clipPlane.normal.x, clipPlane.normal.y, clipPlane.normal.z, clipPlane.constant);
    corner.set(Math.sign(clip.x), Math.sign(clip.y), 1, 1).applyMatrix4(camera.projectionMatrixInverse);
    clip.multiplyScalar(2 / clip.dot(corner));
    const projection = reflectedCamera.projectionMatrix.elements;
    projection[2] = clip.x - projection[3];
    projection[6] = clip.y - projection[7];
    projection[10] = clip.z - projection[11];
    projection[14] = clip.w - projection[15];
    reflectedCamera.projectionMatrixInverse.copy(reflectedCamera.projectionMatrix).invert();
    reflectionMatrix.multiplyMatrices(reflectedCamera.projectionMatrix, reflectedCamera.matrixWorldInverse);

    target.setSize(width, screenHeight);
    const previousTarget = renderer.getRenderTarget();
    const previousBackground = scene.background;
    const hidden = surfaces.filter(surface => surface.visible);
    for (const object of scene.children) {
      if (object.visible && (object.name === 'Campus_navigation' || object.type === 'BoxHelper')) hidden.push(object);
    }
    for (const object of hidden) object.visible = false;
    try {
      scene.background = sky;
      renderer.setRenderTarget(target);
      if (!renderer.autoClear) renderer.clear();
      renderer.render(scene, reflectedCamera);
    } finally {
      renderer.setRenderTarget(previousTarget);
      scene.background = previousBackground;
      for (const object of hidden) object.visible = true;
    }
    lastCameraWorld.copy(camera.matrixWorld);
    lastCameraProjection.copy(camera.projectionMatrix);
    valid = true;
  }

  return {
    update,
    invalidate() { valid = false; },
    setSky(color) { sky.copy(color); valid = false; }
  };
}

if (typeof module !== 'undefined') module.exports = createCampusWater;
