function createCampusBuildings(THREE, data) {
  const root = new THREE.Group(); root.name = 'Campus_buildings';
  const sports = new THREE.Group(); sports.name = 'Sports_ground';
  const materials = {};
  const palette = { brick:0x9b9692, cream:0xd4cbbb, wall:0xd9d9d2, roof:0x434b4c, trim:0xe6e5de, glass:0x526b75, dark:0x303b3d, stone:0xb8b6ad, red:0x9f5e50, metal:0x9da4a2, turf:0x587c50, turf2:0x618556, track:0xa96656, line:0xdedfd5, blue:0x5c8887 };
  for (const [k,color] of Object.entries(palette)) {
    // Building surfaces are masonry and painted plaster; window panes are dielectric, not metal.
    const roughness=k==='glass'?.34:k==='metal'?.58:k==='roof'?.94:.96;
    materials[k] = new THREE.MeshStandardMaterial({name:k,color,roughness,metalness:k==='metal'?.35:0,side:THREE.DoubleSide});
  }
  materials.roseTrim = new THREE.MeshStandardMaterial({name:'roseTrim',color:0xc0a59d,roughness:.93});
  materials.teachingGlass = new THREE.MeshStandardMaterial({name:'teachingGlass',color:0x61978b,roughness:.32});
  const hasPhotos = typeof document !== 'undefined' && typeof CAMPUS_BUILDING_PHOTOS !== 'undefined';
  const pendingTextures = [];
  if (hasPhotos) {
    const loader = new THREE.TextureLoader();
    const photographed = (key, name, baseColor, repeat, material = materials[name] || materials.brick.clone()) => {
      material.name = name;
      materials[name] = material;
      pendingTextures.push(new Promise(resolve => {
        loader.load(CAMPUS_BUILDING_PHOTOS[key], map => {
          map.colorSpace = THREE.SRGBColorSpace;
          map.anisotropy = 4;
          if (repeat) {
            map.wrapS = map.wrapT = THREE.MirroredRepeatWrapping;
            map.repeat.set(...repeat);
          }
          material.map = map;
          material.color.setHex(baseColor);
          if (name === 'brick' || name === 'libraryBrick') {
            material.bumpMap = map;
            material.bumpScale = .045;
          }
          material.needsUpdate = true;
          resolve();
        }, undefined, resolve);
      }));
    };
    photographed('clockBrick', 'brick', 0xfafafa, [3.6, .52]);
    photographed('libraryBrick', 'libraryBrick', 0xffffff, [.6, 1.8]);
    photographed('teachingSlate', 'roof', 0xf2f2f2, [.65, 2]);
    photographed('clockDial', 'clockDial', 0xf7f7f7);
    photographed('libraryFront', 'libraryFront', 0xfdfdfd);
    const paneMaterial = materials.glass.clone();
    paneMaterial.roughness = .23;
    photographed('windowPanes', 'windowPane', 0xd7e4e7, null, paneMaterial);
  }
  const texturesReady = Promise.all(pendingTextures);
  // Shared, subtle mineral grain: one small repeating texture avoids extra draw calls on phones.
  // The node-side GLB exporter has no DOM and retains the base material colours.
  if (typeof document !== 'undefined') {
    const canvas=document.createElement('canvas');canvas.width=canvas.height=128;
    const ctx=canvas.getContext('2d');
    if(ctx){
      const pixels=ctx.createImageData(128,128);let seed=7349;
      for(let i=0;i<pixels.data.length;i+=4){seed=(seed*1664525+1013904223)>>>0;const v=234+(seed>>>28);pixels.data[i]=v;pixels.data[i+1]=v;pixels.data[i+2]=v;pixels.data[i+3]=255;}
      ctx.putImageData(pixels,0,0);
      const grain=new THREE.CanvasTexture(canvas);grain.colorSpace=THREE.SRGBColorSpace;grain.wrapS=grain.wrapT=THREE.RepeatWrapping;
      for(const k of ['wall','cream','stone','trim','track']){materials[k].map=grain;materials[k].bumpMap=grain;materials[k].bumpScale=.035;materials[k].needsUpdate=true;}
    }
  }
  let bins, group, counter = 0;
  function begin(g) { group=g;bins=new Map(); }
  function add(geometry, material) {
    if (geometry.index) {const old=geometry;geometry=geometry.toNonIndexed();old.dispose();}
    if(!geometry.attributes.normal)geometry.computeVertexNormals();
    if(!bins.has(material))bins.set(material,[]);
    bins.get(material).push(geometry);
  }
  function finish() {
    for(const [mat,gs] of bins) {
      const count=gs.reduce((n,g)=>n+g.attributes.position.count,0);
      const p=new Float32Array(count*3),n=new Float32Array(count*3),uv=new Float32Array(count*2);let offset=0;
      const photoPanel = mat === 'clockDial' || mat === 'libraryFront' || mat === 'windowPane';
      for(const g of gs){p.set(g.attributes.position.array,offset*3);n.set(g.attributes.normal.array,offset*3);if(photoPanel)uv.set(g.attributes.uv.array,offset*2);offset+=g.attributes.position.count;g.dispose();}
      if(!photoPanel)for(let i=0;i<count;i++){const ax=Math.abs(n[i*3]),ay=Math.abs(n[i*3+1]),az=Math.abs(n[i*3+2]);uv[i*2]=(ay>.8?p[i*3]:ax>az?p[i*3+2]:p[i*3])/4;uv[i*2+1]=(ay>.8?p[i*3+2]:p[i*3+1])/4;}
      const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(p,3));g.setAttribute('normal',new THREE.BufferAttribute(n,3));g.setAttribute('uv',new THREE.BufferAttribute(uv,2));g.computeBoundingSphere();
      const material = materials[mat];
      if (hasPhotos && ['brick','libraryBrick','cream','wall'].includes(mat)) {
        const colors = new Float32Array(count * 3);
        for (let i = 0; i < count; i++) {
          const height = Math.max(0, p[i * 3 + 1]);
          const shade = .78 + .22 * THREE.MathUtils.smoothstep(height, 0, 6);
          colors.fill(shade, i * 3, i * 3 + 3);
        }
        g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        material.vertexColors = true;
      }
      const m=new THREE.Mesh(g,material);m.name=group.name+'_'+mat;m.castShadow=!photoPanel;m.receiveShadow=true;m.userData.explodeWithParent=true;group.add(m);counter++;
    }
  }
  function box(x,n,y,w,d,h,mat='trim',angle=0) {
    const g=new THREE.BoxGeometry(w,h,d);g.rotateY(angle);g.translate(x,y+h/2,-n);add(g,mat);
  }
  function photoPlane(x,n,y,w,h,angle,material,tile) {
    const geometry = new THREE.PlaneGeometry(w,h);
    if (tile !== undefined) {
      const uv = geometry.attributes.uv;
      // Pad each tile by two texels so the adjacent window doesn't bleed into its edges.
      const u = tile % 2 * .5 + 2 / 256;
      const v = .5 - Math.floor(tile / 2) * .5 + 2 / 256;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, u + uv.getX(i) * (124 / 256), v + uv.getY(i) * (124 / 256));
    }
    geometry.rotateY(angle);
    geometry.translate(x,y,-n);
    add(geometry,material);
  }
  function detailedWindow(x,n,bottom,width,height,angle,outX,outN,tile) {
    const center = bottom + height / 2;
    const face = (u,v,depth) => [x+Math.cos(angle)*u+outX*depth,center+v,-n-Math.sin(angle)*u-outN*depth];
    function ring(halfWidth,halfHeight,depth){
      return [[-halfWidth,-halfHeight],[halfWidth,-halfHeight],[halfWidth,halfHeight],[-halfWidth,halfHeight]]
        .map(([u,v])=>face(u,v,depth));
    }
    const lip = ring(width / 2 + .09,height / 2 + .11,.19);
    const jamb = ring(width / 2,height / 2,.055);
    const outer = ring(width / 2 + .12,height / 2 + .14,.012);
    const vertices=[];
    for(let i=0;i<4;i++){
      const j=(i+1)%4;
      vertices.push(...outer[i],...lip[i],...lip[j],...outer[i],...lip[j],...outer[j]);
      vertices.push(...lip[i],...jamb[i],...jamb[j],...lip[i],...jamb[j],...lip[j]);
    }
    if(outX*Math.sin(angle)-outN*Math.cos(angle)>0){
      for(let i=0;i<vertices.length;i+=9)for(let j=0;j<3;j++){
        const first=vertices[i+j];vertices[i+j]=vertices[i+j+3];vertices[i+j+3]=first;
      }
    }
    const reveal=new THREE.BufferGeometry();
    reveal.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
    reveal.computeVertexNormals();
    add(reveal,'dark');
    photoPlane(x+outX*.058,n+outN*.058,center,width,height,angle,'windowPane',tile);
  }
  function cyl(x,n,y,r,h,mat='trim',segments=20,top=r){const g=new THREE.CylinderGeometry(top,r,h,segments);g.translate(x,y+h/2,-n);add(g,mat);}
  function shape(r,h,y,mat) {
    const s=new THREE.Shape(r.map(p=>new THREE.Vector2(...p)));s.closePath();
    const g=h?new THREE.ExtrudeGeometry(s,{depth:h,bevelEnabled:false,curveSegments:1}):new THREE.ShapeGeometry(s);
    g.rotateX(-Math.PI/2);g.translate(0,y,0);add(g,mat);
  }
  function beam(a,b,width,height,mat='trim') {
    const dx=b[0]-a[0],dn=b[1]-a[1],dy=b[2]-a[2],len=Math.hypot(dx,dn,dy);
    const g=new THREE.BoxGeometry(width,height,len);g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,1),new THREE.Vector3(dx,dy,-dn).normalize()));g.translate((a[0]+b[0])/2,(a[2]+b[2])/2,-(a[1]+b[1])/2);add(g,mat);
  }
  function roof(cx,cn,length,width,eave,rise,angle=0,hip=false,mat='roof') {
    const c=Math.cos(angle),s=Math.sin(angle),P=(u,v,y)=>[cx+c*u-s*v,y,-(cn+s*u+c*v)];
    const a=P(-length/2,-width/2,eave),b=P(length/2,-width/2,eave),c0=P(length/2,width/2,eave),d=P(-length/2,width/2,eave);
    const inset=hip?Math.min(width/2,length/2):0,ra=P(-length/2+inset,0,eave+rise),rb=P(length/2-inset,0,eave+rise);
    const p=[...a,...b,...rb,...a,...rb,...ra,...d,...ra,...rb,...d,...rb,...c0,...a,...ra,...d,...b,...c0,...rb];
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.computeVertexNormals();add(g,mat);
    beam([a[0],-a[2],eave],[b[0],-b[2],eave],.4,.38);beam([d[0],-d[2],eave],[c0[0],-c0[2],eave],.4,.38);
  }
  function obb(r) {
    let best;
    for(let j=0;j<90;j++){const angle=j*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);const us=r.map(p=>p[0]*c+p[1]*s),vs=r.map(p=>-p[0]*s+p[1]*c);const u0=Math.min(...us),u1=Math.max(...us),v0=Math.min(...vs),v1=Math.max(...vs),area=(u1-u0)*(v1-v0);if(!best||area<best.area)best={angle,c,s,u0,u1,v0,v1,area};}
    const u=(best.u0+best.u1)/2,v=(best.v0+best.v1)/2;return {...best,x:u*best.c-v*best.s,n:u*best.s+v*best.c,w:best.u1-best.u0,d:best.v1-best.v0};
  }
  function facades(r,h,floors,style,skip=()=>false) {
    let area=0;for(let i=0;i<r.length;i++){const p=r[i],q=r[(i+1)%r.length];area+=p[0]*q[1]-q[0]*p[1];}
    const sign=area>0?1:-1,fh=h/floors;
    for(let i=0;i<r.length;i++) {
      const a=r[i],b=r[(i+1)%r.length],dx=b[0]-a[0],dn=b[1]-a[1],len=Math.hypot(dx,dn);if(len<3||skip(a,b))continue;
      const ux=dx/len,un=dn/len,nx=un*sign,nn=-ux*sign,angle=Math.atan2(un,ux),cx=(a[0]+b[0])/2,cn=(a[1]+b[1])/2;
      box(cx+nx*.2,cn+nn*.2,h-.55,len,.42,.45,'trim',angle);
      if(hasPhotos && (style==='brick'||style==='residence'))box(cx+nx*.13,cn+nn*.13,.015,len,.31,.46,'stone',angle);
      const bays=Math.max(1,Math.floor((len-1.6)/(style==='residence'?3.8:4.8))),step=(len-1.4)/bays;
      for(let f=0;f<floors;f++) {
        const y=f*fh+fh*.25;
        if(style==='residence'||style==='cream')box(cx+nx*.2,cn+nn*.2,f*fh+.1,len,.5,.25,'trim',angle);
        for(let j=0;j<bays;j++) {
          const along=.7+(j+.5)*step,x=a[0]+ux*along,n=a[1]+un*along,ww=Math.min(style==='residence'?2.4:1.9,step*.67),wh=fh*.59;
          if(hasPhotos){
            detailedWindow(x,n,y,ww,wh,angle,nx,nn,(j*3+f*5+i)%4);
            box(x+nx*.14,n+nn*.14,y-.1,ww+.29,.41,.105,'stone',angle);
          }else{
            box(x+nx*.12,n+nn*.12,y-.1,ww+.26,.17,wh+.22,style==='cream'?'trim':'dark',angle);
            box(x+nx*.24,n+nn*.24,y,ww,.1,wh,'glass',angle);
            box(x+nx*.3,n+nn*.3,y,0.065,.13,wh,'metal',angle);
            if(style==='brick')box(x+nx*.29,n+nn*.29,y-.22,ww+.3,.33,.2,'trim',angle);
          }
          if(style==='residence') {box(x+nx*.8,n+nn*.8,f*fh+.1,step-.18,1.5,.2,'trim',angle);box(x+nx*1.42,n+nn*1.42,f*fh+.3,step-.23,.14,.68,'wall',angle);}
        }
      }
      if(style==='brick'&&len>12){for(let j=0;j<=bays;j++){const along=.7+j*step;box(a[0]+ux*along+nx*.22,a[1]+un*along+nn*.22,.4,hasPhotos?.64:.42,hasPhotos?.55:.45,h-1,'brick',angle);}}
    }
  }
  function tower(x,n,w,d,shaft,cap,angle=0,clock=false) {
    box(x,n,0,w,d,shaft,'brick',angle);box(x,n,shaft,w+.4,d+.4,cap,'trim',angle);
    roof(x,n,w+.9,d+.9,shaft+cap,6.8,angle,true);
    for(let j=0;j<4;j++) {
      const a=angle+j*Math.PI/2,nx=Math.cos(a),nn=Math.sin(a),cx=x+nx*(w/2+.13),cn=n+nn*(d/2+.13);
      if(clock&&hasPhotos){
        for(let floor=0;floor<5;floor++){
          detailedWindow(cx-nx*.13,cn-nn*.13,2.5+floor*3.05,1.04,2.31,a+Math.PI/2,nx,nn,(j+floor)%4);
        }
      }else box(cx,cn,2,1.1,.16,shaft-3,'glass',a+Math.PI/2);
      if(clock) {
        const cy=shaft+cap*.52,rad=Math.min(w,d)*.27;
        if (hasPhotos) {
          photoPlane(cx+nx*.16,cn+nn*.16,cy,3.25,3.25,a+Math.PI/2,'clockDial');
          continue;
        }
        const g=new THREE.CircleGeometry(rad,32);g.rotateY(a+Math.PI/2);g.translate(cx,cy,-cn);add(g,'stone');
        const tx=-nn,tn=nx;
        for(let k=0;k<12;k++){const t=k*Math.PI/6;box(cx+tx*Math.sin(t)*rad*.8+nx*.1,cn+tn*Math.sin(t)*rad*.8+nn*.1,cy+Math.cos(t)*rad*.8-.11,.11,.1,.24,'dark',a+Math.PI/2);}
        beam([cx+nx*.17,cn+nn*.17,cy],[cx+nx*.17+tx*.65,cn+nn*.17+tn*.65,cy+.25],.13,.1,'dark');
        beam([cx+nx*.18,cn+nn*.18,cy],[cx+nx*.18-tx*.22,cn+nn*.18-tn*.22,cy+1.05],.1,.1,'dark');
      }
    }
  }
  function arcade(x,n,length,angle,y=0) {
    const count=Math.max(2,Math.round(length/5)),spacing=length/count,c=Math.cos(angle),s=Math.sin(angle);
    for(let j=0;j<count;j++) {
      const u=-length/2+j*spacing,px=x+c*u,pn=n+s*u;
      box(px,pn,y,.7,2,4.2,'brick',angle);
      const outer=spacing/2,inner=outer-.45,ps=[];
      for(let k=0;k<=16;k++){const t=Math.PI*k/16;ps.push([outer*Math.cos(t),outer*Math.sin(t)]);}
      for(let k=16;k>=0;k--){const t=Math.PI*k/16;ps.push([inner*Math.cos(t),inner*Math.sin(t)]);}
      const sh=new THREE.Shape(ps.map(p=>new THREE.Vector2(...p))),g=new THREE.ExtrudeGeometry(sh,{depth:1.5,bevelEnabled:false});g.translate(0,2.05,-.75);g.rotateY(angle);g.translate(px+c*spacing/2,y,-(pn+s*spacing/2));add(g,'brick');
    }
    box(x,n,y+4.8,length+1,2.5,.3,'trim',angle);box(x,n,y+4.2,length+1,1.8,.7,'brick',angle);
  }
  function lakesideTeaching(b) {
    const northWing = b.s === 'REF-A';
    const north = northWing ? 65 : 24;
    const rectangle = (x,n,w,d) => [[x-w/2,n-d/2],[x+w/2,n-d/2],[x+w/2,n+d/2],[x-w/2,n+d/2]];
    const cream = (x,n,y,w,d,h) => box(x,n,y,w,d,h,'cream');
    function terrace(x,n,w,d,y,rise=1.6) {
      const bottom=rectangle(x,n,w,d), top=rectangle(x,n,w-4.6,d-4.6);
      const positions=[];
      const coord=([east,north],h)=>[east,h,-north];
      for(let i=0;i<4;i++){
        const j=(i+1)%4, a=coord(bottom[i],y), b=coord(bottom[j],y), c=coord(top[j],y+rise), d=coord(top[i],y+rise);
        positions.push(...a,...b,...c,...a,...c,...d);
      }
      const geometry=new THREE.BufferGeometry();
      geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
      add(geometry,'roof');
      shape(top,.22,y+rise,'stone');
      box(x,n,y-.21,w,d,.23,'trim');
    }
    // The west photograph shows three successively higher roof terraces on each court wing.
    for(const [i,x] of [-324.5,-307.5,-290.5].entries()){
      const height=8.25+i*2.1;
      const wing=rectangle(x,north,17.0,12.7);
      shape(wing,height,0,'cream');
      facades(wing,height,3,'cream',(a,b)=>a[0]===b[0] && a[0]>-332);
      for(const offset of [-6.43,6.43])box(x,north+offset,height-.94,17.04,.26,.48,'roseTrim');
      terrace(x,north,17.8,14.2,height+.08);
    }
    // Outer wings retain the satellite footprint with the flat roof or shallow slate rim visible in the oblique photo.
    for(const [i,outline] of b.parts.entries()){
      const isOuter=northWing ? [0,2,4].includes(i) : [3,4].includes(i);
      if(!isOuter)continue;
      // Stop each rear wing at the open court instead of filling the passage under the bridge.
      const part=northWing&&i===4 ? outline.map(([x,n])=>[x,Math.max(60,n)])
        : !northWing&&i===3 ? outline.map(([x,n])=>[x,Math.min(29,n)]) : outline;
      const o=obb(part), height=i===4&&northWing?9.5:8.9;
      shape(part,height,0,'cream');
      facades(part,height,3,'cream');
      terrace(o.x,o.n,o.w+.55,o.d+.55,height,.94);
    }
    if(!northWing){
      const cx=-331, cn=8.8, radius=10.1;
      const perimeter=Array.from({length:13},(_,i)=>{
        const angle=Math.PI/2+i*Math.PI/12;
        return [cx+Math.cos(angle)*radius,cn+Math.sin(angle)*radius];
      });
      perimeter.push([-313,cn-radius],[-313,cn+radius]);
      shape(perimeter,6.9,0,'cream');
      shape(perimeter,.28,6.9,'trim');
      for(let i=1;i<12;i++){
        const t=Math.PI/2+i*Math.PI/12;
        const x=cx+Math.cos(t)*(radius+.06),n=cn+Math.sin(t)*(radius+.06);
        for(const y of [1.0,4.1])box(x,n,y,1.74,.14,1.92,'teachingGlass',t+Math.PI/2);
      }
    }
    // One open roof pavilion per wing, both behind the court’s stepped roofs.
    const towerX=-279, towerN=north;
    cream(towerX,towerN,9,9.3,10.5,4.4);
    box(towerX,towerN,12.9,10.6,11.8,.59,'roseTrim');
    for(const x of [-283,-275])for(const n of [-4,0,4])cyl(x,towerN+n,13.48,.22,3.02,'trim',10);
    for(const n of [-4,4])cyl(towerX,towerN+n,13.48,.22,3.02,'trim',10);
    roof(towerX,towerN,11.5,11.5,16.5,3,0,true);
    for(let flight=0;flight<2;flight++)for(let step=0;step<8;step++){
      const n=towerN+(flight?1:-6.2)+step*.62;
      box(-284.2,n,9.15+flight*1.84+step*.23,1.76,.69,.22,'stone');
    }
    if(!northWing){finish();return;}
    // The glazed shared bridge rests above open columns. The pink portal frames its middle bay.
    const middle=44.5, bridgeLength=32;
    cream(-276.8,middle,4.8,8.0,bridgeLength,5.5);
    box(-276.8,middle,10.25,8.8,bridgeLength+.3,.34,'trim');
    box(-276.8,middle,10.55,7.7,bridgeLength-.5,.18,'roof');
    box(-281,middle,7.08,.32,bridgeLength,.21,'roseTrim');
    for(let pane=0;pane<11;pane++)for(const level of [5.28,7.85]){
      const n=middle+(pane-5)*2.77;
      box(-280.91,n,level,.15,2.1,1.56,'teachingGlass');
      box(-281,n,level,.12,.11,1.56,'trim');
    }
    for(const n of [29.5,34,39.3,49.7,55,59.5])cream(-278.2,n,0,1.05,.70,4.85);
    for(const n of [40,49])box(-282.1,n,0,1.24,.91,7.48,'roseTrim');
    box(-282.1,middle,6.18,1.26,9.9,1.42,'roseTrim');
    finish();

    // The west-facing approach is paved, with three low landscaped terraces and clear stairs on both sides.
    const forecourt=new THREE.Group();
    forecourt.name='REF-AB lakeside forecourt';
    forecourt.userData.isForecourt=true;
    group.add(forecourt);
    begin(forecourt);
    box(-313.5,middle,-.11,71,26.7,.18,'stone');
    for(const [i,x] of [-312,-302.8,-293.6].entries()){
      const y=.08+i*.46;
      box(x,middle,y,6.6,16.2,.59,'stone');
      box(x,middle,y+.57,6.14,15.65,.12,'turf');
      for(const n of [-6.4,-3.85,0,3.85,6.4])for(const dx of [-2.1,2.1]){
        const bush=new THREE.IcosahedronGeometry(.81,1);bush.scale(1,.59,.96);bush.translate(x+dx,y+1.0,-(middle+n));add(bush,'turf2');
      }
      for(const side of [-1,1]){
        const n=middle+side*10.8;
        box(x+.42,n,0,7.92,2.15,y+.46,'stone');
        for(let j=0;j<4;j++)box(x-4.80+j*.33,n,0,.35,2.15,y+j*.115,'stone');
      }
    }
    finish();
  }
  for(const b of data.buildings) {
    const g=new THREE.Group();g.name=b.s+' '+b.n;g.userData={seq:b.s,name:b.n,height_m:b.h,eave_m:b.e,evidence:b.evidence};root.add(g);begin(g);
    const bb=obb(b.r), mat=b.s==='B84'&&hasPhotos?'libraryBrick':b.detail==='brick'?'brick':b.detail==='cream'||b.detail==='lakeside'?'cream':'wall';
    if(b.detail==='canopy') {
      const angle=Math.atan2(data.sport.un,data.sport.ux),len=Math.max(bb.w,bb.d),width=Math.min(bb.w,bb.d),c=Math.cos(angle),s=Math.sin(angle);
      box(bb.x,bb.n,0,len,width,3,'cream',angle);
      for(let i=0;i<7;i++){const v=-width/2+(i+.5)*width/7;box(bb.x-s*v,bb.n+c*v,3+i*.36,len,width/7,.4,'red',angle);}
      const positions=[];
      const P=(u,v)=>[bb.x+c*u-s*v,7.1+2.1*Math.pow(Math.max(0,Math.sin((u/len+.5)*Math.PI*5)),5)*(1-Math.abs(v)/(width*.7))+.7*Math.cos(v/width*Math.PI),-(bb.n+s*u+c*v)];
      for(let i=0;i<80;i++)for(let j=0;j<6;j++){const u=-len/2+i*len/80,v=-width/2+j*width/6,a=P(u,v),d=P(u+len/80,v+width/6),p=P(u+len/80,v),q=P(u,v+width/6);positions.push(...a,...p,...d,...a,...d,...q);}
      const canopy=new THREE.BufferGeometry();canopy.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));canopy.computeVertexNormals();add(canopy,'trim');
      for(let i=0;i<=10;i++){const u=-len/2+i*len/10;box(bb.x+c*u,bb.n+s*u,0,.35,.35,8.3,'metal',angle);}
      finish();continue;
    }
    if(b.detail==='lakeside') {
      lakesideTeaching(b);
      continue;
    }
    if(b.s==='B85') {
      if (hasPhotos) {
        // 校园实拍 01、03、05、06：沿主翼保留砖扶壁、白色窗间板和退后的顶层窗带。
        const wing = [b.r[0], b.r[3], b.r[4], b.r[9]];
        const signedArea = wing.reduce((sum, [x,n], i) => {
          const [nextX,nextN] = wing[(i + 1) % wing.length];
          return sum + x * nextN - nextX * n;
        }, 0);
        const outside = Math.sign(signedArea);
        shape(wing, b.e, 0, 'brick');
        for (let side = 0; side < wing.length; side++) {
          const [x,n] = wing[side], [endX,endN] = wing[(side + 1) % wing.length];
          const length = Math.hypot(endX - x,endN - n);
          const dx = (endX - x) / length, dn = (endN - n) / length;
          const nx = dn * outside, nn = -dx * outside, angle = Math.atan2(dn,dx);
          const place = (along,depth,y,width,thickness,height,material) => {
            box(x+dx*along+nx*depth,n+dn*along+nn*depth,y,width,thickness,height,material,angle);
          };
          const bays = Math.max(2, Math.round((length - 1.4) / 3.35));
          const span = (length - 1.4) / bays;
          place(length/2, .12, .02, length, .32, .48, 'stone');
          place(length/2, .105, 14.67, length, .28, 2.57, 'brick');
          place(length/2, .27, 17.22, length + .24, .62, .44, 'trim');
          for (let bay = 0; bay < bays; bay++) {
            const along = .7 + span*(bay+.5), width = Math.min(1.94,span*.72);
            const px = x + dx*along, pn = n + dn*along;
            for (let row = 0; row < 3; row++) {
              const y = 1.01 + row * 4.14;
              detailedWindow(px,pn,y,width,2.85,angle,nx,nn,(bay + row + side) % 4);
              place(along,.09,y+2.88,width+.08,.23,1.15,'trim');
              place(along,.24,y-.11,width+.17,.45,.13,'stone');
            }
            detailedWindow(px+nx*.25,pn+nn*.25,15.01,width+.12,1.86,angle,nx,nn,(bay + side) % 4);
            place(.7 + span*bay,.25,.47,.62,.61,14.2,'brick');
          }
          place(length-.7,.25,.47,.62,.61,14.2,'brick');
        }
        const wingBox = obb(wing);
        roof(wingBox.x, wingBox.n, wingBox.w-.15, wingBox.d-.1, b.e-.02, 2.1, wingBox.angle, false);

        // 主塔：转角窄窗、退台砖冠、白色钟室和有小平顶的深色四坡屋面。
        const towerX = -153.5, towerN = -346.7, towerAngle = Math.PI/4;
        const shaftHeight = 19.5, clockRoofY = 24.7, shaftRadius = 3.7;
        const towerPoint = (u,v) => [towerX + (u-v)*Math.SQRT1_2, towerN + (u+v)*Math.SQRT1_2];
        const towerOutline = (radius,corner) => [
          [-radius+corner,-radius],[radius-corner,-radius],[radius,-radius+corner],[radius,radius-corner],
          [radius-corner,radius],[-radius+corner,radius],[-radius,radius-corner],[-radius,-radius+corner]
        ].map(([u,v])=>towerPoint(u,v));
        const core = towerOutline(shaftRadius-.27,.65);
        shape(core,shaftHeight,0,'brick');
        shape(towerOutline(shaftRadius+.15,.75),.63,shaftHeight-.49,'brick');
        const clockRadius = shaftRadius-.24;
        box(towerX,towerN,shaftHeight,2*clockRadius,2*clockRadius,clockRoofY-shaftHeight,'trim',towerAngle);
        box(towerX,towerN,clockRoofY-.42,2*shaftRadius+.17,2*shaftRadius+.17,.43,'trim',towerAngle);
        for (let side = 0; side < 4; side++) {
          const face = towerAngle + side*Math.PI/2, nx=Math.cos(face), nn=Math.sin(face);
          const angle = face+Math.PI/2, tx = Math.cos(angle), tn = Math.sin(angle);
          const place = (u,depth,y,width,thickness,height,material) => {
            box(towerX+nx*depth+tx*u,towerN+nn*depth+tn*u,y,width,thickness,height,material,angle);
          };
          for (const offset of [-2.28,2.28]) place(offset,shaftRadius-.06,0,1.38,.43,shaftHeight-.16,'brick');
          place(0,shaftRadius-.13,3.05,.57,.32,shaftHeight-3.3,'brick');
          for (const offset of [-.86,.86]) {
            for(let row=0;row<5;row++) {
              const y = 3.15 + row*3.19;
              const glassWidth = side%2 ? .61 : .49;
              const depth=shaftRadius-.27;
              detailedWindow(towerX+nx*depth+tx*offset,towerN+nn*depth+tn*offset,y,glassWidth,2.42,angle,nx,nn,(side+row)%4);
              place(offset,depth+.2,y+1.55,glassWidth,.08,.065,'metal');
            }
          }
          const dialWidth=2.63,dialY=shaftHeight+2.7;
          place(0,clockRadius+.02,dialY-dialWidth/2-.08,dialWidth+.16,.12,dialWidth+.16,'stone');
          photoPlane(towerX+nx*(clockRadius+.086),towerN+nn*(clockRadius+.086),dialY,dialWidth,dialWidth,angle,'clockDial');
        }
        // Glazing follows the chamfer faces instead of floating across a square corner.
        for (let i = 1; i < core.length; i += 2) {
          const p = core[i], q = core[(i + 1) % core.length];
          const angle = Math.atan2(q[1]-p[1],q[0]-p[0]);
          const x=(p[0]+q[0])/2,n=(p[1]+q[1])/2;
          for(let row=0;row<5;row++)detailedWindow(x,n,3.08+row*3.19,.61,2.42,angle,Math.sin(angle),-Math.cos(angle),(i+row)%4);
        }
        const roofCorner = (u,v,y)=>{const [x,n]=towerPoint(u,v);return [x,y,-n];};
        const square=[[-1,-1],[1,-1],[1,1],[-1,1]];
        const eaves=square.map(([u,v])=>roofCorner(u*(shaftRadius+.09),v*(shaftRadius+.09),clockRoofY));
        const ridge=square.map(([u,v])=>roofCorner(u*.71,v*.71,b.h));
        const roofPositions=[];
        for(let i=0;i<4;i++) {
          const next=(i+1)%4;
          roofPositions.push(...eaves[i],...eaves[next],...ridge[next],...eaves[i],...ridge[next],...ridge[i]);
        }
        roofPositions.push(...ridge[0],...ridge[1],...ridge[2],...ridge[0],...ridge[2],...ridge[3]);
        const towerRoof = new THREE.BufferGeometry();
        towerRoof.setAttribute('position',new THREE.Float32BufferAttribute(roofPositions,3));
        towerRoof.computeVertexNormals();
        add(towerRoof,'roof');

        // 塔下深色入口、外挑门楣和台阶，均贴近原有建筑轮廓。
        const doorAngle = towerAngle + Math.PI/2;
        const [doorX,doorN] = towerPoint(shaftRadius-.24,-1.27);
        box(doorX,doorN,.27,1.98,.09,2.67,'dark',doorAngle);
        const [lintelX,lintelN] = towerPoint(shaftRadius+.28,-1.27);
        box(lintelX,lintelN,2.95,2.54,1.12,.37,'brick',doorAngle);
        for(let step=0;step<3;step++) {
          const [x,n]=towerPoint(shaftRadius+step*.28,-1.27);
          box(x,n,0,2.6,1.48,(3-step)*.095,'stone',doorAngle);
        }

        // 西侧连廊照片 04：砖柱间是低矢高的真拱洞，顶台有浅色栏板。
        const bayWidth = 4.8, arcadeX = -182.48, arcadeStart = -390.2;
        for (let i = 0; i <= 5; i++) {
          const n = arcadeStart + i*bayWidth;
          box(arcadeX,n,0,1.02,2.66,3.49,'brick',Math.PI/2);
          box(arcadeX,n,2.49,1.15,2.76,.24,'trim',Math.PI/2);
          box(arcadeX,n,4.11,.56,2.44,.95,'brick',Math.PI/2);
        }
        for (let bay = 0; bay < 5; bay++) {
          const center = arcadeStart + (bay+.5)*bayWidth;
          const arch = new THREE.Shape();
          arch.moveTo(-bayWidth/2,2.73);
          arch.lineTo(-1.92,2.73);
          arch.quadraticCurveTo(0,4.49,1.92,2.73);
          arch.lineTo(bayWidth/2,2.73);
          arch.lineTo(bayWidth/2,4.02);
          arch.lineTo(-bayWidth/2,4.02);
          arch.closePath();
          const span = new THREE.ExtrudeGeometry(arch,{depth:2.34,bevelEnabled:false,curveSegments:12});
          span.translate(0,0,-1.17);
          span.rotateY(Math.PI/2);
          span.translate(arcadeX,0,-center);
          add(span,'brick');
          for (const side of [-1,1])box(arcadeX+side*1.13,center,4.1,bayWidth-.56,.26,.76,'trim',Math.PI/2);
        }
        const arcadeCenter=arcadeStart+bayWidth*2.5;
        box(arcadeX,arcadeCenter,.025,24.85,2.75,.1,'stone',Math.PI/2);
        box(arcadeX,arcadeCenter,4.0,24.85,2.77,.2,'trim',Math.PI/2);
        finish();continue;
      }
      const main=[[-188.02,-364.14],[-176.19,-370.65],[-153,-348.24],[-151.27,-350.01],[-148.1,-346.96],[-153.66,-341.25],[-157.04,-344.52],[-162.22,-339.2]];
      shape(main,b.e,0,'brick');facades(main,b.e,4,'brick');
      roof(-169.2,-354.6,36,10.8,17.7,2.8,Math.PI/4,false);
      tower(-154.5,-345.9,7.3,7.3,19.5,5.2,Math.PI/4,true);
      arcade(-182.5,-378,24,Math.PI/2);
    } else if(b.s==='B84') {
      // Library reference album: front 01/02/03, stair tower 05/06 and roof 07/09.
      const [leftEnd, rightEnd] = [b.r[0], b.r.at(-1)];
      const angle = Math.atan2(rightEnd[1]-leftEnd[1],rightEnd[0]-leftEnd[0]);
      const ux = Math.cos(angle), un = Math.sin(angle);
      const cx = (leftEnd[0]+rightEnd[0])/2, cn = (leftEnd[1]+rightEnd[1])/2;
      const front = (u,v) => [cx+ux*u-un*v,cn+un*u+ux*v];
      const put = (u,v,y,w,d,h,material) => box(...front(u,v),y,w,d,h,material,angle);
      const edgeLength = Math.hypot(rightEnd[0]-leftEnd[0],rightEnd[1]-leftEnd[1]);
      const plazaLevel = -.12, landing = 1.46, porchTop = 6.35, wingTop = 20.25;
      const porchHalfWidth = 13, recess = 3.05, holesBottom = 7.65, holesHeight = 1.08;
      const inset = (halfWidth,depth) => [...b.r,
        front(halfWidth,0),front(halfWidth,-depth),front(-halfWidth,-depth),front(-halfWidth,0)
      ];
      // The front of the lower block is indented so the entrance can cast a real shadow.
      shape(inset(porchHalfWidth,recess),porchTop-plazaLevel,plazaLevel,mat);
      shape(b.r,holesBottom-porchTop,porchTop,mat);
      shape(inset(porchHalfWidth,.52),holesHeight,holesBottom,mat);
      shape(b.r,wingTop-holesBottom-holesHeight,holesBottom+holesHeight,mat);
      shape(b.r,.19,wingTop,'stone');
      put(0,-8.3,wingTop,edgeLength-.6,16.6,b.e-wingTop,mat);
      put(0,-8.3,b.e,edgeLength-.6,16.6,.15,'stone');

      put(0,-1.35,porchTop-.21,26.4,3.6,.32,'trim');
      put(0,-.1,plazaLevel,26.6,6.3,landing-plazaLevel,'stone');
      const riserCount = 7, stairRun = 4;
      for(let riser=0;riser<riserCount;riser++) {
        const remainingRun = stairRun*(1-riser/riserCount);
        put(0,3.05+remainingRun/2,plazaLevel,25.4,remainingRun,(landing-plazaLevel)*(riser+1)/riserCount,'stone');
      }
      for(const side of [-1,1]) {
        put(side*4.5,-.85,landing,1.4,2.5,porchTop-landing,mat);
        put(side*15.55,-2.93,plazaLevel,6.2,6.0,b.h-.16-plazaLevel,mat);
        put(side*15.55,-2.93,b.h-.16,6.2,6.0,.16,'trim');
        put(side*14.15,.85,plazaLevel,3.4,2.6,1.8-plazaLevel,mat);
        put(side*14.15,.85,1.8,3.44,2.64,.12,'stone');
        beam([...front(side*14.65,7.0),plazaLevel-.07],[...front(side*14.65,2.6),landing-.07],2.8,.15,'stone');
        for(const rail of [side*13.38,side*15.92]) {
          beam([...front(rail,7.0),plazaLevel+.92],[...front(rail,2.6),landing+.92],.07,.07,'metal');
          for(let post=0;post<4;post++){
            const t=post/3;
            put(rail,7.0-4.4*t,plazaLevel+(landing-plazaLevel)*t,.07,.07,.92,'metal');
          }
        }
      }
      const glassBay = (u,width) => {
        const bottom = landing, tall = porchTop-bottom-.36;
        put(u,-recess+.045,bottom,width,.10,tall,'glass');
        for(let column=0;column<=4;column++) put(u+width*(column/4-.5),-recess+.13,bottom,.09,.16,tall,'dark');
        for(const level of [0,2.25,tall]) put(u,-recess+.13,bottom+level,width,.16,.09,'dark');
      };
      glassBay(0,7.56);
      glassBay(-7.48,4.19);
      glassBay(7.48,4.19);
      for(const handle of [-.22,.22]) put(handle,-recess+.23,landing+.95,.045,.05,.38,'metal');
      // Twelve small square openings above the lintel, recessed behind brick webs.
      const apertureStep = porchHalfWidth/6, apertureWidth = .83;
      for(let opening=0;opening<12;opening++) {
        const u = (opening-5.5)*apertureStep;
        put(u,-.48,holesBottom,apertureWidth,.11,holesHeight,'glass');
        put(u,0,holesBottom,apertureWidth+.12,.15,.09,'stone');
        if(opening<11) put(u+apertureStep/2,-.26,holesBottom,apertureStep-apertureWidth,.52,holesHeight,mat);
      }
      for(const side of [-1,1]) put(side*(porchHalfWidth-.33),-.26,holesBottom,.66,.52,holesHeight,mat);

      // At the right-hand corner, the stair tower sits against the side wall.
      const wingEdge = (index) => {
        const a=b.r[index], b2=b.r[(index+1)%b.r.length];
        const len=Math.hypot(b2[0]-a[0],b2[1]-a[1]);
        const x=(b2[0]-a[0])/len,n=(b2[1]-a[1])/len;
        return {len,angle:Math.atan2(n,x),point:(u,v)=>[a[0]+x*u+n*v,a[1]+n*u-x*v]};
      };
      const towerEdge = wingEdge(0), towerTop = 23.4;
      const tower = (u,v,y,w,d,h,m) => box(...towerEdge.point(u,v),y,w,d,h,m,towerEdge.angle);
      tower(5.3,1.04,plazaLevel,3.95,2.64,.10-plazaLevel,'stone');
      tower(5.3,1.04,.10,3.85,2.55,towerTop-.10,'glass');
      tower(5.3,1.04,towerTop,4.11,2.82,.22,'dark');
      for(const u of [3.35,5.3,7.25]) tower(u,2.34,.1,.09,.13,towerTop-.1,'dark');
      for(const v of [1.17,2.34]) for(const u of [3.34,7.26]) tower(u,v,.1,.09,.13,towerTop-.10,'dark');
      for(let y=2.9;y<towerTop;y+=2.9) {
        tower(5.3,2.34,y,3.97,.14,.075,'dark');
        for(const u of [3.34,7.26]) tower(u,1.04,y,.12,2.67,.075,'dark');
      }
      // The wings carry tall reading-room windows beneath rows of masonry slots.
      for(let index=0;index<b.r.length-1;index++) {
        const edge=wingEdge(index);
        const place=(u,v,y,w,d,h,m)=>box(...edge.point(u,v),y,w,d,h,m,edge.angle);
        const start=index===0?10:2.4, stop=edge.len-2.4;
        const spacing=4.8;
        if(stop-start<spacing)continue;
        place(edge.len/2,.08,.06,edge.len,.35,.37,'stone');
        place(edge.len/2,.10,wingTop-.35,edge.len,.46,.21,'trim');
        for(let u=start;u<=stop;u+=spacing) {
          place(u,.08,.94,2.5,.17,8.48,'dark');
          place(u,.18,1.13,2.08,.09,8.05,'glass');
          place(u,.26,1.13,.09,.13,8.05,'metal');
          for(const level of [3.85,6.5]) place(u,.26,level,2.09,.13,.08,'metal');
          place(u-spacing*.5,.24,.38,.64,.53,9.53,mat);
          place(u,.1,11.38,1.17,.19,2.08,'dark');
          place(u,.22,11.52,.92,.08,1.8,'glass');
        }
      }
      // Recessed rooftop decks face a white window wall beneath the gable.
      for(const index of [0,6]) {
        const edge=wingEdge(index), length=edge.len-(index===0?16:19);
        const terrace=(u,v,y,w,d,h,m)=>box(...edge.point(u,v),y,w,d,h,m,edge.angle);
        const ridge=edge.point(edge.len/2,-17.8);
        roof(...ridge,length,15.2,wingTop+.23,3.5,edge.angle,false);
        terrace(edge.len/2,-5.0,wingTop+.18,length,8.6,.15,'stone');
        terrace(edge.len/2,-.47,wingTop+.18,length,.32,1.03,mat);
        terrace(edge.len/2,-.47,wingTop+1.21,length,.4,.075,'trim');
        terrace(edge.len/2,-11.9,wingTop+.23,length-.4,3.6,1.82,'cream');
        terrace(edge.len/2,-11.9,wingTop+2.05,length-.22,3.9,.16,'trim');
        for(let u=(edge.len-length)/2+2.4;u<(edge.len+length)/2-1;u+=3.5) {
          terrace(u,-10.075,wingTop+.51,1.38,.09,1.35,'glass');
          terrace(u,-10.01,wingTop+.51,.08,.10,1.35,'dark');
        }
      }
      if(hasPhotos){
        photoPlane(...front(0,.025),18.06,25.4,10.7,angle+Math.PI,'libraryFront');
      }else{
        const sign=front(0,.045);
        g.userData.sign={text:'圖  書  館',x:sign[0],n:sign[1],y:19,w:16,h:2.2,angle:angle+Math.PI};
      }
    } else {
      const e=b.e;
      const shell=b.detail==='mall'?b.r.filter(p=>p[1]<(23.14698-23.14195)*110950):b.r;
      const teachingCourt=hasPhotos&&['B86','B89'].includes(b.s);
      if(teachingCourt){
        // The north and south walls facing the landscaped courtyard are open galleries.
        const galleryEdges=new Set([5,9]);
        const wallRing=[];
        const area=shell.reduce((sum,[x,n],i)=>{const [u,v]=shell[(i+1)%shell.length];return sum+x*v-u*n;},0);
        const orientation=Math.sign(area);
        for(let i=0;i<shell.length;i++){
          const a=shell[i],end=shell[(i+1)%shell.length];
          wallRing.push(a);
          if(!galleryEdges.has(i))continue;
          const length=Math.hypot(end[0]-a[0],end[1]-a[1]);
          const ux=(end[0]-a[0])/length,un=(end[1]-a[1])/length;
          const nx=un*orientation,nn=-ux*orientation;
          const angle=Math.atan2(un,ux);
          const galleryDepth=2.15;
          const point=(u,v)=>[a[0]+ux*u+nx*v,a[1]+un*u+nn*v];
          wallRing.push(point(.3,0),point(.3,-galleryDepth),point(length-.3,-galleryDepth),point(length-.3,0));
          const bayCount=Math.round(length/5.8),bayWidth=(length-.6)/bayCount;
          const bayCenter=length/2;
          for(let floor=0;floor<4;floor++){
            const y=floor*4.5;
            const slab=point(bayCenter,-galleryDepth*.5);
            box(...slab,y,length-.6,galleryDepth+.07,.28,'stone',angle);
            box(...point(bayCenter,.13),y+.25,length-.6,.28,.57,'trim',angle);
            for(let j=0;j<bayCount;j++){
              const post=.3+j*bayWidth;
              box(...point(post,.02),y,.62,.7,4.5,'brick',angle);
              const opening=point(post+bayWidth*.52,-galleryDepth);
              detailedWindow(...opening,y+1.1,1.65,2.15,angle,nx,nn,(floor+j)%4);
            }
          }
          box(...point(length-.3,.02),0,.6,.7,e,'brick',angle);
          box(...point(bayCenter,.03),e-.64,length-.32,.72,.64,'brick',angle);
        }
        shape(wallRing,e,0,mat);
        shape(shell,.24,e,'stone');
        facades(shell,e,b.floors,b.detail,a=>galleryEdges.has(shell.indexOf(a)));
      }else{
        shape(shell,e,0,mat);shape(shell,.24,e,'stone');
      facades(shell,e,b.floors,b.detail);
      }
      if(b.p&&b.g){const r=b.g;roof(r.cx,r.cy,r.hl*2+.6,r.hw*2+.6,e,b.h-e,Math.atan2(r.uy,r.ux));}
      if(['B86','B89'].includes(b.s)) {
        const minX=Math.min(...b.r.map(p=>p[0])),maxX=Math.max(...b.r.map(p=>p[0])),minN=Math.min(...b.r.map(p=>p[1])),maxN=Math.max(...b.r.map(p=>p[1]));
        roof((minX+maxX)/2,maxN-6.5,maxX-minX-10,13,e,3.9,0,false);
        roof((minX+maxX)/2,minN+6,maxX-minX,12.8,e,3.9,0,false);
        roof(maxX-6,(minN+maxN)/2,maxN-minN-14,11,e,3.4,Math.PI/2,false);
        if(teachingCourt){
          // Both photo sets show a white neck below the clipped slate cap; there is no clock here.
          const towerX=maxX-17,towerN=maxN-7.8;
          box(towerX,towerN,0,6.9,6.9,e+1,'brick');
          box(towerX,towerN,e+1,7.06,7.06,1.85,'trim');
          box(towerX,towerN,e+2.75,7.38,7.38,.25,'stone');
          const corners=(radius,y)=>[[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,z])=>[towerX+x*radius,y,-towerN+z*radius]);
          const lower=corners(3.7,e+3),upper=corners(1.5,b.h),positions=[];
          for(let i=0;i<4;i++){
            const j=(i+1)%4;
            positions.push(...lower[i],...lower[j],...upper[j],...lower[i],...upper[j],...upper[i]);
          }
          positions.push(...upper[0],...upper[2],...upper[1],...upper[0],...upper[3],...upper[2]);
          const cap=new THREE.BufferGeometry();
          cap.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
          cap.computeVertexNormals();add(cap,'roof');
          for(let floor=0;floor<5;floor++){
            const y=1.5+floor*3.35;
            detailedWindow(towerX-.85,towerN-3.45,y,.62,1.78,0,0,-1,floor%4);
            detailedWindow(towerX+.85,towerN-3.45,y,.62,1.78,0,0,-1,(floor+2)%4);
          }
          for(const north of [minN+6.4,maxN-6.5]){
            for(const side of [-1,1]){
              const bandNorth=north+side*6.47;
              const width=maxX-minX-14;
              box((minX+maxX)/2,bandNorth,e-.93,width,.18,.91,'trim');
              for(let x=minX+9;x<maxX-9;x+=3.4)box(x,bandNorth+side*.12,e-.69,1.5,.15,.54,'glass');
            }
          }
          if(b.s==='B86'){
            // The aerial photo locates the masonry gateway on the shared courtyard axis.
            const gateX=-464,gateNorth=-405,gateAngle=Math.PI/2;
            const left=-418.6,right=-388.8,passage=4.9;
            for(const offset of [-1,1]){
              const pierNorth=gateNorth+offset*(passage/2+.46);
              box(gateX,pierNorth,0,.92,5,4.4,'brick',gateAngle);
              box(gateX,pierNorth,0,1.16,5.2,.32,'stone',gateAngle);
              box(gateX,pierNorth,3.25,1.03,5.13,.22,'trim',gateAngle);
            }
            const radius=passage/2,curve=new THREE.Shape();
            curve.moveTo(-radius-.45,3.15);
            curve.lineTo(-radius-.45,4.65);
            curve.lineTo(radius+.45,4.65);
            curve.lineTo(radius+.45,3.15);
            curve.lineTo(radius,3.15);
            for(let step=1;step<=14;step++){
              const angle=Math.PI*step/14;
              curve.lineTo(Math.cos(angle)*radius,3.15+Math.sin(angle)*1.06);
            }
            curve.closePath();
            const portal=new THREE.ExtrudeGeometry(curve,{depth:4.82,bevelEnabled:false});
            portal.translate(0,0,-2.41);portal.rotateY(gateAngle);portal.translate(gateX,0,-gateNorth);
            add(portal,'brick');
            box(gateX,gateNorth,4.65,7.15,5.73,.25,'trim',gateAngle);
            roof(gateX,gateNorth,7.02,5.7,4.9,2.45,gateAngle,true);
            for(const [start,end] of [[left,gateNorth-3.45],[gateNorth+3.45,right]]){
              const span=end-start,center=(start+end)/2;
              box(gateX,center,3.7,span,2.4,.46,'brick',gateAngle);
              box(gateX,center,4.16,span+.12,2.69,.22,'trim',gateAngle);
              const sections=Math.ceil(span/3.9);
              for(let j=1;j<sections;j++)box(gateX,start+span*j/sections,0,.58,1.68,3.7,'brick',gateAngle);
            }
          }
        }else tower(minX+6,maxN-8,7,7,e+1,1.8,0,false);
        box((minX+maxX)/2,(minN+maxN)/2,-.02,32,14,.09,'stone');
      }
      if(['B73','B78','B80'].includes(b.s)) {
        const edges=b.r.map((a,i)=>{const z=b.r[(i+1)%b.r.length];return{a,z,len:Math.hypot(z[0]-a[0],z[1]-a[1])};}).sort((a,z)=>z.len-a.len);
        const edge=edges[0],a=edge.a,z=edge.z,angle=Math.atan2(z[1]-a[1],z[0]-a[0]);
        const sign=1,width=12;
        const cx=(a[0]+z[0])/2-Math.sin(angle)*width/2*sign,cn=(a[1]+z[1])/2+Math.cos(angle)*width/2*sign;
        roof(cx,cn,edge.len*.88,width,e,3.4,angle,false);
        if(b.s==='B73')tower(b.r[0][0],b.r[0][1],6,6,e+3,2,angle,false);
      }
      if(b.detail==='mall') {
        const x=(113.025789-113.0216)*102400,n=(23.147042-23.14195)*110950;
        cyl(x,n,0,18,15.9,'glass',48,20.2);cyl(x,n,15.9,22.2,.8,'trim',48);cyl(x,n,16.7,14.5,1.2,'stone',48);
        for(let i=0;i<24;i++){const a=i*Math.PI/12,c=Math.cos(a),s=Math.sin(a);beam([x+c*18,n+s*18,.1],[x+c*20.6,n+s*20.6,16],.35,.35,'trim');}
        for(let j=1;j<4;j++){const y=j*4.1,r=18+y/16*2.2;const tor=new THREE.TorusGeometry(r,.16,4,64);tor.rotateX(Math.PI/2);tor.translate(x,y,-n);add(tor,'metal');}
      }
      if(b.detail==='cream'&&b.r.length<=5){roof(bb.x,bb.n,bb.w+.8,bb.d+.8,e,2.3,bb.angle,true,['B64','B67','B70'].includes(b.s)?'red':'roof');}
      if(b.detail==='cream'&&b.r.length>5){for(let i=0;i<b.r.length;i++){const a=b.r[i],z=b.r[(i+1)%b.r.length],len=Math.hypot(z[0]-a[0],z[1]-a[1]);if(len<20)continue;const angle=Math.atan2(z[1]-a[1],z[0]-a[0]),w=8;roof((a[0]+z[0])/2-Math.sin(angle)*w/2,(a[1]+z[1])/2+Math.cos(angle)*w/2,len,w,e,2.1,angle,true,b.s==='B81'?'red':'roof');}}
      if(b.detail==='gym') {box(bb.x,bb.n,e,bb.w,bb.d,.5,'metal',bb.angle);for(let k=-5;k<=5;k++)box(bb.x+Math.cos(bb.angle)*k*3,bb.n+Math.sin(bb.angle)*k*3,e+.5,.12,bb.d,.1,'trim',bb.angle);}
      if(b.detail==='residence'&&!b.p){box(bb.x,bb.n,e+.1,Math.min(bb.w,8),Math.min(bb.d,6),1.2,'wall',bb.angle);}
    }
    finish();
  }
  begin(sports);
  const sp=data.sport,c=sp.ux,s=sp.un,angle=Math.atan2(s,c),P=(u,v)=>[sp.x+c*u-s*v,sp.n+s*u+c*v];
  const stadium=r=>{const pts=[];for(let j=0;j<=48;j++){const a=-Math.PI/2+j*Math.PI/48;pts.push(P(sp.straight/2+Math.cos(a)*r,Math.sin(a)*r));}for(let j=0;j<=48;j++){const a=Math.PI/2+j*Math.PI/48;pts.push(P(-sp.straight/2+Math.cos(a)*r,Math.sin(a)*r));}return pts;};
  shape(stadium(sp.radius+9),.15,.04,'track');shape(stadium(sp.radius),0,.205,'turf');
  for(let j=0;j<12;j++){const p=P(-52.5+(j+.5)*105/12,0);box(p[0],p[1],.22,105/12,65,.03,j%2?'turf':'turf2',angle);}
  function mark(pts,width=.15){for(let j=1;j<pts.length;j++)beam([...pts[j-1],.29],[...pts[j],.29],width,.035,'line');}
  for(let lane=0;lane<8;lane++){const r=stadium(sp.radius+lane*1.2);mark([...r,r[0]],.12);}
  mark([P(-52.5,-32.5),P(52.5,-32.5),P(52.5,32.5),P(-52.5,32.5),P(-52.5,-32.5)]);mark([P(0,-32.5),P(0,32.5)]);
  mark(Array.from({length:49},(_,j)=>P(Math.cos(j*Math.PI/24)*9.15,Math.sin(j*Math.PI/24)*9.15)));
  for(const side of [-1,1]){mark([P(side*52.5,-20.15),P(side*36,-20.15),P(side*36,20.15),P(side*52.5,20.15)]);const l=P(side*52.5,-3.66),r=P(side*52.5,3.66);beam([...l,.3],[...l,2.74],.12,.12);beam([...r,.3],[...r,2.74],.12,.12);beam([...l,2.74],[...r,2.74],.12,.12);}
  finish();
  return {root,sports,materials,texturesReady,stats:{buildings:root.children.length,meshBatches:counter}};
}
if(typeof module!=='undefined')module.exports=createCampusBuildings;
