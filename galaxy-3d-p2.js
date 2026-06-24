import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

// ─── Scene Setup ───
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, innerWidth/innerHeight, 0.5, 2000);
camera.position.set(50, 180, 280);

const renderer = new THREE.WebGLRenderer({antialias:true,alpha:true});
renderer.setSize(innerWidth,innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio,2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
document.getElementById('c').appendChild(renderer.domElement);

const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(innerWidth,innerHeight);
labelRenderer.domElement.style.position='fixed';labelRenderer.domElement.style.top='0';
labelRenderer.domElement.style.pointerEvents='none';labelRenderer.domElement.style.left='0';
labelRenderer.domElement.style.zIndex='3';
document.body.appendChild(labelRenderer.domElement);

const controls = new OrbitControls(camera,renderer.domElement);
controls.enableDamping=true;controls.dampingFactor=0.06;
controls.minDistance=40;controls.maxDistance=600;
controls.target.set(0,0,0);controls.update();

// ─── Lighting ───
scene.add(new THREE.AmbientLight(0x1a1a3e,0.8));
const cl = new THREE.PointLight(0xff8800,400,250);cl.position.set(0,0,0);scene.add(cl);
const al = new THREE.DirectionalLight(0x4488ff,0.5);al.position.set(100,200,100);scene.add(al);
scene.add(new THREE.PointLight(0x3388ff,80,200));

// ─── Stars ───
const sg=new THREE.BufferGeometry();const sv=[];
for(let i=0;i<5000;i++){const r=400+Math.random()*600;const t=Math.random()*Math.PI*2;const p=Math.acos(2*Math.random()-1);
  sv.push(r*Math.sin(p)*Math.cos(t),r*Math.sin(p)*Math.sin(t),r*Math.cos(p));}
sg.setAttribute('position',new THREE.Float32BufferAttribute(sv,3));
scene.add(new THREE.Points(sg,new THREE.PointsMaterial({color:0xffffff,size:0.3,transparent:true,opacity:0.6,blending:THREE.AdditiveBlending,depthWrite:false})));

// ─── Wireframe Sphere Grid ───
const sphereWireGeo = new THREE.SphereGeometry(160,24,18);
const sphereWireMat = new THREE.MeshBasicMaterial({color:0x00aaff,wireframe:true,transparent:true,opacity:0.04,depthWrite:false});
const sphereWire = new THREE.Mesh(sphereWireGeo,sphereWireMat);scene.add(sphereWire);
// Inner shells
const innerShell = new THREE.Mesh(new THREE.SphereGeometry(90,16,12),sphereWireMat.clone());innerShell.material.opacity=0.025;scene.add(innerShell);
const innerShell2 = new THREE.Mesh(new THREE.SphereGeometry(60,16,12),sphereWireMat.clone());innerShell2.material.opacity=0.015;scene.add(innerShell2);

// ─── Entity Data ───
const COLORS = {
  amir:0xffaa00, mindset:0xaabbcc, ventures:0x00cccc,
  'content-empire':0xff44ff, lamatree:0x44ff88, grademy:0xaa44ff,
  lamabroker:0xff8800, pripitch:0xff3344, 'great-dami':0xffd700, rema:0x44dd66,
  lamatrader:0xffdd00, ragmedium:0x00eeff, ragx:0x44aaff,
  syneticx:0x8844cc, unitas:0x4488ff, waterspring:0x44ddff
};

const entities = [
  // Center
  {id:'amir',label:'AMIR',radius:0,color:'amir',shape:'sun',size:12,level:0,tag:'Commander'},
  // Inner ring R~40
  {id:'mindset',label:'MINDSET',radius:40,color:'mindset',shape:'circle',size:7,level:1,tag:'Discipline'},
  {id:'ventures',label:'VENTURES',radius:40,color:'ventures',shape:'diamond',size:7,level:1,tag:'Ideas'},
  // Mid-inner R~70
  {id:'content-empire',label:'CONTENT EMPIRE',radius:70,color:'content-empire',shape:'play',size:9,level:2,tag:'Media'},
  {id:'lamatree',label:'LAMATREE',radius:70,color:'lamatree',shape:'tree',size:9,level:2,tag:'Referral'},
  {id:'grademy',label:'GRADEMY',radius:70,color:'grademy',shape:'pyramid',size:9,level:2,tag:'EdTech'},
  // Mid R~100
  {id:'lamabroker',label:'LAMABROKER',radius:100,color:'lamabroker',shape:'blocks',size:11,level:3,tag:'Brokerage'},
  {id:'pripitch',label:'PRIPITCH',radius:100,color:'pripitch',shape:'rocket',size:11,level:3,tag:'Pitch AI'},
  {id:'great-dami',label:'GREAT DAMI',radius:100,color:'great-dami',shape:'star',size:11,level:3,tag:'Startup'},
  {id:'rema',label:'REMA',radius:100,color:'rema',shape:'house',size:11,level:3,tag:'Exteriors'},
  // Outer R~140
  {id:'lamatrader',label:'LAMATRADER',radius:140,color:'lamatrader',shape:'barchart',size:15,level:4,tag:'ITE'},
  {id:'ragmedium',label:'RAGMEDIUM',radius:140,color:'ragmedium',shape:'network',size:15,level:4,tag:'AI Enrich'},
  {id:'ragx',label:'RAGX',radius:140,color:'ragx',shape:'nodes',size:15,level:4,tag:'Outreach'},
  {id:'syneticx',label:'SYNETICX',radius:140,color:'syneticx',shape:'hexagon',size:14,level:3,tag:'Client'},
  {id:'unitas',label:'UNITAS',radius:140,color:'unitas',shape:'rings',size:14,level:3,tag:'Client'},
  {id:'waterspring',label:'WATERSPRING',radius:140,color:'waterspring',shape:'droplet',size:14,level:3,tag:'Client'}
];

// ─── Fibonacci Sphere Placement ───
function placeOnSphere(idx,total,radius,yOffset=0){
  if(radius===0)return{x:0,y:0,z:0};
  const goldenRatio=(1+Math.sqrt(5))/2;
  const theta=2*Math.PI*idx/goldenRatio;
  const phi=Math.acos(1-2*(idx+0.5)/total);
  const x=radius*Math.sin(phi)*Math.cos(theta);
  const y=radius*Math.sin(phi)*Math.sin(theta);
  const z=radius*Math.cos(phi);
  return {x,y,z};
}

// ─── Shape Builders ───
function makeMat(color,opacity=0.5,emissiveIntensity=0.4){
  return new THREE.MeshPhysicalMaterial({
    color,emissive:color,emissiveIntensity,roughness:0.2,metalness:0.1,
    transparent:true,opacity,clearcoat:0.3,side:THREE.DoubleSide
  });
}
function wireframeOverlay(geo,color){
  const edges=new THREE.EdgesGeometry(geo);
  return new THREE.LineSegments(edges,new THREE.LineBasicMaterial({color,transparent:true,opacity:0.3}));
}

function buildSun(color,size){
  const g=new THREE.Group();
  const c=new THREE.Color(color);
  const m=makeMat(c,0.9,0.8);
  const sphere=new THREE.Mesh(new THREE.SphereGeometry(size,48,48),m);g.add(sphere);
  g.add(wireframeOverlay(new THREE.SphereGeometry(size*1.02,24,24),c));
  // Glow aura
  const aura=new THREE.Mesh(new THREE.SphereGeometry(size*1.8,24,24),
    new THREE.ShaderMaterial({uniforms:{c:{value:c}},vertexShader:'varying vec3 vN;varying vec3 vP;void main(){vN=normalize(normalMatrix*normal);vec4 p=modelViewMatrix*vec4(position,1.);vP=p.xyz;gl_Position=projectionMatrix*p;}',
    fragmentShader:'uniform vec3 c;varying vec3 vN;varying vec3 vP;void main(){vec3 v=normalize(-vP);float i=pow(0.6-dot(vN,v),3.);gl_FragColor=vec4(c,i*0.4);}',
    transparent:true,depthWrite:false,blending:THREE.AdditiveBlending}));
  g.add(aura);
  return g;
}

function buildCircle(color,size){
  const g=new THREE.Group();const c=new THREE.Color(color);
  const m=makeMat(c);const s=new THREE.Mesh(new THREE.SphereGeometry(size,32,32),m);g.add(s);
  g.add(wireframeOverlay(new THREE.SphereGeometry(size*1.05,16,16),c));
  return g;
}

function buildDiamond(color,size){
  const g=new THREE.Group();const c=new THREE.Color(color);
  const m=makeMat(c,0.6,0.5);
  const geo=new THREE.OctahedronGeometry(size,0);
  g.add(new THREE.Mesh(geo,m));
  g.add(wireframeOverlay(geo.clone(),c));
  return g;
}

function buildPlayButton(color,size){
  const g=new THREE.Group();const c=new THREE.Color(color);
  const m=makeMat(c,0.5,0.4);
  // Triangle
  const sh=new THREE.Shape();sh.moveTo(0,-size*0.9);sh.lineTo(size*1.0,0);sh.lineTo(0,size*0.9);sh.closePath();
  const ext=new THREE.ExtrudeGeometry(sh,{depth:size*0.4,bevelEnabled:false});
  g.add(new THREE.Mesh(ext,m));
  g.add(wireframeOverlay(ext.clone(),c));
  // Ring around it
  const ring=new THREE.Mesh(new THREE.TorusGeometry(size*1.2,0.15,8,32),new THREE.MeshBasicMaterial({color:c,transparent:true,opacity:0.3}));
  ring.rotation.x=Math.PI/2;g.add(ring);
  return g;
}

function buildTree(color,size){
  const g=new THREE.Group();const c=new THREE.Color(color);const m=makeMat(c,0.5,0.4);
  const trunk=new THREE.Mesh(new THREE.CylinderGeometry(size*0.15,size*0.25,size*0.8,8),m);
  trunk.position.y=-size*0.4;g.add(trunk);
  for(let i=0;i<3;i++){
    const r=size*(0.7-i*0.2);const h=size*(0.6-i*0.15);const y=size*(0.1+i*0.35);
    const cone=new THREE.Mesh(new THREE.ConeGeometry(r,h,12),m);cone.position.y=y;g.add(cone);
    g.add(wireframeOverlay(new THREE.ConeGeometry(r*1.05,h*1.05,12),c));
  }
  return g;
}

function buildPyramid(color,size){
  const g=new THREE.Group();const c=new THREE.Color(color);const m=makeMat(c,0.5,0.4);
  const cone=new THREE.Mesh(new THREE.ConeGeometry(size*0.8,size*1.2,4),m);g.add(cone);
  g.add(wireframeOverlay(new THREE.ConeGeometry(size*0.85,size*1.25,4),c));
  return g;
}

function buildBlocks(color,size){
  const g=new THREE.Group();const c=new THREE.Color(color);const m=makeMat(c,0.5,0.4);
  const w=size*0.6;
  for(let i=0;i<3;i++){
    const h=size*(0.4+i*0.3);const box=new THREE.Mesh(new THREE.BoxGeometry(w,h*0.7,w),m);
    box.position.set(-w/2+i*w/2,h*0.35,0);g.add(box);
    g.add(wireframeOverlay(new THREE.BoxGeometry(w*1.05,h*0.75,w*1.05),c));
  }
  return g;
}

function buildRocket(color,size){
  const g=new THREE.Group();const c=new THREE.Color(color);const m=makeMat(c,0.6,0.5);
  const body=new THREE.Mesh(new THREE.CylinderGeometry(size*0.2,size*0.35,size*1.0,12),m);
  body.position.y=0;g.add(body);
  const nose=new THREE.Mesh(new THREE.ConeGeometry(size*0.25,size*0.4,12),m);
  nose.position.y=size*0.7;g.add(nose);
  // Fins
  for(let i=0;i<3;i++){
    const a=i*Math.PI*2/3;const fin=new THREE.Mesh(new THREE.BoxGeometry(size*0.05,size*0.3,size*0.25),m);
    fin.position.set(Math.sin(a)*size*0.35,-size*0.4,Math.cos(a)*size*0.35);
    fin.rotation.y=-a;g.add(fin);
  }
  // Thruster glow
  const glow=new THREE.Mesh(new THREE.SphereGeometry(size*0.2,8,8),
    new THREE.MeshBasicMaterial({color:0xff6600,transparent:true,opacity:0.6}));
  glow.position.y=-size*0.6;g.add(glow);
  g.add(wireframeOverlay(new THREE.CylinderGeometry(size*0.22,size*0.37,size*1.0,12),c));
  return g;
}

function buildStar(color,size){
  const g=new THREE.Group();const c=new THREE.Color(color);const m=makeMat(c,0.6,0.5);
  const pts=5;const outer=size;const inner=size*0.4;
  const sh=new THREE.Shape();
  for(let i=0;i<pts*2;i++){
    const r=i%2===0?outer:inner;const a=i/pts*Math.PI-Math.PI/2;
    i===0?sh.moveTo(r*Math.cos(a),r*Math.sin(a)):sh.lineTo(r*Math.cos(a),r*Math.sin(a));
  }sh.closePath();
  const ext=new THREE.ExtrudeGeometry(sh,{depth:size*0.4,bevelEnabled:false});
  g.add(new THREE.Mesh(ext,m));g.add(wireframeOverlay(ext.clone(),c));
  return g;
}

function buildHouse(color,size){
  const g=new THREE.Group();const c=new THREE.Color(color);const m=makeMat(c,0.5,0.4);
  const wall=new THREE.Mesh(new THREE.BoxGeometry(size*1.0,size*0.6,size*0.8),m);
  wall.position.y=-size*0.1;g.add(wall);
  const roof=new THREE.Mesh(new THREE.ConeGeometry(size*0.8,size*0.6,4),m);
  roof.position.y=size*0.4;roof.rotation.y=Math.PI/4;g.add(roof);
  g.add(wireframeOverlay(new THREE.BoxGeometry(size*1.05,size*0.65,size*0.85),c));
  g.add(wireframeOverlay(new THREE.ConeGeometry(size*0.85,size*0.6,4),c));
  return g;
}

function buildBarChart(color,size){
  const g=new THREE.Group();const c=new THREE.Color(color);const m=makeMat(c,0.5,0.4);
  const w=size*0.25;
  for(let i=0;i<3;i++){
    const h=size*(0.4+i*0.35);const b=new THREE.Mesh(new THREE.BoxGeometry(w,h,w),m);
    b.position.set((i-1)*w*1.5,h/2,0);g.add(b);
    g.add(wireframeOverlay(new THREE.BoxGeometry(w*1.05,h*1.05,w*1.05),c));
  }
  return g;
}

function buildNetwork(color,size){
  const g=new THREE.Group();const c=new THREE.Color(color);const m=makeMat(c,0.5,0.4);
  const center=new THREE.Mesh(new THREE.SphereGeometry(size*0.3,24,24),m);g.add(center);
  // Orbital rings
  for(let i=0;i<2;i++){
    const r=size*(0.6+i*0.25);const ring=new THREE.Mesh(new THREE.TorusGeometry(r,0.05,8,32),
      new THREE.MeshBasicMaterial({color:c,transparent:true,opacity:0.3}));
    ring.rotation.x=i*Math.PI/3;ring.rotation.z=i*0.5;g.add(ring);
  }
  return g;
}

function buildNodes(color,size){
  const g=new THREE.Group();const c=new THREE.Color(color);const m=makeMat(c,0.5,0.4);
  const off=size*0.3;
  for(let i=0;i<2;i++){
    const s=new THREE.Mesh(new THREE.SphereGeometry(size*0.25,16,16),m);
    s.position.set((i-0.5)*off*2,0,0);g.add(s);
  }
  const bar=new THREE.Mesh(new THREE.CylinderGeometry(0.05,0.05,off*2,6),new THREE.MeshBasicMaterial({color:c,transparent:true,opacity:0.3}));
  bar.rotation.z=Math.PI/2;g.add(bar);
  return g;
}

function buildHexagon(color,size){
  const g=new THREE.Group();const c=new THREE.Color(color);const m=makeMat(c,0.5,0.4);
  const sh=new THREE.Shape();
  for(let i=0;i<6;i++){const a=i/6*Math.PI*2;const x=Math.cos(a)*size;const y=Math.sin(a)*size*0.8;
    i===0?sh.moveTo(x,y):sh.lineTo(x,y);}sh.closePath();
  const ext=new THREE.ExtrudeGeometry(sh,{depth:size*0.5,bevelEnabled:false});
  g.add(new THREE.Mesh(ext,m));g.add(wireframeOverlay(ext.clone(),c));
  return g;
}

function buildRings(color,size){
  const g=new THREE.Group();const c=new THREE.Color(color);const m=makeMat(c,0.5,0.4);
  const center=new THREE.Mesh(new THREE.SphereGeometry(size*0.2,16,16),m);g.add(center);
  for(let i=0;i<3;i++){
    const r=size*(0.4+i*0.25);const ring=new THREE.Mesh(new THREE.TorusGeometry(r,0.06,8,32),
      new THREE.MeshBasicMaterial({color:c,transparent:true,opacity:0.3}));
    ring.rotation.x=i*0.8;ring.rotation.z=i*0.3;g.add(ring);
  }
  return g;
}

function buildDroplet(color,size){
  const g=new THREE.Group();const c=new THREE.Color(color);const m=makeMat(c,0.5,0.4);
  const pts=[];
  for(let i=0;i<20;i++){
    const t=i/19*Math.PI;
    const r=i<10?size*Math.sin(t*1.5)*0.8:size*(1-Math.pow(i-10,2)/100)*0.6;
    pts.push(new THREE.Vector2(Math.sin(t)*r*0.5,t*size*0.5));
  }
  const lathe=new THREE.LatheGeometry(pts,16);
  g.add(new THREE.Mesh(lathe,m));g.add(wireframeOverlay(lathe.clone(),c));
  return g;
}

const shapeBuilders={
  sun:buildSun,circle:buildCircle,diamond:buildDiamond,play:buildPlayButton,
  tree:buildTree,pyramid:buildPyramid,blocks:buildBlocks,rocket:buildRocket,
  star:buildStar,house:buildHouse,barchart:buildBarChart,network:buildNetwork,
  nodes:buildNodes,hexagon:buildHexagon,rings:buildRings,droplet:buildDroplet
};

// ─── Create Entities ───
const entityMeshes={};
const entityLabels={};
const entityPositions={};
const clickTargets=[];

entities.forEach((ent,i)=>{
  const colorVal=COLORS[ent.color];
  // Position on sphere
  const rings={};entities.forEach(e=>{
    if(!rings[e.radius])rings[e.radius]=[];
    rings[e.radius].push(e);
  });
  // Find my index within my radius group
  const myRing=rings[ent.radius];
  const ringIdx=myRing.indexOf(ent);
  const pos=placeOnSphere(ringIdx,myRing.length,ent.radius);
  if(ent.radius===0){pos.x=0;pos.y=0;pos.z=0;}
  entityPositions[ent.id]=pos;

  // Build shape
  const builder=shapeBuilders[ent.shape];
  const meshGroup=builder?builder(colorVal,ent.size):buildCircle(colorVal,ent.size);
  meshGroup.position.set(pos.x,pos.y,pos.z);
  meshGroup.userData={entityId:ent.id,isEntity:true};
  scene.add(meshGroup);
  entityMeshes[ent.id]=meshGroup;
  clickTargets.push(meshGroup);

  // Label (hidden by default, inside the planet)
  const lblDiv=document.createElement('div');
  lblDiv.textContent=ent.label;
  lblDiv.style.cssText='color:rgba(255,255,255,0.8);font-size:9px;font-weight:600;letter-spacing:1px;font-family:monospace;'+
    'background:transparent;padding:1px 4px;border-radius:2px;pointer-events:none;text-shadow:0 0 8px rgba(0,200,255,0.3);'+
    'transition:opacity 0.3s;opacity:0';
  const label=new CSS2DObject(lblDiv);
  label.position.set(pos.x,pos.y,pos.z);
  scene.add(label);
  entityLabels[ent.id]=label;
});

// ─── Radial Connections ───
function makeConnection(from,to,color,opacity=0.06){
  const f=entityPositions[from];const t=entityPositions[to];
  if(!f||!t)return;
  const mid=new THREE.Vector3().addVectors(new THREE.Vector3(f.x,f.y,f.z),new THREE.Vector3(t.x,t.y,t.z)).multiplyScalar(0.5);
  const curve=new THREE.QuadraticBezierCurve3(new THREE.Vector3(f.x,f.y,f.z),mid,new THREE.Vector3(t.x,t.y,t.z));
  const pts=curve.getPoints(20);
  const geo=new THREE.BufferGeometry().setFromPoints(pts);
  const line=new THREE.Line(geo,new THREE.LineBasicMaterial({color,transparent:true,opacity,depthWrite:false}));
  scene.add(line);
}

// Connect center to all
entities.forEach(e=>{if(e.id!=='amir')makeConnection('amir',e.id,0x4488ff,0.08);});
// RAGmedium ↔ RAGx
makeConnection('ragmedium','ragx',0x00eeff,0.15);
// Clients group
makeConnection('syneticx','unitas',0x8844cc,0.1);
makeConnection('syneticx','waterspring',0x8844cc,0.1);
makeConnection('unitas','waterspring',0x4488ff,0.1);
// Startups
makeConnection('pripitch','great-dami',0xffd700,0.1);

// ─── Glow Particles around Center ───
const pCount=200;const pg=new THREE.BufferGeometry();const ppos=[],psizes=[];
for(let i=0;i<pCount;i++){
  const r=15+Math.random()*25;const t=Math.random()*Math.PI*2;const p=Math.acos(2*Math.random()-1);
  ppos.push(r*Math.sin(p)*Math.cos(t),r*Math.sin(p)*Math.sin(t),r*Math.cos(p));
  psizes.push(0.5+Math.random()*1.5);
}
pg.setAttribute('position',new THREE.Float32BufferAttribute(ppos,3));
pg.setAttribute('size',new THREE.Float32BufferAttribute(psizes,1));
const pMat=new THREE.PointsMaterial({color:0xff8800,size:0.15,transparent:true,opacity:0.5,
  blending:THREE.AdditiveBlending,depthWrite:false});
const particles=new THREE.Points(pg,pMat);scene.add(particles);

document.getElementById('galaxy-3d-loaded').dispatchEvent(new Event('ready'));
console.log('[Galaxy] Scene initialized with',entities.length,'entities');
