  /* =======================
     History (Undo/Redo)
  ======================= */
  const HISTORY_MAX = 60;
  let historyPast = [];
  let historyFuture = [];
  let historyMeta = []; // parallel array: {reason, time} for each historyPast entry
  function snapshotForHistory() {
    return deepClone({
      rawRows: state.rawRows,
      items: state.items,
      placements: state.placements,
      subjectCfg: state.subjectCfg,
      teacherCfg: state.teacherCfg,
      settings: state.settings,
      ui: { ...state.ui, selectedId: null, selectedFrom: '' },
      snapshots: state.snapshots
    });
  }
  function restoreFromHistory(snap) {
    state.rawRows = snap.rawRows || [];
    state.items = snap.items || {};
    state.placements = snap.placements || {};
    state.subjectCfg = snap.subjectCfg || {};
    state.teacherCfg = snap.teacherCfg || {};
    state.settings = snap.settings || state.settings;
    state.ui = { ...state.ui, ...(snap.ui || {}) };
    state.snapshots = snap.snapshots || [];
    state.ui.selectedId = null; state.ui.selectedFrom = '';
    sanitizeState('元に戻す/セット切替');
    invalidateIndex();
  }
  function pushHistory(reason = '') {
    historyPast.push(snapshotForHistory());
    historyMeta.push({ reason: reason || '操作', time: Date.now() });
    if (historyPast.length > HISTORY_MAX) { historyPast.shift(); historyMeta.shift(); }
    historyFuture = [];
    // console.log('pushHistory',reason,historyPast.length)
  }
  function undo() {
    if (!historyPast.length) { flash('Undoできません'); return; }
    const cur = snapshotForHistory();
    const prev = historyPast.pop();
    historyMeta.pop();
    historyFuture.push(cur);
    restoreFromHistory(prev);
    markDirty('undo');
    rerenderAll();
    broadcastState();
  }
  function redo() {
    if (!historyFuture.length) { flash('Redoできません'); return; }
    const cur = snapshotForHistory();
    const nxt = historyFuture.pop();
    historyPast.push(cur);
    restoreFromHistory(nxt);
    markDirty('redo');
    rerenderAll();
    broadcastState();
  }

  /* =======================
     Autosave / Broadcast
  ======================= */
  let bc = null;
  try { bc = new BroadcastChannel(BC_NAME); } catch (e) { }
  function broadcastState() {
    if (!bc) return;
    bc.postMessage({ type: 'state', data: { placements: state.placements, items: state.items, subjectCfg: state.subjectCfg, teacherCfg: state.teacherCfg, settings: state.settings } });
  }
  if (bc) {
    bc.onmessage = (ev) => {
      const msg = ev.data || {};
      if (msg.type === 'req') { broadcastState(); return; }
      if (msg.type === 'state' && msg.data) {
        // popout -> main : accept only if popout is "controller" (we'll accept always but push history)
        // For safety, require explicit action messages; ignore raw sync.
      }
      if (msg.type === 'action') {
        applyExternalAction(msg.action);
      }
    };
  }

  /* postMessage fallback for popouts (file://等でも動く) */
  window.addEventListener('message', (ev) => {
    const msg = ev.data || {};
    if (msg.type === 'req') {
      try {
        ev.source && ev.source.postMessage({ type: 'state', data: { placements: state.placements, items: state.items, subjectCfg: state.subjectCfg, teacherCfg: state.teacherCfg, settings: state.settings } }, '*');
      } catch (e) { }
    }
    if (msg.type === 'action') {
      applyExternalAction(msg.action);
      try { ev.source && ev.source.postMessage({ type: 'state', data: { placements: state.placements, items: state.items, subjectCfg: state.subjectCfg, teacherCfg: state.teacherCfg, settings: state.settings } }, '*'); } catch (e) { }
    }
  });
  function saveNow() {
    // v48: 仮配置モード中は保存しない
    if (_sandboxMode) return;
    try {
      state.autosave.saving = true; updateAutosaveUI();
      sanitizeState('保存前');
      const payload = {
        v: '27.1',
        schema: SCHEMA_VERSION,
        savedAt: now(),
        rawRows: state.rawRows,
        items: state.items,
        placements: state.placements,
        subjectCfg: state.subjectCfg,
        teacherCfg: state.teacherCfg,
        settings: state.settings,
        ui: { ...state.ui, selectedId: null, selectedFrom: '' },
        snapshots: state.snapshots
      };
      const saveKey = _resolveSetKey(typeof _currentSetId !== 'undefined' ? _currentSetId : null);
      const json = JSON.stringify(payload);
      // 1世代前の控えを残す（今の保存内容が正しく読めるときだけ。壊れた内容で控えを上書きしない）
      try {
        const prev = localStorage.getItem(saveKey);
        if (prev && prev !== json) { JSON.parse(prev); localStorage.setItem(saveKey + '__bak', prev); }
      } catch (e) { /* 控えが作れなくても本保存は続ける（容量不足など） */ }
      // 書いた内容を読み戻して確かめる
      localStorage.setItem(saveKey, json);
      if (localStorage.getItem(saveKey) !== json) throw new Error('保存内容の確認に失敗しました');
      state.autosave.dirty = false;
      state.autosave.lastSaved = payload.savedAt;
      state.autosave.error = '';
      state.autosave.saving = false;
      updateAutosaveUI();
    } catch (e) {
      state.autosave.saving = false;
      state.autosave.error = String(e);
      // 容量超過は原因が分かりにくいので、ファイル保存を促す（一度だけ）
      const isQuota = e && (e.name === 'QuotaExceededError' || /quota/i.test(String(e.message || e)));
      if (isQuota) {
        updateAutosaveUI('保存失敗(容量超過)');
        if (!saveNow._quotaWarned) {
          saveNow._quotaWarned = true;
          try { flash('⚠ ブラウザ保存容量を超えました。「💾 保存」でファイルに書き出してください', 5000); } catch (e2) { }
        }
      } else {
        updateAutosaveUI('保存失敗');
      }
    }
  }
  let saveTimer = null;
  function markDirty(reason = '') {
    state.autosave.dirty = true;
    updateAutosaveUI();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 900);
  }

  /* =======================
     Parse / Build masters
  ======================= */
  function ensureRowId(row) {
    if (!row._id) row._id = 'r_' + Math.random().toString(36).slice(2, 10) + '_' + now().toString(36);
    return row._id;
  }

  function normalizeAbbr(s, maxLen = 4) {
    s = (s || '').trim();
    if (!s) return '';
    // remove spaces; keep up to maxLen chars (subjects default 4; teachers use larger)
    const t = s.replace(/\s+/g, '');
    return maxLen == null ? t : t.slice(0, maxLen);
  }


  function inferTeacherAbbrFromRaw(name) {
    const counts = new Map();
    for (const r of (state.rawRows || [])) {
      if ((r.tea || '') !== name) continue;
      const ab = String(r.teaAbbr || '').trim();
      if (!ab) continue;
      counts.set(ab, (counts.get(ab) || 0) + 1);
    }
    let best = '', bestN = 0;
    for (const [ab, n] of counts.entries()) {
      if (n > bestN) { bestN = n; best = ab; }
    }
    return best || name;
  }

  function rebuildMastersFromRaw() {
    // Ensure subject/teacher keys exist
    const subjKeys = new Set();
    const teaKeys = new Set();
    for (const r of state.rawRows) {
      ensureRowId(r);
      const subj = (r.subj || '').trim();
      if (subj) subjKeys.add(subj);
      const teas = splitList(r.tea);
      teas.forEach(t => teaKeys.add(t));
    }
    for (const s of subjKeys) {
      if (!state.subjectCfg[s]) state.subjectCfg[s] = { abbr: (rfindSubjAbbr(s) || normalizeAbbr(s)), dept: rfindDept(s) || '', color: pickColor(s), fixedForbid: {}, noSameDay: false, noConsec: false, maxPerDay: null, allowedMode: false, allowedSlots: {} };
      state.subjectCfg[s].color ||= pickColor(s);
      state.subjectCfg[s].abbr ||= normalizeAbbr(s);
      // v33.0: ensure allowedMode/allowedSlots exist
      if (state.subjectCfg[s].allowedMode === undefined) state.subjectCfg[s].allowedMode = false;
      if (state.subjectCfg[s].noConsec === undefined) state.subjectCfg[s].noConsec = false;
      if (!state.subjectCfg[s].allowedSlots) state.subjectCfg[s].allowedSlots = {};
    }
    for (const t of teaKeys) {
      if (!state.teacherCfg[t]) {
        state.teacherCfg[t] = { abbr: t, abbrAuto: true, dept: '', maxDaily: null, maxConsec: null, unavailable: {}, allowedMode: false, allowedSlots: {} };
      }
      const cfg = state.teacherCfg[t];
      // v47-B1: ensure breakSlots exists
      if (!cfg.breakSlots) cfg.breakSlots = {};
      // v32.2: prefer CSV '教員略' when auto; allow manual override
      if (cfg.abbrAuto === undefined) {
        const ab = (cfg.abbr || '').trim();
        cfg.abbrAuto = (!ab || ab === normalizeAbbr(t, 4) || ab === normalizeAbbr(t, 12) || ab === t);
      }
      const inferred = inferTeacherAbbrFromRaw(t);
      if (cfg.abbrAuto) {
        cfg.abbr = inferred;
      } else {
        cfg.abbr ||= inferred;
      }
    }
  }

  function rfindSubjAbbr(subj) {
    for (const r of state.rawRows) { if ((r.subj || '').trim() === subj && (r.subjAbbr || '').trim()) return r.subjAbbr.trim(); }
    return '';
  }
  function rfindDept(subj) {
    for (const r of state.rawRows) { if ((r.subj || '').trim() === subj && (r.dept || '').trim()) return r.dept.trim(); }
    return '';
  }

  // データ登録の行から作成画面のコマを作り直す。行が同じならコマの番号も同じなので、配置・ロックはそのまま残る
  //   opts.history=false … 呼び出し側で「元に戻す」の記録を済ませている時
  //   opts.keepSelection … 選んでいたコマが残っていれば選択も残す
  function reflectRawToItems(opts = {}) {
    if (opts.history !== false) pushHistory('reflect');
    const keepSel = opts.keepSelection ? state.ui.selectedId : null;
    const items = {};
    const placementsOld = state.placements || {};
    const newPlacements = {};
    rebuildMastersFromRaw();

    for (const r of state.rawRows) {
      ensureRowId(r);
      const cls = splitList(r.cls);
      const subj = (r.subj || '').trim();
      if (!cls.length || !subj) continue;
      const subjKey = subj;
      const teas = splitList(r.tea);
      const teaKey = teas.join(',') || ''; // multi teacher group
      const rooms = splitList(r.room);
      // span は 3連以上も保持（r.span 優先、無ければ dbl から）
      const span = Math.max(1, parseInt(r.span, 10) || (r.dbl ? 2 : 1) || 1);
      const parallel = !!r.parallel;
      const count = Math.max(1, parseInt(r.count || 1, 10) || 1);
      for (let k = 1; k <= count; k++) {
        const id = `${r._id}__${k}`;
        items[id] = {
          id, srcId: r._id,
          cls, subj, subjKey,
          teas, teaKey,
          rooms,
          span,
          parallel,
          locked: !!(placementsOld[id] && placementsOld[id].locked),
          countIdx: k
        };
        // 読込由来の同時展開/相乗り表示情報を保持
        if (r.simul) items[id].simul = true;
        if (r.realSubj) items[id].realSubj = r.realSubj;
        if (placementsOld[id] && placementsOld[id].day) {
          newPlacements[id] = placementsOld[id];
        } else {
          newPlacements[id] = null;
        }
      }
    }
    state.items = items;
    state.placements = newPlacements;
    if (!(keepSel && items[keepSel])) { state.ui.selectedId = null; state.ui.selectedFrom = ''; }
    invalidateIndex();
    _rawSigAtReflect = rawRowsSig();
    markDirty('reflectRawToItems');
  }
  // データ登録の内容の「指紋」。変わったかどうかの判定に使う
  let _rawSigAtReflect = null;
  function rawRowsSig() {
    try { return JSON.stringify((state.rawRows || []).map(r => [r._id, r.cls, r.subj, r.tea, r.room, r.count, r.span, r.dbl, r.parallel, r.simul, r.realSubj])); } catch (e) { return ''; }
  }
  // データ登録の画面に入った時の内容を基準として覚える（ここから変わった分だけを反映する）
  function markRawBaseline() { _rawSigAtReflect = rawRowsSig(); }
  // データ登録で変えた内容が、まだ作成画面に反映されていなければ反映する（配置・ロック・選択はそのまま）
  function autoReflectIfChanged() {
    const sig = rawRowsSig();
    if (_rawSigAtReflect === null || sig === _rawSigAtReflect) return false;
    // 反映すると外れる配置があるか先に数える（行を消した・コマ数を減らした・CSVを読み直した時など）
    const newIds = new Set();
    for (const r of state.rawRows || []) {
      if (!splitList(r.cls).length || !(r.subj || '').trim()) continue;
      const n = Math.max(1, parseInt(r.count || 1, 10) || 1);
      for (let k = 1; k <= n; k++) newIds.add(`${ensureRowId(r)}__${k}`);
    }
    const lost = Object.keys(state.placements || {}).filter(id => state.placements[id]?.day && !newIds.has(id)).length;
    const doIt = () => {
      const before = Object.values(state.placements || {}).filter(p => p && p.day).length;
      reflectRawToItems({ keepSelection: true });
      const after = Object.values(state.placements || {}).filter(p => p && p.day).length;
      flash(before === after ? 'データ登録の変更を作成画面に反映しました（配置はそのまま）' : `データ登録の変更を反映しました（配置 ${before}→${after}コマ）`, 5000);
      try { rerenderAll(); } catch (e) { }
    };
    if (!lost) { doIt(); return true; }
    // 配置が外れる時は黙って進めず確かめる（「しない」を選んでも、データ登録の「作成画面へ反映」でいつでも反映できる）
    _rawSigAtReflect = sig;
    showModalHTML('データ登録の変更を反映しますか？', `<div style="line-height:1.8">反映すると、作成画面に置いてある <b>${lost} コマ</b>が外れて在庫に戻ります。<br><span style="color:#64748b">（行を消した・コマ数を減らした・CSVを読み直した、など）</span><br><br>「反映する」… 作成画面を新しいデータに合わせる<br>「今のまま」… 作成画面はそのまま（後でデータ登録の「作成画面へ反映」からいつでも反映できます）</div>`, doIt, '反映する', '今のまま');
    return true;
  }

