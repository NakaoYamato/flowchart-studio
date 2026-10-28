/**************************************************************
 * state.js : プロジェクトデータ・クラス継承・GUIメンバ解析・自動リサイズ
 **************************************************************/
const GRID_SIZE = 24;
const snapToGrid = (val) => Math.round(val / GRID_SIZE) * GRID_SIZE;
const uid = (prefix) => `${prefix}_${Math.random().toString(36).substring(2, 9)}`;
const CLASS_LAYER_ID = "class_diagram";

const ACCESS_SYMBOLS = {
  public: "+",
  private: "-",
  protected: "#"
};
const ACCESS_ORDER = ["public", "private", "protected"];

function formatClassField(f) {
  const sym = ACCESS_SYMBOLS[f.access] || "+";
  const mName = (f.memberName || "").trim() || "field";
  const mType = (f.dataType || "").trim();
  return mType ? `${sym} ${mName}: ${mType}` : `${sym} ${mName}`;
}

function formatClassMethod(m) {
  const sym = ACCESS_SYMBOLS[m.access] || "+";
  const mName = (m.memberName || "").trim() || "Method";
  const mArgs = (m.args || "").trim();
  const mType = (m.returnType || "").trim();
  return mType ? `${sym} ${mName}(${mArgs}): ${mType}` : `${sym} ${mName}(${mArgs})`;
}

// キャンバス上のインライン編集で入力されたテキスト (例: "hp: int" や "Attack(power: int): void") を構造化データに反映する関数
function parseInlineMemberText(item, rawInput, isMethod = false) {
  let str = (rawInput || "").trim();
  if (str.startsWith("+")) { item.access = "public"; str = str.slice(1).trim(); }
  else if (str.startsWith("-")) { item.access = "private"; str = str.slice(1).trim(); }
  else if (str.startsWith("#")) { item.access = "protected"; str = str.slice(1).trim(); }

  if (isMethod) {
    const match = str.match(/^([^\(\:]+)(?:\(([^\)]*)\))?\s*(?::\s*(.*))?$/);
    if (match) {
      item.memberName = (match[1] || "Method").trim();
      if (match[2] !== undefined) item.args = match[2].trim();
      if (match[3] !== undefined && match[3].trim() !== "") item.returnType = match[3].trim();
    } else {
      item.memberName = str || "Method";
    }
    item.name = formatClassMethod(item);
  } else {
    const parts = str.split(":");
    item.memberName = (parts[0] || "field").trim();
    if (parts.length > 1) {
      item.dataType = parts.slice(1).join(":").trim() || "int";
    }
    item.name = formatClassField(item);
  }
  return item;
}

function normalizeClassMember(item, isMethod = false) {
  if (item.memberName !== undefined) {
    if (!item.access) item.access = "public";
    item.name = isMethod ? formatClassMethod(item) : formatClassField(item);
    return item;
  }
  item.access = "public";
  item.memberName = isMethod ? "Method" : "value";
  item.args = "";
  item.returnType = "void";
  item.dataType = "int";
  return parseInlineMemberText(item, item.name || "", isMethod);
}

// クラス内の変数・関数の数に合わせてクラスノードの高さが不足しないよう自動調整
function autoAdjustClassNodeHeight(node) {
  if (!node || node.type !== 'class') return;
  const fCount = Array.isArray(node.fields) ? node.fields.length : 0;
  const mCount = Array.isArray(node.methods) ? node.methods.length : 0;
  const requiredH = 36 + 26 + Math.max(1, fCount) * 24 + 26 + Math.max(1, mCount) * 24 + 28;
  const snappedReq = snapToGrid(requiredH + 12);
  if (node.height < snappedReq) {
    node.height = snappedReq;
  }
}

