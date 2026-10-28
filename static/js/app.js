/**************************************************************
 * app.js : クラス爆速編集・プロジェクトメニュー・右クリック防止対応
 **************************************************************/

document.getElementById('btn-mode-flow').addEventListener('click', () => {
  if (isClassMode()) {
    switchLayer(lastFlowLayerId || 'root');
  }
});
document.getElementById('btn-mode-class').addEventListener('click', () => {
  if (!isClassMode()) {
    lastFlowLayerId = projectData.currentLayerId;
    switchLayer(CLASS_LAYER_ID);
  }
});

/* --- プロジェクト▼ドロップダウンメニューの開閉制御 --- */
const projectMenuBtn = document.getElementById('btn-project-menu');
const projectDropdownContent = document.getElementById('project-dropdown-content');

projectMenuBtn.addEventListener('click', (ev) => {
  ev.stopPropagation();
  projectDropdownContent.classList.toggle('show');
});

window.addEventListener('click', () => {
  if (projectDropdownContent.classList.contains('show')) {
    projectDropdownContent.classList.remove('show');
  }
});

projectDropdownContent.addEventListener('mousedown', (ev) => ev.stopPropagation());

/* ドロップダウン内のボタンに既存機能を割り当て */
document.getElementById('btn-open-modal').addEventListener('click', () => {
  projectDropdownContent.classList.remove('show');
  projectModal.classList.add('open');
  fetchProjectList();
});
document.getElementById('btn-copy-url').addEventListener('click', () => {
  projectDropdownContent.classList.remove('show');
  navigator.clipboard.writeText(window.location.href).then(() => {
    showToast('プロジェクト専用URLをコピーしました！');
  });
});
document.getElementById('btn-cloud-save').addEventListener('click', () => {
  projectDropdownContent.classList.remove('show');
  saveCurrentProject();
});
document.getElementById('btn-open-json-modal').addEventListener('click', () => {
  projectDropdownContent.classList.remove('show');
  aiJsonTextarea.value = JSON.stringify(projectData, null, 2);
  aiJsonModal.classList.add('open');
});
document.getElementById('btn-open-ai-assist').addEventListener('click', () => {
  projectDropdownContent.classList.remove('show');
  const layer = currentLayer();
  document.getElementById('ai-target-layer-name').textContent = layer.name || layer.id;
  aiAssistModal.classList.add('open');
  aiPromptInput.focus();
});

/* --- タグ管理 --- */
function renderProjectTagManager() {
  const container = document.getElementById('project-tag-list');
  if (document.activeElement && document.activeElement.classList.contains('tag-manage-name-input')) {
    return;
  }
  container.innerHTML = '';
  (projectData.tags || []).forEach(tag => {
    const row = document.createElement('div');
    row.className = 'tag-manage-item';
    row.innerHTML = `
      <input type="color" value="${tag.color}" title="タグの色（塗りつぶし色）を変更">
      <input type="text" class="tag-manage-name-input" value="${tag.name}" title="クリックしてタグ名を編集">
      <button class="btn btn-danger" style="padding:1px 5px; font-size:10px;" title="タグを削除">✕</button>
    `;
    const colorInput = row.querySelector('input[type="color"]');
    const nameInput = row.querySelector('.tag-manage-name-input');

    colorInput.addEventListener('change', (ev) => {
      recordHistory();
      tag.color = ev.target.value;
      render();
    });
    colorInput.addEventListener('input', (ev) => {
      tag.color = ev.target.value;
      render();
    });

    nameInput.addEventListener('change', (ev) => {
      const newName = ev.target.value.trim();
      if (!newName) {
        ev.target.value = tag.name;
        return;
      }
      recordHistory();
      tag.name = newName;
      render();
      showToast(`🏷️ タグ名を「${newName}」に変更しました（Ctrl+Sで保存）`);
    });
    nameInput.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        nameInput.blur();
      }
    });

    row.querySelector('button').addEventListener('click', () => {
      recordHistory();
      projectData.tags = projectData.tags.filter(t => t.id !== tag.id);
      Object.values(projectData.layers).forEach(l => {
        l.nodes.forEach(n => {
          if (Array.isArray(n.tags)) n.tags = n.tags.filter(id => id !== tag.id);
        });
      });
      render();
    });
    container.appendChild(row);
  });
}

