import { generateGraph } from './graph-generation.js';
import { STYLE } from './cytoscape-setup.js';
import { renderAgentsLayer, getCyEdge as getCyEdgeShared, highlightEdge as highlightEdgeShared, markCurrentNode as markCurrentNodeShared } from './sim-shared.js';
import { cyRef, setSimState } from './state.js';
import { setStat, logAdd, logClear, updateAgentChips, updateEdgeTable } from './ui.js';

const q = id => document.getElementById(id);
let cy2 = null;

// Use shared STYLE from sim1 for visual parity
const highlightEdge = (from, to, mode) => highlightEdgeShared(cy2, from, to, mode);
const markCurrentNode = (nodeId) => markCurrentNodeShared(cy2, nodeId);
const getCyEdge = (from, to) => getCyEdgeShared(cy2, from, to);
 
function initCy2(nodes, edges) {
  if (!q('cy2')) return;
  if (cy2) cy2.destroy();
  const hasPresetPositions = nodes.some(node => node.position);
  cy2 = cytoscape({
    container: q('cy2'),
    elements: { nodes, edges },
    style: STYLE,
    layout: hasPresetPositions
      ? { name: 'preset', padding: 60, fit: true, animate: false }
      : { name: 'cose', padding: 40, nodeOverlap: 30, animate: false },
  });
  // expose for runtime inspection and debugging
  try { window.cy2 = cy2; } catch (e) { /* ignore */ }
  if (q('cy2')) {
    q('cy2').dataset.nodeCount = String(nodes.length || 0);
    q('cy2').dataset.edgeCount = String(edges.length || 0);
  }
  // set shared cyRef.instance so main UI helpers operate on cy2 when sim2 is active
  try { cyRef.instance = cy2; } catch (e) { /* ignore */ }
  cy2.on('mouseover', 'node', showTooltip2);
  cy2.on('mouseout', 'node', () => { q('tooltip2').style.display = 'none'; });
  cy2.on('pan zoom resize layoutstop', () => renderAgentsLayer(cy2, q('agentLayer2'), state.agents, state.activeAgentId));
  cy2.on('position', 'node', () => renderAgentsLayer(cy2, q('agentLayer2'), state.agents, state.activeAgentId));
}

function showTooltip2(evt) {
  if (!state) return;
  const node = evt.target;
  const nid = node.id();
  const tooltip = q('tooltip2');
  const pos = node.renderedPosition();
  const agentsHere = state.agents.filter(a => a.alive && `n${a.pos}` === nid);
  const here = node.hasClass('blackhole') || node.hasClass('revealed')
    ? '☠ BLACK HOLE'
    : node.hasClass('safe') ? '✓ SAFE' : 'Unexplored';
  const agentList = agentsHere.length > 0
    ? agentsHere.map(a => `A${a.id}`).join(', ')
    : 'none';
  tooltip.innerHTML = `<b>${nid}</b><br>Agents: ${agentList}<br>${here}`;
  tooltip.style.left = `${pos.x + 18}px`;
  tooltip.style.top = `${pos.y - 34}px`;
  tooltip.style.display = 'block';
}

const state = {
  n: 8, f: 1, k: 0, homebase: 0, bhNode: -1, agents: [], neighbors: {}, ports: {}, edges: [],
  edgeStatus: {}, edgeEvidence: {}, know: 'unknown', comm: 'whiteboard', delta: 0,
  round: 0,
  done: false,
  found: false,
  bhLocated: false,
  currentNode: 0,
  visitedNodes: new Set(),
  safeNodes: new Set(),
  traversalOrder: [],
  traversalIndex: 0,
  currentOperation: null,
  activeAgentId: null,
  lostInBH: 0,
  bhDeceptionProb: 0.0,
  log: [],
  intervalId: null,
};

function updateFormula2() {
  const f = +q('sim2fFault').value;
  const know = q('sim2TopoKnow').value;
  const comm = q('sim2CommModel').value;

  let k, time, alg;
  if (know === 'known') {
    k = 2 * f + 2;
    time = 'O(n + f)';
    alg = 'DFS+CCP';
  } else if (comm === 'whiteboard') {
    k = '(f+1)(∆+1)';
    time = 'O(m + f)';
    alg = 'DFS+CCP+WB';
  } else {
    k = '(f+1)(∆+1)+3f+1';
    time = 'O(m·n + f)';
    alg = 'DFS+CCP+MAP';
  }

  q('sim2FormulaBox').innerHTML = `
    <span class="hi">k ≥ ${typeof k === 'number' ? `<b>${k}</b>` : k}</span> agents needed<br>
    Time: <span class="hi-g">${time}</span><br>
    Algorithm: <span class="hi">${alg}</span><br>
    <span class="hi-r">f = ${f}</span> Byzantine fault(s)
  `;
}

