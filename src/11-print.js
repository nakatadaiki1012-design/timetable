  /* =======================
     Popouts (separate windows)
  ======================= */
  function openPopout(kind) {
    // v32.2: replace real browser popouts with in-app floating windows (more stable)
    // kind: 'teacher' | 'class' | 'room' | 'stock'
    if (kind === 'stock') {
      // stock float: show a compact stock inspector as a floating window
      openFloat('stock', '在庫');
      return;
    }
    openFloatPicker(kind);
  }


  /* external action from popout */
  function applyExternalAction(action) {
    if (!action) return;
    if (action.kind === 'MOVE') {
      placeItem(action.id, action.day, action.period, { mode: action.mode || 'safe' });
    }
    if (action.kind === 'STOCK') {
      toStock(action.id);
    }
    if (action.kind === 'LOCK') {
      toggleLock(action.id);
    }
  }

  /* =======================
     Print view
  ======================= */

  const PRINT_TOKENS = [
    { v: '', l: '(なし)' },
    { v: 'subjFull', l: '科目フル' },
    { v: 'subjAbbr', l: '科目略' },
    { v: 'teaAbbr', l: '教員略' },
    { v: 'teaFull', l: '教員フル' },
    { v: 'cls', l: 'クラス' },
    { v: 'room', l: '教室' },
    { v: 'dept', l: '教科' },
    { v: 'span', l: '2連表示' },
  ];
  function ensurePrintLayoutDefaults() {
    state.ui.printLayout ||= { l1: ['subjAbbr', 'teaAbbr', ''], l2: ['room', '', ''] };
  }
  function populatePrintLayoutSelects() {
    const ids = ['pl1-1', 'pl1-2', 'pl1-3', 'pl1-4', 'pl2-1', 'pl2-2', 'pl2-3'];
    ids.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      if (el.dataset.ready === '1') return;
      el.innerHTML = PRINT_TOKENS.map(t => `<option value="${escapeAttr(t.v)}">${escapeHtml(t.l)}</option>`).join('');
      el.dataset.ready = '1';
    });
  }
  function readPrintLayout() {
    ensurePrintLayoutDefaults();
    const get = (id) => document.getElementById(id)?.value ?? '';
    const l1 = [get('pl1-1'), get('pl1-2'), get('pl1-3'), get('pl1-4')].filter(x => x);
    const l2 = [get('pl2-1'), get('pl2-2'), get('pl2-3')].filter(x => x);
    return { l1, l2 };
  }
  function applyPrintLayoutToUI() {
    ensurePrintLayoutDefaults();
    populatePrintLayoutSelects();
    const lay = state.ui.printLayout;
    const set = (id, val) => { const el = document.getElementById(id); if (el && el.value !== val) el.value = val; };
    const l1 = lay.l1 || [];
    const l2 = lay.l2 || [];
    set('pl1-1', l1[0] || ''); set('pl1-2', l1[1] || ''); set('pl1-3', l1[2] || ''); set('pl1-4', l1[3] || '');
    set('pl2-1', l2[0] || ''); set('pl2-2', l2[1] || ''); set('pl2-3', l2[2] || '');
  }
  function formatPrintToken(tok, it) {
    const sc = state.subjectCfg[it.subjKey] || {};
    const subjAbbr = (sc.abbr || it.subj || '').trim();
    const subjFull = (it.subj || it.subjKey || '').trim();
    const dept = (sc.dept || '').trim();
    const teas = Array.isArray(it.teas) ? it.teas : [];
    const clsArr = Array.isArray(it.cls) ? it.cls : [];
    const roomsArr = Array.isArray(it.rooms) ? it.rooms : [];
    const teaFull = teas.join(',');
    const teaAbbr = teas.map(t => state.teacherCfg[t]?.abbr || t).join(',');
    const cls = clsArr.join(',');
    const room = roomsArr.join(',');
    if (tok === 'subjFull') return subjFull;
    if (tok === 'subjAbbr') return subjAbbr;
    if (tok === 'dept') return dept;
    if (tok === 'teaFull') return teaFull;
    if (tok === 'teaAbbr') return teaAbbr;
    if (tok === 'cls') return cls;
    if (tok === 'room') return room;
    if (tok === 'span') return it.span === 2 ? '[2]' : '';
    return '';
  }
  function buildPrintItemHTML(it, opt, layout, align = 'center', fontFamily = 'inherit') {
    const isTeaTok = (t) => (t === 'teaAbbr' || t === 'teaFull');
    const isClsTok = (t) => (t === 'cls');
    const isRoomTok = (t) => (t === 'room');
    const isSpanTok = (t) => (t === 'span');
    const l1 = (layout?.l1 || []).map(t => {
      if (!t) return '';
      if (isTeaTok(t) && !opt?.showTea) return '';
      if (isClsTok(t) && !opt?.showCls) return '';
      if (isRoomTok(t) && !opt?.showRoom) return '';
      if (isSpanTok(t) && !opt?.showSpan) return '';
      return formatPrintToken(t, it);
    }).filter(x => x);
    const l2 = (layout?.l2 || []).map(t => {
      if (!t) return '';
      if (isTeaTok(t) && !opt?.showTea) return '';
      if (isClsTok(t) && !opt?.showCls) return '';
      if (isRoomTok(t) && !opt?.showRoom) return '';
      if (isSpanTok(t) && !opt?.showSpan) return '';
      return formatPrintToken(t, it);
    }).filter(x => x);
    const h1 = escapeHtml(l1.join(' '));
    const h2 = escapeHtml(l2.join(' '));
    if (!h1 && !h2) return '';
    const inlineStyle = `text-align:${align};font-family:${fontFamily}`;
    return `<div class="pi" style="${inlineStyle}">${h1 ? `<div class="l1" style="${inlineStyle}">${h1}</div>` : ''}${h2 ? `<div class="l2" style="${inlineStyle}">${h2}</div>` : ''}</div>`;
  }

  // 🔍 全ページ縮小プレビュー一覧：print-areaの各ページを縮小サムネイルで一覧表示
  function showPrintOverview() {
    const area = document.getElementById('print-area');
    if (!area) return;
    // 最新の内容を確実に反映
    try { renderPrint(); } catch (e) { }
    const blocks = Array.from(area.children).filter(el => (el.textContent || '').trim() && el.tagName !== 'STYLE');
    if (!blocks.length) { flash('先に印刷内容を表示してください'); return; }
    // 既存のオーバーレイを除去
    document.getElementById('print-overview-overlay')?.remove();
    const orient = document.getElementById('print-page-orient')?.value || 'landscape';
    const pageW = orient === 'portrait' ? 794 : 1123; // A4 96dpi 相当
    const thumbW = 300;
    const scale = thumbW / pageW;

    const overlay = document.createElement('div');
    overlay.id = 'print-overview-overlay';
    overlay.className = 'print-overview-overlay';
    const bar = document.createElement('div');
    bar.className = 'print-overview-bar';
    bar.innerHTML = `<strong>🔍 全体プレビュー</strong><span class="muted small">全 ${blocks.length} ページ</span>`;
    const closeBtn = document.createElement('button');
    closeBtn.className = 'btn secondary';
    closeBtn.textContent = '✕ 閉じる';
    closeBtn.onclick = () => overlay.remove();
    bar.appendChild(closeBtn);
    overlay.appendChild(bar);

    const grid = document.createElement('div');
    grid.className = 'print-overview-grid';
    blocks.forEach((b, i) => {
      const thumb = document.createElement('div');
      thumb.className = 'print-overview-thumb';
      const label = document.createElement('div');
      label.className = 'print-overview-label';
      const titleEl = b.querySelector('.print-card-title, h3');
      label.textContent = `${i + 1}. ${titleEl ? (titleEl.textContent || '').trim() : 'ページ' + (i + 1)}`;
      const inner = document.createElement('div');
      inner.className = 'print-overview-inner';
      inner.style.width = pageW + 'px';
      inner.style.transform = `scale(${scale})`;
      inner.innerHTML = b.outerHTML;
      const frame = document.createElement('div');
      frame.className = 'print-overview-frame';
      frame.style.width = thumbW + 'px';
      // 高さはブロックの実測から算出（描画後に補正）
      frame.appendChild(inner);
      thumb.appendChild(label);
      thumb.appendChild(frame);
      grid.appendChild(thumb);
    });
    overlay.appendChild(grid);
    overlay.addEventListener('click', (ev) => { if (ev.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
    // 各サムネイルの枠高さを実際の縮小後高さに合わせる
    requestAnimationFrame(() => {
      grid.querySelectorAll('.print-overview-frame').forEach((frame) => {
        const inner = frame.querySelector('.print-overview-inner');
        if (inner) frame.style.height = (inner.getBoundingClientRect().height) + 'px';
      });
    });
    const esc = (ev) => { if (ev.key === 'Escape') { overlay.remove(); window.removeEventListener('keydown', esc, true); } };
    window.addEventListener('keydown', esc, true);
  }

  function renderPrint() {
    const area = $('#print-area'); if (!area) return;
    // v32.2: ensure print layout selects are populated
    if (document.getElementById('pl1-1') && document.getElementById('pl1-1').options.length === 0) {
      populatePrintLayoutSelects();
      applyPrintLayoutToUI();
    }
    const type = $('#print-type')?.value || 'class';
    const layout = readPrintLayout();
    // persist layout to state
    state.ui.printLayout = layout;
    markDirty('ui');
    const opt = {
      showTea: !!$('#print-show-tea')?.checked,
      showCls: !!$('#print-show-cls')?.checked,
      showRoom: !!$('#print-show-room')?.checked,
      showSpan: !!$('#print-show-span')?.checked,
    };
    const areaBox = $('#print-area');
    if (areaBox) {
      areaBox.classList.toggle('print-borders', !!$('#print-borders')?.checked);
      // v38: pattern & border width
      const pattern = $('#print-pattern')?.value || 'none';
      areaBox.dataset.pattern = pattern;
      areaBox.classList.toggle('pattern-stripe', pattern === 'stripe');
      areaBox.classList.toggle('pattern-checker', pattern === 'checker');
      const bw = parseFloat($('#print-border-width')?.value || 1);
      areaBox.style.setProperty('--print-border-width', bw + 'px');
      const bwLabel = $('#print-border-width-label');
      if (bwLabel) bwLabel.textContent = bw + 'px';
      // v39: コントラスト
      const contrast = parseFloat($('#print-pattern-contrast')?.value || 30) / 100;
      areaBox.style.setProperty('--print-pattern-alpha', String(contrast));
    }

    // v32.6: cell height / font size steps
    const cellStep = clamp(Number(state.ui.printCellStep || 0), -4, 8);
    const fontStep = clamp(Number(state.ui.printFontStep || 0), -4, 8);
    const cellSizes = [28, 34, 40, 46, 52, 58, 66, 76, 88, 100, 120, 140];
    const fontSizes = [8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 20, 24];
    const baseIdx = 3; // default = 46px / 12px
    const cellH = cellSizes[clamp(baseIdx + cellStep, 0, cellSizes.length - 1)];
    const fontStepSize = fontSizes[clamp(baseIdx + fontStep, 0, fontSizes.length - 1)];
    // 直接フォントサイズ指定があればそれを優先
    const fontSize = (state.ui.printFontSizePx && state.ui.printFontSizePx > 0) ? state.ui.printFontSizePx : fontStepSize;
    const labels = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL'];
    const stepToLabel = s => labels[clamp(s + 2, 0, labels.length - 1)];
    const cl = $('#print-cell-label'); if (cl) cl.textContent = stepToLabel(cellStep);
    const fl = $('#print-font-label'); if (fl) fl.textContent = stepToLabel(fontStep);
    // col width step
    const colStep = clamp(Number(state.ui.printColStep || 0), -4, 8);
    const colWidths = [30, 40, 55, 70, 85, 100, 120, 140, 170, 200, 240, 280];
    const colW = colWidths[clamp(baseIdx + colStep, 0, colWidths.length - 1)];
    const wl = $('#print-col-label'); if (wl) wl.textContent = stepToLabel(colStep);
    // page orientation
    const orient = $('#print-page-orient')?.value || 'landscape';
    let pStyle = document.getElementById('print-page-style');
    if (!pStyle) { pStyle = document.createElement('style'); pStyle.id = 'print-page-style'; document.head.appendChild(pStyle); }
    pStyle.textContent = `@media print { @page { size: A4 ${orient}; } }`;

    // v45.2: align + font family — UI select の値を state に読み込む（逆向きにしない）
    // state → UI への上書きは初回のみ（_initialized フラグで管理）
    const alignEl = $('#print-align');
    const fontFamilyEl = $('#print-font-family');
    if (alignEl) {
      if (!alignEl._initialized) {
        // 初回だけ state から UI へ復元
        if (state.ui.printAlign) alignEl.value = state.ui.printAlign;
        alignEl._initialized = true;
      }
      // 常に UI → state の方向で読む（ユーザー操作を上書きしない）
      state.ui.printAlign = alignEl.value;
    } else { state.ui.printAlign ||= 'center'; }
    if (fontFamilyEl) {
      if (!fontFamilyEl._initialized) {
        if (state.ui.printFontFamily) fontFamilyEl.value = state.ui.printFontFamily;
        fontFamilyEl._initialized = true;
      }
      state.ui.printFontFamily = fontFamilyEl.value;
    } else { state.ui.printFontFamily ||= 'system'; }

    // v63.2: fontFamilyCSS をここで算出して #print-area 自体にも設定
    const fontFam0 = state.ui.printFontFamily || 'system';
    const fontFamilyCSS0 = _printFontCSS(fontFam0);
    if (areaBox) areaBox.style.fontFamily = fontFamilyCSS0;

    // v63.2: 枠サイズ固定/フレキシブル
    const cellSizeEl = $('#print-cell-size-mode');
    if (cellSizeEl) {
      if (!cellSizeEl._initialized) {
        if (state.ui.printFixedSize) cellSizeEl.value = state.ui.printFixedSize;
        cellSizeEl._initialized = true;
      }
      state.ui.printFixedSize = cellSizeEl.value;
    } else { state.ui.printFixedSize ||= 'fixed'; }

    const idx = buildIndex();
    const maxP = Math.max(...DAYS.map(d => maxPeriod(d)));

    // Matrix view: all keys as rows, day×period as columns (縦=教員/クラス, 横=曜日×時間)
    // Use smaller cell height for matrix to fit A3; adjust with existing ↑↓ buttons
    if (type === 'matrix-teacher' || type === 'matrix-class' || type === 'matrix-room') {
      const kind = type === 'matrix-teacher' ? 'teacher' : type === 'matrix-class' ? 'class' : 'room';
      const keys = getAxisKeys(kind);
      const matrixCellH = Math.max(24, Math.round(cellH * 0.7));
      area.innerHTML = buildMatrixHTML(kind, keys, idx, maxP, opt, layout, matrixCellH, fontSize);
      initPrintResize();
      return;
    }

    // タイトル（クラス名・教員名）フォントサイズ
    const titleFontSize = (state.ui.printTitleFontSizePx && state.ui.printTitleFontSizePx > 0)
      ? state.ui.printTitleFontSizePx : (fontSize + 2);
    // タイトル入力を現在値に同期
    const tfPxEl = document.getElementById('print-title-font-px');
    if (tfPxEl && !tfPxEl._focused) tfPxEl.value = titleFontSize;
    const hfPxEl = document.getElementById('print-header-font-px');
    const headerFontSizeNow = (state.ui.printHeaderFontSizePx && state.ui.printHeaderFontSizePx > 0)
      ? state.ui.printHeaderFontSizePx : fontSize;
    if (hfPxEl && !hfPxEl._focused) hfPxEl.value = headerFontSizeNow;

    // 1頁1エンティティ モード
    if (type === 'class-paged' || type === 'teacher-paged') {
      const baseType = type === 'class-paged' ? 'class' : 'teacher';
      const keys2 = getAxisKeys(baseType);
      let html2 = '';
      for (let i = 0; i < keys2.length; i++) {
        const key = keys2[i];
        html2 += `<div class="print-page-break" style="${i > 0 ? 'page-break-before:always;' : ''}margin-bottom:12px;">
          <h3 class="print-card-title" style="font-family:${fontFamilyCSS0};font-size:${titleFontSize}px;margin:0 0 6px">${escapeHtml(key)}</h3>
          ${printTableHTML(baseType, key, idx, maxP, opt, layout, cellH, fontSize, 1, colW)}
        </div>`;
      }
      area.innerHTML = html2 || '<div class="card">データなし</div>';
      initPrintResize();
      return;
    }

    const keys = getAxisKeys(type);
    const printCols = parseInt($('#print-cols')?.value || '1', 10) || 1;
    let html = '';

    if (printCols === 1) {
      for (const key of keys) {
        html += `<div class="card print-card" style="page-break-inside:avoid;margin-bottom:10px;">
        <h3 class="print-card-title" style="font-family:${fontFamilyCSS0};font-size:${titleFontSize}px">${escapeHtml(key)}</h3>
        ${printTableHTML(type, key, idx, maxP, opt, layout, cellH, fontSize, printCols, colW)}
      </div>`;
      }
    } else {
      // 複数列: chunkに分けてflexで横並び
      for (let i = 0; i < keys.length; i += printCols) {
        const chunk = keys.slice(i, i + printCols);
        html += `<div class="print-row" style="display:flex;gap:8px;margin-bottom:10px;page-break-inside:avoid;align-items:flex-start;">`;
        for (const key of chunk) {
          html += `<div class="card print-card" style="flex:1;min-width:0;page-break-inside:avoid;">
          <h3 class="print-card-title" style="font-size:${Math.max(10, fontSize - 1)}px;margin:0 0 4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(key)}</h3>
          ${printTableHTML(type, key, idx, maxP, opt, layout, Math.max(24, Math.round(cellH * (printCols === 2 ? 0.85 : 0.7))), Math.max(8, Math.round(fontSize * (printCols === 2 ? 0.9 : 0.75))), printCols, colW)}
        </div>`;
        }
        html += `</div>`;
      }
    }
    area.innerHTML = html || '<div class="card">データなし</div>';
    // print-cols イベント登録（初回のみ）
    const printColsSel = $('#print-cols');
    if (printColsSel && !printColsSel._bound) { printColsSel._bound = true; printColsSel.onchange = renderPrint; }
    initPrintResize();
  }

  /* ── ドラッグによる列幅・行高さ変更 ── */
  function initPrintResize() {
    const area = document.getElementById('print-area');
    if (!area) return;
    state.ui.printColWidths ||= {};
    state.ui.printRowHeights ||= {};

    const tables = Array.from(area.querySelectorAll('table.t2'));
    if (!tables.length) return;

    tables.forEach(table => {
      const cols = Array.from(table.querySelectorAll('col'));

      // 保存済み列幅を適用
      let hasColOverride = false;
      cols.forEach((col, ci) => {
        if (state.ui.printColWidths[ci] != null) {
          col.style.width = state.ui.printColWidths[ci] + 'px';
          hasColOverride = true;
        }
      });
      if (hasColOverride) { table.style.tableLayout = 'fixed'; table.style.width = 'auto'; }

      // 保存済み行高さを適用
      const bodyRows = Array.from(table.querySelectorAll('tbody tr'));
      bodyRows.forEach((tr, ri) => {
        if (state.ui.printRowHeights[ri] != null) {
          const h = state.ui.printRowHeights[ri];
          tr.querySelectorAll('td,th').forEach(cell => { cell.style.height = h + 'px'; });
        }
      });

      if (table._prResizeInit) return;
      table._prResizeInit = true;

      // ── 列幅リサイズハンドル（ヘッダ th の右端） ──
      const headThs = Array.from(table.querySelectorAll('thead tr:first-child th'));
      headThs.forEach((th, ci) => {
        th.style.position = 'relative';
        const h = document.createElement('div');
        h.className = 'pr-col-handle';
        th.appendChild(h);

        h.addEventListener('mousedown', e => {
          e.preventDefault(); e.stopPropagation();
          const col = cols[ci];
          const startX = e.clientX;
          const startW = col ? (col.offsetWidth || th.offsetWidth) : th.offsetWidth;
          tables.forEach(t => { t.style.tableLayout = 'fixed'; t.style.width = 'auto'; });

          const onMove = e => {
            const newW = Math.max(24, startW + (e.clientX - startX));
            state.ui.printColWidths[ci] = newW;
            tables.forEach(t => {
              const c = t.querySelectorAll('col')[ci];
              if (c) c.style.width = newW + 'px';
            });
          };
          const onUp = () => { markDirty('ui'); window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
          window.addEventListener('mousemove', onMove);
          window.addEventListener('mouseup', onUp);
        });
      });

      // ── 行高さリサイズハンドル（tbody 行の th 下端） ──
      bodyRows.forEach((tr, ri) => {
        const th = tr.querySelector('th');
        if (!th) return;
        th.style.position = 'relative';
        const h = document.createElement('div');
        h.className = 'pr-row-handle';
        th.appendChild(h);

        h.addEventListener('mousedown', e => {
          e.preventDefault(); e.stopPropagation();
          const startY = e.clientY;
          const startH = tr.offsetHeight;

          const onMove = e => {
            const newH = Math.max(16, startH + (e.clientY - startY));
            state.ui.printRowHeights[ri] = newH;
            tables.forEach(t => {
              const rows = t.querySelectorAll('tbody tr');
              const targetTr = rows[ri];
              if (targetTr) targetTr.querySelectorAll('td,th').forEach(cell => { cell.style.height = newH + 'px'; });
            });
          };
          const onUp = () => { markDirty('ui'); window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
          window.addEventListener('mousemove', onMove);
          window.addEventListener('mouseup', onUp);
        });
      });
    });

    // 直接フォントサイズ入力の表示を同期
    const fsInput = document.getElementById('print-font-size-px');
    if (fsInput && !fsInput._focused) {
      const fontSizes = [8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 20, 24];
      const baseIdx = 3;
      const fontStep = clamp(Number(state.ui.printFontStep || 0), -4, 8);
      const currentFs = state.ui.printFontSizePx || fontSizes[clamp(baseIdx + fontStep, 0, fontSizes.length - 1)];
      fsInput.value = currentFs;
    }
  }

  function resetPrintResize() {
    state.ui.printColWidths = {};
    state.ui.printRowHeights = {};
    state.ui.printFontSizePx = null;
    state.ui.printTitleFontSizePx = null;
    state.ui.printHeaderFontSizePx = null;
    markDirty('ui');
    renderPrint();
    flash('サイズをリセットしました');
  }

  function equalizeColWidths() {
    const area = document.getElementById('print-area');
    const tables = Array.from(area?.querySelectorAll('table.t2') || []);
    if (!tables.length) { flash('先に印刷タブで時間割を表示してください'); return; }
    state.ui.printColWidths ||= {};
    const cols = Array.from(tables[0].querySelectorAll('col'));
    // 曜日列（index 1以降）の現在幅を集めて最大値を統一幅に
    const dayWidths = cols.slice(1).map((c, i) => {
      const saved = state.ui.printColWidths[i + 1];
      return saved || c.offsetWidth || 70;
    });
    const target = Math.max(...dayWidths, 50);
    cols.slice(1).forEach((_, i) => { state.ui.printColWidths[i + 1] = target; });
    markDirty('ui');
    renderPrint();
    flash(`列幅を ${target}px に揃えました`);
  }

  function equalizeRowHeights() {
    const area = document.getElementById('print-area');
    const tables = Array.from(area?.querySelectorAll('table.t2') || []);
    if (!tables.length) { flash('先に印刷タブで時間割を表示してください'); return; }
    state.ui.printRowHeights ||= {};
    const bodyRows = Array.from(tables[0].querySelectorAll('tbody tr'));
    const heights = bodyRows.map((tr, i) => {
      const saved = state.ui.printRowHeights[i];
      return saved || tr.offsetHeight || 40;
    });
    const target = Math.max(...heights, 24);
    bodyRows.forEach((_, i) => { state.ui.printRowHeights[i] = target; });
    markDirty('ui');
    renderPrint();
    flash(`行高さを ${target}px に揃えました`);
  }

  function printFitA4Portrait() {
    const adays = activeDays();
    const maxP = Math.max(...adays.map(d => maxPeriod(d)));
    if (!maxP || !adays.length) { flash('データがありません'); return; }
    // A4 縦: 210×297mm。96dpi換算 794×1123px、マージン各10mm(38px)引き
    const pageW = 794 - 76;  // 718px
    const pageH = 1123 - 76; // 1047px
    const periodColW = 28;
    const headerRowH = 26;
    const dayColW = Math.max(50, Math.floor((pageW - periodColW) / adays.length));
    const rowH   = Math.max(18, Math.floor((pageH - headerRowH) / maxP));
    const fs     = Math.max(7, Math.min(14, Math.floor(rowH * 0.32)));
    // 列幅・行高さをドラッグリサイズ上書き形式で保存
    state.ui.printColWidths = { 0: periodColW };
    adays.forEach((_, i) => { state.ui.printColWidths[i + 1] = dayColW; });
    state.ui.printRowHeights = {};
    for (let i = 0; i < maxP; i++) { state.ui.printRowHeights[i] = rowH; }
    state.ui.printFontSizePx = fs;
    state.ui.printTitleFontSizePx = fs + 2;
    state.ui.printHeaderFontSizePx = fs;
    // ページ方向を縦に
    const orientEl = document.getElementById('print-page-orient');
    if (orientEl) orientEl.value = 'portrait';
    markDirty('ui');
    renderPrint();
    flash(`A4縦フィット: 列幅${dayColW}px / 行高${rowH}px / 文字${fs}px`);
  }
  function printTableHTML(kind, key, idx, maxP, opt, layout, cellH = 46, fontSize = 12, printCols = 1, colW = 0) {
    const align = state.ui.printAlign || 'center';
    const fontFam = state.ui.printFontFamily || 'system';
    const fontFamilyCSS = _printFontCSS(fontFam);
    // ヘッダ（曜日・時限数字）専用フォントサイズ
    const headerFontSize = (state.ui.printHeaderFontSizePx && state.ui.printHeaderFontSizePx > 0)
      ? state.ui.printHeaderFontSizePx : fontSize;
    const hStyle = `font-family:${fontFamilyCSS};font-size:${headerFontSize}px`;
    // v63.2: 枠サイズ固定/フレキシブル切替
    const isFlexible = (state.ui.printFixedSize || 'fixed') === 'flexible';
    const cellHeightCSS = isFlexible ? `min-height:${cellH}px;height:auto` : `height:${cellH}px`;
    const cellStyle = `${cellHeightCSS};padding:2px 5px;text-align:${align};vertical-align:middle;`;
    const minW = Math.max(200, Math.round(680 / Math.max(1, printCols)));
    // v63.3: colgroup で時限列(狭め)+曜日列(均等幅)を明示的に指定
    const dayColPct = Math.floor((100 - 8) / DAYS.length); // 8%=時限列, 残りを均等分配
    const colgroupHTML = colW
      ? `<colgroup><col style="width:40px">${DAYS.map(() => `<col style="min-width:${colW}px">`).join('')}</colgroup>`
      : `<colgroup><col style="width:8%">${DAYS.map(() => `<col style="width:${dayColPct}%">`).join('')}</colgroup>`;
    let html = `<table class="t2" style="min-width:${minW}px;width:100%;font-size:${fontSize}px;font-family:${fontFamilyCSS};table-layout:fixed">${colgroupHTML}<thead><tr><th style="${hStyle}">時限</th>${DAYS.map(d => `<th style="${hStyle}">${DAYJP[d]}</th>`).join('')}</tr></thead><tbody>`;
    for (let p = 1; p <= maxP; p++) {
      html += `<tr><th style="${hStyle}">${p}</th>`;
      for (const d of DAYS) {
        if (p > maxPeriod(d)) { html += `<td class="forbidden"></td>`; continue; }
        // 【4】2連の2コマ目も同じ授業を印刷する（従来は isSpanFill で除外され空欄になっていた）
        const ids = idsInCellForRow(kind, key, d, p, idx);
        if (!ids.length) { html += `<td style="${cellStyle}"></td>`; continue; }
        const lines = ids.map(id => {
          const it = state.items[id];
          return buildPrintItemHTML(it, opt, layout, align, fontFamilyCSS);
        }).filter(x => x).join('<div class="pi-sep"></div>');
        html += `<td style="${cellStyle}">${lines}</td>`;
      }
      html += `</tr>`;
    }
    html += `</tbody></table>`;
    return html;
  }

  /* =======================
     v49: PDF直接エクスポート
     html2canvas + jsPDF をCDNから遅延ロードして
     #print-area をA4 PDFとして保存
  ======================= */
  function _loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) {
        // already inserted - wait for it or resolve immediately
        resolve(); return;
      }
      const s = document.createElement('script');
      s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('CDN読込失敗: ' + src));
      document.head.appendChild(s);
    });
  }
  async function exportPDF() {
    const area = document.getElementById('print-area');
    if (!area || !area.innerHTML.trim()) { flash('先に印刷タブで時間割を表示してください'); return; }

    // Show loading state
    const btn = document.getElementById('btn-pdf-export');
    const origText = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = '⏳ 生成中...'; }
    flash('📄 PDF生成中... ライブラリ読込中');

    try {
      // Lazy-load libraries
      await _loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');
      await _loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');

      if (typeof html2canvas === 'undefined') throw new Error('html2canvasの読込に失敗しました');
      if (typeof window.jspdf === 'undefined') throw new Error('jsPDFの読込に失敗しました');

      flash('📷 スクリーンショット撮影中...');
      await new Promise(r => setTimeout(r, 80)); // ensure flash renders

      const canvas = await html2canvas(area, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false,
        removeContainer: true,
      });

      const { jsPDF } = window.jspdf;
      const imgW = canvas.width;
      const imgH = canvas.height;
      const isLandscape = imgW > imgH;

      const pdf = new jsPDF({
        orientation: isLandscape ? 'landscape' : 'portrait',
        unit: 'mm',
        format: 'a4',
      });

      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const margin = 8; // mm
      const usableW = pageW - margin * 2;
      const usableH = pageH - margin * 2;

      const ratio = Math.min(usableW / (imgW / 3.7795), usableH / (imgH / 3.7795));
      const finalW = (imgW / 3.7795) * ratio;
      const finalH = (imgH / 3.7795) * ratio;
      const offX = margin + (usableW - finalW) / 2;
      const offY = margin + (usableH - finalH) / 2;

      pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', offX, offY, finalW, finalH);

      const now = new Date();
      const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
      pdf.save(`timetable_${ts}.pdf`);
      flash('✅ PDF保存完了');
    } catch (e) {
      console.error('exportPDF error:', e);
      // Fallback: browser print dialog
      showModalHTML('❌ PDF生成失敗',
        `<div style="padding:8px">
        <div style="color:#ef4444;margin-bottom:12px">エラー: ${escapeHtml(e.message)}</div>
        <div style="font-size:12px;color:#64748b">
          <strong>代替手順:</strong><br>
          1. 「印刷 / PDF」ボタンをクリック<br>
          2. 印刷ダイアログで「PDFとして保存」を選択
        </div>
      </div>`,
        () => window.print(), '📄 ブラウザで印刷', '閉じる');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = origText; }
    }
  }


  function ensureFloatState() {
    state.ui.floats ||= [];
    state.ui.floatZ ||= 70;
  }
  function openFloatPicker(kind) {
    // v33.1: Show a card grid of all teachers/classes to pick from
    const kindNorm = (kind === 'teacher' || kind === 'class' || kind === 'room') ? kind : 'teacher';
    const keys = getAxisKeys(kindNorm);
    if (!keys.length) { flash('対象がありません'); return; }
    const idx = buildIndex();

    const tagLabel = kindNorm === 'teacher' ? '教員' : kindNorm === 'class' ? 'クラス' : '教室';

    // Build load count for each key (items assigned)
    const loadCount = {};
    for (const key of keys) {
      let cnt = 0;
      for (const id in state.items) {
        const it = state.items[id];
        const match = (kindNorm === 'teacher' && (it.teas || []).includes(key))
          || (kindNorm === 'class' && (it.cls || []).includes(key))
          || (kindNorm === 'room' && (it.rooms || []).includes(key));
        if (match) cnt++;
      }
      loadCount[key] = cnt;
    }

    const cardsHTML = keys.map(key => {
      const placed = Object.keys(state.items).filter(id => {
        const it = state.items[id]; if (!state.placements[id]) return false;
        return (kindNorm === 'teacher' && (it.teas || []).includes(key))
          || (kindNorm === 'class' && (it.cls || []).includes(key))
          || (kindNorm === 'room' && (it.rooms || []).includes(key));
      }).length;
      const total = loadCount[key] || 0;
      const pct = total > 0 ? Math.round(placed / total * 100) : 0;
      return `<button class="fp-card" data-key="${escapeAttr(key)}" title="${escapeHtml(key)}: 配置${placed}/${total}コマ">
      <div class="fp-name">${escapeHtml(key)}</div>
      <div class="fp-stat">${placed}/${total}</div>
    </button>`;
    }).join('');

    const html = `
    <input id="fp-q" class="mini-input" placeholder="絞り込み（例: 田中 / 1-7）" style="width:100%;margin-bottom:8px"/>
    <div id="fp-grid" class="fp-grid">${cardsHTML}</div>
    <div class="muted small" style="margin-top:6px">行ヘッダーをダブルクリックでも開けます。</div>
  `;

    showModalHTML(`${tagLabel}ビューを開く`, html, () => {
      const sel = document.querySelector('#fp-grid .fp-card.selected');
      const key = sel?.dataset.key || keys[0];
      openFloat(kindNorm, key);
      rerenderAll();
    }, '開く', 'キャンセル', () => {
      const grid = document.getElementById('fp-grid');
      const q = document.getElementById('fp-q');
      // Select first card by default
      if (grid) {
        const last = state.ui.lastRow?.kind === kindNorm ? state.ui.lastRow.key : '';
        const firstCard = (last ? grid.querySelector(`[data-key="${CSS.escape(last)}"]`) : null) || grid.querySelector('.fp-card');
        firstCard?.classList.add('selected');
        // Click to select, dblclick to open immediately
        grid.querySelectorAll('.fp-card').forEach(btn => {
          btn.onclick = () => {
            grid.querySelectorAll('.fp-card').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
          };
          btn.ondblclick = () => {
            openFloat(kindNorm, btn.dataset.key);
            rerenderAll();
            document.getElementById('modal-cancel')?.click();
          };
        });
      }
      if (q) {
        q.oninput = () => {
          const qq = (q.value || '').trim().toLowerCase();
          grid?.querySelectorAll('.fp-card').forEach(btn => {
            btn.style.display = (!qq || btn.dataset.key.toLowerCase().includes(qq)) ? '' : 'none';
          });
        };
        q.focus();
      }
    });
  }



  function openFloat(kind, key) {
    if (!(kind === 'teacher' || kind === 'class' || kind === 'room' || kind === 'stock')) { flash('フロートは教員/クラス/教室/在庫で開けます'); return; }
    ensureFloatState();
    const exist = state.ui.floats.find(w => w.kind === kind && w.key === key);
    if (exist) { bringFloatToFront(exist.id); renderFloatLayer(); return; }
    const id = 'fw_' + now() + '_' + Math.floor(Math.random() * 1e6);
    const baseX = 40 + (state.ui.floats.length * 28) % 240;
    const baseY = 60 + (state.ui.floats.length * 24) % 180;
    // 在庫上モード時はグリッドエリアが狭いので横長（ワイド・ショート）に
    const isStockTop = document.body.classList.contains('stock-top');
    const defaultW = isStockTop ? 1100 : 980;
    const defaultH = isStockTop ? 360 : 620;
    const w = { id, kind, key, x: baseX, y: baseY, w: defaultW, h: defaultH, z: (state.ui.floatZ || 70) + 1 };
    state.ui.floatZ = w.z;
    state.ui.floats.push(w);
    markDirty('ui');
    renderFloatLayer();
  }
  function closeFloat(id) {
    ensureFloatState();
    state.ui.floats = state.ui.floats.filter(w => w.id !== id);
    markDirty('ui');
    renderFloatLayer();
  }
  function bringFloatToFront(id) {
    ensureFloatState();
    const w = state.ui.floats.find(x => x.id === id); if (!w) return;
    w.z = (state.ui.floatZ || 70) + 1;
    state.ui.floatZ = w.z;
    markDirty('ui');
  }
  function renderFloatLayer() {
    const layer = document.getElementById('float-layer');
    if (!layer) return;
    ensureFloatState();
    // remove stale nodes (.atw-win は state.ui.floats 管理外なので除外)
    const keep = new Set(state.ui.floats.map(w => w.id));
    layer.querySelectorAll('.float-win:not(.atw-win)').forEach(el => {
      if (!keep.has(el.dataset.id)) el.remove();
    });

    const idx = buildIndex();
    for (const win of state.ui.floats) {
      let el = layer.querySelector(`.float-win[data-id="${CSS.escape(win.id)}"]`);
      if (!el) {
        el = document.createElement('div');
        el.className = 'float-win';
        el.dataset.id = win.id;
        el.dataset.kind = win.kind;  // ★追加: kindを設定
        el.dataset.key = win.key;    // ★追加: keyを設定
        layer.appendChild(el);
        bindFloatWin(el, win.id);
      }
      el.style.left = win.x + 'px';
      el.style.top = win.y + 'px';
      el.style.width = win.w + 'px';
      el.style.height = win.h + 'px';
      el.style.zIndex = String(win.z || 80);
      el.innerHTML = buildFloatHTML(win, idx);
      bindFloatContent(el, win, idx);
    }
  }
  function buildFloatHTML(win, idx) {
    const tag = (win.kind === 'teacher' ? '教員' : win.kind === 'class' ? 'クラス' : win.kind === 'room' ? '教室' : win.kind === 'stock' ? '在庫' : '');
    const title = (win.kind === 'stock') ? '在庫' : `${tag}: ${win.key}`;
    const isStock = (win.kind === 'stock');
    const stockCollapsed = !!win.stockCollapsed;

    // Prev/Next navigation for non-stock windows
    let navHTML = '';
    if (!isStock) {
      const keys = getAxisKeys(win.kind);
      const curIdx = keys.indexOf(win.key);
      const hasPrev = curIdx > 0;
      const hasNext = curIdx < keys.length - 1;
      const prevKey = hasPrev ? keys[curIdx - 1] : null;
      const nextKey = hasNext ? keys[curIdx + 1] : null;
      const abbr = (k) => {
        if (!k) return '';
        if (win.kind === 'teacher') return state.teacherCfg[k]?.abbr || k;
        return k;
      };
      const prevLabel = prevKey ? `‹ ${escapeHtml(abbr(prevKey).slice(0, 5))}` : '‹';
      const nextLabel = nextKey ? `${escapeHtml(abbr(nextKey).slice(0, 5))} ›` : '›';
      navHTML = `
      <button class="btn secondary float-nav-btn" data-act="nav-prev" ${hasPrev ? '' : 'disabled'} title="${prevKey ? '前: ' + abbr(prevKey) : '前なし'}">${prevLabel}</button>
      <span class="float-nav-pos">${curIdx + 1}/${keys.length}</span>
      <button class="btn secondary float-nav-btn" data-act="nav-next" ${hasNext ? '' : 'disabled'} title="${nextKey ? '次: ' + abbr(nextKey) : '次なし'}">${nextLabel}</button>
    `;
    }
    return `
    <div class="float-head" data-handle="1">
      <span class="title">${escapeHtml(title)}</span>
      <span class="tag">${escapeHtml(tag)}</span>
      <div class="spacer"></div>
      ${navHTML}
      ${!isStock ? `<button class="btn secondary" data-act="stock-toggle" title="在庫パネル 開閉" style="font-size:11px;padding:2px 6px">${stockCollapsed ? '▶在庫' : '◀在庫'}</button>` : ''}
      <button class="btn secondary" data-act="close">×</button>
    </div>
    <div class="float-body">
      <div class="float-stock${stockCollapsed ? ' float-stock-collapsed' : ''}" ${isStock ? 'style="flex:1;max-width:none"' : ''}>
        ${stockCollapsed && !isStock ? '' : `
        <div class="head">
          <strong>${isStock ? '在庫' : 'この' + (win.kind === 'teacher' ? '教員' : win.kind === 'class' ? 'クラス' : '教室') + 'の在庫'}</strong>
          <span class="muted small" data-role="count"></span>
          <div class="spacer"></div>
          <label class="chk small"><input type="checkbox" data-role="showPlaced">配置済も</label>
        </div>
        <div class="stock-list float-stock-list" data-role="stock"></div>
        `}
      </div>
      ${isStock ? '' : '<div class="float-grid" data-role="grid"></div>'}
    </div>
    <div class="float-resize-handle" title="ドラッグでリサイズ"></div>
  `;
  }

  function bindFloatWin(el, id) {
    // close
    el.addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-act="close"]');
      if (btn) { ev.stopPropagation(); closeFloat(id); }
      // stock-toggle: collapse/expand stock panel
      const toggleBtn = ev.target.closest('[data-act="stock-toggle"]');
      if (toggleBtn) {
        ev.stopPropagation();
        const win = state.ui.floats.find(w => w.id === id); if (!win) return;
        win.stockCollapsed = !win.stockCollapsed;
        markDirty('ui');
        renderFloatLayer();
      }
      // nav prev/next
      const navBtn = ev.target.closest('[data-act="nav-prev"],[data-act="nav-next"]');
      if (navBtn && !navBtn.disabled) {
        ev.stopPropagation();
        const win = state.ui.floats.find(w => w.id === id); if (!win) return;
        const keys = getAxisKeys(win.kind);
        const curIdx = keys.indexOf(win.key);
        const dir = navBtn.dataset.act === 'nav-prev' ? -1 : 1;
        const newIdx = curIdx + dir;
        if (newIdx >= 0 && newIdx < keys.length) {
          win.key = keys[newIdx];
          markDirty('ui');
          renderFloatLayer();
        }
      }
    });
    el.addEventListener('mousedown', () => bringFloatToFront(id));

    // drag move by header — skip bottom-right 20px corner (reserved for resize handle)
    let dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;
    el.addEventListener('mousedown', (ev) => {
      const handle = ev.target.closest('[data-handle="1"]');
      if (!handle) return;
      // Exclude resize corner area from drag (16px corner)
      const rect = el.getBoundingClientRect();
      if (ev.clientX > rect.right - 16 && ev.clientY > rect.bottom - 16) return;
      dragging = true;
      const win = state.ui.floats.find(w => w.id === id); if (!win) return;
      sx = ev.clientX; sy = ev.clientY; ox = win.x; oy = win.y;
      ev.preventDefault();
    });
    window.addEventListener('mousemove', (ev) => {
      if (!dragging) return;
      const win = state.ui.floats.find(w => w.id === id); if (!win) return;
      win.x = clamp(Math.round(ox + (ev.clientX - sx)), 0, window.innerWidth - 80);
      win.y = clamp(Math.round(oy + (ev.clientY - sy)), 0, window.innerHeight - 60);
      el.style.left = win.x + 'px';
      el.style.top = win.y + 'px';
    });
    window.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      markDirty('ui');
    });

    // observe resize (store size)
    const ro = new ResizeObserver((entries) => {
      for (const ent of entries) {
        const win = state.ui.floats.find(w => w.id === id); if (!win) continue;
        win.w = Math.round(ent.contentRect.width);
        win.h = Math.round(ent.contentRect.height);
        markDirty('ui');
      }
    });
    ro.observe(el);
  }
  function scopedStockIds(kind, key, showPlaced) {
    const ids = Object.keys(state.items).filter(id => {
      const plc = state.placements[id];
      if (!showPlaced && plc) return false;
      const it = state.items[id];
      if (kind === 'stock') return true;
      if (kind === 'teacher') return it.teas.includes(key);
      if (kind === 'class') return it.cls.includes(key);
      if (kind === 'room') return it.rooms.includes(key);
      return false;
    });
    // sort by dept then subject then class
    const deptOf = (id) => (state.subjectCfg[state.items[id]?.subjKey]?.dept) || '';
    const subjKeyOf = (id) => (state.items[id]?.subjKey) || '';
    const clsOf = (id) => (state.items[id]?.cls || []).join(',');
    const sk = (id) => `${deptOf(id)}\u0001${subjKeyOf(id)}\u0001${clsOf(id)}\u0001${id}`;
    return ids.sort((a, b) => sk(a).localeCompare(sk(b), 'ja'));
  }
  function renderScopedStock(listEl, kind, key, showPlaced) {
    listEl.innerHTML = '';
    listEl.style.display = 'flex';
    listEl.style.flexWrap = 'wrap';
    listEl.style.gap = '4px';
    listEl.style.padding = '4px';
    listEl.style.overflowY = 'auto';

    const ids = scopedStockIds(kind, key, showPlaced);
    const deptOf = (id) => (state.subjectCfg[state.items[id]?.subjKey]?.dept) || '';
    const deptCounts = new Map();
    ids.forEach(id => deptCounts.set(deptOf(id) || '（未設定）', (deptCounts.get(deptOf(id) || '（未設定）') || 0) + 1));
    let cur = null;

    for (const id of ids) {
      const d = deptOf(id) || '（未設定）';
      if (d !== cur) {
        cur = d;
        const sep = document.createElement('div');
        sep.className = 'stock-sep';
        sep.style.cssText = 'flex:0 0 100%;font-size:10px;color:#64748b;font-weight:900;padding:2px 4px 0';
        sep.innerHTML = `<span>${escapeHtml(d)}</span><span class="cnt" style="margin-left:4px;color:#94a3b8">${deptCounts.get(d)}</span>`;
        listEl.appendChild(sep);
      }
      // Render as a compact lesson-style card
      listEl.appendChild(floatStockCard(id));
    }
    return ids.length;
  }

  // Compact lesson-style card for float window stock
  function floatStockCard(id) {
    const it = state.items[id];
    const scfg = state.subjectCfg[it.subjKey] || {};
    const color = scfg.color || pickColor(it.subjKey);
    const abbr = (scfg.abbr || it.subj || '').trim();
    const cls = it.cls.join(',');
    const tea = it.teas.map(t => state.teacherCfg[t]?.abbr || normalizeAbbr(t, 6) || t).join(',');

    const el = document.createElement('div');
    el.className = 'float-stock-card' + (state.ui.selectedId === id ? ' sel' : '');
    el.draggable = true;
    el.dataset.id = id;
    el.style.background = color;
    el.style.color = isDark(color) ? '#fff' : '#0f172a';
    // title属性を削除（黒いポップアップと2重表示を防ぐ）
    // el.title=`${abbr}\nクラス:${cls}\n教員:${tea}`;
    el.innerHTML = `
    <div class="fsc-subj">${escapeHtml(abbr.slice(0, 4))}</div>
    <div class="fsc-cls">${escapeHtml(cls.slice(0, 8))}</div>
    ${tea ? `<div class="fsc-tea">${escapeHtml(tea.slice(0, 8))}</div>` : ''}
    ${it.span === 2 ? `<div class="fsc-span">2連</div>` : ''}
  `;
    el.ondragstart = (ev) => {
      window._currentDragId = id;
      window._dragPending = true;
      ev.dataTransfer.setData('text/plain', id);
      try { ev.dataTransfer.setData('id', id); } catch { }
      ev.dataTransfer.effectAllowed = 'move';
      highlightValidSlots(id);
    };
    el.ondragend = () => {
      window._dragPending = false;
      setTimeout(() => { if (!window._dragPending) window._currentDragId = null; }, 100);
    };
    el.onclick = () => selectId(id, 'stock');
    el.ondblclick = () => { selectId(id, 'stock'); openPropSuggestions(id); };
    el.onmouseenter = (ev) => { try { showHoverTip(itemDetailText(id), ev.clientX, ev.clientY); } catch { } };
    el.onmousemove = (ev) => { try { showHoverTip(itemDetailText(id), ev.clientX, ev.clientY); } catch { } };
    el.onmouseleave = () => hideHoverTip();
    return el;
  }
  function renderFloatGrid(gridEl, kind, key, idx) {
    const maxP = Math.max(...DAYS.map(d => maxPeriod(d)));
    let html = `<table class="t2"><thead><tr><th>時限</th>${DAYS.map(d => `<th>${DAYJP[d]}</th>`).join('')}</tr></thead><tbody>`;
    for (let p = 1; p <= maxP; p++) {
      html += `<tr><th>${p}</th>`;
      for (const d of DAYS) {
        if (p > maxPeriod(d)) { html += `<td class="forbidden"></td>`; continue; }
        html += `<td data-day="${d}" data-p="${p}"></td>`;
      }
      html += `</tr>`;
    }
    html += `</tbody></table>`;
    gridEl.innerHTML = html;

    for (const td of gridEl.querySelectorAll('td[data-day]')) {
      const day = td.dataset.day; const p = parseInt(td.dataset.p, 10);
      const ids = idsInCellForRow(kind, key, day, p, idx);
      const stack = document.createElement('div');
      stack.className = 'cell-stack';
      if (ids.some(id => isSpanFill(id, day, p))) td.classList.add('spanfill');
      for (const id of ids) {
        if (isSpanFill(id, day, p)) {
          const card = renderLessonCard(id, kind, key, true);
          if (card) stack.appendChild(card);
        } else {
          const card = renderLessonCard(id, kind, key, false);
          if (card) stack.appendChild(card);
        }
      }
      td.innerHTML = '';
      td.appendChild(stack);
      td.ondragover = (ev) => {
        ev.preventDefault();
        td.classList.add('drop-hint');
        // v49: 3色リアルタイムプレビュー（メイングリッドと同仕様）
        const dragId = window._currentDragId;
        if (dragId && dragId !== td._previewId) {
          td._previewId = dragId;
          td.classList.remove('drag-preview-ok', 'drag-preview-warn', 'drag-preview-ng');
          // Remove old badge-style indicators
          td.querySelectorAll('.float-hover-badge').forEach(b => b.remove());
          try {
            const vTest = validatePlacement(dragId, day, p, 'safe', null);
            if (vTest.blocks.length) {
              td.classList.add('drag-preview-ng');
              td.title = '✗ ' + vTest.blocks[0];
            } else if (vTest.warns.length) {
              td.classList.add('drag-preview-warn');
              td.title = '△ ' + vTest.warns[0];
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
        td.querySelectorAll('.float-hover-badge').forEach(b => b.remove());
        if (typeof clearHoverSuggestion === 'function') {
          clearHoverSuggestion();
        }
      };
      td.ondrop = (ev) => {
        ev.preventDefault(); td.classList.remove('drop-hint');
        if (typeof clearHoverSuggestion === 'function') {
          clearHoverSuggestion();
        }
        const id = ev.dataTransfer.getData('text/plain') || ev.dataTransfer.getData('id') || window._currentDragId; if (!id) return;
        // Auto push-out: same logic as main grid
        const dropMode = state.ui.drop || 'safe';
        const v = validatePlacement(id, day, p, 'safe', null);
        if (v.blocks.length && dropMode === 'safe') {
          const it2 = state.items[id];
          const idxL = buildIndex();
          const blockers = new Set();
          if (it2) {
            for (const t of it2.teas || []) { (idxL.tea?.[t]?.[day]?.[p] || []).forEach(x => { if (x !== id && !state.placements[x]?.locked && !isSpanFill(x, day, p)) blockers.add(x); }); }
            for (const c of it2.cls || []) { (idxL.cls?.[c]?.[day]?.[p] || []).forEach(x => { if (x !== id && !state.placements[x]?.locked && !isSpanFill(x, day, p)) blockers.add(x); }); }
          }
          const movable = [...blockers];
          if (movable.length === 1) {
            const blkId = movable[0];
            pushHistory('auto-push');
            state.placements[blkId] = null;
            invalidateIndex();
            const v2 = validatePlacement(id, day, p, 'safe', null);
            if (v2.blocks.length === 0) {
              doPlace(id, day, p, null);
              const bsc = state.subjectCfg[state.items[blkId]?.subjKey] || {};
              flash(`「${bsc.abbr || state.items[blkId]?.subj || blkId}」を退避して配置`);
            } else {
              invalidateIndex(); rerenderAll();
              placeItem(id, day, p, { mode: dropMode });
            }
            return;
          }
        }
        placeItem(id, day, p, { mode: dropMode });
      };
      td.onclick = () => {
        const any = ids.find(x => !isSpanFill(x, day, p));
        if (state.ui.selectedId) {
          placeItem(state.ui.selectedId, day, p, { mode: state.ui.drop });
        } else if (any) {
          selectId(any, 'grid');
        }
      };
      td.oncontextmenu = (ev) => {
        ev.preventDefault();
        const any = ids.find(x => !isSpanFill(x, day, p));
        const menu = [];
        menu.push({ muted: true, label: `${DAYJP[day]}${p}` });
        if (any) {
          menu.push({ label: 'このコマを在庫へ', on: () => toStock(any) });
          menu.push({ label: 'このコマの提案', on: () => openPropSuggestions(any) });
        }
        showCtxMenu(menu, ev.clientX, ev.clientY);
      };
    }
  }
  function bindFloatContent(el, win, idx) {
    const stockBox = el.querySelector('[data-role="stock"]');
    const gridBox = el.querySelector('[data-role="grid"]');
    const cnt = el.querySelector('[data-role="count"]');
    const chk = el.querySelector('[data-role="showPlaced"]');
    const showPlaced = !!(win.showPlaced);
    if (chk) chk.checked = showPlaced;
    if (chk) {
      chk.onchange = () => {
        win.showPlaced = chk.checked;
        markDirty('ui');
        renderFloatLayer();
      };
    }
    // stock
    if (stockBox) {
      stockBox.ondragover = (ev) => { ev.preventDefault(); };
      stockBox.ondrop = (ev) => {
        ev.preventDefault();
        const id = ev.dataTransfer.getData('text/plain') || ev.dataTransfer.getData('id') || window._currentDragId;
        if (id) toStock(id);
      };
      const n = renderScopedStock(stockBox, win.kind, win.key, showPlaced);
      if (cnt) cnt.textContent = `(${n})`;
    }
    if (gridBox) {
      renderFloatGrid(gridBox, win.kind, win.key, idx);
    }
  }

