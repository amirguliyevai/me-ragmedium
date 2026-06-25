const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true, ignoreHTTPSErrors: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  
  const results = [];
  
  try {
    // Test 1: Load the dashboard
    console.log('TEST 1: Loading dashboard...');
    await page.goto('https://me.ragmedium.com/new/', { waitUntil: 'networkidle', timeout: 30000 });
    const title = await page.title();
    console.log('  Title:', title);
    results.push({ test: 'Page loads', pass: title.includes('Command Center') || title.length > 0, detail: title });
    
    // Test 2: Check no old model references
    console.log('TEST 2: Checking model references...');
    const pageContent = await page.content();
    const hasOldRefs = pageContent.includes('V4-Flash') || pageContent.includes('V4-Pro') || pageContent.includes('DeepSeek');
    const owlAlphaCount = (pageContent.match(/owl-alpha/g) || []).length;
    console.log('  owl-alpha count:', owlAlphaCount);
    console.log('  Has old refs:', hasOldRefs);
    results.push({ test: 'Model refs fixed', pass: !hasOldRefs && owlAlphaCount > 0, detail: `owl-alpha: ${owlAlphaCount}, old refs: ${hasOldRefs}` });
    
    // Test 3: Check Command Center nav exists
    console.log('TEST 3: Checking Command Center navigation...');
    const ccNav = await page.locator('text=Command Center').count();
    console.log('  Command Center nav items:', ccNav);
    results.push({ test: 'CC nav exists', pass: ccNav > 0, detail: `${ccNav} items` });
    
    // Test 4: Navigate to Command Center
    console.log('TEST 4: Navigating to Command Center...');
    await page.click('text=Command Center');
    await page.waitForTimeout(1500);
    const ccVisible = await page.locator('#commandCenter').count();
    console.log('  Command Center visible:', ccVisible);
    results.push({ test: 'CC page renders', pass: ccVisible > 0, detail: `visible: ${ccVisible}` });
    
    // Test 5: Check Kanban columns
    console.log('TEST 5: Checking Kanban columns...');
    const kanbanCols = await page.locator('.cc-kanban-col').count();
    console.log('  Kanban columns:', kanbanCols);
    results.push({ test: 'Kanban columns', pass: kanbanCols === 5, detail: `${kanbanCols} columns` });
    
    // Test 6: Check task cards
    console.log('TEST 6: Checking task cards...');
    const cards = await page.locator('.cc-card').count();
    console.log('  Task cards:', cards);
    results.push({ test: 'Task cards render', pass: cards > 0, detail: `${cards} cards` });
    
    // Test 7: Check priority colors
    console.log('TEST 7: Checking priority indicators...');
    const prioBars = await page.locator('.cc-card-prio').count();
    console.log('  Priority bars:', prioBars);
    results.push({ test: 'Priority colors', pass: prioBars > 0, detail: `${prioBars} bars` });
    
    // Test 8: Check view toggle buttons
    console.log('TEST 8: Checking view toggles...');
    const kanbanBtn = await page.locator('#ccViewKanban').count();
    const listBtn = await page.locator('#ccViewList').count();
    const treeBtn = await page.locator('#ccViewTree').count();
    const galaxyBtn = await page.locator('#ccViewGalaxy').count();
    console.log('  Buttons: kanban=' + kanbanBtn + ' list=' + listBtn + ' tree=' + treeBtn + ' galaxy=' + galaxyBtn);
    results.push({ test: 'View toggles', pass: kanbanBtn === 1 && listBtn === 1 && treeBtn === 1 && galaxyBtn === 1, detail: 'all 4 present' });
    
    // Test 9: Check team filter
    console.log('TEST 9: Checking team filter...');
    const teamFilter = await page.locator('#ccTeamFilter').count();
    const projectFilter = await page.locator('#ccProjectFilter').count();
    console.log('  Team filter:', teamFilter, 'Project filter:', projectFilter);
    results.push({ test: 'Filters exist', pass: teamFilter === 1 && projectFilter === 1, detail: 'both present' });
    
    // Test 10: Check Add Task button
    console.log('TEST 10: Checking Add Task button...');
    const addTaskBtn = await page.locator('text=+ Add Task').count();
    console.log('  Add Task button:', addTaskBtn);
    results.push({ test: 'Add Task button', pass: addTaskBtn > 0, detail: `${addTaskBtn} buttons` });
    
    // Test 11: Click Add Task → modal
    console.log('TEST 11: Testing Add Task modal...');
    await page.click('text=+ Add Task');
    await page.waitForTimeout(500);
    const modal = await page.locator('#addTaskModal').count();
    const modalOpen = await page.locator('#addTaskModal.open').count();
    console.log('  Modal exists:', modal, 'Modal open:', modalOpen);
    results.push({ test: 'Add Task modal', pass: modal === 1 && modalOpen === 1, detail: `modal: ${modal}, open: ${modalOpen}` });
    
    // Close modal
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    
    // Test 12: Navigate to Approvals
    console.log('TEST 12: Navigating to Approvals...');
    await page.click('text=Approvals');
    await page.waitForTimeout(1000);
    const approvalCards = await page.locator('.approval-card').count();
    console.log('  Approval cards:', approvalCards);
    results.push({ test: 'Approval cards', pass: approvalCards >= 3, detail: `${approvalCards} cards` });
    
    // Test 13: Check approval card structure
    console.log('TEST 13: Checking approval card structure...');
    const approveBtn = await page.locator('.btn-approve').count();
    const denyBtn = await page.locator('.btn-deny').count();
    const commentBtn = await page.locator('.btn-comment').count();
    console.log('  Buttons: approve=' + approveBtn + ' deny=' + denyBtn + ' comment=' + commentBtn);
    results.push({ test: 'Approval buttons', pass: approveBtn >= 3 && denyBtn >= 3 && commentBtn >= 3, detail: 'all present' });
    
    // Test 14: Click on agent to open overlay
    console.log('TEST 14: Testing agent detail overlay...');
    await page.click('text=Command Center');
    await page.waitForTimeout(1000);
    // Click on first task card to open agent detail
    const firstCard = page.locator('.cc-card').first();
    if (await firstCard.count() > 0) {
      await firstCard.click();
      await page.waitForTimeout(800);
      const overlay = await page.locator('.agent-overlay').count();
      const overlayOpen = await page.locator('.agent-overlay.open').count();
      console.log('  Overlay exists:', overlay, 'Overlay open:', overlayOpen);
      results.push({ test: 'Agent overlay', pass: overlay === 1 && overlayOpen === 1, detail: `overlay: ${overlay}, open: ${overlayOpen}` });
      
      // Test 15: Check overlay tabs
      console.log('TEST 15: Checking overlay tabs...');
      const tabs = await page.locator('.agent-overlay-tab').count();
      console.log('  Tabs:', tabs);
      results.push({ test: 'Overlay tabs', pass: tabs === 4, detail: `${tabs} tabs` });
      
      // Test 16: Check message input
      console.log('TEST 16: Checking message input...');
      const msgInput = await page.locator('#agentMsgInput').count();
      const sendBtn = await page.locator('.agent-msg-send').count();
      console.log('  Input:', msgInput, 'Send:', sendBtn);
      results.push({ test: 'Message input', pass: msgInput === 1 && sendBtn === 1, detail: 'both present' });
      
      // Close overlay
      await page.click('.agent-overlay-close');
      await page.waitForTimeout(500);
    } else {
      results.push({ test: 'Agent overlay', pass: false, detail: 'No task cards found' });
    }
    
    // Test 17: Check List view
    console.log('TEST 17: Testing List view...');
    await page.click('#ccViewList');
    await page.waitForTimeout(500);
    const listRows = await page.locator('.cc-list-row').count();
    console.log('  List rows:', listRows);
    results.push({ test: 'List view', pass: listRows > 0, detail: `${listRows} rows` });
    
    // Test 18: Check Galaxy view
    console.log('TEST 18: Testing Galaxy view...');
    await page.click('#ccViewGalaxy');
    await page.waitForTimeout(500);
    const galaxyAgents = await page.locator('.cc-galaxy-agent').count();
    console.log('  Galaxy agents:', galaxyAgents);
    results.push({ test: 'Galaxy view', pass: galaxyAgents > 0, detail: `${galaxyAgents} agents` });
    
    // Test 19: Check Tree view
    console.log('TEST 19: Testing Tree view...');
    await page.click('#ccViewTree');
    await page.waitForTimeout(500);
    const treeView = await page.locator('#ccTree').count();
    console.log('  Tree view:', treeView);
    results.push({ test: 'Tree view', pass: treeView === 1, detail: 'tree rendered' });
    
    // Test 20: Check service worker updated
    console.log('TEST 20: Checking service worker...');
    const swContent = await page.evaluate(() => {
      return fetch('/sw.js').then(r => r.text());
    });
    const swUpdated = swContent.includes('notification-navigate') && swContent.includes('chatUrl');
    console.log('  SW updated:', swUpdated);
    results.push({ test: 'Service worker', pass: swUpdated, detail: 'has notification routing' });
    
  } catch(e) {
    console.error('ERROR:', e.message);
    results.push({ test: 'Error', pass: false, detail: e.message });
  }
  
  await browser.close();
  
  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log('TEST RESULTS SUMMARY');
  console.log('='.repeat(60));
  let passed = 0;
  results.forEach(r => {
    const status = r.pass ? '✅ PASS' : '❌ FAIL';
    console.log(`  ${status}  ${r.test}: ${r.detail}`);
    if (r.pass) passed++;
  });
  console.log('='.repeat(60));
  console.log(`TOTAL: ${passed}/${results.length} passed`);
  
  process.exit(passed === results.length ? 0 : 1);
})();
