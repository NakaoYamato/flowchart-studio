/**************************************************************
 * state.js : プロジェクトデータ・エディタ状態・Undo/Redo履歴・座標計算
 **************************************************************/
const GRID_SIZE = 24;
const snapToGrid = (val) => Math.round(val / GRID_SIZE) * GRID_SIZE;
const uid = (prefix) => `${prefix}_${Math.random().toString(36).substring(2, 9)}`;

function createEmptyProject(projectId) {
  return {
    projectId: projectId,
    currentLayerId: "root",
    layers: {
      "root": {
        id: "root",
        name: "メイン画面",
        parentLayerId: null,
        parentNodeId: null,
        nodes: [
          {
            id: "node_start", type: "rect", text: "",
            x: 240, y: 144, width: 192, height: 84,
            color: "#dbeafe", fontSize: 14, fontFamily: "'Segoe UI', 'Meiryo', sans-serif",
            textAlign: "center",
            parentGroupId: null, childLayerId: null, locked: false, isParentProxy: false,
            linkTargetNodeId: null, linkTargetLayerId: null
          }
        ],
        edges: []
      }
    }
  };
}

let projectData = createEmptyProject("demo_project_01");

function isNodeLocked(node) {
  return Boolean(node && (node.locked || node.isParentProxy));
}

const currentLayer = () => projectData.layers[projectData.currentLayerId] || projectData.layers["root"];

/* --- Undo / Redo 履歴管理 --- */
const MAX_HISTORY = 60;
let undoStack = [];
let redoStack = [];
let dragSnapshotBefore = null;

function cloneState(data) {
  return JSON.parse(JSON.stringify(data));
}

function clearHistory() {
  undoStack = [];
  redoStack = [];
  updateUndoRedoButtons();
}

function recordHistory(customBeforeState = null) {
  const stateToPush = customBeforeState || cloneState(projectData);
  if (undoStack.length > 0 && JSON.stringify(undoStack[undoStack.length - 1]) === JSON.stringify(stateToPush)) {
    return;
  }
  undoStack.push(stateToPush);
  if (undoStack.length > MAX_HISTORY) undoStack.shift();
  redoStack = [];
  updateUndoRedoButtons();
}

function performUndo() {
  commitInlineEdit();
  if (undoStack.length === 0) {
    showToast('これ以上元に戻せません');
    return;
  }
  redoStack.push(cloneState(projectData));
  projectData = undoStack.pop();
  selectedNodeIds.clear();
  selectedEdgeId = null;
  updateUndoRedoButtons();
  render();
  showToast('↶ 元に戻しました (Undo)');
}

function performRedo() {
  commitInlineEdit();
  if (redoStack.length === 0) {
    showToast('これ以上やり直せません');
    return;
  }
  undoStack.push(cloneState(projectData));
  projectData = redoStack.pop();
  selectedNodeIds.clear();
  selectedEdgeId = null;
  updateUndoRedoButtons();
  render();
  showToast('↷ やり直しました (Redo)');
}

function updateUndoRedoButtons() {
  document.getElementById('btn-undo').disabled = (undoStack.length === 0);
  document.getElementById('btn-redo').disabled = (redoStack.length === 0);
}

/* --- エディタ操作状態 & DOM参照 --- */
let panX = 0, panY = 0, zoom = 1;
let selectedNodeIds = new Set();
let selectedEdgeId = null;
let hoveredNodeId = null;
let highlightedNodeId = null;
let clipboardData = null;

// mode: 'none' | 'pan' | 'dragNodes' | 'resize' | 'connect' | 'quickCreate' | 'marquee'
let mode = 'none';
let primaryDragNodeId = null;
let dragStartScreen = { x: 0, y: 0 };
let dragStartWorld = { x: 0, y: 0 };
let initialPan = { x: 0, y: 0 };
let rightClickPanMoved = false;
let contextMenuWorldPos = { x: 200, y: 150 };
let initialNodeStates = new Map();
let activeResize = null;
let activeConnect = null;
let marqueeRect = null;

let lastClickInfo = { id: null, time: 0 };
let editingNodeId = null;

const svg = document.getElementById('canvas-svg');
const viewport = document.getElementById('viewport');
const gridPattern = document.getElementById('grid-pattern');
const containersLayer = document.getElementById('containers-layer');
const memoTethersLayer = document.getElementById('memo-tethers-layer');
const edgesLayer = document.getElementById('edges-layer');
const nodesLayer = document.getElementById('nodes-layer');
const memosLayer = document.getElementById('memos-layer');
const uiLayer = document.getElementById('ui-layer');
const miniToolbar = document.getElementById('mini-toolbar');
const contextMenu = document.getElementById('context-menu');
const inlineEditor = document.getElementById('inline-editor');
const projectModal = document.getElementById('project-modal');
const snapIndicator = document.getElementById('snap-indicator');

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => t.classList.remove('show'), 2500);
}

function hideContextMenu() {
  contextMenu.style.display = 'none';
}

