/**************************************************************
 * renderer.js : SVG描画エンジン（クラス内スプレッドシート型直接入力対応）
 **************************************************************/
let pendingFocusSelector = null; // Enter連続追加時に次の入力欄へ自動フォーカスするためのセレクタ

function updateTypeSuggestionsDatalist() {
  const dl = document.getElementById('type-suggestions');
  if (!dl) return;
  const baseTypes = ['int', 'float', 'bool', 'string', 'void', 'double', 'Vector2', 'Vector3', 'GameObject', 'Transform', 'List<int>', 'List<string>', 'Dictionary<string, int>'];
  const clsLayer = projectData.layers[CLASS_LAYER_ID];
  const classNames = clsLayer ? clsLayer.nodes.filter(n => n.type === 'class' && n.text).map(n => n.text.trim()) : [];
  const all = [...new Set([...baseTypes, ...classNames])];
  dl.innerHTML = all.map(t => `<option value="${t}"></option>`).join('');
}

function render() {
  ensureProjectStructure(projectData);
  const layer = currentLayer();
  if (!layer) return;

  ensureParentProxyNode(layer);
  updateModeUI();
  updateTypeSuggestionsDatalist();

  layer.nodes.forEach(n => {
    if (n.type === 'memo' && n.parentObjectType === 'edge' && n.parentObjectId) {
      if (!(mode === 'dragNodes' && selectedNodeIds.has(n.id))) {
        const anchor = getParentAnchorPoint(layer, 'edge', n.parentObjectId);
        if (anchor && typeof n.offsetX === 'number' && typeof n.offsetY === 'number') {
          n.x = Math.round(anchor.x + n.offsetX);
          n.y = Math.round(anchor.y + n.offsetY);
        }
      }
    }
  });

  updateViewportTransform();
  renderBreadcrumbs();
  renderLayerTree();
  renderProjectTagManager();

  containersLayer.innerHTML = '';
  memoTethersLayer.innerHTML = '';
  edgesLayer.innerHTML = '';
  nodesLayer.innerHTML = '';
  memosLayer.innerHTML = '';
  uiLayer.innerHTML = '';

  const containers = layer.nodes.filter(n => n.type === 'container');
  const memos = layer.nodes.filter(n => n.type === 'memo');
  const mainNodes = layer.nodes.filter(n => n.type !== 'container' && n.type !== 'memo');

  containers.forEach(c => containersLayer.appendChild(createNodeSVG(c)));
  mainNodes.forEach(r => nodesLayer.appendChild(createNodeSVG(r)));
  memos.forEach(m => {
    memosLayer.appendChild(createNodeSVG(m));
    const tether = createMemoTetherSVG(layer, m);
    if (tether) memoTethersLayer.appendChild(tether);
  });

  layer.edges.forEach(e => {
    const g = createEdgeSVG(e);
    if (g) edgesLayer.appendChild(g);
  });

  layer.nodes.forEach(n => {
    const isSelected = selectedNodeIds.has(n.id);
    const isHovered = hoveredNodeId === n.id;
    if (isSelected || isHovered) {
      if (isSelected && selectedNodeIds.size === 1 && !isNodeLocked(n)) {
        uiLayer.appendChild(createResizeHandlesSVG(n));
      }
      if (n.type !== 'memo' && (isHovered || (isSelected && selectedNodeIds.size === 1))) {
        uiLayer.appendChild(createOuterPortsAndQuickCreateSVG(n));
      }
    }
  });

  if ((mode === 'connect' || mode === 'quickCreate') && activeConnect) {
    const srcNode = layer.nodes.find(n => n.id === activeConnect.sourceId);
    if (srcNode) {
      const p1 = getPortCoords(srcNode, activeConnect.sourcePort);
      const oppositePort = getOppositePort(activeConnect.sourcePort);
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      const d = computeCurvePath(p1.x, p1.y, activeConnect.currentX, activeConnect.currentY, activeConnect.sourcePort, oppositePort);
      line.setAttribute('d', d);
      line.setAttribute('stroke', mode === 'quickCreate' ? '#10b981' : '#3b82f6');
      line.setAttribute('stroke-width', '2.5');
      line.setAttribute('stroke-dasharray', '6,4');
      line.setAttribute('fill', 'none');
      line.setAttribute('marker-end', isClassMode() ? 'url(#arrowhead-inheritance-selected)' : (mode === 'quickCreate' ? 'url(#arrowhead-create)' : 'url(#arrowhead-selected)'));
      uiLayer.appendChild(line);

      if (mode === 'quickCreate') {
        const defaultW = isClassMode() ? 276 : 192;
        const defaultH = isClassMode() ? 192 : 84;
        const ghostPos = computeNewNodePosFromCursor(activeConnect.currentX, activeConnect.currentY, activeConnect.sourcePort, defaultW, defaultH);
        const ghost = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        ghost.setAttribute('x', ghostPos.x);
        ghost.setAttribute('y', ghostPos.y);
        ghost.setAttribute('width', defaultW);
        ghost.setAttribute('height', defaultH);
        ghost.setAttribute('rx', 7);
        ghost.setAttribute('fill', 'rgba(16, 185, 129, 0.15)');
        ghost.setAttribute('stroke', '#10b981');
        ghost.setAttribute('stroke-width', '2');
        ghost.setAttribute('stroke-dasharray', '5,3');
        uiLayer.appendChild(ghost);
      }
    }
  }

  if (mode === 'marquee' && marqueeRect) {
    const box = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    box.setAttribute('x', marqueeRect.x);
    box.setAttribute('y', marqueeRect.y);
    box.setAttribute('width', marqueeRect.w);
    box.setAttribute('height', marqueeRect.h);
    box.setAttribute('fill', 'rgba(59, 130, 246, 0.15)');
    box.setAttribute('stroke', '#3b82f6');
    box.setAttribute('stroke-width', 1.5 / zoom);
    box.setAttribute('stroke-dasharray', '5,3');
    uiLayer.appendChild(box);
  }

  updatePropertyPanel();
  updateMiniToolbarPosition();

  // Enter連続追加などで指定された入力欄があれば即座にフォーカス＆全選択
  if (pendingFocusSelector) {
    const targetInput = document.querySelector(pendingFocusSelector);
    pendingFocusSelector = null;
    if (targetInput) {
      targetInput.focus();
      if (targetInput.select) targetInput.select();
    }
  }
}

