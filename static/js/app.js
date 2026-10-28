/**************************************************************
 * app.js : 全機能完全統合版
 * (プロジェクトメニュー・テキスト編集優先・＋から即入力・階層Undo・AI連携・自動整列)
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

if (projectMenuBtn && projectDropdownContent) {
  projectMenuBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    projectDropdownContent.classList.toggle('show');
  });

  window.addEventListener('click', () => {
    projectDropdownContent.classList.remove('show');
  });

  projectDropdownContent.addEventListener('mousedown', (ev) => ev.stopPropagation());
}

/* --- タグ管理 --- */
function renderProjectTagManager() {
  const container = document.getElementById('project-tag-list');
  if (!container) return;
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

/* --- キャンバス上のクラスノード内で「＋変数」「＋関数」を追加 --- */
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

/* --- テキスト一括編集 ＆ C#/C++コード出力 --- */
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

/* --- ダブルクリック時の「周辺オブジェクト選択ポップアップ」 --- */
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

/* --- 矢印の間への要素生成 --- */
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
  if (!inClass && newNode.type === 'rect') {
    setTimeout(() => startInlineEdit(newNode), 10);
  }
  showToast('➕ 矢印の間に要素を生成しました');
}

/* --- マウスイベント・右クリックブラウザポップアップ完全防止 --- */
window.addEventListener('contextmenu', (ev) => {
  if (ev.target && ['INPUT', 'TEXTAREA'].includes(ev.target.tagName)) return;
  ev.preventDefault();
}, true);

window.addEventListener('mousedown', (ev) => {
  if (ev.button === 3) {
    ev.preventDefault();
    ev.stopPropagation();
    performUndo();
  } else if (ev.button === 4) {
    ev.preventDefault();
    ev.stopPropagation();
    performRedo();
  }
}, true);

window.addEventListener('mouseup', (ev) => {
  if (ev.button === 3 || ev.button === 4) {
    ev.preventDefault();
    ev.stopPropagation();
  }
}, true);

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
      } else {
        showToast('この周辺（半径95px以内）にオブジェクトはありません');
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

/* --- プラスマーク（またはドラッグ接続）から要素を生成し、すぐテキスト編集を開始 --- */
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
    text: inClass ? 'ChildClass' : '',
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
  }

  selectedNodeIds.clear();
  selectedNodeIds.add(newNode.id);
  selectedEdgeId = null;
  showToast(inClass ? '🧬 派生クラスを生成し、継承(▷)で接続しました' : '✨ 新規矩形を生成しました（そのまま文字を入力できます）');
  return newNode;
}

window.addEventListener('mouseup', (ev) => {
  if (mode === 'none') return;
  const layer = currentLayer();
  snapIndicator.style.display = 'none';
  let autoEditNode = null;

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
        autoEditNode = spawnConnectedNode(srcNode, activeConnect.sourcePort, activeConnect.currentX, activeConnect.currentY, isClickOnly);
      } else if (mode === 'connect') {
        const p1 = getPortCoords(srcNode, activeConnect.sourcePort);
        if (Math.hypot(pt.x - p1.x, pt.y - p1.y) > 45) {
          recordHistory();
          autoEditNode = spawnConnectedNode(srcNode, activeConnect.sourcePort, pt.x, pt.y, false);
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

  // プラスマーク等で新しい矩形が生成されたら即座にテキスト入力を起動
  if (autoEditNode && autoEditNode.type === 'rect') {
    startInlineEdit(autoEditNode);
  }
});

function detectClosestPort(node, x, y) {
  const candidates = ['top', 'right', 'bottom', 'left'].map(k => {
    const c = getPortCoords(node, k);
    return { key: k, dist: Math.hypot(c.x - x, c.y - y) };
  });
  candidates.sort((a, b) => a.dist - b.dist);
  return candidates[0].key;
}

svg.addEventListener('wheel', (ev) => {
  ev.preventDefault();
  commitInlineEdit();
  hideContextMenu();
  hideNearbyPicker();
  const factor = ev.deltaY < 0 ? 1.1 : 0.9;
  const newZoom = Math.min(2.8, Math.max(0.25, zoom * factor));
  const rect = svg.getBoundingClientRect();
  const mx = ev.clientX - rect.left;
  const my = ev.clientY - rect.top;

  panX = mx - (mx - panX) * (newZoom / zoom);
  panY = my - (my - panY) * (newZoom / zoom);
  zoom = newZoom;
  updateViewportTransform();
}, { passive: false });

/* --- インライン編集・ミニツールバー --- */
miniToolbar.addEventListener('mousedown', (ev) => ev.stopPropagation());
contextMenu.addEventListener('mousedown', (ev) => ev.stopPropagation());
inlineEditor.addEventListener('mousedown', (ev) => ev.stopPropagation());

function toggleLockSelection() {
  const layer = currentLayer();
  const targetNodes = layer.nodes.filter(n => selectedNodeIds.has(n.id) && !n.isParentProxy);
  if (targetNodes.length === 0) {
    showToast('ロックを切り替える要素を選択してください');
    return;
  }
  recordHistory();
  const anyUnlocked = targetNodes.some(n => !n.locked);
  targetNodes.forEach(n => n.locked = anyUnlocked);
  render();
  showToast(anyUnlocked ? '🔒 選択要素をロックしました' : '🔓 ロックを解除しました');
}

function startInlineEdit(node) {
  if (!node || isNodeLocked(node)) return;
  if (node.type === 'class') {
    pendingFocusSelector = `input[data-cls-title="${node.id}"]`;
    render();
    return;
  }
  editingNodeId = node.id;
  editingMemberSpec = null;
  selectedNodeIds.clear();
  selectedNodeIds.add(node.id);
  render();

  inlineEditor.style.display = 'block';
  inlineEditor.style.left = `${ panX + node.x * zoom }px`;
  inlineEditor.style.top = `${ panY + node.y * zoom }px`;
  inlineEditor.style.width = `${ node.width * zoom }px`;
  const editH = node.type === 'container' ? 34 : node.height;
  inlineEditor.style.height = `${ editH * zoom }px`;
  inlineEditor.style.fontSize = `${ (node.fontSize || 14) * zoom }px`;
  inlineEditor.style.fontFamily = node.fontFamily || "'Segoe UI', 'Meiryo', sans-serif";
  inlineEditor.style.textAlign = node.textAlign || (node.type === 'memo' ? 'left' : 'center');
  inlineEditor.value = node.text || '';
  inlineEditor.focus();
  inlineEditor.select();
}

function commitInlineEdit() {
  if (!editingNodeId) return;
  const node = currentLayer().nodes.find(n => n.id === editingNodeId);

  if (node && !isNodeLocked(node)) {
    if (node.text !== inlineEditor.value) {
      recordHistory();
      node.text = inlineEditor.value;
      if (node.childLayerId && projectData.layers[node.childLayerId]) {
        projectData.layers[node.childLayerId].name = node.text || '無題の階層';
      }
    }
  }

  editingNodeId = null;
  editingMemberSpec = null;
  inlineEditor.style.display = 'none';
  render();
}

inlineEditor.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter' && !ev.shiftKey) {
    ev.preventDefault();
    commitInlineEdit();
  } else if (ev.key === 'Escape') {
    editingNodeId = null;
    editingMemberSpec = null;
    inlineEditor.style.display = 'none';
    render();
  }
});

function setTextAlignment(align) {
  applyToSelectedNodes(n => n.textAlign = align, true);
}

function updateMiniToolbarPosition() {
  const layer = currentLayer();
  if (!layer || !miniToolbar) return;
  const selectedNodes = layer.nodes.filter(n => selectedNodeIds.has(n.id));
  if (selectedNodes.length === 0) {
    miniToolbar.style.display = 'none';
    return;
  }

  const minX = Math.min(...selectedNodes.map(n => n.x));
  const maxX = Math.max(...selectedNodes.map(n => n.x + n.width));
  const minY = Math.min(...selectedNodes.map(n => n.y));

  const centerX = ((minX + maxX) / 2) * zoom + panX;
  const topY = minY * zoom + panY - 18;

  miniToolbar.style.display = 'flex';
  miniToolbar.style.left = `${centerX}px`;
  miniToolbar.style.top = `${Math.max(48, topY)}px`;

  const first = selectedNodes[0];
  const allLocked = selectedNodes.every(n => isNodeLocked(n));
  const anyHasTag = selectedNodes.some(n => getNodeActiveTag(n) !== null);
  const lockBtn = document.getElementById('mt-lock');
  lockBtn.textContent = allLocked ? '🔒' : '🔓';
  lockBtn.className = allLocked ? 'btn btn-warning' : 'btn';
  lockBtn.disabled = selectedNodes.every(n => n.isParentProxy);

  document.getElementById('mt-font').value = first.fontFamily || "'Segoe UI', 'Meiryo', sans-serif";
  document.getElementById('mt-font-slider').value = first.fontSize || 14;
  document.getElementById('mt-font-val').textContent = `${first.fontSize || 14}px`;

  const mtColor = document.getElementById('mt-color');
  mtColor.value = getEffectiveNodeColor(first);
  mtColor.disabled = allLocked || anyHasTag;
  mtColor.title = anyHasTag ? 'タグの色が適用されています（タグ解除で自由変更可）' : '塗りつぶし色を変更';

  const curAlign = first.textAlign || (first.type === 'memo' ? 'left' : 'center');
  ['left', 'center', 'right'].forEach(a => {
    document.getElementById(`mt-align-${a}`).classList.toggle('active', curAlign === a);
  });
}

