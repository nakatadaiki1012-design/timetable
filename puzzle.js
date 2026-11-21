/* 連鎖・パズル型の提案探索（何手も先読みしてコマを動かす）と、提案の詳細表示。
   script.js の後に読み込む。script.js 内で window に公開された関数・定数を使う。 */

// Global helpers (hoisted, accessible from inside IIFE via scope chain)
function clampNum(v, a, b, d) { if (Number.isNaN(v) || v == null) return d; return Math.max(a, Math.min(b, v)); }
// clampInt は script.js の1つに統一（window.clampInt として公開）




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


/* =====================================================================
   収まり探索（fit solver）
   「このコマをこのマスに入れたら、押し出されたコマはどこへ行けば全員収まるか」を
   何手も先まで読む。専用の軽い盤面（どの先生・クラス・教室がいつ埋まっているか）を
   1回だけ作り、1手ごとの差分更新で読むので、従来の探索より桁違いに多くの手を読める。
   見つけた手順は最後に必ず本来の判定（validatePlacement）で確かめてから返す。
===================================================================== */
function fitBuildModel() {
  const slots = [], slotOf = {}, dayStart = [], dayEnd = [];
  for (const d of DAYS) {
    slotOf[d] = {};
    const st = slots.length, mp = maxPeriod(d);
    for (let p = 1; p <= mp; p++) { slotOf[d][p] = slots.length; slots.push({ day: d, p }); }
    for (let k = st; k < slots.length; k++) { dayStart[k] = st; dayEnd[k] = slots.length; }
  }
  const nS = slots.length;
  const ids = Object.keys(state.items), ix = {};
  ids.forEach((id, i) => { ix[id] = i; });
  const N = ids.length;
  const resIx = new Map(), resRoom = [], resCls = [];
  const getRes = (k, kind) => { let r = resIx.get(k); if (r === undefined) { r = resIx.size; resIx.set(k, r); resRoom.push(kind === 2); resCls.push(kind === 1); } return r; };
  const roomOn = !!state.settings.roomConflict;
  const res = new Array(N), span = new Int8Array(N), par = new Uint8Array(N), locked = new Uint8Array(N), pos = new Int16Array(N), subj = new Int32Array(N);
  const subjIx = new Map();
  for (let i = 0; i < N; i++) {
    const it = state.items[ids[i]], r = [];
    for (const t of (it.teas || [])) r.push(getRes('T\u0001' + t, 0));
    for (const c of (it.cls || [])) r.push(getRes('C\u0001' + c, 1));
    if (roomOn) for (const m of (it.rooms || [])) r.push(getRes('R\u0001' + m, 2));
    res[i] = r; span[i] = it.span || 1; par[i] = it.parallel ? 1 : 0;
    if (!subjIx.has(it.subjKey)) subjIx.set(it.subjKey, subjIx.size);
    subj[i] = subjIx.get(it.subjKey);
    const plc = state.placements[ids[i]];
    locked[i] = plc && plc.locked ? 1 : 0;
    const s = plc && plc.day && slotOf[plc.day] ? slotOf[plc.day][plc.period] : undefined;
    pos[i] = (s === undefined) ? -1 : s;
  }
  const occ = new Array(resIx.size * nS);
  const M = { slots, slotOf, nS, ids, ix, N, res, resRoom, resCls, span, par, locked, pos, subj, occ, dayStart, dayEnd, allowed: new Array(N), mark: new Int32Array(N), stamp: 0 };
  for (let i = 0; i < N; i++) if (pos[i] >= 0) fitAdd(M, i, pos[i]);
  return M;
}
function fitAdd(M, i, s) {
  const r = M.res[i], sp = M.span[i], end = M.dayEnd[s];
  for (let k = 0; k < sp && s + k < end; k++) for (let j = 0; j < r.length; j++) { const c = r[j] * M.nS + s + k; (M.occ[c] || (M.occ[c] = [])).push(i); }
}
function fitRemove(M, i, s) {
  const r = M.res[i], sp = M.span[i], end = M.dayEnd[s];
  for (let k = 0; k < sp && s + k < end; k++) for (let j = 0; j < r.length; j++) { const a = M.occ[r[j] * M.nS + s + k]; if (a) { const q = a.indexOf(i); if (q >= 0) a.splice(q, 1); } }
}
// コマ i を置けるマス（他のコマの位置に関係なく決まる条件だけで判定。必要になったコマだけ計算して覚えておく）
function fitAllowed(M, i) {
  let a = M.allowed[i];
  if (a) return a;
  a = [];
  const it = state.items[M.ids[i]];
  for (let s = 0; s < M.nS; s++) {
    const sl = M.slots[s];
    if (s + M.span[i] > M.dayEnd[s]) continue;
    if (staticBlocks(it, sl.day, sl.p).length === 0) a.push(s);
  }
  return (M.allowed[i] = a);
}
// コマ i をマス s に置いたときにぶつかるコマを out に集める（重複なし）
function fitConflicts(M, i, s, out) {
  const r = M.res[i], sp = M.span[i], st = ++M.stamp, mark = M.mark, pi = M.par[i];
  out.length = 0;
  for (let k = 0; k < sp; k++) for (let j = 0; j < r.length; j++) {
    const a = M.occ[r[j] * M.nS + s + k];
    if (!a || !a.length) continue;
    const room = M.resRoom[r[j]];
    for (let q = 0; q < a.length; q++) {
      const x = a[q];
      if (x === i || mark[x] === st) continue;
      if (!room && pi && M.par[x]) continue; // 並列どうしは同じ時間に置ける
      mark[x] = st; out.push(x);
    }
  }
  return out;
}
// 同じ日に同じ科目がもうあるか（あるほど後回しにする。警告の出ない収まり方を先に見つけるため）
function fitSameDayPen(M, i, s) {
  const r = M.res[i]; let pen = 0;
  for (let j = 0; j < r.length; j++) {
    if (!M.resCls[r[j]]) continue;
    for (let t = M.dayStart[s]; t < M.dayEnd[s]; t++) {
      const a = M.occ[r[j] * M.nS + t];
      if (a) for (let q = 0; q < a.length; q++) if (a[q] !== i && M.subj[a[q]] === M.subj[i]) pen++;
    }
  }
  return pen;
}
function fitMix(x) { x = Math.imul(x ^ (x >>> 16), 0x45d9f3b); x = Math.imul(x ^ (x >>> 16), 0x45d9f3b); return (x ^ (x >>> 16)) >>> 0; }