function updateModeUI() {
  const inClass = isClassMode();
  document.getElementById('btn-mode-flow').classList.toggle('active-mode', !inClass);
  document.getElementById('btn-mode-class').classList.toggle('active-mode', inClass);
  document.getElementById('left-add-flow').style.display = inClass ? 'none' : 'flex';
  document.getElementById('left-add-class').style.display = inClass ? 'flex' : 'none';
}

function createMemoTetherSVG(layer, memoNode) {
  if (!memoNode.parentObjectType || !memoNode.parentObjectId) return null;
  const anchor = getParentAnchorPoint(layer, memoNode.parentObjectType, memoNode.parentObjectId);
  if (!anchor) return null;

  const mx = memoNode.x + memoNode.width / 2;
  const my = memoNode.y + memoNode.height / 2;

  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  line.setAttribute('x1', anchor.x);
  line.setAttribute('y1', anchor.y);
  line.setAttribute('x2', mx);
  line.setAttribute('y2', my);
  line.setAttribute('stroke', '#eab308');
  line.setAttribute('stroke-width', '2');
  line.setAttribute('stroke-dasharray', '4,4');
  g.appendChild(line);

  const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  dot.setAttribute('cx', anchor.x);
  dot.setAttribute('cy', anchor.y);
  dot.setAttribute('r', 4);
  dot.setAttribute('fill', '#eab308');
  g.appendChild(dot);

  return g;
}

