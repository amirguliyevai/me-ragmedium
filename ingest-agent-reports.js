#!/usr/bin/env node
/**
 * Ingest agent reports from approval-queue and kanban into agent-log.json
 * for display in the dashboard Slack clone with PWA push notifications.
 */
const fs = require('fs');
const path = require('path');

const DASHBOARD_DATA = path.join(__dirname, 'data', 'agent-log.json');
const REPORTS_DIR = '/home/admin/.openclaw/workspace/agent-team/reports';

function id(prefix = 'rpt') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function readAgentLog() {
  try {
    return JSON.parse(fs.readFileSync(DASHBOARD_DATA, 'utf8'));
  } catch {
    return { outputs: {}, status: {}, updated: new Date().toISOString() };
  }
}

function writeAgentLog(log) {
  log.updated = new Date().toISOString();
  fs.writeFileSync(DASHBOARD_DATA, JSON.stringify(log, null, 2));
}

function ingestReports() {
  const log = readAgentLog();
  let newCount = 0;

  // Ensure all agent slots exist
  const agentIds = [
    'kaneki', 'cmo', 'cto', 'cfo', 'lamatrader-lead', 'grademy-lead',
    'pripitch-lead', 'outreach-head', 'content-director', 'rema-lead', 'ventures-pm',
    'chief-of-staff'
  ];
  for (const aid of agentIds) {
    if (!log.outputs[aid]) log.outputs[aid] = [];
  }

  // Scan report files
  if (!fs.existsSync(REPORTS_DIR)) {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
    writeAgentLog(log);
    console.log('Created reports directory, no reports to ingest yet.');
    return;
  }

  const files = fs.readdirSync(REPORTS_DIR).filter(f => f.endsWith('.json'));
  for (const file of files) {
    try {
      const filePath = path.join(REPORTS_DIR, file);
      const report = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const agentId = report.agent || 'unknown';
      
      // Ensure agent slot exists
      if (!log.outputs[agentId]) log.outputs[agentId] = [];

      // Check if this report was already ingested (by id)
      const alreadyExists = log.outputs[agentId].some(o => o.id === report.id);
      if (alreadyExists) continue;

      // Add to outputs
      const output = {
        id: report.id || id(),
        text: report.text || report.summary || report.title || '',
        title: report.title || '',
        type: report.type || 'report',
        at: report.createdAt || new Date().toISOString(),
        surface: 'agent',
        urgency: report.urgency || 'normal'
      };
      
      log.outputs[agentId].push(output);
      newCount++;

      // Move processed file to archive
      const archiveDir = path.join(REPORTS_DIR, 'archive');
      if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir, { recursive: true });
      fs.renameSync(filePath, path.join(archiveDir, file));
    } catch (e) {
      console.error(`Error processing ${file}:`, e.message);
    }
  }

  writeAgentLog(log);
  console.log(`Ingested ${newCount} new agent reports. Total agents: ${Object.keys(log.outputs).length}`);
}

ingestReports();
