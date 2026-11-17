function enableGlassRefraction() {
  const filters = document.getElementById('glass-filters');
  if (!filters || !/Chrome\//.test(navigator.userAgent) || !CSS.supports('backdrop-filter','url(#campus-glass)')) return;
  for (const [index, panel] of [...document.querySelectorAll('.panel,.compass')].entries()) {
    const id = `campus-glass-${index}`;
    const svg = 'http://www.w3.org/2000/svg';
    const filter = document.createElementNS(svg, 'filter');
    filter.id = id;
    filter.setAttribute('color-interpolation-filters','sRGB');
    const map = document.createElementNS(svg, 'feImage');
    map.setAttribute('preserveAspectRatio','none');
    map.setAttribute('result','glassMap');
    const refract = document.createElementNS(svg, 'feDisplacementMap');
    for (const [key, value] of Object.entries({in:'SourceGraphic',in2:'glassMap',scale:'-120',xChannelSelector:'R',yChannelSelector:'G'})) refract.setAttribute(key,value);
    filter.append(map,refract);
    filters.append(filter);
    panel.style.setProperty('--glass-refraction',`url(#${id})`);
    new ResizeObserver(() => {
      const w = panel.offsetWidth, h = panel.offsetHeight;
      if (!w || !h) return;
      const radius = Math.min(parseFloat(getComputedStyle(panel).borderTopLeftRadius),w/2,h/2);
      const edge = Math.min(w,h)*.06;
      const image = `<svg xmlns="${svg}" width="${w}" height="${h}"><defs><linearGradient id="x" x1="100%" x2="0%"><stop stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="red"/></linearGradient><linearGradient id="y" x2="0%" y2="100%"><stop stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="lime"/></linearGradient><filter id="soft"><feGaussianBlur stdDeviation="7"/></filter></defs><rect width="100%" height="100%" fill="#808080"/><rect width="100%" height="100%" rx="${radius}" fill="url(#x)"/><rect width="100%" height="100%" rx="${radius}" fill="url(#y)" style="mix-blend-mode:screen"/><rect x="${edge}" y="${edge}" width="${w-edge*2}" height="${h-edge*2}" rx="${radius}" fill="#808080" fill-opacity=".96" filter="url(#soft)"/></svg>`;
      map.setAttribute('href',`data:image/svg+xml,${encodeURIComponent(image)}`);
      panel.dataset.refractive = '';
    }).observe(panel);
  }
}

(() => {
  const canvas=document.getElementById('scene'),scene=new THREE.Scene();
  enableGlassRefraction();
  const headerPanel=document.querySelector('header');
  new ResizeObserver(()=>{
    const bounds=headerPanel.getBoundingClientRect();
    if(bounds.height)document.documentElement.style.setProperty('--campus-header-bottom',`${bounds.bottom}px`);
  }).observe(headerPanel);
  scene.background=new THREE.Color(0xdde5e9);scene.fog=new THREE.Fog(0xdde5e9,2400,4400);
  const renderer=new THREE.WebGLRenderer({canvas,antialias:true,preserveDrawingBuffer:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.6));renderer.setSize(innerWidth,innerHeight);
  renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.02;
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.shadowMap.autoUpdate=false;
  const camera=new THREE.OrthographicCamera(-1,1,1,-1,1,6000);
  // Clear afternoon light from the southwest, approximately 32° above the horizon.
  const ambient=new THREE.HemisphereLight(0xd5e7ff,0xa3a088,1.05);
  scene.add(ambient);
  const sunDirection=new THREE.Vector3(-899,700,683);
  const sun=new THREE.DirectionalLight(0xffe8ce,3.45);sun.position.copy(sunDirection);sun.castShadow=true;
  const shadowSize=innerWidth<=720?2048:4096;sun.shadow.mapSize.set(shadowSize,shadowSize);Object.assign(sun.shadow.camera,{left:-1180,right:1180,top:1180,bottom:-1180,near:5,far:3400});sun.shadow.camera.updateProjectionMatrix();sun.shadow.bias=-.000016;sun.shadow.normalBias=.1;scene.add(sun,sun.target);
  const skyCanvas=document.createElement('canvas');skyCanvas.width=512;skyCanvas.height=256;
  const skyContext=skyCanvas.getContext('2d'),skyGradient=skyContext.createLinearGradient(0,0,0,256);
  skyGradient.addColorStop(0,'#87acdb');skyGradient.addColorStop(.47,'#dce6ed');skyGradient.addColorStop(.54,'#d5d5bc');skyGradient.addColorStop(1,'#6d7565');skyContext.fillStyle=skyGradient;skyContext.fillRect(0,0,512,256);
  const skyTexture=new THREE.CanvasTexture(skyCanvas);skyTexture.colorSpace=THREE.SRGBColorSpace;skyTexture.mapping=THREE.EquirectangularReflectionMapping;
  const pmrem=new THREE.PMREMGenerator(renderer);scene.environment=pmrem.fromEquirectangular(skyTexture).texture;skyTexture.dispose();pmrem.dispose();
  const model=createCampusBuildings(THREE,CAMPUS_DATA);
  const env=createCampusEnvironment(THREE,CAMPUS_DATA,CAMPUS_ASSETS);
  const nav=createCampusNavigation(THREE,CAMPUS_DATA,scene,env);
  const street=createCampusStreet(THREE,env,innerWidth/innerHeight);
  const atmosphere=createCampusAtmosphere(THREE,scene,CAMPUS_ASSETS.sky,()=>{waterReflection.invalidate();dirty=true;});
  scene.add(env.root,model.root,model.sports);
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(6000,6000),new THREE.MeshStandardMaterial({color:0xd8dfcf,roughness:1}));floor.rotation.x=-Math.PI/2;floor.position.y=-9;floor.name='Distant_ground';floor.receiveShadow=true;scene.add(floor);
  const reflectedMaterials=new Set();
  scene.traverse(o=>{if(o.isMesh&&o.material.isMeshStandardMaterial)reflectedMaterials.add(o.material);});
  const waterReflection=createCampusWater(THREE,renderer,scene,env.waterGroup,env);
  for(const g of model.root.children) {
    const s=g.userData.sign;if(!s)continue;
    const c=document.createElement('canvas');c.width=512;c.height=96;const ctx=c.getContext('2d');ctx.fillStyle='#e4ddcd';ctx.font='bold 70px "KaiTi","Microsoft YaHei",serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(s.text,256,48);
    const tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;
    const mesh=new THREE.Mesh(new THREE.PlaneGeometry(s.w,s.h),new THREE.MeshBasicMaterial({map:tex,transparent:true,depthWrite:false,side:THREE.DoubleSide}));mesh.name=g.name+'_sign';mesh.rotation.y=s.angle||0;mesh.position.set(s.x,s.y,-s.n);g.add(mesh);
  }
  const trees=env.stats.treeCount??env.stats.trees??0;document.getElementById('tree-count').textContent=Number(trees).toLocaleString('en-US');
  let az=-.65,el=.69,orth=690,target=new THREE.Vector3(0,0,0),dirty=true,flight=null,selectedBuilding=null;
  THREE.DefaultLoadingManager.onLoad=()=>{waterReflection.invalidate();dirty=true;};
  model.texturesReady?.then(()=>{waterReflection.invalidate();dirty=true;});
  const views={
    overall:{az:-.66,el:.67,orth:810,x:0,n:0},
    teaching:{az:-.65,el:.69,orth:285,x:-305,n:-200},
    clock:{az:.54,el:.32,orth:80,x:-166,n:-359},
    courts:{az:-2.4,el:.67,orth:125,x:-462,n:-402},
    dorm:{az:1.1,el:.68,orth:270,x:360,n:345},
    top:{az:0,el:Math.PI/2-.001,orth:795,x:0,n:-10}
  };
  let shadowKey='';
  function positionShadows(x,z,extent){
    const key=[extent,x,z].join(',');
    if(key===shadowKey)return;
    sun.target.position.set(x,0,z);
    sun.position.copy(sun.target.position).add(sunDirection);
    Object.assign(sun.shadow.camera,{left:-extent,right:extent,top:extent,bottom:-extent});
    sun.shadow.camera.updateProjectionMatrix();
    renderer.shadowMap.needsUpdate=true;
    shadowKey=key;
  }
  function position(){const a=innerWidth/innerHeight;camera.left=-orth*a;camera.right=orth*a;camera.top=orth;camera.bottom=-orth;camera.position.set(target.x+1800*Math.sin(az)*Math.cos(el),target.y+1800*Math.sin(el),target.z+1800*Math.cos(az)*Math.cos(el));camera.lookAt(target);camera.updateProjectionMatrix();
    positionShadows(target.x,target.z,Math.max(180,Math.min(1180,orth*Math.max(a,1.4)*1.8)));
    dirty=true;
  }
  function flyTo(v,ms){flight={start:performance.now(),duration:ms||800,from:{az,el,orth,x:target.x,y:target.y,z:target.z},to:{az:v.az??az,el:v.el??el,orth:v.orth??orth,x:v.x??target.x,y:v.y??target.y,z:v.z??target.z}};dirty=true;}
  function stepFlight(t){if(!flight)return;const k=Math.min(1,(t-flight.start)/flight.duration),e=k<.5?4*k*k*k:1-Math.pow(-2*k+2,3)/2,from=flight.from,to=flight.to;az=from.az+(to.az-from.az)*e;el=from.el+(to.el-from.el)*e;orth=from.orth+(to.orth-from.orth)*e;target.x=from.x+(to.x-from.x)*e;target.y=from.y+(to.y-from.y)*e;target.z=from.z+(to.z-from.z)*e;position();if(k>=1)flight=null;}
  function applyView(name){flight=null;const v=views[name]||views.overall;({az,el,orth}=v);if(name==='overall')orth=Math.max(orth,1050/(innerWidth/innerHeight));target.set(v.x,0,-v.n);position();document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===name));}
  const params=new URLSearchParams(location.search);if(params.get('clean')==='1')document.body.classList.add('clean');
  applyView(params.get('view')||'overall');
  document.querySelector('.explore').before(document.getElementById('weather-settings').content.cloneNode(true));
  const weatherStatus=document.getElementById('weather-status');
  const weatherButton=document.getElementById('weather-mode');
  const timeFormat=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hour12:false});
  const skyColor=new THREE.Color();
  const daySky=new THREE.Color(0xc8e2f5),cloudSky=new THREE.Color(0xc0cedb);
  const duskSky=new THREE.Color(0xd2a28b),nightSky=new THREE.Color(0x35455e);
  let haze=0;
  function applyWeather(state) {
    atmosphere.update(state);
    const {mode,source,solar,weather,weatherLabel,localTime}=state;
    const elevation=solar.altitude*180/Math.PI;
    const daylight=THREE.MathUtils.smoothstep(elevation,-9,10);
    const sunAbove=THREE.MathUtils.smoothstep(elevation,-.5,16);
    const cloud=THREE.MathUtils.clamp((weather?.cloudCover??(mode==='preview'?8:25))/100,0,1);
    const rainCode=weather?.code??0;
    const wetWeather=(rainCode>=51&&rainCode<=67)||(rainCode>=80&&rainCode<=82)||rainCode>=95;
    const rain=Math.min(1,Math.max((weather?.precipitation??0)*1.6,wetWeather?.42:0));
    const mist=(rainCode===45||rainCode===48)?.85:rain*.7;
    haze=mist;
    const shadowStrength=(1-.88*Math.pow(cloud,1.45))*(1-.63*rain);
    sun.intensity=3.1*sunAbove*shadowStrength;
    sun.castShadow=sun.intensity>.14;
    sunDirection.fromArray(solar.direction).multiplyScalar(1350);
    sun.color.setRGB(1, .68+.29*sunAbove, .48+.43*sunAbove);
    ambient.intensity=THREE.MathUtils.lerp(.28,1.22+.36*cloud,daylight);
    ambient.color.set(0xa1bde8).lerp(new THREE.Color(0xe1eeff),daylight);
    ambient.groundColor.set(0x65748c).lerp(new THREE.Color(0xb5b29a),daylight);
    skyColor.copy(daySky).lerp(cloudSky,Math.max(cloud,rain));
    if(elevation<12)skyColor.lerp(duskSky,(1-sunAbove)*.58*(1-cloud));
    skyColor.lerp(nightSky,1-daylight);
    scene.background.copy(skyColor);
    scene.fog.color.copy(skyColor);
    document.body.classList.toggle('dim-map',daylight<.5);
    waterReflection.setSky(skyColor);
    for(const material of reflectedMaterials){
      const glazed=material===model.materials.glass||material===model.materials.windowPane||material===model.materials.teachingGlass;
      const base=glazed?.68:material.name==='Jade_lake_water'?.46:.24;
      material.envMapIntensity=base*(.18+.82*daylight);
    }
    weatherStatus.textContent=mode==='preview'?'晴天下午预览':[
      timeFormat.format(localTime),weather?`${weatherLabel||'校园天气'} ${Math.round(weather.temperature)}°`:'按校园时间',source==='cached'?'上次天气':''
    ].filter(Boolean).join(' · ');
    weatherButton.textContent=mode==='preview'?'切回实时天气':'晴天下午预览';
    weatherButton.setAttribute('aria-pressed',String(mode==='preview'));
    shadowKey='';
    position();
  }
  const campusWeather=createCampusWeather(applyWeather,params.get('weather')==='preview'?'preview':'live');
  weatherButton.onclick=()=>campusWeather.setMode(campusWeather.getState().mode==='preview'?'live':'preview');
  const compass=document.getElementById('compass-reset');
  const compassNeedle=document.getElementById('needle');
  const compassNorth=document.getElementById('north');
  compass.onclick=()=>{
    const turn=THREE.MathUtils.euclideanModulo(az+Math.PI,2*Math.PI)-Math.PI;
    document.getElementById('spin').checked=false;
    flyTo({az:az-turn},380);
  };
  const labelData=[];
  for(const b of CAMPUS_DATA.buildings){if(!b.n)continue;const d=document.createElement('div');d.className='label';d.textContent=b.n;d.hidden=true;document.body.appendChild(d);const box=new THREE.Box3().setFromObject(model.root.children.find(g=>g.userData.seq===b.s)),center=box.getCenter(new THREE.Vector3());labelData.push({element:d,b,position:new THREE.Vector3(center.x,box.max.y+5,center.z)});}
  const projected=new THREE.Vector3();
  function labels(){const shown=[];const show=document.getElementById('labels').checked&&!document.body.classList.contains('clean');const candidates=labelData.slice().sort((a,b)=>Number(/^\d+栋$/.test(a.b.n))-Number(/^\d+栋$/.test(b.b.n)));
    const obstacles=[document.querySelector('header'),document.getElementById('controls-panel'),document.getElementById('info')].filter(e=>e && e.getClientRects().length).map(e=>e.getBoundingClientRect());
    for(const l of candidates){l.element.hidden=true;if(!show||orth>400&&(/^\d+栋$/.test(l.b.n)||!['B84','B85','B60','B10','B49','B74'].includes(l.b.s)))continue;projected.copy(l.position).project(camera);if(projected.z>1||Math.abs(projected.x)>.97||Math.abs(projected.y)>.94)continue;const x=(projected.x+1)*innerWidth/2,y=(1-projected.y)*innerHeight/2,w=l.b.n.length*12+16;
      if(obstacles.some(r=>x+w/2>r.left&&x-w/2<r.right&&y>r.top&&y-24<r.bottom)||shown.some(r=>Math.abs(x-r.x)<(w+r.w)/2+4&&Math.abs(y-r.y)<24))continue;
      shown.push({x,y,w});l.element.hidden=false;l.element.style.left=x+'px';l.element.style.top=y+'px';}
  }
  document.querySelectorAll('details').forEach(d=>d.addEventListener('toggle',()=>{dirty=true;}));
  document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>applyView(b.dataset.view));
  const navFrom=document.getElementById('nav-from'),navTo=document.getElementById('nav-to'),navResult=document.getElementById('nav-result');
  function endpointGroups(){
    const gates=document.createElement('optgroup');gates.label='校园出入口';
    for(const g of CAMPUS_DATA.gates){const o=document.createElement('option');o.value=g.id;o.textContent=g.name;gates.appendChild(o);}
    const buildings=document.createElement('optgroup');buildings.label='建筑';
    // 导航只列有真实名称的建筑，未命名楼栋仍可在 3D 里点选后“导航到这里”。
    for(const b of CAMPUS_DATA.buildings.filter(b=>b.n).sort((a,b)=>a.n.localeCompare(b.n,'zh-Hans-CN'))){const o=document.createElement('option');o.value=b.s;o.textContent=b.n;buildings.appendChild(o);}
    return [gates,buildings];
  }
  navFrom.append(...endpointGroups());navTo.append(...endpointGroups());
  const currentLocationOption=new Option('我的位置（GPS）','current-location');
  navFrom.prepend(currentLocationOption);
  const navPlaceholder=document.createElement('option');navPlaceholder.value='';navPlaceholder.textContent='选择目的地…';navTo.prepend(navPlaceholder);navTo.value='';
  navFrom.value=matchMedia('(pointer:coarse)').matches&&isSecureContext&&navigator.geolocation?'current-location':'gate-east';
  const navGo=document.getElementById('nav-go');
  const navPreview=document.getElementById('nav-preview');
  const updateStartButton=()=>{
    const gps=navFrom.value==='current-location';
    navGo.textContent=gps?'定位并导航':'开始导航';
    navPreview.disabled=gps;
    navPreview.title=gps?'选校门或建筑作起点即可预览路线':'';
  };
  updateStartButton();
  const navType=id=>id.startsWith('gate-')?'gate':'building';
  function navMessage(text){navResult.classList.add('show');navResult.textContent='';const span=document.createElement('span');span.className='note';span.textContent=text;navResult.appendChild(span);}
  const controlsPanel=document.getElementById('controls-panel');
  const streetHud=document.getElementById('street-hud');
  const streetArrow=document.getElementById('street-arrow');
  const streetMeters=document.getElementById('street-meters');
  const streetInstruction=document.getElementById('street-instruction');
  const streetDestination=document.getElementById('street-destination');
  const streetRemaining=document.getElementById('street-remaining');
  const streetPause=document.getElementById('street-pause');
  const streetNext=document.getElementById('street-next');
  const streetReplan=document.getElementById('street-replan');
  const streetLocation=document.getElementById('street-location');
  const streetControls=streetLocation.closest('.street-controls');
  const streetExit=document.getElementById('street-exit');
  const arrowPaths={
    straight:'M16 26V7m-8 8 8-8 8 8',
    left:'M21 26V12a4 4 0 0 0-4-4H6m6-6-6 6 6 6',
    right:'M11 26V12a4 4 0 0 1 4-4h11m-6-6 6 6-6 6',
    uturn:'M23 25V13a7 7 0 0 0-14 0v11m-5-5 5 5 5-5',
    arrive:'m7 16 6 6L25 9'
  };
  let directions=null;
  let locationDestination=null;
  let locationAction='';
  let streetUiKey='';
  let lastStreetReflection=-Infinity;
  const formatDistance=meters=>meters>=1000?`${(meters/1000).toFixed(1)} 公里`:`${Math.ceil(Math.max(0,meters))} 米`;
  function updateStreetHud(state=street.getState()){
    const sign=directions.at(state.traveled);
    const remaining=state.complete?'已到达':`剩余 ${formatDistance(state.remaining)}`;
    const meters=state.complete?'已到达':formatDistance(sign.meters);
    const key=[sign.kind,sign.text,meters,remaining,state.paused,state.complete].join('|');
    if(key===streetUiKey)return;
    streetUiKey=key;
    streetArrow.setAttribute('d',arrowPaths[sign.kind]);
    streetMeters.textContent=meters;
    const text=state.complete?'已到达目的地':sign.text;
    if(streetInstruction.textContent!==text)streetInstruction.textContent=text;
    streetRemaining.textContent=remaining;
    streetPause.textContent=state.complete?'重新出发':state.paused?'继续':'暂停';
    streetNext.textContent=sign.nextMeters>=directions.totalMeters-.1?'到终点':'到下一路口';
    streetNext.disabled=state.complete;
  }
  function setLocationControls(active){
    streetControls.toggleAttribute('data-location',active);
    streetLocation.hidden=!active;
    streetPause.hidden=active;
    streetNext.hidden=active;
    streetReplan.hidden=true;
    locationAction='';
  }
  function startStreet(route,followLocation=false){
    if(!street.start(route))return false;
    if(followLocation)street.step(0);
    directions=createCampusDirections(route.points);
    streetUiKey='';
    lastStreetReflection=-Infinity;
    flight=null;
    drag=null;
    closeBuildingInfo();
    nav.show(route,{street:true});
    streetDestination.textContent=route.to;
    document.body.classList.add('street-active');
    streetHud.hidden=false;
    setLocationControls(followLocation);
    updateStreetHud();
    if(!followLocation)streetPause.focus({preventScroll:true});
    dirty=true;
    return true;
  }
  function stopStreet(){
    locationDestination=null;
    gpsTracker.stop();
    if(!street.getState().active)return;
    street.stop();
    directions=null;
    document.body.classList.remove('street-active');
    streetHud.hidden=true;
    const route=nav.route();
    if(route){nav.show(route);frameRoute(route.points);}
    (controlsPanel.open?navGo:controlsPanel.querySelector('summary')).focus({preventScroll:true});
    position();
  }
  streetPause.onclick=()=>{
    street.togglePause();
    updateStreetHud();
    dirty=true;
  };
  streetNext.onclick=()=>{
    const {traveled,paused}=street.getState();
    const sign=directions.at(traveled);
    street.step(Math.max(1,sign.nextMeters-traveled+1));
    if(!paused&&!street.getState().complete)street.togglePause();
    lastStreetReflection=-Infinity;
    updateStreetHud();
    dirty=true;
  };
  streetExit.onclick=stopStreet;
  addEventListener('keydown',e=>{
    if(e.key==='Escape'&&(directions||locationDestination)){e.preventDefault();stopStreet();}
  });
  addEventListener('pagehide',()=>{
    if(locationDestination)stopStreet();
  });
  function clearRoute(){stopStreet();nav.clear();navResult.classList.remove('show');navResult.textContent='';document.getElementById('nav-summary').textContent='选择起点与目的地';dirty=true;}
  function frameRoute(points){
    const center=new THREE.Box2();
    for(const [x,north] of points)center.expandByPoint(new THREE.Vector2(x,-north));
    const focus=center.getCenter(new THREE.Vector2());
    const viewElevation=Math.max(el,.84);
    let halfWidth=0,halfHeight=0;
    for(const [x,north] of points){
      const dx=x-focus.x,dz=-north-focus.y;
      halfWidth=Math.max(halfWidth,Math.abs(dx*Math.cos(az)-dz*Math.sin(az)));
      halfHeight=Math.max(halfHeight,Math.abs(dx*Math.sin(az)+dz*Math.cos(az))*Math.sin(viewElevation));
    }
    const size=Math.max(45,halfWidth*innerHeight/(innerWidth*.78),halfHeight/.73);
    flyTo({x:focus.x,y:0,z:focus.y,orth:size,el:viewElevation},650);
  }
  function showRouteSummary(result){
    navResult.classList.add('show');navResult.textContent='';
    const title=document.createElement('b');
    title.textContent=(result.distance>=1000?(result.distance/1000).toFixed(2)+' km':Math.round(result.distance)+' m')+' · 步行约 '+result.minutes+' 分钟';
    navResult.appendChild(title);
    const endpoints=document.createElement('span');
    endpoints.textContent=`${result.from} → ${result.to}`;
    navResult.appendChild(endpoints);
    const via=document.createElement('span');via.textContent='途经：'+(result.roads.length?result.roads.join(' → '):'校内步行道');navResult.appendChild(via);
    const note=document.createElement('span');note.className='note';
    note.textContent=navType(navTo.value)==='gate'?'终点为校园出入口。':result.approach>25?'终点前约 '+Math.round(result.approach)+' m 为楼前接通段，现场请以步道为准。':'路线沿校园道路，终点在建筑入口一侧。';
    if(result.offroad>0)note.textContent+=` 路网中约 ${Math.ceil(result.offroad)} 米为估算连接，仅供预览。`;
    navResult.appendChild(note);
    document.getElementById('nav-summary').textContent=title.textContent;
  }
  const locationMessages={
    locating:'正在获取手机位置…', inaccurate:'定位精度不足，请到开阔处等候',
    offroute:'当前位置已偏离路线', backtracking:'当前位置在路线后方', stale:'定位暂时中断，等待新位置',
    denied:'定位权限未开启，请在浏览器中允许定位', unavailable:'暂时无法取得位置，请到室外重试',
    timeout:'定位超时，请在室外重试', unsupported:'此浏览器不支持定位',
    insecure:'手机定位需要在 HTTPS 网页中打开'
  };
  function planFromPosition(point){
    const result=nav.graph.route({type:'position',point},locationDestination);
    if(!result)return false;
    if(!startStreet(result,true))return false;
    showRouteSummary(result);
    gpsTracker.setRoute(result);
    return true;
  }
  function showLocationIssue(state,message){
    streetUiKey='';
    streetArrow.setAttribute('d','M16 7v11m0 6v1');
    streetMeters.textContent='指引已暂停';
    if(streetInstruction.textContent!==message)streetInstruction.textContent=message;
    streetRemaining.textContent='';
    streetLocation.textContent='';
    streetLocation.hidden=true;
    locationAction=(state.status==='offroute'||state.status==='backtracking')&&state.point?'replan':
      ['timeout','unavailable','denied'].includes(state.status)?'retry':'';
    streetReplan.hidden=!locationAction;
    streetReplan.textContent=locationAction==='retry'?'重试定位':'重新规划';
  }
  const gpsTracker=createCampusLocation(state=>{
    if(!locationDestination||state.status==='idle')return;
    if(state.status==='ready'){
      if(planFromPosition(state.point))return;
      navMessage('暂未找到从当前位置出发的校园路线，请走到已标注的校园道路后重试');
      return;
    }
    const message=locationMessages[state.status];
    if(state.status==='tracking'&&directions){
      const {traveled,total,complete}=street.getState();
      if(complete)return;
      const end=nav.route().points.at(-1);
      const arrivalRadius=Math.min(8,Math.max(3,state.accuracy/2));
      const nearEnd=total-state.progress<=arrivalRadius&&Math.hypot(state.point[0]-end[0],state.point[1]-end[1])<=arrivalRadius;
      const progress=nearEnd?total:Math.min(state.progress,Math.max(0,total-.5));
      street.step(progress-traveled);
      updateStreetHud();
      const text=nearEnd?'已到达目的地附近':`跟随当前位置 · 精度约 ${Math.ceil(state.accuracy)} 米`;
      if(streetLocation.textContent!==text)streetLocation.textContent=text;
      streetLocation.hidden=false;
      streetReplan.hidden=true;
      locationAction='';
      if(nearEnd)gpsTracker.stop();
      dirty=true;
    }else if(message){
      if(directions)showLocationIssue(state,message);
      else navMessage(message);
    }
  });
  streetReplan.onclick=()=>{
    if(locationAction==='retry'){gpsTracker.start(nav.route());return;}
    const {point}=gpsTracker.getState();
    if(point&&!planFromPosition(point))streetInstruction.textContent='暂未找到从当前位置出发的校园路线';
  };
  function runNavigation(preview=false){
    if(!navFrom.value||!navTo.value){navMessage('请选择起点和目的地');return null;}
    if(navFrom.value===navTo.value){navMessage('起点和目的地相同');return null;}
    locationDestination=null;
    gpsTracker.stop();
    const destination={type:navType(navTo.value),id:navTo.value};
    if(navFrom.value==='current-location'){
      if(preview)return null;
      locationDestination=destination;
      controlsPanel.open=true;
      closeBuildingInfo();
      gpsTracker.start();
      return null;
    }
    const result=nav.graph.route({type:navType(navFrom.value),id:navFrom.value},destination,{mappedOnly:true});
    if(!result||result.points.length<2){navMessage('现有地图暂时无法规划这两个地点之间的路线');return null;}
    if(preview){
      closeBuildingInfo();
      nav.show(result);
      frameRoute(result.points);
    }else if(!startStreet(result)){
      navMessage('这两点之间没有可导航的路线');
      return null;
    }
    showRouteSummary(result);
    if(matchMedia('(max-width:720px)').matches)controlsPanel.open=false;
    return result;
  }
  document.getElementById('nav-swap').onclick=()=>{
    if(navFrom.value==='current-location'){navMessage('当前位置只能用作起点');return;}
    if(!navTo.value){navMessage('请先选择目的地');return;}
    const from=navFrom.value,to=navTo.value;
    for(const [select,value,source] of [[navFrom,to,navTo],[navTo,from,navFrom]]){
      if(!Array.from(select.options).some(o=>o.value===value)){
        const option=document.createElement('option');option.value=value;option.textContent=source.selectedOptions[0].textContent;select.appendChild(option);
      }
    }
    navFrom.value=to;navTo.value=from;clearRoute();updateStartButton();
  };
  navFrom.addEventListener('change',()=>{clearRoute();updateStartButton();});
  navTo.addEventListener('change',clearRoute);
  navGo.onclick=()=>runNavigation();
  navPreview.onclick=()=>runNavigation(true);
  document.getElementById('nav-clear').onclick=clearRoute;
  let navHereOption=null;
  document.getElementById('nav-here').onclick=()=>{if(!selectedBuilding)return;const b=selectedBuilding;if(b.n){if(navHereOption){navHereOption.remove();navHereOption=null;}}else{if(!navHereOption){navHereOption=document.createElement('option');navTo.appendChild(navHereOption);}navHereOption.value=b.s;navHereOption.textContent=b.s+'（点选）';}navTo.value=b.s;document.getElementById('controls-panel').open=true;runNavigation();};
  document.getElementById('labels').onchange=()=>{dirty=true;};
  document.getElementById('trees').onchange=e=>{env.treesGroup.visible=e.target.checked;renderer.shadowMap.needsUpdate=true;waterReflection.invalidate();dirty=true;};
  const originals=new Map(),clay=new THREE.MeshStandardMaterial({color:0xf5f4ef,roughness:1});
  model.root.traverse(o=>{if(o.isMesh)originals.set(o,o.material);});
  document.getElementById('clay').onchange=e=>{for(const [mesh,mat] of originals)mesh.material=e.target.checked?clay:mat;waterReflection.invalidate();dirty=true;};
  let drag=null,moved=false;
  canvas.oncontextmenu=e=>e.preventDefault();
  canvas.addEventListener('pointerdown',e=>{if(directions)return;flight=null;canvas.setPointerCapture(e.pointerId);drag={x:e.clientX,y:e.clientY,pan:e.button!==0||e.shiftKey};moved=false;});
  canvas.addEventListener('pointermove',e=>{if(!drag)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(Math.abs(dx)+Math.abs(dy)>1)moved=true;
    if(drag.pan){const k=2*orth/innerHeight;target.x-=Math.cos(az)*dx*k+Math.sin(az)*dy*k;target.z+=Math.sin(az)*dx*k-Math.cos(az)*dy*k;}else{az-=dx*.004;el=Math.max(.18,Math.min(Math.PI/2-.001,el+dy*.003));}drag.x=e.clientX;drag.y=e.clientY;position();});
  const ray=new THREE.Raycaster(),pointer=new THREE.Vector2();let highlight=null;
  function focusBuilding(g){
    const box=new THREE.Box3().setFromObject(g),center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3());
    // Fit the projected box while keeping the current viewing direction.
    const halfWidth=(Math.abs(Math.cos(az))*size.x+Math.abs(Math.sin(az))*size.z)/2;
    const halfHeight=(Math.abs(Math.sin(az)*Math.sin(el))*size.x+Math.cos(el)*size.y+Math.abs(Math.cos(az)*Math.sin(el))*size.z)/2;
    const fitted=Math.max(35,halfWidth/(innerWidth/innerHeight*.78),halfHeight/.65);
    if(matchMedia('(max-width:720px)').matches)document.getElementById('controls-panel').open=false;
    flyTo({x:center.x,y:center.y,z:center.z,orth:Math.max(35,Math.min(fitted,orth*.85))},800);
  }
  function closeBuildingInfo(){
    document.getElementById('info').style.display='none';
    selectedBuilding=null;
    if(highlight){scene.remove(highlight);highlight.geometry.dispose();highlight.material.dispose();highlight=null;}
    dirty=true;
  }
  function pick(e){
    pointer.set(e.clientX/innerWidth*2-1,1-e.clientY/innerHeight*2);
    ray.setFromCamera(pointer,camera);
    const hit=ray.intersectObjects(model.root.children,true).find(item=>!item.object.parent.userData.isForecourt);
    if(!hit)return;
    let group=hit.object;
    while(group.parent!==model.root)group=group.parent;
    const building=CAMPUS_DATA.buildings.find(b=>b.s===group.userData.seq);
    if(!building)return;
    closeBuildingInfo();
    selectedBuilding=building;
    document.getElementById('info-name').textContent=building.n||building.s;
    document.getElementById('info').style.display='block';
    highlight=new THREE.BoxHelper(group,0xc1a16b);
    scene.add(highlight);
    focusBuilding(group);
  }
  canvas.addEventListener('pointerup',e=>{if(drag&&!moved&&e.button===0)pick(e);drag=null;});
  canvas.addEventListener('pointercancel',()=>{drag=null;});
  canvas.addEventListener('wheel',e=>{e.preventDefault();if(directions)return;flight=null;orth=Math.max(35,Math.min(3200,orth*Math.exp(e.deltaY*.001)));position();},{passive:false});
  canvas.addEventListener('keydown',e=>{if(directions)return;if(e.key==='ArrowLeft')az-=.1;else if(e.key==='ArrowRight')az+=.1;else if(e.key==='ArrowUp')el=Math.min(1.57,el+.06);else if(e.key==='ArrowDown')el=Math.max(.18,el-.06);else if(e.key==='+'||e.key==='=')orth=Math.max(35,orth*.9);else if(e.key==='-')orth=Math.min(3200,orth*1.1);else return;e.preventDefault();flight=null;position();});
  document.getElementById('close-info').onclick=closeBuildingInfo;
  addEventListener('resize',()=>{
    renderer.setSize(innerWidth,innerHeight);
    street.resize(innerWidth/innerHeight);
    position();
  });
  renderer.shadowMap.needsUpdate=true;document.getElementById('loading').remove();
  let last=0;
  function render(time){
    requestAnimationFrame(render);
    if(directions){
      if(street.update(time)){
        updateStreetHud();
        dirty=true;
      }
      if(dirty){
        const {x,z}=street.camera.position;
        positionShadows(Math.round(x/50)*50,Math.round(z/50)*50,155);
        atmosphere.follow(street.camera);
        scene.fog.near=220-150*haze;
        scene.fog.far=1300-790*haze;
        if(time-lastStreetReflection>=100||street.getState().paused){
          waterReflection.update(street.camera);
          lastStreetReflection=time;
        }
        renderer.render(scene,street.camera);
        dirty=false;
      }
      last=time;
      return;
    }
    stepFlight(time);
    if(document.getElementById('spin').checked&&!flight){
      az+=Math.min(50,time-last)*.00004;
      position();
    }
    last=time;
    if(nav.active()){
      nav.update(time);
      dirty=true;
    }
    if(!dirty)return;
    atmosphere.follow(camera);
    scene.fog.near=2400-700*haze;
    scene.fog.far=4400-1600*haze;
    waterReflection.update(camera);
    renderer.render(scene,camera);
    labels();
    const compassAngle=az*180/Math.PI;
    compassNeedle.style.transform=`rotate(${compassAngle}deg)`;
    compassNorth.style.transform=`rotate(${-compassAngle}deg)`;
    const meters=orth<130?20:100;
    document.getElementById('scale-bar').style.width=meters/(2*orth)*innerHeight+'px';
    document.getElementById('scale-text').textContent=meters+' m';
    dirty=false;
  }
  requestAnimationFrame(render);
  window.campus={scene,camera,renderer,model,env,nav,street,views,applyView,runNavigation,clearRoute,flyTo,weather:campusWeather,stats:{...model.stats,...env.stats},getView:()=>({az,el,orth,target:target.toArray()}),render:()=>{dirty=true;}};
  window.appReady=true;
})();