/* target を tslot に入れ、押し出されたコマを全員どこかに収める手順を探す。
   limit = 動かしてよいコマ数（target を含む）。onSolution(placedItems) が true を返したら打ち切る。
   戻り値: { capped: 読み切れずに打ち切ったか, timeout, nodes } */
function fitSearch(M, target, tslot, limit, nodeCap, deadline, onSolution) {
  const isPlaced = new Uint8Array(M.N), newPos = new Int16Array(M.N);
  const pending = [], placed = [];
  const seen = new Set();
  let nodes = 0, capped = false, timeout = false, h1 = 0, h2 = 0;
  const tmp = [];
  function cands(x) {
    const list = [];
    const room = limit - placed.length - pending.length; // 新たに押し出してよい数
    if (room < 0) return list;
    const al = (x === target) ? [tslot] : fitAllowed(M, x);
    for (let a = 0; a < al.length; a++) {
      const s = al[a];
      if (x !== target && s === M.pos[x]) continue;
      fitConflicts(M, x, s, tmp);
      if (tmp.length > room) continue;
      let ok = true;
      for (let q = 0; q < tmp.length; q++) { const k = tmp[q]; if (M.locked[k] || isPlaced[k]) { ok = false; break; } }
      if (!ok) continue;
      list.push({ s, K: tmp.slice(), w: tmp.length * 100 + fitSameDayPen(M, x, s) * 3 });
    }
    list.sort((p, q) => p.w - q.w);
    return list;
  }
  function dfs() {
    if (pending.length === 0) return onSolution(placed, newPos);
    if (++nodes > nodeCap) { capped = true; return true; }
    if ((nodes & 127) === 0 && performance.now() > deadline) { capped = true; timeout = true; return true; }
    const key = h1 * 2097152 + (h2 >>> 11);
    if (seen.has(key)) return false;
    seen.add(key);
    // 置き場所の候補が最も少ないコマから片付ける
    let bx = -1, bl = null;
    for (let q = 0; q < pending.length; q++) {
      const l = cands(pending[q]);
      if (!l.length) return false;
      if (!bl || l.length < bl.length) { bx = pending[q]; bl = l; if (l.length === 1) break; }
    }
    pending.splice(pending.indexOf(bx), 1);
    let stop = false;
    for (let c = 0; c < bl.length && !stop; c++) {
      const { s, K } = bl[c];
      for (let q = 0; q < K.length; q++) { fitRemove(M, K[q], M.pos[K[q]]); pending.push(K[q]); }
      fitAdd(M, bx, s); isPlaced[bx] = 1; newPos[bx] = s; placed.push(bx);
      const z1 = fitMix(bx * 64 + s + 1), z2 = fitMix(bx * 64 + s + 0x9e3779b1);
      h1 = (h1 ^ z1) >>> 0; h2 = (h2 ^ z2) >>> 0;
      stop = dfs();
      h1 = (h1 ^ z1) >>> 0; h2 = (h2 ^ z2) >>> 0;
      placed.pop(); isPlaced[bx] = 0; fitRemove(M, bx, s);
      for (let q = K.length - 1; q >= 0; q--) { pending.splice(pending.lastIndexOf(K[q]), 1); fitAdd(M, K[q], M.pos[K[q]]); }
    }
    pending.push(bx);
    return stop;
  }
  const had = M.pos[target] >= 0;
  if (had) fitRemove(M, target, M.pos[target]);
  pending.push(target);
  try { dfs(); } finally { if (had) fitAdd(M, target, M.pos[target]); }
  return { capped, timeout, nodes };
}