function createEmptyProject(projectId) {
  return {
    projectId: projectId,
    currentLayerId: "root",
    tags: [
      { id: "tag_sys", name: "システム", color: "#93c5fd" },
      { id: "tag_ui",  name: "UI/演出",  color: "#86efac" },
      { id: "tag_imp", name: "重要仕様", color: "#fca5a5" }
    ],
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
            textAlign: "center", tags: [],
            parentGroupId: null, childLayerId: null, locked: false, isParentProxy: false,
            linkTargetNodeId: null, linkTargetLayerId: null, linkTargetMethodId: null
          }
        ],
        edges: []
      },
      [CLASS_LAYER_ID]: {
        id: CLASS_LAYER_ID,
        name: "🧩 クラス図",
        isClassDiagram: true,
        parentLayerId: null,
        parentNodeId: null,
        nodes: [
          {
            id: "cls_base",
            type: "class",
            text: "ActorBase",
            x: 240, y: 48, width: 264, height: 168,
            color: "#f3e8ff", fontSize: 13, fontFamily: "'Consolas', 'Meiryo', monospace",
            textAlign: "left", tags: [],
            fields: [
              normalizeClassMember({ id: "fld_b1", access: "protected", memberName: "id", dataType: "int" }, false)
            ],
            methods: [
              normalizeClassMember({ id: "mtd_b1", access: "public", memberName: "Init", args: "", returnType: "void" }, true)
            ],
            parentGroupId: null, childLayerId: null, locked: false, isParentProxy: false,
            linkTargetNodeId: null, linkTargetLayerId: null, linkTargetMethodId: null
          },
          {
            id: "cls_sample",
            type: "class",
            text: "PlayerCard",
            x: 240, y: 288, width: 264, height: 192,
            color: "#f3e8ff", fontSize: 13, fontFamily: "'Consolas', 'Meiryo', monospace",
            textAlign: "left", tags: [],
            fields: [
              normalizeClassMember({ id: "fld_1", access: "private", memberName: "power", dataType: "int" }, false)
            ],
            methods: [
              normalizeClassMember({ id: "mtd_1", access: "public", memberName: "Attack", args: "target: ActorBase", returnType: "void" }, true)
            ],
            parentGroupId: null, childLayerId: null, locked: false, isParentProxy: false,
            linkTargetNodeId: null, linkTargetLayerId: null, linkTargetMethodId: null
          }
        ],
        edges: [
          {
            id: "cls_edge_inherit",
            source: "cls_sample",
            sourcePort: "top",
            target: "cls_base",
            targetPort: "bottom",
            relationType: "inheritance",
            label: "extends",
            color: "#475569"
          }
        ]
      }
    }
  };
}

let projectData = createEmptyProject("demo_project_01");

function ensureProjectStructure(data) {
  if (!Array.isArray(data.tags)) {
    data.tags = [
      { id: "tag_sys", name: "システム", color: "#93c5fd" },
      { id: "tag_ui",  name: "UI/演出",  color: "#86efac" },
      { id: "tag_imp", name: "重要仕様", color: "#fca5a5" }
    ];
  }
  if (!data.layers) data.layers = {};
  if (!data.layers[CLASS_LAYER_ID]) {
    data.layers[CLASS_LAYER_ID] = {
      id: CLASS_LAYER_ID,
      name: "🧩 クラス図",
      isClassDiagram: true,
      parentLayerId: null,
      parentNodeId: null,
      nodes: [],
      edges: []
    };
  }
  Object.values(data.layers).forEach(layer => {
    (layer.nodes || []).forEach(n => {
      if (!Array.isArray(n.tags)) n.tags = [];
      if (n.tags.length > 1) n.tags = [n.tags[0]];
      if (n.type === 'class') {
        if (!Array.isArray(n.fields)) n.fields = [];
        if (!Array.isArray(n.methods)) n.methods = [];
        n.fields.forEach(f => normalizeClassMember(f, false));
        n.methods.forEach(m => normalizeClassMember(m, true));
        autoAdjustClassNodeHeight(n);
      }
    });
    (layer.edges || []).forEach(e => {
      if (!e.relationType) e.relationType = 'normal';
    });
  });
}

function getNodeActiveTag(node) {
  if (!node || !Array.isArray(node.tags) || node.tags.length === 0) return null;
  const tagId = node.tags[0];
  return (projectData.tags || []).find(t => t.id === tagId) || null;
}