document.getElementById('btn-create-tag').addEventListener('click', () => {
  const nameInput = document.getElementById('new-tag-name');
  const colorInput = document.getElementById('new-tag-color');
  const name = nameInput.value.trim();
  if (!name) return showToast('タグ名を入力してください');
  recordHistory();
  projectData.tags.push({
    id: uid('tag'),
    name,
    color: colorInput.value || '#93c5fd'
  });
  nameInput.value = '';
  render();
  showToast(`🏷️ タグ「${name}」を作成しました（Ctrl+SでDB保存）`);
});

/* --- キャンバス上のクラスノード内での追加 --- */
function quickAddClassMemberOnCanvas(classNode, kind) {
  recordHistory();
  selectedNodeIds.clear();
  selectedNodeIds.add(classNode.id);
  selectedEdgeId = null;

  let newMember;
  if (kind === 'field') {
    if (!Array.isArray(classNode.fields)) classNode.fields = [];
    const idx = classNode.fields.length + 1;
    newMember = normalizeClassMember({
      id: uid('fld'),
      access: 'private',
      memberName: `value${idx}`,
      dataType: 'int'
    }, false);
    classNode.fields.push(newMember);
  } else {
    if (!Array.isArray(classNode.methods)) classNode.methods = [];
    const idx = classNode.methods.length + 1;
    newMember = normalizeClassMember({
      id: uid('mtd'),
      access: 'public',
      memberName: `Method${idx}`,
      args: '',
      returnType: 'void'
    }, true);
    classNode.methods.push(newMember);
  }

  autoAdjustClassNodeHeight(classNode);
  pendingFocusSelector = `input[data-member-name="${newMember.id}"]`;
  render();
}

// 親クラスから子クラスを派生
function spawnChildClassFromParent(parentNode) {
  recordHistory();
  const layer = currentLayer();
  const w = parentNode.width || 276;
  const h = 192;
  const childX = snapToGrid(parentNode.x);
  const childY = snapToGrid(parentNode.y + parentNode.height + 72);

  const childNode = {
    id: uid('cls'),
    type: 'class',
    text: `${parentNode.text || 'Base'}Child`,
    x: childX,
    y: childY,
    width: w,
    height: h,
    color: parentNode.color || '#f3e8ff',
    fontSize: parentNode.fontSize || 13,
    fontFamily: parentNode.fontFamily || "'Consolas', 'Meiryo', monospace",
    textAlign: 'left',
    tags: Array.isArray(parentNode.tags) && parentNode.tags.length > 0 ? [parentNode.tags[0]] : [],
    fields: [],
    methods: [],
    parentGroupId: parentNode.parentGroupId || null,
    childLayerId: null,
    locked: false,
    isParentProxy: false,
    linkTargetNodeId: null,
    linkTargetLayerId: null,
    linkTargetMethodId: null
  };

  layer.nodes.push(childNode);
  layer.edges.push({
    id: uid('edge'),
    source: childNode.id,
    sourcePort: 'top',
    target: parentNode.id,
    targetPort: 'bottom',
    relationType: 'inheritance',
    label: 'extends',
    color: '#475569'
  });

  selectedNodeIds.clear();
  selectedNodeIds.add(childNode.id);
  selectedEdgeId = null;
  pendingFocusSelector = `input[data-cls-title="${childNode.id}"]`;
  render();
  showToast(`🧬 「${parentNode.text}」を継承する子クラスを生成しました`);
}

document.getElementById('btn-spawn-child-class').addEventListener('click', () => {
  const layer = currentLayer();
  const cls = layer.nodes.find(n => selectedNodeIds.has(n.id) && n.type === 'class');
  if (cls) spawnChildClassFromParent(cls);
});

function serializeClassToBulkText(classNode) {
  const lines = [classNode.text || 'ClassName', '---'];
  (classNode.fields || []).forEach(f => {
    normalizeClassMember(f, false);
    lines.push(formatClassField(f));
  });
  lines.push('---');
  (classNode.methods || []).forEach(m => {
    normalizeClassMember(m, true);
    lines.push(formatClassMethod(m));
  });
  return lines.join('\n');
}