function createNodeSVG(node) {
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.setAttribute('transform', `translate(${node.x}, ${node.y})`);
  if (highlightedNodeId === node.id) {
    g.classList.add('jump-highlight');
  }

  const locked = isNodeLocked(node);
  g.style.cursor = locked ? 'default' : 'move';

  const isSelected = selectedNodeIds.has(node.id);
  const isContainer = node.type === 'container';
  const isMemo = node.type === 'memo';
  const isClass = node.type === 'class';
  const fillColor = getEffectiveNodeColor(node);
  const activeTag = getNodeActiveTag(node);

  const hoverPad = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  hoverPad.setAttribute('x', -52);
  hoverPad.setAttribute('y', -52);
  hoverPad.setAttribute('width', node.width + 104);
  hoverPad.setAttribute('height', node.height + 104);
  hoverPad.setAttribute('fill', 'transparent');
  g.appendChild(hoverPad);

  // 1. 単一タグピル表示
  if (activeTag) {
    const pillW = Math.max(48, activeTag.name.length * 11 + 18);
    const pillG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    pillG.setAttribute('transform', `translate(0, -22)`);

    const pillBg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    pillBg.setAttribute('width', pillW);
    pillBg.setAttribute('height', 18);
    pillBg.setAttribute('rx', 9);
    pillBg.setAttribute('fill', activeTag.color || '#3b82f6');
    pillBg.setAttribute('stroke', '#1e293b');
    pillBg.setAttribute('stroke-width', '1.2');
    pillG.appendChild(pillBg);

    const pillTxt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    pillTxt.setAttribute('x', pillW / 2);
    pillTxt.setAttribute('y', 12.5);
    pillTxt.setAttribute('text-anchor', 'middle');
    pillTxt.setAttribute('fill', '#111827');
    pillTxt.setAttribute('font-size', '10px');
    pillTxt.setAttribute('font-weight', 'bold');
    pillTxt.textContent = `🏷️ ${activeTag.name}`;
    pillG.appendChild(pillTxt);

    g.appendChild(pillG);
  }

  // 2. 本体描画
  if (isMemo) {
    const fold = 16;
    const w = node.width, h = node.height;
    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    poly.setAttribute('points', `0,0 ${w - fold},0 ${w},${fold} ${w},${h} 0,${h}`);
    poly.setAttribute('fill', fillColor);
    poly.setAttribute('stroke', isSelected ? '#3b82f6' : (locked ? '#f59e0b' : '#ca8a04'));
    poly.setAttribute('stroke-width', isSelected ? '3' : '1.6');
    g.appendChild(poly);

    const corner = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    corner.setAttribute('points', `${w - fold},0 ${w - fold},${fold} ${w},${fold}`);
    corner.setAttribute('fill', 'rgba(0,0,0,0.12)');
    corner.setAttribute('stroke', '#ca8a04');
    corner.setAttribute('stroke-width', '1');
    g.appendChild(corner);

    const memoTag = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    memoTag.setAttribute('x', locked ? 34 : 8);
    memoTag.setAttribute('y', 14);
    memoTag.setAttribute('fill', '#854d0e');
    memoTag.setAttribute('font-size', '10px');
    memoTag.setAttribute('font-weight', 'bold');
    memoTag.textContent = node.parentObjectId ? '📎 子メモ (仕様)' : '📝 メモ';
    g.appendChild(memoTag);
  } else if (isClass) {
    // UML クラスノード（クリック1回で即入力・Enterで次行連続追加できるスプレッドシート型UI）
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('width', node.width);
    rect.setAttribute('height', node.height);
    rect.setAttribute('rx', 6);
    rect.setAttribute('fill', fillColor);
    rect.setAttribute('stroke', isSelected ? '#3b82f6' : (locked ? '#f59e0b' : '#6d28d9'));
    rect.setAttribute('stroke-width', isSelected ? '3' : '2');
    g.appendChild(rect);

    const headerBg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    headerBg.setAttribute('width', node.width);
    headerBg.setAttribute('height', 34);
    headerBg.setAttribute('rx', 6);
    headerBg.setAttribute('fill', '#7c3aed');
    g.appendChild(headerBg);

    const fo = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
    fo.setAttribute('x', 0);
    fo.setAttribute('y', 0);
    fo.setAttribute('width', node.width);
    fo.setAttribute('height', node.height);
    fo.style.pointerEvents = 'none';

    const wrapper = document.createElement('div');
    wrapper.style.width = '100%';
    wrapper.style.height = '100%';
    wrapper.style.display = 'flex';
    wrapper.style.flexDirection = 'column';
    wrapper.style.fontFamily = node.fontFamily || "'Consolas', 'Meiryo', monospace";
    wrapper.style.fontSize = `${node.fontSize || 13}px`;
    wrapper.style.color = '#1e293b';

    // クラス名ヘッダー（直接クリック編集 input ＋ 右上に「＋子クラス」派生ボタン）
    const titleDiv = document.createElement('div');
    titleDiv.style.height = '34px';
    titleDiv.style.display = 'flex';
    titleDiv.style.alignItems = 'center';
    titleDiv.style.justifyContent = 'space-between';
    titleDiv.style.paddingLeft = locked ? '32px' : '8px';
    titleDiv.style.paddingRight = '6px';

    const titleLeft = document.createElement('div');
    titleLeft.style.display = 'flex';
    titleLeft.style.alignItems = 'center';
    titleLeft.style.gap = '4px';
    titleLeft.style.flex = '1';
    titleLeft.innerHTML = `<span style="font-size:12px;">🧩</span>`;

    const titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.className = 'cls-title-input';
    titleInput.setAttribute('data-cls-title', node.id);
    titleInput.value = node.text || 'ClassName';
    titleInput.disabled = locked;
    titleInput.title = 'クリックしてクラス名を直接変更 (Enterで変数追加へ)';
    titleInput.addEventListener('mousedown', (ev) => {
      ev.stopPropagation();
      if (!selectedNodeIds.has(node.id)) {
        selectedNodeIds.clear();
        selectedNodeIds.add(node.id);
        updatePropertyPanel();
      }
    });
    titleInput.addEventListener('change', (ev) => {
      recordHistory();
      node.text = ev.target.value.trim() || 'ClassName';
      render();
    });
    titleInput.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        node.text = titleInput.value.trim() || 'ClassName';
        quickAddClassMemberOnCanvas(node, 'field');
      }
    });
    titleLeft.appendChild(titleInput);
    titleDiv.appendChild(titleLeft);

    if (!locked) {
      const subBtn = document.createElement('button');
      subBtn.className = 'cls-sub-spawn-btn';
      subBtn.textContent = '＋子クラス';
      subBtn.title = 'このクラスを継承する子クラスを下に自動生成します';
      subBtn.addEventListener('mousedown', (ev) => ev.stopPropagation());
      subBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        spawnChildClassFromParent(node);
      });
      titleDiv.appendChild(subBtn);
    }
    wrapper.appendChild(titleDiv);

    // --- メンバ変数セクション ---
    const fieldHeader = document.createElement('div');
    fieldHeader.className = 'cls-gui-section-header';
    fieldHeader.innerHTML = `<span>フィールド (変数)</span>`;
    if (!locked) {
      const addFBtn = document.createElement('button');
      addFBtn.className = 'cls-gui-add-btn';
      addFBtn.textContent = '＋ 変数';
      addFBtn.addEventListener('mousedown', (ev) => ev.stopPropagation());
      addFBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        quickAddClassMemberOnCanvas(node, 'field');
      });
      fieldHeader.appendChild(addFBtn);
    }
    wrapper.appendChild(fieldHeader);

    const fieldsDiv = document.createElement('div');
    fieldsDiv.style.padding = '3px 5px 5px 5px';
    fieldsDiv.style.borderBottom = '1.5px solid #a78bfa';
    fieldsDiv.style.minHeight = '26px';
    if (!node.fields || node.fields.length === 0) {
      const emptyF = document.createElement('div');
      emptyF.style.color = '#64748b';
      emptyF.style.fontSize = '11px';
      emptyF.style.padding = '2px 4px';
      emptyF.style.cursor = 'pointer';
      emptyF.style.pointerEvents = 'auto';
      emptyF.textContent = '＋ クリックして変数を追加...';
      if (!locked) {
        emptyF.addEventListener('mousedown', (ev) => ev.stopPropagation());
        emptyF.addEventListener('click', (ev) => {
          ev.stopPropagation();
          quickAddClassMemberOnCanvas(node, 'field');
        });
      }
      fieldsDiv.appendChild(emptyF);
    } else {
      node.fields.forEach(f => {
        fieldsDiv.appendChild(createClassMemberRowDOM(node, f, 'field', locked));
      });
    }
    wrapper.appendChild(fieldsDiv);

    // --- 関数（メソッド）セクション ---
    const methodHeader = document.createElement('div');
    methodHeader.className = 'cls-gui-section-header';
    methodHeader.innerHTML = `<span>メソッド (関数)</span>`;
    if (!locked) {
      const addMBtn = document.createElement('button');
      addMBtn.className = 'cls-gui-add-btn';
      addMBtn.textContent = '＋ 関数';
      addMBtn.addEventListener('mousedown', (ev) => ev.stopPropagation());
      addMBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        quickAddClassMemberOnCanvas(node, 'method');
      });
      methodHeader.appendChild(addMBtn);
    }
    wrapper.appendChild(methodHeader);

    const methodsDiv = document.createElement('div');
    methodsDiv.style.padding = '3px 5px 5px 5px';
    methodsDiv.style.flex = '1';
    if (!node.methods || node.methods.length === 0) {
      const emptyM = document.createElement('div');
      emptyM.style.color = '#64748b';
      emptyM.style.fontSize = '11px';
      emptyM.style.padding = '2px 4px';
      emptyM.style.cursor = 'pointer';
      emptyM.style.pointerEvents = 'auto';
      emptyM.textContent = '＋ クリックして関数を追加...';
      if (!locked) {
        emptyM.addEventListener('mousedown', (ev) => ev.stopPropagation());
        emptyM.addEventListener('click', (ev) => {
          ev.stopPropagation();
          quickAddClassMemberOnCanvas(node, 'method');
        });
      }
      methodsDiv.appendChild(emptyM);
    } else {
      node.methods.forEach(m => {
        methodsDiv.appendChild(createClassMemberRowDOM(node, m, 'method', locked));
      });
    }
    wrapper.appendChild(methodsDiv);

    fo.appendChild(wrapper);
    g.appendChild(fo);
  } else {
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('width', node.width);
    rect.setAttribute('height', node.height);
    rect.setAttribute('rx', isContainer ? 10 : 7);
    rect.setAttribute('fill', fillColor);
    rect.setAttribute('fill-opacity', isContainer ? '0.45' : '1');

    if (node.isParentProxy) {
      rect.setAttribute('stroke', isSelected ? '#3b82f6' : '#d97706');
      rect.setAttribute('stroke-width', isSelected ? '3.5' : '2.5');
      rect.setAttribute('stroke-dasharray', '6,3');
    } else if (locked) {
      rect.setAttribute('stroke', isSelected ? '#3b82f6' : '#f59e0b');
      rect.setAttribute('stroke-width', isSelected ? '3' : '2');
    } else {
      rect.setAttribute('stroke', isSelected ? '#3b82f6' : (isContainer ? '#64748b' : '#475569'));
      rect.setAttribute('stroke-width', isSelected ? '3' : '1.8');
      if (isContainer) rect.setAttribute('stroke-dasharray', '7,4');
    }
    g.appendChild(rect);

    if (node.isParentProxy) {
      const proxyHeader = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      proxyHeader.setAttribute('width', node.width);
      proxyHeader.setAttribute('height', 22);
      proxyHeader.setAttribute('rx', 6);
      proxyHeader.setAttribute('fill', '#f59e0b');
      g.appendChild(proxyHeader);

      const proxyLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      proxyLabel.setAttribute('x', 8);
      proxyLabel.setAttribute('y', 15);
      proxyLabel.setAttribute('fill', '#ffffff');
      proxyLabel.setAttribute('font-size', '10px');
      proxyLabel.setAttribute('font-weight', 'bold');
      proxyLabel.textContent = '🔒 親階層ノード (編集不可・接続起点)';
      g.appendChild(proxyLabel);
    } else if (isContainer) {
      const headerRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      headerRect.setAttribute('width', node.width);
      headerRect.setAttribute('height', 32);
      headerRect.setAttribute('rx', 8);
      headerRect.setAttribute('fill', 'rgba(100, 116, 139, 0.2)');
      g.appendChild(headerRect);
    }
  }

  // 3. テキスト表示（クラスノード以外）
  if (!isClass) {
    const fo = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
    const leftPad = (isContainer && locked) ? 34 : 8;
    fo.setAttribute('x', leftPad);
    fo.setAttribute('y', (node.isParentProxy || isMemo) ? 20 : (isContainer ? 4 : 8));
    fo.setAttribute('width', Math.max(20, node.width - leftPad - 8));
    fo.setAttribute('height', (node.isParentProxy || isMemo) ? Math.max(20, node.height - 26) : (isContainer ? 26 : Math.max(20, node.height - 16)));
    fo.style.pointerEvents = 'none';

    const align = node.textAlign || (isMemo || isContainer ? 'left' : 'center');
    const justifyMap = { left: 'flex-start', center: 'center', right: 'flex-end' };

    const div = document.createElement('div');
    div.style.width = '100%';
    div.style.height = '100%';
    div.style.display = 'flex';
    div.style.alignItems = isMemo ? 'flex-start' : 'center';
    div.style.justifyContent = justifyMap[align] || 'center';
    div.style.textAlign = align;
    div.style.fontSize = `${node.fontSize || 14}px`;
    div.style.fontFamily = node.fontFamily || "'Segoe UI', 'Meiryo', sans-serif";
    div.style.fontWeight = (isContainer || node.isParentProxy) ? '700' : '500';
    div.style.color = '#1e293b';
    div.style.wordBreak = 'break-word';
    div.style.whiteSpace = 'pre-wrap';
    div.textContent = editingNodeId === node.id ? '' : (node.text || '');
    fo.appendChild(div);
    g.appendChild(fo);
  }

  // 4. ロックバッジ
  if (locked && !node.isParentProxy) {
    const lockBadge = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    lockBadge.setAttribute('transform', `translate(6, 6)`);
    lockBadge.style.cursor = 'pointer';

    const lbBg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    lbBg.setAttribute('width', 22);
    lbBg.setAttribute('height', 20);
    lbBg.setAttribute('rx', 4);
    lbBg.setAttribute('fill', '#f59e0b');
    lockBadge.appendChild(lbBg);

    const lbTxt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    lbTxt.setAttribute('x', 11);
    lbTxt.setAttribute('y', 14);
    lbTxt.setAttribute('text-anchor', 'middle');
    lbTxt.setAttribute('font-size', '11px');
    lbTxt.textContent = '🔒';
    lockBadge.appendChild(lbTxt);

    lockBadge.addEventListener('mousedown', (ev) => ev.stopPropagation());
    lockBadge.addEventListener('click', (ev) => {
      ev.stopPropagation();
      recordHistory();
      node.locked = false;
      render();
      showToast('🔓 ロックを解除しました');
    });
    g.appendChild(lockBadge);
  }

  // 5. リンクボタン
  if (node.linkTargetNodeId) {
    const targetInfo = findNodeAcrossProject(node.linkTargetNodeId);
    let targetName = 'リンク切れ';
    if (targetInfo) {
      const baseName = targetInfo.node.text || targetInfo.node.id;
      if (node.linkTargetMethodId && Array.isArray(targetInfo.node.methods)) {
        const mtd = targetInfo.node.methods.find(m => m.id === node.linkTargetMethodId);
        targetName = mtd ? `${baseName}::${mtd.memberName || mtd.name}()` : baseName;
      } else {
        targetName = baseName;
      }
    }

    const linkG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    linkG.setAttribute('transform', `translate(6, ${node.height - 24})`);
    linkG.style.cursor = 'pointer';

    const shortLabel = targetName.length > 14 ? targetName.slice(0, 14) + '…' : targetName;
    const badgeW = Math.min(node.width - 12, Math.max(72, shortLabel.length * 9 + 28));
    const lBg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    lBg.setAttribute('width', badgeW);
    lBg.setAttribute('height', 19);
    lBg.setAttribute('rx', 5);
    lBg.setAttribute('fill', targetInfo ? '#7c3aed' : '#64748b');
    lBg.setAttribute('stroke', '#ffffff');
    lBg.setAttribute('stroke-width', '1');
    linkG.appendChild(lBg);

    const lTxt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    lTxt.setAttribute('x', 6);
    lTxt.setAttribute('y', 13);
    lTxt.setAttribute('fill', '#ffffff');
    lTxt.setAttribute('font-size', '10px');
    lTxt.setAttribute('font-weight', 'bold');
    lTxt.textContent = `🔗 ${shortLabel}`;
    linkG.appendChild(lTxt);

    const lTitle = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    lTitle.textContent = `クリックで「${targetName}」へすぐ移動`;
    linkG.appendChild(lTitle);

    linkG.addEventListener('mousedown', (ev) => ev.stopPropagation());
    linkG.addEventListener('click', (ev) => {
      ev.stopPropagation();
      jumpToLinkedNode(node.linkTargetNodeId, node.linkTargetMethodId);
    });
    g.appendChild(linkG);
  }

  // 6. 矩形右上の内部階層移動バッジ
  if (!isContainer && !isMemo && !isClass && !node.isParentProxy) {
    const childLayer = node.childLayerId ? projectData.layers[node.childLayerId] : null;
    const childCount = childLayer ? childLayer.nodes.filter(n => !n.isParentProxy).length : 0;

    const badgeG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    badgeG.setAttribute('transform', `translate(${node.width - 34}, 6)`);
    badgeG.style.cursor = 'pointer';

    const badgeBg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    badgeBg.setAttribute('width', 28);
    badgeBg.setAttribute('height', 20);
    badgeBg.setAttribute('rx', 5);
    badgeBg.setAttribute('fill', childCount > 0 ? '#2563eb' : '#475569');
    badgeBg.setAttribute('stroke', '#ffffff');
    badgeBg.setAttribute('stroke-width', '1');
    badgeG.appendChild(badgeBg);

    const badgeTxt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    badgeTxt.setAttribute('x', 14);
    badgeTxt.setAttribute('y', 14);
    badgeTxt.setAttribute('text-anchor', 'middle');
    badgeTxt.setAttribute('fill', '#ffffff');
    badgeTxt.setAttribute('font-size', '10px');
    badgeTxt.setAttribute('font-weight', 'bold');
    badgeTxt.textContent = childCount > 0 ? `${childCount}↗` : '↗';
    badgeG.appendChild(badgeTxt);

    badgeG.addEventListener('mousedown', (ev) => ev.stopPropagation());
    badgeG.addEventListener('click', (ev) => {
      ev.stopPropagation();
      enterNodeLayer(node.id);
    });
    g.appendChild(badgeG);
  }

  g.addEventListener('mouseenter', () => {
    if (mode === 'none' && hoveredNodeId !== node.id) {
      hoveredNodeId = node.id;
      render();
    }
  });
  g.addEventListener('mouseleave', () => {
    if (mode === 'none' && hoveredNodeId === node.id) {
      hoveredNodeId = null;
      render();
    }
  });

  g.addEventListener('mousedown', (ev) => {
    if (ev.button !== 0) return;
    ev.stopPropagation();
    hideContextMenu();
    hideNearbyPicker();
    commitInlineEdit();

    const now = Date.now();
    if (lastClickInfo.id === node.id && (now - lastClickInfo.time) < 350) {
      lastClickInfo = { id: null, time: 0 };
      const worldPt = screenToWorld(ev.clientX, ev.clientY);
      const nearbyItems = findNearbyObjects(worldPt.x, worldPt.y, 75);
      const hasEdgesNearby = nearbyItems.some(item => item.kind === 'edge');
      if (hasEdgesNearby) {
        openNearbyPicker(ev.clientX, ev.clientY, nearbyItems, node);
        return;
      }
      if (isNodeLocked(node)) {
        showToast(node.isParentProxy ? '🔒 親階層ノードは編集できません' : '🔒 ロック中です (Ctrl+Lで解除)');
        return;
      }
      startInlineEdit(node);
      return;
    }
    lastClickInfo = { id: node.id, time: now };

    if (!selectedNodeIds.has(node.id)) {
      if (!ev.shiftKey) selectedNodeIds.clear();
      selectedNodeIds.add(node.id);
    }
    selectedEdgeId = null;

    if (isNodeLocked(node)) {
      render();
      return;
    }

    dragSnapshotBefore = cloneState(projectData);
    mode = 'dragNodes';
    primaryDragNodeId = node.id;
    dragStartWorld = screenToWorld(ev.clientX, ev.clientY);
    initialNodeStates.clear();

    const layer = currentLayer();
    const movingIds = new Set();

    selectedNodeIds.forEach(id => {
      const n = layer.nodes.find(item => item.id === id);
      if (n && !isNodeLocked(n)) {
        movingIds.add(n.id);
        if (n.type === 'container') {
          layer.nodes.filter(ch => ch.parentGroupId === n.id && !isNodeLocked(ch)).forEach(ch => {
            movingIds.add(ch.id);
            layer.nodes.filter(m => m.type === 'memo' && m.parentObjectType === 'node' && m.parentObjectId === ch.id && !isNodeLocked(m))
              .forEach(m => movingIds.add(m.id));
          });
        }
        layer.nodes.filter(m => m.type === 'memo' && m.parentObjectType === 'node' && m.parentObjectId === n.id && !isNodeLocked(m))
          .forEach(m => movingIds.add(m.id));
      }
    });

    movingIds.forEach(id => {
      const n = layer.nodes.find(item => item.id === id);
      if (n) initialNodeStates.set(id, { x: n.x, y: n.y, width: n.width, height: n.height });
    });

    render();
  });

  return g;
}