function makeAgents(k, f, homebase) {
  const agents = [];
  for (let i = 0; i < k; i++) {
    agents.push({
      id: i,
      pos: homebase,
      alive: true,
      byzantine: false,
      identified: false,
      status: 'good',
    });
  }
  return agents;
}

function addLog(text, style = 'info') {
  state.log.unshift({ round: state.round, text, style });
  if (state.log.length > 50) state.log.pop();
  try {
    const root = document.getElementById('log');
    if (root) {
      const entry = document.createElement('div');
      entry.className = 'log-entry';
      entry.innerHTML = `<span class="log-round">R${state.round}</span><span class="log-msg ${style}">${text}</span>`;
      root.appendChild(entry);
      root.scrollTop = root.scrollHeight;
    }
  } catch (e) {
    // ignore UI errors
  }
}

function renderSim2() {
  if (cy2) {
    cy2.nodes().forEach(node => {
      const index = Number(node.id().slice(1));
      node.removeClass('homebase blackhole safe current');
      if (index === 0) node.addClass('homebase');
      if (index === state.bhNode) node.addClass('blackhole');
      if (state.safeNodes.has(index)) node.addClass('safe');
    });
    cy2.resize();
    cy2.fit();
    renderAgentsLayer(cy2, q('agentLayer2'), state.agents, state.activeAgentId);
  }

  q('sim2Round').textContent = String(state.round);
  const aliveAgents = state.agents.filter(a => a.alive);
  const aliveCount = aliveAgents.length;
  q('sim2Alive').textContent = String(aliveCount);
  q('sim2Lost').textContent = String(state.lostInBH);

  const explorers = aliveAgents.filter(a => a.pos !== state.homebase).length;
  const waiters = aliveAgents.filter(a => a.pos === state.homebase).length;
  q('sim2Explorers').textContent = String(explorers);
  q('sim2Waiters').textContent = String(waiters);

  q('sim2Boundary').textContent = String(state.safeNodes.size);

  const edgeSafe = Object.values(state.edgeStatus).filter(v => v === 'safe').length;
  const edgeDanger = Object.values(state.edgeStatus).filter(v => v === 'dangerous').length;
  q('sim2EdgeSafe').textContent = String(edgeSafe);
  q('sim2EdgeDanger').textContent = String(edgeDanger);
  q('sim2ProgressBar').style.width = progressPercent() + '%';

  const logRoot = q('sim2Log');
  if (logRoot) {
    if (!state.log.length) {
      logRoot.innerHTML = '<div class="log-entry"><span class="log-msg system">Simulation initialized. Press BUILD.</span></div>';
    } else {
      logRoot.innerHTML = state.log
        .map(entry => `<div class="log-entry"><span class="log-round">R${entry.round}</span><span class="log-msg ${entry.style}">${entry.text}</span></div>`)
        .join('');
      logRoot.scrollTop = logRoot.scrollHeight;
    }
  }

  updateSim2AgentChips();
  updateSim2EdgeTable();

  updateRunButton();

  // Sync main UI panel and log to mirror sim2 state for parity with sim1
  try {
    setStat('sRound', String(state.round));
    setStat('sAlive', String(aliveCount));
    setStat('sLost', String(state.lostInBH));
    setStat('sEdgeSafe', String(edgeSafe));
    setStat('sEdgeDanger', String(edgeDanger));

    // Update main log to match sim2 log
    logClear();
    (state.log || []).slice().reverse().forEach(entry => logAdd(entry.round || 0, entry.style || 'info', entry.text));

    // Update agent chips and edge table using shared UI helpers
    updateAgentChips();
    updateEdgeTable();
  } catch (e) {
    // ignore UI sync errors to avoid breaking simulation
  }
}

function updateRunButton() {
  q('sim2RunBtn').textContent = state.intervalId ? '⏸ PAUSE' : '▶ RUN SIMULATION';
}