function applyToSelectedNodes(fn, shouldRecord = true) {
  const layer = currentLayer();
  const editable = layer.nodes.filter(n => selectedNodeIds.has(n.id) && !isNodeLocked(n));
  if (editable.length === 0) {
    showToast('🔒 ロック中のため変更できません');
    return;
  }
  if (shouldRecord) recordHistory();
  editable.forEach(n => fn(n));
  render();
}

document.getElementById('mt-lock').addEventListener('click', toggleLockSelection);
document.getElementById('prop-lock-btn').addEventListener('click', toggleLockSelection);

document.getElementById('mt-align-left').addEventListener('click', () => setTextAlignment('left'));
document.getElementById('mt-align-center').addEventListener('click', () => setTextAlignment('center'));
document.getElementById('mt-align-right').addEventListener('click', () => setTextAlignment('right'));
document.getElementById('prop-align-left').addEventListener('click', () => setTextAlignment('left'));
document.getElementById('prop-align-center').addEventListener('click', () => setTextAlignment('center'));
document.getElementById('prop-align-right').addEventListener('click', () => setTextAlignment('right'));

document.getElementById('mt-font').addEventListener('change', (e) => applyToSelectedNodes(n => n.fontFamily = e.target.value));
document.getElementById('mt-font-slider').addEventListener('change', (e) => applyToSelectedNodes(n => n.fontSize = parseInt(e.target.value, 10)));
document.getElementById('mt-font-slider').addEventListener('input', (e) => applyToSelectedNodes(n => n.fontSize = parseInt(e.target.value, 10), false));
document.getElementById('mt-font-dec').addEventListener('click', () => applyToSelectedNodes(n => n.fontSize = Math.max(8, (n.fontSize || 14) - 2)));
document.getElementById('mt-font-inc').addEventListener('click', () => applyToSelectedNodes(n => n.fontSize = Math.min(72, (n.fontSize || 14) + 2)));
document.getElementById('mt-color').addEventListener('change', (e) => {
  applyToSelectedNodes(n => {
    if (!getNodeActiveTag(n)) n.color = e.target.value;
  }, true);
});
document.getElementById('mt-color').addEventListener('input', (e) => {
  applyToSelectedNodes(n => {
    if (!getNodeActiveTag(n)) n.color = e.target.value;
  }, false);
});
document.getElementById('mt-add-child-memo').addEventListener('click', () => addChildMemoToCurrentSelection());
document.getElementById('mt-copy').addEventListener('click', () => { copySelection(); pasteSelection(); });
document.getElementById('mt-del').addEventListener('click', () => deleteSelection());

/* --- コピー・貼り付け・削除・ショートカット --- */
function deepCloneLayer(sourceLayerId, newParentLayerId, newParentNodeId) {
  const orig = projectData.layers[sourceLayerId];
  if (!orig) return null;
  const newLayerId = uid('layer');
  const idMap = new Map();

  const clonedNodes = orig.nodes.map(n => {
    const newId = n.isParentProxy ? `parent_proxy_${newLayerId}` : uid(n.type === 'container' ? 'cont' : (n.type === 'memo' ? 'memo' : 'node'));
    idMap.set(n.id, newId);
    return { ...JSON.parse(JSON.stringify(n)), id: newId };
  });

  clonedNodes.forEach(n => {
    if (n.parentGroupId && idMap.has(n.parentGroupId)) {
      n.parentGroupId = idMap.get(n.parentGroupId);
    }
    if (n.parentObjectType === 'node' && n.parentObjectId && idMap.has(n.parentObjectId)) {
      n.parentObjectId = idMap.get(n.parentObjectId);
    }
    if (n.childLayerId) {
      n.childLayerId = deepCloneLayer(n.childLayerId, newLayerId, n.id);
    }
  });

  const clonedEdges = orig.edges.map(e => ({
    ...JSON.parse(JSON.stringify(e)),
    id: uid('edge'),
    source: idMap.get(e.source) || e.source,
    target: idMap.get(e.target) || e.target
  }));

  projectData.layers[newLayerId] = {
    id: newLayerId,
    name: orig.name,
    parentLayerId: newParentLayerId,
    parentNodeId: newParentNodeId,
    nodes: clonedNodes,
    edges: clonedEdges
  };
  return newLayerId;
}

function copySelection() {
  const layer = currentLayer();
  if (selectedNodeIds.size === 0) return;

  const targetIds = new Set();
  selectedNodeIds.forEach(id => {
    const n = layer.nodes.find(item => item.id === id);
    if (n && !n.isParentProxy) {
      targetIds.add(n.id);
      if (n.type === 'container') {
        layer.nodes.filter(ch => ch.parentGroupId === n.id && !ch.isParentProxy).forEach(ch => targetIds.add(ch.id));
      }
      layer.nodes.filter(m => m.type === 'memo' && m.parentObjectType === 'node' && m.parentObjectId === n.id)
        .forEach(m => targetIds.add(m.id));
    }
  });

  const nodesToCopy = layer.nodes.filter(n => targetIds.has(n.id));
  if (nodesToCopy.length === 0) return showToast('親階層アンカーノードはコピーできません');
  const edgesToCopy = layer.edges.filter(e => targetIds.has(e.source) && targetIds.has(e.target));

  clipboardData = {
    nodes: JSON.parse(JSON.stringify(nodesToCopy)),
    edges: JSON.parse(JSON.stringify(edgesToCopy))
  };
  showToast(`${nodesToCopy.length}個の要素をコピーしました`);
}

function pasteSelection(customBasePos = null) {
  if (!clipboardData || clipboardData.nodes.length === 0) return;
  recordHistory();
  const layer = currentLayer();
  const idMap = new Map();
  const newSelected = new Set();

  const minX = Math.min(...clipboardData.nodes.map(n => n.x));
  const minY = Math.min(...clipboardData.nodes.map(n => n.y));
  const offsetX = customBasePos ? snapToGrid(customBasePos.x - minX) : GRID_SIZE;
  const offsetY = customBasePos ? snapToGrid(customBasePos.y - minY) : GRID_SIZE;

  const newNodes = clipboardData.nodes.map(n => {
    const newId = uid(n.type === 'container' ? 'cont' : (n.type === 'memo' ? 'memo' : (n.type === 'class' ? 'cls' : 'node')));
    idMap.set(n.id, newId);
    newSelected.add(newId);
    return {
      ...JSON.parse(JSON.stringify(n)),
      id: newId,
      x: n.x + offsetX,
      y: n.y + offsetY,
      isParentProxy: false
    };
  });

  newNodes.forEach(n => {
    if (n.parentGroupId) {
      n.parentGroupId = idMap.get(n.parentGroupId) || n.parentGroupId;
    }
    if (n.parentObjectType === 'node' && n.parentObjectId) {
      n.parentObjectId = idMap.get(n.parentObjectId) || n.parentObjectId;
    }
    if (n.childLayerId && projectData.layers[n.childLayerId]) {
      n.childLayerId = deepCloneLayer(n.childLayerId, layer.id, n.id);
    }
    layer.nodes.push(n);
  });

  clipboardData.edges.forEach(e => {
    if (idMap.has(e.source) && idMap.has(e.target)) {
      layer.edges.push({
        ...JSON.parse(JSON.stringify(e)),
        id: uid('edge'),
        source: idMap.get(e.source),
        target: idMap.get(e.target)
      });
    }
  });

  selectedNodeIds = newSelected;
  render();
  showToast('貼り付けました');
}

function deleteSelection() {
  const layer = currentLayer();
  if (selectedNodeIds.size > 0) {
    const deletableIds = new Set(
      [...selectedNodeIds].filter(id => {
        const n = layer.nodes.find(item => item.id === id);
        return n && !isNodeLocked(n);
      })
    );
    if (deletableIds.size === 0) {
      showToast('🔒 ロック中（または親階層ノード）のため削除できません');
      return;
    }
    recordHistory();
    layer.nodes = layer.nodes.filter(n => !deletableIds.has(n.id));
    layer.edges = layer.edges.filter(e => !deletableIds.has(e.source) && !deletableIds.has(e.target));
    selectedNodeIds.clear();
    render();
  } else if (selectedEdgeId) {
    const edge = layer.edges.find(e => e.id === selectedEdgeId);
    if (edge && edge.locked) {
      showToast('🔒 矢印がロックされているため削除できません');
      return;
    }
    recordHistory();
    layer.edges = layer.edges.filter(e => e.id !== selectedEdgeId);
    selectedEdgeId = null;
    render();
  }
}

