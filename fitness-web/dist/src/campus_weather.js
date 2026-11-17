const CAMPUS_WEATHER_LOCATION = { latitude: 23.14195, longitude: 113.0216, timezone: 'Asia/Shanghai' };
const CAMPUS_WEATHER_URL = 'https://api.open-meteo.com/v1/forecast?' + new URLSearchParams({
  latitude: CAMPUS_WEATHER_LOCATION.latitude,
  longitude: CAMPUS_WEATHER_LOCATION.longitude,
  timezone: CAMPUS_WEATHER_LOCATION.timezone,
  timeformat: 'unixtime',
  current: 'temperature_2m,weather_code,cloud_cover,precipitation'
});
const CAMPUS_WEATHER_CACHE = 'campus-weather-v1';
const WEATHER_REFRESH_MS = 15 * 60_000;
const WEATHER_RETRY_MS = 5 * 60_000;
const WEATHER_CACHE_MAX_AGE_MS = 90 * 60_000;

// A distant sky is only shown from the ground-level camera. It follows the
// camera, so it never changes the coordinates of the campus or navigation.
function createCampusAtmosphere(THREE, scene, photoUrl, onLoad) {
  const skyPhoto = new THREE.TextureLoader().load(photoUrl, () => {
    material.uniforms.photoReady.value = 1;
    onLoad();
  });
  skyPhoto.colorSpace = THREE.SRGBColorSpace;
  skyPhoto.wrapS = THREE.RepeatWrapping;
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      daylight: { value: 1 }, clouds: { value: .24 }, sunAbove: { value: 1 },
      sunDirection: { value: new THREE.Vector3(0, 1, 0) },
      skyPhoto: { value: skyPhoto }, photoReady: { value: 0 }
    },
    vertexShader: `varying vec3 skyDirection;
      varying vec2 skyUV;
      void main(){skyDirection=normalize(position);skyUV=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader: `
      varying vec3 skyDirection;
      varying vec2 skyUV;
      uniform float daylight, clouds, sunAbove;
      uniform vec3 sunDirection;
      uniform sampler2D skyPhoto;
      uniform float photoReady;
      float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float noise(vec2 p){
        vec2 i=floor(p), f=fract(p);f=f*f*(3.0-2.0*f);
        return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+1.),f.x),f.y);
      }
      void main(){
        vec3 d=normalize(skyDirection);
        float h=max(d.y,0.0);
        float overcast=smoothstep(.55,1.0,clouds);
        vec3 dayHorizon=mix(vec3(.30,.49,.72),vec3(.56,.60,.63),overcast);
        vec3 dayZenith=mix(vec3(.075,.24,.51),vec3(.34,.39,.44),overcast);
        vec3 horizon=mix(vec3(.07,.09,.15),dayHorizon,daylight);
        vec3 zenith=mix(vec3(.009,.015,.035),dayZenith,daylight);
        vec3 color=mix(horizon,zenith,pow(smoothstep(0.0,.9,h),.55));
        // A cloud layer in perspective: separate rounded lobes and small distant clouds.
        vec2 p=d.xz/max(.10,d.y+.10)*2.1;
        vec2 warp=vec2(noise(p*.48+2.7),noise(p*.48+13.2))-.5;
        p+=warp*.72;
        float broad=noise(p*.72);
        float lobes=noise(p*1.65+7.1);
        float fine=noise(p*3.7-3.6);
        float cloudNoise=.48*broad+.33*lobes+.19*fine;
        float cover=mix(.62,.39,clouds);
        float cloud=smoothstep(cover,cover+.075,cloudNoise)*smoothstep(.006,.075,h)*daylight;
        // Darker bases and brighter scalloped tops suggest depth without ray marching.
        float relief=clamp(.60+(lobes-.5)*.65+(fine-.5)*.25,0.0,1.0);
        vec3 cloudBase=mix(vec3(.35,.39,.44),vec3(.69,.73,.77),sunAbove);
        vec3 cloudTop=mix(vec3(.61,.64,.68),vec3(1.20,1.19,1.15),sunAbove);
        vec3 cloudColor=mix(cloudBase,cloudTop,relief);
        color=mix(color,cloudColor,cloud*.95);
        float toward=max(dot(d,normalize(sunDirection)),0.0);
        color+=vec3(1.0,.84,.64)*pow(toward,96.0)*.12*sunAbove*(1.0-cloud*.7);
        // Align the sky photograph's bright sector with the calculated solar azimuth.
        vec2 photoUV=vec2(1.08-skyUV.x-atan(sunDirection.z,sunDirection.x)*.15915494,skyUV.y);
        vec3 photo=texture2D(skyPhoto,photoUV).rgb;
        photo=mix(photo,horizon,.10+.13*(1.0-smoothstep(.03,.28,h)));
        float photoWeight=photoReady*sunAbove*(1.0-overcast)*smoothstep(-.015,.055,d.y);
        color=mix(color,photo*1.16,photoWeight);
        gl_FragColor=vec4(color,1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(2400, 32, 16), material);
  dome.name = 'Ground_view_atmosphere'; dome.frustumCulled = false; dome.renderOrder = -1000;
  dome.visible = false;
  scene.add(dome);
  return {
    update(state) {
      const elevation = state.solar.altitude * 180 / Math.PI;
      const smooth = (low, high, n) => { const t = Math.max(0, Math.min(1, (n-low)/(high-low))); return t*t*(3-2*t); };
      material.uniforms.daylight.value = smooth(-7, 6, elevation);
      material.uniforms.sunAbove.value = smooth(-.5, 16, elevation);
      material.uniforms.clouds.value = state.weather ? Math.max(.22, state.weather.cloudCover / 100) : .28;
      material.uniforms.sunDirection.value.fromArray(state.solar.direction).normalize();
    },
    follow(camera) {
      dome.visible = !!camera.isPerspectiveCamera;
      if (dome.visible) dome.position.copy(camera.position);
    },
    dispose() { scene.remove(dome); dome.geometry.dispose(); material.dispose(); skyPhoto.dispose(); }
  };
}

