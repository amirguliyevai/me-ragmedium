const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(60000);
  
  const errors = [];
  page.on('pageerror', err => errors.push('PAGEERR: ' + err.message));

  try {
    await page.goto('https://me.ragmedium.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    // Try calling renderPage('tasks') which works
    await page.evaluate(() => {
      if (typeof renderPage === 'function') renderPage('tasks');
    });
    await page.waitForTimeout(3000);

    // Check the main content area
    const check = await page.evaluate(() => {
      // The pages object renders into the main content
      // Check if any element has kanban-cols
      const kanbanCols = document.querySelector('.kanban-cols');
      const tasksPageContent = document.getElementById('tasksPageContent');
      
      // Check the pages container
      const pagesContainer = document.querySelector('[class*="pages"]') || document.getElementById('pagesContainer');
      
      // Check what's actually visible
      const allDivs = document.querySelectorAll('div');
      let tasksContainer = null;
      for (const d of allDivs) {
        if (d.dataset && d.dataset.page === 'tasks') {
          tasksContainer = {found: true, visible: d.offsetParent !== null, html: d.innerHTML.slice(0,200)};
          break;
        }
      }
      
      // Get all page elements
      const pageElements = Array.from(document.querySelectorAll('[data-page]')).map(el => ({
        page: el.dataset.page,
        visible: el.offsetParent !== null || el.style.display !== 'none',
        class: el.className.slice(0, 50)
      }));
      
      return {
        kanbanCols: kanbanCols ? kanbanCols.innerHTML.slice(0,200) : 'NOT FOUND',
        tasksPageContent: tasksPageContent ? tasksPageContent.innerHTML.slice(0,200) : 'NOT FOUND',
        tasksContainer,
        pageElements: pageElements.slice(0, 10),
        bodyText: document.body.innerText.includes('Backlog') ? 'has Backlog' : 'no Backlog text'
      };
    });
    console.log('Check after renderPage:', JSON.stringify(check, null, 2));

    // If the kanban is rendered but inside a hidden page, let's look at the structure
    const structure = await page.evaluate(() => {
      // Find the main content area
      const main = document.querySelector('main, [class*="main"], [class*="content"]');
      if (!main) return 'no main found';
      
      // Get all direct children with their visibility
      const children = Array.from(main.children).map(c => ({
        tag: c.tagName,
        class: c.className.slice(0, 60),
        visible: c.offsetParent !== null,
        childCount: c.children.length
      }));
      
      return {
        mainHTML: main.innerHTML.slice(0, 500),
        children: children
      };
    });
    console.log('Structure:', JSON.stringify(structure, null, 2));

    await page.screenshot({ path: '/tmp/dashboard_tasks_final.png', fullPage: false });
    console.log('\nErrors:', errors.length);
    errors.forEach(e => console.log(e));

  } catch (err) {
    console.error('Test failed:', err.message);
  } finally {
    await browser.close();
  }
})();
