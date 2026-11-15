/* 連鎖・パズル型の提案探索（何手も先読みしてコマを動かす）と、提案の詳細表示。
   script.js の後に読み込む。script.js 内で window に公開された関数・定数を使う。 */

// Global helpers (hoisted, accessible from inside IIFE via scope chain)
function clampNum(v, a, b, d) { if (Number.isNaN(v) || v == null) return d; return Math.max(a, Math.min(b, v)); }
function clampInt(v, a, b, d) { const n = parseInt(v, 10); if (Number.isNaN(n)) return d; return Math.max(a, Math.min(b, n)); }




/* =======================
   Puzzle suggestions (multi-step relocation)
   - up to 7 moves / people
   - resolves conflicts by chaining relocations
======================= */

const PUZ_CFG = {
  MAX_INVOLVED: 12,    // v63: さらに深い連動を許可 (8→12)
  MAX_SUGS: 16,        // v63.2: 提案数上限 (12→16)
  MAX_TARGETS: 32,     // v63.2: ターゲット探索上限 (24→32)
  MAX_VISITS: 8000,    // v63.2: 探索数上限 (6000→8000) 退避なし提案を増やすため
  SLOT_CANDS: 20,      // v63.2: (16→20)
  MAX_BLOCKERS_PER_SLOT: 6, // v63.2: (5→6)
};

function puzSpan(id) { return state.items[id]?.span || 1; }
function puzParallelOK(aId, bId) {
  const a = state.items[aId], b = state.items[bId];
  return !!(a?.parallel && b?.parallel);
}

function puzWithTempMoves(moves, fn) {
  const uniq = []; const seen = new Set();
  for (const m of (moves || [])) {
    if (!m?.id || seen.has(m.id)) continue;
    seen.add(m.id); uniq.push(m);
  }
  const backup = {};
  for (const m of uniq) { backup[m.id] = state.placements[m.id]; state.placements[m.id] = null; }
  for (const m of uniq) {
    state.placements[m.id] = { day: m.day, period: m.period, locked: backup[m.id]?.locked || false };
  }
  invalidateIndex();
  try { return fn(); }
  finally {
    for (const id in backup) state.placements[id] = backup[id];
    invalidateIndex();
  }
}

function puzBlockerIdsFromIdx(it, id, day, period, idx) {
  const set = new Set();
  const span = it.span || 1;

  for (let k = 0; k < span; k++) {
    const p = period + k;

    for (const tea of (it.teas || [])) {
      const ids = idx.tea?.[tea]?.[day]?.[p] || [];
      for (const x of ids) set.add(x);
    }
    for (const cls of (it.cls || [])) {
      const ids = idx.cls?.[cls]?.[day]?.[p] || [];
      for (const x of ids) set.add(x);
    }
    if (state.settings.roomConflict) {
      for (const room of (it.rooms || [])) {
        const ids = idx.room?.[room]?.[day]?.[p] || [];
        for (const x of ids) set.add(x);
      }
    }
  }

  set.delete(id);
  const out = [];
  for (const x of set) {
    if (typeof isSpanFill === 'function' && isSpanFill(x, day, period)) continue;
    if (puzParallelOK(id, x)) continue;
    out.push(x);
  }
  return out;
}

function puzEvalMove(moves, mid) {
  return puzWithTempMoves(moves, () => {
    const it = state.items[mid];
    if (!it) return { mid, blocks: ['不明'], warns: [], blockers: [] };
    const idx = buildIndex();
    const m = moves.find(x => x.id === mid);
    const v = validatePlacement(mid, m.day, m.period, 'safe', null) || { blocks: ['不明'], warns: [] };
    const blockers = puzBlockerIdsFromIdx(it, mid, m.day, m.period, idx);
    return { mid, blocks: (v.blocks || []), warns: (v.warns || []), blockers };
  });
}