function campusSun(date) {
  // US Naval Observatory approximate solar coordinates and equation of time.
  // https://aa.usno.navy.mil/faq/sun_approx
  const rad = Math.PI / 180;
  const days = date.getTime() / 86_400_000 - 10_957.5;
  const anomaly = (357.529 + .98560028 * days) * rad;
  const meanLongitude = ((280.459 + .98564736 * days) % 360) * rad;
  const longitude = meanLongitude + (1.915 * Math.sin(anomaly) + .020 * Math.sin(2 * anomaly)) * rad;
  const tilt = (23.439 - .00000036 * days) * rad;
  const rightAscension = Math.atan2(Math.cos(tilt) * Math.sin(longitude), Math.cos(longitude));
  const declination = Math.asin(Math.sin(tilt) * Math.sin(longitude));
  const equationOfTime = Math.atan2(Math.sin(meanLongitude - rightAscension), Math.cos(meanLongitude - rightAscension));
  const utcHours = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  const hourAngle = (utcHours * 15 + CAMPUS_WEATHER_LOCATION.longitude - 180) * rad + equationOfTime;
  const latitude = CAMPUS_WEATHER_LOCATION.latitude * rad;
  const east = -Math.cos(declination) * Math.sin(hourAngle);
  const up = Math.sin(latitude) * Math.sin(declination) + Math.cos(latitude) * Math.cos(declination) * Math.cos(hourAngle);
  const north = Math.cos(latitude) * Math.sin(declination) - Math.sin(latitude) * Math.cos(declination) * Math.cos(hourAngle);
  return {
    altitude: Math.asin(Math.max(-1, Math.min(1, up))),
    azimuth: (Math.atan2(east, north) + 2 * Math.PI) % (2 * Math.PI),
    direction: [east, up, -north]
  };
}