function stepSim2() {
  if (state.done) {
    addLog('Simulation has completed. Build a new graph to run again.', 'warn');
    return;
  }

  const s = state;
  if (!s.currentOperation) {
    if (shouldFinish()) {
      finishSim2(finishWasSuccessful());
      return;
    }
    s.currentOperation = prepareOperation(s.traversalOrder[s.traversalIndex]);
  }

  const op = s.currentOperation;
  const action = op.actions[op.index++];
  if (!action) {
    addLog('Simulation halted: no valid action was available for the current DFS step.', 'danger');
    finishSim2(false);
    return;
  }
  state.round += 1;
  s.activeAgentId = action.agentId ?? null;
  highlightEdge(action.from ?? op.step.from, action.to ?? op.step.to, action.type === 'moveCluster' ? 'release' : 'probing');

  if (action.type === 'move') {
    moveAgent(action.agentId, action.from ?? op.step.from, action.to ?? op.step.to);
  } else if (action.type === 'moveCluster') {
    moveAgentCluster(action.agentIds, action.from ?? op.step.from, action.to ?? op.step.to);
  } else if (action.type === 'lose') {
    loseAgentToBlackHole(action.agentId, action.from ?? op.step.from, action.to ?? op.step.to);
  } else if (action.type === 'markMoveOnly') {
    s.currentNode = op.step.to;
    markCurrentNode(op.step.to);
  } else if (action.type === 'noop') {
    addLog('No DFS movement was required this round.', 'info');
  }

  if (op.index >= op.actions.length) {
    const outcome = completeOperation(op);
    if (outcome === 'failed') {
      renderSim2();
      finishSim2(false);
      return;
    }
    if (outcome === 'complete') {
      s.currentOperation = null;
      s.traversalIndex++;
    }
  }

  renderSim2();

  if (s.agents.filter(a => a.alive && !a.byzantine).length === 0) {
    addLog('ALL GOOD AGENTS ELIMINATED - BHS FAILED', 'danger');
    finishSim2(false);
    return;
  }

  if (!s.currentOperation && shouldFinish()) {
    finishSim2(finishWasSuccessful());
  }

  if (state.done && state.intervalId) {
    clearInterval(state.intervalId);
    state.intervalId = null;
  }

  renderSim2();
}

function resetSim2() {
  clearInterval(state.intervalId);
  state.intervalId = null;

  if (cy2) {
    cy2.destroy();
    cy2 = null;
  }

  // Clear UI elements
  if (q('agentLayer2')) q('agentLayer2').innerHTML = '';
  if (q('sim2Log')) q('sim2Log').innerHTML = '';
  if (q('sim2EdgeTable')) q('sim2EdgeTable').innerHTML = '';
  if (q('sim2AgentList')) q('sim2AgentList').innerHTML = '';
  if (q('overlay2')) q('overlay2').className = '';

  ['sim2Round', 'sim2Alive', 'sim2Lost', 'sim2Explorers', 'sim2Waiters',
   'sim2Boundary', 'sim2EdgeSafe', 'sim2EdgeDanger'].forEach(id => {
      const el = q(id);
      if (el) {
        el.textContent = (id === 'sim2Alive') ? '—' : '0';
      }
  });
  if (q('sim2ProgressBar')) q('sim2ProgressBar').style.width = '0%';
  if (q('sim2RunBtn')) {
    q('sim2RunBtn').disabled  = true;
    q('sim2RunBtn').textContent = '▶ RUN SIMULATION';
  }
  if (q('sim2StepBtn')) q('sim2StepBtn').disabled = true;

  addLog('Simulation reset. Press BUILD to generate a new graph.', 'system');
  renderSim2();
}

