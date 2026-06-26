const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(60000);

  try {
    await page.goto('https://me.ragmedium.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    // Check what renderPage does and what pages exists
    const debug = await page.evaluate(() => {
      // Check if pages object exists
      const info = {};
      
      // Try to find pages in window
      if (typeof pages !== 'undefined') {
        info.pagesExists = true;
        info.pagesKeys = Object.keys(pages);
      } else {
        info.pagesExists = false;
      }
      
      // Check renderPage source
      if (typeof renderPage === 'function') {
        info.renderPageSrc = renderPage.toString().slice(0, 500);
      }
      
      // Check what happens when we call renderPage('tasks')
      // Look for any container that holds pages
      const possibleContainers = ['pageContent', 'mainContent', 'app', 'content', 'container'];
      info.containers = {};
      for (const id of possibleContainers) {
        const el = document.getElementById(id);
        if (el) info.containers[id] = {tag: el.tagName, class: el.className.slice(0,50)};
      }
      
      // Check body children
      info.bodyChildren = Array.from(document.body.children).map(c => c.tagName + '.' + c.className.slice(0,40));
      
      return info;
    });
    console.log(JSON.stringify(debug, null, 2));

    // Try calling renderPage and catch any error
    const result = await page.evaluate(() => {
      try {
        if (typeof renderPage === 'function') {
          renderPage('tasks');
          return 'renderPage(tasks) called successfully';
        }
        return 'renderPage not a function';
      } catch(e) {
        return 'ERROR: ' + e.message;
      }
    });
    console.log('\nrenderPage result:', result);
    
    await page.waitForTimeout(2000);
    
    // Check again for tasks content
    const check2 = await page.evaluate(() => {
      const all = document.querySelectorAll('.kanban-card');
      const cols = document.querySelectorAll('.kanban-col');
      const taskContent = document.getElementById('tasksPageContent');
      return {
        kanbanCards: all.length,
        kanbanCols: cols.length,
        tasksPageContent: taskContent ? taskContent.innerHTML.slice(0,200) : 'NOT FOUND',
        bodyTextHasBacklog: document.body.innerText.includes('Backlog')
      };
    });
    console.log('After renderPage:', JSON.stringify(check2, null, 2));

    await page.screenshot({ path: '/tmp/dashboard_tasks_final.png', fullPage: false });

  } catch (err) {
    console.error('Test failed:', err.message);
  } finally {
    await browser.close();
  }
})();