// 1ノード分の全移動を一度の仮適用・一度の索引構築で評価する（従来は移動ごとに索引を作り直していた）
function puzEvalAll(moves) {
  return puzWithTempMoves(moves, () => {
    const idx = buildIndex();
    return moves.map(m => {
      const it = state.items[m.id];
      if (!it) return { mid: m.id, blocks: ['不明'], warns: [], blockers: [] };
      const v = validatePlacement(m.id, m.day, m.period, 'safe', null) || { blocks: ['不明'], warns: [] };
      const blockers = puzBlockerIdsFromIdx(it, m.id, m.day, m.period, idx);
      return { mid: m.id, blocks: (v.blocks || []), warns: (v.warns || []), blockers };
    });
  });
}
// 「基準の移動を適用し、さらに id を盤面から外した状態」で fn を実行する（候補枠を一括評価するため）
function puzWithBaseAndRemoved(baseMovesArr, id, fn) {
  return puzWithTempMoves(baseMovesArr, () => {
    const bk = state.placements[id];
    state.placements[id] = null; invalidateIndex();
    try { return fn(); } finally { state.placements[id] = bk; invalidateIndex(); }
  });
}

function puzIsMovable(id, moveById) {
  if (!id) return false;
  if (moveById[id]) return false;
  if (state.placements[id]?.locked) return false;
  return true;
}

function puzCandidateSlots(id, baseMovesArr) {
  const it = state.items[id]; if (!it) return [];
  const out = [];
  const curPlc = state.placements[id];

  // 高速化: 基準の移動を一度だけ適用し、id を盤面から外した状態で全枠を評価する
  // （従来は枠ごとに仮適用→索引構築を繰り返しており、1回の探索で数百回の索引構築が発生していた）
  const infos = puzWithBaseAndRemoved(baseMovesArr, id, () => {
    const idx = buildIndex();
    const arr = [];
    for (const day of DAYS) {
      const maxP = maxPeriod(day);
      for (let p = 1; p <= maxP; p++) {
        if ((it.span || 1) === 2 && p === maxP) continue;
        if (curPlc && curPlc.day === day && curPlc.period === p) continue;
        const v = validatePlacement(id, day, p, 'safe', null) || { blocks: ['不明'], warns: [] };
        const blockers = puzBlockerIdsFromIdx(it, id, day, p, idx);
        let soft = 0;
        try { if (typeof softPlacementPenalty === 'function') soft = softPlacementPenalty(id, day, p); } catch (e) { }
        arr.push({ day, p, v, blockers, soft });
      }
    }
    return arr;
  });
  for (const info of infos) {
    const { day, p } = info;
    {

      const blocks = info.v.blocks || [];
      const warns = info.v.warns || [];
      const blockers = info.blockers || [];

      if (blocks.length && blockers.length === 0) continue;
      if (blockers.length > PUZ_CFG.MAX_BLOCKERS_PER_SLOT) continue;

      let score = 100;
      score -= blockers.length * 16; // v49: 18→16
      score -= warns.length * 5;     // v49: 6→5
      if (p <= 2) score += 4;
      if (p <= 4) score += 2;

      // v49+: 教員負荷ペナルティ（先生の1日コマ数が多い日は避ける）
      for (const tea of (it.teas || [])) {
        const dayLoad = teacherDayCount(tea, day);
        score -= dayLoad * 3;
      }

      // v49+: ブロッカーが0（空き枠）は大幅ボーナス（在庫不使用の積極誘導）
      if (blockers.length === 0) score += 25;

      // 連鎖の質（上手くハマる手）を優先
      score -= (info.soft || 0);

      out.push({ day, p, score, blockersN: blockers.length });
    }
  }

  out.sort((a, b) => b.score - a.score);
  return out.slice(0, PUZ_CFG.SLOT_CANDS);
}