function buildSim2() {
  clearInterval(state.intervalId);
  state.intervalId = null;
  q('sim2RunBtn').textContent = '▶ RUN SIMULATION';

  // Build nodes/edges via shared generator and initialize cy2 with the same style/layout as sim1
  const topo = q('sim2TopoSelect').value;
  const { nodes, edges } = generateGraph(topo, +q('sim2nNodes').value);
  initCy2(nodes, edges);
  if (cy2) {
    const homeId = `n0`;
    const bhId = `n${state.bhNode}`;
    const nHome = cy2.getElementById(homeId);
    const nBh = cy2.getElementById(bhId);
    if (nHome && nHome.length) nHome.addClass('homebase');
    if (nBh && nBh.length) nBh.addClass('blackhole');
  }

  // Clear UI before building
  if (q('sim2EdgeTable')) q('sim2EdgeTable').innerHTML = '';
  if (q('sim2AgentList')) q('sim2AgentList').innerHTML = '';
  if (q('overlay2')) q('overlay2').className = '';
  if (q('sim2Log')) {
    q('sim2Log').innerHTML = '';
  }

  const n = +q('sim2nNodes').value;
  const f = +q('sim2fFault').value;
  const comm = q('sim2CommModel').value;
  const know = q('sim2TopoKnow').value;
  const bhDeceptionProb = (+q('sim2BhDeception').value || 0) / 100;

  const homebase = 0;
  const neighbors = buildNeighbors(n, edges);
  const bhNode = chooseBlackHole(n, homebase, neighbors, know);

  const delta = Math.max(...Object.values(neighbors).map(v => v.length));
  const k = Math.max(requiredAgents(know, comm, f, delta), f + 2);

  const agents = makeAgents(k, f, homebase);

  const ports = {};
  for (let i = 0; i < n; i++) ports[i] = [...new Set(neighbors[i])].sort((a, b) => a - b);

  const edgeStatus = {};
  const edgeEvidence = {};
  edges.forEach(e => {
    const s = +e.data.source.slice(1);
    const t = +e.data.target.slice(1);
    const key = edgeKey(s, t);
    edgeStatus[key] = 'unknown';
    edgeEvidence[key] = {
      departed: new Set(),
      returned: new Set(),
      missing: new Set(),
    };
  });

  Object.assign(state, {
    n, f, k, homebase, bhNode, agents, neighbors, ports, edges,
    edgeStatus, edgeEvidence, know, comm, delta, bhDeceptionProb,
    round: 0,
    done: false,
    found: false,
    bhLocated: false,
    currentNode: homebase,
    visitedNodes: new Set([homebase]),
    safeNodes: new Set([homebase]),
    traversalOrder: [],
    traversalIndex: 0,
    currentOperation: null,
    activeAgentId: null,
    lostInBH: 0,
    log: [],
  });

  state.traversalOrder = know === 'known'
    ? buildKnownDFSPlan()
    : buildUnknownDFSPlan();

  cy2.getElementById('n' + homebase).addClass('homebase');
  cy2.getElementById('n' + bhNode).addClass('blackhole');

  q('sim2RunBtn').disabled = false;
  q('sim2StepBtn').disabled = false;

  // publish sim2 state to shared simState for UI functions
  try { setSimState(state); } catch (e) { /* ignore */ }

  addLog('Simulation initialized.', 'system');
  addLog(`Graph built: ${n} nodes, ${edges.length} edges, Delta=${delta}`, 'system');
  addLog(`Black Hole at node ${bhNode} (hidden from agents)`, 'system');
  addLog(`Team: k=${k} agents, fault tolerance f=${f}`, 'system');
  addLog(`Byzantine BH deception rate: ${(bhDeceptionProb * 100).toFixed(0)}% per probe`, 'system');
  addLog(`CCP thresholds: 1 distinct return => SAFE, 1 distinct non-return => DANGEROUS.`, 'info');
  addLog(`Homebase: node ${homebase}. DFS traversal plan ready.`, 'info');

  updateFormula2();
  renderSim2();
}

function finishSim2(success) {
  state.done = true;
  state.activeAgentId = null;
  clearInterval(state.intervalId);
  state.intervalId = null;

  cy2.edges().removeClass('probing').removeClass('release');
  q('sim2ProgressBar').style.width = '100%';
  q('sim2RunBtn').textContent = '▶ RUN SIMULATION';

  const survivors = state.agents.filter(a => a.alive && !a.byzantine).length;
  if (success) {
    addLog(`BH LOCATED at node ${state.bhNode}`, 'system');
    const modeNote = state.know === 'unknown'
      ? `All ${state.edges.length} edges explored/classified.`
      : 'DFS stopped after locating the black hole.';
    addLog(`${survivors} good agent(s) survived. ${state.lostInBH} lost in BH. ${modeNote}`, 'safe');
    showSim2Overlay('success', 'BLACK HOLE LOCATED',
      `Node ${state.bhNode} identified in ${state.round} rounds - ${survivors} survivors`);
  } else {
    const unknownLeft = Object.values(state.edgeStatus).filter(v => v === 'unknown').length;
    addLog('BHS FAILED', 'danger');
    showSim2Overlay('failure', 'MISSION FAILED',
      unknownLeft > 0 ? `${unknownLeft} edge(s) remained unexplored` : `All good agents eliminated by round ${state.round}`);
  }

  renderSim2();

  q('sim2RunBtn').disabled = true;
  q('sim2StepBtn').disabled = true;
}

function toggleRunSim2() {
  if (state.intervalId) {
    clearInterval(state.intervalId);
    state.intervalId = null;
    updateRunButton();
    addLog('Simulation paused.', 'warn');
    renderSim2();
    return;
  }

  const interval = Number(q('sim2SpeedSel').value);
  state.intervalId = setInterval(() => {
    stepSim2();
    if (state.done && state.intervalId) {
      clearInterval(state.intervalId);
      state.intervalId = null;
      updateRunButton();
    }
  }, interval);
  updateRunButton();
  addLog('Simulation started.', 'info');
  renderSim2();
}

function switchSimulation(value) {
  const sim1 = q('sim1-container');
  const sim2 = q('sim2-container');
  if (!sim1 || !sim2) return;
  if (value === 'sim2') {
    sim1.style.display = 'none';
    sim2.style.display = 'flex';
    // When the container becomes visible, we must tell Cytoscape to resize.
    if (cy2) {
      cy2.resize();
      cy2.fit();
    }
  } else {
    sim1.style.display = '';
    sim2.style.display = 'none';
  }
  q('sim2Select').value = value === 'sim2' ? 'sim2' : 'sim1';
  updateSimulationIndicator(value);
}

