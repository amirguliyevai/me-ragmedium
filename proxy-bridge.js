// Proxy bridge — wires all placeholder tabs to real services
(function() {
  const TAB_URLS = {
    'Todo': '/api/team/tasks',
    'Calendar': '/proxy/calendar.html',
    'Projects': '/api/team/projects',
    'Desktop': '/proxy/desktop.html',
    'Workspace': 'http://127.0.0.1:1704/',
    'Docs': 'http://127.0.0.1:8098/',
    'Gallery': 'http://127.0.0.1:8097/',
    'Skills': '/api/skills-catalog',
    'Secrets': '/api/team/secrets'
  };
  
  // Watch for DOM changes (DC runtime re-renders)
  const observer = new MutationObserver(function() {
    const ph = document.querySelector('[data-dc-tpl] [style*="440px"]');
    if (ph && ph.closest('[style*="100%"]')) {
      const container = ph.closest('[style*="100%"]');
      const nameEl = container.querySelector('[style*="font-size:18px"]');
      if (nameEl && nameEl.textContent) {
        const tabName = nameEl.textContent.trim();
        const url = TAB_URLS[tabName];
        if (url) {
          container.innerHTML = '<iframe src="' + url + '" style="width:100%;height:calc(100vh-98px);border:0;background:#05070d;"></iframe>';
        }
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: false });
})();
