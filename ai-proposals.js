/* 高精度AI提案・問題分析（独立したまとまり）。script.js・puzzle.js の後に読み込む。 */
(function () {
  // このIIFEは独立スコープのため、共通定数/ヘルパをローカルに定義（未定義参照を防ぐ）
  const DAYJP = { Mon: '月', Tue: '火', Wed: '水', Thu: '木', Fri: '金', Sat: '土', Sun: '日' };
  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  const invalidateIndex = () => { try { window.invalidateIndex && window.invalidateIndex(); } catch (e) { } };
  function maxPeriod(day) { const v = (window.state?.settings?.periodsByDay || {})[day]; return (v != null) ? v : 6; }
  function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  // ---- maxPeriodForItem: accept both (day,cls) and (item,day) calls without breaking older code
  const __maxPeriodForItem_orig = (typeof maxPeriodForItem === 'function') ? maxPeriodForItem : null;
  function maxPeriodForItemFlex(a, b) {
    let day = null; let classes = [];
    if (typeof a === 'string') { day = a; if (b) classes = [b]; }
    else { const it = a; day = b; classes = (it && Array.isArray(it.cls)) ? it.cls : []; }
    let maxP = maxPeriod(day);
    const ov = state?.settings?.classPeriodOverride || {};
    for (const cls of classes) {
      const v = ov?.[cls]?.[day];
      if (v !== undefined && v !== null && v !== '') {
        const n = Number(v);
        if (Number.isFinite(n)) maxP = Math.min(maxP, n);
      }
    }
    return maxP;
  }
  // overwrite safely
  try { maxPeriodForItem = maxPeriodForItemFlex; } catch { /* ignore */ }

  // ---- highlightValidSlots: auto-clear + robust cleanup
  if (typeof highlightValidSlots === 'function') {
    const __highlightValidSlots_orig = highlightValidSlots;
    highlightValidSlots = function (id) {
      clearValidSlots();
      const r = __highlightValidSlots_orig(id);
      try {
        if (__validSlotTimer) clearTimeout(__validSlotTimer);
        __validSlotTimer = setTimeout(() => { try { clearValidSlots(); } catch { } }, 9000);
        const once = () => { try { clearValidSlots(); } catch { }; window.removeEventListener('keydown', onKey, true); window.removeEventListener('mousedown', once, true); window.removeEventListener('wheel', once, true); window.removeEventListener('resize', once, true); };
        const onKey = (ev) => { if (ev.key === 'Escape') once(); };
        window.addEventListener('keydown', onKey, true);
        window.addEventListener('mousedown', once, true);
        window.addEventListener('wheel', once, true);
        window.addEventListener('resize', once, true);
      } catch { }
      return r;
    };
  }

  // ---- applySuggestion: atomic apply (prevents script error / broken buttons)
  if (typeof applySuggestion === 'function') {
    const __applySuggestion_orig = applySuggestion;
    applySuggestion = function (sug) {
      try {
        const moves0 = sug?.moves || [];
        if (!moves0.length) { flash('移動がありません'); return; }
        // locked are immutable
        const moves = moves0.filter(m => !state.placements[m.id]?.locked);
        if (!moves.length) { flash('ロック中のため適用できません'); return; }

        clearOverlays();

        // simulate on a cloned placements
        const backup = deepClone(state.placements);
        // remove touched first (atomic)
        const touched = new Set(moves.map(m => m.id));
        for (const id of touched) { if (state.placements[id]?.locked) continue; state.placements[id] = null; }
        // apply all
        for (const m of moves) {
          if (state.placements[m.id]?.locked) continue;
          state.placements[m.id] = { day: m.day, period: m.period, locked: false };
        }
        invalidateIndex?.();

        // final validate pass (hard blocks)
        for (const m of moves) {
          const plc = state.placements[m.id];
          if (!plc) continue;
          const v = validatePlacement(m.id, plc.day, plc.period, 'safe');
          if (v && v.blocks && v.blocks.length) {
            // rollback
            state.placements = backup;
            invalidateIndex?.();
            showModal?.('適用できません', '提案の適用中に禁則/上限により失敗しました。\n' + v.blocks.join(' / '));
            return;
          }
        }

        pushHistory?.('suggest');
        markDirty?.('suggest');
        rerenderAll?.();
        broadcastState?.();
        flash('提案を適用しました');
      } catch (e) {
        console.error(e);
        flash('提案適用でエラー');
        try { showModal?.('エラー', (e && (e.stack || e.message)) ? String(e.stack || e.message) : 'unknown'); } catch { }
      }
    };
  }

  // ---- sanitize placements by validatePlacement (enforce classPeriodOverride etc.)
  function sanitizePlacements() {
    try {
      const ids = Object.keys(state.items || {});
      let changed = false;
      for (const id of ids) {
        const plc = state.placements?.[id];
        if (!plc) continue;
        const v = validatePlacement(id, plc.day, plc.period, 'safe');
        if (v && v.blocks && v.blocks.length) {
          // keep locked even if invalid? better: keep but mark; here we remove if not locked
          if (!plc.locked) {
            state.placements[id] = null; changed = true;
          }
        }
      }
      if (changed) invalidateIndex?.();
      return changed;
    } catch { return false; }
  }

  // ---- AI配置: prevent double-run + sanitize + no shake
  if (typeof aiPlaceAll === 'function') {
    const __aiPlaceAll_orig = aiPlaceAll;
    aiPlaceAll = function () {
      if (__aiPlaceRunning) { flash('AI配置 実行中'); return; }
      __aiPlaceRunning = true;
      __setBtnDisabled('btn-ai', true);
      try {
        clearOverlays();
        const r = __aiPlaceAll_orig();
        // enforce overrides
        try { sanitizePlacements(); } catch { }
        return r;
      } catch (e) {
        console.error(e);
        flash('AI配置でエラー');
        try { showModal?.('AI配置 エラー', String(e.stack || e.message || e)); } catch { }
      } finally {
        __aiPlaceRunning = false;
        __setBtnDisabled('btn-ai', false);
      }
    };
  }

  // ---- AI探索: add visible trial pulse (non-destructive)
  if (typeof aiRun === 'function') {
    const __aiRun_orig = aiRun;
    aiRun = async function () {
      if (__aiRunRunning) { flash('AI探索 実行中'); return; }
      __aiRunRunning = true;
      __setBtnDisabled('btn-ai-run', true);
      clearOverlays();
      const base = deepClone(state.placements);

      // preview helper: apply a random small change for visibility, then restore
      const startPreview = () => {
        try {
          if (__previewTimer) clearInterval(__previewTimer);
          __previewTimer = setInterval(() => {
            try {
              // restore
              if (__previewRestore) { __previewRestore(); __previewRestore = null; }
              const ids = Object.keys(state.items || {});
              const movable = ids.filter(id => !state.placements[id] && state.items[id]);
              if (!movable.length) return;
              const id = movable[Math.floor(Math.random() * movable.length)];
              // find a random cell to attempt (quick)
              const days = state.days || ['mon', 'tue', 'wed', 'thu', 'fri'];
              const day = days[Math.floor(Math.random() * days.length)];
              const maxP = maxPeriodForItem(state.items[id], day);
              const p = 1 + Math.floor(Math.random() * Math.max(1, maxP));
              const v = validatePlacement(id, day, p, 'safe');
              if (v && v.blocks && v.blocks.length) return;
              const prev = deepClone(state.placements);
              state.placements[id] = { day, period: p, locked: false };
              invalidateIndex?.();
              rerenderAll?.();
              __previewRestore = () => {
                state.placements = prev;
                invalidateIndex?.();
                rerenderAll?.();
              };
              setTimeout(() => { if (__previewRestore) { __previewRestore(); __previewRestore = null; } }, 140);
            } catch { }
          }, 320);
        } catch { }
      };
      const stopPreview = () => {
        try {
          if (__previewTimer) clearInterval(__previewTimer);
          __previewTimer = null;
          if (__previewRestore) { __previewRestore(); __previewRestore = null; }
        } catch { }
      };

      try {
        startPreview();
        __aiRun_orig();
        // __aiRun_origは即リターンしrequestAnimationFrameで非同期実行するため、
        // aiRunner.running===false になるまでポーリングして待つ
        await new Promise(resolve => {
          const poll = setInterval(() => {
            // aiRunner はbindEvents内のローカル変数だが、btn表示が変わるのでそれで判定
            const btn = document.getElementById('btn-ai-run');
            const isStillRunning = btn && (btn.textContent.includes('停止') || btn.textContent.includes('停止中'));
            if (!isStillRunning) {
              clearInterval(poll);
              resolve();
            }
          }, 300);
        });
        stopPreview();
        // sanitize
        try { sanitizePlacements(); } catch { }
        return r;
      } catch (e) {
        stopPreview();
        console.error(e);
        flash('AI探索でエラー');
        try { showModal?.('AI探索 エラー', String(e.stack || e.message || e)); } catch { }
      } finally {
        __aiRunRunning = false;
        __setBtnDisabled('btn-ai-run', false);
      }
    };
  }

  // ---- global: clear overlays before rerender if possible
  if (typeof rerenderAll === 'function') {
    const __rerenderAll_orig = rerenderAll;
    rerenderAll = function () {
      try { clearOverlays(); } catch { }
      return __rerenderAll_orig();
    };
  }


  try { window.state = state; window.__ULT_STATE__ = state; } catch (e) { }

  /* ===============================================================================
     高精度AI提案システム v2.0 - 大幅改善版
     
     改善内容:
     1. 提案精度の向上 - より賢いスコアリングと多様な探索
     2. 視覚化の改善 - 連鎖移動を明確に表示
     3. AI探索の強化 - ビームサーチ + モンテカルロ探索
     4. 問題分析機能 - リアルタイム制約違反分析
     
     使い方:
     1. script.js の computeLookaheadSuggestions を置き換え
     2. 新しい関数群を追加
     3. UI に問題分析パネルを追加
     =============================================================================== */

  /* =======================
     1. スコアリングシステムの改善
  ======================= */

  /**
   * 改善版スコアリング - 制約違反の種類と重要度を考慮
   */
  function calculatePlacementScore(id, day, period, validation) {
    let score = 100;
    const it = state.items[id];
    if (!it) return 0;

    // ブロッカーがある場合は大幅減点
    if (validation.blocks && validation.blocks.length > 0) {
      score -= validation.blocks.length * 50;
    }

    // 警告の種類別に減点
    if (validation.warns && validation.warns.length > 0) {
      validation.warns.forEach(warn => {
        const msg = warn.msg || warn;

        // 教員の重複 - 重大
        if (msg.includes('教員') && msg.includes('重複')) {
          score -= 20;
        }
        // クラスの重複 - 重大
        else if (msg.includes('クラス') && msg.includes('重複')) {
          score -= 20;
        }
        // 連続コマ超過 - 中程度
        else if (msg.includes('連続')) {
          score -= 10;
        }
        // 1日上限超過 - 中程度
        else if (msg.includes('1日')) {
          score -= 10;
        }
        // 禁止枠 - 軽度
        else if (msg.includes('禁止')) {
          score -= 5;
        }
        // その他の警告 - 軽度
        else {
          score -= 3;
        }
      });
    }

    // ボーナス要素

    // 2連コマの場合、連続性を評価
    if ((it.span || 1) === 2) {
      const nextPeriod = period + 1;
      const maxP = maxPeriod(day);
      if (nextPeriod <= maxP) {
        score += 5; // 2連が収まる場合はボーナス
      }
    }

    // 禁止枠を避けている場合はボーナス（countForbidは別IIFEなのでwindow経由）
    const forbidCount = (window.countForbid ? window.countForbid(it.subjKey) : 0) || 0;
    if (forbidCount > 0) {
      score += 3; // 禁止枠を回避できた
    }

    // 早い時限ほど若干ボーナス（朝の授業を優先）
    score += (8 - period) * 0.5;

    return Math.max(0, score);
  }

  /**
   * 配置の「難易度」を計算（高いほど配置が難しい）
   */
  function calculatePlacementDifficulty(id) {
    const it = state.items[id];
    if (!it) return 0;

    let difficulty = 0;

    // 2連コマは配置が難しい
    if ((it.span || 1) === 2) {
      difficulty += 15;
    }

    // 複数クラスは難しい
    if (it.cls && it.cls.length > 1) {
      difficulty += 10 * (it.cls.length - 1);
    }

    // 複数教員は難しい
    if (it.teas && it.teas.length > 1) {
      difficulty += 8 * (it.teas.length - 1);
    }

    // 禁止枠が多いと難しい
    const forbidCount = countForbid(it.subjKey) || 0;
    difficulty += forbidCount * 2;

    // 残り配置可能枠数を計算
    let availableSlots = 0;
    for (const day of DAYS) {
      const maxP = maxPeriod(day);
      for (let p = 1; p <= maxP; p++) {
        if ((it.span || 1) === 2 && p === maxP) continue;
        const v = validatePlacement(id, day, p, 'safe', null);
        if (!v.blocks || v.blocks.length === 0) {
          availableSlots++;
        }
      }
    }

    // 選択肢が少ないほど難しい
    if (availableSlots < 5) {
      difficulty += (5 - availableSlots) * 5;
    }

    return difficulty;
  }

  /* =======================
     2. 改善版AI探索システム
  ======================= */

  /**
   * 改善版先読み提案 - ビームサーチ + 多様性考慮
   */
  function computeEnhancedLookaheadSuggestions(id) {
    const it = state.items[id];
    if (!it) return [];

    window._aiDebug && console.log(`🔍 改善版AI探索開始: ${id}`);
    const startTime = performance.now();

    const BEAM_WIDTH = 10;      // ビーム幅を拡大
    const LOOKAHEAD_DEPTH = 6;  // 先読み深度を拡大
    const TOP_RESULTS = 8;      // 提案数を増加

    // 未配置コマを難易度順にソート
    const allIds = Object.keys(state.items);
    const unplacedOthers = allIds.filter(x => x !== id && !state.placements[x]);
    const sortedUnplaced = unplacedOthers
      .map(xid => ({ id: xid, difficulty: calculatePlacementDifficulty(xid) }))
      .sort((a, b) => b.difficulty - a.difficulty)
      .slice(0, LOOKAHEAD_DEPTH)
      .map(x => x.id);

    window._aiDebug && console.log(`  難しいコマ ${sortedUnplaced.length}個を先読み対象に`);

    // 初期候補を生成
    const initialCandidates = [];
    for (const day of DAYS) {
      const maxP = maxPeriod(day);
      for (let p = 1; p <= maxP; p++) {
        if ((it.span || 1) === 2 && p === maxP) continue;

        const v = validatePlacement(id, day, p, 'safe', null);
        const score = calculatePlacementScore(id, day, p, v);

        // ブロッカーがない場合のみ候補に追加
        if (!v.blocks || v.blocks.length === 0) {
          initialCandidates.push({
            day,
            period: p,
            score,
            validation: v
          });
        }
      }
    }

    if (initialCandidates.length === 0) {
      window._aiDebug && console.log('  ❌ 配置可能な候補なし');
      return [];
    }

    window._aiDebug && console.log(`  初期候補: ${initialCandidates.length}個`);

    // スコア順 + 多様性を考慮してビーム候補を選択
    const beamCandidates = selectDiverseCandidates(initialCandidates, BEAM_WIDTH);
    window._aiDebug && console.log(`  ビーム候補: ${beamCandidates.length}個`);

    // 各ビーム候補について先読み探索
    const results = [];
    for (let i = 0; i < beamCandidates.length; i++) {
      const cand = beamCandidates[i];

      // 一時的に配置
      const backup = deepClone(state.placements);
      state.placements[id] = { day: cand.day, period: cand.period, locked: false };
      invalidateIndex();

      // 先読み探索
      const lookaheadResult = simulateLookahead(sortedUnplaced, id);

      // 復元
      state.placements = backup;
      invalidateIndex();

      // 総合スコア計算
      const totalScore =
        cand.score * 0.4 +                    // 初手の品質
        lookaheadResult.placedCount * 15 +    // 後続配置数
        lookaheadResult.avgScore * 0.3 +      // 後続の平均品質
        (lookaheadResult.allPlaced ? 50 : 0); // 全配置ボーナス

      results.push({
        title: generateSuggestionTitle(cand, lookaheadResult),
        score: Math.round(totalScore),
        reason: generateSuggestionReason(cand, lookaheadResult, sortedUnplaced.length),
        moves: [{
          id,
          day: cand.day,
          period: cand.period,
          span: it.span || 1
        }],
        lookahead: lookaheadResult,
        warnings: cand.validation.warns || []
      });
    }

    // スコア順にソート
    results.sort((a, b) => b.score - a.score);

    const endTime = performance.now();
    window._aiDebug && console.log(`  ✅ 探索完了: ${(endTime - startTime).toFixed(1)}ms`);
    window._aiDebug && console.log(`  提案数: ${results.length}個（上位${TOP_RESULTS}個を返す）`);

    return results.slice(0, TOP_RESULTS);
  }

  /**
   * 多様性を考慮した候補選択
   */
  function selectDiverseCandidates(candidates, count) {
    if (candidates.length <= count) {
      return candidates.sort((a, b) => b.score - a.score);
    }

    const selected = [];
    const remaining = [...candidates].sort((a, b) => b.score - a.score);

    // 上位を確保
    const topCount = Math.min(3, count);
    selected.push(...remaining.splice(0, topCount));

    // 残りは多様性を考慮して選択
    while (selected.length < count && remaining.length > 0) {
      let bestIdx = 0;
      let bestDiversity = -1;

      for (let i = 0; i < remaining.length; i++) {
        const cand = remaining[i];

        // 既存候補との距離を計算
        let minDistance = Infinity;
        for (const sel of selected) {
          const distance =
            Math.abs(DAYS.indexOf(cand.day) - DAYS.indexOf(sel.day)) +
            Math.abs(cand.period - sel.period);
          minDistance = Math.min(minDistance, distance);
        }

        // 多様性スコア = 距離 + 品質
        const diversityScore = minDistance * 2 + cand.score * 0.1;

        if (diversityScore > bestDiversity) {
          bestDiversity = diversityScore;
          bestIdx = i;
        }
      }

      selected.push(remaining.splice(bestIdx, 1)[0]);
    }

    return selected;
  }

  /**
   * 先読みシミュレーション
   */
  function simulateLookahead(itemIds, excludeId) {
    let placedCount = 0;
    let totalScore = 0;
    const placements = [];

    for (const itemId of itemIds) {
      if (itemId === excludeId) continue;

      const it = state.items[itemId];
      if (!it) continue;

      // 配置済みの場合はスキップ
      if (state.placements[itemId]) continue;

      // 最良の配置を探す
      let bestPlacement = null;
      let bestScore = -Infinity;

      for (const day of DAYS) {
        const maxP = maxPeriod(day);
        for (let p = 1; p <= maxP; p++) {
          if ((it.span || 1) === 2 && p === maxP) continue;

          const v = validatePlacement(itemId, day, p, 'safe', null);
          if (v.blocks && v.blocks.length > 0) continue;

          const score = calculatePlacementScore(itemId, day, p, v);
          if (score > bestScore) {
            bestScore = score;
            bestPlacement = { day, period: p };
          }
        }
      }

      if (bestPlacement) {
        // 一時配置
        state.placements[itemId] = {
          day: bestPlacement.day,
          period: bestPlacement.period,
          locked: false
        };
        invalidateIndex();

        placedCount++;
        totalScore += bestScore;
        placements.push({
          id: itemId,
          ...bestPlacement,
          score: bestScore
        });
      }
    }

    return {
      placedCount,
      totalCount: itemIds.length,
      avgScore: placedCount > 0 ? totalScore / placedCount : 0,
      allPlaced: placedCount === itemIds.length,
      placements
    };
  }

  /**
   * 提案タイトルを生成
   */
  function generateSuggestionTitle(candidate, lookahead) {
    const dayJP = DAYJP[candidate.day];
    const period = candidate.period;
    const status = lookahead.allPlaced ? '✓完璧' :
      lookahead.placedCount > lookahead.totalCount * 0.7 ? '○良好' : '';

    return `${dayJP}${period}限 ${status} (後続${lookahead.placedCount}/${lookahead.totalCount})`;
  }

  /**
   * 提案理由を生成
   */
  function generateSuggestionReason(candidate, lookahead, totalCount) {
    const reasons = [];

    // 配置成功率
    const successRate = Math.round((lookahead.placedCount / totalCount) * 100);
    reasons.push(`難しいコマを${lookahead.placedCount}個配置可能（成功率${successRate}%）`);

    // 品質評価
    if (candidate.score >= 90) {
      reasons.push('この配置は制約違反なし');
    } else if (candidate.score >= 70) {
      reasons.push('軽微な警告のみ');
    } else {
      reasons.push('いくつかの制約に抵触');
    }

    // 先読み結果
    if (lookahead.allPlaced) {
      reasons.push('全ての難関コマの配置に成功！');
    } else if (lookahead.avgScore >= 80) {
      reasons.push('後続コマも高品質に配置');
    }

    return reasons;
  }

  /* =======================
     3. 視覚化システムの改善
  ======================= */

  /**
   * リアルタイム提案表示 - マウスオーバー時
   */
  let currentHoverSuggestion = null;
  let hoverOverlay = null;

  function showHoverSuggestion(id, day, period) {
    if (!id || !day || !period) return;

    // 高速化: 同じ位置なら再計算しない
    if (currentHoverSuggestion &&
      currentHoverSuggestion.id === id &&
      currentHoverSuggestion.day === day &&
      currentHoverSuggestion.period === period) {
      return;
    }

    // 提案を計算
    const it = state.items[id];
    if (!it) return;

    const v = validatePlacement(id, day, period, 'safe', null);
    const score = calculatePlacementScore(id, day, period, v);

    currentHoverSuggestion = {
      id,
      day,
      period,
      score,
      validation: v
    };

    // 視覚化を更新
    updateHoverVisualization(currentHoverSuggestion);
  }

  function updateHoverVisualization(suggestion) {
    // オーバーレイを初期化
    if (!hoverOverlay) {
      hoverOverlay = document.createElement('div');
      hoverOverlay.id = 'hover-suggestion-overlay';
      hoverOverlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 9999;
    `;
      document.body.appendChild(hoverOverlay);
    }

    // クリア
    hoverOverlay.innerHTML = '';

    // 移動先のセル位置を取得
    const targetCell = document.querySelector(
      `[data-day="${suggestion.day}"][data-p="${suggestion.period}"]`
    );
    if (!targetCell) return;

    const rect = targetCell.getBoundingClientRect();

    // 巨大な矢印を表示（SVGではなくCSS）
    const arrow = document.createElement('div');
    arrow.style.cssText = `
    position: fixed;
    left: ${rect.left}px;
    top: ${rect.top}px;
    width: ${rect.width}px;
    height: ${rect.height}px;
    border: 4px solid ${getScoreColor(suggestion.score)};
    border-radius: 8px;
    box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.2),
                0 0 20px rgba(59, 130, 246, 0.4),
                inset 0 0 20px rgba(59, 130, 246, 0.1);
    animation: pulse-glow 1.5s ease-in-out infinite;
    z-index: 1;
  `;
    hoverOverlay.appendChild(arrow);

    // スコアバッジを表示
    const badge = document.createElement('div');
    badge.style.cssText = `
    position: fixed;
    left: ${rect.left + rect.width / 2 - 40}px;
    top: ${rect.top - 50}px;
    width: 80px;
    height: 40px;
    background: ${getScoreColor(suggestion.score)};
    color: white;
    border-radius: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: bold;
    font-size: 16px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    z-index: 2;
  `;
    badge.textContent = `${Math.round(suggestion.score)}点`;
    hoverOverlay.appendChild(badge);

    // 詳細情報パネル
    const panel = document.createElement('div');
    panel.style.cssText = `
    position: fixed;
    left: ${rect.right + 20}px;
    top: ${rect.top}px;
    width: 250px;
    max-height: 300px;
    overflow-y: auto;
    background: white;
    border: 2px solid ${getScoreColor(suggestion.score)};
    border-radius: 12px;
    padding: 16px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
    z-index: 2;
  `;

    const it = state.items[suggestion.id];
    const sc = state.subjectCfg?.[it?.subjKey];

    let panelHTML = `
    <div style="font-weight: bold; font-size: 16px; margin-bottom: 12px; color: #1f2937;">
      ${escapeHtml(sc?.abbr || it?.subjKey || '?')}
    </div>
    <div style="font-size: 13px; color: #6b7280; margin-bottom: 8px;">
      ${DAYJP[suggestion.day]}曜 ${suggestion.period}限目
    </div>
    <div style="border-top: 1px solid #e5e7eb; padding-top: 8px; margin-top: 8px;">
      <div style="font-size: 12px; font-weight: bold; color: #374151; margin-bottom: 4px;">
        評価: ${getScoreLabel(suggestion.score)}
      </div>
  `;

    // 警告を表示
    if (suggestion.validation.warns && suggestion.validation.warns.length > 0) {
      panelHTML += `<div style="margin-top: 8px;">`;
      panelHTML += `<div style="font-size: 11px; font-weight: bold; color: #ef4444; margin-bottom: 4px;">⚠️ 警告 (${suggestion.validation.warns.length}件)</div>`;
      suggestion.validation.warns.slice(0, 3).forEach(warn => {
        const msg = warn.msg || warn;
        panelHTML += `<div style="font-size: 11px; color: #dc2626; padding: 2px 0;">• ${escapeHtml(msg)}</div>`;
      });
      if (suggestion.validation.warns.length > 3) {
        panelHTML += `<div style="font-size: 10px; color: #9ca3af;">他 ${suggestion.validation.warns.length - 3}件...</div>`;
      }
      panelHTML += `</div>`;
    } else {
      panelHTML += `<div style="font-size: 12px; color: #10b981; margin-top: 8px;">✓ 制約違反なし</div>`;
    }

    panelHTML += `</div>`;
    panel.innerHTML = panelHTML;
    hoverOverlay.appendChild(panel);
  }

  function clearHoverSuggestion() {
    currentHoverSuggestion = null;
    if (hoverOverlay) {
      hoverOverlay.innerHTML = '';
    }
  }

  function getScoreColor(score) {
    if (score >= 90) return '#10b981'; // 緑
    if (score >= 70) return '#3b82f6'; // 青
    if (score >= 50) return '#f59e0b'; // 橙
    return '#ef4444'; // 赤
  }

  function getScoreLabel(score) {
    if (score >= 90) return '優秀 (推奨)';
    if (score >= 70) return '良好';
    if (score >= 50) return '可能';
    return '要改善';
  }

  /* =======================
     4. 問題分析機能
  ======================= */

  /**
   * 現在の時間割の問題を分析
   */
  function analyzeCurrentProblems() {
    window._aiDebug && console.log('🔍 問題分析開始...');

    const problems = {
      critical: [],    // 重大な問題（ブロッカー）
      warnings: [],    // 警告
      suggestions: [], // 改善提案
      statistics: {}   // 統計情報
    };

    const allIds = Object.keys(state.items);

    // 統計情報を初期化
    problems.statistics = {
      totalItems: allIds.length,
      placedItems: 0,
      unplacedItems: 0,
      itemsWithCritical: 0,
      itemsWithWarnings: 0,
      avgScore: 0
    };

    let totalScore = 0;

    // 各コマを分析
    for (const id of allIds) {
      const plc = state.placements[id];
      const it = state.items[id];
      if (!it) continue;

      if (!plc) {
        // 未配置
        problems.statistics.unplacedItems++;

        // 配置の難易度を計算
        const difficulty = calculatePlacementDifficulty(id);

        if (difficulty > 30) {
          problems.critical.push({
            type: 'unplaced_hard',
            itemId: id,
            message: `配置困難: ${getItemLabel(id)}（難易度${Math.round(difficulty)}）`,
            difficulty
          });
        } else {
          problems.suggestions.push({
            type: 'unplaced',
            itemId: id,
            message: `未配置: ${getItemLabel(id)}`
          });
        }
      } else {
        // 配置済み
        problems.statistics.placedItems++;

        // バリデーション（validatePlacementは別IIFEなのでwindow経由で参照）
        const v = (window.validatePlacement ? window.validatePlacement(id, plc.day, plc.period, 'safe', null) : { blocks: [], warns: [] });
        const score = calculatePlacementScore(id, plc.day, plc.period, v);
        totalScore += score;

        // ブロッカーがある場合（本来あり得ないが）
        if (v.blocks && v.blocks.length > 0) {
          problems.critical.push({
            type: 'blocker',
            itemId: id,
            location: `${DAYJP[plc.day]}${plc.period}`,
            message: `重複: ${getItemLabel(id)} @ ${DAYJP[plc.day]}${plc.period}`,
            blocks: v.blocks
          });
          problems.statistics.itemsWithCritical++;
        }

        // 警告がある場合
        if (v.warns && v.warns.length > 0) {
          problems.warnings.push({
            type: 'warning',
            itemId: id,
            location: `${DAYJP[plc.day]}${plc.period}`,
            message: `警告: ${getItemLabel(id)} @ ${DAYJP[plc.day]}${plc.period}`,
            warns: v.warns,
            score
          });
          problems.statistics.itemsWithWarnings++;
        }

        // スコアが低い場合は改善提案
        if (score < 70 && (!v.blocks || v.blocks.length === 0)) {
          problems.suggestions.push({
            type: 'improvement',
            itemId: id,
            location: `${DAYJP[plc.day]}${plc.period}`,
            message: `改善可能: ${getItemLabel(id)} @ ${DAYJP[plc.day]}${plc.period} (スコア${Math.round(score)}点)`,
            score
          });
        }
      }
    }

    // 平均スコアを計算
    if (problems.statistics.placedItems > 0) {
      problems.statistics.avgScore = totalScore / problems.statistics.placedItems;
    }

    // 同じ科目・クラスの「配置困難」が何十行も並ぶのをまとめる（例: 配置困難: 美Ⅰ 1-2 ×2コマ）
    {
      const grouped = new Map(); const rest = [];
      for (const p of problems.critical) {
        if (p.type !== 'unplaced_hard') { rest.push(p); continue; }
        const key = getItemLabel(p.itemId) + ' ' + ((state.items[p.itemId]?.cls || []).join(','));
        const g = grouped.get(key);
        if (g) { g.count++; g.difficulty = Math.max(g.difficulty, p.difficulty || 0); }
        else grouped.set(key, { ...p, count: 1 });
      }
      for (const g of grouped.values()) {
        g.message = `配置できていない: ${getItemLabel(g.itemId)} ${(state.items[g.itemId]?.cls || []).join(',')}` + (g.count > 1 ? ` ×${g.count}コマ` : '');
        rest.push(g);
      }
      problems.critical = rest;
    }
    // 上の数字と下の一覧の件数をそろえる（以前は上が0なのに一覧が24件と食い違っていた）
    problems.statistics.itemsWithCritical = problems.critical.reduce((a, p) => a + (p.count || 1), 0);

    // 問題を重要度順にソート
    problems.critical.sort((a, b) => (b.difficulty || 0) - (a.difficulty || 0));
    problems.warnings.sort((a, b) => (a.score || 100) - (b.score || 100));
    problems.suggestions.sort((a, b) => (a.score || 100) - (b.score || 100));

    window._aiDebug && console.log('✅ 問題分析完了');
    window._aiDebug && console.log(`  重大: ${problems.critical.length}件`);
    window._aiDebug && console.log(`  警告: ${problems.warnings.length}件`);
    window._aiDebug && console.log(`  改善提案: ${problems.suggestions.length}件`);

    return problems;
  }

  /**
   * 問題分析結果を表示
   */
  function showProblemAnalysisPanel() {
    const problems = analyzeCurrentProblems();

    // モーダルを作成
    const modal = document.createElement('div');
    modal.style.cssText = `
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 90%;
    max-width: 800px;
    max-height: 80vh;
    background: white;
    border-radius: 16px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
    z-index: 10001;
    display: flex;
    flex-direction: column;
  `;

    // ヘッダー
    const header = document.createElement('div');
    header.style.cssText = `
    padding: 20px 24px;
    border-bottom: 2px solid #e5e7eb;
    display: flex;
    justify-content: space-between;
    align-items: center;
  `;
    header.innerHTML = `
    <div>
      <h2 style="font-size: 20px; font-weight: bold; color: #1f2937; margin: 0 0 8px 0;">
        📊 問題分析レポート
      </h2>
      <div style="font-size: 13px; color: #6b7280;">
        現在の時間割の問題を分析しました
      </div>
    </div>
    <button class="pa-close" title="閉じる (Esc)" style="
      background: none;
      border: none;
      font-size: 24px;
      color: #9ca3af;
      cursor: pointer;
      padding: 4px;
      line-height: 1;
    ">×</button>
  `;
    modal.appendChild(header);

    // 統計サマリー
    const stats = document.createElement('div');
    stats.style.cssText = `
    padding: 16px 24px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: 12px;
  `;

    const statItems = [
      { label: '配置済み', value: `${problems.statistics.placedItems}/${problems.statistics.totalItems}` },
      { label: '未配置', value: problems.statistics.unplacedItems },
      { label: '重大問題', value: problems.statistics.itemsWithCritical, color: problems.statistics.itemsWithCritical > 0 ? '#ef4444' : '#10b981' },
      { label: '警告', value: problems.statistics.itemsWithWarnings, color: problems.statistics.itemsWithWarnings > 0 ? '#f59e0b' : '#10b981' },
      { label: '平均スコア', value: `${Math.round(problems.statistics.avgScore)}点` }
    ];

    statItems.forEach(item => {
      const statCard = document.createElement('div');
      statCard.style.cssText = `
      background: rgba(255, 255, 255, 0.15);
      padding: 12px;
      border-radius: 8px;
      text-align: center;
    `;
      statCard.innerHTML = `
      <div style="font-size: 24px; font-weight: bold; color: ${item.color || 'white'}; margin-bottom: 4px;">
        ${item.value}
      </div>
      <div style="font-size: 11px; color: rgba(255, 255, 255, 0.9);">
        ${item.label}
      </div>
    `;
      stats.appendChild(statCard);
    });

    modal.appendChild(stats);

    // コンテンツエリア
    const content = document.createElement('div');
    content.style.cssText = `
    flex: 1;
    overflow-y: auto;
    padding: 20px 24px;
  `;

    // 重大問題
    if (problems.critical.length > 0) {
      content.innerHTML += `
      <div style="margin-bottom: 24px;">
        <h3 style="font-size: 16px; font-weight: bold; color: #ef4444; margin: 0 0 12px 0; display: flex; align-items: center; gap: 8px;">
          <span style="display: inline-block; width: 8px; height: 8px; background: #ef4444; border-radius: 50%;"></span>
          重大問題 (${problems.statistics.itemsWithCritical}件)
        </h3>
        <div style="display: flex; flex-direction: column; gap: 8px;">
          ${problems.critical.slice(0, 10).map(p => `
            <div style="background: #fef2f2; border-left: 4px solid #ef4444; padding: 12px; border-radius: 4px;">
              <div style="font-size: 13px; color: #7f1d1d; font-weight: 600;">${escapeHtml(p.message)}</div>
            </div>
          `).join('')}
          ${problems.critical.length > 10 ? `<div style="font-size: 12px; color: #9ca3af; text-align: center;">他 ${problems.critical.length - 10}件...</div>` : ''}
        </div>
      </div>
    `;
    }

    // 警告
    if (problems.warnings.length > 0) {
      content.innerHTML += `
      <div style="margin-bottom: 24px;">
        <h3 style="font-size: 16px; font-weight: bold; color: #f59e0b; margin: 0 0 12px 0; display: flex; align-items: center; gap: 8px;">
          <span style="display: inline-block; width: 8px; height: 8px; background: #f59e0b; border-radius: 50%;"></span>
          警告 (${problems.warnings.length}件)
        </h3>
        <div style="display: flex; flex-direction: column; gap: 8px;">
          ${problems.warnings.slice(0, 10).map(p => `
            <div style="background: #fffbeb; border-left: 4px solid #f59e0b; padding: 12px; border-radius: 4px;">
              <div style="font-size: 13px; color: #78350f; font-weight: 600;">${escapeHtml(p.message)}</div>
              <div style="font-size: 11px; color: #92400e; margin-top: 4px;">
                ${p.warns.slice(0, 2).map(w => `• ${escapeHtml(w.msg || w)}`).join('<br>')}
              </div>
            </div>
          `).join('')}
          ${problems.warnings.length > 10 ? `<div style="font-size: 12px; color: #9ca3af; text-align: center;">他 ${problems.warnings.length - 10}件...</div>` : ''}
        </div>
      </div>
    `;
    }

    // 改善提案
    if (problems.suggestions.length > 0) {
      content.innerHTML += `
      <div style="margin-bottom: 24px;">
        <h3 style="font-size: 16px; font-weight: bold; color: #3b82f6; margin: 0 0 12px 0; display: flex; align-items: center; gap: 8px;">
          <span style="display: inline-block; width: 8px; height: 8px; background: #3b82f6; border-radius: 50%;"></span>
          改善提案 (${problems.suggestions.length}件)
        </h3>
        <div style="display: flex; flex-direction: column; gap: 8px;">
          ${problems.suggestions.slice(0, 10).map(p => `
            <div style="background: #eff6ff; border-left: 4px solid #3b82f6; padding: 12px; border-radius: 4px;">
              <div style="font-size: 13px; color: #1e3a8a;">${escapeHtml(p.message)}</div>
            </div>
          `).join('')}
          ${problems.suggestions.length > 10 ? `<div style="font-size: 12px; color: #9ca3af; text-align: center;">他 ${problems.suggestions.length - 10}件...</div>` : ''}
        </div>
      </div>
    `;
    }

    // 問題がない場合
    if (problems.critical.length === 0 && problems.warnings.length === 0 && problems.suggestions.length === 0) {
      content.innerHTML = `
      <div style="text-align: center; padding: 40px 20px;">
        <div style="font-size: 48px; margin-bottom: 16px;">🎉</div>
        <div style="font-size: 18px; font-weight: bold; color: #10b981; margin-bottom: 8px;">
          完璧です！
        </div>
        <div style="font-size: 14px; color: #6b7280;">
          現在の時間割に問題は見つかりませんでした
        </div>
      </div>
    `;
    }

    modal.appendChild(content);

    // オーバーレイ
    const overlay = document.createElement('div');
    overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.5);
    z-index: 10000;
  `;
    // ×・背景クリック・Esc のどれでも、窓と暗い背景を両方閉じる
    // （以前は×で窓だけ消え、背景が残って画面が一切クリックできなくなっていた）
    const close = () => { overlay.remove(); modal.remove(); document.removeEventListener('keydown', onKey, true); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    overlay.onclick = close;
    const xb = modal.querySelector('.pa-close'); if (xb) xb.onclick = close;
    document.addEventListener('keydown', onKey, true);

    document.body.appendChild(overlay);
    document.body.appendChild(modal);
  }

  /**
   * アイテムのラベルを取得
   */
  function getItemLabel(id) {
    const it = state.items[id];
    if (!it) return id;
    const sc = state.subjectCfg?.[it.subjKey];
    return sc?.abbr || it.subjKey || id;
  }

  /* =======================
     CSS アニメーション
  ======================= */

  // スタイルを追加
  const styleSheet = document.createElement('style');
  styleSheet.textContent = `
  @keyframes pulse-glow {
    0%, 100% {
      box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.2),
                  0 0 20px rgba(59, 130, 246, 0.4),
                  inset 0 0 20px rgba(59, 130, 246, 0.1);
    }
    50% {
      box-shadow: 0 0 0 8px rgba(59, 130, 246, 0.3),
                  0 0 30px rgba(59, 130, 246, 0.6),
                  inset 0 0 30px rgba(59, 130, 246, 0.2);
    }
  }
`;
  document.head.appendChild(styleSheet);


  /* =======================
     v59: 強化版 深読み探索 (多手連動 / 最適化)
     - 既存3ファイル互換・破壊的変更なし
     - 深読みON時に、より広い候補・探索継続・警告(教員上限/連続)の改善まで狙う
  ======================= */

  // 教員ペナルティ（1日上限超・連続上限超）を idx から計算
  function __teaPenaltyFromIdx(tea, idx) {
    const maxD = teacherDailyMax(tea);
    const maxC = teacherConsecMax(tea);
    let pen = 0;

    for (const day of DAYS) {
      const maxP = maxPeriod(day);
      let load = 0;
      // load: その教員がその日その時限に1つでも授業があるか（spanFillは除外）
      for (let p = 1; p <= maxP; p++) {
        const ids = idx.tea?.[tea]?.[day]?.[p] || [];
        if (ids.some(x => !isSpanFill(x, day, p))) load++;
      }
      if (maxD != null) {
        const ex = Math.max(0, load - maxD);
        pen += ex * ex * 20;
      }
      if (maxC != null) {
        const lunchAfter = Number(state.settings.lunchAfter || 0);
        let best = 0, cur = 0;
        for (let p = 1; p <= maxP; p++) {
          if (lunchAfter && p === lunchAfter + 1) cur = 0;
          const ids = idx.tea?.[tea]?.[day]?.[p] || [];
          const has = ids.some(x => !isSpanFill(x, day, p));
          if (has) { cur++; best = Math.max(best, cur); } else cur = 0;
        }
        const ex = Math.max(0, best - maxC);
        pen += ex * ex * 15;
      }
    }
    return pen;
  }

  function __collectTeachersFromMoves(moves) {
    const set = new Set();
    for (const m of (moves || [])) {
      const it = state.items[m.id];
      for (const t of (it?.teas || [])) set.add(t);
    }
    return Array.from(set);
  }

  function __sumTeaPenalty(teachers, idx) {
    let s = 0;
    for (const t of (teachers || [])) s += __teaPenaltyFromIdx(t, idx);
    return s;
  }

  function __estimateTeacherPenaltyImprovement(moves) {
    if (!moves?.length) return 0;
    const teachers = __collectTeachersFromMoves(moves);
    if (!teachers.length) return 0;
    const idx0 = buildIndex();
    const base = __sumTeaPenalty(teachers, idx0);
    const after = puzWithTempMoves(moves, () => {
      const idx = buildIndex();
      return __sumTeaPenalty(teachers, idx);
    });
    return base - after; // 改善ならプラス
  }

  // 深読み用: 候補スロットを広めに、評価は「警告を減らす」寄りに
  function puzCandidateSlotsDeep(id, baseMovesArr, opts = {}) {
    const it = state.items[id]; if (!it) return [];
    const out = [];
    const curPlc = state.placements[id];
    const CANDS = clampInt(opts.cands, 8, 30, 22);
    const MAX_BLOCKERS = clampInt(opts.maxBlockers, 2, 6, 5);
    // 高速化: 全枠を一度の仮適用で評価
    const infoMap = puzWithBaseAndRemoved(baseMovesArr, id, () => {
      const idx = buildIndex(); const mp = {};
      for (const day of DAYS) {
        const maxP = maxPeriod(day);
        for (let p = 1; p <= maxP; p++) {
          const v = validatePlacement(id, day, p, 'safe', null) || { blocks: ['不明'], warns: [] };
          mp[day + p] = { v, blockers: puzBlockerIdsFromIdx(it, id, day, p, idx) };
        }
      }
      return mp;
    });

    for (const day of DAYS) {
      const maxP = maxPeriod(day);
      for (let p = 1; p <= maxP; p++) {
        if ((it.span || 1) === 2 && p === maxP) continue;
        if (curPlc && curPlc.day === day && curPlc.period === p) continue;

        const info = infoMap[day + p];
        if (!info) continue;

        const blocks = info.v.blocks || [];
        const warns = info.v.warns || [];
        const blockers = info.blockers || [];

        // blocksがあるのに「誰を動かせば解けるか」候補が取れない場合は捨てる
        if (blocks.length && blockers.length === 0) continue;
        if (blockers.length > MAX_BLOCKERS) continue;

        let score = 100;
        score -= blockers.length * 14;
        score -= warns.length * 7;
        if (p <= 2) score += 4;
        if (p <= 4) score += 2;

        // 深読みでは「空き枠ボーナス」を抑え、連動が出る余地も残す
        if (blockers.length === 0) score += 10;

        // 教員負荷（現在のその曜日コマ数）にペナルティ
        for (const tea of (it.teas || [])) {
          const dayLoad = teacherDayCount(tea, day);
          score -= dayLoad * 4;

          // 1日上限を超えそうなら強く避ける（警告を減らす）
          const maxD = teacherDailyMax(tea);
          if (maxD != null) {
            // curPlcが同じ曜日なら、移動前に既に含まれている分を差し引く（近似）
            const curAdj = (curPlc && curPlc.day === day) ? (dayLoad - (it.span || 1)) : dayLoad;
            const after = curAdj + (it.span || 1);
            const ex = Math.max(0, after - maxD);
            score -= ex * 30;
          }
        }

        out.push({ day, p, score, blockersN: blockers.length });
      }
    }

    out.sort((a, b) => b.score - a.score);
    return out.slice(0, CANDS);
  }

  // v63.4: 将棋的長考モード（非同期・限界突破版）
  async function puzSearchOptAsync(targetId, targetDay, targetP, opts = {}, progressCb = null) {
    const tIt = state.items[targetId]; if (!tIt) return null;

    const shogi = !!opts.shogi;
    const deep = !!opts.deep || shogi;
    const start = performance.now ? performance.now() : Date.now();

    // shogiモードの時は限界突破（8000ms / 20万ノード / 20手先）
    const maxMs = clampInt(opts.maxMs, 60, 10000, shogi ? 8000 : (deep ? 900 : 220));
    const maxVisits = clampInt(opts.maxVisits, 300, 300000, shogi ? 200000 : (deep ? 12000 : PUZ_CFG.MAX_VISITS));
    const maxInvolved = clampInt(opts.maxInvolved, 4, 30, shogi ? 20 : (deep ? 10 : PUZ_CFG.MAX_INVOLVED));

    let visits = 0;
    let yields = 0;
    let bestMoves = null;
    let bestScore = -Infinity;

    const seen = new Set();

    function keyOf(moveById) {
      return Object.values(moveById).map(m => `${m.id}@${m.day}${m.period}`).sort().join('|');
    }

    function objectiveScore(moves) {
      const imp = __estimateTeacherPenaltyImprovement(moves);
      const qual = chainQualityScore(moves);
      const steps = Math.max(0, (moves.length || 1) - 1);
      return imp * 0.8 + qual - steps * 1.2;
    }

    function pickWorstBlock(moves) {
      let worst = null;
      for (const m of moves) {
        const inf = puzEvalMove(moves, m.id);
        if (inf.blocks.length === 0) continue;
        if (!worst || (inf.blockers.length > worst.blockers.length)) worst = inf;
      }
      return worst;
    }

    const init = {};
    init[targetId] = { id: targetId, day: targetDay, period: targetP, span: tIt.span || 1 };
    const frontier = [{ moveById: init, prio: 0 }];

    let lastYieldTime = start;

    while (frontier.length) {
      const now = performance.now ? performance.now() : Date.now();

      // 約40msごとにUIスレッドを開放（スタッタリング防止）
      if (now - lastYieldTime > 40) {
        if (progressCb) progressCb(visits, maxVisits);
        await new Promise(r => setTimeout(r, 0));
        lastYieldTime = performance.now ? performance.now() : Date.now();
        yields++;
      }

      if ((now - start) > maxMs) break;
      if (visits > maxVisits) break;

      // Best-first: find max prio in O(n) instead of sorting
      let bestFIdx = 0;
      for (let bi = 1; bi < frontier.length; bi++) {
        if (frontier[bi].prio > frontier[bestFIdx].prio) bestFIdx = bi;
      }
      const node = frontier.splice(bestFIdx, 1)[0];
      const moveById = node.moveById;

      visits++;
      if (Object.keys(moveById).length > maxInvolved) continue;

      const sig = keyOf(moveById);
      if (seen.has(sig)) continue;
      seen.add(sig);

      const moves = Object.values(moveById);

      let dead = false; let worst = null; const mustMove = new Set();
      for (const inf of puzEvalAll(moves)) {
        if (inf.blocks.length && inf.blockers.length === 0) { dead = true; break; }
        if (inf.blocks.length === 0) continue;
        // ロック等で動かせないコマとぶつかる枝は詰み
        if (inf.blockers.some(bk => !puzIsMovable(bk, moveById))) { dead = true; break; }
        for (const bk of inf.blockers) { if (!moveById[bk]) mustMove.add(bk); }
        if (!worst || (inf.blockers.length < worst.blockers.length)) worst = inf;
      }
      // 下限枝刈り: 必ず動かすコマ数が残り手数を超える枝は読まない
      if (!dead && moves.length + mustMove.size > maxInvolved) dead = true;
      if (dead) continue;

      if (!worst) {
        const sim = simulateMoves(moves);
        if (sim.ok) {
          const sc = deep ? objectiveScore(moves) : (chainQualityScore(moves) - Math.max(0, moves.length - 1) * 3);
          if (sc > bestScore) {
            bestScore = sc;
            bestMoves = moves;
          }
        }
        continue;
      }

      const blockers = (worst.blockers || []).filter(b => puzIsMovable(b, moveById));
      if (!blockers.length) continue;

      // ぶつかっているコマは全員いずれ動かすので1つに絞る（A→B/B→A の順列重複を省く）
      const blkList = blockers.slice(0, 1);
      for (const blk of blkList) {
        const baseMovesArr = moves;
        // 深い場合は候補スロットを多く取る
        const slots = deep ? puzCandidateSlotsDeep(blk, baseMovesArr, { cands: 20, maxBlockers: 5 }) : puzCandidateSlots(blk, baseMovesArr);
        for (const s of slots) {
          const bit = state.items[blk];
          const next = { ...moveById };
          next[blk] = { id: blk, day: s.day, period: s.p, span: bit?.span || 1 };
          frontier.push({ moveById: next, prio: node.prio + (s.score || 0) - 60 });
        }
      }
    }

    return bestMoves;
  }
  // v63.4: windowに公開して他スコープからアクセス可能にする
  window.puzSearchOptAsync = puzSearchOptAsync;

  // 深読み: 連鎖探索（探索継続してベストを返す / 追加で教員上限・連続の改善も狙う）
  function puzSearchOpt(targetId, targetDay, targetP, opts = {}) {
    const tIt = state.items[targetId]; if (!tIt) return null;

    const deep = !!opts.deep;
    const start = performance.now ? performance.now() : Date.now();
    const maxMs = clampInt(opts.maxMs, 60, 1800, deep ? 900 : 220);
    const maxVisits = clampInt(opts.maxVisits, 300, 60000, deep ? 12000 : PUZ_CFG.MAX_VISITS);
    const maxInvolved = clampInt(opts.maxInvolved, 4, 14, deep ? 10 : PUZ_CFG.MAX_INVOLVED);

    let visits = 0;
    let bestMoves = null;
    let bestScore = -Infinity;

    const seen = new Set();

    function keyOf(moveById) {
      const ent = Object.values(moveById)
        .map(m => `${m.id}@${m.day}${m.period}`)
        .sort()
        .join('|');
      return ent;
    }

    function objectiveScore(moves) {
      // v63: 教員ペナルティ改善ボーナスを強化し、手数ペナルティを緩和して「深い最適解」を出しやすくする
      const imp = __estimateTeacherPenaltyImprovement(moves);
      const qual = chainQualityScore(moves);
      const steps = Math.max(0, (moves.length || 1) - 1);
      return imp * 0.8 + qual - steps * 1.2;
    }

    function pickWorstBlock(moves) {
      let worst = null;
      for (const m of moves) {
        const inf = puzEvalMove(moves, m.id);
        if (inf.blocks.length === 0) continue;
        if (!worst || (inf.blockers.length > worst.blockers.length)) worst = inf;
      }
      return worst;
    }

    function findOverloadVictimId(currentMoves) {
      // currentMovesが「ブロック無しで成立」している状態で、教員上限/連続をさらに改善するための追加移動候補を1つ返す
      const teachers = __collectTeachersFromMoves(currentMoves);
      if (!teachers.length) return null;

      // 今の状態（currentMoves適用後）の idx を作って最悪の超過を探す
      const res = puzWithTempMoves(currentMoves, () => {
        const idx = buildIndex();
        let best = null;
        for (const tea of teachers) {
          const maxD = teacherDailyMax(tea);
          const maxC = teacherConsecMax(tea);
          for (const day of DAYS) {
            const maxP = maxPeriod(day);
            // load
            let load = 0;
            for (let p = 1; p <= maxP; p++) {
              const ids = idx.tea?.[tea]?.[day]?.[p] || [];
              if (ids.some(x => !isSpanFill(x, day, p))) load++;
            }
            if (maxD != null) {
              const ex = Math.max(0, load - maxD);
              if (ex > 0 && (!best || ex > best.ex)) { best = { type: 'daily', tea, day, ex, idx }; }
            }
            if (maxC != null) {
              const lunchAfter = Number(state.settings.lunchAfter || 0);
              let bestRun = 0, cur = 0;
              for (let p = 1; p <= maxP; p++) {
                if (lunchAfter && p === lunchAfter + 1) cur = 0;
                const ids = idx.tea?.[tea]?.[day]?.[p] || [];
                const has = ids.some(x => !isSpanFill(x, day, p));
                if (has) { cur++; bestRun = Math.max(bestRun, cur); } else cur = 0;
              }
              const ex = Math.max(0, bestRun - maxC);
              if (ex > 0 && (!best || ex > best.ex)) { best = { type: 'consec', tea, day, ex, idx }; }
            }
          }
        }
        return best;
      });

      if (!res) return null;

      // その教員のその日のコマから「動かせそうなコマ」を拾う
      const idx = res.idx || buildIndex();
      const used = new Set(currentMoves.map(m => m.id));
      const maxP = maxPeriod(res.day);
      const cand = [];
      for (let p = 1; p <= maxP; p++) {
        const ids = idx.tea?.[res.tea]?.[res.day]?.[p] || [];
        for (const x of ids) {
          if (isSpanFill(x, res.day, p)) continue;
          if (used.has(x)) continue;
          if (state.placements[x]?.locked) continue;
          cand.push(x);
        }
      }
      // 簡易: span=1 を優先
      cand.sort((a, b) => (puzSpan(a) - puzSpan(b)));
      return cand[0] || null;
    }

    // ノード: {moveById, prio}
    const init = {};
    init[targetId] = { id: targetId, day: targetDay, period: targetP, span: tIt.span || 1 };
    const frontier = [{ moveById: init, prio: 0 }];

    while (frontier.length) {
      const now = performance.now ? performance.now() : Date.now();
      if ((now - start) > maxMs) break;
      if (visits > maxVisits) break;

      // best-first: find max prio in O(n)
      let bestFIdx2 = 0;
      for (let bi = 1; bi < frontier.length; bi++) {
        if (frontier[bi].prio > frontier[bestFIdx2].prio) bestFIdx2 = bi;
      }
      const node = frontier.splice(bestFIdx2, 1)[0];
      const moveById = node.moveById;

      visits++;
      if (Object.keys(moveById).length > maxInvolved) continue;

      const sig = keyOf(moveById);
      if (seen.has(sig)) continue;
      seen.add(sig);

      const moves = Object.values(moveById);

      // 明らかな詰み: blocksがあるのに blocker候補が取れない
      let dead = false; let worst = null; const mustMove = new Set();
      for (const inf of puzEvalAll(moves)) {
        if (inf.blocks.length && inf.blockers.length === 0) { dead = true; break; }
        if (inf.blocks.length === 0) continue;
        // ロック等で動かせないコマとぶつかる枝は詰み
        if (inf.blockers.some(bk => !puzIsMovable(bk, moveById))) { dead = true; break; }
        for (const bk of inf.blockers) { if (!moveById[bk]) mustMove.add(bk); }
        if (!worst || (inf.blockers.length < worst.blockers.length)) worst = inf;
      }
      // 下限枝刈り: 必ず動かすコマ数が残り手数を超える枝は読まない
      if (!dead && moves.length + mustMove.size > maxInvolved) dead = true;
      if (dead) continue;

      if (!worst) {
        const sim = simulateMoves(moves);
        if (sim.ok) {
          const sc = deep ? objectiveScore(moves) : (chainQualityScore(moves) - Math.max(0, moves.length - 1) * 3);
          if (sc > bestScore) {
            bestScore = sc;
            bestMoves = moves;
          }

          // 深読み: さらに教員上限/連続の改善が見込めるなら、追加で1コマ動かす探索を続ける
          if (deep && Object.keys(moveById).length < maxInvolved) {
            const victim = findOverloadVictimId(moves);
            if (victim) {
              const baseMovesArr = moves;
              const slots = puzCandidateSlotsDeep(victim, baseMovesArr, { cands: 18, maxBlockers: 5 });
              for (const s of slots) {
                const vit = state.items[victim];
                const next = { ...moveById };
                next[victim] = { id: victim, day: s.day, period: s.p, span: vit?.span || 1 };
                frontier.push({ moveById: next, prio: node.prio + (s.score || 0) - 40 });
              }
            }
          }
        }
        continue;
      }

      const blockers = (worst.blockers || []).filter(b => puzIsMovable(b, moveById));
      if (!blockers.length) continue;

      // 深読み: blockersを多めに試す（順序を少しランダム化）
      // ぶつかっているコマは全員いずれ動かすので1つに絞る（A→B/B→A の順列重複を省く）
      const blkList = blockers.slice(0, 1);
      for (const blk of blkList) {
        const baseMovesArr = moves;
        const slots = deep ? puzCandidateSlotsDeep(blk, baseMovesArr, { cands: 20, maxBlockers: 5 }) : puzCandidateSlots(blk, baseMovesArr);
        for (const s of slots) {
          const bit = state.items[blk];
          const next = { ...moveById };
          next[blk] = { id: blk, day: s.day, period: s.p, span: bit?.span || 1 };
          frontier.push({ moveById: next, prio: node.prio + (s.score || 0) - 60 });
        }
      }
    }

    return bestMoves;
  }

  function computeGridChainCoreDeep(id, targetSlots, maxResults = 10) {
    const it = state.items[id];
    if (!it) return [];
    const out = [];
    const seen = new Set();
    const start = performance.now ? performance.now() : Date.now();
    const overallMs = 1800; // v63: 深読み全体のタイムアウト延長 (1200→1800)

    // 目標が多すぎると重いので上限
    const slots = (targetSlots || []).slice(0, 36);

    for (const t of slots) {
      const now = performance.now ? performance.now() : Date.now();
      if ((now - start) > overallMs) break;
      if (out.length >= maxResults * 2) break;

      const moves = puzSearchOpt(id, t.day, t.p, { deep: true, maxMs: 350, maxVisits: 12000, maxInvolved: 12 });
      if (!moves || !moves.length) continue;

      const k = movesKey(moves);
      if (seen.has(k)) continue;
      seen.add(k);

      const moves2 = moves.map(m => {
        const cur = state.placements[m.id];
        return { ...m, fromDay: cur?.day, fromPeriod: cur?.period, span: puzSpan(m.id) };
      });

      const depth = moves2.length - 1;
      const qual = chainQualityScore(moves2);
      const imp = __estimateTeacherPenaltyImprovement(moves2);
      const baseScore = 70 + qual + imp * 0.25 - depth * 1.3;

      const prereqs = moves2.filter(m => m.id !== id);
      const desc = prereqs.length
        ? prereqs.map(m => {
          const subj = state.items[m.id]?.subjKey || m.id;
          const from = (m.fromDay != null) ? `${DAYJP[m.fromDay]}${m.fromPeriod}` : '在庫';
          return `${subj} ${from}→${DAYJP[m.day]}${m.period}`;
        }).join(' → ')
        : '直接移動可能';

      const typeLabel = depth === 0 ? '直接'
        : depth === 1 ? '2手連動'
          : depth === 2 ? '3手連動'
            : depth === 3 ? '4手連動'
              : `${depth + 1}手連動`;

      const r = [
        prereqs.length ? `${prereqs.length}コマを連動移動（在庫なし）` : '空き枠',
        desc,
        (imp > 0.1) ? `✓ 教員負荷 改善 +${imp.toFixed(0)}` : null,
        '✓ 全コマ制約チェック済み'
      ].filter(Boolean);

      out.push({
        title: `${typeLabel}(深): ${DAYJP[t.day]}${t.p}限へ`,
        score: Math.round(baseScore),
        reason: r,
        moves: moves2,
        noStock: true,
        chainDepth: depth,
        _deep: true,
      });
    }

    out.sort((a, b) => b.score - a.score);
    // 各手数の偏りを抑える
    const ded = [];
    const byDepth = {};
    for (const s of out) {
      const d = s.chainDepth;
      byDepth[d] = (byDepth[d] || 0) + 1;
      if (byDepth[d] <= 4) ded.push(s);
    }
    return ded.slice(0, maxResults);
  }

  function computeLinkedSuggestionsDeep(id) {
    const it = state.items[id];
    if (!it) return [];
    const curPlc = state.placements[id];

    const slots = [];
    for (const day of DAYS) {
      const maxP = maxPeriod(day);
      for (let p = 1; p <= maxP; p++) {
        if ((it.span || 1) === 2 && p === maxP) continue;
        if (curPlc && curPlc.day === day && curPlc.period === p) continue;

        const v = validatePlacement(id, day, p, 'safe', null) || { blocks: [], warns: [] };
        // 深読みは「完全OK」でも、教員負荷改善が見込める場合は候補に入れる
        let teaPenalty = 0;
        for (const tea of (it.teas || [])) {
          const maxD = teacherDailyMax(tea);
          if (maxD != null) {
            const dayLoad = teacherDayCount(tea, day);
            const curAdj = (curPlc && curPlc.day === day) ? (dayLoad - (it.span || 1)) : dayLoad;
            const after = curAdj + (it.span || 1);
            const ex = Math.max(0, after - maxD);
            teaPenalty += ex * 25;
          }
        }

        if (v.blocks.length === 0 && v.warns.length === 0 && teaPenalty <= 0) continue;

        const priority = 110 - v.blocks.length * 18 - v.warns.length * 8 - teaPenalty + (p <= 3 ? 2 : 0);
        slots.push({ day, p, priority });
      }
    }
    slots.sort((a, b) => b.priority - a.priority);

    const topSlots = slots.slice(0, 28);
    return computeGridChainCoreDeep(id, topSlots, 10);
  }

  // 先読みタブ用：深読みの最適化提案（いったん連動深の上位を返す）
  function computeDeepOptimizeSuggestions(id) {
    const s = computeLinkedSuggestionsDeep(id);
    return (s || []).map(x => ({ ...x, title: `🧠最適化: ${x.title}`, score: (x.score || 0) + 6 }));
  }

  // 深読み回転：長めの回転(3〜6)も探索（時間内に見つかったもののみ）
  function computeCycleSuggestionsDeep(id) {
    // 既存の回転に加え、深い回転候補を追加
    const base = (typeof computeCycleSuggestions === 'function') ? computeCycleSuggestions(id) : [];
    const it0 = state.items[id];
    const plc0 = state.placements[id];
    if (!it0 || !plc0) return base;

    const out = [];
    const start = performance.now ? performance.now() : Date.now();
    const timeLimit = 520;

    // 関連集合（同一教員/クラス/教室で衝突しやすい近傍）を作る
    const idx0 = buildIndex();
    const rel = new Set();
    for (const tea of (it0.teas || [])) {
      for (const day of DAYS) {
        const maxP = maxPeriod(day);
        for (let p = 1; p <= maxP; p++) {
          (idx0.tea?.[tea]?.[day]?.[p] || []).forEach(x => { if (x && x !== id) rel.add(x); });
        }
      }
    }
    for (const c of (it0.cls || [])) {
      for (const day of DAYS) {
        const maxP = maxPeriod(day);
        for (let p = 1; p <= maxP; p++) {
          (idx0.cls?.[c]?.[day]?.[p] || []).forEach(x => { if (x && x !== id) rel.add(x); });
        }
      }
    }
    if (state.settings.roomConflict) {
      for (const r of (it0.rooms || [])) {
        for (const day of DAYS) {
          const maxP = maxPeriod(day);
          for (let p = 1; p <= maxP; p++) {
            (idx0.room?.[r]?.[day]?.[p] || []).forEach(x => { if (x && x !== id) rel.add(x); });
          }
        }
      }
    }

    const relIds = Array.from(rel)
      .filter(x => state.placements[x] && !state.placements[x].locked)
      .slice(0, 140);

    // 一時的に placements を null にするヘルパ
    function withTempNull(ids, fn) {
      const backup = {};
      for (const x of ids) { backup[x] = state.placements[x]; state.placements[x] = null; }
      invalidateIndex();
      try { return fn(); }
      finally {
        for (const x in backup) state.placements[x] = backup[x];
        invalidateIndex();
      }
    }

    // DFS でサイクル構築（最大6手）
    const origin = { day: plc0.day, period: plc0.period };
    const maxLen = 6;

    function tryCycle(path) {
      const now = performance.now ? performance.now() : Date.now();
      if ((now - start) > timeLimit) return;

      const last = path[path.length - 1];
      if (path.length >= 3) {
        // close possible?
        const ignoreIds = new Set(path);
        const okClose = withTempNull(Array.from(ignoreIds), () => {
          const v = validatePlacement(last, origin.day, origin.period, 'safe', null);
          return (v.blocks || []).length === 0;
        });
        if (okClose) {
          const moves = [];
          for (let i = 0; i < path.length; i++) {
            const curId = path[i];
            const nextId = (i === path.length - 1) ? path[0] : path[i + 1];
            const dest = state.placements[nextId];
            const curIt = state.items[curId];
            if (!dest || !curIt) return;
            moves.push({ id: curId, day: dest.day, period: dest.period, span: curIt.span || 1 });
          }
          const sim = simulateMoves(moves);
          if (sim.ok) {
            const qs = chainQualityScore(moves);
            const imp = __estimateTeacherPenaltyImprovement(moves);
            out.push({
              title: `${path.length}コマ回転(深): →${DAYJP[state.placements[path[1]]?.day]}${state.placements[path[1]]?.period}`,
              score: 62 + qs + imp * 0.2,
              reason: [`${path.length}コマの回転（在庫なし）`, (imp > 0.1 ? `教員負荷 改善 +${imp.toFixed(0)}` : '')].filter(Boolean),
              moves, noStock: true, _deep: true,
            });
          }
        }
      }

      if (path.length >= maxLen) return;
      const used = new Set(path);

      // 次候補: relIds のうち未使用
      // 適当に上位だけ試す（時間のため）
      for (let i = 0; i < relIds.length; i++) {
        const now2 = performance.now ? performance.now() : Date.now();
        if ((now2 - start) > timeLimit) return;
        const nxt = relIds[i];
        if (used.has(nxt)) continue;

        const dest = state.placements[nxt];
        if (!dest) continue;
        const ignoreIds = new Set(path); ignoreIds.add(nxt);

        // last が nxt の場所へ行けるか（cycle内は一旦外す想定）
        const okEdge = withTempNull(Array.from(ignoreIds), () => {
          const v = validatePlacement(last, dest.day, dest.period, 'safe', null);
          return (v.blocks || []).length === 0;
        });
        if (!okEdge) continue;

        tryCycle([...path, nxt]);
        if (out.length >= 10) return;
      }
    }

    try {
      tryCycle([id]);
    } catch (e) {
      console.error('deep cycle search error', e);
    }

    // merge + dedup
    const all = [...base, ...out];
    const seen = new Set();
    const merged = all.filter(s => {
      const k = movesKey(s.moves);
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    merged.sort((a, b) => (b.score || 0) - (a.score || 0));
    return merged.slice(0, 10);
  }


  /* =======================
     エクスポート
  ======================= */

  // グローバルスコープに公開
  if (typeof window !== 'undefined') {
    window.computeEnhancedLookaheadSuggestions = computeEnhancedLookaheadSuggestions;
    window.showHoverSuggestion = showHoverSuggestion;
    window.clearHoverSuggestion = clearHoverSuggestion;
    window.analyzeCurrentProblems = analyzeCurrentProblems;
    window.showProblemAnalysisPanel = showProblemAnalysisPanel;
  }

  window._aiDebug && console.log('✅ 高精度AI提案システム v2.0 読み込み完了');

})();