window.addEventListener('keydown', (ev) => {
  const key = ev.key.toLowerCase();

  if ((ev.ctrlKey || ev.metaKey) && key === 's') {
    ev.preventDefault();
    commitInlineEdit();
    saveCurrentProject();
    return;
  }

  if (editingNodeId || ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;

  if ((ev.ctrlKey || ev.metaKey) && key === 'z') {
    ev.preventDefault();
    if (ev.shiftKey) performRedo();
    else performUndo();
  } else if ((ev.ctrlKey || ev.metaKey) && key === 'y') {
    ev.preventDefault();
    performRedo();
  } else if ((ev.ctrlKey || ev.metaKey) && key === 'l') {
    ev.preventDefault();
    toggleLockSelection();
  } else if ((ev.ctrlKey || ev.metaKey) && key === 'c') {
    ev.preventDefault();
    copySelection();
  } else if ((ev.ctrlKey || ev.metaKey) && key === 'v') {
    ev.preventDefault();
    pasteSelection();
  } else if (ev.key === 'Delete' || ev.key === 'Backspace') {
    ev.preventDefault();
    deleteSelection();
  }
});

/* --- 右パネル：プロパティ・タグ・クラス・リンク編集 --- */
function populateNodeTagSelector(selectedNodes) {
  const container = document.getElementById('node-tag-selector');
  if (!container) return;
  container.innerHTML = '';
  const allTags = projectData.tags || [];

  const noneSelected = selectedNodes.every(n => !Array.isArray(n.tags) || n.tags.length === 0);
  const clearChip = document.createElement('span');
  clearChip.className = 'tag-chip' + (noneSelected ? ' selected' : '');
  clearChip.style.background = '#374151';
  clearChip.style.color = '#e5e7eb';
  clearChip.textContent = '🚫 タグなし (自由色)';
  clearChip.addEventListener('click', () => {
    applyToSelectedNodes(n => { n.tags = []; }, true);
  });
  container.appendChild(clearChip);

  allTags.forEach(tag => {
    const hasTag = selectedNodes.every(n => Array.isArray(n.tags) && n.tags[0] === tag.id);
    const chip = document.createElement('span');
    chip.className = 'tag-chip' + (hasTag ? ' selected' : '');
    chip.style.background = tag.color || '#3b82f6';
    chip.style.color = '#111827';
    chip.textContent = tag.name;
    chip.addEventListener('click', () => {
      applyToSelectedNodes(n => {
        if (Array.isArray(n.tags) && n.tags[0] === tag.id) n.tags = [];
        else n.tags = [tag.id];
      }, true);
    });
    container.appendChild(chip);
  });
}

function populateClassExtendsSelector(classNode) {
  const select = document.getElementById('prop-class-extends');
  const layer = currentLayer();
  select.innerHTML = '<option value="">（継承なし）</option>';

  const currentInheritEdge = layer.edges.find(e => e.source === classNode.id && e.relationType === 'inheritance');
  const currentParentId = currentInheritEdge ? currentInheritEdge.target : '';

  layer.nodes.filter(n => n.type === 'class' && n.id !== classNode.id).forEach(otherCls => {
    const opt = document.createElement('option');
    opt.value = otherCls.id;
    opt.textContent = `🧩 ${otherCls.text || otherCls.id}`;
    if (otherCls.id === currentParentId) opt.selected = true;
    select.appendChild(opt);
  });
}

document.getElementById('prop-class-extends').addEventListener('change', (ev) => {
  const layer = currentLayer();
  const classNode = layer.nodes.find(n => selectedNodeIds.has(n.id) && n.type === 'class');
  if (!classNode) return;

  recordHistory();
  const newParentId = ev.target.value;
  layer.edges = layer.edges.filter(e => !(e.source === classNode.id && e.relationType === 'inheritance'));

  if (newParentId) {
    const parentCls = layer.nodes.find(n => n.id === newParentId);
    if (parentCls) {
      const srcPort = (parentCls.y < classNode.y) ? 'top' : 'right';
      const tgtPort = (parentCls.y < classNode.y) ? 'bottom' : 'left';
      layer.edges.push({
        id: uid('edge'),
        source: classNode.id,
        sourcePort: srcPort,
        target: parentCls.id,
        targetPort: tgtPort,
        relationType: 'inheritance',
        label: 'extends',
        color: '#475569'
      });
      showToast(`🧬 「${parentCls.text}」を親クラスとして継承接続しました`);
    }
  } else {
    showToast('継承関係を解除しました');
  }
  render();
});

const bulkTextarea = document.getElementById('prop-class-bulk-text');
bulkTextarea.addEventListener('change', () => {
  const cls = currentLayer().nodes.find(n => selectedNodeIds.has(n.id) && n.type === 'class');
  if (!cls || isNodeLocked(cls)) return;
  recordHistory();
  applyBulkTextToClassNode(cls, bulkTextarea.value);
  render();
});
bulkTextarea.addEventListener('input', () => {
  const cls = currentLayer().nodes.find(n => selectedNodeIds.has(n.id) && n.type === 'class');
  if (!cls || isNodeLocked(cls)) return;
  applyBulkTextToClassNode(cls, bulkTextarea.value);
  render();
});

function renderClassMembersEditor(classNode) {
  populateClassExtendsSelector(classNode);
  if (document.activeElement !== bulkTextarea) {
    bulkTextarea.value = serializeClassToBulkText(classNode);
  }
  bulkTextarea.disabled = isNodeLocked(classNode);

  const fieldListEl = document.getElementById('class-field-list');
  const methodListEl = document.getElementById('class-method-list');
  fieldListEl.innerHTML = '';
  methodListEl.innerHTML = '';

  (classNode.fields || []).forEach(f => {
    normalizeClassMember(f, false);
    const row = document.createElement('div');
    row.className = 'member-edit-row';
    row.innerHTML = `
      <select title="アクセス修飾子">
        <option value="public" ${f.access === 'public' ? 'selected' : ''}>+ pub</option>
        <option value="private" ${f.access === 'private' ? 'selected' : ''}>- priv</option>
        <option value="protected" ${f.access === 'protected' ? 'selected' : ''}># prot</option>
      </select>
      <input type="text" class="m-name" value="${f.memberName || ''}" placeholder="変数名">
      <input type="text" class="m-type" list="type-suggestions" value="${f.dataType || ''}" placeholder="型">
      <button class="btn btn-danger" style="padding:2px 6px; font-size:10px;">✕</button>
    `;
    const selEl = row.querySelector('select');
    const nameEl = row.querySelector('.m-name');
    const typeEl = row.querySelector('.m-type');

    const updateField = () => {
      recordHistory();
      f.access = selEl.value;
      f.memberName = nameEl.value.trim();
      f.dataType = typeEl.value.trim();
      f.name = formatClassField(f);
      render();
    };
    selEl.addEventListener('change', updateField);
    nameEl.addEventListener('change', updateField);
    typeEl.addEventListener('change', updateField);

    row.querySelector('button').addEventListener('click', () => {
      recordHistory();
      classNode.fields = classNode.fields.filter(item => item.id !== f.id);
      render();
    });
    fieldListEl.appendChild(row);
  });

  (classNode.methods || []).forEach(m => {
    normalizeClassMember(m, true);
    const row = document.createElement('div');
    row.className = 'member-edit-row';
    row.innerHTML = `
      <select title="アクセス修飾子">
        <option value="public" ${m.access === 'public' ? 'selected' : ''}>+ pub</option>
        <option value="private" ${m.access === 'private' ? 'selected' : ''}>- priv</option>
        <option value="protected" ${m.access === 'protected' ? 'selected' : ''}># prot</option>
      </select>
      <input type="text" class="m-name" value="${m.memberName || ''}" placeholder="関数名">
      <input type="text" class="m-args" value="${m.args || ''}" placeholder="引数">
      <input type="text" class="m-type" list="type-suggestions" value="${m.returnType || ''}" placeholder="型">
      <button class="btn btn-danger" style="padding:2px 6px; font-size:10px;">✕</button>
    `;
    const selEl = row.querySelector('select');
    const nameEl = row.querySelector('.m-name');
    const argsEl = row.querySelector('.m-args');
    const typeEl = row.querySelector('.m-type');

    const updateMethod = () => {
      recordHistory();
      m.access = selEl.value;
      m.memberName = nameEl.value.trim();
      m.args = argsEl.value.trim();
      m.returnType = typeEl.value.trim();
      m.name = formatClassMethod(m);
      render();
    };
    selEl.addEventListener('change', updateMethod);
    nameEl.addEventListener('change', updateMethod);
    argsEl.addEventListener('change', updateMethod);
    typeEl.addEventListener('change', updateMethod);

    row.querySelector('button').addEventListener('click', () => {
      recordHistory();
      classNode.methods = classNode.methods.filter(item => item.id !== m.id);
      render();
    });
    methodListEl.appendChild(row);
  });
}

document.getElementById('btn-add-class-field').addEventListener('click', () => {
  const accessEl = document.getElementById('new-field-access');
  const nameEl = document.getElementById('new-field-name');
  const typeEl = document.getElementById('new-field-type');
  const mName = nameEl.value.trim();
  const mType = typeEl.value.trim() || 'int';
  if (!mName) return showToast('メンバ変数名を入力してください');

  applyToSelectedNodes(n => {
    if (n.type === 'class') {
      if (!Array.isArray(n.fields)) n.fields = [];
      const newField = normalizeClassMember({
        id: uid('fld'),
        access: accessEl.value,
        memberName: mName,
        dataType: mType
      }, false);
      n.fields.push(newField);
      autoAdjustClassNodeHeight(n);
    }
  }, true);
  nameEl.value = '';
  typeEl.value = '';
  nameEl.focus();
});

document.getElementById('btn-add-class-method').addEventListener('click', () => {
  const accessEl = document.getElementById('new-method-access');
  const nameEl = document.getElementById('new-method-name');
  const typeEl = document.getElementById('new-method-type');
  const argsEl = document.getElementById('new-method-args');
  const mName = nameEl.value.trim();
  const mType = typeEl.value.trim() || 'void';
  const mArgs = argsEl.value.trim();
  if (!mName) return showToast('関数名を入力してください');

  applyToSelectedNodes(n => {
    if (n.type === 'class') {
      if (!Array.isArray(n.methods)) n.methods = [];
      const newMethod = normalizeClassMember({
        id: uid('mtd'),
        access: accessEl.value,
        memberName: mName,
        args: mArgs,
        returnType: mType
      }, true);
      n.methods.push(newMethod);
      autoAdjustClassNodeHeight(n);
    }
  }, true);
  nameEl.value = '';
  typeEl.value = '';
  argsEl.value = '';
  nameEl.focus();
});

function populateMemoParentOptions(memoNode) {
  const select = document.getElementById('prop-memo-parent-select');
  const layer = currentLayer();
  select.innerHTML = '<option value="">（親なし・独立メモ）</option>';

  layer.nodes.filter(n => n.id !== memoNode.id && n.type !== 'memo').forEach(n => {
    const opt = document.createElement('option');
    opt.value = `node:${n.id}`;
    const label = n.text ? n.text.slice(0, 18) : n.id;
    opt.textContent = `🟦 要素: ${label}`;
    if (memoNode.parentObjectType === 'node' && memoNode.parentObjectId === n.id) opt.selected = true;
    select.appendChild(opt);
  });

  layer.edges.forEach((e, idx) => {
    const src = layer.nodes.find(n => n.id === e.source);
    const tgt = layer.nodes.find(n => n.id === e.target);
    const sName = src ? (src.text || src.id).slice(0, 8) : '?';
    const tName = tgt ? (tgt.text || tgt.id).slice(0, 8) : '?';
    const opt = document.createElement('option');
    opt.value = `edge:${e.id}`;
    opt.textContent = `↗ 矢印#${idx + 1}: ${sName} ➔ ${tName}`;
    if (memoNode.parentObjectType === 'edge' && memoNode.parentObjectId === e.id) opt.selected = true;
    select.appendChild(opt);
  });
}

function populateLinkTargetOptions(currentNode) {
  const select = document.getElementById('prop-link-select');
  const searchInput = document.getElementById('prop-link-search');
  const query = (searchInput.value || '').trim().toLowerCase();

  select.innerHTML = '<option value="">（リンクなし）</option>';

  const curVal = currentNode.linkTargetNodeId
    ? (currentNode.linkTargetMethodId ? `${currentNode.linkTargetNodeId}::${currentNode.linkTargetMethodId}` : currentNode.linkTargetNodeId)
    : '';

  const matchesFilter = (text, val) => {
    if (val === curVal) return true;
    if (!query) return true;
    return text.toLowerCase().includes(query);
  };

  const clsLayer = projectData.layers[CLASS_LAYER_ID];
  if (clsLayer && clsLayer.nodes.length > 0) {
    const grpClass = document.createElement('optgroup');
    grpClass.label = '🧩 クラス図 (クラス ＆ 関数)';
    clsLayer.nodes.forEach(cn => {
      if (cn.id === currentNode.id) return;
      const clsLabel = `🧩 クラス: ${cn.text || cn.id}`;
      if (matchesFilter(clsLabel, cn.id)) {
        const optCls = document.createElement('option');
        optCls.value = cn.id;
        optCls.textContent = clsLabel;
        if (curVal === cn.id) optCls.selected = true;
        grpClass.appendChild(optCls);
      }

      if (Array.isArray(cn.methods)) {
        cn.methods.forEach(m => {
          const val = `${cn.id}::${m.id}`;
          const mLabel = ` ⚡ 関数: ${cn.text || cn.id} :: ${formatClassMethod(m)}`;
          if (matchesFilter(mLabel, val)) {
            const optM = document.createElement('option');
            optM.value = val;
            optM.textContent = mLabel;
            if (curVal === val) optM.selected = true;
            grpClass.appendChild(optM);
          }
        });
      }
    });
    if (grpClass.children.length > 0) select.appendChild(grpClass);
  }

  const grpFlow = document.createElement('optgroup');
  grpFlow.label = '📊 フローチャート要素';
  Object.values(projectData.layers).forEach(layer => {
    if (layer.isClassDiagram) return;
    layer.nodes.forEach(n => {
      if (n.id === currentNode.id || n.isParentProxy) return;
      const typeIcon = n.type === 'container' ? '📦' : (n.type === 'memo' ? '📝' : '🟦');
      const name = n.text ? n.text.slice(0, 18) : `(無題:${n.id})`;
      const itemLabel = `[${layer.name || '階層'}] ${typeIcon} ${name}`;
      if (matchesFilter(itemLabel, n.id)) {
        const opt = document.createElement('option');
        opt.value = n.id;
        opt.textContent = itemLabel;
        if (curVal === n.id) opt.selected = true;
        grpFlow.appendChild(opt);
      }
    });
  });
  if (grpFlow.children.length > 0) select.appendChild(grpFlow);

  const jumpBtn = document.getElementById('btn-prop-jump-link');
  jumpBtn.style.display = currentNode.linkTargetNodeId ? 'inline-flex' : 'none';

  renderBacklinksList(currentNode);
}

function renderBacklinksList(currentNode) {
  const listEl = document.getElementById('prop-backlinks-list');
  listEl.innerHTML = '';
  const backlinks = findBacklinksToNode(currentNode.id);

  if (backlinks.length === 0) {
    listEl.innerHTML = '<div style="font-size:11px; color:var(--text-sub);">この要素を参照しているリンクはありません</div>';
    return;
  }

  backlinks.forEach(b => {
    const item = document.createElement('div');
    item.className = 'backlink-item';
    const srcName = b.sourceNode.text ? b.sourceNode.text.slice(0, 14) : `(無題:${b.sourceNode.id})`;
    const layerName = b.sourceLayer.name || '階層';
    let methodNote = '';
    if (b.targetMethodId && Array.isArray(currentNode.methods)) {
      const m = currentNode.methods.find(x => x.id === b.targetMethodId);
      if (m) methodNote = ` ➔ ⚡${m.memberName || m.name}()`;
    }
    item.innerHTML = `
      <span>📍 [${layerName}] ${srcName}${methodNote}</span>
      <span style="color:#c4b5fd; font-weight:700;">移動 ↗</span>
    `;
    item.addEventListener('click', () => {
      jumpToLinkedNode(b.sourceNode.id);
    });
    listEl.appendChild(item);
  });
}

document.getElementById('prop-link-search').addEventListener('input', () => {
  const layer = currentLayer();
  const node = layer.nodes.find(n => selectedNodeIds.has(n.id));
  if (node) populateLinkTargetOptions(node);
});

function updatePropertyPanel() {
  const emptyEl = document.getElementById('prop-empty');
  const nodeEl = document.getElementById('prop-node');
  const edgeEl = document.getElementById('prop-edge');
  const layer = currentLayer();
  if (!layer) return;

  if (selectedNodeIds.size > 0) {
    emptyEl.style.display = 'none';
    nodeEl.style.display = 'block';
    edgeEl.style.display = 'none';

    const selectedNodes = layer.nodes.filter(n => selectedNodeIds.has(n.id));
    const first = selectedNodes[0];
    const multiBadge = document.getElementById('prop-multi-badge');
    const proxyNotice = document.getElementById('prop-proxy-notice');
    const lockBtn = document.getElementById('prop-lock-btn');
    const locked = selectedNodes.every(n => isNodeLocked(n));
    const isProxy = selectedNodes.some(n => n.isParentProxy);
    const anyHasTag = selectedNodes.some(n => getNodeActiveTag(n) !== null);

    proxyNotice.style.display = isProxy ? 'block' : 'none';
    lockBtn.style.display = isProxy ? 'none' : 'inline-flex';
    lockBtn.textContent = locked ? '🔒 ロック中 (クリックで解除 / Ctrl+L)' : '🔓 編集・移動をロックする (Ctrl+L)';
    lockBtn.className = locked ? 'btn btn-warning' : 'btn';

    populateNodeTagSelector(selectedNodes);

    const curAlign = first.textAlign || (first.type === 'memo' ? 'left' : 'center');
    ['left', 'center', 'right'].forEach(a => {
      document.getElementById(`prop-align-${a}`).classList.toggle('active-btn', curAlign === a);
    });

    if (selectedNodes.length > 1) {
      multiBadge.style.display = 'block';
      multiBadge.textContent = `${selectedNodes.length} 個の要素を一括選択中`;
      document.getElementById('prop-text-group').style.display = 'none';
      document.getElementById('prop-class-box').style.display = 'none';
      document.getElementById('prop-pos-group').style.display = 'none';
      document.getElementById('prop-memo-parent-box').style.display = 'none';
      document.getElementById('prop-add-child-memo-box').style.display = 'none';
      document.getElementById('prop-link-box').style.display = 'none';
      document.getElementById('btn-enter-layer').style.display = 'none';
    } else {
      multiBadge.style.display = 'none';
      const isMemo = first.type === 'memo';
      const isClass = first.type === 'class';

      document.getElementById('prop-text-group').style.display = isClass ? 'none' : 'block';
      document.getElementById('prop-text').value = first.text || '';
      document.getElementById('prop-pos-group').style.display = 'grid';
      document.getElementById('prop-w').value = first.width;
      document.getElementById('prop-h').value = first.height;

      document.getElementById('prop-class-box').style.display = isClass ? 'block' : 'none';
      document.getElementById('prop-align-group').style.display = isClass ? 'none' : 'block';
      document.getElementById('prop-memo-parent-box').style.display = isMemo ? 'block' : 'none';
      document.getElementById('prop-add-child-memo-box').style.display = isMemo ? 'none' : 'block';
      document.getElementById('prop-link-box').style.display = first.isParentProxy ? 'none' : 'block';
      document.getElementById('btn-enter-layer').style.display = (first.type !== 'rect' || first.isParentProxy) ? 'none' : 'inline-flex';

      if (isClass) renderClassMembersEditor(first);
      if (isMemo) populateMemoParentOptions(first);
      if (!first.isParentProxy) populateLinkTargetOptions(first);
    }

    ['prop-text', 'prop-fontsize', 'prop-fontfamily', 'prop-w', 'prop-h'].forEach(id => {
      document.getElementById(id).disabled = locked;
    });

    const colorInput = document.getElementById('prop-color');
    const colorHint = document.getElementById('prop-color-tag-hint');
    colorInput.value = getEffectiveNodeColor(first);
    colorInput.disabled = locked || anyHasTag;
    colorHint.style.display = anyHasTag ? 'block' : 'none';

    document.getElementById('prop-fontsize').value = first.fontSize || 14;
    document.getElementById('prop-fontfamily').value = first.fontFamily || "'Segoe UI', 'Meiryo', sans-serif";
  } else if (selectedEdgeId) {
    const edge = layer.edges.find(e => e.id === selectedEdgeId);
    if (edge) {
      emptyEl.style.display = 'none';
      nodeEl.style.display = 'none';
      edgeEl.style.display = 'block';

      const lockBtn = document.getElementById('prop-edge-lock-btn');
      const isLocked = Boolean(edge.locked);
      lockBtn.textContent = isLocked ? '🔒 ロック中 (クリックで解除)' : '🔓 編集をロックする';
      lockBtn.className = isLocked ? 'btn btn-warning' : 'btn';

      const srcSelect = document.getElementById('prop-edge-source-node');
      const tgtSelect = document.getElementById('prop-edge-target-node');
      srcSelect.innerHTML = '';
      tgtSelect.innerHTML = '';

      layer.nodes.forEach(n => {
        const title = n.text || `(${n.type}:${n.id.slice(-4)})`;
        const opt1 = document.createElement('option');
        opt1.value = n.id;
        opt1.textContent = title;
        if (n.id === edge.source) opt1.selected = true;
        srcSelect.appendChild(opt1);

        const opt2 = document.createElement('option');
        opt2.value = n.id;
        opt2.textContent = title;
        if (n.id === edge.target) opt2.selected = true;
        tgtSelect.appendChild(opt2);
      });

      document.querySelectorAll('.btn-edge-src-port').forEach(btn => {
        btn.classList.toggle('active-btn', btn.getAttribute('data-port') === edge.sourcePort);
        btn.disabled = isLocked;
      });
      document.querySelectorAll('.btn-edge-tgt-port').forEach(btn => {
        btn.classList.toggle('active-btn', btn.getAttribute('data-port') === edge.targetPort);
        btn.disabled = isLocked;
      });

      srcSelect.disabled = isLocked;
      tgtSelect.disabled = isLocked;
      document.getElementById('prop-edge-label').disabled = isLocked;
      document.getElementById('prop-edge-color').disabled = isLocked;
      document.getElementById('btn-edge-reverse').disabled = isLocked;
      document.getElementById('btn-insert-rect-on-edge').disabled = isLocked;

      document.getElementById('prop-edge-label').value = edge.label || '';
      document.getElementById('prop-edge-color').value = edge.color || '#475569';

      const rType = edge.relationType || 'normal';
      ['normal', 'inheritance', 'implementation', 'dependency'].forEach(t => {
        const b = document.getElementById(`btn-edge-type-${t}`);
        b.classList.toggle('active-btn', rType === t);
        b.disabled = isLocked;
      });
    }
  } else {
    emptyEl.style.display = 'block';
    nodeEl.style.display = 'none';
    edgeEl.style.display = 'none';
  }
}

/* --- 矢印描画（renderer.jsのcreateEdgeSVGが未定義の場合のフォールバックとしても動作） --- */
function createEdgeSVG(edge) {
  const layer = currentLayer();
  const src = layer.nodes.find(n => n.id === edge.source);
  const tgt = layer.nodes.find(n => n.id === edge.target);
  if (!src || !tgt) return null;

  const p1 = getPortCoords(src, edge.sourcePort);
  const p2 = getPortCoords(tgt, edge.targetPort);
  const d = computeCurvePath(p1.x, p1.y, p2.x, p2.y, edge.sourcePort, edge.targetPort);
  const isSelected = selectedEdgeId === edge.id;
  const isLocked = Boolean(edge.locked);
  const relType = edge.relationType || 'normal';
  const isInherit = (relType === 'inheritance' || relType === 'implementation');
  const isDashed = (relType === 'implementation' || relType === 'dependency');

  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.style.cursor = 'pointer';

  const hit = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  hit.setAttribute('d', d);
  hit.setAttribute('stroke', 'transparent');
  hit.setAttribute('stroke-width', '22');
  hit.setAttribute('fill', 'none');
  g.appendChild(hit);

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', d);
  path.setAttribute('stroke', isSelected ? (isLocked ? '#f59e0b' : '#3b82f6') : (edge.color || '#475569'));
  path.setAttribute('stroke-width', isSelected ? '3' : '2.2');
  if (isDashed) path.setAttribute('stroke-dasharray', '6,4');
  path.setAttribute('fill', 'none');

  let markerUrl = isSelected ? 'url(#arrowhead-selected)' : 'url(#arrowhead)';
  if (isInherit) {
    markerUrl = isSelected ? 'url(#arrowhead-inheritance-selected)' : 'url(#arrowhead-inheritance)';
  }
  path.setAttribute('marker-end', markerUrl);
  g.appendChild(path);

  const mx = (p1.x + p2.x) / 2;
  const my = (p1.y + p2.y) / 2;

  if (edge.label) {
    const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    txt.setAttribute('x', mx);
    txt.setAttribute('y', my - 10);
    txt.setAttribute('text-anchor', 'middle');
    txt.setAttribute('fill', '#1e293b');
    txt.setAttribute('font-size', '12px');
    txt.setAttribute('font-weight', '600');
    txt.textContent = edge.label + (isLocked ? ' 🔒' : '');
    g.appendChild(txt);
  }

  if (isSelected && !isLocked) {
    const midBtn = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    midBtn.setAttribute('transform', `translate(${mx - 14}, ${my})`);
    midBtn.style.cursor = 'pointer';

    const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    c.setAttribute('r', 10);
    c.setAttribute('fill', '#2563eb');
    c.setAttribute('stroke', '#ffffff');
    c.setAttribute('stroke-width', '2');
    midBtn.appendChild(c);

    const plus = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    plus.setAttribute('x', 0);
    plus.setAttribute('y', 4);
    plus.setAttribute('text-anchor', 'middle');
    plus.setAttribute('fill', '#ffffff');
    plus.setAttribute('font-size', '13px');
    plus.setAttribute('font-weight', 'bold');
    plus.textContent = '+';
    midBtn.appendChild(plus);

    midBtn.addEventListener('mousedown', (ev) => ev.stopPropagation());
    midBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      insertNodeBetweenEdge(edge.id);
    });
    g.appendChild(midBtn);

    const relBtn = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    relBtn.setAttribute('transform', `translate(${mx + 14}, ${my})`);
    relBtn.style.cursor = 'pointer';

    const rc = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    rc.setAttribute('r', 10);
    rc.setAttribute('fill', isInherit ? '#7c3aed' : '#475569');
    rc.setAttribute('stroke', '#ffffff');
    rc.setAttribute('stroke-width', '2');
    relBtn.appendChild(rc);

    const rTxt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    rTxt.setAttribute('x', 0);
    rTxt.setAttribute('y', 4);
    rTxt.setAttribute('text-anchor', 'middle');
    rTxt.setAttribute('fill', '#ffffff');
    rTxt.setAttribute('font-size', '10px');
    rTxt.setAttribute('font-weight', 'bold');
    rTxt.textContent = '▷';
    relBtn.appendChild(rTxt);

    relBtn.addEventListener('mousedown', (ev) => ev.stopPropagation());
    relBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      recordHistory();
      edge.relationType = (edge.relationType === 'inheritance') ? 'normal' : 'inheritance';
      render();
      showToast(edge.relationType === 'inheritance' ? '▷ 継承（extends）矢印に変更しました' : '➔ 通常矢印に変更しました');
    });
    g.appendChild(relBtn);
  }

  g.addEventListener('mousedown', (ev) => {
    if (ev.button !== 0) return;
    ev.stopPropagation();
    hideContextMenu();
    hideNearbyPicker();
    commitInlineEdit();
    selectedNodeIds.clear();
    selectedEdgeId = edge.id;
    render();
  });

  return g;
}

