const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(60000);
  
  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push('CONSOLE: ' + msg.text());
    if (msg.type() === 'warning') errors.push('WARN: ' + msg.text());
  });
  page.on('pageerror', err => errors.push('PAGEERR: ' + err.message));
  page.on('requestfailed', req => errors.push('REQFAIL: ' + req.url() + ' ' + req.failure()?.errorText));

  try {
    await page.goto('https://me.ragmedium.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    // Check if renderPage exists and what happens
    const debug = await page.evaluate(() => {
      const info = {
        hasRenderPage: typeof renderPage === 'function',
        hasSetPage: typeof setPage === 'function',
        activePage: window.activePage || 'not defined',
        locationHash: window.location.hash,
      };
      return info;
    });
    console.log('Debug:', JSON.stringify(debug));

    // Try clicking the Tasks button in nav
    const clickResult = await page.evaluate(() => {
      // Look for buttons/links with "Tasks" text
      const all = document.querySelectorAll('button, a, [role="button"]');
      for (const el of all) {
        const text = el.textContent.trim();
        if (text === '🎯 Tasks' || text === 'Tasks') {
          el.click();
          return 'clicked: ' + text;
        }
      }
      // Try spans inside nav
      const spans = document.querySelectorAll('span');
      for (const s of spans) {
        if (s.textContent.trim() === '🎯 Tasks') {
          s.click();
          return 'clicked span';
        }
      }
      return 'not found';
    });
    console.log('Click result:', clickResult);
    
    await page.waitForTimeout(5000);

    // Check result
    const result = await page.evaluate(() => {
      const el = document.getElementById('tasksPageContent');
      if (!el) return {found: false};
      const cards = el.querySelectorAll('.kanban-card');
      const cols = el.querySelectorAll('.kanban-col');
      return {
        found: true,
        cardCount: cards.length,
        colCount: cols.length,
        htmlPreview: el.innerHTML.slice(0, 300)
      };
    });
    console.log('Result:', JSON.stringify(result, null, 2));

    // Check for API errors
    const apiTest = await page.evaluate(async () => {
      try {
        const r = await fetch('/api/galaxy/tasks');
        const data = await r.json();
        return {status: r.status, count: Array.isArray(data) ? data.length : 'not array', sample: data.slice(0,2)};
      } catch(e) {
        return {error: e.message};
      }
    });
    console.log('API test:', JSON.stringify(apiTest, null, 2));

    await page.screenshot({ path: '/tmp/dashboard_tasks_final.png', fullPage: false });
    
    console.log('\nErrors:', errors.length);
    errors.forEach(e => console.log(e));

  } catch (err) {
    console.error('Test failed:', err.message);
  } finally {
    await browser.close();
  }
})();
