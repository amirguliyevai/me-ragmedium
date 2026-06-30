(function() {
    'use strict';
    
    // Wait for DCLogic to be available (support.js loads asynchronously)
    function init() {
        if (!window.DCLogic || !window.__dcRegistry) {
            setTimeout(init, 100);
            return;
        }
        
        const API_BASE = 'http://127.0.0.1:1707';
        
        // Color scheme for teams/divisions
        const TEAM_COLORS = {
            'Executive': '#ffb020',
            'Engineering': '#18e0ff', 
            'Content': '#ff5cc8',
            'ClientSuccess': '#2fe08a',
            'LeadGen': '#9b7bff',
            'Operations': '#9b7bff',
            'Research': '#9b7bff',
            'Startups': '#c77bff',
            'Leadership': '#ffb020',
            'General': '#5b6b82'
        };
        
        const PRIORITY_COLORS = {
            0: '#ff4d5e', // P0
            1: '#ffb020', // P1
            2: '#18e0ff', // P2
            3: '#6b7a90', // P3
        };
        
        const PRIORITY_LABELS = { 0: 'P0', 1: 'P1', 2: 'P2', 3: 'P3' };
        
        const STATUS_CONFIG = {
            'backlog': { label: 'BACKLOG', color: '#6b7a90' },
            'todo': { label: 'TO DO', color: '#9b7bff' },
            'in_progress': { label: 'IN PROGRESS', color: '#18e0ff' },
            'review': { label: 'REVIEW', color: '#ff5cc8' },
            'done': { label: 'DONE', color: '#2fe08a' },
            'failed': { label: 'FAILED', color: '#ff4d5e' },
            'approved': { label: 'APPROVED', color: '#2fe08a' },
            'denied': { label: 'DENIED', color: '#ff4d5e' },
        };
        
        // Nav definitions from original template
        const NAV_MAIN = [
            { id: 'overview', label: 'Overview', glyph: '⊞' },
            { id: 'board', label: 'Board', glyph: '▦' },
            { id: 'agents', label: 'Agents', glyph: '◉' },
            { id: 'activity', label: 'Activity', glyph: '⟁' },
            { id: 'messages', label: 'Slack', glyph: '◇' },
            { id: 'galaxy', label: 'Galaxy', glyph: '✦' },
        ];
        
        const NAV_MORE = ['Todo', 'Calendar', 'Projects', 'Desktop', 'Workspace', 'Docs', 'Gallery', 'Skills', 'Secrets']
            .map(n => ({ id: 'placeholder', label: n, glyph: n[0] }));
        
        // Project colors from original
        const PROJ_COLORS = {
            'Content Empire': '#7b9bff',
            'Engineering': '#18e0ff',
            'Lead Generation': '#9be23d',
            'Client Success': '#2fe0c8',
            'Operations': '#9b7bff',
            'Research': '#9b7bff',
            'Startups': '#c77bff',
            'Executive': '#ffb020',
        };
        
        const CHANNELS = [
            { id: '#command', label: 'command' },
            { id: '#engineering', label: 'engineering' },
            { id: '#content', label: 'content' },
            { id: '#client-success', label: 'client-success' },
            { id: '#approvals', label: 'approvals' },
        ];
        
        // API helper
        async function apiGet(path) {
            try {
                const res = await fetch(API_BASE + path);
                if (!res.ok) return null;
                return await res.json();
            } catch(e) {
                console.error('API error:', path, e);
                return null;
            }
        }
        
        async function apiPatch(path, body) {
            try {
                const res = await fetch(API_BASE + path, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                });
                return res.ok;
            } catch(e) {
                console.error('API patch error:', path, e);
                return false;
            }
        }
        
        function getInitials(name) {
            return name ? name.charAt(0).toUpperCase() : '?';
        }
        
        function getDivisionColor(div) {
            return TEAM_COLORS[div] || '#5b6b82';
        }
        
        function timeAgo(dateStr) {
            if (!dateStr) return '—';
            const ms = Date.now() - new Date(dateStr).getTime();
            const sec = Math.floor(ms / 1000);
            if (sec < 60) return sec + 's';
            const min = Math.floor(sec / 60);
            if (min < 60) return min + 'm';
            const hr = Math.floor(min / 60);
            if (hr < 24) return hr + 'h';
            return Math.floor(hr / 24) + 'd';
        }
        
        class Component extends window.DCLogic {
            constructor(props) {
                super(props);
                this.state = {
                    tab: 'overview', placeholderName: '',
                    openTaskId: null, openAgentId: null,
                    chatCollapsed: false, channel: '#command',
                    notifOpen: false, tick: 0, clock: this._clock(),
                    feedIdx: 0, resolved: {}, typingOn: true,
                    boardMode: 'kanban', agentsMode: 'grid',
                    slackTab: 'agents', slackConv: 'dm:forge',
                    callAgentId: null, callStart: 0,
                    loading: true, data: null,
                };
            }
            
            _clock() {
                const d = new Date();
                return String(d.getHours()).padStart(2, '0') + ':' + 
                       String(d.getMinutes()).padStart(2, '0') + ':' + 
                       String(d.getSeconds()).padStart(2, '0');
            }
            
            async _fetchData() {
                const [stats, tasksRes, agents, projects, notifications] = await Promise.all([
                    apiGet('/api/stats'),
                    apiGet('/api/tasks?limit=50'),
                    apiGet('/api/agents'),
                    apiGet('/api/projects'),
                    apiGet('/api/notifications'),
                ]);
                
                const tasks = (tasksRes && (tasksRes.tasks || tasksRes)) || [];
                const agentList = agents || [];
                const projList = projects || [];
                const notifList = notifications || [];
                
                const agentMap = {};
                agentList.forEach(a => { agentMap[a.id] = a; });
                
                const divisions = {};
                agentList.forEach(a => {
                    const div = a.division || 'General';
                    if (!divisions[div]) divisions[div] = [];
                    divisions[div].push(a);
                });
                
                const projMap = {};
                projList.forEach(p => { projMap[p.id] = p; });
                
                this.setState({ data: { agentMap, agentList, divisions, tasks, projList, projMap, stats, notifList }, loading: false });
            }
            
            componentDidMount() {
                this._fetchData();
                this._t1 = setInterval(() => this.setState({ clock: this._clock() }), 1000);
                this._t2 = setInterval(() => this.setState(s => ({ tick: s.tick + 1, typingOn: !s.typingOn })), 1700);
                this._t3 = setInterval(() => this._fetchData(), 30000);
            }
            
            componentWillUnmount() {
                [this._t1, this._t2, this._t3].forEach(clearInterval);
            }
            
            renderVals() {
                const s = this.state;
                const d = s.data;
                
                if (!d) {
                    return this._defaultRenderVals();
                }
                
                const { agentMap, agentList, divisions, tasks, projList, projMap, stats, notifList } = d;
                
                const activeAgents = agentList.filter(a => a.status === 'active');
                const onlineAgents = agentList.filter(a => a.status === 'active' || a.status === 'online' || a.status === 'idle');
                
                const enrichAgent = (a) => ({
                    id: String(a.id),
                    name: a.name,
                    role: a.title || a.agent_type || '',
                    team: a.division || 'General',
                    teamName: a.division || 'General',
                    color: getDivisionColor(a.division),
                    init: getInitials(a.name),
                    status: a.status || 'idle',
                    statusLabel: (a.status || 'idle').toUpperCase(),
                    statusC: a.status === 'active' ? '#18e0ff' : a.status === 'online' ? '#2fe08a' : '#6b7a90',
                    working: a.status === 'active',
                    model: a.model || '',
                    level: a.level || 2,
                    parent_agent_id: a.parent_agent_id,
                    isActive: a.is_active !== false,
                });
                
                const enrichedAgents = agentList.map(enrichAgent);
                const enrichedAgentMap = {};
                enrichedAgents.forEach(a => { enrichedAgentMap[a.id] = a; });
                
                const enrichedTasks = tasks.map(t => {
                    const pri = t.priority !== undefined && t.priority !== null ? t.priority : 3;
                    const assignees = t.assigned_agents || [];
                    const assigneeId = assignees.length > 0 ? assignees[0] : null;
                    const assigneeAgent = assigneeId ? enrichedAgentMap[String(assigneeId)] : null;
                    
                    const projId = t.project_id;
                    const proj = projId ? projMap[projId] : null;
                    const projName = proj ? proj.name : (t.agent_division || 'General');
                    const projColor = PROJ_COLORS[projName] || getDivisionColor(t.agent_division) || '#5b6b82';
                    
                    const status = t.status || 'backlog';
                    const statusCfg = STATUS_CONFIG[status] || { label: status.toUpperCase(), color: '#6b7a90' };
                    const pct = status === 'in_progress' ? 50 : status === 'done' ? 100 : status === 'review' ? 90 : status === 'failed' ? 0 : status === 'todo' ? 10 : 0;
                    
                    return {
                        id: String(t.id),
                        title: t.title || 'Untitled',
                        projName: projName,
                        projColor: projColor,
                        pri: pri,
                        priC: PRIORITY_COLORS[pri] || '#6b7a90',
                        priLabel: PRIORITY_LABELS[pri] || 'P' + pri,
                        status: status,
                        statusLabel: statusCfg.label,
                        statusColor: statusCfg.color,
                        assignee: assigneeId ? String(assigneeId) : null,
                        assigneeName: assigneeAgent ? assigneeAgent.name : 'Unassigned',
                        assigneeColor: assigneeAgent ? assigneeAgent.color : '#475264',
                        assigneeInit: assigneeAgent ? assigneeAgent.init : '?',
                        pct: pct,
                        pctStr: pct + '%',
                        eta: t.created_at ? timeAgo(t.created_at) : '—',
                        tags: t.tags || [],
                        agent_type: t.agent_type || '',
                        agent_division: t.agent_division || '',
                        description: t.description || '',
                        created_at: t.created_at,
                        waitingApproval: false,
                        hasApproval: false,
                        isProg: status === 'in_progress' || status === 'review',
                        train: [],
                    };
                });
                
                const taskMap = {};
                enrichedTasks.forEach(t => { taskMap[t.id] = t; });
                
                const activeTasks = enrichedTasks.filter(t => t.status === 'in_progress' || t.status === 'review');
                const liveOps = activeTasks.slice(0, 8).map(t => ({ ...t, waitingApproval: false }));
                
                const sortedTasks = [...enrichedTasks].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
                const activity = sortedTasks.slice(0, 15).map(t => {
                    const agent = t.assigneeName !== 'Unassigned' ? enrichedAgentMap[t.assignee] : null;
                    return {
                        task: t.id,
                        agentName: agent ? agent.name : t.assigneeName,
                        agentColor: agent ? agent.color : '#475264',
                        agentInit: agent ? agent.init : getInitials(t.assigneeName),
                        verb: t.status === 'done' ? 'completed' : t.status === 'in_progress' ? 'started' : t.status === 'failed' ? 'failed on' : 'queued',
                        obj: t.title,
                        time: t.created_at ? timeAgo(t.created_at) : '—',
                        type: (t.agent_type || 'task').toUpperCase(),
                        typeC: t.status === 'done' ? '#2fe08a' : t.status === 'failed' ? '#ff4d5e' : '#18e0ff',
                        detail: '',
                    };
                });
                
                const approvalNotifs = notifList.filter(n => n.priority === 'high' || n.priority === 'normal').slice(0, 5);
                const approvals = approvalNotifs.map(n => {
                    const sourceName = n.source || 'System';
                    const sourceAgent = enrichedAgentMap[sourceName] || null;
                    return {
                        taskId: String(n.id),
                        requesterName: sourceAgent ? sourceAgent.name : sourceName,
                        requesterColor: sourceAgent ? sourceAgent.color : '#ffb020',
                        requesterInit: sourceAgent ? sourceAgent.init : getInitials(sourceName),
                        requesterRole: sourceAgent ? sourceAgent.role : 'System',
                        priC: n.priority === 'high' ? '#ff4d5e' : n.priority === 'normal' ? '#ffb020' : '#18e0ff',
                        priLabel: n.priority === 'high' ? 'P1' : n.priority === 'normal' ? 'P2' : 'P3',
                        request: n.title || 'Action required',
                        reason: n.message || '',
                        age: n.ts ? timeAgo(n.ts) : '—',
                        resolved: !!s.resolved[String(n.id)],
                        notResolved: !s.resolved[String(n.id)],
                        approved: s.resolved[String(n.id)] === 'approved',
                        state: (s.resolved[String(n.id)] || 'PENDING').toUpperCase(),
                    };
                });
                const pendingApprovals = approvals.filter(a => !a.resolved);
                
                const statsArr = [];
                if (stats) {
                    statsArr.push({ label: 'AGENTS ONLINE', value: (stats.agents?.active || 0) + ' / ' + (stats.agents?.total || 0), c: '#2fe08a' });
                    statsArr.push({ label: 'ACTIVE OPS', value: String(stats.taskCounts?.in_progress || 0), c: '#18e0ff' });
                    statsArr.push({ label: 'IN REVIEW', value: String(tasks.filter(t => t.status === 'review').length), c: '#ff5cc8' });
                    statsArr.push({ label: 'APPROVALS', value: String(pendingApprovals.length), c: '#ffb020' });
                    statsArr.push({ label: 'DONE TODAY', value: String(stats.taskCounts?.done || 0), c: '#9b7bff' });
                } else {
                    statsArr.push({ label: 'AGENTS ONLINE', value: agentList.length + ' / ' + agentList.length, c: '#2fe08a' });
                    statsArr.push({ label: 'ACTIVE OPS', value: String(activeTasks.length), c: '#18e0ff' });
                    statsArr.push({ label: 'DONE', value: '0', c: '#9b7bff' });
                }
                
                const teamColors = { ...TEAM_COLORS };
                const teamsGrouped = Object.entries(divisions).map(([name, agents]) => ({
                    key: name,
                    name: name,
                    color: teamColors[name] || '#5b6b82',
                    agents: agents.map(enrichAgent),
                })).filter(t => t.agents.length > 0);
                
                const STATUS_ORDER = ['backlog', 'todo', 'in_progress', 'review', 'done'];
                const cols = STATUS_ORDER.map(key => {
                    const cfg = STATUS_CONFIG[key];
                    const ts = enrichedTasks.filter(t => t.status === key);
                    return {
                        key,
                        label: cfg.label,
                        count: ts.length,
                        color: cfg.color,
                        tasks: ts.map(t => ({ ...t, isProg: key === 'in_progress' || key === 'review' })),
                    };
                }).filter(c => c.tasks.length > 0);
                const boardRows = enrichedTasks;
                
                const onlineView = onlineAgents.map(enrichAgent).slice(0, 14);
                
                const you = { name: 'Amir', role: 'Founder', init: 'A', color: '#ffb020' };
                const leadAgents = agentList.filter(a => a.level === 1);
                const leads = leadAgents.slice(0, 6).map(l => {
                    const el = enrichAgent(l);
                    const reports = agentList.filter(a => a.parent_agent_id === l.id).map(enrichAgent);
                    return { team: l.division || 'Team', lead: el, reports: reports.slice(0, 8) };
                });
                const org = { you, leads };
                
                const notifs = notifList.slice(0, 10).map(n => {
                    const sourceName = n.source || 'System';
                    const sourceAgent = enrichedAgentMap[sourceName] || null;
                    return {
                        id: String(n.id),
                        agentName: sourceAgent ? sourceAgent.name : sourceName,
                        agentColor: sourceAgent ? sourceAgent.color : '#ffb020',
                        agentInit: sourceAgent ? sourceAgent.init : getInitials(sourceName),
                        text: n.title || '',
                        age: n.ts ? timeAgo(n.ts) : '—',
                        resolved: !!s.resolved[String(n.id)],
                    };
                });
                const notifCount = notifs.filter(n => !n.resolved).length;
                
                const channels = CHANNELS.map(c => ({
                    ...c,
                    active: c.id === s.channel,
                    hasUnread: false,
                    unread: 0,
                }));
                const channelLabel = s.channel;
                
                const recentActivityMsgs = activity.slice(0, 8).map(a => ({
                    agentColor: a.agentColor,
                    agentInit: a.agentInit,
                    agentName: a.agentName,
                    agentRole: '',
                    time: a.time,
                    text: a.verb + ' ' + a.obj,
                    isMention: false,
                    isApproval: false,
                    isStatus: false,
                }));
                const activeMessages = recentActivityMsgs;
                
                const typers = enrichedAgents.filter(a => a.working);
                const typer = typers[s.tick % typers.length] || enrichedAgents[0] || { name: '...', color: '#18e0ff', init: '?' };
                
                const slackAgentTeams = teamsGrouped.map(tm => ({
                    name: tm.name,
                    color: tm.color,
                    count: tm.agents.length,
                    agents: tm.agents.map(a => ({
                        ...a,
                        conv: 'dm:' + a.id,
                        active: s.slackConv === 'dm:' + a.id,
                    })),
                }));
                const slackGroups = [
                    { conv: 'grp:all', name: 'all-agents', topic: 'Everyone', members: agentList.length, active: s.slackConv === 'grp:all', last: '' },
                    { conv: 'grp:eng', name: 'engineering', topic: 'Engineering', members: (divisions['Engineering'] || []).length, active: s.slackConv === 'grp:eng', last: '' },
                    { conv: 'grp:content', name: 'content-guild', topic: 'Content', members: (divisions['Content'] || []).length, active: s.slackConv === 'grp:content', last: '' },
                ];
                
                let convHeader = '', convMsgs = [], convSub = '', convColor = '#18e0ff', convInit = '?';
                if (s.slackConv && s.slackConv.startsWith('dm:')) {
                    const id = s.slackConv.slice(3);
                    const a = enrichedAgentMap[id] || enrichedAgents.find(x => x.name.toLowerCase() === id);
                    if (a) {
                        convHeader = a.name;
                        convSub = a.role + ' · ' + a.teamName;
                        convColor = a.color;
                        convInit = a.init;
                        const agentTasks = enrichedTasks.filter(t => t.assignee === a.id).slice(0, 3);
                        convMsgs = agentTasks.length > 0 ? agentTasks.map(t => ({
                            fromName: a.name, fromColor: a.color, fromInit: a.init,
                            time: t.created_at ? timeAgo(t.created_at) : '—',
                            text: 'Working on: ' + t.title, isMe: false, mentionsMe: false,
                        })) : [{
                            fromName: a.name, fromColor: a.color, fromInit: a.init,
                            time: '—', text: 'Standing by. No blockers.', isMe: false, mentionsMe: false,
                        }];
                    }
                } else {
                    convHeader = s.slackConv || '#command';
                    convSub = 'Channel';
                    convColor = '#9b7bff';
                    convInit = '#';
                    convMsgs = notifList.slice(0, 5).map(n => ({
                        fromName: n.source || 'System',
                        fromColor: n.priority === 'high' ? '#ff4d5e' : '#18e0ff',
                        fromInit: getInitials(n.source || 'S'),
                        time: n.ts ? timeAgo(n.ts) : '—',
                        text: n.title || n.message || '',
                        isMe: false,
                        mentionsMe: n.priority === 'high',
                    }));
                }
                
                let callView = null;
                if (s.callAgentId) {
                    const a = enrichedAgentMap[String(s.callAgentId)] || enrichedAgents[0];
                    if (a) {
                        const elapsed = Math.floor((Date.now() - s.callStart) / 1000);
                        const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
                        const ss = String(elapsed % 60).padStart(2, '0');
                        callView = {
                            ...a,
                            statusC: a.statusC,
                            timer: mm + ':' + ss,
                            transcript: [
                                { text: 'Hey — you\'re live. What do you need?', isMe: false, who: a.name, whoColor: a.color },
                                { text: 'Status update on your current work.', isMe: true, who: 'You', whoColor: '#ffb020' },
                                { text: 'On it. Current task: ' + (a.taskTitle || 'no active task'), isMe: false, who: a.name, whoColor: a.color },
                            ],
                        };
                    }
                }
                
                const divisionsArr = Object.entries(divisions);
                const galaxyData = divisionsArr.slice(0, 8).map(([name, agents]) => ({
                    key: name,
                    name: name,
                    color: teamColors[name] || '#5b6b82',
                    count: agents.length,
                    ships: agents.filter(a => a.status === 'active').length,
                    agents: agents.slice(0, 5).map(a => ({ init: getInitials(a.name), color: getDivisionColor(a.division), active: a.status === 'active' })),
                }));
                
                let taskView = null;
                if (s.openTaskId) {
                    const t = taskMap[s.openTaskId];
                    if (t) {
                        taskView = {
                            ...t,
                            hasApproval: false,
                            assignee: t.assignee || '',
                            chan: t.agent_type ? '#' + t.agent_type : '#command',
                            approvalData: null,
                        };
                    }
                }
                
                let agentView = null;
                if (s.openAgentId) {
                    const a = enrichedAgentMap[String(s.openAgentId)] || enrichedAgents.find(x => x.name.toLowerCase() === String(s.openAgentId));
                    if (a) {
                        const agentTasks = enrichedTasks.filter(t => t.assignee === a.id);
                        const currentTask = agentTasks.find(t => t.status === 'in_progress') || agentTasks[0] || null;
                        agentView = {
                            ...a,
                            isActive: a.status === 'active',
                            ring: a.statusC,
                            taskTitle: currentTask ? currentTask.title : 'No active task',
                            taskId: currentTask ? currentTask.id : '',
                            hasTask: !!currentTask,
                            hasCot: true,
                            noCot: false,
                            cot: [
                                { t: 'THINK', x: 'Ready and operational.', tagC: '#9b7bff' },
                                { t: 'ACT', x: currentTask ? 'Working on: ' + currentTask.title : 'Idle, awaiting instructions.', tagC: '#18e0ff' },
                            ],
                        };
                    }
                }
                
                const navMainView = NAV_MAIN.map(n => ({
                    ...n,
                    active: s.tab === n.id,
                    glyphColor: s.tab === n.id ? '#18e0ff' : '#5b6b82',
                }));
                const collapsed = s.chatCollapsed;
                
                return {
                    gridCols: collapsed ? '74px 1fr 0px' : '74px 1fr 360px',
                    galaxyDataJson: JSON.stringify(galaxyData),
                    navMain: navMainView,
                    navMore: NAV_MORE,
                    viewName: s.tab === 'placeholder' ? s.placeholderName : (NAV_MAIN.find(n => n.id === s.tab) || { label: '' }).label || 'Overview',
                    isOverview: s.tab === 'overview',
                    isBoard: s.tab === 'board',
                    isAgents: s.tab === 'agents',
                    isActivity: s.tab === 'activity',
                    isGalaxy: s.tab === 'galaxy',
                    isMessages: s.tab === 'messages',
                    isPlaceholder: s.tab === 'placeholder',
                    placeholderName: s.placeholderName,
                    clock: s.clock,
                    stats: statsArr,
                    liveOps,
                    activity,
                    approvals,
                    onlineAgents: onlineView,
                    boardMode: s.boardMode,
                    isKanban: s.boardMode === 'kanban',
                    isTable: s.boardMode === 'table',
                    cols,
                    boardRows,
                    agentsMode: s.agentsMode,
                    isGridMode: s.agentsMode === 'grid',
                    isTreeMode: s.agentsMode === 'tree',
                    teamsGrouped,
                    org,
                    slackTab: s.slackTab,
                    isSlackAgents: s.slackTab === 'agents',
                    isSlackGroups: s.slackTab === 'groups',
                    slackAgentTeams,
                    slackGroups,
                    convMsgs,
                    convHeader,
                    convColor,
                    convInit,
                    convSub,
                    channels,
                    activeMessages,
                    channelLabel,
                    typerName: typer.name,
                    typerColor: typer.color,
                    typerInit: typer.init,
                    typingOn: s.typingOn,
                    feedOpen: !collapsed,
                    feedCollapsed: collapsed,
                    chatCollapsed: collapsed,
                    notifs,
                    notifCount,
                    notifOpen: s.notifOpen,
                    taskView,
                    agentView,
                    taskOpen: !!taskView,
                    agentOpen: !!agentView,
                    callView,
                    callOpen: !!callView,
                    callClosed: !callView,
                    setTab: this.setTab,
                    openTask: this.openTask,
                    openAgent: this.openAgent,
                    closeOverlay: this.closeOverlay,
                    approve: this.approve,
                    deny: this.deny,
                    goToChat: this.goToChat,
                    selectChannel: this.selectChannel,
                    toggleNotif: this.toggleNotif,
                    toggleChat: this.toggleChat,
                    notifJump: this.notifJump,
                    setBoardMode: this.setBoardMode,
                    setAgentsMode: this.setAgentsMode,
                    setSlackTab: this.setSlackTab,
                    openConv: this.openConv,
                    openCall: this.openCall,
                    endCall: this.endCall,
                };
            }
            
            _defaultRenderVals() {
                return {
                    gridCols: '74px 1fr 360px',
                    galaxyDataJson: '[]',
                    navMain: NAV_MAIN.map(n => ({ ...n, glyphColor: '#5b6b82', active: false })),
                    navMore: NAV_MORE,
                    viewName: 'loading',
                    isOverview: true, isBoard: false, isAgents: false, isActivity: false,
                    isGalaxy: false, isMessages: false, isPlaceholder: false,
                    placeholderName: '',
                    clock: this._clock(),
                    stats: [
                        { label: 'AGENTS ONLINE', value: '...', c: '#2fe08a' },
                        { label: 'ACTIVE OPS', value: '...', c: '#18e0ff' },
                    ],
                    liveOps: [], activity: [], approvals: [], onlineAgents: [],
                    boardMode: 'kanban', isKanban: true, isTable: false,
                    cols: [], boardRows: [],
                    agentsMode: 'grid', isGridMode: true, isTreeMode: false,
                    teamsGrouped: [], org: { you: { name: 'Amir', role: 'Founder', init: 'A', color: '#ffb020' }, leads: [] },
                    slackTab: 'agents', isSlackAgents: true, isSlackGroups: false,
                    slackAgentTeams: [], slackGroups: [],
                    convMsgs: [], convHeader: '...', convColor: '#18e0ff', convInit: '?', convSub: '',
                    channels: CHANNELS.map(c => ({ ...c, active: false, hasUnread: false, unread: 0 })),
                    activeMessages: [], channelLabel: '#command',
                    typerName: '...', typerColor: '#18e0ff', typerInit: '?', typingOn: true,
                    feedOpen: true, feedCollapsed: false, chatCollapsed: false,
                    notifs: [], notifCount: 0, notifOpen: false,
                    taskView: null, agentView: null, taskOpen: false, agentOpen: false,
                    callView: null, callOpen: false, callClosed: true,
                    setTab: this.setTab, openTask: this.openTask, openAgent: this.openAgent,
                    closeOverlay: this.closeOverlay, approve: this.approve, deny: this.deny,
                    goToChat: this.goToChat, selectChannel: this.selectChannel,
                    toggleNotif: this.toggleNotif, toggleChat: this.toggleChat,
                    notifJump: this.notifJump, setBoardMode: this.setBoardMode,
                    setAgentsMode: this.setAgentsMode, setSlackTab: this.setSlackTab,
                    openConv: this.openConv, openCall: this.openCall, endCall: this.endCall,
                };
            }
            
            setTab(e) {
                const t = e.currentTarget.dataset.tab;
                const n = e.currentTarget.dataset.name || '';
                this.setState({ tab: t, placeholderName: n, notifOpen: false });
            }
            
            openTask(e) {
                this.setState({ openTaskId: e.currentTarget.dataset.id });
            }
            
            openAgent(e) {
                this.setState({ openAgentId: e.currentTarget.dataset.id });
            }
            
            closeOverlay() {
                this.setState({ openTaskId: null, openAgentId: null });
            }
            
            async approve(e) {
                const id = e.currentTarget.dataset.id;
                e.stopPropagation();
                await apiPatch('/api/tasks/' + id, { status: 'approved' });
                this.setState(s => ({
                    resolved: Object.assign({}, s.resolved, { [id]: 'approved' }),
                }));
            }
            
            async deny(e) {
                const id = e.currentTarget.dataset.id;
                e.stopPropagation();
                await apiPatch('/api/tasks/' + id, { status: 'denied' });
                this.setState(s => ({
                    resolved: Object.assign({}, s.resolved, { [id]: 'denied' }),
                }));
            }
            
            goToChat(e) {
                const c = e.currentTarget.dataset.chan || '#command';
                this.setState({ channel: c, openTaskId: null, chatCollapsed: false });
            }
            
            selectChannel(e) {
                this.setState({ channel: e.currentTarget.dataset.chan });
            }
            
            toggleNotif() {
                this.setState(s => ({ notifOpen: !s.notifOpen }));
            }
            
            toggleChat() {
                this.setState(s => ({ chatCollapsed: !s.chatCollapsed }));
            }
            
            notifJump(e) {
                const id = e.currentTarget.dataset.id;
                this.setState({ openTaskId: id, notifOpen: false });
            }
            
            setBoardMode(e) {
                this.setState({ boardMode: e.currentTarget.dataset.mode });
            }
            
            setAgentsMode(e) {
                this.setState({ agentsMode: e.currentTarget.dataset.mode });
            }
            
            setSlackTab(e) {
                this.setState({ slackTab: e.currentTarget.dataset.tab });
            }
            
            openConv(e) {
                this.setState({ slackConv: e.currentTarget.dataset.conv });
            }
            
            openCall(e) {
                const id = e.currentTarget.dataset.id;
                this.setState({ callAgentId: id, callStart: Date.now() });
            }
            
            endCall() {
                this.setState({ callAgentId: null });
            }
            
            stop(e) {
                e.stopPropagation();
            }
        }
        
        // Patch the registry to hot-reload the Logic class
        const entry = window.__dcRegistry['Root'];
        if (entry) {
            entry.Logic = Component;
            entry.ver = (entry.ver || 0) + 1;
            entry.subs.forEach(fn => fn());
        }
    }
    
    init();
})();