function applyBulkTextToClassNode(classNode, rawText) {
  const lines = rawText.split(/\r?\n/);
  const newFields = [];
  const newMethods = [];
  let oldFieldIdx = 0;
  let oldMethodIdx = 0;
  let section = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (line.startsWith('---') || line.startsWith('===')) {
      section++;
      continue;
    }
    if (section === 0 && i === 0 && !line.startsWith('+') && !line.startsWith('-') && !line.startsWith('#') && !line.includes(':') && !line.includes('(')) {
      classNode.text = line;
      section = 1;
      continue;
    }

    const isMethod = line.includes('(');
    if (isMethod) {
      const existing = (classNode.methods || [])[oldMethodIdx++];
      const mObj = existing ? { ...existing } : { id: uid('mtd'), access: 'public', memberName: 'Method', args: '', returnType: 'void' };
      parseInlineMemberText(mObj, line, true);
      newMethods.push(mObj);
    } else {
      const existing = (classNode.fields || [])[oldFieldIdx++];
      const fObj = existing ? { ...existing } : { id: uid('fld'), access: 'private', memberName: 'field', dataType: 'int' };
      parseInlineMemberText(fObj, line, false);
      newFields.push(fObj);
    }
  }

  classNode.fields = newFields;
  classNode.methods = newMethods;
  autoAdjustClassNodeHeight(classNode);
}

function exportClassCode(classNode, lang = 'csharp') {
  const layer = currentLayer();
  const inheritEdge = layer.edges.find(e => e.source === classNode.id && e.relationType === 'inheritance');
  const parentCls = inheritEdge ? layer.nodes.find(n => n.id === inheritEdge.target) : null;
  const parentName = parentCls ? parentCls.text : '';

  const clsName = (classNode.text || 'MyClass').replace(/\s+/g, '');
  let code = '';

  if (lang === 'csharp') {
    const ext = parentName ? ` : ${parentName}` : '';
    code += `public class ${clsName}${ext}\n{\n`;
    (classNode.fields || []).forEach(f => {
      normalizeClassMember(f, false);
      code += `    ${f.access || 'private'} ${f.dataType || 'int'} ${f.memberName};\n`;
    });
    if ((classNode.fields || []).length > 0 && (classNode.methods || []).length > 0) code += `\n`;
    (classNode.methods || []).forEach(m => {
      normalizeClassMember(m, true);
      code += `    ${m.access || 'public'} ${m.returnType || 'void'} ${m.memberName}(${m.args || ''})\n    {\n    }\n`;
    });
    code += `}\n`;
  } else {
    const ext = parentName ? ` : public ${parentName}` : '';
    code += `#pragma once\n\nclass ${clsName}${ext}\n{\n`;
    ['public', 'protected', 'private'].forEach(acc => {
      const fList = (classNode.fields || []).filter(f => (f.access || 'private') === acc);
      const mList = (classNode.methods || []).filter(m => (m.access || 'public') === acc);
      if (fList.length === 0 && mList.length === 0) return;
      code += `${acc}:\n`;
      fList.forEach(f => {
        code += `    ${f.dataType || 'int'} ${f.memberName};\n`;
      });
      mList.forEach(m => {
        code += `    ${m.returnType || 'void'} ${m.memberName}(${m.args || ''});\n`;
      });
    });
    code += `};\n`;
  }

  navigator.clipboard.writeText(code).then(() => {
    showToast(`💻 ${lang === 'csharp' ? 'C#' : 'C++ (.h)'} のクラスコードをコピーしました！`);
  });
}

document.getElementById('btn-export-csharp').addEventListener('click', () => {
  const cls = currentLayer().nodes.find(n => selectedNodeIds.has(n.id) && n.type === 'class');
  if (cls) exportClassCode(cls, 'csharp');
});
document.getElementById('btn-export-cpp').addEventListener('click', () => {
  const cls = currentLayer().nodes.find(n => selectedNodeIds.has(n.id) && n.type === 'class');
  if (cls) exportClassCode(cls, 'cpp');
});