function setSelectedEdgeRelationType(relType) {
  const edge = currentLayer().edges.find(ed => ed.id === selectedEdgeId);
  if (!edge || edge.locked) return;
  recordHistory();
  edge.relationType = relType;
  if (relType === 'inheritance' && !edge.label) edge.label = 'extends';
  if (relType === 'implementation' && !edge.label) edge.label = 'implements';
  render();
}
document.getElementById('btn-edge-type-normal').addEventListener('click', () => setSelectedEdgeRelationType('normal'));
document.getElementById('btn-edge-type-inheritance').addEventListener('click', () => setSelectedEdgeRelationType('inheritance'));
document.getElementById('btn-edge-type-implementation').addEventListener('click', () => setSelectedEdgeRelationType('implementation'));
document.getElementById('btn-edge-type-dependency').addEventListener('click', () => setSelectedEdgeRelationType('dependency'));

document.getElementById('btn-edge-reverse').addEventListener('click', () => {
  const edge = currentLayer().edges.find(ed => ed.id === selectedEdgeId);
  if (!edge || edge.locked) return;
  recordHistory();
  const tmpId = edge.source;
  const tmpPort = edge.sourcePort;
  edge.source = edge.target;
  edge.sourcePort = edge.targetPort;
  edge.target = tmpId;
  edge.targetPort = tmpPort;
  render();
  showToast('⇄ 矢印の向きを反転しました');
});