// 提案一式の間だけ有効な探索結果メモ（同じ目的枠を「連動」「パズル」など複数の計算が重ねて探すのを防ぐ）
const __puzMemo = { map: new Map(), clear() { this.map.clear(); } };
function puzSearch(targetId, targetDay, targetP, opts = {}) {
  const tIt = state.items[targetId]; if (!tIt) return null;
  const __maxLimit = Math.max(2, Math.min(PUZ_CFG.MAX_INVOLVED, opts.maxLimit || PUZ_CFG.MAX_INVOLVED));
  const __memoKey = `${targetId}|${targetDay}|${targetP}`;
  const memo = __puzMemo.map.get(__memoKey);
  if (memo) {
    if (memo.moves) return memo.moves;               // 既に解が見つかっている
    if (memo.exhausted >= __maxLimit) return null;   // この手数までは解なしと確定済み
  }

  let visits = 0;
  const seen = new Set();
  // 実時間の締切。満杯の時間割では候補評価ごとに全コマのindexを作り直すため探索が重く、
  // visits 上限だけでは長時間ブロックし得る。締切を超えたら中断フラグで全dfsを即座に畳む。
  const __puzStart = Date.now();
  const __PUZ_DEADLINE = opts.maxMs || (typeof window !== 'undefined' && window.__PUZ_DEADLINE_MS) || 100;
  // 1回のpuzSearchの締切に加え、提案一式(computeSuggestionPack)全体で共有する総締切も尊重する。
  // これにより多数のpuzSearch呼び出しの合計時間が膨らんでポップアップが固まるのを防ぐ。
  const __PUZ_GLOBAL = (typeof window !== 'undefined' && window.__PUZ_GLOBAL_DEADLINE) || 0;
  let __puzAborted = false;

  function keyOf(moveById) {
    const ent = Object.values(moveById)
      .map(m => `${m.id}@${m.day}${m.period}`)
      .sort()
      .join('|');
    return ent;
  }

  let __limit = PUZ_CFG.MAX_INVOLVED; // 反復深化: まず少ない手数で解を探し、見つからなければ手数を増やす

  function dfs(moveById) {
    if (__puzAborted) return null; // 締切超過後は全探索を即座に畳む
    visits++;
    if (visits > PUZ_CFG.MAX_VISITS) return null;
    const now = Date.now();
    if (now - __puzStart > __PUZ_DEADLINE || (__PUZ_GLOBAL && now > __PUZ_GLOBAL)) { __puzAborted = true; return null; }
    if (Object.keys(moveById).length > __limit) return null;

    const moves = Object.values(moveById);

    // ノード内の全移動を一度に評価（索引構築1回）
    const infs = puzEvalAll(moves);
    let worst = null;
    const mustMove = new Set(); // ぶつかっている全コマ＝最終的に必ず動かす必要があるコマ
    for (const inf of infs) {
      if (inf.blocks.length && inf.blockers.length === 0) return null;
      if (inf.blocks.length === 0) continue;
      for (const b of inf.blockers) { if (!moveById[b]) mustMove.add(b); }
      // 動かせないコマ（ロック等）とぶつかっていたらこの枝は詰み
      if (inf.blockers.some(b => !puzIsMovable(b, moveById))) return null;
      // 最も選択肢の少ない（ぶつかりの少ない）移動から片付ける
      if (!worst || (inf.blockers.length < worst.blockers.length)) worst = inf;
    }
    // 下限枝刈り: 残り手数より「必ず動かすコマ」が多ければ、この手数上限では解けない
    const remaining = __limit - moves.length;
    if (mustMove.size > remaining) return null;

    const sig = keyOf(moveById);
    if (seen.has(sig)) return null;
    seen.add(sig);

    if (!worst) {
      const sim = simulateMoves(moves);
      return sim.ok ? moves : null;
    }

    // ぶつかっているコマは全員いずれ動かすので、1つに絞って枝分かれさせる
    // （A→B の順と B→A の順は同じ最終形に至るため、順列の重複探索を省く）
    const blk = (worst.blockers || []).find(b => puzIsMovable(b, moveById));
    if (!blk) return null;
    const baseMovesArr = Object.values(moveById);
    const slots = puzCandidateSlots(blk, baseMovesArr);
    const remAfter = remaining - 1; // このコマを動かした後に残る手数
    for (const s of slots) {
      // 移動先で新たにぶつかる数が残り手数を超える枝は読まない
      if ((s.blockersN || 0) > remAfter) continue;
      if (__puzAborted) return null;
      const bit = state.items[blk];
      const next = { ...moveById };
      next[blk] = { id: blk, day: s.day, period: s.p, span: bit?.span || 1 };
      const res = dfs(next);
      if (res) return res;
    }
    return null;
  }

  const init = {};
  init[targetId] = { id: targetId, day: targetDay, period: targetP, span: tIt.span || 1 };
  // 反復深化: 2手→3手→…と手数の上限を広げながら探す。短い手順を優先しつつ、
  // 時間が許す限り「何手も先」まで深く読む。
  const startLim = Math.max(2, (memo && memo.exhausted ? memo.exhausted + 1 : 2));
  for (let lim = startLim; lim <= __maxLimit; lim++) {
    __limit = lim;
    seen.clear();
    const res = dfs(init);
    if (res) { __puzMemo.map.set(__memoKey, { moves: res }); return res; }
    if (__puzAborted || visits > PUZ_CFG.MAX_VISITS) return null; // 時間切れ: 確定ではないので記録しない
    __puzMemo.map.set(__memoKey, { exhausted: lim });            // この手数では解なしと確定
  }
  return null;
}