/* あるコマ id について、全マスを対象に「全員が収まる手順」を探す仕事。
   step(ms) を呼ぶたびに ms ミリ秒ぶん進む（画面を固めずに長考できる）。
   手数の少ない順（1手→2手→…）に全マスを一巡ずつ深くしていく。 */
function fitJob(id, opts = {}) {
  const M = fitBuildModel();
  const t = M.ix[id];
  const maxL = opts.maxMoves || 12;
  const baseCap = opts.nodeCap || 3000;
  const maxSweeps = opts.sweeps || 1;
  const cells = [], queue = [];
  const warnBefore = new Map();
  let totalNodes = 0, evals = 0;
  if (t !== undefined && !M.locked[t]) {
    const al = new Set(fitAllowed(M, t)), tmp = [];
    for (let s = 0; s < M.nS; s++) {
      if (s === M.pos[t] || !al.has(s)) continue;
      if (opts.onlySlot && !(M.slots[s].day === opts.onlySlot.day && M.slots[s].p === opts.onlySlot.period)) continue; // 1マスだけを集中的に読む
      fitConflicts(M, t, s, tmp);
      if (tmp.some(k => M.locked[k])) continue; // ロックされたコマとぶつかるマスは入れない
      const c = { s, day: M.slots[s].day, p: M.slots[s].p, L: 1 + tmp.length, best: null, bestL: 0, done: false, sweep: 0, cappedL: 0, tried: new Set() };
      if (c.L > maxL) continue;
      cells.push(c);
    }
    cells.sort((a, b) => a.L - b.L);
    for (const c of cells) queue.push(c);
  }
  const baseWarns = (iid) => {
    if (warnBefore.has(iid)) return warnBefore.get(iid);
    const plc = state.placements[iid];
    let n = 0;
    if (plc && plc.day) { try { n = (validatePlacement(iid, plc.day, plc.period, 'safe', null).warns || []).length; } catch (e) { } }
    warnBefore.set(iid, n); return n;
  };
  function evalSolution(c, placed, newPos) {
    const moves = placed.map(i => ({ id: M.ids[i], day: M.slots[newPos[i]].day, period: M.slots[newPos[i]].p, span: M.span[i] }));
    const key = moves.map(m => m.id + '@' + m.day + m.period).sort().join('|');
    if (c.tried.has(key)) return false;
    c.tried.add(key);
    let before = 0; for (const m of moves) before += baseWarns(m.id);
    evals++;
    const infs = puzEvalAll(moves); // 本来の判定で確かめる
    let after = 0;
    for (const inf of infs) { if (inf.blocks.length) return false; after += inf.warns.length; }
    const newWarns = Math.max(0, after - before);
    if (!c.best || newWarns < c.best.newWarns) { c.best = { moves, newWarns, warnTexts: infs.flatMap(x => x.warns) }; c.bestL = moves.length; }
    return newWarns === 0 || c.tried.size >= (c.L <= 3 ? 12 : 6) + c.sweep * 6;
  }
  function runUnit(c, deadline) {
    const cap = baseCap * Math.pow(6, c.sweep) * (c.L >= 6 ? 2 : 1);
    const before = c.tried.size;
    const r = fitSearch(M, t, c.s, c.L, cap, deadline, (placed, newPos) => evalSolution(c, placed, newPos));
    totalNodes += r.nodes;
    if (c.best && c.best.newWarns === 0) { c.done = true; return; }
    if (r.timeout) return;
    if (r.capped && !c.cappedL && c.tried.size === before) c.cappedL = c.L;
    c.L++;
    // 警告つきの案しか無いときは、あと2手だけ深く読んで警告なしの案を探す
    if (c.L > maxL || (c.best && c.L > c.bestL + 2)) {
      if (!c.best && c.cappedL && c.sweep + 1 < maxSweeps) { c.sweep++; c.L = c.cappedL; c.cappedL = 0; } // 読み切れなかったマスは、後でもっと粘って読み直す
      else c.done = true;
    }
  }
  return {
    cells,
    step(ms) {
      const end = performance.now() + ms;
      while (queue.length && performance.now() < end) {
        const c = queue.shift();
        runUnit(c, opts.hardDeadline ? end : Infinity);
        if (!c.done) queue.push(c);
      }
      return queue.length === 0;
    },
    progress() { const solved = cells.filter(c => c.best).length; return { solved, total: cells.length, remaining: queue.length, nodes: totalNodes, evals }; },
    suggestions(tag) {
      const out = [];
      for (const c of cells) {
        if (!c.best) continue;
        const moves = c.best.moves.map(m => { const cur = state.placements[m.id]; return { ...m, fromDay: cur?.day, fromPeriod: cur?.period }; });
        const depth = moves.length - 1;
        const others = moves.filter(m => m.id !== id);
        const desc = others.map(m => {
          const it = state.items[m.id]; const sc = state.subjectCfg[it?.subjKey] || {};
          const nm = (sc.abbr || it?.subj || m.id) + (it?.cls?.length ? '[' + it.cls.join(',') + ']' : '');
          return `${nm} ${m.fromDay ? DAYJP[m.fromDay] + m.fromPeriod : '在庫'}→${DAYJP[m.day]}${m.period}`;
        }).join(' → ');
        const nw = c.best.newWarns;
        // 時間割の質（先生の連続コマ・同じ教科の偏りなど）がどう変わるか。負なら良くなる
        let dq = 0; try { if (typeof moveDeltaCost === 'function') dq = moveDeltaCost(moves) || 0; } catch (e) { }
        const qNote = dq <= -30 ? '👍 連続コマや偏りが減ります' : dq >= 60 ? '△ 連続コマや偏りが少し増えます' : '';
        out.push({
          title: `${tag || ''}${depth === 0 ? '直接' : (depth + 1) + '手連動'}: ${DAYJP[c.day]}${c.p}限へ`,
          score: Math.max(10, 94 - depth * 5 - nw * 9 - Math.max(-6, Math.min(12, Math.round(dq / 20)))),
          reason: [
            depth === 0 ? '空いています' : `${depth}コマを動かすと全員が収まります（在庫に出るコマなし）`,
            ...(desc ? [desc] : []),
            nw ? `⚠ 注意が${nw}件増えます: ${[...new Set(c.best.warnTexts)].slice(0, 2).join(' / ')}` : '✓ 重複なし・注意も増えません',
            ...(qNote ? [qNote] : []),
          ],
          moves, noStock: true, chainDepth: depth, isFit: true, newWarns: nw, deltaCost: dq,
        });
      }
      return out;
    },
  };
}
// 提案を開いたときに使う同期版（budgetMs の間だけ読む）
function fitSuggestions(id, budgetMs, opts = {}) {
  const job = fitJob(id, { hardDeadline: true, ...opts });
  job.step(budgetMs);
  const out = job.suggestions();
  out._progress = job.progress();
  return out;
}
