#!/usr/bin/env python3
"""Replace vault template and vault graph rendering in index.html"""
import re

with open('index.html', 'r') as f:
    content = f.read()

# ─── 1. Replace vault template ───
old_template_marker = 'vault:`'
new_template_start = 'skills:`'

old_vault_template = """  vault:`
    <div style="padding:0;display:flex;flex-direction:column;height:100%">
      <div style="display:flex;gap:8px;align-items:center;padding:8px 12px;flex-shrink:0">
        <h2 style="margin:0;font-size:15px">\U0001F9E0 Knowledge Graph</h2>
        <span style="font-size:10px;color:var(--muted)">3D mindmap \u00b7 ${new Date().toISOString().slice(0,10)}</span>
        <span style="flex:1"></span>
        <span id="vaultStats" style="font-size:10px;color:var(--dim)"></span>
      </div>
      <div id="vaultCanvasWrap" style="flex:1;position:relative;overflow:hidden;background:var(--bg)">
        <canvas id="vaultCanvas" style="width:100%;height:100%;cursor:grab"></canvas>
        <div id="vaultNodeInfo" style="position:absolute;bottom:12px;left:50%;transform:translateX(-50%);background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:6px 14px;font-size:11px;color:var(--text);display:none"></div>
      </div>
    </div>`,"""

new_vault_template = """  vault:`
    <div style="padding:0;display:flex;flex-direction:column;height:100%">
      <div style="display:flex;gap:8px;align-items:center;padding:6px 12px;flex-shrink:0;border-bottom:1px solid var(--border)">
        <h2 style="margin:0;font-size:14px;font-weight:600">\U0001F9E0 Vault</h2>
        <span style="font-size:10px;color:var(--muted)">knowledge graph \u00b7 ${new Date().toISOString().slice(0,10)}</span>
        <span style="flex:1"></span>
        <div style="display:flex;gap:4px;align-items:center">
          <input id="vaultSearch" placeholder="Search nodes\u2026" style="padding:4px 8px;border-radius:6px;border:1px solid var(--border);background:var(--bg);color:var(--text);font-size:11px;width:140px;outline:none" oninput="vaultSearchChange(this.value)">
          <select id="vaultFilter" style="padding:4px 6px;border-radius:6px;border:1px solid var(--border);background:var(--bg);color:var(--text);font-size:10px" onchange="vaultFilterChange(this.value)">
            <option value="all">All</option>
            <option value="chat">\U0001F4AC Chats</option>
            <option value="business">\U0001F3E2 Businesses</option>
            <option value="document">\U0001F4C4 Docs</option>
            <option value="task">\u2705 Tasks</option>
            <option value="post">\U0001F4DD Posts</option>
            <option value="account">\U0001F517 Accounts</option>
            <option value="persona">\U0001F464 Personas</option>
          </select>
          <span id="vaultStats" style="font-size:10px;color:var(--dim);min-width:60px;text-align:right"></span>
        </div>
      </div>
      <div style="display:flex;flex:1;overflow:hidden">
        <div id="vaultCanvasWrap" style="flex:1;position:relative;overflow:hidden;background:var(--bg);min-width:0">
          <canvas id="vaultCanvas" style="width:100%;height:100%;display:block"></canvas>
          <div id="vaultMiniMap" style="position:absolute;bottom:8px;right:8px;width:120px;height:80px;background:rgba(0,0,0,0.5);border:1px solid var(--border);border-radius:6px;display:none"></div>
          <div id="vaultLoading" style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);color:var(--muted);font-size:13px">Loading knowledge graph\u2026</div>
          <div id="vaultEmpty" style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);color:var(--muted);font-size:13px;display:none;text-align:center;line-height:1.8">
            No data yet. Start chatting,<br>add projects, or upload documents.
          </div>
        </div>
        <div id="vaultDetail" style="width:0;overflow:hidden;transition:width 0.2s;background:var(--card);border-left:1px solid var(--border);display:flex;flex-direction:column">
          <div style="padding:8px 10px;display:flex;align-items:center;gap:6px;border-bottom:1px solid var(--border);flex-shrink:0">
            <span id="vaultDetailIcon" style="font-size:16px">\U0001F4C4</span>
            <span id="vaultDetailTitle" style="font-size:13px;font-weight:600;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">Title</span>
            <button onclick="closeVaultDetail()" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:14px;padding:2px 6px">\u2715</button>
          </div>
          <div id="vaultDetailBody" style="flex:1;overflow-y:auto;padding:8px 10px;font-size:12px;color:var(--text);line-height:1.6"></div>
        </div>
      </div>
    </div>`,"""

if old_vault_template in content:
    content = content.replace(old_vault_template, new_vault_template, 1)
    print("1. Vault template replaced")