// 2段階探索: まず全目的枠を短時間・少ない手数で当たり、残り時間で未解決の有望な枠を深く読む。
// 従来は目的枠ごとに固定の締切を使っていたため、後ろの枠はほとんど探索されなかった。
function puzSearchTwoPass(id, targets, budgetMs) {
  const start = Date.now();
  const globalDl = (typeof window !== 'undefined' && window.__PUZ_GLOBAL_DEADLINE) || 0;
  const deadline = Math.min(start + budgetMs, globalDl || Infinity);
  const left = () => deadline - Date.now();
  const found = new Map();
  const unsolved = [];
  // 1段目: 速い浅読み（〜3手）
  for (const t of targets) {
    if (left() <= 0) break;
    const r = puzSearch(id, t.day, t.p, { maxMs: Math.min(40, left()), maxLimit: 3 });
    if (r) found.set(t.day + t.p, r); else unsolved.push(t);
  }
  // 2段目: 残り時間を未解決の枠に配分して深読み（最大手数まで）
  for (let i = 0; i < unsolved.length; i++) {
    const rem = left(); if (rem <= 15) break;
    const t = unsolved[i];
    const per = Math.max(60, Math.min(400, Math.floor(rem / (unsolved.length - i))));
    const r = puzSearch(id, t.day, t.p, { maxMs: per });
    if (r) found.set(t.day + t.p, r);
  }
  return found;
}

function computePuzzleSuggestions(id) {
  const it = state.items[id];
  if (!it) return [];

  const targets = [];
  for (const day of DAYS) {
    const maxP = maxPeriod(day);
    for (let p = 1; p <= maxP; p++) {
      if ((it.span || 1) === 2 && p === maxP) continue;

      const v = validatePlacement(id, day, p, 'safe', null) || { blocks: [], warns: [] };
      const blockers = puzWithTempMoves([], () => {
        const idx = buildIndex();
        return puzBlockerIdsFromIdx(it, id, day, p, idx);
      });

      if ((v.blocks || []).length && blockers.length === 0) continue;

      const est = 100 - blockers.length * 16 - (v.warns || []).length * 6 + (p <= 2 ? 3 : 0);
      targets.push({ day, p, blockersN: blockers.length, est });
    }
  }
  targets.sort((a, b) => (a.blockersN - b.blockersN) || (b.est - a.est));
  const candTargets = targets.slice(0, PUZ_CFG.MAX_TARGETS);

  const out = [];
  const foundMap = puzSearchTwoPass(id, candTargets, 900);
  for (const t of candTargets) {
    if (out.length >= PUZ_CFG.MAX_SUGS) break;
    const moves = foundMap.get(t.day + t.p);
    if (!moves) continue;

    const moves2 = moves.map(m => {
      const cur = state.placements[m.id];
      return {
        ...m,
        fromDay: cur?.day,
        fromPeriod: cur?.period,
        span: puzSpan(m.id),
      };
    });

    const n = moves2.length;
    let score = 92 - (n - 1) * 12 - t.blockersN * 4;
    const reason = [
      `目的: ${DAYJP[t.day]}${t.p} に入れる`,
      `連動移動: ${n}コマ（最大${PUZ_CFG.MAX_INVOLVED}）`,
      `ブロック想定: ${t.blockersN}`,
    ];
    out.push({
      title: `パズル: ${DAYJP[t.day]}${t.p}へ（${n}コマ連動）`,
      score,
      reason,
      moves: moves2,
    });
  }

  out.sort((a, b) => b.score - a.score);
  return out;
}