// クラスノード内の各変数・関数行：クリックするだけで直接入力・Tab移動・Enterで次行追加できるDOM
function createClassMemberRowDOM(classNode, member, kind, locked) {
  const isMethod = (kind === 'method');
  normalizeClassMember(member, isMethod);

  const row = document.createElement('div');
  row.className = 'cls-gui-member-row';
  if (isMethod && highlightedMethodId === member.id) {
    row.classList.add('method-highlight');
  }

  // 1. アクセス修飾子バッジ (+ / - / #) ワンクリック切替
  const accBtn = document.createElement('span');
  accBtn.className = 'cls-gui-access-btn';
  accBtn.textContent = ACCESS_SYMBOLS[member.access] || '+';
  accBtn.title = `アクセス修飾子: ${member.access} (クリックで + / - / # 切替)`;
  if (!locked) {
    accBtn.addEventListener('mousedown', (ev) => ev.stopPropagation());
    accBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      recordHistory();
      const idx = ACCESS_ORDER.indexOf(member.access || 'public');
      member.access = ACCESS_ORDER[(idx + 1) % ACCESS_ORDER.length];
      member.name = isMethod ? formatClassMethod(member) : formatClassField(member);
      render();
    });
  }
  row.appendChild(accBtn);

  const selectThisClass = (ev) => {
    ev.stopPropagation();
    if (!selectedNodeIds.has(classNode.id)) {
      selectedNodeIds.clear();
      selectedNodeIds.add(classNode.id);
      selectedEdgeId = null;
      updatePropertyPanel();
    }
  };

  // 2. 名前入力欄 (変数名 or 関数名)
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'cls-inline-input cls-inline-name';
  nameInput.setAttribute('data-member-name', member.id);
  nameInput.value = member.memberName || '';
  nameInput.placeholder = isMethod ? '関数名' : '変数名';
  nameInput.disabled = locked;
  nameInput.addEventListener('mousedown', selectThisClass);
  nameInput.addEventListener('change', () => {
    recordHistory();
    member.memberName = nameInput.value.trim() || (isMethod ? 'Method' : 'field');
    member.name = isMethod ? formatClassMethod(member) : formatClassField(member);
    render();
  });

  if (isMethod) {
    // 関数の場合： name ( args ) : returnType
    const lp = document.createElement('span');
    lp.className = 'cls-sep';
    lp.textContent = '(';

    const argsInput = document.createElement('input');
    argsInput.type = 'text';
    argsInput.className = 'cls-inline-input cls-inline-args';
    argsInput.value = member.args || '';
    argsInput.placeholder = '引数';
    argsInput.title = '引数 (例: power: int)';
    argsInput.disabled = locked;
    argsInput.addEventListener('mousedown', selectThisClass);
    argsInput.addEventListener('change', () => {
      recordHistory();
      member.args = argsInput.value.trim();
      member.name = formatClassMethod(member);
      render();
    });

    const rp = document.createElement('span');
    rp.className = 'cls-sep';
    rp.textContent = '):';

    const typeInput = document.createElement('input');
    typeInput.type = 'text';
    typeInput.className = 'cls-inline-input cls-inline-type';
    typeInput.setAttribute('list', 'type-suggestions');
    typeInput.value = member.returnType || 'void';
    typeInput.placeholder = '戻り値型';
    typeInput.disabled = locked;
    typeInput.addEventListener('mousedown', selectThisClass);
    typeInput.addEventListener('change', () => {
      recordHistory();
      member.returnType = typeInput.value.trim() || 'void';
      member.name = formatClassMethod(member);
      render();
    });

    // Enterキーで次の関数を連続追加
    const handleMethodEnter = (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        member.memberName = nameInput.value.trim() || 'Method';
        member.args = argsInput.value.trim();
        member.returnType = typeInput.value.trim() || 'void';
        member.name = formatClassMethod(member);
        quickAddClassMemberOnCanvas(classNode, 'method');
      }
    };
    nameInput.addEventListener('keydown', handleMethodEnter);
    argsInput.addEventListener('keydown', handleMethodEnter);
    typeInput.addEventListener('keydown', handleMethodEnter);

    row.appendChild(nameInput);
    row.appendChild(lp);
    row.appendChild(argsInput);
    row.appendChild(rp);
    row.appendChild(typeInput);
  } else {
    // 変数の場合： name : dataType
    const colon = document.createElement('span');
    colon.className = 'cls-sep';
    colon.textContent = ':';

    const typeInput = document.createElement('input');
    typeInput.type = 'text';
    typeInput.className = 'cls-inline-input cls-inline-type';
    typeInput.setAttribute('list', 'type-suggestions');
    typeInput.value = member.dataType || 'int';
    typeInput.placeholder = '型';
    typeInput.disabled = locked;
    typeInput.addEventListener('mousedown', selectThisClass);
    typeInput.addEventListener('change', () => {
      recordHistory();
      member.dataType = typeInput.value.trim() || 'int';
      member.name = formatClassField(member);
      render();
    });

    // Enterキーで次の変数を連続追加、Backspace空欄で削除
    const handleFieldKey = (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        member.memberName = nameInput.value.trim() || 'field';
        member.dataType = typeInput.value.trim() || 'int';
        member.name = formatClassField(member);
        quickAddClassMemberOnCanvas(classNode, 'field');
      }
    };
    nameInput.addEventListener('keydown', handleFieldKey);
    typeInput.addEventListener('keydown', handleFieldKey);

    row.appendChild(nameInput);
    row.appendChild(colon);
    row.appendChild(typeInput);
  }

  // 3. 削除ボタン (✕)
  if (!locked) {
    const delBtn = document.createElement('button');
    delBtn.className = 'cls-gui-del-btn';
    delBtn.textContent = '✕';
    delBtn.title = 'この行を削除';
    delBtn.addEventListener('mousedown', (ev) => ev.stopPropagation());
    delBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      recordHistory();
      if (isMethod) {
        classNode.methods = (classNode.methods || []).filter(m => m.id !== member.id);
      } else {
        classNode.fields = (classNode.fields || []).filter(f => f.id !== member.id);
      }
      render();
    });
    row.appendChild(delBtn);
  }

  return row;
}

