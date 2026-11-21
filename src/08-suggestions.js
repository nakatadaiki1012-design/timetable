  /* =======================
     Drag Preview (v34.3)
  ======================= */




  function renderStock() {
    const list = $('#stock-list'); if (!list) return;
    const showPlaced = !!state.ui.showPlaced;
    const q = (state.ui.stockSearch || '').trim();
    const byDept = !!state.ui.groupStock; // v32.2: "教科順"
    const idsAll = Object.keys(state.items).filter(id => {
      const plc = state.placements[id];
      if (!showPlaced && plc) return false;
      const it = state.items[id];
      const blob = `${it.subj} ${it.cls.join(' ')} ${it.teas.join(' ')} ${it.rooms.join(' ')} ${(state.subjectCfg[it.subjKey]?.dept) || ''}`;
      return !q || blob.includes(q);
    });

    $('#stock-count').textContent = String(idsAll.length);
    list.innerHTML = '';

    // sort helpers
    const deptOf = (id) => (state.subjectCfg[state.items[id]?.subjKey]?.dept) || '';
    const subjKeyOf = (id) => (state.items[id]?.subjKey) || '';
    const clsOf = (id) => (state.items[id]?.cls || []).join(',');
    const key = (id) => `${subjKeyOf(id)}${clsOf(id)}${id}`;
    // 教科の並びは教員の「教科順」と同じ（国語→地歴→公民→数学→情報→理科→保健体育→芸術→外国語→家庭→その他→未設定）
    const deptRankOf = (id) => {
      const d = canonicalDept(deptOf(id));
      const i = TEACHER_DEPT_ORDER.indexOf(d === '社会' ? '地歴' : d);
      return i >= 0 ? i : (deptOf(id) ? 100 : 200);
    };
    const ids = idsAll.slice().sort((a, b) => (deptRankOf(a) - deptRankOf(b)) || deptOf(a).localeCompare(deptOf(b), 'ja') || key(a).localeCompare(key(b), 'ja'));

    if (!byDept) {
      ids.forEach(id => list.appendChild(stockItemEl(id)));
      _initBlockerAnalysis();
      return;
    }

    // Insert dept separators that span columns (no collapsible)
    let curDept = null;
    let cntDept = 0;
    const flush = () => {
      if (curDept == null) return;
      // update last sep count if needed (already set when created)
    };

    const deptCounts = new Map();
    ids.forEach(id => deptCounts.set(deptOf(id) || '（未設定）', (deptCounts.get(deptOf(id) || '（未設定）') || 0) + 1));

    for (const id of ids) {
      const d = deptOf(id) || '（未設定）';
      if (d !== curDept) {
        curDept = d;
        const sep = document.createElement('div');
        sep.className = 'stock-sep';
        // 教科の未配置コマ数を取得
        const unplacedInDept = ids.filter(x => deptOf(x) === d && !state.placements[x]).length;
        sep.innerHTML = `<span>${escapeHtml(d)}</span><span class="cnt">${deptCounts.get(d)}</span>${unplacedInDept > 0 ? `<button class="stock-sep-ai-btn" data-dept="${escapeAttr(d)}" title="${unplacedInDept}コマをAI配置">🤖</button>` : ''}`;
        sep.querySelector('.stock-sep-ai-btn')?.addEventListener('click', (e) => {
          e.stopPropagation();
          const targetIds = ids.filter(x => deptOf(x) === d && !state.placements[x]);
          if (!targetIds.length) { flash('未配置なし'); return; }
          aiPlaceSelected(new Set(targetIds));
        });
        list.appendChild(sep);
      }
      list.appendChild(stockItemEl(id));
    }
    // v48: イベント委譲でバッジクリックを処理
    _initBlockerAnalysis();
    // v49 B-1: 進捗バー更新
    try { updatePlacementProgress(); } catch (e) { }
  }

  function stockItemEl(id) {
    const it = state.items[id];
    const plc = state.placements[id];
    const scfg = state.subjectCfg[it.subjKey] || {};
    const color = getItemDisplayColor(id);
    // Abbreviation: up to 3 characters
    const rawAbbr = scfg.abbr || it.subj || '';
    const abbr3 = rawAbbr.slice(0, 3);
    const tea = it.teas.map(t => state.teacherCfg[t]?.abbr || normalizeAbbr(t, 8) || t).join(',');
    const cls = it.cls.join(',');
    const room = it.rooms.join(',');
    const el = document.createElement('div');
    const _isMultiSel = state.ui.stockMultiSel instanceof Set && state.ui.stockMultiSel.has(id);
    el.className = 'stock-item'
      + (state.ui.selectedId === id ? ' selected' : '')
      + (_isMultiSel ? ' stock-multi-sel' : '');
    el.draggable = true;
    el.dataset.id = id;
    el.style.borderLeft = `6px solid ${color}`;
    el.style.background = hexWithAlpha(color, 0.07);

    // Placement text
    let placeText, placeClass;
    if (plc) {
      const span2 = it.span === 2 ? `-${plc.period + 1}` : '';
      placeText = `${DAYJP[plc.day]}${plc.period}${span2}`;
      if (plc.locked) placeText += ' 🔒';
      placeClass = '';
    } else {
      placeText = '未配置';
      placeClass = 'unplaced';
    }

    // v46-C1: 配置可能性バッジ（未配置コマのみ）
    let placeabilityBadge = '';
    if (!plc) {
      try {
        const slotCount = _countValidSlots(id);
        if (slotCount === 0) {
          placeabilityBadge = `<span class="si-slot-badge slot-ng" title="配置できる枠がありません！クリックで原因分析" data-blocker-id="${id}" style="cursor:pointer">🚫 0</span>`;
        } else if (slotCount <= 2) {
          placeabilityBadge = `<span class="si-slot-badge slot-warn" title="${slotCount}枠のみ配置可能（クリックで原因分析）" data-blocker-id="${id}" style="cursor:pointer">⚠${slotCount}</span>`;
        } else if (slotCount <= 9) {
          placeabilityBadge = `<span class="si-slot-badge slot-caution" title="${slotCount}枠に配置可能">△${slotCount}</span>`;
        } else {
          placeabilityBadge = `<span class="si-slot-badge slot-ok" title="${slotCount}枠に配置可能">✓${slotCount}</span>`;
        }
      } catch (e) { placeabilityBadge = ''; }
    }

    // v49 B-4: 配置済みコマの違反チェック
    let stockVio = '';
    if (plc?.day) { try { stockVio = violationSummary(id) || ''; } catch (e) { } }

    el.innerHTML = `
    <div class="si-name">${escapeHtml(abbr3)}</div>
    <div class="si-chips">
      <span class="chip si-cls">${escapeHtml(cls.slice(0, 12))}</span>
      ${tea ? `<span class="chip si-tea">${escapeHtml(tea.slice(0, 10))}</span>` : ''}
      ${it.span === 2 ? `<span class="chip chip-span">2連</span>` : ''}
    </div>
    <div class="si-place-row">
      <div class="si-place ${placeClass}">${escapeHtml(placeText)}</div>
      ${stockVio ? `<span class="vio-badge" title="${escapeHtml(stockVio)}">⚠</span>` : ''}
      ${placeabilityBadge}
    </div>
  `;
    el.ondragstart = (ev) => {
      window._currentDragId = id;
      window._dragPending = true;
      ev.dataTransfer.setData('text/plain', id);
      try { ev.dataTransfer.setData('id', id); } catch { }
      ev.dataTransfer.effectAllowed = 'move';
      setTimeout(() => highlightValidSlots(id), 0); // v42: DOM変更をdragstart後に遅延（ドラッグ壊れ対策）
    };
    el.ondragend = () => {
      window._dragPending = false;
      setTimeout(() => { if (!window._dragPending) window._currentDragId = null; }, 100);
    };
    el.onclick = (ev) => {
      if (ev.ctrlKey || ev.metaKey) {
        // CTRL+クリック: 複数選択（toggleで追加/除去）
        const sel = state.ui.stockMultiSel = state.ui.stockMultiSel || new Set();
        if (sel.has(id)) { sel.delete(id); } else { sel.add(id); }
        el.classList.toggle('stock-multi-sel', sel.has(id));
        // ツールバーを更新
        _updateStockMultiBar();
        return;
      }
      // 通常クリック: 単一選択
      if (state.ui.stockMultiSel?.size) { state.ui.stockMultiSel.clear(); document.querySelectorAll('.stock-multi-sel').forEach(e => e.classList.remove('stock-multi-sel')); _updateStockMultiBar(); }
      selectId(id, 'stock');
    };
    el.ondblclick = (ev) => {
      ev.preventDefault();
      selectId(id, 'stock');
      const plc = state.placements[id];

      // v62.5: 在庫(未配置)のダブルクリックは「提案」を優先（Alt+ダブルクリックで即配置）
      if (ev.altKey && !plc?.day) {
        quickAutoPlace(id);
        return;
      }
      openPropSuggestions(id);

      // v62.5: 教員一覧（全授業）を開いている/教員軸のときは、その教員が見える位置へスクロール
      try {
        const it = state.items[id];
        const teaRaw = (it?.teas || [])[0];
        if (teaRaw) {
          const teaKey = resolveAxisKey('teacher', teaRaw);
          if (state.ui.viewMode === 'teacher') scrollMainRowIntoView('teacher', teaKey);
          scrollAllWindowToKey('teacher', teaKey);
        }
      } catch (e) { }
    };
    el.oncontextmenu = (ev) => {
      ev.preventDefault();
      const it2 = state.items[id];
      const abbr2 = (state.subjectCfg[it2?.subjKey]?.abbr || it2?.subj || id).slice(0, 12);
      const plc2 = state.placements[id];
      showCtxMenu([
        { muted: true, label: abbr2 },
        ...(plc2?.day ? [{ label: '在庫へ', act: 'to_stock', on: () => toStock(id) }] : []),
        { label: '削除（在庫から除去）', act: 'del_stock', on: () => {
          pushHistory('delStock');
          if (plc2?.day) toStock(id);
          delete state.items[id];
          delete state.placements[id];
          markDirty('items');
          rerenderAll();
        }},
        { label: 'コピー（複製）', act: 'copy', on: () => copyItem(id) },
        { label: '提案を開く', act: 'sug', on: () => openPropSuggestions(id) },
        { sep: true },
        { label: '選択', act: 'sel', on: () => selectId(id, 'stock') },
      ], ev.clientX, ev.clientY);
    };
    // hover tip
    el.onmouseenter = (ev) => {
      try { showHoverTip(itemDetailText(id), ev.clientX, ev.clientY); } catch { }
      try { highlightRelated(id, true); } catch { }
    };
    el.onmousemove = (ev) => { try { showHoverTip(itemDetailText(id), ev.clientX, ev.clientY); } catch { } };
    el.onmouseleave = () => {
      hideHoverTip();
      try { highlightRelated(id, false); } catch { }
    };
    return el;
  }

  /* v48: 配置不能コマ原因分析 - イベント委譲 */
  function _initBlockerAnalysis() {
    const list = document.getElementById('stock-list');
    if (!list || list._blockerBound) return;
    list._blockerBound = true;
    list.addEventListener('click', (ev) => {
      const badge = ev.target.closest('[data-blocker-id]');
      if (!badge) return;
      ev.stopPropagation();
      showBlockerAnalysis(badge.dataset.blockerId);
    });
  }

  function showBlockerAnalysis(id) {
    const it = state.items[id]; if (!it) return;
    const scfg = state.subjectCfg[it.subjKey] || {};
    const abbr = scfg.abbr || it.subj || id;

    // 全スロットをチェックして制約カテゴリ別集計
    const savedPlc = state.placements[id];
    state.placements[id] = null;
    invalidateIndex();

    const blockerMap = {}; // blockType -> count
    const slotDetails = []; // {day, p, blocks[], warns[]}

    for (const day of DAYS) {
      const maxP = maxPeriod(day);
      for (let p = 1; p <= maxP; p++) {
        if (it.span === 2 && p === maxP) continue;
        const v = validatePlacement(id, day, p, 'safe', null);
        if (v.blocks.length || v.warns.length) {
          for (const b of v.blocks) {
            // カテゴリ分類
            const cat = b.startsWith('固定禁則') ? '固定禁則'
              : b.startsWith('教員不可') ? '教員不可'
                : b.startsWith('教員重複') ? '教員重複'
                  : b.startsWith('クラス重複') ? 'クラス重複'
                    : b.startsWith('教室重複') ? '教室重複'
                      : b.startsWith('クラス時限上限') ? 'クラス時限超過'
                        : 'その他';
            blockerMap[cat] = (blockerMap[cat] || 0) + 1;
          }
          slotDetails.push({ day, p, blocks: v.blocks, warns: v.warns });
        }
      }
    }

    state.placements[id] = savedPlc;
    invalidateIndex();

    const totalSlots = DAYS.reduce((s, d) => s + maxPeriod(d), 0) - (it.span === 2 ? DAYS.length : 0);
    const blockedCount = slotDetails.filter(s => s.blocks.length).length;
    const warnOnly = slotDetails.filter(s => !s.blocks.length && s.warns.length).length;
    const freeCount = totalSlots - blockedCount - warnOnly;

    // カテゴリ別サマリ
    const catRows = Object.entries(blockerMap).sort((a, b) => b[1] - a[1])
      .map(([cat, cnt]) => `<div class="blocker-cat-row">
      <span class="blocker-cat-name">${escapeHtml(cat)}</span>
      <div class="blocker-cat-bar"><div class="blocker-cat-fill" style="width:${Math.round(cnt / totalSlots * 100)}%"></div></div>
      <span class="blocker-cat-cnt">${cnt}コマ</span>
    </div>`).join('');

    // スロット詳細グリッド (曜日×時限)
    const maxP2 = Math.max(...DAYS.map(d => maxPeriod(d)));
    let gridHTML = `<table class="blocker-grid"><thead><tr><th></th>`;
    for (const d of DAYS) gridHTML += `<th>${DAYJP[d]}</th>`;
    gridHTML += `</tr></thead><tbody>`;
    for (let p = 1; p <= maxP2; p++) {
      gridHTML += `<tr><th>${p}</th>`;
      for (const day of DAYS) {
        if (p > maxPeriod(day)) { gridHTML += `<td class="blocker-cell-off"></td>`; continue; }
        if (it.span === 2 && p === maxPeriod(day)) { gridHTML += `<td class="blocker-cell-off" title="2連は最終時限不可">—</td>`; continue; }
        const slot = slotDetails.find(s => s.day === day && s.p === p);
        if (!slot) { gridHTML += `<td class="blocker-cell-ok" title="◎ 配置可">◎</td>`; continue; }
        if (slot.blocks.length) {
          const tip = slot.blocks[0];
          gridHTML += `<td class="blocker-cell-ng" title="${escapeHtml(tip)}">✗</td>`;
        } else {
          gridHTML += `<td class="blocker-cell-warn" title="${escapeHtml(slot.warns[0] || '')}">△</td>`;
        }
      }
      gridHTML += `</tr>`;
    }
    gridHTML += `</tbody></table>`;

    const html = `
    <div class="blocker-wrap">
      <div class="blocker-summary">
        <span class="blocker-stat ok-stat">◎ 配置可: ${freeCount}</span>
        <span class="blocker-stat warn-stat">△ 警告あり: ${warnOnly}</span>
        <span class="blocker-stat ng-stat">✗ 不可: ${blockedCount}</span>
      </div>
      ${Object.keys(blockerMap).length ? `<div class="blocker-cats">${catRows}</div>` : ''}
      <div class="blocker-hint">◎=配置可  △=警告あり  ✗=配置不可（セルにカーソルで詳細）</div>
      ${gridHTML}
    </div>`;

    showModalHTML(`🔍 原因分析: 「${escapeHtml(abbr)}」${escapeHtml(it.cls.join(','))}`, html, null, '閉じる', '閉じる');
  }

  /* v47-B5: 在庫一括選択 */
  function _stockSelectAll(mode) {
    // 現在表示されているstock-itemを対象に選択
    const sel = state.ui.stockMultiSel = state.ui.stockMultiSel || new Set();
    const items = document.querySelectorAll('#stock-list .stock-item');
    if (!items.length) { flash('表示中のコマがありません'); return; }

    // modeに応じて対象を絞る
    let pivotSubjKey = null, pivotCls = null;
    const selId = state.ui.selectedId;
    if ((mode === 'dept' || mode === 'cls') && selId && state.items[selId]) {
      pivotSubjKey = state.items[selId].subjKey;
      pivotCls = (state.items[selId].cls || [])[0];
    }

    let added = 0;
    items.forEach(el => {
      const id = el.dataset.id; if (!id) return;
      const it = state.items[id]; if (!it) return;
      if (state.placements[id]) return; // 配置済みは除外

      if (mode === 'dept' && pivotSubjKey) {
        const scfg = state.subjectCfg[it.subjKey] || {};
        const pivotScfg = state.subjectCfg[pivotSubjKey] || {};
        if ((scfg.dept || it.subjKey) !== (pivotScfg.dept || pivotSubjKey)) return;
      }
      if (mode === 'cls' && pivotCls) {
        if (!(it.cls || []).includes(pivotCls)) return;
      }

      if (!sel.has(id)) { sel.add(id); el.classList.add('stock-multi-sel'); added++; }
    });

    if (added === 0 && mode !== 'displayed') {
      // 選択中コマがなければ全表示コマを選ぶ
      items.forEach(el => {
        const id = el.dataset.id; if (!id || state.placements[id]) return;
        if (!sel.has(id)) { sel.add(id); el.classList.add('stock-multi-sel'); added++; }
      });
    }
    _updateStockMultiBar();
    flash(added > 0 ? `${added}コマを追加選択` : '選択対象がありません');
  }

  /* v45: 在庫複数選択 (CTRL+クリック) */
  // v46-C1: 配置可能スロット数を高速カウント（インデックス利用）
  function _countValidSlots(id) {
    const it = state.items[id]; if (!it) return 0;
    const idx = buildIndex();
    const span = it.span || 1;
    let count = 0;
    for (const d of DAYS) {
      const maxP = maxPeriod(d);
      for (let p = 1; p <= maxP; p++) {
        if (span === 2 && p === maxP) continue;
        let ok = true;
        for (let dp = 0; dp < span && ok; dp++) {
          const pp = p + dp;
          if (pp > maxP) { ok = false; break; }
          if (isForbiddenForSubject(it.subjKey, d, pp)) { ok = false; break; }
          for (const t of it.teas || []) {
            if (isUnavailableForTeacher(t, d, pp)) { ok = false; break; }
            if ((idx.tea?.[t]?.[d]?.[pp] || []).length) { ok = false; break; }
            const maxD = teacherDailyMax(t);
            if (maxD != null && dp === 0) {
              let cnt = 0;
              for (let pp2 = 1; pp2 <= maxP; pp2++) if ((idx.tea?.[t]?.[d]?.[pp2] || []).length) cnt++;
              if (cnt + 1 > maxD) { ok = false; break; }
            }
          }
          for (const c of it.cls || []) {
            if ((idx.cls?.[c]?.[d]?.[pp] || []).length) { ok = false; break; }
          }
        }
        if (ok) count++;
      }
    }
    return count;
  }


  function _updateStockMultiBar() {
    const bar = document.getElementById('stock-multi-bar');
    const countEl = document.getElementById('stock-multi-count');
    const sel = state.ui.stockMultiSel;
    const n = sel?.size || 0;
    if (!bar) return;
    bar.style.display = n > 0 ? 'flex' : 'none';
    if (countEl) countEl.textContent = `${n}コマ選択中 (Ctrl+クリックで追加)`;
  }

  /* ─── F1: グリッド複数選択バー ─── */
  function _updateGridMultiBar() {
    const bar = document.getElementById('grid-multi-bar');
    const countEl = document.getElementById('grid-multi-count');
    const sel = state.ui.gridMultiSel;
    const n = sel?.size || 0;
    if (!bar) return;
    bar.style.display = n > 0 ? 'flex' : 'none';
    if (countEl) countEl.textContent = `${n}コマ選択中`;
  }
  function clearGridMultiSel() {
    if (state.ui.gridMultiSel) state.ui.gridMultiSel.clear();
    document.querySelectorAll('.grid-multi-sel').forEach(e => e.classList.remove('grid-multi-sel'));
    _updateGridMultiBar();
  }

  /* ─── F8: コピー（複製） ─── */
  function copyItem(id) {
    const it = state.items[id]; if (!it) return;
    pushHistory('copy');
    const newId = 'copy_' + id + '_' + Date.now().toString(36);
    state.items[newId] = deepClone(it);
    state.placements[newId] = null;
    markDirty('items');
    rerenderAll();
    flash(`📋 「${it.subj || it.subjKey}」を複製しました（在庫へ）`);
  }

  /* ─── F2: 履歴パネル ─── */
  function openHistoryPanel() {
    let panel = document.getElementById('history-panel');
    if (panel) { panel.classList.toggle('show'); return; }
    panel = document.createElement('div');
    panel.id = 'history-panel';
    panel.className = 'history-panel show';
    document.body.appendChild(panel);
    _renderHistoryPanel(panel);
  }
  function _renderHistoryPanel(panel) {
    const REASON_LABELS = {
      ai: 'AI配置', undo: 'Undo', redo: 'Redo', place: 'コマ配置',
      toStock: '在庫へ', swap: '入替', lock: 'ロック', delStock: '削除',
      copy: 'コピー', projectImport: '読込', 'ai-run': 'AI探索',
    };
    const rows = historyPast.map((_, i) => {
      const meta = historyMeta[i] || {};
      const label = REASON_LABELS[meta.reason] || meta.reason || '操作';
      const t = meta.time ? new Date(meta.time).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
      return `<div class="hist-row" data-idx="${i}"><span class="hist-label">${escapeHtml(label)}</span><span class="hist-time">${t}</span></div>`;
    }).reverse().join('') || '<div class="muted small" style="padding:8px">履歴なし</div>';
    panel.innerHTML = `
      <div class="hist-header"><strong>📜 操作履歴</strong>
        <span class="muted small" style="flex:1;text-align:right">${historyPast.length}件</span>
        <button id="hist-close" style="background:none;border:none;cursor:pointer;font-size:16px;color:#64748b">✕</button>
      </div>
      <div class="hist-note muted small">クリックでその時点に戻す</div>
      <div class="hist-body">${rows}</div>`;
    panel.querySelector('#hist-close').onclick = () => panel.classList.remove('show');
    panel.querySelectorAll('.hist-row').forEach(row => {
      row.onclick = () => {
        const idx = parseInt(row.dataset.idx, 10);
        // Undo to this index: pop until historyPast.length === idx+1
        const targetLen = historyPast.length - idx;
        for (let k = 0; k < targetLen - 1; k++) {
          const cur = snapshotForHistory();
          const prev = historyPast.pop(); historyMeta.pop();
          historyFuture.push(cur);
          restoreFromHistory(prev);
        }
        markDirty('history');
        rerenderAll();
        panel.classList.remove('show');
        flash(`↩ ${historyMeta[idx]?.reason || '操作'} へ戻しました`);
      };
    });
  }

  /* ─── F3: コマ検索ハイライト ─── */
  function applyItemSearchHighlight() {
    const q = (state.ui.itemSearchQuery || '').trim().toLowerCase();
    let count = 0;
    document.querySelectorAll('.lesson, .stock-item').forEach(el => {
      if (!q) { el.classList.remove('search-match', 'search-dim'); return; }
      const id = el.dataset.id;
      if (!id) return;
      const it = state.items[id];
      if (!it) return;
      const text = [it.subj, it.subjKey, ...(it.teas || []), ...(it.cls || []), ...(it.rooms || [])].join(' ').toLowerCase();
      const match = text.includes(q);
      el.classList.toggle('search-match', match);
      el.classList.toggle('search-dim', !match);
      if (match) count++;
    });
    const countEl = document.getElementById('item-search-count');
    if (countEl) countEl.textContent = q ? `${count}件` : '';
  }

  /* ─── F6: 制約オーバーレイ（配置可否） ─── */
  function applyConstraintOverlay() {
    const active = state.ui.constraintOverlay;
    const selId = state.ui.selectedId;
    // clear
    document.querySelectorAll('.slot-ok, .slot-ng').forEach(e => { e.classList.remove('slot-ok', 'slot-ng'); });
    if (!active || !selId) return;
    const it = state.items[selId]; if (!it) return;
    const idx = buildIndex();
    document.querySelectorAll('td[data-day][data-p]').forEach(td => {
      const day = td.dataset.day; const period = parseInt(td.dataset.p, 10);
      if (!day || !period) return;
      // temporary placement check
      const ok = _canPlaceOnSlot(selId, it, day, period, idx);
      td.classList.add(ok ? 'slot-ok' : 'slot-ng');
    });
  }
  function _canPlaceOnSlot(id, it, day, period, idx) {
    const span = it.span || 1;
    const maxP = maxPeriod(day);
    if (period < 1 || period > maxP) return false;
    if (span === 2 && period === maxP) return false;
    for (let dp = 0; dp < span; dp++) {
      const p = period + dp;
      if (typeof isForbiddenForSubject === 'function' && isForbiddenForSubject(it.subjKey, day, p)) return false;
      for (const t of it.teas || []) {
        if (typeof isUnavailableForTeacher === 'function' && isUnavailableForTeacher(t, day, p)) return false;
        const occ = (idx.tea?.[t]?.[day]?.[p] || []).filter(x => x !== id);
        if (occ.length) return false;
      }
      for (const c of it.cls || []) {
        const occ = (idx.cls?.[c]?.[day]?.[p] || []).filter(x => x !== id);
        if (occ.length) return false;
      }
    }
    return true;
  }

  /* ─── F7: 競合ダッシュボード ─── */
  function showDashboard() {
    const idx = buildIdxFromPlacements(state.placements);
    const allIds = Object.keys(state.items);
    const placed = allIds.filter(id => state.placements[id]?.day);
    const unplaced = allIds.filter(id => !state.placements[id]?.day);

    // 教員負荷集計
    const teaLoad = {}; // tea -> {total, byDay:{Mon:n,...}, conflicts:n}
    for (const id of placed) {
      const it = state.items[id]; if (!it) continue;
      const plc = state.placements[id];
      const span = it.span || 1;
      for (const t of it.teas || []) {
        if (!teaLoad[t]) teaLoad[t] = { total: 0, byDay: {}, conflicts: 0 };
        teaLoad[t].total += span;
        teaLoad[t].byDay[plc.day] = (teaLoad[t].byDay[plc.day] || 0) + span;
      }
    }
    // 衝突カウント
    for (const t in idx.tea) {
      if (!teaLoad[t]) teaLoad[t] = { total: 0, byDay: {}, conflicts: 0 };
      for (const d of DAYS) for (let p = 1; p <= maxPeriod(d); p++) {
        const occ = idx.tea[t]?.[d]?.[p] || [];
        if (occ.length > 1) teaLoad[t].conflicts += occ.length - 1;
      }
    }
    // クラス充填率
    const clsFill = {}; // cls -> {filled, total}
    const classes = [...new Set(allIds.flatMap(id => state.items[id]?.cls || []))].sort();
    for (const cls of classes) {
      let total = 0, filled = 0;
      for (const d of DAYS) { const mp = maxPeriod(d); total += mp; for (let p = 1; p <= mp; p++) { if ((idx.cls?.[cls]?.[d]?.[p] || []).length) filled++; } }
      clsFill[cls] = { filled, total };
    }

    const teaSorted = Object.entries(teaLoad).sort((a, b) => b[1].total - a[1].total);
    const teaRows = teaSorted.map(([t, l]) => {
      const maxD = typeof teacherDailyMax === 'function' ? teacherDailyMax(t) : null;
      const over = maxD && l.total > maxD * DAYS.length;
      const conflStr = l.conflicts > 0 ? `<span style="color:#ef4444">衝突${l.conflicts}</span>` : '<span style="color:#10b981">✓</span>';
      const dayStr = DAYS.map(d => `${DAYJP[d]}:${l.byDay[d]||0}`).join(' ');
      return `<tr class="${over ? 'dash-over' : ''}"><td>${escapeHtml((state.teacherCfg[t]?.abbr||t).slice(0,8))}</td><td>${l.total}</td><td class="muted small">${dayStr}</td><td>${conflStr}</td></tr>`;
    }).join('');

    const clsRows = classes.map(cls => {
      const f = clsFill[cls] || { filled: 0, total: 0 };
      const pct = f.total ? Math.round(f.filled / f.total * 100) : 0;
      const bar = `<div style="width:${pct}%;height:6px;background:${pct>=100?'#10b981':pct>=80?'#3b82f6':'#f59e0b'};border-radius:3px"></div>`;
      return `<tr><td>${escapeHtml(cls)}</td><td>${f.filled}/${f.total}</td><td style="min-width:80px"><div style="background:#e5e7eb;border-radius:3px">${bar}</div></td><td class="muted small">${pct}%</td></tr>`;
    }).join('');

    const html = `
      <div class="dash-wrap">
        <div class="dash-summary">
          <div class="dash-card"><div class="dash-num">${placed.length}</div><div class="dash-lbl">配置済み</div></div>
          <div class="dash-card warn"><div class="dash-num">${unplaced.length}</div><div class="dash-lbl">未配置（在庫）</div></div>
          <div class="dash-card"><div class="dash-num">${teaSorted.filter(([,l])=>l.conflicts>0).length}</div><div class="dash-lbl">衝突教員</div></div>
          <div class="dash-card"><div class="dash-num">${classes.length}</div><div class="dash-lbl">クラス数</div></div>
        </div>
        <details open><summary class="dash-section-title">👩‍🏫 教員週コマ数</summary>
        <div class="dash-scroll"><table class="dash-table"><thead><tr><th>教員</th><th>計</th><th>曜日別</th><th>衝突</th></tr></thead><tbody>${teaRows||'<tr><td colspan="4" class="muted">データなし</td></tr>'}</tbody></table></div></details>
        <details open><summary class="dash-section-title">🏫 クラス充填率</summary>
        <div class="dash-scroll"><table class="dash-table"><thead><tr><th>クラス</th><th>配置/合計</th><th>充填</th><th>率</th></tr></thead><tbody>${clsRows||'<tr><td colspan="4" class="muted">データなし</td></tr>'}</tbody></table></div></details>
      </div>`;
    showModalHTML('📊 競合・負荷ダッシュボード', html, null, '閉じる', null);
  }

  /* v45: 指定コマIDのリストをAI配置する */
  function aiPlaceSelected(ids) {
    const targetIds = [...ids].filter(id => !state.placements[id]);
    if (!targetIds.length) { flash('未配置コマがありません（選択中コマはすでに配置済み）'); return; }

    const mode = $('#ai-mode')?.value || 'normal';
    const rand = clampNum(Number($('#ai-rand')?.value || 0) / 100, 0, 1, 0.20);
    const tries = 60;

    // 現在の配置をベースに選択コマだけ挿入試行
    const basePlacements = {};
    for (const id in state.placements) { if (state.placements[id]) basePlacements[id] = state.placements[id]; }
    // 対象コマは除外（未配置として扱う）
    for (const id of targetIds) basePlacements[id] = null;

    let best = null;

    for (let t = 0; t < tries; t++) {
      const placements = Object.assign({}, basePlacements);
      const idx = buildIdxFromPlacements(placements);

      // 難しい順にソート
      const order = targetIds.slice().sort((a, b) => {
        const slotCount = (id) => {
          const it = state.items[id]; if (!it) return 999;
          let c = 0;
          for (const d of DAYS) {
            for (let p = 1; p <= maxPeriod(d); p++) {
              let ok = true;
              for (let dp = 0; dp < (it.span || 1) && ok; dp++) {
                const pp = p + dp;
                if (isForbiddenForSubject(it.subjKey, d, pp)) ok = false;
                for (const tea of it.teas || []) { if (isUnavailableForTeacher(tea, d, pp)) ok = false; }
              }
              if (ok) c++;
            }
          }
          return c;
        };
        return slotCount(a) - slotCount(b);
      });
      if (rand > 0.15 && t > 0) shuffle(order);

      let placed = 0;
      for (const id of order) {
        const it = state.items[id]; if (!it) continue;
        const cands = [];
        for (const d of DAYS) {
          const mP = maxPeriod(d);
          for (let p = 1; p <= mP; p++) {
            if ((it.span || 1) === 2 && p === mP) continue;
            // hard constraints
            let ok = true;
            for (let dp = 0; dp < (it.span || 1) && ok; dp++) {
              const pp = p + dp;
              if (isForbiddenForSubject(it.subjKey, d, pp)) { ok = false; break; }
              for (const tea of it.teas || []) {
                if (isUnavailableForTeacher(tea, d, pp)) { ok = false; break; }
                if ((idx.tea?.[tea]?.[d]?.[pp] || []).length) { ok = false; break; }
                // 教員1日上限チェック
                const maxD = teacherDailyMax(tea);
                if (maxD != null) {
                  let cnt = 0;
                  for (let pp2 = 1; pp2 <= mP; pp2++) if ((idx.tea?.[tea]?.[d]?.[pp2] || []).length) cnt++;
                  if (dp === 0 && cnt + 1 > maxD) { ok = false; break; }
                }
              }
              for (const c of it.cls || []) { if ((idx.cls?.[c]?.[d]?.[pp] || []).length) { ok = false; break; } }
            }
            if (!ok) continue;
            // soft score (simple spread)
            let pen = 0;
            for (const c of it.cls || []) {
              for (const d2 of DAYS) for (let p2 = 1; p2 <= maxPeriod(d2); p2++) {
                for (const oid of (idx.cls?.[c]?.[d2]?.[p2] || [])) {
                  if (state.items[oid]?.subjKey === it.subjKey && d2 === d) pen += 2;
                }
              }
            }
            cands.push({ day: d, period: p, score: 100 - pen });
          }
        }
        if (!cands.length) continue;
        cands.sort((a, b) => b.score - a.score);
        const pick = (rand > 0.1 && cands.length > 1) ? cands[Math.floor(Math.random() * Math.min(4, cands.length))] : cands[0];
        placements[id] = { day: pick.day, period: pick.period, locked: false };
        // add to local idx
        const addIdx = (type, key, d, p) => { if (!idx[type]) idx[type] = {}; if (!idx[type][key]) idx[type][key] = {}; if (!idx[type][key][d]) idx[type][key][d] = {}; if (!idx[type][key][d][p]) idx[type][key][d][p] = []; idx[type][key][d][p].push(id); };
        for (let dp = 0; dp < (it.span || 1); dp++) {
          for (const tea of it.teas || []) addIdx('tea', tea, pick.day, pick.period + dp);
          for (const c of it.cls || []) addIdx('cls', c, pick.day, pick.period + dp);
        }
        placed++;
      }
      const remain = targetIds.filter(id => !placements[id]).length;
      if (!best || remain < best.remain) { best = { placements, remain, placed }; }
      if (best.remain === 0) break;
    }

    if (!best) { flash('AI配置失敗'); return; }

    pushHistory('ai-selected');
    for (const id of targetIds) {
      if (best.placements[id]) state.placements[id] = best.placements[id];
    }
    invalidateIndex(); markDirty('ai'); rerenderAll();

    // 選択解除
    state.ui.stockMultiSel?.clear();
    document.querySelectorAll('.stock-multi-sel').forEach(e => e.classList.remove('stock-multi-sel'));
    _updateStockMultiBar();

    flash(`AI: 選択${targetIds.length}コマ中${best.placed}コマ配置, 残${best.remain}`);
  }



  let _dragPopEl = null;
  let _dragPopTimer = null;
  function hideDragPopup() {
    if (_dragPopEl) { _dragPopEl.remove(); _dragPopEl = null; }
    if (_dragPopTimer) { clearTimeout(_dragPopTimer); _dragPopTimer = null; }
  }

  function renderProp() {
    const box = $('#prop-body'); if (!box) return;
    // 【C-3】何も選択していない時はプロパティ欄を細く畳み、時間割の表示面積を最大化する
    const panel = $('#prop-panel');
    if (panel) panel.classList.toggle('collapsed', !!state.ui.propOn && !state.ui.selectedId);
    if (!state.ui.propOn) { box.innerHTML = ''; return; }
    const id = state.ui.selectedId;
    if (!id) {
      box.innerHTML = `<div class="prop-empty">在庫やコマをクリックすると詳細が表示されます。<br>ダブルクリックで「配置候補」を表示。</div>`;
      return;
    }
    const it = state.items[id];
    if (!it) { box.innerHTML = '<div class="prop-empty">不明</div>'; return; }
    const plc = state.placements[id];
    const scfg = state.subjectCfg[it.subjKey] || {};
    const tlabels = it.teas.map(t => state.teacherCfg[t]?.abbr || normalizeAbbr(t, 12) || t).join(',');

    // Compute available slots
    let validCount = 0, swapCount = 0, hardCount = 0;
    const savedPlc = state.placements[id];
    state.placements[id] = null;
    invalidateIndex();
    for (const day of DAYS) {
      const mP = maxPeriod(day);
      for (let p = 1; p <= mP; p++) {
        if (it.span === 2 && p === mP) continue;
        const v = validatePlacement(id, day, p, 'safe', null);
        if (v.blocks.length === 0) validCount++;
        else {
          const idx = buildIndex();
          let hasOcc = false;
          for (let dp = 0; dp < (it.span || 1); dp++) {
            for (const t of it.teas || []) { if ((idx.tea?.[t]?.[day]?.[p + dp] || []).length) { hasOcc = true; break; } }
            for (const c of it.cls || []) { if ((idx.cls?.[c]?.[day]?.[p + dp] || []).length) { hasOcc = true; break; } }
          }
          if (hasOcc) swapCount++;
          else hardCount++;
        }
      }
    }
    state.placements[id] = savedPlc;
    invalidateIndex();

    // Current violations
    let vioHTML = '';
    if (plc) {
      const v = validatePlacement(id, plc.day, plc.period, 'safe', null);
      if (v.blocks.length) {
        vioHTML = `<div class="prop-vio-box"><strong>⚠ 制約違反</strong><ul>${v.blocks.map(b => `<li>${escapeHtml(b)}</li>`).join('')}</ul></div>`;
      } else if (v.warns.length) {
        vioHTML = `<div class="prop-warn-box"><strong>⚡ 警告</strong><ul>${v.warns.map(w => `<li>${escapeHtml(w)}</li>`).join('')}</ul></div>`;
      } else {
        vioHTML = `<div class="prop-ok-box">✓ 制約OK</div>`;
      }
    }

    box.innerHTML = `
    <div class="prop-grid">
      <label>科目</label><div><strong>${escapeHtml(it.subj)}</strong> <span class="muted small">(${escapeHtml(scfg.dept || '')})</span>${it.simul ? ' <span class="real-subj-tag" title="同時展開（相乗り）授業">同時展開</span>' : ''}${it.realSubj ? ` <span class="real-subj-tag" title="開講科目">科目: ${escapeHtml(it.realSubj)}</span>` : ''}</div>
      <label>クラス</label><div>${escapeHtml(it.cls.join(', '))}</div>
      <label>教員</label><div>${escapeHtml(it.teas.join(', '))}</div>
      <label>教室</label><div>${escapeHtml(it.rooms.join(', '))}</div>
      <label>コマ</label><div>${plc ? `${DAYJP[plc.day]} ${plc.period}${it.span === 2 ? '-' + (plc.period + 1) : ''}` : '未配置'}</div>
      <label>2連</label><div>${it.span === 2 ? 'はい' : 'いいえ'}</div>
      <label>ロック</label><div>${plc ? (plc.locked ? '🔒 あり' : 'なし') : '—'}</div>
    </div>
    ${vioHTML}
    <div class="prop-slots-status">
      <div class="slot-stat valid-stat"><span class="slot-label">◎ 即配置可</span><span class="slot-count">${validCount}</span></div>
      <div class="slot-stat swap-stat"><span class="slot-label">○ 交換可</span><span class="slot-count">${swapCount}</span></div>
      <div class="slot-stat hard-stat"><span class="slot-label">△ 難</span><span class="slot-count">${hardCount}</span></div>
    </div>
    <div class="prop-actions">
      <button class="sec" id="prop-lock">${plc ? (plc.locked ? '🔓 ロック解除' : '🔒 ロック') : '🔒 ロック'}</button>
      <button class="danger" id="prop-stock">📦 在庫へ</button>
    </div>
    <div class="suggest" id="suggest-box"></div>
  `;
    $('#prop-lock').onclick = () => { if (plc) toggleLock(id); else flash('未配置'); };
    $('#prop-stock').onclick = () => toStock(id);
  }


  // v63.4: 空きセルをダブルクリック→「ここに来れるコマ」の提案を表示
  function openSlotSuggestions(day, p) {
    const idx = buildIndex();
    const mode = state.ui.viewMode || 'teacher';
    const candidates = [];

    // 全コマを対象に、このスロットに配置できるかチェック
    for (const [id, it] of Object.entries(state.items)) {
      if (!it) continue;
      // 2コマ連続の2つ目は除外
      if ((it.span || 1) === 2 && p >= maxPeriod(day)) continue;

      // 既にこのセルに配置済みのコマは除外
      const plc = state.placements[id];
      if (plc && plc.day === day && plc.period === p) continue;

      const v = validatePlacement(id, day, p, 'safe', null) || { blocks: [], warns: [] };
      const blocks = v.blocks.length;
      const warns = v.warns.length;

      let rank, label;
      if (blocks === 0 && warns === 0) { rank = 0; label = '◎'; }
      else if (blocks === 0) { rank = 1; label = '〇'; }
      else if (blocks <= 2) { rank = 2; label = '△'; }
      else { rank = 3; label = '×'; }

      // ×(不可)は非表示にしない: ユーザーは全体を把握したい
      const isStock = !plc || !plc.day;
      const scfg = state.subjectCfg[it.subjKey] || {};
      const abbr = scfg.abbr || it.subj || it.subjKey || '';
      const teas = it.teas.map(t => state.teacherCfg[t]?.abbr || t).join(',');
      const cls = it.cls.join(',');

      candidates.push({
        id, rank, label, abbr, teas, cls, isStock,
        blocks, warns, blockMsgs: v.blocks, warnMsgs: v.warns
      });
    }

    // ◎→〇→△→×の順にソート（同ランク内は在庫優先、次に科目名）
    candidates.sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;
      if (a.isStock !== b.isStock) return a.isStock ? -1 : 1;
      return (a.abbr || '').localeCompare(b.abbr || '');
    });

    // ×以外を主に表示（×は折りたたみ）
    const good = candidates.filter(c => c.rank <= 2);
    const bad = candidates.filter(c => c.rank === 3);

    let overlay = document.getElementById('sug-popup-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'sug-popup-overlay';
      overlay.className = 'sug-popup-overlay';
      document.body.appendChild(overlay);
    }

    const rankColors = { '◎': '#22c55e', '〇': '#3b82f6', '△': '#f59e0b', '×': '#ef4444' };

    const goodHtml = good.map(c => `
      <div class="slot-sug-item" data-id="${c.id}" style="cursor:pointer;padding:6px 10px;border-bottom:1px solid #1e293b;display:flex;gap:8px;align-items:center"
           title="${c.blockMsgs.concat(c.warnMsgs).join('\n')}">
        <span style="font-weight:800;font-size:16px;color:${rankColors[c.label]};min-width:24px">${c.label}</span>
        <span style="flex:1;font-size:12px;color:#e2e8f0">
          ${escapeHtml(c.abbr)} <span style="color:#94a3b8">${escapeHtml(c.teas)}</span>
          <span style="color:#64748b">${escapeHtml(c.cls)}</span>
          ${c.isStock ? '<span style="color:#f59e0b;font-size:10px;margin-left:4px">📦在庫</span>' : ''}
        </span>
        <span style="font-size:10px;color:#94a3b8">${c.blocks > 0 ? c.blocks + 'ブロック' : c.warns > 0 ? c.warns + '警告' : '制約なし'}</span>
      </div>
    `).join('');

    const badHtml = bad.length > 0 ? `
      <details style="margin-top:4px">
        <summary style="padding:6px 10px;color:#94a3b8;font-size:11px;cursor:pointer">× 不可 (${bad.length}件) — クリックで展開</summary>
        ${bad.map(c => `
          <div class="slot-sug-item" data-id="${c.id}" style="cursor:pointer;padding:4px 10px;border-bottom:1px solid #1e293b;display:flex;gap:8px;align-items:center;opacity:0.6"
               title="${c.blockMsgs.join('\n')}">
            <span style="font-weight:800;font-size:14px;color:${rankColors['×']};min-width:24px">×</span>
            <span style="flex:1;font-size:11px;color:#94a3b8">
              ${escapeHtml(c.abbr)} ${escapeHtml(c.teas)} ${escapeHtml(c.cls)}
            </span>
          </div>
        `).join('')}
      </details>
    ` : '';

    overlay.innerHTML = `
    <div class="sug-popup-box" id="sug-popup-box" style="max-width:500px">
      <div class="sug-popup-header">
        <div class="sug-popup-title">📍 ${DAYJP[day]}${p}限に来れるコマ (${good.length}件)</div>
        <span class="sug-popup-hint">クリックでそのコマの提案を表示</span>
        <button class="sug-popup-close" id="sug-popup-close-btn">✕</button>
      </div>
      <div class="sug-popup-body" style="max-height:60vh;overflow-y:auto">
        ${good.length > 0 ? goodHtml : '<div style="padding:16px;text-align:center;color:#94a3b8">配置可能なコマがありません</div>'}
        ${badHtml}
      </div>
    </div>
    `;
    overlay.style.display = 'flex';

    document.getElementById('sug-popup-close-btn').onclick = () => { overlay.style.display = 'none'; };

    // 各コマクリックでそのコマの提案を開く
    overlay.querySelectorAll('.slot-sug-item').forEach(el => {
      el.onclick = () => {
        const cid = el.dataset.id;
        overlay.style.display = 'none';
        if (cid) openPropSuggestions(cid);
      };
      el.onmouseenter = () => { el.style.background = '#334155'; };
      el.onmouseleave = () => { el.style.background = ''; };
    });

    // ESCで閉じる
    const escHandler = (ev) => {
      if (ev.key === 'Escape') { overlay.style.display = 'none'; document.removeEventListener('keydown', escHandler); }
    };
    document.addEventListener('keydown', escHandler);
  }

  async function openPropSuggestions(id) {
    try { if (!id) id = ((window.state || state).ui || {}).selectedId; } catch (e) { }
    if (!id) return;
    try { selectId(id, state.ui.selectedFrom || 'grid'); } catch (e) { }

    // v38: Show suggestions in a floating popup instead of bottom of prop panel
    let overlay = document.getElementById('sug-popup-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'sug-popup-overlay';
      overlay.className = 'sug-popup-overlay';
      document.body.appendChild(overlay);
    }
    // Create a temporary sugBox inside the popup
    const it_name = (() => {
      const it = state.items[id];
      if (!it) return id;
      const scfg = state.subjectCfg[it.subjKey] || {};
      const abbr = scfg.abbr || it.subj || it.subjKey;
      return abbr + (it.cls.length ? ` [${it.cls.join(',')}]` : '');
    })();
    overlay.innerHTML = `
    <div class="sug-popup-box" id="sug-popup-box">
      <div class="sug-popup-header">
        <div class="sug-popup-title">💡 配置提案: <strong>${escapeHtml(it_name)}</strong></div>
        <span class="sug-popup-hint">↑↓ 移動 · Enter 採用 · Esc 閉じる</span>
        <button class="sug-popup-deep" id="sug-popup-deep-btn">🧠 深読み:OFF</button>
        <button class="sug-popup-lns" id="sug-popup-lns-btn">🧩 LNS:OFF</button>
        <button class="sug-popup-close" id="sug-popup-close-btn">✕</button>
      </div>
      <div class="sug-popup-body">
        <div id="sug-popup-content" class="suggest suggest-popup"></div>
      </div>
    </div>
  `;
    overlay.style.display = 'flex';
    document.getElementById('sug-popup-close-btn').onclick = () => closeSuggestionPopup();
    // Deep toggle (🧠 深読み) - v59
    try {
      window.__SUG_DEEP = !!window.__SUG_DEEP;
      const deepBtn = document.getElementById('sug-popup-deep-btn');
      if (deepBtn) {
        const updateDeepBtn = () => { deepBtn.textContent = window.__SUG_DEEP ? '🧠 深読み:ON' : '🧠 深読み:OFF'; deepBtn.classList.toggle('on', !!window.__SUG_DEEP); };
        updateDeepBtn();
        deepBtn.onclick = () => {
          window.__SUG_DEEP = !window.__SUG_DEEP;
          updateDeepBtn();
          try { pack = computeSuggestionPack(id); } catch (e) { console.error('computeSuggestionPack', e); }
          try { render(); } catch (e) { console.error('render', e); }
        };
      }
    } catch (e) { console.error('deep toggle init', e); }

    // LNS toggle (🧩 Large Neighborhood Search) - v60
    try {
      window.__SUG_LNS = !!window.__SUG_LNS;
      const lnsBtn = document.getElementById('sug-popup-lns-btn');
      if (lnsBtn) {
        const updateLnsBtn = () => { lnsBtn.textContent = window.__SUG_LNS ? '🧩 LNS:ON' : '🧩 LNS:OFF'; lnsBtn.classList.toggle('on', !!window.__SUG_LNS); };
        updateLnsBtn();
        lnsBtn.onclick = () => {
          window.__SUG_LNS = !window.__SUG_LNS;
          updateLnsBtn();
          try { pack = computeSuggestionPack(id); } catch (e) { console.error('computeSuggestionPack', e); }
          try { render(); } catch (e) { console.error('render', e); }
        };
      }
    } catch (e) { console.error('lns toggle init', e); }

    overlay.onclick = (e) => { if (e.target === overlay) closeSuggestionPopup(); };
    // Make popup draggable
    makeSugPopupDraggable(overlay.querySelector('#sug-popup-box'));
    // v39: 前回位置を復元
    if (_sugPopupSavedPos) {
      const box = overlay.querySelector('#sug-popup-box');
      if (box) {
        box.style.position = 'fixed';
        box.style.left = _sugPopupSavedPos.left;
        box.style.top = _sugPopupSavedPos.top;
        box.style.transform = 'none';
      }
    }
    // v63.2: キーボードキャプチャ（Esc・Enter）マトリクスUI向け
    _sugPopupKeyHandler = (ev) => {
      const ovl = document.getElementById('sug-popup-overlay');
      if (!ovl || ovl.style.display === 'none') { window.removeEventListener('keydown', _sugPopupKeyHandler, true); return; }

      if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); closeSuggestionPopup(); window.removeEventListener('keydown', _sugPopupKeyHandler, true); return; }
      if (ev.key === 'Enter') { ev.preventDefault(); ev.stopPropagation(); const btn = document.getElementById('idea-btn-apply'); if (btn && !btn.disabled) btn.click(); return; }
      if (ev.key === 'ArrowRight') { ev.preventDefault(); ev.stopPropagation(); const btn = document.getElementById('idea-slot-next'); if (btn && !btn.disabled) btn.click(); return; }
      if (ev.key === 'ArrowLeft') { ev.preventDefault(); ev.stopPropagation(); const btn = document.getElementById('idea-slot-prev'); if (btn && !btn.disabled) btn.click(); return; }
    };
    window.addEventListener('keydown', _sugPopupKeyHandler, true);

    let sugBox = overlay.querySelector('#sug-popup-content') || document.getElementById('sug-popup-content');
    // 先に窓を出して「計算中」を見せてから計算する（以前は計算が終わるまで画面が固まって見えた）
    if (sugBox) sugBox.innerHTML = '<div class="sug-loading" style="padding:40px;text-align:center;color:#475569;font-weight:700">🔍 移動先を計算中…（何手も先まで読んでいます）</div>';
    const __openToken = (openPropSuggestions._token = (openPropSuggestions._token || 0) + 1);
    await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
    if (__openToken !== openPropSuggestions._token || overlay.style.display === 'none') return; // 計算前に閉じた/別のコマを開いた
    let pack = null; try { pack = computeSuggestionPack(id); } catch (e) { console.error('computeSuggestionPack', e); showModal('エラー', '提案の計算でエラー: ' + e.message); return; }
    const tabs = [
      { k: 'empty', label: '🟢 空き枠' },
      { k: 'swap', label: '🔄 入替' },
      { k: 'cycle', label: '🔺 回転' },
      { k: 'linked', label: '🔗 連動' },
      { k: 'lookahead', label: '🔭 先読み' },
      { k: 'lns', label: '🧩 LNS' },
      { k: 'force', label: '⚠️ 強制' },
    ];
    let cur = pack._tab || 'empty';
    if (!pack[cur] || !pack[cur].length) cur = (tabs.find(t => pack[t.k]?.length)?.k) || 'empty';
    pack._tab = cur; try { ['empty', 'swap', 'cycle', 'linked', 'lookahead', 'lns', 'force'].forEach(k => { if (!Array.isArray(pack[k])) pack[k] = []; }); } catch (e) { }
    if (pack.empty.length === 0) { try { pack.empty = computeEmptySuggestions(id) || []; } catch (e) { } }
    if (pack.force.length === 0) { try { pack.force = computeForceSuggestions(id) || []; } catch (e) { } }
    function render() {
      // v63.2: 全タブ横断でスロット(day,period)ごとにベスト提案をマッピング
      const allSugs = [];
      ['empty', 'swap', 'cycle', 'linked', 'lookahead', 'lns', 'force'].forEach(k => {
        (pack[k] || []).forEach(s => { if (s && s.moves && s.moves.length) allSugs.push(s); });
      });

      // スロットごとにグループ化: 対象アイテム(id)の移動先をキーにする
      const slotMap = {};  // key "day-period" => { sugs: [...], best: suggestion }
      for (const sg of allSugs) {
        const mTarget = sg.moves.find(m => m.id === id);
        if (!mTarget) continue;
        const k = `${mTarget.day}-${mTarget.period}`;
        if (!slotMap[k]) slotMap[k] = { sugs: [], best: null };
        slotMap[k].sugs.push(sg);
      }
      // 各スロット内でスコア降順にソートしベストを設定
      for (const k of Object.keys(slotMap)) {
        slotMap[k].sugs.sort((a, b) => (b.score || 0) - (a.score || 0));
        slotMap[k].best = slotMap[k].sugs[0];
      }

      // 選択中スロット
      const selDay = pack._selDay || null;
      const selPer = pack._selPer || null;
      const selKey = selDay && selPer ? `${selDay}-${selPer}` : null;
      const selSlot = selKey ? slotMap[selKey] : null;
      const selSugs = selSlot ? selSlot.sugs : [];
      let selIdx = pack._selIdx || 0;
      if (selIdx >= selSugs.length) selIdx = Math.max(0, selSugs.length - 1);
      pack._selIdx = selIdx;
      const selSug = selSugs[selIdx] || null;

      // ── マトリクスUI（時間割表）の生成 ──
      const maxP = Math.max(...DAYS.map(d => maxPeriod(d)));
      const curPlc = state.placements[id];
      let matrixTrs = '';

      // マス上の吹き出し: 点数ではなく「どうすれば入るか」を言葉で示す
      const sugCellTip = (d, p, cell, best, depth) => {
        const bad = (best.score || 0) < 0;
        let how = depth === 0 ? 'そのまま置けます' : depth === 1 ? '他の1コマと入れ替えれば置けます' : `他の${depth}コマを動かせば置けます`;
        if (bad) how = (depth === 0 ? '置けますが' : how.replace('置けます', '置けますが')) + '、重複などの問題が残ります';
        const why = (best.reason || []).slice(0, 2).join(' / ');
        const n = cell.sugs.length > 1 ? `（案${cell.sugs.length}件）` : '';
        return `${DAYJP[d]}${p}限: ${how}${n}` + (why ? `\n${why}` : '') + '\nクリックで手順を表示';
      };
      for (let p = 1; p <= maxP; p++) {
        matrixTrs += `<tr><th>${p}限</th>`;
        for (const d of DAYS) {
          const k = `${d}-${p}`;
          const cell = slotMap[k];
          const isCurrent = curPlc && curPlc.day === d && curPlc.period === p;
          const isSelected = selKey === k;

          if (isCurrent && (!cell || !cell.sugs.length)) {
            matrixTrs += `<td class="idea-matrix-cell mark-ng" style="background:#fef3c7;color:#b45309;font-weight:900">現</td>`;
          } else if (!cell || !cell.sugs.length) {
            matrixTrs += `<td class="idea-matrix-cell mark-ng">×</td>`;
          } else {
            const best = cell.best;
            const depth = (best.moves || []).length - 1; // 0=直接配置, 1=1手玉突き, 2+=複雑
            const hasVio = (best.score || 0) < 0;
            let mark, className;
            if (depth === 0 && !hasVio) { mark = '◎'; className = 'mark-perfect'; }
            else if (depth <= 1 && !hasVio) { mark = '〇'; className = 'mark-good'; }
            else if (!hasVio) { mark = '△'; className = 'mark-ok'; }
            else { mark = '△'; className = 'mark-ok'; }

            const activeCls = isSelected ? 'active-cell' : '';
            // マークの下に「動かすコマ数」を出す（△でも3コマで済むのか10コマ動くのかが一目で分かるように）
            const cntBadge = depth >= 2 ? `<span style="font-size:9px;font-weight:800;color:${depth >= 6 ? '#b45309' : '#64748b'};display:block;line-height:1">${depth + 1}コマ</span>` : '';
            const currentFlag = isCurrent ? '<span style="font-size:9px;vertical-align:top">現</span>' : '';

            matrixTrs += `<td class="idea-matrix-cell js-matrix-cell ${className} ${activeCls}" data-day="${d}" data-per="${p}" title="${escapeAttr(sugCellTip(d, p, cell, best, depth))}">${currentFlag}${mark}${cntBadge}</td>`;
          }
        }
        matrixTrs += `</tr>`;
      }

      const matrixHtml = `
        <div class="idea-matrix-wrap">
          <table class="idea-matrix-table">
            <thead><tr><th></th>${DAYS.map(d => `<th>${DAYJP[d]}</th>`).join('')}</tr></thead>
            <tbody>${matrixTrs}</tbody>
          </table>
        </div>
      `;

      // ── 選択中提案の詳細パネル ──
      let detailHtml = '';
      if (selSug) {
        const miniGridsHtml = buildSugMiniGridHTML(selSug.moves) || '';
        const movesListHtml = (selSug.moves || []).map((m, i) => {
          const it_m = state.items[m.id];
          const sc_m = state.subjectCfg[it_m?.subjKey] || {};
          const plc = state.placements[m.id];
          const fromStr = plc ? `${DAYJP[plc.day]}曜${plc.period}` : '在庫';
          const toStr = `${DAYJP[m.day]}曜${m.period}`;
          const subjAbbr = (sc_m.abbr || it_m?.subj || m.id).slice(0, 8);
          const teasStr = (it_m?.teas || []).join(', ').slice(0, 12);
          const clsStr = (it_m?.cls || []).join(', ').slice(0, 12);
          return `<div class="idea-move-row">
            <span class="im-idx">${String(i + 1).padStart(3, '0')}</span>
            <span class="im-subj2">${escapeHtml(subjAbbr)}</span>
            <span class="im-fromto">${fromStr} ➜ ${toStr}</span>
            <span class="im-tea">${escapeHtml(teasStr)}</span>
            <span class="im-cls">${escapeHtml(clsStr)}</span>
          </div>`;
        }).join('');

        const isForce = (selSug.title || '').includes('強制');
        const scoreVal = Math.round(selSug.score || 0);
        const depth = (selSug.moves || []).length;

        detailHtml = `
          <div class="idea-detail-panel">
            <div class="idea-detail-header">
              <span class="idea-detail-title">${escapeHtml(selSug.title || '提案')}</span>
              <span class="ish-score">スコア: ${scoreVal} / ${depth}手</span>
              <span class="idea-detail-nav">${selIdx + 1}/${selSugs.length}件
                <button class="idea-btn-sm" id="idea-slot-prev" ${selIdx <= 0 ? 'disabled' : ''}>◀</button>
                <button class="idea-btn-sm" id="idea-slot-next" ${selIdx >= selSugs.length - 1 ? 'disabled' : ''}>▶</button>
              </span>
            </div>
            ${miniGridsHtml ? `<div class="idea-sug-grids">${miniGridsHtml}</div>` : ''}
            <div class="idea-sug-moves-list">${movesListHtml || '<div style="padding:8px;color:#94a3b8">移動なし</div>'}</div>
            ${selSug.reason ? `<div class="idea-sug-reason">${escapeHtml((selSug.reason || []).join(' · '))}</div>` : ''}
            <div class="idea-detail-actions">
              <button class="idea-btn" id="idea-btn-reason">詳細</button>
              <button class="idea-btn apply ${isForce ? 'apply-force' : ''}" id="idea-btn-apply">${isForce ? '⚠ 強制採用' : '採 用'}</button>
            </div>
          </div>
        `;
      } else if (selKey) {
        detailHtml = `<div class="idea-detail-panel"><div style="padding:24px;text-align:center;color:#94a3b8">${selKey ? `${DAYJP[selDay]}${selPer}限: 提案なし` : 'セルを選択してください'}</div></div>`;
      } else {
        detailHtml = `<div class="idea-detail-panel"><div style="padding:24px;text-align:center;color:#94a3b8;font-size:13px">⬆ 上の時間割表で◎〇△をクリックすると、詳しい移動手順が表示されます</div></div>`;
      }

      sugBox.innerHTML = `
      <div class="sug-head">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
          <div class="sug-hint" style="color:#475569;font-size:12px;font-weight:800;flex:1">コマ入れ提案 — ${escapeHtml((state.items[id]?.subj || id).slice(0, 20))}</div>
          <button class="idea-btn" id="idea-btn-deep" style="width:auto;padding:4px 12px;font-size:11px;background:#7c3aed;color:#fff;border:none">🤔 長考（最大8秒・もっと深く読む）</button>
        </div>
        <div class="sug-hint" style="color:#94a3b8;font-size:11px">◎そのまま置ける　〇入れ替え1回　△数コマ動かせば全員収まる（数字＝動かすコマ数）　×入れない ｜ マスを押すと手順を表示</div>
      </div>
      ${matrixHtml}
      ${detailHtml}
      <div style="text-align:right;padding:4px 8px">
        <button class="idea-btn btn-cancel" id="idea-btn-cancel" style="width:auto;display:inline-block;padding:6px 16px">閉じる</button>
      </div>
    `;

      // ── イベントバインド ──
      // マトリクスセルクリック（シングル: スロット選択、ダブル: ベスト提案を即採用）
      sugBox.querySelectorAll('.js-matrix-cell').forEach(cell => {
        cell.onclick = () => {
          pack._selDay = cell.dataset.day;
          pack._selPer = parseInt(cell.dataset.per, 10);
          pack._selIdx = 0;
          render();
        };
        cell.ondblclick = (ev) => {
          ev.stopPropagation();
          const day = cell.dataset.day;
          const per = parseInt(cell.dataset.per, 10);
          const key = `${day}-${per}`;
          // slotMap は render() のスコープ外なので再計算
          const allSugsD = [];
          ['empty', 'swap', 'cycle', 'linked', 'lookahead', 'lns', 'force'].forEach(k => {
            (pack[k] || []).forEach(s => { if (s && s.moves && s.moves.length) allSugsD.push(s); });
          });
          const sugsForSlot = allSugsD.filter(sg => {
            const m = sg.moves.find(m => m.id === id);
            return m && `${m.day}-${m.period}` === key;
          }).sort((a, b) => (b.score || 0) - (a.score || 0));
          if (sugsForSlot.length) {
            applySuggestion(sugsForSlot[0]);
            closeSuggestionPopup();
          }
        };
      });

      // スロット内の次/前
      const slotNext = sugBox.querySelector('#idea-slot-next');
      if (slotNext) slotNext.onclick = () => { if (pack._selIdx < selSugs.length - 1) { pack._selIdx++; render(); } };
      const slotPrev = sugBox.querySelector('#idea-slot-prev');
      if (slotPrev) slotPrev.onclick = () => { if (pack._selIdx > 0) { pack._selIdx--; render(); } };

      // 採用
      const btnApply = sugBox.querySelector('#idea-btn-apply');
      if (btnApply && selSug) btnApply.onclick = () => { applySuggestion(selSug); closeSuggestionPopup(); };

      // 詳細
      const btnReason = sugBox.querySelector('#idea-btn-reason');
      if (btnReason && selSug) btnReason.onclick = () => showSuggestionDetail(selSug);

      // 閉じる
      const btnCancel = sugBox.querySelector('#idea-btn-cancel');
      if (btnCancel) btnCancel.onclick = () => closeSuggestionPopup();

      // v63.4: 将棋的長考モード（深探索）— 1つの時間枠で全スロットを深く探索
      const btnDeep = sugBox.querySelector('#idea-btn-deep');
      if (btnDeep) {
        btnDeep.onclick = async () => {
          btnDeep.disabled = true;
          const originalBg = btnDeep.style.background;
          btnDeep.style.background = '#94a3b8';
          btnDeep.textContent = '🤔 長考開始...';

          const it = state.items[id];
          if (!it) return;

          let foundAny = false;
          const globalStart = performance.now();
          const GLOBAL_TIMEOUT = 8000; // 全体8秒
          // 収まり探索を、画面を固めないよう小分けにしながら時間いっぱいまで深く読む（最大16コマ連動）
          const myToken = openPropSuggestions._token;
          const job = fitJob(id, { maxMoves: 16, nodeCap: 20000, sweeps: 3 });
          let finished = false;
          while (!finished && performance.now() - globalStart < GLOBAL_TIMEOUT) {
            finished = job.step(60);
            const pr = job.progress();
            btnDeep.textContent = `🤔 長考中… ${Math.min(99, Math.round((performance.now() - globalStart) / GLOBAL_TIMEOUT * 100))}%（${pr.solved}/${pr.total}マスで収まる形を発見）`;
            await new Promise(r => setTimeout(r, 0));
            if (myToken !== openPropSuggestions._token || !document.body.contains(btnDeep)) return; // 閉じた/別のコマを開いた
          }
          // 長考の前から「収まる案」があったマス（強制以外のどれかの案があるマス）
          const before = new Set(['empty', 'swap', 'cycle', 'linked', 'lookahead', 'lns'].flatMap(k => pack[k] || []).filter(s => (s.score || 0) >= 0).map(s => { const m = (s.moves || []).find(m => m.id === id); return m ? m.day + '-' + m.period : ''; }));
          pack.linked = (pack.linked || []).filter(s => !s.isFit);
          let newCells = 0;
          for (const sg of job.suggestions()) {
            const mt = sg.moves.find(m => m.id === id);
            if (mt && !before.has(mt.day + '-' + mt.period)) { newCells++; sg.isDeep = true; sg.title = '♛長考 ' + sg.title; }
            pack.linked.push(sg);
          }
          foundAny = newCells > 0;

          // ── 結果後処理 ──
          // 同じ移動先への重複提案をまとめ、スコア降順でソート
          if (pack.linked) {
            const byDest = {};
            for (const s of pack.linked) {
              const mt = s.moves?.find(m => m.id === id);
              if (!mt) continue;
              const k = `${mt.day}-${mt.period}`;
              if (!byDest[k] || (s.score || 0) > (byDest[k].score || 0)) byDest[k] = s;
            }
            // 将棋モード以外の既存提案は保持し、深探索分だけ差し替え
            const nonDeep = pack.linked.filter(s => !s.isDeep);
            pack.linked = [...nonDeep, ...Object.values(byDest).filter(s => s.isDeep)];
            pack.linked.sort((a, b) => (b.score || 0) - (a.score || 0));
          }

          const totalSec = ((performance.now() - globalStart) / 1000).toFixed(1);

          // ボタンを常に再有効化（再探索可能にする）
          const resetBtn = () => {
            if (btnDeep) {
              btnDeep.style.background = originalBg;
              btnDeep.disabled = false;
            }
          };

          if (!foundAny) {
            render(); // 既存マスの案がより良い手順に置き換わっている場合があるので描き直す
            try { flash(`長考しましたが、これ以上収まるマスは見つかりませんでした（${totalSec}秒）`); } catch (e) { }
          } else {
            const cnt = (pack.linked || []).filter(s => s.isDeep).length;
            btnDeep.textContent = `♛ 新たに${cnt}マスで収まる形を発見 (${totalSec}秒)`;
            try { flash(`長考の結果: 新たに${cnt}マスで、全員が収まる形が見つかりました`); } catch (e) { }
            resetBtn(); // 即座に再有効化（再クリックで再探索できる）
            // 🔗連動タブに自動切替して結果を表示
            pack._tab = 'linked';
            const deepSugs = (pack.linked || []).filter(s => s.isDeep);
            if (deepSugs.length > 0) {
              const best = deepSugs.sort((a, b) => (b.score || 0) - (a.score || 0))[0];
              const mTarget = best.moves.find(m => m.id === id);
              if (mTarget) {
                pack._selDay = String(mTarget.day);
                pack._selPer = String(mTarget.period);
                pack._selIdx = 0;
              }
            }
            render();
          }
        };
      }

      // 矢印プレビュー
      if (selSug && selSug.moves) {
        try { setTimeout(() => previewSuggestionMoves(selSug.moves), 10); } catch (e) { }
      } else {
        clearSuggestionArrows();
      }
    }
    render();
  }

  // v39: ポップアップ位置記憶・キーボードハンドラ（モジュール変数）
  let _sugPopupSavedPos = null;
  let _sugPopupKeyHandler = null; // モジュールスコープで保持し closeSuggestionPopup から解除可能に

  function closeSuggestionPopup() {
    const overlay = document.getElementById('sug-popup-overlay');
    if (overlay) {
      // v39: 位置を保存してから閉じる
      const box = overlay.querySelector('#sug-popup-box');
      if (box) {
        const style = box.style;
        if (style.left || style.top) {
          _sugPopupSavedPos = { left: style.left, top: style.top };
        }
      }
      overlay.style.display = 'none';
    }
    // v39 fix: キーボードハンドラを明示的に解除（ゴースト防止）
    if (_sugPopupKeyHandler) {
      window.removeEventListener('keydown', _sugPopupKeyHandler, true);
      _sugPopupKeyHandler = null;
    }
    clearSuggestionArrows();
  }
  function makeSugPopupDraggable(box) {
    if (!box) return;
    const header = box.querySelector('.sug-popup-header');
    if (!header) return;
    let startX, startY, startLeft, startTop;
    header.style.cursor = 'move';
    header.onmousedown = (e) => {
      if (e.target.id === 'sug-popup-close-btn') return;
      startX = e.clientX; startY = e.clientY;
      const r = box.getBoundingClientRect();
      startLeft = r.left; startTop = r.top;
      box.style.position = 'fixed';
      box.style.left = startLeft + 'px'; box.style.top = startTop + 'px';
      box.style.transform = 'none';
      const onMove = (e2) => {
        box.style.left = Math.max(0, startLeft + (e2.clientX - startX)) + 'px';
        box.style.top = Math.max(0, startTop + (e2.clientY - startY)) + 'px';
      };
      const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    };

    // リサイズハンドル（右下）
    const resizer = document.createElement('div');
    resizer.className = 'sug-popup-resizer';
    resizer.title = 'ドラッグでリサイズ';
    box.appendChild(resizer);
    resizer.onmousedown = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const startW = box.offsetWidth;
      const startH = box.offsetHeight;
      const sx = e.clientX, sy = e.clientY;
      const onMove = (e2) => {
        const newW = Math.max(480, startW + (e2.clientX - sx));
        const newH = Math.max(300, startH + (e2.clientY - sy));
        box.style.width = newW + 'px';
        box.style.maxHeight = newH + 'px';
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.style.cursor = '';
      };
      document.body.style.cursor = 'se-resize';
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    };
  }

  /* ── 提案カードの「操作テキスト」生成（例：言語文化１−１を在庫から水５へ） ── */
  function buildMoveDescLines(moves, opts) {
    // 各moveを「〇〇（クラス/担当）を△△から◇◇へ」の行に変換
    // opts.chainSwap=true の場合: 最後のコマが主役（目標）、それ以前が退避ステップ
    const moveIdSet = new Set(moves.map(m => m.id));
    const isChain = !!(opts && opts.chainSwap && moves.length >= 2);
    const mainIdx = isChain ? moves.length - 1 : 0; // 主役のインデックス

    return moves.map((m, mi) => {
      const it = state.items[m.id];
      const scfg = state.subjectCfg[it?.subjKey] || {};
      const subjName = scfg.abbr || it?.subj || m.id;
      const cls = (it?.cls || []).join('・');
      const tea = (it?.teas || []).map(t => state.teacherCfg[t]?.abbr || t).join('・');
      const fromPlc = state.placements[m.id];
      const span = it?.span || 1;
      const toStr = `${DAYJP[m.day]}${m.period}${span === 2 ? `–${m.period + 1}` : ''}限`;
      const fromStr = fromPlc
        ? `${DAYJP[fromPlc.day]}${fromPlc.period}${span === 2 ? `–${fromPlc.period + 1}` : ''}限`
        : '在庫';

      // 移動先に別のコマがあるか調べる
      let displacedNote = '';
      try {
        for (const [pid, plc] of Object.entries(state.placements)) {
          if (!plc || moveIdSet.has(pid)) continue;
          if (plc.day === m.day && plc.period === m.period) {
            const dIt = state.items[pid];
            if (!dIt) continue;
            const sharedCls = (it?.cls || []).some(c => (dIt.cls || []).includes(c));
            if (sharedCls) {
              const dsc = state.subjectCfg[dIt.subjKey] || {};
              const dAbbr = dsc.abbr || dIt.subj || '';
              displacedNote = `（${escapeHtml(dAbbr)}を退かす）`;
            }
          }
        }
      } catch (e) { }

      // 連鎖移動のprefix: 退避ステップには「まず/次に」、主役には「→ 目的」マーク
      let prefix, rowClass;
      if (isChain) {
        if (mi === mainIdx) {
          prefix = '🎯 ';
          rowClass = 'mdc-row mdc-main mdc-chain-goal';
        } else if (mi === 0) {
          prefix = moves.length - 1 === 1 ? 'まず ' : `①退避 `;
          rowClass = 'mdc-row mdc-chain-prereq';
        } else {
          prefix = `${'①②③④⑤'[mi]}退避 `;
          rowClass = 'mdc-row mdc-chain-prereq';
        }
      } else {
        prefix = mi === 0 ? '' : 'そして ';
        rowClass = `mdc-row${mi === 0 ? ' mdc-main' : ''}`;
      }

      return `<div class="${rowClass}">
      <span class="mdc-prefix">${escapeHtml(prefix)}</span>
      <span class="mdc-subj">${escapeHtml(subjName)}</span>
      ${cls ? `<span class="mdc-cls">${escapeHtml(cls)}</span>` : ''}
      ${tea ? `<span class="mdc-tea">${escapeHtml(tea)}</span>` : ''}
      <span class="mdc-from">${escapeHtml(fromStr)}</span>
      <span class="mdc-arr">➜</span>
      <span class="mdc-to">${escapeHtml(toStr)}</span>
      ${displacedNote ? `<span class="mdc-displaced">${displacedNote}</span>` : ''}
    </div>`;
    }).join('');
  }

  function renderSugItem(s, idx) {
    const title = s.title || '';
    const moves = s.moves || [];
    const reasonStr = (s.reason || []).join(' · ');
    const hasViolation = (s.score || 0) < 0;
    const isForceItem = (title || '').includes('強制');

    // ── 操作説明テキスト（メイン表示）
    const descLines = buildMoveDescLines(moves, { chainSwap: !!(s.chainSwap) });

    // ── ミニ時間割グリッド（教員視点・移動元→移動先を矢印で示す）
    // duplication回避: miniTT（テーブル形式）はgrid代替なので一方のみ表示
    const miniGridHTML = buildSugMiniGridHTML(moves);

    const scoreVal = Math.round(s.score || 0);
    const scoreBarW = Math.min(100, Math.max(0, scoreVal + 20)) + '%';
    const scoreColor = scoreVal >= 80 ? '#22c55e' : scoreVal >= 50 ? '#f59e0b' : scoreVal >= 0 ? '#94a3b8' : '#ef4444';
    const scoreHTML = `<div class="sug-score-wrap" title="スコア: ${scoreVal}">
    <div class="sug-score-bar" style="width:${scoreBarW};background:${scoreColor}"></div>
    <span class="sug-score-num" style="color:${scoreColor}">${scoreVal}</span>
  </div>`;

    const isForceStr = isForceItem ? '<span class="sug-type-badge force-badge">⚠ 強制</span>' : '';
    const noStockBadge = s.noStock ? '<span class="sug-type-badge nostk-badge">✓ 在庫不使用</span>' : '';
    const chainBadge = (s.chainDepth >= 2) ? `<span class="sug-type-badge chain-badge">${s.chainDepth}手連動</span>` : '';

    return `
    <div class="sug-item${hasViolation ? ' sug-warn' : ''}${isForceItem ? ' sug-force' : ''}" data-moves='${JSON.stringify(moves).replace(/'/g, "&apos;")}'>
      <div class="sug-item-header">
        <div class="sug-title">${isForceStr}${noStockBadge}${chainBadge}${escapeHtml(title)}${hasViolation ? ' <span class="sug-vbadge">⚠ 違反あり</span>' : ''}</div>
        ${scoreHTML}
      </div>
      <div class="mdc-wrap">${descLines}</div>
      ${reasonStr ? `<div class="sug-reason">${escapeHtml(reasonStr)}</div>` : ''}
      ${miniGridHTML ? `<div class="sug-mini-grids">${miniGridHTML}</div>` : ''}
      <div class="btnrow">
        <button class="apply${isForceItem ? ' apply-force' : ''}" data-idx="${idx}">${isForceItem ? '⚠ 強制採用' : '✓ 採用'}</button>
        <button class="why" data-idx="${idx}">詳細</button>
        <button class="sug-pin-btn" data-idx="${idx}" title="ピン留め (P)">📌</button>
      </div>
    </div>
  `;
  }

  /**
   * v42: 提案カード内に表示する簡易個人窓グリッド
   * 関係する教員(最大2名)の時間割をミニ表示し、移動元/先を色付け
   */
  function buildSugMiniGridHTML(moves) {
    if (!moves || !moves.length) return '';
    try {
      // 関係する教員を収集（最大3名）
      const teas = [];
      for (const m of moves) {
        const it = state.items[m.id];
        if (!it) continue;
        for (const t of it.teas || []) { if (!teas.includes(t)) teas.push(t); }
      }
      if (!teas.length) return '';
      const showTeas = teas.slice(0, 3);
      const idx = buildIndex();
      const maxP = Math.max(...DAYS.map(d => maxPeriod(d)));

      return showTeas.map(tea => {
        const abbr = state.teacherCfg[tea]?.abbr || tea.slice(0, 4);
        // FROM/TO cells for this teacher
        const myFromCells = new Set();
        const myToCells = new Set();
        for (const m of moves) {
          const it = state.items[m.id];
          if (!it) continue;
          if (!(it.teas || []).includes(tea)) continue;
          const fromPlc = state.placements[m.id];
          if (fromPlc) for (let dp = 0; dp < (it.span || 1); dp++) myFromCells.add(`${fromPlc.day}|${fromPlc.period + dp}`);
          for (let dp = 0; dp < (it.span || 1); dp++) myToCells.add(`${m.day}|${m.period + dp}`);
        }

        let rows = '';
        // Collect which cells need highlighting for this teacher (only show rows that matter + 1 context row)
        const highlightPeriods = new Set();
        for (const k of [...myFromCells, ...myToCells]) {
          const [, p] = k.split('|');
          const pi = parseInt(p);
          for (let dp = -1; dp <= 1; dp++) {
            if (pi + dp >= 1 && pi + dp <= maxP) highlightPeriods.add(pi + dp);
          }
        }

        for (let p = 1; p <= maxP; p++) {
          rows += `<tr>`;
          rows += `<td class="smg-h">${p}</td>`;
          for (const d of DAYS) {
            const cellKey = `${d}|${p}`;
            const isFrom = myFromCells.has(cellKey);
            const isTo = myToCells.has(cellKey);
            const cellIds = (idx.tea?.[tea]?.[d]?.[p] || []).filter(x => !isSpanFill(x, d, p));
            let cellContent = '';
            let cellStyle = '';
            let cellClass = 'smg-c';

            if (isFrom && isTo) {
              cellStyle = 'background:#8b5cf6;color:#fff;font-weight:900;font-size:10px';
              cellContent = '↔';
            } else if (isFrom) {
              // 移動元：赤系濃い背景 + 出発矢印
              cellStyle = 'background:#ef4444;color:#fff;font-weight:900;font-size:10px;position:relative';
              const it0 = cellIds.length ? state.items[cellIds[0]] : null;
              const ab0 = it0 ? (state.subjectCfg[it0.subjKey]?.abbr || it0.subj || '').slice(0, 3) : '';
              cellContent = `<div style="font-size:7px;opacity:.85">${escapeHtml(ab0)}</div><div style="font-size:13px">↑</div>`;
              cellClass = 'smg-c smg-from';
            } else if (isTo) {
              // 移動先：緑系濃い背景 + 到着矢印
              cellStyle = 'background:#16a34a;color:#fff;font-weight:900;font-size:10px;position:relative';
              const it0 = cellIds.length ? state.items[cellIds[0]] : null;
              const ab0 = it0 ? (state.subjectCfg[it0.subjKey]?.abbr || it0.subj || '').slice(0, 3) : '';
              cellContent = `<div style="font-size:7px;opacity:.85">${it0 ? escapeHtml(ab0) : '空'}</div><div style="font-size:13px">↓</div>`;
              cellClass = 'smg-c smg-to';
            } else if (cellIds.length) {
              const id0 = cellIds[0];
              const it0 = state.items[id0];
              const sc0 = state.subjectCfg[it0?.subjKey] || {};
              const col0 = sc0.color || pickColor(it0?.subjKey || '');
              const ab0 = (sc0.abbr || it0?.subj || '').slice(0, 3);
              cellStyle = `background:${col0}28;border-left:3px solid ${col0}`;
              cellContent = escapeHtml(ab0);
            }
            if (p > maxPeriod(d)) {
              rows += `<td class="smg-fd"></td>`;
            } else {
              rows += `<td class="${cellClass}" style="${cellStyle}">${cellContent}</td>`;
            }
          }
          rows += `</tr>`;
        }

        // Build SVG arrow overlay: connect FROM cells to TO cells
        // We'll add a CSS arrow indicator below the table instead
        const arrowPairs = [];
        for (const m of moves) {
          const it = state.items[m.id];
          if (!it || !(it.teas || []).includes(tea)) continue;
          const fromPlc = state.placements[m.id];
          if (fromPlc) {
            arrowPairs.push({
              from: `${DAYJP[fromPlc.day]}${fromPlc.period}限`,
              to: `${DAYJP[m.day]}${m.period}限`,
              subj: (state.subjectCfg[it.subjKey]?.abbr || it.subj || '').slice(0, 4)
            });
          }
        }
        const arrowHTML = arrowPairs.map(ap =>
          `<div class="smg-arrow-row">` +
          `<span class="smg-ar-from" style="background:#fef2f2;border:1px solid #ef4444;border-radius:4px;padding:2px 6px;color:#b91c1c;font-size:11px;font-weight:700">` +
          `↑ ${escapeHtml(ap.subj)} ${escapeHtml(ap.from)}</span>` +
          `<svg class="smg-ar-svg" viewBox="0 0 48 14" fill="none" style="width:48px;height:14px;flex-shrink:0">` +
          `<line x1="2" y1="7" x2="40" y2="7" stroke="url(#smgar-grad-${Math.random().toString(36).slice(2,6)})" stroke-width="2.5" stroke-linecap="round"/>` +
          `<polygon points="36,3 48,7 36,11" fill="#16a34a"/>` +
          `</svg>` +
          `<span class="smg-ar-to" style="background:#f0fdf4;border:1px solid #16a34a;border-radius:4px;padding:2px 6px;color:#15803d;font-size:11px;font-weight:700">` +
          `↓ ${escapeHtml(ap.to)}</span>` +
          `</div>`
        ).join('');

        // Compact FROM→TO summary below table
        const summaryHTML = arrowPairs.map(ap =>
          `<div class="smg-summary"><span class="smg-from-lbl">↑ ${escapeHtml(ap.subj)} ${escapeHtml(ap.from)}</span>` +
          `<span class="smg-arr-lbl">▶</span>` +
          `<span class="smg-to-lbl">${escapeHtml(ap.to)} ↓</span></div>`
        ).join('');

        return `<div class="smg-block">
        <div class="smg-title smg-title-mover">📋 ${escapeHtml(abbr)}</div>
        <div style="position:relative">
          <table class="smg-table">
            <thead><tr><th></th>${DAYS.map(d => `<th>${DAYJP[d]}</th>`).join('')}</tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        ${summaryHTML}
      </div>`;
      }).join('') + (() => {
        // ── どかされる教員の簡易時間割 ──
        // 移動先スロットに既存コマがある場合、その教員の時間割を表示
        try {
          const moveIdSet = new Set(moves.map(m => m.id));
          const displacedTeaSet = new Set();
          for (const m of moves) {
            const it = state.items[m.id];
            if (!it) continue;
            // find items at destination that aren't in moves
            for (const [pid, plc] of Object.entries(state.placements)) {
              if (!plc || moveIdSet.has(pid)) continue;
              if (plc.day === m.day && plc.period === m.period) {
                const dIt = state.items[pid];
                if (!dIt) continue;
                // same class check
                const sharedCls = (it.cls || []).some(c => (dIt.cls || []).includes(c));
                if (sharedCls) {
                  for (const t of dIt.teas || []) displacedTeaSet.add(t);
                }
              }
            }
          }
          const displacedTeas = [...displacedTeaSet].filter(t => !teas.includes(t)).slice(0, 2);
          if (!displacedTeas.length) return '';

          return displacedTeas.map(tea => {
            const abbr = state.teacherCfg[tea]?.abbr || tea.slice(0, 4);
            let rows = '';
            for (let p = 1; p <= maxP; p++) {
              rows += `<tr><td class="smg-h">${p}</td>`;
              for (const d of DAYS) {
                const cellIds = (idx.tea?.[tea]?.[d]?.[p] || []).filter(x => !isSpanFill(x, d, p));
                // Highlight destination slot (where this teacher's lesson is being displaced FROM)
                let isDisplacedFrom = false;
                for (const m of moves) {
                  if (m.day === d && m.period === p) {
                    if ((idx.tea?.[tea]?.[d]?.[p] || []).some(pid => !moveIdSet.has(pid))) {
                      isDisplacedFrom = true;
                    }
                  }
                }
                let cellContent = '';
                let cellStyle = '';
                if (isDisplacedFrom) {
                  const it0 = cellIds.length ? state.items[cellIds[0]] : null;
                  const ab0 = it0 ? (state.subjectCfg[it0.subjKey]?.abbr || it0.subj || '').slice(0, 3) : '';
                  cellStyle = 'background:#f59e0b;color:#fff;font-weight:900;font-size:10px;border:2px solid #b45309;';
                  cellContent = `<div style="font-size:7px;opacity:.9">${escapeHtml(ab0)}</div><div>退</div>`;
                } else if (cellIds.length) {
                  const id0 = cellIds[0];
                  const it0 = state.items[id0];
                  const sc0 = state.subjectCfg[it0?.subjKey] || {};
                  const col0 = sc0.color || pickColor(it0?.subjKey || '');
                  const ab0 = (sc0.abbr || it0?.subj || '').slice(0, 3);
                  cellStyle = `background:${col0}20;border-left:3px solid ${col0}`;
                  cellContent = escapeHtml(ab0);
                }
                if (p > maxPeriod(d)) {
                  rows += `<td class="smg-fd"></td>`;
                } else {
                  rows += `<td class="smg-c" style="${cellStyle}">${cellContent}</td>`;
                }
              }
              rows += `</tr>`;
            }
            return `<div class="smg-block smg-displaced">
            <div class="smg-title smg-title-displaced">⬅ ${escapeHtml(abbr)} (退避)</div>
            <table class="smg-table">
              <thead><tr><th></th>${DAYS.map(d => `<th>${DAYJP[d]}</th>`).join('')}</tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>`;
          }).join('');
        } catch (e) { return ''; }
      })();
    } catch (e) { console.error('buildSugMiniGridHTML error', e); return ''; }
  }
  function isSamePositionSuggestion(s) {
    // すべてのmoveが現在位置と同じなら無意味な提案
    if (!s.moves || !s.moves.length) return false;
    return s.moves.every(m => {
      const plc = state.placements[m.id];
      return plc && plc.day === m.day && plc.period === m.period;
    });
  }

  /* movesを正規化したキー（全タブ横断で重複排除に使う） */
  function movesKey(moves) {
    if (!moves || !moves.length) return '';
    return moves.map(m => `${m.id}:${m.day}:${m.period}`).sort().join('|');
  }

  /* ============================================================
     v49+: 提案精度改善 — グリッド内連動提案の共通コア
     
     在庫不使用の連動移動提案を生成する。
     puzSearch（パズルソルバー）を活用し、
     ブロッカーが別のブロッカーの場所へ連鎖的に移動するケースも検出する。
     ============================================================ */

  /**
   * chainQualityScore(moves)
   * movesが完了した後の各コマの配置品質を評価する。
   * validatePlacement を全コマに対して実行し、
   * 警告・ブロックの少ない提案を高く評価する。
   */
  // 【提案精度】配置のソフト制約ペナルティ（小さいほど良い）。
  // 同科目を同じ日に重ねない／同じ教科を隣り合わせにしない、という“良い時間割”の観点を数値化する。
  // 現在の配置indexを参照するため、chainQualityScore（一時適用）からも空き枠/入替（現状態での仮配置）からも使える。
  function softPlacementPenalty(id, day, period) {
    const it = state.items[id]; if (!it) return 0;
    const idx = buildIndex();
    const span = it.span || 1;
    const scfg = state.subjectCfg[it.subjKey] || {};
    const myDept = scfg.dept || '';
    const maxP = maxPeriod(day);
    let pen = 0;
    for (const c of (it.cls || [])) {
      const dayIdx = idx.cls?.[c]?.[day] || {};
      // 同科目が同じ日に既にあるか（自分・継続コマは除く）
      let sameSubjSameDay = 0;
      for (const p in dayIdx) {
        for (const oid of (dayIdx[p] || [])) {
          if (oid === id) continue;
          if (isSpanFill(oid, day, Number(p))) continue;
          if (state.items[oid]?.subjKey === it.subjKey) sameSubjSameDay++;
        }
      }
      if (sameSubjSameDay > 0) pen += sameSubjSameDay * (scfg.noSameDay ? 24 : 10);
      // 同じ教科が左右に隣接するか
      if (myDept) {
        const neigh = [];
        if (period - 1 >= 1) neigh.push(period - 1);
        if (period + span <= maxP) neigh.push(period + span);
        for (const np of neigh) {
          const nid = (dayIdx[np] || []).find(x => x !== id && !isSpanFill(x, day, np));
          if (nid && (state.subjectCfg[state.items[nid]?.subjKey]?.dept || '') === myDept) {
            pen += (scfg.noConsec ? 10 : 4);
          }
        }
      }
    }
    // 教員の中抜け（授業→空き→授業）を増やす配置を避ける
    const lunchAfter = Number(state.settings.lunchAfter || 0);
    for (const t of (it.teas || [])) {
      const tday = idx.tea?.[t]?.[day] || {};
      const set = new Set();
      for (const p in tday) for (const oid of (tday[p] || [])) { if (oid !== id) set.add(Number(p)); }
      for (let dp = 0; dp < span; dp++) set.add(period + dp);
      if (set.size >= 2) {
        const arr = [...set].sort((a, b) => a - b);
        let holes = 0;
        for (let pp = arr[0] + 1; pp < arr[arr.length - 1]; pp++) {
          if (set.has(pp)) continue;
          if (lunchAfter && pp === lunchAfter + 1) continue; // 昼休み直後の空きは中抜けと見なさない
          holes++;
        }
        pen += holes * 3;
      }
      // 連続授業: この配置で先生が3連続/4連続以上になるなら減点（4連続は特に重く）
      {
        const add = teacherRunScore(set, day);
        pen += add * 3 + (add >= 10 ? add * 9 : 0);
      }
    }
    // 時間帯の偏り: このクラスの同じ授業が既に1時間目/午後に多いのに、さらに同じ時間帯へ置く配置を減点
    for (const c of (it.cls || [])) {
      let n = 1, first = (period === 1 ? 1 : 0), pm = (lunchAfter && period > lunchAfter ? 1 : 0);
      const seenS = new Set([id]);
      const cIdx = idx.cls?.[c] || {};
      for (const d in cIdx) for (const pk in cIdx[d]) for (const oid of (cIdx[d][pk] || [])) {
        if (seenS.has(oid)) continue; seenS.add(oid);
        const o = state.items[oid]; if (!o || o.subjKey !== it.subjKey) continue;
        const op = state.placements[oid]; if (!op || !op.day) continue;
        n++; if (op.period === 1) first++; if (lunchAfter && op.period > lunchAfter) pm++;
      }
      if (n >= 2) {
        if (period === 1) pen += Math.max(0, first - Math.max(1, Math.floor(n / 3))) * 12;
        if (lunchAfter && period > lunchAfter) pen += Math.max(0, pm - Math.max(1, Math.ceil(n / 2))) * 8;
      }
    }
    return pen;
  }

  // 【提案精度】移動の前後で「関係する先生・クラスの、関係する曜日」の時間割の悪さを比べる。
  // 移動先だけでなく移動元に空きコマ(中抜け)ができる悪化や、逆に解消される改善も反映する。
  function localSoftCost(teas, clsList, days) {
    const idx = buildIndex();
    const lunchAfter = Number(state.settings.lunchAfter || 0);
    let cost = 0;
    for (const t of teas) for (const d of days) {
      const tday = idx.tea?.[t]?.[d] || {};
      const ps = Object.keys(tday).filter(p => (tday[p] || []).length).map(Number).sort((a, b) => a - b);
      if (ps.length >= 2) {
        const set = new Set(ps);
        for (let pp = ps[0] + 1; pp < ps[ps.length - 1]; pp++) {
          if (set.has(pp) || (lunchAfter && pp === lunchAfter + 1)) continue;
          cost += 6; // 中抜け（先生にとって負担が大きいので重め）
        }
      }
      const maxD = teacherDailyMax(t);
      if (maxD != null && ps.length > maxD) cost += (ps.length - maxD) * 6;
      // 連続授業（3連続=3、4連続=30、5連続=60）
      {
        const add = teacherRunScore(new Set(ps), d);
        cost += add * 3 + (add >= 10 ? add * 9 : 0); // 4連続以上は提案ではほぼ選ばない重さに
      }
    }
    // 3年の体育: 入れる日には3年の全クラスに（体育が無いクラス1つにつき30点）
    if (clsList.some(c => new RegExp('^' + PE_GRADE + '-\\d+$').test(c))) cost += peFairPenalty(state.placements) * 30;
    // 同じ授業が1時間目ばかり・午後ばかりになっていないか（クラスごと・週全体）
    for (const c of clsList) {
      const agg = {}; const seenA = new Set();
      const cIdx = idx.cls?.[c] || {};
      for (const d in cIdx) for (const pk in cIdx[d]) for (const oid of (cIdx[d][pk] || [])) {
        if (seenA.has(oid)) continue; seenA.add(oid);
        const o = state.items[oid]; if (!o) continue;
        const op = state.placements[oid]; if (!op || !op.day) continue;
        const a = agg[o.subjKey] || (agg[o.subjKey] = { n: 0, first: 0, pm: 0 });
        a.n++; if (op.period === 1) a.first++; if (lunchAfter && op.period > lunchAfter) a.pm++;
      }
      for (const k in agg) {
        const a = agg[k]; if (a.n < 2) continue;
        cost += Math.max(0, a.first - Math.max(1, Math.floor(a.n / 3))) * 12;
        cost += Math.max(0, a.pm - Math.max(1, Math.ceil(a.n / 2))) * 8;
      }
    }
    for (const c of clsList) for (const d of days) {
      const cday = idx.cls?.[c]?.[d] || {};
      const bySubj = {}; const starts = [];
      for (const p in cday) for (const oid of (cday[p] || [])) {
        if (isSpanFill(oid, d, Number(p))) continue;
        const o = state.items[oid]; if (!o) continue;
        (bySubj[o.subjKey] = bySubj[o.subjKey] || []).push(oid);
        starts.push({ p: Number(p), id: oid, span: o.span || 1 });
      }
      for (const k in bySubj) {
        const n = new Set(bySubj[k]).size;
        if (n > 1) cost += (n - 1) * ((state.subjectCfg[k] || {}).noSameDay ? 24 : 10);
      }
      starts.sort((a, b) => a.p - b.p);
      for (let i = 0; i + 1 < starts.length; i++) {
        const a = starts[i], b = starts[i + 1];
        if (a.p + a.span !== b.p) continue;
        const da = (state.subjectCfg[state.items[a.id]?.subjKey] || {}).dept || '';
        const db = (state.subjectCfg[state.items[b.id]?.subjKey] || {}).dept || '';
        if (da && da === db) cost += ((state.subjectCfg[state.items[b.id]?.subjKey] || {}).noConsec ? 10 : 4);
      }
    }
    return cost;
  }
  function moveDeltaCost(moves) {
    if (!moves || !moves.length) return 0;
    const teas = new Set(), cls = new Set(), days = new Set();
    for (const m of moves) {
      const it = state.items[m.id]; if (!it) continue;
      (it.teas || []).forEach(t => teas.add(t)); (it.cls || []).forEach(c => cls.add(c));
      days.add(m.day); const cur = state.placements[m.id]; if (cur && cur.day) days.add(cur.day);
    }
    const T = [...teas], C = [...cls], D = [...days];
    const before = localSoftCost(T, C, D);
    const after = puzWithTempMoves(moves, () => localSoftCost(T, C, D));
    return after - before; // 負なら時間割が良くなる
  }

  function chainQualityScore(moves) {
    if (!moves || !moves.length) return 0;
    let __delta = 0; try { __delta = moveDeltaCost(moves); } catch (e) { }
    return -__delta + puzWithTempMoves(moves, () => {
      let score = 0;
      for (const m of moves) {
        const v = validatePlacement(m.id, m.day, m.period, 'safe', null) || { blocks: [], warns: [] };
        score -= v.blocks.length * 20;
        score -= v.warns.length * 5;
        // ボーナス: 午前中・教員コマ数が少ない日
        const it = state.items[m.id];
        if (it) {
          for (const tea of (it.teas || [])) score -= teacherDayCount(tea, m.day) * 2;
        }
        score += m.period <= 3 ? 3 : 0;
      }
      return score;
    });
  }

  /**
   * computeGridChainCore(id, targetSlots)
   * puzSearch を使って、id を targetSlots のどれかに配置する
   * グリッド内連動移動を探索する。
   * 在庫不使用・全コマ制約満足を保証する。
   */
  function computeGridChainCore(id, targetSlots, maxResults = 16) {
    const it = state.items[id];
    if (!it) return [];
    const out = [];
    const seen = new Set();
    const startTime = Date.now();

    const foundMap = puzSearchTwoPass(id, targetSlots, 1200);
    for (const { day, p } of targetSlots) {
      if (out.length >= maxResults * 2) break;

      const moves = foundMap.get(day + p);
      if (!moves || !moves.length) continue;

      // 重複排除
      const k = moves.map(m => `${m.id}:${m.day}:${m.period}`).sort().join('|');
      if (seen.has(k)) continue;
      seen.add(k);

      // 品質スコア計算（全移動先の制約を検証）
      const qualScore = chainQualityScore(moves);
      const depth = moves.length - 1; // ブロッカーの移動手数
      const baseScore = Math.max(20, 88 - depth * 12) + qualScore;

      // 各移動の説明
      const prereqs = moves.filter(m => m.id !== id);
      const desc = prereqs.length > 0
        ? prereqs.map(m => {
          const subj = state.items[m.id]?.subjKey || m.id;
          const from = state.placements[m.id]
            ? `${DAYJP[state.placements[m.id].day]}${state.placements[m.id].period}`
            : '在庫';
          return `${subj} ${from}→${DAYJP[m.day]}${m.period}`;
        }).join(' → ')
        : '直接移動可能';

      const typeLabel = depth === 0 ? '直接'
        : depth === 1 ? '2手連動'
          : depth === 2 ? '3手連動'
            : `${depth + 1}手連動`;

      out.push({
        title: `${typeLabel}: ${DAYJP[day]}${p}限へ`,
        score: Math.round(baseScore),
        reason: [
          depth === 0 ? '空き枠あり' : `${prereqs.length}コマを連動移動（グリッド内、在庫なし）`,
          desc,
          ...(prereqs.length > 0 ? ['✓ 全コマ制約チェック済み'] : []),
        ],
        moves,
        noStock: true,
        chainDepth: depth,
      });
    }

    out.sort((a, b) => b.score - a.score);
    // 重複手順が多い場合は間引き
    const deduped = [];
    const depthCount = {};
    for (const s of out) {
      const d = s.chainDepth;
      depthCount[d] = (depthCount[d] || 0) + 1;
      if (depthCount[d] <= 4) deduped.push(s); // 各手数最大4件
    }
    return deduped.slice(0, maxResults);
  }

  /**
   * computeLinkedSuggestions(id)
   * 配置済み・未配置どちらにも対応する連動提案。
   * puzSearch で 1〜4手先まで探索し、在庫不使用の解のみ返す。
   */
  function computeLinkedSuggestions(id) {
    const it = state.items[id];
    if (!it) return [];

    const curPlc = state.placements[id];

    // 候補スロットを事前にスコアリング
    const slots = [];
    for (const day of DAYS) {
      const maxP = maxPeriod(day);
      for (let p = 1; p <= maxP; p++) {
        if ((it.span || 1) === 2 && p >= maxP) continue;
        if (curPlc && curPlc.day === day && curPlc.period === p) continue;

        const v = validatePlacement(id, day, p, 'safe', null) || { blocks: [], warns: [] };
        // 直接置ける場合は empty タブに任せる（ただし0〜1警告のみの場合は含める）
        if (v.blocks.length === 0 && v.warns.length === 0) continue; // 完全空きはスキップ

        // ブロッカー数が少ない順に優先（見込みが高い）
        const priority = 100 - v.blocks.length * 15 - v.warns.length * 5 + (p <= 3 ? 3 : 0);
        slots.push({ day, p, priority, blocks: v.blocks.length });
      }
    }
    slots.sort((a, b) => b.priority - a.priority);

    // v63.2: 上位スロットで探索（最大32スロットに拡張、結果24件）
    const topSlots = slots.slice(0, 32);
    return computeGridChainCore(id, topSlots, 24);
  }


  function computeSuggestionPack(id) {
    const deep = !!(window && window.__SUG_DEEP);
    // 提案一式で共有する総時間予算。多数のpuzSearch呼び出しの合計を抑えてポップアップの固まりを防ぐ。
    // 深読みONのときは少し長めに許容する。
    // まず収まり探索（全マスについて「押し出されたコマも全員収まる手順」を高速に読む）を走らせ、
    // 従来の探索は残りの短い時間で別案を足す役に回す。
    let fitRaw = [];
    try { if (typeof fitSuggestions === 'function') fitRaw = fitSuggestions(id, deep ? 1500 : 500, deep ? { maxMoves: 14, nodeCap: 8000, sweeps: 2 } : {}); } catch (e) { console.error('提案計算エラー (収まり探索):', e); }
    try { window.__PUZ_GLOBAL_DEADLINE = Date.now() + (deep ? 1200 : 300); if (typeof __puzMemo !== 'undefined') __puzMemo.clear(); } catch (e) { }
    const safeCompute = (fn, label) => {
      try {
        return fn() || [];
      } catch (e) {
        console.error(`提案計算エラー (${label}):`, e);
        return [];
      }
    };

    const filterSame = arr => arr.filter(s => !isSamePositionSuggestion(s));

    // v49+: スコア降順にソート（各タブ内で品質順）
    const sortByScore = arr => [...arr].sort((a, b) => (b.score || 0) - (a.score || 0));

    // v45.2: 全タブ横断で重複排除（movesキーで管理）
    const globalSeenKeys = new Set();
    const dedupGlobal = (arr) => arr.filter(s => {
      const k = movesKey(s.moves);
      if (!k || globalSeenKeys.has(k)) return false;
      globalSeenKeys.add(k);
      return true;
    });

    // v49+: 連動提案（グリッド内・在庫不使用）を主軸に
    // computeLinkedSuggestions は puzSearch ベースでブロッカーの連鎖も解決
    const linkedRaw = sortByScore(filterSame([...fitRaw, ...safeCompute(() => (deep && typeof computeLinkedSuggestionsDeep === 'function') ? computeLinkedSuggestionsDeep(id) : computeLinkedSuggestions(id), '連動')]));

    // 入替: 2コマ入替 + 連動提案の1手分
    const swapRaw = sortByScore(filterSame([
      ...safeCompute(() => computeSwapSuggestions(id), '入替'),
    ]));

    // 回転: 3〜4コマの回転（全グリッド内）
    const cycleRaw = sortByScore(filterSame(safeCompute(() => (deep && typeof computeCycleSuggestionsDeep === 'function') ? computeCycleSuggestionsDeep(id) : computeCycleSuggestions(id), '回転')));

    // パズル: 全体最適・先読み
    const lookaheadRaw = sortByScore(filterSame([
      ...(deep && typeof computeDeepOptimizeSuggestions === 'function' ? safeCompute(() => computeDeepOptimizeSuggestions(id), '深読み') : []),
      ...safeCompute(() => computePuzzleSuggestions(id), 'パズル'),
      ...safeCompute(() => computeLookaheadSuggestions(id), '先読み')
    ]));

    // LNS: Large Neighborhood Search（部分破壊→再配置で「全体の収まり」を改善）
    const lnsRaw = sortByScore(filterSame(safeCompute(() => (typeof window !== 'undefined' && window.__SUG_LNS && typeof computeLNSSuggestions === 'function') ? computeLNSSuggestions(id) : [], 'LNS')));

    const raw = {
      empty: filterSame(safeCompute(() => computeEmptySuggestions(id), '空き枠')),
      swap: swapRaw,
      cycle: cycleRaw,
      linked: linkedRaw,   // v49: stash → linked (グリッド内連動)
      lookahead: lookaheadRaw,
      lns: lnsRaw,
      force: filterSame(safeCompute(() => computeForceSuggestions(id), '強制')),
    };

    // 総予算をクリア（残すと後続の単発puzSearchが即中断してしまう）
    try { window.__PUZ_GLOBAL_DEADLINE = 0; } catch (e) { }

    // タブ順に重複排除（先に出たタブ優先）
    return {
      empty: dedupGlobal(raw.empty),
      swap: dedupGlobal(raw.swap),
      cycle: dedupGlobal(raw.cycle),
      linked: dedupGlobal(raw.linked),
      lookahead: dedupGlobal(raw.lookahead),
      lns: dedupGlobal(raw.lns || []),
      force: dedupGlobal(raw.force),
    };
  }


  function simulateMoves(moves) {
    const backup = {};
    for (const m of moves) { backup[m.id] = state.placements[m.id]; }
    try {
      // remove
      for (const m of moves) { state.placements[m.id] = null; }
      // apply
      for (const m of moves) {
        state.placements[m.id] = { day: m.day, period: m.period, locked: backup[m.id]?.locked || false };
      }
      invalidateIndex();
      // warm cache
      buildIndex();
      // validate all
      const errors = [];
      for (const m of moves) {
        const v = validatePlacement(m.id, m.day, m.period, 'safe', null);
        if (v.blocks.length) errors.push(...v.blocks.map(x => `[${m.id}] ${x}`));
      }
      return { ok: errors.length === 0, errors };
    } finally {
      for (const k in backup) { state.placements[k] = backup[k]; }
      invalidateIndex();
    }
  }

  /* v39: 印刷自動フィット — A4縦1枚に収まるようcellStep/fontStepを自動算出 */
  function printAutoFit() {
    const type = $('#print-type')?.value || 'class';
    const keys = getAxisKeys(type);
    if (!keys.length) { flash('データがありません'); return; }
    const maxP = Math.max(...DAYS.map(d => maxPeriod(d)));

    // A4縦の利用可能高さ（mm→px換算, 96dpi）: 297mm - マージン30mm ≈ 267mm → 1013px
    // ただしブラウザのCSSピクセルとmm変換は近似
    const pageH = 960; // px (conservative)
    const rowCount = maxP + 1; // +1 for header
    const targetCellH = Math.floor((pageH / rowCount) - 2); // -2px for borders

    const cellSizes = [28, 34, 40, 46, 52, 58, 66, 76, 88, 100, 120, 140];
    const fontSizes = [8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 20, 24];
    const baseIdx = 3;

    // cellStep: cellSizes[baseIdx+step] <= targetCellH
    let bestCellStep = -4;
    for (let s = -4; s <= 8; s++) {
      if (cellSizes[clamp(baseIdx + s, 0, cellSizes.length - 1)] <= targetCellH) bestCellStep = s;
    }

    // fontStep: 対応するフォントサイズ（cellの比率で決定）
    const bestFontStep = Math.max(-4, bestCellStep - 1);

    state.ui.printCellStep = bestCellStep;
    state.ui.printFontStep = bestFontStep;
    markDirty('ui');
    renderPrint();
    flash(`自動フィット: セル高${cellSizes[clamp(baseIdx + bestCellStep, 0, cellSizes.length - 1)]}px / 文字${fontSizes[clamp(baseIdx + bestFontStep, 0, fontSizes.length - 1)]}px`);
  }

  function applySuggestion(s) {
    const moves0 = s?.moves || [];
    if (!moves0.length) return;

    // ロックは動かさない（安全側）
    const moves = moves0.filter(m => !state.placements[m.id]?.locked);
    if (!moves.length) { flash('移動対象がロックされています'); return; }

    // 強制提案かどうか判定（タイトルに「強制」が含まれる場合はvalidation skip）
    const isForce = !!(s.force || (s.title || '').includes('強制') || (s.title || '').includes('⚠'));

    if (!isForce) {
      const sim = simulateMoves(moves);
      if (!sim.ok) {
        // 強制適用の確認ダイアログを出す
        const errMsg = sim.errors.slice(0, 3).join('\n');
        showModal(
          '制約違反があります — 強制適用しますか？',
          `${errMsg}\n\n「OK」で強制的に配置します（違反は残ります）。`,
          () => {
            _doApplySuggestion(moves);
          }
        );
        return;
      }
    }

    _doApplySuggestion(moves);
  }

  function _doApplySuggestion(moves) {
    pushHistory('suggest');

    // ★原子適用：いったん全員外す→まとめて置く
    const lockMap = {};
    for (const m of moves) {
      lockMap[m.id] = !!state.placements[m.id]?.locked;
      state.placements[m.id] = null;
    }
    invalidateIndex();

    for (const m of moves) {
      doPlace(m.id, m.day, m.period, null);
      if (state.placements[m.id]) state.placements[m.id].locked = lockMap[m.id];
    }

    invalidateIndex();
    markDirty('place');
    rerenderAll();
    broadcastState();
  }
  /* =======================
     仕上げ: 先生の連続授業（4連続→3連続）と、同じ授業の時間帯の偏り（1時間目ばかり/午後ばかり）を減らす
     - 問題のあるコマごとに「同じクラスの別のコマとの入替」「空き枠への移動」「同じクラス内の3コマ回転」を試し、
       衝突を作らず時間割全体の悪さ(moveDeltaCost)が下がる手だけを採用する
     - ロック済みのコマは動かさない
  ======================= */
  function softProblemIds() {
    const lunchAfter = Number(state.settings.lunchAfter || 0);
    const idx = buildIndex();
    const prio = {};
    // 総合的な探究・LHRは学年一斉で動かせないので対象外（時間を無駄にしない）
    const fixedLike = (id) => /総合的な探究|ＬＨＲ|LHR/.test(state.items[id]?.subj || '');
    const bump = (id, v) => { if (!state.placements[id]?.locked && !fixedLike(id)) prio[id] = Math.max(prio[id] || 0, v); };
    const stat = { run4: 0, run3: 0, first: 0, pm: 0 };
    // 先生の連続授業
    for (const t in idx.tea) for (const d of DAYS) {
      const dm = idx.tea[t]?.[d]; if (!dm) continue;
      const taught = new Set(Object.keys(dm).filter(p => (dm[p] || []).length).map(Number));
      for (const run of teacherRuns(taught, d)) {
        if (run.length < 3) continue;
        if (run.length >= 4) stat.run4++; else stat.run3++;
        for (const p of run) for (const id of (dm[p] || [])) bump(id, run.length >= 4 ? 30 : 10);
      }
    }
    // 同じ授業の時間帯の偏り
    for (const c in idx.cls) {
      const agg = {}; const seen = new Set();
      for (const d in idx.cls[c]) for (const pk in idx.cls[c][d]) for (const id of (idx.cls[c][d][pk] || [])) {
        if (seen.has(id)) continue; seen.add(id);
        const it = state.items[id], pl = state.placements[id]; if (!it || !pl) continue;
        const a = agg[it.subjKey] || (agg[it.subjKey] = { n: 0, first: [], pm: [] });
        a.n++; if (pl.period === 1) a.first.push(id); if (lunchAfter && pl.period > lunchAfter) a.pm.push(id);
      }
      for (const k in agg) {
        const a = agg[k]; if (a.n < 2) continue;
        if (a.first.length > Math.max(1, Math.floor(a.n / 3))) { stat.first++; a.first.forEach(id => bump(id, 20)); }
        if (a.pm.length > Math.max(1, Math.ceil(a.n / 2))) { stat.pm++; a.pm.forEach(id => bump(id, 15)); }
      }
    }
    // 3年の体育が一部のクラスにしか無い日 → その日の体育を動かす候補に
    {
      const before = peFairPenalty(state.placements); stat.pe = before;
      if (before > 0) for (const id in state.items) { const it = state.items[id]; if (/体育/.test(it.subj || '') && (it.cls || []).some(c => new RegExp('^' + PE_GRADE + '-').test(c))) bump(id, 25); }
    }
    const ids = Object.keys(prio).sort((x, y) => prio[y] - prio[x]);
    return { ids, stat };
  }

  // 1コマについて、衝突を作らずに時間割を良くする最良の手を探す（無ければ null）
  function bestSoftFixFor(id, deadline) {
    const it = state.items[id]; const plc = state.placements[id];
    if (!it || !plc || plc.locked) return null;
    const span = it.span || 1;
    const clsKey = (it.cls || []).slice().sort().join(',');
    let best = null;
    const consider = (moves) => {
      if (moves.some(m => state.placements[m.id]?.locked)) return;
      const sim = simulateMoves(moves); if (!sim.ok) return;
      let d = 0; try { d = moveDeltaCost(moves); } catch (e) { return; }
      if (d < -0.5 && (!best || d < best.delta)) best = { moves, delta: d };
    };
    // 同じクラス（同じクラス構成・同じ長さ）の他のコマ
    const peers = [];
    for (const oid in state.items) {
      if (oid === id) continue;
      const o = state.items[oid], op = state.placements[oid];
      if (!o || !op || !op.day || op.locked) continue;
      if ((o.span || 1) !== span) continue;
      if ((o.cls || []).slice().sort().join(',') !== clsKey) continue;
      peers.push(oid);
    }
    // 1) 入替
    for (const oid of peers) {
      if (Date.now() > deadline) break;
      const op = state.placements[oid];
      consider([{ id, day: op.day, period: op.period, span }, { id: oid, day: plc.day, period: plc.period, span }]);
    }
    // 2) 空き枠への移動（クラスの空き時限）
    for (const d of DAYS) {
      const maxP = maxPeriod(d);
      for (let p = 1; p + span - 1 <= maxP; p++) {
        if (Date.now() > deadline) break;
        if (d === plc.day && p === plc.period) continue;
        const v = validatePlacement(id, d, p, 'safe', null);
        if (v.blocks.length) continue;
        consider([{ id, day: d, period: p, span }]);
      }
    }
    // 1b) 合同授業（複数クラス）・クラスをまたぐ入替:
    //     移動先の時限に「関係するクラスそれぞれの授業」が1コマずつある場合、それらを丸ごと元の時限へ移す。
    //     移動先のコマが関係クラス以外のクラスも含む場合や、ロック・長さ違いは対象外
    {
      const clsSet = new Set(it.cls || []);
      const idx0 = buildIndex(); // 試すたびに作り直さないよう、最初の索引を使い回す
      for (const d of DAYS) {
        const maxP = maxPeriod(d);
        for (let p = 1; p + span - 1 <= maxP; p++) {
          if (Date.now() > deadline) break;
          if (d === plc.day && p === plc.period) continue;
          const others = new Set();
          let ok = true;
          for (let k = 0; k < span && ok; k++) {
            for (const c of clsSet) {
              for (const oid of (idx0.cls?.[c]?.[d]?.[p + k] || [])) {
                if (oid === id) continue;
                const o = state.items[oid], op = state.placements[oid];
                if (!o || !op || op.locked || (o.span || 1) !== span || op.period !== p || !(o.cls || []).every(x => clsSet.has(x))) { ok = false; break; }
                others.add(oid);
              }
              if (!ok) break;
            }
          }
          if (!ok || !others.size) continue;
          if (others.size === 1 && peers.includes([...others][0])) continue; // 1対1の入替は上で試し済み
          consider([{ id, day: d, period: p, span }, ...[...others].map(oid => ({ id: oid, day: plc.day, period: plc.period, span }))]);
        }
      }
    }
    // 3) 同じクラス内の3コマ回転（入替で直らない時だけ）
    if (!best) {
      const lim = Math.min(peers.length, 18);
      for (let i = 0; i < lim && Date.now() <= deadline; i++) for (let j = 0; j < lim && Date.now() <= deadline; j++) {
        if (i === j) continue;
        const a = peers[i], b = peers[j];
        const pa = state.placements[a], pb = state.placements[b];
        consider([
          { id, day: pa.day, period: pa.period, span },
          { id: a, day: pb.day, period: pb.period, span },
          { id: b, day: plc.day, period: plc.period, span },
        ]);
      }
    }
    // 4) それでも直らない時は、収まり探索で「他のクラス・先生のコマも含めて数コマ動かす」手を探す
    //    （押し出されたコマも全員収まり、注意も増えず、連続・偏りが減る手だけを採用）
    if (!best && typeof fitSuggestions === 'function' && Date.now() < deadline) {
      try {
        for (const s of fitSuggestions(id, Math.min(250, deadline - Date.now()), { maxMoves: 6 })) {
          if (s.newWarns || !(s.deltaCost < -0.5)) continue;
          if (best && s.deltaCost >= best.delta) continue;
          const moves = s.moves.map(m => ({ id: m.id, day: m.day, period: m.period, span: m.span || 1 }));
          if (moves.some(m => state.placements[m.id]?.locked) || !simulateMoves(moves).ok) continue;
          best = { moves, delta: s.deltaCost };
        }
      } catch (e) { console.error('収まり探索(改善):', e); }
    }
    return best;
  }

  // 時間の許す限り直す（非同期・画面を固めない）。戻り値は前後の件数
  async function polishTeacherRunsAndSpread(opts = {}) {
    const budgetMs = opts.budgetMs || 15000;
    const statusEl = document.getElementById('ai-status');
    const start = Date.now(); const end = start + budgetMs;
    const before = softProblemIds().stat;
    let applied = 0, histPushed = false;
    for (let pass = 0; pass < 4 && Date.now() < end; pass++) {
      const { ids } = softProblemIds();
      if (!ids.length) break;
      let changed = 0;
      for (const id of ids) {
        if (Date.now() >= end) break;
        if (opts.shouldStop && opts.shouldStop()) { pass = 99; break; }
        const fix = bestSoftFixFor(id, Math.min(end, Date.now() + 600));
        if (fix) {
          if (!histPushed) { pushHistory('polish'); histPushed = true; }
          for (const m of fix.moves) state.placements[m.id] = null;
          for (const m of fix.moves) state.placements[m.id] = { day: m.day, period: m.period, locked: false };
          invalidateIndex(); applied++; changed++;
        }
        if (statusEl) statusEl.textContent = `🧹 連続・偏りを改善中… ${applied}手`;
        await new Promise(r => setTimeout(r, 0)); // 画面を固めない
      }
      if (!changed) break;
    }
    const after = softProblemIds().stat;
    if (applied) { markDirty('place'); rerenderAll(); broadcastState(); }
    const msg = `🧹 改善 ${applied}手: 4連続 ${before.run4}→${after.run4}・3連続 ${before.run3}→${after.run3}・1時間目の偏り ${before.first}→${after.first}・午後の偏り ${before.pm}→${after.pm}` + ((before.pe || after.pe) ? `・3年体育が無いクラス ${before.pe}→${after.pe}` : '');
    if (statusEl) statusEl.textContent = msg;
    if (!opts.silent) flash(msg);
    return { before, after, applied };
  }

  function computeEmptySuggestions(id) {
    const it = state.items[id];
    if (!it) return [];
    const curPlc = state.placements[id]; // 現在の配置
    const out = [];
    for (const day of DAYS) {
      const maxP = maxPeriod(day);
      for (let p = 1; p <= maxP; p++) {
        if (it.span === 2 && p === maxP) continue;
        // v42: 同じ位置への移動は除外（意味がない）
        if (curPlc && curPlc.day === day && curPlc.period === p) continue;
        const v = validatePlacement(id, day, p, 'safe', null);
        if (v.blocks.length) continue;
        let score = 100;
        const reason = [];
        for (const tea of it.teas) {
          const taught = teacherDayCount(tea, day);
          score -= taught * 2;
          reason.push(`${tea}:本日${taught}コマ`);
        }
        score -= v.warns.length * 8;
        if (v.warns.length) reason.push('警告:' + v.warns.join(','));
        score += (p <= 2) ? 3 : 0;
        // 【提案精度】同科目の同日重複・教科の連続を加味して、より良い枠を上位にする
        let delta = 0; try { delta = moveDeltaCost([{ id, day, period: p, span: it.span || 1 }]); } catch (e) { }
        score -= delta;
        if (delta >= 10) reason.push('同科目が同じ日/教科連続/空きコマが増える');
        else if (delta < 0) reason.push('時間割が良くなる（空きコマ・重複が減る）');
        out.push({ title: `空き: ${DAYJP[day]}${p}`, score, reason, moves: [{ id, day, period: p, span: it.span || 1 }] });
      }
    }

    // 空き枠がない場合のパズル提案は「先読み」タブ側（computePuzzleSuggestions）で計算するため、
    // ここでは重ねて探索しない（同じ探索を2回行い時間を浪費していた）

    out.sort((a, b) => b.score - a.score);
    return out.slice(0, 14);
  }
  function teacherDayCount(tea, day) {
    const idx = buildIndex();
    const maxP = maxPeriod(day);
    let cnt = 0;
    for (let p = 1; p <= maxP; p++) {
      const ids = idx.tea?.[tea]?.[day]?.[p] || [];
      if (ids.some(x => !isSpanFill(x, day, p))) cnt++;
    }
    return cnt;
  }
  function computeSwapSuggestions(id) {
    const it = state.items[id]; const plc = state.placements[id];
    if (!it || !plc) return []; // swap needs origin
    const idx = buildIndex();
    const out = [];
    // candidates: cells that are currently occupied (teacher/class/room conflicts likely)
    const candIds = Object.keys(state.placements).filter(x => state.placements[x]).slice(0, 200);
    for (const other of candIds) {
      if (other === id) continue;
      const po = state.placements[other];
      const ito = state.items[other]; if (!po || !ito) continue;
      // v42: 自分が既にその位置にいる場合はスキップ（意味のない入替）
      if (plc.day === po.day && plc.period === po.period) continue;
      // try swap id<->other
      const moves = [
        { id, day: po.day, period: po.period, span: it.span || 1 },
        { id: other, day: plc.day, period: plc.period, span: ito.span || 1 },
      ];
      const sim = simulateMoves(moves);
      if (!sim.ok) continue;
      // 【提案精度】衝突ゼロの入替を一律80点にせず、入替後の良さ（同科目重複/教科連続/教員負荷）で差を付ける
      const score = 80 + chainQualityScore(moves);
      out.push({ title: `入替: ${DAYJP[po.day]}${po.period} ↔ ${DAYJP[plc.day]}${plc.period}`, score: Math.round(score), reason: [`相手:${ito.subjKey}`], moves });
      if (out.length >= 60) break; // 収集上限（この後スコア順に絞る）
    }
    // 【提案精度】良い入替を上位に（衝突ゼロのものを品質順に並べて上位のみ返す）
    out.sort((a, b) => b.score - a.score);
    return out.slice(0, 14);
  }
  function computeCycleSuggestions(id) {
    const it = state.items[id]; const plc = state.placements[id];
    if (!it || !plc) return [];
    const out = [];
    const T0 = Date.now();
    const placed = Object.keys(state.placements)
      .filter(x => state.placements[x] && x !== id && !state.placements[x].locked)
      .slice(0, 200);

    // --- 3コマ回転 ---
    outer3:
    for (let i = 0; i < placed.length; i++) {
      if (Date.now() - T0 > 200) break;
      const a = placed[i]; const pa = state.placements[a]; const ita = state.items[a]; if (!pa || !ita) continue;
      for (let j = i + 1; j < placed.length; j++) {
        const b = placed[j]; const pb = state.placements[b]; const itb = state.items[b]; if (!pb || !itb) continue;
        const moves = [
          { id, day: pa.day, period: pa.period, span: it.span || 1 },
          { id: a, day: pb.day, period: pb.period, span: ita.span || 1 },
          { id: b, day: plc.day, period: plc.period, span: itb.span || 1 },
        ];
        const sim = simulateMoves(moves);
        if (!sim.ok) continue;
        const qs = chainQualityScore(moves);
        out.push({
          title: `3コマ回転: →${DAYJP[pa.day]}${pa.period}`,
          score: 72 + qs,
          reason: [`${ita.subjKey}→${DAYJP[pb.day]}${pb.period}, ${itb.subjKey}→${DAYJP[plc.day]}${plc.period}`],
          moves, noStock: true,
        });
        if (out.length >= 5) break outer3;
      }
    }

    // --- 4コマ回転 ---
    if (Date.now() - T0 < 280 && placed.length >= 3) {
      outer4:
      for (let i = 0; i < Math.min(placed.length, 100); i++) {
        if (Date.now() - T0 > 320) break;
        const a = placed[i]; const pa = state.placements[a]; const ita = state.items[a]; if (!pa || !ita) continue;
        for (let j = i + 1; j < Math.min(placed.length, 100); j++) {
          const b = placed[j]; const pb = state.placements[b]; const itb = state.items[b]; if (!pb || !itb) continue;
          for (let k = j + 1; k < Math.min(placed.length, 80); k++) {
            if (Date.now() - T0 > 350) break;
            const c = placed[k]; const pc = state.placements[c]; const itc = state.items[c]; if (!pc || !itc) continue;
            const moves4 = [
              { id, day: pa.day, period: pa.period, span: it.span || 1 },
              { id: a, day: pb.day, period: pb.period, span: ita.span || 1 },
              { id: b, day: pc.day, period: pc.period, span: itb.span || 1 },
              { id: c, day: plc.day, period: plc.period, span: itc.span || 1 },
            ];
            const sim4 = simulateMoves(moves4);
            if (!sim4.ok) continue;
            const qs4 = chainQualityScore(moves4);
            out.push({
              title: `4コマ回転: →${DAYJP[pa.day]}${pa.period}`,
              score: 60 + qs4,
              reason: [`4コマ連鎖回転（在庫不使用）`,
                `${ita.subjKey}→${DAYJP[pb.day]}${pb.period}, ${itb.subjKey}→${DAYJP[pc.day]}${pc.period}, ${itc.subjKey}→${DAYJP[plc.day]}${plc.period}`],
              moves: moves4, noStock: true,
            });
            if (out.length >= 8) break outer4;
          }
        }
      }
    }

    out.sort((a, b) => b.score - a.score);
    return out.slice(0, 8);
  }

  /**
   * v49+: computeChainSwapSuggestions
   * puzSearch を使ったグリッド内連動提案（配置済みコマ用）
   * 在庫退避なし・全コマ制約チェック済み
   */
  function computeChainSwapSuggestions(id) {
    return computeLinkedSuggestions(id);
  }

  function computeForceSuggestions(id) {
    const it = state.items[id];
    if (!it) return [];
    const curPlc = state.placements[id];
    const out = [];
    for (const day of DAYS) {
      const maxP = maxPeriod(day);
      for (let p = 1; p <= maxP; p++) {
        if ((it.span || 1) === 2 && p === maxP) continue;
        if (curPlc && curPlc.day === day && curPlc.period === p) continue;
        const v = validatePlacement(id, day, p, 'safe', null);
        // 違反あり OR 警告のみのコマを対象とする（完全OKはemptyタブで扱う）
        if (v.blocks.length === 0 && v.warns.length === 0) continue; // 完全空きはスキップ
        const score = -v.blocks.length * 20 - v.warns.length * 5 + (p <= 3 ? 5 : 0);
        const reason = [...v.blocks.map(b => `🔴${b}`), ...v.warns.map(w => `⚠${w}`)];
        const label = v.blocks.length > 0 ? `強制: ${DAYJP[day]}${p}限（違反${v.blocks.length}件）` : `警告: ${DAYJP[day]}${p}限`;
        out.push({ title: label, score, reason, moves: [{ id, day, period: p, span: it.span || 1 }] });
      }
    }
    out.sort((a, b) => (b.score || 0) - (a.score || 0));
    return out.slice(0, 12);
  }
  /**
   * v49+: computeStashSuggestions
   * 未配置コマ向け。puzSearch を使ったグリッド内連動提案。
   * 在庫退避なし・全コマ制約チェック付き。
   */
  function computeStashSuggestions(id) {
    const it = state.items[id];
    if (!it || state.placements[id]) return []; // 未配置コマのみ対象

    // computeLinkedSuggestions は配置済み・未配置どちらにも対応
    return computeLinkedSuggestions(id);
  }


  /* =======================
     Lookahead (先読み) suggestions — mini beam search
  ======================= */
  function computeLookaheadSuggestions(id) {
    // 改善版を使用
    if (typeof computeEnhancedLookaheadSuggestions === 'function') {
      try {
        return computeEnhancedLookaheadSuggestions(id);
      } catch (e) {
        console.error('改善版提案でエラー:', e);
        // フォールバック
      }
    }

    // For each candidate placement of 'id', simulate placing it then greedily
    // place the next N hardest unplaced items. Score = how many we can place + quality.
    const it = state.items[id]; if (!it) return [];
    const BEAM = 6;   // candidate placements to evaluate
    const DEPTH = 4;  // how many subsequent items to look ahead

    // Gather unplaced ids (excluding target)
    const allIds = Object.keys(state.items);
    const unplacedOthers = allIds.filter(x => x !== id && !state.placements[x]);

    // Sort by constraint hardness
    const hardness = (xid) => {
      const xi = state.items[xid]; if (!xi) return 0;
      const forbid = countForbid(xi.subjKey) || 0;
      return ((xi.span || 1) === 2 ? 10 : 0) + (xi.cls?.length > 1 ? 6 : 0) + (xi.teas?.length > 1 ? 5 : 0) + forbid * 0.4;
    };
    const nextIds = unplacedOthers.slice().sort((a, b) => hardness(b) - hardness(a)).slice(0, DEPTH);

    // Candidate placements for target
    const targetCands = [];
    for (const day of DAYS) {
      const maxP = maxPeriod(day);
      for (let p = 1; p <= maxP; p++) {
        if ((it.span || 1) === 2 && p === maxP) continue;
        const v = validatePlacement(id, day, p, 'safe', null);
        if (v.blocks.length) continue;
        targetCands.push({ day, period: p, score: 100 - v.warns.length * 5 });
      }
    }
    targetCands.sort((a, b) => b.score - a.score);
    const evalCands = targetCands.slice(0, BEAM);
    if (!evalCands.length) return [];

    // For each candidate, simulate
    const results = [];
    for (const cand of evalCands) {
      // temporarily place target
      const backup = deepClone(state.placements);
      state.placements[id] = { day: cand.day, period: cand.period, locked: false };
      invalidateIndex();

      // greedily place next items
      let placed = 0;
      const placedIds = [id];
      for (const nid of nextIds) {
        const nit = state.items[nid]; if (!nit) continue;
        let best = null, bestScore = -99999;
        for (const day2 of DAYS) {
          const maxP2 = maxPeriod(day2);
          for (let p2 = 1; p2 <= maxP2; p2++) {
            if ((nit.span || 1) === 2 && p2 === maxP2) continue;
            const v2 = validatePlacement(nid, day2, p2, 'safe', null);
            if (v2.blocks.length) continue;
            const sc = 100 - v2.warns.length * 5;
            if (sc > bestScore) { bestScore = sc; best = { day: day2, period: p2 }; }
          }
        }
        if (best) {
          state.placements[nid] = { day: best.day, period: best.period, locked: false };
          invalidateIndex();
          placed++;
          placedIds.push(nid);
        }
      }

      // restore
      state.placements = backup;
      invalidateIndex();

      const totalScore = 50 + placed * 20 + cand.score * 0.3;
      const moves = [{ id, day: cand.day, period: cand.period, span: it.span || 1 }];
      results.push({
        title: `先読み: ${DAYJP[cand.day]}${cand.period} (後続+${placed})`,
        score: Math.round(totalScore),
        reason: [`この後 ${placed}/${nextIds.length} コマ配置可能`, `難しいコマ優先で探索`],
        moves,
      });
    }
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, 6);
  }