function updateSimulationIndicator(value) {
  const indicator = q('simIndicator');
  if (!indicator) return;
  indicator.textContent = value === 'sim2'
    ? 'Active: Byzantine BBH Home Exploration'
    : 'Active: Classical Black Hole Search';
}

function showSim2Overlay(type, title, subtitle) {
  const overlay = q('overlay2');
  if (!overlay) return;
  overlay.className = `active ${type}`;
  q('ov2Title').textContent = title;
  q('ov2Sub').textContent = subtitle;
}

function updateSim2AgentChips() {
  const agentList = q('sim2AgentList');
  if (!agentList) return;
  if (!state || !state.agents || state.agents.length === 0) {
    agentList.innerHTML = '<div class="muted">No agents deployed.</div>';
    return;
  }
  agentList.innerHTML = state.agents.map(agent => {
    // All agents are good, so status is either 'good' or 'dead'.
    const status = agent.alive ? 'good' : 'dead';
    return `<div class="agent-chip agent-${status}" title="A${agent.id} - pos: ${agent.pos ?? 'lost'}">A${agent.id}</div>`;
  }).join('');
}

function updateSim2EdgeTable() {
  const edgeTable = q('sim2EdgeTable');
  if (!edgeTable) return;
  if (!state || !state.edges || state.edges.length === 0) {
    edgeTable.innerHTML = '<div class="muted">No edges to display.</div>';
    return;
  }
  const rows = state.edges.map(edge => {
    const s = +edge.data.source.slice(1);
    const t = +edge.data.target.slice(1);
    const key = edgeKey(s, t);
    const status = state.edgeStatus[key] || 'unknown';
    const evidence = state.edgeEvidence[key];
    const returned = evidence ? evidence.returned.size : 0;
    const missing = evidence ? evidence.missing.size : 0;
    return `<div class="edge-row"><div class="edge-id">e(${s},${t})</div><div class="edge-status edge-status-${status}">${status.toUpperCase()}</div><div class="edge-ev" title="${returned} returned, ${missing} missing"><span class="ev-ret">${returned}</span> / <span class="ev-mis">${missing}</span></div></div>`;
  }).join('');
  edgeTable.innerHTML = rows;
}

// --- Logic copied and adapted from simulation.js ---

function edgeKey(a, b) {
  return `${Math.min(a, b)}-${Math.max(a, b)}`;
}

function buildNeighbors(n, edges) {
  const neighbors = {};
  for (let i = 0; i < n; i++) neighbors[i] = [];
  edges.forEach(e => {
    const s = +e.data.source.slice(1);
    const t = +e.data.target.slice(1);
    neighbors[s].push(t);
    neighbors[t].push(s);
  });
  return neighbors;
}

function graphStaysConnectedWithout(blockedNode, homebase, neighbors, n) {
  const visited = new Set([homebase]);
  const queue = [homebase];
  while (queue.length) {
    const cur = queue.shift();
    for (const next of neighbors[cur] || []) {
      if (next === blockedNode || visited.has(next)) continue;
      visited.add(next);
      queue.push(next);
    }
  }
  return visited.size === n - 1;
}

function chooseBlackHole(n, homebase, neighbors, know) {
  const candidates = [...Array(n).keys()].filter(node => node !== homebase);
  const viable = know === 'unknown'
    ? candidates.filter(node => graphStaysConnectedWithout(node, homebase, neighbors, n))
    : candidates;
  const pool = viable.length > 0 ? viable : candidates;
  return pool[Math.floor(Math.random() * pool.length)];
}

function requiredAgents(know, comm, f, delta) {
  if (know === 'known') return 2 * f + 2;
  if (comm === 'whiteboard') return (f + 1) * (delta + 1);
  return (f + 1) * (delta + 1) + 3 * f + 1;
}

function buildKnownDFSPlan() {
  const { homebase, ports } = state;
  const visited = new Set([homebase]);
  const plan = [];

  const dfs = (u) => {
    for (const v of (ports[u] || [])) {
      if (visited.has(v)) continue;
      visited.add(v);
      plan.push({ kind: 'probe', from: u, to: v, classify: true, label: 'DFS probe' });
      dfs(v);
      plan.push({ kind: 'move', from: v, to: u, classify: false, label: 'DFS backtrack' });
    }
  };

  dfs(homebase);
  return plan;
}