function jumpToLinkedNode(targetNodeId, targetMethodId = null) {
  const found = findNodeAcrossProject(targetNodeId);
  if (!found) {
    showToast('⚠️ リンク先のオブジェクトが見つかりません');
    return;
  }
  if (projectData.currentLayerId !== found.layer.id) {
    if (projectData.currentLayerId !== CLASS_LAYER_ID) {
      lastFlowLayerId = projectData.currentLayerId;
    }
    projectData.currentLayerId = found.layer.id;
  }
  const rect = svg.getBoundingClientRect();
  zoom = 1;
  panX = Math.round(rect.width / 2 - (found.node.x + found.node.width / 2) * zoom);
  panY = Math.round(rect.height / 2 - (found.node.y + found.node.height / 2) * zoom);

  selectedNodeIds.clear();
  selectedNodeIds.add(found.node.id);
  selectedEdgeId = null;
  highlightedNodeId = found.node.id;
  highlightedMethodId = targetMethodId || null;
  render();

  let msg = `🔗 「${found.node.text || found.node.id}」へ移動しました`;
  if (targetMethodId && Array.isArray(found.node.methods)) {
    const m = found.node.methods.find(item => item.id === targetMethodId);
    if (m) msg = `🔗 クラス関数「${found.node.text}::${m.memberName || m.name}()」へ移動しました`;
  }
  showToast(msg);

  setTimeout(() => {
    if (highlightedNodeId === found.node.id) {
      highlightedNodeId = null;
      highlightedMethodId = null;
      render();
    }
  }, 2600);
}