else:
    print("1. ERROR: Could not find old vault template")
    idx = content.find('vault:`')
    if idx >= 0:
        print(f"   Found vault:` at char {idx}")
        print(repr(content[idx:idx+500]))

# ─── 2. Replace old renderVaultGraph + helpers with new code ───
old_graph_code = """// ─── VAULT 3D KNOWLEDGE GRAPH ─────────────────────
let vaultNodes=[],vaultEdges=[],vaultAnim=null;

function renderVaultGraph(){
  const canvas=$('vaultCanvas');
  if(!canvas)return;
  const ctx=canvas.getContext('2d');
  const W=canvas.parentElement.clientWidth;
  const H=canvas.parentElement.clientHeight;
  canvas.width=W*2;canvas.height=H*2;
  canvas.style.width=W+'px';canvas.style.height=H+'px';
  ctx.scale(2,2);
  
  // Build nodes from brain threads
  const threads=state.brain?.threads||[];
  vaultNodes=threads.filter(t=>t.title&&t.title!=='General Brain'&&t.title!=='Chat chat 9').map(t=>({
    id:t.id,label:t.title,radius:8+Math.min((t.messages||[]).length,20)*1.5,
    x:40+Math.random()*(W-80),y:40+Math.random()*(H-80),
    vx:0,vy:0,color:'#9cdef2',thread:t
  }));
  // Add businesses as hub nodes
  const biz=state.businesses||[];
  biz.forEach(b=>{
    vaultNodes.push({id:'biz_'+b.id,label:b.name,radius:16,x:Math.random()*W,y:Math.random()*H,vx:0,vy:0,color:'#e06c75',biz:true,thread:null});
  });
  // Fallback demo nodes when no data
  if(vaultNodes.length<3){
    const demos=[
      {id:'demo_projects',label:'Projects Hub',radius:18,color:'#e06c75',biz:true,thread:null},
      {id:'demo_tasks',label:'Active Tasks',radius:10,color:'#98c379',biz:false,thread:null},
      {id:'demo_docs',label:'Documents',radius:10,color:'#61afef',biz:false,thread:null},
      {id:'demo_revenue',label:'Revenue',radius:12,color:'#d19a66',biz:false,thread:null},
      {id:'demo_content',label:'Content',radius:9,color:'#c678dd',biz:false,thread:null},
    ];
    demos.forEach((d,i)=>{
      const angle=(i/demos.length)*Math.PI*2-1.5;
      const distance=Math.min(W,H)*0.25;
      d.x=W/2+Math.cos(angle)*distance;
      d.y=H/2+Math.sin(angle)*distance;
      d.vx=0;d.vy=0;
      vaultNodes.push(d);
    });
  }
  // Create edges between related nodes
  vaultEdges=[];
  for(let i=0;i<vaultNodes.length;i++){
    for(let j=i+1;j<vaultNodes.length;j++){
      if(Math.random()<0.3) vaultEdges.push({source:i,target:j});
    }
  }
  
  let hoverNode=null;
  let mx=0,my=0;
  
  function simulate(){
    // Simple force simulation
    for(let i=0;i<vaultNodes.length;i++){
      const n=vaultNodes[i];
      // Repulsion
      for(let j=0;j<vaultNodes.length;j++){
        if(i===j)continue;
        const o=vaultNodes[j];
        const dx=n.x-o.x,dy=n.y-o.y;
        const dist=Math.max(dx*dx+dy*dy,1);
        const force=500/dist;
        n.vx+=dx/dist*force;
        n.vy+=dy/dist*force;
      }
      // Attraction to center
      n.vx+=(W/2-n.x)*0.001;
      n.vy+=(H/2-n.y)*0.001;
      // Damping
      n.vx*=0.85;n.vy*=0.85;
      n.x+=n.vx;n.y+=n.vy;
      // Bounds
      n.x=Math.max(20,Math.min(W-20,n.x));
      n.y=Math.max(20,Math.min(H-20,n.y));
    }
    draw();
    vaultAnim=requestAnimationFrame(simulate);
  }
  
  function draw(){
    ctx.clearRect(0,0,W,H);
    // Draw edges
    ctx.strokeStyle='rgba(156,222,242,0.08)';
    ctx.lineWidth=1;
    vaultEdges.forEach(e=>{
      const s=vaultNodes[e.source],t=vaultNodes[e.target];
      if(!s||!t)return;
      ctx.beginPath();
      ctx.moveTo(s.x,s.y);
      ctx.lineTo(t.x,t.y);
      ctx.stroke();
    });
    // Draw nodes
    vaultNodes.forEach(n=>{
      const isHover=n===hoverNode;
      const r=isHover?n.radius+4:n.radius;
      ctx.beginPath();
      ctx.arc(n.x,n.y,r,0,Math.PI*2);
      ctx.fillStyle=n.color||(n.biz?'#e06c75':'#9cdef2');
      ctx.globalAlpha=n.biz?0.8:0.6;
      ctx.fill();
      ctx.globalAlpha=1;
      if(isHover){
        ctx.strokeStyle='#fff';
        ctx.lineWidth=2;
        ctx.stroke();
      }
      // Label
      ctx.fillStyle=n.biz?'#e06c75':'#9cdef2';
      ctx.font='9px system-ui,sans-serif';
      ctx.textAlign='center';
      ctx.fillText(n.label.substring(0,15),n.x,n.y+r+10);
    });
    // Node info
    const info=$('vaultNodeInfo');
    if(info&&hoverNode){
      info.style.display='block';
      info.textContent=hoverNode.label+(hoverNode.thread?(' \u2014 '+(hoverNode.thread.messages||[]).length+' messages'):' (project hub)');
    }else if(info)info.style.display='none';
  }
  
  // Mouse interaction
  canvas.onmousemove=function(e){
    const rect=canvas.getBoundingClientRect();
    mx=e.clientX-rect.left;my=e.clientY-rect.top;
    hoverNode=null;
    for(let i=vaultNodes.length-1;i>=0;i--){
      const n=vaultNodes[i];
      const dx=mx-n.x,dy=my-n.y;
      if(dx*dx+dy*dy<(n.radius+8)*(n.radius+8)){hoverNode=n;break;}
    }
    canvas.style.cursor=hoverNode?'pointer':'grab';
  };
  canvas.onmouseleave=function(){hoverNode=null;const info=$('vaultNodeInfo');if(info)info.style.display='none';};
  canvas.onclick=function(){
    if(hoverNode&&hoverNode.thread)navTo('chat');
  };
  
  const stats=$('vaultStats');
  if(stats)stats.textContent=vaultNodes.length+' nodes';
  
  if(vaultAnim)cancelAnimationFrame(vaultAnim);
  simulate();
}"""

