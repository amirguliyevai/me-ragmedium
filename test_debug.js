const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(60000);
  
  page.on('pageerror', err => console.log('PAGE ERROR:', err.message));

  try {
    await page.goto('https://me.ragmedium.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(5000);

    // Debug: what's in the body?
    const bodyInfo = await page.evaluate(() => {
      // Check for sidebar/nav structure
      const nav = document.querySelector('nav, [class*="sidebar"], [class*="nav"]');
      const allButtons = Array.from(document.querySelectorAll('button')).map(b => ({text: b.textContent.trim().slice(0,30)}));
      
      // Check for specific elements
      const gallery = document.getElementById('galleryModal');
      const pages = document.querySelectorAll('[class*="page"], [id*="page"]');
      
      return {
        url: window.location.href,
        hasNav: !!nav,
        buttonCount: allButtons.length,
        buttons: allButtons.slice(0, 20),
        hasGallery: !!gallery,
        bodyClasses: document.body.className,
      };
    });
    console.log(JSON.stringify(bodyInfo, null, 2));

    // Try to trigger renderPage('tasks')
    const tasksResult = await page.evaluate(() => {
      // Check if renderPage exists
      if (typeof renderPage === 'function') {
        renderPage('tasks');
        return 'renderPage called';
      }
      // Check what global functions exist
      const fns = Object.keys(window).filter(k => typeof window[k] === 'function' && k.startsWith('render'));
      return 'renderPage not found. Available: ' + fns.join(', ');
    });
    console.log('Tasks trigger result:', tasksResult);
    
    await page.waitForTimeout(3000);
    await page.screenshot({ path: '/tmp/dashboard_tasks2.png', fullPage: false });

    // Check if content appeared
    const check = await page.evaluate(() => {
      const el = document.getElementById('tasksPageContent');
      const pageContent = document.querySelector('[class*="page-content"], [class*="content"]');
      return {
        hasTasksPageContent: !!el,
        tasksPageContentHTML: el ? el.innerHTML.slice(0, 200) : 'not found',
        pageContentClass: pageContent ? pageContent.className : 'not found',
        bodyText: document.body.innerText.slice(0, 300)
      };
    });
    console.log(JSON.stringify(check, null, 2));

  } catch (err) {
    console.error('Test failed:', err.message);
  } finally {
    await browser.close();
  }
})();