/* --- 周辺オブジェクト選択 --- */
function findNearbyObjects(worldX, worldY, radius = 90) {
  const layer = currentLayer();
  const results = [];

  layer.edges.forEach((e) => {
    const d = distanceToEdgeCurve(layer, e, worldX, worldY);
    if (d <= radius) {
      const src = layer.nodes.find(n => n.id === e.source);
      const tgt = layer.nodes.find(n => n.id === e.target);
      const sName = src ? (src.text || src.id).slice(0, 10) : '?';
      const tName = tgt ? (tgt.text || tgt.id).slice(0, 10) : '?';
      const prefix = e.relationType === 'inheritance' ? '▷ 継承' : '↗ 矢印';
      results.push({
        kind: 'edge',
        id: e.id,
        dist: Math.round(d),
        label: `${prefix}: ${sName} ➔ ${tName}${e.label ? ` (${e.label})` : ''}`
      });
    }
  });

  layer.nodes.forEach(n => {
    const d = distanceToNodeRect(n, worldX, worldY);
    if (d <= radius) {
      const icon = n.type === 'container' ? '📦' : (n.type === 'memo' ? '📝' : (n.type === 'class' ? '🧩' : '🟦'));
      const title = n.text ? n.text.slice(0, 16) : `(無題:${n.id})`;
      results.push({
        kind: 'node',
        id: n.id,
        dist: Math.round(d),
        label: `${icon} ${title}`
      });
    }
  });

  results.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'edge' ? -1 : 1;
    return a.dist - b.dist;
  });
  return results;
}

function openNearbyPicker(clientX, clientY, items, doubleClickedNode = null) {
  const rect = svg.getBoundingClientRect();
  const listEl = document.getElementById('nearby-list');
  listEl.innerHTML = '';

  if (doubleClickedNode && !isNodeLocked(doubleClickedNode)) {
    const editRow = document.createElement('div');
    editRow.className = 'nearby-item';
    editRow.style.borderLeft = '3px solid #10b981';
    editRow.innerHTML = `<span>✏️ 「${(doubleClickedNode.text || 'この要素').slice(0, 12)}」の名前を編集</span>`;
    editRow.addEventListener('click', () => {
      hideNearbyPicker();
      startInlineEdit(doubleClickedNode);
    });
    listEl.appendChild(editRow);
  }

  items.forEach(item => {
    const row = document.createElement('div');
    row.className = 'nearby-item';
    row.innerHTML = `
      <span>${item.label}</span>
      <span style="font-size:10px; color:#9ca3af;">${item.dist}px</span>
    `;
    row.addEventListener('click', () => {
      hideNearbyPicker();
      if (item.kind === 'edge') {
        selectedNodeIds.clear();
        selectedEdgeId = item.id;
        showToast('↗ 矢印を選択しました');
      } else {
        selectedEdgeId = null;
        selectedNodeIds.clear();
        selectedNodeIds.add(item.id);
        showToast('要素を選択しました');
      }
      render();
    });
    listEl.appendChild(row);
  });

  nearbyPicker.style.display = 'flex';
  const left = Math.min(rect.width - 260, Math.max(8, clientX - rect.left));
  const top = Math.min(rect.height - 240, Math.max(8, clientY - rect.top));
  nearbyPicker.style.left = `${left}px`;
  nearbyPicker.style.top = `${top}px`;
}

document.getElementById('btn-close-nearby').addEventListener('click', hideNearbyPicker);
nearbyPicker.addEventListener('mousedown', (ev) => ev.stopPropagation());