function buildUnknownDFSPlan() {
  const { homebase, bhNode, ports } = state;
  const visitedNodes = new Set([homebase]);
  const exploredEdges = new Set();
  const plan = [];

  const dfs = (u) => {
    for (const v of (ports[u] || [])) {
      const key = edgeKey(u, v);
      if (exploredEdges.has(key)) continue;
      exploredEdges.add(key);

      if (v === bhNode) {
        plan.push({ kind: 'probe', from: u, to: v, classify: true, label: 'BH boundary probe' });
        continue;
      }

      if (!visitedNodes.has(v)) {
        visitedNodes.add(v);
        plan.push({ kind: 'probe', from: u, to: v, classify: true, label: 'DFS discovery' });
        dfs(v);
        plan.push({ kind: 'move', from: v, to: u, classify: false, label: 'DFS backtrack' });
      } else {
        plan.push({ kind: 'probe', from: u, to: v, classify: true, label: 'DFS cross-edge probe' });
        plan.push({ kind: 'move', from: v, to: u, classify: false, label: 'Return after cross-edge probe' });
      }
    }
  };

  dfs(homebase);
  return plan;
}

function prepareOperation(step) {
  if (!step) {
    return { step: { from: state.currentNode, to: state.currentNode }, actions: [{ type: 'noop' }], index: 0 };
  }

  if (step.kind === 'probe') return prepareProbeOperation(step);
  return prepareMoveOperation(step);
}

function prepareMoveOperation(step) {
  const key = edgeKey(step.from, step.to);
  const actions = [];

  if (state.edgeStatus[key] === 'dangerous') {
    addLog(`Golden rule: refusing to traverse dangerous port (${step.from}->${step.to}).`, 'danger');
    actions.push({ type: 'noop' });
    return { step, actions, index: 0 };
  }

  const movers = state.agents.filter(a => a.alive && a.pos === step.from);
  const shouldReleaseCluster = (state.know === 'unknown' || state.edgeStatus[key] === 'safe') && movers.length > 1;

  if (shouldReleaseCluster) {
    actions.push({ type: 'moveCluster', agentIds: movers.map(agent => agent.id), from: step.from, to: step.to });
  } else {
    movers.forEach(agent => actions.push({ type: 'move', agentId: agent.id, from: step.from, to: step.to }));
  }

  if (movers.length === 0) {
    addLog(`No live agents at node ${step.from}; advancing logical DFS cursor to ${step.to}.`, 'warn');
    actions.push({ type: 'markMoveOnly' });
  }

  return { step, actions, index: 0 };
}

function prepareProbeOperation(step) {
  const { from, to } = step;
  const key = edgeKey(from, to);

  if (state.edgeStatus[key] === 'dangerous') {
    addLog(`Golden rule: port (${from}->${to}) is dangerous and will not be probed again.`, 'danger');
    return { step, actions: [{ type: 'noop' }], index: 0 };
  }

  if (state.edgeStatus[key] === 'safe') {
    addLog(`Port (${from}->${to}) is already SAFE; moving across it.`, 'safe');
    return prepareMoveOperation(step);
  }

  if (state.bhLocated && to === state.bhNode) {
    markPortDangerous(from, to, `Known black-hole boundary (${from}->${to}) marked DANGEROUS without another probe.`);
    return { step, actions: [{ type: 'noop' }], index: 0 };
  }

  const threshold = 1; // No byzantine agents, 1 confirmation is enough.
  const candidates = agentsAvailableForProbe(from);
  if (candidates.length < threshold) {
    addLog(`CCP cannot start on (${from}->${to}): need ${threshold} available agents at node ${from}, found ${candidates.length}.`, 'danger');
    return { step, actions: [{ type: 'noop' }], index: 0, failed: true };
  }

  const probe = {
    key,
    phase: 'initial',
    sent: new Set(),
    returned: new Set(),
    missing: new Set(),
    limit: 1,
  };

  const op = { step, actions: [], index: 0, probe };
  const outcome = scheduleSoloProbe(op);
  if (outcome === 'failed') {
    return { step, actions: [{ type: 'noop' }], index: 0, failed: true };
  }

  addLog(`CCP starts on (${from}->${to}) with a solo probe; 1 confirmation needed.`, 'system');
  return op;
}

function agentsAvailableForProbe(nodeId) {
  return state.agents.filter(agent =>
    agent.alive &&
    agent.pos === nodeId &&
    !agent.identified // this property is now always false but harmless to keep check
  );
}