new_graph_code = """// \u2500\u2500\u2500 VAULT KNOWLEDGE GRAPH (full data, interactive, stable) \u2500\u2500\u2500
let vaultNodes=[], vaultEdges=[], vaultAnim=null, vaultGraphData=null;
let vaultSearchTerm='', vaultFilterType='all';

function vaultSearchChange(val){ vaultSearchTerm=val.toLowerCase(); applyVaultFilters(); }
function vaultFilterChange(val){ vaultFilterType=val; applyVaultFilters(); }

function applyVaultFilters(){
  const canvas=$('vaultCanvas'); if(!canvas)return;
  // Rebuild visible nodes based on filter+search
  const all=vaultGraphData?.nodes||[];
  vaultNodes=all.filter(n=>{
    if(vaultFilterType!=='all' && n.type!==vaultFilterType) return false;
    if(vaultSearchTerm && !n.label.toLowerCase().includes(vaultSearchTerm) && !(n.meta?.keywords||[]).some(k=>k.toLowerCase().includes(vaultSearchTerm))) return false;
    return true;
  });
  // Filter edges to only connect visible nodes
  const visibleIds=new Set(vaultNodes.map(n=>n.id));
  vaultEdges=(vaultGraphData?.edges||[]).filter(e=>visibleIds.has(e.source)&&visibleIds.has(e.target));
  const stats=$('vaultStats');
  if(stats)stats.textContent=vaultNodes.length+'/'+all.length+' nodes';
}

// Node style config
const NODE_STYLES={
  chat:{color:'#58a6ff',shape:'circle',icon:'\U0001F4AC',label:'Chat'},
  business:{color:'#e06c75',shape:'hexagon',icon:'\U0001F3E2',label:'Business'},
  document:{color:'#98c379',shape:'square',icon:'\U0001F4C4',label:'Doc'},
  account:{color:'#c678dd',shape:'diamond',icon:'\U0001F517',label:'Account'},
  post:{color:'#d19a66',shape:'circle',icon:'\U0001F4DD',label:'Post'},
  persona:{color:'#56b4e9',shape:'triangle',icon:'\U0001F464',label:'Persona'},
  task:{color:'#3eb489',shape:'square',icon:'\u2705',label:'Task'}
};
const NODE_RADIUS={chat:7,business:14,document:9,account:8,post:6,persona:7,task:5};

function renderVaultGraph(){
  const canvas=$('vaultCanvas'); if(!canvas)return;
  const ctx=canvas.getContext('2d');
  const wrap=canvas.parentElement;
  let W=wrap.clientWidth, H=wrap.clientHeight;
  canvas.width=W*2; canvas.height=H*2;
  canvas.style.width=W+'px'; canvas.style.height=H+'px';
  ctx.scale(2,2);

  const loading=$('vaultLoading'); if(loading)loading.style.display='block';
  const empty=$('vaultEmpty'); if(empty)empty.style.display='none';
  const stats=$('vaultStats'); if(stats)stats.textContent='Loading\u2026';

  if(vaultAnim){cancelAnimationFrame(vaultAnim);vaultAnim=null;}

  fetch('/api/vault/graph').then(r=>r.json()).then(data=>{
    if(loading)loading.style.display='none';
    if(data.ok && data.graph?.nodes?.length>0){
      vaultGraphData=data.graph;
      // Layout nodes with initial positions
      const all=data.graph.nodes;
      const cx=W/2, cy=H/2;
      const layerR=Math.min(W,H)*0.35;
      all.forEach((n,i)=>{
        const angle=(i/all.length)*Math.PI*2 + (Math.random()-0.5)*0.3;
        const r=layerR*(0.5+Math.random()*0.5);
        n.x=cx+Math.cos(angle)*r;
        n.y=cy+Math.sin(angle)*r;
        n.vx=(Math.random()-0.5)*2;
        n.vy=(Math.random()-0.5)*2;
        n.radius=NODE_RADIUS[n.type]||7;
      });
      vaultGraphData.nodes=all;
      applyVaultFilters();
      startForceSimulation(canvas,ctx,W,H);
    } else {
      if(empty)empty.style.display='block';
      if(stats)stats.textContent='0 nodes';
    }
  }).catch(e=>{
    if(loading)loading.textContent='Failed to load graph';
    if(stats)stats.textContent='Error';
  });
}

function startForceSimulation(canvas,ctx,W,H){
  if(vaultAnim){cancelAnimationFrame(vaultAnim);vaultAnim=null;}
  if(!vaultNodes || vaultNodes.length===0) return;

  // Force simulation with alpha decay (settles to equilibrium)
  let alpha=1.0;
  const alphaDecay=0.005;
  const alphaMin=0.001;

  let hoverNode=null, selectedNode=null;
  let mx=0, my=0, isDragging=false, dragNode=null, dragOffX=0, dragOffY=0;
  let panX=0, panY=0, isPanning=false, panStartX=0, panStartY=0, panStartPX=0, panStartPY=0;
  let scale=1;

  function simulate(){
    const dt=Math.min(alpha,0.1);
    const centerForce=0.002*alpha;
    const repForce=300*alpha;
    const edgeForce=0.0005*alpha;

    for(let i=0;i<vaultNodes.length;i++){
      const n=vaultNodes[i];
      if(n===dragNode) continue;
      // Repulsion between all pairs
      for(let j=0;j<vaultNodes.length;j++){
        if(i===j) continue;
        const o=vaultNodes[j];
        let dx=n.x-o.x, dy=n.y-o.y;
        const dist=Math.max(Math.sqrt(dx*dx+dy*dy),1);
        const f=repForce/(dist*dist);
        n.vx+=dx*f;
        n.vy+=dy*f;
      }
      // Attraction to center
      n.vx+=(W/2-n.x)*centerForce;
      n.vy+=(H/2-n.y)*centerForce;
      // Edge attraction (spring)
      for(const e of vaultEdges){
        if(e.source===n.id || e.target===n.id){
          const other=n.id===e.source?e.target:e.source;
          const o=vaultNodes.find(x=>x.id===other);
          if(!o) continue;
          let dx=o.x-n.x, dy=o.y-n.y;
          const dist=Math.sqrt(dx*dx+dy*dy)||1;
          const targetDist=80+(n.radius||7)+(o.radius||7);
          const f=(dist-targetDist)*edgeForce;
          n.vx+=dx/dist*f;
          n.vy+=dy/dist*f;
        }
      }
      // Damping
      n.vx*=0.85; n.vy*=0.85;
      n.x+=n.vx; n.y+=n.vy;
      // Bounds
      n.x=Math.max(20,Math.min(W-20,n.x));
      n.y=Math.max(20,Math.min(H-20,n.y));
    }

    // Decay alpha
    alpha=Math.max(alphaMin,alpha-alphaDecay);
    draw();
    vaultAnim=requestAnimationFrame(simulate);
  }

  function draw(){
    ctx.save();
    ctx.clearRect(0,0,W,H);
    ctx.translate(panX,panY);
    ctx.scale(scale,scale);

    // Draw edges
    if(vaultEdges.length>0){
      ctx.strokeStyle='rgba(88,166,255,0.12)';
      ctx.lineWidth=1;
      ctx.beginPath();
      vaultEdges.forEach(e=>{
        const s=vaultNodes.find(n=>n.id===e.source);
        const t=vaultNodes.find(n=>n.id===e.target);
        if(!s||!t) return;
        ctx.moveTo(s.x,s.y);
        ctx.lineTo(t.x,t.y);
      });
      ctx.stroke();
    }

    // Draw nodes
    for(const n of vaultNodes){
      const isHover=n===hoverNode;
      const isSel=n===selectedNode;
      const style=NODE_STYLES[n.type]||{color:'#8b949e',shape:'circle'};
      const r=(isSel?n.radius+5:isHover?n.radius+3:n.radius)*1;
      const x=n.x, y=n.y;

      ctx.save();
      ctx.globalAlpha=n.type==='document'?0.75:0.9;
      ctx.beginPath();
      switch(style.shape){
        case 'hexagon':{
          for(let i=0;i<6;i++){
            const a=Math.PI/3*i-Math.PI/6;
            const hx=x+r*Math.cos(a), hy=y+r*Math.sin(a);
            i===0?ctx.moveTo(hx,hy):ctx.lineTo(hx,hy);
          }
          ctx.closePath(); break;
        }
        case 'square':{
          const s=r*1.2;
          ctx.rect(x-s,y-s,s*2,s*2); break;
        }
        case 'diamond':{
          ctx.moveTo(x,y-r*1.3);
          ctx.lineTo(x+r*1.3,y);
          ctx.lineTo(x,y+r*1.3);
          ctx.lineTo(x-r*1.3,y);
          ctx.closePath(); break;
        }
        case 'triangle':{
          ctx.moveTo(x,y-r*1.3);
          ctx.lineTo(x+r*1.3,y+r*1);
          ctx.lineTo(x-r*1.3,y+r*1);
          ctx.closePath(); break;
        }
        default:{
          ctx.arc(x,y,r,0,Math.PI*2);
        }
      }
      ctx.fillStyle=style.color;
      ctx.fill();
      ctx.globalAlpha=1;

      if(isSel){
        ctx.strokeStyle='#fff';
        ctx.lineWidth=2.5;
        ctx.stroke();
        // Glow
        ctx.shadowColor=style.color;
        ctx.shadowBlur=15;
        ctx.stroke();
        ctx.shadowBlur=0;
      } else if(isHover){
        ctx.strokeStyle='rgba(255,255,255,0.6)';
        ctx.lineWidth=1.5;
        ctx.stroke();
      }

      // Label
      if(r>5 || isHover || isSel){
        ctx.fillStyle='rgba(230,237,243,0.85)';
        ctx.font='9px system-ui,sans-serif';
        ctx.textAlign='center';
        const label=n.label.length>16?n.label.slice(0,15)+'\u2026':n.label;
        ctx.fillText(label,x,y+r+12);
      }
      ctx.restore();
    }
    ctx.restore();
  }

  // Mouse interaction
  function getMousePos(e){
    const rect=canvas.getBoundingClientRect();
    const ex=e.clientX||(e.touches?e.touches[0].clientX:0);
    const ey=e.clientY||(e.touches?e.touches[0].clientY:0);
    return {
      x:(ex-rect.left-panX)/scale,
      y:(ey-rect.top-panY)/scale
    };
  }

  canvas.onmousedown=function(e){
    const pos=getMousePos(e);
    // Check for node hit
    for(let i=vaultNodes.length-1;i>=0;i--){
      const n=vaultNodes[i];
      const dx=pos.x-n.x, dy=pos.y-n.y;
      const hitR=(n.radius||7)+8;
      if(dx*dx+dy*dy<hitR*hitR){
        isDragging=true; dragNode=n;
        dragOffX=pos.x-n.x; dragOffY=pos.y-n.y;
        selectedNode=n;
        showVaultDetail(n);
        return;
      }
    }
    // Start pan
    isPanning=true;
    panStartX=e.clientX; panStartY=e.clientY;
    panStartPX=panX; panStartPY=panY;
    canvas.style.cursor='grabbing';
  };

  canvas.onmousemove=function(e){
    const pos=getMousePos(e);
    if(isDragging && dragNode){
      dragNode.x=pos.x-dragOffX;
      dragNode.y=pos.y-dragOffY;
      alpha=Math.max(alpha,0.3); // Revive simulation on drag
      return;
    }
    if(isPanning){
      panX=panStartPX+(e.clientX-panStartX);
      panY=panStartPY+(e.clientY-panStartY);
      return;
    }
    // Hover detection
    mx=pos.x; my=pos.y;
    hoverNode=null;
    for(let i=vaultNodes.length-1;i>=0;i--){
      const n=vaultNodes[i];
      const dx=mx-n.x, dy=my-n.y;
      const hitR=(n.radius||7)+6;
      if(dx*dx+dy*dy<hitR*hitR){ hoverNode=n; break; }
    }
    canvas.style.cursor=hoverNode?'pointer':'grab';
  };

  canvas.onmouseup=function(){
    if(isDragging && dragNode){ alpha=0.3; }
    isDragging=false; dragNode=null;
    isPanning=false;
    canvas.style.cursor='grab';
  };

  canvas.onmouseleave=function(){
    hoverNode=null; isDragging=false; dragNode=null;
    isPanning=false;
  };

  canvas.onclick=function(e){
    if(isPanning||isDragging) return;
    const pos=getMousePos(e);
    for(let i=vaultNodes.length-1;i>=0;i--){
      const n=vaultNodes[i];
      const dx=pos.x-n.x, dy=pos.y-n.y;
      const hitR=(n.radius||7)+6;
      if(dx*dx+dy*dy<hitR*hitR){
        selectedNode=n;
        showVaultDetail(n);
        return;
      }
    }
    selectedNode=null;
    closeVaultDetail();
  };

  // Touch support
  let touchStartX=0, touchStartY=0;
  canvas.ontouchstart=function(e){
    const t=e.touches[0];
    const pos=getMousePos(e);
    touchStartX=t.clientX; touchStartY=t.clientY;
    // Check node
    for(let i=vaultNodes.length-1;i>=0;i--){
      const n=vaultNodes[i];
      const dx=pos.x-n.x, dy=pos.y-n.y;
      const hitR=(n.radius||7)+12;
      if(dx*dx+dy*dy<hitR*hitR){
        selectedNode=n;
        showVaultDetail(n);
        return;
      }
    }
  };
  canvas.ontouchmove=function(e){
    e.preventDefault();
    if(e.touches.length===2){
      // Pinch zoom
      const t1=e.touches[0], t2=e.touches[1];
      const dist=Math.hypot(t1.clientX-t2.clientX,t1.clientY-t2.clientY);
      if(!canvas._pinchDist){ canvas._pinchDist=dist; return; }
      scale=Math.max(0.2,Math.min(5,scale*(dist/canvas._pinchDist)));
      canvas._pinchDist=dist;
    } else {
      const t=e.touches[0];
      panX+=t.clientX-touchStartX;
      panY+=t.clientY-touchStartY;
      touchStartX=t.clientX; touchStartY=t.clientY;
    }
  };
  canvas.ontouchend=function(){ canvas._pinchDist=null; };

  // Zoom with scroll wheel
  canvas.onwheel=function(e){
    e.preventDefault();
    const delta=e.deltaY>0?0.92:1.08;
    scale=Math.max(0.2,Math.min(5,scale*delta));
  };

  const stats=$('vaultStats');
  if(stats)stats.textContent=vaultNodes.length+' nodes';

  alpha=1.0;
  simulate();
}

function showVaultDetail(n){
  const panel=$('vaultDetail');
  const icon=$('vaultDetailIcon');
  const title=$('vaultDetailTitle');
  const body=$('vaultDetailBody');
  if(!panel||!body)return;

  panel.style.width='320px';
  panel.style.minWidth='320px';
  if(icon){
    const style=NODE_STYLES[n.type]||{icon:'\U0001F4CB'};
    icon.textContent=style.icon;
  }
  if(title)title.textContent=n.label;
  if(!body)return;

  const m=n.meta||{};
  let html='';

  // Type badge
  const st=NODE_STYLES[n.type];
  html+='<div style="display:flex;gap:6px;align-items:center;margin-bottom:8px">';
  html+='<span style="padding:2px 8px;border-radius:4px;font-size:10px;font-weight:600;background:'+(st?.color||'#555')+'22;color:'+(st?.color||'#888')+'">'+(st?.label||n.type||'Node')+'</span>';
  if(n.type==='chat' && m.messages>0) html+='<span style="color:var(--muted);font-size:10px">'+m.messages+' messages</span>';
  if(n.type==='document') html+='<span style="color:var(--muted);font-size:10px">'+m.sections+' sections</span>';
  html+='</div>';

  switch(n.type){
    case 'chat':{
      if(m.lastPreview) html+='<div style="background:var(--bg);border-radius:6px;padding:8px;margin-bottom:8px;font-size:11px;color:var(--text);line-height:1.5">'+escHtml(m.lastPreview.slice(0,500))+'</div>';
      if(m.businessIds?.length>0) html+='<div style="font-size:11px;color:var(--muted);margin-bottom:4px">Businesses: '+m.businessIds.join(', ')+'</div>';
      if(m.tags?.length>0) html+='<div style="font-size:11px;color:var(--muted);margin-bottom:4px">Tags: '+m.tags.join(', ')+'</div>';
      if(m.lastTime) html+='<div style="font-size:10px;color:var(--dim)">Last activity: '+new Date(m.lastTime).toLocaleString()+'</div>';
      break;
    }
    case 'business':{
      html+='<div style="font-size:12px;margin-bottom:6px">Status: <strong>'+(m.status||'\-')+'</strong></div>';
      html+='<div style="font-size:12px;margin-bottom:6px">Stage: <strong>'+(m.stage||'\-')+'</strong></div>';
      if(m.description) html+='<div style="font-size:11px;color:var(--muted);line-height:1.5;margin-bottom:6px">'+escHtml(m.description)+'</div>';
      if(m.tags?.length>0) html+='<div style="font-size:11px;color:var(--muted)">Tags: '+m.tags.join(', ')+'</div>';
      break;
    }
    case 'document':{
      if(m.path) html+='<div style="font-size:11px;color:var(--muted);margin-bottom:6px">Path: '+escHtml(m.path)+'</div>';
      if(m.preview) html+='<div style="background:var(--bg);border-radius:6px;padding:8px;margin-bottom:8px;font-size:11px;color:var(--text);line-height:1.5">'+escHtml(m.preview.slice(0,500))+'</div>';
      if(m.keywords?.length>0) html+='<div style="font-size:11px;color:var(--muted);margin-bottom:4px">Keywords: '+m.keywords.slice(0,15).join(', ')+(m.keywords.length>15?' +'+(m.keywords.length-15)+' more':'')+'</div>';
      if(m.size) html+='<div style="font-size:10px;color:var(--dim)">Size: '+(m.size/1024).toFixed(1)+' KB</div>';
      break;
    }
    case 'post':{
      html+='<div style="font-size:12px;margin-bottom:4px">Status: <strong>'+(m.status||'\-')+'</strong></div>';
      html+='<div style="font-size:12px;margin-bottom:4px">Type: <strong>'+(m.type||'\-')+'</strong></div>';
      if(m.platform) html+='<div style="font-size:11px;color:var(--muted);margin-bottom:4px">Platform: '+escHtml(m.platform)+'</div>';
      if(m.impressions) html+='<div style="font-size:11px;color:var(--muted)">Impressions: '+m.impressions+' | Engagement: '+(m.engagement||0)+'</div>';
      break;
    }
    case 'account':{
      html+='<div style="font-size:12px;margin-bottom:4px">Platform: <strong>'+(m.platform||'\-')+'</strong></div>';
      if(m.handle) html+='<div style="font-size:11px;color:var(--muted);margin-bottom:4px">Handle: @'+escHtml(m.handle)+'</div>';
      if(m.followers) html+='<div style="font-size:11px;color:var(--muted);margin-bottom:4px">Followers: '+m.followers+'</div>';
      if(m.status) html+='<div style="font-size:11px;color:var(--muted);margin-bottom:4px">Status: '+escHtml(m.status)+'</div>';
      break;
    }
    case 'persona':{
      html+='<div style="font-size:12px;margin-bottom:4px">Voice: <strong>'+(m.voice||'\-')+'</strong></div>';
      if(m.audience) html+='<div style="font-size:11px;color:var(--muted);margin-bottom:4px">Audience: '+escHtml(m.audience)+'</div>';
      if(m.accounts?.length>0) html+='<div style="font-size:11px;color:var(--muted);margin-bottom:4px">Accounts: '+m.accounts.join(', ')+'</div>';
      break;
    }
    case 'task':{
      html+='<div style="font-size:12px;margin-bottom:4px">Priority: <strong>'+(m.priority||'medium')+'</strong></div>';
      html+='<div style="font-size:12px;margin-bottom:4px">Date: <strong>'+(m.date||'\-')+'</strong></div>';
      if(m.project) html+='<div style="font-size:11px;color:var(--muted);margin-bottom:4px">Project: '+escHtml(m.project)+'</div>';
      if(m.minutes) html+='<div style="font-size:11px;color:var(--muted);margin-bottom:4px">Est: '+m.minutes+' min</div>';
      break;
    }
    default:{
      html+='<div style="font-size:11px;color:var(--muted)">ID: '+escHtml(n.id)+'</div>';
    }
  }

  // Show connected edges (relationships)
  const relEdges=vaultEdges.filter(e=>e.source===n.id||e.target===n.id);
  if(relEdges.length>0){
    html+='<div style="margin-top:12px;padding-top:8px;border-top:1px solid var(--border)">';
    html+='<div style="font-size:11px;font-weight:600;margin-bottom:4px">Connections ('+relEdges.length+'):</div>';
    for(const e of relEdges.slice(0,20)){
      const otherId=e.source===n.id?e.target:e.source;
      const other=vaultGraphData?.nodes?.find(x=>x.id===otherId);
      if(!other) continue;
      const os=NODE_STYLES[other.type]||{icon:'\U0001F4CB',color:'#888'};
      html+='<div style="display:flex;gap:6px;align-items:center;padding:3px 0;font-size:11px">';
      html+='<span style="font-size:10px">'+os.icon+'</span>';
      html+='<span style="color:var(--muted)">'+escHtml(other.label)+'</span>';
      if(e.label) html+='<span style="color:var(--dim);font-size:10px">\u2192 '+escHtml(e.label)+'</span>';
      html+='</div>';
    }
    if(relEdges.length>20) html+='<div style="color:var(--dim);font-size:10px;margin-top:2px">+'+(relEdges.length-20)+' more</div>';
    html+='</div>';
  }

  body.innerHTML=html;
  // Smooth open the edge-connected nodes
  alpha=Math.max(alpha,0.5);
}

function closeVaultDetail(){
  const panel=$('vaultDetail');
  if(panel) panel.style.width='0';
}

function escHtml(s){
  if(!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}"""