/* --- プラスマークから生成したときそのままテキスト入力を開始 --- */
function spawnConnectedNode(sourceNode, sourcePort, dropX, dropY, isClickOnly = false) {
  const layer = currentLayer();
  const inClass = isClassMode();
  const w = inClass ? 276 : (sourceNode.type === 'rect' ? sourceNode.width : 192);
  const h = inClass ? 192 : (sourceNode.type === 'rect' ? sourceNode.height : 84);
  let pos;

  if (isClickOnly) {
    const gap = 96;
    if (sourcePort === 'right') pos = { x: sourceNode.x + sourceNode.width + gap, y: sourceNode.y + (sourceNode.height - h) / 2 };
    else if (sourcePort === 'left') pos = { x: sourceNode.x - w - gap, y: sourceNode.y + (sourceNode.height - h) / 2 };
    else if (sourcePort === 'bottom') pos = { x: sourceNode.x + (sourceNode.width - w) / 2, y: sourceNode.y + sourceNode.height + gap };
    else pos = { x: sourceNode.x + (sourceNode.width - w) / 2, y: sourceNode.y - h - gap };
  } else {
    pos = computeNewNodePosFromCursor(dropX, dropY, sourcePort, w, h);
  }

  const newNode = {
    id: uid(inClass ? 'cls' : 'node'),
    type: inClass ? 'class' : 'rect',
    text: inClass ? 'NewClass' : '',
    x: snapToGrid(pos.x),
    y: snapToGrid(pos.y),
    width: w,
    height: h,
    color: inClass ? '#f3e8ff' : (sourceNode.isParentProxy ? '#dbeafe' : (sourceNode.color || '#dbeafe')),
    fontSize: sourceNode.fontSize || (inClass ? 13 : 14),
    fontFamily: sourceNode.fontFamily || (inClass ? "'Consolas', 'Meiryo', monospace" : "'Segoe UI', 'Meiryo', sans-serif"),
    textAlign: sourceNode.textAlign || (inClass ? 'left' : 'center'),
    tags: Array.isArray(sourceNode.tags) && sourceNode.tags.length > 0 ? [sourceNode.tags[0]] : [],
    fields: inClass ? [] : undefined,
    methods: inClass ? [] : undefined,
    parentGroupId: null,
    childLayerId: null,
    locked: false,
    isParentProxy: false,
    linkTargetNodeId: null,
    linkTargetLayerId: null,
    linkTargetMethodId: null
  };

  const containers = layer.nodes.filter(n => n.type === 'container');
  const cx = newNode.x + newNode.width / 2;
  const cy = newNode.y + newNode.height / 2;
  const hitCont = containers.find(c => cx >= c.x && cx <= c.x + c.width && cy >= c.y && cy <= c.y + c.height);
  if (hitCont) newNode.parentGroupId = hitCont.id;

  layer.nodes.push(newNode);

  const targetPort = getOppositePort(sourcePort);
  if (inClass && sourceNode.type === 'class') {
    layer.edges.push({
      id: uid('edge'),
      source: newNode.id,
      sourcePort: targetPort,
      target: sourceNode.id,
      targetPort: sourcePort,
      relationType: 'inheritance',
      label: 'extends',
      color: '#475569'
    });
    pendingFocusSelector = `input[data-cls-title="${newNode.id}"]`;
  } else {
    layer.edges.push({
      id: uid('edge'),
      source: sourceNode.id,
      sourcePort: sourcePort,
      target: newNode.id,
      targetPort: targetPort,
      relationType: 'normal',
      label: '',
      color: '#475569'
    });
    // フローチャートの場合は生成後に即座にテキスト編集を起動
    pendingFocusSelector = null;
  }

  selectedNodeIds.clear();
  selectedNodeIds.add(newNode.id);
  selectedEdgeId = null;
  render();

  // フローチャートの矩形の場合はインライン編集を直接トリガー
  if (!inClass && newNode.type === 'rect') {
    startInlineEdit(newNode);
  }

  showToast('✨ 新規要素を生成して矢印を接続しました');
}