function buildProbeActionsForAgent(agent, from, to, probe) {
  probe.sent.add(agent.id);
  const isBlackHolePort = to === state.bhNode;

  if (isBlackHolePort) {
    const bhDeceives = Math.random() < state.bhDeceptionProb;
    if (bhDeceives) {
      addLog(`Byzantine BH at ${to} deceives, A${agent.id} returns.`, 'byz');
      return [
        { type: 'move', agentId: agent.id, from, to },
        { type: 'move', agentId: agent.id, from: to, to: from, probeResult: 'return' },
      ];
    } else {
      return [{ type: 'lose', agentId: agent.id, from, to, probeResult: 'missing' }];
    }
  }

  return [
    { type: 'move', agentId: agent.id, from, to },
    { type: 'move', agentId: agent.id, from: to, to: from, probeResult: 'return' },
  ];
}

function recordProbeEvidence(op) {
  const evidence = state.edgeEvidence[op.probe.key];

  op.actions.forEach(action => {
    if (!action.probeResult) return;
    op.probe.sent.add(action.agentId);
    evidence.departed.add(action.agentId);

    if (action.probeResult === 'return') {
      op.probe.returned.add(action.agentId);
      evidence.returned.add(action.agentId);
    } else if (action.probeResult === 'missing') {
      op.probe.missing.add(action.agentId);
      evidence.missing.add(action.agentId);
    }
  });
}

function scheduleSafeAdvance(op) {
  const { from, to } = op.step;
  const movers = state.agents.filter(agent => agent.alive && agent.pos === from);

  if (movers.length === 0) {
    state.currentNode = to;
    markCurrentNode(to);
    return 'complete';
  }

  op.probe.phase = 'advance-safe';
  op.actions = [{ type: 'moveCluster', agentIds: movers.map(agent => agent.id), from, to }];
  op.index = 0;
  addLog(`Release phase: the verified cluster crosses (${from}->${to}) together.`, 'safe');
  return 'continue';
}

function scheduleSoloProbe(op) {
  const { from, to } = op.step;

  if (op.probe.sent.size >= op.probe.limit) {
    addLog(`CCP exhausted ${op.probe.limit} probe agent(s) on (${from}->${to}) without reaching a threshold.`, 'danger');
    return 'failed';
  }

  const nextAgent = agentsAvailableForProbe(from).find(agent => !op.probe.sent.has(agent.id));
  if (!nextAgent) {
    addLog(`CCP cannot continue on (${from}->${to}): no unused non-blacklisted agent remains at node ${from}.`, 'danger');
    return 'failed';
  }

  op.probe.phase = 'solo';
  op.actions = buildProbeActionsForAgent(nextAgent, from, to, op.probe);
  op.index = 0;
  addLog(`Solo CCP probe: A${nextAgent.id} tests (${from}->${to}) and immediately returns.`, 'system');
  return 'continue';
}

function markPortDangerous(from, to, message) {
  const key = edgeKey(from, to);
  state.edgeStatus[key] = 'dangerous';
  const cyEdge = getCyEdge(from, to);
  cyEdge.addClass('dangerous').removeClass('probing');
  cy2.getElementById(`n${to}`).removeClass('blackhole').addClass('revealed');
  addLog(message, 'danger');
}

function moveAgent(agentId, from, to) {
  const agent = state.agents.find(a => a.id === agentId);
  if (!agent || !agent.alive) return;

  agent.pos = to;
  state.currentNode = to;
  markCurrentNode(to);
  addLog(`A${agent.id} moves ${from}->${to} (good).`, 'info');
}

function moveAgentCluster(agentIds, from, to) {
  const agents = state.agents.filter(agent => agentIds.includes(agent.id) && agent.alive);
  if (!agents.length) return;

  agents.forEach(agent => {
    agent.pos = to;
  });
  state.currentNode = to;
  markCurrentNode(to);
  const labels = agents.map(agent => `A${agent.id}`).join(', ');
  addLog(`Cluster release: ${labels} move ${from}->${to} together.`, 'safe');
}

function loseAgentToBlackHole(agentId, from, to) {
  const agent = state.agents.find(a => a.id === agentId);
  if (!agent || !agent.alive) return;
  agent.alive = false;
  agent.status = 'dead';
  agent.pos = to;
  state.lostInBH++;
  state.currentNode = from;
  markCurrentNode(from);
  addLog(`A${agent.id} enters ${from}->${to} and is lost in the black hole (${state.lostInBH}/${state.f + 1}).`, 'danger');
}

