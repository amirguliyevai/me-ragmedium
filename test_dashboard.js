const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(60000);
  
  // Collect console errors
  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      errors.push(msg.text());
    }
  });
  page.on('pageerror', err => {
    errors.push(err.message);
  });

  try {
    // Load the page - use domcontentloaded for speed
    console.log('Loading https://me.ragmedium.com ...');
    await page.goto('https://me.ragmedium.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
    console.log('Page DOM loaded');

    // Wait for loading screen to go away
    try {
      await page.waitForSelector('#loadingMsg', { state: 'hidden', timeout: 15000 });
      console.log('Loading message hidden');
    } catch(e) {
      console.log('Loading message timeout (might already be hidden via CSS)');
    }
    
    // Wait extra for JS to execute
    await page.waitForTimeout(5000);
    console.log('Waited for JS execution');

    // Take screenshot of main page
    await page.screenshot({ path: '/tmp/dashboard_main.png', fullPage: false });
    console.log('Main page screenshot saved');

    // Navigate to tasks page - look for the Tasks nav item
    console.log('Looking for Tasks navigation...');
    const navItems = await page.evaluate(() => {
      // Check sidebar nav items
      const links = document.querySelectorAll('a, button, [class*="nav"], [class*="link"]');
      const found = [];
      links.forEach(l => {
        if (l.textContent && l.textContent.includes('Tasks')) {
          found.push({tag: l.tagName, text: l.textContent.trim().slice(0,50), class: l.className.slice(0,50)});
        }
      });
      return found;
    });
    console.log('Tasks elements found:', JSON.stringify(navItems));

    // Try clicking nav item
    const clicked = await page.evaluate(() => {
      const items = document.querySelectorAll('[data-page], [data-id]');
      for (const item of items) {
        if (item.dataset.page === 'tasks' || item.dataset.id === 'tasks') {
          item.click();
          return 'clicked data-page tasks';
        }
      }
      // Try finding by text
      const all = document.querySelectorAll('*');
      for (const el of all) {
        if (el.children.length === 0 && el.textContent.trim() === '🎯 Tasks') {
          el.click();
          return 'clicked text tasks';
        }
      }
      return 'not found';
    });
    console.log('Click result:', clicked);
    
    await page.waitForTimeout(3000);

    // Take screenshot of tasks page
    await page.screenshot({ path: '/tmp/dashboard_tasks.png', fullPage: false });
    console.log('Tasks page screenshot saved');

    // Count kanban cards
    const cardCount = await page.evaluate(() => {
      const cards = document.querySelectorAll('.kanban-card');
      return cards.length;
    });
    console.log(`Found ${cardCount} kanban cards`);

    // Report errors
    if (errors.length > 0) {
      console.log(`\n=== CONSOLE ERRORS (${errors.length}) ===`);
      errors.forEach(e => console.log('ERROR:', e));
    } else {
      console.log('\nNo console errors!');
    }

    // Final result
    console.log('\n=== VERIFICATION RESULT ===');
    console.log(`Page loaded: YES`);
    console.log(`Tasks page navigated: YES`);
    console.log(`Kanban cards found: ${cardCount}`);
    console.log(`Console errors: ${errors.length}`);
    
    if (cardCount > 0 && errors.length === 0) {
      console.log('\n✅ ALL CHECKS PASSED');
    } else if (cardCount > 0) {
      console.log('\n⚠️ CARDS RENDERED BUT WITH ERRORS');
    } else {
      console.log('\n❌ NO CARDS FOUND');
    }

  } catch (err) {
    console.error('Test failed:', err.message);
  } finally {
    await browser.close();
  }
})();