function campusWeatherLabel(code) {
  if (code === 0) return '晴';
  if (code === 1 || code === 2) return '多云';
  if (code === 3) return '阴';
  if (code === 45 || code === 48) return '雾';
  if (code >= 51 && code <= 57) return '毛毛雨';
  if (code >= 61 && code <= 67) return '雨';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return '雪';
  if (code >= 80 && code <= 82) return '阵雨';
  if (code >= 95 && code <= 99) return '雷阵雨';
  return '天气模型';
}

function createCampusWeather(onChange, initialMode = 'live') {
  let mode = initialMode === 'preview' ? 'preview' : 'live';
  let snapshot = null;
  let modelFetched = false;
  let state;
  let nextAttempt = 0;
  let request;
  let disposed = false;
  try { snapshot = JSON.parse(localStorage.getItem(CAMPUS_WEATHER_CACHE)); } catch { /* file URLs can have storage disabled */ }

  function isRecent(data, now, maxAge) {
    return data && [data.time, data.code, data.cloudCover, data.precipitation, data.temperature].every(Number.isFinite)
      && data.cloudCover >= 0 && data.cloudCover <= 100 && data.precipitation >= 0
      && data.time > now - maxAge && data.time <= now + WEATHER_REFRESH_MS;
  }

  function publish() {
    const localTime = new Date();
    if (mode === 'preview') {
      // 15:00 in China Standard Time, on the current campus calendar date.
      const campusDay = new Date(localTime.getTime() + 8 * 3_600_000);
      localTime.setTime(Date.UTC(campusDay.getUTCFullYear(), campusDay.getUTCMonth(), campusDay.getUTCDate(), 7));
    }
    const current = mode === 'live' && isRecent(snapshot, localTime.getTime(), WEATHER_CACHE_MAX_AGE_MS);
    const weather = mode === 'preview'
      ? { code: 0, cloudCover: 0, precipitation: 0, temperature: null, observedAt: null }
      : current ? {
        code: snapshot.code, cloudCover: snapshot.cloudCover, precipitation: snapshot.precipitation,
        temperature: snapshot.temperature, observedAt: new Date(snapshot.time)
      } : null;
    state = {
      mode,
      source: mode === 'preview' ? 'preview' : current ? (modelFetched ? 'model' : 'cached') : 'solar',
      solar: campusSun(localTime),
      weather,
      weatherLabel: weather ? campusWeatherLabel(weather.code) : '',
      localTime
    };
    onChange(state);
  }

  async function refresh() {
    if (disposed || mode !== 'live' || request || Date.now() < nextAttempt) return;
    const controller = new AbortController();
    request = controller;
    const timeout = setTimeout(() => controller.abort(), 6500);
    try {
      const response = await fetch(CAMPUS_WEATHER_URL, { signal: controller.signal, credentials: 'omit' });
      if (!response.ok) throw new Error('Weather API unavailable');
      const { current } = await response.json();
      const now = Date.now();
      const fresh = {
        time: Number.isFinite(current.time) ? current.time * 1000 : NaN,
        code: current.weather_code,
        cloudCover: current.cloud_cover,
        precipitation: current.precipitation,
        temperature: current.temperature_2m
      };
      if (!isRecent(fresh, now, 2 * WEATHER_REFRESH_MS)) throw new Error('Missing or stale weather');
      if (disposed) return;
      snapshot = fresh;
      modelFetched = true;
      nextAttempt = now + WEATHER_REFRESH_MS;
      try { localStorage.setItem(CAMPUS_WEATHER_CACHE, JSON.stringify(snapshot)); } catch { /* retain in-memory data */ }
    } catch {
      modelFetched = false;
      nextAttempt = Date.now() + WEATHER_RETRY_MS;
    } finally {
      request = null;
      clearTimeout(timeout);
    }
    if (!disposed && mode === 'live') publish();
  }

  function tick() {
    publish();
    void refresh();
  }

  tick();
  const timer = setInterval(tick, 60_000);
  return {
    getState: () => state,
    setMode(next) {
      if (disposed || (next !== 'preview' && next !== 'live') || mode === next) return;
      mode = next;
      tick();
    },
    refresh,
    dispose() {
      disposed = true;
      clearInterval(timer);
      request?.abort();
    }
  };
}
