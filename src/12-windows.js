  /* =======================
     Splitters
  ======================= */
  /* =======================
  /* =======================
     教員一覧 / クラス一覧ウィンドウ (v45)
     縦=時限、横=曜日（月～金）
     ドラッグ&ドロップ対応
  ======================= */
  function openAllTeachersWindow() {
    _openAllItemsWindow('teacher');
  }
  function openAllClassesWindow() {
    _openAllItemsWindow('class');
  }

  function _openAllItemsWindow(kind) {
    const existId = `__all_${kind}__`;
    const layer = document.getElementById('float-layer');
    if (!layer) return;
    const existing = layer.querySelector(`[data-id="${CSS.escape(existId)}"]`);
    if (existing) { existing.remove(); return; }

    const keys = getAxisKeys(kind);
    if (!keys.length) { flash(kind === 'teacher' ? '教員データなし' : 'クラスデータなし'); return; }

    const title = kind === 'teacher' ? '👥 教員一覧' : '🏫 クラス一覧';
    const searchPlaceholder = kind === 'teacher' ? '教員名で絞り込み…' : 'クラス名で絞り込み…';
    const el = document.createElement('div');
    el.className = 'float-win atw-win';
    el.dataset.id = existId;
    el.style.cssText = `left:20px;top:20px;width:${Math.min(window.innerWidth - 40, 1400)}px;height:${Math.min(window.innerHeight - 60, 720)}px;z-index:9990;position:fixed`;
    el.innerHTML = `
    <div class="float-head atw-head" data-handle="1">
      <span class="title">${title}</span>
      <span class="atw-count muted small"></span>
      <div class="spacer"></div>
      <input class="atw-search" placeholder="${searchPlaceholder}">
      <button class="btn secondary" data-act="close-atw">×</button>
    </div>
    <div class="atw-tiles" data-kind="${kind}"></div>
    <div class="float-resize-handle"></div>
  `;
    layer.appendChild(el);
    _atwBind(el, existId, kind, keys);
  }

  function _atwBind(el, existId, kind, keys) {
    const tilesEl = el.querySelector('.atw-tiles');

    // ウィンドウドラッグ
    const head = el.querySelector('[data-handle]');
    if (head) {
      let sx, sy, sl, st;
      head.onmousedown = (e) => {
        if (e.target.closest('button,input')) return;
        sx = e.clientX; sy = e.clientY;
        const r = el.getBoundingClientRect(); sl = r.left; st = r.top;
        el.style.left = sl + 'px'; el.style.top = st + 'px'; el.style.transform = 'none';
        const onM = (e2) => { el.style.left = Math.max(0, sl + (e2.clientX - sx)) + 'px'; el.style.top = Math.max(0, st + (e2.clientY - sy)) + 'px'; };
        const onU = () => { document.removeEventListener('mousemove', onM); document.removeEventListener('mouseup', onU); };
        document.addEventListener('mousemove', onM); document.addEventListener('mouseup', onU);
      };
    }
    el.querySelector('[data-act="close-atw"]').onclick = () => el.remove();

    // 検索
    el.querySelector('.atw-search').oninput = (e) => {
      const q = e.target.value.toLowerCase();
      el.querySelectorAll('.atw-block').forEach(b => {
        const key = b.dataset.key || '';
        const abbr = kind === 'teacher' ? (state.teacherCfg[key]?.abbr || key).toLowerCase() : key.toLowerCase();
        b.style.display = (!q || key.toLowerCase().includes(q) || abbr.includes(q)) ? '' : 'none';
      });
    };

    // 関連表示: カードにカーソルを合わせると、クラス一覧では同じ先生、教員一覧では同じクラスのカードを濃くする
    let _atwHlTimer = null;
    tilesEl.addEventListener('mouseover', (e) => {
      const card = e.target.closest('.atw-card[data-id]'); if (!card) return;
      clearTimeout(_atwHlTimer);
      _atwHlTimer = setTimeout(() => atwApplyHighlight(el, kind, card.dataset.id), 80);
    });
    tilesEl.addEventListener('mouseout', (e) => {
      const card = e.target.closest('.atw-card[data-id]'); if (!card) return;
      const to = e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('.atw-card[data-id]');
      if (to) return; // 隣のカードへ移る時は消さない（チラつき防止）
      clearTimeout(_atwHlTimer);
      _atwHlTimer = setTimeout(() => atwApplyHighlight(el, kind, null), 60);
    });

    // 描画
    _atwRender(el, tilesEl, kind, keys);
  }

  function atwApplyHighlight(win, kind, id) {
    win.querySelectorAll('.atw-hl-self,.atw-hl-tea,.atw-hl-cls').forEach(c => c.classList.remove('atw-hl-self', 'atw-hl-tea', 'atw-hl-cls'));
    win.classList.toggle('atw-hl-on', !!id);
    const cnt = win.querySelector('.atw-count');
    if (cnt && cnt.dataset.prev != null && !id) { cnt.textContent = cnt.dataset.prev; delete cnt.dataset.prev; }
    if (!id) return;
    const it = state.items[id]; if (!it) return;
    const linked = linkedGroupIds(id);
    const teaSet = new Set(it.teas || []), clsSet = new Set(it.cls || []);
    const byTea = kind === 'class'; // クラス一覧=同じ先生、教員一覧=同じクラス
    let n = 0;
    win.querySelectorAll('.atw-card[data-id]').forEach(c => {
      const eid = c.dataset.id;
      if (eid === id || linked.has(eid)) { c.classList.add('atw-hl-self'); return; }
      const o = state.items[eid]; if (!o) return;
      if (byTea ? (o.teas || []).some(t => teaSet.has(t)) : (o.cls || []).some(x => clsSet.has(x))) { c.classList.add(byTea ? 'atw-hl-tea' : 'atw-hl-cls'); n++; }
    });
    if (cnt) {
      if (cnt.dataset.prev == null) cnt.dataset.prev = cnt.textContent;
      cnt.textContent = byTea ? `🟧 同じ先生（${(it.teas || []).join('・') || '未設定'}） ${n}コマ` : `🟦 同じクラス（${(it.cls || []).join('・') || '未設定'}） ${n}コマ`;
    }
  }

  function _atwRender(el, tilesEl, kind, keys) {
    const idx = buildIndex();
    const maxP = Math.max(...DAYS.map(d => maxPeriod(d)));

    function buildMini(key) {
      const labelAbbr = kind === 'teacher' ? (state.teacherCfg[key]?.abbr || key) : key;
      // 時限数カウント
      let total = 0;
      for (const d of DAYS) for (let p = 1; p <= maxPeriod(d); p++) {
        const ids = kind === 'teacher'
          ? (idx.tea?.[key]?.[d]?.[p] || []).filter(x => !isSpanFill(x, d, p))
          : (idx.cls?.[key]?.[d]?.[p] || []).filter(x => !isSpanFill(x, d, p));
        total += ids.length;
      }

      // テーブル構築: 縦=時限, 横=曜日
      const dayHeaders = DAYS.map(d => `<th class="atw-th-day">${DAYJP[d]}</th>`).join('');
      let rows = '';
      for (let p = 1; p <= maxP; p++) {
        rows += `<tr><th class="atw-th-p">${p}</th>`;
        for (const d of DAYS) {
          if (p > maxPeriod(d)) { rows += `<td class="atw-forb"></td>`; continue; }
          const ids = kind === 'teacher'
            ? (idx.tea?.[key]?.[d]?.[p] || []).filter(x => !isSpanFill(x, d, p))
            : (idx.cls?.[key]?.[d]?.[p] || []).filter(x => !isSpanFill(x, d, p));
          if (!ids.length) {
            rows += `<td class="atw-cell" data-day="${d}" data-p="${p}"></td>`; continue;
          }
          const cards = ids.map(id => {
            const it = state.items[id]; if (!it) return '';
            const scfg = state.subjectCfg[it.subjKey] || {};
            const color = scfg.color || pickColor(it.subjKey);
            const subjAbbr = (scfg.abbr || it.subj || it.subjKey).slice(0, 6);
            const sub = kind === 'teacher' ? (it.cls || []).join(',').slice(0, 6) : (state.teacherCfg[(it.teas || [])[0]]?.abbr || (it.teas || [])[0] || '').slice(0, 5);
            const bg = hexWithAlpha(color, 0.8);
            const fg = isDark(color) ? '#fff' : '#0f172a';
            const plc = state.placements[id];
            const locked = plc?.locked ? ' atw-locked' : '';
            return `<div class="atw-card${locked}" draggable="true" data-id="${escapeAttr(id)}"
            style="background:${bg};color:${fg}"
            title="${escapeHtml(subjAbbr)} ${escapeHtml(sub)}">
            ${escapeHtml(subjAbbr)}<div class="atw-cls">${escapeHtml(sub)}</div>
          </div>`;
          }).join('');
          rows += `<td class="atw-cell" data-day="${d}" data-p="${p}">${cards}</td>`;
        }
        rows += `</tr>`;
      }

      return `<div class="atw-block" data-key="${escapeAttr(key)}" data-kind="${kind}">
      <div class="atw-name" title="ダブルクリックで個人窓 / ${labelAbbr}">
        ${escapeHtml(labelAbbr)}<span class="atw-cnt">${total}</span>
      </div>
      <div class="atw-scroll">
        <table class="atw-table">
          <thead><tr><th class="atw-th-blank"></th>${dayHeaders}</tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
    }

    tilesEl.innerHTML = keys.map(buildMini).join('');
    const countEl = el.querySelector('.atw-count');
    if (countEl) countEl.textContent = `${keys.length}${kind === 'teacher' ? '名' : 'クラス'}`;

    // --- ダブルクリックで個人窓 ---
    tilesEl.querySelectorAll('.atw-name').forEach(nm => {
      nm.ondblclick = () => {
        const b = nm.closest('.atw-block');
        if (!b) return;
        openFloat(b.dataset.kind, b.dataset.key);
        rerenderAll();
      };
    });

    // --- ドラッグ開始 (カードから) ---
    tilesEl.querySelectorAll('.atw-card[draggable]').forEach(card => {
      card.ondragstart = (e) => {
        const id = card.dataset.id;
        window._currentDragId = id;
        window._dragPending = true;
        e.dataTransfer.setData('text/plain', id);
        try { e.dataTransfer.setData('id', id); } catch { }
        e.dataTransfer.effectAllowed = 'move';
        // ★Fix5: 元のコマ（配置済みの場合）をフェードアウト表示
        const plc = state.placements[id];
        if (plc) {
          // 同じ一覧内の元コマのセルをハイライト
          const fromCell = tilesEl.querySelector(`td.atw-cell[data-day="${plc.day}"][data-p="${plc.period}"]`);
          if (fromCell) {
            fromCell.classList.add('atw-drag-from');
            // どのブロックから出発したかも表示
            const block = card.closest('.atw-block');
            if (block) block.classList.add('atw-dragging-from');
          }
        }
        card.style.opacity = '0.45';
      };
      card.ondragend = () => {
        window._dragPending = false;
        setTimeout(() => { if (!window._dragPending) window._currentDragId = null; }, 100);
        card.style.opacity = '';
        tilesEl.querySelectorAll('.atw-drag-from,.atw-dragging-from').forEach(x => {
          x.classList.remove('atw-drag-from', 'atw-dragging-from');
        });
      };
    });

    // --- ドラッグ受け入れ (空きセルへ) ---
    tilesEl.querySelectorAll('td.atw-cell').forEach(td => {
      td.ondragover = (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        tilesEl.querySelectorAll('.atw-cell.atw-drag-over').forEach(x => x.classList.remove('atw-drag-over'));
        td.classList.add('atw-drag-over');
        // ドラッグ中プレビュー（制約チェック）
        const dragId = window._currentDragId;
        if (dragId && dragId !== td._atwPreviewId) {
          td._atwPreviewId = dragId;
          td.classList.remove('drag-preview-ok', 'drag-preview-warn', 'drag-preview-ng');
          try {
            const day2 = td.dataset.day, p2 = parseInt(td.dataset.p, 10);
            const v2 = validatePlacement(dragId, day2, p2, 'safe', null);
            if (v2.blocks.length) td.classList.add('drag-preview-ng');
            else if (v2.warns.length) td.classList.add('drag-preview-warn');
            else td.classList.add('drag-preview-ok');
          } catch (_) { }
        }
      };
      td.ondragleave = () => {
        td.classList.remove('atw-drag-over', 'drag-preview-ok', 'drag-preview-warn', 'drag-preview-ng');
        td._atwPreviewId = null;
      };
      td.ondrop = (e) => {
        e.preventDefault();
        td.classList.remove('atw-drag-over');
        const id = e.dataTransfer.getData('text/plain') || e.dataTransfer.getData('id') || window._currentDragId;
        if (!id) return;
        const day = td.dataset.day, p = parseInt(td.dataset.p, 10);
        if (!day || !p) return;
        // doPlace→rerenderAll→_atwRefreshAll が自動的に ATW を再描画するため
        // ここで手動 replaceWith は不要（二重更新・ウィンドウ消滅の原因になる）
        placeItem(id, day, p, { mode: state.ui.drop || 'safe' });
      };
    });
  }

  function _atwBuildOneMini(key, kind, idx) {
    // atwRenderの単一ブロック版（再描画用）
    const maxP = Math.max(...DAYS.map(d => maxPeriod(d)));
    const labelAbbr = kind === 'teacher' ? (state.teacherCfg[key]?.abbr || key) : key;
    let total = 0;
    for (const d of DAYS) for (let p = 1; p <= maxPeriod(d); p++) {
      const ids = kind === 'teacher'
        ? (idx.tea?.[key]?.[d]?.[p] || []).filter(x => !isSpanFill(x, d, p))
        : (idx.cls?.[key]?.[d]?.[p] || []).filter(x => !isSpanFill(x, d, p));
      total += ids.length;
    }
    const dayHeaders = DAYS.map(d => `<th class="atw-th-day">${DAYJP[d]}</th>`).join('');
    let rows = '';
    for (let p = 1; p <= maxP; p++) {
      rows += `<tr><th class="atw-th-p">${p}</th>`;
      for (const d of DAYS) {
        if (p > maxPeriod(d)) { rows += `<td class="atw-forb"></td>`; continue; }
        const ids = kind === 'teacher'
          ? (idx.tea?.[key]?.[d]?.[p] || []).filter(x => !isSpanFill(x, d, p))
          : (idx.cls?.[key]?.[d]?.[p] || []).filter(x => !isSpanFill(x, d, p));
        if (!ids.length) { rows += `<td class="atw-cell" data-day="${d}" data-p="${p}"></td>`; continue; }
        const cards = ids.map(id => {
          const it = state.items[id]; if (!it) return '';
          const scfg = state.subjectCfg[it.subjKey] || {};
          const color = scfg.color || pickColor(it.subjKey);
          const subjAbbr = (scfg.abbr || it.subj || it.subjKey).slice(0, 6);
          const sub = kind === 'teacher' ? (it.cls || []).join(',').slice(0, 6) : (state.teacherCfg[(it.teas || [])[0]]?.abbr || (it.teas || [])[0] || '').slice(0, 5);
          const bg = hexWithAlpha(color, 0.8);
          const fg = isDark(color) ? '#fff' : '#0f172a';
          const locked = state.placements[id]?.locked ? ' atw-locked' : '';
          return `<div class="atw-card${locked}" draggable="true" data-id="${escapeAttr(id)}"
          style="background:${bg};color:${fg}"
          title="${escapeHtml(subjAbbr)} ${escapeHtml(sub)}">
          ${escapeHtml(subjAbbr)}<div class="atw-cls">${escapeHtml(sub)}</div>
        </div>`;
        }).join('');
        rows += `<td class="atw-cell" data-day="${d}" data-p="${p}">${cards}</td>`;
      }
      rows += `</tr>`;
    }
    return `<div class="atw-block" data-key="${escapeAttr(key)}" data-kind="${kind}">
    <div class="atw-name">${escapeHtml(labelAbbr)}<span class="atw-cnt">${total}</span></div>
    <div class="atw-scroll">
      <table class="atw-table">
        <thead><tr><th class="atw-th-blank"></th>${dayHeaders}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </div>`;
  }

  function _atwBindBlock(tilesEl, block) {
    block.querySelector('.atw-name').ondblclick = () => {
      openFloat(block.dataset.kind, block.dataset.key);
      rerenderAll();
    };
    block.querySelectorAll('.atw-card[draggable]').forEach(card => {
      card.ondragstart = (e) => {
        window._currentDragId = card.dataset.id; window._dragPending = true;
        e.dataTransfer.setData('text/plain', card.dataset.id);
        try { e.dataTransfer.setData('id', card.dataset.id); } catch { }
        e.dataTransfer.effectAllowed = 'move';
      };
      card.ondragend = () => { window._dragPending = false; setTimeout(() => { if (!window._dragPending) window._currentDragId = null; }, 100); };
    });
    block.querySelectorAll('td.atw-cell').forEach(td => {
      td.ondragover = (e) => {
        e.preventDefault(); e.dataTransfer.dropEffect = 'move';
        td.classList.add('atw-drag-over');
        const dragId = window._currentDragId;
        if (dragId && dragId !== td._atwPreviewId) {
          td._atwPreviewId = dragId;
          td.classList.remove('drag-preview-ok', 'drag-preview-warn', 'drag-preview-ng');
          try {
            const v2 = validatePlacement(dragId, td.dataset.day, parseInt(td.dataset.p, 10), 'safe', null);
            if (v2.blocks.length) td.classList.add('drag-preview-ng');
            else if (v2.warns.length) td.classList.add('drag-preview-warn');
            else td.classList.add('drag-preview-ok');
          } catch (_) { }
        }
      };
      td.ondragleave = () => {
        td.classList.remove('atw-drag-over', 'drag-preview-ok', 'drag-preview-warn', 'drag-preview-ng');
        td._atwPreviewId = null;
      };
      td.ondrop = (e) => {
        e.preventDefault();
        td.classList.remove('atw-drag-over', 'drag-preview-ok', 'drag-preview-warn', 'drag-preview-ng');
        const id = e.dataTransfer.getData('text/plain') || e.dataTransfer.getData('id') || window._currentDragId; if (!id) return;
        const day = td.dataset.day, p = parseInt(td.dataset.p, 10); if (!day || !p) return;
        placeItem(id, day, p, { mode: state.ui.drop || 'safe' });
      };
    });
  }



  /* =======================
  Timetable Analysis (v32.6)
======================= */
  /* =======================
     AI問題提案ウィザード (v45)
     未解決の問題を優先度順に提示し、
     1件ずつ「これをこう解決しますか？」と提案する
  ======================= */
  let _wizardIssues = null;
  let _wizardIdx = 0;
  let _wizardEl = null;

  function openAiWizard() {
    // 既に開いていれば閉じる
    if (_wizardEl) { _wizardEl.remove(); _wizardEl = null; return; }

    _wizardIssues = _buildWizardIssues();
    _wizardIdx = 0;

    _wizardEl = document.createElement('div');
    _wizardEl.id = 'ai-wizard';
    _wizardEl.className = 'ai-wizard';
    document.body.appendChild(_wizardEl);

    _renderWizardCard();
  }

  function _buildWizardIssues() {
    const issues = [];
    const idx = buildIndex();
    const allIds = Object.keys(state.items);

    // 1. 未配置コマ（最高優先）
    const unplaced = allIds.filter(id => !state.placements[id]);
    for (const id of unplaced) {
      const it = state.items[id]; if (!it) continue;
      const scfg = state.subjectCfg[it.subjKey] || {};
      const abbr = scfg.abbr || it.subj || id;
      const cls = it.cls.join(',');
      issues.push({
        priority: 100,
        type: 'unplaced',
        title: `「${abbr}」${cls} が未配置`,
        desc: 'このコマはまだどこにも配置されていません。',
        id,
        action: async () => {
          // 空き枠を探して提案
          const sugs = computeEmptySuggestions(id);
          if (!sugs?.length) { flash('配置できる枠がありません（制約が厳しい可能性があります）'); return; }
          const best = sugs[0];
          showModal(`「${abbr}」${cls} を ${DAYJP[best.moves[0].day]}${best.moves[0].period}時限に配置しますか？`, '提案を適用します。', () => {
            pushHistory('wizard');
            for (const m of best.moves) doPlace(m.id, m.day, m.period, null);
            invalidateIndex(); markDirty('wizard'); rerenderAll();
            _wizardIssues = _buildWizardIssues(); _wizardIdx = 0; _renderWizardCard();
          });
        }
      });
    }

    // 2. 教員1日上限超過
    for (const [tea, tcfg] of Object.entries(state.teacherCfg || {})) {
      const maxD = tcfg.maxDaily;
      if (maxD == null) continue;
      for (const d of DAYS) {
        let cnt = 0;
        const dayIds = [];
        for (let p = 1; p <= maxPeriod(d); p++) {
          const ids2 = (idx.tea?.[tea]?.[d]?.[p] || []).filter(x => !isSpanFill(x, d, p));
          if (ids2.length) { cnt++; dayIds.push(...ids2); }
        }
        if (cnt > maxD) {
          const over = cnt - maxD;
          const teaAbbr = tcfg.abbr || tea;
          const movable = dayIds.filter(id => !state.placements[id]?.locked);
          issues.push({
            priority: 90,
            type: 'teacher-overload',
            title: `${teaAbbr} — ${DAYJP[d]}に${cnt}コマ（上限${maxD}）`,
            desc: `1日上限(${maxD}コマ)を${over}コマ超えています。${movable.length > 0 ? `「${(state.subjectCfg[state.items[movable[0]]?.subjKey]?.abbr || state.items[movable[0]]?.subj || movable[0])}」などを別の日に移動できます。` : ''}`,
            ids: movable.slice(0, 3), tea, day: d,
            action: async () => {
              if (!movable.length) { flash('ロック解除できるコマがありません'); return; }
              const toMove = movable[0];
              const it = state.items[toMove]; if (!it) return;
              const sugs = computeEmptySuggestions(toMove);
              const otherDay = sugs?.find(s => s.moves[0]?.day !== d);
              if (!otherDay) { flash('移動先が見つかりません'); return; }
              const m = otherDay.moves[0];
              const abbr2 = state.subjectCfg[it.subjKey]?.abbr || it.subj || toMove;
              showModal(`「${abbr2}」を ${DAYJP[m.day]}${m.period}時限に移動して上限超過を解消しますか？`, '提案を適用します。', () => {
                pushHistory('wizard');
                doPlace(m.id, m.day, m.period, null);
                invalidateIndex(); markDirty('wizard'); rerenderAll();
                _wizardIssues = _buildWizardIssues(); _wizardIdx = 0; _renderWizardCard();
              });
            }
          });
        }
      }
    }

    // 3. クラス競合
    for (const cls of [...new Set(Object.values(state.items).flatMap(it => it.cls || []))]) {
      for (const d of DAYS) {
        for (let p = 1; p <= maxPeriod(d); p++) {
          const ids2 = (idx.cls?.[cls]?.[d]?.[p] || []).filter(x => !isSpanFill(x, d, p));
          if (ids2.length > 1) {
            const labels = ids2.map(id => state.subjectCfg[state.items[id]?.subjKey]?.abbr || state.items[id]?.subj || id).join('・');
            const movable = ids2.filter(id => !state.placements[id]?.locked);
            issues.push({
              priority: 80,
              type: 'class-conflict',
              title: `${cls} — ${DAYJP[d]}${p}限に競合 (${labels})`,
              desc: `同じクラスが同時刻に${ids2.length}コマ重複しています。`,
              ids: movable,
              action: async () => {
                if (!movable.length) { flash('移動できるコマがありません'); return; }
                const toMove = movable[movable.length - 1];
                const it = state.items[toMove]; if (!it) return;
                const sugs = computeEmptySuggestions(toMove);
                if (!sugs?.length) { flash('移動先が見つかりません'); return; }
                const m = sugs[0].moves[0];
                const abbr2 = state.subjectCfg[it.subjKey]?.abbr || it.subj || toMove;
                showModal(`「${abbr2}」を ${DAYJP[m.day]}${m.period}時限に移動して競合を解消しますか？`, '提案を適用します。', () => {
                  pushHistory('wizard');
                  doPlace(m.id, m.day, m.period, null);
                  invalidateIndex(); markDirty('wizard'); rerenderAll();
                  _wizardIssues = _buildWizardIssues(); _wizardIdx = 0; _renderWizardCard();
                });
              }
            });
          }
        }
      }
    }

    // ── v46-A1-3: 教員連続上限超過 ─────────────────────────────────
    for (const [tea, tcfg] of Object.entries(state.teacherCfg || {})) {
      const maxC = teacherConsecMax(tea);
      if (maxC == null) continue;
      for (const d of DAYS) {
        // teacherConsecRun は「最長連続数」(数値)だけを返すため、ここで最長区間の時限も求める
        // （以前は {best, bestRun} を期待しており、「🤖 解決」ボタンが毎回エラーで止まっていた）
        const run = (() => {
          const lunchAfter = Number(state.settings.lunchAfter || 0);
          const maxP = maxPeriod(d);
          let best = 0, bestRun = [], cur = [];
          for (let p = 1; p <= maxP; p++) {
            if (lunchAfter && p === lunchAfter + 1) cur = [];
            if ((idx.tea?.[tea]?.[d]?.[p] || []).length) { cur.push(p); if (cur.length > best) { best = cur.length; bestRun = cur.slice(); } }
            else cur = [];
          }
          return { best, bestRun };
        })();
        if (run.best <= maxC) continue;
        const over = run.best - maxC;
        const teaAbbr = tcfg.abbr || tea;
        const movable = run.bestRun
          .flatMap(p => (idx.tea?.[tea]?.[d]?.[p] || []))
          .filter(id => !state.placements[id]?.locked && !isSpanFill(id, d, 0));
        if (!movable.length) continue;
        issues.push({
          priority: 85,
          type: 'teacher-consec',
          title: `${teaAbbr} — ${DAYJP[d]}に${run.best}連続（上限${maxC}）`,
          desc: `連続授業が上限(${maxC}コマ)を${over}コマ超えています。間に空きを作ることで解消できます。`,
          ids: movable.slice(0, 2),
          action: async () => {
            if (!movable.length) { flash('移動できるコマがありません'); return; }
            const toMove = movable[0];
            const it = state.items[toMove]; if (!it) return;
            const sugs = computeEmptySuggestions(toMove);
            // 別の日、または少なくとも連続が切れる枠を優先
            const best2 = sugs?.find(s => {
              const m = s.moves[0];
              return m && (m.day !== d || Math.abs(m.period - run.bestRun[0]) > maxC);
            }) || sugs?.[0];
            if (!best2) { flash('移動先が見つかりません'); return; }
            const m = best2.moves[0];
            const abbr2 = state.subjectCfg[it.subjKey]?.abbr || it.subj || toMove;
            showModal(`「${abbr2}」を ${DAYJP[m.day]}${m.period}時限に移動して連続超過を解消しますか？`, '提案を適用します。', () => {
              pushHistory('wizard');
              doPlace(m.id, m.day, m.period, null);
              invalidateIndex(); markDirty('wizard'); rerenderAll();
              _wizardIssues = _buildWizardIssues(); _wizardIdx = 0; _renderWizardCard();
            });
          }
        });
      }
    }

    // ── v46-A1-4: 教室競合 ──────────────────────────────────────────
    if (state.settings.roomConflict) {
      const allRooms = [...new Set(Object.values(state.items).flatMap(it => it.rooms || []))];
      for (const room of allRooms) {
        for (const d of DAYS) {
          for (let p = 1; p <= maxPeriod(d); p++) {
            const ids2 = (idx.room?.[room]?.[d]?.[p] || []).filter(x => !isSpanFill(x, d, p));
            if (ids2.length < 2) continue;
            const labels = ids2.map(id => state.subjectCfg[state.items[id]?.subjKey]?.abbr || state.items[id]?.subj || id).join('・');
            const movable = ids2.filter(id => !state.placements[id]?.locked);
            if (!movable.length) continue;
            issues.push({
              priority: 75,
              type: 'room-conflict',
              title: `教室「${room}」— ${DAYJP[d]}${p}限に競合 (${labels})`,
              desc: `同じ教室に${ids2.length}コマが重複しています。どちらかを別の教室または別の時間に移動してください。`,
              ids: movable,
              action: async () => {
                const toMove = movable[movable.length - 1];
                const it = state.items[toMove]; if (!it) return;
                const sugs = computeEmptySuggestions(toMove);
                if (!sugs?.length) { flash('移動先が見つかりません'); return; }
                const m = sugs[0].moves[0];
                const abbr2 = state.subjectCfg[it.subjKey]?.abbr || it.subj || toMove;
                showModal(`「${abbr2}」を ${DAYJP[m.day]}${m.period}時限に移動して教室競合を解消しますか？`, '提案を適用します。', () => {
                  pushHistory('wizard');
                  doPlace(m.id, m.day, m.period, null);
                  invalidateIndex(); markDirty('wizard'); rerenderAll();
                  _wizardIssues = _buildWizardIssues(); _wizardIdx = 0; _renderWizardCard();
                });
              }
            });
          }
        }
      }
    }

    // ── v46-A1-5: 同日同科目違反 ────────────────────────────────────
    for (const id of Object.keys(state.items)) {
      const plc = state.placements[id]; if (!plc?.day) continue;
      const it = state.items[id]; if (!it) continue;
      const scfg = state.subjectCfg[it.subjKey] || {};
      if (!scfg.noSameDay) continue;
      for (const c of it.cls || []) {
        if (hasSameDaySubjectDuplicate(c, it.subjKey, plc.day, id)) {
          if (state.placements[id]?.locked) continue;
          const abbr2 = scfg.abbr || it.subj || id;
          const existingIssue = issues.find(x => x.type === 'same-day-subj' && x.id === id);
          if (existingIssue) continue;
          issues.push({
            priority: 70,
            type: 'same-day-subj',
            title: `「${abbr2}」${c} — ${DAYJP[plc.day]}に同科目が複数`,
            desc: `同日同科目禁止が設定されているのに、${DAYJP[plc.day]}に複数コマ配置されています。`,
            id,
            action: async () => {
              const sugs = computeEmptySuggestions(id);
              const otherDay = sugs?.find(s => s.moves[0]?.day !== plc.day);
              if (!otherDay) { flash('別の日への移動先が見つかりません'); return; }
              const m = otherDay.moves[0];
              showModal(`「${abbr2}」を ${DAYJP[m.day]}${m.period}時限に移動して同日重複を解消しますか？`, '提案を適用します。', () => {
                pushHistory('wizard');
                doPlace(m.id, m.day, m.period, null);
                invalidateIndex(); markDirty('wizard'); rerenderAll();
                _wizardIssues = _buildWizardIssues(); _wizardIdx = 0; _renderWizardCard();
              });
            }
          });
          break;
        }
      }
    }

    // 優先度順にソート
    issues.sort((a, b) => b.priority - a.priority);
    return issues;
  }

  function _renderWizardCard() {
    if (!_wizardEl) return;
    const issues = _wizardIssues || [];

    if (!issues.length || _wizardIdx >= issues.length) {
      _wizardEl.innerHTML = `
      <div class="wiz-head">
        <span class="wiz-title">🎉 AI問題提案</span>
        <button class="wiz-close">×</button>
      </div>
      <div class="wiz-body">
        <div class="wiz-done">✅ 現在の問題はすべて確認しました</div>
        <button class="wiz-btn-secondary" id="wiz-refresh">再スキャン</button>
      </div>`;
      _wizardEl.querySelector('.wiz-close').onclick = () => { _wizardEl?.remove(); _wizardEl = null; };
      _wizardEl.querySelector('#wiz-refresh').onclick = () => { _wizardIssues = _buildWizardIssues(); _wizardIdx = 0; _renderWizardCard(); };
      return;
    }

    const issue = issues[_wizardIdx];
    const _typeIcons = { 'unplaced': '📦', 'teacher-overload': '⚠️', 'class-conflict': '💥', 'teacher-consec': '🔄', 'room-conflict': '🏫', 'same-day-subj': '📅' };
    const _typeLabels = { 'unplaced': '未配置', 'teacher-overload': '教員超過', 'class-conflict': 'クラス競合', 'teacher-consec': '連続超過', 'room-conflict': '教室競合', 'same-day-subj': '同日重複' };
    const typeIcon = _typeIcons[issue.type] || '❓';
    const remaining = issues.length - _wizardIdx;

    _wizardEl.innerHTML = `
    <div class="wiz-head">
      <span class="wiz-title">🤖 AI問題提案</span>
      <span class="wiz-remain">${remaining}件残り</span>
      <button class="wiz-close">×</button>
    </div>
    <div class="wiz-body">
      <div class="wiz-issue-type">${typeIcon} ${_typeLabels[issue.type] || issue.type}</div>
      <div class="wiz-issue-title">${escapeHtml(issue.title)}</div>
      <div class="wiz-issue-desc">${escapeHtml(issue.desc)}</div>
    </div>
    <div class="wiz-actions">
      <button class="wiz-btn-primary" id="wiz-apply">✅ 提案を適用</button>
      <button class="wiz-btn-secondary" id="wiz-skip">スキップ →</button>
      <button class="wiz-btn-secondary" id="wiz-open">詳細を見る</button>
    </div>
    <div class="wiz-progress">
      <div class="wiz-progress-bar" style="width:${Math.round((_wizardIdx / Math.max(1, issues.length)) * 100)}%"></div>
    </div>`;

    _wizardEl.querySelector('.wiz-close').onclick = () => { _wizardEl?.remove(); _wizardEl = null; };
    _wizardEl.querySelector('#wiz-apply').onclick = () => issue.action?.();
    _wizardEl.querySelector('#wiz-skip').onclick = () => _advanceWizard();
    _wizardEl.querySelector('#wiz-open').onclick = () => {
      if (issue.id) openPropSuggestions(issue.id);
      else if (issue.ids?.[0]) openPropSuggestions(issue.ids[0]);
    };
  }

  function _advanceWizard() {
    _wizardIdx++;
    _renderWizardCard();
  }

  function showTimetableAnalysis() {
    try {
      const issues = analyzeTimetable();
      if (!issues.length) {
        showModalHTML('✅ 分析結果：問題なし',
          '<div class="muted small" style="margin:8px 0">検出できる問題はありませんでした。</div>',
          null, '閉じる', '閉じる');
        return;
      }
      const byLevel = { warn: [], info: [] };
      for (const iss of issues) {
        (byLevel[iss.level] || byLevel.info).push(iss);
      }
      const renderSection = (items, icon, cls) =>
        items.map((iss, idx_) => `<div class="analysis-item ${cls}" data-iss-level="${cls}" data-iss-idx="${idx_}">
        <span class="analysis-icon">${icon}</span>
        <div class="analysis-text">
          <strong>${escapeHtml(iss.title)}</strong>
          ${iss.detail ? `<div class="analysis-detail">${escapeHtml(iss.detail)}</div>` : ''}
          <div class="analysis-actions">
            ${iss.fixableIds?.length ? `<button class="fix-btn btn-mini" data-fix-idx="${cls}_${idx_}">🔧 修正提案</button>` : ''}
            ${iss.fixTea || iss.fixDay || iss.fixableIds?.length ? `<button class="highlight-btn btn-mini" data-hl-idx="${cls}_${idx_}">📍 ハイライト</button>` : ''}
          </div>
        </div>
      </div>`).join('');
      const warnCount = byLevel.warn.length;
      const infoCount = byLevel.info.length;
      // v47-C4: 教員コマ数バーチャート
      const teaChartHTML = (() => {
        const idx2 = buildIndex();
        const placed = Object.keys(state.items).filter(id => state.placements[id]?.day);
        const allTea = [...new Set(placed.flatMap(id => state.items[id].teas || []))].sort((a, b) => a.localeCompare(b, 'ja'));
        if (!allTea.length) return '';
        const counts = allTea.map(t => {
          let n = 0;
          for (const d of DAYS) for (let p = 1; p <= maxPeriod(d); p++) n += (idx2.tea?.[t]?.[d]?.[p] || []).filter(id => !isSpanFill(id, d, p)).length;
          return { t, n, maxD: teacherDailyMax(t) };
        });
        const maxN = Math.max(...counts.map(c => c.n), 1);
        const bars = counts.map(c => {
          const pct = Math.round(c.n / maxN * 100);
          const over = c.maxD != null && c.n > c.maxD * DAYS.length;
          const barColor = over ? '#ef4444' : (pct > 70 ? '#f59e0b' : '#3b82f6');
          const abbr = (state.teacherCfg[c.t]?.abbr || c.t).slice(0, 5);
          return `<div class="teabar-row" title="${escapeHtml(c.t)}: ${c.n}コマ${c.maxD != null ? ' (上限' + c.maxD + '/日)' : ''}">
          <div class="teabar-name">${escapeHtml(abbr)}</div>
          <div class="teabar-bar"><div class="teabar-fill" style="width:${pct}%;background:${barColor}"></div></div>
          <div class="teabar-cnt${over ? ' teabar-over' : ''}">${c.n}</div>
        </div>`;
        }).join('');
        return `<details class="tea-chart-wrap" open><summary class="tea-chart-title">📊 教員週コマ数バランス</summary><div class="tea-chart">${bars}</div></details>`;
      })();

      const html = `
      <div class="analysis-wrap" id="analysis-wrap-root">
        <div class="analysis-summary">
          ${warnCount > 0 ? `<span class="analysis-badge warn-badge">⚠ ${warnCount}件</span>` : ''}
          ${infoCount > 0 ? `<span class="analysis-badge info-badge">ℹ ${infoCount}件</span>` : ''}
        </div>
        ${teaChartHTML}
        ${byLevel.warn.length ? renderSection(byLevel.warn, '⚠️', 'warn') : ''}
        ${byLevel.info.length ? renderSection(byLevel.info, 'ℹ️', 'info') : ''}
      </div>
    `;
      showModalHTML(`📋 時間割分析（全${issues.length}件）`, html,
        null, '閉じる', null,
        () => {
          // Bind fix buttons
          document.querySelectorAll('.fix-btn[data-fix-idx]').forEach(btn => {
            btn.onclick = () => {
              const parts = btn.dataset.fixIdx.split('_');
              const level = parts[0];
              const i = parseInt(parts[1], 10);
              const iss = (byLevel[level] || [])[i];
              if (!iss) return;
              try {
                // Fix: 分析モーダルを先に閉じてから修正提案モーダルを開く
                document.getElementById('modal-cancel')?.click();
                setTimeout(() => {
                  try { showIssueFixSuggestion(iss); } catch (e2) {
                    console.error('Error in showIssueFixSuggestion:', e2);
                    flash('修正提案の表示に失敗しました');
                  }
                }, 80);
              } catch (e) {
                console.error('Error in showIssueFixSuggestion:', e);
                flash('修正提案の表示に失敗しました');
              }
            };
          });
          // Bind highlight buttons
          document.querySelectorAll('.highlight-btn[data-hl-idx]').forEach(btn => {
            btn.onclick = () => {
              const parts = btn.dataset.hlIdx.split('_');
              const level = parts[0];
              const i = parseInt(parts[1], 10);
              const iss = (byLevel[level] || [])[i];
              if (!iss) return;
              try {
                highlightIssue(iss);
              } catch (e) {
                console.error('Error in highlightIssue:', e);
                flash('ハイライト表示に失敗しました');
              }
              // Visual feedback
              btn.textContent = '✓ ハイライト済';
              btn.disabled = true;
              setTimeout(() => { btn.textContent = '📍 ハイライト'; btn.disabled = false; }, 2000);
            };
          });
        }
      );
    } catch (e) {
      console.error('Error in showTimetableAnalysis:', e);
      showModal('エラー', `分析処理中にエラーが発生しました:\n${e.message}`);
    }
  }

  function highlightIssue(iss) {
    // Clear previous highlights
    $$('.issue-highlight').forEach(el => el.classList.remove('issue-highlight'));

    if (iss.fixableIds && iss.fixableIds.length) {
      // Highlight specific lesson cards
      for (const id of iss.fixableIds) {
        const cards = document.querySelectorAll(`.lesson[data-id="${CSS.escape(id)}"]`);
        cards.forEach(c => c.classList.add('issue-highlight'));
      }
      // Scroll to first one
      const first = document.querySelector(`.lesson[data-id="${CSS.escape(iss.fixableIds[0])}"]`);
      if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
      flash(`問題のコマを赤枠でハイライトしました`);
    } else if (iss.fixTea && iss.fixDay) {
      // 教員ビューに切り替えて該当教員の当該曜日セルをハイライト
      try { switchTab('edit'); } catch (e) { }
      state.ui.viewMode = 'teacher';
      try { rerenderAll(); } catch (e) { }
      setTimeout(() => {
        const row = document.querySelector(`.grid-wrapper tr[data-row="${CSS.escape(iss.fixTea)}"]`);
        if (row) {
          row.querySelectorAll(`td[data-day="${iss.fixDay}"]`).forEach(td => td.classList.add('issue-highlight'));
          row.scrollIntoView({ behavior: 'smooth', block: 'center' });
          flash(`${iss.fixTea} の ${DAYJP[iss.fixDay] || iss.fixDay} をハイライトしました`);
        } else {
          flash(`${iss.fixTea} の行が見つかりませんでした`);
        }
      }, 200);
    }
  }

  /* v33.0: データ登録不備分析 */
  function analyzeRawData() {
    const issues = [];
    const rows = state.rawRows || [];

    if (!rows.length) {
      return [{ level: 'info', title: 'データがありません', detail: 'データ登録タブで行を追加してください。' }];
    }

    // 1. コマ数が多すぎる行
    for (const r of rows) {
      const cnt = parseInt(r.count || 1, 10) || 1;
      const subj = (r.subj || '').trim();
      const cls = (r.cls || '').trim();
      if (cnt > 10) {
        issues.push({ level: 'warn', title: `「${subj}」(${cls}) コマ数が${cnt}と非常に多い`, detail: '週あたり10コマ超は通常あり得ません。入力ミスの可能性があります。' });
      } else if (cnt > 6) {
        issues.push({ level: 'info', title: `「${subj}」(${cls}) コマ数が${cnt}コマ`, detail: '週6コマ超は多めです。確認をお勧めします。' });
      }
    }

    // 2. 教員名が似ている（1文字以内の差）→ 同一人物の入力ミスの可能性
    const teaNames = [...new Set(rows.flatMap(r => splitList(r.tea)))].filter(Boolean);
    const simGroups = new Set();
    for (let i = 0; i < teaNames.length; i++) {
      for (let j = i + 1; j < teaNames.length; j++) {
        const a = teaNames[i], b = teaNames[j];
        if (Math.abs(a.length - b.length) <= 1 && levenshtein(a, b) <= 1 && a.length >= 2) {
          const key = [a, b].sort().join('|');
          if (!simGroups.has(key)) {
            simGroups.add(key);
            issues.push({ level: 'warn', title: `教員名が類似: 「${a}」と「${b}」`, detail: '同一人物の入力ミスの可能性があります。どちらかに統一してください。' });
          }
        }
      }
    }

    // 3. 科目名が似ている
    const subjNames = [...new Set(rows.map(r => (r.subj || '').trim()))].filter(Boolean);
    for (let i = 0; i < subjNames.length; i++) {
      for (let j = i + 1; j < subjNames.length; j++) {
        const a = subjNames[i], b = subjNames[j];
        if (Math.abs(a.length - b.length) <= 1 && levenshtein(a, b) === 1 && a.length >= 3) {
          const key = [a, b].sort().join('|');
          issues.push({ level: 'info', title: `科目名が類似: 「${a}」と「${b}」`, detail: '同じ科目の入力ゆれの可能性があります。' });
        }
      }
    }

    // 4. 同一クラス+科目の合計コマが多すぎる
    const csCount = {}; // 'cls|subj' -> total
    for (const r of rows) {
      const cnt = parseInt(r.count || 1, 10) || 1;
      for (const c of splitList(r.cls)) {
        const k = `${c}|${(r.subj || '').trim()}`;
        csCount[k] = (csCount[k] || 0) + cnt;
      }
    }
    const totalSlots = DAYS.reduce((s, d) => s + maxPeriod(d), 0);
    for (const [k, cnt] of Object.entries(csCount)) {
      const [cls, subj] = k.split('|');
      if (cnt > totalSlots * 0.4) {
        issues.push({ level: 'warn', title: `「${subj}」(${cls}) 週${cnt}コマ`, detail: `全スロット(${totalSlots})の40%超です。配置可能性を確認してください。` });
      }
    }

    // 5. 教員が未設定の行
    const noTea = rows.filter(r => (r.subj || '').trim() && !(r.tea || '').trim());
    if (noTea.length) {
      issues.push({ level: 'info', title: `教員未設定の行が${noTea.length}件あります`, detail: noTea.slice(0, 3).map(r => `「${(r.subj || '').trim()}」(${(r.cls || '').trim()})`).join('、') + (noTea.length > 3 ? `…` : '') });
    }

    // 6. クラスが未設定の行
    const noCls = rows.filter(r => (r.subj || '').trim() && !(r.cls || '').trim());
    if (noCls.length) {
      issues.push({ level: 'warn', title: `クラス未設定の行が${noCls.length}件あります`, detail: noCls.slice(0, 3).map(r => `「${(r.subj || '').trim()}」`).join('、') + (noCls.length > 3 ? '…' : '') });
    }

    // 7. 同一教員が異なる教科で登録されている（参考情報）
    const teaDeptMap = {};
    for (const r of rows) {
      const dept = (r.dept || '').trim();
      if (!dept) continue;
      for (const t of splitList(r.tea)) {
        if (!teaDeptMap[t]) teaDeptMap[t] = new Set();
        teaDeptMap[t].add(dept);
      }
    }
    for (const [t, depts] of Object.entries(teaDeptMap)) {
      if (depts.size >= 3) {
        issues.push({ level: 'info', title: `教員「${t}」が${depts.size}教科を担当`, detail: [...depts].join('、') });
      }
    }

    // 8. 合計コマ数の確認
    const totalItems = rows.reduce((s, r) => s + (parseInt(r.count || 1, 10) || 1), 0);
    const allSlots = Object.keys(state.items).length || totalItems;
    if (totalItems > totalSlots * Object.keys(csCount).length / 5 && totalItems > 50) {
      issues.push({ level: 'info', title: `合計コマ数: ${totalItems}件`, detail: `配置スロット合計:${totalSlots}。クラス数によっては配置困難になる場合があります。` });
    }

    return issues;
  }

  // Simple Levenshtein for short strings
  function levenshtein(a, b) {
    if (!a.length) return b.length; if (!b.length) return a.length;
    const m = a.length, n = b.length;
    const dp = Array.from({ length: m + 1 }, (_, i) => Array.from({ length: n + 1 }, (_, j) => i ? j ? 0 : i : j));
    for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    return dp[m][n];
  }

  function showDataAnalysis() {
    const issues = analyzeRawData();
    if (!issues.length) {
      showModalHTML('✅ データ分析：問題なし', '<div class="muted small" style="margin:8px 0">検出できる問題はありませんでした。</div>', null, '閉じる', '閉じる');
      return;
    }
    const icon = { warn: '⚠️', info: 'ℹ️', err: '🚨' };
    const html = `<div class="data-issue-wrap">${issues.map(i => `
    <div class="data-issue-item ${i.level}">
      <div class="di-icon">${icon[i.level] || 'ℹ️'}</div>
      <div class="di-text"><strong>${escapeHtml(i.title)}</strong>${i.detail ? `<div class="di-detail">${escapeHtml(i.detail)}</div>` : ''}</div>
    </div>`).join('')}
    <div class="muted small" style="margin-top:8px">${issues.length}件の指摘事項</div>
  </div>`;
    showModalHTML(`🔍 データ分析（${issues.length}件）`, html, null, '閉じる', '閉じる');
  }

  /* v33.0: Show fix suggestion for a specific analysis issue */
  function showIssueFixSuggestion(iss) {
    try {
      if (!iss.fixableIds || !iss.fixableIds.length) {
        flash('この問題の自動修正提案はありません');
        return;
      }
      const firstId = iss.fixableIds[0];
      const pack = computeSuggestionPack(firstId);
      const allAlts = [
        ...(pack.empty || []).slice(0, 3),
        ...(pack.swap || []).slice(0, 3),
        ...(pack.linked || []).slice(0, 2),
      ].filter(Boolean).sort((a, b) => b.score - a.score).slice(0, 5);

      if (!allAlts.length) {
        // No suggestions found - show info and allow manual placement
        const it = state.items[firstId];
        const scfg = state.subjectCfg[it?.subjKey] || {};
        const abbr = scfg.abbr || it?.subj || '?';
        const plc = state.placements[firstId];
        const curWhere = plc ? `${DAYJP[plc.day]}${plc.period}` : '在庫';
        showModalHTML(
          `🔧 修正提案: 「${abbr}」(${curWhere})`,
          `<div style="padding:12px 4px">
          <div style="color:#64748b;margin-bottom:12px">自動提案が見つかりませんでした。</div>
          <div style="font-size:12px;color:#94a3b8">
            • コマをドラッグして手動で移動してください<br>
            • または在庫に戻してAI配置をお試しください
          </div>
        </div>`,
          null, '閉じる', '閉じる'
        );
        return;
      }

      const it = state.items[firstId];
      const scfg = state.subjectCfg[it?.subjKey] || {};
      const abbr = scfg.abbr || it?.subj || '?';
      const plc = state.placements[firstId];
      const curWhere = plc ? `${DAYJP[plc.day]}${plc.period}` : '在庫';

      // Open float windows for each involved teacher (will draw arrows on hover)
      const involvedTeas = [];
      for (const alt of allAlts) {
        for (const m of (alt.moves || [])) {
          const mit = state.items[m.id];
          for (const tea of (mit?.teas || [])) { if (!involvedTeas.includes(tea)) involvedTeas.push(tea); }
        }
      }
      involvedTeas.slice(0, 3).forEach(tea => { try { openFloat('teacher', tea); } catch { } });

      // Build visual move arrows HTML
      function buildMoveArrow(m) {
        try {
          const mit = state.items[m.id]; if (!mit) return '';
          const ms = state.subjectCfg[mit.subjKey] || {};
          const ma = ms.abbr || mit.subj || '?';
          const col = ms.color || pickColor(mit.subjKey) || '#64748b';
          const from = m.fromDay ? `${DAYJP[m.fromDay]}${m.fromPeriod}` : (state.placements[m.id] ? `${DAYJP[state.placements[m.id].day]}${state.placements[m.id].period}` : '在庫');
          const to = `${DAYJP[m.day]}${m.period}`;
          return `<span class="move-chip" style="background:${hexWithAlpha(col, 0.18)};border:1px solid ${col};color:#1e293b;border-radius:6px;padding:2px 7px;margin:2px;display:inline-flex;align-items:center;gap:4px;font-size:12px;white-space:nowrap">
          <span style="font-weight:900;color:${col}">${escapeHtml(ma)}</span>
          <span style="color:#94a3b8">${escapeHtml(from)}</span>
          <span style="color:#ef4444;font-size:16px;font-weight:900">➜</span>
          <span style="font-weight:700">${escapeHtml(to)}</span>
        </span>`;
        } catch (e) {
          console.error('Error in buildMoveArrow:', e, m);
          return '';
        }
      }

      const altsHTML = allAlts.map((s, i) => {
        try {
          const moves = s.moves || [];
          const arrowsHTML = moves.map(buildMoveArrow).filter(Boolean).join('');
          // Build score bar
          const scoreColor = s.score >= 70 ? '#22c55e' : s.score >= 40 ? '#f59e0b' : '#f43f5e';
          return `<div class="sug-item issueFix-item" data-isf-idx="${i}" style="margin-bottom:10px;padding:10px;background:#f8fafc;border-radius:10px;border:1px solid #e2e8f0;cursor:pointer;transition:box-shadow .15s">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
            <span class="badge2">案${i + 1}</span>
            <span style="font-size:11px;color:#64748b">${escapeHtml(s.label || s.title || '')}</span>
            <span style="margin-left:auto;font-size:11px;color:${scoreColor};font-weight:900">★${s.score}</span>
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px;align-items:center">${arrowsHTML}</div>
          ${moves.length > 1 ? `<div style="font-size:10px;color:#94a3b8;margin-bottom:6px">↑ ${moves.length}コマの連動移動（ホバーで矢印表示）</div>` :
              `<div style="font-size:10px;color:#94a3b8;margin-bottom:4px">ホバーで個人窓に矢印表示</div>`}
          <button class="btn" style="font-size:11px;padding:3px 12px" data-fix-sug="${i}">✅ 適用</button>
        </div>`;
        } catch (e) {
          console.error('Error in mapping alternatives:', e, s);
          return '';
        }
      }).join('');

      showModalHTML(
        `🔧 修正提案: 「${abbr}」(${curWhere})`,
        `<div style="max-height:60vh;overflow-y:auto;padding-right:4px">${altsHTML}</div>`,
        null, '閉じる', '閉じる',
        () => {
          // Bind apply buttons
          document.querySelectorAll('[data-fix-sug]').forEach(btn => {
            btn.onclick = () => {
              const i = parseInt(btn.dataset.fixSug, 10);
              const s = allAlts[i]; if (!s) return;
              clearSuggestionArrows();
              pushHistory('issueFix');
              for (const m of (s.moves || [])) {
                if (state.placements[m.id]?.locked) continue;
                state.placements[m.id] = m.day ? { day: m.day, period: m.period, locked: false } : null;
              }
              invalidateIndex(); markDirty('issueFix'); rerenderAll(); broadcastState();
              $('#modal-ok')?.click();
              flash('修正案を適用しました');
              setTimeout(() => showTimetableAnalysis(), 400);
            };
          });
          // Hover: show arrows in teacher float windows
          document.querySelectorAll('.issueFix-item').forEach(item => {
            item.onmouseenter = () => {
              const i2 = parseInt(item.dataset.isfIdx, 10);
              const s2 = allAlts[i2]; if (!s2?.moves?.length) return;
              previewSuggestionMoves(s2.moves);
            };
            item.onmouseleave = () => { clearSuggestionArrows(); };
          });
        }
      );
    } catch (e) {
      console.error('Error in showIssueFixSuggestion:', e);
      console.error('Full error:', e.stack);
      flash('修正案の表示に失敗しました: ' + e.message);
    }
  }

  function analyzeTimetable() {
    const issues = [];
    const idx = buildIndex();
    const placed = Object.keys(state.items).filter(id => state.placements[id]?.day);
    const allTeachers = [...new Set(placed.flatMap(id => state.items[id].teas || []))];
    const allClasses = [...new Set(placed.flatMap(id => state.items[id].cls || []))];
    const DAYS_JP = DAYS.map(d => DAYJP[d] || d);
    const maxP = Math.max(...DAYS.map(d => maxPeriod(d)));

    // --- 1. Teacher consecutive run violations (soft: no maxConsec set but >=3) ---
    for (const tea of allTeachers) {
      const tcfg = state.teacherCfg[tea] || {};
      const maxC = teacherConsecMax(tea);
      for (const day of DAYS) {
        const mP = maxPeriod(day);
        const taught = new Set();
        const teachSlotIds = {};
        for (let p = 1; p <= mP; p++) {
          const ids = idx.tea?.[tea]?.[day]?.[p] || [];
          if (ids.length) { taught.add(p); teachSlotIds[p] = ids; }
        }
        // compute longest run
        let best = 0, cur = 0, runStart = 0;
        const lunchAfter = Number(state.settings.lunchAfter || 0);
        let bestRun = [];
        let curRun = [];
        for (let p = 1; p <= mP; p++) {
          if (lunchAfter && p === lunchAfter + 1) { cur = 0; curRun = []; }
          if (taught.has(p)) { cur++; curRun.push(p); if (cur > best) { best = cur; bestRun = [...curRun]; } }
          else { cur = 0; curRun = []; }
        }
        const fixIds = bestRun.flatMap(p => (teachSlotIds[p] || [])).filter(id => !state.placements[id]?.locked);
        if (maxC == null && best >= 3) {
          issues.push({ level: 'warn', title: `${tea} — ${DAYJP[day]}に${best}連続授業`, detail: '連続授業上限未設定。見直しを推奨します。', fixableIds: fixIds.slice(0, 3), fixTea: tea, fixDay: day });
        } else if (maxC != null && best > maxC) {
          issues.push({ level: 'warn', title: `${tea} — ${DAYJP[day]}に連続${best}コマ（上限${maxC}）`, detail: '教員連続上限を超えています。', fixableIds: fixIds.slice(0, 3), fixTea: tea, fixDay: day });
        }
      }
    }

    // --- 2. Teacher overloaded on one day ---
    for (const tea of allTeachers) {
      for (const day of DAYS) {
        const mP = maxPeriod(day);
        let cnt = 0;
        for (let p = 1; p <= mP; p++) cnt += (idx.tea?.[tea]?.[day]?.[p] || []).length > 0 ? 1 : 0;
        if (cnt >= Math.ceil(mP * 0.75) && mP >= 4) {
          issues.push({ level: 'info', title: `${tea} — ${DAYJP[day]}に${cnt}/${mP}コマ集中`, detail: '1日の授業が多い傾向があります。' });
        }
      }
    }

    // --- 3. Teacher all lessons in period 1 or last period ---
    for (const tea of allTeachers) {
      const teacherIds = placed.filter(id => state.items[id].teas?.includes(tea));
      if (teacherIds.length < 2) continue;
      const periods = teacherIds.map(id => state.placements[id].period);
      if (periods.every(p => p === 1)) {
        issues.push({ level: 'info', title: `${tea} — 全授業が1時限目`, detail: '授業が1時限目に集中しています。' });
      } else if (periods.every(p => p === maxP)) {
        issues.push({ level: 'info', title: `${tea} — 全授業が最終時限(${maxP})`, detail: '授業が最終時限に集中しています。' });
      }
      // majority in period 1
      const p1count = periods.filter(p => p === 1).length;
      if (p1count / periods.length >= 0.6 && periods.length >= 3) {
        issues.push({ level: 'info', title: `${tea} — ${periods.length}コマ中${p1count}コマが1時限目`, detail: '1時限目への集中傾向があります。' });
      }
    }

    // --- 4. Subject all lessons in same period for a class ---
    const subjClassMap = new Map(); // 'cls|subjKey' -> [ids]
    for (const id of placed) {
      const it = state.items[id];
      for (const c of it.cls || []) {
        const k = `${c}|${it.subjKey}`;
        if (!subjClassMap.has(k)) subjClassMap.set(k, []);
        subjClassMap.get(k).push(id);
      }
    }
    for (const [key, ids] of subjClassMap) {
      if (ids.length < 2) continue;
      const [cls, subjKey] = key.split('|');
      const scfg = state.subjectCfg[subjKey] || {};
      const abbr = scfg.abbr || subjKey;
      const periods = ids.map(id => state.placements[id].period);
      if (periods.every(p => p === periods[0])) {
        issues.push({ level: 'info', title: `${cls} 「${abbr}」— 全${ids.length}コマが${periods[0]}時限目`, detail: '同じ時限への集中。バランスの見直しを検討してください。' });
      }
      // Check same day concentration
      const days = ids.map(id => state.placements[id].day);
      const dayCounts = {};
      for (const d of days) dayCounts[d] = (dayCounts[d] || 0) + 1;
      for (const [d, cnt] of Object.entries(dayCounts)) {
        if (cnt >= 2 && ids.length >= 3) {
          issues.push({ level: 'info', title: `${cls} 「${abbr}」— ${DAYJP[d]}に${cnt}コマ集中`, detail: '同一曜日に同科目が複数。' });
        }
      }
    }

    // --- 5. Hard violations (conflicts, forbidden) ---
    const vioIds = placed.filter(id => {
      const it = state.items[id];
      const plc = state.placements[id];
      for (let dp = 0; dp < (it.span || 1); dp++) {
        if (isForbiddenForSubject(it.subjKey, plc.day, plc.period + dp)) return true;
      }
      return false;
    });
    for (const id of vioIds) {
      const it = state.items[id];
      const scfg = state.subjectCfg[it.subjKey] || {};
      const plc = state.placements[id];
      issues.push({ level: 'warn', title: `「${scfg.abbr || it.subj}」— 禁則スロットに配置済み`, detail: `${DAYJP[plc.day]}${plc.period} (${(it.cls || []).join(',')})`, fixableIds: [id] });
    }

    // --- 6. Unplaced items ---
    const unplaced = Object.keys(state.items).filter(id => !state.placements[id]);
    if (unplaced.length) {
      const names = unplaced.slice(0, 5).map(id => { const it = state.items[id]; const sc = state.subjectCfg[it.subjKey] || {}; return (sc.abbr || it.subj || id) + `(${(it.cls || []).join(',')})`; });
      issues.push({ level: 'warn', title: `未配置コマが${unplaced.length}件あります`, detail: names.join('、') + (unplaced.length > 5 ? `他${unplaced.length - 5}件…` : ''), fixableIds: unplaced.slice(0, 8) });
    }

    return issues;
  }

  // Build full matrix: rows=all keys (teachers or classes), cols=day×period
  // Optimized for A3 single-sheet output with adjustable cell size
  function buildMatrixHTML(kind, keys, idx, maxP, opt, layout, cellH = 32, fontSize = 9, colWidth = 0) {
    const align = state.ui.printAlign || 'center';
    const fontFam = state.ui.printFontFamily || 'system';
    const fontFamilyCSS = _printFontCSS(fontFam);
    // 列の幅は印刷画面の「列幅」で変えられる（以前は行の高さから決めていて、狭すぎて字が「…」になった）
    const colW = colWidth || Math.max(28, clamp(cellH, 28, 80));
    const rowH = cellH;
    const mFS = Math.max(7, fontSize - 1);
    const nameW = 72;
    // Build header
    let html = `<div class="print-matrix-wrap" style="overflow-x:auto;font-size:${mFS}px;font-family:${fontFamilyCSS}">`;
    const tableW = nameW + DAYS.length * maxP * colW + 20;
    html += `<table class="t2 print-matrix" style="table-layout:fixed;width:${tableW}px;--mx-w:${tableW}px;font-family:${fontFamilyCSS}">`;
    html += `<thead>`;
    // Row 1: name + day headers
    html += `<tr><th rowspan="2" style="width:${nameW}px;min-width:${nameW}px;vertical-align:middle;text-align:center;background:#e8f0fe">${kind === 'teacher' ? '教員' : kind === 'class' ? 'クラス' : kind === 'room' ? '教室' : '対象'}</th>`;
    for (const day of DAYS) {
      const periodsInDay = maxPeriod(day);
      html += `<th colspan="${maxP}" style="text-align:center;background:#f1f5f9;font-size:${mFS + 1}px;font-weight:900">${DAYJP[day]}</th>`;
    }
    html += `</tr>`;
    // Row 2: period numbers
    html += `<tr>`;
    for (const day of DAYS) {
      for (let p = 1; p <= maxP; p++) {
        const overMaxP = p > maxPeriod(day);
        html += `<th style="width:${colW}px;min-width:${colW}px;background:${overMaxP ? '#f8fafc' : '#f8fafc'};font-size:${mFS - 1}px;color:${overMaxP ? '#cbd5e1' : '#64748b'};padding:2px 0;text-align:center">${p}</th>`;
      }
    }
    html += `</tr></thead><tbody>`;
    // Data rows: one per key (teacher or class)
    // 文字は「…」で切らない。入らない時は文字を小さくし、それでも入らなければ折り返す
    const tLen = (t) => [...String(t)].reduce((a, c) => a + (/[ -~｡-ﾟ]/.test(c) ? 0.55 : 1), 0);
    const fitPx = (t, base, w, min) => Math.max(min, Math.min(base, Math.floor((w * 0.94) / Math.max(1, tLen(t)) * 10) / 10));
    const shortTea = (ts) => ts.length > 2 ? `${ts[0]}他${ts.length - 1}` : ts.join('・');
    for (const key of keys) {
      const keyFs = fitPx(key, mFS + 1, nameW - 8, 7);
      html += `<tr><th style="height:${rowH}px;width:${nameW}px;min-width:${nameW}px;font-size:${keyFs}px;line-height:1.15;word-break:break-all;background:#fafcff;padding:1px 4px;text-align:left" title="${escapeHtml(key)}">${escapeHtml(key)}</th>`;
      for (const day of DAYS) {
        for (let p = 1; p <= maxP; p++) {
          const overMaxP = p > maxPeriod(day);
          if (overMaxP) { html += `<td class="forbidden" style="height:${rowH}px;width:${colW}px;min-width:${colW}px"></td>`; continue; }
          // 【4】2連の2コマ目も同じ授業を印刷する
          const ids = idsInCellForRow(kind, key, day, p, idx);
          if (!ids.length) { html += `<td style="height:${rowH}px;width:${colW}px;min-width:${colW}px"></td>`; continue; }
          const innerW = colW - 9; // マスの余白・色の帯の分を引く
          const many = ids.length > 1 ? 0.85 : 1;
          const cells = ids.map(id => {
            const it = state.items[id]; if (!it) return '';
            const scfg = state.subjectCfg[it.subjKey] || {};
            // 科目名は読みやすい略称で（数学Ⅰ11 → 数Ⅰ、日世226 → 選択）。クラスの表では「1年」を省く
            let sj = { main: scfg.abbr || it.subj || '' };
            try { sj = sheetSubj(it, 'abbr'); } catch (e) { }
            let abbr = sj.isChoice ? '選択' : sj.main;
            if (kind === 'class' && !sj.isChoice) abbr = abbr.replace(/^[1-6１-６]\s*年?\s*(?=[^\d\s・-]{2})/, '');
            let main = abbr;
            const line2parts = [];
            if (kind === 'class') { if (opt.showTea && it.teas?.length) line2parts.push(shortTea(it.teas.map(t => (state.teacherCfg[t]?.abbr || t)))); }
            else {
              // 教員・教室の表では、大きくクラス、小さく科目
              if (it.cls?.length) { main = compactClsLabel(it.cls); line2parts.push(abbr); }
              if (kind === 'room' && opt.showTea && it.teas?.length) line2parts.push(shortTea(it.teas));
            }
            if (opt.showRoom && kind !== 'room' && it.rooms?.length) { const rs = it.rooms.filter(r => !(it.cls || []).includes(r)); if (rs.length) line2parts.push(rs.join('・')); }
            const color = scfg.color || pickColor(it.subjKey) || '#e2e8f0';
            const bg = hexWithAlpha(color, 0.28);
            const fsMain = fitPx(main, mFS + 1, innerW, 6.5) * many;
            const sub2 = line2parts.map(l => `<div style="font-size:${(fitPx(l, mFS - 1, innerW, 6) * many).toFixed(1)}px;color:#475569;line-height:1.1;word-break:break-all">${escapeHtml(l)}</div>`).join('');
            return `<div style="background:${bg};border-left:2px solid ${color};border-radius:2px;padding:1px 2px;margin-bottom:1px;text-align:${align};font-family:${fontFamilyCSS}" title="${escapeHtml((it.realSubj || it.subj || '') + ' ' + (it.teas || []).join('・'))}"><div style="font-weight:800;font-size:${fsMain.toFixed(1)}px;line-height:1.1;word-break:break-all">${escapeHtml(main)}</div>${sub2}</div>`;
          }).join('');
          html += `<td style="height:${rowH}px;width:${colW}px;min-width:${colW}px;padding:1px;vertical-align:top">${cells}</td>`;
        }
      }
      html += `</tr>`;
    }
    html += `</tbody></table></div>`;
    return html;
  }

  /* =======================
     Keyboard Help Modal (v34.3)
  ======================= */
  function showKeyboardHelp() {
    const shortcuts = [
      { key: 'Ctrl+Z', desc: '元に戻す' },
      { key: 'Ctrl+Y / Ctrl+Shift+Z', desc: 'やり直し' },
      { key: 'Esc', desc: '選択解除' },
      { key: 'Delete / Backspace', desc: '選択中のコマを在庫へ' },
      { key: '→ / ←', desc: '次/前の未配置コマへジャンプ' },
      { key: 'Space / Enter', desc: '選択中の未配置コマを即配置' },
      { key: 'L', desc: '選択中のコマをロック/解除' },
      { key: 'S', desc: '選択中のコマの提案を開く' },
      { key: 'A', desc: 'AI探索 開始/停止' },
      { key: 'R', desc: '修復モード実行' },
      { key: 'Ctrl+A', desc: '在庫を全選択（編集タブ）' },
      { key: 'Ctrl+クリック', desc: '在庫の複数選択（追加/除去）' },
      { key: '?', desc: 'このヘルプを表示' },
    ];
    const html = `
    <div class="kb-help-wrap">
      <table class="kb-help-table">
        <thead>
          <tr><th>キー</th><th>機能</th></tr>
        </thead>
        <tbody>
          ${shortcuts.map(s => `<tr>
            <td class="kb-key">${escapeHtml(s.key)}</td>
            <td class="kb-desc">${escapeHtml(s.desc)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
      <div class="kb-hint">💡 コマを選択してから S キーを押すと提案が開きます</div>
      <div style="margin-top:12px;text-align:center">
        <button onclick="showVersionInfo()" style="font-size:11px;padding:4px 12px;background:#f1f5f9;border:1px solid #cbd5e1;border-radius:6px;cursor:pointer">
          📋 バージョン情報・修正履歴を見る
        </button>
      </div>
    </div>
  `;
    showModalHTML('⌨️ キーボードショートカット', html, null, '閉じる', '閉じる');
  }

  function showVersionInfo() {
    const html = `
    <div style="padding:8px;max-height:70vh;overflow-y:auto">
      <h2 style="font-size:18px;font-weight:900;margin-bottom:8px;color:#0f172a">📦 駒入盤（こまいればん）— 時間割作成アプリ</h2>
      <div style="font-size:12px;color:#64748b;margin-bottom:16px">最終更新: 2026年2月20日</div>
      
      <h3 style="font-size:14px;font-weight:900;margin:12px 0 6px;color:#0f172a">🚀 v49.0 新機能・修正</h3>
      <ul style="font-size:12px;line-height:1.6;color:#334155;margin:0;padding-left:20px">
        <li><strong>📄 PDFエクスポート:</strong> 印刷タブから直接PDF保存（html2canvas + jsPDF）</li>
        <li><strong>⇉ 並列授業グループ表示:</strong> 同一セルの並列コマを視覚的にグループ化（左ボーダー＋ヘッダ）</li>
        <li><strong>🎨 フロート窓ドラッグプレビュー強化:</strong> 3色（緑/黄/赤）でリアルタイム制約表示</li>
        <li><strong>🔴 強制上書ドロップモード:</strong> 確認ダイアログなしで即配置（移動先コマを在庫へ）</li>
        <li><strong>🐛 印刷設定初期化バグ修正:</strong> 保存済み揃え・フォント設定が正しく復元されるように</li>
        <li><strong>⌨️ キーボードヘルプ更新:</strong> Ctrl+A・Ctrl+クリック を追加</li>
      </ul>

      <h3 style="font-size:14px;font-weight:900;margin:12px 0 6px;color:#0f172a">📦 v46〜v48 主要機能</h3>
      <ul style="font-size:12px;line-height:1.6;color:#334155;margin:0;padding-left:20px">
        <li><strong>v48:</strong> ドラッグ中リアルタイム制約プレビュー（メイングリッド）、配置不能原因分析、仮配置サンドボックス、スナップ差分テキストレポート</li>
        <li><strong>v47:</strong> 在庫複数選択（Ctrl+クリック/全選択）、スナップ差分表示、教員休憩コマ設定、複数時間割セット管理、教員コマ数バーチャート</li>
        <li><strong>v46:</strong> AIウィザード強化（教員連続/教室競合/同日重複）、SA停滞再加熱、教員/クラス一覧ウィンドウ自動再描画、科目連続禁止制約、教室マトリクス印刷、在庫配置可能性バッジ</li>
      </ul>

      <h3 style="font-size:14px;font-weight:900;margin:12px 0 6px;color:#0f172a">🎯 主要機能一覧</h3>
      <ul style="font-size:12px;line-height:1.6;color:#334155;margin:0;padding-left:20px">
        <li>CSV一括インポート/エクスポート（BOM付きUTF-8対応）</li>
        <li>ドラッグ&ドロップ配置（制約プレビュー付き）</li>
        <li>AI自動配置（SA＋GA＋Greedy・停滞再加熱）</li>
        <li>多視点表示（教員別・クラス別・教室別）＋フロート個人窓</li>
        <li>制約管理（固定禁則・許可枠モード・同日禁止・連続禁止）</li>
        <li>2連続コマ・並列展開・仮配置サンドボックス</li>
        <li>衝突解決ダイアログ・配置提案（6種タブ）</li>
        <li>Undo/Redo・スナップショット差分・複数時間割セット管理</li>
        <li>印刷・PDFエクスポート（マトリクス・個人表・多列対応）</li>
      </ul>

      <h3 style="font-size:14px;font-weight:900;margin:12px 0 6px;color:#0f172a">🔧 技術情報（他AI引き継ぎ用）</h3>
      <div style="font-size:11px;background:#f8fafc;padding:8px;border-radius:6px;border:1px solid #e2e8f0;font-family:monospace;white-space:pre-wrap;line-height:1.5;color:#1e293b">state構造:
  rawRows: 入力データ配列
  items: {id: {subjKey, cls[], teas[], rooms[], span, parallel}}
  placements: {id: {day, period, locked}}
  subjectCfg: {key: {abbr, color, dept, fixedForbid, allowedMode, allowedSlots, noSameDay, noConsec, maxPerDay}}
  teacherCfg: {key: {abbr, maxDaily, maxConsec, unavailable, allowedMode, allowedSlots, breakSlots}}
  settings: {periodsByDay, lunchAfter, roomConflict, teaDefaultMaxDaily, teaDefaultMaxConsec}
  ui: {viewMode, selectedId, stockMultiSel, floats[], drop, printAlign, printFontFamily, ...}

主要関数:
  buildIndex() — idx.tea/cls/room キャッシュ構築
  validatePlacement(id, day, period, mode, swapTarget) — 制約チェック
  placeItem(id, day, period, opts) — UIから配置（衝突ダイアログあり）
  doPlace(id, day, period, swapTarget) — 直接配置
  computeSuggestionPack(id) — 提案生成（6タブ）
  aiTrialOnce(basePlacements) — AI 1トライアル
  exportPDF() — PDF直接保存

デバッグ:
  buildIndex()
  _wizardIssues = _buildWizardIssues(); console.log(_wizardIssues)
  localStorage: ultimate_tt_state_v271</div>
    </div>
  `;
    showModalHTML('📋 バージョン情報 v36.3', html, null, '閉じる', '閉じる');
  }
  window.showVersionInfo = showVersionInfo;

  function bindSplitters() {
    const splitV = $('#split-stock');
    const splitP = $('#split-prop');
    const splitTop = $('#split-stock-top');
    const stock = $('#stock-panel');
    const prop = $('#prop-panel');
    const grid = $('#grid-wrapper');

    function dragV(split, leftEl, propName, min = 200, max = 600) {
      let startX = 0, startW = 0;
      split.onmousedown = (ev) => {
        startX = ev.clientX; startW = leftEl.getBoundingClientRect().width;
        const move = (e) => {
          const dx = e.clientX - startX;
          const w = clamp(startW + dx, min, max);
          leftEl.style.width = w + 'px';
        };
        const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); applyDensity(); };
        window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
      };
    }
    if (splitV && stock) dragV(splitV, stock, 'width', 180, 720);
    if (splitP && prop) dragV(splitP, prop, 'width', 260, 620);

    if (splitTop) {
      // In stock-top mode the grid row height is driven by --stockTopH on body,
      // NOT by stock.style.height. Read CSS var for startH.
      let startY = 0, startH = 0;
      const getStockTopH = () => {
        const v = document.body.style.getPropertyValue('--stockTopH');
        return v ? parseInt(v) : (state.ui.stockTopH || 260);
      };
      splitTop.onmousedown = (ev) => {
        ev.preventDefault();
        startY = ev.clientY;
        startH = getStockTopH();
        const move = (e) => {
          const dy = e.clientY - startY;
          const h = clamp(startH + dy, 80, window.innerHeight - 200);
          state.ui.stockTopH = h;
          document.body.style.setProperty('--stockTopH', h + 'px');
        };
        const up = () => {
          window.removeEventListener('mousemove', move);
          window.removeEventListener('mouseup', up);
          markDirty('ui');
        };
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
      };
    }
  }

