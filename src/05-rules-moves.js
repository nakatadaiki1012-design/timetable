  /* =======================
     Constraints / Counts
  ======================= */
  function maxPeriod(day) {
    const v = state.settings.periodsByDay[day];
    return (v != null) ? v : 6; // 0 = hidden, undefined falls back to 6
  }
  // Active days (periodsByDay > 0 means the day is shown)
  function activeDays() { return DAYS.filter(d => maxPeriod(d) > 0); }
  // Effective max period for an item, considering per-class overrides
  function maxPeriodForItem(it, day) {
    if (!it) return maxPeriod(day);
    const ov = state.settings.classPeriodOverride || {};
    let m = maxPeriod(day);
    for (const c of (it.cls || [])) {
      if (ov[c] && ov[c][day] != null) m = Math.min(m, Number(ov[c][day]));
    }
    return m;
  }

  function idCoversCell(id, day, period) {
    const plc = state.placements[id];
    if (!plc) return false;
    if (plc.day !== day) return false;
    const span = state.items[id]?.span || 1;
    return period >= plc.period && period < plc.period + span;
  }
  function isSpanFill(id, day, period) {
    const plc = state.placements[id];
    if (!plc) return false;
    const span = state.items[id]?.span || 1;
    // 【C-6】3連以上(span>=3)も継続コマとして扱う（従来はspan===2のみ）
    return (span >= 2 && plc.day === day && period > plc.period && period < plc.period + span);
  }

  function teacherDailyMax(tea) {
    const tcfg = state.teacherCfg[tea] || {};
    return (tcfg.maxDaily != null && tcfg.maxDaily !== '') ? Number(tcfg.maxDaily) :
      (state.settings.teaDefaultMaxDaily != null && state.settings.teaDefaultMaxDaily !== '') ? Number(state.settings.teaDefaultMaxDaily) : null;
  }
  function teacherConsecMax(tea) {
    const tcfg = state.teacherCfg[tea] || {};
    return (tcfg.maxConsec != null && tcfg.maxConsec !== '') ? Number(tcfg.maxConsec) :
      (state.settings.teaDefaultMaxConsec != null && state.settings.teaDefaultMaxConsec !== '') ? Number(state.settings.teaDefaultMaxConsec) : null;
  }

  let __idxCache = null;
  function invalidateIndex() { __idxCache = null; _jisenCache = null; }

  function buildIndex() {
    if (__idxCache) return __idxCache;
    // Returns indexes to quickly check conflicts
    const idx = { tea: {}, cls: {}, room: {} }; // idx.tea[tea][day][period] => [ids]
    for (const id in state.items) {
      const it = state.items[id];
      const plc = state.placements[id];
      if (!plc) continue;
      for (let dp = 0; dp < it.span; dp++) {
        const day = plc.day; const p = plc.period + dp;
        // teacher
        for (const tea of (it.teas.length ? it.teas : ['(未)'])) {
          idx.tea[tea] ??= {}; idx.tea[tea][day] ??= {}; idx.tea[tea][day][p] ??= [];
          idx.tea[tea][day][p].push(id);
        }
        // class
        for (const c of it.cls) {
          idx.cls[c] ??= {}; idx.cls[c][day] ??= {}; idx.cls[c][day][p] ??= [];
          idx.cls[c][day][p].push(id);
        }
        // room
        for (const r of ((it.rooms?.length) ? it.rooms : ['(未)'])) {
          idx.room[r] ??= {}; idx.room[r][day] ??= {}; idx.room[r][day][p] ??= [];
          idx.room[r][day][p].push(id);
        }
      }
    }
    __idxCache = idx;
    return idx;
  }

  /* =======================
     Duplicate Resolver (一括二重解消)
  ======================= */
  function resolveAllDuplicatesToStock() {
    pushHistory('fixDupAll');
    const moved = new Set();
    let loops = 0;
    const maxLoops = 6;

    const pickKeep = (ids) => {
      const ranked = ids.map(id => {
        const it = state.items[id] || {};
        const plc = state.placements[id];
        const locked = !!plc?.locked;
        const span = it.span || 1;
        const par = !!it.parallel;
        const score = (locked ? 1000 : 0) + span * 10 + (par ? 2 : 0) + (it.teas?.length || 0) + (it.cls?.length || 0) + (it.rooms?.length || 0);
        return { id, score };
      }).sort((a, b) => b.score - a.score);
      return ranked[0]?.id || ids[0];
    };

    while (loops++ < maxLoops) {
      invalidateIndex();
      const idx = buildIndex();
      const toStash = new Set();

      const markConf = (ids) => {
        if (!ids || ids.length <= 1) return;
        const keep = pickKeep(ids);
        for (const id of ids) {
          if (id === keep) continue;
          toStash.add(id);
        }
      };

      // teacher conflicts (parallel-only is exempt)
      for (const tea in idx.tea) {
        const byDay = idx.tea[tea] || {};
        for (const day in byDay) {
          const byP = byDay[day] || {};
          for (const p in byP) {
            const ids = byP[p] || [];
            if (ids.length <= 1) continue;
            const nonPar = ids.filter(id => !state.items[id]?.parallel);
            if (nonPar.length === 0) continue;
            markConf(ids);
          }
        }
      }

      // class conflicts (parallel-only is exempt)
      for (const c in idx.cls) {
        const byDay = idx.cls[c] || {};
        for (const day in byDay) {
          const byP = byDay[day] || {};
          for (const p in byP) {
            const ids = byP[p] || [];
            if (ids.length <= 1) continue;
            const nonPar = ids.filter(id => !state.items[id]?.parallel);
            if (nonPar.length === 0) continue;
            markConf(ids);
          }
        }
      }

      // room conflicts (always)
      for (const r in idx.room) {
        const byDay = idx.room[r] || {};
        for (const day in byDay) {
          const byP = byDay[day] || {};
          for (const p in byP) {
            const ids = byP[p] || [];
            if (ids.length <= 1) continue;
            markConf(ids);
          }
        }
      }

      let changed = 0;
      for (const id of toStash) {
        if (!state.placements[id]) continue;
        state.placements[id] = null;
        moved.add(id);
        changed++;
      }
      if (!changed) break;
    }

    invalidateIndex();
    markDirty('fixDupAll');
    rerenderAll();
    broadcastState();
    flash(`二重を解消: ${moved.size}コマを在庫へ退避`);
  }

  function teacherConsecRun(tea, day) {
    // returns longest consecutive run, respecting lunch break
    const lunchAfter = Number(state.settings.lunchAfter || 0);
    const maxP = maxPeriod(day);
    const taught = new Set();
    const idx = buildIndex();
    for (let p = 1; p <= maxP; p++) {
      const ids = idx.tea?.[tea]?.[day]?.[p] || [];
      if (ids.length) taught.add(p);
    }
    let best = 0, cur = 0;
    for (let p = 1; p <= maxP; p++) {
      if (lunchAfter && p === lunchAfter + 1) { cur = 0; } // break at lunch boundary
      if (taught.has(p)) { cur++; best = Math.max(best, cur); } else cur = 0;
    }
    return best;
  }

  function countSameDaySubject(cls, subjKey, day) {
    let cnt = 0;
    for (const id in state.items) {
      const it = state.items[id];
      if (!it.cls.includes(cls) || it.subjKey !== subjKey) continue;
      const plc = state.placements[id];
      if (plc && plc.day === day) cnt += it.span;
    }
    return cnt;
  }

  function hasSameDaySubjectDuplicate(cls, subjKey, day, exceptId = null) {
    // If noSameDay, allow at most once start (span counts as 1 "lesson")
    let starts = 0;
    for (const id in state.items) {
      if (id === exceptId) continue;
      const it = state.items[id];
      if (!it.cls.includes(cls) || it.subjKey !== subjKey) continue;
      const plc = state.placements[id];
      if (plc && plc.day === day) starts++;
    }
    return starts > 0;
  }

  // 学校のルール: 自選（自由選択）は名前の曜日（例: 自由選択(金)→金曜）の、その学年の最後のコマ（2連なら最後の2コマ）にしか置けない。
  // 3年生は授業を取っていない生徒が多いため、途中のコマには入れられない。
  let _jisenCache = null;
  const JISEN_DAY = { '月': 'Mon', '火': 'Tue', '水': 'Wed', '木': 'Thu', '金': 'Fri', '土': 'Sat' };
  function jisenRule(subjKey) {
    if (!/自選|自由選択/.test(subjKey || '')) return null;
    if (!_jisenCache) _jisenCache = {};
    if (_jisenCache[subjKey] !== undefined) return _jisenCache[subjKey];
    const m = String(subjKey).match(/[（(]\s*([月火水木金土])\s*[)）]/);
    const day = m ? JISEN_DAY[m[1]] : null;
    // その授業を受けるクラスの「その曜日の最後の時限」と、コマの長さ
    let span = 1; const lastByDay = {};
    for (const id in state.items) {
      const it = state.items[id]; if (!it || it.subjKey !== subjKey) continue;
      span = Math.max(span, it.span || 1);
      for (const d of DAYS) { const mp = maxPeriodForItem(it, d); lastByDay[d] = lastByDay[d] == null ? mp : Math.min(lastByDay[d], mp); }
    }
    return (_jisenCache[subjKey] = { day, span, lastByDay });
  }
  function isForbiddenForSubject(subjKey, day, period) {
    const jr = jisenRule(subjKey);
    if (jr) {
      if (jr.day && day !== jr.day) return true;
      const last = jr.lastByDay[day];
      if (last != null && (period > last || period < last - jr.span + 1)) return true;
    }
    const scfg = state.subjectCfg[subjKey] || {};
    // allowedMode: only listed slots are allowed; everything else is forbidden
    if (scfg.allowedMode && scfg.allowedSlots && Object.keys(scfg.allowedSlots).length) {
      const allowed = scfg.allowedSlots[day] || [];
      return !allowed.includes(period);
    }
    const arr = scfg.fixedForbid?.[day] || [];
    return arr.includes(period);
  }
  function isUnavailableForTeacher(tea, day, period) {
    const tcfg = state.teacherCfg[tea] || {};
    // v43: allowedMode — only listed slots are allowed; everything else is unavailable
    if (tcfg.allowedMode && tcfg.allowedSlots && Object.keys(tcfg.allowedSlots).length) {
      const allowed = tcfg.allowedSlots[day] || [];
      return !allowed.includes(period);
    }
    const arr = tcfg.unavailable?.[day] || [];
    return arr.includes(period);
  }

  // 他のコマの位置に関係なく決まる「置けない理由」（時限の範囲・2連の最終時限・クラス時限上限・固定禁則/自選・教員不可）。
  // validatePlacement と、先読み探索（puzzle.js の収まり探索）の両方が同じ判定を使う。
  function staticBlocks(it, day, period) {
    const blocks = [];
    const maxP = maxPeriod(day);
    if (period < 1 || period > maxP) blocks.push('その曜日にその時限はありません');
    if (it.span === 2 && period === maxP) blocks.push('2連は最終時限に開始できません');

    // per-class period override
    const clsMaxP = maxPeriodForItem(it, day);
    for (let dp = 0; dp < it.span; dp++) {
      if (period + dp > clsMaxP) blocks.push(`クラス時限上限 (${period + dp}>${clsMaxP})`);
    }

    // fixed forbid
    for (let dp = 0; dp < it.span; dp++) {
      if (isForbiddenForSubject(it.subjKey, day, period + dp)) blocks.push(jisenRule(it.subjKey) ? `自選は${(jisenRule(it.subjKey).day && DAYJP[jisenRule(it.subjKey).day]) || '指定の曜日'}の最後のコマにしか置けません` : `固定禁則: ${DAYJP[day]}${period + dp}`);
    }
    for (const tea of it.teas) {
      for (let dp = 0; dp < it.span; dp++) {
        if (isUnavailableForTeacher(tea, day, period + dp)) blocks.push(`教員不可: ${tea} ${DAYJP[day]}${period + dp}`);
      }
    }
    return blocks;
  }

  function validatePlacement(id, day, period, mode = 'safe', swapTargetId = null) {
    // returns {ok, warns:[...], blocks:[...]}
    const it = state.items[id];
    if (!it) return { ok: false, warns: [], blocks: ['不明なコマ'] };
    const warns = []; const blocks = staticBlocks(it, day, period);
    const maxP = maxPeriod(day);

    // teacher unavailable & conflicts
    const idx = buildIndex();
    const isParallel = !!it.parallel;
    // Helper: is teacher conflict "exempt" because both items are parallel?
    const parallelExempt = (conflictId) => isParallel && !!(state.items[conflictId]?.parallel);
    for (const tea of it.teas) {
      for (let dp = 0; dp < it.span; dp++) {
        const p = period + dp;
        // v47-B1: breakSlots 警告（配置は可能だが推奨しない）
        const bSlots = state.teacherCfg[tea]?.breakSlots;
        if (bSlots && (bSlots[day] || []).includes(p)) warns.push(`休憩推奨コマ: ${tea} ${DAYJP[day]}${p}（可能だが要確認）`);
        const occ = idx.tea?.[tea]?.[day]?.[p] || [];
        const occ2 = occ.filter(x => x !== id && x !== swapTargetId);
        // parallel items: ignore teacher conflict with other parallel items only
        const nonParallelConflicts = occ2.filter(x => !parallelExempt(x));
        if (nonParallelConflicts.length) blocks.push(`教員重複: ${tea} ${DAYJP[day]}${p}`);
        else if (occ2.length && isParallel) warns.push(`並列展開: ${tea} ${DAYJP[day]}${p}（${occ2.length}コマ並列）`);
      }
      const maxD = teacherDailyMax(tea);
      if (maxD != null) {
        // count planned
        let taught = 0;
        for (let p = 1; p <= maxP; p++) {
          const occ = idx.tea?.[tea]?.[day]?.[p] || [];
          const occ2 = occ.filter(x => x !== id && x !== swapTargetId);
          if (occ2.length) taught++;
        }
        taught += it.span;
        if (taught > maxD) warns.push(`教員1日上限超: ${tea} ${taught}/${maxD}`);
      }
      const maxC = teacherConsecMax(tea);
      if (maxC != null) {
        // simulate: temporarily place and compute max run (rough)
        // We'll approximate by counting current + new; recompute run using temporary set
        const lunchAfter = Number(state.settings.lunchAfter || 0);
        const taught = new Set();
        for (let p = 1; p <= maxP; p++) {
          const occ = idx.tea?.[tea]?.[day]?.[p] || [];
          const occ2 = occ.filter(x => x !== id && x !== swapTargetId);
          if (occ2.length) taught.add(p);
        }
        for (let dp = 0; dp < it.span; dp++) taught.add(period + dp);
        let best = 0, cur = 0;
        for (let p = 1; p <= maxP; p++) {
          if (lunchAfter && p === lunchAfter + 1) cur = 0;
          if (taught.has(p)) { cur++; best = Math.max(best, cur); } else cur = 0;
        }
        if (best > maxC) warns.push(`連続上限超: ${tea} ${best}/${maxC}`);
      }
    }

    // class conflicts — parallel items may share class timeslots with other parallel items
    for (const c of it.cls) {
      for (let dp = 0; dp < it.span; dp++) {
        const p = period + dp;
        const occ = idx.cls?.[c]?.[day]?.[p] || [];
        const occ2 = occ.filter(x => x !== id && x !== swapTargetId);
        // parallel items: class conflict only if the conflicting item is NOT parallel
        const nonParallelClassConflicts = isParallel
          ? occ2.filter(x => !parallelExempt(x))
          : occ2;
        if (nonParallelClassConflicts.length) blocks.push(`クラス重複: ${c} ${DAYJP[day]}${p}`);
      }
      const scfg = state.subjectCfg[it.subjKey] || {};
      if (scfg.noSameDay) {
        if (hasSameDaySubjectDuplicate(c, it.subjKey, day, id)) warns.push(`同日同科目: ${c} ${it.subj} (${DAYJP[day]})`);
      }
      if (scfg.maxPerDay != null && scfg.maxPerDay !== '') {
        const maxN = Number(scfg.maxPerDay);
        const n = countSameDaySubject(c, it.subjKey, day) + it.span;
        if (n > maxN) warns.push(`同日上限超: ${c} ${it.subj} ${n}/${maxN}`);
      }
      // v46-B2: 科目連続禁止チェック
      if (scfg.noConsec) {
        const idxNow = buildIndex();
        const prevId = (idxNow.cls?.[c]?.[day]?.[period - 1] || [])[0];
        const nextId = (idxNow.cls?.[c]?.[day]?.[period + it.span] || [])[0];
        if (prevId && prevId !== id && state.items[prevId]?.subjKey === it.subjKey) warns.push(`連続禁止: ${c} ${it.subj} が ${DAYJP[day]}${period - 1}-${period}限に連続`);
        if (nextId && nextId !== id && state.items[nextId]?.subjKey === it.subjKey) warns.push(`連続禁止: ${c} ${it.subj} が ${DAYJP[day]}${period + it.span - 1}-${period + it.span}限に連続`);
      }
    }

    // room conflicts
    if (state.settings.roomConflict) {
      const rooms = it.rooms;
      for (const r of rooms) {
        for (let dp = 0; dp < it.span; dp++) {
          const p = period + dp;
          const occ = idx.room?.[r]?.[day]?.[p] || [];
          const occ2 = occ.filter(x => x !== id && x !== swapTargetId);
          if (occ2.length) blocks.push(`教室重複: ${r} ${DAYJP[day]}${p}`);
        }
      }
    }

    const ok = blocks.length === 0 || (mode === 'swap' && blocks.length === 0); // swap doesn't bypass "blocks"
    return { ok, warns, blocks };
  }

  // 禁制（固定禁則/教員不可/時限範囲/2連最終/クラス時限上限）は「強制」でも上書き不可
  function isAbsoluteBlockMsg(msg) {
    if (!msg) return false;
    return msg.startsWith('固定禁則')
      || msg.startsWith('教員不可')
      || msg.startsWith('その曜日にその時限はありません')
      || msg.startsWith('2連は最終時限')
      || msg.startsWith('クラス時限上限');
  }
  function absoluteBlocksOf(blocks) {
    return (blocks || []).filter(isAbsoluteBlockMsg);
  }

  /* =======================
     Mutations
  ======================= */
  function placeItem(id, day, period, opts = { mode: 'safe' }) {
    try {
      const it = state.items[id]; if (!it) return;
      if (state.placements[id] && state.placements[id].locked) { flash('ロック中'); return; }

      const mode = opts.mode || state.ui.drop || 'safe';
      const idx = buildIndex();

      // Check for conflicts in target cell
      const existingIds = [];
      for (const tea of it.teas) { (idx.tea?.[tea]?.[day]?.[period] || []).forEach(x => { if (x !== id && !isSpanFill(x, day, period)) existingIds.push(x); }); }
      it.cls.forEach(c => (idx.cls?.[c]?.[day]?.[period] || []).forEach(x => { if (x !== id && !isSpanFill(x, day, period)) existingIds.push(x); }));
      it.rooms.forEach(r => (idx.room?.[r]?.[day]?.[period] || []).forEach(x => { if (x !== id && !isSpanFill(x, day, period)) existingIds.push(x); }));

      const existingComaIds = [...new Set(existingIds)];

      // v49: 強制上書モード — 衝突コマを在庫へ押し出して即配置
      if (mode === 'force') {
        // 禁制（固定禁則/教員不可など）は強制でも不可
        const v0 = validatePlacement(id, day, period, 'safe', null);
        const abs = absoluteBlocksOf(v0.blocks);
        if (abs.length) {
          showPlacementFailDialog(id, day, period, abs);
          return;
        }
        pushHistory('place-force');
        for (const cid of existingComaIds) {
          if (!state.placements[cid]?.locked) state.placements[cid] = null;
        }
        invalidateIndex();
        doPlace(id, day, period, null);
        if (opts.afterPlace) try { opts.afterPlace(); } catch (e2) { }
        const pushed = existingComaIds.length;
        if (pushed) flash(`強制配置: ${pushed}コマを在庫へ移動`);
        return;
      }

      // ★ シンプル化: 空セルまたは入替モードは直接実行
      if (existingComaIds.length === 0 || mode === 'swap') {
        // 空セルまたは入替モード → 標準フローで処理
        let swapTarget = null;
        if (mode === 'swap' && existingComaIds.length === 1) {
          swapTarget = existingComaIds[0];
        }

        const v = validatePlacement(id, day, period, mode, swapTarget);
        if (v.blocks.length) {
          // ブロック（ハード制約違反）がある場合のみダイアログ
          showPlacementFailDialog(id, day, period, v.blocks);
          return;
        }
        if (v.warns.length && mode === 'safe') {
          // 警告がある場合は確認ダイアログ
          showModal('警告（続行しますか？）', v.warns.join('\n'), () => {
            pushHistory('place');
            doPlace(id, day, period, swapTarget);
            if (opts.afterPlace) try { opts.afterPlace(); } catch (e2) { }
          });
          return;
        }
        // 問題なし → 直接配置
        pushHistory('place');
        doPlace(id, day, period, swapTarget);
        if (opts.afterPlace) try { opts.afterPlace(); } catch (e2) { }
        return;
      }

      // ★ 衝突があり、入替モードでもない → 衝突解決ダイアログ
      showConflictResolutionDialog(id, day, period, existingComaIds, opts.afterPlace);

    } catch (e) {
      console.error('Error in placeItem:', e);
      flash('配置エラー: ' + e.message);
    }
  }

  function showConflictResolutionDialog(id, day, period, existingComaIds, afterPlace = null) {
    try {
      const it = state.items[id];
      const scfg = state.subjectCfg[it.subjKey] || {};
      const abbr = scfg.abbr || it.subj || id;
      const existingNames = existingComaIds.map(cid => {
        const c = state.items[cid];
        const cfg = state.subjectCfg[c?.subjKey] || {};
        return cfg.abbr || c?.subj || cid;
      }).join(', ');


      // 禁制（固定禁則/教員不可など）は、強制配置でも上書き不可
      const absBlocks = absoluteBlocksOf((validatePlacement(id, day, period, 'safe', null) || { blocks: [] }).blocks);

      // Generate simple solutions
      const solutions = [];

      // 一番のおすすめ: 押し出されるコマも含めて全員が収まる形（収まり探索でこのマスだけを集中的に読む）
      if (!absBlocks.length && typeof fitJob === 'function') {
        try {
          const job = fitJob(id, { hardDeadline: true, maxMoves: 14, nodeCap: 12000, sweeps: 2, onlySlot: { day, period } });
          job.step(700);
          const fit = job.suggestions()[0];
          if (fit) {
            solutions.push({
              title: `⭐ 全員が収まる形で入れる（${fit.moves.length - 1}コマを動かす）`,
              action: 'fit',
              moves: fit.moves,
              reason: (fit.reason || []).slice(1),
              recommended: true,
            });
          }
        } catch (e) { console.error('収まり探索(ドラッグ):', e); }
      }

      // Solution 1: Remove existing items
      solutions.push({
        title: '既存コマを外す（在庫へ）',
        action: 'remove',
        ids: existingComaIds,
        reason: ['既存コマを在庫に移動して配置'],
      });

      // Solution 2: Swap with first existing
      if (existingComaIds.length === 1) {
        solutions.push({
          title: '交換する',
          action: 'swap',
          swapTarget: existingComaIds[0],
          reason: ['既存コマと入れ替え'],
        });
      }

      // Solution 3: Try to find alternative empty slots for the new item
      for (const altDay of DAYS) {
        const maxP = maxPeriod(altDay);
        for (let p = 1; p <= maxP; p++) {
          if (it.span === 2 && p === maxP) continue;
          const curP = state.placements[id];
          if (curP && curP.day === altDay && curP.period === p) continue; // 今いる場所は候補にしない
          const v = validatePlacement(id, altDay, p, 'safe', null);
          if (v.blocks.length === 0) {
            solutions.push({
              title: `別の空き枠へ配置: ${DAYJP[altDay]}${p}`,
              action: 'move',
              day: altDay,
              period: p,
              reason: ['競合を避けて別の枠に配置'],
            });
            // Only show first 2 alternatives
            if (solutions.filter(s => s.action === 'move').length >= 2) break;
          }
        }
        if (solutions.filter(s => s.action === 'move').length >= 2) break;
      }


      // 危険な「強制配置」は一番下に置く（以前は一番上にあり、押し間違えやすかった）
      if (!absBlocks.length) {
        solutions.push({
          title: '⚠️ 強制配置（既存コマを上書き）',
          action: 'force',
          reason: ['重複したまま置きます（既存コマは在庫へ）'],
          dangerous: true,
        });
      }

      // Show dialog with solutions
      const modal = document.getElementById('modal');
      const title = document.getElementById('modal-title');
      const msgDiv = document.getElementById('modal-msg');
      const okBtn = document.getElementById('modal-ok');
      const cancelBtn = document.getElementById('modal-cancel');

      title.textContent = 'コマの配置方法を選択';

      const solutionHtml = solutions.map((sol, idx) => {
        const bgColor = sol.dangerous ? '#fef2f2' : sol.recommended ? '#ecfdf5' : '#f1f5f9';
        const borderColor = sol.dangerous ? '#fca5a5' : sol.recommended ? '#34d399' : '#cbd5e1';
        const textColor = sol.dangerous ? '#991b1b' : sol.recommended ? '#065f46' : '#0f172a';
        return `
      <div style="background:${bgColor};border:1px solid ${borderColor};border-radius:8px;padding:10px;margin:8px 0;cursor:pointer;transition:all 0.2s;" 
           onmouseover="this.style.background='${sol.dangerous ? '#fee2e2' : sol.recommended ? '#d1fae5' : '#e2e8f0'}'" 
           onmouseout="this.style.background='${bgColor}'"
           onclick="window._applyConflictSolution(${idx});">
        <div style="font-weight:900;color:${textColor};">${escapeHtml(sol.title)}</div>
        <div style="font-size:11px;color:#64748b;margin-top:4px;">${sol.reason.map(r => `• ${escapeHtml(r)}`).join('<br>')}</div>
      </div>
    `;
      }).join('');

      // この窓は改行をそのまま表示する設定なので、HTMLの改行・字下げを詰めてから入れる（以前は大きなすき間ができていた）
      msgDiv.innerHTML = (`
      <div style="margin-bottom:10px;">
        <div>「${escapeHtml(abbr)}」を ${DAYJP[day]}${period} に配置</div>
        <div style="font-size:12px;color:#64748b;margin-top:4px;">既存: 「${escapeHtml(existingNames)}」</div>
        ${absBlocks.length ? `<div style="margin-top:6px;padding:6px 8px;border-radius:8px;background:#fff7ed;border:1px solid #fed7aa;color:#9a3412;font-size:12px;">禁制のため、この枠への強制配置はできません：<br>${absBlocks.map(x => `• ${escapeHtml(x)}`).join('<br>')}</div>` : ''}
      </div>
      <div style="font-weight:900;color:#0f172a;margin:10px 0;font-size:12px;">解決案:</div>
      ${solutionHtml}
    `).replace(/>\s*\n\s*</g, '><').replace(/\n\s*/g, ' ');

      okBtn.style.display = 'none';
      cancelBtn.textContent = 'キャンセル';
      const _closeConflictModal = () => { modal.classList.remove('show'); modal.style.display = ''; modal.setAttribute('aria-hidden', 'true'); modal.removeEventListener('click', _overlayClose); };
      const _overlayClose = (ev) => { if (ev.target === modal) _closeConflictModal(); };
      cancelBtn.onclick = _closeConflictModal;
      modal.addEventListener('click', _overlayClose);

      modal.style.display = '';
      modal.classList.add('show');
      modal.setAttribute('aria-hidden', 'false');

      // Set global handler for solutions
      window._applyConflictSolution = (idx) => {
        try {
          _closeConflictModal();
          const sol = solutions[idx];
          if (!sol) return;


          if (sol.action === 'fit') {
            applySuggestion({ moves: sol.moves });
            flash(`全員が収まる形で配置しました（${sol.moves.length}コマを移動）`);
          } else if (sol.action === 'force') {
            // Force placement: remove existing items and place without validation
            // ただし禁制（固定禁則/教員不可など）は強制でも不可
            const abs = absoluteBlocksOf((validatePlacement(id, day, period, 'safe', null) || { blocks: [] }).blocks);
            if (abs.length) {
              showToast('禁制のため強制配置できません', 'error');
              showPlacementFailDialog(id, day, period, abs);
              return;
            }
            pushHistory('place');
            for (const cid of existingComaIds) {
              state.placements[cid] = null;
            }
            invalidateIndex();
            // Force place without validation
            state.placements[id] = { day, period, locked: false };
            invalidateIndex();
            markDirty('place');
            rerenderAll();
            broadcastState();
            flash(`⚠️ 強制配置しました（制約無視）`);
          } else if (sol.action === 'remove') {
            // Remove existing items to stock
            pushHistory('place'); // 外す前に記録する（以前は外した後に記録していて「元に戻す」で在庫へ出したコマが戻らなかった）
            for (const cid of sol.ids) {
              state.placements[cid] = null;
            }
            invalidateIndex();
            flash(`「${existingNames}」を在庫へ移動しました`);
            doPlace(id, day, period, null);
          } else if (sol.action === 'swap') {
            pushHistory('place');
            doPlace(id, day, period, sol.swapTarget);
            flash('コマを交換しました');
          } else if (sol.action === 'move') {
            pushHistory('place');
            doPlace(id, sol.day, sol.period, null);
            flash(`「${abbr}」を ${DAYJP[sol.day]}${sol.period} に配置しました`);
          }

          if (afterPlace) try { afterPlace(); } catch (e3) { }
        } catch (e) {
          console.error('Error applying solution:', e);
          flash('配置処理中にエラーが発生しました: ' + e.message);
        }
      };

    } catch (e) {
      console.error('Error in showConflictResolutionDialog:', e);
      flash('ダイアログの表示に失敗しました: ' + e.message);
    }
  }

  function showPlacementFailDialog(id, day, period, blocks) {
    // v41: Compute alternative suggestions (try-catch + async hint)
    let pack = null;
    try { pack = computeSuggestionPack(id); }
    catch (e) { console.error('computeSuggestionPack', e); showModal('エラー', '提案の計算でエラー: ' + e.message); return; }
    // v41: async refresh in background (non-blocking refinement after popup opens)
    setTimeout(() => {
      try {
        const refined = computeSuggestionPack(id);
        const box = document.getElementById('sug-popup-content');
        if (box && refined) { pack = refined; render(); }
      } catch (e) { }
    }, 120);
    const allAlts = [
      ...(pack.empty || []).slice(0, 3),
      ...(pack.swap || []).slice(0, 3),
      ...(pack.linked || []).slice(0, 2),
      ...(pack.cycle || []).slice(0, 2),
      ...(pack.lookahead || []).slice(0, 2),
    ].filter(Boolean).sort((a, b) => b.score - a.score).slice(0, 8);

    const blockMsg = blocks.join('\n');
    const it = state.items[id];
    const scfg = state.subjectCfg[it?.subjKey] || {};
    const abbr = scfg.abbr || it?.subj || '';

    // v32.5: Find blocking items for push-out options
    const idx0 = buildIndex();
    const span = it.span || 1;
    const blockers = new Set();
    for (let dp = 0; dp < span; dp++) {
      const pp = period + dp;
      for (const t of it.teas || []) (idx0.tea?.[t]?.[day]?.[pp] || []).forEach(x => { if (x !== id) blockers.add(x); });
      for (const c of it.cls || []) (idx0.cls?.[c]?.[day]?.[pp] || []).forEach(x => { if (x !== id) blockers.add(x); });
      if (state.settings?.roomConflict) for (const r of it.rooms || []) (idx0.room?.[r]?.[day]?.[pp] || []).forEach(x => { if (x !== id) blockers.add(x); });
    }
    const movableBlockers = [...blockers].filter(x => state.placements[x] && !state.placements[x]?.locked);

    const pushOutHTML = movableBlockers.length > 0 ? `
    <div class="fail-suggest" style="margin-bottom:8px">
      <h4>↗ 押し出す（衝突コマを退かす）</h4>
      ${movableBlockers.map((blkId, bi) => {
      const bit = state.items[blkId];
      const bscfg = state.subjectCfg[bit?.subjKey] || {};
      const babbr = bscfg.abbr || bit?.subj || blkId;
      const bplc = state.placements[blkId];
      const bwhere = bplc ? `${DAYJP[bplc.day]}${bplc.period}` : '—';
      return `<div class="fail-sug-item" style="margin-bottom:6px">
          <div class="ftop">「${escapeHtml(babbr.slice(0, 6))}」(${escapeHtml(bwhere)}) を押し出す</div>
          <div class="fbtns">
            <button class="fpush-stock" data-blkid="${escapeAttr(blkId)}" data-tid="${escapeAttr(id)}" data-day="${escapeAttr(day)}" data-p="${period}" style="background:#f59e0b;color:#fff;border:none">在庫へ退避して配置</button>
            <button class="fpush-near" data-blkid="${escapeAttr(blkId)}" data-tid="${escapeAttr(id)}" data-day="${escapeAttr(day)}" data-p="${period}">空きセルへ移動</button>
          </div>
        </div>`;
    }).join('')}
    </div>` : '';

    const altHTML = allAlts.length ? allAlts.map((s, i) => {
      const moves = s.moves || [];
      const tableRows = moves.map((m, mi) => {
        const mit = state.items[m.id];
        const mscfg = state.subjectCfg[mit?.subjKey] || {};
        const mabbr = (mscfg.abbr || mit?.subj || m.id).slice(0, 4);
        const mcls = (mit?.cls || []).join(',').slice(0, 8);
        const curPlc = state.placements[m.id];
        const fromStr = curPlc ? `${DAYJP[curPlc.day]}${curPlc.period}` : '(未配置)';
        const toStr = `${DAYJP[m.day]}${m.period}${m.span === 2 ? '–' + (m.period + 1) : ''}`;
        return `<tr class="${mi === 0 ? 'main-item' : 'other-item'}">
        <td class="col-from"><strong>${escapeHtml(mabbr)}</strong> <span style="color:#64748b;font-size:10px">${escapeHtml(mcls)}</span></td>
        <td class="col-day">${escapeHtml(fromStr)}</td>
        <td class="col-arrow">➜</td>
        <td class="col-to">${escapeHtml(toStr)}</td>
      </tr>`;
      }).join('');
      const table = moves.length ? `<table class="sug-move-table">
      <thead><tr><th>コマ</th><th>現在</th><th></th><th>移動先</th></tr></thead>
      <tbody>${tableRows}</tbody></table>` : '';
      const reasonStr = (s.reason || []).join(' · ');
      return `<div class="fail-sug-item">
      <div class="ftop">${escapeHtml(s.title || '')} <span class="muted small">score ${s.score || 0}</span></div>
      ${reasonStr ? `<div class="fdesc">${escapeHtml(reasonStr)}</div>` : ''}
      ${table}
      <div class="fbtns"><button class="fapply" data-sidx="${i}">✓ 採用</button></div>
    </div>`;
    }).join('') : '<div class="prop-empty">代替案なし（全セルが埋まっています）</div>';

    const html = `
    <div class="muted small" style="margin-bottom:8px">「${escapeHtml(abbr)}」を ${DAYJP[day]}${period} に配置できません：</div>
    <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:8px 10px;font-size:12px;white-space:pre-wrap;color:#7f1d1d;margin-bottom:10px">${escapeHtml(blockMsg)}</div>
    ${pushOutHTML}
    <div class="fail-suggest">
      <h4>📋 代替案（${allAlts.length}件）</h4>
      ${altHTML}
    </div>
  `;
    showModalHTML('配置できません — 代替案', html, null, '閉じる', 'キャンセル');

    // bind apply buttons after modal renders
    setTimeout(() => {
      document.querySelectorAll('.fail-sug-item .fapply').forEach(btn => {
        btn.onclick = () => {
          const idx2 = parseInt(btn.dataset.sidx, 10);
          const s = allAlts[idx2];
          if (!s) return;
          const modal = document.getElementById('modal');
          if (modal) modal.classList.remove('show');
          applySuggestion(s);
        };
      });
      // Push-out: move blocker to stock then place target
      document.querySelectorAll('.fpush-stock').forEach(btn => {
        btn.onclick = () => {
          const blkId = btn.dataset.blkid;
          const tid = btn.dataset.tid;
          const tday = btn.dataset.day;
          const tp = parseInt(btn.dataset.p, 10);
          const modal = document.getElementById('modal'); if (modal) modal.classList.remove('show');
          pushHistory('push-out');
          state.placements[blkId] = null;
          invalidateIndex();
          const v2 = validatePlacement(tid, tday, tp, 'force', null);
          if (v2.blocks.length === 0) {
            doPlace(tid, tday, tp, null);
          } else {
            rerenderAll();
            flash(`「${state.items[blkId] && (state.subjectCfg[state.items[blkId].subjKey]?.abbr || state.items[blkId].subj) || blkId}」を在庫へ`);
            rerenderAll();
          }
        };
      });
      // Push-out: find nearest empty cell for blocker, then place target
      document.querySelectorAll('.fpush-near').forEach(btn => {
        btn.onclick = () => {
          const blkId = btn.dataset.blkid;
          const tid = btn.dataset.tid;
          const tday = btn.dataset.day;
          const tp = parseInt(btn.dataset.p, 10);
          const modal = document.getElementById('modal'); if (modal) modal.classList.remove('show');
          // Find a good slot for blkId without the target placed
          const sugs = computeEmptySuggestions(blkId);
          if (!sugs.length) { flash('移動先が見つかりません'); return; }
          const best2 = sugs[0];
          const m0 = best2.moves?.[0];
          if (!m0) { flash('移動先が見つかりません'); return; }
          pushHistory('push-near');
          state.placements[blkId] = { day: m0.day, period: m0.period, locked: false };
          invalidateIndex();
          const v2 = validatePlacement(tid, tday, tp, 'safe', null);
          if (v2.blocks.length === 0) {
            doPlace(tid, tday, tp, null);
            flash(`押し出し→配置 完了`);
          } else {
            rerenderAll();
            flash(`押し出したが衝突が残っています`);
          }
        };
      });
    }, 50);
  }
  function doPlace(id, day, period, swapTarget = null, opts = { force: false, silent: false }) {
    // 禁制（固定禁則/教員不可/時限範囲/2連最終/クラス時限上限）は、強制でも上書き不可
    try {
      const v = validatePlacement(id, day, period, 'safe', swapTarget);
      const abs = absoluteBlocksOf(v.blocks);
      if (abs.length) {
        if (!opts?.silent) {
          showToast('禁制のため配置できません', 'error');
          try { showPlacementFailDialog(id, day, period, abs); } catch (e) { }
        }
        return false;
      }
      if (swapTarget) {
        const old = state.placements[id];
        if (old && old.day) {
          const v2 = validatePlacement(swapTarget, old.day, old.period, 'safe', id);
          const abs2 = absoluteBlocksOf(v2.blocks);
          if (abs2.length) {
            if (!opts?.silent) {
              showToast('入替先が禁制のため交換できません', 'error');
              try { showPlacementFailDialog(swapTarget, old.day, old.period, abs2); } catch (e) { }
            }
            return false;
          }
        }
      }
    } catch (e) { /* fail open */ }

    if (swapTarget) {
      // swapTarget goes to old place of id
      const old = state.placements[id];
      if (state.placements[swapTarget] && state.placements[swapTarget].locked) { flash('入替先がロック'); return; }
      state.placements[id] = { day, period, locked: state.placements[id]?.locked || false };
      if (old && old.day) {
        state.placements[swapTarget] = { day: old.day, period: old.period, locked: state.placements[swapTarget]?.locked || false };
      } else {
        state.placements[swapTarget] = null;
      }
    } else {
      state.placements[id] = { day, period, locked: state.placements[id]?.locked || false };
    }
    invalidateIndex();
    markDirty('place');
    rerenderAll();
    broadcastState();
    return true;
  }
  function toStock(id) {
    if (!state.items[id]) return;
    if (state.placements[id] && state.placements[id].locked) { flash('ロック中'); return; }
    pushHistory('toStock');
    state.placements[id] = null;
    invalidateIndex();
    markDirty('toStock');
    rerenderAll();
    broadcastState();
  }
  /* ═══════════════════════════════════════════════════
     v62: 🎲 ランダム外し（ホットスポット優先）
     - 教員の1日過多（例: 5コマ以上 / 上限超）
     - ヒートマップ温度（重複/連続/過多の強さ）
     - 置きやすさ（良い配置・難しいコマは外しにくい）
     Shift: 多めに外す / Alt: 少なめに外す
     ═══════════════════════════════════════════════════ */
  function randomUnplaceHot(ev) {
    const allIds = Object.keys(state.items || {});
    if (!allIds.length) { flash('データがありません'); return; }
    const includeLocked = !!(ev?.ctrlKey || ev?.metaKey);
    const placed = allIds.filter(id => state.placements?.[id]?.day && (includeLocked || !state.placements[id].locked));
    if (!placed.length) { flash('外せるコマがありません（全て未配置 or ロック）'); return; }

    // 外す数：既定18%（Shift=30% / Alt=10%）
    // Ctrl(または⌘)でロックも対象に含める
    const ratio = ev?.shiftKey ? 0.40 : (ev?.altKey ? 0.12 : 0.25);
    const n = clampInt(Math.round(placed.length * ratio), 10, 160);

    const idx = buildIndex();

    // 教員×曜日 load キャッシュ
    const teaDayLoad = {};
    const teaDayOcc = {}; // for run length
    const ensureTea = (tea) => {
      if (teaDayLoad[tea]) return;
      teaDayLoad[tea] = {};
      teaDayOcc[tea] = {};
      for (const d of DAYS) {
        const maxP = maxPeriod(d);
        let load = 0;
        const occSet = new Set();
        for (let p = 1; p <= maxP; p++) {
          const ids = (idx.tea?.[tea]?.[d]?.[p] || []);
          const occ = ids.filter(x => !isSpanFill(x, d, p));
          if (occ.length) { load++; occSet.add(p); }
        }
        teaDayLoad[tea][d] = load;
        teaDayOcc[tea][d] = occSet;
      }
    };

    // セル温度（applyHeatmap互換の簡易版）
    const teacherCellHeat = (tea, d, p) => {
      ensureTea(tea);
      const ids = (idx.tea?.[tea]?.[d]?.[p] || []).filter(x => !isSpanFill(x, d, p));
      let heat = 0, intensity = 1;
      if (ids.length > 1) { heat = 3; intensity = Math.min(3.0, 1.0 + (ids.length - 1) * 0.5); }
      else if (ids.length === 1) {
        const maxD = teacherDailyMax(tea);
        const load = teaDayLoad[tea][d] || 0;
        // 「5コマ以上」もホットとして扱う（maxDが無い場合の目安）
        const baseMax = (maxD == null) ? 4 : maxD;
        const over = Math.max(0, load - baseMax);
        if (over > 0) { heat = Math.max(heat, 2); intensity = Math.max(intensity, 1.0 + over * 0.45); }
        // 連続（簡易）
        const maxC = teacherConsecMax(tea);
        const occSet = teaDayOcc[tea][d];
        let run = 1;
        let pp = p - 1; while (pp >= 1 && occSet.has(pp)) { run++; pp--; }
        let pp2 = p + 1; const mp = maxPeriod(d);
        while (pp2 <= mp && occSet.has(pp2)) { run++; pp2++; }
        if (maxC != null && run > maxC) { heat = Math.max(heat, 2); intensity = Math.max(intensity, 1.0 + (run - maxC) * 0.55); }
        else if (run >= 3) { heat = Math.max(heat, 1); intensity = Math.max(intensity, 0.85 + run * 0.1); }
      }
      return { heat, intensity };
    };
    const classCellHeat = (cls, d, p) => {
      const ids = (idx.cls?.[cls]?.[d]?.[p] || []).filter(x => !isSpanFill(x, d, p));
      if (ids.length > 1) return { heat: 3, intensity: Math.min(3.0, 1.0 + (ids.length - 1) * 0.5) };
      if (ids.length === 1) {
        try { if (violationSummary(ids[0])) return { heat: 2, intensity: 1.2 }; } catch (e) { }
      }
      return { heat: 0, intensity: 1 };
    };
    const roomCellHeat = (room, d, p) => {
      const ids = (idx.room?.[room]?.[d]?.[p] || []).filter(x => !isSpanFill(x, d, p));
      if (ids.length > 1) return { heat: 3, intensity: Math.min(3.0, 1.0 + (ids.length - 1) * 0.5) };
      return { heat: 0, intensity: 1 };
    };

    // 配置の「良さ」（高いほど良い）をざっくり推定：0..100
    // ※重い validatePlacement を全件に回さない（O(n)で計算）
    const approxPlacementQuality = (id) => {
      const plc = state.placements[id]; const it = state.items[id];
      if (!plc?.day || !it) return 0;
      let pen = 0;
      const d = plc.day, p0 = plc.period, span = it.span || 1;
      const mp = maxPeriod(d);
      // 禁則/不可
      for (let dp = 0; dp < span; dp++) {
        const p = p0 + dp;
        if (p < 1 || p > mp) pen += 40;
        if (it.span === 2 && p0 === mp) pen += 40;
        if (isForbiddenForSubject(it.subjKey, d, p)) pen += 25;
        for (const tea of (it.teas || [])) {
          if (isUnavailableForTeacher(tea, d, p)) pen += 25;
        }
      }
      // 衝突（教員/クラス/教室）
      for (let dp = 0; dp < span; dp++) {
        const p = p0 + dp;
        for (const tea of (it.teas || [])) {
          const occ = (idx.tea?.[tea]?.[d]?.[p] || []).filter(x => !isSpanFill(x, d, p) && x !== id);
          // parallel同士は軽く
          const occ2 = (it.parallel) ? occ.filter(x => !state.items[x]?.parallel) : occ;
          if (occ2.length) pen += 30;
        }
        for (const cls of (it.cls || [])) {
          const occ = (idx.cls?.[cls]?.[d]?.[p] || []).filter(x => !isSpanFill(x, d, p) && x !== id);
          if (occ.length) pen += 30;
        }
        if (state.settings.roomConflict) {
          for (const room of (it.rooms || [])) {
            const occ = (idx.room?.[room]?.[d]?.[p] || []).filter(x => !isSpanFill(x, d, p) && x !== id);
            if (occ.length) pen += 30;
          }
        }
      }
      // 1日上限/連続上限（warn相当）
      for (const tea of (it.teas || [])) {
        ensureTea(tea);
        const maxD = teacherDailyMax(tea);
        const load = teaDayLoad[tea][d] || 0;
        const baseMax = (maxD == null) ? 4 : maxD;
        if (load > baseMax) pen += (load - baseMax) * 8;
        const maxC = teacherConsecMax(tea);
        if (maxC != null) {
          const occSet = teaDayOcc[tea][d];
          // このp0の周辺 run
          let run = 0;
          for (let p = 1; p <= maxPeriod(d); p++) {
            if (occSet.has(p)) run++; else run = 0;
            if (run > maxC) { pen += (run - maxC) * 4; }
          }
        }
      }
      // 難しいコマ（2連/多人数）は少し保護（penを減らす）
      const diff = calculatePlacementDifficulty(id) || 0;
      const protect = Math.min(20, diff * 0.2);
      pen = Math.max(0, pen - protect);
      const q = clamp(100 - pen, 0, 100);
      return q;
    };

    // 外しやすさ（重み）：大きいほど外れやすい
    const weightOf = (id) => {
      const plc = state.placements[id]; const it = state.items[id];
      if (!plc?.day || !it) return 0;
      const d = plc.day, p0 = plc.period, span = it.span || 1;
      let temp = 0;
      // 現在の表示モードも少し加点（ユーザが見ている“熱い”所）
      const mode = state.ui?.viewMode || 'teacher';
      const heatFn = (mode === 'class') ? classCellHeat : (mode === 'room') ? roomCellHeat : teacherCellHeat;

      for (let dp = 0; dp < span; dp++) {
        const p = p0 + dp;
        // teacher heat (常に見る)
        for (const tea of (it.teas || [])) {
          const h = teacherCellHeat(tea, d, p);
          temp = Math.max(temp, h.heat + (h.intensity - 1));
        }
        // class heat
        for (const cls of (it.cls || [])) {
          const h = classCellHeat(cls, d, p);
          temp = Math.max(temp, h.heat + (h.intensity - 1));
        }
        // room heat
        if (state.settings.roomConflict) {
          for (const room of (it.rooms || [])) {
            const h = roomCellHeat(room, d, p);
            temp = Math.max(temp, h.heat + (h.intensity - 1));
          }
        }
        // view heat（見えている軸の熱）
        if (mode === 'teacher') {
          for (const tea of (it.teas || [])) {
            const h = heatFn(tea, d, p); temp = Math.max(temp, h.heat + (h.intensity - 1));
          }
        } else if (mode === 'class') {
          for (const cls of (it.cls || [])) {
            const h = heatFn(cls, d, p); temp = Math.max(temp, h.heat + (h.intensity - 1));
          }
        } else if (mode === 'room') {
          for (const room of (it.rooms || [])) {
            const h = heatFn(room, d, p); temp = Math.max(temp, h.heat + (h.intensity - 1));
          }
        }
      }

      // 1日過多（5コマ以上 or 上限超）を強く
      let over = 0;
      for (const tea of (it.teas || [])) {
        ensureTea(tea);
        const maxD = teacherDailyMax(tea);
        const load = teaDayLoad[tea][d] || 0;
        const baseMax = (maxD == null) ? 4 : maxD;
        if (load >= 5) over += 1; // 「5コマ以上」は問答無用で熱い
        if (load > baseMax) over += (load - baseMax);
      }

      const q = approxPlacementQuality(id); // 0..100 高いほど良い
      const qNorm = q / 100;
      // 良い配置は外しにくい（最低でも0.06は残す）
      const keepFactor = Math.max(0.06, (1 - qNorm) * (1 - qNorm) + 0.04);
      // 難しいコマも外しにくい
      const diff = calculatePlacementDifficulty(id) || 0;
      const diffKeep = 1 / (1 + diff / 55);

      let w = 0.25 + temp * 2.4 + over * 8.0 + (1 - qNorm) * 2.2;
      w *= keepFactor;
      w *= diffKeep;
      return Math.max(0.001, w);
    };

    // Weighted sampling without replacement（Efraimidis-Spirakis）
    const scored = [];
    for (const id of placed) {
      const w = weightOf(id);
      const u = Math.random();
      const key = -Math.log(Math.max(1e-9, u)) / w; // 小さいほど選ばれやすい
      scored.push({ id, key });
    }
    scored.sort((a, b) => a.key - b.key);
    const picked = scored.slice(0, Math.min(n, scored.length)).map(x => x.id);
    if (!picked.length) { flash('外す対象がありません'); return; }

    pushHistory('randUnplace');
    for (const id of picked) {
      // まとめて在庫へ
      state.placements[id] = null;
    }
    invalidateIndex();
    markDirty('randUnplace');
    rerenderAll();
    broadcastState();
    showToast(`🎲 ランダム外し：${picked.length}コマを在庫へ退避（Shift=多め / Alt=少なめ / Ctrl=ロック含む）`, 'info');
  }

  /* ═══════════════════════════════════════════════════
     v62.4: 🔥 ヒート外し（ヒートマップ着色セルだけを部分的に退避）
     - 現在の表示軸（教員/クラス/教室）のヒートマップで色が付く(heat>0)セルに乗っているコマだけ対象
     - セル単位で「一部だけ」外す（まず各セル1件まで → 足りなければ追加）
     - 良い配置（近似スコア高）はできるだけ外さない
     Shift: 多め / Alt: 厳選(熱2以上) / Ctrl: ロック含む
     ═══════════════════════════════════════════════════ */
  function randomUnplaceHeatOnly(ev) {
    const allIds = Object.keys(state.items || {});
    if (!allIds.length) { flash('データがありません'); return; }
    const includeLocked = !!(ev?.ctrlKey || ev?.metaKey);

    const placed = allIds.filter(id => state.placements?.[id]?.day && (includeLocked || !state.placements[id].locked));
    if (!placed.length) { flash('外せるコマがありません（全て未配置 or ロック）'); return; }

    const idx = buildIndex();
    const mode = state.ui?.viewMode || 'teacher';

    // 教員×曜日 load キャッシュ
    const teaDayLoad = {};
    const teaDayOcc = {};
    const ensureTea = (tea) => {
      if (teaDayLoad[tea]) return;
      teaDayLoad[tea] = {};
      teaDayOcc[tea] = {};
      for (const d of DAYS) {
        const maxP = maxPeriod(d);
        let load = 0;
        const occSet = new Set();
        for (let p = 1; p <= maxP; p++) {
          const ids = (idx.tea?.[tea]?.[d]?.[p] || []);
          const occ = ids.filter(x => !isSpanFill(x, d, p));
          if (occ.length) { load++; occSet.add(p); }
        }
        teaDayLoad[tea][d] = load;
        teaDayOcc[tea][d] = occSet;
      }
    };

    // applyHeatmap互換の温度
    const teacherCellHeat = (tea, d, p) => {
      ensureTea(tea);
      const ids = (idx.tea?.[tea]?.[d]?.[p] || []).filter(x => !isSpanFill(x, d, p));
      let heat = 0, intensity = 1;
      if (ids.length > 1) { heat = 3; intensity = Math.min(3.0, 1.0 + (ids.length - 1) * 0.5); }
      else if (ids.length === 1) {
        const maxD = teacherDailyMax(tea);
        const load = teaDayLoad[tea][d] || 0;
        const baseMax = (maxD == null) ? 4 : maxD;
        const over = Math.max(0, load - baseMax);
        if (over > 0) { heat = Math.max(heat, 2); intensity = Math.max(intensity, 1.0 + over * 0.45); }
        // 連続
        const maxC = teacherConsecMax(tea);
        const occSet = teaDayOcc[tea][d];
        let run = 1;
        let pp = p - 1; while (pp >= 1 && occSet.has(pp)) { run++; pp--; }
        let pp2 = p + 1; const mp = maxPeriod(d);
        while (pp2 <= mp && occSet.has(pp2)) { run++; pp2++; }
        if (maxC != null && run > maxC) { heat = Math.max(heat, 2); intensity = Math.max(intensity, 1.0 + (run - maxC) * 0.55); }
        else if (run >= 3) { heat = Math.max(heat, 1); intensity = Math.max(intensity, 0.85 + run * 0.1); }
      }
      return { heat, intensity };
    };
    const classCellHeat = (cls, d, p) => {
      const ids = (idx.cls?.[cls]?.[d]?.[p] || []).filter(x => !isSpanFill(x, d, p));
      if (ids.length > 1) return { heat: 3, intensity: Math.min(3.0, 1.0 + (ids.length - 1) * 0.5) };
      if (ids.length === 1) {
        try { if (violationSummary(ids[0])) return { heat: 2, intensity: 1.2 }; } catch (e) { }
      }
      return { heat: 0, intensity: 1 };
    };
    const roomCellHeat = (room, d, p) => {
      const ids = (idx.room?.[room]?.[d]?.[p] || []).filter(x => !isSpanFill(x, d, p));
      if (ids.length > 1) return { heat: 3, intensity: Math.min(3.0, 1.0 + (ids.length - 1) * 0.5) };
      return { heat: 0, intensity: 1 };
    };

    // 近似配置品質 0..100（高いほど良い）: ランダム外しと同等
    const approxPlacementQuality = (id) => {
      const plc = state.placements[id]; const it = state.items[id];
      if (!plc?.day || !it) return 0;
      let pen = 0;
      const d = plc.day, p0 = plc.period, span = it.span || 1;
      const mp = maxPeriod(d);
      for (let dp = 0; dp < span; dp++) {
        const p = p0 + dp;
        if (p < 1 || p > mp) pen += 40;
        if (it.span === 2 && p0 === mp) pen += 40;
        if (isForbiddenForSubject(it.subjKey, d, p)) pen += 25;
        for (const tea of (it.teas || [])) if (isUnavailableForTeacher(tea, d, p)) pen += 25;
      }
      for (let dp = 0; dp < span; dp++) {
        const p = p0 + dp;
        for (const tea of (it.teas || [])) {
          const occ = (idx.tea?.[tea]?.[d]?.[p] || []).filter(x => !isSpanFill(x, d, p) && x !== id);
          const occ2 = (it.parallel) ? occ.filter(x => !state.items[x]?.parallel) : occ;
          if (occ2.length) pen += 30;
        }
        for (const cls of (it.cls || [])) {
          const occ = (idx.cls?.[cls]?.[d]?.[p] || []).filter(x => !isSpanFill(x, d, p) && x !== id);
          if (occ.length) pen += 30;
        }
        if (state.settings.roomConflict) {
          for (const room of (it.rooms || [])) {
            const occ = (idx.room?.[room]?.[d]?.[p] || []).filter(x => !isSpanFill(x, d, p) && x !== id);
            if (occ.length) pen += 30;
          }
        }
      }
      for (const tea of (it.teas || [])) {
        ensureTea(tea);
        const maxD = teacherDailyMax(tea);
        const load = teaDayLoad[tea][d] || 0;
        const baseMax = (maxD == null) ? 4 : maxD;
        if (load > baseMax) pen += (load - baseMax) * 8;
        const maxC = teacherConsecMax(tea);
        if (maxC != null) {
          const occSet = teaDayOcc[tea][d];
          let run = 0;
          for (let p = 1; p <= maxPeriod(d); p++) {
            if (occSet.has(p)) run++; else run = 0;
            if (run > maxC) pen += (run - maxC) * 4;
          }
        }
      }
      // 難しいコマは保護
      const diff = (typeof calculatePlacementDifficulty === 'function') ? (calculatePlacementDifficulty(id) || 0) : 0;
      pen = Math.max(0, pen - Math.min(20, diff * 0.2));
      return clamp(100 - pen, 0, 100);
    };

    const heatFn = (mode === 'class') ? classCellHeat : (mode === 'room') ? roomCellHeat : teacherCellHeat;
    const keysOf = (it) => (mode === 'class') ? (it.cls || []) : (mode === 'room') ? (it.rooms || []) : (it.teas || []);

    // 候補生成（ヒートセルのみ）
    const minHeat = ev?.altKey ? 2 : 1; // Alt=厳選(熱2以上)
    const candidates = [];
    for (const id of placed) {
      const plc = state.placements[id];
      const it = state.items[id];
      if (!plc?.day || !it) continue;
      const d = plc.day, p0 = plc.period, span = it.span || 1;
      const keys = keysOf(it);
      if (!keys.length) continue;

      let best = { heat: 0, intensity: 1, key: null };
      for (let dp = 0; dp < span; dp++) {
        const p = p0 + dp;
        for (const k of keys) {
          const h = heatFn(k, d, p);
          if (h.heat > best.heat || (h.heat === best.heat && h.intensity > best.intensity)) {
            best = { heat: h.heat, intensity: h.intensity, key: String(k) + '|' + d + '|' + p };
          }
        }
      }
      if (best.heat < minHeat) continue; // 色が付いていないセルは除外

      const q = approxPlacementQuality(id);
      const qNorm = q / 100;
      const keepFactor = Math.max(0.06, (1 - qNorm) * (1 - qNorm) + 0.04);
      const diff = (typeof calculatePlacementDifficulty === 'function') ? (calculatePlacementDifficulty(id) || 0) : 0;
      const diffKeep = 1 / (1 + diff / 55);

      const hotScore = best.heat + (best.intensity - 1);
      // ヒート外しは hotScore を強め、良い配置は keepFactor で保護
      let w = 0.2 + hotScore * 6.0 + (1 - qNorm) * 1.8;
      w *= keepFactor;
      w *= diffKeep;
      candidates.push({ id, cellKey: mode + ':' + best.key, w });
    }

    if (!candidates.length) {
      flash('🔥 ヒート外し: 色付きセルのコマが見つかりません');
      return;
    }

    // 外す数（候補数ベース）
    const ratio = ev?.shiftKey ? 0.45 : 0.28;
    const n = clampInt(Math.round(candidates.length * ratio), 3, 90);

    // Weighted sampling: まずセル重複を避ける
    const scored = candidates.map(c => {
      const u = Math.random();
      const key = -Math.log(Math.max(1e-9, u)) / Math.max(0.001, c.w);
      return { id: c.id, cellKey: c.cellKey, key };
    }).sort((a, b) => a.key - b.key);

    const picked = [];
    const usedCells = new Set();
    // 1st pass: 1 per cell
    for (const s of scored) {
      if (picked.length >= n) break;
      if (usedCells.has(s.cellKey)) continue;
      usedCells.add(s.cellKey);
      picked.push(s.id);
    }
    // 2nd pass: fill remaining
    if (picked.length < n) {
      const setPicked = new Set(picked);
      for (const s of scored) {
        if (picked.length >= n) break;
        if (setPicked.has(s.id)) continue;
        picked.push(s.id);
        setPicked.add(s.id);
      }
    }

    if (!picked.length) { flash('🔥 ヒート外し: 外す対象がありません'); return; }

    pushHistory('heatUnplace');
    for (const id of picked) state.placements[id] = null;
    invalidateIndex();
    markDirty('heatUnplace');
    rerenderAll();
    broadcastState();
    showToast(`🔥 ヒート外し：色付きセルから${picked.length}コマを退避（Shift=多め / Alt=熱2以上 / Ctrl=ロック含む）`, 'info');
  }

  // 数値を整数にして範囲内に収める。数値にできない時（空欄など）は既定値 def（無ければ下限）を使う。
  // 以前は既定値を受け取らない版と受け取る版が別々にあり、起動時に前者が後者を上書きしていたため、
  // 「試行」「秒」の欄が空だと 30 ではなく 1 や「時間無制限」になっていた。
  function clampInt(v, lo, hi, def) {
    const n = (typeof v === 'number') ? Math.trunc(v) : parseInt(v, 10);
    if (!Number.isFinite(n)) return def !== undefined ? def : lo;
    return Math.max(lo, Math.min(hi, n));
  }

  function _printFontCSS(fontFam) {
    if (fontFam === 'gothic')  return '"Hiragino Sans","Yu Gothic","Meiryo",sans-serif';
    if (fontFam === 'mincho')  return '"Yu Mincho","Hiragino Mincho Pro","Noto Serif CJK JP","Times New Roman",serif';
    if (fontFam === 'rounded') return '"Hiragino Maru Gothic Pro","BIZ UDRGothic","Rounded Mplus 1c",sans-serif';
    if (fontFam === 'mono')    return '"Courier New",monospace';
    return 'inherit';
  }

  // v49 A-1 + C-1: 1コマ即配置 — 最高スコアの空き枠に自動配置
  function quickAutoPlace(id) {
    const it = state.items[id]; if (!it) return;
    if (state.placements[id]?.locked) { flash('ロック中'); return; }
    let sugs = [];
    try { sugs = computeEmptySuggestions(id) || []; } catch (e) { }
    if (!sugs.length) {
      flash(`「${state.subjectCfg[it.subjKey]?.abbr || it.subj}」を配置できる枠がありません`);
      return;
    }
    // スコア最高の候補を選択
    sugs.sort((a, b) => b.score - a.score);
    const best = sugs[0].moves[0];
    if (!best) return;
    pushHistory('quickPlace');
    doPlace(id, best.day, best.period, null);
    const abbr = state.subjectCfg[it.subjKey]?.abbr || it.subj;
    showToast(`⚡ 「${abbr}」→ ${DAYJP[best.day]}${best.period}限 に配置`, 'success');
    // 配置後に次の未配置コマを自動選択
    setTimeout(() => jumpToNextUnplaced(id), 200);
  }

  // v49 A-3: 次の未配置コマへジャンプ
  function jumpToNextUnplaced(currentId) {
    const allIds = Object.keys(state.items);
    const unplaced = allIds.filter(id => !state.placements[id]?.day);
    if (!unplaced.length) { flash('全コマ配置完了！ 🎉'); return; }
    const curIdx = unplaced.indexOf(currentId);
    const nextId = curIdx >= 0 && curIdx < unplaced.length - 1
      ? unplaced[curIdx + 1]
      : unplaced[0];
    selectId(nextId, 'stock');
    // 在庫リストでスクロール
    setTimeout(() => {
      const el = document.querySelector(`.stock-item[data-id="${CSS.escape(nextId)}"]`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 50);
  }

  function lockAllPlaced(mode) {
    // mode: 'lock' | 'unlock' | 'toggle'
    pushHistory('lockAll');
    let changed = 0;
    for (const id in state.placements) {
      const p = state.placements[id];
      if (!p?.day) continue;
      if (mode === 'lock') { if (!p.locked) { p.locked = true; changed++; } }
      else if (mode === 'unlock') { if (p.locked) { p.locked = false; changed++; } }
      else { p.locked = !p.locked; changed++; }
    }
    markDirty('lockAll');
    invalidateIndex();
    rerenderAll();
    broadcastState();
    flash(`${changed}コマを${mode === 'lock' ? 'ロック' : mode === 'unlock' ? 'ロック解除' : '切替'}しました`);
  }

  function toggleLock(id) {
    if (!state.items[id]) return;
    pushHistory('lock');
    const p = state.placements[id];
    if (!p) { flash('未配置'); return; }
    p.locked = !p.locked;
    markDirty('lock');
    rerenderAll();
    broadcastState();
  }


  function domId(prefix, key) {
    return prefix + encodeURIComponent(String(key || '')).replace(/%/g, '_').replace(/\./g, '_');
  }
  let __rerenderTimer = null;
  let __focusSnap = null;
  function snapshotFocus() {
    const el = document.activeElement;
    if (!el || !el.id) return null;
    let start = null, end = null;
    try { start = el.selectionStart; end = el.selectionEnd; } catch (e) { }
    const snap = { id: el.id, start, end };
    snap.scrollTea = $('#teacher-container')?.scrollTop ?? 0;
    snap.scrollSubj = $('#subject-container')?.scrollTop ?? 0;
    return snap;
  }
  function restoreFocus(snap) {
    if (!snap) return;
    requestAnimationFrame(() => {
      const t = $('#teacher-container'); if (t && snap.scrollTea != null) t.scrollTop = snap.scrollTea;
      const s = $('#subject-container'); if (s && snap.scrollSubj != null) s.scrollTop = snap.scrollSubj;
      const el = document.getElementById(snap.id);
      if (el) {
        try { el.focus({ preventScroll: true }); } catch (e) { try { el.focus(); } catch (_) { } }
        try { if (snap.start != null && snap.end != null && el.setSelectionRange) el.setSelectionRange(snap.start, snap.end); } catch (e) { }
      }
    });
  }
  function queueRerenderAllPreserveFocus(delayMs = 160) {
    __focusSnap = snapshotFocus();
    clearTimeout(__rerenderTimer);
    __rerenderTimer = setTimeout(() => {
      const snap = __focusSnap; __focusSnap = null;
      rerenderAll();
      restoreFocus(snap);
    }, delayMs);
  }