function insertNodeBetweenEdge(edgeId) {
  const layer = currentLayer();
  const edgeIdx = layer.edges.findIndex(e => e.id === edgeId);
  if (edgeIdx === -1) return;
  const edge = layer.edges[edgeIdx];

  const srcNode = layer.nodes.find(n => n.id === edge.source);
  const tgtNode = layer.nodes.find(n => n.id === edge.target);
  if (!srcNode || !tgtNode) return;

  recordHistory();

  const inClass = isClassMode();
  const w = inClass ? 276 : (srcNode.type === 'rect' ? srcNode.width : 192);
  const h = inClass ? 192 : (srcNode.type === 'rect' ? srcNode.height : 84);
  const p1 = getPortCoords(srcNode, edge.sourcePort);
  const p2 = getPortCoords(tgtNode, edge.targetPort);
  const midX = (p1.x + p2.x) / 2;
  const midY = (p1.y + p2.y) / 2;

  const newNode = {
    id: uid(inClass ? 'cls' : 'node'),
    type: inClass ? 'class' : 'rect',
    text: inClass ? 'MiddleClass' : '',
    x: snapToGrid(midX - w / 2),
    y: snapToGrid(midY - h / 2),
    width: w,
    height: h,
    color: srcNode.isParentProxy ? '#dbeafe' : (srcNode.color || (inClass ? '#f3e8ff' : '#dbeafe')),
    fontSize: srcNode.fontSize || (inClass ? 13 : 14),
    fontFamily: srcNode.fontFamily || (inClass ? "'Consolas', 'Meiryo', monospace" : "'Segoe UI', 'Meiryo', sans-serif"),
    textAlign: srcNode.textAlign || (inClass ? 'left' : 'center'),
    tags: Array.isArray(srcNode.tags) && srcNode.tags.length > 0 ? [srcNode.tags[0]] : [],
    fields: inClass ? [] : undefined,
    methods: inClass ? [] : undefined,
    parentGroupId: srcNode.parentGroupId || null,
    childLayerId: null,
    locked: false,
    isParentProxy: false,
    linkTargetNodeId: null,
    linkTargetLayerId: null,
    linkTargetMethodId: null
  };

  layer.nodes.push(newNode);

  const inPort = getOppositePort(edge.sourcePort);
  const outPort = edge.sourcePort;

  const edge1 = {
    id: uid('edge'),
    source: edge.source,
    sourcePort: edge.sourcePort,
    target: newNode.id,
    targetPort: inPort,
    relationType: edge.relationType || 'normal',
    label: edge.label || '',
    color: edge.color || '#475569'
  };
  const edge2 = {
    id: uid('edge'),
    source: newNode.id,
    sourcePort: outPort,
    target: edge.target,
    targetPort: edge.targetPort,
    relationType: edge.relationType || 'normal',
    label: '',
    color: edge.color || '#475569'
  };

  layer.edges.splice(edgeIdx, 1, edge1, edge2);

  layer.nodes.forEach(n => {
    if (n.type === 'memo' && n.parentObjectType === 'edge' && n.parentObjectId === edge.id) {
      n.parentObjectId = edge1.id;
    }
  });

  selectedEdgeId = null;
  selectedNodeIds.clear();
  selectedNodeIds.add(newNode.id);
  render();
  if (!inClass) startInlineEdit(newNode);
  showToast('➕ 矢印の間に要素を生成しました');
}

/* --- 右クリックのブラウザポップアップを完全防止 --- */
window.addEventListener('contextmenu', (ev) => {
  ev.preventDefault();
});

svg.addEventListener('mousedown', (ev) => {
  commitInlineEdit();
  hideContextMenu();
  hideNearbyPicker();

  if (ev.button === 2 || ev.button === 1) {
    ev.preventDefault();
    mode = 'pan';
    rightClickPanMoved = false;
    dragStartScreen = { x: ev.clientX, y: ev.clientY };
    initialPan = { x: panX, y: panY };
    return;
  }

  if (ev.button === 0) {
    const now = Date.now();
    const clickDist = Math.hypot(ev.clientX - lastCanvasClickPos.x, ev.clientY - lastCanvasClickPos.y);
    if ((now - lastCanvasClickTime) < 360 && clickDist < 16) {
      lastCanvasClickTime = 0;
      const worldPt = screenToWorld(ev.clientX, ev.clientY);
      const nearby = findNearbyObjects(worldPt.x, worldPt.y, 95);
      if (nearby.length > 0) {
        openNearbyPicker(ev.clientX, ev.clientY, nearby, null);
        return;
      }
    }
    lastCanvasClickTime = now;
    lastCanvasClickPos = { x: ev.clientX, y: ev.clientY };

    if (!ev.shiftKey) {
      selectedNodeIds.clear();
      selectedEdgeId = null;
    }
    mode = 'marquee';
    dragStartWorld = screenToWorld(ev.clientX, ev.clientY);
    marqueeRect = { x: dragStartWorld.x, y: dragStartWorld.y, w: 0, h: 0 };
    render();
  }
});

