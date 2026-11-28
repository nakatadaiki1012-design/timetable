  /* =======================
     UI helpers
  ======================= */

  function hideCtxMenu() {
    const m = document.getElementById('ctx-menu');
    if (m) { m.style.display = 'none'; m.innerHTML = ''; }
  }
  function showCtxMenu(items, x, y) {
    const m = document.getElementById('ctx-menu');
    if (!m) return;
    m.innerHTML = items.map(it => {
      if (it.sep) return '<div class="sep"></div>';
      if (it.muted) return `<div class="item muted">${escapeHtml(it.label)}</div>`;
      return `<div class="item" data-act="${escapeAttr(it.act)}">${escapeHtml(it.label)}</div>`;
    }).join('');
    m.style.display = 'block';
    _ctxOpenedAt = Date.now();
    // position
    const vw = window.innerWidth, vh = window.innerHeight;
    const rect = m.getBoundingClientRect();
    let px = Math.min(x, vw - rect.width - 10);
    let py = Math.min(y, vh - rect.height - 10);
    m.style.left = px + 'px'; m.style.top = py + 'px';
    m.querySelectorAll('.item[data-act]').forEach(el => {
      el.onclick = (ev) => {
        const act = el.dataset.act;
        hideCtxMenu();
        const fn = items.find(i => i.act === act)?.on;
        try { fn && fn(); } catch (e) { console.error(e); }
      };
    });
  }
  // ボタンを押して開いたメニューが、その同じクリックで閉じてしまわないようにする
  let _ctxOpenedAt = 0;
  window.addEventListener('click', () => { if (Date.now() - _ctxOpenedAt < 80) return; hideCtxMenu(); });
  window.addEventListener('scroll', () => hideCtxMenu(), true);

  /* =======================
     Toast Notification System (v34.4)
  ======================= */
  let _toastQueue = [];
  let _toastTimer = null;

  function showToast(message, type = 'info', duration = 3000) {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    const icon = type === 'success' ? '✓' : type === 'error' ? '✗' : type === 'warning' ? '⚠' : 'ℹ';
    toast.innerHTML = `
    <div class="toast-icon">${icon}</div>
    <div class="toast-message">${escapeHtml(message)}</div>
  `;

    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      document.body.appendChild(container);
    }

    container.appendChild(toast);

    // Animate in
    setTimeout(() => toast.classList.add('show'), 10);

    // Auto remove
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  function flash(text, ms = 1600) {
    const el = $('#msg');
    el.textContent = text || '';
    if (!text) return;
    setTimeout(() => { if (el.textContent === text) el.textContent = ''; }, ms);
  }
  function updateAutosaveUI(override = '') {
    const dot = $('#autosave-dot'); const tx = $('#autosave-text');
    if (!dot || !tx) return;
    dot.classList.toggle('dirty', !!state.autosave.dirty);
    dot.classList.toggle('saving', !!state.autosave.saving);
    dot.classList.toggle('err', !!state.autosave.error);
    if (state.autosave.error) tx.textContent = '保存エラー';
    else if (state.autosave.saving) tx.textContent = '保存中';
    else if (state.autosave.dirty) tx.textContent = '未保存';
    else tx.textContent = '保存済み';
    if (override) flash(override);
  }
  function showModal(title, msg, onOk = null) {
    const modal = $('#modal'); const mt = $('#modal-title'); const mm = $('#modal-msg');
    modal.classList.add('show'); modal.setAttribute('aria-hidden', 'false');
    mt.textContent = title; mm.textContent = msg || '';
    const ok = $('#modal-ok'); const cancel = $('#modal-cancel');
    cancel.style.display = onOk ? '' : 'none'; // OKのみの場合はキャンセル非表示
    const keyHandler = (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); ok.click(); }
      if (ev.key === 'Escape') { ev.preventDefault(); onOk ? cancel.click() : ok.click(); }
    };
    const cleanup = () => {
      ok.onclick = null; cancel.onclick = null;
      modal.removeEventListener('click', overlayClick);
      window.removeEventListener('keydown', keyHandler, true);
      modal.classList.remove('show'); modal.setAttribute('aria-hidden', 'true');
      cancel.style.display = '';
    };
    const overlayClick = (ev) => { if (ev.target === modal) { cleanup(); } };
    modal.addEventListener('click', overlayClick);
    ok.onclick = () => { cleanup(); if (onOk) onOk(); };
    cancel.onclick = () => cleanup();
    setTimeout(() => window.addEventListener('keydown', keyHandler, true), 80);
    setTimeout(() => ok.focus(), 30);
  }

  function showModalHTML(title, html, onOk = null, okText = 'OK', cancelText = 'キャンセル', afterMount = null) {
    const modal = $('#modal'); const mt = $('#modal-title'); const mm = $('#modal-msg');
    modal.classList.add('show'); modal.setAttribute('aria-hidden', 'false');
    mt.textContent = title; mm.innerHTML = html || '';
    const ok = $('#modal-ok'); const cancel = $('#modal-cancel');
    ok.textContent = okText; cancel.textContent = cancelText;
    // cancelText が null/空の場合はキャンセルボタンを非表示
    cancel.style.display = (cancelText && cancelText !== okText) ? '' : 'none';
    const keyHandler = (ev) => {
      if (ev.key === 'Escape') { ev.preventDefault(); cancel.style.display === '' ? cancel.click() : ok.click(); }
      if (ev.key === 'Enter' && ev.target === ok) { ev.preventDefault(); ok.click(); }
    };
    const cleanup = () => {
      ok.onclick = null; cancel.onclick = null;
      modal.removeEventListener('click', overlayClick);
      window.removeEventListener('keydown', keyHandler, true);
      modal.classList.remove('show'); modal.setAttribute('aria-hidden', 'true');
      ok.textContent = 'OK'; cancel.textContent = 'キャンセル';
      cancel.style.display = '';
      mm.innerHTML = '';
    };
    // 背景クリックで閉じる（モーダルボックス外をクリック）
    const overlayClick = (ev) => {
      if (ev.target === modal) { cleanup(); if (!cancelText || cancelText === okText) { if (onOk) onOk(); } }
    };
    modal.addEventListener('click', overlayClick);
    ok.onclick = () => { cleanup(); if (onOk) onOk(); };
    cancel.onclick = () => cleanup();
    setTimeout(() => window.addEventListener('keydown', keyHandler, true), 80);
    if (afterMount) setTimeout(afterMount, 10);
  }

  /* =======================
     Rendering
  ======================= */
  function switchTab(tab) {
    // データ登録で担当替えなどをした後、反映ボタンを押さずに別の画面へ移っても、変更が自動で反映されるように
    if (state.tab === 'input' && tab !== 'input') { try { autoReflectIfChanged(); } catch (e) { console.error('自動反映', e); } }
    if (tab === 'input' && state.tab !== 'input') { try { markRawBaseline(); } catch (e) { } }
    state.tab = tab;
    // 【7】現在のタブを body に記録（作成画面以外では下の操作バーを隠すため）
    document.body.dataset.tab = tab;
    $$('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    $$('.view').forEach(v => v.style.display = 'none');
    $('#view-' + tab).style.display = 'flex';
    if (tab === 'edit') rerenderEdit({ reuse: true });
    if (tab === 'subject') renderSubjectSettings();
    if (tab === 'teacher') renderTeacherSettings();
    if (tab === 'input') renderInputTable();
    if (tab === 'school') renderSchoolSettings();
    if (tab === 'print') { applyPrintLayoutToUI(); renderPrint(); }
  }

  function rerenderAll() {
    syncDaysFromSettings();
    // keep current tab
    if (state.tab === 'input') renderInputTable();
    if (state.tab === 'school') renderSchoolSettings();
    if (state.tab === 'subject') renderSubjectSettings();
    if (state.tab === 'teacher') renderTeacherSettings();
    if (state.tab === 'edit') rerenderEdit();
    if (state.tab === 'print') { applyPrintLayoutToUI(); renderPrint(); }
    renderSnapshotList();
    // v46-A3: 教員/クラス一覧ウィンドウが開いていれば差分更新
    try { _atwRefreshAll(); } catch (e) { }
    // v49: 配置進捗バー更新
    try { updatePlacementProgress(); } catch (e) { }
    try { updateMobileStockCount(); } catch (e) { }
    // F3: 検索ハイライト
    try { if (state.ui.itemSearchQuery) requestAnimationFrame(applyItemSearchHighlight); } catch (e) {}
    // F6: 制約オーバーレイ
    try { if (state.ui.constraintOverlay) requestAnimationFrame(applyConstraintOverlay); } catch (e) {}
  }

  // v49 B-1: 配置進捗バー (ヘッダー常時表示)
  function updatePlacementProgress() {
    const bar = document.getElementById('placement-progress-bar');
    const label = document.getElementById('placement-progress-label');
    const unplacedBadge = document.getElementById('unplaced-badge');
    if (!bar && !label && !unplacedBadge) return;

    const allIds = Object.keys(state.items);
    const total = allIds.length;
    const placed = allIds.filter(id => state.placements[id]?.day).length;
    const unplaced = total - placed;
    const pct = total > 0 ? Math.round(placed / total * 100) : 0;

    // violations
    let vioCount = 0;
    try {
      for (const id of allIds) {
        if (state.placements[id]?.day && violationSummary(id)) vioCount++;
      }
    } catch (e) { }

    if (bar) {
      bar.style.width = pct + '%';
      bar.style.background = vioCount > 0 ? '#f59e0b' : pct === 100 ? '#22c55e' : '#3b82f6';
    }
    if (label) {
      label.textContent = `${placed}/${total} (${pct}%)`;
      label.title = vioCount > 0 ? `⚠ 制約違反 ${vioCount}件` : pct === 100 ? '全コマ配置完了!' : `残 ${unplaced}コマ`;
    }
    if (unplacedBadge) {
      unplacedBadge.textContent = unplaced > 0 ? String(unplaced) : '';
      unplacedBadge.style.display = unplaced > 0 ? 'inline-flex' : 'none';
      unplacedBadge.dataset.unplaced = unplaced;
    }
  }

  // v46-A3: ATWウィンドウ差分再描画
  function _atwRefreshAll() {
    const layer = document.getElementById('float-layer'); if (!layer) return;
    const wins = layer.querySelectorAll('.atw-win');
    if (!wins.length) return;
    const idx = buildIndex();
    wins.forEach(win => {
      const tilesEl = win.querySelector('.atw-tiles');
      const kind = tilesEl?.dataset.kind;
      if (!kind) return;
      tilesEl.querySelectorAll('.atw-block').forEach(block => {
        const key = block.dataset.key; if (!key) return;
        const tmp = document.createElement('div');
        tmp.innerHTML = _atwBuildOneMini(key, kind, idx);
        const nb = tmp.firstElementChild; if (!nb) return;
        block.replaceWith(nb);
        _atwBindBlock(tilesEl, nb);
      });
    });
  }

  function renderSchoolSettings() {
    $('#p-mon').value = state.settings.periodsByDay.Mon;
    $('#p-tue').value = state.settings.periodsByDay.Tue;
    $('#p-wed').value = state.settings.periodsByDay.Wed;
    $('#p-thu').value = state.settings.periodsByDay.Thu;
    $('#p-fri').value = state.settings.periodsByDay.Fri;
    if ($('#p-sat')) $('#p-sat').value = state.settings.periodsByDay.Sat || 0;
    $('#lunch-after').value = state.settings.lunchAfter;
    $('#chk-room-conflict').checked = !!state.settings.roomConflict;
    $('#school-tea-maxdaily').value = state.settings.teaDefaultMaxDaily ?? '';
    $('#school-tea-maxconsec').value = state.settings.teaDefaultMaxConsec ?? '';
    renderClassPeriodOverride();
  }

  function renderClassPeriodOverride() {
    const container = $('#class-period-override-list'); if (!container) return;
    const ov = state.settings.classPeriodOverride || {};
    // Get all known classes for datalist
    const allCls = uniq(Object.values(state.items).flatMap(it => it.cls || [])).sort();
    container.innerHTML = '';
    const entries = Object.keys(ov);

    const makeRow = (cls = '', dayVals = {}) => {
      const row = document.createElement('div');
      row.className = 'cls-ov-row';
      const clsInput = document.createElement('input');
      clsInput.type = 'text'; clsInput.placeholder = '例: 3-1HR';
      clsInput.value = cls; clsInput.className = 'sel cls-ov-cls-inp'; clsInput.style.width = '100px';
      clsInput.list = 'dl-allcls';

      const dayInputs = {};
      const dayRow = document.createElement('div');
      dayRow.className = 'cls-ov-days';
      for (const d of DAYS) {
        const lbl = document.createElement('span');
        lbl.className = 'cls-ov-dlabel'; lbl.textContent = DAYJP[d];
        const inp = document.createElement('input');
        inp.type = 'number'; inp.min = '1'; inp.max = '12'; inp.placeholder = '−';
        inp.className = 'num cls-ov-inp'; inp.style.width = '40px';
        inp.value = dayVals[d] != null ? dayVals[d] : '';
        dayInputs[d] = inp;
        dayRow.appendChild(lbl); dayRow.appendChild(inp);
      }
      const delBtn = document.createElement('button');
      delBtn.textContent = '✕'; delBtn.className = 'btn danger'; delBtn.style.padding = '3px 8px';
      delBtn.title = 'この行を削除';
      delBtn.onclick = () => {
        const k = clsInput.value.trim();
        if (k && state.settings.classPeriodOverride) delete state.settings.classPeriodOverride[k];
        markDirty('school'); renderClassPeriodOverride(); rerenderAll();
      };

      const save = () => {
        const k = clsInput.value.trim(); if (!k) return;
        if (!state.settings.classPeriodOverride) state.settings.classPeriodOverride = {};
        const entry = {};
        for (const d of DAYS) {
          const v = dayInputs[d].value.trim();
          if (v !== '') entry[d] = clamp(parseInt(v, 10), 1, 12);
        }
        state.settings.classPeriodOverride[k] = entry;
        markDirty('school'); rerenderAll();
      };
      clsInput.onchange = save;
      for (const d of DAYS) dayInputs[d].onchange = save;

      row.appendChild(clsInput); row.appendChild(dayRow); row.appendChild(delBtn);
      container.appendChild(row);
    };

    // Datalist for classes
    if (!$('#dl-allcls')) {
      const dl = document.createElement('datalist'); dl.id = 'dl-allcls';
      allCls.forEach(c => { const o = document.createElement('option'); o.value = c; dl.appendChild(o); });
      document.body.appendChild(dl);
    }

    // Show example hint if empty
    if (!entries.length) {
      const hint = document.createElement('div');
      hint.className = 'cls-ov-hint';
      hint.innerHTML = '<strong>💡 使い方：</strong> 3年生だけ月曜が6限の場合、クラスに「3-1HR」、月に「6」と入力';
      container.appendChild(hint);
    }

    for (const cls of entries) makeRow(cls, ov[cls]);

    const addBtn = $('#btn-add-cls-override');
    if (addBtn) {
      // Clone to remove any stale listeners
      const newBtn = addBtn.cloneNode(true);
      addBtn.parentNode.replaceChild(newBtn, addBtn);
      newBtn.onclick = () => { makeRow('', {}); };
    }
  }

  function gatherSchoolSettings() {
    pushHistory('school');
    state.settings.periodsByDay.Mon = clamp(parseInt($('#p-mon').value ?? 7, 10), 0, 12);
    state.settings.periodsByDay.Tue = clamp(parseInt($('#p-tue').value ?? 6, 10), 0, 12);
    state.settings.periodsByDay.Wed = clamp(parseInt($('#p-wed').value ?? 6, 10), 0, 12);
    state.settings.periodsByDay.Thu = clamp(parseInt($('#p-thu').value ?? 6, 10), 0, 12);
    state.settings.periodsByDay.Fri = clamp(parseInt($('#p-fri').value ?? 6, 10), 0, 12);
    if ($('#p-sat')) state.settings.periodsByDay.Sat = clamp(parseInt($('#p-sat').value || 0, 10) || 0, 0, 12);
    syncDaysFromSettings();
    state.settings.lunchAfter = clamp(parseInt($('#lunch-after').value || 4, 10), 0, 11);
    state.settings.roomConflict = !!$('#chk-room-conflict').checked;
    const md = $('#school-tea-maxdaily').value.trim();
    state.settings.teaDefaultMaxDaily = md === '' ? null : clamp(parseInt(md, 10), 1, 30);
    const mc = $('#school-tea-maxconsec').value.trim();
    state.settings.teaDefaultMaxConsec = mc === '' ? null : clamp(parseInt(mc, 10), 1, 30);
    markDirty('school');
    rerenderAll();
    broadcastState();
  }

  function renderInputTable() {
    const tb = $('#input-tbody'); if (!tb) return;
    tb.innerHTML = '';
    const subjSet = uniq(state.rawRows.map(r => (r.subj || '').trim()).filter(Boolean));
    const teaSet = uniq(state.rawRows.flatMap(r => splitList(r.tea)));
    const subjDataList = `<datalist id="dl-subjects">${subjSet.map(s => `<option value="${escapeHtml(s)}"></option>`).join('')}</datalist>`;
    const teaDataList = `<datalist id="dl-teachers">${teaSet.map(s => `<option value="${escapeHtml(s)}"></option>`).join('')}</datalist>`;
    if (!$('#dl-subjects')) document.body.insertAdjacentHTML('beforeend', subjDataList);
    if (!$('#dl-teachers')) document.body.insertAdjacentHTML('beforeend', teaDataList);

    const rows = state.rawRows;
    if (!rows.length) {
      addRow(); // create one
    }
    const isSorted = !!_inputSort.col;
    for (const r of getSortedRows()) {
      ensureRowId(r);
      const tr = document.createElement('tr');
      tr.dataset.rowid = r._id;
      const subjKey = (r.subj || '').trim();
      const color = (state.subjectCfg[subjKey]?.color) || (subjKey ? pickColor(subjKey) : '#fff');
      tr.style.background = subjKey ? hexWithAlpha(color, 0.10) : '';
      tr.draggable = !isSorted;
      // 教室未設定の警告（総合/LHR等の教室不要科目は除外）
      const _noRoomOk = /総合的な探究|LHR|ロングホーム|ホームルーム/.test((subjKey || '').replace(/[Ａ-Ｚａ-ｚ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)));
      const roomWarn = subjKey && !(r.room || '').trim() && !_noRoomOk;
      tr.innerHTML = `
      <td class="drag-handle" title="${isSorted ? '並替中はドラッグ不可' : 'ドラッグして並び替え'}" style="${isSorted ? 'color:#cbd5e1;cursor:default' : ''}">${isSorted ? '—' : '⠿'}</td>
      <td>
        <div class="op-buttons">
          <button class="dup" data-act="dup">複製</button>
          <button class="del" data-act="del">削除</button>
        </div>
      </td>
      <td><input type="text" value="${escapeAttr(r.cls || '')}" placeholder="例: 1-1,1-2" /></td>
      <td><input type="text" value="${escapeAttr(r.subj || '')}" list="dl-subjects" /></td>
      <td><input type="text" value="${escapeAttr(r.subjAbbr || '')}" placeholder="略" /></td>
      <td><input type="text" value="${escapeAttr(r.dept || '')}" placeholder="教科" /></td>
      <td><input type="text" value="${escapeAttr(r.tea || '')}" title="${escapeAttr(r.tea || '')}" list="dl-teachers" /></td>
      <td><input type="text" value="${escapeAttr(r.teaAbbr || '')}" title="${escapeAttr(r.teaAbbr || '')}" placeholder="略" /></td>
      <td class="${roomWarn ? 'cell-room-warn' : ''}" title="${roomWarn ? '教室が未設定です' : ''}"><input type="text" value="${escapeAttr(r.room || '')}" title="${escapeAttr(r.room || '')}" placeholder="例: 1-1,オーラル教室" /></td>
      <td><input type="number" min="1" max="30" value="${escapeAttr(r.count || 1)}" /></td>
      <td><input type="checkbox" ${r.dbl ? 'checked' : ''} /></td>
      <td><input type="checkbox" ${r.parallel ? 'checked' : ''} title="並列：同一先生が複数クラスに同時展開" /></td>
    `;
      const tds = tr.querySelectorAll('td');
      const inputs = tr.querySelectorAll('input');
      // operation buttons
      tr.querySelector('[data-act="del"]').onclick = () => {
        showModal('削除', 'この行を削除しますか？', () => {
          pushHistory('rowDel');
          state.rawRows = state.rawRows.filter(x => x._id !== r._id);
          markDirty('rowDel');
          renderInputTable();
        });
      };
      tr.querySelector('[data-act="dup"]').onclick = () => {
        pushHistory('rowDup');
        const copy = deepClone(r); copy._id = null; ensureRowId(copy);
        const idx = state.rawRows.findIndex(x => x._id === r._id);
        state.rawRows.splice(idx + 1, 0, copy);
        markDirty('rowDup');
        renderInputTable();
      };
      // ── Drag & drop row reorder ──
      tr.addEventListener('dragstart', (ev) => {
        _dragRowId = r._id;
        tr.classList.add('dragging-row');
        ev.dataTransfer.effectAllowed = 'move';
        ev.dataTransfer.setData('text/plain', r._id);
      });
      tr.addEventListener('dragend', () => {
        _dragRowId = null;
        tr.classList.remove('dragging-row');
        document.querySelectorAll('#input-tbody tr').forEach(x => x.classList.remove('drag-over-row'));
      });
      tr.addEventListener('dragover', (ev) => {
        ev.preventDefault(); ev.dataTransfer.dropEffect = 'move';
        document.querySelectorAll('#input-tbody tr').forEach(x => x.classList.remove('drag-over-row'));
        if (_dragRowId && _dragRowId !== r._id) tr.classList.add('drag-over-row');
      });
      tr.addEventListener('drop', (ev) => {
        ev.preventDefault();
        tr.classList.remove('drag-over-row');
        if (!_dragRowId || _dragRowId === r._id || isSorted) return;
        const fromIdx = state.rawRows.findIndex(x => x._id === _dragRowId);
        const toIdx = state.rawRows.findIndex(x => x._id === r._id);
        if (fromIdx < 0 || toIdx < 0) return;
        pushHistory('rowMove');
        const [moved] = state.rawRows.splice(fromIdx, 1);
        state.rawRows.splice(toIdx, 0, moved);
        _dragRowId = null;
        markDirty('rowMove');
        renderInputTable();
      });
      // bind inputs — IME composition guard prevents re-render during kanji conversion
      const withIMEGuard = (inp, fn) => {
        let composing = false;
        inp.addEventListener('compositionstart', () => { composing = true; _inputTableIMEComposing = true; });
        inp.addEventListener('compositionend', () => { composing = false; _inputTableIMEComposing = false; fn(false); });
        inp.oninput = () => { if (!composing) fn(true); };
      };
      withIMEGuard(inputs[0], () => { r.cls = inputs[0].value; markDirty('input'); });
      withIMEGuard(inputs[1], (live) => { r.subj = inputs[1].value; markDirty('input'); if (live) renderInputTableDebounced(tr, inputs[1]); });
      withIMEGuard(inputs[2], () => { r.subjAbbr = inputs[2].value; markDirty('input'); });
      withIMEGuard(inputs[3], () => { r.dept = inputs[3].value; markDirty('input'); });
      withIMEGuard(inputs[4], (live) => { r.tea = inputs[4].value; markDirty('input'); if (live) renderInputTableDebounced(tr, inputs[4]); });
      withIMEGuard(inputs[5], () => { r.teaAbbr = inputs[5].value; markDirty('input'); });
      withIMEGuard(inputs[6], () => { r.room = inputs[6].value; markDirty('input'); });
      inputs[7].oninput = () => { r.count = clamp(parseInt(inputs[7].value || 1, 10), 1, 30); markDirty('input'); };
      inputs[8].onchange = () => { r.dbl = inputs[8].checked; markDirty('input'); };
      inputs[9].onchange = () => { r.parallel = inputs[9].checked; markDirty('input'); };
      tb.appendChild(tr);
    }
  }
  let inputRerenderTimer = null;
  let _inputTableIMEComposing = false; // global IME guard for datalist re-render
  let _dragRowId = null; // drag-and-drop row reorder
  // sort state: { col: 'cls'|'subj'|'dept'|'tea'|null, dir: 'asc'|'desc' }
  let _inputSort = { col: null, dir: 'asc' };
  let _teaSort = { col: 'name', dir: 'asc' }; // default: name asc

  function getSortedRows() {
    if (!_inputSort.col) return state.rawRows;
    const col = _inputSort.col;
    const dir = _inputSort.dir === 'asc' ? 1 : -1;
    return [...state.rawRows].sort((a, b) => {
      const va = (a[col] || '').trim();
      const vb = (b[col] || '').trim();
      return va.localeCompare(vb, 'ja') * dir;
    });
  }

  function updateSortButtons() {
    document.querySelectorAll('#input-thead-row th[data-sort]').forEach(th => {
      const c = th.dataset.sort;
      const icon = th.querySelector('.sort-icon');
      const isAsc = _inputSort.col === c && _inputSort.dir === 'asc';
      const isDesc = _inputSort.col === c && _inputSort.dir === 'desc';
      th.classList.toggle('th-sort-active', isAsc || isDesc);
      if (icon) icon.textContent = isAsc ? '▲' : isDesc ? '▼' : '';
    });
    const resetSpan = $('#th-sort-reset');
    if (resetSpan) resetSpan.style.display = _inputSort.col ? '' : 'none';
  }

  function updateTeaSortButtons() {
    ['name', 'dept'].forEach(c => {
      const btn = $(`[data-tea-sort="${c}"]`);
      if (!btn) return;
      btn.classList.toggle('active-asc', _teaSort.col === c && _teaSort.dir === 'asc');
      btn.classList.toggle('active-desc', _teaSort.col === c && _teaSort.dir === 'desc');
    });
  }

  function bindSortToolbar() {
    document.querySelectorAll('#input-thead-row th[data-sort]').forEach(th => {
      th.style.cursor = 'pointer';
      th.onclick = (ev) => {
        if (ev.target.classList.contains('col-resizer')) return;
        const c = th.dataset.sort;
        if (_inputSort.col === c) {
          _inputSort.dir = _inputSort.dir === 'asc' ? 'desc' : 'asc';
        } else {
          _inputSort.col = c; _inputSort.dir = 'asc';
        }
        updateSortButtons();
        renderInputTable();
      };
    });
    const resetSpan = $('#th-sort-reset');
    if (resetSpan) resetSpan.onclick = (ev) => {
      ev.stopPropagation();
      _inputSort = { col: null, dir: 'asc' };
      updateSortButtons();
      renderInputTable();
    };
  }
  function renderInputTableDebounced(activeRow, activeInput) {
    if (_inputTableIMEComposing) return; // don't blow up IME session
    // Snapshot focus: which row ID and which column index was active
    let focusRowId = null, focusColIdx = -1, focusSelStart = null, focusSelEnd = null;
    if (activeRow && activeInput) {
      const rowEl = activeRow;
      const r = state.rawRows.find(x => rowEl.dataset && rowEl.dataset.rowid === x._id);
      focusRowId = r?._id ?? null;
      const inputs = Array.from(rowEl.querySelectorAll('input'));
      focusColIdx = inputs.indexOf(activeInput);
      try { focusSelStart = activeInput.selectionStart; focusSelEnd = activeInput.selectionEnd; } catch (e) { }
    } else {
      // Try snapshotting the currently active element
      const el = document.activeElement;
      if (el && el.tagName === 'INPUT') {
        const tr = el.closest('tr[data-rowid]');
        if (tr) {
          focusRowId = tr.dataset.rowid;
          const inputs = Array.from(tr.querySelectorAll('input'));
          focusColIdx = inputs.indexOf(el);
          try { focusSelStart = el.selectionStart; focusSelEnd = el.selectionEnd; } catch (e) { }
        }
      }
    }
    clearTimeout(inputRerenderTimer);
    inputRerenderTimer = setTimeout(() => {
      if (state.tab === 'input') {
        renderInputTable();
        // Restore focus
        if (focusRowId != null && focusColIdx >= 0) {
          requestAnimationFrame(() => {
            const tr = document.querySelector(`tr[data-rowid="${CSS.escape(focusRowId)}"]`);
            if (tr) {
              const inputs = Array.from(tr.querySelectorAll('input'));
              const el = inputs[focusColIdx];
              if (el) {
                try { el.focus({ preventScroll: true }); } catch (e) { }
                try { if (focusSelStart != null) el.setSelectionRange(focusSelStart, focusSelEnd ?? focusSelStart); } catch (e) { }
              }
            }
          });
        }
      }
    }, 250);
  }
  function addRow() {
    pushHistory('rowAdd');
    state.rawRows.push({ _id: null, cls: '', subj: '', subjAbbr: '', dept: '', tea: '', teaAbbr: '', room: '', count: 1, dbl: false, parallel: false });
    ensureRowId(state.rawRows[state.rawRows.length - 1]);
    markDirty('rowAdd');
    renderInputTable();
  }

  /* =======================
     Subject / Teacher settings
  ======================= */
  function renderSubjectSettings() {
    const box = $('#subject-container'); if (!box) return;
    rebuildMastersFromRaw();
    const keys = Object.keys(state.subjectCfg).sort((a, b) => a.localeCompare(b, 'ja'));
    box.innerHTML = '';
    for (const key of keys) {
      const cfg = state.subjectCfg[key];
      const isAllowed = !!cfg.allowedMode;
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `
      <div class="card-head">
        <h3>${escapeHtml(key)}</h3>
        <div class="spacer"></div>
      </div>
      <div class="tile-summary">略称: ${escapeHtml(cfg.abbr || '')}　教科: ${escapeHtml(cfg.dept || '')}</div>
      <div class="color-box">
        <input type="color" value="${escapeAttr(cfg.color || pickColor(key))}" />
        <div class="muted small">自動色（コマの色分け）</div>
      </div>
      <div class="form-grid" style="margin-top:10px;">
        <label>略称</label><input type="text" value="${escapeAttr(cfg.abbr || '')}" />
        <label>教科</label><input type="text" value="${escapeAttr(cfg.dept || '')}" placeholder="例: 国語 / 英語 / 音楽" />
        <label>同日複数</label>
          <select>
            <option value="0" ${cfg.noSameDay ? '' : 'selected'}>OK</option>
            <option value="1" ${cfg.noSameDay ? 'selected' : ''}>不可（同日1回）</option>
          </select>
        <label>同日上限(時数)</label><input type="number" min="1" max="20" value="${cfg.maxPerDay == null ? '' : escapeAttr(cfg.maxPerDay)}" placeholder="未設定" />
        <label>連続配置</label>
          <select class="noconsec-sel">
            <option value="0" ${cfg.noConsec ? '' : 'selected'}>OK（連続可）</option>
            <option value="1" ${cfg.noConsec ? 'selected' : ''}>禁止（同科目を連続させない）</option>
          </select>
      </div>
      <div class="rulebox">
        <div class="row" style="justify-content:space-between;align-items:center;">
          <div class="row" style="gap:6px"><strong>${isAllowed ? '許可枠' : '固定禁則'}</strong><span class="muted small">${isAllowed ? '緑=配置OK（それ以外は不可）' : '赤=配置不可'}</span></div>
          <label class="chk small" style="gap:4px;cursor:pointer" title="ONにすると、選んだ枠だけに配置可能になります（禁則の逆）">
            <input type="checkbox" class="allow-mode-chk" ${isAllowed ? 'checked' : ''}/> 許可枠モード
          </label>
        </div>
        ${isAllowed
          ? miniCalendarHTML('subj-allow', key, cfg.allowedSlots || {}, true)
          : miniCalendarHTML('subj', key, cfg.fixedForbid || {})}
      </div>
      <div class="row gap wrap" style="margin-top:10px;align-items:center;">
        <button class="btn secondary subj-bulk-place" data-subj="${escapeAttr(key)}" title="禁則/許可枠・教員不可を守って一括配置（Shift+クリックで既配置も再配置）">📌 この科目を一括配置</button>
        <span class="muted small">（Shift+クリック: 既配置も再配置）</span>
      </div>
    `;
      const color = card.querySelector('input[type="color"]');
      const inputs = card.querySelectorAll('input[type="text"],input[type="number"]');
      const abbr = inputs[0];
      const dept = inputs[1];
      const noSame = card.querySelector('select');
      const maxpd = inputs[2];
      const allowChk = card.querySelector('.allow-mode-chk');
      color.oninput = () => { pushHistory('subjColor'); cfg.color = color.value; markDirty('subj'); queueRerenderAllPreserveFocus(); };
      abbr.oninput = () => { cfg.abbr = abbr.value; markDirty('subj'); queueRerenderAllPreserveFocus(); };
      dept.oninput = () => { cfg.dept = dept.value; markDirty('subj'); queueRerenderAllPreserveFocus(); };
      noSame.onchange = () => { cfg.noSameDay = (noSame.value === '1'); markDirty('subj'); };
      maxpd.oninput = () => { cfg.maxPerDay = maxpd.value.trim() === '' ? null : clamp(parseInt(maxpd.value, 10), 1, 30); markDirty('subj'); };
      const noConsecSel = card.querySelector('.noconsec-sel');
      if (noConsecSel) noConsecSel.onchange = () => { cfg.noConsec = (noConsecSel.value === '1'); markDirty('subj'); };
      allowChk.onchange = () => {
        pushHistory('allowMode');
        cfg.allowedMode = allowChk.checked;
        markDirty('subj');
        renderSubjectSettings(); // re-render this card
      };
      if (isAllowed) {
        bindMiniCalendar(card, 'subj-allow', key, 'allowedSlots', true);
      } else {
        bindMiniCalendar(card, 'subj', key, 'fixedForbid');
      }

      // v61: 一括配置（科目ごと）
      const btnBulk = card.querySelector('.subj-bulk-place');
      if (btnBulk) btnBulk.onclick = (ev) => {
        const includePlaced = !!(ev && ev.shiftKey);
        bulkPlaceSubject(key, { includePlaced });
      };
      box.appendChild(card);
    }
  }

  function renderTeacherSettings() {
    const box = $('#teacher-container'); if (!box) return;
    rebuildMastersFromRaw();
    const dir = _teaSort.dir === 'asc' ? 1 : -1;
    const keys = Object.keys(state.teacherCfg).sort((a, b) => {
      if (_teaSort.col === 'dept') {
        const da = (state.teacherCfg[a]?.dept || inferTeacherDept(a) || '').trim();
        const db = (state.teacherCfg[b]?.dept || inferTeacherDept(b) || '').trim();
        const cmp = da.localeCompare(db, 'ja');
        if (cmp !== 0) return cmp * dir;
      }
      return a.localeCompare(b, 'ja') * dir;
    });
    box.innerHTML = '';
    for (const key of keys) {
      const cfg = state.teacherCfg[key];
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `
      <div class="card-head">
        <h3>${escapeHtml(key)}</h3>
        <div class="spacer"></div>
      </div>
      <div class="tile-summary">略称: ${escapeHtml(cfg.abbr || '')}　教科: ${escapeHtml((cfg.dept || inferTeacherDept(key)) || '')}</div>
      <div class="form-grid">
        <label>略称</label><input id="${domId('tea-abbr-', key)}" type="text" value="${escapeAttr(cfg.abbr || '')}" />
        <label>教科(参考)</label><input id="${domId('tea-dept-', key)}" type="text" value="${escapeAttr(cfg.dept || '')}" placeholder="例: 英語" />
        <label>1日上限</label><input id="${domId('tea-maxd-', key)}" type="number" min="1" max="30" value="${cfg.maxDaily == null ? '' : escapeAttr(cfg.maxDaily)}" placeholder="未設定" />
        <label>連続上限</label><input id="${domId('tea-maxc-', key)}" type="number" min="1" max="30" value="${cfg.maxConsec == null ? '' : escapeAttr(cfg.maxConsec)}" placeholder="未設定" />
      </div>
      <div class="rulebox">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap">
          <label class="chk" style="font-size:12px">
            <input type="checkbox" class="tea-allowed-chk" ${cfg.allowedMode ? 'checked' : ''}>
            <strong>出勤可能指定モード</strong>
          </label>
          <span class="muted small">${cfg.allowedMode ? '（緑○=出勤可、それ以外は不可）' : '（赤×=出勤不可コマ）'}</span>
        </div>
        <div>
          <div class="muted small" style="margin-bottom:2px">${cfg.allowedMode ? '出勤可能コマ（○）' : '出勤不可コマ（×）'}</div>
          ${cfg.allowedMode
            ? miniCalendarHTML('tea', key, cfg.allowedSlots || {}, true)
            : miniCalendarHTML('tea', key, cfg.unavailable || {})
          }
        </div>
      </div>
    `;
      const inputs = card.querySelectorAll('input');
      inputs[0].oninput = () => { cfg.abbr = inputs[0].value; cfg.abbrAuto = false; markDirty('tea'); queueRerenderAllPreserveFocus(); };
      inputs[1].oninput = () => { cfg.dept = inputs[1].value; markDirty('tea'); queueRerenderAllPreserveFocus(); };
      inputs[2].oninput = () => { cfg.maxDaily = inputs[2].value.trim() === '' ? null : clamp(parseInt(inputs[2].value, 10), 1, 30); markDirty('tea'); };
      inputs[3].oninput = () => { cfg.maxConsec = inputs[3].value.trim() === '' ? null : clamp(parseInt(inputs[3].value, 10), 1, 30); markDirty('tea'); };
      // v43: allowed-mode toggle
      const allowedChk = card.querySelector('.tea-allowed-chk');
      if (allowedChk) allowedChk.onchange = () => {
        cfg.allowedMode = allowedChk.checked;
        if (cfg.allowedMode && !cfg.allowedSlots) cfg.allowedSlots = {};
        markDirty('tea');
        renderTeacherSettings(); // re-render card to swap calendar type
      };
      if (cfg.allowedMode) {
        bindMiniCalendar(card, 'tea-allow', key, 'allowedSlots', true);
      } else {
        bindMiniCalendar(card, 'tea', key, 'unavailable');
      }
      box.appendChild(card);
    }
  }

  function miniCalendarHTML(type, key, map, isAllowMode = false) {
    // 5 x maxPeriod
    const maxP = Math.max(...DAYS.map(d => maxPeriod(d)));
    const head = `<table class="mini-cal"><thead><tr><th></th>${DAYS.map(d => `<th>${DAYJP[d]}</th>`).join('')}</tr></thead><tbody>`;
    let body = '';
    for (let p = 1; p <= maxP; p++) {
      body += `<tr><th>${p}</th>`;
      for (const d of DAYS) {
        const exists = (map?.[d] || []).includes(p);
        const disabled = p > maxPeriod(d);
        const cls = disabled ? 'disabled' : '';
        const onCls = isAllowMode ? 'allowed' : 'on';
        body += `<td data-day="${d}" data-p="${p}" class="${cls} ${exists ? onCls : ''}">${disabled ? '' : (exists ? (isAllowMode ? '○' : '×') : '')}</td>`;
      }
      body += '</tr>';
    }
    body += '</tbody></table>';
    return head + body;
  }
  function bindMiniCalendar(root, type, key, field, isAllowMode = false) {
    root.querySelectorAll('td[data-day]').forEach(td => {
      td.onclick = () => {
        if (td.classList.contains('disabled')) return;
        pushHistory('miniCal');
        const d = td.dataset.day; const p = parseInt(td.dataset.p, 10);
        const cfg = (type === 'subj' || type === 'subj-allow') ? state.subjectCfg[key]
          : state.teacherCfg[key]; // tea, tea-allow, tea-break all point to teacherCfg
        cfg[field] ??= {};
        cfg[field][d] ??= [];
        const arr = cfg[field][d];
        const i = arr.indexOf(p);
        if (i >= 0) arr.splice(i, 1); else arr.push(p);
        arr.sort((a, b) => a - b);
        markDirty('miniCal');
        rerenderAll();
        broadcastState();
      };
    });
  }

  /* =======================
     v61: 科目の一括配置（固定枠/LHRなど）
     - 禁制（固定禁則/教員不可/時限範囲/2連最終/クラス時限上限）は必ず守る
     - 既配置も動かしたい場合は Shift+クリック
  ======================= */
  function _bulkHardness(it) {
    const span = it?.span || 1;
    return span * 50 + (it?.teas?.length || 0) * 12 + (it?.cls?.length || 0) * 10 + (it?.rooms?.length || 0) * 6;
  }

  function _bulkBestSlotFor(id) {
    const it = state.items[id];
    if (!it) return null;
    const scfg = state.subjectCfg[it.subjKey] || {};

    const span = it.span || 1;
    let best = null;

    for (const day of DAYS) {
      const maxP = maxPeriod(day);
      let ps;
      if (scfg.allowedMode && scfg.allowedSlots && Object.keys(scfg.allowedSlots).length) {
        ps = (scfg.allowedSlots[day] || []).slice();
      } else {
        ps = [];
        for (let p = 1; p <= maxP; p++) ps.push(p);
      }
      for (const p of ps) {
        if (p < 1 || p > maxP) continue;
        if (span === 2 && p === maxP) continue;
        // subject fixed/allowed & other hard constraints are inside validatePlacement
        const v = validatePlacement(id, day, p, 'safe', null);
        if ((v.blocks || []).length) continue;

        let score = 100;
        score -= (v.warns || []).length * 7;
        // teacher load penalty
        for (const tea of (it.teas || [])) {
          score -= teacherDayCount(tea, day) * 3;
        }
        if (p <= 2) score += 6;
        else if (p <= 4) score += 3;

        // bonus: allowedMode slots are usually "fixed" → encourage using them
        if (scfg.allowedMode) score += 10;

        if (!best || score > best.score) best = { day, period: p, score };
      }
    }
    return best;
  }

  function bulkPlaceSubject(subjKey, opts = {}) {
    try { rebuildMastersFromRaw(); } catch (e) { }
    const includePlaced = !!opts.includePlaced;
    const silent = !!opts.silent;
    const skipHistory = !!opts.skipHistory;
    const noRender = !!opts.noRender;

    const ids = Object.keys(state.items).filter(id => {
      const it = state.items[id];
      if (!it) return false;
      if (it.subjKey !== subjKey) return false;
      if (state.placements[id]?.locked) return false;
      return true;
    });
    if (!ids.length) { if (!silent) flash('対象のコマがありません'); return { placed: 0, failed: 0, total: 0 }; }

    // 対象: 未配置 +（Shiftなら既配置も）+ 禁制に乗ってしまっている既配置
    const targets = [];
    for (const id of ids) {
      const plc = state.placements[id];
      if (!plc) { targets.push(id); continue; }
      const abs = absoluteBlocksOf((validatePlacement(id, plc.day, plc.period, 'safe', null) || { blocks: [] }).blocks);
      if (abs.length) { targets.push(id); continue; }
      if (includePlaced) targets.push(id);
    }
    if (!targets.length) { if (!silent) flash('未配置/禁制のコマがありません'); return { placed: 0, failed: 0, total: 0 }; }

    if (!skipHistory) pushHistory('bulkSubjPlace');

    // backup current placements for safety (used when includePlaced)
    const backup = {};
    for (const id of targets) backup[id] = state.placements[id];

    // clear targets first
    for (const id of targets) state.placements[id] = null;
    invalidateIndex();

    // hardest-first
    targets.sort((a, b) => _bulkHardness(state.items[b]) - _bulkHardness(state.items[a]));

    let placed = 0, failed = 0;
    for (const id of targets) {
      const best = _bulkBestSlotFor(id);
      if (best) {
        state.placements[id] = { day: best.day, period: best.period, locked: !!backup[id]?.locked };
        placed++;
      } else {
        // restore if it was previously placed and we were moving it
        if (backup[id]) state.placements[id] = backup[id];
        else state.placements[id] = null;
        failed++;
      }
      invalidateIndex();
    }

    markDirty('place');
    if (!noRender) {
      rerenderAll();
      broadcastState();
    }
    if (!silent) flash(`一括配置（${subjKey}）: 成功 ${placed} / 失敗 ${failed}`);
    return { placed, failed, total: targets.length };
  }

