// DC Bridge v2 — wires ALL tabs to real services
// Runs after DC runtime renders, detects placeholder text and replaces content
(function() {
  var TAB_CONTENT = {
    'Todo': '<div style="padding:18px;color:#eaf6ff;font-family:IBM Plex Mono;"><h2 style="color:#18e0ff;">Task Board</h2><div id="todo-list" style="margin-top:12px;">Loading...</div></div><script>fetch("/api/team/tasks?limit=50").then(r=>r.json()).then(d=>{var t=d.tasks||d||[];document.getElementById("todo-list").innerHTML=t.map(function(x){return"<div style=\"padding:10px;border:1px solid rgba(24,224,255,.14);margin-bottom:8px;\"><div style=\"color:"+(x.projectColor||"#18e0ff")+"\">"+x.project+"</div><div style=\"font-size:14px;\">"+x.title+"</div><div style=\"color:#6b7a90;font-size:11px;\">"+x.status+"</div></div>"}).join("")})</script>',
    'Calendar': '<iframe src="/proxy/calendar" style="width:100%;height:calc(100vh - 98px);border:0;background:#05070d;"></iframe>',
    'Projects': '<div style="padding:18px;color:#eaf6ff;"><h2 style="color:#18e0ff;font-family:Chakra Petch;">Projects</h2><div id="project-list" style="margin-top:12px;">Loading...</div></div><script>fetch("/api/team/projects?limit=20").then(r=>r.json()).then(d=>{var p=d.projects||d||[];document.getElementById("project-list").innerHTML=p.map(function(x){return"<div style=\"padding:14px;border:1px solid rgba(24,224,255,.14);margin-bottom:10px;clip-path:polygon(0 0,calc(100% - 12px) 0,100% 12px,100% 100%,0 100%);\"><div style=\"font-family:Chakra Petch;font-size:15px;color:#eaf6ff;\">"+x.name+"</div><div style=\"color:#6b7a90;font-size:11px;\">"+x.squad+"</div><div style=\"height:4px;background:rgba(120,140,170,.14);margin-top:8px;\"><div style=\"height:100%;width:"+Math.min(100, x.progress||x.taskCount*10)+"%;background:linear-gradient(90deg,#18e0ff,#2fe08a);\"></div></div></div>"}).join("")})</script>',
    'Desktop': '<div style="padding:18px;display:grid;grid-template-columns:repeat(auto-fill,minmax(100px,1fr));gap:12px;" id="desktop-icons"></div><script>var apps=[{n:"Agent Team",i:"👥",c:"#18e0ff"},{n:"Content Studio",i:"🎨",c:"#ff5cc8"},{n:"Content Empire",i:"📡",c:"#2fe08a"},{n:"Workspace",i:"💻",c:"#ffb020"},{n:"Leads",i:"📊",c:"#9b7bff"},{n:"Galaxy",i:"🌌",c:"#18e0ff"},{n:"Knowledge",i:"🧠",c:"#2fe08a"},{n:"Call",i:"📞",c:"#ff5cc8"},{n:"Inbox",i:"📨",c:"#ffb020"},{n:"Skills",i:"⚡",c:"#9b7bff"},{n:"Secrets",i:"🔐",c:"#ff4d5e"},{n:"Docs",i:"📄",c:"#18e0ff"},{n:"Gallery",i:"🖼️",c:"#2fe08a"},{n:"Calendar",i:"📅",c:"#ffb020"}];document.getElementById("desktop-icons").innerHTML=apps.map(function(a){return"<div style=\"padding:16px;border:1px solid "+a.c+"40;background:rgba(10,16,26,.8);text-align:center;cursor:pointer;clip-path:polygon(0 0,calc(100% - 10px) 0,100% 10px,100% 100%,0 100%);\"><div style=\"font-size:28px;margin-bottom:6px;\">"+a.i+"</div><div style=\"font-family:IBM Plex Mono;font-size:10px;color:#eaf6ff;\">"+a.n+"</div></div>"}).join("")</script>',
    'Workspace': '<iframe src="http://127.0.0.1:1704/" style="width:100%;height:calc(100vh - 98px);border:0;background:#05070d;"></iframe>',
    'Docs': '<div style="padding:18px;color:#eaf6ff;"><h2 style="color:#18e0ff;font-family:Chakra Petch;">Documents</h2><div style="margin-top:12px;color:#6b7a90;">File browser loading...</div><iframe src="/proxy/docs" style="width:100%;height:calc(100vh - 180px);border:0;background:#05070d;margin-top:12px;"></iframe></div>',
    'Gallery': '<div style="padding:18px;color:#eaf6ff;"><h2 style="color:#18e0ff;font-family:Chakra Petch;">Gallery</h2><div style="margin-top:12px;color:#6b7a90;">Image gallery loading...</div><iframe src="/proxy/gallery" style="width:100%;height:calc(100vh - 180px);border:0;background:#05070d;margin-top:12px;"></iframe></div>',
    'Skills': '<div style="padding:18px;color:#eaf6ff;"><h2 style="color:#18e0ff;font-family:Chakra Petch;">Skills</h2><div id="skills-list" style="margin-top:12px;">Loading...</div></div><script>fetch("/api/skills-catalog?limit=50").then(r=>r.json()).then(d=>{var s=d.skills||d||[];document.getElementById("skills-list").innerHTML=s.map(function(x){return"<div style=\"padding:10px;border:1px solid rgba(120,140,170,.14);margin-bottom:6px;\"><div style=\"font-size:13px;color:#eaf6ff;\">"+(x.name||x)+"</div></div>"}).join("")})</script>',
    'Secrets': '<div style="padding:18px;color:#eaf6ff;"><h2 style="color:#18e0ff;font-family:Chakra Petch;">Secrets Vault</h2><div id="secrets-list" style="margin-top:12px;">Loading...</div></div><script>fetch("/api/team/secrets?limit=50").then(r=>r.json()).then(d=>{var s=d.secrets||d||[];document.getElementById("secrets-list").innerHTML=s.map(function(x){return"<div style=\"padding:10px;border:1px solid rgba(120,140,170,.14);margin-bottom:6px;display:flex;justify-content:space-between;\"><span>"+(x.name||x.key||x)+"</span><span style=\"color:#6b7a90;\">••••••••</span></div>"}).join("")})</script>',
    'Inbox': '<iframe src="/proxy/inbox" style="width:100%;height:calc(100vh - 98px);border:0;background:#05070d;"></iframe>',
    'Content': '<iframe src="/proxy/content-hub" style="width:100%;height:calc(100vh - 98px);border:0;background:#05070d;"></iframe>',
    'Studio': '<iframe src="/proxy/content-studio" style="width:100%;height:calc(100vh - 98px);border:0;background:#05070d;"></iframe>',
    'Empire': '<iframe src="/proxy/content-empire" style="width:100%;height:calc(100vh - 98px);border:0;background:#05070d;"></iframe>',
    'Brain': '<iframe src="/proxy/knowledge-brain" style="width:100%;height:calc(100vh - 98px);border:0;background:#05070d;"></iframe>'
  };
  
  function wirePlaceholders() {
    try {
      // Find any "module standing by" text
      var els = document.querySelectorAll('[style*="display"], [style*="flex"], [style*="grid"]');
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        var text = el.textContent || '';
        if (text.indexOf('module standing by') !== -1 || text.indexOf('not yet wired') !== -1) {
          // This is a placeholder - find the container
          var container = el.closest('[style*="min-height"]') || el.parentElement;
          while (container && container.style && !container.style.height && container.parentElement) {
            container = container.parentElement;
          }
          // Extract the tab name
          var nameEl = container ? container.querySelector('[style*="text-transform:uppercase"]') : null;
          var tabName = nameEl ? nameEl.textContent.trim() : '';
          
          if (tabName && TAB_CONTENT[tabName]) {
            container.innerHTML = TAB_CONTENT[tabName];
            console.log('[DC Bridge] Wired tab:', tabName);
          }
        }
      }
    } catch(e) { /* silent */ }
  }
  
  // Run on load + every time DOM changes
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { 
      setTimeout(wirePlaceholders, 1500); 
    });
  } else {
    setTimeout(wirePlaceholders, 1000);
  }
  
  // Also poll periodically for tab switches
  setInterval(wirePlaceholders, 2000);
  
  console.log('[DC Bridge] v2 loaded');
})();