document.getElementById('prop-text').addEventListener('change', (e) => {
  applyToSelectedNodes(n => {
    n.text = e.target.value;
    if (n.childLayerId && projectData.layers[n.childLayerId]) {
      projectData.layers[n.childLayerId].name = n.text || 'サブ階層';
    }
  }, true);
});
document.getElementById('prop-text').addEventListener('input', (e) => {
  applyToSelectedNodes(n => {
    n.text = e.target.value;
    if (n.childLayerId && projectData.layers[n.childLayerId]) {
      projectData.layers[n.childLayerId].name = n.text || 'サブ階層';
    }
  }, false);
});
document.getElementById('prop-color').addEventListener('change', (e) => {
  applyToSelectedNodes(n => { if (!getNodeActiveTag(n)) n.color = e.target.value; }, true);
});
document.getElementById('prop-color').addEventListener('input', (e) => {
  applyToSelectedNodes(n => { if (!getNodeActiveTag(n)) n.color = e.target.value; }, false);
});
document.getElementById('prop-fontsize').addEventListener('change', (e) => applyToSelectedNodes(n => n.fontSize = parseInt(e.target.value, 10) || 14, true));
document.getElementById('prop-fontfamily').addEventListener('change', (e) => applyToSelectedNodes(n => n.fontFamily = e.target.value, true));
document.getElementById('prop-w').addEventListener('change', (e) => applyToSelectedNodes(n => n.width = Math.max(60, parseInt(e.target.value, 10) || 160), true));
document.getElementById('prop-h').addEventListener('change', (e) => applyToSelectedNodes(n => n.height = Math.max(40, parseInt(e.target.value, 10) || 80), true));