function createResizeHandlesSVG(node) {
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  const handles = [
    { dir: 'nw', x: node.x, y: node.y, cursor: 'nwse-resize' },
    { dir: 'n',  x: node.x + node.width / 2, y: node.y, cursor: 'ns-resize' },
    { dir: 'ne', x: node.x + node.width, y: node.y, cursor: 'nesw-resize' },
    { dir: 'e',  x: node.x + node.width, y: node.y + node.height / 2, cursor: 'ew-resize' },
    { dir: 'se', x: node.x + node.width, y: node.y + node.height, cursor: 'nwse-resize' },
    { dir: 's',  x: node.x + node.width / 2, y: node.y + node.height, cursor: 'ns-resize' },
    { dir: 'sw', x: node.x, y: node.y + node.height, cursor: 'nesw-resize' },
    { dir: 'w',  x: node.x, y: node.y + node.height / 2, cursor: 'ew-resize' }
  ];

  handles.forEach(h => {
    const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    r.setAttribute('x', h.x - 4.5);
    r.setAttribute('y', h.y - 4.5);
    r.setAttribute('width', 9);
    r.setAttribute('height', 9);
    r.setAttribute('fill', '#ffffff');
    r.setAttribute('stroke', '#2563eb');
    r.setAttribute('stroke-width', '2');
    r.style.cursor = h.cursor;

    r.addEventListener('mousedown', (ev) => {
      if (ev.button !== 0 || isNodeLocked(node)) return;
      ev.stopPropagation();
      commitInlineEdit();
      dragSnapshotBefore = cloneState(projectData);
      mode = 'resize';
      activeResize = { nodeId: node.id, dir: h.dir };
      dragStartWorld = screenToWorld(ev.clientX, ev.clientY);
      initialNodeStates.clear();
      initialNodeStates.set(node.id, { x: node.x, y: node.y, width: node.width, height: node.height });
    });
    g.appendChild(r);
  });
  return g;
}