function completeOperation(op) {
  if (op.failed) return 'failed';

  const { from, to, classify, label } = op.step;
  const key = edgeKey(from, to);
  const cyEdge = getCyEdge(from, to);

  if (op.step.kind === 'move') {
    state.currentNode = to;
    markCurrentNode(to);
    cyEdge.removeClass('probing');
    return 'complete';
  }

  if (!op.probe) {
    cyEdge.removeClass('probing');
    return op.failed ? 'failed' : 'complete';
  }

  if (op.probe.phase === 'advance-safe') {
    state.currentNode = to;
    markCurrentNode(to);
    cyEdge.removeClass('probing');
    return 'complete';
  }

  recordProbeEvidence(op);

  const returned = op.probe.returned.size;
  const missing = op.probe.missing.size;
  const threshold = 1; // No byzantine agents, 1 confirmation is enough.

  addLog(`CCP evidence on (${from}->${to}): ${returned}/${threshold} returned, ${missing}/${threshold} did not return.`, 'system');

  if (returned >= threshold) {
    if (classify && state.edgeStatus[key] === 'unknown') {
      state.edgeStatus[key] = 'safe';
      state.safeNodes.add(from);
      state.safeNodes.add(to);
      state.visitedNodes.add(to);
      cyEdge.addClass('safe');
      cy2.getElementById(`n${to}`).addClass('safe');
      cy2.getElementById(`n${from}`).addClass('safe');
      addLog(`${label}: port (${from}->${to}) certified SAFE after ${returned} distinct return(s).`, 'safe');
    }

    return scheduleSafeAdvance(op);
  }

  if (missing >= threshold) {
    state.found = true;
    state.bhLocated = true;
    state.currentNode = from;
    markPortDangerous(from, to, `CCP on port (${from}->${to}) certified DANGEROUS after ${missing} distinct non-return(s).`);

    return 'complete';
  }

  return scheduleSoloProbe(op);
}

function shouldFinish() {
  if (state.currentOperation) return false;
  if (state.know === 'unknown') return allEdgesClassified() || state.traversalIndex >= state.traversalOrder.length;
  return state.traversalIndex >= state.traversalOrder.length || state.bhLocated;
}

function finishWasSuccessful() {
  if (state.know === 'unknown') return state.bhLocated && allEdgesClassified();
  return state.bhLocated;
}

function allEdgesClassified() {
  return Object.values(state.edgeStatus).every(status => status !== 'unknown');
}

function progressPercent() {
  if (state.know === 'unknown') {
    const classified = Object.values(state.edgeStatus).filter(status => status !== 'unknown').length;
    return Math.min(100, classified / state.edges.length * 100);
  }

  if (state.traversalOrder.length === 0) return 100;
  const opFraction = state.currentOperation
    ? state.currentOperation.index / state.currentOperation.actions.length
    : 0;
  return Math.min(100, (state.traversalIndex + opFraction) / state.traversalOrder.length * 100);
}

// --- End of copied logic ---

function installEventHandlers() {
  q('sim2BuildBtn').addEventListener('click', buildSim2);
  q('sim2ResetBtn').addEventListener('click', resetSim2);
  q('sim2RunBtn').addEventListener('click', toggleRunSim2);
  q('sim2StepBtn').addEventListener('click', stepSim2);

  q('sim2SpeedSel').addEventListener('change', () => {
    if (state.intervalId) {
      clearInterval(state.intervalId);
      state.intervalId = setInterval(stepSim2, Number(q('sim2SpeedSel').value));
    }
  });

  q('sim2nNodes').addEventListener('input', () => { q('sim2nVal').textContent = q('sim2nNodes').value; updateFormula2(); });
  q('sim2fFault').addEventListener('input', () => { q('sim2fVal').textContent = q('sim2fFault').value; updateFormula2(); });
  q('sim2BhDeception').addEventListener('input', () => { q('sim2BhDeceptionVal').textContent = `${q('sim2BhDeception').value}%`; });
  q('sim2TopoKnow').addEventListener('change', updateFormula2);
  q('sim2CommModel').addEventListener('change', updateFormula2);

  q('sim2nNodes').addEventListener('change', buildSim2);
  q('sim2fFault').addEventListener('change', buildSim2);
  q('sim2TopoSelect').addEventListener('change', buildSim2);
  q('sim2TopoKnow').addEventListener('change', buildSim2);
  q('sim2CommModel').addEventListener('change', buildSim2);

  q('overlay2CloseBtn').addEventListener('click', () => q('overlay2').className = '');
  document.querySelectorAll('#sim2Status .tab').forEach(tab => {
    tab.addEventListener('click', () => switchSim2Tab(tab.dataset.tab));
  });
}

function switchSim2Tab(tabName) {
  document.querySelectorAll('#sim2Status .tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('#sim2Status .tab').forEach(el => el.classList.remove('active'));
  q(`sim2-tab-${tabName}`).classList.add('active');
  document.querySelector(`#sim2Status .tab[data-tab="${tabName}"]`).classList.add('active');
}

window.switchSimulation = switchSimulation;

(function initializeSim2() {
  if (!q('cy2')) return;
  installEventHandlers();
  buildSim2();
  updateSimulationIndicator(q('sim2Select').value || 'sim1');
}());