document.getElementById('prop-memo-parent-select').addEventListener('change', (e) => {
  const layer = currentLayer();
  const memo = layer.nodes.find(n => selectedNodeIds.has(n.id) && n.type === 'memo');
  if (!memo) return;
  recordHistory();
  const val = e.target.value;
  if (!val) {
    memo.parentObjectType = null;
    memo.parentObjectId = null;
    memo.offsetX = null;
    memo.offsetY = null;
  } else {
    const [pType, pId] = val.split(':');
    memo.parentObjectType = pType;
    memo.parentObjectId = pId;
    const anchor = getParentAnchorPoint(layer, pType, pId);
    if (anchor) {
      memo.offsetX = memo.x - anchor.x;
      memo.offsetY = memo.y - anchor.y;
    }
  }
  render();
  showToast('📎 メモの親オブジェクト設定を更新しました');
});

document.getElementById('prop-link-select').addEventListener('change', (e) => {
  const layer = currentLayer();
  const node = layer.nodes.find(n => selectedNodeIds.has(n.id));
  if (!node) return;
  recordHistory();
  const rawVal = e.target.value || '';
  if (!rawVal) {
    node.linkTargetNodeId = null;
    node.linkTargetLayerId = null;
    node.linkTargetMethodId = null;
    render();
    showToast('リンク設定を解除しました');
    return;
  }
  const [targetNodeId, targetMethodId] = rawVal.split('::');
  node.linkTargetNodeId = targetNodeId;
  node.linkTargetMethodId = targetMethodId || null;
  const found = findNodeAcrossProject(targetNodeId);
  node.linkTargetLayerId = found ? found.layer.id : null;
  render();
  showToast('🔗 リンクボタンを設定しました');
});

document.getElementById('btn-prop-jump-link').addEventListener('click', () => {
  const layer = currentLayer();
  const node = layer.nodes.find(n => selectedNodeIds.has(n.id));
  if (node && node.linkTargetNodeId) {
    jumpToLinkedNode(node.linkTargetNodeId, node.linkTargetMethodId);
  }
});

document.getElementById('btn-enter-layer').addEventListener('click', () => {
  if (selectedNodeIds.size === 1) enterNodeLayer([...selectedNodeIds][0]);
});

document.getElementById('prop-edge-label').addEventListener('change', () => recordHistory());
document.getElementById('prop-edge-label').addEventListener('input', (e) => {
  const edge = currentLayer().edges.find(ed => ed.id === selectedEdgeId);
  if (edge) { edge.label = e.target.value; render(); }
});
document.getElementById('prop-edge-color').addEventListener('change', () => recordHistory());
document.getElementById('prop-edge-color').addEventListener('input', (e) => {
  const edge = currentLayer().edges.find(ed => ed.id === selectedEdgeId);
  if (edge) { edge.color = e.target.value; render(); }
});

document.getElementById('prop-edge-lock-btn').addEventListener('click', () => {
  const edge = currentLayer().edges.find(e => e.id === selectedEdgeId);
  if (!edge) return;
  recordHistory();
  edge.locked = !edge.locked;
  render();
  showToast(edge.locked ? '🔒 矢印をロックしました' : '🔓 矢印のロックを解除しました');
});

document.getElementById('prop-edge-source-node').addEventListener('change', (e) => {
  const edge = currentLayer().edges.find(ed => ed.id === selectedEdgeId);
  if (!edge || edge.locked) return;
  recordHistory();
  edge.source = e.target.value;
  render();
});

document.getElementById('prop-edge-target-node').addEventListener('change', (e) => {
  const edge = currentLayer().edges.find(ed => ed.id === selectedEdgeId);
  if (!edge || edge.locked) return;
  recordHistory();
  edge.target = e.target.value;
  render();
});

document.querySelectorAll('.btn-edge-src-port').forEach(btn => {
  btn.addEventListener('click', () => {
    const edge = currentLayer().edges.find(ed => ed.id === selectedEdgeId);
    if (!edge || edge.locked) return;
    recordHistory();
    edge.sourcePort = btn.getAttribute('data-port');
    render();
  });
});

document.querySelectorAll('.btn-edge-tgt-port').forEach(btn => {
  btn.addEventListener('click', () => {
    const edge = currentLayer().edges.find(ed => ed.id === selectedEdgeId);
    if (!edge || edge.locked) return;
    recordHistory();
    edge.targetPort = btn.getAttribute('data-port');
    render();
  });
});

document.getElementById('btn-insert-rect-on-edge').addEventListener('click', () => {
  if (selectedEdgeId) insertNodeBetweenEdge(selectedEdgeId);
});
document.getElementById('btn-edge-add-child-memo').addEventListener('click', () => {
  addChildMemoToCurrentSelection();
});
document.getElementById('btn-prop-add-child-memo').addEventListener('click', () => {
  addChildMemoToCurrentSelection();
});

/* --- オブジェクト追加・コンテキストメニュー・パネル開閉 --- */
function addNode(type, customWorldPos = null, parentSpec = null) {
  recordHistory();
  const layer = currentLayer();
  const isCont = type === 'container';
  const isMemo = type === 'memo';
  const isClass = type === 'class';

  const baseX = customWorldPos ? snapToGrid(customWorldPos.x) : snapToGrid((-panX + 260) / zoom);
  const baseY = customWorldPos ? snapToGrid(customWorldPos.y) : snapToGrid((-panY + 180) / zoom);

  const newNode = {
    id: uid(isCont ? 'cont' : (isMemo ? 'memo' : (isClass ? 'cls' : 'node'))),
    type,
    text: isCont ? '新規グループコンテナ' : (isMemo ? '仕様メモ' : (isClass ? 'NewClass' : '')),
    x: baseX,
    y: baseY,
    width: isCont ? 360 : (isClass ? 276 : 192),
    height: isCont ? 240 : (isClass ? 192 : (isMemo ? 108 : 84)),
    color: isCont ? '#e2e8f0' : (isMemo ? '#fef08a' : (isClass ? '#f3e8ff' : '#dbeafe')),
    fontSize: isClass ? 13 : 14,
    fontFamily: isClass ? "'Consolas', 'Meiryo', monospace" : "'Segoe UI', 'Meiryo', sans-serif",
    textAlign: (isMemo || isCont || isClass) ? 'left' : 'center',
    tags: [],
    fields: isClass ? [normalizeClassMember({ id: uid('fld'), access: 'private', memberName: 'value', dataType: 'int' }, false)] : undefined,
    methods: isClass ? [normalizeClassMember({ id: uid('mtd'), access: 'public', memberName: 'Execute', args: '', returnType: 'void' }, true)] : undefined,
    parentGroupId: null,
    childLayerId: null,
    locked: false,
    isParentProxy: false,
    parentObjectType: parentSpec ? parentSpec.type : null,
    parentObjectId: parentSpec ? parentSpec.id : null,
    offsetX: parentSpec ? parentSpec.offsetX : null,
    offsetY: parentSpec ? parentSpec.offsetY : null,
    linkTargetNodeId: null,
    linkTargetLayerId: null,
    linkTargetMethodId: null
  };

  layer.nodes.push(newNode);
  selectedNodeIds.clear();
  selectedNodeIds.add(newNode.id);
  selectedEdgeId = null;
  if (isClass) {
    pendingFocusSelector = `input[data-cls-title="${newNode.id}"]`;
  }
  render();
  return newNode;
}

function addChildMemoToCurrentSelection() {
  const layer = currentLayer();
  if (selectedNodeIds.size === 1) {
    const parentNode = layer.nodes.find(n => selectedNodeIds.has(n.id));
    if (!parentNode) return;
    const memoX = parentNode.x + parentNode.width + 36;
    const memoY = parentNode.y - 12;
    const anchor = { x: parentNode.x + parentNode.width / 2, y: parentNode.y + parentNode.height / 2 };
    addNode('memo', { x: memoX, y: memoY }, {
      type: 'node',
      id: parentNode.id,
      offsetX: memoX - anchor.x,
      offsetY: memoY - anchor.y
    });
    showToast('📎 選択要素に「子メモ」を追加しました');
  } else if (selectedEdgeId) {
    const edge = layer.edges.find(e => e.id === selectedEdgeId);
    if (!edge) return;
    const mid = getEdgeMidpoint(layer, edge) || { x: 240, y: 180 };
    const memoX = mid.x + 24;
    const memoY = mid.y - 96;
    addNode('memo', { x: memoX, y: memoY }, {
      type: 'edge',
      id: edge.id,
      offsetX: memoX - mid.x,
      offsetY: memoY - mid.y
    });
    showToast('📎 矢印に「子メモ」を追加しました');
  }
}