window.addEventListener('mousemove', (ev) => {
  if (mode === 'none') return;

  if (mode === 'pan') {
    const dist = Math.hypot(ev.clientX - dragStartScreen.x, ev.clientY - dragStartScreen.y);
    if (dist >= 5) {
      rightClickPanMoved = true;
      svg.classList.add('panning');
    }
    if (rightClickPanMoved) {
      panX = initialPan.x + (ev.clientX - dragStartScreen.x);
      panY = initialPan.y + (ev.clientY - dragStartScreen.y);
      updateViewportTransform();
    }
    return;
  }

  const pt = screenToWorld(ev.clientX, ev.clientY);
  const layer = currentLayer();

  if (mode === 'dragNodes') {
    let dx = pt.x - dragStartWorld.x;
    let dy = pt.y - dragStartWorld.y;

    if (ev.shiftKey && primaryDragNodeId && initialNodeStates.has(primaryDragNodeId)) {
      snapIndicator.style.display = 'block';
      const primaryInit = initialNodeStates.get(primaryDragNodeId);
      const snappedX = snapToGrid(primaryInit.x + dx);
      const snappedY = snapToGrid(primaryInit.y + dy);
      dx = snappedX - primaryInit.x;
      dy = snappedY - primaryInit.y;
    } else {
      snapIndicator.style.display = 'none';
    }

    initialNodeStates.forEach((init, id) => {
      const n = layer.nodes.find(item => item.id === id);
      if (n && !isNodeLocked(n)) {
        n.x = Math.round(init.x + dx);
        n.y = Math.round(init.y + dy);
      }
    });
    render();
  } else if (mode === 'resize' && activeResize) {
    const n = layer.nodes.find(item => item.id === activeResize.nodeId);
    const init = initialNodeStates.get(activeResize.nodeId);
    if (n && init && !isNodeLocked(n)) {
      const dx = pt.x - dragStartWorld.x;
      const dy = pt.y - dragStartWorld.y;
      const minW = 72, minH = 48;
      const d = activeResize.dir;
      const useSnap = ev.shiftKey;
      snapIndicator.style.display = useSnap ? 'block' : 'none';

      if (d.includes('e')) {
        const rawW = init.width + dx;
        n.width = Math.max(minW, useSnap ? snapToGrid(rawW) : Math.round(rawW));
      }
      if (d.includes('s')) {
        const rawH = init.height + dy;
        n.height = Math.max(minH, useSnap ? snapToGrid(rawH) : Math.round(rawH));
      }
      if (d.includes('w')) {
        const rawW = init.width - dx;
        const newW = Math.max(minW, useSnap ? snapToGrid(rawW) : Math.round(rawW));
        n.x = init.x + (init.width - newW);
        n.width = newW;
      }
      if (d.includes('n')) {
        const rawH = init.height - dy;
        const newH = Math.max(minH, useSnap ? snapToGrid(rawH) : Math.round(rawH));
        n.y = init.y + (init.height - newH);
        n.height = newH;
      }
      render();
    }
  } else if ((mode === 'connect' || mode === 'quickCreate') && activeConnect) {
    activeConnect.currentX = ev.shiftKey ? snapToGrid(pt.x) : pt.x;
    activeConnect.currentY = ev.shiftKey ? snapToGrid(pt.y) : pt.y;
    render();
  } else if (mode === 'marquee') {
    const x = Math.min(dragStartWorld.x, pt.x);
    const y = Math.min(dragStartWorld.y, pt.y);
    const w = Math.abs(pt.x - dragStartWorld.x);
    const h = Math.abs(pt.y - dragStartWorld.y);
    marqueeRect = { x, y, w, h };

    selectedNodeIds.clear();
    layer.nodes.forEach(n => {
      const intersects = !(
        n.x > x + w ||
        n.x + n.width < x ||
        n.y > y + h ||
        n.y + n.height < y
      );
      if (intersects) selectedNodeIds.add(n.id);
    });
    render();
  }
});

function openContextMenuAt(clientX, clientY) {
  const rect = svg.getBoundingClientRect();
  contextMenuWorldPos = screenToWorld(clientX, clientY);

  const inClass = isClassMode();
  document.getElementById('ctx-add-rect').style.display = inClass ? 'none' : 'flex';
  document.getElementById('ctx-add-class').style.display = inClass ? 'flex' : 'none';

  const hasSelection = (selectedNodeIds.size === 1 || selectedEdgeId !== null);
  document.getElementById('ctx-child-divider').style.display = hasSelection ? 'block' : 'none';
  document.getElementById('ctx-add-child-memo').style.display = hasSelection ? 'flex' : 'none';
  document.getElementById('ctx-insert-on-edge').style.display = selectedEdgeId ? 'flex' : 'none';

  contextMenu.style.display = 'flex';
  const menuW = 220, menuH = 200;
  const left = Math.min(rect.width - menuW - 8, Math.max(8, clientX - rect.left));
  const top = Math.min(rect.height - menuH - 8, Math.max(8, clientY - rect.top));
  contextMenu.style.left = `${left}px`;
  contextMenu.style.top = `${top}px`;
}