function createOuterPortsAndQuickCreateSVG(node) {
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  const portOffset = 18;
  const createOffset = 38;

  const dirs = [
    {
      key: 'top',
      bx: node.x + node.width / 2, by: node.y,
      px: node.x + node.width / 2, py: node.y - portOffset,
      cx: node.x + node.width / 2, cy: node.y - createOffset
    },
    {
      key: 'right',
      bx: node.x + node.width, by: node.y + node.height / 2,
      px: node.x + node.width + portOffset, py: node.y + node.height / 2,
      cx: node.x + node.width + createOffset, cy: node.y + node.height / 2
    },
    {
      key: 'bottom',
      bx: node.x + node.width / 2, by: node.y + node.height,
      px: node.x + node.width / 2, py: node.y + node.height + portOffset,
      cx: node.x + node.width / 2, cy: node.y + node.height + createOffset
    },
    {
      key: 'left',
      bx: node.x, by: node.y + node.height / 2,
      px: node.x - portOffset, py: node.y + node.height / 2,
      cx: node.x - createOffset, cy: node.y + node.height / 2
    }
  ];

  dirs.forEach(d => {
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', d.bx);
    line.setAttribute('y1', d.by);
    line.setAttribute('x2', d.cx);
    line.setAttribute('y2', d.cy);
    line.setAttribute('stroke', '#93c5fd');
    line.setAttribute('stroke-width', '1.5');
    line.setAttribute('stroke-dasharray', '2,2');
    g.appendChild(line);

    const portCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    portCircle.setAttribute('cx', d.px);
    portCircle.setAttribute('cy', d.py);
    portCircle.setAttribute('r', 5.5);
    portCircle.setAttribute('fill', '#3b82f6');
    portCircle.setAttribute('stroke', '#ffffff');
    portCircle.setAttribute('stroke-width', '2');
    portCircle.style.cursor = 'crosshair';

    portCircle.addEventListener('mousedown', (ev) => {
      if (ev.button !== 0) return;
      ev.stopPropagation();
      commitInlineEdit();
      const pt = screenToWorld(ev.clientX, ev.clientY);
      mode = 'connect';
      activeConnect = { sourceId: node.id, sourcePort: d.key, currentX: pt.x, currentY: pt.y };
    });
    g.appendChild(portCircle);

    const createGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    createGroup.setAttribute('transform', `translate(${d.cx}, ${d.cy})`);
    createGroup.style.cursor = 'pointer';

    const createCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    createCircle.setAttribute('r', 8);
    createCircle.setAttribute('fill', '#10b981');
    createCircle.setAttribute('stroke', '#ffffff');
    createCircle.setAttribute('stroke-width', '2');
    createGroup.appendChild(createCircle);

    const plusTxt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    plusTxt.setAttribute('x', 0);
    plusTxt.setAttribute('y', 4);
    plusTxt.setAttribute('text-anchor', 'middle');
    plusTxt.setAttribute('fill', '#ffffff');
    plusTxt.setAttribute('font-size', '12px');
    plusTxt.setAttribute('font-weight', 'bold');
    plusTxt.style.pointerEvents = 'none';
    plusTxt.textContent = '+';
    createGroup.appendChild(plusTxt);

    createGroup.addEventListener('mousedown', (ev) => {
      if (ev.button !== 0) return;
      ev.stopPropagation();
      commitInlineEdit();
      const pt = screenToWorld(ev.clientX, ev.clientY);
      dragStartWorld = pt;
      mode = 'quickCreate';
      activeConnect = { sourceId: node.id, sourcePort: d.key, currentX: pt.x, currentY: pt.y };
    });

    g.appendChild(createGroup);
  });
  return g;
}

