  /* =======================
     Wiring / Init
  ======================= */
  function bindEvents() {

    // Helper: safe selector with null check
    const safeGet = (sel) => {
      const el = $(sel);
      if (!el) console.warn(`[bindEvents] Element not found: ${sel}`);
      return el;
    };

    // tabs
    $$('.tab').forEach(b => b.onclick = () => switchTab(b.dataset.tab));

    // version info (click on header version number)
    const verEl = document.querySelector('.brand .ver');
    if (verEl) verEl.onclick = () => showVersionInfo();

    // undo redo reset
    const btnUndo = safeGet('#btn-undo');
    const btnRedo = safeGet('#btn-redo');
    const btnReset = safeGet('#btn-reset');
    if (btnUndo) btnUndo.onclick = undo;
    if (btnRedo) btnRedo.onclick = redo;
    if (btnReset) btnReset.onclick = () => {
      showModal('全リセット', '保存データも含め全て消します。よろしいですか？', () => {
        localStorage.removeItem(LS_KEY);
        historyPast = []; historyFuture = [];
        state.rawRows = []; state.items = {}; state.placements = {}; state.subjectCfg = {}; state.teacherCfg = {};
        state.snapshots = [];
        markDirty('reset');
        addRow();
        switchTab('input');
      });
    };


    // subject/teacher fold (tile)
    const subjContainer = safeGet('#subject-container');
    if (subjContainer) subjContainer.addEventListener('click', (ev) => {
      const btn = ev.target.closest('button[data-act="subj_fold"]');
      if (!btn) return;
      const key = btn.dataset.key;
      state.ui.subjExpanded ??= {};
      state.ui.subjExpanded[key] = !state.ui.subjExpanded[key];
      markDirty('ui');
      renderSubjectSettings();
    });
    const teaContainer = safeGet('#teacher-container');
    if (teaContainer) teaContainer.addEventListener('click', (ev) => {
      const btn = ev.target.closest('button[data-act="tea_fold"]');
      if (!btn) return;
      const key = btn.dataset.key;
      state.ui.teaExpanded ??= {};
      state.ui.teaExpanded[key] = !state.ui.teaExpanded[key];
      markDirty('ui');
      renderTeacherSettings();
    });

    // input
    const btnAddRow = safeGet('#btn-add-row');
    const btnReflect = safeGet('#btn-reflect');
    const btnDataAnalyze = safeGet('#btn-data-analyze');
    const btnExport = safeGet('#btn-export');
    const btnImport = safeGet('#btn-import');
    const csvFile = safeGet('#csv-file');

    if (btnAddRow) btnAddRow.onclick = addRow;
    if (btnReflect) btnReflect.onclick = () => {
      // イデア読込の同時展開(相乗り)配置はrawRowsに完全表現できないため、
      // 再構築で失われる可能性がある場合は確認する。
      const hasSimul = Object.values(state.items || {}).some(it => it && it.simul);
      const doReflect = () => { reflectRawToItems({ keepSelection: true }); switchTab('edit'); };
      if (hasSimul) {
        showModalHTML('作成画面へ反映',
          '<div style="line-height:1.7">データ入力の内容から時間割を再構築します。<br>' +
          '<span style="color:#b45309">⚠ イデア読込の<strong>同時展開（相乗り）授業</strong>は、データ入力の行だけでは完全に再現できないため、' +
          '相乗りの配置情報が簡略化される場合があります。</span><br>' +
          '（読込直後の時間割をそのまま使う場合は「作成画面」タブへ直接切り替えてください。）</div>',
          doReflect, '再構築する', 'キャンセル');
      } else { doReflect(); }
    };
    if (btnDataAnalyze) btnDataAnalyze.onclick = () => showDataAnalysis();
    if (btnExport) btnExport.onclick = exportCSV;
    if (btnImport) btnImport.onclick = () => { const f = safeGet('#csv-file'); if (f) f.click(); };
    // Excelの様式: データがある時は「空の様式」か「今のデータ入り」かを選ぶ
    $('#btn-xl-template')?.addEventListener('click', (ev) => {
      if (!(state.rawRows || []).length) { exportExcelTemplate(false); return; }
      showCtxMenu([
        { act: 'xl-blank', label: '空の様式（書き方の見本つき）', on: () => exportExcelTemplate(false) },
        { act: 'xl-data', label: `今のデータ入り（${state.rawRows.length}行）`, on: () => exportExcelTemplate(true) },
      ], ev.clientX, ev.clientY);
    });
    $('#btn-xl-import')?.addEventListener('click', () => $('#xl-file')?.click());
    $('#xl-file')?.addEventListener('change', async (ev) => { const f = ev.target.files?.[0]; ev.target.value = ''; if (f) await importExcelFile(f); });
    if (csvFile) csvFile.onchange = async (ev) => {
      const f = ev.target.files?.[0]; if (!f) return;
      const enc = $('#csv-enc').value;
      const text = await readFileText(f, enc);
      importCSVText(text);
      ev.target.value = '';
    };

    // school
    const btnSchoolDefault = safeGet('#btn-school-default');
    if (btnSchoolDefault) btnSchoolDefault.onclick = () => {
      pushHistory('schoolDefault');
      state.settings.periodsByDay = { Mon: 7, Tue: 6, Wed: 6, Thu: 6, Fri: 6 };
      state.settings.lunchAfter = 4;
      state.settings.roomConflict = true;
      state.settings.teaDefaultMaxDaily = null;
      state.settings.teaDefaultMaxConsec = 4;
      markDirty('schoolDefault');
      renderSchoolSettings();
    };
    ['#p-mon', '#p-tue', '#p-wed', '#p-thu', '#p-fri', '#p-sat', '#lunch-after', '#chk-room-conflict', '#school-tea-maxdaily', '#school-tea-maxconsec']
      .forEach(sel => {
        const el = $(sel);
        if (el) el.addEventListener('change', gatherSchoolSettings);
        else console.warn(`[bindEvents] Not found: ${sel}`);
      });

    // teacher/subject global clear
    const btnSubClearall = safeGet('#btn-sub-clearall');
    if (btnSubClearall) btnSubClearall.onclick = () => {
      pushHistory('subClearAll');
      for (const k in state.subjectCfg) state.subjectCfg[k].fixedForbid = {};
      markDirty('subClearAll'); rerenderAll();
    };

    // v61: subject batch rules
    const btnSubBatchApply = safeGet('#btn-sub-batch-apply');
    if (btnSubBatchApply) btnSubBatchApply.onclick = () => {
      const selNoSame = $('#sub-batch-nosameday');
      const selNoConsec = $('#sub-batch-noconsec');
      const inpMax = $('#sub-batch-maxperday');
      const vNoSame = selNoSame?.value || 'keep';
      const vNoConsec = selNoConsec?.value || 'keep';
      const vMaxRaw = (inpMax?.value ?? '').toString().trim();

      const keys = Object.keys(state.subjectCfg);
      if (!keys.length) { flash('科目設定がありません。先にデータ登録を保存してください。'); return; }
      if (vNoSame === 'keep' && vNoConsec === 'keep' && vMaxRaw === '') { flash('変更なし'); return; }

      pushHistory('subBatch');
      for (const k of keys) {
        const cfg = state.subjectCfg[k];
        if (vNoSame !== 'keep') cfg.noSameDay = (vNoSame === '1');
        if (vNoConsec !== 'keep') cfg.noConsec = (vNoConsec === '1');
        if (vMaxRaw !== '') {
          const n = Number(vMaxRaw);
          cfg.maxPerDay = (!Number.isFinite(n) || n <= 0) ? null : clamp(Math.round(n), 1, 30);
        }
      }
      markDirty('subj');
      renderSubjectSettings();
      flash(`科目設定を一括適用しました（${keys.length}科目）`);
    };

    // v61: bulk place fixed-slot subjects (allowedMode)
    const btnSubPlaceFixed = safeGet('#btn-sub-place-fixed');
    if (btnSubPlaceFixed) btnSubPlaceFixed.onclick = () => {
      const keys = Object.keys(state.subjectCfg).filter(k => {
        const cfg = state.subjectCfg[k] || {};
        return !!cfg.allowedMode && cfg.allowedSlots && Object.keys(cfg.allowedSlots).some(d => (cfg.allowedSlots[d] || []).length);
      });
      if (!keys.length) { flash('許可枠モード（緑）を設定している科目がありません'); return; }
      showModal('固定枠科目 一括配置', `許可枠モードを設定している${keys.length}科目について、未配置/禁制のコマを一括配置します。\n（動かない場合は「科目設定」カード内の📌ボタンで個別に試してください）`, () => {
        pushHistory('bulkFixedSubj');
        let ok = 0, fail = 0;
        for (const k of keys) {
          const res = bulkPlaceSubject(k, { includePlaced: false, silent: true, skipHistory: true, noRender: true });
          if (res?.placed > 0) ok++;
          if (res?.failed > 0) fail++;
        }
        invalidateIndex();
        markDirty('place');
        rerenderAll();
        broadcastState();
        flash(`固定枠一括配置: 成功 ${ok}科目 / 失敗あり ${fail}科目`);
      });
    };

    // v33.0: bulk set noSameDay
    const btnSubNoSameDay = safeGet('#btn-sub-noSameDay-all');
    if (btnSubNoSameDay) btnSubNoSameDay.onclick = () => {
      const cnt = Object.keys(state.subjectCfg).length;
      if (!cnt) { flash('科目設定がありません。先にデータ登録を保存してください。'); return; }
      showModal('同日複数：一括不可', `全${cnt}科目について「同日複数配置を不可」に設定します。`, () => {
        pushHistory('noSameDayAll');
        for (const k in state.subjectCfg) state.subjectCfg[k].noSameDay = true;
        markDirty('noSameDayAll'); rerenderAll();
        flash(`${cnt}科目に同日複数不可を設定しました`);
      });
    };

    // v33.0: auto color by dept
    const btnSubColorAuto = safeGet('#btn-sub-color-auto');
    if (btnSubColorAuto) btnSubColorAuto.onclick = () => {
      const cnt = Object.keys(state.subjectCfg).length;
      if (!cnt) { flash('科目設定がありません。'); return; }
      pushHistory('colorAuto');
      for (const k in state.subjectCfg) {
        state.subjectCfg[k].color = pickColor(k); // regenerate based on dept
      }
      markDirty('colorAuto'); rerenderAll();
      flash(`${cnt}科目の色を教科別に自動設定しました`);
    };

    const btnTeaInferdept = safeGet('#btn-tea-inferdept');
    if (btnTeaInferdept) btnTeaInferdept.onclick = () => {
      pushHistory('inferDept');
      for (const k of Object.keys(state.teacherCfg)) {
        const cfg = state.teacherCfg[k];
        if (!(cfg.dept || '').trim()) {
          const inf = inferTeacherDept(k);
          if (inf) cfg.dept = inf;
        }
      }
      markDirty('tea');
      renderTeacherSettings();
      flash('教科(参考)を推定して入力しました（空欄のみ）');
    };

    const btnTeaClearall = safeGet('#btn-tea-clearall');
    if (btnTeaClearall) btnTeaClearall.onclick = () => {
      pushHistory('teaClearAll');
      for (const k in state.teacherCfg) state.teacherCfg[k].unavailable = {};
      markDirty('teaClearAll'); rerenderAll();
    };

    // teacher sort buttons
    ['#btn-tea-sort-name', '#btn-tea-sort-dept'].forEach(sel => {
      const btn = safeGet(sel);
      if (!btn) return;
      btn.onclick = () => {
        const col = btn.dataset.teaSort;
        if (_teaSort.col === col) { _teaSort.dir = _teaSort.dir === 'asc' ? 'desc' : 'asc'; }
        else { _teaSort.col = col; _teaSort.dir = 'asc'; }
        updateTeaSortButtons();
        renderTeacherSettings();
      };
    });
    updateTeaSortButtons();

    // input table sort toolbar
    bindSortToolbar();
    updateSortButtons();


    // fold (科目/教員設定の折りたたみ) - duplicate handlers, keep only one
    // (already bound above)


    // edit radios and controls
    $$('input[name="viewmode"]').forEach(r => r.onchange = () => { state.ui.viewMode = r.value; markDirty('ui'); rerenderEdit(); });
    $$('input[name="tool"]').forEach(r => r.onchange = () => { state.ui.tool = r.value; });
    $$('input[name="drop"]').forEach(r => r.onchange = () => { state.ui.drop = r.value; });

    const showPlaced = safeGet('#show-placed');
    const groupStock = safeGet('#group-stock');
    const stockSearch = safeGet('#stock-search');
    const rowFilter = safeGet('#row-filter');

    if (showPlaced) showPlaced.onchange = () => { state.ui.showPlaced = showPlaced.checked; renderStock(); };
    if (groupStock) groupStock.onchange = () => { state.ui.groupStock = groupStock.checked; renderStock(); };
    if (stockSearch) stockSearch.oninput = () => { state.ui.stockSearch = stockSearch.value; renderStock(); };

    // v45: 複数選択バー
    // v47-B5: 在庫一括選択ボタン
    document.getElementById('btn-stock-sel-all')?.addEventListener('click', () => {
      _stockSelectAll('displayed');
    });
    document.getElementById('btn-stock-sel-dept')?.addEventListener('click', () => {
      _stockSelectAll('dept');
    });
    document.getElementById('btn-stock-sel-cls')?.addEventListener('click', () => {
      _stockSelectAll('cls');
    });

    document.getElementById('btn-stock-multi-ai')?.addEventListener('click', () => {
      const sel = state.ui.stockMultiSel;
      if (!sel?.size) { flash('コマが選択されていません (Ctrl+クリックで選択)'); return; }
      aiPlaceSelected(sel);
    });
    document.getElementById('btn-stock-multi-clear')?.addEventListener('click', () => {
      state.ui.stockMultiSel?.clear();
      document.querySelectorAll('.stock-multi-sel').forEach(e => e.classList.remove('stock-multi-sel'));
      _updateStockMultiBar();
    });
    if (rowFilter) rowFilter.oninput = () => { state.ui.rowFilter = rowFilter.value; renderGrid(); };

    // v32.3: stock item size controls
    const stockSizes = ['xs', 'sm', 'md', 'lg', 'xl'];
    const applyStockSize = () => {
      const sz = state.ui.stockSize || 'md';
      document.body.setAttribute('data-stock-size', sz);
      stockSizes.forEach(s => {
        const b = $('#stock-sz-' + s); if (b) b.style.outline = (s === sz) ? '2px solid var(--pri)' : '';
      });
      const wMap = { xs: '80px', sm: '100px', md: '128px', lg: '160px', xl: '200px' };
      document.documentElement.style.setProperty('--stockItemW', wMap[sz] || '128px');
    };
    stockSizes.forEach(sz => {
      const b = $('#stock-sz-' + sz); if (!b) return;
      b.onclick = () => { state.ui.stockSize = sz; markDirty('ui'); applyStockSize(); renderStock(); };
    });
    applyStockSize();

    const btnStockLeft = safeGet('#btn-stock-left');
    const btnStockTop = safeGet('#btn-stock-top');
    const btnStockCompact = safeGet('#btn-stock-compact');
    const btnPropToggle = safeGet('#btn-prop-toggle');

    if (btnStockLeft) btnStockLeft.onclick = () => { state.ui.stockPos = 'left'; markDirty('ui'); rerenderEdit(); };
    if (btnStockTop) btnStockTop.onclick = () => { state.ui.stockPos = 'top'; if (!state.ui.stockTopH) state.ui.stockTopH = state.ui.stockThin ? 180 : 260; markDirty('ui'); rerenderEdit(); };
    if (btnStockCompact) btnStockCompact.onclick = () => { state.ui.stockThin = !state.ui.stockThin; markDirty('ui'); rerenderEdit(); };
    if (btnPropToggle) btnPropToggle.onclick = () => { state.ui.propOn = !state.ui.propOn; markDirty('ui'); rerenderEdit(); };

    const btnFit = safeGet('#btn-fit');
    const btnScroll = safeGet('#btn-scroll');

    if (btnFit) btnFit.onclick = () => {
      pushHistory('fit');
      state.ui.stockPos = 'top'; state.ui.stockThin = true; state.ui.propOn = false;
      state.ui.densityMode = 'auto'; state.ui.densityFine = -1;
      markDirty('ui'); rerenderEdit(); flash('Fit: 1画面優先');
    };
    if (btnScroll) btnScroll.onclick = () => {
      pushHistory('scroll');
      state.ui.stockPos = 'left'; state.ui.stockThin = false; state.ui.propOn = true;
      state.ui.densityMode = 'mid'; state.ui.densityFine = 0;
      markDirty('ui'); rerenderEdit(); flash('Scroll: 読みやすさ優先');
    };

    const btnFontDown = safeGet('#btn-font-down');
    const btnFontReset = safeGet('#btn-font-reset');
    const btnFontUp = safeGet('#btn-font-up');
    const btnCellDown = safeGet('#btn-cell-down');
    const btnCellReset = safeGet('#btn-cell-reset');
    const btnCellUp = safeGet('#btn-cell-up');

    if (btnFontDown) btnFontDown.onclick = () => { state.ui.fontStep = clamp((state.ui.fontStep || 0) - 1, -3, 3); markDirty('ui'); applyDensity(); renderGrid(); };
    if (btnFontReset) btnFontReset.onclick = () => { state.ui.fontStep = 0; markDirty('ui'); applyDensity(); renderGrid(); };
    if (btnFontUp) btnFontUp.onclick = () => { state.ui.fontStep = clamp((state.ui.fontStep || 0) + 1, -3, 3); markDirty('ui'); applyDensity(); renderGrid(); };
    if (btnCellDown) btnCellDown.onclick = () => { state.ui.cellStep = clamp((state.ui.cellStep || 0) - 1, -3, 3); markDirty('ui'); applyDensity(); renderGrid(); };
    if (btnCellReset) btnCellReset.onclick = () => { state.ui.cellStep = 0; markDirty('ui'); applyDensity(); renderGrid(); };
    if (btnCellUp) btnCellUp.onclick = () => { state.ui.cellStep = clamp((state.ui.cellStep || 0) + 1, -3, 3); markDirty('ui'); applyDensity(); renderGrid(); };

    const btnDensityAuto = safeGet('#btn-density-auto');
    const btnDensityTight = safeGet('#btn-density-tight');
    const btnDensityMid = safeGet('#btn-density-mid');
    const btnDensityWide = safeGet('#btn-density-wide');
    const densityFine = safeGet('#density-fine');

    if (btnDensityAuto) btnDensityAuto.onclick = () => { state.ui.densityMode = 'auto'; markDirty('ui'); applyDensity(); };
    if (btnDensityTight) btnDensityTight.onclick = () => { state.ui.densityMode = 'tight'; markDirty('ui'); applyDensity(); };
    if (btnDensityMid) btnDensityMid.onclick = () => { state.ui.densityMode = 'mid'; markDirty('ui'); applyDensity(); };
    if (btnDensityWide) btnDensityWide.onclick = () => { state.ui.densityMode = 'wide'; markDirty('ui'); applyDensity(); };
    if (densityFine) densityFine.oninput = () => {
      state.ui.densityFine = parseInt(densityFine.value, 10);
      const lbl = safeGet('#density-fine-label');
      if (lbl) lbl.textContent = '±' + state.ui.densityFine;
      applyDensity();
    };

    const btnTeaSortName = safeGet('#btn-tea-sort-name-edit');
    const btnTeaSortSubj = safeGet('#btn-tea-sort-subj');
    const btnTeaSortManual = safeGet('#btn-tea-sort-manual');

    if (btnTeaSortName) btnTeaSortName.onclick = () => { state.ui.teacherSort = 'name'; renderGrid(); };
    if (btnTeaSortSubj) btnTeaSortSubj.onclick = () => { state.ui.teacherSort = 'subject'; renderGrid(); };
    if (btnTeaSortManual) btnTeaSortManual.onclick = () => { state.ui.teacherSort = 'manual'; state.ui.teacherOrder = getAxisKeys('teacher'); markDirty('ui'); renderGrid(); flash('手動並び替え: 行見出しをドラッグ'); };

    const btnColorMode = safeGet('#btn-color-mode');
    if (btnColorMode) btnColorMode.onclick = (ev) => {
      const cur = state.ui.colorMode || 'subject';
      const modes = [
        { label: '科目色（デフォルト）', value: 'subject' },
        { label: 'タイプ別色（単独/複数教員/複数クラス/2連）', value: 'type' },
        { label: '学年別色（クラスの先頭数字）', value: 'grade' },
      ];
      // act（項目の名前）が無いと、どれを押しても先頭の項目が実行されてしまう
      showCtxMenu([...modes.map(m => ({
        act: 'color-' + m.value,
        label: (m.value === cur ? '✓ ' : '　') + m.label,
        on: () => { state.ui.colorMode = m.value; markDirty('ui'); rerenderAll(); }
      })), { sep: true }, { act: 'color-legend', label: '📖 色の見本を見る', on: () => showColorLegend() }], ev.clientX, ev.clientY);
    };

    const btnClearSelection = safeGet('#btn-clear-selection');
    if (btnClearSelection) btnClearSelection.onclick = () => { state.ui.selectedId = null; state.ui.selectedFrom = ''; rerenderEdit(); };

    // popouts
    const btnPopTeacher = safeGet('#btn-pop-teacher');
    const btnPopClass = safeGet('#btn-pop-class');
    const btnPopRoom = safeGet('#btn-pop-room');
    const btnPopStock = safeGet('#btn-pop-stock');

    if (btnPopTeacher) btnPopTeacher.onclick = () => openPopout('teacher');
    if (btnPopClass) btnPopClass.onclick = () => openPopout('class');
    if (btnPopRoom) btnPopRoom.onclick = () => openPopout('room');
    if (btnPopStock) btnPopStock.onclick = () => openPopout('stock');

    // v42: 全窓を閉じるボタン
    const btnCloseAllFloats = safeGet('#btn-close-all-floats');
    if (btnCloseAllFloats) btnCloseAllFloats.onclick = () => {
      ensureFloatState();
      state.ui.floats = [];
      markDirty('ui');
      renderFloatLayer();
      flash('全ての個人窓を閉じました');
    };

    // AI

    // AI options
    const updRand = () => {
      const v = Number($('#ai-rand')?.value || 0) / 100;
      const el = $('#ai-rand-val'); if (el) el.textContent = v.toFixed(2);
    };
    if ($('#ai-rand')) { $('#ai-rand').addEventListener('input', updRand); updRand(); }
    $('#btn-ai').onclick = () => aiPlaceAll();
    // 学校のルール: 水曜は30分×6時間のため、LHRを持っている専任の先生は水曜⑤⑥の出勤不可を外してよい
    $('#btn-tea-wed56')?.addEventListener('click', () => {
      const lhr = new Set();
      for (const id in state.items) { const it = state.items[id]; if (/ＬＨＲ|LHR|ロングホーム/.test(it.subj || '')) (it.teas || []).forEach(t => lhr.add(t)); }
      const targets = [];
      for (const t of lhr) {
        const cfg = state.teacherCfg[t]; if (!cfg) continue;
        if (cfg.allowedMode) continue; // 出勤可能指定モードの先生は対象外（非常勤の扱い）
        const wed = (cfg.unavailable && cfg.unavailable.Wed) || [];
        const rm = wed.filter(p => p === 5 || p === 6);
        if (rm.length) targets.push({ t, rm, rest: wed.filter(p => p !== 5 && p !== 6) });
      }
      if (!targets.length) { flash('水曜⑤⑥が出勤不可になっているLHR担当の先生はいません'); return; }
      const list = targets.map(x => `・${x.t}（水曜 ${x.rm.join('・')}限を外す${x.rest.length ? `／水曜 ${x.rest.join('・')}限は出勤不可のまま` : ''}）`).join('\n');
      showModal('水曜⑤⑥の出勤不可を外します',
        `LHRを担当している専任の先生 ${targets.length}名の、水曜5・6限の出勤不可を外します。\n\n${list}\n\nLHRを担当していない先生（非常勤など）は変更しません。Ctrl+Zで元に戻せます。`,
        () => {
          pushHistory('wed56');
          for (const x of targets) { state.teacherCfg[x.t].unavailable.Wed = x.rest; }
          markDirty('teacher'); rerenderAll();
          flash(`✓ ${targets.length}名の水曜⑤⑥の出勤不可を外しました`);
        });
    });
    $('#btn-polish')?.addEventListener('click', async (ev) => {
      const b = ev.currentTarget; if (b.disabled) return;
      b.disabled = true; const t = b.textContent; b.textContent = '🧹 改善中…';
      try { await polishTeacherRunsAndSpread({ budgetMs: 20000 }); } finally { b.disabled = false; b.textContent = t; }
    });
    $('#btn-analyze')?.addEventListener('click', () => showTimetableAnalysis());
    $('#btn-set-manager')?.addEventListener('click', () => openSetManager());
    $('#btn-project-save')?.addEventListener('click', () => exportProjectFile());
    $('#btn-project-load')?.addEventListener('click', () => $('#project-load-file')?.click());
    $('#btn-idea-export')?.addEventListener('click', () => exportIdeaFile());
    $('#btn-test-return')?.addEventListener('click', () => { try { openTestReturnDialog(); } catch (e) { console.error(e); } });
    $('#project-load-file')?.addEventListener('change', async (ev) => {
      const f = ev.target.files?.[0]; if (!f) return;
      await importProjectFile(f);
      ev.target.value = '';
    });
    $('#btn-sandbox-start')?.addEventListener('click', () => enableSandbox());
    $('#btn-lock-all')?.addEventListener('click', () => lockAllPlaced('lock'));
    $('#btn-unlock-all')?.addEventListener('click', () => lockAllPlaced('unlock'));
    $('#btn-fix-dup-all')?.addEventListener('click', () => { try { resolveAllDuplicatesToStock(); } catch (e) { console.error(e); flash('二重解消でエラー'); } });
    // 🎲 ランダム外し: delegated binding so it still works even if the header is rerendered
    if (!document.__randUnplaceBound) {
      document.__randUnplaceBound = true;
      document.addEventListener('click', (ev) => {
        const t = ev?.target?.closest ? ev.target.closest('#btn-rand-unplace, #btn-rand-unplace-heat') : null;
        if (!t) return;
        try {
          const mode = document.getElementById('rand-unplace-mode')?.value || 'hot';
          if (t.id === 'btn-rand-unplace-heat' || mode === 'heat') randomUnplaceHeatOnly(ev);
          else randomUnplaceHot(ev);
        }
        catch (e) {
          console.error(e);
          try { showModal('エラー', 'ランダム外しでエラー: ' + String(e?.message || e)); } catch { }
          flash('ランダム外しでエラー');
        }
      });
    }
    // ⚙ その他メニュー：項目クリック or 外側クリックで閉じる
    if (!document.__hdrMoreBound) {
      document.__hdrMoreBound = true;
      document.addEventListener('click', (ev) => {
        document.querySelectorAll('details.hdr-more[open]').forEach((more) => {
          const inItem = ev.target.closest && ev.target.closest('.hdr-more-item');
          const inThisSummary = ev.target.closest && more.querySelector('summary') === ev.target.closest('summary');
          if (inItem || (!inThisSummary && !more.contains(ev.target))) more.open = false;
        });
      });
    }
    // v49 A-3: 未配置バッジクリックで次へジャンプ
    document.getElementById('unplaced-badge')?.addEventListener('click', () => {
      const allIds = Object.keys(state.items);
      const unplaced = allIds.filter(id => !state.placements[id]?.day);
      if (!unplaced.length) { flash('未配置コマなし'); return; }
      switchTab('edit');
      const cur = state.ui.selectedId;
      const curIdx = unplaced.indexOf(cur);
      const nextId = curIdx >= 0 && curIdx < unplaced.length - 1 ? unplaced[curIdx + 1] : unplaced[0];
      selectId(nextId, 'stock');
      setTimeout(() => { const el = document.querySelector(`.stock-item[data-id="${CSS.escape(nextId)}"]`); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, 100);
    });
    // 配置数維持モード: チェックボックス→state.settings 同期（初期値も反映）
    const _keepPlacedEl = $('#ai-keep-placed');
    if (_keepPlacedEl) {
      _keepPlacedEl.checked = !!state.settings.aiKeepPlaced;
      _keepPlacedEl.addEventListener('change', () => { state.settings.aiKeepPlaced = !!_keepPlacedEl.checked; markDirty('aiKeepPlaced'); });
    }
    // 空きコマ最小化モード: チェックボックス→state.settings 同期
    const _minGapEl = $('#ai-min-gap');
    if (_minGapEl) {
      _minGapEl.checked = !!state.settings.aiMinGap;
      _minGapEl.addEventListener('change', () => { state.settings.aiMinGap = !!_minGapEl.checked; markDirty('aiMinGap'); });
    }
    // 1日コマ平準化モード
    const _balLoadEl = $('#ai-balance-load');
    if (_balLoadEl) {
      _balLoadEl.checked = !!state.settings.aiBalanceLoad;
      _balLoadEl.addEventListener('change', () => { state.settings.aiBalanceLoad = !!_balLoadEl.checked; markDirty('aiBalanceLoad'); });
    }
    // AI設定の永続化（アルゴリズム/試行/秒数）— リロードで既定値に戻らないように
    [['ai-algo', 'aiAlgo'], ['ai-tries', 'aiTries'], ['ai-seconds', 'aiSeconds']].forEach(([id, key]) => {
      const el = $('#' + id); if (!el) return;
      if (state.settings[key] != null && state.settings[key] !== '') el.value = state.settings[key];
      el.addEventListener('change', () => { state.settings[key] = el.value; markDirty(key); });
    });
    // AIチェックボックス（偏り抑制/同教科連続回避）の永続化
    [['ai-balance', 'aiBalance'], ['ai-noconsec', 'aiNoConsec']].forEach(([id, key]) => {
      const el = $('#' + id); if (!el) return;
      if (state.settings[key] != null) el.checked = !!state.settings[key];
      el.addEventListener('change', () => { state.settings[key] = !!el.checked; markDirty(key); });
    });
    $('#btn-ai-wizard')?.addEventListener('click', () => { try { openAiWizard(); } catch (e) { console.error(e); } });
    // v40: AIログボタン
    $('#btn-ai-log')?.addEventListener('click', () => { try { ensureAiLogPanel(); } catch (e) { } });
    // v41: ヒートマップ・エリート・収束グラフボタン
    $('#btn-heatmap')?.addEventListener('click', () => { try { toggleHeatmap(); } catch (e) { console.error(e); } });
    $('#btn-color-mode')?.addEventListener('click', () => { try { toggleColorMode(); } catch (e) { console.error(e); } });
    $('#btn-elite')?.addEventListener('click', () => { try { ensureElitePanel(); } catch (e) { console.error(e); } });
    $('#btn-conv')?.addEventListener('click', () => { try { initConvergenceChart(); } catch (e) { console.error(e); } });
    // v44: 教員一覧ウィンドウ
    $('#btn-all-teachers')?.addEventListener('click', () => { try { openAllTeachersWindow(); } catch (e) { console.error(e); } });
    // v45: クラス一覧ウィンドウ
    $('#btn-all-classes')?.addEventListener('click', () => { try { openAllClassesWindow(); } catch (e) { console.error(e); } });
    // Bind column resizers for input table
    setTimeout(() => {
      document.querySelectorAll('#input-table col[data-col]').forEach(col => {
        const colName = col.dataset.col;
        const th = document.querySelector(`#input-thead-row th[data-col="${colName}"]`);
        if (!th) return;
        const resizer = th.querySelector('.col-resizer'); if (!resizer) return;
        let startX = 0, startW = 0;
        resizer.addEventListener('mousedown', (ev) => {
          ev.preventDefault(); ev.stopPropagation();
          startX = ev.clientX;
          startW = parseInt(col.style.width || '100', 10);
          const move = (e) => {
            const w = Math.max(40, startW + e.clientX - startX);
            col.style.width = w + 'px';
          };
          const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
          window.addEventListener('mousemove', move);
          window.addEventListener('mouseup', up);
        });
      });
    }, 500);
    $('#btn-clear-placed').onclick = () => {
      showModal('配置クリア', '配置だけ消して在庫に戻します。よろしいですか？', () => {
        pushHistory('clearPlaced');
        for (const id in state.placements) if (state.placements[id] && !state.placements[id].locked) state.placements[id] = null;
        markDirty('clearPlaced'); rerenderAll(); broadcastState();
      });
    };
    // AI continuous search (Idea-like): run trials until time budget, keep best
    let aiRunner = { running: false, stop: false };
    const btnRun = $('#btn-ai-run');
    if (btnRun) {
      btnRun.onclick = () => {
        if (aiRunner.running) {
          aiRunner.stop = true;
          btnRun.textContent = '停止中…';
          btnRun.disabled = true;
          return;
        }
        aiRunner.running = true;
        aiRunner.stop = false;
        btnRun.textContent = 'AI探索停止';
        btnRun.classList.add('danger');
        // ステータスクリア
        const statusEl = document.getElementById('ai-status');
        if (statusEl) statusEl.textContent = '探索を開始しています…';
        const pbEl = document.getElementById('ai-progress-bar');
        if (pbEl) pbEl.style.width = '0%';
        // v40: ログパネル表示
        try { ensureAiLogPanel(); } catch (e) { }
        // v41: 収束グラフ初期化
        try { initConvergenceChart(); } catch (e) { console.warn('[v41] conv init', e); }

        const sec = clampInt($('#ai-seconds')?.value, 0, 120, 30);
        const tries = clampInt($('#ai-tries')?.value, 1, 500, 60);
        const start = performance.now();
        const deadline = start + (sec > 0 ? sec * 1000 : 999999999);
        const maxTrials = (sec > 0) ? Math.max(tries, 1000000) : tries;
        const status = $('#ai-status');

        const basePlacements = deepClone(state.placements);
        let __aiHistoryPushed = false;
        const pushHistoryOnce = (tag) => { if (__aiHistoryPushed) return; __aiHistoryPushed = true; pushHistory(tag || 'ai'); };
        const allIds = Object.keys(state.items);
        const unplaced0 = allIds.filter(id => !basePlacements[id]);
        // 全コマ配置済みでも、ハード違反やソフトコストが残っていれば
        // SA/入替による最適化（仕上げ探索）を実行できるようにする。
        // 未配置ゼロ かつ 違反ゼロ のときのみ「実行不要」として終了する。
        const hardVio0 = hardViolationsFromPlacements(basePlacements);
        if (!unplaced0.length && hardVio0 === 0) {
          // 全コマ配置済み・違反なし: 配置探索は不要なので、探索時間を「時間割の質の改善」
          // （先生の4連続/3連続・同じ授業の時間帯の偏り）に使う。停止ボタンで途中終了できる
          const budget = Math.max(5, sec || 30) * 1000;
          if (statusEl) statusEl.textContent = '全コマ配置済み → 時間割の質を改善中…';
          polishTeacherRunsAndSpread({ budgetMs: budget, shouldStop: () => aiRunner.stop })
            .catch(e => console.warn('[polish]', e))
            .finally(() => {
              aiRunner.running = false; aiRunner.stop = false;
              btnRun.textContent = 'AI探索開始'; btnRun.classList.remove('danger'); btnRun.disabled = false;
            });
          return;
        }

        // BUG FIX: Use global softMetricsFromPlacements instead of IIFE-local totalSoft
        const optBal2 = !!$('#ai-balance')?.checked;
        const optNC2 = !!$('#ai-noconsec')?.checked;
        const baseSoft0 = softMetricsFromPlacements(basePlacements, optBal2, optNC2);
        let appliedKey = { vio: hardViolationsFromPlacements(basePlacements), remain: unplaced0.length, soft: baseSoft0.score, bias: baseSoft0.bias, consec: baseSoft0.consec };
        // BUG FIX: betterKey closed properly; applyPlacementsAll hoisted OUT of betterKey
        const _keepPlaced = !!state.settings.aiKeepPlaced;
        const betterKey = (a, b) => {
          // 配置数維持モードでは未配置数を最優先（違反より先に判定）
          if (_keepPlaced && a.remain !== b.remain) return a.remain < b.remain;
          if (a.vio !== b.vio) return a.vio < b.vio;
          if (a.remain !== b.remain) return a.remain < b.remain;
          if (a.soft !== b.soft) return a.soft < b.soft;
          if (a.bias !== b.bias) return a.bias < b.bias;
          return a.consec < b.consec;
        };
        const applyPlacementsAll = (plcObj) => {
          const ids = Object.keys(state.items);
          // 先に全コマを適用
          for (const id of ids) {
            const cur = state.placements[id];
            if (cur && cur.locked) continue;
            const nxt = plcObj[id] || null;
            if (nxt) {
              state.placements[id] = { day: nxt.day, period: nxt.period, locked: false };
            } else {
              if (state.placements[id]) state.placements[id] = null;
            }
          }
          // 重複チェック: 同じ(cls×day×period)に複数コマが入っていたら後者をnullに
          const seen = {}; // "cls|day|period" -> id
          for (const id of ids) {
            const p = state.placements[id]; if (!p?.day) continue;
            const it = state.items[id]; if (!it) continue;
            for (const c of it.cls || []) {
              const key = `${c}|${p.day}|${p.period}`;
              if (seen[key] && seen[key] !== id) {
                // 重複 - 後者を在庫に戻す (lockedでなければ)
                if (!p.locked) { state.placements[id] = null; break; }
              } else {
                seen[key] = id;
              }
            }
          }
        };

        let best = null;
        let done = 0;
        let lastUi = 0;
        let lastApply = 0;
        let lastLive = 0;  // for live preview even without improvement

        // バンディット型時間配分: 各アルゴリズムの改善回数に基づき動的に時間配分
        const _bandit = {
          lns:    { wins: 1, pulls: 1 },
          greedy: { wins: 1, pulls: 1 },
          sa:     { wins: 1, pulls: 1 },
          ga:     { wins: 1, pulls: 1 },
          island: { wins: 1, pulls: 1 },
        };
        let _banditTotal = 0;
        const _banditBudget = (name, frameMs) => {
          // UCB1: score = wins/pulls + sqrt(2*ln(total)/pulls)
          const b = _bandit[name]; if (!b) return frameMs * 0.2;
          const ucb = b.wins / b.pulls + Math.sqrt(2 * Math.log(_banditTotal + 1) / b.pulls);
          const sum = Object.values(_bandit).reduce((s, x) => s + x.wins / x.pulls + Math.sqrt(2 * Math.log(_banditTotal + 1) / x.pulls), 0);
          return frameMs * (ucb / sum);
        };
        const _banditWin = (name) => { if (_bandit[name]) { _bandit[name].wins++; _bandit[name].pulls++; } _banditTotal++; };
        const _banditPull = (name) => { if (_bandit[name]) _bandit[name].pulls++; _banditTotal++; };

        // v40: アルゴリズム選択・ログ・島モデル状態
        const algoName = $('#ai-algo')?.value || 'auto';
        const aiLog = []; // 探索ログ
        const logEntry = (msg, data = {}) => {
          const t = Math.round(performance.now() - start);
          aiLog.push({ t, trial: done, msg, ...data });
          if (aiLog.length > 500) aiLog.shift(); // メモリ上限
          if (window._aiDebug) console.log(`[AI t=${t}ms #${done}] ${msg}`, data);
        };
        logEntry('探索開始', { algo: algoName, tries: maxTrials, sec });

        // v40: SA/Tabu/Island 用の状態（greedy以外のとき初期化）
        let aiCtx = null;
        let saState = null;
        let tabuState = null;
        let islandState = null;
        let gaState = null; // v41: GA
        let lnsState = null; // LNS
        if (algoName !== 'greedy') {
          try {
            aiCtx = buildAiCtx(basePlacements);
            if (algoName === 'sa' || algoName === 'auto') {
              saState = initSAStateFast(basePlacements, aiCtx); // v41: Delta高速版
              logEntry('SA(Fast)初期化', { T: saState.T, alpha: saState.alpha });
            }
            if (algoName === 'tabu') {
              tabuState = initTabuState(basePlacements, aiCtx);
              logEntry('Tabu初期化', { tabuLen: tabuState.tabuLen });
            }
            if (algoName === 'island') {
              islandState = initIslandState(basePlacements, aiCtx);
              logEntry('Island初期化', { islands: ISLAND_COUNT });
            }
            if (algoName === 'ga') {
              gaState = initGAState(basePlacements, aiCtx); // v41: GA
              logEntry('GA初期化', { pop: GA_POP_SIZE });
            }
            if (algoName === 'auto') {
              // autoモード: LNS + greedy + FastSA + Island + GA を混合
              tabuState = initTabuState(basePlacements, aiCtx);
              islandState = initIslandState(basePlacements, aiCtx);
              gaState = initGAState(basePlacements, aiCtx);
              lnsState = initLNSState(basePlacements, aiCtx);
              logEntry('LNS初期化');
            }
          } catch (e) {
            console.error('[v40] アルゴリズム初期化エラー:', e);
            logEntry('初期化エラー: ' + e.message);
          }
        }

        // v40: SA/Tabu/Island の最良解をbestに反映するヘルパー
        const evalKeyFromEval = (ev) => ({
          remain: ev.remain,
          vio: ev.hard,
          soft: ev.soft,
          bias: ev.bias || 0,
          consec: ev.consec || 0,
        });
        const tryUpdateBestFromAlgo = (algoEval, algoPlacements, label) => {
          if (!algoEval) return;
          const key = evalKeyFromEval(algoEval);
          if (!best || betterKey(key, best.key)) {
            best = { placements: algoPlacements, key, msg: `${label}: 残${key.remain} 違${key.vio} 偏${key.bias.toFixed(1)}` };
            logEntry('新ベスト更新', { label, ...key });
          }
        };

        const step = () => {
          const now = performance.now();
          if (aiRunner.stop || now >= deadline || done >= maxTrials) {
            // apply best
            if (best && betterKey(best.key, appliedKey)) {
              pushHistoryOnce('ai');
              applyPlacementsAll(best.placements);
              appliedKey = best.key;
              invalidateIndex();
              markDirty('ai');
              rerenderAll();
              broadcastState();
              const msg = best.msg || 'AI探索完了';
              flash(msg);
              if (status) status.textContent = msg;
              // v40: 最終ログを出力
              logEntry('探索完了', best.key);
              finalizeAiLog(aiLog, algoName, done, performance.now() - start);
              // v41: エリートアーカイブへ登録
              try {
                const ts = new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
                eliteArchiveTryAdd(best.placements, best.key, `${algoTag} ${ts}`);
              } catch (e) { console.warn('[elite]', e); }
              // v32.6: show timetable analysis after AI completes
              setTimeout(() => showTimetableAnalysis(), 400);
            } else {
              if (best && best.key) {
                const msg = `AI探索: 改善なし（残${best.key.remain} 違${best.key.vio}）`;
                flash(msg);
                if (status) status.textContent = msg;
              } else {
                flash('AI探索: 改善なし');
              }
            }
            aiRunner.running = false;
            aiRunner.stop = false;
            if (btnRun) { btnRun.textContent = 'AI探索開始'; btnRun.classList.remove('danger'); btnRun.disabled = false; }
            // 仕上げ: 先生の4連続/3連続・同じ授業の時間帯の偏りを、衝突を作らない入替で減らす
            setTimeout(() => { try { polishTeacherRunsAndSpread({ budgetMs: 10000 }); } catch (e) { console.warn('[polish]', e); } }, 50);
            // プログレスバーをリセット
            const pb = document.getElementById('ai-progress-bar');
            if (pb) pb.style.width = '0%';
            return;
          }

          // run a chunk of trials within this frame budget (~12ms)
          const frameEnd = now + 12;
          let latestTrial = null;

          // v40: アルゴリズム別の試行ループ
          // autoモードでは違反が残っている間LNSを優先
          const hasHardVio = best ? best.key.vio > 0 : true;
          const hasRemain = best ? best.key.remain > 0 : true;

          if (algoName === 'auto' && lnsState && aiCtx && (hasHardVio || hasRemain)) {
            // LNS: 違反コマ集中破壊+MRV修復（バンディット配分）
            const lnsMsBudget = Math.max(2, Math.min(6, _banditBudget('lns', 12)));
            const lnsFrameEnd = Math.min(performance.now() + lnsMsBudget, frameEnd);
            _banditPull('lns');
            while (performance.now() < lnsFrameEnd && !aiRunner.stop) {
              try { aiLNSStep(lnsState, aiCtx); }
              catch (e) { console.error('[LNS]', e); break; }
            }
            if (lnsState.improved) {
              tryUpdateBestFromAlgo(lnsState.bestEval, lnsState.bestPlacements, 'LNS🔍');
              lnsState.improved = false;
              _banditWin('lns');
              // SA/Islandも最良解から再スタートして連携
              if (saState && lnsState.bestCost < (saState.bestCost || Infinity)) {
                saState = initSAStateFast(lnsState.bestPlacements, aiCtx);
              }
            }
          }

          if (algoName === 'greedy' || algoName === 'auto') {
            // greedy: Max-Regret+動的MRV強化版（バンディット配分）
            const greedyMsBudget = algoName === 'auto' ? Math.max(2, Math.min(7, _banditBudget('greedy', 12))) : 12;
            const greedyFrameEnd = algoName === 'auto' ? Math.min(performance.now() + greedyMsBudget, frameEnd) : frameEnd;
            if (algoName === 'auto') _banditPull('greedy');
            const bestBefore = best;
            while (performance.now() < greedyFrameEnd && done < maxTrials && performance.now() < deadline && !aiRunner.stop) {
              let r;
              try { r = aiTrialOnce(basePlacements); }
              catch (e) {
                aiRunner.stop = true;
                const em = 'AI探索エラー: ' + (e?.message || e);
                console.error(e); flash(em);
                if (status) status.textContent = em; break;
              }
              done++;
              latestTrial = r;
              if (!best || betterKey(r.key, best.key)) { best = r; logEntry('greedy新ベスト', r.key); if (algoName === 'auto') _banditWin('greedy'); }
            }
          }

          if ((algoName === 'sa' || algoName === 'auto') && saState && aiCtx) {
            // v41: FastSA (差分評価エンジン使用、バンディット配分)
            const saMsBudget = algoName === 'auto' ? Math.max(2, Math.min(6, _banditBudget('sa', 12))) : 12;
            const saFrameEnd = algoName === 'auto' ? Math.min(performance.now() + saMsBudget, frameEnd) : frameEnd;
            const saStepsBefore = saState.step;
            if (algoName === 'auto') _banditPull('sa');
            while (performance.now() < saFrameEnd && !aiRunner.stop) {
              try { aiSAStepFast(saState, aiCtx); }
              catch (e) { console.error('[FastSA]', e); break; }
            }
            const saStepsDone = saState.step - saStepsBefore;
            if (algoName === 'sa') done += Math.ceil(saStepsDone / 20);
            if (saState.improved) { tryUpdateBestFromAlgo(saState.bestEval, saState.bestPlacements, 'SA🔥'); saState.improved = false; if (algoName === 'auto') _banditWin('sa'); }
          }

          if ((algoName === 'ga' || algoName === 'auto') && gaState && aiCtx) {
            // v41: GA（バンディット配分）
            const gaMsBudget = algoName === 'auto' ? Math.max(1, Math.min(4, _banditBudget('ga', 12))) : 12;
            const gaFrameEnd = algoName === 'auto' ? Math.min(performance.now() + gaMsBudget, frameEnd) : frameEnd;
            if (algoName === 'auto') _banditPull('ga');
            while (performance.now() < gaFrameEnd && !aiRunner.stop) {
              try { aiGAStep(gaState, aiCtx); }
              catch (e) { console.error('[GA]', e); break; }
            }
            if (algoName === 'ga') done = gaState.step;
            if (gaState.improved) { tryUpdateBestFromAlgo(gaState.bestEval, gaState.bestPlacements, 'GA🧬'); gaState.improved = false; if (algoName === 'auto') _banditWin('ga'); }
          }

          if (algoName === 'tabu' && tabuState && aiCtx) {
            const tabuFrameEnd = frameEnd;
            while (performance.now() < tabuFrameEnd && !aiRunner.stop) {
              try { aiTabuStep(tabuState, aiCtx); }
              catch (e) { console.error('[Tabu]', e); break; }
            }
            done += Math.ceil(tabuState.step / 10);
            if (tabuState.improved) { tryUpdateBestFromAlgo(tabuState.bestEval, tabuState.bestPlacements, 'Tabu'); tabuState.improved = false; }
          }

          if ((algoName === 'island' || algoName === 'auto') && islandState && aiCtx) {
            // Island（バンディット配分）
            const islandMsBudget = algoName === 'auto' ? Math.max(1, Math.min(4, _banditBudget('island', 12))) : 12;
            const islandFrameEnd = algoName === 'auto' ? Math.min(performance.now() + islandMsBudget, frameEnd) : frameEnd;
            if (algoName === 'auto') _banditPull('island');
            while (performance.now() < islandFrameEnd && !aiRunner.stop) {
              try { aiIslandStep(islandState, aiCtx); }
              catch (e) { console.error('[Island]', e); break; }
            }
            if (algoName === 'island') done = islandState.step;
            if (islandState.improved) { tryUpdateBestFromAlgo(islandState.bestEval, islandState.bestPlacements, 'Island'); islandState.improved = false; if (algoName === 'auto') _banditWin('island'); }
          }

          // Live preview: apply best-so-far when improved, with animation
          const now2 = performance.now();
          const shouldApplyBest = best && betterKey(best.key, appliedKey) && (now2 - lastApply > 150);

          if (shouldApplyBest) {
            pushHistoryOnce('aiProgress');
            applyPlacementsAll(best.placements);
            appliedKey = best.key;
            lastApply = now2;
            invalidateIndex();
            markDirty('ai');
            rerenderAll();
            broadcastState();
          } else if (now2 - lastLive > 800) {
            // 改善がなくても定期的にUIステータスを更新して探索中であることを示す
            lastLive = now2;
            try { rerenderAll(); } catch (e) { }
          }

          if (status && now2 - lastUi > 120) {
            lastUi = now2;
            const b = best?.key;
            const elapsed = (now2 - start) / 1000;
            const prog = sec > 0 ? Math.min(100, elapsed / sec * 100) : Math.min(100, done / maxTrials * 100);
            // プログレスバー更新
            const progressBar = document.getElementById('ai-progress-bar');
            if (progressBar) progressBar.style.width = prog.toFixed(1) + '%';
            const algoTag = { greedy: 'Greedy', sa: 'SA🔥', tabu: 'Tabu🚫', island: 'Island🏝', ga: 'GA🧬', auto: 'Auto⚡' }[algoName] || algoName;
            const tempStr = (saState && algoName === 'sa') ? ` T=${saState.T.toFixed(1)}` : '';
            const total = Object.keys(state.items).length;
            const placed = b ? (total - b.remain) : 0;
            let msg;
            if (b) {
              const pct = total > 0 ? Math.round(placed / total * 100) : 0;
              msg = `${algoTag} ${elapsed.toFixed(1)}s | 配置${placed}/${total}コマ(${pct}%) | 残${b.remain} 違反${b.vio} 偏${b.bias.toFixed(1)}${tempStr}`;
              if (b.remain === 0) msg = `✅ ${algoTag} ${elapsed.toFixed(1)}s | 全${total}コマ配置！ 違反${b.vio} 偏${b.bias.toFixed(1)}`;
            } else {
              msg = `${algoTag} ${elapsed.toFixed(1)}s | 探索中… (${done}試行)${tempStr}`;
            }
            status.textContent = msg;
            // v40: ログパネル更新
            updateAiLogPanel(aiLog);
            // v41: 収束グラフ記録
            if (best) try { recordConvergence(Math.round(elapsed * 10) / 10, best.key); } catch (e) { }
          }
          requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      };
    }


    // snapshots
    $('#btn-snap-save').onclick = () => saveSnapshot($('#snap-name').value);
    $('#btn-snap-load').onclick = () => loadSnapshot($('#snap-list').value);
    $('#btn-snap-del').onclick = () => deleteSnapshot($('#snap-list').value);
    // v47-B4: 差分表示
    $('#btn-snap-compare')?.addEventListener('click', () => {
      const name = $('#snap-list')?.value;
      if (!name) { flash('スナップを選択してください'); return; }
      showSnapDiff(name);
      // 編集タブに切り替え
      if (state.tab !== 'edit') switchTab('edit');
    });
    $('#btn-snap-diff-close')?.addEventListener('click', () => hideSnapDiff());
    $('#btn-snap-diff-report')?.addEventListener('click', () => showSnapDiffReport());
    $('#btn-snap-export').onclick = () => {
      const blob = new Blob([JSON.stringify(state.snapshots, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'timetable_snapshots.json';
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    };
    $('#btn-snap-import').onclick = () => $('#snap-import-file').click();
    $('#snap-import-file').onchange = async (ev) => {
      const f = ev.target.files?.[0]; if (!f) return;
      const text = await f.text();
      try {
        const snaps = JSON.parse(text);
        pushHistory('snapImport');
        if (Array.isArray(snaps)) state.snapshots = snaps;
        markDirty('snapImport'); renderSnapshotList();
      } catch (e) { showModal('読込失敗', String(e)); }
      ev.target.value = '';
    };

    // print
    $('#btn-print').onclick = () => window.print();
    // 印刷する時、全クラス／全教員マトリクスが紙より横に長ければ、表全体を同じ割合で縮めて紙の幅に収める（右側が切れないように）
    window.addEventListener('beforeprint', () => {
      const orient = $('#print-page-orient')?.value || 'landscape';
      const paperPx = (orient === 'landscape' ? 277 : 190) * 96 / 25.4; // A4 の印刷できる幅（左右の余白を除く）
      document.querySelectorAll('.print-matrix-wrap').forEach(w => {
        const t = w.querySelector('table'); if (!t) return;
        const tw = parseFloat(t.style.width) || t.scrollWidth;
        w.style.zoom = String(Math.min(1, paperPx / tw));
      });
    });
    window.addEventListener('afterprint', () => document.querySelectorAll('.print-matrix-wrap').forEach(w => { w.style.zoom = ''; }));
    $('#btn-pdf-export')?.addEventListener('click', () => {
      // 掲示用の時間割表は、ブラウザの印刷から「PDFに保存」する方が文字がくっきりして速い
      if (document.getElementById('view-print')?.classList.contains('sheet-mode')) { flash('印刷の画面で、送り先（プリンター）を「PDFに保存」にしてください', 6000); setTimeout(() => window.print(), 300); return; }
      try { exportPDF(); } catch (e) { console.error(e); flash('PDFエラー: ' + e.message); }
    });
    // print cell/font size
    const printStep = (key, delta) => {
      state.ui[key] = clamp((state.ui[key] || 0) + delta, -4, 8);
      markDirty('ui'); renderPrint();
    };
    $('#btn-print-cell-down')?.addEventListener('click', () => printStep('printCellStep', -1));
    $('#btn-print-cell-up')?.addEventListener('click', () => printStep('printCellStep', 1));
    $('#btn-print-col-down')?.addEventListener('click', () => printStep('printColStep', -1));
    $('#btn-print-col-up')?.addEventListener('click', () => printStep('printColStep', 1));
    // v43: align and font family
    $('#print-align')?.addEventListener('change', renderPrint);
    $('#print-font-family')?.addEventListener('change', renderPrint);
    $('#print-cell-size-mode')?.addEventListener('change', renderPrint);
    // v38: pattern and border width
    $('#print-pattern')?.addEventListener('change', renderPrint);
    $('#print-border-width')?.addEventListener('input', renderPrint);
    // v39: 自動フィット・コントラスト
    $('#print-pattern-contrast')?.addEventListener('input', () => {
      const v = parseFloat($('#print-pattern-contrast')?.value || 30) / 100;
      const areaBox = $('#print-area');
      if (areaBox) areaBox.style.setProperty('--print-pattern-alpha', String(v));
      const lbl = $('#print-pattern-contrast-label');
      if (lbl) lbl.textContent = Math.round(v * 100) + '%';
    });
    $('#btn-export-teacher-matrix').onclick = () => exportTeacherMatrixCSV();
    const btnExportClassMatrix = $('#btn-export-class-matrix');
    if (btnExportClassMatrix) btnExportClassMatrix.onclick = () => exportClassMatrixCSV();
    const btnExportTeaXlsx = $('#btn-export-teacher-xlsx');
    if (btnExportTeaXlsx) btnExportTeaXlsx.onclick = () => exportTeacherMatrixXLSX();
    const btnExportClsXlsx = $('#btn-export-class-xlsx');
    if (btnExportClsXlsx) btnExportClsXlsx.onclick = () => exportClassMatrixXLSX();
    $('#btn-export-class-sheets-xlsx')?.addEventListener('click', () => exportClassSheetsXLSX());
    $('#btn-export-teacher-sheets-xlsx')?.addEventListener('click', () => exportTeacherSheetsXLSX());
    $('#print-page-orient')?.addEventListener('change', renderPrint);
    $('#btn-print-overview')?.addEventListener('click', () => { try { showPrintOverview(); } catch (e) { console.error(e); flash('プレビュー生成でエラー'); } });
    $('#print-type').onchange = renderPrint;
    // 印刷の向き・種別を永続化（リロードで既定値に戻らないように）
    [['print-page-orient', 'printOrient'], ['print-type', 'printType']].forEach(([id, key]) => {
      const el = $('#' + id); if (!el) return;
      if (state.settings[key] != null && state.settings[key] !== '') el.value = state.settings[key];
      el.addEventListener('change', () => { state.settings[key] = el.value; markDirty(key); });
    });
    // サイズリセット
    $('#btn-print-reset-size')?.addEventListener('click', () => resetPrintResize());
    $('#btn-equalize-cols')?.addEventListener('click', () => equalizeColWidths());
    $('#btn-equalize-rows')?.addEventListener('click', () => equalizeRowHeights());
    $('#btn-fit-a4-portrait')?.addEventListener('click', () => printFitA4Portrait());
    // フォントサイズ直接入力ヘルパー
    const bindFontPxInput = (id, stateKey) => {
      const el = $('#' + id);
      if (!el) return;
      el.addEventListener('focus', () => { el._focused = true; });
      el.addEventListener('blur', () => { el._focused = false; });
      el.addEventListener('change', () => {
        let v = parseInt(el.value, 10);
        if (v > 0) {
          v = clamp(v, 5, 72); // 極端な値でレイアウトが崩れないよう制限
          el.value = v;
          state.ui[stateKey] = v; markDirty('ui'); renderPrint();
        }
      });
      el.addEventListener('keydown', e => { if (e.key === 'Enter') el.blur(); });
    };
    bindFontPxInput('print-font-size-px', 'printFontSizePx');
    bindFontPxInput('print-title-font-px', 'printTitleFontSizePx');
    bindFontPxInput('print-header-font-px', 'printHeaderFontSizePx');

    // keyboard
    window.addEventListener('keydown', (ev) => {
      const tg = ev.target;
      if (tg && (tg.tagName === 'INPUT' || tg.tagName === 'TEXTAREA' || tg.isContentEditable)) return;

      // Undo/Redo
      if (ev.ctrlKey && !ev.shiftKey && ev.key.toLowerCase() === 'z') { ev.preventDefault(); undo(); }
      if ((ev.ctrlKey && ev.key.toLowerCase() === 'y') || (ev.ctrlKey && ev.shiftKey && ev.key.toLowerCase() === 'z')) { ev.preventDefault(); redo(); }

      // Selection actions — v39: ポップアップが開いていればEscで閉じる
      if (ev.key === 'Escape') {
        const overlay = document.getElementById('sug-popup-overlay');
        if (overlay && overlay.style.display !== 'none') { closeSuggestionPopup(); return; }
        // 画面を大きく覆う「教員一覧／クラス一覧」窓は Esc で閉じる（以前は×ボタンでしか閉じられなかった）
        const atw = [...document.querySelectorAll('#float-layer [data-id^="__all_"]')].pop();
        if (atw && !state.ui.selectedId) { atw.remove(); return; }
        clearValidSlots(); state.ui.selectedId = null; state.ui.selectedFrom = ''; rerenderEdit();
      }
      if (ev.key === 'Delete' || ev.key === 'Backspace') {
        if (state.ui.selectedId) { ev.preventDefault(); toStock(state.ui.selectedId); }
      }
      // v49 A-3: Arrow keys to navigate unplaced items
      if (ev.key === 'ArrowRight' && !ev.ctrlKey && !ev.shiftKey && state.tab === 'edit') {
        if (document.activeElement && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
          ev.preventDefault();
          const allIds = Object.keys(state.items);
          const unplaced = allIds.filter(id => !state.placements[id]?.day);
          if (unplaced.length) {
            const cur = state.ui.selectedId;
            const curIdx = unplaced.indexOf(cur);
            const nextId = curIdx >= 0 && curIdx < unplaced.length - 1 ? unplaced[curIdx + 1] : unplaced[0];
            selectId(nextId, 'stock');
            setTimeout(() => { const el = document.querySelector(`.stock-item[data-id="${CSS.escape(nextId)}"]`); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, 50);
          }
        }
      }
      if (ev.key === 'ArrowLeft' && !ev.ctrlKey && !ev.shiftKey && state.tab === 'edit') {
        if (document.activeElement && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
          ev.preventDefault();
          const allIds = Object.keys(state.items);
          const unplaced = allIds.filter(id => !state.placements[id]?.day);
          if (unplaced.length) {
            const cur = state.ui.selectedId;
            const curIdx = unplaced.indexOf(cur);
            const prevId = curIdx > 0 ? unplaced[curIdx - 1] : unplaced[unplaced.length - 1];
            selectId(prevId, 'stock');
            setTimeout(() => { const el = document.querySelector(`.stock-item[data-id="${CSS.escape(prevId)}"]`); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, 50);
          }
        }
      }
      // v49 A-1: Space/Enter で選択中の未配置コマを即配置
      if ((ev.key === ' ' || ev.key === 'Enter') && state.tab === 'edit') {
        if (document.activeElement && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA' && document.activeElement.tagName !== 'BUTTON') {
          const selId = state.ui.selectedId;
          if (selId && !state.placements[selId]?.day) {
            ev.preventDefault();
            quickAutoPlace(selId);
          }
        }
      }
      if (ev.key.toLowerCase() === 'l') {
        if (state.ui.selectedId) toggleLock(state.ui.selectedId);
      }

      // New shortcuts (v34.3)
      if (ev.key.toLowerCase() === 's' && !ev.ctrlKey) {
        if (state.ui.selectedId) { ev.preventDefault(); openPropSuggestions(state.ui.selectedId); }
      }
      // v47-B5: Ctrl+A で在庫一括選択（編集タブかつ在庫パネルにフォーカス時）
      if (ev.ctrlKey && ev.key.toLowerCase() === 'a') {
        if (state.tab === 'edit') {
          ev.preventDefault();
          _stockSelectAll('displayed');
        }
      }
      if (ev.key.toLowerCase() === 'a' && !ev.ctrlKey) {
        ev.preventDefault();
        const btnRun = $('#btn-ai-run');
        if (btnRun) btnRun.click();
      }
      if (ev.key.toLowerCase() === 'r' && !ev.ctrlKey) {
        ev.preventDefault();
        const btnRepair = $('#btn-repair');
        if (btnRepair) btnRepair.click();
      }
      if (ev.key === '?' || (ev.shiftKey && ev.key === '/')) {
        ev.preventDefault();
        showKeyboardHelp();
      }
    });

    bindSplitters();

    // UI scale (previously outside IIFE - moved here to fix ReferenceError)
    const applyUiScale = () => {
      const v = clampNum(Number(state.ui.uiScale || 1), 0.6, 1.5, 1);
      state.ui.uiScale = v;
      document.documentElement.style.setProperty('--uiScale', String(v));
      const lbl = $('#ui-scale-label'); if (lbl) lbl.textContent = Math.round(v * 100) + '%';
      document.documentElement.style.setProperty('--settingsCardMin', (v >= 1.15 ? '320px' : v <= 0.9 ? '240px' : '280px'));
    };
    applyUiScale();
    const _uiMinus = $('#ui-minus'); if (_uiMinus) _uiMinus.onclick = () => { state.ui.uiScale = clampNum((state.ui.uiScale || 1) - 0.1, 0.6, 1.5, 1); markDirty('ui'); applyUiScale(); };
    const _uiPlus = $('#ui-plus'); if (_uiPlus) _uiPlus.onclick = () => { state.ui.uiScale = clampNum((state.ui.uiScale || 1) + 0.1, 0.6, 1.5, 1); markDirty('ui'); applyUiScale(); };

    // View zoom controls (各設定画面の拡縮)
    state.ui.viewZoom = state.ui.viewZoom || {};
    function applyViewZoom(viewId) {
      const z = clampNum(state.ui.viewZoom[viewId] || 1, 0.5, 2.0, 1);
      state.ui.viewZoom[viewId] = z;
      const el2 = document.getElementById(viewId);
      if (el2) el2.style.setProperty('--view-zoom', String(z));
      const ctrl = document.querySelector(`.zoom-ctrl[data-zoom-target="${viewId}"]`);
      const lbl2 = ctrl?.querySelector('.zoom-lbl');
      if (lbl2) lbl2.textContent = Math.round(z * 100) + '%';
    }
    document.querySelectorAll('.zoom-ctrl[data-zoom-target]').forEach(ctrl => {
      const viewId = ctrl.dataset.zoomTarget;
      applyViewZoom(viewId);
      ctrl.querySelector('.zoom-out').onclick = () => { state.ui.viewZoom[viewId] = clampNum((state.ui.viewZoom[viewId] || 1) - 0.1, 0.5, 2.0, 1); markDirty('ui'); applyViewZoom(viewId); };
      ctrl.querySelector('.zoom-in').onclick  = () => { state.ui.viewZoom[viewId] = clampNum((state.ui.viewZoom[viewId] || 1) + 0.1, 0.5, 2.0, 1); markDirty('ui'); applyViewZoom(viewId); };
    });

    // print option checkboxes
    ['print-type', 'print-show-tea', 'print-show-cls', 'print-show-room', 'print-show-span', 'print-borders'].forEach(id2 => {
      const el2 = document.getElementById(id2);
      if (el2) el2.onchange = () => renderPrint();
    });

    // print layout selects
    populatePrintLayoutSelects();
    applyPrintLayoutToUI();
    ['pl1-1', 'pl1-2', 'pl1-3', 'pl1-4', 'pl2-1', 'pl2-2', 'pl2-3'].forEach(id3 => {
      const el3 = document.getElementById(id3);
      if (!el3) return;
      el3.onchange = () => { state.ui.printLayout = readPrintLayout(); markDirty('ui'); renderPrint(); };
    });

    // 問題分析ボタン
    // 📊ボタンには既に「時間割分析」（修正ボタン付き）が付いている。
    // ここで別の分析窓も付けていたため、1回押すと2つの窓が重なって開いていた。二重登録をやめる。

    // ─── F1: グリッド複数選択 ───
    document.getElementById('btn-grid-multi-stock')?.addEventListener('click', () => {
      const sel = state.ui.gridMultiSel; if (!sel?.size) return;
      pushHistory('gridMultiStock');
      for (const id of sel) { if (state.placements[id]?.day) toStock(id); }
      clearGridMultiSel(); rerenderAll();
    });
    document.getElementById('btn-grid-multi-lock')?.addEventListener('click', () => {
      const sel = state.ui.gridMultiSel; if (!sel?.size) return;
      pushHistory('gridMultiLock');
      for (const id of sel) { if (state.placements[id]?.day) toggleLock(id); }
      clearGridMultiSel(); rerenderAll();
    });
    document.getElementById('btn-grid-multi-copy')?.addEventListener('click', () => {
      const sel = state.ui.gridMultiSel; if (!sel?.size) return;
      pushHistory('gridMultiCopy');
      for (const id of [...sel]) copyItem(id);
      clearGridMultiSel();
    });
    document.getElementById('btn-grid-multi-del')?.addEventListener('click', () => {
      const sel = state.ui.gridMultiSel; if (!sel?.size) return;
      if (!confirm(`選択中の${sel.size}コマを削除しますか？`)) return;
      pushHistory('gridMultiDel');
      for (const id of sel) { toStock(id); delete state.items[id]; delete state.placements[id]; }
      clearGridMultiSel(); markDirty('items'); rerenderAll();
    });
    document.getElementById('btn-grid-multi-clear')?.addEventListener('click', clearGridMultiSel);

    // ─── F2: 履歴パネル ───
    document.getElementById('btn-history')?.addEventListener('click', openHistoryPanel);

    // ─── F3: コマ検索 ───
    const itemSearchEl = document.getElementById('item-search');
    if (itemSearchEl) {
      itemSearchEl.oninput = () => {
        state.ui.itemSearchQuery = itemSearchEl.value;
        requestAnimationFrame(applyItemSearchHighlight);
      };
    }
    document.getElementById('btn-item-search-clear')?.addEventListener('click', () => {
      state.ui.itemSearchQuery = '';
      if (itemSearchEl) itemSearchEl.value = '';
      applyItemSearchHighlight();
    });

    // ─── F6: 制約オーバーレイ ───
    document.getElementById('btn-constraint-overlay')?.addEventListener('click', () => {
      state.ui.constraintOverlay = !state.ui.constraintOverlay;
      const btn = document.getElementById('btn-constraint-overlay');
      if (btn) btn.classList.toggle('active', state.ui.constraintOverlay);
      if (state.ui.constraintOverlay) applyConstraintOverlay();
      else document.querySelectorAll('.slot-ok, .slot-ng').forEach(e => { e.classList.remove('slot-ok', 'slot-ng'); });
    });

    // ─── F7: ダッシュボード ───
    document.getElementById('btn-dashboard')?.addEventListener('click', () => {
      try { showDashboard(); } catch (e) { console.error(e); flash('ダッシュボード表示エラー: ' + e.message); }
    });

  }

  function loadState() {
    const candidates = [];
    if (localStorage.getItem(LS_KEY)) candidates.push(LS_KEY);
    else {
      // Try to migrate from older versions (best effort)
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k) continue;
        if (k === LS_KEY) continue;
        if (/^ultimate_tt_state_/i.test(k) || /^timetable_state_/i.test(k) || k.toLowerCase().includes('timetable')) {
          candidates.push(k);
        }
      }
      candidates.sort(); // older -> newer-ish by key name
      candidates.push(LS_KEY); // last fallback (empty)
    }

    // 本保存が壊れていたら1世代前の控えも候補にする
    if (candidates[0] === LS_KEY && localStorage.getItem(LS_KEY + '__bak')) candidates.splice(1, 0, LS_KEY + '__bak');
    for (const key of candidates) {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        let obj;
        try { obj = JSON.parse(raw); }
        catch (pe) {
          // 壊れた保存データは消さずに別名で退避（あとで復旧できるように）。空の状態で上書きしない
          try {
            // 同じ壊れデータは1つだけ残す（読み込むたびに増えて容量を圧迫しないように）
            const dk = Object.keys(localStorage).filter(k => k.startsWith(key + '__damaged_'));
            if (!dk.some(k => localStorage.getItem(k) === raw)) {
              dk.sort().slice(0, Math.max(0, dk.length - 2)).forEach(k => localStorage.removeItem(k)); // 古いものは最大3件まで
              localStorage.setItem(key + '__damaged_' + Date.now(), raw);
            }
          } catch (e) { }
          loadState._recoveredFrom = 'damaged';
          continue;
        }
        // accept if it looks like our schema
        if (obj && (obj.rawRows || obj.items || obj.placements)) {
          state.rawRows = obj.rawRows || state.rawRows || [];
          state.items = normalizeItems(obj.items || state.items || {});
          state.placements = obj.placements || state.placements || {};
          state.subjectCfg = obj.subjectCfg || state.subjectCfg || {};
          state.teacherCfg = obj.teacherCfg || state.teacherCfg || {};
          state.settings = { ...state.settings, ...(obj.settings || {}) };
          state.ui = { ...state.ui, ...(obj.ui || {}) };
          state.snapshots = obj.snapshots || state.snapshots || [];
          state.autosave.dirty = false;
          state.autosave.lastSaved = obj.savedAt || 0;
          sanitizeState('読込');
          if (/__bak$/.test(key)) loadState._recoveredFrom = 'backup';
          return true;
        }
      } catch (e) { /* ignore */ }
    }
    return false;
  }

  function init() {
    // v32.2: surface runtime errors in the UI
    window.onerror = (msg, src, line, col, err) => {
      const m = String(msg || '') + (line ? ` @${line}:${col || 0}` : '');
      console.error(err || msg);
      try { flash('エラー: ' + m); } catch (e) { }
    };

    loadState();
    sanitizeState('起動');
    if (loadState._recoveredFrom === 'backup') setTimeout(() => flash('⚠ 保存データが壊れていたため、1つ前の保存から復旧しました', 6000), 600);
    else if (loadState._recoveredFrom === 'damaged') setTimeout(() => flash('⚠ 保存データが読めませんでした。壊れたデータは消さずに別名で残しています', 6000), 600);
    // ページを閉じる直前に未保存の変更を保存
    window.addEventListener('beforeunload', () => { try { if (state.autosave.dirty) saveNow(); } catch (e) { } });
    // 別のタブで同じ時間割が保存されたら知らせる（気づかず上書きし合うのを防ぐ）
    window.addEventListener('storage', (ev) => {
      try {
        const myKey = _resolveSetKey(typeof _currentSetId !== 'undefined' ? _currentSetId : null);
        if (ev.key === myKey && ev.newValue) flash('⚠ 別のタブでこの時間割が保存されました。同時に編集すると片方の変更が消えます', 6000);
      } catch (e) { }
    });
    if (!state.rawRows.length) addRow();
    rebuildMastersFromRaw();
    if (!Object.keys(state.items).length) reflectRawToItems(); // build initial
    bindEvents();
    renderSnapshotList();
    try { markRawBaseline(); } catch (e) { } // 起動時の内容を基準にする（データ登録の画面から始まる場合のため）
    switchTab(state.tab || 'input');
    updateAutosaveUI();
    // v49: 初期進捗バー更新
    setTimeout(() => { try { updatePlacementProgress(); } catch (e) { } }, 300);
    // periodic save
    setInterval(() => { if (state.autosave.dirty && !state.autosave.saving) saveNow(); }, 10000);
    // initial broadcast request
    try { if (bc) bc.postMessage({ type: 'req' }); } catch (e) { }
    // expose state and key functions for global helpers / external scripts
    try {
      window.state = state;
      window.__ULT_STATE__ = state;
      window.rebuildMastersFromRaw = rebuildMastersFromRaw;
      window.reflectRawToItems = reflectRawToItems;
      window.rerenderAll = rerenderAll;
      window.openPropSuggestions = openPropSuggestions;
      window.previewSuggestionMoves = previewSuggestionMoves;
      window.placeItem = placeItem;
      window.rebuildItems = rebuildMastersFromRaw;
      window.validatePlacement = validatePlacement;
      window.countForbid = countForbid;
      window.invalidateIndex = invalidateIndex;
      // 別IIFE（AI提案/問題分析）が素の識別子で参照する第1IIFEヘルパを公開し、
      // グローバル解決で未定義参照クラッシュを防ぐ
      Object.assign(window, {
        buildIndex, clampInt, deepClone, flash, isSpanFill, staticBlocks, pickColor,
        teacherDailyMax, teacherConsecMax, teacherDayCount,
        chainQualityScore, moveDeltaCost, softPlacementPenalty, clearValidSlots, simulateMoves,
        normalizeAbbr, showModal, showModalHTML,
        // トップレベルのパズル/連鎖探索(puzSearch等)が素の識別子で参照するIIFE内定数/関数。
        // これらが未公開だと puzSearch が「DAYS is not defined」でクラッシュし、
        // 連動・三角トレード・パズル(多手先読み)提案が全て無言で0件になる。
        DAYS, DAYJP, maxPeriod, maxPeriodForItem,
        // クラウド保存(cloud.js)用
        buildProjectPayload, applyProjectData, showModalHTML, escapeHtml,
      });
    } catch (e) { }
  }

  // 【UI修正】「⚙ その他」等のドロップダウンを、開いたときに必ず画面内へ収める
  function clampDropdownPanels() {
    document.querySelectorAll('details.hdr-more[open] > .hdr-more-panel').forEach(panel => {
      panel.style.left = ''; panel.style.right = '';
      const host = panel.parentElement.getBoundingClientRect();
      const pw = panel.offsetWidth || 0, W = window.innerWidth, M = 8;
      // 既定は右揃え。左にはみ出すなら左揃え、それでも右にはみ出すなら画面内へずらす
      let left = host.right - pw;
      if (left < M) left = host.left;
      if (left + pw > W - M) left = W - M - pw;
      if (left < M) left = M;
      panel.style.left = (left - host.left) + 'px';
      panel.style.right = 'auto';
    });
  }
  document.addEventListener('toggle', (ev) => { if (ev.target && ev.target.matches && ev.target.matches('details.hdr-more')) requestAnimationFrame(clampDropdownPanels); }, true);
  window.addEventListener('resize', () => { try { clampDropdownPanels(); } catch (e) { } });

  document.addEventListener('DOMContentLoaded', init);

})(); // IIFE end