window.addEventListener('mouseup', (ev) => {
  if (mode === 'none') return;
  const layer = currentLayer();
  snapIndicator.style.display = 'none';

  if (mode === 'pan') {
    svg.classList.remove('panning');
    if (ev.button === 2 && !rightClickPanMoved) {
      openContextMenuAt(ev.clientX, ev.clientY);
    }
  } else if (mode === 'dragNodes') {
    let moved = false;
    initialNodeStates.forEach((init, id) => {
      const n = layer.nodes.find(item => item.id === id);
      if (n && (n.x !== init.x || n.y !== init.y)) moved = true;
    });

    const containers = layer.nodes.filter(n => n.type === 'container');
    selectedNodeIds.forEach(id => {
      const node = layer.nodes.find(n => n.id === id);
      if (node && node.type !== 'container' && !isNodeLocked(node)) {
        const cx = node.x + node.width / 2;
        const cy = node.y + node.height / 2;
        const hitCont = containers.find(c =>
          cx >= c.x && cx <= c.x + c.width && cy >= c.y && cy <= c.y + c.height
        );
        node.parentGroupId = hitCont ? hitCont.id : null;

        if (node.type === 'memo' && node.parentObjectType && node.parentObjectId) {
          const anchor = getParentAnchorPoint(layer, node.parentObjectType, node.parentObjectId);
          if (anchor) {
            node.offsetX = node.x - anchor.x;
            node.offsetY = node.y - anchor.y;
          }
        }
      }
    });

    if (moved && dragSnapshotBefore) {
      recordHistory(dragSnapshotBefore);
    }
    dragSnapshotBefore = null;
  } else if (mode === 'resize' && activeResize) {
    if (dragSnapshotBefore) {
      recordHistory(dragSnapshotBefore);
    }
    dragSnapshotBefore = null;
  } else if ((mode === 'connect' || mode === 'quickCreate') && activeConnect) {
    const pt = screenToWorld(ev.clientX, ev.clientY);
    const srcNode = layer.nodes.find(n => n.id === activeConnect.sourceId);

    const target = layer.nodes.find(n =>
      n.id !== activeConnect.sourceId &&
      n.type !== 'memo' &&
      pt.x >= n.x - 16 && pt.x <= n.x + n.width + 16 &&
      pt.y >= n.y - 16 && pt.y <= n.y + n.height + 16
    );

    if (target && mode === 'connect') {
      recordHistory();
      const targetPort = detectClosestPort(target, pt.x, pt.y);
      const isClassInherit = (isClassMode() && srcNode && srcNode.type === 'class' && target.type === 'class');
      layer.edges.push({
        id: uid('edge'),
        source: activeConnect.sourceId,
        sourcePort: activeConnect.sourcePort,
        target: target.id,
        targetPort,
        relationType: isClassInherit ? 'inheritance' : 'normal',
        label: isClassInherit ? 'extends' : '',
        color: '#475569'
      });
    } else if (srcNode) {
      const dragDist = Math.hypot(pt.x - dragStartWorld.x, pt.y - dragStartWorld.y);
      if (mode === 'quickCreate') {
        recordHistory();
        const isClickOnly = dragDist < 18;
        spawnConnectedNode(srcNode, activeConnect.sourcePort, activeConnect.currentX, activeConnect.currentY, isClickOnly);
      } else if (mode === 'connect') {
        const p1 = getPortCoords(srcNode, activeConnect.sourcePort);
        if (Math.hypot(pt.x - p1.x, pt.y - p1.y) > 45) {
          recordHistory();
          spawnConnectedNode(srcNode, activeConnect.sourcePort, pt.x, pt.y, false);
        }
      }
    }
    activeConnect = null;
  }

  mode = 'none';
  primaryDragNodeId = null;
  activeResize = null;
  marqueeRect = null;
  render();
});

/* --- 左右パネルのトグルボタン動作（サブバー移動対応） --- */
const leftPanel = document.getElementById('left-panel');
const rightPanel = document.getElementById('right-panel');
const leftResizer = document.getElementById('left-resizer');
const rightResizer = document.getElementById('right-resizer');

document.getElementById('btn-toggle-left').addEventListener('click', () => {
  leftPanel.classList.toggle('hidden');
  leftResizer.classList.toggle('hidden');
});
document.getElementById('btn-toggle-right').addEventListener('click', () => {
  rightPanel.classList.toggle('hidden');
  rightResizer.classList.toggle('hidden');
});