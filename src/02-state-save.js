  /* =======================
     State
  ======================= */
  const state = {
    tab: 'input',
    rawRows: [],              // [{_id, cls, subj, subjAbbr, dept, tea, teaAbbr, room, count, dbl, parallel}]
    items: {},                // id -> {id, srcId, cls[], subj, subjKey, tea[], teaKey, room[], countIdx, span, locked, placed?}
    placements: {},           // id -> {day, period} or null
    subjectCfg: {},           // subjKey -> {abbr, dept, color, fixedForbid:{Mon:[1,2]}, noSameDay, maxPerDay}
    teacherCfg: {},           // teaKey -> {abbr, dept, maxDaily, maxConsec, unavailable:{Mon:[1,2]}}
    settings: {
      periodsByDay: { Mon: 7, Tue: 6, Wed: 6, Thu: 6, Fri: 6 },
      classPeriodOverride: {}, // clsKey -> {Mon:6, Tue:6, ...}  per-class time limit
      lunchAfter: 4,
      roomConflict: true,
      teaDefaultMaxDaily: null,
      teaDefaultMaxConsec: 4
    },
    ui: {
      viewMode: 'teacher',
      tool: 'move',
      drop: 'safe',
      showPlaced: false,
      groupStock: true,
      stockSearch: '',
      stockPos: 'left',   // left/top
      stockThin: false,
      propOn: true,
      densityMode: 'auto', // auto/tight/mid/wide
      densityFine: 0,
      fontStep: 0,
      cellStep: 0,
      rowFilter: '',
      teacherSort: 'name',
      teacherOrder: [], // name/subject
      selectedId: null,
      selectedFrom: '', // stock/grid
      colorMode: 'subject', // subject / type
      gridMultiSel: null, // Set of ids selected in grid (Ctrl+click)
      constraintOverlay: false, // show placement validity overlay
      itemSearchQuery: '', // global item search
    },
    autosave: { dirty: false, saving: false, lastSaved: 0, error: '' },
    snapshots: [] // [{name, savedAt, data:{placements}}]
  };

  /* =======================
     データ保護（壊れたデータを読み込んでも動き続け、保存済みデータを失わないための仕組み）
     - sanitizeState(): 状態を丸ごと差し替えた直後に必ず通す「形の点検と修理」
     - 保存は1世代前の控え(__bak)を残してから行い、壊れていたら控えから復旧する
  ======================= */
  const DEFAULT_SETTINGS = JSON.parse(JSON.stringify(state.settings));
  const DEFAULT_UI = JSON.parse(JSON.stringify({ ...state.ui, gridMultiSel: null }));
  const SCHEMA_VERSION = 2;
  const _isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
  const _toStrArr = (x) => (Array.isArray(x) ? x : (x == null || x === '' ? [] : [x]))
    .map(v => (v == null ? '' : String(v)).trim()).filter(Boolean);
  const _VALID_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  function sanitizeState(reason = '') {
    const fix = { items: 0, placements: 0, rows: 0, settings: 0, other: 0 };
    // items
    if (!_isObj(state.items)) { state.items = {}; fix.items++; }
    for (const id of Object.keys(state.items)) {
      const it = state.items[id];
      if (!_isObj(it)) { delete state.items[id]; fix.items++; continue; }
      if (it.id !== id) { it.id = id; fix.items++; }
      if (typeof it.subj !== 'string') { it.subj = it.subj == null ? '' : String(it.subj); fix.items++; }
      if (typeof it.subjKey !== 'string' || !it.subjKey) { it.subjKey = it.subj; fix.items++; }
      for (const k of ['cls', 'teas', 'rooms']) {
        if (!Array.isArray(it[k]) || it[k].some(v => typeof v !== 'string' || !v.trim())) { it[k] = _toStrArr(it[k]); fix.items++; }
      }
      const sp = parseInt(it.span, 10);
      const spOk = Number.isFinite(sp) && sp >= 1 && sp <= 4 ? sp : 1;
      if (it.span !== spOk) { it.span = spOk; fix.items++; }
    }
    // placements: 実在するコマだけ・曜日/時限の形が正しいものだけ残す
    if (!_isObj(state.placements)) { state.placements = {}; fix.placements++; }
    for (const id of Object.keys(state.placements)) {
      const p = state.placements[id];
      if (!state.items[id]) { delete state.placements[id]; fix.placements++; continue; }
      if (p == null) continue;
      const per = parseInt(p.period, 10);
      if (!_isObj(p) || !_VALID_DAYS.includes(p.day) || !Number.isFinite(per) || per < 1 || per > 12) {
        state.placements[id] = null; fix.placements++; continue;
      }
      if (p.period !== per) { p.period = per; fix.placements++; }
      if (typeof p.locked !== 'boolean') { p.locked = !!p.locked; }
    }
    // rawRows
    if (!Array.isArray(state.rawRows)) { state.rawRows = []; fix.rows++; }
    state.rawRows = state.rawRows.filter(r => { const ok = _isObj(r); if (!ok) fix.rows++; return ok; });
    // 各種設定
    if (!_isObj(state.subjectCfg)) { state.subjectCfg = {}; fix.other++; }
    if (!_isObj(state.teacherCfg)) { state.teacherCfg = {}; fix.other++; }
    for (const k of Object.keys(state.subjectCfg)) if (!_isObj(state.subjectCfg[k])) { delete state.subjectCfg[k]; fix.other++; }
    for (const k of Object.keys(state.teacherCfg)) if (!_isObj(state.teacherCfg[k])) { delete state.teacherCfg[k]; fix.other++; }
    if (!_isObj(state.settings)) { state.settings = {}; fix.settings++; }
    for (const k in DEFAULT_SETTINGS) {
      if (state.settings[k] === undefined) { state.settings[k] = JSON.parse(JSON.stringify(DEFAULT_SETTINGS[k])); fix.settings++; }
    }
    if (!_isObj(state.settings.periodsByDay)) { state.settings.periodsByDay = { ...DEFAULT_SETTINGS.periodsByDay }; fix.settings++; }
    for (const d of Object.keys(state.settings.periodsByDay)) {
      const v = parseInt(state.settings.periodsByDay[d], 10);
      const ok = Number.isFinite(v) ? Math.max(0, Math.min(12, v)) : 0;
      if (state.settings.periodsByDay[d] !== ok) { state.settings.periodsByDay[d] = ok; fix.settings++; }
    }
    if (!_isObj(state.settings.classPeriodOverride)) { state.settings.classPeriodOverride = {}; fix.settings++; }
    if (!_isObj(state.ui)) { state.ui = {}; fix.other++; }
    for (const k in DEFAULT_UI) if (state.ui[k] === undefined) state.ui[k] = JSON.parse(JSON.stringify(DEFAULT_UI[k]));
    if (state.ui.selectedId && !state.items[state.ui.selectedId]) state.ui.selectedId = null;
    if (!Array.isArray(state.snapshots)) { state.snapshots = []; fix.other++; }
    try { invalidateIndex(); } catch (e) { }
    const total = fix.items + fix.placements + fix.rows + fix.settings + fix.other;
    if (total) console.warn('[データ点検] ' + (reason || '') + ' で修理しました', fix);
    return { total, fix };
  }

  /* =======================
     Project File Export / Import
     ファイル形式: .ide (JSON) — イデア時間割ソフト互換
     全データ（データ登録・科目/教員設定・配置・スナップショット）を一括保存
  ======================= */
  const PROJECT_FORMAT = 'idea-timetable-project';
  const PROJECT_VERSION = '1.0';

  /* =======================
     テスト返却 特別時間割ジェネレータ
     現在のフル時間割から、各クラスの科目を1回ずつ・教員重複/禁制回避で
     短期間(既定3日×6限)に割り付け、余りを体育2連/芸術/LHR等で埋める。
  ======================= */
  function generateTestReturnPlan(opts) {
    opts = opts || {};
    const numDays = clampInt(opts.days, 1, 5, 3);
    const periods = clampInt(opts.periods, 1, 8, 6);
    const dayKeys = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].slice(0, numDays);
    const fillers = opts.fillers || [{ subj: '保健体育', span: 2 }, { subj: '芸術', span: 1 }, { subj: 'ＬＨＲ', span: 1 }];
    const slots = [];
    for (const d of dayKeys) for (let p = 1; p <= periods; p++) slots.push({ day: d, period: p, key: d + '#' + p });

    // 1. 現行の配置済み時間割から クラス→科目→{教員, 単位数(コマ数)} を収集
    const classSubj = {}; // class -> Map(subj -> {teas:Set, count})
    for (const id in state.placements) {
      const plc = state.placements[id]; if (!plc || !plc.day) continue;
      const it = state.items[id]; if (!it) continue;
      const subj = it.subjKey || it.subj; if (!subj) continue;
      const span = it.span || 1;
      for (const c of (it.cls || [])) {
        const m = classSubj[c] || (classSubj[c] = new Map());
        const rec = m.get(subj) || { teas: new Set(), count: 0 };
        (it.teas || []).forEach(t => t && rec.teas.add(t));
        rec.count += span; // 単位数（週コマ数）
        m.set(subj, rec);
      }
    }
    // 除外科目（返却対象でないもの）
    const exclude = new Set(['選択', '総合的な探究の時間', '総合的な探究', 'ＬＨＲ', 'LHR', '参観', ...fillers.map(f => f.subj)]);
    if (Array.isArray(opts.excludeSubjects)) opts.excludeSubjects.forEach(s => exclude.add(s));

    const classes = Object.keys(classSubj).filter(c => classSubj[c].size).sort((a, b) => a.localeCompare(b, 'ja'));
    const teacherBusy = {}; // teacher -> Set(slotKey)
    const classUsed = {};   // class -> Set(slotKey)
    const newItems = {}; const newPlacements = {}; let idc = 0;
    const report = { classes: classes.length, placed: 0, unplaced: 0, filled: 0, warnings: [] };
    const teaFree = (t, sl, subj) => !((teacherBusy[t] && teacherBusy[t].has(sl.key)))
      && !(typeof isUnavailableForTeacher === 'function' && isUnavailableForTeacher(t, sl.day, sl.period))
      && !(typeof isForbiddenForSubject === 'function' && isForbiddenForSubject(subj, sl.day, sl.period));
    const addItem = (subj, cls, teas, day, period, span) => {
      const id = 'tr' + (idc++);
      newItems[id] = { id, subj, subjKey: subj, cls: cls.slice(), teas: (teas || []).slice(), rooms: [], span: span || 1 };
      newPlacements[id] = (day) ? { day, period, locked: false } : null;
      return id;
    };

    const placeOnce = (c, subj, teas) => {
      for (const sl of slots) {
        if (classUsed[c].has(sl.key)) continue;
        if (teas.length && !teas.every(t => teaFree(t, sl, subj))) continue;
        addItem(subj, [c], teas, sl.day, sl.period, 1);
        classUsed[c].add(sl.key);
        teas.forEach(t => (teacherBusy[t] || (teacherBusy[t] = new Set())).add(sl.key));
        return true;
      }
      return false;
    };

    for (const c of classes) {
      classUsed[c] = new Set();
      // 制約が厳しい科目（担当教員が多い）から先に置くと詰まりにくい
      const subs = [...classSubj[c].keys()].filter(s => !exclude.has(s));
      subs.sort((a, b) => classSubj[c].get(b).teas.size - classSubj[c].get(a).teas.size);
      const placedN = {}; // subj -> 配置済み回数
      // (1) 全科目を1回ずつ配置（テスト返却本体）
      for (const subj of subs) {
        const teas = [...classSubj[c].get(subj).teas];
        if (placeOnce(c, subj, teas)) { report.placed++; placedN[subj] = 1; }
        else { addItem(subj, [c], teas, null, null, 1); report.unplaced++; placedN[subj] = 0; report.warnings.push(`${c} ${subj}: 空き枠なし`); }
      }
      // (2) 余り枠は「元の単位数が多い授業をもう一度」入れる。
      //     残り単位数(元コマ数 - 配置済み回数)が多い科目を優先して再配置する。
      let guard = 0;
      while (classUsed[c].size < slots.length && guard++ < slots.length * 3) {
        let best = null, bestQ = 0;
        for (const s of subs) {
          const q = (classSubj[c].get(s).count || 1) - (placedN[s] || 0);
          if (q > bestQ) { bestQ = q; best = s; }
        }
        if (!best) break; // 残り単位数なし → 汎用fillerへ
        const teas = [...classSubj[c].get(best).teas];
        if (placeOnce(c, best, teas)) { report.filled++; placedN[best] = (placedN[best] || 0) + 1; }
        else { placedN[best] = classSubj[c].get(best).count; } // どこにも置けない→この科目は打ち切り
      }
      // (3) それでも空きがあれば汎用filler(体育2連/芸術/LHR)で埋める
      let fi = 0, g2 = 0;
      while (classUsed[c].size < slots.length && g2++ < slots.length * 2) {
        const f = fillers[fi % fillers.length]; fi++;
        const span = clampInt(f.span, 1, 2, 1);
        let placedFiller = false;
        for (let si = 0; si < slots.length; si++) {
          const sl = slots[si];
          if (span === 2) {
            const next = slots[si + 1];
            if (!next || next.day !== sl.day || next.period !== sl.period + 1) continue;
            if (classUsed[c].has(sl.key) || classUsed[c].has(next.key)) continue;
            addItem(f.subj, [c], [], sl.day, sl.period, 2);
            classUsed[c].add(sl.key); classUsed[c].add(next.key); report.filled += 2; placedFiller = true; break;
          } else {
            if (classUsed[c].has(sl.key)) continue;
            addItem(f.subj, [c], [], sl.day, sl.period, 1);
            classUsed[c].add(sl.key); report.filled++; placedFiller = true; break;
          }
        }
        if (!placedFiller && span === 2) continue;
        if (!placedFiller) break;
      }
    }
    // rawRows も生成物に合わせて作る（データ登録タブの表示・reflectでの消失を防ぐ）
    const rawRows = [];
    for (const id in newItems) {
      const it = newItems[id];
      rawRows.push({ _id: 'tr_' + id, cls: (it.cls || []).join(','), subj: it.subj, subjAbbr: '', dept: '', tea: (it.teas || []).join(','), teaAbbr: '', room: '', count: 1, dbl: it.span === 2, parallel: false });
    }
    return { items: newItems, placements: newPlacements, rawRows, dayKeys, periods, report };
  }

  // 現在の全配置から返却対象になりうる科目一覧を取得（自動除外を除く）
  function _trGatherSubjects() {
    const auto = new Set(['選択', '総合的な探究の時間', '総合的な探究', 'ＬＨＲ', 'LHR', '参観']);
    const cnt = {};
    for (const id in state.placements) {
      const plc = state.placements[id]; if (!plc || !plc.day) continue;
      const it = state.items[id]; if (!it) continue;
      const s = it.subjKey || it.subj; if (!s || auto.has(s)) continue;
      cnt[s] = (cnt[s] || 0) + 1;
    }
    return Object.keys(cnt).sort((a, b) => a.localeCompare(b, 'ja')).map(s => ({ subj: s, count: cnt[s] }));
  }
  // テスト返却案のスナップショット保存/復元（別案の保存・比較用）
  function _trSnapshot(label) {
    state.trSaved = state.trSaved || [];
    state.trSaved.push({
      id: 'trs_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
      label: label || ('案 ' + (state.trSaved.length + 1)),
      ts: Date.now(),
      snap: deepClone({
        items: state.items, placements: state.placements, rawRows: state.rawRows,
        periodsByDay: state.settings.periodsByDay,
      }),
    });
    // 保存数の上限（メモリ肥大防止）。trSaved はセッション内メモリのみ（localStorage容量超過回避）
    if (state.trSaved.length > 12) state.trSaved.splice(0, state.trSaved.length - 12);
  }
  function _trRestore(sid) {
    const e = (state.trSaved || []).find(x => x.id === sid); if (!e) return false;
    pushHistory('trRestore');
    const s = deepClone(e.snap);
    state.items = normalizeItems(s.items || {});
    state.placements = s.placements || {};
    state.rawRows = Array.isArray(s.rawRows) ? s.rawRows : [];
    if (s.periodsByDay) Object.assign(state.settings.periodsByDay, s.periodsByDay);
    sanitizeState('案の切替');
    invalidateIndex(); markDirty('trRestore'); rerenderAll();
    flash(`🔄 「${e.label}」に切替えました`);
    return true;
  }

  function applyTestReturnTimetable(opts) {
    if (!Object.keys(state.placements || {}).some(id => state.placements[id] && state.placements[id].day)) {
      flash('先に通常の時間割を読み込んでください'); return;
    }
    // 初回生成時、元のフル時間割を案として自動保存（比較・復帰用）
    state.trSaved = state.trSaved || [];
    if (!state.trSaved.some(e => e.origin)) {
      _trSnapshot('元のフル時間割');
      state.trSaved[state.trSaved.length - 1].origin = true;
    }
    const plan = generateTestReturnPlan(opts);
    pushHistory('testReturn');
    state.items = plan.items;
    state.placements = plan.placements;
    if (Array.isArray(plan.rawRows)) state.rawRows = plan.rawRows;
    const allDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
    allDays.forEach((d, i) => { state.settings.periodsByDay[d] = (i < plan.dayKeys.length) ? plan.periods : 0; });
    sanitizeState('テスト返却');
    invalidateIndex();
    markDirty('testReturn');
    rerenderAll();
    const r = plan.report;
    const exCnt = (opts && Array.isArray(opts.excludeSubjects)) ? opts.excludeSubjects.length : 0;
    // 生成結果を案として保存（別案比較用）
    _trSnapshot(`返却案 ${plan.dayKeys.length}日×${plan.periods}限${exCnt ? `・除外${exCnt}科目` : ''}`);
    flash(`🗓️ テスト返却時間割を生成（${r.classes}クラス・配置${r.placed}・埋め${r.filled}${r.unplaced ? `・未配置${r.unplaced}` : ''}）`, 4500);
  }

  function openTestReturnDialog() {
    const subjects = _trGatherSubjects();
    // 科目選択チェックリスト（既定は全選択・単位数の多い順ヒント付き）
    const subjChecks = subjects.length
      ? subjects.map(s => `<label class="tr-subj-chk"><input type="checkbox" class="tr-subj" value="${escapeAttr(s.subj)}" checked> ${escapeHtml(s.subj)} <span class="muted small">×${s.count}</span></label>`).join('')
      : '<div class="muted small">配置済みの科目がありません（先にフル時間割を読み込んでください）</div>';
    const saved = state.trSaved || [];
    const savedHTML = saved.length
      ? saved.slice().reverse().map(e => `<div class="tr-saved-row" data-sid="${e.id}">
          <span class="tr-saved-label">${e.origin ? '⭐ ' : ''}${escapeHtml(e.label)}</span>
          <span class="muted small">${new Date(e.ts).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}</span>
          <button class="sec tr-switch" data-sid="${e.id}">切替</button>
          ${e.origin ? '' : `<button class="danger tr-del" data-sid="${e.id}">✕</button>`}
        </div>`).join('')
      : '<div class="muted small">まだ保存された案はありません。生成すると自動で案として保存されます。</div>';
    const html =
      `<div style="line-height:1.7">
        <div>現在のフル時間割から各クラスの科目を1回ずつ配置した<strong>テスト返却用の特別時間割</strong>を生成します。</div>
        <div style="margin-top:10px;display:flex;gap:18px;flex-wrap:wrap;align-items:center">
          <label>日数 <input id="tr-days" type="number" min="1" max="5" value="3" style="width:56px"></label>
          <label>1日の時限 <input id="tr-periods" type="number" min="1" max="8" value="6" style="width:56px"></label>
        </div>
        <details class="tr-section" ${subjects.length ? '' : 'open'}>
          <summary><strong>📋 返却科目の選択</strong> <span class="muted small">（チェックを外すと返却対象から除外）</span></summary>
          <div class="tr-subj-toolbar">
            <button type="button" class="sec" id="tr-all">全選択</button>
            <button type="button" class="sec" id="tr-none">全解除</button>
          </div>
          <div class="tr-subj-list">${subjChecks}</div>
        </details>
        <details class="tr-section">
          <summary><strong>💾 保存済みの案（別案の比較）</strong></summary>
          <div class="tr-saved-list">${savedHTML}</div>
        </details>
        <div style="margin-top:8px" class="muted small">全（選択）科目を1回ずつ配置後、余り枠は<strong>元の単位数が多い授業をもう一度</strong>入れて埋めます（教員の重複・禁制時間は自動回避）。それでも余れば体育(2連)/芸術/LHRで補います。</div>
        <div style="margin-top:6px;color:#b45309">※ 生成のたびに案として自動保存されます。元に戻すには上の「切替」または Ctrl+Z。</div>
      </div>`;
    let days = 3, periods = 6;
    showModalHTML('🗓️ テスト返却 特別時間割の生成', html, () => {
      const excludeSubjects = subjects
        .filter(s => { const el = document.querySelector(`.tr-subj[value="${CSS.escape(s.subj)}"]`); return el && !el.checked; })
        .map(s => s.subj);
      try { applyTestReturnTimetable({ days, periods, excludeSubjects }); } catch (e) { console.error(e); flash('生成でエラー: ' + (e && e.message)); }
    }, '生成する', 'キャンセル', () => {
      const dEl = document.getElementById('tr-days'), pEl = document.getElementById('tr-periods');
      if (dEl) dEl.addEventListener('input', () => { days = clampInt(dEl.value, 1, 5, 3); });
      if (pEl) pEl.addEventListener('input', () => { periods = clampInt(pEl.value, 1, 8, 6); });
      const setAll = (v) => document.querySelectorAll('.tr-subj').forEach(c => { c.checked = v; });
      document.getElementById('tr-all')?.addEventListener('click', () => setAll(true));
      document.getElementById('tr-none')?.addEventListener('click', () => setAll(false));
      // 保存案の切替・削除
      const modal = document.getElementById('modal');
      modal.querySelectorAll('.tr-switch').forEach(b => b.addEventListener('click', (ev) => {
        ev.preventDefault();
        const sid = b.dataset.sid;
        document.getElementById('modal-cancel')?.click(); // モーダルを閉じてから復元
        setTimeout(() => _trRestore(sid), 30);
      }));
      modal.querySelectorAll('.tr-del').forEach(b => b.addEventListener('click', (ev) => {
        ev.preventDefault();
        const sid = b.dataset.sid;
        state.trSaved = (state.trSaved || []).filter(e => e.id !== sid);
        const row = b.closest('.tr-saved-row'); if (row) row.remove();
      }));
    });
  }