function getEffectiveNodeColor(node) {
  const activeTag = getNodeActiveTag(node);
  if (activeTag) return activeTag.color;
  if (node.color) return node.color;
  if (node.type === 'container') return '#e2e8f0';
  if (node.type === 'memo') return '#fef08a';
  if (node.type === 'class') return '#f3e8ff';
  return '#dbeafe';
}

function isNodeLocked(node) {
  return Boolean(node && (node.locked || node.isParentProxy));
}

const currentLayer = () => projectData.layers[projectData.currentLayerId] || projectData.layers["root"];
const isClassMode = () => projectData.currentLayerId === CLASS_LAYER_ID;

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
  ensureProjectStructure(projectData);
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
  ensureProjectStructure(projectData);
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
let lastFlowLayerId = "root";
let selectedNodeIds = new Set();
let selectedEdgeId = null;
let hoveredNodeId = null;
let highlightedNodeId = null;
let highlightedMethodId = null;
let clipboardData = null;

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
let lastCanvasClickTime = 0;
let lastCanvasClickPos = { x: 0, y: 0 };

// インライン文字編集の対象管理（通常ノード名 or クラス内メンバ）
let editingNodeId = null;
let editingMemberSpec = null; // { nodeId, kind: 'field'|'method', memberId }

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
const nearbyPicker = document.getElementById('nearby-picker');
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

function hideNearbyPicker() {
  nearbyPicker.style.display = 'none';
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

  // 関数が存在する場合のみ安全に呼び出す
  if (typeof updateMiniToolbarPosition === 'function') {
    updateMiniToolbarPosition();
  }
}

/* --- 幾何・アンカー・検索・逆参照ヘルパー --- */
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

function distanceToEdgeCurve(layer, edge, px, py) {
  const src = layer.nodes.find(n => n.id === edge.source);
  const tgt = layer.nodes.find(n => n.id === edge.target);
  if (!src || !tgt) return Infinity;

  const p1 = getPortCoords(src, edge.sourcePort);
  const p2 = getPortCoords(tgt, edge.targetPort);
  const dist = Math.max(40, Math.hypot(p2.x - p1.x, p2.y - p1.y) * 0.45);
  const offset = (p) => {
    if (p === 'top') return { dx: 0, dy: -dist };
    if (p === 'bottom') return { dx: 0, dy: dist };
    if (p === 'left') return { dx: -dist, dy: 0 };
    return { dx: dist, dy: 0 };
  };
  const o1 = offset(edge.sourcePort), o2 = offset(edge.targetPort);
  const c1x = p1.x + o1.dx, c1y = p1.y + o1.dy;
  const c2x = p2.x + o2.dx, c2y = p2.y + o2.dy;

  let minD = Infinity;
  const steps = 24;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const mt = 1 - t;
    const bx = mt*mt*mt*p1.x + 3*mt*mt*t*c1x + 3*mt*t*t*c2x + t*t*t*p2.x;
    const by = mt*mt*mt*p1.y + 3*mt*mt*t*c1y + 3*mt*t*t*c2y + t*t*t*p2.y;
    const d = Math.hypot(px - bx, py - by);
    if (d < minD) minD = d;
  }
  return minD;
}

function distanceToNodeRect(node, px, py) {
  const dx = Math.max(node.x - px, 0, px - (node.x + node.width));
  const dy = Math.max(node.y - py, 0, py - (node.y + node.height));
  return Math.hypot(dx, dy);
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

function findBacklinksToNode(targetNodeId) {
  const backlinks = [];
  if (!targetNodeId) return backlinks;
  Object.values(projectData.layers).forEach(layer => {
    (layer.nodes || []).forEach(n => {
      if (n.linkTargetNodeId === targetNodeId) {
        backlinks.push({
          sourceNode: n,
          sourceLayer: layer,
          targetMethodId: n.linkTargetMethodId || null
        });
      }
    });
  });
  return backlinks;
}

function ensureParentProxyNode(layer) {
  if (!layer || layer.isClassDiagram || !layer.parentLayerId || !layer.parentNodeId) return;
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
      tags: Array.isArray(parentNode.tags) ? [...parentNode.tags] : [],
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
    proxy.tags = Array.isArray(parentNode.tags) ? [...parentNode.tags] : [];
    proxy.locked = true;
    proxy.isParentProxy = true;
  }
}