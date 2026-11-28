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
    // すぐ使える時間割表（掲示用・配布用）
    const isSheet = /^sheet-/.test(type);
    document.getElementById('view-print')?.classList.toggle('sheet-mode', isSheet);
    if (isSheet) {
      bindSheetOpts(); fillSheetOnly(type === 'sheet-teacher' ? 'teacher' : 'class');
      document.getElementById('view-print')?.classList.toggle('sheet-all', /^sheet-all-/.test(type)); // 一覧表では使わない項目を隠す
      renderSheets(area, type); return;
    }
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
      area.innerHTML = buildMatrixHTML(kind, keys, idx, maxP, opt, layout, matrixCellH, fontSize, Math.max(30, Math.min(120, Math.round(colW * 0.6))));
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


  /* =======================
     すぐ使える時間割表（掲示用・配布用）
     A4 にぴったり収まる表を、選択肢を数個選ぶだけで作る。
     文字の大きさは紙の大きさとコマ数から自動で決める（科目名が長いマスだけ自動で縮める）。
  ======================= */
  const SHEET_DEFAULTS = { paper: 'A4', fitOne: false, perPage: 1, color: 'color', name: 'auto', showTea: true, showRoom: false, showCls: true, showLunch: true, title: '', term: '', footer: '', grid: 'bold' };
  function sheetOpts() {
    state.settings.sheet = { ...SHEET_DEFAULTS, ...(state.settings.sheet || {}) };
    return state.settings.sheet;
  }
  // 全角英数字は半角に、半角カタカナ（ｺﾐ など）は全角に（印刷で読みやすく）
  const toHalf = (s) => String(s || '').replace(/[Ａ-Ｚａ-ｚ０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/[\uFF61-\uFF9F]+/g, k => k.normalize('NFKC'));
  // クラス名を読みやすく（1-1 → 1年1組）
  function sheetClassTitle(key) {
    const m = /^(\d)\s*-\s*(\d+)$/.exec(String(key));
    return m ? `${m[1]}年${m[2]}組` : String(key);
  }
  // 印刷する科目名。選択授業のコード（数学Ⅰ12・日世226 など）は、元の科目名に置き換える
  function sheetSubj(it, nameMode) {
    const scfg = state.subjectCfg[it.subjKey] || {};
    const real = String(it.realSubj || '').trim();
    const parts = real ? real.split(/\s*\/\s*/).filter(Boolean) : [];
    const abbrOf = (name) => { const c = state.subjectCfg[name]; return (c && c.abbr) ? c.abbr : displayAbbr({ subj: name, subjKey: name }, c); };
    if (parts.length > 1) {
      // 選択（生徒によって受ける科目が違う）
      const list = parts.map(p => nameMode === 'abbr' ? toHalf(abbrOf(p)) : toHalf(p));
      return { main: '選択', sub: list.join('・'), list, abbrList: parts.map(p => toHalf(abbrOf(p))), isChoice: true };
    }
    const base = parts[0] || it.subj || it.subjKey || '';
    if (nameMode === 'abbr') {
      // 略称がコードのまま（数学Ⅰ12 など）のときは、元の科目の略称を使う
      let a = scfg.abbr || '';
      if (!a || (parts[0] && /\d{2,}$/.test(a))) a = abbrOf(base);
      if ([...a].length > 6) a = displayAbbr({ subj: base, subjKey: base }, null); // 略称が長すぎる時（総合的な探究の時間→総探 など）
      return { main: toHalf(a), sub: '' };
    }

    const MAP = { '総合的な探究の時間': '総合的な探究', 'ＬＨＲ': 'LHR', 'ロングホームルーム': 'LHR' };
    const full = toHalf(MAP[base] || base);
    if (nameMode === 'auto') {
      // おまかせ: 正式名が長すぎてマスに1行で入らない時だけ略称にする（後で幅を見て決める）
      let a = scfg.abbr || '';
      if (!a || (parts[0] && /\d{2,}$/.test(a))) a = abbrOf(base);
      if ([...a].length > 6) a = displayAbbr({ subj: base, subjKey: base }, null);
      return { main: full, alt: toHalf(a), sub: '' };
    }
    return { main: full, sub: '' };
  }
  function sheetEsc(s) { return escapeHtml(String(s == null ? '' : s)); }
  // 1枚分の時間割表のHTML。w,h は mm
  function sheetHTML(kind, key, idx, o, w, h) {
    const maxP = Math.max(...DAYS.map(d => maxPeriod(d)));
    const lunch = o.showLunch ? Number(state.settings.lunchAfter || 0) : 0;
    const hasLunch = lunch > 0 && lunch < maxP;
    const school = o.title || state.settings.schoolName || '';
    const title = kind === 'class' ? sheetClassTitle(key) : `${key} 先生`;
    // 週の時間数（2連は2時間と数える）
    let hours = 0;
    const counted = new Set();
    for (const d of DAYS) for (let p = 1; p <= maxPeriod(d); p++) {
      for (const id of idsInCellForRow(kind, key, d, p, idx)) { const k = id + d + p; if (!counted.has(k)) { counted.add(k); hours++; } }
    }
    // 寸法（mm）: 見出し・曜日行・昼休み行・本体
    const headH = Math.min(18, Math.max(9, h * 0.09));
    const footH = o.footer || true ? Math.min(5, Math.max(3, h * 0.025)) : 0;
    const dayRowH = Math.min(10, Math.max(5, h * 0.05));
    const lunchH = hasLunch ? Math.min(6, Math.max(3, h * 0.03)) : 0;
    const bodyH = h - headH - footH - dayRowH - lunchH - 2;
    const rowH = bodyH / maxP;
    const perCol = DAYS.length;
    const pColW = Math.min(14, Math.max(7, w * 0.06));
    const colW = (w - pColW) / perCol;
    // 文字の大きさ（mm）。マスの高さと幅の小さい方に合わせる
    const subjFs = Math.max(2.4, Math.min(rowH * 0.34, colW * 0.17, 9));
    const subFs = Math.max(1.9, Math.min(subjFs * 0.52, 4.2));
    const titleFs = Math.min(headH * 0.62, 11);
    const textLen = (text) => [...String(text)].reduce((a, c) => a + (/[ -~｡-ﾟ]/.test(c) ? 0.55 : 1), 0);
    const fitsOneLine = (text, fs, widthMm) => textLen(text) * fs <= widthMm * 0.92;
    const fitFs = (text, base, widthMm) => {
      // 長い名前だけ、1〜2行で収まるよう縮める（全角1文字≒文字の大きさ1つ分の幅）
      const len = textLen(text);
      const oneLine = (widthMm * 0.92) / Math.max(1, len);
      if (oneLine >= base) return base;
      // 少し縮めれば1行に収まるなら1行にする（単語の途中で折り返すより読みやすい）
      if (oneLine >= base * 0.6) return oneLine;
      const twoLine = (widthMm * 0.92 * 2) / Math.max(1, len);
      return Math.max(base * 0.42, Math.min(base * 0.8, twoLine));
    };
    const color = o.color === 'color';
    const cellInner = (ids, rowsSpan) => {
      if (!ids.length) return '';
      const many = ids.length > 1;
      return ids.map(id => {
        const it = state.items[id]; if (!it) return '';
        const sj = sheetSubj(it, o.name);
        // クラスの表では「1年体育」の「1年」は言わなくても分かるので省く
        if (kind === 'class' && !sj.isChoice) sj.main = sj.main.replace(/^[1-6１-６]\s*年?\s*(?=[^\d\s・-]{2})/, '');
        const lines = [];
        const k = many ? 0.62 : 1;
        const baseFs = subjFs * k * (rowsSpan > 1 ? 1.1 : 1);
        // おまかせ: 正式名が少し縮めても1行に入らない時は略称にする（2行に折れるより読みやすい）
        if (sj.alt && sj.alt !== sj.main && !fitsOneLine(sj.main, baseFs * 0.78, colW - 2)) {
          sj.main = kind === 'class' ? sj.alt.replace(/^[1-6１-６]\s*年?\s*(?=[^\d\s・-]{2})/, '') : sj.alt;
        }
        let main = sj.main;
        // 先生が多い授業（体育など）は「西村 ほか3名」とまとめる（4人並べると字が小さくなりすぎる）
        const teaLabel = (ts) => ts.length > 2 ? `${ts[0]} ほか${ts.length - 1}名` : ts.join('・');
        let listHtml = '';
        if (kind === 'teacher') {
          // 先生の表: 大きくクラス、小さく科目
          // クラスは省略せずに書く（同じ学年はまとめて 3-3,4,5）
          const byG = {};
          for (const c of (it.cls || [])) { const m = /^(\d+)-(.+)$/.exec(c); if (m) (byG[m[1]] ||= []).push(m[2]); else (byG[c] ||= []); }
          const c = Object.entries(byG).map(([g, ns]) => ns.length ? `${g}-${ns.join(',')}` : g).join(' ');
          main = c || sj.main;
          if (c && c !== sj.main) lines.push(sj.main + (sj.sub ? `（${sj.sub}）` : '')); // クラスが無い授業（会議など）は名前を2回書かない
        } else {
          if (sj.isChoice) {
            // 選択: 科目を1つずつ行に分けて書く（3つまで。多い時は略称で1行に）
            const names = (sj.list.length <= 3 && sj.list.every(n => fitsOneLine(n, subFs * k * 1.05, colW - 2))) ? sj.list
              : [(sj.abbrList || sj.list).join('・')];
            listHtml = names; // 大きさは下で、マスの高さに入るように決める
          }
          if (o.showTea && (it.teas || []).length) lines.push(teaLabel(it.teas || []));
        }
        // 教室: クラスの教室（1-1 など、クラス名と同じもの）は書かなくても分かるので省く
        if (o.showRoom) { const rs = (it.rooms || []).filter(r => r !== key && !(it.cls || []).includes(r)); if (rs.length) lines.push(rs.join('・')); }
        const choiceView = sj.isChoice && kind === 'class'; // クラスの表の「選択」だけ、見出しを小さくして科目名を並べる
        let fsMain = choiceView ? Math.min(baseFs * 0.62, subFs * 1.5) : fitFs(main, baseFs, colW - 2);
        let fsSub = Math.max(Math.min(subFs * k, fsMain * 0.8), 2.1 * k);
        const choiceNames = Array.isArray(listHtml) ? listHtml : [];
        const subLines = lines.filter(Boolean);
        let fsChoice = choiceNames.map(n => fitFs(n, subFs * k * 1.05, colW - 2));
        let fsLines = subLines.map(l => fitFs(l, fsSub, colW - 2));
        // マスの高さに入るか確かめ、入らなければ全体を同じ割合で小さくする（行が伸びて表が紙からはみ出さないように）
        const W = (colW - 2) * 0.92;
        const nLines = (t, f) => Math.max(1, Math.ceil(textLen(t) * f / W)); // 折り返して何行になるか
        const needOf = () => fsMain * 1.12 * nLines(main, fsMain) + choiceNames.reduce((a, n, i) => a + fsChoice[i] * 1.2 * nLines(n, fsChoice[i]), 0) + subLines.reduce((a, l, i) => a + fsLines[i] * 1.25 * nLines(l, fsLines[i]), 0) + 1.4;
        const avail = (rowH * rowsSpan - 0.8) / (many ? ids.length : 1);
        for (let tries = 0; tries < 6 && needOf() > avail; tries++) {
          const r = Math.max(0.6, avail / needOf());
          fsMain *= r; fsChoice = fsChoice.map(f => f * r); fsLines = fsLines.map(f => f * r);
        }
        listHtml = choiceNames.map((n, i) => `<div class="ks-choice" style="font-size:${fsChoice[i].toFixed(2)}mm">${sheetEsc(n)}</div>`).join('');
        const subHtml = subLines.map((l, i) => `<div class="ks-sub" style="font-size:${fsLines[i].toFixed(2)}mm">${sheetEsc(l)}</div>`).join('');
        const col = color ? (state.subjectCfg[it.subjKey]?.color || pickColor(it.subjKey)) : '';
        const st = color ? `style="--ks-c:${col};--ks-bg:${paleColor(col, 0.16)}"` : '';
        return `<div class="ks-item${many ? ' ks-many' : ''}${choiceView ? ' ks-is-choice' : ''}" ${st}><div class="ks-main" style="font-size:${fsMain.toFixed(2)}mm">${sheetEsc(main)}</div>${listHtml}${subHtml}</div>`;
      }).join('');
    };
    let rows = '';
    const skip = {}; // 2連でまとめたマス
    for (let p = 1; p <= maxP; p++) {
      let tr = `<tr style="height:${rowH.toFixed(2)}mm"><th class="ks-p"><span style="font-size:${Math.min(rowH * 0.32, 6).toFixed(2)}mm">${p}</span></th>`;
      for (const d of DAYS) {
        if (skip[d + p]) continue;
        if (p > maxPeriod(d)) { tr += `<td class="ks-none"></td>`; continue; }
        const ids = idsInCellForRow(kind, key, d, p, idx);
        // 2連（同じ授業が続けて2時間）は1つのマスにまとめる。ただし昼休みをまたぐ場合はまとめない
        let span = 1;
        if (ids.length === 1 && (state.items[ids[0]]?.span || 1) === 2 && state.placements[ids[0]]?.period === p && p + 1 <= maxPeriod(d) && !(hasLunch && p === lunch)) {
          const nx = idsInCellForRow(kind, key, d, p + 1, idx);
          if (nx.length === 1 && nx[0] === ids[0]) { span = 2; skip[d + (p + 1)] = true; }
        }
        tr += `<td class="ks-c${ids.length ? '' : ' ks-empty'}"${span > 1 ? ` rowspan="${span}"` : ''}>${cellInner(ids, span)}</td>`;
      }
      rows += tr + '</tr>';
      if (hasLunch && p === lunch) rows += `<tr class="ks-lunch" style="height:${lunchH.toFixed(2)}mm"><td colspan="${DAYS.length + 1}"><span style="font-size:${Math.min(lunchH * 0.62, 3.4).toFixed(2)}mm">昼休み</span></td></tr>`;
    }
    const today = new Date();
    const dateStr = `${today.getFullYear()}年${today.getMonth() + 1}月${today.getDate()}日 作成`;
    return `<div class="ks-sheet ks-grid-${o.grid}${color ? ' ks-color' : ' ks-mono'}" style="width:${w}mm;height:${h}mm">
      <div class="ks-head" style="height:${headH.toFixed(2)}mm">
        <div class="ks-title" style="font-size:${titleFs.toFixed(2)}mm">${sheetEsc(title)}</div>
        <div class="ks-meta" style="font-size:${Math.min(headH * 0.3, 4).toFixed(2)}mm">${school ? `<div>${sheetEsc(school)}</div>` : ''}${o.term ? `<div>${sheetEsc(o.term)}</div>` : ''}</div>
        <div class="ks-hours" style="font-size:${Math.min(headH * 0.28, 3.6).toFixed(2)}mm">週 ${hours} 時間</div>
      </div>
      <table class="ks-table" style="height:${(h - headH - footH - 1).toFixed(2)}mm">
        <colgroup><col style="width:${pColW.toFixed(2)}mm">${DAYS.map(() => `<col style="width:${colW.toFixed(2)}mm">`).join('')}</colgroup>
        <thead><tr style="height:${dayRowH.toFixed(2)}mm"><th class="ks-corner"></th>${DAYS.map(d => `<th class="ks-day" style="font-size:${Math.min(dayRowH * 0.55, 6).toFixed(2)}mm">${DAYJP[d]}</th>`).join('')}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="ks-foot" style="height:${footH.toFixed(2)}mm;font-size:${Math.min(footH * 0.6, 2.6).toFixed(2)}mm"><span>${sheetEsc(o.footer || '')}</span><span>${dateStr}</span></div>
    </div>`;
  }
  // 全ページのHTML（A4、余白10mm。1ページに1・2・4枚）
  /* 学校全体の一覧表（全クラス／全教員を1枚に並べる。行が多すぎる時は自動でページを分ける） */
  function matrixSheetHTML(kind, keys, idx, o, w, h, pageNo, pageCount) {
    const days = DAYS.filter(d => maxPeriod(d) > 0);
    const cols = []; // [{d,p}]
    for (const d of days) for (let p = 1; p <= maxPeriod(d); p++) cols.push({ d, p });
    const lunch = o.showLunch ? Number(state.settings.lunchAfter || 0) : 0;
    const school = o.title || state.settings.schoolName || '';
    const headH = Math.min(14, Math.max(8, h * 0.05));
    const footH = 3.5;
    const hdrH = Math.min(12, Math.max(7, h * 0.045)); // 曜日＋時限の2段
    const labW = Math.min(kind === 'class' ? 16 : 20, Math.max(10, w * 0.055));
    const cw = (w - labW) / cols.length;
    const rowH = (h - headH - footH - hdrH - 1.5) / keys.length;
    const textLen = (t) => [...String(t)].reduce((a, c) => a + (/[ -~｡-ﾟ]/.test(c) ? 0.55 : 1), 0);
    const fit = (t, base, wmm) => Math.max(base * 0.45, Math.min(base, (wmm * 0.9) / Math.max(1, textLen(t))));
    const mainBase = Math.max(1.8, Math.min(rowH * 0.46, cw * 0.36, 5));
    const subBase = Math.max(1.4, Math.min(rowH * 0.3, mainBase * 0.72));
    const showSub = rowH >= 4.6; // 行がとても低い時だけ2行目（先生・科目）を出さない
    const color = o.color === 'color';
    const cellFor = (ids, span) => {
      if (!ids.length) return '';
      const W = cw * span - 0.8;
      return ids.map(id => {
        const it = state.items[id]; if (!it) return '';
        const sj = sheetSubj(it, 'abbr');
        let main, sub = '';
        if (kind === 'class') {
          main = sj.isChoice ? '選択' : sj.main.replace(/^[1-6１-６]\s*年?\s*(?=[^\d\s・-]{2})/, '');
          if (o.showTea && (it.teas || []).length) sub = it.teas.length > 1 ? `${it.teas[0]}他` : it.teas[0];
        } else {
          main = (it.cls || []).length ? compactClsLabel(it.cls) : sj.main;
          if (main !== sj.main) sub = sj.isChoice ? '選択' : sj.main;
        }
        const k = ids.length > 1 ? 0.7 : 1;
        const fm = fit(main, mainBase * k, W), fs = fit(sub, subBase * k, W);
        const col = color ? (state.subjectCfg[it.subjKey]?.color || pickColor(it.subjKey)) : '';
        const st = color ? ` style="--ks-c:${col};--ks-bg:${paleColor(col, 0.2)}"` : '';
        return `<div class="km-it"${st}><div class="km-m" style="font-size:${fm.toFixed(2)}mm">${sheetEsc(main)}</div>${showSub && sub && ids.length === 1 ? `<div class="km-s" style="font-size:${fs.toFixed(2)}mm">${sheetEsc(sub)}</div>` : ''}</div>`;
      }).join('');
    };
    let body = '';
    let prevGrade = null;
    for (const key of keys) {
      const g = kind === 'class' ? (/^(\d+)-/.exec(key) || [])[1] : null;
      const sep = prevGrade != null && g != null && g !== prevGrade; // 学年の変わり目は太線
      prevGrade = g;
      let tr = `<tr class="${sep ? 'km-gsep' : ''}" style="height:${rowH.toFixed(2)}mm"><th class="km-lab" style="font-size:${Math.min(rowH * 0.42, labW * 0.22, 4.6).toFixed(2)}mm">${sheetEsc(kind === 'class' ? key : key)}</th>`;
      for (let i = 0; i < cols.length; i++) {
        const { d, p } = cols[i];
        const ids = idsInCellForRow(kind, key, d, p, idx);
        let span = 1;
        // 2連は横につなげる（昼休みをまたぐ場合はつなげない）
        if (ids.length === 1 && i + 1 < cols.length && cols[i + 1].d === d && !(lunch && p === lunch)) {
          const nx = idsInCellForRow(kind, key, d, p + 1, idx);
          if (nx.length === 1 && nx[0] === ids[0] && state.placements[ids[0]]?.period === p) span = 2;
        }
        const cls = ['km-c', p === 1 ? 'km-dstart' : '', (lunch && p === lunch + 1) ? 'km-lunch' : ''].filter(Boolean).join(' ');
        // 色はマス全体に塗る（中の文字の箱だけだと、まだらに見える）
        const it0 = ids.length === 1 ? state.items[ids[0]] : null;
        const bg = (it0 && o.color === 'color') ? ` style="background:${paleColor(state.subjectCfg[it0.subjKey]?.color || pickColor(it0.subjKey), 0.2)}"` : '';
        tr += `<td class="${cls}"${span > 1 ? ` colspan="2"` : ''}${bg}>${cellFor(ids, span)}</td>`;
        i += span - 1;
      }
      body += tr + '</tr>';
    }
    const hd1 = days.map(d => `<th class="km-day km-dstart" colspan="${maxPeriod(d)}" style="font-size:${Math.min(hdrH * 0.36, 4.4).toFixed(2)}mm">${DAYJP[d]}</th>`).join('');
    const hd2 = cols.map(({ d, p }) => `<th class="km-per${p === 1 ? ' km-dstart' : ''}${(lunch && p === lunch + 1) ? ' km-lunch' : ''}" style="font-size:${Math.min(hdrH * 0.3, cw * 0.4, 3.4).toFixed(2)}mm">${p}</th>`).join('');
    const today = new Date();
    const title = kind === 'class' ? '全校時間割（クラス別）' : '全校時間割（先生別）';
    return `<div class="ks-sheet km-sheet ks-grid-${o.grid}${color ? ' ks-color' : ' ks-mono'}" style="width:${w}mm;height:${h}mm">
      <div class="ks-head" style="height:${headH.toFixed(2)}mm">
        <div class="ks-title" style="font-size:${Math.min(headH * 0.6, 9).toFixed(2)}mm">${title}</div>
        <div class="ks-meta" style="font-size:${Math.min(headH * 0.3, 4).toFixed(2)}mm">${school ? `<div>${sheetEsc(school)}</div>` : ''}${o.term ? `<div>${sheetEsc(o.term)}</div>` : ''}</div>
        ${pageCount > 1 ? `<div class="ks-hours" style="font-size:${Math.min(headH * 0.3, 3.6).toFixed(2)}mm">${pageNo} / ${pageCount}</div>` : ''}
      </div>
      <table class="ks-table km-table">
        <colgroup><col style="width:${labW.toFixed(2)}mm">${cols.map(() => `<col style="width:${cw.toFixed(3)}mm">`).join('')}</colgroup>
        <thead><tr style="height:${(hdrH * 0.55).toFixed(2)}mm"><th class="ks-corner km-lab" rowspan="2" style="font-size:${Math.min(hdrH * 0.3, 3.4).toFixed(2)}mm">${kind === 'class' ? 'クラス' : '先生'}</th>${hd1}</tr><tr style="height:${(hdrH * 0.45).toFixed(2)}mm">${hd2}</tr></thead>
        <tbody>${body}</tbody>
      </table>
      <div class="ks-foot" style="height:${footH}mm;font-size:2.4mm"><span>${sheetEsc(o.footer || '')}</span><span>${today.getFullYear()}年${today.getMonth() + 1}月${today.getDate()}日 作成</span></div>
    </div>`;
  }
  function renderSheets(area, type) {
    const o = sheetOpts();
    const kind = (type === 'sheet-teacher' || type === 'sheet-all-teacher') ? 'teacher' : 'class';
    const isAll = type === 'sheet-all-class' || type === 'sheet-all-teacher';
    const orient = $('#print-page-orient')?.value || 'landscape';
    const A3 = o.paper === 'A3';
    const S1 = A3 ? 420 : 297, S2 = A3 ? 297 : 210;
    const PW = orient === 'landscape' ? S1 : S2, PH = orient === 'landscape' ? S2 : S1, M = 10, G = 6;
    const pageStyle = () => {
      let pStyle = document.getElementById('print-page-style');
      if (!pStyle) { pStyle = document.createElement('style'); pStyle.id = 'print-page-style'; document.head.appendChild(pStyle); }
      pStyle.textContent = `@media print { @page { size: ${A3 ? 'A3' : 'A4'} ${orient}; margin: 0; } }`;
    };
    if (isAll) {
      // 一覧表: 行が低くなりすぎる（読めない）時だけページを分ける。分ける時は各ページの行数をそろえる
      const idx0 = buildIndex();
      let keysAll = getAxisKeys(kind).filter(k => DAYS.some(d => { for (let p = 1; p <= maxPeriod(d); p++) if (idsInCellForRow(kind, k, d, p, idx0).length) return true; return false; }));
      // クラス一覧には「1-1」の形の普通のクラスだけを載せる（学務G などの会議は先生一覧で見える）
      if (kind === 'class' && keysAll.some(k => /^\d+-\d+$/.test(k))) keysAll = keysAll.filter(k => /^\d+-\d+$/.test(k));
      const w = PW - M * 2, h = PH - M * 2;
      const usable = h - Math.min(14, Math.max(8, h * 0.05)) - 3.5 - Math.min(12, Math.max(7, h * 0.045)) - 1.5;
      const minRow = 5.2; // これより低いと字が小さすぎる（A3縦なら先生70人ほどまで1枚に入る）
      // 「1枚に収める」を選んだ時は、行がどれだけ低くなっても1ページにする
      const pages = o.fitOne ? 1 : Math.max(1, Math.ceil(keysAll.length * minRow / usable));
      const per = Math.ceil(keysAll.length / pages);
      let html = '';
      for (let i = 0; i < pages; i++) {
        const chunk = keysAll.slice(i * per, (i + 1) * per); if (!chunk.length) continue;
        html += `<div class="ks-page" style="width:${PW}mm;height:${PH - 0.6}mm;padding:${M}mm;grid-template-columns:${w}mm;grid-template-rows:${h}mm;gap:0">${matrixSheetHTML(kind, chunk, idx0, o, w, h, i + 1, pages)}</div>`;
      }
      area.innerHTML = html || '<div class="card">印刷する時間割がありません</div>';
      pageStyle();
      const info = document.getElementById('sheet-count');
      const hint = pages > 1 ? (kind === 'teacher' && !(A3 && orient === 'portrait') ? '（A3の縦にすると1枚に入りやすくなります）' : !A3 ? '（A3にすると枚数が減ります）' : '') : '';
      if (info) info.textContent = `${keysAll.length}${kind === 'class' ? 'クラス' : '人'}・${pages}ページ${hint}`;
      return;
    }
    const per = [1, 2, 4].includes(Number(o.perPage)) ? Number(o.perPage) : 1;
    // 2枚: 横向きなら左右、縦向きなら上下に並べる
    const cols = per === 1 ? 1 : per === 4 ? 2 : (orient === 'landscape' ? 2 : 1);
    const rowsN = per / cols;
    const w = (PW - M * 2 - G * (cols - 1)) / cols, h = (PH - M * 2 - G * (rowsN - 1)) / rowsN;
    let keys = getAxisKeys(kind);
    const only = (state.ui.sheetOnly || '').trim();
    if (only) keys = keys.filter(k => k === only);
    // 授業が1つもない行（未設定の教員など）は印刷しない
    const idx = buildIndex();
    keys = keys.filter(k => DAYS.some(d => { for (let p = 1; p <= maxPeriod(d); p++) if (idsInCellForRow(kind, k, d, p, idx).length) return true; return false; }));
    let html = '';
    for (let i = 0; i < keys.length; i += per) {
      const chunk = keys.slice(i, i + per);
      // 高さは紙よりわずかに小さくする（ぴったりだと端数で次のページにはみ出し、白紙ができる）
      html += `<div class="ks-page" style="width:${PW}mm;height:${PH - 0.6}mm;padding:${M}mm;grid-template-columns:repeat(${cols},${w.toFixed(2)}mm);grid-template-rows:repeat(${rowsN},${h.toFixed(2)}mm);gap:${G}mm">${chunk.map(k => sheetHTML(kind, k, idx, o, w, h)).join('')}</div>`;
    }
    area.innerHTML = html || '<div class="card">印刷する時間割がありません</div>';
    pageStyle();
    const info = document.getElementById('sheet-count');
    if (info) info.textContent = keys.length ? `${keys.length}${kind === 'class' ? 'クラス' : '人'}・${Math.ceil(keys.length / per)}ページ` : '';
  }
  // 設定欄（掲示用の時だけ表示）
  function bindSheetOpts() {
    const box = document.getElementById('sheet-opts'); if (!box) return;
    // 表示のたびに、今の設定を欄に反映する（別のファイルを読み込んだ時などにずれないように）
    const o = sheetOpts();
    box.querySelectorAll('[data-sk]').forEach(el => {
      const k = el.dataset.sk;
      if (el.type === 'checkbox') el.checked = !!o[k];
      else if (el.type === 'radio') el.checked = String(o[k]) === el.value;
      else if (document.activeElement !== el) el.value = o[k] ?? '';
    });
    if (box._bound) return;
    box._bound = true;
    const set = (k, v) => { sheetOpts()[k] = v; markDirty('ui'); renderPrint(); };
    box.querySelectorAll('[data-sk]').forEach(el => {
      const k = el.dataset.sk;
      if (el.type === 'checkbox') el.addEventListener('change', () => set(k, el.checked));
      else if (el.type === 'radio') el.addEventListener('change', () => { if (el.checked) set(k, el.value); });
      else el.addEventListener('change', () => set(k, el.value));
    });
    const only = document.getElementById('sheet-only');
    if (only) only.addEventListener('change', () => { state.ui.sheetOnly = only.value; markDirty('ui'); renderPrint(); });
  }
  function fillSheetOnly(kind) {
    const sel = document.getElementById('sheet-only'); if (!sel) return;
    const keys = getAxisKeys(kind);
    const want = (kind === 'class' ? 'すべてのクラス' : 'すべての先生');
    const sig = kind + keys.join('|');
    if (sel._sig !== sig) {
      sel._sig = sig;
      sel.innerHTML = `<option value="">${want}</option>` + keys.map(k => `<option value="${escapeAttr(k)}">${escapeHtml(kind === 'class' ? sheetClassTitle(k) : k)}</option>`).join('');
    }
    if (state.ui.sheetOnly && !keys.includes(state.ui.sheetOnly)) state.ui.sheetOnly = '';
    sel.value = state.ui.sheetOnly || '';
  }