function updateProjectHeaderAndUrl(projectId, pushHistory = true) {
  projectData.projectId = projectId;
  const labelEl = document.getElementById('current-project-label');
  labelEl.textContent = projectId;
  labelEl.parentElement.title = `プロジェクト: ${projectId}`;
  document.title = `${projectId} - FlowHierarchy Studio`;

  if (pushHistory) {
    const targetPath = `/p/${encodeURIComponent(projectId)}`;
    if (window.location.pathname !== targetPath) {
      window.history.pushState({ projectId }, '', targetPath);
    }
    window.history.pushState({ projectId, guard: true }, '', targetPath);
  }
}

function screenToWorld(clientX, clientY) {
  const rect = svg.getBoundingClientRect();
  return {
    x: (clientX - rect.left - panX) / zoom,
    y: (clientY - rect.top - panY) / zoom
  };
}

function updateViewportTransform() {
  viewport.setAttribute('transform', `translate(${panX}, ${panY}) scale(${zoom})`);
  gridPattern.setAttribute('patternTransform', `translate(${panX}, ${panY}) scale(${zoom})`);
  updateMiniToolbarPosition();
}

/* --- 幾何・アンカー・検索ヘルパー --- */
function getPortCoords(node, port) {
  switch (port) {
    case 'top': return { x: node.x + node.width / 2, y: node.y };
    case 'right': return { x: node.x + node.width, y: node.y + node.height / 2 };
    case 'bottom': return { x: node.x + node.width / 2, y: node.y + node.height };
    case 'left': default: return { x: node.x, y: node.y + node.height / 2 };
  }
}

function getOppositePort(port) {
  if (port === 'top') return 'bottom';
  if (port === 'bottom') return 'top';
  if (port === 'left') return 'right';
  return 'left';
}

function computeNewNodePosFromCursor(cx, cy, sourcePort, w = 192, h = 84) {
  if (sourcePort === 'right') return { x: Math.round(cx), y: Math.round(cy - h / 2) };
  if (sourcePort === 'left')  return { x: Math.round(cx - w), y: Math.round(cy - h / 2) };
  if (sourcePort === 'bottom') return { x: Math.round(cx - w / 2), y: Math.round(cy) };
  return { x: Math.round(cx - w / 2), y: Math.round(cy - h) };
}

function computeCurvePath(x1, y1, x2, y2, p1, p2) {
  const dist = Math.max(40, Math.hypot(x2 - x1, y2 - y1) * 0.45);
  const offset = (p) => {
    if (p === 'top') return { dx: 0, dy: -dist };
    if (p === 'bottom') return { dx: 0, dy: dist };
    if (p === 'left') return { dx: -dist, dy: 0 };
    return { dx: dist, dy: 0 };
  };
  const o1 = offset(p1), o2 = offset(p2);
  return `M ${x1} ${y1} C ${x1 + o1.dx} ${y1 + o1.dy}, ${x2 + o2.dx} ${y2 + o2.dy}, ${x2} ${y2}`;
}

function getEdgeMidpoint(layer, edge) {
  const src = layer.nodes.find(n => n.id === edge.source);
  const tgt = layer.nodes.find(n => n.id === edge.target);
  if (!src || !tgt) return null;
  const p1 = getPortCoords(src, edge.sourcePort);
  const p2 = getPortCoords(tgt, edge.targetPort);
  return { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
}

function getParentAnchorPoint(layer, parentType, parentId) {
  if (parentType === 'node') {
    const pNode = layer.nodes.find(n => n.id === parentId);
    if (!pNode) return null;
    return { x: pNode.x + pNode.width / 2, y: pNode.y + pNode.height / 2 };
  } else if (parentType === 'edge') {
    const pEdge = layer.edges.find(e => e.id === parentId);
    if (!pEdge) return null;
    return getEdgeMidpoint(layer, pEdge);
  }
  return null;
}

function findNodeAcrossProject(targetNodeId) {
  if (!targetNodeId) return null;
  for (const layer of Object.values(projectData.layers)) {
    const found = layer.nodes.find(n => n.id === targetNodeId);
    if (found) return { node: found, layer };
  }
  return null;
}

function ensureParentProxyNode(layer) {
  if (!layer || !layer.parentLayerId || !layer.parentNodeId) return;
  const parentLayer = projectData.layers[layer.parentLayerId];
  if (!parentLayer) return;
  const parentNode = parentLayer.nodes.find(n => n.id === layer.parentNodeId);
  if (!parentNode) return;

  let proxy = layer.nodes.find(n => n.isParentProxy);
  if (!proxy) {
    proxy = {
      id: `parent_proxy_${layer.id}`,
      type: 'rect',
      text: parentNode.text || '',
      x: 240,
      y: 48,
      width: Math.max(192, parentNode.width || 192),
      height: parentNode.height || 84,
      color: parentNode.color || '#dbeafe',
      fontSize: parentNode.fontSize || 14,
      fontFamily: parentNode.fontFamily || "'Segoe UI', 'Meiryo', sans-serif",
      textAlign: parentNode.textAlign || 'center',
      parentGroupId: null,
      childLayerId: null,
      locked: true,
      isParentProxy: true
    };
    layer.nodes.unshift(proxy);
  } else {
    proxy.text = parentNode.text || '';
    proxy.color = parentNode.color || '#dbeafe';
    proxy.fontFamily = parentNode.fontFamily || "'Segoe UI', 'Meiryo', sans-serif";
    proxy.locked = true;
    proxy.isParentProxy = true;
  }
}