/* =======================
   Suggestion detail UI (mini person panels + arrows)
======================= */

function buildMoveChipHTML(m) {
  const it = state.items[m.id]; if (!it) return '';
  const scfg = state.subjectCfg[it.subjKey] || {};
  const abbr = (scfg.abbr || it.subj || '?').slice(0, 4);
  const col = scfg.color || pickColor(it.subjKey || '');
  const from = (m.fromDay != null) ? `${DAYJP[m.fromDay]}${m.fromPeriod}` : '在庫';
  const to = `${DAYJP[m.day]}${m.period}${(it.span === 2) ? '–' + (m.period + 1) : ''}`;
  return `<span class="puz-chip" style="border-color:${col};background:${hexWithAlpha(col, 0.14)}">
    <b style="color:${col}">${escapeHtml(abbr)}</b>
    <span class="muted">${escapeHtml(from)}</span> → <span>${escapeHtml(to)}</span>
  </span>`;
}

function buildTeacherPanelsHTML(moves) {
  if (!moves?.length) return '';

  const teas = [];
  const seen = new Set();
  for (const m of moves) {
    const it = state.items[m.id];
    for (const t of (it?.teas || [])) {
      if (seen.has(t)) continue;
      seen.add(t); teas.push(t);
      if (teas.length >= 7) break;
    }
    if (teas.length >= 7) break;
  }

  const after = puzWithTempMoves(moves, () => {
    const idx = buildIndex();
    return { idx };
  });

  function cellDotsHTML(ids) {
    const dots = [];
    for (const id of (ids || [])) {
      if (typeof isSpanFill === 'function' && isSpanFill(id)) continue;
      const it = state.items[id]; if (!it) continue;
      const scfg = state.subjectCfg[it.subjKey] || {};
      const col = scfg.color || pickColor(it.subjKey || '');
      dots.push(`<i class="puz-dot" style="background:${col}"></i>`);
      if (dots.length >= 3) break;
    }
    return dots.join('');
  }

  const panels = teas.map(tea => {
    const maxPAll = Math.max(...DAYS.map(d => maxPeriod(d)));
    let html = `<div class="puz-person" data-tea="${escapeAttr(tea)}">
      <div class="puz-title">${escapeHtml(tea)}</div>
      <div class="puz-miniwrap">
        <svg class="puz-svg"></svg>
        <table class="puz-mini">
          <thead><tr><th>限</th>${DAYS.map(d => `<th>${DAYJP[d]}</th>`).join('')}</tr></thead>
          <tbody>`;

    for (let p = 1; p <= maxPAll; p++) {
      html += `<tr><th>${p}</th>`;
      for (const d of DAYS) {
        if (p > maxPeriod(d)) {
          html += `<td class="forbidden"></td>`;
          continue;
        }

        const ids = after.idx.tea?.[tea]?.[d]?.[p] || [];
        const fromIds = moves.filter(m => {
          const it = state.items[m.id];
          return (it?.teas || []).includes(tea) && m.fromDay === d && m.fromPeriod === p;
        }).map(x => x.id);
        const toIds = moves.filter(m => {
          const it = state.items[m.id];
          return (it?.teas || []).includes(tea) && m.day === d && m.period === p;
        }).map(x => x.id);

        const cls = [
          fromIds.length ? 'puz-from' : '',
          toIds.length ? 'puz-to' : '',
          (ids.length ? 'has' : '')
        ].join(' ');

        html += `<td class="${cls}" data-day="${escapeAttr(d)}" data-period="${p}"
                  data-from="${escapeAttr(fromIds.join(' '))}"
                  data-to="${escapeAttr(toIds.join(' '))}">
                  <div class="puz-dots">${cellDotsHTML(ids)}</div>
                </td>`;
      }
      html += `</tr>`;
    }

    html += `</tbody></table></div></div>`;
    return html;
  }).join('');

  return `<div class="puz-panels" id="puz-panel-root">${panels}</div>`;
}