document.getElementById('btn-side-rect').addEventListener('click', () => addNode('rect'));
document.getElementById('btn-side-container').addEventListener('click', () => addNode('container'));
document.getElementById('btn-side-memo').addEventListener('click', () => addNode('memo'));
document.getElementById('btn-side-class').addEventListener('click', () => addNode('class'));
document.getElementById('btn-side-class-cont').addEventListener('click', () => addNode('container'));
document.getElementById('btn-side-class-memo').addEventListener('click', () => addNode('memo'));

document.getElementById('ctx-add-rect').addEventListener('click', () => {
  hideContextMenu();
  const n = addNode('rect', contextMenuWorldPos);
  startInlineEdit(n);
});
document.getElementById('ctx-add-class').addEventListener('click', () => {
  hideContextMenu();
  addNode('class', contextMenuWorldPos);
});
document.getElementById('ctx-add-container').addEventListener('click', () => {
  hideContextMenu();
  addNode('container', contextMenuWorldPos);
});
document.getElementById('ctx-add-memo').addEventListener('click', () => {
  hideContextMenu();
  addNode('memo', contextMenuWorldPos);
});
document.getElementById('ctx-add-child-memo').addEventListener('click', () => {
  hideContextMenu();
  addChildMemoToCurrentSelection();
});
document.getElementById('ctx-insert-on-edge').addEventListener('click', () => {
  hideContextMenu();
  if (selectedEdgeId) insertNodeBetweenEdge(selectedEdgeId);
});
document.getElementById('ctx-paste').addEventListener('click', () => {
  hideContextMenu();
  pasteSelection(contextMenuWorldPos);
});

document.getElementById('btn-undo').addEventListener('click', performUndo);
document.getElementById('btn-redo').addEventListener('click', performRedo);
document.getElementById('btn-copy').addEventListener('click', copySelection);
document.getElementById('btn-paste').addEventListener('click', () => pasteSelection());
document.getElementById('btn-delete').addEventListener('click', deleteSelection);
document.getElementById('btn-reset-view').addEventListener('click', () => { panX = 0; panY = 0; zoom = 1; render(); });

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

function setupResizer(resizerEl, panelEl, isLeft) {
  let dragging = false;
  resizerEl.addEventListener('mousedown', (e) => {
    dragging = true;
    resizerEl.classList.add('dragging');
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const newW = isLeft ? e.clientX : (window.innerWidth - e.clientX);
    panelEl.style.width = `${Math.max(160, Math.min(520, newW))}px`;
  });
  window.addEventListener('mouseup', () => {
    if (dragging) {
      dragging = false;
      resizerEl.classList.remove('dragging');
    }
  });
}
setupResizer(leftResizer, leftPanel, true);
setupResizer(rightResizer, rightPanel, false);

/* --- Firebase プロジェクト一覧・保存・読込 --- */
async function fetchProjectList() {
  const container = document.getElementById('project-list-container');
  container.innerHTML = '<div style="color:var(--text-sub); font-size:12px; padding:12px;">Firebaseから一覧を取得中...</div>';
  try {
    const res = await fetch('/api/projects?action=list');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const list = data.projects || [];

    if (list.length === 0) {
      container.innerHTML = '<div style="color:var(--text-sub); font-size:12px; padding:12px;">保存されたプロジェクトはまだありません。上のフォームから新規作成してください。</div>';
      return;
    }

    container.innerHTML = '';
    list.forEach(item => {
      const row = document.createElement('div');
      row.className = 'project-item';
      row.innerHTML = `
        <div class="project-item-info">
          <div class="project-item-title">📁 ${item.projectId}</div>
          <div class="project-item-meta">階層数: ${item.layerCount} ｜ ルート要素数: ${item.rootNodeCount} ｜ 更新: ${item.updatedAt.slice(0, 19)}</div>
        </div>
        <div style="display:flex; gap:6px;">
          <button class="btn btn-primary btn-open-item">開く</button>
          <button class="btn btn-danger btn-del-item" title="削除">🗑</button>
        </div>
      `;
      row.addEventListener('click', () => openProjectById(item.projectId, true));
      row.querySelector('.btn-del-item').addEventListener('click', async (ev) => {
        ev.stopPropagation();
        if (!confirm(`プロジェクト「${item.projectId}」をFirebaseから削除しますか？`)) return;
        await deleteProjectById(item.projectId);
        fetchProjectList();
      });
      container.appendChild(row);
    });
  } catch (err) {
    console.error(err);
    container.innerHTML = `<div style="color:#f87171; font-size:12px; padding:12px;">一覧の取得に失敗しました: ${err.message}</div>`;
  }
}

async function openProjectById(pid, pushHistory = true) {
  if (!pid) return;
  try {
    const res = await fetch(`/api/projects/${encodeURIComponent(pid)}?project_id=${encodeURIComponent(pid)}`);
    if (res.status === 404) {
      projectData = createEmptyProject(pid);
      clearHistory();
      updateProjectHeaderAndUrl(pid, pushHistory);
      projectModal.classList.remove('open');
      selectedNodeIds.clear();
      selectedEdgeId = null;
      panX = 0; panY = 0; zoom = 1;
      render();
      showToast(`新規プロジェクト「${pid}」を開始しました（Ctrl+S で保存）`);
      return;
    }
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.detail || `HTTP ${res.status}`);
    }
    const loaded = await res.json();
    ensureProjectStructure(loaded);
    projectData = loaded;
    if (!projectData.currentLayerId || !projectData.layers[projectData.currentLayerId]) {
      projectData.currentLayerId = "root";
    }
    clearHistory();
    updateProjectHeaderAndUrl(pid, pushHistory);
    projectModal.classList.remove('open');
    selectedNodeIds.clear();
    selectedEdgeId = null;
    panX = 0; panY = 0; zoom = 1;
    render();
    showToast(`プロジェクト「${pid}」を読み込みました`);
  } catch (err) {
    console.error(err);
    showToast(`読込エラー: ${err.message}`);
  }
}

let isSaving = false;
async function saveCurrentProject() {
  if (isSaving) return;
  const pid = projectData.projectId;
  if (!pid) return showToast('プロジェクトが選択されていません');

  if (document.activeElement && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
    document.activeElement.blur();
  }

  isSaving = true;
  const saveBtn = document.getElementById('btn-cloud-save');
  const savingBanner = document.getElementById('saving-banner');

  if (saveBtn) saveBtn.disabled = true;
  if (savingBanner) savingBanner.style.display = 'block';

  try {
    const res = await fetch(`/api/projects/${encodeURIComponent(pid)}?project_id=${encodeURIComponent(pid)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(projectData)
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.detail || `HTTP ${res.status}`);
    }
    showToast(`☁ Firebaseへ保存しました (タグ・全階層・クラス図)`);
  } catch (err) {
    console.error(err);
    showToast(`保存エラー: ${err.message}`);
  } finally {
    isSaving = false;
    if (saveBtn) saveBtn.disabled = false;
    if (savingBanner) savingBanner.style.display = 'none';
  }
}

async function deleteProjectById(pid) {
  try {
    await fetch(`/api/projects/${encodeURIComponent(pid)}?project_id=${encodeURIComponent(pid)}&action=delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: pid, _action: 'delete' })
    });
    showToast(`「${pid}」を削除しました`);
  } catch (err) {
    showToast(`削除エラー: ${err.message}`);
  }
}

/* ==============================================================
 * 【方法A】JSON入出力モーダル ＆ 【方法B】AI自動生成モーダル ＆ プロジェクトメニュー連携
 * ============================================================== */
const aiJsonModal = document.getElementById('ai-json-modal');
const aiJsonTextarea = document.getElementById('ai-json-textarea');
const aiAssistModal = document.getElementById('ai-assist-modal');
const aiPromptInput = document.getElementById('ai-prompt-input');
const aiReplyBox = document.getElementById('ai-assist-reply');

document.getElementById('btn-open-modal').addEventListener('click', () => {
  if (projectDropdownContent) projectDropdownContent.classList.remove('show');
  projectModal.classList.add('open');
  fetchProjectList();
});
document.getElementById('btn-close-modal').addEventListener('click', () => {
  projectModal.classList.remove('open');
});
document.getElementById('btn-refresh-list').addEventListener('click', fetchProjectList);

