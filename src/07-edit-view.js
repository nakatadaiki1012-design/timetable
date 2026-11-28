  /* =======================
     Edit view (Grid / Stock / Prop)
  ======================= */
  // prefer delegated DnD
  window._useDelegatedDnd = true;
  // 表の中身を決めるデータの「指紋」。前に描いた時と同じなら、表を作り直さなくてよい
  let _gridSig = null;
  function gridSignature() {
    try {
      const ui = { ...state.ui, selectedId: null, selectedFrom: '' };
      return JSON.stringify([state.items, state.placements, state.subjectCfg, state.teacherCfg, state.settings, ui, document.getElementById('grid-wrapper')?.dataset.dl || '']);
    } catch (e) { return null; }
  }
  function rerenderEdit(opts = {}) {
    applyBodyClasses();
    applyDensity();
    // v32.3: apply stock size
    const _sz = state.ui.stockSize || 'md';
    document.body.setAttribute('data-stock-size', _sz);
    const _wMap = { xs: '80px', sm: '100px', md: '128px', lg: '160px', xl: '200px' };
    document.documentElement.style.setProperty('--stockItemW', _wMap[_sz] || '128px');
    renderStock();
    // 別の画面から戻っただけで何も変わっていない時は、表を作り直さない（作り直すと1秒近く固まっていた）
    const sig = opts.reuse ? gridSignature() : null;
    if (sig && sig === _gridSig && document.querySelector('#grid .timetable')) { try { updateGridSelection(); } catch (e) { renderGrid(); } }
    else renderGrid();
    renderProp();
    $('#stock-search').value = state.ui.stockSearch || '';
    $('#row-filter').value = state.ui.rowFilter || '';
    $('#show-placed').checked = !!state.ui.showPlaced;
    $('#group-stock').checked = !!state.ui.groupStock;
    $('#density-fine').value = state.ui.densityFine;
    $('#density-fine-label').textContent = '±' + String(state.ui.densityFine);
    renderFloatLayer();
  }



  // ===== Row/Key normalization helpers (robust matching for relevant-row gating) =====
  function normalizeKey(s) {
    return String(s || '').replace(/[\u3000\s]+/g, '').replace(/[()（）]/g, '').toLowerCase();
  }


  function resolveAxisKey(kind, raw) {
    const nk = normalizeKey(raw);
    if (!nk) return raw;
    try {
      const keys = getAxisKeys(kind) || [];
      const hit = keys.find(k => normalizeKey(k) === nk);
      return hit || raw;
    } catch (e) { return raw; }
  }

  function scrollMainRowIntoView(kind, key) {
    // Main grid row header (teacher/class/room axis view)
    try {
      const th = document.querySelector(`.grid-wrapper th[data-rowkey="${CSS.escape(key)}"]`);
      if (th) th.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (e) { }
  }

  function scrollAllWindowToKey(kind, key) {
    // All-teachers / all-classes floating window
    try {
      const layer = document.getElementById('float-layer');
      if (!layer) return;
      const existId = `__all_${kind}__`;
      const win = layer.querySelector(`.atw-win[data-id="${CSS.escape(existId)}"]`);
      if (!win) return;
      const block = win.querySelector(`.atw-block[data-key="${CSS.escape(key)}"]`);
      if (block) block.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    } catch (e) { }
  }

  function uniqArr(a) { return Array.from(new Set(a.filter(Boolean))); }
  function teacherCandidates(key) {
    try { const cfg = (state.teacherCfg || {})[key] || {}; return uniqArr([key, cfg.name, cfg.abbr].map(normalizeKey)); } catch (e) { return [normalizeKey(key)]; }
  }
  function classCandidates(key) {
    try { const cfg = (state.classCfg || {})[key] || {}; return uniqArr([key, cfg.name, cfg.abbr].map(normalizeKey)); } catch (e) { return [normalizeKey(key)]; }
  }
  function roomCandidates(key) {
    try { const cfg = (state.roomCfg || {})[key] || {}; return uniqArr([key, cfg.name, cfg.abbr].map(normalizeKey)); } catch (e) { return [normalizeKey(key)]; }
  }
  function isRelevantRowByMode(tr, it, mode) {
    if (!tr || !it) return false;
    const rowKey = tr.getAttribute('data-row');
    const rowN = normalizeKey(rowKey);
    if (mode === 'teacher') {
      const teas = (it.teas && it.teas.length ? it.teas : ['(未)']);
      if (teas.includes('(未)') && (rowKey === '(未)' || rowN === '未')) return true;
      for (const t of (it.teas || [])) { const cands = teacherCandidates(t); if (cands.includes(rowN)) return true; }
      return false;
    } else if (mode === 'class') {
      for (const c of (it.cls || [])) { const cands = classCandidates(c); if (cands.includes(rowN)) return true; }
      return false;
    } else if (mode === 'room') {
      for (const r of (it.rooms || [])) { const cands = roomCandidates(r); if (cands.includes(rowN)) return true; }
      return false;
    }
    return true;
  }
  function applyBodyClasses() {
    const isTop = state.ui.stockPos === 'top';
    document.body.classList.toggle('stock-top', isTop);
    document.body.classList.toggle('thin', !!state.ui.stockThin);
    document.body.classList.toggle('prop-hide', !state.ui.propOn);

    // stock-top height — update the CSS variable on body (used in grid-template-rows)
    const h = Number(state.ui.stockTopH || (state.ui.stockThin ? 180 : 260));
    document.body.style.setProperty('--stockTopH', h + 'px');

    // DO NOT set stock.style.height — grid-template-rows controls row height, not element height
    const stock = $('#stock-panel');
    if (stock) stock.style.height = '';

    // Show/hide horizontal splitter via JS (overrides inline display:none in HTML)
    const splitTop = $('#split-stock-top');
    if (splitTop) splitTop.style.display = isTop ? 'block' : 'none';
  }
  function applyDensity() {
    const wrap = $('#grid-wrapper');
    if (!wrap) return;
    let dl = 3;
    if (state.ui.densityMode === 'tight') dl = 1;
    if (state.ui.densityMode === 'mid') dl = 3;
    if (state.ui.densityMode === 'wide') dl = 5;
    if (state.ui.densityMode === 'auto') {
      const w = wrap.clientWidth || 1000;
      dl = w < 980 ? 1 : w < 1180 ? 2 : w < 1480 ? 3 : w < 1780 ? 4 : 5;
    }
    dl = clamp(dl + Number(state.ui.densityFine || 0), 0, 6);

    // font/cell adjustments (stepwise)
    const fs = clamp(Number(state.ui.fontStep || 0), -3, 3);
    const cs = clamp(Number(state.ui.cellStep || 0), -3, 3);
    wrap.style.setProperty('--subAdj', (fs * 1) + 'px');
    wrap.style.setProperty('--metaAdj', (fs * 1) + 'px');
    wrap.style.setProperty('--tdhAdj', (cs * 4) + 'px');
    // 【B-1】文字を大きくしたらコマ幅(テーブル最小幅)も広げる（切れ防止・見出し固定でスクロール）
    wrap.style.setProperty('--tableAdj', (fs * 90) + 'px');
    // 【1/2】時限の総数（列数）。CSSで「列数×文字サイズ由来の最小幅」をテーブル最小幅にする
    try { wrap.style.setProperty('--ncols', String(activeDays().reduce((n, d) => n + maxPeriod(d), 0) || 30)); } catch (e) { }
    const fsl = $('#font-step-label'); if (fsl) fsl.textContent = `±${fs}`;
    const csl = $('#cell-step-label'); if (csl) csl.textContent = `±${cs}`;

    wrap.dataset.dl = String(dl);
  }


  // 教員を教科順に並べるときの順番。データ上の教科名の書き方（社会・理・英語 など）の違いを吸収する
  const TEACHER_DEPT_ORDER = ['国語', '地歴', '公民', '数学', '情報', '理科', '保健体育', '芸術', '外国語', '家庭'];
  function canonicalDept(name) {
    const d = String(name || '').replace(/[\s　]/g, '');
    if (!d) return '';
    if (/国語/.test(d)) return '国語';
    if (/地理|歴史|地歴/.test(d)) return '地歴';
    if (/公民|政経|政治|倫理|公共/.test(d)) return '公民';
    if (/社会/.test(d)) return '社会'; // 地歴か公民かは担当科目で決める
    if (/数学|算数/.test(d)) return '数学';
    if (/情報/.test(d)) return '情報';
    if (/理科|^理$|物理|化学|生物|地学/.test(d)) return '理科';
    if (/保健|体育/.test(d)) return '保健体育';
    if (/芸術|音楽|美術|書道|工芸/.test(d)) return '芸術';
    if (/外国語|英語|^英$|英会話|ALT/i.test(d)) return '外国語';
    if (/家庭/.test(d)) return '家庭';
    return d;
  }
  function teacherDeptRank(teacherName) {
    if (teacherName === '(未)') return 999;
    let dept = canonicalDept(inferTeacherDept(teacherName));
    if (dept === '社会') {
      // 「社会」の先生は、担当している授業の教科（地理歴史/公民）が多い方に入れる
      let geo = 0, civ = 0;
      for (const id in state.items) {
        const it = state.items[id];
        if (!it || !(it.teas || []).includes(teacherName)) continue;
        const sd = canonicalDept(state.subjectCfg[it.subjKey]?.dept || it.subj);
        if (sd === '地歴') geo++; else if (sd === '公民') civ++;
      }
      dept = civ > geo ? '公民' : '地歴';
    }
    const i = TEACHER_DEPT_ORDER.indexOf(dept);
    return i >= 0 ? i : (dept ? 100 : 200); // 一覧に無い教科は後ろ、教科不明はさらに後ろ
  }

  function inferTeacherDept(teacherName) {
    const cfg = state.teacherCfg[teacherName] || {};
    const direct = (cfg.dept || '').trim();
    if (direct) return direct;

    // infer from taught subjects
    const counts = new Map();
    for (const id of Object.keys(state.items)) {
      const it = state.items[id];
      if (!it || !it.teas || !it.teas.includes(teacherName)) continue;
      const sd = (state.subjectCfg[it.subjKey]?.dept || '').trim();
      const key = sd || '(未設定)';
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    let best = '', bestN = 0;
    for (const [k, n] of counts.entries()) {
      if (n > bestN) { best = k; bestN = n; }
    }
    return (best === '(未設定)') ? '' : best;
  }
  function getAxisKeys(mode) {
    const ids = Object.keys(state.items);
    const set = new Set();
    if (mode === 'teacher') {
      for (const id of ids) {
        const it = state.items[id];
        const teas = it.teas.length ? it.teas : ['(未)'];
        teas.forEach(t => set.add(t));
      }
      const keys = Array.from(set);
      if (state.ui.teacherSort === 'manual') {
        // use saved order, append new ones
        const order = Array.isArray(state.ui.teacherOrder) ? state.ui.teacherOrder.slice() : [];
        const setKeys = new Set(keys);
        const out = [];
        for (const k of order) { if (setKeys.has(k)) out.push(k); }
        for (const k of keys) { if (!out.includes(k)) out.push(k); }
        state.ui.teacherOrder = out.slice();
        return out;
      }
      if (state.ui.teacherSort === 'subject') {
        // 教科順: 国語→地歴→公民→数学→情報→理科→保健体育→芸術→外国語→家庭→その他→(未)。同じ教科の中は名前順
        const rank = {};
        for (const k of keys) rank[k] = teacherDeptRank(k);
        keys.sort((a, b) => (rank[a] - rank[b]) || a.localeCompare(b, 'ja'));
      } else {
        keys.sort((a, b) => a.localeCompare(b, 'ja'));
      }
      return keys;
    }
    if (mode === 'class') {
      for (const id of ids) state.items[id].cls.forEach(c => set.add(c));
      return Array.from(set).sort((a, b) => a.localeCompare(b, 'ja'));
    }
    if (mode === 'room') {
      for (const id of ids) {
        const rooms = state.items[id].rooms.length ? state.items[id].rooms : ['(未)'];
        rooms.forEach(r => set.add(r));
      }
      return Array.from(set).sort((a, b) => a.localeCompare(b, 'ja'));
    }
    return [];
  }
  function rowMatchesFilter(key) {
    const q = (state.ui.rowFilter || '').trim();
    if (!q) return true;
    return key.includes(q);
  }

  // コマの文字を「1行・はみ出さない最大サイズ」に合わせる。
  // まとめて読み取ってからまとめて書き込み、再計算(レイアウト)を最小限にする。
  // コマの文字を、マスの幅に入る大きさに合わせる。
  // 前に合わせた時と「文字」と「マスの幅」が同じコマは測り直さない（全コマを毎回測り直すと重い）
  function fitLessonText() {
    const root = document.getElementById('grid'); if (!root) return;
    __fitOnly = null;
    const els = root.querySelectorAll('.timetable td .lesson .l1 .subj, .timetable td .lesson .l2');
    const MIN = 7;
    const todo = [];
    for (const el of els) {
      const cw = el.clientWidth;
      const key = cw + '|' + el.textContent;
      if (el.__fk === key) continue;
      el.__fkNext = key; todo.push(el);
    }
    if (!todo.length) return;
    for (const el of todo) if (el.style.fontSize) el.style.fontSize = '';
    const reads = [];
    for (const el of todo) {
      const sw = el.scrollWidth, cw = el.clientWidth;
      el.__fk = el.__fkNext;
      if (!cw || sw <= cw + 0.5) continue;
      reads.push([el, parseFloat(getComputedStyle(el).fontSize) || 11, cw / sw]);
    }
    for (const [el, fs, r] of reads) {
      el.style.setProperty('font-size', Math.max(MIN, Math.floor(fs * r * 10) / 10) + 'px', 'important');
    }
  }
  let __fitQueued = false;
  function queueFitLessonText() {
    if (__fitQueued) return; __fitQueued = true;
    requestAnimationFrame(() => { __fitQueued = false; try { fitLessonText(); } catch (e) { } });
  }
  (function watchGridForFit() {
    const start = () => {
      const g = document.getElementById('grid'); if (!g) return;
      new MutationObserver(queueFitLessonText).observe(g, { childList: true, subtree: true });
      window.addEventListener('resize', () => { __fitOnly = null; queueFitLessonText(); });
      // 表の幅が変わった時（右の詳細欄が開閉した時など）は、全コマの文字の大きさを合わせ直す
      try {
        let lastW = 0;
        new ResizeObserver((es) => { const w = Math.round(es[0].contentRect.width); if (w && w !== lastW) { lastW = w; __fitOnly = null; queueFitLessonText(); } }).observe(document.getElementById('grid-wrapper') || g);
      } catch (e) { }
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  })();

  /* =======================
     スマホ表示（画面幅が狭い端末向けの切替）
     - 1曜日ずつ表示して文字を大きく、在庫は下から出る引き出しに、詳細欄は畳む
     - 端末の幅で自動判定し、ヘッダーの「📱」ボタンでいつでも切替（選択は端末に記憶）
  ======================= */
  const MOBILE_KEY = 'tt_mobile_mode';
  function wantMobile() {
    let v = null; try { v = localStorage.getItem(MOBILE_KEY); } catch (e) { }
    if (v === '1') return true; if (v === '0') return false;
    // スマホ（幅760px以下）に加え、指で操作する端末ならタブレット(縦〜横の小さめ)もスマホ表示で始める
    const touch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    return window.innerWidth <= 760 || (touch && window.innerWidth <= 1100);
  }
  function setMobileDay(d) {
    const days = activeDays ? activeDays() : DAYS;
    if (d !== 'all' && !days.includes(d)) d = days[0] || 'Mon';
    document.body.dataset.mday = d;
    document.querySelectorAll('#mobile-bar .mb-day').forEach(b => {
      b.classList.toggle('on', b.dataset.mday === d);
      b.style.display = (b.dataset.mday === 'all' || days.includes(b.dataset.mday)) ? '' : 'none';
    });
  }
  function applyMobileMode(on) {
    document.body.classList.toggle('mobile', on);
    if (!on) document.body.classList.remove('stock-open');
    const btn = document.getElementById('btn-mobile-toggle');
    if (btn) btn.textContent = on ? '🖥 PC表示' : '📱 スマホ表示';
    if (on && !document.body.dataset.mday) {
      const today = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date().getDay()];
      setMobileDay(today);
    } else if (on) setMobileDay(document.body.dataset.mday);
    try { queueFitLessonText(); } catch (e) { }
  }
  function updateMobileStockCount() {
    const el = document.getElementById('mb-stock-count'); if (!el) return;
    const n = Object.keys(state.items).filter(id => !state.placements[id]?.day).length;
    el.textContent = n;
  }
  (function initMobileMode() {
    const start = () => {
      applyMobileMode(wantMobile());
      document.getElementById('btn-mobile-toggle')?.addEventListener('click', () => {
        const on = !document.body.classList.contains('mobile');
        try { localStorage.setItem(MOBILE_KEY, on ? '1' : '0'); } catch (e) { }
        applyMobileMode(on);
      });
      document.querySelectorAll('#mobile-bar .mb-day').forEach(b => b.addEventListener('click', () => { setMobileDay(b.dataset.mday); queueFitLessonText(); }));
      document.getElementById('mb-stock')?.addEventListener('click', () => { updateMobileStockCount(); document.body.classList.toggle('stock-open'); });
      // 在庫のコマを選んだら引き出しを閉じ、時間割のマスをタップして置けるようにする
      document.getElementById('stock-list')?.addEventListener('click', (e) => {
        if (!document.body.classList.contains('mobile')) return;
        if (e.target.closest('.lesson, .stock-card, [data-id]')) setTimeout(() => document.body.classList.remove('stock-open'), 120);
      });
      // 端末の向きを変えた時など、記憶した選択が無ければ幅で自動判定し直す
      window.addEventListener('resize', () => {
        let v = null; try { v = localStorage.getItem(MOBILE_KEY); } catch (e) { }
        if (v == null) applyMobileMode(wantMobile());
      });
      updateMobileStockCount();
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  })();

  // 画面の切り替えボタン（表示・ツール・置き方）の印を、今の設定に合わせる。
  // 以前は保存された設定（例: クラス表示）で開いても印は「教員」のままで、押しても教員表示に戻せなかった
  function syncEditRadios() {
    const want = { viewmode: state.ui.viewMode || 'teacher', tool: state.ui.tool, drop: state.ui.drop };
    for (const name in want) {
      if (!want[name]) continue;
      const r = document.querySelector(`input[name="${name}"][value="${want[name]}"]`);
      if (r && !r.checked) r.checked = true;
    }
  }
  function renderGrid() {
    const live = $('#grid'); if (!live) return;
    // 表はまず画面の外で組み立て、最後に「前と変わった行だけ」を画面に差し替える（毎回全部を描き直すと重い）
    const root = document.createElement('div');
    try { clearRelatedHighlight(); } catch (e) { } // 描き直し時に薄い表示が残らないように
    try { syncEditRadios(); } catch (e) { }
    _gridSig = null; // 描いている途中で失敗した時に「描き終えた」と取り違えないよう、最後に付け直す
    setTimeout(() => { _gridSig = gridSignature(); }, 0);
    const mode = state.ui.viewMode;
    const keysAll = getAxisKeys(mode);
    const keys = keysAll.filter(rowMatchesFilter);
    const adays = activeDays();
    const maxP = adays.length ? Math.max(...adays.map(d => maxPeriod(d))) : 1;
    const lastDay = adays[adays.length - 1];
    let html = `<table class="timetable"><thead><tr><th>${mode === 'teacher' ? '教員' : mode === 'class' ? 'クラス' : '教室'}</th>`;
    for (const d of adays) {
      const sepCls = (d !== lastDay) ? ' day-sep' : '';
      html += `<th colspan="${maxPeriod(d)}" data-day="${d}" class="${sepCls.trim()}">${DAYJP[d]}</th>`;
    }
    html += `</tr><tr><th></th>`;
    for (const d of adays) {
      for (let p = 1; p <= maxPeriod(d); p++) {
        const isDaySep = (d !== lastDay) && (p === maxPeriod(d));
        html += `<th data-day="${d}" data-p="${p}" class="${isDaySep ? 'day-sep' : ''}">${p}</th>`;
      }
    }
    html += `</tr></thead><tbody>`;
    for (const key of keys) {
      const label = (mode === 'teacher') ? (state.teacherCfg[key]?.abbr || key) : key;
      const title = (mode === 'teacher') ? key : '';
      html += `<tr data-row="${escapeAttr(key)}"><th draggable="true" data-rowkey="${escapeAttr(key)}" title="${escapeAttr(title)}">${escapeHtml(label)}</th>`;
      for (const d of adays) {
        for (let p = 1; p <= maxPeriod(d); p++) {
          let forbid = false;
          if (mode === 'teacher') {
            forbid = isUnavailableForTeacher(key, d, p);
          }
          // クラスモード・教室モードでは教員不定のため、セル自体の禁則表示は行わない
          // (ドラッグ中のハイライト◎/×バッジで個別に判定される)
          const isDaySep = (d !== lastDay) && (p === maxPeriod(d));
          const cls = [forbid ? 'forbidden' : '', isDaySep ? 'day-sep' : ''].filter(Boolean).join(' ');
          html += `<td data-day="${d}" data-p="${p}" class="${cls}"></td>`;
        }
      }
      html += `</tr>`;
    }
    html += `</tbody></table>`;
    root.innerHTML = html;

    // v43: Delegated drag-and-drop on the grid root — most reliable approach
    // This catches ALL drops regardless of which child element is the target
    live.ondragover = (ev) => {
      const td = ev.target.closest('td[data-day][data-p]');
      if (!td) return;
      ev.preventDefault();
      ev.dataTransfer.dropEffect = 'move';
      // 同じマスの上にいる間は何もしない（ブラウザは止まっていてもこの合図を出し続けるので、毎回描き直すと重い）
      if (td.classList.contains('drop-hint')) return;
      // 既存のhint解除
      live.querySelectorAll('.drop-hint').forEach(el => el.classList.remove('drop-hint'));
      td.classList.add('drop-hint');
      // 列全体ハイライト（同じ曜日×時限の全行）
      const day = td.dataset.day, p = td.dataset.p;
      live.querySelectorAll('.col-drag-over').forEach(el => el.classList.remove('col-drag-over'));
      live.querySelectorAll(`td[data-day="${day}"][data-p="${p}"]`).forEach(el => el.classList.add('col-drag-over'));
    };
    live.ondragleave = (ev) => {
      // only clear if leaving the grid entirely
      if (!live.contains(ev.relatedTarget)) {
        live.querySelectorAll('.drop-hint').forEach(el => el.classList.remove('drop-hint'));
        live.querySelectorAll('.col-drag-over').forEach(el => el.classList.remove('col-drag-over'));
      }
    };
    // ドラッグをやめた時（Escで取り消した・表の外で離した）も、列の色付けを消す。以前は残ったままになった
    if (!live._dragEndBound) {
      live._dragEndBound = true;
      window.addEventListener('dragend', () => {
        live.querySelectorAll('.drop-hint').forEach(el => el.classList.remove('drop-hint'));
        live.querySelectorAll('.col-drag-over').forEach(el => el.classList.remove('col-drag-over'));
      });
    }
    live.ondrop = (ev) => {
      ev.preventDefault();
      live.querySelectorAll('.drop-hint').forEach(el => el.classList.remove('drop-hint'));
      live.querySelectorAll('.col-drag-over').forEach(el => el.classList.remove('col-drag-over'));
      const td = ev.target.closest('td[data-day][data-p]');
      if (!td) return;
      const dropId = ev.dataTransfer.getData('text/plain') || ev.dataTransfer.getData('id') || window._currentDragId;
      if (!dropId) return;
      if (state.ui.tool === 'erase') { flash('消すツール中'); return; }
      placeItem(dropId, td.dataset.day, parseInt(td.dataset.p, 10), { mode: state.ui.drop || 'safe' });
    };

    // row header actions (remember last, dblclick opens floating)
    for (const th of root.querySelectorAll('th[data-rowkey]')) {
      th.onclick = () => { state.ui.lastRow = { kind: mode, key: th.dataset.rowkey }; };
      th.ondblclick = () => { state.ui.lastRow = { kind: mode, key: th.dataset.rowkey }; openFloat(mode, th.dataset.rowkey); rerenderAll(); };
    }

    // fill cells
    const idx = buildIndex(); // for quick
    for (const tr of root.querySelectorAll('tbody tr')) {
      const rowKey = tr.dataset.row;
      for (const td of tr.querySelectorAll('td[data-day]')) {
        const day = td.dataset.day; const p = parseInt(td.dataset.p, 10);
        const ids = idsInCellForRow(mode, rowKey, day, p, idx);
        const stack = document.createElement('div');
        stack.className = 'cell-stack';
        // span fill
        for (const id of ids) {
          if (isSpanFill(id, day, p)) {
            // v32.4: show a continuation card for the 2nd period of a 2-span lesson
            td.classList.add('spanfill');
            const card = renderLessonCard(id, mode, rowKey, true); // true = continuation
            if (card) stack.appendChild(card);
          } else {
            const card = renderLessonCard(id, mode, rowKey, false);
            if (card) stack.appendChild(card);
          }
        }
        // v32.5: overflow badge - show warning when multiple items in same cell
        const realIds = ids.filter(x => !isSpanFill(x, day, p));
        if (realIds.length > 1 && rowKey !== '(未)') { // (未)行＝教員/教室が未設定の集まりなので重複警告しない
          // Check if ALL are parallel - if so, show info badge (blue), not error
          const allParallel = realIds.every(x => state.items[x]?.parallel);
          const names = realIds.map(x => { const s = state.subjectCfg[state.items[x]?.subjKey] || {}; return s.abbr || state.items[x]?.subj || x; }).join(', ');
          if (allParallel) {
            // v49: 並列グループを視覚的にまとめて表示
            stack.classList.add('parallel-stack');
            // 合同授業のサマリヘッダを挿入
            const it0 = state.items[realIds[0]];
            const sc0 = state.subjectCfg[it0?.subjKey] || {};
            const subjAbbr = sc0.abbr || it0?.subj || '';
            const allCls = [...new Set(realIds.flatMap(id => state.items[id]?.cls || []))];
            const allTea = [...new Set(realIds.flatMap(id => state.items[id]?.teas || []).map(t => state.teacherCfg[t]?.abbr || t))];
            const header = document.createElement('div');
            header.className = 'parallel-group-header';
            header.title = `合同授業: ${allCls.join('・')}（${names}）`;
            header.innerHTML = `<span class="pg-icon">⇉</span><span class="pg-label">${escapeHtml(subjAbbr.slice(0, 4))}</span><span class="pg-count">${realIds.length}cl</span>`;
            stack.insertBefore(header, stack.firstChild);
          } else {
            const badge = document.createElement('div');
            badge.className = 'cell-overflow-badge';
            badge.title = '重複: ' + `${realIds.length}コマ（${names}）`;
            badge.textContent = `⚠ ${realIds.length}重`;
            stack.appendChild(badge);
          }
        }
        td.innerHTML = '';
        td.appendChild(stack);

        // ★ cell-stack にもdragoverとdropを付与（カードがドロップイベントを吸収するのを防ぐ）
        stack.ondragover = (ev) => { ev.preventDefault(); ev.dataTransfer.dropEffect = 'move'; };
        stack.ondrop = (ev) => {
          ev.preventDefault();
          td.classList.remove('drop-hint');
          const dropId = ev.dataTransfer.getData('text/plain') || ev.dataTransfer.getData('id') || window._currentDragId;
          if (!dropId) return;
          if (state.ui.tool === 'erase') { flash('消すツール中'); return; }
          placeItem(dropId, day, p, { mode: state.ui.drop || 'safe' });
        };

        td.ondragover = (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          ev.dataTransfer.dropEffect = 'move';
          td.classList.add('drop-hint');
          // v48: ドラッグ中プレビュー（制約チェック結果をセルに表示）
          const dragId = window._currentDragId;
          if (dragId && dragId !== td._previewId) {
            td._previewId = dragId;
            td.classList.remove('drag-preview-ok', 'drag-preview-warn', 'drag-preview-ng');
            try {
              const v = validatePlacement(dragId, day, p, 'safe', null);
              if (v.blocks.length) {
                td.classList.add('drag-preview-ng');
                td.title = '✗ ' + v.blocks[0];
              } else if (v.warns.length) {
                td.classList.add('drag-preview-warn');
                td.title = '△ ' + v.warns[0];
              } else {
                td.classList.add('drag-preview-ok');
                td.title = '◎ 配置可';
              }
            } catch (e) { }
          }
        };
        td.ondragleave = () => {
          td.classList.remove('drop-hint', 'drag-preview-ok', 'drag-preview-warn', 'drag-preview-ng');
          td._previewId = null;
          td.title = '';
        };
        td.ondrop = (ev) => {
          try {
            ev.preventDefault();
            ev.stopPropagation();
            td.classList.remove('drop-hint');
            const id = ev.dataTransfer.getData('text/plain') || ev.dataTransfer.getData('id') || window._currentDragId;
            if (!id) return;
            if (state.ui.tool === 'erase') { flash('消すツール中'); return; }
            const dropMode = state.ui.drop || 'safe';
            placeItem(id, day, p, { mode: dropMode });
          } catch (e) {
            console.error('Error in ondrop:', e);
            flash('ドロップエラー: ' + e.message);
          }
        };

        td.oncontextmenu = (ev) => {
          ev.preventDefault();
          const any = ids.find(x => !isSpanFill(x, day, p));
          const menu = [];
          menu.push({ muted: true, label: `${DAYJP[day]}${p}` });
          if (any) {
            menu.push({ label: 'このコマを在庫へ', act: 'cell_to_stock', on: () => toStock(any) });
            menu.push({ label: 'このコマをロック/解除', act: 'cell_lock', on: () => toggleLock(any) });
            menu.push({ label: 'このコマの提案', act: 'cell_sug', on: () => openPropSuggestions(any) });
            menu.push({ label: '👤 担当の先生を変える', act: 'cell_reassign', on: () => openReassignDialog(any) });
            menu.push({ sep: true });
          }
          if (state.ui.selectedId) {
            menu.push({ label: '選択中コマをここへ移動', act: 'cell_move', on: () => placeItem(state.ui.selectedId, day, p, { mode: state.ui.drop }) });
            menu.push({ label: '選択解除', act: 'cell_clear', on: () => selectId(null, 'grid') });
          } else {
            menu.push({ label: '(コマを選択すると移動/提案ができます)', muted: true });
          }
          showCtxMenu(menu, ev.clientX, ev.clientY);
        };
        // v63.4: 空きセルのダブルクリックで「ここに来れるコマ」の提案を表示
        td.ondblclick = (ev) => {
          const realIds = ids.filter(x => !isSpanFill(x, day, p));
          if (realIds.length > 0) return; // コマがあるセルはカード側のdblclickで処理される
          ev.preventDefault();
          openSlotSuggestions(day, p);
        };
        td.onclick = () => {
          // tools
          if (state.ui.tool === 'erase') {
            const sid = state.ui.selectedId;
            if (sid && idCoversCell(sid, day, p)) toStock(sid);
            else {
              // if any lesson present, send top one to stock
              const any = ids.find(x => !isSpanFill(x, day, p));
              if (any) toStock(any);
            }
            return;
          }
          if (state.ui.tool === 'lock') {
            const any = ids.find(x => !isSpanFill(x, day, p));
            if (any) toggleLock(any);
            return;
          }
          // move
          if (state.ui.selectedId) {
            placeItem(state.ui.selectedId, day, p, { mode: state.ui.drop });
          } else {
            // select if exists
            const any = ids.find(x => !isSpanFill(x, day, p));
            if (any) selectId(any, 'grid');
          }
        };
      }
    }

    // row header drag for reordering (teacher manual)
    root.querySelectorAll('tbody th[draggable="true"]').forEach(th => {
      th.ondragstart = (ev) => {
        ev.dataTransfer.setData('rowkey', th.dataset.rowkey);
        ev.dataTransfer.effectAllowed = 'move';
      };
      th.ondblclick = (ev) => { ev.preventDefault(); openFloat(state.ui.viewMode, th.dataset.rowkey); };
      th.ondragover = (ev) => { if (state.ui.viewMode === 'teacher' && state.ui.teacherSort === 'manual') ev.preventDefault(); };
      th.oncontextmenu = (ev) => {
        ev.preventDefault();
        const k = th.dataset.rowkey;
        const menu = [];
        menu.push({ label: 'この行をフロート表示', on: () => openFloat(state.ui.viewMode, k) });
        menu.push({ sep: true });
        menu.push({ label: '並び替え(ドラッグ)の説明', muted: true });
        showCtxMenu(menu, ev.clientX, ev.clientY);
      };
      th.ondrop = (ev) => {
        if (!(state.ui.viewMode === 'teacher' && state.ui.teacherSort === 'manual')) return;
        ev.preventDefault();
        const from = ev.dataTransfer.getData('rowkey');
        const to = th.dataset.rowkey;
        if (!from || !to || from === to) return;
        pushHistory('teaOrder');
        const ord = Array.isArray(state.ui.teacherOrder) ? state.ui.teacherOrder.slice() : getAxisKeys('teacher');
        const a = ord.filter(x => x !== from);
        const idx = a.indexOf(to);
        a.splice(Math.max(idx, 0), 0, from);
        state.ui.teacherOrder = a;
        markDirty('ui');
        renderGrid();
        broadcastState();
      };
    });

    // v41: ヒートマップ再適用
    if (typeof _heatmapActive !== 'undefined' && _heatmapActive) requestAnimationFrame(() => { try { applyHeatmap(); } catch (e) { } });

    // ── 列リサイズ (Excelライク) ──
    _initColResize(root);
    commitGrid(live, root);
  }

  // 組み立てた表を画面に反映する。見出しと行の並びが前と同じなら、中身が変わった行だけ差し替える
  let __fitOnly = null;
  function commitGrid(live, stage) {
    const newT = stage.querySelector('table.timetable'); const oldT = live.querySelector(':scope > table.timetable');
    const sigOf = (el) => el ? el.outerHTML : '';
    if (newT) {
      newT.__headSig = sigOf(newT.tHead) + sigOf(newT.querySelector('colgroup'));
      for (const tr of newT.tBodies[0].rows) tr.__sig = tr.outerHTML;
    }
    let morphed = false;
    try {
      if (newT && oldT && oldT.__headSig === newT.__headSig) {
        const o = [...oldT.tBodies[0].rows], n = [...newT.tBodies[0].rows];
        if (o.length === n.length && o.every((tr, i) => tr.dataset.row === n[i].dataset.row)) {
          const changed = [];
          for (let i = 0; i < n.length; i++) if (o[i].__sig !== n[i].__sig) { o[i].replaceWith(n[i]); changed.push(n[i]); }
          __fitOnly = changed; // 文字の大きさの測り直しも、差し替えた行だけでよい
          morphed = true;
        }
      }
    } catch (e) { morphed = false; }
    if (!morphed) { __fitOnly = null; live.replaceChildren(...stage.childNodes); }
    // 残した行に付いている選択の印などを、今の状態に合わせ直す
    try { updateGridSelection(); } catch (e) { }
    if (morphed && !__fitOnly.length) __fitOnly = null;
  }

  function _initColResize(root) {
    const table = root.querySelector('table.timetable');
    if (!table) return;

    // 2行目のヘッダ（曜日×時限）にリサイズハンドルを注入
    const headerRow2 = table.querySelectorAll('thead tr')[1];
    if (!headerRow2) return;

    // col幅の状態を保持
    state.ui.colWidths = state.ui.colWidths || {};

    // 保存済み幅を適用
    const allCols = table.querySelectorAll('col');
    // colgroup がなければ作成
    let colgroup = table.querySelector('colgroup');
    if (!colgroup) {
      colgroup = document.createElement('colgroup');
      // 先頭(行ラベル列)
      const c0 = document.createElement('col');
      c0.dataset.colkey = '_row';
      if (state.ui.colWidths['_row']) c0.style.width = state.ui.colWidths['_row'] + 'px';
      colgroup.appendChild(c0);
      // 各曜日×時限
      const days = [...table.querySelectorAll('thead tr:first-child th')];
      days.shift(); // skip first (row label)
      for (const th of table.querySelectorAll('thead tr:nth-child(2) th')) {
        const c = document.createElement('col');
        const key = (th.dataset.day || '') + (th.dataset.p || th.textContent.trim());
        c.dataset.colkey = key;
        if (th.dataset.day) c.dataset.day = th.dataset.day; // スマホ表示で曜日ごとに列を隠すため
        if (state.ui.colWidths[key]) c.style.width = state.ui.colWidths[key] + 'px';
        colgroup.appendChild(c);
      }
      table.insertBefore(colgroup, table.firstChild);
    }

    // ヘッダ各thにリサイズハンドルを追加
    const thList = [...headerRow2.querySelectorAll('th')];
    thList.forEach((th, i) => {
      th.style.position = 'relative';
      th.style.userSelect = 'none';
      if (th.querySelector('.col-resize-handle')) return; // 重複防止
      const handle = document.createElement('div');
      handle.className = 'col-resize-handle';
      handle.title = 'ドラッグで列幅変更';
      th.appendChild(handle);

      let startX, startW;
      handle.addEventListener('mousedown', ev => {
        ev.preventDefault();
        ev.stopPropagation();
        startX = ev.clientX;
        // 現在の列幅を取得
        const col = colgroup.children[i + 1]; // +1 for row col
        startW = col ? (parseInt(col.style.width) || th.offsetWidth) : th.offsetWidth;

        const onMove = e => {
          const diff = e.clientX - startX;
          const newW = Math.max(32, startW + diff);
          if (col) col.style.width = newW + 'px';
          const key = col?.dataset.colkey || String(i);
          state.ui.colWidths[key] = newW;
        };
        const onUp = () => {
          markDirty('ui');
          window.removeEventListener('mousemove', onMove);
          window.removeEventListener('mouseup', onUp);
          document.body.style.cursor = '';
        };
        document.body.style.cursor = 'col-resize';
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
      });
    });
  }

  function idsInCellForRow(mode, rowKey, day, p, idx) {
    const out = [];
    if (mode === 'teacher') {
      const ids = idx.tea?.[rowKey]?.[day]?.[p] || [];
      ids.forEach(id => out.push(id));
    } else if (mode === 'class') {
      const ids = idx.cls?.[rowKey]?.[day]?.[p] || [];
      ids.forEach(id => out.push(id));
    } else if (mode === 'room') {
      const ids = idx.room?.[rowKey]?.[day]?.[p] || [];
      ids.forEach(id => out.push(id));
    }
    return uniq(out);
  }


  function violationSummary(id) {
    const it = state.items[id]; const plc = state.placements[id];
    if (!it || !plc) return '';
    const idx = buildIndex();
    const msgs = [];
    for (let dp = 0; dp < (it.span || 1); dp++) {
      const day = plc.day; const p = plc.period + dp;
      // teacher conflicts
      for (const t of it.teas) {
        const arr = (idx.tea?.[t]?.[day]?.[p] || []).filter(x => x !== id);
        if (arr.length) msgs.push(`教員重複:${t}(${DAYJP[day]}${p})`);
      }
      // class conflicts
      for (const c of it.cls) {
        const arr = (idx.cls?.[c]?.[day]?.[p] || []).filter(x => x !== id);
        if (arr.length) msgs.push(`クラス重複:${c}(${DAYJP[day]}${p})`);
      }
      // room conflicts (only if room is set)
      for (const r of it.rooms || []) {
        const arr = (idx.room?.[r]?.[day]?.[p] || []).filter(x => x !== id);
        if (arr.length) msgs.push(`教室重複:${r}(${DAYJP[day]}${p})`);
      }
      // teacher unavailable
      if (state.ui.viewMode === 'teacher') { /* not needed */ }
      for (const t of it.teas) {
        if (isUnavailableForTeacher(t, day, p)) msgs.push(`教員不可:${t}(${DAYJP[day]}${p})`);
      }
    }
    // daily same subject ban (if enabled)
    if (state.settings?.noSameSubjectPerDay) {
      for (const c of it.cls) {
        const maxP = maxPeriod(plc.day);
        let cnt = 0;
        for (let pp = 1; pp <= maxP; pp++) {
          const ids = (idx.cls?.[c]?.[plc.day]?.[pp] || []);
          ids.forEach(x => { if (x !== id && state.items[x]?.subjKey === it.subjKey) cnt++; });
        }
        if (cnt) msgs.push(`同日同科目:${c}`);
      }
    }
    return uniq(msgs).slice(0, 6).join(' / ');
  }

  // 【UI】コマ表示用の短い科目名。略称が未設定/長すぎる場合に自動で短縮する。
  function displayAbbr(it, scfg) {
    let a = String((scfg && scfg.abbr) || it.subj || it.subjKey || '').trim();
    const MAP = { '総合的な探究の時間': '総探', '総合的な学習の時間': '総学', 'ロングホームルーム': 'LHR', 'ホームルーム': 'HR' };
    if (MAP[a]) return MAP[a];
    a = a.replace(/[（(]([^）)]*)[）)]/g, '$1'); // 自選(月) → 自選月
    a = a.replace(/[Ａ-Ｚａ-ｚ０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
    if (a.length > 5 && !(scfg && scfg.abbr && scfg.abbr.length <= 5)) a = a.slice(0, 4);
    return a;
  }
  // 【UI】合同クラスの表記を圧縮（3クラス以上は「1-8 他2」）
  function compactClsLabel(cls) {
    const a = (cls || []).filter(Boolean);
    if (a.length >= 3) return a[0] + ' 他' + (a.length - 1);
    if (a.length === 2) {
      // 同じ学年なら「2-7,2-8」→「2-7,8」と短縮（狭いコマで上の行が切れるのを防ぐ）
      const m0 = a[0].match(/^(\d+-)(.+)$/), m1 = a[1].match(/^(\d+-)(.+)$/);
      if (m0 && m1 && m0[1] === m1[1]) return a[0] + ',' + m1[2];
    }
    return a.join(',');
  }
  // 【UI】連動グループ: 一緒に動く／同時に開講されるコマ
  //   同一コマ(合同で複数行に出る) / 並列設定コマ / 同時展開(自選等)ブロックの同時限コマ
  // 選択中コマの連動グループは、表を1回描く間に何千回も聞かれるので覚えておく（以前は毎回全コマを調べ直していた）
  let _selLinkedKey = null, _selLinkedSet = null;
  function selLinkedIds(id) {
    const p = state.placements[id];
    const key = id + '|' + (p ? p.day + p.period : '') + '|' + Object.keys(state.items).length;
    if (_selLinkedKey !== key || !_selLinkedSet) { _selLinkedKey = key; _selLinkedSet = linkedGroupIds(id); }
    return _selLinkedSet;
  }
  // コマを選んだ・選択を外した時は、表を作り直さず「選択の印」だけを付け替える。
  // （以前は選ぶたびに表全体を作り直し、全コマの文字の大きさを測り直していて、0.5秒ほど固まっていた）
  function updateGridSelection() {
    const root = document.getElementById('grid');
    if (!root || !root.querySelector('.timetable')) return false;
    root.querySelectorAll('.lesson.sel, .lesson.linked-hl, .lesson.linked-root').forEach(el => el.classList.remove('sel', 'linked-hl', 'linked-root'));
    root.querySelectorAll('.valid-slot, .invalid-slot, .swap-slot, .hard-slot').forEach(el => el.classList.remove('valid-slot', 'invalid-slot', 'swap-slot', 'hard-slot'));
    root.querySelectorAll('.slot-grade-badge').forEach(el => el.remove());
    const sid = state.ui.selectedId;
    if (!sid || !state.items[sid]) return true;
    _selLinkedKey = null;
    const group = selLinkedIds(sid);
    const it = state.items[sid];
    const isRoot = group.size > 1 || (it.cls || []).length > 1;
    const esc = (v) => (window.CSS && CSS.escape) ? CSS.escape(v) : String(v).replace(/"/g, '\\"');
    for (const gid of group) {
      root.querySelectorAll(`.lesson[data-id="${esc(gid)}"]`).forEach(el => {
        if (gid === sid) { el.classList.add('sel'); if (isRoot && !el.classList.contains('span-cont')) el.classList.add('linked-root'); }
        else if (!el.classList.contains('span-cont')) el.classList.add('linked-hl');
      });
    }
    return true;
  }
  function linkedGroupIds(id) {
    const it = state.items[id]; const plc = state.placements[id];
    const out = new Set([id]);
    if (!it || !plc || !plc.day) return out;
    for (const oid in state.items) {
      if (oid === id) continue;
      const o = state.items[oid]; const op = state.placements[oid];
      if (!o || !op || op.day !== plc.day || op.period !== plc.period) continue;
      if ((it.parallel && o.parallel) || (it.simul && o.simul && o.subj === it.subj)) out.add(oid);
    }
    return out;
  }
  function linkKindChips(it) {
    const chips = [];
    if ((it.cls || []).length > 1) chips.push(['合', 'c-gou', '合同授業: ' + it.cls.join(',')]);
    if (it.simul) chips.push(['同', 'c-simul', '同時展開' + (it.realSubj ? '：' + it.realSubj : '')]);
    if (it.parallel) chips.push(['並', 'c-par', '並列（同時に開講）']);
    return chips;
  }

  function renderLessonCard(id, mode, rowKey, isCont = false) {
    const it = state.items[id];
    const plc = state.placements[id];
    if (!it || !plc) return null;

    const scfg = state.subjectCfg[it.subjKey] || {};
    const color = getItemDisplayColor(id);
    const abbr = displayAbbr(it, scfg);

    const teaLabel = (it.teas||[]).map(t => state.teacherCfg[t]?.abbr || normalizeAbbr(t, 12) || t).join(',');
    const clsLabel = (it.cls||[]).join(',');
    const roomLabel = (it.rooms||[]).join(',');

    // Continuation card (2nd period of 2-span lesson)
    if (isCont) {
      const el = document.createElement('div');
      el.className = 'lesson span-cont' + (plc.locked ? ' locked' : '') + (state.ui.selectedId === id ? ' sel' : '');
      el.dataset.id = id;
      el.draggable = true;
      el.classList.add(mode === 'teacher' ? 'mode-teacher' : mode === 'class' ? 'mode-class' : 'mode-room');
      const contLabel = (mode === 'teacher' || mode === 'room') ? compactClsLabel(it.cls) : (abbr || '');
      const contHtml = escapeHtml(contLabel);
      // 【B-3/B-4】2連の2コマ目も淡背景＋色帯にし、科目名を表示（従来は「↓」だけで薄かった）
      applyLessonBg(el, it, color);
      el.style.color = '#0f172a';
      el.style.borderLeft = '4px solid ' + color;
      el.innerHTML = `<div class="l1"><div class="subj">${contHtml}</div></div>`;
      el.ondragstart = (ev) => {
        window._currentDragId = id;
        window._dragPending = true;
        ev.dataTransfer.setData('text/plain', id);
        try { ev.dataTransfer.setData('id', id); } catch { }
        ev.dataTransfer.effectAllowed = 'move';
      };
      el.ondragend = () => {
        window._dragPending = false;
        setTimeout(() => { if (!window._dragPending) window._currentDragId = null; }, 100);
      };
      el.onclick = (ev) => { ev.stopPropagation(); selectId(id, 'grid'); };
      el.ondblclick = (ev) => { ev.stopPropagation(); openPropSuggestions(id); };
      el.onmouseenter = (ev) => { try { showHoverTip(itemDetailText(id), ev.clientX, ev.clientY); } catch { } };
      el.onmousemove = (ev) => { try { showHoverTip(itemDetailText(id), ev.clientX, ev.clientY); } catch { } };
      el.onmouseleave = () => hideHoverTip();
      return el;
    }

    // Normal display rules
    let mainText = abbr;
    let subText = '';
    let footText = '';
    let showSecondRow = false;

    if (mode === 'teacher') {
      // Teacher axis: show class on 1st row, subject on 2nd row (readable)
      mainText = (it.cls && it.cls.length) ? compactClsLabel(it.cls) : '(未)';
      subText = ''; // avoid tiny right label
      showSecondRow = true;
      footText = (abbr || it.subjKey || it.subj || '').toString();
    } else if (mode === 'class') {
      mainText = abbr || it.subjKey || '(未)';
      // クラス窓：教員名を2行目に表示
      if (teaLabel) { footText = teaLabel; showSecondRow = true; }
    } else if (mode === 'room') {
      // 教室窓: クラス名（全体表示）+ 科目略称 + 教員略称
      mainText = (it.cls && it.cls.length) ? compactClsLabel(it.cls) : '(未)';
      subText = abbr;
      footText = teaLabel;
      showSecondRow = !!(footText);
    }

    const el = document.createElement('div');
    el.className = 'lesson' + (plc.locked ? ' locked' : '') + (state.ui.selectedId === id ? ' sel' : '');
    let vio = '';
    try { vio = violationSummary(id) || ''; } catch (e) { vio = ''; }
    if (vio) el.classList.add('violate');
    // v47-B4: スナップ差分ハイライト
    try {
      const diffCls = getSnapDiffForId(id);
      if (diffCls) el.classList.add(diffCls);
    } catch (e) { }
    el.draggable = true;
    el.dataset.id = id;
    el.classList.add(mode === 'teacher' ? 'mode-teacher' : mode === 'class' ? 'mode-class' : 'mode-room');
    // 【UI】選択中コマの連動グループ（合同の別行表示・並列・同時展開）を常時強調
    try { const sid = state.ui.selectedId; if (sid && sid !== id && selLinkedIds(sid).has(id)) el.classList.add('linked-hl'); if (sid === id && (selLinkedIds(id).size > 1 || (it.cls || []).length > 1)) el.classList.add('linked-root'); } catch (e) { }
    // el.title removed: browser tooltip suppressed (custom hover-tip used instead)
    // 【B-3】淡い背景＋濃い文字＋左端の色帯（科目色分けは色帯で維持、文字はコントラスト比4.5以上）
    applyLessonBg(el, it, color);
    el.style.color = '#0f172a';
    el.style.borderLeft = '4px solid ' + color;

    // 【1】クラス名・教員名は1つずつ折り返し禁止の単位にし、カンマの後だけで改行させる
    const nbJoin = (txt) => String(txt || '').split(',').map(s => `<span class="nb">${escapeHtml(s)}</span>`).join(',<wbr>');
    el.innerHTML = `
    <div class="l1">
      <div class="subj${String(mainText).length >= 3 ? ' long' : ''}${String(mainText).length >= 5 ? ' xlong' : ''}${String(mainText).length >= 7 ? ' xxlong' : ''}">${escapeHtml(mainText)}</div>
      ${(mode === 'room' || mode === 'teacher') && subText ? `<div class="rightlab">${escapeHtml(mode === 'room' ? subText.slice(0, 6) : subText.slice(0, 4))}</div>` : ``}
    </div>
    <div class="lchips">
      ${linkKindChips(it).map(([t, c, tip]) => `<span class="lchip ${c}" title="${escapeAttr(tip)}">${t}</span>`).join('')}
      ${(it.span || 1) >= 2 ? `<span class="lchip c-span" title="${it.span}コマ連続">${it.span}</span>` : ''}
      ${vio ? '<span class="lchip c-vio" title="' + escapeAttr(vio) + '">!</span>' : ''}
    </div>
    ${showSecondRow ? `
      <div class="l2">
        <div class="teacher">${mode === 'class' ? nbJoin(footText) : escapeHtml(footText || '')}</div>
        ${mode === 'teacher' && roomLabel ? `<div class="roommini">${escapeHtml(roomLabel)}</div>` : ''}
      </div>
    ` : ``}
  `;

    el.ondragstart = (ev) => {
      window._currentDragId = id;
      window._dragPending = true;
      ev.dataTransfer.setData('text/plain', id);
      try { ev.dataTransfer.setData('id', id); } catch { }
      ev.dataTransfer.effectAllowed = 'move';
      setTimeout(() => highlightValidSlots(id), 0);
    };
    el.ondragend = () => {
      window._dragPending = false;
      // 遅延クリア: drop が先に完了する場合がある（Firefox等）
      setTimeout(() => { if (!window._dragPending) window._currentDragId = null; }, 100);
    };
    el.ondragover = (ev) => { ev.preventDefault(); ev.dataTransfer.dropEffect = 'move'; };
    el.ondrop = (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      const dropId = ev.dataTransfer.getData('text/plain') || ev.dataTransfer.getData('id') || window._currentDragId;
      if (!dropId || dropId === id) return;
      // drop onto a card - get the td parent and place there
      const tdEl = ev.target.closest('td[data-day]');
      if (tdEl) { const dday = tdEl.dataset.day; const dp = parseInt(tdEl.dataset.p, 10); if (dday && dp) placeItem(dropId, dday, dp, { mode: state.ui.drop || 'safe' }); }
    };
    el.onclick = (ev) => {
      ev.stopPropagation();
      if (ev.ctrlKey || ev.metaKey) {
        const sel = state.ui.gridMultiSel = state.ui.gridMultiSel || new Set();
        if (sel.has(id)) { sel.delete(id); el.classList.remove('grid-multi-sel'); }
        else { sel.add(id); el.classList.add('grid-multi-sel'); }
        _updateGridMultiBar();
      } else {
        selectId(id, 'grid');
      }
    };
    el.ondblclick = (ev) => { ev.stopPropagation(); openPropSuggestions(id); };

    el.oncontextmenu = (ev) => {
      ev.preventDefault();
      const menu = [
        { muted: true, label: `${abbr || it.subjKey}` },
        { label: '在庫へ', act: 'to_stock', on: () => toStock(id) },
        { label: (plc.locked ? 'ロック解除' : 'ロック'), act: 'lock', on: () => toggleLock(id) },
        { label: '配置/移動の提案', act: 'sug', on: () => openPropSuggestions(id) },
        { label: '👤 担当の先生を変える', act: 'reassign', on: () => openReassignDialog(id) },
        { label: 'コピー（複製）', act: 'copy', on: () => copyItem(id) },
        { sep: true },
        { label: 'Ctrl+クリックで複数選択', muted: true },
        { label: '選択', act: 'sel', on: () => selectId(id, 'grid') }
      ];
      showCtxMenu(menu, ev.clientX, ev.clientY);
    };

    el.onmouseenter = (ev) => {
      try { showHoverTip(itemDetailText(id), ev.clientX, ev.clientY); } catch { }
      // v49 B-3: 関連コマをハイライト（同教員・同クラス）
      try { highlightRelated(id, true); } catch { }
    };
    el.onmousemove = (ev) => { try { showHoverTip(itemDetailText(id), ev.clientX, ev.clientY); } catch { } };
    el.onmouseleave = () => {
      hideHoverTip();
      try { highlightRelated(id, false); } catch { }
    };

    return el;
  }

  // v49 B-3: 関連コマ (同教員・同クラス) のハイライト
  // コマにカーソルを合わせた時の関連表示（それ以外は薄く表示して関連だけが目立つようにする）
  //   紫=同じコマ（別の行に出ている同じ授業・合同・同時展開）
  //   クラス表示では 橙=同じ先生の授業、教員表示では 青=同じクラスの授業 を濃く表示する
  const HOVER_CLASSES = ['hl-linked', 'hl-samesubj', 'hl-tea', 'hl-cls', 'related-highlight', 'linked-hover'];
  let _hlTimer = null, _hlActive = null;
  function highlightRelated(id, on) {
    clearTimeout(_hlTimer);
    if (!on) {
      // 隣のコマへ移るときにチラつかないよう、外す処理は少し待つ
      _hlTimer = setTimeout(() => { if (_hlActive === id) clearRelatedHighlight(); }, 60);
      return;
    }
    if (document.body.classList.contains('dragging') || state.ui.selectedId) { clearRelatedHighlight(); return; }
    _hlTimer = setTimeout(() => applyRelatedHighlight(id), 90); // 素早くなぞった時は描き直さない
  }
  // スマホ・タブレット: コマを長押しすると関連表示（カーソルを合わせる操作の代わり）。
  // 次にどこかをタップすると消える。長押しで右クリックメニューが出ないようにする
  (function initLongPressHighlight() {
    let timer = null, startX = 0, startY = 0, shownAt = 0, touchAt = 0;
    const start = () => {
      document.addEventListener('touchstart', (e) => {
        touchAt = Date.now();
        if (shownAt && Date.now() - shownAt > 300) { clearRelatedHighlight(); shownAt = 0; }
        const card = e.target.closest && e.target.closest('.timetable .lesson[data-id]');
        clearTimeout(timer); if (!card || e.touches.length !== 1) return;
        startX = e.touches[0].clientX; startY = e.touches[0].clientY;
        timer = setTimeout(() => { applyRelatedHighlight(card.dataset.id); shownAt = Date.now(); try { navigator.vibrate && navigator.vibrate(15); } catch (er) { } }, 450);
      }, { passive: true });
      document.addEventListener('touchmove', (e) => {
        const t = e.touches[0]; if (!t) return;
        if (Math.abs(t.clientX - startX) > 10 || Math.abs(t.clientY - startY) > 10) clearTimeout(timer); // スクロールなら取り消す
      }, { passive: true });
      document.addEventListener('touchend', () => {
        clearTimeout(timer);
        // 長押しで関連表示を出した直後の指離しは「タップ（選択）」として扱わない
        if (shownAt && Date.now() - shownAt < 2000) {
          const kill = (ev) => { ev.preventDefault(); ev.stopPropagation(); };
          document.addEventListener('click', kill, { capture: true, once: true });
          setTimeout(() => document.removeEventListener('click', kill, true), 600);
        }
      }, { passive: true });
      // 長押しで出る右クリックメニュー（ブラウザ・アプリ両方）を抑える
      document.addEventListener('contextmenu', (e) => {
        if (Date.now() - touchAt < 1200 && e.target.closest && e.target.closest('.lesson[data-id]')) { e.preventDefault(); e.stopPropagation(); }
      }, true);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  })();
  function clearRelatedHighlight() {
    _hlActive = null;
    document.body.classList.remove('hl-on');
    document.querySelectorAll('.' + HOVER_CLASSES.join(',.')).forEach(el => el.classList.remove(...HOVER_CLASSES));
    const st = document.getElementById('status-left');
    if (st && st.dataset.hlPrev != null) { st.textContent = st.dataset.hlPrev; delete st.dataset.hlPrev; }
  }
  function applyRelatedHighlight(id) {
    const it = state.items[id]; if (!it) return;
    clearRelatedHighlight();
    _hlActive = id;
    const teaSet = new Set(it.teas || []), clsSet = new Set(it.cls || []);
    const linked = linkedGroupIds(id);
    // 表示ごとに濃く見せるもの: クラス表示=同じコマ＋同じ先生 / 教員表示=同じコマ＋同じクラス / 教室表示=両方
    const mode = state.ui.viewMode;
    const showTea = mode !== 'teacher', showCls = mode !== 'class';
    const kindOf = (eid) => {
      if (eid === id || linked.has(eid)) return 'hl-linked';
      const o = state.items[eid]; if (!o) return null;
      if (showTea && (o.teas || []).some(t => teaSet.has(t))) return 'hl-tea';
      if (showCls && (o.cls || []).some(c => clsSet.has(c))) return 'hl-cls';
      return null;
    };
    const cnt = { tea: new Set(), cls: new Set() };
    for (const eid in state.items) {
      if (eid === id || !state.placements[eid]?.day) continue;
      const k = kindOf(eid);
      if (k === 'hl-tea') cnt.tea.add(eid); else if (k === 'hl-cls') cnt.cls.add(eid);
    }
    document.body.classList.add('hl-on');
    document.querySelectorAll('.lesson[data-id], .stock-item[data-id]').forEach(el => {
      const k = kindOf(el.dataset.id);
      if (k && !(el.dataset.id === id && el.matches(':hover'))) el.classList.add(k);
    });
    // 件数を画面下に表示（離れたら元に戻す）
    const st = document.getElementById('status-left');
    if (st) {
      if (st.dataset.hlPrev == null) st.dataset.hlPrev = st.textContent;
      const parts = [];
      if (showTea) parts.push(`🟧 同じ先生（${(it.teas || []).join('・') || '未設定'}）の授業 ${cnt.tea.size}コマ`);
      if (showCls) parts.push(`🟦 同じクラス（${(it.cls || []).join('・') || '未設定'}）の授業 ${cnt.cls.size}コマ`);
      st.textContent = parts.join('　');
    }
  }

  function selectId(id, from) {
    if (!id) clearValidSlots();  // Fix: clear arrows when deselecting
    state.ui.selectedId = id || null;
    state.ui.selectedFrom = from;
    renderProp();
    // 表は作り直さず、選択の印だけ付け替える（表がまだ無い時だけ作る）
    let fast = false;
    try { clearRelatedHighlight(); fast = updateGridSelection(); } catch (e) { fast = false; }
    if (!fast) renderGrid();
    renderStock();

    // Show/hide quick action bar (v34.4)
    renderQuickActionBar();
    // F6: constraint overlay if active
    try { if (state.ui.constraintOverlay) applyConstraintOverlay(); } catch (e) {}
  }

  /* =======================
     Quick Action Bar (v34.4)
  ======================= */
  function renderQuickActionBar() {
    let bar = document.getElementById('quick-action-bar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'quick-action-bar';
      document.body.appendChild(bar);
    }

    const id = state.ui.selectedId;
    document.body.classList.toggle('qab-on', !!(id && state.items[id]));
    if (!id) {
      bar.classList.remove('show');
      return;
    }

    const it = state.items[id];
    if (!it) {
      bar.classList.remove('show');
      return;
    }

    const plc = state.placements[id];
    const scfg = state.subjectCfg[it.subjKey] || {};
    const abbr = (scfg.abbr || it.subj || '').slice(0, 6);
    const color = scfg.color || pickColor(it.subjKey);
    const cls = it.cls.join(',').slice(0, 12);
    const plcText = plc ? `${DAYJP[plc.day]}${plc.period}` : '未配置';

    bar.innerHTML = `
    <div class="qab-info">
      <div class="qab-chip" style="background:${color};color:${isDark(color) ? '#fff' : '#0f172a'}">${escapeHtml(abbr)}</div>
      <div class="qab-details">
        <div class="qab-cls">${escapeHtml(cls)}</div>
        <div class="qab-plc">${escapeHtml(plcText)}</div>
      </div>
    </div>
    <div class="qab-actions">
      ${!plc?.day ? `<button class="qab-btn qab-autoplace" title="最適な空き枠に即配置 (Space)">⚡ 即配置</button>` : ''}
      <button class="qab-btn qab-suggest" title="提案を開く (S)">💡 提案</button>
      <button class="qab-btn qab-lock" title="ロック/解除 (L)">${plc ? (plc.locked ? '🔓' : '🔒') : ''} ${plc ? (plc.locked ? '解除' : 'ロック') : 'ロック'}</button>
      ${plc?.day ? `<button class="qab-btn qab-stock" title="在庫へ (Del)">📦 在庫へ</button>` : ''}
      <button class="qab-btn qab-close" title="選択解除 (Esc)">✕</button>
    </div>
  `;

    bar.classList.add('show');

    // Bind actions
    if (bar.querySelector('.qab-autoplace')) {
      bar.querySelector('.qab-autoplace').onclick = () => quickAutoPlace(id);
    }
    bar.querySelector('.qab-suggest').onclick = () => openPropSuggestions(id);
    bar.querySelector('.qab-lock').onclick = () => { if (plc) toggleLock(id); else showToast('未配置のコマはロックできません', 'warning'); };
    const stockBtn = bar.querySelector('.qab-stock');
    if (stockBtn) stockBtn.onclick = () => toStock(id);
    bar.querySelector('.qab-close').onclick = () => { selectId(null, ''); };
  }

  /* =======================
     Valid slot highlighting (drag/select)
  ======================= */
  function highlightValidSlots(id) {
    clearValidSlots();
    const st = (window.state || state);
    const it = st.items[id]; if (!it) return;
    const saved = st.placements[id]; st.placements[id] = null; invalidateIndex();
    const mode = st.ui.viewMode;
    const tdList = [];
    try {
      const root = document.getElementById('grid');
      root && root.querySelectorAll('tbody tr[data-row]').forEach(tr => {
        if (isRelevantRowByMode(tr, it, mode)) {
          tr.querySelectorAll('td[data-day][data-p]').forEach(td => tdList.push(td));
        }
      });
    } catch (e) { }
    try {
      document.querySelectorAll('.float-win').forEach(win => {
        const kind = win.getAttribute('data-kind'); const key = win.getAttribute('data-key');
        if ((mode === 'teacher' && kind !== 'teacher') || (mode === 'class' && kind !== 'class') || (mode === 'room' && kind !== 'room')) return;
        if (mode === 'teacher') { let ok = false; for (const t of (it.teas || [])) { if (teacherCandidates(t).includes(normalizeKey(key))) { ok = true; break; } } if (!ok) return; }
        else if (mode === 'class') { let ok = false; for (const c of (it.cls || [])) { if (classCandidates(c).includes(normalizeKey(key))) { ok = true; break; } } if (!ok) return; }
        else if (mode === 'room') { let ok = false; for (const r of (it.rooms || [])) { if (roomCandidates(r).includes(normalizeKey(key))) { ok = true; break; } } if (!ok) return; }
        const grid = win.querySelector('.float-grid'); if (!grid) return;
        grid.querySelectorAll('td[data-day][data-p]').forEach(td => tdList.push(td));
      });
    } catch (e) { }
    if (!tdList.length) { st.placements[id] = saved; invalidateIndex(); return; }
    const idx = buildIndex(); const span = it.span || 1;
    for (const td of tdList) {
      const day = td.dataset.day; const p = parseInt(td.dataset.p, 10);
      const v = validatePlacement(id, day, p, 'safe', null);
      let grade, label;
      if (v.blocks.length === 0) {
        let occ = false;
        for (let d = 0; d < span; d++) {
          const pp = p + d; if (pp < 1) continue;
          for (const t of (it.teas || [])) { if ((idx.tea?.[t]?.[day]?.[pp] || []).length) { occ = true; break; } }
          for (const c of (it.cls || [])) { if ((idx.cls?.[c]?.[day]?.[pp] || []).length) { occ = true; break; } }
        }
        if (occ) { grade = 'swap-slot'; label = '○'; } else { grade = 'valid-slot'; label = '◎'; }
      } else {
        const hard = v.blocks.some(isAbsoluteBlockMsg);
        if (hard) { grade = 'invalid-slot'; label = '×'; } else { grade = 'hard-slot'; label = '△'; }
      }
      td.classList.add(grade);
      const badge = document.createElement('div'); badge.className = 'slot-grade-badge ' + (label === '◎' ? 'grade-maru' : label === '○' ? 'grade-swap' : label === '△' ? 'grade-hard' : 'grade-ng');
      badge.textContent = label; badge.style.cssText = 'position:absolute;top:3px;right:4px;font-size:13px;font-weight:900;pointer-events:none;z-index:10;line-height:1';
      td.style.position = 'relative'; td.appendChild(badge);
    }
    st.placements[id] = saved; invalidateIndex();
    const clear = () => { clearValidSlots(); window.removeEventListener('dragend', clear); };
    window.addEventListener('dragend', clear, { once: true });
  }

  /* =======================
     SVG Arrow Suggestion Overlay — shows WITHIN teacher float windows
     Called when the user hovers a suggestion card in the proposal panel.
     For each move in the suggestion: opens the teacher's float window and
     draws an animated SVG arrow from the FROM cell to the TO cell.
  ======================= */
  let _previewSugCleanup = null;

  function clearSuggestionArrows() {
    try {
      // Remove viewport overlay (legacy cleanup)
      document.querySelectorAll('#suggestion-svg-overlay, .float-suggestion-svg').forEach(el => el.remove());
      if (_previewSugCleanup) { _previewSugCleanup(); _previewSugCleanup = null; }
    } catch { }
  }

  function previewSuggestionMoves(moves) {
    clearSuggestionArrows();
    if (!moves || !moves.length) return;

    // メイングリッドへの矢印オーバーレイ（全移動ステップを可視化）
    try { _drawMainGridArrows(moves); } catch (e) { console.warn('grid arrow error:', e); }

    const drawTimer = setTimeout(() => {
      // 既に開いている個人窓にも矢印を描画
      for (const m of moves) {
        const it = state.items[m.id];
        if (!it) continue;
        const fromPlc = state.placements[m.id];
        for (const tea of (it.teas || [])) {
          try {
            const floatWin = state.ui?.floats?.find(w => w.kind === 'teacher' && w.key === tea);
            if (!floatWin) continue;
            const floatEl = document.querySelector(`.float-win[data-id="${CSS.escape(floatWin.id)}"]`);
            if (!floatEl) continue;
            const gridEl = floatEl.querySelector('[data-role="grid"]');
            if (!gridEl) continue;
            const toTd = gridEl.querySelector(`td[data-day="${m.day}"][data-p="${m.period}"]`);
            const fromTd = fromPlc ? gridEl.querySelector(`td[data-day="${fromPlc.day}"][data-p="${fromPlc.period}"]`) : null;
            if (!toTd) continue;
            _drawFloatArrow(floatEl, fromTd, toTd, it);
          } catch (e) { console.warn('Arrow draw error:', e); }
        }
      }
    }, 80);

    _previewSugCleanup = () => {
      clearTimeout(drawTimer);
      document.querySelectorAll('.float-suggestion-svg, #main-grid-sug-svg').forEach(el => el.remove());
      document.querySelectorAll('.cell-suggest-from, .cell-suggest-to').forEach(el => {
        el.classList.remove('cell-suggest-from', 'cell-suggest-to');
      });
    };
  }

  function _drawMainGridArrows(moves) {
    document.getElementById('main-grid-sug-svg')?.remove();
    document.querySelectorAll('.cell-suggest-from,.cell-suggest-to').forEach(el => {
      el.classList.remove('cell-suggest-from', 'cell-suggest-to');
    });

    const root = document.getElementById('grid');
    if (!root || !moves || !moves.length) return;
    const mode = state.ui.viewMode;

    // Collect pairs: {fromRect, toRect, color, label}
    const arrows = [];
    for (const m of moves) {
      const it = state.items[m.id]; if (!it) continue;
      const fromPlc = state.placements[m.id];
      const scfg = state.subjectCfg[it.subjKey] || {};
      const color = scfg.color || '#ef4444';
      const label = (scfg.abbr || it.subj || '').slice(0, 4);

      const rowKeys = mode === 'teacher' ? (it.teas || [])
        : mode === 'class' ? (it.cls || [])
          : (it.rooms || []);

      // Fall back: if no row matched current mode, try all modes
      let found = false;
      for (const rk of rowKeys) {
        const tr = root.querySelector(`tbody tr[data-row="${CSS.escape(rk)}"]`);
        if (!tr) continue;
        found = true;
        const toTd = tr.querySelector(`td[data-day="${CSS.escape(m.day)}"][data-p="${m.period}"]`);
        const fromTd = fromPlc ? tr.querySelector(`td[data-day="${CSS.escape(fromPlc.day)}"][data-p="${fromPlc.period}"]`) : null;
        if (fromTd) fromTd.classList.add('cell-suggest-from');
        if (toTd) toTd.classList.add('cell-suggest-to');
        if (fromTd && toTd) {
          arrows.push({ from: fromTd.getBoundingClientRect(), to: toTd.getBoundingClientRect(), color, label });
        } else if (toTd) {
          // Only destination known (unplaced item): just mark TO
          arrows.push({ from: null, to: toTd.getBoundingClientRect(), color, label });
        }
      }

      // If no row found in current mode, highlight by day/period across all rows
      if (!found) {
        const toTds = root.querySelectorAll(`tbody td[data-day="${CSS.escape(m.day)}"][data-p="${m.period}"]`);
        toTds.forEach(td => td.classList.add('cell-suggest-to'));
        if (fromPlc) {
          const fromTds = root.querySelectorAll(`tbody td[data-day="${CSS.escape(fromPlc.day)}"][data-p="${fromPlc.period}"]`);
          fromTds.forEach(td => td.classList.add('cell-suggest-from'));
        }
      }
    }

    if (!arrows.length) return;

    // Create full-viewport SVG overlay
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.id = 'main-grid-sug-svg';
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    // 提案ウィンドウ(z-index 9999)より下に描く。以前は19999で、矢印が提案ウィンドウの上に透けて見えていた
    svg.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;pointer-events:none;z-index:9990;overflow:visible';

    let defs = `<defs>`;
    let body = '';

    arrows.forEach(({ from, to, color, label }, i) => {
      const uid = `mgar${i}`;
      // Large arrowhead marker (white outline + colored fill)
      defs += `<marker id="${uid}o" markerWidth="14" markerHeight="10" refX="13" refY="5" orient="auto">
        <polygon points="0 0,14 5,0 10" fill="white"/>
      </marker>
      <marker id="${uid}" markerWidth="12" markerHeight="8" refX="11" refY="4" orient="auto">
        <polygon points="0 0,12 4,0 8" fill="${color}"/>
      </marker>`;

      const tx = to.left + to.width / 2;
      const ty = to.top + to.height / 2;

      if (from) {
        const fx = from.left + from.width / 2;
        const fy = from.top + from.height / 2;
        const dx = tx - fx, dy = ty - fy;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const r = 16; // cell half-size offset from center
        const sx = fx + dx / len * r, sy = fy + dy / len * r;
        const ex = tx - dx / len * (r + 14), ey = ty - dy / len * (r + 14);
        const mx = (sx + ex) / 2, my = (sy + ey) / 2; // midpoint for label
        // White shadow line then colored line
        body += `<line x1="${sx}" y1="${sy}" x2="${ex}" y2="${ey}" stroke="white" stroke-width="6" opacity="0.85" stroke-linecap="round" marker-end="url(#${uid}o)"/>`;
        body += `<line x1="${sx}" y1="${sy}" x2="${ex}" y2="${ey}" stroke="${color}" stroke-width="3.5" opacity="1" stroke-linecap="round" marker-end="url(#${uid})"/>`;
        // FROM badge: circle with "発" label
        body += `<circle cx="${fx}" cy="${fy}" r="11" fill="white" stroke="${color}" stroke-width="2.5"/>`;
        body += `<text x="${fx}" y="${fy + 4}" font-size="11" fill="${color}" text-anchor="middle" font-weight="900">発</text>`;
        // subject label midway
        if (label) {
          body += `<rect x="${mx - label.length * 4 - 4}" y="${my - 9}" width="${label.length * 8 + 8}" height="16" rx="3" fill="white" opacity="0.9"/>`;
          body += `<text x="${mx}" y="${my + 4}" font-size="11" fill="${color}" text-anchor="middle" font-weight="bold">${escapeHtml(label)}</text>`;
        }
      }
      // TO badge: circle with "着" label
      body += `<circle cx="${tx}" cy="${ty}" r="11" fill="white" stroke="#16a34a" stroke-width="2.5"/>`;
      body += `<text x="${tx}" y="${ty + 4}" font-size="11" fill="#16a34a" text-anchor="middle" font-weight="900">着</text>`;
    });

    defs += '</defs>';
    svg.innerHTML = defs + body;
    document.body.appendChild(svg);
  }

  function _drawFloatArrow(floatEl, fromTd, toTd, item) {
    // Add highlight classes to FROM/TO cells
    if (fromTd) fromTd.classList.add('cell-suggest-from');
    if (toTd) toTd.classList.add('cell-suggest-to');

    if (!fromTd || !toTd) return; // no arrow if only destination known (from stock)

    // Get positions relative to floatEl
    const floatRect = floatEl.getBoundingClientRect();
    const fromRect = fromTd.getBoundingClientRect();
    const toRect = toTd.getBoundingClientRect();
    if (!fromRect.width || !toRect.width) return;

    const fx = (fromRect.left + fromRect.width / 2) - floatRect.left;
    const fy = (fromRect.top + fromRect.height / 2) - floatRect.top;
    const tx = (toRect.left + toRect.width / 2) - floatRect.left;
    const ty = (toRect.top + toRect.height / 2) - floatRect.top;

    // Bezier control point
    const cx = (fx + tx) / 2 + (ty - fy) * 0.3;
    const cy = (fy + ty) / 2 - (tx - fx) * 0.3;

    const scfg = state.subjectCfg[item?.subjKey] || {};
    const color = scfg.color || '#0ea5e9';

    // Build SVG (positioned absolute over the float window)
    const uid = 'fsug_' + Math.random().toString(36).slice(2, 8);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.className = 'float-suggestion-svg';
    svg.style.cssText = `position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:200;overflow:visible`;
    svg.innerHTML = `
    <defs>
      <marker id="${uid}-head" markerWidth="9" markerHeight="7" refX="9" refY="3.5" orient="auto">
        <polygon points="0 0, 9 3.5, 0 7" fill="${color}" opacity="0.95"/>
      </marker>
      <filter id="${uid}-glow">
        <feGaussianBlur stdDeviation="2.5" result="blur"/>
        <feComposite in="SourceGraphic" in2="blur" operator="over"/>
      </filter>
    </defs>
    <!-- Glow -->
    <path d="M ${fx} ${fy} Q ${cx} ${cy} ${tx} ${ty}"
          stroke="${color}" stroke-width="7" fill="none" opacity="0.18"/>
    <!-- Main arrow -->
    <path d="M ${fx} ${fy} Q ${cx} ${cy} ${tx} ${ty}"
          stroke="${color}" stroke-width="2.8" fill="none" opacity="0.92"
          stroke-dasharray="7,4"
          marker-end="url(#${uid}-head)">
      <animate attributeName="stroke-dashoffset" from="0" to="-22" dur="0.9s" repeatCount="indefinite"/>
    </path>
    <!-- Start dot -->
    <circle cx="${fx}" cy="${fy}" r="5" fill="${color}" opacity="0.85">
      <animate attributeName="r" values="5;7;5" dur="1.2s" repeatCount="indefinite"/>
    </circle>
  `;
    // Float el must be position:relative (should be already)
    const oldStyle = floatEl.style.position;
    if (!floatEl.style.position || floatEl.style.position === '') floatEl.style.position = 'relative';
    floatEl.appendChild(svg);
  }

  function clearValidSlots() {
    $$('.valid-slot').forEach(el => el.classList.remove('valid-slot'));
    $$('.invalid-slot').forEach(el => el.classList.remove('invalid-slot'));
    $$('.swap-slot').forEach(el => el.classList.remove('swap-slot'));
    $$('.hard-slot').forEach(el => el.classList.remove('hard-slot'));
    $$('.slot-grade-badge').forEach(el => el.remove());
    // Remove all SVG overlays (main + float windows)
    document.querySelectorAll('#suggestion-svg-overlay, .float-suggestion-svg').forEach(el => el.remove());
    document.querySelectorAll('.cell-suggest-from,.cell-suggest-to').forEach(el => { el.classList.remove('cell-suggest-from'); el.classList.remove('cell-suggest-to'); });
    if (_previewSugCleanup) { try { _previewSugCleanup(); } catch { } _previewSugCleanup = null; }
  }

