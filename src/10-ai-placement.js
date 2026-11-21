  /* =======================
     AI placement (lightweight heuristic)
  ======================= */

  function aiTrialOnce(basePlacements) {
    const mode = $('#ai-mode')?.value || 'normal';
    const rand = clampNum(Number($('#ai-rand')?.value || 0) / 100, 0, 1, 0.35);
    const optBalance = !!$('#ai-balance')?.checked;
    const optNoConsec = !!$('#ai-noconsec')?.checked;

    const allIds = Object.keys(state.items);
    const fixedLocked = new Set(allIds.filter(id => basePlacements[id] && basePlacements[id].locked));
    const placements = deepClone(basePlacements);

    // v42: exploration shake - temporarily unplace some non-locked lessons to escape local minima
    if (mode !== 'gentle') {
      const movable = allIds.filter(id => placements[id] && !placements[id].locked);
      const k = (mode === 'bold') ? (3 + Math.floor(Math.random() * 6)) : (Math.random() < 0.25 ? (1 + Math.floor(Math.random() * 3)) : 0);
      if (k > 0 && movable.length) {
        const pick = shuffle(movable.slice()).slice(0, Math.min(k, movable.length));
        for (const rid of pick) { placements[rid] = null; }
      }
    }

    const unplaced0 = allIds.filter(id => !placements[id]);

    // ── Degree map: 教員・クラスを共有するアイテム数（拘束度） ──────────
    // 自分が配置される時に他の何アイテムの選択肢を狭めるか → 大きいほど先に配置すべき
    const degreeMap = {};
    for (const id of allIds) {
      const it = state.items[id]; if (!it) { degreeMap[id] = 0; continue; }
      let deg = 0;
      for (const t of it.teas || []) {
        for (const xid of allIds) {
          if (xid === id) continue;
          if ((state.items[xid]?.teas || []).includes(t)) deg++;
        }
      }
      for (const c of it.cls || []) {
        for (const xid of allIds) {
          if (xid === id) continue;
          if ((state.items[xid]?.cls || []).includes(c)) deg++;
        }
      }
      degreeMap[id] = deg;
    }

    // ── occupancy込みの有効スロット数（真のMRV） ──────────────────────
    const countValidWithOcc = (id, curIdx) => {
      const it = state.items[id]; if (!it) return 999;
      const span = it.span || 1;
      let cnt = 0;
      for (const day of DAYS) {
        const maxP = maxPeriod(day);
        for (let p = 1; p <= maxP; p++) {
          if (span === 2 && p === maxP) continue;
          let ok = true;
          for (let dp = 0; dp < span && ok; dp++) {
            const pp = p + dp;
            if (isForbiddenForSubject(it.subjKey, day, pp)) { ok = false; break; }
            for (const t of it.teas || []) {
              if (isUnavailableForTeacher(t, day, pp)) { ok = false; break; }
              const occ = curIdx.tea?.[t]?.[day]?.[pp] || [];
              if (it.parallel ? occ.some(x => !state.items[x]?.parallel) : occ.length) { ok = false; break; }
            }
            if (!ok) break;
            for (const c of it.cls || []) {
              const occ = curIdx.cls?.[c]?.[day]?.[pp] || [];
              if (it.parallel ? occ.some(x => !state.items[x]?.parallel) : occ.length) { ok = false; break; }
            }
          }
          if (ok) cnt++;
        }
      }
      return cnt;
    };

    // MRV+Degree合成: 有効スロットが少ない順、同数ならdegree多い順
    const mrvDegreeScore = (id, curIdx) => {
      const mrv = countValidWithOcc(id, curIdx);
      return mrv * 10000 - degreeMap[id]; // mrv小・degree大が先
    };

    // 静的な初期hardnessソート（高速化: degree・MRVを初期概算で）
    const validSlotCountPure = (id) => {
      const it = state.items[id]; if (!it) return 999;
      let cnt = 0;
      for (const day of DAYS) {
        const maxP = maxPeriod(day);
        for (let p = 1; p <= maxP; p++) {
          if ((it.span || 1) === 2 && p === maxP) continue;
          let ok = true;
          for (let dp = 0; dp < (it.span || 1) && ok; dp++) {
            const pp = p + dp;
            if (isForbiddenForSubject(it.subjKey, day, pp)) { ok = false; break; }
            for (const t of it.teas || []) { if (isUnavailableForTeacher(t, day, pp)) { ok = false; break; } }
          }
          if (ok) cnt++;
        }
      }
      return cnt;
    };
    const hardness = (id) => {
      const it = state.items[id]; if (!it) return 0;
      const span = it.span || 1;
      const forbid = countForbid(it.subjKey) || 0;
      const structuralHardness = (span === 2 ? 10 : 0) + (it.cls?.length > 1 ? 6 : 0) + (it.teas?.length > 1 ? 5 : 0) + (it.rooms?.length > 1 ? 2 : 0) + forbid * 0.4;
      const slots = validSlotCountPure(id);
      const scarcity = slots === 0 ? 200 : slots === 1 ? 150 : slots <= 3 ? 80 : slots <= 6 ? 40 : slots <= 12 ? 20 : slots <= 20 ? 8 : 0;
      const degree = Math.min(degreeMap[id] || 0, 30) * 0.5; // degree heuristic
      return structuralHardness + scarcity + degree;
    };
    let order = unplaced0.slice().sort((a, b) => hardness(b) - hardness(a));
    if (rand > 0.15) order = shuffle(order);

    const timeScore = (p) => (p === 1 ? -2 : p === 2 ? -1 : p === 3 ? 0 : p === 4 ? 0 : p === 5 ? 1 : p === 6 ? 2 : 3);
    const deptOf = (it) => (state.subjectCfg[it.subjKey]?.dept || '');

    const idx = buildIdxFromPlacements(placements);
    const stats = buildDeptStatsFromPlacements(placements);

    // canPlace signature: (id_ignored, it, day, period, idx_ignored) — uses closure idx
    const canPlace = (_id, it, day, period) => {
      const span = it.span || 1;
      const maxP = maxPeriod(day);
      if (period < 1 || period > maxP) return false;
      if (span === 2 && period === maxP) return false;
      // per-class period override
      const clsMaxP = maxPeriodForItem(it, day);
      for (let dp = 0; dp < span; dp++) { if (period + dp > clsMaxP) return false; }
      for (let dp = 0; dp < span; dp++) {
        const p = period + dp;
        if (isForbiddenForSubject(it.subjKey, day, p)) return false;
        for (const t of it.teas || []) {
          if (isUnavailableForTeacher(t, day, p)) return false;
          const occ = idx.tea?.[t]?.[day]?.[p] || [];
          if (it.parallel) {
            if (occ.some(x => !placements_items_parallel(x))) return false;
          } else {
            if (occ.length) return false;
          }
          // ★ Fix4: 教員1日上限をハード制約として強制
          const maxD = teacherDailyMax(t);
          if (maxD != null) {
            let taught = 0;
            for (let pp = 1; pp <= maxP; pp++) {
              if ((idx.tea?.[t]?.[day]?.[pp] || []).length) taught++;
            }
            // spanの最初のコマでのみカウント（2連続コマは1コマとして数える）
            if (dp === 0 && taught + 1 > maxD) return false;
          }
        }
        for (const c of it.cls || []) {
          const occ = idx.cls?.[c]?.[day]?.[p] || [];
          if (it.parallel) {
            if (occ.some(x => !placements_items_parallel(x))) return false;
          } else {
            if (occ.length) return false;
          }
        }
        if (state.settings.roomConflict) {
          for (const r of it.rooms || []) {
            if ((idx.room?.[r]?.[day]?.[p] || []).length) return false;
          }
        }
      }
      return true;
    };
    // Helper: is item x a parallel item? (uses current trial's placements items)
    const placements_items_parallel = (x) => !!(state.items[x]?.parallel);

    const scoreCandidate = (it, day, period) => {
      let pen = 0;
      const span = it.span || 1;
      const dept = deptOf(it);
      if ((it.cls?.length || 0) > 1 && period === 1) pen += 1.2;

      const lunchAfter = Number(state.settings.lunchAfter || 0);
      for (const t of it.teas || []) {
        const maxD = teacherDailyMax(t);
        const maxC = teacherConsecMax(t);
        let taught = 0; const maxP = maxPeriod(day);
        for (let p = 1; p <= maxP; p++) { if ((idx.tea?.[t]?.[day]?.[p] || []).length) taught++; }
        taught += span;
        if (maxD != null && taught > maxD) pen += (taught - maxD) * 6;

        if (maxC != null) {
          const taughtSet = new Set();
          for (let p = 1; p <= maxP; p++) { if ((idx.tea?.[t]?.[day]?.[p] || []).length) taughtSet.add(p); }
          for (let dp = 0; dp < span; dp++) taughtSet.add(period + dp);
          let best = 0, cur = 0;
          for (let p = 1; p <= maxP; p++) {
            if (lunchAfter && p === lunchAfter + 1) cur = 0;
            if (taughtSet.has(p)) { cur++; best = Math.max(best, cur); } else cur = 0;
          }
          if (best > maxC) pen += (best - maxC) * 8;
        }
        pen += taught * 0.08;
      }

      if (optNoConsec && dept) {
        for (const c of it.cls || []) {
          const leftP = period - 1;
          if (leftP >= 1) {
            const leftId = (idx.cls?.[c]?.[day]?.[leftP] || [])[0];
            if (leftId) {
              const dL = deptOf(state.items[leftId] || { subjKey: '' });
              if (dL && dL === dept) pen += 4;
            }
          }
          const rightP = period + span;
          const maxP = maxPeriod(day);
          if (rightP <= maxP) {
            const rightId = (idx.cls?.[c]?.[day]?.[rightP] || [])[0];
            if (rightId) {
              const dR = deptOf(state.items[rightId] || { subjKey: '' });
              if (dR && dR === dept) pen += 4;
            }
          }
        }
      }

      // v46-B2: 科目ごと連続禁止（noConsec）ソフトペナルティ
      {
        const scfg2 = state.subjectCfg[it.subjKey] || {};
        if (scfg2.noConsec) {
          for (const c of it.cls || []) {
            const prevId = (idx.cls?.[c]?.[day]?.[period - 1] || [])[0];
            const nextId = (idx.cls?.[c]?.[day]?.[period + span] || [])[0];
            if (prevId && state.items[prevId]?.subjKey === it.subjKey) pen += 12;
            if (nextId && state.items[nextId]?.subjKey === it.subjKey) pen += 12;
          }
        }
      }

      if (optBalance && dept) {
        const get = (c, d) => {
          if (!stats.clsDept[c]) stats.clsDept[c] = {};
          if (!stats.clsDept[c][d]) stats.clsDept[c][d] = { sum: 0, cnt: 0 };
          return stats.clsDept[c][d];
        };
        for (const c of it.cls || []) {
          const st = get(c, dept);
          for (let dp = 0; dp < span; dp++) {
            const p = period + dp;
            const ts = timeScore(p);
            const old = (st.cnt > 0) ? (st.sum * st.sum) / st.cnt : 0;
            const ns = st.sum + ts;
            const nc = st.cnt + 1;
            const neu = (ns * ns) / nc;
            pen += (neu - old) * 1.2;
          }
        }
      }

      for (let dp = 0; dp < span; dp++) {
        const p = period + dp;
        pen += Math.max(0, Math.abs(timeScore(p)) - 1) * 0.25;
      }

      return 100 - pen;
    };

    const choose = (cands) => {
      cands.sort((a, b) => b.score - a.score);
      if (cands.length === 1 || rand <= 0) return cands[0];
      const K = Math.min(8, cands.length);
      const top = cands.slice(0, K);
      const best = top[0].score;
      const tau = 0.3 + rand * 3.0;
      let sumW = 0;
      const ws = top.map(c => { const w = Math.exp((c.score - best) / tau); sumW += w; return w; });
      let r = Math.random() * sumW;
      for (let i = 0; i < top.length; i++) { r -= ws[i]; if (r <= 0) return top[i]; }
      return top[0];
    };

    const place = (id, it, day, period) => {
      placements[id] = { day, period, locked: false };
      addToIdxLocal(idx, id, it, placements[id]);
      // stats update
      const dept = deptOf(it);
      if (dept) {
        for (const c of it.cls || []) {
          if (!stats.clsDept[c]) stats.clsDept[c] = {};
          if (!stats.clsDept[c][dept]) stats.clsDept[c][dept] = { sum: 0, cnt: 0 };
          const st = stats.clsDept[c][dept];
          const span = it.span || 1;
          for (let dp = 0; dp < span; dp++) {
            const p = period + dp;
            st.sum += timeScore(p);
            st.cnt += 1;
          }
        }
      }
    };

    // ── Pilot lookahead: simulate placing next K items greedily to score a candidate ──
    // Used for forward checking & pilot scoring of top candidate slots
    const pilotScore = (id, it, day, period, pilotDepth, remSet) => {
      // Temporarily place and measure: count how many of next pilotDepth items can be placed
      const tmpIdx = { tea: JSON.parse(JSON.stringify(idx.tea || {})), cls: JSON.parse(JSON.stringify(idx.cls || {})), room: JSON.parse(JSON.stringify(idx.room || {})) };
      // Place this candidate in tmpIdx
      const tmpPlace = (xid, xit, xday, xp) => { addToIdxLocal(tmpIdx, xid, xit, { day: xday, period: xp }); };
      tmpPlace(id, it, day, period);

      let placed = 0, dead = 0;
      const remArr = [...remSet].filter(x => x !== id);
      // Re-sort remaining by MRV with tmpIdx
      remArr.sort((a, b) => mrvDegreeScore(a, tmpIdx) - mrvDegreeScore(b, tmpIdx));
      for (let pi = 0; pi < Math.min(pilotDepth, remArr.length); pi++) {
        const pid = remArr[pi];
        const pit = state.items[pid]; if (!pit) continue;
        let bestDay = null, bestP = -1, bestSc = -Infinity;
        for (const xday of DAYS) {
          const xmaxP = maxPeriod(xday);
          for (let xp = 1; xp <= xmaxP; xp++) {
            if ((pit.span || 1) === 2 && xp === xmaxP) continue;
            // Check validity against tmpIdx
            let ok = true;
            for (let dp = 0; dp < (pit.span || 1) && ok; dp++) {
              const pp = xp + dp;
              if (isForbiddenForSubject(pit.subjKey, xday, pp)) { ok = false; break; }
              for (const t of pit.teas || []) {
                if (isUnavailableForTeacher(t, xday, pp)) { ok = false; break; }
                const occ = tmpIdx.tea?.[t]?.[xday]?.[pp] || [];
                if (pit.parallel ? occ.some(x => !state.items[x]?.parallel) : occ.length) { ok = false; break; }
              }
              if (!ok) break;
              for (const c of pit.cls || []) {
                const occ = tmpIdx.cls?.[c]?.[xday]?.[pp] || [];
                if (pit.parallel ? occ.some(x => !state.items[x]?.parallel) : occ.length) { ok = false; break; }
              }
            }
            if (!ok) continue;
            const sc = scoreCandidate(pit, xday, xp);
            if (sc > bestSc) { bestSc = sc; bestDay = xday; bestP = xp; }
          }
        }
        if (bestDay) { tmpPlace(pid, pit, bestDay, bestP); placed++; }
        else dead++;
      }
      // Score = placed items bonus - dead (unplaceable) items penalty
      return placed * 10 - dead * 30;
    };

    // Forward check: would placing id at (day,period) make any remaining item unplaceable?
    const forwardCheck = (id, it, day, period, remSet) => {
      // Quick check: only run if remaining set is small enough
      if (remSet.size > 60) return true; // skip FC for large problems (too expensive)
      const tmpIdx = { tea: JSON.parse(JSON.stringify(idx.tea || {})), cls: JSON.parse(JSON.stringify(idx.cls || {})), room: JSON.parse(JSON.stringify(idx.room || {})) };
      addToIdxLocal(tmpIdx, id, it, { day, period });
      for (const rid of remSet) {
        if (rid === id) continue;
        const rit = state.items[rid]; if (!rit) continue;
        let hasSlot = false;
        outer: for (const rday of DAYS) {
          const rmaxP = maxPeriod(rday);
          for (let rp = 1; rp <= rmaxP; rp++) {
            if ((rit.span || 1) === 2 && rp === rmaxP) continue;
            let ok = true;
            for (let dp = 0; dp < (rit.span || 1) && ok; dp++) {
              const pp = rp + dp;
              if (isForbiddenForSubject(rit.subjKey, rday, pp)) { ok = false; break; }
              for (const t of rit.teas || []) {
                if (isUnavailableForTeacher(t, rday, pp)) { ok = false; break; }
                const occ = tmpIdx.tea?.[t]?.[rday]?.[pp] || [];
                if (rit.parallel ? occ.some(x => !state.items[x]?.parallel) : occ.length) { ok = false; break; }
              }
              if (!ok) break;
              for (const c of rit.cls || []) {
                const occ = tmpIdx.cls?.[c]?.[rday]?.[pp] || [];
                if (rit.parallel ? occ.some(x => !state.items[x]?.parallel) : occ.length) { ok = false; break; }
              }
            }
            if (ok) { hasSlot = true; break outer; }
          }
        }
        if (!hasSlot) return false; // dead-end detected
      }
      return true;
    };

    // Dynamic MRV greedy — at each step pick the most constrained remaining item
    const remaining = new Set(order);
    const PILOT_DEPTH = 4; // simulate this many moves ahead for top candidates
    while (remaining.size > 0) {
      // Select most constrained item (min MRV, max degree for tiebreak)
      let bestId = null, bestMrvScore = Infinity;
      for (const id of remaining) {
        const s = mrvDegreeScore(id, idx);
        if (s < bestMrvScore) { bestMrvScore = s; bestId = id; }
      }
      remaining.delete(bestId);

      const id = bestId;
      const it = state.items[id]; if (!it) continue;
      if (placements[id]) continue;

      const cands = [];
      for (const day of DAYS) {
        const maxP = maxPeriod(day);
        for (let p = 1; p <= maxP; p++) {
          if ((it.span || 1) === 2 && p === maxP) continue;
          if (!canPlace(id, it, day, p, idx)) continue;
          cands.push({ day, period: p, score: scoreCandidate(it, day, p) });
        }
      }
      if (!cands.length) continue;

      // Sort candidates, then apply pilot lookahead to top-K to pick best
      cands.sort((a, b) => b.score - a.score);
      const pilotK = remaining.size > 0 ? Math.min(5, cands.length) : 1;
      if (remaining.size > 0 && pilotK > 1) {
        // Forward check + pilot scoring on top candidates
        let bestCand = null, bestPilot = -Infinity;
        for (let ci = 0; ci < pilotK; ci++) {
          const c = cands[ci];
          if (!forwardCheck(id, it, c.day, c.period, remaining)) continue; // skip dead-ends
          const ps = c.score + pilotScore(id, it, c.day, c.period, PILOT_DEPTH, remaining);
          if (ps > bestPilot) { bestPilot = ps; bestCand = c; }
        }
        if (!bestCand) bestCand = cands[0]; // all caused dead-ends, fall back
        place(id, it, bestCand.day, bestCand.period);
      } else {
        const pick = choose(cands);
        place(id, it, pick.day, pick.period);
      }
    }

    // v32.4: multi-pass stash repair — try to place each remaining item by moving one blocker
    // Pass 1: all remaining, sorted hardest first
    // Pass 2: retry any still-remaining (chain repair can unlock more after pass 1 moves)
    for (let repPass = 0; repPass < 2; repPass++) {
      const stillLeft = unplaced0.filter(id => !placements[id]).sort((a, b) => hardness(b) - hardness(a));
      if (!stillLeft.length) break;
      for (const id of stillLeft) {
        const it = state.items[id]; if (!it) continue;
        if (placements[id]) continue;
        tryStashPlace(id, it, placements, idx, stats, canPlace, scoreCandidate, place, fixedLocked);
      }
    }

    // v32.4: destroy-and-repair rounds — smarter: sort by hardness when re-placing
    const movablePlaced = () => Object.keys(state.items).filter(x => placements[x] && !placements[x].locked);
    const destroyOnce = (k) => {
      const cand = movablePlaced();
      if (!cand.length) return;
      // Prefer destroying "easier" items so harder ones get first pick when re-placed
      const sorted = cand.slice().sort((a, b) => hardness(a) - hardness(b));
      const pick = sorted.slice(0, Math.min(k, sorted.length));
      for (const x of pick) { delete placements[x]; }
      const idxNew = buildIdxFromPlacements(placements);
      idx.tea = idxNew.tea; idx.cls = idxNew.cls; idx.room = idxNew.room;
      stats.clsDept = buildDeptStatsFromPlacements(placements).clsDept;

      // Re-place all unplaced sorted hardest-first
      const unp = Object.keys(state.items).filter(x => !placements[x])
        .sort((a, b) => hardness(b) - hardness(a));
      for (const xid of unp) {
        const itx = state.items[xid]; if (!itx) continue;
        const cands = [];
        for (const day of DAYS) {
          const maxP = maxPeriod(day);
          for (let p = 1; p <= maxP; p++) {
            if ((itx.span || 1) === 2 && p === maxP) continue;
            if (!canPlace(xid, itx, day, p, idx)) continue;
            cands.push({ day, period: p, score: scoreCandidate(itx, day, p) });
          }
        }
        if (!cands.length) continue;
        const pick2 = choose(cands);
        place(xid, itx, pick2.day, pick2.period);
      }
      // One stash pass after each destroy round
      const afterLeft = Object.keys(state.items).filter(x => !placements[x]).sort((a, b) => hardness(b) - hardness(a));
      for (const xid of afterLeft) {
        const itx = state.items[xid]; if (!itx) continue;
        tryStashPlace(xid, itx, placements, idx, stats, canPlace, scoreCandidate, place, fixedLocked);
      }
    };

    const rem0 = unplaced0.filter(x => !placements[x]).length;
    // More rounds when items remain, fewer when already good
    const rounds = rem0 > 0 ? 4 : 2;
    for (let rr = 0; rr < rounds; rr++) {
      destroyOnce(2 + Math.floor(Math.random() * (rem0 > 0 ? 4 : 3)));
    }

    const remain = unplaced0.filter(id => !placements[id]).length;
    const soft = softMetricsFromPlacements(placements, optBalance, optNoConsec);
    const vio = hardViolationsFromPlacements(placements);
    const msg = `AI: 配置${unplaced0.length - remain}/${unplaced0.length} 残${remain} 違反${vio} 偏り${soft.bias.toFixed(1)} 連続${soft.consec}`;
    return { placements, key: { remain, vio, soft: soft.score, bias: soft.bias, consec: soft.consec }, msg };
  }

  function tryStashPlace(id, it, placements, idx, stats, canPlace, scoreCandidate, place, fixedLocked) {
    // Look for a cell where target can go after moving one blocker out.
    const span = it.span || 1;
    // Build all candidate cells, sort: first check cells where target might fit directly (fast path)
    const cells = [];
    for (const day of DAYS) {
      const maxP = maxPeriod(day);
      for (let p = 1; p <= maxP; p++) {
        if (span === 2 && p === maxP) continue;
        cells.push({ day, period: p });
      }
    }
    // Fast path: some cells may already be free
    for (const cell of cells) {
      const day = cell.day, p0 = cell.period;
      if (canPlace(id, it, day, p0, idx)) {
        place(id, it, day, p0);
        return true;
      }
    }
    // Stash path: for each cell, gather blockers and try to move one
    // Sort cells randomly for diversity across repair passes
    const shuffled = shuffle(cells);
    for (const cell of shuffled) {
      const day = cell.day, p0 = cell.period;
      // gather blockers within span
      const blockers = new Set();
      for (let dp = 0; dp < span; dp++) {
        const p = p0 + dp;
        for (const t of it.teas || []) (idx.tea?.[t]?.[day]?.[p] || []).forEach(x => blockers.add(x));
        for (const c of it.cls || []) (idx.cls?.[c]?.[day]?.[p] || []).forEach(x => blockers.add(x));
        if (state.settings.roomConflict) {
          for (const r of it.rooms || []) (idx.room?.[r]?.[day]?.[p] || []).forEach(x => blockers.add(x));
        }
      }
      // choose a movable blocker
      const blk = [...blockers].find(x => x && placements[x] && !fixedLocked.has(x));
      if (!blk) continue;
      const itB = state.items[blk]; if (!itB) continue;

      // Build idx without blocker and check if target fits
      const idx2 = buildIdxFromPlacements(placements, blk);
      const okTarget = (() => {
        const spanT = span;
        for (let dp = 0; dp < spanT; dp++) {
          const pp = p0 + dp;
          if (isForbiddenForSubject(it.subjKey, day, pp)) return false;
          for (const t of it.teas || []) {
            if (isUnavailableForTeacher(t, day, pp)) return false;
            if ((idx2.tea?.[t]?.[day]?.[pp] || []).length) return false;
          }
          for (const cl of it.cls || []) {
            if ((idx2.cls?.[cl]?.[day]?.[pp] || []).length) return false;
          }
          if (state.settings.roomConflict) {
            for (const r of it.rooms || []) {
              if ((idx2.room?.[r]?.[day]?.[pp] || []).length) return false;
            }
          }
        }
        return true;
      })();
      if (!okTarget) continue;

      const canPlaceB = (day2, p2) => {
        const spanB = itB.span || 1;
        const maxP = maxPeriod(day2);
        if (p2 < 1 || p2 > maxP) return false;
        if (spanB === 2 && p2 === maxP) return false;
        for (let dp = 0; dp < spanB; dp++) {
          const pp = p2 + dp;
          if (isForbiddenForSubject(itB.subjKey, day2, pp)) return false;
          for (const t of itB.teas || []) {
            if (isUnavailableForTeacher(t, day2, pp)) return false;
            if ((idx2.tea?.[t]?.[day2]?.[pp] || []).length) return false;
          }
          for (const c of itB.cls || []) {
            if ((idx2.cls?.[c]?.[day2]?.[pp] || []).length) return false;
          }
          if (state.settings.roomConflict) {
            for (const r of itB.rooms || []) {
              if ((idx2.room?.[r]?.[day2]?.[pp] || []).length) return false;
            }
          }
        }
        return true;
      };

      // Find best spot for blocker
      let bestB = null, bestBScore = -99999;
      for (const day2 of DAYS) {
        const maxP2 = maxPeriod(day2);
        for (let p2 = 1; p2 <= maxP2; p2++) {
          if ((itB.span || 1) === 2 && p2 === maxP2) continue;
          if (!canPlaceB(day2, p2)) continue;
          // Quick score: prefer not to create new conflicts
          const sc = (day2 === day && Math.abs(p2 - p0) <= 2) ? -1 : 1; // prefer moving far
          if (sc > bestBScore) { bestBScore = sc; bestB = { day: day2, period: p2 }; }
        }
      }
      if (!bestB) continue;

      // Perform the move
      placements[blk] = null;
      placements[id] = null;
      const idxFresh = buildIdxFromPlacements(placements);
      idx.tea = idxFresh.tea; idx.cls = idxFresh.cls; idx.room = idxFresh.room;
      stats.clsDept = buildDeptStatsFromPlacements(placements).clsDept;

      place(blk, itB, bestB.day, bestB.period);
      place(id, it, day, p0);
      return true;
    }
    return false;
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function buildIdxFromPlacements(placements, skipId = null) {
    const idx = { tea: {}, cls: {}, room: {} };
    const add = (type, key, day, p, id) => {
      if (!idx[type][key]) idx[type][key] = {};
      if (!idx[type][key][day]) idx[type][key][day] = {};
      if (!idx[type][key][day][p]) idx[type][key][day][p] = [];
      idx[type][key][day][p].push(id);
    };
    for (const id in state.items) {
      if (skipId && id === skipId) continue;
      const it = state.items[id];
      const plc = placements[id];
      if (!it || !plc) continue;
      const span = it.span || 1;
      for (let dp = 0; dp < span; dp++) {
        const day = plc.day; const p = plc.period + dp;
        for (const t of it.teas || []) add('tea', t, day, p, id);
        for (const c of it.cls || []) add('cls', c, day, p, id);
        for (const r of it.rooms || []) add('room', r, day, p, id);
      }
    }
    return idx;
  }

  function addToIdxLocal(idx, id, it, plc) {
    const add = (type, key, day, p, id) => {
      if (!idx[type][key]) idx[type][key] = {};
      if (!idx[type][key][day]) idx[type][key][day] = {};
      if (!idx[type][key][day][p]) idx[type][key][day][p] = [];
      idx[type][key][day][p].push(id);
    };
    const span = it.span || 1;
    for (let dp = 0; dp < span; dp++) {
      const day = plc.day; const p = plc.period + dp;
      for (const t of it.teas || []) add('tea', t, day, p, id);
      for (const c of it.cls || []) add('cls', c, day, p, id);
      for (const r of it.rooms || []) add('room', r, day, p, id);
    }
  }

  function buildDeptStatsFromPlacements(placements) {
    const stats = { clsDept: {} };
    const get = (c, d) => {
      if (!stats.clsDept[c]) stats.clsDept[c] = {};
      if (!stats.clsDept[c][d]) stats.clsDept[c][d] = { sum: 0, cnt: 0 };
      return stats.clsDept[c][d];
    };
    const timeScore = (p) => (p === 1 ? -2 : p === 2 ? -1 : p === 3 ? 0 : p === 4 ? 0 : p === 5 ? 1 : p === 6 ? 2 : 3);
    for (const id in state.items) {
      const it = state.items[id];
      const plc = placements[id];
      if (!it || !plc) continue;
      const dept = (state.subjectCfg[it.subjKey]?.dept || '');
      if (!dept) continue;
      const span = it.span || 1;
      for (const c of it.cls || []) {
        for (let dp = 0; dp < span; dp++) {
          const p = plc.period + dp;
          const st = get(c, dept);
          st.sum += timeScore(p);
          st.cnt += 1;
        }
      }
    }
    return stats;
  }

  // クラス→そのクラスを含むitem idの一覧（itemsは探索中不変なのでキャッシュ）
  let _itemsByClassCache = null, _itemsByClassKey = null;
  function getItemsByClass() {
    // state.items の参照が変わったら作り直す（import/編集時）
    if (_itemsByClassCache && _itemsByClassKey === state.items) return _itemsByClassCache;
    const map = {};
    for (const id in state.items) {
      const it = state.items[id]; if (!it) continue;
      for (const c of (it.cls || [])) { (map[c] || (map[c] = [])).push(id); }
    }
    _itemsByClassCache = map; _itemsByClassKey = state.items;
    return map;
  }
  const _softTimeScore = (p) => (p === 1 ? -2 : p === 2 ? -1 : p === 3 ? 0 : p === 4 ? 0 : p === 5 ? 1 : p === 6 ? 2 : 3);

  // 教員→そのコマ一覧（空きコマ最小化用, itemsは探索中不変なのでキャッシュ）
  let _itemsByTeaCache = null, _itemsByTeaKey = null;
  function getItemsByTeacher() {
    if (_itemsByTeaCache && _itemsByTeaKey === state.items) return _itemsByTeaCache;
    const map = {};
    for (const id in state.items) {
      const it = state.items[id]; if (!it) continue;
      for (const t of (it.teas || [])) { (map[t] || (map[t] = [])).push(id); }
    }
    _itemsByTeaCache = map; _itemsByTeaKey = state.items;
    return map;
  }
  // 教員系ソフトの設定と重み
  function aiMinGapOn() { return !!state.settings.aiMinGap; }
  function aiBalanceLoadOn() { return !!state.settings.aiBalanceLoad; }
  const TEACHER_GAP_W = 8;
  const TEACHER_BAL_W = 2; // 1日コマ数の二乗和ペナルティ重み（負担平準化）
  // 教員の連続授業ペナルティ（常に有効）。3連続=30、4連続=300、5連続=600 相当
  const TEACHER_RUN_W = 30;
  function teacherRunPenalty(L) { return L >= 4 ? (L - 3) * 10 : (L === 3 ? 1 : 0); }
  // 先生のその日の授業時限（集合）から、昼休みで区切った「連続した時限のまとまり」を返す（AI・提案・改善処理で共通）
  function teacherRuns(periodSet, day) {
    const lunchAfter = Number(state.settings.lunchAfter || 0);
    const maxP = maxPeriod(day);
    const runs = []; let run = [];
    const flush = () => { if (run.length) runs.push(run); run = []; };
    for (let p = 1; p <= maxP + 1; p++) {
      if (lunchAfter && p === lunchAfter + 1) flush();
      if (periodSet.has(p)) run.push(p); else flush();
    }
    return runs;
  }
  // 連続授業の点数（3連続=1点、4連続以上=(L-3)×10点）の合計
  const teacherRunScore = (periodSet, day) => teacherRuns(periodSet, day).reduce((a, r) => a + teacherRunPenalty(r.length), 0);
  // 同じ授業が1時間目ばかり・午後ばかりに偏るのを避ける重み（常に有効）
  const SUBJ_SPREAD_W = 40;
  // 学校のルール: 3年の体育は、入れる日には3年の全クラスに入れる（1クラスだけ無い日は不公平）。
  // 体育がある日に、体育が無い3年のクラス1つにつき PE_FAIR_W 点の減点
  const PE_FAIR_W = 300;
  const PE_GRADE = '3';
  function peFairPenalty(placements) {
    const isPE = (it) => /体育/.test(it.subj || '') && !/保健/.test(it.subj || '');
    const gradeCls = new Set(); const byDay = {};
    for (const id in state.items) {
      const it = state.items[id]; if (!it) continue;
      for (const c of (it.cls || [])) if (new RegExp('^' + PE_GRADE + '-\\d+$').test(c)) gradeCls.add(c);
      if (!isPE(it)) continue;
      const p = placements[id]; if (!p || !p.day) continue;
      for (const c of (it.cls || [])) if (gradeCls.has(c) || new RegExp('^' + PE_GRADE + '-\\d+$').test(c)) (byDay[p.day] || (byDay[p.day] = new Set())).add(c);
    }
    let pen = 0;
    for (const d in byDay) { const n = byDay[d].size; if (n > 0 && n < gradeCls.size) pen += gradeCls.size - n; }
    return pen;
  }
  // 1教員分の教員系ソフト生値:
  //   gap     = 各曜日で最初〜最後の授業の間の空き時限数（中抜け）の合計
  //   balance = 各曜日の担当コマ数の二乗和（小さいほど曜日間で平準化される）
  function teacherSoftContribution(placements, tea, ids) {
    const byDay = {};
    for (const id of ids) {
      const plc = placements[id]; if (!plc || !plc.day) continue;
      const it = state.items[id]; if (!it) continue;
      const span = it.span || 1;
      const s = byDay[plc.day] || (byDay[plc.day] = new Set());
      for (let dp = 0; dp < span; dp++) s.add(plc.period + dp);
    }
    let gap = 0, balance = 0, run = 0;
    const lunchAfter = Number(state.settings.lunchAfter || 0);
    for (const day in byDay) {
      const ps = byDay[day];
      // 連続授業: 昼休みで区切った連続コマ数 L について、3連続=1点、4連続以上=(L-3)×10点
      // （4連続はできるだけ無くし、3連続もなるべく減らす）
      run += teacherRunScore(ps, day);
      balance += ps.size * ps.size;
      if (ps.size < 2) continue;
      let mn = Infinity, mx = -Infinity;
      for (const p of ps) { if (p < mn) mn = p; if (p > mx) mx = p; }
      gap += (mx - mn + 1) - ps.size;
    }
    return { gap, balance, run };
  }

  // 1クラス分のソフト指標（bias/consec/noSameDay）の生値を算出。
  // 全体のソフト指標はクラス単位で完全に分解できるため、これを合算すると
  // softMetricsFromPlacements と一致する（差分評価との整合を保証）。
  function classSoftContribution(placements, c, ids) {
    const deptOf = (id) => (state.subjectCfg[state.items[id]?.subjKey]?.dept) || '';
    const deptAgg = {};   // dept -> {sum, cnt}
    const cell = {};      // day -> period -> 先頭item id
    const noSame = {};    // `c|subjKey|day` -> count
    const spread = {};    // subjKey -> {n, first, pm}
    const lunchAfterS = Number(state.settings.lunchAfter || 0);
    for (const id of ids) {
      const plc = placements[id]; if (!plc || !plc.day) continue;
      const it = state.items[id]; if (!it) continue;
      const dept = deptOf(id);
      const span = it.span || 1;
      for (let dp = 0; dp < span; dp++) {
        const p = plc.period + dp;
        if (dept) { const a = deptAgg[dept] || (deptAgg[dept] = { sum: 0, cnt: 0 }); a.sum += _softTimeScore(p); a.cnt += 1; }
        const dd = cell[plc.day] || (cell[plc.day] = {});
        if (dd[p] === undefined) dd[p] = id; // 先頭優先
      }
      const sc = state.subjectCfg[it.subjKey] || {};
      if (sc.noSameDay) { const key = `${c}|${it.subjKey}|${plc.day}`; noSame[key] = (noSame[key] || 0) + 1; }
      const sp = spread[it.subjKey] || (spread[it.subjKey] = { n: 0, first: 0, pm: 0 });
      sp.n++; if (plc.period === 1) sp.first++; if (lunchAfterS && plc.period > lunchAfterS) sp.pm++;
    }
    // 同じ授業の時間帯の偏り: 1時間目が週の1/3（最低1回）を超える分、午後が半分（最低1回）を超える分を減点
    let spreadPen = 0;
    for (const k in spread) {
      const a = spread[k]; if (a.n < 2) continue;
      spreadPen += Math.max(0, a.first - Math.max(1, Math.floor(a.n / 3)));
      spreadPen += Math.max(0, a.pm - Math.max(1, Math.ceil(a.n / 2)));
    }
    let bias = 0;
    for (const d in deptAgg) { const a = deptAgg[d]; if (a.cnt > 0) bias += (a.sum * a.sum) / a.cnt; }
    let consec = 0;
    for (const day in cell) {
      const maxP = maxPeriod(day);
      const row = cell[day];
      for (let p = 1; p < maxP; p++) {
        const a = row[p], b = row[p + 1];
        if (a === undefined || b === undefined) continue;
        if (a === b && (state.items[a]?.span || 1) === 2) continue;
        const da = deptOf(a), db = deptOf(b);
        if (da && da === db) consec += 1;
      }
    }
    let noSameDay = 0;
    for (const k in noSame) { const n = noSame[k]; if (n >= 2) noSameDay += 5000 + (n - 2) * 8000; }
    // 時間帯の偏りは常に有効なソフト制約として noSameDay 枠に合算（差分評価の経路をそのまま使える）
    noSameDay += spreadPen * SUBJ_SPREAD_W;
    return { bias, consec, noSameDay, spread: spreadPen };
  }

  function softMetricsFromPlacements(placements, optBalance = true, optNoConsec = true) {
    const itemsByClass = getItemsByClass();
    let bias = 0, consec = 0, noSameDayPenalty = 0;
    for (const c in itemsByClass) {
      const r = classSoftContribution(placements, c, itemsByClass[c]);
      bias += r.bias; consec += r.consec; noSameDayPenalty += r.noSameDay;
    }
    let teaGap = 0, teaBal = 0, teaRun = 0;
    const gapOn = aiMinGapOn(), balOn = aiBalanceLoadOn();
    {
      const itemsByTea = getItemsByTeacher();
      for (const t in itemsByTea) { const r = teacherSoftContribution(placements, t, itemsByTea[t]); teaGap += r.gap; teaBal += r.balance; teaRun += r.run; }
    }
    const score = (optBalance ? bias : 0) + (optNoConsec ? consec * 4 : 0) + noSameDayPenalty
      + (gapOn ? teaGap * TEACHER_GAP_W : 0) + (balOn ? teaBal * TEACHER_BAL_W : 0) + teaRun * TEACHER_RUN_W;
    const peFair = peFairPenalty(placements);
    return { bias, consec, noSameDayPenalty, teaGap, teaBal, teaRun, peFair, score: score + peFair * PE_FAIR_W };
  }

  // 未配置ペナルティ重み。配置数維持モードではハード違反(×100000)より重くして、
  // AIがコマを在庫へ外して違反を減らす動きを抑制し、全配置のまま違反最小化する。
  function aiRemainWeight() { return state.settings.aiKeepPlaced ? 200000 : 50000; }

  function hardViolationsFromPlacements(placements) {
    const idx = buildIdxFromPlacements(placements);
    let v = 0;
    const countType = (map) => {
      for (const k in map) {
        for (const d in map[k]) {
          for (const p in map[k][d]) {
            const arr = map[k][d][p] || [];
            if (arr.length > 1) v += (arr.length - 1);
          }
        }
      }
    };
    countType(idx.tea);
    countType(idx.cls);
    if (state.settings.roomConflict) countType(idx.room);
    // 教員1日上限超過もハード違反に含める
    for (const tea in idx.tea) {
      const maxD = teacherDailyMax(tea);
      if (maxD == null) continue;
      for (const day of DAYS) {
        const dayMap = idx.tea[tea]?.[day]; if (!dayMap) continue;
        const items = new Set();
        for (const p in dayMap) { for (const id of (dayMap[p] || [])) items.add(id); }
        if (items.size > maxD) v += (items.size - maxD);
      }
    }
    return v;
  }

  function aiPlaceAll() {
    const mode = $('#ai-mode')?.value || 'normal';
    const tries = clampInt($('#ai-tries')?.value, 1, 200, 30);
    const rand = clampNum(Number($('#ai-rand')?.value || 0) / 100, 0, 1, 0.35);
    const optBalance = !!$('#ai-balance')?.checked;
    const optNoConsec = !!$('#ai-noconsec')?.checked;

    // F5: リアルタイム進捗表示
    const _stEl = $('#ai-status');
    const _pbEl = $('#ai-progress-bar');
    const _aiStart = performance.now();
    const _setGreedyStatus = (trial, total, bestPlaced, totalUnplaced) => {
      const pct = Math.round(trial / total * 100);
      if (_pbEl) _pbEl.style.width = pct + '%';
      const elapsed = ((performance.now() - _aiStart) / 1000).toFixed(1);
      if (_stEl) _stEl.textContent = `Greedy: 試行${trial}/${total} ベスト${bestPlaced}/${totalUnplaced} (${elapsed}s)`;
    };

    const basePlacements = deepClone(state.placements);
    const allIds = Object.keys(state.items);

    const unplaced0 = allIds.filter(id => !basePlacements[id]);
    // 全コマ配置済みでも違反が残っていれば最適化を実行（違反ゼロのときのみ実行不要）
    if (!unplaced0.length && hardViolationsFromPlacements(basePlacements) === 0) { flash('未配置・違反ともにありません'); return; }

    const fixedIds = allIds.filter(id => basePlacements[id] && basePlacements[id].locked);
    const movablePlaced = allIds.filter(id => basePlacements[id] && !basePlacements[id].locked);
    // v42: allow a small shake in AI配置 (bold/normal only)
    if (mode !== 'gentle') {
      const k = (mode === 'bold') ? (2 + Math.floor(Math.random() * 5)) : (Math.random() < 0.12 ? (1 + Math.floor(Math.random() * 2)) : 0);
      if (k > 0 && movablePlaced.length) {
        const pick = shuffle(movablePlaced.slice()).slice(0, Math.min(k, movablePlaced.length));
        for (const rid of pick) { basePlacements[rid] = null; }
      }
    }

    // Pre-sort by constraint hardness: 2連続 > 同時教員数 > 単位数 > 禁則枠 > 配置困難度
    // Precompute contention maps (O(n) pass)
    const teaContMap = {}; // teacher → total items count
    const roomContMap = {}; // room → total items count
    const subjClsInstMap = {}; // "subjKey|cls" → instance count
    for (const xid of allIds) {
      const xit = state.items[xid]; if (!xit) continue;
      for (const t of xit.teas || []) teaContMap[t] = (teaContMap[t] || 0) + 1;
      for (const r of xit.rooms || []) roomContMap[r] = (roomContMap[r] || 0) + 1;
      for (const c of xit.cls || []) {
        const k = xit.subjKey + '|' + c;
        subjClsInstMap[k] = (subjClsInstMap[k] || 0) + 1;
      }
    }
    const hardness = (id) => {
      const it = state.items[id]; if (!it) return 0;
      const span = it.span || 1;
      const forbid = countForbid(it.subjKey) || 0;
      // 1. 2連続: highest priority
      // 2. 同時に多くの教員・教室が動く = teacher/room contention
      let contention = 0;
      for (const t of it.teas || []) contention += Math.max(0, (teaContMap[t] || 0) - 1);
      for (const r of it.rooms || []) contention += Math.max(0, (roomContMap[r] || 0) - 1);
      const contentionScore = Math.min(contention, 40) * 0.5; // up to +20
      // 3. 単位数が多い (many instances of this subject for same class = harder to spread)
      let instMax = 0;
      for (const c of it.cls || []) { instMax = Math.max(instMax, subjClsInstMap[it.subjKey + '|' + c] || 0); }
      const instScore = Math.min(instMax, 8) * 1.2; // up to +9.6
      const structural = (span === 2 ? 16 : 0) + (it.cls?.length > 1 ? 6 : 0) + (it.teas?.length > 1 ? 5 : 0) + (it.rooms?.length > 1 ? 2 : 0) + forbid * 0.4 + contentionScore + instScore;
      // Pure slot count (ignoring occupancy conflicts)
      let slots = 0;
      for (const d of DAYS) { const maxP = maxPeriod(d); for (let p = 1; p <= maxP; p++) { if (span === 2 && p === maxP) continue; let ok = true; for (let dp = 0; dp < span && ok; dp++) { const pp = p + dp; if (isForbiddenForSubject(it.subjKey, d, pp)) ok = false; for (const t of it.teas || []) { if (isUnavailableForTeacher(t, d, pp)) ok = false; } } if (ok) slots++; } }
      const scarcity = slots === 0 ? 200 : slots === 1 ? 150 : slots <= 3 ? 80 : slots <= 6 ? 40 : slots <= 12 ? 20 : slots <= 20 ? 8 : 0;
      return structural + scarcity;
    };
    const unplaced = unplaced0.slice().sort((a, b) => hardness(b) - hardness(a));

    // --- Quality evaluation (soft) ---
    const timeScore = (p) => (p === 1 ? -2 : p === 2 ? -1 : p === 3 ? 0 : p === 4 ? 0 : p === 5 ? 1 : p === 6 ? 2 : 3);
    const deptOf = (it) => (state.subjectCfg[it.subjKey]?.dept || '');

    function buildIdxFrom(placements) {
      const idx = { tea: {}, cls: {}, room: {} };
      const add = (type, key, day, p, id) => {
        if (!idx[type][key]) idx[type][key] = {};
        if (!idx[type][key][day]) idx[type][key][day] = {};
        if (!idx[type][key][day][p]) idx[type][key][day][p] = [];
        idx[type][key][day][p].push(id);
      };
      for (const id in state.items) {
        const it = state.items[id];
        const plc = placements[id];
        if (!it || !plc) continue;
        const span = it.span || 1;
        for (let dp = 0; dp < span; dp++) {
          const day = plc.day; const p = plc.period + dp;
          for (const t of it.teas || []) add('tea', t, day, p, id);
          for (const c of it.cls || []) add('cls', c, day, p, id);
          for (const r of it.rooms || []) add('room', r, day, p, id);
        }
      }
      return idx;
    }

    function buildDeptStats(placements) {
      // stats.clsDept[c][dept] = {sum, cnt}
      const stats = { clsDept: {} };
      const get = (c, d) => {
        if (!stats.clsDept[c]) stats.clsDept[c] = {};
        if (!stats.clsDept[c][d]) stats.clsDept[c][d] = { sum: 0, cnt: 0 };
        return stats.clsDept[c][d];
      };
      for (const id in state.items) {
        const it = state.items[id];
        const plc = placements[id];
        if (!it || !plc) continue;
        const dept = deptOf(it);
        if (!dept) continue;
        const span = it.span || 1;
        for (const c of it.cls || []) {
          for (let dp = 0; dp < span; dp++) {
            const p = plc.period + dp;
            const st = get(c, dept);
            st.sum += timeScore(p);
            st.cnt += 1;
          }
        }
      }
      return stats;
    }

    function biasObjective(stats) {
      let pen = 0;
      for (const c in stats.clsDept) {
        for (const d in stats.clsDept[c]) {
          const st = stats.clsDept[c][d];
          if (st.cnt > 0) pen += (st.sum * st.sum) / st.cnt;
        }
      }
      return pen;
    }

    function consecObjective(placements) {
      // count consecutive same dept per class per day (ignore 2-span same id adjacency)
      const idx = buildIdxFrom(placements);
      let pen = 0;
      for (const c in idx.cls) {
        for (const day of DAYS) {
          const maxP = maxPeriod(day);
          for (let p = 1; p < maxP; p++) {
            const a = (idx.cls[c][day]?.[p] || [])[0];
            const b = (idx.cls[c][day]?.[p + 1] || [])[0];
            if (!a || !b) continue;
            if (a === b && (state.items[a]?.span || 1) === 2) continue;
            const da = deptOf(state.items[a] || { subjKey: '' });
            const db = deptOf(state.items[b] || { subjKey: '' });
            if (da && da === db) pen += 1;
          }
        }
      }
      return pen;
    }

    function totalSoft(placements) {
      const stats = buildDeptStats(placements);
      const bias = biasObjective(stats);
      const consec = consecObjective(placements);
      return { bias, consec, score: (optBalance ? bias : 0) + (optNoConsec ? consec * 4 : 0) };
    }

    // --- Candidate feasibility and scoring using local index/stats ---
    function canPlace(id, it, day, period, idx) {
      const span = it.span || 1;
      const maxP = maxPeriod(day);
      if (period < 1 || period > maxP) return false;
      if (span === 2 && period === maxP) return false;
      for (let dp = 0; dp < span; dp++) {
        const p = period + dp;
        if (isForbiddenForSubject(it.subjKey, day, p)) return false;
        for (const t of it.teas || []) {
          if (isUnavailableForTeacher(t, day, p)) return false;
          const occ = idx.tea?.[t]?.[day]?.[p] || [];
          if (occ.length) return false;
        }
        for (const c of it.cls || []) {
          const occ = idx.cls?.[c]?.[day]?.[p] || [];
          if (occ.length) return false;
        }
        if (state.settings.roomConflict) {
          for (const r of it.rooms || []) {
            const occ = idx.room?.[r]?.[day]?.[p] || [];
            if (occ.length) return false;
          }
        }
      }
      // v33.0: enforce noSameDay hard constraint in AI
      const scfg = state.subjectCfg[it.subjKey] || {};
      if (scfg.noSameDay) {
        for (const c of it.cls || []) {
          const dayIds = Object.keys(idx.cls?.[c]?.[day] || {}).flatMap(p => (idx.cls?.[c]?.[day]?.[p] || []));
          const sameDaySubj = dayIds.some(oid => oid !== id && state.items[oid]?.subjKey === it.subjKey);
          if (sameDaySubj) return false;
        }
      }
      // v33.0: enforce maxPerDay hard constraint in AI
      if (scfg.maxPerDay != null && scfg.maxPerDay !== '') {
        const maxN = Number(scfg.maxPerDay);
        for (const c of it.cls || []) {
          let cnt = 0;
          const daySlots = idx.cls?.[c]?.[day] || {};
          for (const p in daySlots) {
            const occ = daySlots[p] || [];
            for (const oid of occ) { if (state.items[oid]?.subjKey === it.subjKey) cnt++; }
          }
          cnt += span;
          if (cnt > maxN) return false;
        }
      }
      return true;
    }

    function addToIdxLocal(id, it, plc, idx) {
      const add = (type, key, day, p, id) => {
        if (!idx[type][key]) idx[type][key] = {};
        if (!idx[type][key][day]) idx[type][key][day] = {};
        if (!idx[type][key][day][p]) idx[type][key][day][p] = [];
        idx[type][key][day][p].push(id);
      };
      const span = it.span || 1;
      for (let dp = 0; dp < span; dp++) {
        const day = plc.day; const p = plc.period + dp;
        for (const t of it.teas || []) add('tea', t, day, p, id);
        for (const c of it.cls || []) add('cls', c, day, p, id);
        for (const r of it.rooms || []) add('room', r, day, p, id);
      }
    }

    function scoreCandidate(id, it, day, period, idx, stats) {
      let pen = 0;
      const span = it.span || 1;
      const dept = deptOf(it);
      const scfg = state.subjectCfg[it.subjKey] || {};

      // Mild avoid: multi-class at 1st period tends to over-pack (bias)
      if ((it.cls?.length || 0) > 1 && period === 1) pen += 1.2;

      // v33.0: Strongly prefer spreading same subject across different days
      if (scfg.noSameDay) {
        // Already enforced in canPlace, but add soft penalty for near-violations
      }
      // Prefer spreading same subject over different days (not all Mon, not all Tue)
      {
        const subjDayCounts = {};
        for (const c of it.cls || []) {
          const daySlots = idx.cls?.[c]?.[day] || {};
          for (const p in daySlots) {
            for (const oid of daySlots[p] || []) {
              if (state.items[oid]?.subjKey === it.subjKey) {
                subjDayCounts[day] = (subjDayCounts[day] || 0) + 1;
              }
            }
          }
        }
        const sameDay = subjDayCounts[day] || 0;
        pen += sameDay * 2.5; // Penalize putting same subject on same day repeatedly
      }

      // Teacher load (soft)
      const lunchAfter = Number(state.settings.lunchAfter || 0);
      for (const t of it.teas || []) {
        const maxD = teacherDailyMax(t);
        const maxC = teacherConsecMax(t);
        // daily count
        let taught = 0;
        const maxP = maxPeriod(day);
        for (let p = 1; p <= maxP; p++) {
          if (idx.tea?.[t]?.[day]?.[p]?.length) taught++;
        }
        taught += span;
        if (maxD != null && taught > maxD) pen += (taught - maxD) * 6;
        // consecutive run
        if (maxC != null) {
          const taughtSet = new Set();
          for (let p = 1; p <= maxP; p++) {
            if (idx.tea?.[t]?.[day]?.[p]?.length) taughtSet.add(p);
          }
          for (let dp = 0; dp < span; dp++) taughtSet.add(period + dp);
          let best = 0, cur = 0;
          for (let p = 1; p <= maxP; p++) {
            if (lunchAfter && p === lunchAfter + 1) cur = 0;
            if (taughtSet.has(p)) { cur++; best = Math.max(best, cur); } else cur = 0;
          }
          if (best > maxC) pen += (best - maxC) * 8;
        }
        // spread a bit
        pen += taught * 0.08;
        // v33.0: reward spreading teacher workload evenly across days
        let otherDayLoads = 0, otherDayCnt = 0;
        for (const od of DAYS) { if (od === day) continue; const odIdx = idx.tea?.[t]?.[od] || {}; const n = Object.values(odIdx).filter(a => a.length).length; if (n) { otherDayLoads += n; otherDayCnt++; } }
        if (otherDayCnt > 0) { const avgOther = otherDayLoads / otherDayCnt; if (taught > avgOther + 1) pen += 0.5; }
      }

      // Consecutive same dept (per class) (soft)
      if (optNoConsec && dept) {
        for (const c of it.cls || []) {
          // check left neighbor
          const leftP = period - 1;
          if (leftP >= 1) {
            const leftId = (idx.cls?.[c]?.[day]?.[leftP] || [])[0];
            if (leftId) {
              const dL = deptOf(state.items[leftId] || { subjKey: '' });
              if (dL && dL === dept) pen += 4;
            }
          }
          // check right neighbor (after span)
          const rightP = period + span;
          const maxP = maxPeriod(day);
          if (rightP <= maxP) {
            const rightId = (idx.cls?.[c]?.[day]?.[rightP] || [])[0];
            if (rightId) {
              const dR = deptOf(state.items[rightId] || { subjKey: '' });
              if (dR && dR === dept) pen += 4;
            }
          }
        }
      }

      // Bias objective delta (soft)
      if (optBalance && dept) {
        const get = (c, d) => {
          if (!stats.clsDept[c]) stats.clsDept[c] = {};
          if (!stats.clsDept[c][d]) stats.clsDept[c][d] = { sum: 0, cnt: 0 };
          return stats.clsDept[c][d];
        };
        for (const c of it.cls || []) {
          const st = get(c, dept);
          for (let dp = 0; dp < span; dp++) {
            const p = period + dp;
            const ts = timeScore(p);
            const old = (st.cnt > 0) ? (st.sum * st.sum) / st.cnt : 0;
            const ns = st.sum + ts;
            const nc = st.cnt + 1;
            const neu = (ns * ns) / nc;
            pen += (neu - old) * 1.2; // weight
          }
        }
      }

      // Early/late gentle preference (avoid extremes a bit)
      for (let dp = 0; dp < span; dp++) {
        const p = period + dp;
        pen += Math.max(0, Math.abs(timeScore(p)) - 1) * 0.25;
      }

      const score = 100 - pen;
      return score;
    }

    function chooseCandidate(cands, rand) {
      cands.sort((a, b) => b.score - a.score);
      if (cands.length === 1 || rand <= 0) return cands[0];
      const K = Math.min(8, cands.length);
      const top = cands.slice(0, K);
      const best = top[0].score;
      const tau = 0.3 + rand * 3.0;
      let sumW = 0;
      const ws = top.map(c => { const w = Math.exp((c.score - best) / tau); sumW += w; return w; });
      let r = Math.random() * sumW;
      for (let i = 0; i < top.length; i++) { r -= ws[i]; if (r <= 0) return top[i]; }
      return top[0];
    }

    // ── フォワードチェック: 配置後に残コマのスロット数を管理 ──
    // resItems[`t:T:D:P`] or [`c:C:D:P`] → unplaced item ids that need that resource slot
    function buildFwdResItems(unpIds, placements, idx) {
      const resItems = {};
      const slotCnt = {};
      for (const xid of unpIds) {
        if (placements[xid]) { slotCnt[xid] = Infinity; continue; }
        const xit = state.items[xid]; if (!xit) { slotCnt[xid] = 0; continue; }
        const xspan = xit.span || 1;
        let cnt = 0;
        for (const d2 of DAYS) {
          const maxP2 = maxPeriod(d2);
          for (let p2 = 1; p2 <= maxP2; p2++) {
            if (xspan === 2 && p2 === maxP2) continue;
            if (!canPlace(xid, xit, d2, p2, idx)) continue;
            cnt++;
            for (let dp2 = 0; dp2 < xspan; dp2++) {
              const pp = p2 + dp2;
              for (const t of xit.teas || []) { const k = `t:${t}:${d2}:${pp}`; (resItems[k] = resItems[k] || new Set()).add(xid); }
              for (const c of xit.cls || []) { const k = `c:${c}:${d2}:${pp}`; (resItems[k] = resItems[k] || new Set()).add(xid); }
            }
          }
        }
        slotCnt[xid] = cnt;
      }
      return { resItems, slotCnt };
    }

    // After placing id at (day, period), update slotCnt for affected items.
    // Returns set of items that dropped to 0 (for diagnostics).
    function updateFwdAfterPlace(id, it, day, period, placements, idx, resItems, slotCnt) {
      const span = it.span || 1;
      const affected = new Set();
      for (let dp = 0; dp < span; dp++) {
        const p = period + dp;
        for (const t of it.teas || []) { const k = `t:${t}:${day}:${p}`; (resItems[k] || new Set()).forEach(yid => { if (yid !== id && !placements[yid]) affected.add(yid); }); }
        for (const c of it.cls || []) { const k = `c:${c}:${day}:${p}`; (resItems[k] || new Set()).forEach(yid => { if (yid !== id && !placements[yid]) affected.add(yid); }); }
      }
      for (const yid of affected) {
        const yit = state.items[yid]; if (!yit) continue;
        const yspan = yit.span || 1;
        // Count how many of Y's valid start positions overlap the newly blocked cells
        let lost = 0;
        for (let p2 = Math.max(1, period - yspan + 1); p2 <= period + span - 1; p2++) {
          const maxP = maxPeriod(day);
          if (p2 < 1 || p2 > maxP) continue;
          if (yspan === 2 && p2 === maxP) continue;
          if (canPlace(yid, yit, day, p2, idx)) lost++;
        }
        slotCnt[yid] = Math.max(0, (slotCnt[yid] || 0) - lost);
      }
    }

    // Forward-check penalty: penalise placements that would doom (slotCnt→0) related items
    function fwdPenalty(id, it, day, period, placements, idx, resItems, slotCnt) {
      const span = it.span || 1;
      const affected = new Set();
      for (let dp = 0; dp < span; dp++) {
        const p = period + dp;
        for (const t of it.teas || []) { const k = `t:${t}:${day}:${p}`; (resItems[k] || new Set()).forEach(yid => { if (yid !== id && !placements[yid]) affected.add(yid); }); }
        for (const c of it.cls || []) { const k = `c:${c}:${day}:${p}`; (resItems[k] || new Set()).forEach(yid => { if (yid !== id && !placements[yid]) affected.add(yid); }); }
      }
      let penalty = 0;
      for (const yid of affected) {
        const cur = slotCnt[yid];
        if (cur == null || cur === Infinity) continue;
        const yit = state.items[yid]; if (!yit) continue;
        const yspan = yit.span || 1;
        let lost = 0;
        for (let p2 = Math.max(1, period - yspan + 1); p2 <= period + span - 1; p2++) {
          const maxP = maxPeriod(day);
          if (p2 < 1 || p2 > maxP) continue;
          if (yspan === 2 && p2 === maxP) continue;
          if (canPlace(yid, yit, day, p2, idx)) lost++;
        }
        const after = cur - lost;
        if (after <= 0) penalty += 80;       // dooms an item
        else if (after === 1) penalty += 20;  // leaves only 1 slot (very risky)
        else if (after === 2) penalty += 5;
      }
      return penalty;
    }

    // ── 深度2連鎖スワップ修復 ──
    // After greedy: for each unplaced item U, try moving up to 2 blockers to place U
    function chainRepair(unplacedIds, placements, idx, fixedLocked) {
      let improved = true;
      while (improved) {
        improved = false;
        for (const uid of unplacedIds) {
          if (placements[uid]) continue;
          const uit = state.items[uid]; if (!uit) continue;
          const uspan = uit.span || 1;

          // depth-1: can U go here if we remove B1?
          for (const day of DAYS) {
            const maxP = maxPeriod(day);
            for (let p = 1; p <= maxP; p++) {
              if (uspan === 2 && p === maxP) continue;
              if (canPlace(uid, uit, day, p, idx)) {
                // direct placement
                placements[uid] = { day, period: p, locked: false };
                addToIdxLocal(uid, uit, placements[uid], idx);
                improved = true; break;
              }
              // gather 1-step blockers
              const b1Set = new Set();
              for (let dp = 0; dp < uspan; dp++) {
                const pp = p + dp;
                for (const t of uit.teas || []) (idx.tea?.[t]?.[day]?.[pp] || []).forEach(x => b1Set.add(x));
                for (const c of uit.cls || []) (idx.cls?.[c]?.[day]?.[pp] || []).forEach(x => b1Set.add(x));
                if (state.settings.roomConflict) for (const r of uit.rooms || []) (idx.room?.[r]?.[day]?.[pp] || []).forEach(x => b1Set.add(x));
              }
              for (const b1 of b1Set) {
                if (!b1 || fixedLocked.has(b1) || !placements[b1]) continue;
                const b1it = state.items[b1]; if (!b1it) continue;
                // temporarily remove B1
                const b1plc = placements[b1];
                placements[b1] = null;
                removeFromIdx(b1, b1it, b1plc, idx);
                if (canPlace(uid, uit, day, p, idx)) {
                  // B1 can be moved somewhere directly?
                  const b1span = b1it.span || 1;
                  let b1placed = false;
                  for (const d2 of DAYS) {
                    if (b1placed) break;
                    const maxP2 = maxPeriod(d2);
                    for (let p2 = 1; p2 <= maxP2; p2++) {
                      if (b1span === 2 && p2 === maxP2) continue;
                      if (canPlace(b1, b1it, d2, p2, idx)) {
                        placements[b1] = { day: d2, period: p2, locked: false };
                        addToIdxLocal(b1, b1it, placements[b1], idx);
                        b1placed = true; break;
                      }
                    }
                  }
                  if (!b1placed) {
                    // depth-2: B1 needs to displace B2 to find a spot
                    for (const d2 of DAYS) {
                      if (b1placed) break;
                      const maxP2 = maxPeriod(d2);
                      for (let p2 = 1; p2 <= maxP2; p2++) {
                        if (b1span === 2 && p2 === maxP2) continue;
                        // gather B2 blockers for B1 at (d2,p2)
                        const b2Set = new Set();
                        for (let dp2 = 0; dp2 < b1span; dp2++) {
                          const pp2 = p2 + dp2;
                          for (const t of b1it.teas || []) (idx.tea?.[t]?.[d2]?.[pp2] || []).forEach(x => b2Set.add(x));
                          for (const c of b1it.cls || []) (idx.cls?.[c]?.[d2]?.[pp2] || []).forEach(x => b2Set.add(x));
                        }
                        for (const b2 of b2Set) {
                          if (!b2 || fixedLocked.has(b2) || !placements[b2] || b2 === b1) continue;
                          const b2it = state.items[b2]; if (!b2it) continue;
                          const b2plc = placements[b2];
                          placements[b2] = null;
                          removeFromIdx(b2, b2it, b2plc, idx);
                          // can B1 go to (d2,p2)?
                          if (canPlace(b1, b1it, d2, p2, idx)) {
                            // can B2 go anywhere directly?
                            const b2span = b2it.span || 1;
                            let b2placed = false;
                            for (const d3 of DAYS) {
                              if (b2placed) break;
                              const maxP3 = maxPeriod(d3);
                              for (let p3 = 1; p3 <= maxP3; p3++) {
                                if (b2span === 2 && p3 === maxP3) continue;
                                if (canPlace(b2, b2it, d3, p3, idx)) {
                                  placements[b2] = { day: d3, period: p3, locked: false };
                                  addToIdxLocal(b2, b2it, placements[b2], idx);
                                  b2placed = true; break;
                                }
                              }
                            }
                            if (b2placed) {
                              placements[b1] = { day: d2, period: p2, locked: false };
                              addToIdxLocal(b1, b1it, placements[b1], idx);
                              b1placed = true; break;
                            }
                          }
                          // restore B2 if didn't work
                          if (!placements[b2]) {
                            placements[b2] = b2plc;
                            addToIdxLocal(b2, b2it, b2plc, idx);
                          }
                        }
                        if (b1placed) break;
                      }
                    }
                  }
                  if (b1placed) {
                    // place U now that B1 is out of the way
                    placements[uid] = { day, period: p, locked: false };
                    addToIdxLocal(uid, uit, placements[uid], idx);
                    improved = true;
                  } else {
                    // restore B1
                    placements[b1] = b1plc;
                    addToIdxLocal(b1, b1it, b1plc, idx);
                  }
                  if (placements[uid]) break;
                } else {
                  // restore B1 (U still can't go here even without B1)
                  placements[b1] = b1plc;
                  addToIdxLocal(b1, b1it, b1plc, idx);
                }
              }
              if (placements[uid]) break;
            }
            if (placements[uid]) break;
          }
        }
      }
    }

    // helper: remove item from local idx
    function removeFromIdx(id, it, plc, idx) {
      if (!plc) return;
      const span = it.span || 1;
      for (let dp = 0; dp < span; dp++) {
        const p = plc.period + dp;
        for (const t of it.teas || []) { const arr = idx.tea?.[t]?.[plc.day]?.[p]; if (arr) { const i = arr.indexOf(id); if (i >= 0) arr.splice(i, 1); } }
        for (const c of it.cls || []) { const arr = idx.cls?.[c]?.[plc.day]?.[p]; if (arr) { const i = arr.indexOf(id); if (i >= 0) arr.splice(i, 1); } }
        for (const r of it.rooms || []) { const arr = idx.room?.[r]?.[plc.day]?.[p]; if (arr) { const i = arr.indexOf(id); if (i >= 0) arr.splice(i, 1); } }
      }
    }

    // ── 深度3連鎖スワップ修復 ──
    // 深度2で解決できなかった難しいケースに対応（残り8コマ以下のみ実行）
    function chainRepairDepth3(unplacedIds, placements, idx, fixedLocked) {
      for (const uid of unplacedIds) {
        if (placements[uid]) continue;
        const uit = state.items[uid]; if (!uit) continue;
        const uspan = uit.span || 1;
        outer3:
        for (const day of DAYS) {
          const maxP = maxPeriod(day);
          for (let p = 1; p <= maxP; p++) {
            if (uspan === 2 && p === maxP) continue;
            // gather B1 blockers
            const b1Set = new Set();
            for (let dp = 0; dp < uspan; dp++) {
              const pp = p + dp;
              for (const t of uit.teas || []) (idx.tea?.[t]?.[day]?.[pp] || []).forEach(x => b1Set.add(x));
              for (const c of uit.cls || []) (idx.cls?.[c]?.[day]?.[pp] || []).forEach(x => b1Set.add(x));
            }
            if (!b1Set.size) {
              // direct place
              placements[uid] = { day, period: p, locked: false };
              addToIdxLocal(uid, uit, placements[uid], idx);
              break outer3;
            }
            for (const b1 of b1Set) {
              if (!b1 || fixedLocked.has(b1) || !placements[b1]) continue;
              const b1it = state.items[b1]; if (!b1it) continue;
              const b1plc = placements[b1];
              placements[b1] = null; removeFromIdx(b1, b1it, b1plc, idx);
              if (!canPlace(uid, uit, day, p, idx)) { placements[b1] = b1plc; addToIdxLocal(b1, b1it, b1plc, idx); continue; }
              // try placing B1 somewhere (depth-2 logic)
              let b1done = false;
              const b1span = b1it.span || 1;
              for (const d2 of DAYS) {
                if (b1done) break;
                const mp2 = maxPeriod(d2);
                for (let p2 = 1; p2 <= mp2; p2++) {
                  if (b1span === 2 && p2 === mp2) continue;
                  if (canPlace(b1, b1it, d2, p2, idx)) {
                    placements[b1] = { day: d2, period: p2, locked: false }; addToIdxLocal(b1, b1it, placements[b1], idx);
                    b1done = true; break;
                  }
                  // depth-3: B1 needs to displace B2, B2 displaces B3
                  const b2Set = new Set();
                  for (let dp2 = 0; dp2 < b1span; dp2++) {
                    const pp2 = p2 + dp2;
                    for (const t of b1it.teas || []) (idx.tea?.[t]?.[d2]?.[pp2] || []).forEach(x => b2Set.add(x));
                    for (const c of b1it.cls || []) (idx.cls?.[c]?.[d2]?.[pp2] || []).forEach(x => b2Set.add(x));
                  }
                  for (const b2 of b2Set) {
                    if (!b2 || fixedLocked.has(b2) || !placements[b2] || b2 === b1) continue;
                    const b2it = state.items[b2]; if (!b2it) continue;
                    const b2plc = placements[b2];
                    placements[b2] = null; removeFromIdx(b2, b2it, b2plc, idx);
                    if (!canPlace(b1, b1it, d2, p2, idx)) { placements[b2] = b2plc; addToIdxLocal(b2, b2it, b2plc, idx); continue; }
                    // try placing B2 somewhere
                    const b2span = b2it.span || 1;
                    let b2done = false;
                    for (const d3 of DAYS) {
                      if (b2done) break;
                      const mp3 = maxPeriod(d3);
                      for (let p3 = 1; p3 <= mp3; p3++) {
                        if (b2span === 2 && p3 === mp3) continue;
                        if (canPlace(b2, b2it, d3, p3, idx)) {
                          placements[b2] = { day: d3, period: p3, locked: false }; addToIdxLocal(b2, b2it, placements[b2], idx);
                          b2done = true; break;
                        }
                      }
                    }
                    if (b2done) {
                      placements[b1] = { day: d2, period: p2, locked: false }; addToIdxLocal(b1, b1it, placements[b1], idx);
                      b1done = true; break;
                    }
                    placements[b2] = b2plc; addToIdxLocal(b2, b2it, b2plc, idx);
                  }
                  if (b1done) break;
                }
              }
              if (b1done) {
                placements[uid] = { day, period: p, locked: false }; addToIdxLocal(uid, uit, placements[uid], idx);
                break outer3;
              }
              placements[b1] = b1plc; addToIdxLocal(b1, b1it, b1plc, idx);
            }
          }
        }
      }
    }

    // ── ソフト最適化ローカルサーチ ──
    // 全コマ配置後（remain=0）にソフト制約（連続教科・時間帯偏り）を局所探索で改善
    function softOptSwap(placements, idx, allItemIds, fixedLocked) {
      const movable = allItemIds.filter(id => placements[id] && !fixedLocked.has(id));
      const softScore = () => totalSoft(placements).score;
      let curScore = softScore();
      const MAX_ITERS = Math.min(200, movable.length * 3);
      for (let iter = 0; iter < MAX_ITERS; iter++) {
        // Pick 2 random movable items and try swapping their slots
        const i1 = Math.floor(Math.random() * movable.length);
        let i2 = Math.floor(Math.random() * (movable.length - 1));
        if (i2 >= i1) i2++;
        const id1 = movable[i1], id2 = movable[i2];
        const plc1 = placements[id1], plc2 = placements[id2];
        if (!plc1 || !plc2) continue;
        const it1 = state.items[id1], it2 = state.items[id2];
        if (!it1 || !it2) continue;
        // Tentative swap (check feasibility)
        placements[id1] = null; placements[id2] = null;
        removeFromIdx(id1, it1, plc1, idx); removeFromIdx(id2, it2, plc2, idx);
        const ok1 = canPlace(id1, it1, plc2.day, plc2.period, idx);
        const ok2 = canPlace(id2, it2, plc1.day, plc1.period, idx);
        if (ok1 && ok2) {
          const newPlc1 = { day: plc2.day, period: plc2.period, locked: false };
          const newPlc2 = { day: plc1.day, period: plc1.period, locked: false };
          placements[id1] = newPlc1; addToIdxLocal(id1, it1, newPlc1, idx);
          placements[id2] = newPlc2; addToIdxLocal(id2, it2, newPlc2, idx);
          const newScore = softScore();
          if (newScore < curScore) {
            curScore = newScore; // keep swap
          } else {
            // revert
            placements[id1] = null; placements[id2] = null;
            removeFromIdx(id1, it1, newPlc1, idx); removeFromIdx(id2, it2, newPlc2, idx);
            placements[id1] = plc1; addToIdxLocal(id1, it1, plc1, idx);
            placements[id2] = plc2; addToIdxLocal(id2, it2, plc2, idx);
          }
        } else {
          // restore
          placements[id1] = plc1; addToIdxLocal(id1, it1, plc1, idx);
          placements[id2] = plc2; addToIdxLocal(id2, it2, plc2, idx);
        }
      }
    }

    // ── ターゲット型シェイク ──
    // Identify placed items that block the most unplaced items; unplace those as priority
    function targetedShakeIds(unplacedIds, placements, prevIdx) {
      const blockCount = {}; // placed id → how many unplaced items it blocks
      for (const uid of unplacedIds) {
        if (placements[uid]) continue;
        const uit = state.items[uid]; if (!uit) continue;
        const uspan = uit.span || 1;
        const seen = new Set();
        for (const day of DAYS) {
          const maxP = maxPeriod(day);
          for (let p = 1; p <= maxP; p++) {
            if (uspan === 2 && p === maxP) continue;
            for (let dp = 0; dp < uspan; dp++) {
              const pp = p + dp;
              for (const t of uit.teas || []) (prevIdx?.tea?.[t]?.[day]?.[pp] || []).forEach(x => { if (!seen.has(x)) { seen.add(x); blockCount[x] = (blockCount[x] || 0) + 1; } });
              for (const c of uit.cls || []) (prevIdx?.cls?.[c]?.[day]?.[pp] || []).forEach(x => { if (!seen.has(x)) { seen.add(x); blockCount[x] = (blockCount[x] || 0) + 1; } });
            }
          }
        }
      }
      // Return top-K placed items sorted by block count
      return Object.entries(blockCount)
        .filter(([xid]) => placements[xid] && !placements[xid]?.locked)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([xid]) => xid);
    }

    // --- Run trials ---
    let best = null;
    let prevBestPlacements = null;

    const shuffled = (arr) => {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
      return a;
    };

    for (let t = 0; t < tries; t++) {
      // F5: 進捗更新（10試行ごと）
      if (t % 5 === 0) _setGreedyStatus(t, tries, best?.placed || 0, unplaced0.length);

      const placements = deepClone(basePlacements);

      // ターゲット型シェイク: 前回試行で未配置が残った場合、ブロッカーを優先的に外す
      if (t > 0 && prevBestPlacements && mode !== 'gentle') {
        const prevIdx = buildIdxFrom(prevBestPlacements);
        const prevUnplaced = unplaced0.filter(id => !prevBestPlacements[id]);
        if (prevUnplaced.length > 0) {
          const shakeIds = targetedShakeIds(prevUnplaced, prevBestPlacements, prevIdx);
          // shake targets + previously unplaced (already null in basePlacements so just target the blockers)
          for (const sid of shakeIds) { placements[sid] = null; }
          // also random shake to avoid getting stuck in same pattern
          if (mode === 'bold' && Math.random() < 0.4) {
            const movable = unplaced0.filter(id => placements[id] && !placements[id]?.locked);
            const extra = shuffled(movable).slice(0, 2 + Math.floor(Math.random() * 3));
            for (const eid of extra) placements[eid] = null;
          }
        }
      }

      const idx = buildIdxFrom(placements);
      const stats = buildDeptStats(placements);

      // フォワードチェック用データ構造を構築
      const currentUnplaced = unplaced.filter(id => !placements[id]);
      const { resItems, slotCnt } = buildFwdResItems(currentUnplaced, placements, idx);
      const useFwd = currentUnplaced.length <= 600; // large schedules: skip for speed

      // Max-Regret: 1位と2位スロットスコア差が大きいコマを優先（occupancy無視の構造的評価）
      const computeRegret = (xid) => {
        const xit = state.items[xid]; if (!xit) return 0;
        const xspan = xit.span || 1;
        const scores = [];
        for (const d of DAYS) {
          const mp = maxPeriod(d);
          for (let p = 1; p <= mp; p++) {
            if (xspan === 2 && p === mp) continue;
            let ok = true;
            for (let dp = 0; dp < xspan && ok; dp++) {
              if (isForbiddenForSubject(xit.subjKey, d, p + dp)) ok = false;
              for (const t of xit.teas || []) { if (isUnavailableForTeacher(t, d, p + dp)) { ok = false; break; } }
            }
            if (ok) scores.push(100 - Math.abs(timeScore(p)) * 0.5);
          }
        }
        if (scores.length < 2) return scores.length === 0 ? -999 : 999;
        scores.sort((a, b) => b - a);
        return scores[0] - scores[1]; // 後悔度: 大きいほど1位スロットが唯一的
      };

      // 動的MRV: 現在のoccupancyを考慮した配置可能スロット数
      const mrvCount = (xid, curIdx) => {
        const xit = state.items[xid]; if (!xit) return 999;
        let c = 0;
        for (const d of DAYS) { const mp = maxPeriod(d); for (let p = 1; p <= mp; p++) { if ((xit.span||1)===2&&p===mp) continue; if (canPlace(xid,xit,d,p,curIdx)) c++; } }
        return c;
      };

      // 初期順: ランダム性がある場合はシャッフル後にMax-Regret補正
      const orderArr = (rand > 0.15) ? shuffled(unplaced) : unplaced.slice();
      if (rand <= 0.15) {
        // deterministic: sort by hardness(desc) then regret(desc) as secondary
        orderArr.sort((a, b) => {
          const hDiff = hardness(b) - hardness(a);
          if (Math.abs(hDiff) > 5) return hDiff;
          return computeRegret(b) - computeRegret(a);
        });
      }

      let greedyPlacedCnt = 0;
      let orderPos = 0;
      while (orderPos < orderArr.length) {
        const id = orderArr[orderPos++];
        if (placements[id]) continue;
        const it = state.items[id]; if (!it) continue;
        const cands = [];
        for (const day of DAYS) {
          const maxP = maxPeriod(day);
          for (let p = 1; p <= maxP; p++) {
            if ((it.span || 1) === 2 && p === maxP) continue;
            if (!canPlace(id, it, day, p, idx)) continue;
            let sc = scoreCandidate(id, it, day, p, idx, stats);
            // フォワードチェック: 他コマの配置可能枠が0になる選択を避ける
            if (useFwd) sc -= fwdPenalty(id, it, day, p, placements, idx, resItems, slotCnt);
            cands.push({ day, period: p, score: sc });
          }
        }
        if (!cands.length) continue;
        const pick = chooseCandidate(cands, rand);
        placements[id] = { day: pick.day, period: pick.period, locked: false };
        addToIdxLocal(id, it, placements[id], idx);
        if (useFwd) updateFwdAfterPlace(id, it, pick.day, pick.period, placements, idx, resItems, slotCnt);
        const dept = deptOf(it);
        if (dept) {
          if (!stats.clsDept) stats.clsDept = {};
          for (const c of it.cls || []) {
            if (!stats.clsDept[c]) stats.clsDept[c] = {};
            if (!stats.clsDept[c][dept]) stats.clsDept[c][dept] = { sum: 0, cnt: 0 };
            const st = stats.clsDept[c][dept];
            const span = it.span || 1;
            for (let dp = 0; dp < span; dp++) { const p = pick.period + dp; st.sum += timeScore(p); st.cnt += 1; }
          }
        }
        greedyPlacedCnt++;

        // 動的MRV再ソート: 20コマ配置ごとに残りをスロット数の少ない順に再ソート
        if (greedyPlacedCnt % 20 === 0 && orderPos < orderArr.length) {
          const rem = orderArr.slice(orderPos).filter(xid => !placements[xid]);
          if (rem.length > 1) {
            rem.sort((a, b) => mrvCount(a, idx) - mrvCount(b, idx));
            let ri = 0;
            for (let oi = orderPos; oi < orderArr.length; oi++) {
              if (ri < rem.length) orderArr[oi] = rem[ri++];
            }
          }
        }
      }

      // 深度2→3連鎖スワップで残った未配置コマを修復
      const fixedLocked = new Set([...fixedIds, ...allIds.filter(id => placements[id]?.locked)]);
      const stillUnplaced = unplaced0.filter(id => !placements[id]);
      if (stillUnplaced.length > 0 && stillUnplaced.length <= 30) {
        chainRepair(stillUnplaced, placements, idx, fixedLocked);
      }
      // 深度3修復: 残りが少ない場合にのみ重い探索を実行
      const stillUnplaced3 = unplaced0.filter(id => !placements[id]);
      if (stillUnplaced3.length > 0 && stillUnplaced3.length <= 8) {
        chainRepairDepth3(stillUnplaced3, placements, idx, fixedLocked);
      }

      // ソフト最適化ローカルサーチ: 全コマ配置後に制約違反を軽減
      const remainAfterRepair = unplaced0.filter(id => !placements[id]).length;
      if (remainAfterRepair === 0 && (optBalance || optNoConsec)) {
        softOptSwap(placements, idx, unplaced0, fixedLocked);
      }

      const remain = unplaced0.filter(id => !placements[id]).length;
      const soft = totalSoft(placements);
      const key = { remain, soft: soft.score, bias: soft.bias, consec: soft.consec, placed: unplaced0.length - remain };

      if (!best || key.remain < best.key.remain ||
        (key.remain === best.key.remain && key.soft < best.key.soft) ||
        (key.remain === best.key.remain && key.soft === best.key.soft && key.placed > best.key.placed)) {
        best = { placements, key };
      }
      prevBestPlacements = placements;
      if (best && best.key.remain === 0 && best.key.soft < 2) break;
    }

    if (!best) { flash('AI配置失敗'); return; }

    // Fix 7: Remove any double-stacks in the best placements before applying
    // Build final index and clear any conflicting items (keep first placed, clear others)
    {
      const finalIdx = { tea: {}, cls: {}, room: {} };
      const toUnplace = new Set();
      for (const id of unplaced0) {
        const plc = best.placements[id];
        if (!plc) continue;
        const it = state.items[id]; if (!it) continue;
        const span = it.span || 1;
        let conflict = false;
        for (let dp = 0; dp < span && !conflict; dp++) {
          const pp = plc.period + dp;
          for (const t of it.teas || []) {
            if ((finalIdx.tea?.[t]?.[plc.day]?.[pp] || []).length) { conflict = true; break; }
          }
          for (const c of it.cls || []) {
            if ((finalIdx.cls?.[c]?.[plc.day]?.[pp] || []).length) { conflict = true; break; }
          }
        }
        if (conflict) { toUnplace.add(id); continue; }
        // Register in finalIdx
        for (let dp = 0; dp < span; dp++) {
          const pp = plc.period + dp;
          const add = (type, key) => { if (!finalIdx[type][key]) finalIdx[type][key] = {}; if (!finalIdx[type][key][plc.day]) finalIdx[type][key][plc.day] = {}; if (!finalIdx[type][key][plc.day][pp]) finalIdx[type][key][plc.day][pp] = []; finalIdx[type][key][plc.day][pp].push(id); };
          for (const t of it.teas || []) add('tea', t);
          for (const c of it.cls || []) add('cls', c);
        }
      }
      for (const id of toUnplace) best.placements[id] = null;
    }

    // Apply best to real state (only for previously unplaced to avoid surprises)
    pushHistory('ai');
    for (const id of unplaced0) {
      if (best.placements[id]) state.placements[id] = best.placements[id];
    }
    invalidateIndex();
    markDirty('ai');
    rerenderAll();
    broadcastState();

    const s = best.key;
    const msg = `AI: 配置${s.placed}/${unplaced0.length} 残${s.remain} 偏り${s.bias.toFixed(1)} 連続${s.consec}`;
    flash(msg);
    const st = $('#ai-status'); if (st) st.textContent = msg;
  }

  /* ═══════════════════════════════════════════════════════════════
     v40.0 — 新最適化アルゴリズム群
     ・焼きなまし法 (Simulated Annealing)
     ・タブー探索 (Tabu Search)
     ・島モデル型集団探索 (Island Population)
     ─────────────────────────────────────────────────────────────
     共通ユーティリティ: buildAiCtx() で1回生成してアルゴリズム間で再利用
     フレーム予算内実行: 全アルゴリズムは同一 requestAnimationFrame ループで
                          交互に呼び出される→UIが固まらない
  ═══════════════════════════════════════════════════════════════ */

  /* ---------- 共通コンテキスト生成 ---------- */

  /* ═══════════════════════════════════════════════
     v40: AI探索ログパネル
     ═══════════════════════════════════════════════ */
  function ensureAiLogPanel() {
    let panel = document.getElementById('ai-log-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'ai-log-panel';
      panel.className = 'ai-log-panel';
      panel.innerHTML = `
      <div class="ai-log-header">
        <span>🔍 AI探索ログ</span>
        <div style="display:flex;gap:6px;align-items:center">
          <label style="font-size:11px;color:#94a3b8;cursor:pointer">
            <input type="checkbox" id="ai-debug-chk"> デバッグ出力
          </label>
          <button id="ai-log-clear" style="font-size:10px;padding:2px 6px;background:#334155;color:#cbd5e1;border:none;border-radius:4px;cursor:pointer">クリア</button>
          <button id="ai-log-close" style="background:none;border:none;color:#94a3b8;cursor:pointer;font-size:14px">✕</button>
        </div>
      </div>
      <div id="ai-log-body" class="ai-log-body"></div>
    `;
      document.body.appendChild(panel);
      document.getElementById('ai-log-close').onclick = () => panel.classList.remove('visible');
      document.getElementById('ai-log-clear').onclick = () => { const b = document.getElementById('ai-log-body'); if (b) b.innerHTML = ''; };
      document.getElementById('ai-debug-chk').onchange = (e) => { window._aiDebug = e.target.checked; };
    }
    panel.classList.add('visible');
    return panel;
  }

  function updateAiLogPanel(aiLog) {
    const body = document.getElementById('ai-log-body');
    if (!body) return;
    // 最新5件だけ表示（高速）
    const recent = aiLog.slice(-5);
    const html = recent.map(e => {
      const extra = Object.entries(e)
        .filter(([k]) => !['t', 'trial', 'msg'].includes(k))
        .map(([k, v]) => `${k}:${typeof v === 'number' ? v.toFixed ? v.toFixed(1) : v : v}`)
        .join(' ');
      return `<div class="ai-log-entry"><span class="ai-log-t">${e.t}ms</span><span class="ai-log-trial">#${e.trial}</span><span class="ai-log-msg">${e.msg}</span>${extra ? `<span class="ai-log-extra">${extra}</span>` : ''}</div>`;
    }).join('');
    body.innerHTML = html;
  }

  function finalizeAiLog(aiLog, algoName, totalTrials, elapsedMs) {
    const body = document.getElementById('ai-log-body');
    if (!body) return;
    const summary = `<div class="ai-log-summary">${algoName} | ${totalTrials}試行 | ${(elapsedMs / 1000).toFixed(1)}s | ログ${aiLog.length}件</div>`;
    const all = aiLog.map(e => {
      const extra = Object.entries(e).filter(([k]) => !['t', 'trial', 'msg'].includes(k))
        .map(([k, v]) => `${k}=${typeof v === 'number' && v.toFixed ? v.toFixed(2) : v}`).join(' ');
      return `<div class="ai-log-entry"><span class="ai-log-t">${e.t}ms</span><span class="ai-log-trial">#${e.trial}</span><span class="ai-log-msg">${e.msg}</span>${extra ? `<span class="ai-log-extra">${extra}</span>` : ''}</div>`;
    }).join('');
    body.innerHTML = summary + all;
    body.scrollTop = body.scrollHeight;
  }

  function buildAiCtx(basePlacements) {
    const optBalance = !!$('#ai-balance')?.checked;
    const optNoConsec = !!$('#ai-noconsec')?.checked;
    const allIds = Object.keys(state.items);
    const fixedLocked = new Set(allIds.filter(id => basePlacements[id]?.locked));
    const deptOf = (it) => (state.subjectCfg[it?.subjKey]?.dept || '');
    const timeScore = (p) => (p === 1 ? -2 : p === 2 ? -1 : p === 3 ? 0 : p === 4 ? 0 : p === 5 ? 1 : p === 6 ? 2 : 3);

    /* 全候補スロット (item→[{day,period}]) をキャッシュ */
    const validSlotsCache = {};
    for (const id of allIds) {
      const it = state.items[id]; if (!it) continue;
      const span = it.span || 1;
      const slots = [];
      for (const day of DAYS) {
        const maxP = maxPeriod(day);
        for (let p = 1; p <= maxP; p++) {
          if (span === 2 && p === maxP) continue;
          let ok = true;
          for (let dp = 0; dp < span && ok; dp++) {
            const pp = p + dp;
            if (isForbiddenForSubject(it.subjKey, day, pp)) { ok = false; break; }
            for (const t of it.teas || []) { if (isUnavailableForTeacher(t, day, pp)) { ok = false; break; } }
          }
          if (ok) slots.push({ day, period: p });
        }
      }
      validSlotsCache[id] = slots;
    }

    /* 教員1日上限違反数を返す（ユニーク授業コマ単位） */
    function countTeacherDailyMaxVio(idx) {
      let v = 0;
      for (const tea in idx.tea) {
        const maxD = teacherDailyMax(tea);
        if (maxD == null) continue;
        for (const day of DAYS) {
          const dayMap = idx.tea[tea]?.[day]; if (!dayMap) continue;
          const items = new Set();
          for (const p in dayMap) { for (const id of (dayMap[p] || [])) items.add(id); }
          if (items.size > maxD) v += (items.size - maxD);
        }
      }
      return v;
    }

    /* 配置の衝突コスト
       total = hard×100000 + remain×50000 + soft
       この重みで lexicographic: vio > remain > soft を数値的に表現 */
    function evalPlacement(placements) {
      const idx = buildIdxFromPlacements(placements);
      // hard: 重複 + 教員1日上限超過
      let hard = 0;
      const ct = (map) => { for (const k in map) for (const d in map[k]) for (const p in map[k][d]) { const a = map[k][d][p]; if (a.length > 1) hard += a.length - 1; } };
      ct(idx.tea); ct(idx.cls); if (state.settings.roomConflict) ct(idx.room);
      hard += countTeacherDailyMaxVio(idx);
      // soft: 偏り+連続
      const sm = softMetricsFromPlacements(placements, optBalance, optNoConsec);
      const remain = allIds.filter(id => !placements[id]).length;
      return {
        hard, soft: sm.score, bias: sm.bias, consec: sm.consec, remain,
        total: hard * 100000 + remain * aiRemainWeight() + sm.score
      };
    }

    /* 移動操作: コマid を (day,period) に移動した新placements（shallow clone） */
    function movePlacement(placements, id, day, period) {
      const next = Object.assign({}, placements);
      next[id] = placements[id]
        ? Object.assign({}, placements[id], { day, period })
        : { day, period, locked: false };
      return next;
    }

    /* 衝突しているitem IDセットを返す */
    function findConflictedIds(placements) {
      const idx = buildIdxFromPlacements(placements);
      const conflicted = new Set();
      const scanMap = (map) => {
        for (const k in map) for (const d in map[k]) for (const p in map[k][d]) {
          const a = map[k][d][p];
          if (a.length > 1) { for (const x of a) conflicted.add(x); }
        }
      };
      scanMap(idx.tea); scanMap(idx.cls);
      if (state.settings.roomConflict) scanMap(idx.room);
      return conflicted;
    }

    /* ランダムな移動候補を生成 (swap or relocate) — 違反コマを70%優先 */
    function randomNeighbor(placements) {
      const movable = allIds.filter(id => placements[id] && !placements[id].locked);
      if (!movable.length) return null;

      // 70%の確率で違反中のコマを優先選択
      let id;
      const conflicted = findConflictedIds(placements);
      const conflictedMovable = movable.filter(x => conflicted.has(x));
      if (conflictedMovable.length && Math.random() < 0.70) {
        id = conflictedMovable[Math.floor(Math.random() * conflictedMovable.length)];
      } else {
        id = movable[Math.floor(Math.random() * movable.length)];
      }

      const slots = validSlotsCache[id];
      if (!slots.length) return null;
      const slot = slots[Math.floor(Math.random() * slots.length)];
      const r = Math.random();
      // 40%でswap（別コマと交換）
      if (r < 0.40) {
        const others = allIds.filter(x => x !== id && placements[x] && !placements[x].locked);
        if (others.length) {
          const other = others[Math.floor(Math.random() * others.length)];
          if (validSlotsCache[other].length) {
            const next = Object.assign({}, placements);
            const curPlc = placements[id]; const otherPlc = placements[other];
            next[id] = Object.assign({}, otherPlc);
            next[other] = Object.assign({}, curPlc);
            return { placements: next, op: 'swap', id, other };
          }
        }
      }
      // 15%でOR-opt 3コマ同時移動（連続コマの挿入移動）
      if (r < 0.55 && movable.length >= 3) {
        const others2 = movable.filter(x => x !== id);
        if (others2.length >= 2) {
          const id2 = others2[Math.floor(Math.random() * others2.length)];
          const id3 = others2.filter(x => x !== id2)[Math.floor(Math.random() * (others2.length - 1))];
          const sl2 = validSlotsCache[id2]; const sl3 = validSlotsCache[id3];
          if (sl2.length && sl3.length) {
            const next = Object.assign({}, placements);
            // rotate: id→slot of id2, id2→slot of id3, id3→slot of id
            next[id] = Object.assign({}, placements[id2]);
            next[id2] = Object.assign({}, placements[id3]);
            next[id3] = Object.assign({}, placements[id]);
            return { placements: next, op: 'oropt3', id, id2, id3 };
          }
        }
      }
      const next = movePlacement(placements, id, slot.day, slot.period);
      return { placements: next, op: 'move', id, day: slot.day, period: slot.period };
    }

    return { allIds, fixedLocked, validSlotsCache, deptOf, timeScore, evalPlacement, movePlacement, randomNeighbor, findConflictedIds, optBalance, optNoConsec };
  }

  /* ═══════════════════════════════════════════════════════
     LNS (Large Neighborhood Search) — 衝突ターゲット破壊+再修復
     ─────────────────────────────────────────────────────
     1. 衝突しているコマ + 近傍コマを破壊（unplace）
     2. MRVで並べ替えてgreedyで再配置（repair）
     これをstep毎に繰り返し、bestより良ければ採用
     ═══════════════════════════════════════════════════════ */
  function initLNSState(basePlacements, ctx) {
    const ev = ctx.evalPlacement(basePlacements);
    return {
      placements: Object.assign({}, basePlacements),
      bestPlacements: Object.assign({}, basePlacements),
      cost: ev.total, bestCost: ev.total,
      eval: ev, bestEval: ev,
      step: 0, improved: false,
      // 適応型破壊サイズ
      destroyMult: 1.0, noImproveSteps: 0,
    };
  }

  function aiLNSStep(lnsState, ctx) {
    const { allIds, fixedLocked, validSlotsCache } = ctx;
    const placements = Object.assign({}, lnsState.placements);

    // 1. 衝突しているコマを特定
    const conflicted = ctx.findConflictedIds(placements);
    const movable = allIds.filter(id => placements[id] && !fixedLocked.has(id));
    if (!movable.length) return;

    // 2. 破壊するコマを選択: 衝突コマ + ランダムな追加コマ
    const destroySet = new Set();
    for (const id of conflicted) {
      if (!fixedLocked.has(id)) destroySet.add(id);
    }
    // 適応型破壊サイズ: 改善停滞時は大きく、改善中は小さく
    lnsState.noImproveSteps++;
    if (lnsState.improved) { lnsState.destroyMult = Math.max(0.6, lnsState.destroyMult * 0.85); lnsState.noImproveSteps = 0; }
    else if (lnsState.noImproveSteps > 8) { lnsState.destroyMult = Math.min(2.5, lnsState.destroyMult * 1.2); lnsState.noImproveSteps = 0; }
    // 衝突がない場合は完全ランダム破壊
    const baseDestroySize = Math.max(3, Math.min(Math.ceil(movable.length * 0.15 * lnsState.destroyMult), 20));
    if (destroySet.size === 0) {
      const extra = shuffle(movable.slice()).slice(0, baseDestroySize);
      for (const id of extra) destroySet.add(id);
    } else {
      // 衝突コマの隣接コマも一部追加して多様化
      const extra = shuffle(movable.filter(id => !destroySet.has(id))).slice(0, Math.min(baseDestroySize, destroySet.size + 2));
      for (const id of extra) destroySet.add(id);
    }

    // 3. 破壊
    for (const id of destroySet) placements[id] = null;

    // 4. MRV順で貪欲再配置（occupancy込みの真のMRV）
    const toRepair = [...destroySet];
    const idx = buildIdxFromPlacements(placements);

    // occupancy込みで有効スロット数を数える
    const countValidWithOcc = (id) => {
      const it = state.items[id]; if (!it) return 999;
      const span = it.span || 1;
      let cnt = 0;
      for (const slot of (validSlotsCache[id] || [])) {
        const { day, period } = slot;
        let ok = true;
        for (let dp = 0; dp < span && ok; dp++) {
          const p = period + dp;
          for (const t of it.teas || []) {
            const occ = idx.tea?.[t]?.[day]?.[p] || [];
            if (it.parallel ? occ.some(x => !state.items[x]?.parallel) : occ.length) { ok = false; break; }
          }
          if (!ok) break;
          for (const c of it.cls || []) {
            const occ = idx.cls?.[c]?.[day]?.[p] || [];
            if (it.parallel ? occ.some(x => !state.items[x]?.parallel) : occ.length) { ok = false; break; }
          }
        }
        if (ok) cnt++;
      }
      return cnt;
    };

    toRepair.sort((a, b) => countValidWithOcc(a) - countValidWithOcc(b));

    // Pilot simulation: for a candidate (id placed at slot), greedily place next pilotN remaining items
    // Returns bonus score (placed - dead*3)
    const lnsPilotSim = (id, slot, pilotIds) => {
      const tmpIdx = { tea: {}, cls: {}, room: {} };
      // Clone relevant parts of idx (only keys touched by remaining items)
      for (const xid of [id, ...pilotIds]) {
        const xit = state.items[xid]; if (!xit) continue;
        for (const t of xit.teas || []) {
          if (idx.tea[t]) tmpIdx.tea[t] = JSON.parse(JSON.stringify(idx.tea[t]));
        }
        for (const c of xit.cls || []) {
          if (idx.cls[c]) tmpIdx.cls[c] = JSON.parse(JSON.stringify(idx.cls[c]));
        }
      }
      const tmpAdd = (xid, xit, xday, xp) => {
        const xspan = xit.span || 1;
        for (let dp = 0; dp < xspan; dp++) {
          const pp = xp + dp;
          for (const t of xit.teas || []) {
            if (!tmpIdx.tea[t]) tmpIdx.tea[t] = {};
            if (!tmpIdx.tea[t][xday]) tmpIdx.tea[t][xday] = {};
            if (!tmpIdx.tea[t][xday][pp]) tmpIdx.tea[t][xday][pp] = [];
            tmpIdx.tea[t][xday][pp].push(xid);
          }
          for (const c of xit.cls || []) {
            if (!tmpIdx.cls[c]) tmpIdx.cls[c] = {};
            if (!tmpIdx.cls[c][xday]) tmpIdx.cls[c][xday] = {};
            if (!tmpIdx.cls[c][xday][pp]) tmpIdx.cls[c][xday][pp] = [];
            tmpIdx.cls[c][xday][pp].push(xid);
          }
        }
      };
      // Place the candidate
      tmpAdd(id, state.items[id], slot.day, slot.period);
      let placed = 0, dead = 0;
      for (const pid of pilotIds) {
        const pit = state.items[pid]; if (!pit) continue;
        const pspan = pit.span || 1;
        let bestSlotP = null, bestMRV = Infinity;
        for (const pslot of (validSlotsCache[pid] || [])) {
          let ok = true;
          for (let dp = 0; dp < pspan && ok; dp++) {
            const pp = pslot.period + dp;
            for (const t of pit.teas || []) {
              const occ = tmpIdx.tea?.[t]?.[pslot.day]?.[pp] || [];
              if (pit.parallel ? occ.some(x => !state.items[x]?.parallel) : occ.length) { ok = false; break; }
            }
            if (!ok) break;
            for (const c of pit.cls || []) {
              const occ = tmpIdx.cls?.[c]?.[pslot.day]?.[pp] || [];
              if (pit.parallel ? occ.some(x => !state.items[x]?.parallel) : occ.length) { ok = false; break; }
            }
          }
          if (ok) { bestSlotP = pslot; break; } // take first valid slot (already MRV sorted)
        }
        if (bestSlotP) { tmpAdd(pid, pit, bestSlotP.day, bestSlotP.period); placed++; }
        else dead++;
      }
      return placed - dead * 3;
    };

    const placedSet = new Set(); // track repaired ids for pilot lookback
    for (let ri = 0; ri < toRepair.length; ri++) {
      const id = toRepair[ri];
      const it = state.items[id]; if (!it) continue;
      const span = it.span || 1;

      // Collect valid slots
      const validSlots = [];
      for (const slot of (validSlotsCache[id] || [])) {
        const { day, period } = slot;
        let conflict = false;
        for (let dp = 0; dp < span && !conflict; dp++) {
          const p = period + dp;
          for (const t of it.teas || []) {
            const occ = idx.tea?.[t]?.[day]?.[p] || [];
            if (it.parallel ? occ.some(x => !state.items[x]?.parallel) : occ.length) { conflict = true; break; }
          }
          if (conflict) break;
          for (const c of it.cls || []) {
            const occ = idx.cls?.[c]?.[day]?.[p] || [];
            if (it.parallel ? occ.some(x => !state.items[x]?.parallel) : occ.length) { conflict = true; break; }
          }
        }
        if (!conflict) validSlots.push(slot);
      }
      if (!validSlots.length) continue;

      // Pilot lookahead: score top-K slots by simulating next 3 remaining repairs
      const PILOT_K = Math.min(6, validSlots.length);
      const pilotAhead = toRepair.slice(ri + 1, ri + 4); // next 3 items to repair
      let bestSlot = validSlots[0], bestPilot = -Infinity;
      for (let ki = 0; ki < PILOT_K; ki++) {
        const slot = validSlots[ki];
        const baseScore = -ctx.timeScore(slot.period); // prefer early periods (lower timeScore = better)
        const pilotBonus = pilotAhead.length > 0 ? lnsPilotSim(id, slot, pilotAhead) : 0;
        const total = baseScore + pilotBonus;
        if (total > bestPilot) { bestPilot = total; bestSlot = slot; }
      }

      placements[id] = { day: bestSlot.day, period: bestSlot.period, locked: false };
      placedSet.add(id);
      // インデックス更新
      for (let dp = 0; dp < span; dp++) {
        const p = bestSlot.period + dp;
        for (const t of it.teas || []) {
          if (!idx.tea[t]) idx.tea[t] = {};
          if (!idx.tea[t][bestSlot.day]) idx.tea[t][bestSlot.day] = {};
          if (!idx.tea[t][bestSlot.day][p]) idx.tea[t][bestSlot.day][p] = [];
          idx.tea[t][bestSlot.day][p].push(id);
        }
        for (const c of it.cls || []) {
          if (!idx.cls[c]) idx.cls[c] = {};
          if (!idx.cls[c][bestSlot.day]) idx.cls[c][bestSlot.day] = {};
          if (!idx.cls[c][bestSlot.day][p]) idx.cls[c][bestSlot.day][p] = [];
          idx.cls[c][bestSlot.day][p].push(id);
        }
      }
    }

    const ev = ctx.evalPlacement(placements);
    // total は hard×100000 + remain×50000 + soft なので total比較で十分
    if (ev.total < lnsState.cost) {
      lnsState.placements = placements;
      lnsState.cost = ev.total;
      lnsState.eval = ev;
    }
    if (ev.total < lnsState.bestCost) {
      lnsState.bestPlacements = placements;
      lnsState.bestCost = ev.total;
      lnsState.bestEval = ev;
      lnsState.improved = true;
    }
    lnsState.step++;
  }

  /* ══════════════════════════════════════════════════
     アルゴリズム① 焼きなまし法 (Simulated Annealing)
     ══════════════════════════════════════════════════ */
  function aiSAStep(saState, ctx) {
    /* 1ステップ進める。saState は可変オブジェクト（外部で保持） */
    const neighbor = ctx.randomNeighbor(saState.placements);
    if (!neighbor) return;

    const curCost = saState.cost;
    const newEval = ctx.evalPlacement(neighbor.placements);
    const newCost = newEval.total;
    const delta = newCost - curCost;
    const T = saState.T;

    // Metropolis criterion
    if (delta <= 0 || Math.random() < Math.exp(-delta / T)) {
      saState.placements = neighbor.placements;
      saState.cost = newCost;
      saState.eval = newEval;
      if (newCost < saState.bestCost) {
        saState.bestPlacements = neighbor.placements;
        saState.bestCost = newCost;
        saState.bestEval = newEval;
        saState.improved = true;
      }
    }
    // 冷却
    saState.T *= saState.alpha;
    saState.step++;
  }

  function initSAState(placements, ctx) {
    const ev = ctx.evalPlacement(placements);
    const itemCount = Object.keys(state.items).length;
    const T0 = Math.max(60, Math.min(400, itemCount * 1.2));
    const alpha = itemCount > 200 ? 0.9998 : itemCount > 100 ? 0.9996 : 0.9993;
    return {
      placements: Object.assign({}, placements),
      bestPlacements: Object.assign({}, placements),
      cost: ev.total, bestCost: ev.total,
      eval: ev, bestEval: ev,
      T: T0,     // 初期温度（問題サイズに応じて自動調整）
      alpha,     // 冷却率（問題サイズに応じて自動調整）
      step: 0,
      improved: false,
    };
  }

  /* ═══════════════════════════════════════════════
     アルゴリズム② タブー探索 (Tabu Search)
     ═══════════════════════════════════════════════ */
  function initTabuState(placements, ctx) {
    const ev = ctx.evalPlacement(placements);
    return {
      placements: Object.assign({}, placements),
      bestPlacements: Object.assign({}, placements),
      cost: ev.total, bestCost: ev.total,
      eval: ev, bestEval: ev,
      tabuList: [],   // [{key}] 最近行った移動
      tabuLen: 15,    // タブー任期
      step: 0,
      improved: false,
    };
  }

  function aiTabuStep(tabuState, ctx) {
    const { placements, tabuList, tabuLen } = tabuState;
    const movable = ctx.allIds.filter(id => placements[id] && !placements[id].locked);
    if (!movable.length) return;

    // 近傍候補を複数生成（beam=10）して最良の非タブー解を選ぶ
    const BEAM = 10;
    const candidates = [];
    for (let k = 0; k < BEAM * 3; k++) {
      const n = ctx.randomNeighbor(placements);
      if (!n) continue;
      const key = n.op === 'swap'
        ? `sw:${[n.id, n.other].sort().join('|')}`
        : `mv:${n.id}:${n.day}:${n.period}`;
      const isTabu = tabuList.includes(key);
      const ev = ctx.evalPlacement(n.placements);
      candidates.push({ ...n, key, isTabu, ev, cost: ev.total });
      if (candidates.length >= BEAM) break;
    }
    if (!candidates.length) return;

    candidates.sort((a, b) => a.cost - b.cost);
    // aspiration: タブーでも best より良ければ採用
    const pick = candidates.find(c => !c.isTabu || c.cost < tabuState.bestCost)
      || candidates[0];

    tabuState.placements = pick.placements;
    tabuState.cost = pick.cost;
    tabuState.eval = pick.ev;
    tabuList.push(pick.key);
    while (tabuList.length > tabuLen) tabuList.shift();

    if (pick.cost < tabuState.bestCost) {
      tabuState.bestPlacements = pick.placements;
      tabuState.bestCost = pick.cost;
      tabuState.bestEval = pick.ev;
      tabuState.improved = true;
    }
    tabuState.step++;
  }

  /* ═══════════════════════════════════════════════
     アルゴリズム③ 島モデル型集団探索 (Island Population)
     各"島"は独立した焼きなましで、定期的に最良解を交換する
     ═══════════════════════════════════════════════ */
  const ISLAND_COUNT = 4;

  function initIslandState(basePlacements, ctx) {
    const islands = [];
    for (let i = 0; i < ISLAND_COUNT; i++) {
      // 各島を微妙に異なる初期解で始める（destroy-repairを1回適用）
      const startPlacements = Object.assign({}, basePlacements);
      const movable = ctx.allIds.filter(id => startPlacements[id] && !startPlacements[id].locked);
      // island i に応じてランダムに i+1 コマを動かして多様性を持たせる
      const shakeK = Math.min(i + 1, movable.length);
      const shaken = shuffle(movable.slice()).slice(0, shakeK);
      for (const id of shaken) {
        const slots = ctx.validSlotsCache[id];
        if (slots.length) {
          const sl = slots[Math.floor(Math.random() * slots.length)];
          startPlacements[id] = { day: sl.day, period: sl.period, locked: false };
        }
      }
      islands.push(initSAState(startPlacements, ctx));
    }
    return {
      islands, step: 0, migrationInterval: 200, improved: false,
      bestPlacements: Object.assign({}, basePlacements),
      bestCost: ctx.evalPlacement(basePlacements).total,
      bestEval: ctx.evalPlacement(basePlacements)
    };
  }

  function aiIslandStep(islandState, ctx) {
    // 各島を1ステップ進める
    for (const island of islandState.islands) {
      aiSAStep(island, ctx);
      if (island.bestCost < islandState.bestCost) {
        islandState.bestCost = island.bestCost;
        islandState.bestPlacements = island.bestPlacements;
        islandState.bestEval = island.bestEval;
        islandState.improved = true;
      }
    }
    islandState.step++;

    // 定期的に移住: 最良島の解を最悪島に移植
    if (islandState.step % islandState.migrationInterval === 0) {
      const sorted = [...islandState.islands].sort((a, b) => a.bestCost - b.bestCost);
      const best = sorted[0];
      const worst = sorted[sorted.length - 1];
      // worst島を best の最良解から再初期化（+微shake）
      const migPlacements = Object.assign({}, best.bestPlacements);
      const restartSA = initSAState(migPlacements, ctx);
      restartSA.T = 20; // 低温から再開（精細化フェーズ）
      Object.assign(worst, restartSA);
    }
  }



  /* ═══════════════════════════════════════════════════════
     v41.0 — 差分評価エンジン (DeltaEval)
     evalPlacement はO(n)で全indexを再構築していたが、
     DeltaEvalは移動した1〜2コマ分だけ差分計算 → O(k)
     ─────────────────────────────────────────────────────
     使い方:
       const dc = buildDeltaCtx(placements, ctx);
       const {deltaTotal} = dc.evalMove(id, day, period);  // O(k) 評価
       dc.applyMove(id, day, period);   // インクリメンタル更新
       dc.applySwap(id, otherId);
     ═══════════════════════════════════════════════════════ */
  function buildDeltaCtx(placements, ctx) {
    const allIds = ctx.allIds;
    const optBalance = ctx.optBalance;
    const optNoConsec = ctx.optNoConsec;

    // 1回だけ全indexを構築
    let idx = buildIdxFromPlacements(placements);

    // ── インデックス操作ヘルパー ──────────────────
    // 衝突総数(_conflT)をidx操作と同時に増分維持する（roomはroomConflict時のみ計上）
    const _roomConf = !!state.settings.roomConflict;
    const _remainW = aiRemainWeight(); // 探索中は不変（配置数維持モードの重み）
    let _conflT = 0, _dailyT = 0;
    function _del(type, key, day, p, id) {
      const arr = idx[type]?.[key]?.[day]?.[p]; if (!arr) return;
      const i = arr.indexOf(id); if (i < 0) return;
      const before = arr.length; arr.splice(i, 1);
      if (type !== 'room' || _roomConf) _conflT += (arr.length > 1 ? arr.length - 1 : 0) - (before > 1 ? before - 1 : 0);
    }
    function _add(type, key, day, p, id) {
      if (!idx[type][key]) idx[type][key] = {};
      if (!idx[type][key][day]) idx[type][key][day] = {};
      const cell = idx[type][key][day][p] || (idx[type][key][day][p] = []);
      const before = cell.length; cell.push(id);
      if (type !== 'room' || _roomConf) _conflT += (cell.length > 1 ? cell.length - 1 : 0) - (before > 1 ? before - 1 : 0);
    }
    function _removeFromIdx(id, plc) {
      if (!plc) return;
      const it = state.items[id]; if (!it) return;
      const span = it.span || 1;
      for (let dp = 0; dp < span; dp++) {
        const p = plc.period + dp;
        for (const t of it.teas || []) _del('tea', t, plc.day, p, id);
        for (const c of it.cls || []) _del('cls', c, plc.day, p, id);
        for (const r of it.rooms || []) _del('room', r, plc.day, p, id);
      }
    }
    function _addToIdx(id, plc) {
      if (!plc) return;
      const it = state.items[id]; if (!it) return;
      const span = it.span || 1;
      for (let dp = 0; dp < span; dp++) {
        const p = plc.period + dp;
        for (const t of it.teas || []) _add('tea', t, plc.day, p, id);
        for (const c of it.cls || []) _add('cls', c, plc.day, p, id);
        for (const r of it.rooms || []) _add('room', r, plc.day, p, id);
      }
    }

    // ── ハードコスト ──
    // 衝突総数(_conflT)は _add/_del で増分維持。教員1日上限(_dailyT)は
    // 影響する (教員,曜日) のみ再計算する。初期化時のみ全走査する。
    function _dailyVio(tea, day) {
      const maxD = teacherDailyMax(tea); if (maxD == null) return 0;
      const dayMap = idx.tea[tea]?.[day]; if (!dayMap) return 0;
      const items = new Set();
      for (const p in dayMap) { for (const id of (dayMap[p] || [])) items.add(id); }
      return items.size > maxD ? items.size - maxD : 0;
    }
    // 移動/入替で影響する (教員,曜日) の集合を "tea day" 形式で収集
    function _affectedTeaDays(ids) {
      const set = new Set();
      for (const { id, days } of ids) {
        const it = state.items[id]; if (!it) continue;
        for (const t of it.teas || []) for (const d of days) if (d) set.add(t + ' ' + d);
      }
      return set;
    }
    function _sumDaily(set) {
      let s = 0; for (const k of set) { const i = k.indexOf(' '); s += _dailyVio(k.slice(0, i), k.slice(i + 1)); } return s;
    }
    // 初期化: 全走査で _conflT, _dailyT を確定
    function _recomputeHardInit() {
      let conf = 0;
      const ct = (m, isRoom) => { if (isRoom && !_roomConf) return; for (const k in m) for (const d in m[k]) for (const p in m[k][d]) { const a = m[k][d][p]; if (a.length > 1) conf += a.length - 1; } };
      ct(idx.tea, false); ct(idx.cls, false); ct(idx.room, true);
      let daily = 0;
      for (const tea in idx.tea) { for (const day of DAYS) daily += _dailyVio(tea, day); }
      _conflT = conf; _dailyT = daily;
      return conf + daily;
    }

    // ── ソフトコスト: クラス単位(bias/consec/noSameDay)＋教員単位(空きコマ)をキャッシュし、影響分のみ再計算 ──
    const _itemsByClass = getItemsByClass();
    const _itemsByTea = getItemsByTeacher();
    const _gapOn = aiMinGapOn();
    const _balOn = aiBalanceLoadOn();
    const _teaOn = true; // 教員の連続授業ペナルティは常に有効なので教員単位の集計も常に行う
    const _scBias = {}, _scConsec = {}, _scNoSame = {}, _scGap = {}, _scBal = {}, _scRun = {};
    let _biasT = 0, _consecT = 0, _noSameT = 0, _gapT = 0, _balT = 0, _runT = 0;
    function _initSoftCaches() {
      _biasT = 0; _consecT = 0; _noSameT = 0; _gapT = 0; _balT = 0; _runT = 0;
      for (const c in _itemsByClass) {
        const r = classSoftContribution(placements, c, _itemsByClass[c]);
        _scBias[c] = r.bias; _scConsec[c] = r.consec; _scNoSame[c] = r.noSameDay;
        _biasT += r.bias; _consecT += r.consec; _noSameT += r.noSameDay;
      }
      if (_teaOn) for (const t in _itemsByTea) { const r = teacherSoftContribution(placements, t, _itemsByTea[t]); _scGap[t] = r.gap; _scBal[t] = r.balance; _scRun[t] = r.run; _gapT += r.gap; _balT += r.balance; _runT += r.run; }
      _peT = peFairPenalty(placements);
    }
    function _flaggedSoft() {
      return (optBalance ? _biasT : 0) + (optNoConsec ? _consecT * 4 : 0) + _noSameT
        + (_gapOn ? _gapT * TEACHER_GAP_W : 0) + (_balOn ? _balT * TEACHER_BAL_W : 0) + _runT * TEACHER_RUN_W + _peT * PE_FAIR_W;
    }
    let _peT = 0;
    function _updateSoftForClasses(classes) {
      _peT = peFairPenalty(placements);
      for (const c of classes) {
        const r = classSoftContribution(placements, c, _itemsByClass[c] || []);
        _biasT += r.bias - (_scBias[c] || 0);
        _consecT += r.consec - (_scConsec[c] || 0);
        _noSameT += r.noSameDay - (_scNoSame[c] || 0);
        _scBias[c] = r.bias; _scConsec[c] = r.consec; _scNoSame[c] = r.noSameDay;
      }
    }
    function _updateTeaSoftForTeachers(teas) {
      if (!_teaOn) return;
      for (const t of teas) {
        const r = teacherSoftContribution(placements, t, _itemsByTea[t] || []);
        _gapT += r.gap - (_scGap[t] || 0);
        _runT += r.run - (_scRun[t] || 0); _scRun[t] = r.run;
        _balT += r.balance - (_scBal[t] || 0);
        _scGap[t] = r.gap; _scBal[t] = r.balance;
      }
    }
    const _clsOf = (id) => (state.items[id]?.cls || []);
    const _teaOf = (id) => (state.items[id]?.teas || []);

    // ── 全コスト（初期・再同期用）total = hard×100000 + remain×50000 + soft ──
    function _fullCost() {
      _initSoftCaches();
      const h = _recomputeHardInit();
      const rem = allIds.filter(id => !placements[id]).length;
      const soft = _flaggedSoft();
      return { hard: h, soft, bias: _biasT, consec: _consecT, remain: rem, total: h * 100000 + rem * _remainW + soft };
    }

    let _cache = _fullCost();

    /* ── 差分評価: 影響クラスのソフトのみ再計算（ハードはO(セル数)）──── */
    function evalMove(id, newDay, newPeriod, swapId = null) {
      const it = state.items[id]; if (!it) return { deltaTotal: 1e9 };
      const oldPlc = placements[id];
      const swapOldPlc = swapId ? placements[swapId] : null;
      const newPlc = { day: newDay, period: newPeriod, locked: false };
      const newSwapPlc = swapId && oldPlc ? { day: oldPlc.day, period: oldPlc.period, locked: false } : null;

      // 影響する (教員,曜日) と現状の1日上限違反を先に確定
      const affTD = _affectedTeaDays([
        { id, days: [oldPlc && oldPlc.day, newDay] },
        ...(swapId ? [{ id: swapId, days: [swapOldPlc && swapOldPlc.day, oldPlc && oldPlc.day] }] : [])
      ]);
      const oldDaily = _sumDaily(affTD);

      // idx と placements を一時的に変更（_conflT は _add/_del が増分維持）
      _removeFromIdx(id, oldPlc);
      if (swapId && swapOldPlc) _removeFromIdx(swapId, swapOldPlc);
      _addToIdx(id, newPlc);
      if (swapId && newSwapPlc) _addToIdx(swapId, newSwapPlc);
      placements[id] = newPlc;
      if (swapId && newSwapPlc) placements[swapId] = newSwapPlc;

      const newHard = _conflT + _dailyT - oldDaily + _sumDaily(affTD);
      // 影響クラスのソフト差分
      const affected = new Set([..._clsOf(id), ...(swapId ? _clsOf(swapId) : [])]);
      let dB = 0, dC = 0, dN = 0;
      for (const c of affected) {
        const r = classSoftContribution(placements, c, _itemsByClass[c] || []);
        dB += r.bias - (_scBias[c] || 0);
        dC += r.consec - (_scConsec[c] || 0);
        dN += r.noSameDay - (_scNoSame[c] || 0);
      }
      // 影響教員の空きコマ・平準化差分
      let dG = 0, dBal = 0, dRun = 0;
      if (_teaOn) {
        const affTea = new Set([..._teaOf(id), ...(swapId ? _teaOf(swapId) : [])]);
        for (const t of affTea) { const r = teacherSoftContribution(placements, t, _itemsByTea[t] || []); dG += r.gap - (_scGap[t] || 0); dBal += r.balance - (_scBal[t] || 0); dRun += r.run - (_scRun[t] || 0); }
      }
      const newSoft = _flaggedSoft() + (optBalance ? dB : 0) + (optNoConsec ? dC * 4 : 0) + dN
        + (_gapOn ? dG * TEACHER_GAP_W : 0) + (_balOn ? dBal * TEACHER_BAL_W : 0) + dRun * TEACHER_RUN_W
        + (peFairPenalty(placements) - _peT) * PE_FAIR_W;
      const newTotal = newHard * 100000 + newSoft + _cache.remain * _remainW;

      // 元に戻す
      _removeFromIdx(id, newPlc);
      if (swapId && newSwapPlc) _removeFromIdx(swapId, newSwapPlc);
      _addToIdx(id, oldPlc);
      if (swapId && swapOldPlc) _addToIdx(swapId, swapOldPlc);
      placements[id] = oldPlc;
      if (swapId && swapOldPlc) placements[swapId] = swapOldPlc;

      return {
        hard: newHard, soft: newSoft, remain: _cache.remain, total: newTotal,
        deltaTotal: newTotal - _cache.total
      };
    }

    /* ── 移動を実際に適用 ──────────────────────────── */
    function applyMove(id, newDay, newPeriod) {
      const oldPlc = placements[id];
      const affTD = _affectedTeaDays([{ id, days: [oldPlc && oldPlc.day, newDay] }]);
      const oldDaily = _sumDaily(affTD);
      _removeFromIdx(id, oldPlc);
      const newPlc = { day: newDay, period: newPeriod, locked: false };
      placements[id] = newPlc;
      _addToIdx(id, newPlc);
      _dailyT += _sumDaily(affTD) - oldDaily;
      _updateSoftForClasses(_clsOf(id));
      _updateTeaSoftForTeachers(_teaOf(id));
      const h = _conflT + _dailyT;
      const soft = _flaggedSoft();
      _cache = { hard: h, soft, bias: _biasT, consec: _consecT, remain: _cache.remain, total: h * 100000 + _cache.remain * _remainW + soft };
    }
    function applySwap(id, swapId) {
      const a = placements[id], b = placements[swapId];
      if (!a || !b) return;
      const affTD = _affectedTeaDays([{ id, days: [a.day, b.day] }, { id: swapId, days: [b.day, a.day] }]);
      const oldDaily = _sumDaily(affTD);
      _removeFromIdx(id, a); _removeFromIdx(swapId, b);
      placements[id] = { day: b.day, period: b.period, locked: false };
      placements[swapId] = { day: a.day, period: a.period, locked: false };
      _addToIdx(id, placements[id]); _addToIdx(swapId, placements[swapId]);
      _dailyT += _sumDaily(affTD) - oldDaily;
      _updateSoftForClasses(new Set([..._clsOf(id), ..._clsOf(swapId)]));
      _updateTeaSoftForTeachers(new Set([..._teaOf(id), ..._teaOf(swapId)]));
      const h = _conflT + _dailyT;
      const soft = _flaggedSoft();
      _cache = { hard: h, soft, bias: _biasT, consec: _consecT, remain: _cache.remain, total: h * 100000 + _cache.remain * _remainW + soft };
    }

    function getCache() { return _cache; }
    function refreshCache() { _cache = _fullCost(); return _cache; }

    return {
      evalMove, applyMove, applySwap, getCache, refreshCache,
      _idx: idx, _placements: placements
    };
  }

  // 差分評価(buildDeltaCtx)の正当性検証: ランダムな move/swap について
  // 差分で求めた total と、全再計算した total が一致するか確認する。
  // window.__deltaFuzz(trials) で実行し {maxEvalDiff, maxApplyDiff} を返す（0が正しい）。
  function _deltaCtxSelfTest(trials = 300) {
    const base = deepClone(state.placements);
    const ctx = buildAiCtx(base);
    const dc = buildDeltaCtx(deepClone(base), ctx);
    const plc = dc._placements;
    const bruteTotal = (p) => {
      const hard = hardViolationsFromPlacements(p);
      const soft = softMetricsFromPlacements(p, ctx.optBalance, ctx.optNoConsec).score;
      const remain = ctx.allIds.filter(id => !p[id]).length;
      return hard * 100000 + remain * aiRemainWeight() + soft;
    };
    let maxEvalDiff = 0, maxApplyDiff = 0, n = 0;
    for (let i = 0; i < trials; i++) {
      const movable = ctx.allIds.filter(id => plc[id] && !plc[id].locked);
      if (movable.length < 2) break;
      const id = movable[Math.floor(Math.random() * movable.length)];
      const doSwap = Math.random() < 0.5;
      if (doSwap) {
        let sid; do { sid = movable[Math.floor(Math.random() * movable.length)]; } while (sid === id);
        const ev = dc.evalMove(id, plc[sid].day, plc[sid].period, sid);
        const p2 = deepClone(plc); const a = p2[id], b = p2[sid];
        p2[id] = { day: b.day, period: b.period, locked: false }; p2[sid] = { day: a.day, period: a.period, locked: false };
        maxEvalDiff = Math.max(maxEvalDiff, Math.abs(ev.total - bruteTotal(p2)));
        dc.applySwap(id, sid);
      } else {
        const slots = ctx.validSlotsCache[id]; if (!slots || !slots.length) continue;
        const s = slots[Math.floor(Math.random() * slots.length)];
        const ev = dc.evalMove(id, s.day, s.period);
        const p2 = deepClone(plc); p2[id] = { day: s.day, period: s.period, locked: false };
        maxEvalDiff = Math.max(maxEvalDiff, Math.abs(ev.total - bruteTotal(p2)));
        dc.applyMove(id, s.day, s.period);
      }
      maxApplyDiff = Math.max(maxApplyDiff, Math.abs(dc.getCache().total - bruteTotal(plc)));
      n++;
    }
    return { maxEvalDiff, maxApplyDiff, trials: n };
  }
  try { window.__deltaFuzz = _deltaCtxSelfTest; } catch (e) { }
  // 差分評価 vs 全再計算 のスループット比較（開発検証用）
  function _deltaCtxBench(n = 20000) {
    const base = deepClone(state.placements);
    const ctx = buildAiCtx(base);
    const dc = buildDeltaCtx(deepClone(base), ctx);
    const plc = dc._placements;
    const movable = ctx.allIds.filter(id => plc[id] && !plc[id].locked);
    const pick = () => movable[Math.floor(Math.random() * movable.length)];
    // delta evalMove
    let t0 = performance.now();
    for (let i = 0; i < n; i++) { const id = pick(); const s = ctx.validSlotsCache[id]; if (s && s.length) dc.evalMove(id, s[0].day, s[0].period); }
    const deltaMs = performance.now() - t0;
    // full softMetrics (旧: 1手ごとに全再計算していたコスト相当)
    t0 = performance.now();
    for (let i = 0; i < n; i++) { softMetricsFromPlacements(plc, ctx.optBalance, ctx.optNoConsec); }
    const fullMs = performance.now() - t0;
    return { n, deltaMs: Math.round(deltaMs), fullSoftMs: Math.round(fullMs), speedup: +(fullMs / deltaMs).toFixed(1) };
  }
  try { window.__deltaBench = _deltaCtxBench; } catch (e) { }

  /* ── DeltaCtx を使った高速SA ──────────────────────── */
  function initSAStateFast(basePlacements, ctx) {
    const plc = JSON.parse(JSON.stringify(basePlacements));
    const dc = buildDeltaCtx(plc, ctx);
    const cache = dc.getCache();
    return {
      placements: plc, dc,
      bestPlacements: JSON.parse(JSON.stringify(plc)),
      cost: cache.total, bestCost: cache.total,
      eval: cache, bestEval: cache,
      // 初期温度: soft最適化に適した値（vio/remainは重みが大きく自然にgreedy的に振る舞う）
      // soft scoreは通常 0〜n*20 程度。T=n*10で十分な探索ができる
      T: Math.max(200, ctx.allIds.length * 10),
      T0: Math.max(200, ctx.allIds.length * 10), // 再加熱の上限として参照
      alpha: 0.9995,
      acceptCount: 0, rejectCount: 0,
      step: 0, improved: false,
      // v46-A2: 停滞脱出
      stagnationSteps: 0, lastBestCost: cache.total, reheatCount: 0,
    };
  }

  function aiSAStepFast(saState, ctx) {
    const { placements, dc } = saState;
    const movable = ctx.allIds.filter(id => placements[id] && !placements[id].locked);
    if (!movable.length) return;

    // 違反コマを60%優先してSA近傍を生成
    let id;
    if (Math.random() < 0.60) {
      const conflicted = ctx.findConflictedIds(placements);
      const cm = movable.filter(x => conflicted.has(x));
      id = cm.length ? cm[Math.floor(Math.random() * cm.length)] : movable[Math.floor(Math.random() * movable.length)];
    } else {
      id = movable[Math.floor(Math.random() * movable.length)];
    }
    const slots = ctx.validSlotsCache[id];
    if (!slots.length) return;

    let ev, moveType = 'move', swapId = null, moveSlot = null;

    if (Math.random() < 0.5) {
      const others = movable.filter(x => x !== id);
      if (others.length) {
        swapId = others[Math.floor(Math.random() * others.length)];
        const oPlc = placements[swapId];
        if (oPlc) {
          ev = dc.evalMove(id, oPlc.day, oPlc.period, swapId);
          moveType = 'swap';
        }
      }
    }
    if (!ev) {
      // 評価したスロットをそのまま適用する（評価と適用でスロットがズレると
      // Metropolis受理判定が実際の手と対応せず探索が破綻するため）
      moveSlot = slots[Math.floor(Math.random() * slots.length)];
      ev = dc.evalMove(id, moveSlot.day, moveSlot.period);
      moveType = 'move'; swapId = null;
    }

    const delta = ev.deltaTotal;
    const T = saState.T;
    const accept = delta <= 0 || Math.random() < Math.exp(-delta / T);

    if (accept) {
      if (moveType === 'swap') { dc.applySwap(id, swapId); }
      else {
        dc.applyMove(id, moveSlot.day, moveSlot.period);
      }
      const c = dc.getCache();
      saState.cost = c.total;
      saState.eval = c;
      saState.acceptCount++;
      if (saState.cost < saState.bestCost) {
        saState.bestCost = saState.cost;
        saState.bestPlacements = JSON.parse(JSON.stringify(placements));
        saState.bestEval = c;
        saState.improved = true;
      }
    } else {
      saState.rejectCount++;
    }

    // ── 適応型冷却 ──────────────────────────────────
    const total = saState.acceptCount + saState.rejectCount;
    if (total > 300) {
      const ratio = saState.acceptCount / total;
      // soft最適化のT範囲: 10〜500。受理率が低すぎる場合のみ再加熱
      if (ratio < 0.04 && saState.T < 20) {
        saState.T = Math.min(saState.T * 2.0, saState.T0 || 200);  // 再加熱（初期温度を上限）
      } else if (ratio > 0.95) {
        saState.alpha = Math.max(saState.alpha * 0.9998, 0.9990); // 冷却促進
      }
      saState.acceptCount = 0; saState.rejectCount = 0;
    }
    saState.T *= saState.alpha;
    saState.step++;

    // ── v46-A2: 停滞脱出（強制再加熱）───────────────────────────
    if (saState.stagnationSteps !== undefined) {
      if (saState.bestCost < saState.lastBestCost) {
        saState.lastBestCost = saState.bestCost;
        saState.stagnationSteps = 0;
      } else {
        saState.stagnationSteps++;
      }
      // 5000ステップ改善なし かつ 最大3回まで強制再加熱
      if (saState.stagnationSteps > 5000 && saState.reheatCount < 3) {
        saState.reheatCount++;
        saState.stagnationSteps = 0;
        const T0 = saState.T0 || 200;
        saState.T = Math.max(saState.T, T0 * 0.3 * (3 - saState.reheatCount + 1) / 3);
        saState.alpha = Math.max(saState.alpha, 0.9992);
        // ランダムに3〜5コマを強制移動して多様化
        const forceN = 3 + Math.floor(Math.random() * 3);
        const movable2 = ctx.allIds.filter(id => placements[id] && !placements[id].locked);
        const chosen = shuffle(movable2.slice()).slice(0, forceN);
        for (const fid of chosen) {
          const fslots = ctx.validSlotsCache[fid];
          if (fslots.length) {
            const fSlotIdx = Math.floor(Math.random() * fslots.length);
            const fSlot = fslots[fSlotIdx];
            dc.applyMove(fid, fSlot.day, fSlot.period);
          }
        }
        const c2 = dc.getCache();
        saState.cost = c2.total; saState.eval = c2;
      }
    }
  }

  /* ═══════════════════════════════════════════════════
     v41: 遺伝的アルゴリズム (Genetic Algorithm)
     ═══════════════════════════════════════════════════ */
  const GA_POP_SIZE = 6;

  function initGAState(basePlacements, ctx) {
    const population = [];
    for (let i = 0; i < GA_POP_SIZE; i++) {
      const plc = JSON.parse(JSON.stringify(basePlacements));
      const movable = ctx.allIds.filter(id => plc[id] && !plc[id].locked);
      const k = Math.min(i * 3, movable.length);
      for (const id of shuffle(movable.slice()).slice(0, k)) {
        const slots = ctx.validSlotsCache[id];
        if (slots.length) { const s = slots[Math.floor(Math.random() * slots.length)]; plc[id] = { day: s.day, period: s.period, locked: false }; }
      }
      const ev = ctx.evalPlacement(plc);
      population.push({ placements: plc, cost: ev.total, eval: ev });
    }
    population.sort((a, b) => a.cost - b.cost);
    const best = population[0];
    return {
      population, step: 0, improved: false,
      bestPlacements: JSON.parse(JSON.stringify(best.placements)),
      bestCost: best.cost, bestEval: best.eval,
      genInterval: 40,
    };
  }

  function aiGAStep(gaState, ctx) {
    // 各個体に突然変異
    for (const ind of gaState.population) {
      const k = 1 + Math.floor(Math.random() * 3);
      const movable = ctx.allIds.filter(id => ind.placements[id] && !ind.placements[id].locked);
      const newPlc = Object.assign({}, ind.placements);
      for (const id of shuffle(movable.slice()).slice(0, k)) {
        const slots = ctx.validSlotsCache[id];
        if (slots.length) { const s = slots[Math.floor(Math.random() * slots.length)]; newPlc[id] = { day: s.day, period: s.period, locked: false }; }
      }
      const ev = ctx.evalPlacement(newPlc);
      if (ev.total < ind.cost) { ind.placements = newPlc; ind.cost = ev.total; ind.eval = ev; }
    }

    gaState.step++;

    // generationInterval毎に交叉（トーナメント選択＋一様交叉、子2体）
    if (gaState.step % gaState.genInterval === 0) {
      const pop = gaState.population;
      // トーナメント選択: ランダムに3体選び最良を親に（多様性を確保）
      const tournament = () => {
        let best = null;
        for (let t = 0; t < 3; t++) {
          const c = pop[Math.floor(Math.random() * pop.length)];
          if (!best || c.cost < best.cost) best = c;
        }
        return best;
      };
      const keepPlaced = !!state.settings.aiKeepPlaced;
      const makeChild = () => {
        const p1 = tournament(), p2 = tournament();
        const plc = {};
        // 一様交叉: 遺伝子ごとにどちらかの親から継承（allIds順に依存しない混合）
        for (const id of ctx.allIds) plc[id] = (Math.random() < 0.5 ? p1 : p2).placements[id];
        // 衝突解消: 後勝ちで衝突するコマは在庫へ（配置数維持モードでは在庫化せず衝突を許容）
        if (!keepPlaced) {
          const seen = {};
          for (const id of ctx.allIds) {
            const p = plc[id]; if (!p) continue;
            const it = state.items[id]; if (!it) continue;
            const span = it.span || 1; let conflict = false;
            for (let dp = 0; dp < span && !conflict; dp++) {
              for (const t of it.teas || []) { const k = `t:${t}:${p.day}:${p.period + dp}`; if (seen[k]) conflict = true; else seen[k] = id; }
              for (const c of it.cls || []) { const k = `c:${c}:${p.day}:${p.period + dp}`; if (seen[k]) conflict = true; else seen[k] = id; }
            }
            if (conflict) plc[id] = null;
          }
        }
        const ev = ctx.evalPlacement(plc);
        return { placements: plc, cost: ev.total, eval: ev };
      };
      // 子を2体つくり、悪い個体を置換（エリートは保持）
      for (const child of [makeChild(), makeChild()]) {
        pop.sort((a, b) => a.cost - b.cost);
        const worst = pop[pop.length - 1];
        if (child.cost < worst.cost) pop[pop.length - 1] = child;
      }
    }

    gaState.population.sort((a, b) => a.cost - b.cost);
    const best = gaState.population[0];
    if (best.cost < gaState.bestCost) {
      gaState.bestCost = best.cost;
      gaState.bestPlacements = JSON.parse(JSON.stringify(best.placements));
      gaState.bestEval = best.eval;
      gaState.improved = true;
    }
  }

  /* ═══════════════════════════════════════════════════
     v41: エリートアーカイブ (Elite Archive)
     top-K解をセッション内で保持 → 次AI探索の初期解に再利用
     ═══════════════════════════════════════════════════ */
  const ELITE_MAX = 5;
  const _eliteArchive = [];

  function eliteArchiveTryAdd(placements, key, label) {
    const score = (key.vio || 0) * 10000 + (key.remain || 0) * 1000 + (key.soft || 0);
    const entry = {
      placements: JSON.parse(JSON.stringify(placements)),
      key, label, score, ts: Date.now()
    };
    // 重複チェック（スコアが全く同じなら追加しない）
    if (_eliteArchive.some(e => e.score === score)) return;
    _eliteArchive.push(entry);
    _eliteArchive.sort((a, b) => a.score - b.score);
    if (_eliteArchive.length > ELITE_MAX) _eliteArchive.length = ELITE_MAX;
    _renderElitePanel();
  }

  function _renderElitePanel() {
    const body = document.getElementById('elite-body'); if (!body) return;
    body.innerHTML = _eliteArchive.map((e, i) => `
    <div class="elite-entry">
      <span class="elite-rank">#${i + 1}</span>
      <span class="elite-label">${escapeHtml(e.label || '')}</span>
      <span class="elite-score">残${e.key.remain} 違${e.key.vio} 偏${(e.key.bias || 0).toFixed(1)}</span>
      <button class="elite-restore-btn" data-idx="${i}" title="この解を適用">↩ 復元</button>
    </div>
  `).join('') || '<div class="muted" style="padding:8px;font-size:12px">AI探索後に自動登録されます</div>';
    body.querySelectorAll('.elite-restore-btn').forEach(btn => {
      btn.onclick = () => {
        const e = _eliteArchive[parseInt(btn.dataset.idx, 10)]; if (!e) return;
        pushHistory('elite-restore');
        for (const id of Object.keys(state.items)) {
          if (state.placements[id]?.locked) continue;
          state.placements[id] = e.placements[id] || null;
        }
        invalidateIndex(); markDirty('place'); rerenderAll(); broadcastState();
        flash(`🏆 エリート解 #${parseInt(btn.dataset.idx, 10) + 1}「${e.label}」を復元`);
      };
    });
  }

  function ensureElitePanel() {
    let panel = document.getElementById('elite-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'elite-panel';
      panel.className = 'elite-panel';
      panel.innerHTML = `
      <div class="elite-header">
        <span>🏆 エリートアーカイブ (Top${ELITE_MAX})</span>
        <button id="elite-close-btn" style="background:none;border:none;color:#94a3b8;cursor:pointer;font-size:14px">✕</button>
      </div>
      <div id="elite-body" class="elite-body"></div>
    `;
      document.body.appendChild(panel);
      document.getElementById('elite-close-btn').onclick = () => panel.classList.remove('visible');
    }
    panel.classList.add('visible');
    _renderElitePanel();
    return panel;
  }

  /* ═══════════════════════════════════════════════════
     v41: 違反ヒートマップ
     グリッドのセルに違反レベルに応じた色オーバーレイを表示
     ═══════════════════════════════════════════════════ */
  let _heatmapActive = false;

  function toggleHeatmap() {
    _heatmapActive = !_heatmapActive;
    const btn = document.getElementById('btn-heatmap');
    if (btn) btn.classList.toggle('active', _heatmapActive);
    if (_heatmapActive) applyHeatmap();
    else clearHeatmap();
  }

  /* v45.2: コマ色モード切替（2色版） */
  function toggleColorMode() {
    const modes = ['subject', 'type'];
    const labels = { subject: '🎨 科目色', type: '🏷️ 連動色' };
    const descs = {
      subject: '科目色モード（通常）',
      type: '連動色モード：単独コマ=科目色　連動（並列/複数クラス/複数教員/2連）=紫'
    };
    const cur = state.ui.colorMode || 'subject';
    const next = modes[(modes.indexOf(cur) + 1) % modes.length];
    state.ui.colorMode = next;
    markDirty('ui');
    const btn = document.getElementById('btn-color-mode');
    if (btn) {
      btn.textContent = labels[next];
      btn.style.background = next === 'type' ? '#7c3aed' : '#1e40af';
    }
    rerenderAll();
    flash(descs[next]);
  }

  function applyHeatmap() {
    const root = document.getElementById('grid'); if (!root) return;
    const idx = buildIndex();
    const mode = state.ui.viewMode;

    for (const tr of root.querySelectorAll('tbody tr')) {
      const rowKey = tr.dataset.row;
      for (const td of tr.querySelectorAll('td[data-day]')) {
        const day = td.dataset.day, p = parseInt(td.dataset.p, 10);

        let heat = 0;      // 0=clean, 1=warn, 2=conflict, 3=severe
        let intensity = 1; // 1.0 = base; higher = more saturated

        if (mode === 'teacher') {
          const ids = (idx.tea?.[rowKey]?.[day]?.[p] || []);
          const occupied = ids.filter(x => !isSpanFill(x, day, p));
          if (occupied.length > 1) {
            heat = 3; intensity = Math.min(3.0, 1.0 + (occupied.length - 1) * 0.5);
          } else if (occupied.length === 1) {
            const maxD = teacherDailyMax(rowKey);
            if (maxD != null) {
              let cnt = 0;
              for (let pp = 1; pp <= maxPeriod(day); pp++) cnt += (idx.tea?.[rowKey]?.[day]?.[pp] || []).filter(x => !isSpanFill(x, day, pp)).length;
              const over = cnt - maxD;
              if (over > 0) { heat = 2; intensity = 1.0 + over * 0.4; }
            }
            // 連続授業チェック: 何コマ連続か調べて intensity に反映
            let runLen = 1, p2 = p - 1;
            while (p2 >= 1 && (idx.tea?.[rowKey]?.[day]?.[p2] || []).some(x => !isSpanFill(x, day, p2))) { runLen++; p2--; }
            let p3 = p + 1, maxP2 = maxPeriod(day);
            while (p3 <= maxP2 && (idx.tea?.[rowKey]?.[day]?.[p3] || []).some(x => !isSpanFill(x, day, p3))) { runLen++; p3++; }
            const maxC = teacherConsecMax(rowKey);
            if (maxC != null && runLen > maxC) { heat = Math.max(heat, 2); intensity = Math.max(intensity, 1.0 + (runLen - maxC) * 0.5); }
            else if (runLen >= 3) { heat = Math.max(heat, 1); intensity = Math.max(intensity, 0.8 + runLen * 0.1); }
          }
        } else if (mode === 'class') {
          const ids = (idx.cls?.[rowKey]?.[day]?.[p] || []);
          const occupied = ids.filter(x => !isSpanFill(x, day, p));
          if (occupied.length > 1) {
            heat = 3; intensity = Math.min(3.0, 1.0 + (occupied.length - 1) * 0.5);
          } else if (occupied.length === 1) {
            const vio = violationSummary(occupied[0]);
            if (vio) { heat = 2; intensity = 1.2; }
          }
        } else {
          const ids = (idx.room?.[rowKey]?.[day]?.[p] || []);
          const occupied = ids.filter(x => !isSpanFill(x, day, p));
          if (occupied.length > 1) { heat = 3; intensity = 1.0 + (occupied.length - 1) * 0.5; }
        }

        td.classList.remove('heat-0', 'heat-1', 'heat-2', 'heat-3');
        td.style.removeProperty('--heat-intensity');
        if (heat > 0) {
          td.classList.add(`heat-${heat}`);
          if (intensity > 1) td.style.setProperty('--heat-intensity', intensity.toFixed(2));
        }
        if (_heatmapActive) td.classList.add('heat-on');
      }
    }
  }

  function clearHeatmap() {
    const root = document.getElementById('grid'); if (!root) return;
    for (const td of root.querySelectorAll('td')) {
      td.classList.remove('heat-0', 'heat-1', 'heat-2', 'heat-3', 'heat-on');
    }
  }

  /* ═══════════════════════════════════════════════════
     v41: 収束グラフ (Convergence Chart)
     ─────────────────────────────────────────────────
     AI探索中にリアルタイムでコスト推移を描画する
     ═══════════════════════════════════════════════════ */
  const _convergenceData = []; // {t, cost, remain, vio}
  let _convCanvas = null, _convCtx2d = null;

  function initConvergenceChart() {
    _convergenceData.length = 0;
    let panel = document.getElementById('conv-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'conv-panel';
      panel.className = 'conv-panel';
      panel.innerHTML = `
      <div class="conv-header">
        <span>📈 収束グラフ</span>
        <button id="conv-close-btn" style="background:none;border:none;color:#94a3b8;cursor:pointer;font-size:14px">✕</button>
      </div>
      <canvas id="conv-canvas" width="400" height="140" style="width:100%;height:140px"></canvas>
    `;
      document.body.appendChild(panel);
      document.getElementById('conv-close-btn').onclick = () => panel.classList.remove('visible');
    }
    panel.classList.add('visible');
    _convCanvas = document.getElementById('conv-canvas');
    _convCtx2d = _convCanvas?.getContext('2d');
  }

  function recordConvergence(t, key) {
    if (!key) return;
    _convergenceData.push({ t, cost: key.soft || 0, remain: key.remain || 0, vio: key.vio || 0 });
    if (_convergenceData.length > 300) _convergenceData.shift();
    drawConvergenceChart();
  }

  function drawConvergenceChart() {
    const ctx2d = _convCtx2d, canvas = _convCanvas;
    if (!ctx2d || !canvas || !_convergenceData.length) return;
    const W = canvas.width = canvas.offsetWidth * window.devicePixelRatio || 400;
    const H = canvas.height = 140 * window.devicePixelRatio || 140;
    ctx2d.clearRect(0, 0, W, H);

    const data = _convergenceData;
    const maxCost = Math.max(...data.map(d => d.cost), 1);
    const maxRem = Math.max(...data.map(d => d.remain), 1);

    // 背景
    ctx2d.fillStyle = '#0f172a'; ctx2d.fillRect(0, 0, W, H);

    // Grid lines
    ctx2d.strokeStyle = '#1e293b'; ctx2d.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      ctx2d.beginPath(); ctx2d.moveTo(0, H * i / 4); ctx2d.lineTo(W, H * i / 4); ctx2d.stroke();
    }

    const px = (i) => W * i / (data.length - 1 || 1);
    const py = (v, max) => H - (H * 0.1) - (H * 0.8) * Math.min(v / max, 1);

    // Cost line (blue)
    ctx2d.strokeStyle = '#6366f1'; ctx2d.lineWidth = 1.5 * window.devicePixelRatio;
    ctx2d.beginPath();
    data.forEach((d, i) => { i === 0 ? ctx2d.moveTo(px(i), py(d.cost, maxCost)) : ctx2d.lineTo(px(i), py(d.cost, maxCost)); });
    ctx2d.stroke();

    // Remain line (orange)
    ctx2d.strokeStyle = '#f59e0b'; ctx2d.lineWidth = 1.5 * window.devicePixelRatio;
    ctx2d.beginPath();
    data.forEach((d, i) => { i === 0 ? ctx2d.moveTo(px(i), py(d.remain, maxRem)) : ctx2d.lineTo(px(i), py(d.remain, maxRem)); });
    ctx2d.stroke();

    // Legend
    ctx2d.font = `${10 * window.devicePixelRatio}px monospace`;
    ctx2d.fillStyle = '#6366f1'; ctx2d.fillText('偏り', 4, 14 * window.devicePixelRatio);
    ctx2d.fillStyle = '#f59e0b'; ctx2d.fillText('残', 40 * window.devicePixelRatio, 14 * window.devicePixelRatio);
    const last = data[data.length - 1];
    ctx2d.fillStyle = '#e2e8f0';
    ctx2d.fillText(`cost:${last.cost.toFixed(0)} rem:${last.remain} vio:${last.vio}`, 60 * window.devicePixelRatio, 14 * window.devicePixelRatio);
  }

  /* ═══════════════════════════════════════════════════
     v41: 提案の非同期バッチ計算
     computeSuggestionPack を requestIdleCallback (or setTimeout)
     でバックグラウンド実行 → UI固まらない
     ═══════════════════════════════════════════════════ */
  let _sugBatchId = null; // cancelできるようにidを保持



  function countForbid(subjKey) {
    const scfg = state.subjectCfg[subjKey] || {};
    if (scfg.allowedMode && scfg.allowedSlots && Object.keys(scfg.allowedSlots).length) {
      // In allowedMode, forbidden = everything not in allowedSlots
      const totalSlots = DAYS.reduce((s, d) => s + maxPeriod(d), 0);
      const allowed = DAYS.reduce((s, d) => s + (scfg.allowedSlots[d] || []).length, 0);
      return Math.max(0, totalSlots - allowed);
    }
    const map = scfg.fixedForbid || {};
    let n = 0; for (const d in map) n += (map[d] || []).length;
    return n;
  }