document.getElementById('btn-create-project').addEventListener('click', async () => {
  const input = document.getElementById('new-project-input');
  const pid = input.value.trim().replace(/[\/\\?#]/g, '_');
  if (!pid) return showToast('新しいプロジェクト名を入力してください');

  projectData = createEmptyProject(pid);
  clearHistory();
  updateProjectHeaderAndUrl(pid, true);
  projectModal.classList.remove('open');
  input.value = '';
  render();
  await saveCurrentProject();
});

document.getElementById('btn-cloud-save').addEventListener('click', () => {
  if (projectDropdownContent) projectDropdownContent.classList.remove('show');
  saveCurrentProject();
});

document.getElementById('btn-copy-url').addEventListener('click', () => {
  if (projectDropdownContent) projectDropdownContent.classList.remove('show');
  navigator.clipboard.writeText(window.location.href).then(() => {
    showToast('プロジェクト専用URLをコピーしました！');
  });
});

document.getElementById('btn-open-json-modal').addEventListener('click', () => {
  if (projectDropdownContent) projectDropdownContent.classList.remove('show');
  aiJsonTextarea.value = JSON.stringify(projectData, null, 2);
  aiJsonModal.classList.add('open');
});

document.getElementById('btn-close-json-modal').addEventListener('click', () => {
  aiJsonModal.classList.remove('open');
});

document.getElementById('btn-copy-all-json').addEventListener('click', () => {
  aiJsonTextarea.value = JSON.stringify(projectData, null, 2);
  navigator.clipboard.writeText(aiJsonTextarea.value).then(() => {
    showToast('📋 プロジェクト全体のJSONをコピーしました！Geminiチャットに貼り付けられます');
  });
});

document.getElementById('btn-copy-layer-json').addEventListener('click', () => {
  const layerData = currentLayer();
  aiJsonTextarea.value = JSON.stringify(layerData, null, 2);
  navigator.clipboard.writeText(aiJsonTextarea.value).then(() => {
    showToast(`📄 現在の階層「${layerData.name}」のJSONをコピーしました！`);
  });
});

document.getElementById('btn-paste-replace-json').addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (!text || !text.trim()) {
      return showToast('⚠️ クリップボードが空です。コピーしてから実行してください。');
    }
    aiJsonTextarea.value = text;
    document.getElementById('btn-import-json').click();
  } catch (err) {
    console.error(err);
    showToast('⚠️ クリップボードの読み取り権限がないか、エラーが発生しました。テキストエリアに直接貼り付けてください。');
  }
});

document.getElementById('btn-import-json').addEventListener('click', () => {
  const raw = aiJsonTextarea.value.trim();
  if (!raw) return showToast('反映するJSONを貼り付けてください');
  try {
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const parsed = JSON.parse(cleaned);
    recordHistory();

    if (parsed.layers && parsed.layers.root) {
      ensureProjectStructure(parsed);
      parsed.projectId = projectData.projectId;
      projectData = parsed;
      showToast('📥 プロジェクト全体のJSONを反映しました！(Ctrl+Sで保存)');
    } else if (parsed.nodes && Array.isArray(parsed.nodes)) {
      const curId = projectData.currentLayerId;
      parsed.id = curId;
      projectData.layers[curId] = parsed;
      ensureProjectStructure(projectData);
      showToast(`📥 現在の階層「${parsed.name || curId}」にJSONを反映しました！`);
    } else {
      throw new Error('有効な projectData または layer 形式ではありません');
    }

    selectedNodeIds.clear();
    selectedEdgeId = null;
    aiJsonModal.classList.remove('open');
    render();
  } catch (err) {
    showToast(`JSON読込エラー: ${err.message}`);
  }
});

document.getElementById('btn-open-ai-assist').addEventListener('click', () => {
  if (projectDropdownContent) projectDropdownContent.classList.remove('show');
  const layer = currentLayer();
  document.getElementById('ai-target-layer-name').textContent = layer.name || layer.id;
  aiAssistModal.classList.add('open');
  aiPromptInput.focus();
});

document.getElementById('btn-close-ai-assist').addEventListener('click', () => {
  aiAssistModal.classList.remove('open');
});

let isAiRunning = false;
document.getElementById('btn-run-ai-assist').addEventListener('click', async () => {
  if (isAiRunning) return;
  const prompt = aiPromptInput.value.trim();
  if (!prompt) return showToast('AIへの指示を入力してください');

  isAiRunning = true;
  const runBtn = document.getElementById('btn-run-ai-assist');
  const spinner = document.getElementById('ai-spinner');
  const btnText = document.getElementById('ai-btn-text');

  runBtn.disabled = true;
  spinner.classList.add('active');
  btnText.textContent = 'Geminiが設計を生成中...';
  aiReplyBox.style.display = 'none';

  try {
    const layer = currentLayer();
    const pid = projectData.projectId || 'default';
    const res = await fetch(`/api/projects/${encodeURIComponent(pid)}?action=ai_assist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        _action: 'ai_assist',
        prompt: prompt,
        currentLayer: layer,
        tags: projectData.tags || []
      })
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.detail || `HTTP ${res.status}`);
    }

    const result = await res.json();
    if (result.updatedLayer && Array.isArray(result.updatedLayer.nodes)) {
      recordHistory();
      const curId = projectData.currentLayerId;
      result.updatedLayer.id = curId;
      projectData.layers[curId] = result.updatedLayer;
      ensureProjectStructure(projectData);
      render();
      showToast('✨ AIによる生成・編集が完了しました！(Ctrl+Zで元に戻せます)');
    }

    if (result.reply) {
      aiReplyBox.textContent = `🤖 AIからの報告: ${result.reply}`;
      aiReplyBox.style.display = 'block';
    }
  } catch (err) {
    console.error(err);
    showToast(`AI実行エラー: ${err.message}`);
    aiReplyBox.textContent = `⚠️ エラー: ${err.message}`;
    aiReplyBox.style.display = 'block';
  } finally {
    isAiRunning = false;
    runBtn.disabled = false;
    spinner.classList.remove('active');
    btnText.textContent = '🚀 AIでキャンバスを自動生成・更新する';
  }
});

/* ==============================================================
 * 📐 ローカル高速自動整列（AI通信なしで0.01秒で綺麗に再配置）
 * ============================================================== */
function autoLayoutCurrentLayer() {
  const layer = currentLayer();
  if (!layer || !layer.nodes || layer.nodes.length === 0) return;

  recordHistory();

  if (isClassMode()) {
    const classes = layer.nodes.filter(n => n.type === 'class');
    const others = layer.nodes.filter(n => n.type !== 'class');

    const parentIds = new Set(
      layer.edges.filter(e => e.relationType === 'inheritance').map(e => e.target)
    );

    classes.sort((a, b) => {
      const aIsParent = parentIds.has(a.id) ? 0 : 1;
      const bIsParent = parentIds.has(b.id) ? 0 : 1;
      if (aIsParent !== bIsParent) return aIsParent - bIsParent;
      return (a.tags?.[0] || '').localeCompare(b.tags?.[0] || '');
    });

    const cols = 4;
    const startX = 48;
    const startY = 48;
    const gapX = 384;
    const colHeights = new Array(cols).fill(startY);

    classes.forEach((cls, idx) => {
      autoAdjustClassNodeHeight(cls);
      let targetCol = idx % cols;
      cls.x = snapToGrid(startX + targetCol * gapX);
      cls.y = snapToGrid(colHeights[targetCol]);
      colHeights[targetCol] = cls.y + cls.height + 72;
    });

    others.forEach((n, idx) => {
      n.x = snapToGrid(startX + (idx % cols) * gapX);
      n.y = snapToGrid(Math.max(...colHeights) + 48);
    });
  } else {
    const nodes = layer.nodes.filter(n => n.type !== 'container' && n.type !== 'memo');
    const visited = new Set();
    const levels = [];

    const inDegree = new Map();
    nodes.forEach(n => inDegree.set(n.id, 0));
    layer.edges.forEach(e => {
      if (inDegree.has(e.target)) inDegree.set(e.target, inDegree.get(e.target) + 1);
    });

    let queue = nodes.filter(n => n.isParentProxy || inDegree.get(n.id) === 0);
    if (queue.length === 0 && nodes.length > 0) queue = [nodes[0]];

    while (queue.length > 0) {
      levels.push(queue);
      queue.forEach(n => visited.add(n.id));
      const nextQueue = [];
      queue.forEach(u => {
        layer.edges.filter(e => e.source === u.id).forEach(e => {
          const v = nodes.find(n => n.id === e.target);
          if (v && !visited.has(v.id) && !nextQueue.includes(v)) {
            nextQueue.push(v);
          }
        });
      });
      queue = nextQueue;
    }

    const unvisited = nodes.filter(n => !visited.has(n.id));
    if (unvisited.length > 0) levels.push(unvisited);

    let currentY = 48;
    levels.forEach(lvlNodes => {
      const totalW = lvlNodes.length * 240;
      let startX = Math.max(48, 360 - totalW / 2);
      lvlNodes.forEach((n, i) => {
        if (!n.isParentProxy) {
          n.x = snapToGrid(startX + i * 264);
          n.y = snapToGrid(currentY);
        } else {
          n.x = 240;
          n.y = 48;
        }
      });
      currentY += 144;
    });
  }

  panX = 20;
  panY = 20;
  zoom = 0.85;
  render();
  showToast('📐 見やすい位置へ自動整列しました！(Ctrl+Zで元に戻せます)');
}

document.getElementById('btn-auto-layout').addEventListener('click', autoLayoutCurrentLayer);

/* --- ルーティング ＆ 起動時プロジェクト自動読込 --- */
window.addEventListener('popstate', () => {
  if (undoStack.length > 0) {
    performUndo();
    const targetPath = `/p/${encodeURIComponent(projectData.projectId)}`;
    window.history.pushState({ projectId: projectData.projectId, guard: true }, '', targetPath);
  } else {
    handleInitialRoute(false);
  }
});

function handleInitialRoute(pushHistory = false) {
  const path = window.location.pathname;
  const params = new URLSearchParams(window.location.search);

  if (path.startsWith('/p/')) {
    const pid = decodeURIComponent(path.slice(3).replace(/\/$/, ''));
    if (pid) {
      openProjectById(pid, pushHistory);
      return;
    }
  } else if (params.get('p')) {
    openProjectById(params.get('p'), pushHistory);
    return;
  }

  render();
  projectModal.classList.add('open');
  fetchProjectList();
}

handleInitialRoute(false);