if old_graph_code in content:
    content = content.replace(old_graph_code, new_graph_code, 1)
    print("2. Graph rendering code replaced")
else:
    print("2. ERROR: Could not find old graph code")
    idx = content.find('VAULT 3D')
    if idx >= 0:
        print(f"   Found 'VAULT 3D' at char {idx}")
        print(repr(content[idx:idx+200]))

# ─── 3. Replace renderVault function (simplify since graph now loads via API) ───
old_render_vault = """async function renderVault(){
  try{
    const r=await fetch('/api/vault');
    const d=await r.json();
    vaultData=d.files||[];
    const s=$('vaultStats');
    if(s)s.innerHTML=`${d.fileCount||0} files \u00b7 ${((d.totalSize||0)/1024).toFixed(1)} KB \u00b7 indexed ${d.generated?.slice(0,10)||'today'}`;
    renderVaultFiles(vaultData);
  }catch(e){
    const f=$('vaultFiles'); if(f)f.innerHTML='<p style="color:var(--danger)">Vault index not available</p>';
  }
}
function renderVaultFiles(files){
  const el=$('vaultFiles'); if(!el)return;
  el.innerHTML=files.map(f=>`
    <div class="vaultFile" style="padding:8px;border-bottom:1px solid var(--border);cursor:pointer" onclick="toggleVaultFile(this,'${f.path}')">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <strong style="font-size:13px">\U0001F4C4 ${f.title}</strong>
        <span style="font-size:10px;color:var(--muted)">${f.path}</span>
      </div>
      <div style="font-size:11px;color:var(--muted);margin-top:4px">${f.sections.length} sections \u00b7 ${f.size}B \u00b7 ${f.fullKeywords?.length||0} keywords</div>
      <div class="vaultDetail" style="display:none;margin-top:8px;padding:8px;background:var(--bg);border-radius:6px">
        ${f.sections.map(s=>`
          <div style="margin-bottom:6px">
            <strong style="font-size:12px">${s.heading||'\u00b7'}</strong>
            <p style="font-size:11px;color:var(--muted);margin:2px 0">${s.content?.slice(0,200)||''}</p>
          </div>
        `).join('')}
      </div>
    </div>
  `).join('');
}
function toggleVaultFile(el,path){
  const detail=el.querySelector('.vaultDetail');
  if(detail) detail.style.display=detail.style.display==='none'?'block':'none';
}
function filterVault(q){
  if(!q) return renderVaultFiles(vaultData);
  const lower=q.toLowerCase();
  const filtered=vaultData.filter(f=>
    f.title.toLowerCase().includes(lower)||
    f.path.toLowerCase().includes(lower)||
    f.sections.some(s=>s.content.toLowerCase().includes(lower))
  );
  renderVaultFiles(filtered);
}"""

new_render_vault = """async function renderVault(){
  // New vault: loads graph from /api/vault/graph, renders interactively
  const stats=$('vaultStats');
  if(stats)stats.textContent='';
  renderVaultGraph();
}"""

if old_render_vault in content:
    content = content.replace(old_render_vault, new_render_vault, 1)
    print("3. renderVault simplified")
else:
    print("3. ERROR: Could not find old renderVault")
    idx = content.find('renderVault(){')
    if idx >= 0:
        print(f"   Found renderVault at char {idx}")
        print(repr(content[idx:idx+400]))

with open('index.html', 'w') as f:
    f.write(content)
print("\nDone! File written.")