function drawTeacherArrows(moves) {
  const root = document.getElementById('puz-panel-root');
  if (!root) return;

  root.querySelectorAll('.puz-person').forEach(panel => {
    const wrap = panel.querySelector('.puz-miniwrap');
    const svg = panel.querySelector('.puz-svg');
    if (!wrap || !svg) return;

    const tea = panel.dataset.tea;
    const rW = wrap.getBoundingClientRect();

    svg.setAttribute('width', wrap.clientWidth);
    svg.setAttribute('height', wrap.clientHeight);
    svg.innerHTML = `
      <defs>
        <marker id="puzArrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
          <path d="M0,0 L8,4 L0,8 Z"></path>
        </marker>
      </defs>
    `;

    for (const m of moves) {
      const it = state.items[m.id];
      if (!(it?.teas || []).includes(tea)) continue;
      if (m.fromDay == null) continue;

      const fromCell = panel.querySelector(`td[data-day="${CSS.escape(m.fromDay)}"][data-period="${m.fromPeriod}"][data-from~="${CSS.escape(m.id)}"]`);
      const toCell = panel.querySelector(`td[data-day="${CSS.escape(m.day)}"][data-period="${m.period}"][data-to~="${CSS.escape(m.id)}"]`);
      if (!fromCell || !toCell) continue;

      const rf = fromCell.getBoundingClientRect();
      const rt = toCell.getBoundingClientRect();
      const x1 = (rf.left + rf.width / 2) - rW.left;
      const y1 = (rf.top + rf.height / 2) - rW.top;
      const x2 = (rt.left + rt.width / 2) - rW.left;
      const y2 = (rt.top + rt.height / 2) - rW.top;

      const scfg = state.subjectCfg[it.subjKey] || {};
      const col = scfg.color || pickColor(it.subjKey || '');
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', x1); line.setAttribute('y1', y1);
      line.setAttribute('x2', x2); line.setAttribute('y2', y2);
      line.setAttribute('stroke', col);
      line.setAttribute('stroke-width', '2');
      line.setAttribute('marker-end', 'url(#puzArrow)');
      svg.appendChild(line);
    }
  });
}

function showSuggestionDetail(s) {
  if (!s) return;
  const moves = s.moves || [];
  const reason = (s.reason || []).map(x => `• ${escapeHtml(x)}`).join('<br>') || '—';
  const chips = moves.map(buildMoveChipHTML).join('');
  const panels = buildTeacherPanelsHTML(moves);

  const html = `
    <div style="display:flex;flex-direction:column;gap:10px">
      <div><b>${escapeHtml(s.title || '提案')}</b> <span class="muted small">score ${escapeHtml(String(s.score || 0))}</span></div>
      <div class="muted small">${reason}</div>
      <div class="puz-chips">${chips}</div>
      <div class="muted small">▼ 関係教員ミニ窓（科目名なし・矢印で移動）</div>
      ${panels || '<div class="muted small">（関係教員が取得できません）</div>'}
    </div>
  `;

  showModalHTML('提案の詳細', html, null, '閉じる', '閉じる', () => {
    setTimeout(() => drawTeacherArrows(moves), 10);
  });
}


/* =======================
   v35.2 Full-integrated fixes (non-breaking)
   - Prevent double-run AI placement
   - Clear overlays (arrows/badges) reliably
   - Make class period override effective everywhere
   - Make suggestions modal buttons reliable (atomic apply)
   - Visualize AI探索 trials (preview pulse)
======================= */

let __aiPlaceRunning = false;
let __aiRunRunning = false;
let __validSlotTimer = null;
let __previewTimer = null;
let __previewRestore = null;

function __setBtnDisabled(id, v) {
  try {
    const b = document.getElementById(id);
    if (b) b.disabled = !!v;
  } catch { }
}

function clearOverlays() {
  try { clearValidSlots(); } catch { }
  try { hideDragPopup(); } catch { }
  try { hideHoverTip(); } catch { }
  try {
    document.querySelectorAll('.drag-preview,.slot-grade-badge,.validslot-overlay').forEach(n => n.remove());
  } catch { }
}

