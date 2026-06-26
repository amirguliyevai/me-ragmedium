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
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', err => errors.push(err.message));

  try {
    await page.goto('https://me.ragmedium.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(5000);

    // Navigate to tasks via renderPage
    await page.evaluate(() => {
      if (typeof renderPage === 'function') renderPage('tasks');
    });
    await page.waitForTimeout(3000);

    // Count kanban cards
    const result = await page.evaluate(() => {
      const cards = document.querySelectorAll('.kanban-card');
      const cols = document.querySelectorAll('.kanban-col');
      const colInfo = Array.from(cols).map(c => {
        const hdr = c.querySelector('.kanban-col-hdr');
        const count = hdr ? hdr.querySelector('.kanban-count')?.textContent : '?';
        return {status: c.dataset.status, count: count};
      });
      return {
        cardCount: cards.length,
        colCount: cols.length,
        columns: colInfo
      };
    });
    
    console.log('Kanban result:', JSON.stringify(result, null, 2));

    // Take screenshot
    await page.screenshot({ path: '/tmp/dashboard_tasks_final.png', fullPage: false });
    console.log('Screenshot saved to /tmp/dashboard_tasks_final.png');

    // Report
    console.log('\n=== FINAL VERIFICATION ===');
    console.log(`Kanban cards: ${result.cardCount}`);
    console.log(`Columns: ${result.colCount}`);
    console.log(`Console errors: ${errors.length}`);
    if (errors.length > 0) {
      errors.forEach(e => console.log('  ERR:', e));
    }
    
    if (result.cardCount >= 30) {
      console.log('\n✅ SUCCESS: All 35 tasks rendered in kanban view!');
    } else if (result.cardCount > 0) {
      console.log(`\n⚠️ PARTIAL: ${result.cardCount}/35 cards rendered`);
    } else {
      console.log('\n❌ FAIL: No cards rendered');
    }

  } catch (err) {
    console.error('Test failed:', err.message);
  } finally {
    await browser.close();
  }
})();