function createEdgeSVG(edge) {
  const layer = currentLayer();
  const src = layer.nodes.find(n => n.id === edge.source);
  const tgt = layer.nodes.find(n => n.id === edge.target);
  if (!src || !tgt) return null;

  const p1 = getPortCoords(src, edge.sourcePort);
  const p2 = getPortCoords(tgt, edge.targetPort);
  const d = computeCurvePath(p1.x, p1.y, p2.x, p2.y, edge.sourcePort, edge.targetPort);
  const isSelected = selectedEdgeId === edge.id;
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
  path.setAttribute('stroke', isSelected ? '#3b82f6' : (edge.color || '#475569'));
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
    txt.textContent = edge.label;
    g.appendChild(txt);
  }

  if (isSelected) {
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

function enterNodeLayer(nodeId) {
  commitInlineEdit();
  const layer = currentLayer();
  const node = layer.nodes.find(n => n.id === nodeId);
  if (!node || node.type === 'container' || node.type === 'memo' || node.type === 'class' || node.isParentProxy) return;

  recordHistory();
  if (!node.childLayerId || !projectData.layers[node.childLayerId]) {
    const newLayerId = uid('layer');
    node.childLayerId = newLayerId;
    projectData.layers[newLayerId] = {
      id: newLayerId,
      name: node.text || 'サブ階層',
      parentLayerId: layer.id,
      parentNodeId: node.id,
      nodes: [],
      edges: []
    };
  }
  ensureParentProxyNode(projectData.layers[node.childLayerId]);
  switchLayer(node.childLayerId, false);
}

function switchLayer(layerId, saveHist = true) {
  if (!projectData.layers[layerId]) return;
  if (projectData.currentLayerId !== CLASS_LAYER_ID && layerId === CLASS_LAYER_ID) {
    lastFlowLayerId = projectData.currentLayerId;
  }
  if (saveHist && projectData.currentLayerId !== layerId) recordHistory();
  projectData.currentLayerId = layerId;
  ensureParentProxyNode(projectData.layers[layerId]);
  selectedNodeIds.clear();
  selectedEdgeId = null;
  hoveredNodeId = null;
  panX = 0; panY = 0; zoom = 1;
  render();
}

function renderBreadcrumbs() {
  const container = document.getElementById('breadcrumbs');
  container.innerHTML = '';
  if (isClassMode()) {
    const sp = document.createElement('span');
    sp.className = 'crumb active';
    sp.textContent = '🧩 クラス図 (文字クリックで直接入力 / Enterで連続追加 / 右パネルでテキスト一括編集)';
    container.appendChild(sp);
    return;
  }

  const path = [];
  let curr = currentLayer();
  while (curr) {
    path.unshift(curr);
    curr = curr.parentLayerId ? projectData.layers[curr.parentLayerId] : null;
  }
  path.forEach((l, idx) => {
    const sp = document.createElement('span');
    sp.className = 'crumb' + (idx === path.length - 1 ? ' active' : '');
    sp.textContent = l.name || '無題の階層';
    if (idx < path.length - 1) {
      sp.addEventListener('click', () => switchLayer(l.id));
    }
    container.appendChild(sp);
    if (idx < path.length - 1) {
      const sep = document.createElement('span');
      sep.style.color = '#64748b';
      sep.textContent = '›';
      container.appendChild(sep);
    }
  });
}

function renderLayerTree() {
  const treeEl = document.getElementById('layer-tree');
  treeEl.innerHTML = '';

  const clsLayer = projectData.layers[CLASS_LAYER_ID];
  if (clsLayer) {
    const clsItem = document.createElement('div');
    clsItem.className = 'tree-item' + (isClassMode() ? ' active' : '');
    clsItem.style.marginBottom = '6px';
    clsItem.style.border = '1px solid #4c1d95';
    clsItem.innerHTML = `<span>🧩 クラス図</span><span style="font-size:10px; color:#c4b5fd;">${clsLayer.nodes.length}</span>`;
    clsItem.addEventListener('click', () => switchLayer(CLASS_LAYER_ID));
    treeEl.appendChild(clsItem);
  }

  function buildTree(layerId, depth) {
    const l = projectData.layers[layerId];
    if (!l || l.isClassDiagram) return;
    const realCount = l.nodes.filter(n => !n.isParentProxy).length;
    const item = document.createElement('div');
    item.className = 'tree-item' + (projectData.currentLayerId === layerId ? ' active' : '');
    item.style.paddingLeft = `${8 + depth * 14}px`;
    item.innerHTML = `<span>📁 ${l.name || '無題の階層'}</span><span style="font-size:10px; color:#9ca3af;">${realCount}</span>`;
    item.addEventListener('click', () => switchLayer(layerId));
    treeEl.appendChild(item);

    l.nodes.forEach(n => {
      if (n.childLayerId && projectData.layers[n.childLayerId]) {
        buildTree(n.childLayerId, depth + 1);
      }
    });
  }
  buildTree('root', 0);
}