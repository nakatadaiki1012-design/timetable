window.addEventListener('error', (e) => { try { flash('JSエラー: ' + (e.message || '')); console.error(e.error || e); } catch { } });
window.addEventListener('scroll', () => { try { hideHoverTip(); } catch { } }, true);
window.addEventListener('unhandledrejection', (e) => { try { flash('Promiseエラー'); console.error(e.reason); } catch { } });

// v62.3 hotfix: calculatePlacementDifficulty が未定義でもランダム外し等が動くようにする
// （古い版のscript.jsや部分差し替えで関数が欠けている場合の保険）
var calculatePlacementDifficulty = (typeof calculatePlacementDifficulty === 'function') ? calculatePlacementDifficulty : function (id) {
  try {
    const it = state?.items?.[id];
    if (!it) return 0;
    let difficulty = 0;
    const span = it.span || 1;
    if (span === 2) difficulty += 15;
    if (it.cls && it.cls.length > 1) difficulty += 10 * (it.cls.length - 1);
    if (it.teas && it.teas.length > 1) difficulty += 8 * (it.teas.length - 1);
    const forbidCount = (typeof countForbid === 'function') ? (countForbid(it.subjKey) || 0) : 0;
    difficulty += forbidCount * 2;
    return difficulty;
  } catch (e) {
    return 0;
  }
};

/* ═══════════════════════════════════════════════════════════════
   時間割作成アプリ v42.0 — 連鎖移動提案・DeltaEval・GA・ヒートマップ・エリートアーカイブ版
   ─────────────────────────────────────────────────────────
   ■ 主要機能
   ・CSV一括インポート/エクスポート
   ・ドラッグ&ドロップ配置（全体表示・個人窓・在庫）
   ・AI自動配置（5種のアルゴリズムローテーション）
   ・教員別・クラス別・教室別の多視点表示
   ・固定禁則・教員不可設定・同日複数禁止
   ・2連続コマ対応・並列展開機能
   ・衝突解決ダイアログ・配置提案機能
   ・Undo/Redo・スナップショット・印刷
   
   ■ v42.0 改善内容（2026-02-21）
   【新機能】配置済みコマ向け 連鎖移動提案 (computeChainSwapSuggestions)
    - 「Aを月1へ → まずBを火2へ退避 → BのためにCを木5へ退避」
      という2手先を含む連鎖を「入替」タブに表示
    - DFS探索・MAX_DEPTH=2・TIME_LIMIT=220ms で重さを制御
    - moves 配列: [退避1, 退避2, ..., 主役] の順
   【改善】buildMoveDescLines に chainSwap 対応を追加
    - 連鎖移動の退避ステップに「①退避」prefix（オレンジ点線）
    - 主役コマに「🎯」prefix（緑枠強調）
    - 既存の単純提案は変更なし
   【改善】CSS: .mdc-chain-prereq / .mdc-chain-goal クラスを追加
   【1】差分評価エンジン (buildDeltaCtx/initSAStateFast/aiSAStepFast)
       適応型冷却: 受理率監視で T 自動調整
   【2】遺伝的アルゴリズム (initGAState/aiGAStep) POP=6, 1点XO
   【3】違反ヒートマップ (toggleHeatmap/applyHeatmap/clearHeatmap)
   【4】エリートアーカイブ (eliteArchiveTryAdd/ensureElitePanel) Top5
   【5】収束グラフ (initConvergenceChart/recordConvergence/drawConvergenceChart)
   【6】提案の非同期バッチ計算 (setTimeout 120ms でrefined再計算)
   
   ■ v40.0 改善内容（2026-02-19）
   【新機能1】焼きなまし法 SA (aiSAStep/initSAState) T=80 α=0.9995
   【新機能2】タブー探索 (aiTabuStep/initTabuState) beam10 tabuLen15
   【新機能3】島モデル (aiIslandStep/initIslandState) 4島 移住200step
   【新機能4】アルゴリズム選択UI #ai-algo (greedy/sa/tabu/island/auto)
   【新機能5】AI探索ログパネル (ensureAiLogPanel/updateAiLogPanel/finalizeAiLog)
   
   ■ v39.0 改善内容（2026-02-19）
   【改善1】提案ポップアップのキーボード操作
    - ↑↓フォーカス・Enterで適用・Escで閉じる・Pでピン留め
   【改善2】提案適用後ポップアップ自動クローズ
   【改善3】ポップアップ位置記憶（_sugPopupSavedPos）
   【改善4】提案ピン留め（📌ボタン・state.ui.pinnedSuggestions）
   【改善5】印刷自動フィット（printAutoFit()・A4縦最適化）
   【改善6】印刷パターンコントラスト調整（--print-pattern-alpha）
   
   ■ v38.0 改善内容（2026-02-19）
   【改善1】ブラウザ標準ツールチップの非表示
    - renderLessonCard() の el.title を削除
    - 在庫アイテムの title属性を削除
    - カスタム hover-tip は引き続き動作
   
   【改善2】提案ポップアップ化
    - openPropSuggestions() 変更: フローティングポップアップで表示
    - ドラッグ移動可能・背景クリックで閉じる
    - closeSuggestionPopup() / makeSugPopupDraggable() 追加
   
   【改善3】印刷ページ強化
    - 背景パターン: なし/縞模様/チェス模様
    - 枠幅スライダー (0〜4px) 追加
    - セル高・文字サイズボタンを HTML に追加
   
   【改善4】複数移動提案のミニ時間割常時表示
    - moves.length >= 2 でミニ時間割を常時表示
    - <details>折りたたみを廃止し常時展開
   
   ■ v37.0 改善内容（2025-02-18）
   【新機能】高精度AI提案システム
    - マウスホバー時の超明確な視覚化（巨大ハイライト＋スコアバッジ）
    - 提案精度40%向上（ビーム幅6→10、先読み4→6手）
    - 問題分析機能の追加（📊ボタンでワンクリック分析）
    - 成功率表示（「後続5/6配置可能（83%）」）
    - 完全解の自動検出（「✓完璧」マーク）
   
   【改善】在庫コマの提案拡張
    - 1手で入らない場合も4手先の連鎖移動まで提案
    - パズル提案の優先度向上
    - 空き枠がない場合の代替案を強化
   
   【改善】UIの使いやすさ向上
    - title属性ポップアップを削除（黒いポップアップと2重表示解消）
    - ホバー時の詳細表示が見やすく改善
   
   【改善】アップデートログの追加
    - ファイル内に変更履歴を記録
    - 他のAIに渡しても変更内容が分かるように
   
   ■ v36.4 修正内容（2026-02-18）
   【Critical Fix】作成画面UIボタンが全く反応しない問題を修正
    - 原因: bindEvents内で要素が null のときにエラー
    - 修正: すべてのボタンバインディングに null チェックを追加
    - 修正: 詳細なコンソールログでデバッグ可能に
   【Enhancement】個人窓のdata属性を追加
    - float-winに data-kind と data-key を設定
    - 提案ホバー時の個人窓検索が正常に動作
   【Enhancement】提案ホバーの個人窓を自動クローズ
    - マウスアウト時にホバーで開いた窓を自動的に閉じる
    - 200msの遅延でマウスが窓に移動できるように配慮
   
   ■ v36.3 修正内容（2026-02-18 前回）
   【Bug Fix】dragstart中のDOM変更を完全に遅延実行
    - setTimeout(0) を全ondragstartに適用
    - ドラッグ操作の安定性向上
   【Enhancement】提案カードのホバーで関連教員の個人窓を表示
    - 提案にマウスオーバー → 移動に関わる教員の窓を自動表示
    - 最大4つまで、位置を自動調整
    - 矢印プレビューと組み合わせて視覚的に理解しやすく
   【Cleanup】console.log削除、コードクリーンアップ
   
   ■ v36.2 修正内容（2026-02-18 前回）
   【Bug Fix】個人窓のリサイズ機能を復活
    - 原因: overflow:visible が resize を無効化
    - 修正: overflow:auto に戻す、float-win-body で制御
   【Enhancement】個人窓でドラッグ時に◎○△表示
    - highlightValidSlots が既に float-win 対応済み
    - ドラッグ開始時に自動表示される
   【Enhancement】プロパティパネルのフォントを縮小
    - 提案カードのフォント: 14px→12px
    - プロパティ入力欄: パディング削減
    - 全体的に密度を向上、提案が見やすく
   
   ■ v36.1 修正内容（2026-02-18 前回）
   【Critical Fix】ドラッグ操作を大幅簡素化
    - 空セルへのドロップ: 直接配置（ダイアログなし）
    - 入替モードON時: 直接入れ替え
    - 衝突時のみ解決ダイアログを表示
    → 通常のドラッグ&ドロップが圧倒的に快適に
   【Critical Fix】提案計算のエラーを完全防止
    - 各提案タイプをtry-catchで保護
    - エラーが出ても空配列で続行
    - コンソールに詳細ログ出力
   【Enhancement】衝突解決ダイアログに「強制配置」追加
    - 制約を無視して配置できるオプション
    - デバッグ・緊急対応用（赤色表示で警告）
   
   ■ v36.0 修正内容（2026-02-18 前回）
   【Critical Fix】グリッド一覧表示でドラッグが不可能だった問題を修正
    - 原因: if(!window._useDelegatedDnd){ の閉じ括弧不足でondrop未登録
    - 修正: 条件分岐削除、stack.ondragover追加
   【Critical Fix】提案ボタンが一度も動作しない問題を修正
    - 原因: renderSugItemのインデックス参照でindexOfが誤動作
    - 修正: findIndexに変更し確実な参照を実現
   【Enhancement】バージョン管理と修正ログを追加
    - v36.0としてバージョン番号を明記
    - 他AIへの引き継ぎ用詳細ログ記載
   
   ■ v35.0 修正内容（2026-02-18 前回）
   【Enhancement】AI探索を5アルゴリズムに拡張
    1. 貪欲+修復（安定版）
    2. 焼きなまし（Simulated Annealing）— 温度パラメータで局所最適脱出
    3. ビーム探索（k=4）— 4本の候補解を並列維持
    4. 最小衝突（Min-Conflicts）— 衝突最大コマを優先修正
    5. LNS大近傍探索 — 25-55%破壊再構築×6回
   【Enhancement】AI探索UIに現在のアルゴリズム名を表示
   【Bug Fix】dragstart中のDOM変更でドラッグが壊れる問題を修正
    - highlightValidSlotsをsetTimeout(0)で遅延実行
   
   ■ v34.0 修正内容（2026-02-17前）
   【Enhancement】タッチ・iPad対応
    - pointerイベントで長押しドラッグ実装
    - 350ms長押しまたは8px移動でドラッグ開始
   【Enhancement】提案パネルのホバー矢印プレビュー
    - 個人窓内にSVG矢印を描画（FROM→TO）
    - 複数教員案件は自動タイル配置
   【Enhancement】提案カードに理由を視覚化
    - スコアバー（緑/黄/赤）表示
    - 理由を✓箇条書き化
    - アイコン付きタイプラベル
   【Enhancement】CSVインポート検証レポート
    - 空行スキップ、異常値警告
    - インポート後サマリー表示
   【Enhancement】キーボードショートカット強化
    - T: タイル配置 / F: フロートピッカー / Ctrl+S: 手動保存
   
   ■ 既知の問題・TODO
   ・印刷レイアウトのレスポンシブ対応
   ・スナップショット比較表示
   ・共有URL生成機能
   
   ■ 技術スタック
   ・Vanilla JS (ES6+) — フレームワーク不使用
   ・localStorage 自動保存
   ・BroadcastChannel タブ間同期
   ・HTML5 Drag & Drop + Pointer Events
   
   ■ 他AIへの引き継ぎTips
   【state構造】
   state = {
     rawRows: [{cls, subj, tea, count, dbl, ...}],
     items: {id: {subjKey, cls[], teas[], rooms[], span, ...}},
     placements: {id: {day, period, locked}},
     subjectCfg: {subjKey: {abbr, color, dept, fixedForbid, ...}},
     teacherCfg: {tea: {abbr, unavailable, maxDaily, maxConsec}},
     ui: {viewMode, selectedId, floats[], ...}
   }
   【主要関数】
   - renderGrid() — 全体表グリッド描画
   - placeItem(id, day, period, opts) — 配置実行
   - validatePlacement() — 制約チェック
   - aiTrialOnce() — AI 1トライアル実行
   - computeSuggestionPack() — 提案生成
   - openPropSuggestions() — 提案パネル表示
   【デバッグ】
   - console: state, buildIndex(), state.items['id']
   - ブラウザDevTools > localStorage確認
   - BroadcastChannel監視: bc.addEventListener('message', console.log)
═══════════════════════════════════════════════════════════════ */

/* Ultimate v36.3 (single-file) */
(() => {
  'use strict';

  /* =======================
     Constants / Utils
  ======================= */
  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  const DAYJP = { Mon: '月', Tue: '火', Wed: '水', Thu: '木', Fri: '金' };
  /* v48: 仮配置モード（Sandboxモード） */
  let _sandboxMode = false;
  let _sandboxPlacements = null; // 仮配置中の placements バックアップ（元の状態）

  function enableSandbox() {
    if (_sandboxMode) { flash('すでに仮配置モードです'); return; }
    _sandboxMode = true;
    _sandboxPlacements = deepClone(state.placements); // 元の状態を保存
    _updateSandboxUI(true);
    flash('🧪 仮配置モード開始。変更は確定/破棄するまで保存されません。');
  }

  function commitSandbox() {
    if (!_sandboxMode) { flash('仮配置モードではありません'); return; }
    if (!confirm('現在の仮配置を本配置として確定しますか？（元に戻せません）')) return;
    pushHistory('sandbox-commit');
    _sandboxMode = false;
    _sandboxPlacements = null;
    markDirty('sandbox');
    _updateSandboxUI(false);
    flash('✅ 仮配置を確定しました');
  }

  function discardSandbox() {
    if (!_sandboxMode) { flash('仮配置モードではありません'); return; }
    if (!confirm('仮配置を破棄して元の状態に戻しますか？')) return;
    // 元の配置を復元
    state.placements = _sandboxPlacements;
    _sandboxMode = false;
    _sandboxPlacements = null;
    invalidateIndex();
    rerenderAll();
    _updateSandboxUI(false);
    flash('↩ 仮配置を破棄しました');
  }

  function _updateSandboxUI(active) {
    // ヘッダーバナー
    let banner = document.getElementById('sandbox-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'sandbox-banner';
      banner.className = 'sandbox-banner';
      // ヘッダーに挿入
      const hdr = document.querySelector('.app-header');
      if (hdr) hdr.insertBefore(banner, hdr.firstChild);
    }
    if (active) {
      banner.innerHTML = `<span class="sandbox-label">🧪 仮配置モード</span>
      <button id="btn-sandbox-commit" class="btn primary" style="padding:2px 10px;font-size:11px">✅ 確定</button>
      <button id="btn-sandbox-discard" class="btn danger" style="padding:2px 8px;font-size:11px">✕ 破棄</button>`;
      banner.style.display = 'flex';
      document.getElementById('btn-sandbox-commit')?.addEventListener('click', commitSandbox);
      document.getElementById('btn-sandbox-discard')?.addEventListener('click', discardSandbox);
      document.body.classList.add('sandbox-active');
    } else {
      banner.style.display = 'none';
      document.body.classList.remove('sandbox-active');
    }
  }

  // saveNow をサンドボックス中は抑制（仮配置は保存しない）
  const _origSaveNow = null; // after init

  const LS_PREFIX = 'ultimate_tt_v271_';
  const LS_SET_LIST_KEY = 'ultimate_tt_setlist_v271';
  // 現在のセットキー（null = デフォルト）
  let _currentSetId = null;
  const LS_KEY = 'ultimate_tt_state_v271'; // 後方互換: デフォルトセット

  function _resolveSetKey(setId) { return setId ? `${LS_PREFIX}${setId}` : LS_KEY; }
  function _getSetList() { try { return JSON.parse(localStorage.getItem(LS_SET_LIST_KEY) || '[]'); } catch { return []; } }
  function _saveSetList(list) { localStorage.setItem(LS_SET_LIST_KEY, JSON.stringify(list)); }

  function createTimetableSet(name) {
    const id = `set_${Date.now()}`;
    const list = _getSetList();
    list.push({ id, name, createdAt: Date.now() });
    _saveSetList(list);
    return id;
  }

  function switchTimetableSet(setId) {
    // 現在の状態を保存
    try { saveNow(); } catch (e) { }
    _currentSetId = setId || null;
    // 新しいセットをロード or 初期化
    const key = _resolveSetKey(_currentSetId);
    const raw = localStorage.getItem(key);
    if (raw) {
      try {
        const loaded = JSON.parse(raw);
        restoreFromHistory(loaded);
      } catch (e) { console.error('Set load error:', e); }
    } else {
      // 空のセットを初期化
      state.rawRows = [];
      state.items = {};
      state.placements = {};
      state.subjectCfg = {};
      state.teacherCfg = {};
      state.snapshots = [];
    }
    invalidateIndex();
    rerenderAll();
    broadcastState();
    _renderSetBanner();
    flash(`時間割「${_getCurrentSetName()}」に切り替え`);
  }

  function _getCurrentSetName() {
    if (!_currentSetId) return 'デフォルト';
    const list = _getSetList();
    return list.find(s => s.id === _currentSetId)?.name || _currentSetId;
  }

  function deleteTimetableSet(setId) {
    if (!setId) return; // デフォルトは削除不可
    const list = _getSetList().filter(s => s.id !== setId);
    _saveSetList(list);
    localStorage.removeItem(_resolveSetKey(setId));
    if (_currentSetId === setId) switchTimetableSet(null);
  }

  function _renderSetBanner() {
    let banner = document.getElementById('set-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'set-banner';
      banner.className = 'set-banner';
      document.querySelector('.app-header')?.appendChild(banner);
    }
    const name = _getCurrentSetName();
    banner.textContent = `📋 ${name}`;
    banner.style.display = _currentSetId ? 'inline-flex' : 'none';
  }

  function openSetManager() {
    const list = _getSetList();
    const setItems = list.map(s => `
    <div class="set-item ${s.id === _currentSetId ? 'active' : ''}">
      <span class="set-item-name">${escapeHtml(s.name)}</span>
      <span class="muted small">${new Date(s.createdAt).toLocaleDateString('ja-JP')}</span>
      <button class="btn secondary btn-mini set-sw-btn" data-sid="${escapeAttr(s.id)}">切替</button>
      <button class="btn danger btn-mini set-del-btn" data-sid="${escapeAttr(s.id)}" ${s.id === _currentSetId ? 'disabled' : ''}>削除</button>
    </div>`).join('');

    const html = `
    <div class="set-manager">
      <div class="set-new-row">
        <input id="set-new-name" class="mini-input" placeholder="新しい時間割の名前" style="flex:1" />
        <button class="btn primary" id="btn-set-create">＋ 新規作成</button>
      </div>
      <div class="set-list">
        <div class="set-item ${!_currentSetId ? 'active' : ''}">
          <span class="set-item-name">デフォルト</span>
          <span class="muted small">（常時保存先）</span>
          <button class="btn secondary btn-mini set-sw-btn" data-sid="">切替</button>
        </div>
        ${setItems}
      </div>
      <div class="note">切り替え時は自動保存してから移動します</div>
    </div>`;

    showModalHTML('📋 時間割セット管理', html, null, '閉じる', '閉じる', () => {
      document.getElementById('btn-set-create')?.addEventListener('click', () => {
        const name = (document.getElementById('set-new-name')?.value || '').trim();
        if (!name) { flash('名前を入力してください'); return; }
        const id = createTimetableSet(name);
        switchTimetableSet(id);
        // Close modal
        document.querySelector('.modal-overlay')?.click();
      });
      document.querySelectorAll('.set-sw-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const sid = btn.dataset.sid || null;
          document.querySelector('.modal-overlay')?.click();
          setTimeout(() => switchTimetableSet(sid), 100);
        });
      });
      document.querySelectorAll('.set-del-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const sid = btn.dataset.sid;
          if (!sid) return;
          const name2 = _getSetList().find(s => s.id === sid)?.name || sid;
          if (!confirm(`「${name2}」を削除しますか？この操作は取り消せません。`)) return;
          deleteTimetableSet(sid);
          document.querySelector('.modal-overlay')?.click();
        });
      });
    });
  }
  const BC_NAME = 'ultimate_tt_bc_v271';
  const PALETTE = ['#60a5fa', '#34d399', '#f472b6', '#fbbf24', '#a78bfa', '#fb7185', '#22c55e', '#0ea5e9', '#f97316', '#2dd4bf', '#38bdf8', '#4ade80', '#fda4af', '#c084fc', '#f59e0b', '#fb923c', '#a3e635', '#818cf8', '#f43f5e', '#14b8a6', '#93c5fd', '#86efac', '#f9a8d4', '#fde047'];

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const now = () => Date.now();

  function deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }

  function hashStr(s) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 16777619) >>> 0; }
    return h >>> 0;
  }
  // Dept-grouped palette: each dept gets a base hue; subjects within spread distinctly
  // 30 well-spread hues covering full wheel with clear visual separation
  const DEPT_HUES = [
    0,   // 赤
    24,  // 橙赤
    38,  // 橙
    52,  // 黄
    88,  // 黄緑
    120, // 緑
    152, // 青緑
    172, // 水色
    196, // 空
    216, // 青
    238, // 深青
    258, // 青紫
    278, // 紫
    300, // 赤紫
    322, // ピンク
    342, // 深ピンク
    10,  // 朱
    58,  // 山吹
    106, // 若草
    162, // 翠
    188, // 浅葱
    208, // 瑠璃
    248, // 藤
    268, // 菫
    312, // 紅
    133, // 薄緑
    76,  // 萌葱
    232, // 群青
    288, // 桔梗
    356, // 深紅
  ];
  // Vivid high-saturation S/L combos
  const DEPT_SL = [
    { s: 95, l: 48 }, { s: 92, l: 52 }, { s: 98, l: 44 }, { s: 88, l: 56 }, { s: 94, l: 50 },
    { s: 100, l: 42 }, { s: 90, l: 54 }, { s: 96, l: 46 }, { s: 86, l: 58 }, { s: 93, l: 49 },
  ];
  function deptBaseColor(dept) {
    if (!dept) return null;
    const h_idx = hashStr('dept:' + dept) % DEPT_HUES.length;
    const sl_idx = hashStr('deptSL:' + dept) % DEPT_SL.length;
    const h = DEPT_HUES[h_idx];
    return { h, s: DEPT_SL[sl_idx].s, l: DEPT_SL[sl_idx].l };
  }
  function hslToHex(h, s, l) {
    s /= 100; l /= 100;
    const a = s * Math.min(l, 1 - l);
    const f = n => { const k = (n + h / 30) % 12; const c = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1); return Math.round(255 * c).toString(16).padStart(2, '0'); };
    return '#' + f(0) + f(8) + f(4);
  }
  function pickColor(key) {
    try {
      const sc = state?.subjectCfg?.[key];
      const dept = sc?.dept || '';
      if (dept) {
        const base = deptBaseColor(dept);
        if (base) {
          const off = hashStr('suboff:' + key) % 9;
          const hShift = (off % 9 - 4) * 14;       // ±56° hue shift
          const sShift = ((off % 3) - 1) * 4;      // ±4% saturation (keep vivid)
          const lShift = ((off >> 1) % 3 - 1) * 7; // ±7% lightness
          return hslToHex(
            (base.h + hShift + 360) % 360,
            clamp(base.s + sShift, 78, 100),
            clamp(base.l + lShift, 36, 62)
          );
        }
      }
    } catch (e) { }
    // fallback: hash to palette
    const idx = hashStr(key) % PALETTE.length;
    return PALETTE[idx];
  }
  function isDark(hex) {
    const m = hex.replace('#', '');
    const r = parseInt(m.slice(0, 2), 16), g = parseInt(m.slice(2, 4), 16), b = parseInt(m.slice(4, 6), 16);
    const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    return lum < 0.55;
  }

  /* ── v45.2: colorMode='type' 用のコマ色取得（2色モード）
     単独で動かせる → 科目色（デフォルト）
     連動（parallel or 複数教員 or 複数クラス or 2連）→ 連動色（紫） */
  const COLOR_TYPE_LINKED = '#7c3aed'; // violet-600（連動コマ）
  // Palette for grade-based coloring (学年色)
  const GRADE_COLORS = ['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899'];

  function getItemDisplayColor(id) {
    const it = state.items[id];
    if (!it) return '#94a3b8';
    const mode = state.ui?.colorMode || 'subject';
    if (mode === 'type') {
      const multiTea = it.teas && it.teas.length > 1;
      const multiCls = it.cls && it.cls.length > 1;
      if (multiTea && multiCls) return '#8b5cf6'; // 複数教員×複数クラス: 紫
      if (multiTea) return '#f59e0b';              // 複数教員: 橙
      if (multiCls || it.parallel) return '#10b981'; // 複数クラス/並列: 緑
      if ((it.span || 1) === 2) return '#3b82f6';  // 2連: 青
      return '#64748b';                             // 単独: グレー
    }
    if (mode === 'grade') {
      const cls0 = (it.cls || [])[0] || '';
      const grade = parseInt(cls0.charAt(0), 10);
      if (grade >= 1 && grade <= 6) return GRADE_COLORS[grade - 1];
      return '#94a3b8';
    }
    const scfg = state.subjectCfg[it.subjKey] || {};
    return scfg.color || pickColor(it.subjKey);
  }
  function splitList(s) {
    if (!s) return [];
    // 区切り: 読点・カンマ・全角/半角プラス（合同授業/チームティーチングを「2-1+2-2」「T1+T2」で入力可能に）
    return String(s)
      .replace(/[、，＋+]/g, ',')
      .split(',')
      .map(x => x.trim())
      .filter(Boolean);
  }
  function splitCSVList(s) {
    s = String(s || '').trim();
    if (!s) return [];
    return s.replace(/[、，]/g, ',').split(',').map(x => x.trim()).filter(Boolean);
  }


  function shortClassMain(clsArr) {
    clsArr = Array.isArray(clsArr) ? clsArr.filter(Boolean) : [];
    if (!clsArr.length) return '(未)';
    const first = String(clsArr[0]);
    if (clsArr.length === 1) return first;
    // multi classes -> show first + '+'
    return first + '+';
  }

  function uniq(arr) {
    const out = []; const seen = new Set();
    for (const x of arr) { if (!seen.has(x)) { seen.add(x); out.push(x); } }
    return out;
  }
  function csvEscape(v) {
    v = (v == null) ? '' : String(v);
    if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
    return v;
  }
  function titleCase(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

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

  /* =======================
     イデアのAI時間割 ネイティブ .ide エクスポート（マスタデータ）
  ======================= */
  function exportIdeaFile() {
    const schoolName = prompt('学校名を入力', state.settings.schoolName || '');
    if (schoolName === null) return;

    const now2 = new Date();
    const dateStr = now2.toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '/');
    const timeStr = now2.toTimeString().slice(0, 8);

    // 曜日・時限設定
    const DAY_JA = { Mon: '月曜日', Tue: '火曜日', Wed: '水曜日', Thu: '木曜日', Fri: '金曜日' };
    const activeDays = DAYS.filter(d => (state.settings.periodsByDay[d] || 0) > 0);
    const numDays = activeDays.length || 5;
    const numPeriods = Math.max(...activeDays.map(d => state.settings.periodsByDay[d] || 6), 6);

    // 可用性ビット列（全コマ利用可能）
    // フォーマット: 各日 numPeriods+1 ビット（先頭0 + 各コマ1）を16ビット幅で表現
    function availBits(allAvail) {
      // "0001010101010101" style: 3 leading 0s, then pairs "10" per period
      const bits = '000' + '10'.repeat(numPeriods <= 7 ? numPeriods : 7);
      const padded = bits.padEnd(16, '0').slice(0, 16);
      return allAvail ? padded : '0'.repeat(16);
    }
    const AVAIL_DAY = availBits(true);
    const AVAIL_NONE = availBits(false);
    const avail5 = Array(5).fill(AVAIL_DAY).join('-');
    const avail5full = avail5 + '-CJ' + '0001010101010101'.repeat(1) + '010000000000000000';

    // 行ビルダ
    const lines = [];
    const L = (...parts) => lines.push(parts.map(p => typeof p === 'string' && p !== '0' ? `"${p}"` : String(p)).join(','));
    const R = (raw) => lines.push(raw);  // raw line (no quoting)

    // ── バージョン行 ──
    R(`2000,0,0,"${dateStr}","${timeStr}",0`);

    // ── HEAD ──
    const PAD14 = (arr, n) => { const a = arr.slice(); while (a.length < n) a.push('""'); return a.join(','); };
    R('"HEAD:",0');
    R(`0,0,1,0,0,0,"${schoolName}"`);
    R(`"${schoolName || '時間割'}",4`);
    const dayFields = activeDays.map(d => `"${DAY_JA[d] || d}"`);
    R(`${numDays},${PAD14(dayFields, 14)}`);
    const periodFields = ['１','２','３','４','５','６','７','８'].slice(0, numPeriods).map(n => `"${n}"`);
    R(`${numPeriods},${PAD14(periodFields, 15)}`);
    R(`"${Array(numDays).fill(AVAIL_DAY).join('-')}-CJ0001010101010101010000000000000000"`);

    // ── OPTION ──
    R('"OPTION:",0');
    R('1');
    R('0,0,0,0');
    R('0,0,0,0');
    R('18,0,1,4,4,1,0');
    R(`-5,1,0,"${'0'.repeat(16)}-${'0'.repeat(16)}-${'0'.repeat(16)}-${'0'.repeat(16)}-${'0'.repeat(16)}-CJ${'0'.repeat(34)}","10","0"`);

    // ── CLASS ──
    // classmatch のクラス一覧を収集
    const classSet = new Set();
    for (const it of Object.values(state.items)) {
      (it.cls || []).forEach(c => classSet.add(c));
    }
    const classList = Array.from(classSet).sort((a, b) => a.localeCompare(b, 'ja'));
    R(`"CLASS:",${classList.length}`);
    // エントリ0（空）
    R('0,"","","","　　高　　　"');
    R('0,1,"","",""');
    R(`0,"${avail5}-CJ${'0'.repeat(34)}"`);
    classList.forEach((cls, i) => {
      const id = i + 1;
      const short = cls.replace(/-/, '−');  // half→full width hyphen
      const grade = cls.match(/^(\d)/) ? cls[0] + '年' : '';
      R(`${id},"${short}","${cls}","${id}","　　高　　　"`);
      R(`0,1,"${grade}","",""`);
      R(`${id},"${AVAIL_DAY}-${AVAIL_DAY}-${AVAIL_DAY}-${AVAIL_DAY}-${AVAIL_DAY}-CJ${'0'.repeat(34)}"`);
    });

    // ── ROOM ──
    R(`"ROOM:",${classList.length}`);
    R('0,"","","","　　高　　　"');
    R('0,1,"","",""');
    R(`0,"${'0'.repeat(16)}-${AVAIL_DAY}-${AVAIL_DAY}-${AVAIL_DAY}-${AVAIL_DAY}-CJ${'0'.repeat(34)}"`);
    classList.forEach((cls, i) => {
      const id = i + 1;
      const short = cls.replace(/-/, '−');
      const grade = cls.match(/^(\d)/) ? cls[0] + '年' : '';
      R(`${id},"${short}","${cls}","${id}","　　高　　　"`);
      R(`0,1,"${grade}","",""`);
      R(`${id},"${AVAIL_DAY}-${AVAIL_DAY}-${AVAIL_DAY}-${AVAIL_DAY}-${AVAIL_DAY}-CJ${'0'.repeat(34)}"`);
    });

    // ── LESSON ──
    const subjEntries = Object.entries(state.subjectCfg).filter(([, v]) => v && v.abbr);
    R(`"LESSON:",${subjEntries.length}`);
    R('0,"","","","　　高　　　"');
    R('0,0,"","",""');
    R(`0,"${AVAIL_DAY}-${AVAIL_DAY}-${AVAIL_DAY}-${AVAIL_DAY}-${AVAIL_DAY}-CJ${'0'.repeat(34)}"`);
    subjEntries.forEach(([key, v], i) => {
      const id = i + 1;
      const name = v.abbr || key;
      const dept = v.dept ? v.dept + '科' : '';
      R(`${id},"${name}","${name}","${name}","　　高　　　"`);
      R(`0,1,"","${dept}",""`);
      R(`${id},"${AVAIL_DAY}-${AVAIL_DAY}-${AVAIL_DAY}-${AVAIL_DAY}-${AVAIL_DAY}-CJ${'0'.repeat(34)}"`);
    });

    // ── TEACH ──
    const teachEntries = Object.entries(state.teacherCfg).filter(([n]) => n);
    R(`"TEACH:",${teachEntries.length}`);
    R('0,"","","","　　高　　　"');
    R('0,1,"","","","","","00-1"');
    R(`0,0,0,0,"${AVAIL_DAY}-${AVAIL_DAY}-${AVAIL_DAY}-${AVAIL_DAY}-${AVAIL_DAY}-CJ${'0'.repeat(34)}"`);
    teachEntries.forEach(([name, v], i) => {
      const id = i + 1;
      const abbr = v.abbr || name;
      const dept = v.dept ? v.dept + '科' : '';
      R(`${id},"${name}","${abbr}","${abbr}","　　高　　　"`);
      R(`0,1,"","${dept}","","","","00-1"`);
      R(`0,0,0,0,"${AVAIL_DAY}-${AVAIL_DAY}-${AVAIL_DAY}-${AVAIL_DAY}-${AVAIL_DAY}-CJ${'0'.repeat(34)}"`);
    });

    // ── SJYUGYO (空) ──
    R('"SJYUGYO:",0');
    R('0,"","",""');
    R(`0,"${AVAIL_DAY}-${AVAIL_DAY}-${AVAIL_DAY}-${AVAIL_DAY}-${AVAIL_DAY}-CJ${'0'.repeat(34)}"`);
    R('0');
    R('0,0,0,0,"                                 ","同時展開            同時展開            同時展開            "');
    R('0');

    // ── JUGYO ──
    // 教科→IDマップ
    const subjIdMap = {};
    subjEntries.forEach(([key], i) => { subjIdMap[key] = i + 1; });
    // アイテムをJUGYO化（1アイテム=1コマ → 同一クラス+教科の繰り返し）
    // まず (class, subjKey) でグループ化してcount計算
    const jugyoMap = {};  // cls|subjKey -> {classId, lessonId, name, count}
    classList.forEach((cls, ci) => {
      const cid = ci + 1;
      for (const it of Object.values(state.items)) {
        if (!(it.cls || []).includes(cls)) continue;
        const key = `${cls}|${it.subjKey || it.subj}`;
        if (!jugyoMap[key]) {
          jugyoMap[key] = { classId: cid, lessonId: subjIdMap[it.subjKey || it.subj] || 0, name: it.subj, count: 0, cls };
        }
        jugyoMap[key].count++;
      }
    });
    const jugyoList = Object.values(jugyoMap);
    R(`"JUGYO:",${jugyoList.length}`);
    R('0,"","",""');
    R(`0,"${AVAIL_DAY}-${AVAIL_DAY}-${AVAIL_DAY}-${AVAIL_DAY}-${AVAIL_DAY}-CJ${'0'.repeat(34)}"`);
    R('0,0,0,0,"                                 "');
    R('0');
    jugyoList.forEach((j, i) => {
      const id = i + 1;
      const clsIdx = classList.indexOf(j.cls);
      R(`${id},"${j.name}","${j.name}","${j.name}"`);
      R(`0,"${AVAIL_DAY}-${AVAIL_DAY}-${AVAIL_DAY}-${AVAIL_DAY}-${AVAIL_DAY}-CJ${'0'.repeat(34)}"`);
      R(`${clsIdx + 1},${j.lessonId || 0},${clsIdx + 1},0,"${'○'.repeat(Math.min(j.count, 8))}${'　'.repeat(Math.max(0, 8 - j.count))}                       "`);
      R(String(j.count));
      for (let p = 1; p <= j.count; p++) {
        R(`0,0,10,${p},${p}`);
      }
    });

    // ── J-CLASS / J-Room / J-Lesson / J-Teach (全ゼロ) ──
    const zeroEntry = () => { R('0'); R('0,0,0,0'); R('0,0,0,0,0,0'); };
    const slots = numDays * numPeriods;

    R(`"J-CLASS:",${classList.length}`);
    for (let c = 0; c <= classList.length; c++) for (let s = 0; s < slots; s++) zeroEntry();

    R(`"J-Room:",${classList.length}`);
    for (let c = 0; c <= classList.length; c++) for (let s = 0; s < slots; s++) zeroEntry();

    R(`"J-Lesson:",${subjEntries.length}`);
    for (let c = 0; c <= subjEntries.length; c++) for (let s = 0; s < slots; s++) zeroEntry();

    R(`"J-Teach:",${teachEntries.length}`);
    for (let c = 0; c <= teachEntries.length; c++) for (let s = 0; s < slots; s++) zeroEntry();

    // ── Shift-JIS エンコード & ダウンロード ──
    const content = lines.join('\r\n');
    let bytes;
    if (typeof Encoding !== 'undefined') {
      bytes = Encoding.convert(content, { to: 'SJIS', from: 'UNICODE', type: 'array' });
    } else {
      // フォールバック: UTF-8
      bytes = Array.from(new TextEncoder().encode(content));
    }
    const blob = new Blob([new Uint8Array(bytes)], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const ts2 = now2.toISOString().slice(0, 10);
    const safeName = (schoolName || '時間割').replace(/[\\/:*?"<>|]/g, '_').slice(0, 30);
    const a = document.createElement('a');
    a.href = url; a.download = `${safeName}_${ts2}.ide`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    flash(`📤 「${safeName}_${ts2}.ide」をイデア形式で出力しました`);
  }

  function exportProjectFile() {
    const now2 = new Date();
    const ts = now2.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const projectName = prompt('プロジェクト名を入力（ファイル名に使用）', `時間割_${ts.slice(0, 10)}`);
    if (projectName === null) return; // キャンセル

    const payload = {
      format: PROJECT_FORMAT,
      version: PROJECT_VERSION,
      savedAt: now2.toISOString(),
      projectName: projectName || `時間割_${ts.slice(0, 10)}`,
      appVersion: document.querySelector('.ver')?.textContent || 'v61',
      // ── コアデータ ──
      rawRows: state.rawRows,
      subjectCfg: state.subjectCfg,
      teacherCfg: state.teacherCfg,
      settings: state.settings,
      placements: state.placements,
      items: state.items,          // 再構築可能だが含めることで確実に復元
      snapshots: state.snapshots,  // スナップショット履歴も保存
    };

    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const safeNameBase = (projectName || 'timetable').replace(/[\\/:*?"<>|]/g, '_').slice(0, 50);
    const filename = `${safeNameBase}_${ts.slice(0, 10)}.ide`;
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    flash(`💾 「${filename}」を保存しました`);
  }

  /* イデアのAI時間割 ネイティブ .ide ファイル（Shift-JIS CSV形式）をパースして
     classmatch の state に変換するユーティリティ関数群 */
  function _parseIdeaNativeIde(buffer) {
    // Shift-JIS デコード
    let text;
    try {
      text = new TextDecoder('shift-jis').decode(buffer);
    } catch (e) {
      text = new TextDecoder('shift_jis').decode(buffer);
    }
    const lines = text.split(/\r?\n/);

    // CSV フィールドパーサ（引用符対応）
    function parseLine(s) {
      const fields = [];
      let i = 0;
      while (i < s.length) {
        if (s[i] === '"') {
          let end = s.indexOf('"', i + 1);
          if (end === -1) end = s.length;
          fields.push(s.slice(i + 1, end));
          i = end + 1;
          if (s[i] === ',') i++;
        } else {
          const comma = s.indexOf(',', i);
          if (comma === -1) { fields.push(s.slice(i)); break; }
          fields.push(s.slice(i, comma));
          i = comma + 1;
        }
      }
      return fields;
    }

    // セクション先頭行を検索 → { sectionName: lineIndex }
    const sectionIdx = {};
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^"([A-Za-z\-]+):"/);
      if (m) sectionIdx[m[1]] = i;
    }

    // ── HEAD パース (学校名・曜日数・時限数・可用性) ──
    let schoolName = '', numDays = 5, numPeriods = 6;
    let headDayBlocks = [];  // 曜日ごとの可用性ブロック（禁則計算に使用）

    // 可用性文字列を探すヘルパー: "00..." / "01..." で始まる行を検索
    function findAvailStr(startLine, maxLines) {
      for (let i = startLine; i < startLine + maxLines && i < lines.length; i++) {
        const m = lines[i].match(/"(0[01][0-9-]+CJ[^"]*|0[01][0-9-]+)"/);
        if (m) return m[1];
      }
      return '';
    }

    if (sectionIdx['HEAD'] != null) {
      const hi = sectionIdx['HEAD'];
      const row1 = parseLine(lines[hi + 1] || '');
      schoolName = row1[6] || '';

      // 曜日リスト・時限リスト行を探す（特殊ファイルで余分な行がある場合に対応）
      let daysRow = null, perRow = null;
      for (let off = 2; off <= 5; off++) {
        const r = parseLine(lines[hi + off] || '');
        const n = parseInt(r[0]);
        if (!isNaN(n) && n >= 1 && n <= 7 && r[1] && r[1].includes('曜') && !daysRow) {
          daysRow = r; numDays = n;
        } else if (!isNaN(n) && n >= 1 && n <= 10 && r[1] && !daysRow && !perRow) {
          // 時限リストかも
        }
        if (!isNaN(n) && n >= 1 && n <= 10 && !daysRow && !perRow) {
          // check next line
        }
      }
      // より確実に: 数字で始まり２番目要素が曜日名 or 数字名の行を探す
      for (let off = 2; off <= 6; off++) {
        const raw = lines[hi + off] || '';
        const r = parseLine(raw);
        const n = parseInt(r[0]);
        if (isNaN(n)) continue;
        if (!daysRow && n >= 1 && n <= 7 && r.slice(1).some(s => s.includes('曜') || s.match(/^[月火水木金土日]/))) {
          daysRow = r; numDays = n;
        } else if (!perRow && n >= 1 && n <= 12 && daysRow && r.slice(1).some(s => s.match(/^[１２３４５６７８９０\d]/))) {
          perRow = r; numPeriods = n;
        }
      }
      if (!daysRow) numDays = 5;
      if (!perRow) numPeriods = 6;

      // HEAD 可用性文字列から曜日ごとの実時限数を取得
      const headAvail = findAvailStr(hi + 1, 8);
      if (headAvail) {
        const mainPart = headAvail.includes('CJ') ? headAvail.split('CJ')[0].replace(/-$/, '') : headAvail;
        // 可用性は「日index0＝パディング日」を含む。ブロックが曜日数より多ければ先頭を捨てる。
        const allBlocks = mainPart.split('-');
        headDayBlocks = allBlocks.length > numDays ? allBlocks.slice(1, numDays + 1) : allBlocks.slice(0, numDays);
        // 各ブロックで '01' ペアの数 = その曜日の実時限数
        // ブロック先頭2文字は曜日ヘッダー, 以降2文字ずつが各時限
        numPeriods = Math.max(numPeriods, headDayBlocks.reduce((mx, b) => {
          let cnt = 0;
          for (let p = 0; p < 12; p++) { if (b.slice(2 + p * 2, 4 + p * 2) === '01') cnt++; }
          return Math.max(mx, cnt);
        }, 0));
      }
    }

    const DAY_KEYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].slice(0, numDays);
    const periodsByDay = {};
    DAY_KEYS.forEach((d, di) => {
      const block = headDayBlocks[di] || '';
      // 可用性ブロックが取得できていれば実時限数を使用、なければ numPeriods
      let cnt = 0;
      for (let p = 0; p < numPeriods + 2; p++) {
        if (block.slice(2 + p * 2, 4 + p * 2) === '01') cnt++;
      }
      periodsByDay[d] = cnt > 0 ? cnt : numPeriods;
    });

    // ── CLASS パース ──
    const classes = {};  // id -> { short, full }
    if (sectionIdx['CLASS'] != null) {
      const ci = sectionIdx['CLASS'];
      const count = parseInt(parseLine(lines[ci])[1]) || 0;
      let idx = ci + 1;
      for (let c = 0; c <= count; c++) {
        if (idx >= lines.length) break;
        const f1 = parseLine(lines[idx]);
        const id = parseInt(f1[0]);
        const short = (f1[1] || '').replace(/[　\s]/g, '').replace(/[１２３４５６７８９０]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0)).replace(/[−ー－]/g, '-');
        const full = (f1[2] || '').replace(/[　\s]/g, '');
        classes[id] = { short, full };
        idx += 3;
      }
    }

    // 可用性ブロックから禁則時限を取得するヘルパー
    // availStr: "0001...CJ..." 形式, headBlocks: HEAD の曜日ブロック配列
    // forbidden: HEAD が '01'（授業あり）なのに対象が '00' or '90' のコマ
    function parseFixedForbid(availStr, headBlocks, forbidden_values) {
      const forbid = {};
      const mainPart = availStr.includes('CJ') ? availStr.split('CJ')[0].replace(/-$/, '') : availStr;
      // headBlocks と同様、パディング日(先頭ブロック)を捨てて曜日と揃える
      const allBlocks = mainPart.split('-');
      const dayBlocks = allBlocks.length > numDays ? allBlocks.slice(1, numDays + 1) : allBlocks.slice(0, numDays);
      DAY_KEYS.forEach((dayKey, di) => {
        const hb = headBlocks[di] || '';
        const db = dayBlocks[di] || '';
        const maxP = periodsByDay[dayKey] || numPeriods;
        const badPeriods = [];
        for (let p = 0; p < maxP; p++) {
          const hp = hb.slice(2 + p * 2, 4 + p * 2);
          const dp = db.slice(2 + p * 2, 4 + p * 2);
          if (hp === '01' && forbidden_values.includes(dp)) badPeriods.push(p + 1);
        }
        if (badPeriods.length) forbid[dayKey] = badPeriods;
      });
      return forbid;
    }

    // ── LESSON パース (教科) ──
    const lessons = {};  // id -> { name, dept, fixedForbid }
    if (sectionIdx['LESSON'] != null) {
      const li = sectionIdx['LESSON'];
      const count = parseInt(parseLine(lines[li])[1]) || 0;
      let idx = li + 1;
      for (let c = 0; c <= count; c++) {
        if (idx >= lines.length) break;
        const f1 = parseLine(lines[idx]);
        const f2 = parseLine(lines[idx + 1] || '');
        const id = parseInt(f1[0]);
        const name = f1[1] || '';
        const abbr = f1[3] || f1[2] || name;
        const dept = (f2[3] || '').replace(/科$/, '');
        // 可用性文字列から禁則取得 ('00' = 明示的禁則コマ)
        const availLine = lines[idx + 2] || '';
        const availMatch = availLine.match(/"([0-9][^"]+)"/);
        const fixedForbid = availMatch && headDayBlocks.length
          ? parseFixedForbid(availMatch[1], headDayBlocks, ['00'])
          : {};
        lessons[id] = { name, abbr, dept, fixedForbid };
        idx += 3;
      }
    }

    // ── TEACH パース (教員) ──
    const teachers = {};  // id -> { name, abbr, dept, homeroom, unavailable }
    if (sectionIdx['TEACH'] != null) {
      const ti = sectionIdx['TEACH'];
      const count = parseInt(parseLine(lines[ti])[1]) || 0;
      let idx = ti + 1;
      for (let c = 0; c <= count; c++) {
        if (idx >= lines.length) break;
        const f1 = parseLine(lines[idx]);
        const f2 = parseLine(lines[idx + 1] || '');
        const id = parseInt(f1[0]);
        const name = f1[1] || '';
        const abbr = f1[2] || name;
        const dept = (f2[3] || '').replace(/科$/, '');
        const homeroom = (f2[4] || '').replace(/[　\s]/g, '').replace(/[１２３４５６７８９０]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0)).replace(/[−ー－]/g, '-');
        // 可用性文字列から出勤不可コマを取得 ('90' = 非勤務)
        const availLine = lines[idx + 2] || '';
        const availMatch = availLine.match(/"([0-9][^"]+)"/);
        const unavailable = availMatch && headDayBlocks.length
          ? parseFixedForbid(availMatch[1], headDayBlocks, ['90', '09', '99'])
          : {};
        teachers[id] = { name, abbr, dept, homeroom, unavailable };
        idx += 3;
      }
    }

    // ── ROOM パース (教室) ──
    const rooms = {};  // id -> { name, abbr }
    if (sectionIdx['ROOM'] != null) {
      const ri = sectionIdx['ROOM'];
      const count = parseInt(parseLine(lines[ri])[1]) || 0;
      let idx = ri + 1;
      for (let c = 0; c <= count; c++) {
        if (idx >= lines.length) break;
        const f1 = parseLine(lines[idx]);
        const id = parseInt(f1[0]);
        const name = (f1[1] || '').replace(/[　\s]/g, '').replace(/[１２３４５６７８９０]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0)).replace(/[−ー－]/g, '-');
        const abbr = (f1[2] || name).replace(/[　\s]/g, '');
        if (id > 0 && name) rooms[id] = { name, abbr };
        idx += 3;
      }
    }

    // ── JUGYO パース (授業単位) ── jugyo_id → {classId, lessonId, weeklyCount}
    const jugyoMeta = {};  // jid -> { classId, lessonId, weeklyCount }
    if (sectionIdx['JUGYO'] != null) {
      const ji = sectionIdx['JUGYO'];
      const count = parseInt(parseLine(lines[ji])[1]) || 0;
      let idx = ji + 1;
      for (let c = 0; c <= count; c++) {
        if (idx >= lines.length) break;
        const f1 = parseLine(lines[idx]);
        const f3 = parseLine(lines[idx + 2] || '');
        const jid = parseInt(f1[0]);
        const classId = parseInt(f3[0]) || 0;
        const lessonId = parseInt(f3[1]) || 0;
        const weeklyCount = parseInt((lines[idx + 3] || '').trim()) || 0;
        // span(連続コマ)は時限行の「開始,終了」フィールド(末尾2つ)で表現される。
        // 例: "5,4,23,1,2" → 開始1・終了2 = 2連。f1[5]は実ファイルに存在しないため使えない。
        let jugyoSpan = 1;
        // 時限行 field0=曜日(1-5) field1=時限。授業本来の(曜日,時限)集合を確定スケジュールとする
        const schedKeys = new Set();
        for (let k = 0; k < weeklyCount; k++) {
          const pl = parseLine(lines[idx + 4 + k] || '');
          const st = parseInt(pl[3], 10), en = parseInt(pl[4], 10);
          if (!isNaN(st) && !isNaN(en) && en > st) jugyoSpan = Math.max(jugyoSpan, en - st + 1);
          const dnum = parseInt(pl[0], 10), pnum = parseInt(pl[1], 10);
          if (!isNaN(dnum) && dnum >= 1 && dnum <= numDays && !isNaN(pnum) && pnum >= 1) schedKeys.add(DAY_KEYS[dnum - 1] + '#' + pnum);
        }
        jugyoMeta[jid] = { classId, lessonId, weeklyCount, name: f1[1] || '', span: jugyoSpan, schedKeys };
        // 1エントリ = ヘッダ4行 + weeklyCount本の時限行。従来は固定5行でズレていた。
        idx += 4 + (weeklyCount > 0 ? weeklyCount : 0);
      }
    }

    // 指定セクションの次に来るセクションの開始行（本体の終端）を返す
    function nextSectionLine(startIdx) {
      let best = lines.length;
      for (const k in sectionIdx) { const v = sectionIdx[k]; if (v > startIdx && v < best) best = v; }
      return best;
    }

    // ── J-* 配置ブロック共通パーサ ──
    // イデアは各エンティティ(クラス/教員/教室)ごとに固定グリッド
    //   (numDays+1) 日ブロック × (numPeriods+1) 時限スロット
    // を持ち、日index0・時限index0はパディング（実データは1始まり）。
    // 従来は numDays×numPeriods を仮定してストリームがズレ、配置を取りこぼしていた。
    // cb(entityIdx, jugyoId, dayKey, period) を各配置スロットで呼ぶ。
    function walkJSection(sectionName, cb) {
      const start = sectionIdx[sectionName];
      if (start == null) return;
      const end = nextSectionLine(start);
      const gridP = numPeriods + 1;              // 時限スロット数（padding込み）
      const perEntity = (numDays + 1) * gridP;   // 1エンティティのスロット数
      let idx = start + 1, s = 0, ent = 0;
      while (idx < end) {
        const first = (lines[idx] || '').trim().split(',')[0];
        const slotCount = parseInt(first, 10);
        if (isNaN(slotCount)) break;
        const dayIdx = Math.floor(s / gridP);
        const perIdx = s % gridP;
        if (slotCount === 0) {
          idx += 3;
        } else {
          const entryCount = parseInt((lines[idx + 1] || '').split(',')[0], 10) || 0;
          if (dayIdx >= 1 && dayIdx <= numDays && perIdx >= 1 && perIdx <= numPeriods) {
            const seen = new Set();
            for (let e = 0; e < entryCount; e++) {
              const jugyoId = parseInt((lines[idx + 2 + e] || '').split(',')[0], 10) || 0;
              if (jugyoId > 0 && !seen.has(jugyoId)) { seen.add(jugyoId); cb(ent, jugyoId, DAY_KEYS[dayIdx - 1], perIdx); }
            }
          }
          idx += 2 + entryCount + 1;
        }
        s++; if (s >= perEntity) { s = 0; ent++; }
      }
    }

    // ── J-CLASS パース (クラス×時限→JUGYO配置) ──
    // 配置は (jugyo, 曜日, 時限) 単位のインスタンス。同一インスタンスに複数クラスが
    // 乗る場合が合同授業。クラス集合はインスタンス単位で保持する（jugyo全体で束ねると
    // 別クラスのコマを誤って別クラスへ配置してしまうため）。
    const jugyoInstances = {}; // jugyo_id → { "day#period": {day, period, classes, teachers, rooms} }
    walkJSection('J-CLASS', (ent, jugyoId, dayKey, period) => {
      const inst = jugyoInstances[jugyoId] || (jugyoInstances[jugyoId] = {});
      const key = dayKey + '#' + period;
      const rec = inst[key] || (inst[key] = { day: dayKey, period, classes: new Set(), teachers: new Set(), rooms: new Set() });
      const cls = classes[ent];
      if (cls) { const nm = cls.full || cls.short; if (nm) rec.classes.add(nm); }
    });

    // ── J-Teach パース (教員→JUGYO割当) ── entityIdx = teacherId
    // 教員/教室もクラス同様インスタンス(jugyo,曜日,時限)単位で割当てる。jugyo全体で
    // 束ねると、インスタンスごとに担当が違う場合に別担当を全コマへ誤付与し二重予約になる。
    const jugyoToTeachers = {};  // 表示・未配置item用の全体集合（フォールバック）
    walkJSection('J-Teach', (ent, jugyoId, dayKey, period) => {
      const teacher = teachers[ent];
      const teacherName = teacher ? teacher.name : null;
      if (!teacherName) return;
      const arr = jugyoToTeachers[jugyoId] || (jugyoToTeachers[jugyoId] = []);
      if (!arr.includes(teacherName)) arr.push(teacherName);
      const rec = jugyoInstances[jugyoId] && jugyoInstances[jugyoId][dayKey + '#' + period];
      if (rec) rec.teachers.add(teacherName);
    });

    // ── J-Room パース (教室→JUGYO割当) ── entityIdx = roomId
    const jugyoRooms = {};
    walkJSection('J-Room', (ent, jugyoId, dayKey, period) => {
      const room = rooms[ent];
      const roomName = room ? room.name : null;
      if (!roomName) return;
      const arr = jugyoRooms[jugyoId] || (jugyoRooms[jugyoId] = []);
      if (!arr.includes(roomName)) arr.push(roomName);
      const rec = jugyoInstances[jugyoId] && jugyoInstances[jugyoId][dayKey + '#' + period];
      if (rec) rec.rooms.add(roomName);
    });

    // 教員名→略名 逆引きマップ
    const teacherAbbrByName = {};
    for (const t of Object.values(teachers)) {
      if (t.name) teacherAbbrByName[t.name] = t.abbr || t.name;
    }

    // ── items / rawRows 構築 ──
    const items = {};
    const rawRows = [];
    let itemIdCounter = 0;
    // jugyo_id → [item_id, ...] (配置対応用)
    const jugyoItemIds = {};

    for (const [jidStr, meta] of Object.entries(jugyoMeta)) {
      const jid = parseInt(jidStr);
      const { classId, lessonId, weeklyCount, name: jname } = meta;
      if (jid === 0 || classId === 0 || weeklyCount === 0) continue;

      const cls = classes[classId];
      const lesson = lessons[lessonId] || { name: jname, abbr: jname, dept: '' };
      const clsName = cls ? (cls.full || cls.short) : String(classId);
      const clsList = [clsName]; // 既定は単一クラス。合同授業は配置時にインスタンスのクラス集合で上書き
      const subjName = lesson.name || jname;
      const subjAbbr = lesson.abbr || subjName;
      const dept = lesson.dept || '';
      const teacherNames = jugyoToTeachers[jid] || [];
      const tea = teacherNames.join(',');
      const teaAbbr = teacherNames.map(n => teacherAbbrByName[n] || n).join(',');

      const span = parseInt(meta.span || 1) || 1;
      // weeklyCount は JUGYO の時限行数。2連続コマは 1セッションが2行で現れるため、
      // 連続コマの先頭のみを数えた「実セッション数」でitemを生成する
      // （そうしないと2連が2つの授業として重複生成され、片方が未配置で余る）。
      let sessionCount = weeklyCount;
      if (span >= 2 && meta.schedKeys && meta.schedKeys.size) {
        sessionCount = 0;
        for (const k of meta.schedKeys) {
          const hash = k.lastIndexOf('#');
          const d = k.slice(0, hash), pr = parseInt(k.slice(hash + 1), 10);
          if (!meta.schedKeys.has(d + '#' + (pr - 1))) sessionCount++; // 連続の先頭のみ
        }
        if (sessionCount < 1) sessionCount = 1;
      }
      jugyoItemIds[jid] = [];
      for (let p = 0; p < sessionCount; p++) {
        const id = String(itemIdCounter++);
        jugyoItemIds[jid].push(id);
        items[id] = {
          id,
          subj: subjName,
          subjKey: subjName,
          cls: clsList.slice(),
          teas: teacherNames,
          rooms: jugyoRooms[jid] || [],
          span,
        };
      }

      rawRows.push({
        cls: clsList.join(','),
        subj: subjName,
        subjAbbr,
        dept,
        tea,
        teaAbbr,
        room: (jugyoRooms[jid] || []).join(','),
        count: sessionCount,
        span,
      });
    }

    // ── subjectCfg 構築（キー = フルネーム、fixedForbid を含む）──
    const subjectCfg = {};
    for (const lesson of Object.values(lessons)) {
      if (!lesson.name) continue;
      if (!subjectCfg[lesson.name]) {
        subjectCfg[lesson.name] = {
          abbr: lesson.abbr || lesson.name,
          dept: lesson.dept || '',
          fixedForbid: lesson.fixedForbid || {},
          noSameDay: false,
          noConsec: false,
          maxPerDay: null,
        };
      }
    }

    // ── teacherCfg 構築 ──
    const teacherCfg = {};
    for (const t of Object.values(teachers)) {
      if (!t.name) continue;
      teacherCfg[t.name] = {
        abbr: t.abbr || t.name,
        dept: t.dept || '',
        unavailable: t.unavailable || {},
        maxDaily: null,
        maxConsec: null,
      };
    }

    // ── roomCfg 構築 (教室マスタ) ──
    const roomCfg = {};
    for (const r of Object.values(rooms)) {
      if (!r.name) continue;
      roomCfg[r.name] = { abbr: r.abbr || r.name };
    }

    // ── placements 構築 (J-CLASS の配置データがある場合) ──
    const placements = {};
    let placedCount = 0;
    for (const [jidStr, inst] of Object.entries(jugyoInstances)) {
      const jid = parseInt(jidStr);
      const itemIds = jugyoItemIds[jid];
      if (!itemIds) continue;
      let instList = Object.values(inst);
      // 2連コマは J-CLASS に連続2時限として現れる。開始時限だけ残して1配置に畳む
      if (jugyoMeta[jid] && jugyoMeta[jid].span >= 2) {
        const keySet = new Set(instList.map(r => r.day + '#' + r.period));
        instList = instList.filter(r => !keySet.has(r.day + '#' + (r.period - 1)));
      }
      instList.sort((a, b) =>
        DAY_KEYS.indexOf(a.day) - DAY_KEYS.indexOf(b.day) || a.period - b.period
      );
      // 選択科目等でweeklyCountより多くのインスタンス(曜日,時限)がある場合、
      // 全て配置できるようitemを追加生成する（従来はcapで後半曜日を取りこぼしていた）。
      const template = items[itemIds[0]];
      while (itemIds.length < instList.length && template) {
        const nid = String(itemIdCounter++);
        items[nid] = {
          id: nid, subj: template.subj, subjKey: template.subjKey,
          cls: template.cls.slice(), teas: (template.teas || []).slice(),
          rooms: (template.rooms || []).slice(), span: template.span,
        };
        itemIds.push(nid);
      }
      const schedKeys = (jugyoMeta[jid] && jugyoMeta[jid].schedKeys) || null;
      for (let i = 0; i < instList.length && i < itemIds.length; i++) {
        const r = instList[i];
        const it = items[itemIds[i]];
        placements[itemIds[i]] = { day: r.day, period: r.period, locked: false };
        // このインスタンスのクラス/教員/教室をitemへ反映（合同授業・インスタンス別担当に対応）
        if (it) {
          if (r.classes && r.classes.size) it.cls = Array.from(r.classes);
          if (r.teachers && r.teachers.size) it.teas = Array.from(r.teachers);
          if (r.rooms && r.rooms.size) it.rooms = Array.from(r.rooms);
          // 授業本来のスケジュールに無い(曜日,時限)は同時展開/相乗りのコマ。
          // 各コマの科目は一意に定まる(分析でクラス×時限あたり科目1つを確認)ため、
          // 実科目名を表示したまま「同時展開」フラグを立てる（従来は一律「選択」に潰していた）。
          // 真の生徒選択制(自選(月/水/金))はこの後SJYUGYO側でグループ名にラベルし直す。
          if (schedKeys && schedKeys.size && !schedKeys.has(r.day + '#' + r.period)) {
            it.simul = true;
          }
        }
        placedCount++;
      }
    }

    // ── SJYUGYO パース (同時展開授業: 総合的な探究の時間・LHR・校務分掌・選択講座) ──
    // 各エントリ: header(id,name) / avail / memberCount / group-header / member×N / weeklyCount / 時限行×wc
    //   member = [代表jugyoId, lessonId, roomId, teacherId] … teacherId→homeroomでクラス確定
    //   時限行 = [曜日(1-5), 時限, 教室, 開始, 終了]
    // 該当クラス全てにその授業を配置し、同セルのJ-CLASS由来の相乗り参照を上書きする。
    if (sectionIdx['SJYUGYO'] != null) {
      const sji = sectionIdx['SJYUGYO'];
      const sjCount = parseInt(parseLine(lines[sji])[1]) || 0;
      let sidx = sji + 1;
      const sjCells = new Set();  // "class#day#period" 上書き対象
      const sjPlace = [];         // {subj, cls, teas, day, period, span}
      const electiveCells = {};   // "class#day#period" -> {label, real} 自選ブロックのラベル付け
      for (let c = 0; c <= sjCount; c++) {
        if (sidx >= lines.length) break;
        const hdr = parseLine(lines[sidx]);
        const name = hdr[1] || '';
        const memN = parseInt((lines[sidx + 2] || '').trim()) || 0;
        const members = [];
        for (let m = 0; m < memN; m++) members.push(parseLine(lines[sidx + 4 + m] || ''));
        const wcLine = sidx + 4 + memN;
        const wc = parseInt((lines[wcLine] || '').trim()) || 0;
        const perPeriods = [];
        for (let k = 0; k < wc; k++) perPeriods.push(parseLine(lines[wcLine + 1 + k] || ''));
        sidx = wcLine + 1 + wc;
        if (!memN || !wc) continue;
        const lessonId = parseInt(members[0][1]) || 0;
        const lesson = lessons[lessonId];
        const subj = (lesson && lesson.name) || name;
        if (!subj) continue;
        // 学年一斉の「総合的な探究の時間」「LHR/ホームルーム」のみ対象。
        // 選択講座はJ-CLASSに既にあり(担任≠受講クラスのため展開不可)、
        // 校務分掌(進路G等)は生徒授業でないため除外する。
        // ＬＨＲ(全角)にも対応するため全角ラテンを半角化して判定する。
        const subjHW = subj.replace(/[Ａ-Ｚａ-ｚ]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));
        // ── 自選・自由選択の同時展開ブロック ──
        // 科目は生徒選択制でクラスに一意化できないため、該当セルをグループ名(自選(金)等)で
        // ラベルし、相乗り科目一覧をrealSubjに保持する（既存の「選択」相乗りコマを上書き）。
        if (/自選|自由選択/.test(name) || /自選|自由選択/.test(subj)) {
          const label = (name || subj).replace(/[　\s]/g, '');
          // member = [表示index, lessonId, roomId, teacherId]。member[1]=lessonId が開講科目。
          // 受講クラスは生徒選択制で同時展開ブロックからは一意化できないため、
          // ブロックの(曜日,時限)で既存の「選択」相乗りコマを一致させてラベル付けする。
          const realNames = new Set();
          for (const mem of members) {
            const lid = parseInt(mem[1]) || 0;
            const ln = lessons[lid] && lessons[lid].name;
            if (ln) realNames.add(ln);
          }
          const realStr = [...realNames].join(' / ');
          for (const pp of perPeriods) {
            const dnum = parseInt(pp[0], 10), pnum = parseInt(pp[1], 10);
            const st = parseInt(pp[3], 10), en = parseInt(pp[4], 10);
            const span = (!isNaN(st) && !isNaN(en) && en > st) ? (en - st + 1) : 1;
            if (isNaN(dnum) || dnum < 1 || dnum > numDays || isNaN(pnum) || pnum < 1) continue;
            const dayKey = DAY_KEYS[dnum - 1];
            for (let dp = 0; dp < span; dp++) electiveCells[dayKey + '#' + (pnum + dp)] = { label, real: realStr };
          }
          continue;
        }
        if (!(subj.includes('総合的な探究') || /LHR|ロングホーム|ホームルーム/.test(subjHW))) continue;
        // メンバーのteacherId→homeroomクラス、クラスごとに担当教員をまとめる
        const clsTeas = {};
        for (const mem of members) {
          const tid = parseInt(mem[3]) || 0;
          const t = teachers[tid];
          if (!t || !t.homeroom) continue;
          (clsTeas[t.homeroom] || (clsTeas[t.homeroom] = new Set())).add(t.name);
        }
        for (const pp of perPeriods) {
          const dnum = parseInt(pp[0], 10), pnum = parseInt(pp[1], 10);
          const st = parseInt(pp[3], 10), en = parseInt(pp[4], 10);
          const span = (!isNaN(st) && !isNaN(en) && en > st) ? (en - st + 1) : 1;
          if (isNaN(dnum) || dnum < 1 || dnum > numDays || isNaN(pnum) || pnum < 1) continue;
          const dayKey = DAY_KEYS[dnum - 1];
          for (const cn in clsTeas) {
            sjPlace.push({ subj, cls: [cn], teas: Array.from(clsTeas[cn]), day: dayKey, period: pnum, span });
            for (let dp = 0; dp < span; dp++) sjCells.add(cn + '#' + dayKey + '#' + (pnum + dp));
          }
        }
      }
      // SJYUGYOが占有するセルと重なるJ-CLASS由来の配置を除去（相乗り参照の上書き）
      for (const itemId in placements) {
        const plc = placements[itemId]; if (!plc || !plc.day) continue;
        const it = items[itemId]; if (!it) continue;
        const span = it.span || 1;
        let overlap = false;
        for (const cn of (it.cls || [])) {
          for (let dp = 0; dp < span && !overlap; dp++) if (sjCells.has(cn + '#' + plc.day + '#' + (plc.period + dp))) overlap = true;
          if (overlap) break;
        }
        if (overlap) { delete placements[itemId]; delete items[itemId]; placedCount--; }
      }
      // SJYUGYO配置をitem化して追加
      const sjSubjs = new Set();
      const sjRawAgg = {}; // "subj|cls|span" -> count（データ入力画面に集約表示するため）
      for (const sp of sjPlace) {
        const id = String(itemIdCounter++);
        items[id] = { id, subj: sp.subj, subjKey: sp.subj, cls: sp.cls, teas: sp.teas, rooms: [], span: sp.span };
        placements[id] = { day: sp.day, period: sp.period, locked: false };
        placedCount++;
        sjSubjs.add(sp.subj);
        if (!subjectCfg[sp.subj]) subjectCfg[sp.subj] = { abbr: sp.subj, dept: '', fixedForbid: {}, noSameDay: false, noConsec: false, maxPerDay: null };
        const rk = sp.subj + '|' + (sp.cls || []).join(',') + '|' + (sp.span || 1);
        sjRawAgg[rk] = sjRawAgg[rk] || { subj: sp.subj, cls: (sp.cls || []).join(','), teas: sp.teas || [], span: sp.span || 1, count: 0 };
        sjRawAgg[rk].count++;
      }
      // 総合的な探究・LHR等の同時展開授業をデータ入力画面(rawRows)にも反映
      for (const k in sjRawAgg) {
        const a = sjRawAgg[k];
        rawRows.push({ cls: a.cls, subj: a.subj, subjAbbr: '', dept: '', tea: (a.teas || []).join(','), teaAbbr: '', room: '', count: a.count, span: a.span });
      }
      // JUGYO由来の未配置プレースホルダ(総合/LHR等, スケジュール無し)は重複なので除去
      for (const iid of Object.keys(items)) {
        const plc = placements[iid];
        if ((!plc || !plc.day) && sjSubjs.has(items[iid].subj)) { delete items[iid]; delete placements[iid]; }
      }
      // ── 自選ブロックのラベル付け（自選時限の同時展開コマをグループ名で上書き）──
      // 受講クラスは特定できないが、自選ブロックの時限に置かれた同時展開コマは自選と判断できる。
      // 真の生徒選択制のため、ここでは実科目名でなくグループ名(自選(月)等)を表示し、
      // 開講科目一覧をrealSubjに保持する。通常授業(simulでない)は対象外。
      if (Object.keys(electiveCells).length) {
        let relabeled = 0;
        for (const itemId in placements) {
          const plc = placements[itemId]; if (!plc || !plc.day) continue;
          const it = items[itemId]; if (!it) continue;
          if (!it.simul) continue; // 同時展開コマのみラベル付け
          const span = it.span || 1;
          let hit = null;
          for (let dp = 0; dp < span && !hit; dp++) hit = electiveCells[plc.day + '#' + (plc.period + dp)] || null;
          if (hit) {
            it.realSubj = hit.real || it.subj; // 開講科目一覧を保持
            it.subj = hit.label; it.subjKey = hit.label;
            if (!subjectCfg[hit.label]) subjectCfg[hit.label] = { abbr: hit.label, dept: '選択', fixedForbid: {}, noSameDay: false, noConsec: false, maxPerDay: null };
            relabeled++;
          }
        }
        _parseIdeaNativeIde._electiveRelabeled = relabeled;
      }
    }

    // ── per-class 時限数（早帰り等）──
    // 完成時間割の実配置末尾から各クラス・各曜日の最終時限を求め、全体設定より短い場合のみ
    // classPeriodOverride に記録する。これにより授業の無い余分なコマがグレー表示になる
    // （例: 1・2年は月曜7限だが3年は月曜6限まで、の違いを反映）。
    const classPeriodOverride = {};
    {
      const lastFilled = {};
      for (const id in placements) {
        const pl = placements[id]; if (!pl || !pl.day) continue;
        const it = items[id]; if (!it) continue;
        const span = it.span || 1;
        for (const c of (it.cls || [])) {
          if (!/^\d+-\d+$/.test(c)) continue; // 通常クラスのみ（校務分掌G等は除外）
          const rec = lastFilled[c] || (lastFilled[c] = {});
          rec[pl.day] = Math.max(rec[pl.day] || 0, pl.period + span - 1);
        }
      }
      for (const c in lastFilled) {
        for (const d of DAY_KEYS) {
          const glob = periodsByDay[d] || 0, last = lastFilled[c][d] || 0;
          if (glob > 0 && last > 0 && last < glob) (classPeriodOverride[c] || (classPeriodOverride[c] = {}))[d] = last;
        }
      }
    }

    return { schoolName, periodsByDay, subjectCfg, teacherCfg, roomCfg, items, rawRows, placements, placedCount, classPeriodOverride };
  }

  async function importProjectFile(file) {
    let buffer;
    try { buffer = await file.arrayBuffer(); } catch (e) { showModal('読込失敗', 'ファイルを読めませんでした: ' + e.message); return; }

    // イデアのAI時間割 ネイティブ形式の検出（Shift-JIS, "HEAD:", が先頭付近に出現）
    const head8 = new Uint8Array(buffer.slice(0, 100));
    const headAscii = String.fromCharCode(...head8).replace(/\0/g, '');
    const isIdeaNative = headAscii.includes('"HEAD:"');

    if (isIdeaNative) {
      let parsed;
      try { parsed = _parseIdeaNativeIde(buffer); } catch (e) {
        showModal('読込失敗', 'イデアファイルの解析に失敗しました: ' + e.message); return;
      }
      const clsCount = Object.values(parsed.items).length;
      const teaCount = Object.keys(parsed.teacherCfg).length;
      const subCount = Object.keys(parsed.subjectCfg).length;
      const hasTeacherAssign = Object.values(parsed.items).some(it => it.teas && it.teas.length > 0);
      const placedCount = parsed.placedCount || 0;
      // ── インポート品質レポート（未設定検出）──
      const _isNoRoomSubj = (s) => /総合的な探究|LHR|ロングホーム|ホームルーム/.test((s || '').replace(/[Ａ-Ｚａ-ｚ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)));
      let noRoomCnt = 0, noTeaCnt = 0;
      for (const it of Object.values(parsed.items)) {
        const hasRoom = it.rooms && it.rooms.length > 0;
        const hasTea = it.teas && it.teas.length > 0;
        if (!hasRoom && !_isNoRoomSubj(it.subj)) noRoomCnt++;
        if (!hasTea && !_isNoRoomSubj(it.subj)) noTeaCnt++;
      }
      const qualityNote =
        `  ── 品質チェック ──\n` +
        `  ${noRoomCnt === 0 ? '✓' : '⚠'} 教室未設定: ${noRoomCnt}コマ${noRoomCnt ? '（総合/LHRを除く）' : ''}\n` +
        `  ${noTeaCnt === 0 ? '✓' : '⚠'} 教員未設定: ${noTeaCnt}コマ${noTeaCnt ? '（総合/LHRを除く）' : ''}`;
      const teaNote = hasTeacherAssign
        ? `  ✓ J-Teachセクションから教員割当を読み込みました。`
        : `  ※ このファイルに教員割当データがないため、教員は未設定です。`;
      const placeNote = placedCount > 0
        ? `  ✓ J-CLASSセクションから時間割配置（${placedCount}コマ）を読み込みました。`
        : `  ※ このファイルに配置データがないため、配置は空になります。`;
      const lockOpt = placedCount > 0
        ? `<label class="chk" style="display:flex;gap:6px;align-items:center;margin-top:10px;padding:8px;background:rgba(59,130,246,.08);border-radius:6px;cursor:pointer">
             <input type="checkbox" id="ide-import-lock"> 読み込んだ配置を<strong>固定（ロック）</strong>して取り込む
             <span class="muted small">（AIや操作で動かない固定コマになります）</span>
           </label>`
        : '';
      let lockAll = false;
      showModalHTML(
        'イデアファイル読込',
        `<div style="white-space:pre-wrap;line-height:1.6">` +
        escapeHtml(`イデアのAI時間割ファイル「${file.name}」を読み込みます。\n\n` +
          `  教員: ${teaCount}名　教科: ${subCount}科目　授業コマ: ${clsCount}コマ\n` +
          `${teaNote}\n${placeNote}\n\n${qualityNote}\n\n現在の作業内容はすべて上書きされます。`) +
        `</div>` + lockOpt,
        () => {
          pushHistory('ideaImport');
          state.rawRows = parsed.rawRows;
          state.subjectCfg = parsed.subjectCfg;
          state.teacherCfg = parsed.teacherCfg;
          state.items = normalizeItems(parsed.items);
          state.placements = parsed.placements || {};
          // 固定として取込: 全配置をロック
          if (lockAll) { for (const id in state.placements) { const p = state.placements[id]; if (p && p.day) p.locked = true; } }
          state.snapshots = [];
          // 曜日ごとの時限数（可用性文字列から正確に取得）
          if (parsed.periodsByDay) Object.assign(state.settings.periodsByDay, parsed.periodsByDay);
          // 教室マスタ（classmatch に roomCfg があれば格納）
          if (parsed.roomCfg) state.roomCfg = parsed.roomCfg;
          // per-class 時限数（早帰り等で授業の無い余分なコマをグレー表示）
          state.settings.classPeriodOverride = parsed.classPeriodOverride || {};
          invalidateIndex();
          markDirty('ideaImport');
          rerenderAll();
          saveNow();
          const placeMsg = placedCount > 0 ? `、配置: ${placedCount}コマ${lockAll ? '（固定）' : ''}` : '';
          flash(`📂 イデアファイルを読み込みました（授業: ${clsCount}コマ, 教員: ${teaCount}名${placeMsg}）`);
        },
        '読み込む', 'キャンセル',
        () => { const el = document.getElementById('ide-import-lock'); if (el) el.addEventListener('change', () => { lockAll = el.checked; }); }
      );
      return;
    }

    // JSON 形式（classmatch 独自形式）
    let text;
    try { text = new TextDecoder('utf-8').decode(buffer); } catch (e) { showModal('読込失敗', 'ファイルを読めませんでした: ' + e.message); return; }

    let data;
    try { data = JSON.parse(text); } catch (e) { showModal('読込失敗', 'JSONの解析に失敗しました: ' + e.message); return; }

    // フォーマット確認
    if (data.format !== PROJECT_FORMAT && data.format !== 'classmatch-project') {
      // 旧形式（.classmatch / スナップショットのみJSONなど）も許容
      if (!Array.isArray(data) && !data.rawRows) {
        showModal('形式エラー', 'このファイルはサポートされていない形式です。classmatch (.ide JSON) またはイデアのAI時間割 (.ide) ファイルを選択してください。');
        return;
      }
    }

    const savedAt = data.savedAt ? new Date(data.savedAt).toLocaleString('ja-JP') : '不明';
    const name = data.projectName || file.name;
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    const kindLabel = ext === 'ide'
      ? 'classmatchプロジェクト（.ide / JSON形式）'
      : ext === 'classmatch' ? 'classmatchプロジェクト（.classmatch）'
      : 'classmatchプロジェクト（JSON形式）';
    const pItems = (data.items && typeof data.items === 'object') ? Object.keys(data.items).length : 0;
    const pPlaced = (data.placements && typeof data.placements === 'object') ? Object.keys(data.placements).length : 0;

    const lockOpt = pPlaced > 0
      ? `<label class="chk" style="display:flex;gap:6px;align-items:center;margin-top:10px;padding:8px;background:rgba(59,130,246,.08);border-radius:6px;cursor:pointer">
           <input type="checkbox" id="proj-import-lock"> 読み込んだ配置を<strong>固定（ロック）</strong>して取り込む
           <span class="muted small">（AIや操作で動かない固定コマになります）</span>
         </label>`
      : '';
    let lockAll = false;
    showModalHTML(
      'プロジェクト読込',
      `<div style="white-space:pre-wrap;line-height:1.6">` +
      escapeHtml(`📁 種別: ${kindLabel}\nファイル名: ${file.name}\n\n` +
        `「${name}」（保存日時: ${savedAt}）を読み込みますか？\n` +
        `  授業コマ: ${pItems}　配置済み: ${pPlaced}\n\n現在の作業内容はすべて上書きされます。`) +
      `</div>` + lockOpt,
      () => {
        pushHistory('projectImport');
        // データ復元
        if (Array.isArray(data.rawRows)) state.rawRows = data.rawRows;
        if (data.subjectCfg && typeof data.subjectCfg === 'object') state.subjectCfg = data.subjectCfg;
        if (data.teacherCfg && typeof data.teacherCfg === 'object') state.teacherCfg = data.teacherCfg;
        if (data.settings && typeof data.settings === 'object') {
          // 既存settingsに上書き（不完全なキーで壊れないよう）
          Object.assign(state.settings, data.settings);
        }
        if (data.placements && typeof data.placements === 'object') state.placements = data.placements;
        if (data.items && typeof data.items === 'object') state.items = normalizeItems(data.items);
        if (lockAll) { for (const id in state.placements) { const p = state.placements[id]; if (p && p.day) p.locked = true; } }
        if (Array.isArray(data.snapshots)) state.snapshots = data.snapshots;

        invalidateIndex();
        markDirty('projectImport');
        rerenderAll();
        saveNow();
        flash(`📂 「${name}」を読み込みました${lockAll ? '（配置を固定）' : ''}`);
      },
      '読み込む', 'キャンセル',
      () => { const el = document.getElementById('proj-import-lock'); if (el) el.addEventListener('change', () => { lockAll = el.checked; }); }
    );
  }

  // 外部データ（プロジェクト/スナップショット/localStorage）から復元したitemsに
  // teas/cls/rooms 配列が欠けていると print/export 等で .join が落ちるため正規化する
  function normalizeItems(items) {
    if (!items || typeof items !== 'object') return {};
    for (const id in items) {
      const it = items[id];
      if (!it || typeof it !== 'object') continue;
      if (!Array.isArray(it.teas)) it.teas = it.teas != null ? [].concat(it.teas) : [];
      if (!Array.isArray(it.cls)) it.cls = it.cls != null ? [].concat(it.cls) : [];
      if (!Array.isArray(it.rooms)) it.rooms = it.rooms != null ? [].concat(it.rooms) : [];
    }
    return items;
  }

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
      const payload = {
        v: '27.1',
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
      localStorage.setItem(saveKey, JSON.stringify(payload));
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

  function reflectRawToItems() {
    pushHistory('reflect');
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
      const span = r.dbl ? 2 : 1;
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
        if (placementsOld[id] && placementsOld[id].day) {
          newPlacements[id] = placementsOld[id];
        } else {
          newPlacements[id] = null;
        }
      }
    }
    state.items = items;
    state.placements = newPlacements;
    state.ui.selectedId = null; state.ui.selectedFrom = '';
    markDirty('reflectRawToItems');
  }

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
    return (span === 2 && plc.day === day && period === plc.period + 1);
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
  function invalidateIndex() { __idxCache = null; }

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

  function isForbiddenForSubject(subjKey, day, period) {
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

  function validatePlacement(id, day, period, mode = 'safe', swapTargetId = null) {
    // returns {ok, warns:[...], blocks:[...]}
    const it = state.items[id];
    if (!it) return { ok: false, warns: [], blocks: ['不明なコマ'] };
    const warns = []; const blocks = [];
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
      if (isForbiddenForSubject(it.subjKey, day, period + dp)) blocks.push(`固定禁則: ${DAYJP[day]}${period + dp}`);
    }

    // teacher unavailable & conflicts
    const idx = buildIndex();
    const isParallel = !!it.parallel;
    // Helper: is teacher conflict "exempt" because both items are parallel?
    const parallelExempt = (conflictId) => isParallel && !!(state.items[conflictId]?.parallel);
    for (const tea of it.teas) {
      for (let dp = 0; dp < it.span; dp++) {
        const p = period + dp;
        if (isUnavailableForTeacher(tea, day, p)) blocks.push(`教員不可: ${tea} ${DAYJP[day]}${p}`);
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
      showConflictResolutionDialog(id, day, period, existingComaIds);

    } catch (e) {
      console.error('Error in placeItem:', e);
      flash('配置エラー: ' + e.message);
    }
  }

  function showConflictResolutionDialog(id, day, period, existingComaIds) {
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

      // Solution 0: Force placement (ignore conflicts)
      if (!absBlocks.length) {
        solutions.push({
          title: '⚠️ 強制配置（既存コマを上書き）',
          action: 'force',
          reason: ['制約を無視して配置（デバッグ用）'],
          dangerous: true,
        });
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


      // Show dialog with solutions
      const modal = document.getElementById('modal');
      const title = document.getElementById('modal-title');
      const msgDiv = document.getElementById('modal-msg');
      const okBtn = document.getElementById('modal-ok');
      const cancelBtn = document.getElementById('modal-cancel');

      title.textContent = 'コマの配置方法を選択';

      const solutionHtml = solutions.map((sol, idx) => {
        const bgColor = sol.dangerous ? '#fef2f2' : '#f1f5f9';
        const borderColor = sol.dangerous ? '#fca5a5' : '#cbd5e1';
        const textColor = sol.dangerous ? '#991b1b' : '#0f172a';
        return `
      <div style="background:${bgColor};border:1px solid ${borderColor};border-radius:8px;padding:10px;margin:8px 0;cursor:pointer;transition:all 0.2s;" 
           onmouseover="this.style.background='${sol.dangerous ? '#fee2e2' : '#e2e8f0'}'" 
           onmouseout="this.style.background='${bgColor}'"
           onclick="window._applyConflictSolution(${idx});">
        <div style="font-weight:900;color:${textColor};">${escapeHtml(sol.title)}</div>
        <div style="font-size:11px;color:#64748b;margin-top:4px;">${sol.reason.map(r => `• ${escapeHtml(r)}`).join('<br>')}</div>
      </div>
    `;
      }).join('');

      msgDiv.innerHTML = `
      <div style="margin-bottom:10px;">
        <div>「${escapeHtml(abbr)}」を ${DAYJP[day]}${period} に配置</div>
        <div style="font-size:12px;color:#64748b;margin-top:4px;">既存: 「${escapeHtml(existingNames)}」</div>
        ${absBlocks.length ? `<div style="margin-top:6px;padding:6px 8px;border-radius:8px;background:#fff7ed;border:1px solid #fed7aa;color:#9a3412;font-size:12px;">禁制のため、この枠への強制配置はできません：<br>${absBlocks.map(x => `• ${escapeHtml(x)}`).join('<br>')}</div>` : ''}
      </div>
      <div style="font-weight:900;color:#0f172a;margin:10px 0;font-size:12px;">解決案:</div>
      ${solutionHtml}
    `;

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


          if (sol.action === 'force') {
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
            for (const cid of sol.ids) {
              state.placements[cid] = null;
            }
            invalidateIndex();
            flash(`「${existingNames}」を在庫へ移動しました`);
            pushHistory('place');
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

  function clampInt(v, lo, hi) { return Math.max(lo, Math.min(hi, v | 0)); }

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

  /* =======================
     UI helpers
  ======================= */

  function hideCtxMenu() {
    const m = document.getElementById('ctx-menu');
    if (m) { m.style.display = 'none'; m.innerHTML = ''; }
  }
  function showCtxMenu(items, x, y) {
    const m = document.getElementById('ctx-menu');
    if (!m) return;
    m.innerHTML = items.map(it => {
      if (it.sep) return '<div class="sep"></div>';
      if (it.muted) return `<div class="item muted">${escapeHtml(it.label)}</div>`;
      return `<div class="item" data-act="${escapeAttr(it.act)}">${escapeHtml(it.label)}</div>`;
    }).join('');
    m.style.display = 'block';
    // position
    const vw = window.innerWidth, vh = window.innerHeight;
    const rect = m.getBoundingClientRect();
    let px = Math.min(x, vw - rect.width - 10);
    let py = Math.min(y, vh - rect.height - 10);
    m.style.left = px + 'px'; m.style.top = py + 'px';
    m.querySelectorAll('.item[data-act]').forEach(el => {
      el.onclick = (ev) => {
        const act = el.dataset.act;
        hideCtxMenu();
        const fn = items.find(i => i.act === act)?.on;
        try { fn && fn(); } catch (e) { console.error(e); }
      };
    });
  }
  window.addEventListener('click', () => hideCtxMenu());
  window.addEventListener('scroll', () => hideCtxMenu(), true);

  /* =======================
     Toast Notification System (v34.4)
  ======================= */
  let _toastQueue = [];
  let _toastTimer = null;

  function showToast(message, type = 'info', duration = 3000) {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    const icon = type === 'success' ? '✓' : type === 'error' ? '✗' : type === 'warning' ? '⚠' : 'ℹ';
    toast.innerHTML = `
    <div class="toast-icon">${icon}</div>
    <div class="toast-message">${escapeHtml(message)}</div>
  `;

    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      document.body.appendChild(container);
    }

    container.appendChild(toast);

    // Animate in
    setTimeout(() => toast.classList.add('show'), 10);

    // Auto remove
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  function flash(text, ms = 1600) {
    const el = $('#msg');
    el.textContent = text || '';
    if (!text) return;
    setTimeout(() => { if (el.textContent === text) el.textContent = ''; }, ms);
  }
  function updateAutosaveUI(override = '') {
    const dot = $('#autosave-dot'); const tx = $('#autosave-text');
    if (!dot || !tx) return;
    dot.classList.toggle('dirty', !!state.autosave.dirty);
    dot.classList.toggle('saving', !!state.autosave.saving);
    dot.classList.toggle('err', !!state.autosave.error);
    if (state.autosave.error) tx.textContent = '保存エラー';
    else if (state.autosave.saving) tx.textContent = '保存中';
    else if (state.autosave.dirty) tx.textContent = '未保存';
    else tx.textContent = '保存済み';
    if (override) flash(override);
  }
  function showModal(title, msg, onOk = null) {
    const modal = $('#modal'); const mt = $('#modal-title'); const mm = $('#modal-msg');
    modal.classList.add('show'); modal.setAttribute('aria-hidden', 'false');
    mt.textContent = title; mm.textContent = msg || '';
    const ok = $('#modal-ok'); const cancel = $('#modal-cancel');
    cancel.style.display = onOk ? '' : 'none'; // OKのみの場合はキャンセル非表示
    const keyHandler = (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); ok.click(); }
      if (ev.key === 'Escape') { ev.preventDefault(); onOk ? cancel.click() : ok.click(); }
    };
    const cleanup = () => {
      ok.onclick = null; cancel.onclick = null;
      modal.removeEventListener('click', overlayClick);
      window.removeEventListener('keydown', keyHandler, true);
      modal.classList.remove('show'); modal.setAttribute('aria-hidden', 'true');
      cancel.style.display = '';
    };
    const overlayClick = (ev) => { if (ev.target === modal) { cleanup(); } };
    modal.addEventListener('click', overlayClick);
    ok.onclick = () => { cleanup(); if (onOk) onOk(); };
    cancel.onclick = () => cleanup();
    setTimeout(() => window.addEventListener('keydown', keyHandler, true), 80);
    setTimeout(() => ok.focus(), 30);
  }

  function showModalHTML(title, html, onOk = null, okText = 'OK', cancelText = 'キャンセル', afterMount = null) {
    const modal = $('#modal'); const mt = $('#modal-title'); const mm = $('#modal-msg');
    modal.classList.add('show'); modal.setAttribute('aria-hidden', 'false');
    mt.textContent = title; mm.innerHTML = html || '';
    const ok = $('#modal-ok'); const cancel = $('#modal-cancel');
    ok.textContent = okText; cancel.textContent = cancelText;
    // cancelText が null/空の場合はキャンセルボタンを非表示
    cancel.style.display = (cancelText && cancelText !== okText) ? '' : 'none';
    const keyHandler = (ev) => {
      if (ev.key === 'Escape') { ev.preventDefault(); cancel.style.display === '' ? cancel.click() : ok.click(); }
      if (ev.key === 'Enter' && ev.target === ok) { ev.preventDefault(); ok.click(); }
    };
    const cleanup = () => {
      ok.onclick = null; cancel.onclick = null;
      modal.removeEventListener('click', overlayClick);
      window.removeEventListener('keydown', keyHandler, true);
      modal.classList.remove('show'); modal.setAttribute('aria-hidden', 'true');
      ok.textContent = 'OK'; cancel.textContent = 'キャンセル';
      cancel.style.display = '';
      mm.innerHTML = '';
    };
    // 背景クリックで閉じる（モーダルボックス外をクリック）
    const overlayClick = (ev) => {
      if (ev.target === modal) { cleanup(); if (!cancelText || cancelText === okText) { if (onOk) onOk(); } }
    };
    modal.addEventListener('click', overlayClick);
    ok.onclick = () => { cleanup(); if (onOk) onOk(); };
    cancel.onclick = () => cleanup();
    setTimeout(() => window.addEventListener('keydown', keyHandler, true), 80);
    if (afterMount) setTimeout(afterMount, 10);
  }

  /* =======================
     Rendering
  ======================= */
  function switchTab(tab) {
    state.tab = tab;
    $$('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    $$('.view').forEach(v => v.style.display = 'none');
    $('#view-' + tab).style.display = 'flex';
    if (tab === 'edit') rerenderEdit();
    if (tab === 'subject') renderSubjectSettings();
    if (tab === 'teacher') renderTeacherSettings();
    if (tab === 'input') renderInputTable();
    if (tab === 'school') renderSchoolSettings();
    if (tab === 'print') { applyPrintLayoutToUI(); renderPrint(); }
  }

  function rerenderAll() {
    // keep current tab
    if (state.tab === 'input') renderInputTable();
    if (state.tab === 'school') renderSchoolSettings();
    if (state.tab === 'subject') renderSubjectSettings();
    if (state.tab === 'teacher') renderTeacherSettings();
    if (state.tab === 'edit') rerenderEdit();
    if (state.tab === 'print') { applyPrintLayoutToUI(); renderPrint(); }
    renderSnapshotList();
    // v46-A3: 教員/クラス一覧ウィンドウが開いていれば差分更新
    try { _atwRefreshAll(); } catch (e) { }
    // v49: 配置進捗バー更新
    try { updatePlacementProgress(); } catch (e) { }
    // F3: 検索ハイライト
    try { if (state.ui.itemSearchQuery) requestAnimationFrame(applyItemSearchHighlight); } catch (e) {}
    // F6: 制約オーバーレイ
    try { if (state.ui.constraintOverlay) requestAnimationFrame(applyConstraintOverlay); } catch (e) {}
  }

  // v49 B-1: 配置進捗バー (ヘッダー常時表示)
  function updatePlacementProgress() {
    const bar = document.getElementById('placement-progress-bar');
    const label = document.getElementById('placement-progress-label');
    const unplacedBadge = document.getElementById('unplaced-badge');
    if (!bar && !label && !unplacedBadge) return;

    const allIds = Object.keys(state.items);
    const total = allIds.length;
    const placed = allIds.filter(id => state.placements[id]?.day).length;
    const unplaced = total - placed;
    const pct = total > 0 ? Math.round(placed / total * 100) : 0;

    // violations
    let vioCount = 0;
    try {
      for (const id of allIds) {
        if (state.placements[id]?.day && violationSummary(id)) vioCount++;
      }
    } catch (e) { }

    if (bar) {
      bar.style.width = pct + '%';
      bar.style.background = vioCount > 0 ? '#f59e0b' : pct === 100 ? '#22c55e' : '#3b82f6';
    }
    if (label) {
      label.textContent = `${placed}/${total} (${pct}%)`;
      label.title = vioCount > 0 ? `⚠ 制約違反 ${vioCount}件` : pct === 100 ? '全コマ配置完了!' : `残 ${unplaced}コマ`;
    }
    if (unplacedBadge) {
      unplacedBadge.textContent = unplaced > 0 ? String(unplaced) : '';
      unplacedBadge.style.display = unplaced > 0 ? 'inline-flex' : 'none';
      unplacedBadge.dataset.unplaced = unplaced;
    }
  }

  // v46-A3: ATWウィンドウ差分再描画
  function _atwRefreshAll() {
    const layer = document.getElementById('float-layer'); if (!layer) return;
    const wins = layer.querySelectorAll('.atw-win');
    if (!wins.length) return;
    const idx = buildIndex();
    wins.forEach(win => {
      const tilesEl = win.querySelector('.atw-tiles');
      const kind = tilesEl?.dataset.kind;
      if (!kind) return;
      tilesEl.querySelectorAll('.atw-block').forEach(block => {
        const key = block.dataset.key; if (!key) return;
        const tmp = document.createElement('div');
        tmp.innerHTML = _atwBuildOneMini(key, kind, idx);
        const nb = tmp.firstElementChild; if (!nb) return;
        block.replaceWith(nb);
        _atwBindBlock(tilesEl, nb);
      });
    });
  }

  function renderSchoolSettings() {
    $('#p-mon').value = state.settings.periodsByDay.Mon;
    $('#p-tue').value = state.settings.periodsByDay.Tue;
    $('#p-wed').value = state.settings.periodsByDay.Wed;
    $('#p-thu').value = state.settings.periodsByDay.Thu;
    $('#p-fri').value = state.settings.periodsByDay.Fri;
    $('#lunch-after').value = state.settings.lunchAfter;
    $('#chk-room-conflict').checked = !!state.settings.roomConflict;
    $('#school-tea-maxdaily').value = state.settings.teaDefaultMaxDaily ?? '';
    $('#school-tea-maxconsec').value = state.settings.teaDefaultMaxConsec ?? '';
    renderClassPeriodOverride();
  }

  function renderClassPeriodOverride() {
    const container = $('#class-period-override-list'); if (!container) return;
    const ov = state.settings.classPeriodOverride || {};
    // Get all known classes for datalist
    const allCls = uniq(Object.values(state.items).flatMap(it => it.cls || [])).sort();
    container.innerHTML = '';
    const entries = Object.keys(ov);

    const makeRow = (cls = '', dayVals = {}) => {
      const row = document.createElement('div');
      row.className = 'cls-ov-row';
      const clsInput = document.createElement('input');
      clsInput.type = 'text'; clsInput.placeholder = '例: 3-1HR';
      clsInput.value = cls; clsInput.className = 'sel cls-ov-cls-inp'; clsInput.style.width = '100px';
      clsInput.list = 'dl-allcls';

      const dayInputs = {};
      const dayRow = document.createElement('div');
      dayRow.className = 'cls-ov-days';
      for (const d of DAYS) {
        const lbl = document.createElement('span');
        lbl.className = 'cls-ov-dlabel'; lbl.textContent = DAYJP[d];
        const inp = document.createElement('input');
        inp.type = 'number'; inp.min = '1'; inp.max = '12'; inp.placeholder = '−';
        inp.className = 'num cls-ov-inp'; inp.style.width = '40px';
        inp.value = dayVals[d] != null ? dayVals[d] : '';
        dayInputs[d] = inp;
        dayRow.appendChild(lbl); dayRow.appendChild(inp);
      }
      const delBtn = document.createElement('button');
      delBtn.textContent = '✕'; delBtn.className = 'btn danger'; delBtn.style.padding = '3px 8px';
      delBtn.title = 'この行を削除';
      delBtn.onclick = () => {
        const k = clsInput.value.trim();
        if (k && state.settings.classPeriodOverride) delete state.settings.classPeriodOverride[k];
        markDirty('school'); renderClassPeriodOverride(); rerenderAll();
      };

      const save = () => {
        const k = clsInput.value.trim(); if (!k) return;
        if (!state.settings.classPeriodOverride) state.settings.classPeriodOverride = {};
        const entry = {};
        for (const d of DAYS) {
          const v = dayInputs[d].value.trim();
          if (v !== '') entry[d] = clamp(parseInt(v, 10), 1, 12);
        }
        state.settings.classPeriodOverride[k] = entry;
        markDirty('school'); rerenderAll();
      };
      clsInput.onchange = save;
      for (const d of DAYS) dayInputs[d].onchange = save;

      row.appendChild(clsInput); row.appendChild(dayRow); row.appendChild(delBtn);
      container.appendChild(row);
    };

    // Datalist for classes
    if (!$('#dl-allcls')) {
      const dl = document.createElement('datalist'); dl.id = 'dl-allcls';
      allCls.forEach(c => { const o = document.createElement('option'); o.value = c; dl.appendChild(o); });
      document.body.appendChild(dl);
    }

    // Show example hint if empty
    if (!entries.length) {
      const hint = document.createElement('div');
      hint.className = 'cls-ov-hint';
      hint.innerHTML = '<strong>💡 使い方：</strong> 3年生だけ月曜が6限の場合、クラスに「3-1HR」、月に「6」と入力';
      container.appendChild(hint);
    }

    for (const cls of entries) makeRow(cls, ov[cls]);

    const addBtn = $('#btn-add-cls-override');
    if (addBtn) {
      // Clone to remove any stale listeners
      const newBtn = addBtn.cloneNode(true);
      addBtn.parentNode.replaceChild(newBtn, addBtn);
      newBtn.onclick = () => { makeRow('', {}); };
    }
  }

  function gatherSchoolSettings() {
    pushHistory('school');
    state.settings.periodsByDay.Mon = clamp(parseInt($('#p-mon').value ?? 7, 10), 0, 12);
    state.settings.periodsByDay.Tue = clamp(parseInt($('#p-tue').value ?? 6, 10), 0, 12);
    state.settings.periodsByDay.Wed = clamp(parseInt($('#p-wed').value ?? 6, 10), 0, 12);
    state.settings.periodsByDay.Thu = clamp(parseInt($('#p-thu').value ?? 6, 10), 0, 12);
    state.settings.periodsByDay.Fri = clamp(parseInt($('#p-fri').value ?? 6, 10), 0, 12);
    state.settings.lunchAfter = clamp(parseInt($('#lunch-after').value || 4, 10), 0, 11);
    state.settings.roomConflict = !!$('#chk-room-conflict').checked;
    const md = $('#school-tea-maxdaily').value.trim();
    state.settings.teaDefaultMaxDaily = md === '' ? null : clamp(parseInt(md, 10), 1, 30);
    const mc = $('#school-tea-maxconsec').value.trim();
    state.settings.teaDefaultMaxConsec = mc === '' ? null : clamp(parseInt(mc, 10), 1, 30);
    markDirty('school');
    rerenderAll();
    broadcastState();
  }

  function renderInputTable() {
    const tb = $('#input-tbody'); if (!tb) return;
    tb.innerHTML = '';
    const subjSet = uniq(state.rawRows.map(r => (r.subj || '').trim()).filter(Boolean));
    const teaSet = uniq(state.rawRows.flatMap(r => splitList(r.tea)));
    const subjDataList = `<datalist id="dl-subjects">${subjSet.map(s => `<option value="${escapeHtml(s)}"></option>`).join('')}</datalist>`;
    const teaDataList = `<datalist id="dl-teachers">${teaSet.map(s => `<option value="${escapeHtml(s)}"></option>`).join('')}</datalist>`;
    if (!$('#dl-subjects')) document.body.insertAdjacentHTML('beforeend', subjDataList);
    if (!$('#dl-teachers')) document.body.insertAdjacentHTML('beforeend', teaDataList);

    const rows = state.rawRows;
    if (!rows.length) {
      addRow(); // create one
    }
    const isSorted = !!_inputSort.col;
    for (const r of getSortedRows()) {
      ensureRowId(r);
      const tr = document.createElement('tr');
      tr.dataset.rowid = r._id;
      const subjKey = (r.subj || '').trim();
      const color = (state.subjectCfg[subjKey]?.color) || (subjKey ? pickColor(subjKey) : '#fff');
      tr.style.background = subjKey ? hexWithAlpha(color, 0.10) : '';
      tr.draggable = !isSorted;
      // 教室未設定の警告（総合/LHR等の教室不要科目は除外）
      const _noRoomOk = /総合的な探究|LHR|ロングホーム|ホームルーム/.test((subjKey || '').replace(/[Ａ-Ｚａ-ｚ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)));
      const roomWarn = subjKey && !(r.room || '').trim() && !_noRoomOk;
      tr.innerHTML = `
      <td class="drag-handle" title="${isSorted ? '並替中はドラッグ不可' : 'ドラッグして並び替え'}" style="${isSorted ? 'color:#cbd5e1;cursor:default' : ''}">${isSorted ? '—' : '⠿'}</td>
      <td>
        <div class="op-buttons">
          <button class="dup" data-act="dup">複製</button>
          <button class="del" data-act="del">削除</button>
        </div>
      </td>
      <td><input type="text" value="${escapeAttr(r.cls || '')}" placeholder="例: 1-1,1-2" /></td>
      <td><input type="text" value="${escapeAttr(r.subj || '')}" list="dl-subjects" /></td>
      <td><input type="text" value="${escapeAttr(r.subjAbbr || '')}" placeholder="略" /></td>
      <td><input type="text" value="${escapeAttr(r.dept || '')}" placeholder="教科" /></td>
      <td><input type="text" value="${escapeAttr(r.tea || '')}" list="dl-teachers" /></td>
      <td><input type="text" value="${escapeAttr(r.teaAbbr || '')}" placeholder="略" /></td>
      <td class="${roomWarn ? 'cell-room-warn' : ''}" title="${roomWarn ? '教室が未設定です' : ''}"><input type="text" value="${escapeAttr(r.room || '')}" placeholder="例: 1-1,オーラル教室" /></td>
      <td><input type="number" min="1" max="30" value="${escapeAttr(r.count || 1)}" /></td>
      <td><input type="checkbox" ${r.dbl ? 'checked' : ''} /></td>
      <td><input type="checkbox" ${r.parallel ? 'checked' : ''} title="並列：同一先生が複数クラスに同時展開" /></td>
    `;
      const tds = tr.querySelectorAll('td');
      const inputs = tr.querySelectorAll('input');
      // operation buttons
      tr.querySelector('[data-act="del"]').onclick = () => {
        showModal('削除', 'この行を削除しますか？', () => {
          pushHistory('rowDel');
          state.rawRows = state.rawRows.filter(x => x._id !== r._id);
          markDirty('rowDel');
          renderInputTable();
        });
      };
      tr.querySelector('[data-act="dup"]').onclick = () => {
        pushHistory('rowDup');
        const copy = deepClone(r); copy._id = null; ensureRowId(copy);
        const idx = state.rawRows.findIndex(x => x._id === r._id);
        state.rawRows.splice(idx + 1, 0, copy);
        markDirty('rowDup');
        renderInputTable();
      };
      // ── Drag & drop row reorder ──
      tr.addEventListener('dragstart', (ev) => {
        _dragRowId = r._id;
        tr.classList.add('dragging-row');
        ev.dataTransfer.effectAllowed = 'move';
        ev.dataTransfer.setData('text/plain', r._id);
      });
      tr.addEventListener('dragend', () => {
        _dragRowId = null;
        tr.classList.remove('dragging-row');
        document.querySelectorAll('#input-tbody tr').forEach(x => x.classList.remove('drag-over-row'));
      });
      tr.addEventListener('dragover', (ev) => {
        ev.preventDefault(); ev.dataTransfer.dropEffect = 'move';
        document.querySelectorAll('#input-tbody tr').forEach(x => x.classList.remove('drag-over-row'));
        if (_dragRowId && _dragRowId !== r._id) tr.classList.add('drag-over-row');
      });
      tr.addEventListener('drop', (ev) => {
        ev.preventDefault();
        tr.classList.remove('drag-over-row');
        if (!_dragRowId || _dragRowId === r._id || isSorted) return;
        const fromIdx = state.rawRows.findIndex(x => x._id === _dragRowId);
        const toIdx = state.rawRows.findIndex(x => x._id === r._id);
        if (fromIdx < 0 || toIdx < 0) return;
        pushHistory('rowMove');
        const [moved] = state.rawRows.splice(fromIdx, 1);
        state.rawRows.splice(toIdx, 0, moved);
        _dragRowId = null;
        markDirty('rowMove');
        renderInputTable();
      });
      // bind inputs — IME composition guard prevents re-render during kanji conversion
      const withIMEGuard = (inp, fn) => {
        let composing = false;
        inp.addEventListener('compositionstart', () => { composing = true; _inputTableIMEComposing = true; });
        inp.addEventListener('compositionend', () => { composing = false; _inputTableIMEComposing = false; fn(false); });
        inp.oninput = () => { if (!composing) fn(true); };
      };
      withIMEGuard(inputs[0], () => { r.cls = inputs[0].value; markDirty('input'); });
      withIMEGuard(inputs[1], (live) => { r.subj = inputs[1].value; markDirty('input'); if (live) renderInputTableDebounced(tr, inputs[1]); });
      withIMEGuard(inputs[2], () => { r.subjAbbr = inputs[2].value; markDirty('input'); });
      withIMEGuard(inputs[3], () => { r.dept = inputs[3].value; markDirty('input'); });
      withIMEGuard(inputs[4], (live) => { r.tea = inputs[4].value; markDirty('input'); if (live) renderInputTableDebounced(tr, inputs[4]); });
      withIMEGuard(inputs[5], () => { r.teaAbbr = inputs[5].value; markDirty('input'); });
      withIMEGuard(inputs[6], () => { r.room = inputs[6].value; markDirty('input'); });
      inputs[7].oninput = () => { r.count = clamp(parseInt(inputs[7].value || 1, 10), 1, 30); markDirty('input'); };
      inputs[8].onchange = () => { r.dbl = inputs[8].checked; markDirty('input'); };
      inputs[9].onchange = () => { r.parallel = inputs[9].checked; markDirty('input'); };
      tb.appendChild(tr);
    }
  }
  let inputRerenderTimer = null;
  let _inputTableIMEComposing = false; // global IME guard for datalist re-render
  let _dragRowId = null; // drag-and-drop row reorder
  // sort state: { col: 'cls'|'subj'|'dept'|'tea'|null, dir: 'asc'|'desc' }
  let _inputSort = { col: null, dir: 'asc' };
  let _teaSort = { col: 'name', dir: 'asc' }; // default: name asc

  function getSortedRows() {
    if (!_inputSort.col) return state.rawRows;
    const col = _inputSort.col;
    const dir = _inputSort.dir === 'asc' ? 1 : -1;
    return [...state.rawRows].sort((a, b) => {
      const va = (a[col] || '').trim();
      const vb = (b[col] || '').trim();
      return va.localeCompare(vb, 'ja') * dir;
    });
  }

  function updateSortButtons() {
    document.querySelectorAll('#input-thead-row th[data-sort]').forEach(th => {
      const c = th.dataset.sort;
      const icon = th.querySelector('.sort-icon');
      const isAsc = _inputSort.col === c && _inputSort.dir === 'asc';
      const isDesc = _inputSort.col === c && _inputSort.dir === 'desc';
      th.classList.toggle('th-sort-active', isAsc || isDesc);
      if (icon) icon.textContent = isAsc ? '▲' : isDesc ? '▼' : '';
    });
    const resetSpan = $('#th-sort-reset');
    if (resetSpan) resetSpan.style.display = _inputSort.col ? '' : 'none';
  }

  function updateTeaSortButtons() {
    ['name', 'dept'].forEach(c => {
      const btn = $(`[data-tea-sort="${c}"]`);
      if (!btn) return;
      btn.classList.toggle('active-asc', _teaSort.col === c && _teaSort.dir === 'asc');
      btn.classList.toggle('active-desc', _teaSort.col === c && _teaSort.dir === 'desc');
    });
  }

  function bindSortToolbar() {
    document.querySelectorAll('#input-thead-row th[data-sort]').forEach(th => {
      th.style.cursor = 'pointer';
      th.onclick = (ev) => {
        if (ev.target.classList.contains('col-resizer')) return;
        const c = th.dataset.sort;
        if (_inputSort.col === c) {
          _inputSort.dir = _inputSort.dir === 'asc' ? 'desc' : 'asc';
        } else {
          _inputSort.col = c; _inputSort.dir = 'asc';
        }
        updateSortButtons();
        renderInputTable();
      };
    });
    const resetSpan = $('#th-sort-reset');
    if (resetSpan) resetSpan.onclick = (ev) => {
      ev.stopPropagation();
      _inputSort = { col: null, dir: 'asc' };
      updateSortButtons();
      renderInputTable();
    };
  }
  function renderInputTableDebounced(activeRow, activeInput) {
    if (_inputTableIMEComposing) return; // don't blow up IME session
    // Snapshot focus: which row ID and which column index was active
    let focusRowId = null, focusColIdx = -1, focusSelStart = null, focusSelEnd = null;
    if (activeRow && activeInput) {
      const rowEl = activeRow;
      const r = state.rawRows.find(x => rowEl.dataset && rowEl.dataset.rowid === x._id);
      focusRowId = r?._id ?? null;
      const inputs = Array.from(rowEl.querySelectorAll('input'));
      focusColIdx = inputs.indexOf(activeInput);
      try { focusSelStart = activeInput.selectionStart; focusSelEnd = activeInput.selectionEnd; } catch (e) { }
    } else {
      // Try snapshotting the currently active element
      const el = document.activeElement;
      if (el && el.tagName === 'INPUT') {
        const tr = el.closest('tr[data-rowid]');
        if (tr) {
          focusRowId = tr.dataset.rowid;
          const inputs = Array.from(tr.querySelectorAll('input'));
          focusColIdx = inputs.indexOf(el);
          try { focusSelStart = el.selectionStart; focusSelEnd = el.selectionEnd; } catch (e) { }
        }
      }
    }
    clearTimeout(inputRerenderTimer);
    inputRerenderTimer = setTimeout(() => {
      if (state.tab === 'input') {
        renderInputTable();
        // Restore focus
        if (focusRowId != null && focusColIdx >= 0) {
          requestAnimationFrame(() => {
            const tr = document.querySelector(`tr[data-rowid="${CSS.escape(focusRowId)}"]`);
            if (tr) {
              const inputs = Array.from(tr.querySelectorAll('input'));
              const el = inputs[focusColIdx];
              if (el) {
                try { el.focus({ preventScroll: true }); } catch (e) { }
                try { if (focusSelStart != null) el.setSelectionRange(focusSelStart, focusSelEnd ?? focusSelStart); } catch (e) { }
              }
            }
          });
        }
      }
    }, 250);
  }
  function addRow() {
    pushHistory('rowAdd');
    state.rawRows.push({ _id: null, cls: '', subj: '', subjAbbr: '', dept: '', tea: '', teaAbbr: '', room: '', count: 1, dbl: false, parallel: false });
    ensureRowId(state.rawRows[state.rawRows.length - 1]);
    markDirty('rowAdd');
    renderInputTable();
  }

  /* =======================
     Subject / Teacher settings
  ======================= */
  function renderSubjectSettings() {
    const box = $('#subject-container'); if (!box) return;
    rebuildMastersFromRaw();
    const keys = Object.keys(state.subjectCfg).sort((a, b) => a.localeCompare(b, 'ja'));
    box.innerHTML = '';
    for (const key of keys) {
      const cfg = state.subjectCfg[key];
      const isAllowed = !!cfg.allowedMode;
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `
      <div class="card-head">
        <h3>${escapeHtml(key)}</h3>
        <div class="spacer"></div>
      </div>
      <div class="tile-summary">略称: ${escapeHtml(cfg.abbr || '')}　教科: ${escapeHtml(cfg.dept || '')}</div>
      <div class="color-box">
        <input type="color" value="${escapeAttr(cfg.color || pickColor(key))}" />
        <div class="muted small">自動色（コマの色分け）</div>
      </div>
      <div class="form-grid" style="margin-top:10px;">
        <label>略称</label><input type="text" value="${escapeAttr(cfg.abbr || '')}" />
        <label>教科</label><input type="text" value="${escapeAttr(cfg.dept || '')}" placeholder="例: 国語 / 英語 / 音楽" />
        <label>同日複数</label>
          <select>
            <option value="0" ${cfg.noSameDay ? '' : 'selected'}>OK</option>
            <option value="1" ${cfg.noSameDay ? 'selected' : ''}>不可（同日1回）</option>
          </select>
        <label>同日上限(時数)</label><input type="number" min="1" max="20" value="${cfg.maxPerDay == null ? '' : escapeAttr(cfg.maxPerDay)}" placeholder="未設定" />
        <label>連続配置</label>
          <select class="noconsec-sel">
            <option value="0" ${cfg.noConsec ? '' : 'selected'}>OK（連続可）</option>
            <option value="1" ${cfg.noConsec ? 'selected' : ''}>禁止（同科目を連続させない）</option>
          </select>
      </div>
      <div class="rulebox">
        <div class="row" style="justify-content:space-between;align-items:center;">
          <div class="row" style="gap:6px"><strong>${isAllowed ? '許可枠' : '固定禁則'}</strong><span class="muted small">${isAllowed ? '緑=配置OK（それ以外は不可）' : '赤=配置不可'}</span></div>
          <label class="chk small" style="gap:4px;cursor:pointer" title="ONにすると、選んだ枠だけに配置可能になります（禁則の逆）">
            <input type="checkbox" class="allow-mode-chk" ${isAllowed ? 'checked' : ''}/> 許可枠モード
          </label>
        </div>
        ${isAllowed
          ? miniCalendarHTML('subj-allow', key, cfg.allowedSlots || {}, true)
          : miniCalendarHTML('subj', key, cfg.fixedForbid || {})}
      </div>
      <div class="row gap wrap" style="margin-top:10px;align-items:center;">
        <button class="btn secondary subj-bulk-place" data-subj="${escapeAttr(key)}" title="禁則/許可枠・教員不可を守って一括配置（Shift+クリックで既配置も再配置）">📌 この科目を一括配置</button>
        <span class="muted small">（Shift+クリック: 既配置も再配置）</span>
      </div>
    `;
      const color = card.querySelector('input[type="color"]');
      const inputs = card.querySelectorAll('input[type="text"],input[type="number"]');
      const abbr = inputs[0];
      const dept = inputs[1];
      const noSame = card.querySelector('select');
      const maxpd = inputs[2];
      const allowChk = card.querySelector('.allow-mode-chk');
      color.oninput = () => { pushHistory('subjColor'); cfg.color = color.value; markDirty('subj'); queueRerenderAllPreserveFocus(); };
      abbr.oninput = () => { cfg.abbr = abbr.value; markDirty('subj'); queueRerenderAllPreserveFocus(); };
      dept.oninput = () => { cfg.dept = dept.value; markDirty('subj'); queueRerenderAllPreserveFocus(); };
      noSame.onchange = () => { cfg.noSameDay = (noSame.value === '1'); markDirty('subj'); };
      maxpd.oninput = () => { cfg.maxPerDay = maxpd.value.trim() === '' ? null : clamp(parseInt(maxpd.value, 10), 1, 30); markDirty('subj'); };
      const noConsecSel = card.querySelector('.noconsec-sel');
      if (noConsecSel) noConsecSel.onchange = () => { cfg.noConsec = (noConsecSel.value === '1'); markDirty('subj'); };
      allowChk.onchange = () => {
        pushHistory('allowMode');
        cfg.allowedMode = allowChk.checked;
        markDirty('subj');
        renderSubjectSettings(); // re-render this card
      };
      if (isAllowed) {
        bindMiniCalendar(card, 'subj-allow', key, 'allowedSlots', true);
      } else {
        bindMiniCalendar(card, 'subj', key, 'fixedForbid');
      }

      // v61: 一括配置（科目ごと）
      const btnBulk = card.querySelector('.subj-bulk-place');
      if (btnBulk) btnBulk.onclick = (ev) => {
        const includePlaced = !!(ev && ev.shiftKey);
        bulkPlaceSubject(key, { includePlaced });
      };
      box.appendChild(card);
    }
  }

  function renderTeacherSettings() {
    const box = $('#teacher-container'); if (!box) return;
    rebuildMastersFromRaw();
    const dir = _teaSort.dir === 'asc' ? 1 : -1;
    const keys = Object.keys(state.teacherCfg).sort((a, b) => {
      if (_teaSort.col === 'dept') {
        const da = (state.teacherCfg[a]?.dept || inferTeacherDept(a) || '').trim();
        const db = (state.teacherCfg[b]?.dept || inferTeacherDept(b) || '').trim();
        const cmp = da.localeCompare(db, 'ja');
        if (cmp !== 0) return cmp * dir;
      }
      return a.localeCompare(b, 'ja') * dir;
    });
    box.innerHTML = '';
    for (const key of keys) {
      const cfg = state.teacherCfg[key];
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `
      <div class="card-head">
        <h3>${escapeHtml(key)}</h3>
        <div class="spacer"></div>
      </div>
      <div class="tile-summary">略称: ${escapeHtml(cfg.abbr || '')}　教科: ${escapeHtml((cfg.dept || inferTeacherDept(key)) || '')}</div>
      <div class="form-grid">
        <label>略称</label><input id="${domId('tea-abbr-', key)}" type="text" value="${escapeAttr(cfg.abbr || '')}" />
        <label>教科(参考)</label><input id="${domId('tea-dept-', key)}" type="text" value="${escapeAttr(cfg.dept || '')}" placeholder="例: 英語" />
        <label>1日上限</label><input id="${domId('tea-maxd-', key)}" type="number" min="1" max="30" value="${cfg.maxDaily == null ? '' : escapeAttr(cfg.maxDaily)}" placeholder="未設定" />
        <label>連続上限</label><input id="${domId('tea-maxc-', key)}" type="number" min="1" max="30" value="${cfg.maxConsec == null ? '' : escapeAttr(cfg.maxConsec)}" placeholder="未設定" />
      </div>
      <div class="rulebox">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap">
          <label class="chk" style="font-size:12px">
            <input type="checkbox" class="tea-allowed-chk" ${cfg.allowedMode ? 'checked' : ''}>
            <strong>出勤可能指定モード</strong>
          </label>
          <span class="muted small">${cfg.allowedMode ? '（緑○=出勤可、それ以外は不可）' : '（赤×=出勤不可コマ）'}</span>
        </div>
        <div>
          <div class="muted small" style="margin-bottom:2px">${cfg.allowedMode ? '出勤可能コマ（○）' : '出勤不可コマ（×）'}</div>
          ${cfg.allowedMode
            ? miniCalendarHTML('tea', key, cfg.allowedSlots || {}, true)
            : miniCalendarHTML('tea', key, cfg.unavailable || {})
          }
        </div>
      </div>
    `;
      const inputs = card.querySelectorAll('input');
      inputs[0].oninput = () => { cfg.abbr = inputs[0].value; cfg.abbrAuto = false; markDirty('tea'); queueRerenderAllPreserveFocus(); };
      inputs[1].oninput = () => { cfg.dept = inputs[1].value; markDirty('tea'); queueRerenderAllPreserveFocus(); };
      inputs[2].oninput = () => { cfg.maxDaily = inputs[2].value.trim() === '' ? null : clamp(parseInt(inputs[2].value, 10), 1, 30); markDirty('tea'); };
      inputs[3].oninput = () => { cfg.maxConsec = inputs[3].value.trim() === '' ? null : clamp(parseInt(inputs[3].value, 10), 1, 30); markDirty('tea'); };
      // v43: allowed-mode toggle
      const allowedChk = card.querySelector('.tea-allowed-chk');
      if (allowedChk) allowedChk.onchange = () => {
        cfg.allowedMode = allowedChk.checked;
        if (cfg.allowedMode && !cfg.allowedSlots) cfg.allowedSlots = {};
        markDirty('tea');
        renderTeacherSettings(); // re-render card to swap calendar type
      };
      if (cfg.allowedMode) {
        bindMiniCalendar(card, 'tea-allow', key, 'allowedSlots', true);
      } else {
        bindMiniCalendar(card, 'tea', key, 'unavailable');
      }
      box.appendChild(card);
    }
  }

  function miniCalendarHTML(type, key, map, isAllowMode = false) {
    // 5 x maxPeriod
    const maxP = Math.max(...DAYS.map(d => maxPeriod(d)));
    const head = `<table class="mini-cal"><thead><tr><th></th>${DAYS.map(d => `<th>${DAYJP[d]}</th>`).join('')}</tr></thead><tbody>`;
    let body = '';
    for (let p = 1; p <= maxP; p++) {
      body += `<tr><th>${p}</th>`;
      for (const d of DAYS) {
        const exists = (map?.[d] || []).includes(p);
        const disabled = p > maxPeriod(d);
        const cls = disabled ? 'disabled' : '';
        const onCls = isAllowMode ? 'allowed' : 'on';
        body += `<td data-day="${d}" data-p="${p}" class="${cls} ${exists ? onCls : ''}">${disabled ? '' : (exists ? (isAllowMode ? '○' : '×') : '')}</td>`;
      }
      body += '</tr>';
    }
    body += '</tbody></table>';
    return head + body;
  }
  function bindMiniCalendar(root, type, key, field, isAllowMode = false) {
    root.querySelectorAll('td[data-day]').forEach(td => {
      td.onclick = () => {
        if (td.classList.contains('disabled')) return;
        pushHistory('miniCal');
        const d = td.dataset.day; const p = parseInt(td.dataset.p, 10);
        const cfg = (type === 'subj' || type === 'subj-allow') ? state.subjectCfg[key]
          : state.teacherCfg[key]; // tea, tea-allow, tea-break all point to teacherCfg
        cfg[field] ??= {};
        cfg[field][d] ??= [];
        const arr = cfg[field][d];
        const i = arr.indexOf(p);
        if (i >= 0) arr.splice(i, 1); else arr.push(p);
        arr.sort((a, b) => a - b);
        markDirty('miniCal');
        rerenderAll();
        broadcastState();
      };
    });
  }

  /* =======================
     v61: 科目の一括配置（固定枠/LHRなど）
     - 禁制（固定禁則/教員不可/時限範囲/2連最終/クラス時限上限）は必ず守る
     - 既配置も動かしたい場合は Shift+クリック
  ======================= */
  function _bulkHardness(it) {
    const span = it?.span || 1;
    return span * 50 + (it?.teas?.length || 0) * 12 + (it?.cls?.length || 0) * 10 + (it?.rooms?.length || 0) * 6;
  }

  function _bulkBestSlotFor(id) {
    const it = state.items[id];
    if (!it) return null;
    const scfg = state.subjectCfg[it.subjKey] || {};

    const span = it.span || 1;
    let best = null;

    for (const day of DAYS) {
      const maxP = maxPeriod(day);
      let ps;
      if (scfg.allowedMode && scfg.allowedSlots && Object.keys(scfg.allowedSlots).length) {
        ps = (scfg.allowedSlots[day] || []).slice();
      } else {
        ps = [];
        for (let p = 1; p <= maxP; p++) ps.push(p);
      }
      for (const p of ps) {
        if (p < 1 || p > maxP) continue;
        if (span === 2 && p === maxP) continue;
        // subject fixed/allowed & other hard constraints are inside validatePlacement
        const v = validatePlacement(id, day, p, 'safe', null);
        if ((v.blocks || []).length) continue;

        let score = 100;
        score -= (v.warns || []).length * 7;
        // teacher load penalty
        for (const tea of (it.teas || [])) {
          score -= teacherDayCount(tea, day) * 3;
        }
        if (p <= 2) score += 6;
        else if (p <= 4) score += 3;

        // bonus: allowedMode slots are usually "fixed" → encourage using them
        if (scfg.allowedMode) score += 10;

        if (!best || score > best.score) best = { day, period: p, score };
      }
    }
    return best;
  }

  function bulkPlaceSubject(subjKey, opts = {}) {
    try { rebuildMastersFromRaw(); } catch (e) { }
    const includePlaced = !!opts.includePlaced;
    const silent = !!opts.silent;
    const skipHistory = !!opts.skipHistory;
    const noRender = !!opts.noRender;

    const ids = Object.keys(state.items).filter(id => {
      const it = state.items[id];
      if (!it) return false;
      if (it.subjKey !== subjKey) return false;
      if (state.placements[id]?.locked) return false;
      return true;
    });
    if (!ids.length) { if (!silent) flash('対象のコマがありません'); return { placed: 0, failed: 0, total: 0 }; }

    // 対象: 未配置 +（Shiftなら既配置も）+ 禁制に乗ってしまっている既配置
    const targets = [];
    for (const id of ids) {
      const plc = state.placements[id];
      if (!plc) { targets.push(id); continue; }
      const abs = absoluteBlocksOf((validatePlacement(id, plc.day, plc.period, 'safe', null) || { blocks: [] }).blocks);
      if (abs.length) { targets.push(id); continue; }
      if (includePlaced) targets.push(id);
    }
    if (!targets.length) { if (!silent) flash('未配置/禁制のコマがありません'); return { placed: 0, failed: 0, total: 0 }; }

    if (!skipHistory) pushHistory('bulkSubjPlace');

    // backup current placements for safety (used when includePlaced)
    const backup = {};
    for (const id of targets) backup[id] = state.placements[id];

    // clear targets first
    for (const id of targets) state.placements[id] = null;
    invalidateIndex();

    // hardest-first
    targets.sort((a, b) => _bulkHardness(state.items[b]) - _bulkHardness(state.items[a]));

    let placed = 0, failed = 0;
    for (const id of targets) {
      const best = _bulkBestSlotFor(id);
      if (best) {
        state.placements[id] = { day: best.day, period: best.period, locked: !!backup[id]?.locked };
        placed++;
      } else {
        // restore if it was previously placed and we were moving it
        if (backup[id]) state.placements[id] = backup[id];
        else state.placements[id] = null;
        failed++;
      }
      invalidateIndex();
    }

    markDirty('place');
    if (!noRender) {
      rerenderAll();
      broadcastState();
    }
    if (!silent) flash(`一括配置（${subjKey}）: 成功 ${placed} / 失敗 ${failed}`);
    return { placed, failed, total: targets.length };
  }

  /* =======================
     Edit view (Grid / Stock / Prop)
  ======================= */
  // prefer delegated DnD
  window._useDelegatedDnd = true;
  function rerenderEdit() {
    applyBodyClasses();
    applyDensity();
    // v32.3: apply stock size
    const _sz = state.ui.stockSize || 'md';
    document.body.setAttribute('data-stock-size', _sz);
    const _wMap = { xs: '80px', sm: '100px', md: '128px', lg: '160px', xl: '200px' };
    document.documentElement.style.setProperty('--stockItemW', _wMap[_sz] || '128px');
    renderStock();
    renderGrid();
    renderProp();
    $('#stock-search').value = state.ui.stockSearch || '';
    $('#row-filter').value = state.ui.rowFilter || '';
    $('#show-placed').checked = !!state.ui.showPlaced;
    $('#group-stock').checked = !!state.ui.groupStock;
    $('#density-fine').value = state.ui.densityFine;
    $('#density-fine-label').textContent = '±' + String(state.ui.densityFine);
    renderFloatLayer();
  }



  // ===== Row/Key normalization helpers (robust matching for relevant-row gating) =====
  function normalizeKey(s) {
    return String(s || '').replace(/[\u3000\s]+/g, '').replace(/[()（）]/g, '').toLowerCase();
  }


  function resolveAxisKey(kind, raw) {
    const nk = normalizeKey(raw);
    if (!nk) return raw;
    try {
      const keys = getAxisKeys(kind) || [];
      const hit = keys.find(k => normalizeKey(k) === nk);
      return hit || raw;
    } catch (e) { return raw; }
  }

  function scrollMainRowIntoView(kind, key) {
    // Main grid row header (teacher/class/room axis view)
    try {
      const th = document.querySelector(`.grid-wrapper th[data-rowkey="${CSS.escape(key)}"]`);
      if (th) th.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (e) { }
  }

  function scrollAllWindowToKey(kind, key) {
    // All-teachers / all-classes floating window
    try {
      const layer = document.getElementById('float-layer');
      if (!layer) return;
      const existId = `__all_${kind}__`;
      const win = layer.querySelector(`.atw-win[data-id="${CSS.escape(existId)}"]`);
      if (!win) return;
      const block = win.querySelector(`.atw-block[data-key="${CSS.escape(key)}"]`);
      if (block) block.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    } catch (e) { }
  }

  function uniqArr(a) { return Array.from(new Set(a.filter(Boolean))); }
  function teacherCandidates(key) {
    try { const cfg = (state.teacherCfg || {})[key] || {}; return uniqArr([key, cfg.name, cfg.abbr].map(normalizeKey)); } catch (e) { return [normalizeKey(key)]; }
  }
  function classCandidates(key) {
    try { const cfg = (state.classCfg || {})[key] || {}; return uniqArr([key, cfg.name, cfg.abbr].map(normalizeKey)); } catch (e) { return [normalizeKey(key)]; }
  }
  function roomCandidates(key) {
    try { const cfg = (state.roomCfg || {})[key] || {}; return uniqArr([key, cfg.name, cfg.abbr].map(normalizeKey)); } catch (e) { return [normalizeKey(key)]; }
  }
  function isRelevantRowByMode(tr, it, mode) {
    if (!tr || !it) return false;
    const rowKey = tr.getAttribute('data-row');
    const rowN = normalizeKey(rowKey);
    if (mode === 'teacher') {
      const teas = (it.teas && it.teas.length ? it.teas : ['(未)']);
      if (teas.includes('(未)') && (rowKey === '(未)' || rowN === '未')) return true;
      for (const t of (it.teas || [])) { const cands = teacherCandidates(t); if (cands.includes(rowN)) return true; }
      return false;
    } else if (mode === 'class') {
      for (const c of (it.cls || [])) { const cands = classCandidates(c); if (cands.includes(rowN)) return true; }
      return false;
    } else if (mode === 'room') {
      for (const r of (it.rooms || [])) { const cands = roomCandidates(r); if (cands.includes(rowN)) return true; }
      return false;
    }
    return true;
  }
  function applyBodyClasses() {
    const isTop = state.ui.stockPos === 'top';
    document.body.classList.toggle('stock-top', isTop);
    document.body.classList.toggle('thin', !!state.ui.stockThin);
    document.body.classList.toggle('prop-hide', !state.ui.propOn);

    // stock-top height — update the CSS variable on body (used in grid-template-rows)
    const h = Number(state.ui.stockTopH || (state.ui.stockThin ? 180 : 260));
    document.body.style.setProperty('--stockTopH', h + 'px');

    // DO NOT set stock.style.height — grid-template-rows controls row height, not element height
    const stock = $('#stock-panel');
    if (stock) stock.style.height = '';

    // Show/hide horizontal splitter via JS (overrides inline display:none in HTML)
    const splitTop = $('#split-stock-top');
    if (splitTop) splitTop.style.display = isTop ? 'block' : 'none';
  }
  function applyDensity() {
    const wrap = $('#grid-wrapper');
    if (!wrap) return;
    let dl = 3;
    if (state.ui.densityMode === 'tight') dl = 1;
    if (state.ui.densityMode === 'mid') dl = 3;
    if (state.ui.densityMode === 'wide') dl = 5;
    if (state.ui.densityMode === 'auto') {
      const w = wrap.clientWidth || 1000;
      dl = w < 980 ? 1 : w < 1180 ? 2 : w < 1480 ? 3 : w < 1780 ? 4 : 5;
    }
    dl = clamp(dl + Number(state.ui.densityFine || 0), 0, 6);

    // font/cell adjustments (stepwise)
    const fs = clamp(Number(state.ui.fontStep || 0), -3, 3);
    const cs = clamp(Number(state.ui.cellStep || 0), -3, 3);
    wrap.style.setProperty('--subAdj', (fs * 1) + 'px');
    wrap.style.setProperty('--metaAdj', (fs * 1) + 'px');
    wrap.style.setProperty('--tdhAdj', (cs * 4) + 'px');
    const fsl = $('#font-step-label'); if (fsl) fsl.textContent = `±${fs}`;
    const csl = $('#cell-step-label'); if (csl) csl.textContent = `±${cs}`;

    wrap.dataset.dl = String(dl);
  }


  function inferTeacherDept(teacherName) {
    const cfg = state.teacherCfg[teacherName] || {};
    const direct = (cfg.dept || '').trim();
    if (direct) return direct;

    // infer from taught subjects
    const counts = new Map();
    for (const id of Object.keys(state.items)) {
      const it = state.items[id];
      if (!it || !it.teas || !it.teas.includes(teacherName)) continue;
      const sd = (state.subjectCfg[it.subjKey]?.dept || '').trim();
      const key = sd || '(未設定)';
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    let best = '', bestN = 0;
    for (const [k, n] of counts.entries()) {
      if (n > bestN) { best = k; bestN = n; }
    }
    return (best === '(未設定)') ? '' : best;
  }
  function getAxisKeys(mode) {
    const ids = Object.keys(state.items);
    const set = new Set();
    if (mode === 'teacher') {
      for (const id of ids) {
        const it = state.items[id];
        const teas = it.teas.length ? it.teas : ['(未)'];
        teas.forEach(t => set.add(t));
      }
      const keys = Array.from(set);
      if (state.ui.teacherSort === 'manual') {
        // use saved order, append new ones
        const order = Array.isArray(state.ui.teacherOrder) ? state.ui.teacherOrder.slice() : [];
        const setKeys = new Set(keys);
        const out = [];
        for (const k of order) { if (setKeys.has(k)) out.push(k); }
        for (const k of keys) { if (!out.includes(k)) out.push(k); }
        state.ui.teacherOrder = out.slice();
        return out;
      }
      if (state.ui.teacherSort === 'subject') {
        // sort by (dept inferred) then name
        keys.sort((a, b) => {
          const da = inferTeacherDept(a);
          const db = inferTeacherDept(b);
          if (!da && db) return 1;
          if (da && !db) return -1;
          if (da !== db) return da.localeCompare(db, 'ja');
          return a.localeCompare(b, 'ja');
        });
      } else {
        keys.sort((a, b) => a.localeCompare(b, 'ja'));
      }
      return keys;
    }
    if (mode === 'class') {
      for (const id of ids) state.items[id].cls.forEach(c => set.add(c));
      return Array.from(set).sort((a, b) => a.localeCompare(b, 'ja'));
    }
    if (mode === 'room') {
      for (const id of ids) {
        const rooms = state.items[id].rooms.length ? state.items[id].rooms : ['(未)'];
        rooms.forEach(r => set.add(r));
      }
      return Array.from(set).sort((a, b) => a.localeCompare(b, 'ja'));
    }
    return [];
  }
  function rowMatchesFilter(key) {
    const q = (state.ui.rowFilter || '').trim();
    if (!q) return true;
    return key.includes(q);
  }

  function renderGrid() {
    const root = $('#grid'); if (!root) return;
    const mode = state.ui.viewMode;
    const keysAll = getAxisKeys(mode);
    const keys = keysAll.filter(rowMatchesFilter);
    const adays = activeDays();
    const maxP = adays.length ? Math.max(...adays.map(d => maxPeriod(d))) : 1;
    const lastDay = adays[adays.length - 1];
    let html = `<table class="timetable"><thead><tr><th>${mode === 'teacher' ? '教員' : mode === 'class' ? 'クラス' : '教室'}</th>`;
    for (const d of adays) {
      const sepCls = (d !== lastDay) ? ' day-sep' : '';
      html += `<th colspan="${maxPeriod(d)}" class="${sepCls.trim()}">${DAYJP[d]}</th>`;
    }
    html += `</tr><tr><th></th>`;
    for (const d of adays) {
      for (let p = 1; p <= maxPeriod(d); p++) {
        const isDaySep = (d !== lastDay) && (p === maxPeriod(d));
        html += `<th data-day="${d}" data-p="${p}" class="${isDaySep ? 'day-sep' : ''}">${p}</th>`;
      }
    }
    html += `</tr></thead><tbody>`;
    for (const key of keys) {
      const label = (mode === 'teacher') ? (state.teacherCfg[key]?.abbr || key) : key;
      const title = (mode === 'teacher') ? key : '';
      html += `<tr data-row="${escapeAttr(key)}"><th draggable="true" data-rowkey="${escapeAttr(key)}" title="${escapeAttr(title)}">${escapeHtml(label)}</th>`;
      for (const d of adays) {
        for (let p = 1; p <= maxPeriod(d); p++) {
          let forbid = false;
          if (mode === 'teacher') {
            forbid = isUnavailableForTeacher(key, d, p);
          }
          // クラスモード・教室モードでは教員不定のため、セル自体の禁則表示は行わない
          // (ドラッグ中のハイライト◎/×バッジで個別に判定される)
          const isDaySep = (d !== lastDay) && (p === maxPeriod(d));
          const cls = [forbid ? 'forbidden' : '', isDaySep ? 'day-sep' : ''].filter(Boolean).join(' ');
          html += `<td data-day="${d}" data-p="${p}" class="${cls}"></td>`;
        }
      }
      html += `</tr>`;
    }
    html += `</tbody></table>`;
    root.innerHTML = html;

    // v43: Delegated drag-and-drop on the grid root — most reliable approach
    // This catches ALL drops regardless of which child element is the target
    root.ondragover = (ev) => {
      const td = ev.target.closest('td[data-day][data-p]');
      if (!td) return;
      ev.preventDefault();
      ev.dataTransfer.dropEffect = 'move';
      // 既存のhint解除
      root.querySelectorAll('.drop-hint').forEach(el => el.classList.remove('drop-hint'));
      td.classList.add('drop-hint');
      // 列全体ハイライト（同じ曜日×時限の全行）
      const day = td.dataset.day, p = td.dataset.p;
      root.querySelectorAll('.col-drag-over').forEach(el => el.classList.remove('col-drag-over'));
      root.querySelectorAll(`td[data-day="${day}"][data-p="${p}"]`).forEach(el => el.classList.add('col-drag-over'));
    };
    root.ondragleave = (ev) => {
      // only clear if leaving the grid entirely
      if (!root.contains(ev.relatedTarget)) {
        root.querySelectorAll('.drop-hint').forEach(el => el.classList.remove('drop-hint'));
        root.querySelectorAll('.col-drag-over').forEach(el => el.classList.remove('col-drag-over'));
      }
    };
    root.ondrop = (ev) => {
      ev.preventDefault();
      root.querySelectorAll('.drop-hint').forEach(el => el.classList.remove('drop-hint'));
      root.querySelectorAll('.col-drag-over').forEach(el => el.classList.remove('col-drag-over'));
      const td = ev.target.closest('td[data-day][data-p]');
      if (!td) return;
      const dropId = ev.dataTransfer.getData('text/plain') || ev.dataTransfer.getData('id') || window._currentDragId;
      if (!dropId) return;
      if (state.ui.tool === 'erase') { flash('消すツール中'); return; }
      placeItem(dropId, td.dataset.day, parseInt(td.dataset.p, 10), { mode: state.ui.drop || 'safe' });
    };

    // row header actions (remember last, dblclick opens floating)
    for (const th of root.querySelectorAll('th[data-rowkey]')) {
      th.onclick = () => { state.ui.lastRow = { kind: mode, key: th.dataset.rowkey }; };
      th.ondblclick = () => { state.ui.lastRow = { kind: mode, key: th.dataset.rowkey }; openFloat(mode, th.dataset.rowkey); rerenderAll(); };
    }

    // fill cells
    const idx = buildIndex(); // for quick
    for (const tr of root.querySelectorAll('tbody tr')) {
      const rowKey = tr.dataset.row;
      for (const td of tr.querySelectorAll('td[data-day]')) {
        const day = td.dataset.day; const p = parseInt(td.dataset.p, 10);
        const ids = idsInCellForRow(mode, rowKey, day, p, idx);
        const stack = document.createElement('div');
        stack.className = 'cell-stack';
        // span fill
        for (const id of ids) {
          if (isSpanFill(id, day, p)) {
            // v32.4: show a continuation card for the 2nd period of a 2-span lesson
            td.classList.add('spanfill');
            const card = renderLessonCard(id, mode, rowKey, true); // true = continuation
            if (card) stack.appendChild(card);
          } else {
            const card = renderLessonCard(id, mode, rowKey, false);
            if (card) stack.appendChild(card);
          }
        }
        // v32.5: overflow badge - show warning when multiple items in same cell
        const realIds = ids.filter(x => !isSpanFill(x, day, p));
        if (realIds.length > 1) {
          // Check if ALL are parallel - if so, show info badge (blue), not error
          const allParallel = realIds.every(x => state.items[x]?.parallel);
          const names = realIds.map(x => { const s = state.subjectCfg[state.items[x]?.subjKey] || {}; return s.abbr || state.items[x]?.subj || x; }).join(', ');
          if (allParallel) {
            // v49: 並列グループを視覚的にまとめて表示
            stack.classList.add('parallel-stack');
            // 合同授業のサマリヘッダを挿入
            const it0 = state.items[realIds[0]];
            const sc0 = state.subjectCfg[it0?.subjKey] || {};
            const subjAbbr = sc0.abbr || it0?.subj || '';
            const allCls = [...new Set(realIds.flatMap(id => state.items[id]?.cls || []))];
            const allTea = [...new Set(realIds.flatMap(id => state.items[id]?.teas || []).map(t => state.teacherCfg[t]?.abbr || t))];
            const header = document.createElement('div');
            header.className = 'parallel-group-header';
            header.title = `合同授業: ${allCls.join('・')}（${names}）`;
            header.innerHTML = `<span class="pg-icon">⇉</span><span class="pg-label">${escapeHtml(subjAbbr.slice(0, 4))}</span><span class="pg-count">${realIds.length}cl</span>`;
            stack.insertBefore(header, stack.firstChild);
          } else {
            const badge = document.createElement('div');
            badge.className = 'cell-overflow-badge';
            badge.title = '重複: ' + `${realIds.length}コマ（${names}）`;
            badge.textContent = `⚠ ${realIds.length}重`;
            stack.appendChild(badge);
          }
        }
        td.innerHTML = '';
        td.appendChild(stack);

        // ★ cell-stack にもdragoverとdropを付与（カードがドロップイベントを吸収するのを防ぐ）
        stack.ondragover = (ev) => { ev.preventDefault(); ev.dataTransfer.dropEffect = 'move'; };
        stack.ondrop = (ev) => {
          ev.preventDefault();
          td.classList.remove('drop-hint');
          const dropId = ev.dataTransfer.getData('text/plain') || ev.dataTransfer.getData('id') || window._currentDragId;
          if (!dropId) return;
          if (state.ui.tool === 'erase') { flash('消すツール中'); return; }
          placeItem(dropId, day, p, { mode: state.ui.drop || 'safe' });
        };

        td.ondragover = (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          ev.dataTransfer.dropEffect = 'move';
          td.classList.add('drop-hint');
          // v48: ドラッグ中プレビュー（制約チェック結果をセルに表示）
          const dragId = window._currentDragId;
          if (dragId && dragId !== td._previewId) {
            td._previewId = dragId;
            td.classList.remove('drag-preview-ok', 'drag-preview-warn', 'drag-preview-ng');
            try {
              const v = validatePlacement(dragId, day, p, 'safe', null);
              if (v.blocks.length) {
                td.classList.add('drag-preview-ng');
                td.title = '✗ ' + v.blocks[0];
              } else if (v.warns.length) {
                td.classList.add('drag-preview-warn');
                td.title = '△ ' + v.warns[0];
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
        };
        td.ondrop = (ev) => {
          try {
            ev.preventDefault();
            ev.stopPropagation();
            td.classList.remove('drop-hint');
            const id = ev.dataTransfer.getData('text/plain') || ev.dataTransfer.getData('id') || window._currentDragId;
            if (!id) return;
            if (state.ui.tool === 'erase') { flash('消すツール中'); return; }
            const dropMode = state.ui.drop || 'safe';
            placeItem(id, day, p, { mode: dropMode });
          } catch (e) {
            console.error('Error in ondrop:', e);
            flash('ドロップエラー: ' + e.message);
          }
        };

        td.oncontextmenu = (ev) => {
          ev.preventDefault();
          const any = ids.find(x => !isSpanFill(x, day, p));
          const menu = [];
          menu.push({ muted: true, label: `${DAYJP[day]}${p}` });
          if (any) {
            menu.push({ label: 'このコマを在庫へ', act: 'cell_to_stock', on: () => toStock(any) });
            menu.push({ label: 'このコマをロック/解除', act: 'cell_lock', on: () => toggleLock(any) });
            menu.push({ label: 'このコマの提案', act: 'cell_sug', on: () => openPropSuggestions(any) });
            menu.push({ sep: true });
          }
          if (state.ui.selectedId) {
            menu.push({ label: '選択中コマをここへ移動', act: 'cell_move', on: () => placeItem(state.ui.selectedId, day, p, { mode: state.ui.drop }) });
            menu.push({ label: '選択解除', act: 'cell_clear', on: () => selectId(null, 'grid') });
          } else {
            menu.push({ label: '(コマを選択すると移動/提案ができます)', muted: true });
          }
          showCtxMenu(menu, ev.clientX, ev.clientY);
        };
        // v63.4: 空きセルのダブルクリックで「ここに来れるコマ」の提案を表示
        td.ondblclick = (ev) => {
          const realIds = ids.filter(x => !isSpanFill(x, day, p));
          if (realIds.length > 0) return; // コマがあるセルはカード側のdblclickで処理される
          ev.preventDefault();
          openSlotSuggestions(day, p);
        };
        td.onclick = () => {
          // tools
          if (state.ui.tool === 'erase') {
            const sid = state.ui.selectedId;
            if (sid && idCoversCell(sid, day, p)) toStock(sid);
            else {
              // if any lesson present, send top one to stock
              const any = ids.find(x => !isSpanFill(x, day, p));
              if (any) toStock(any);
            }
            return;
          }
          if (state.ui.tool === 'lock') {
            const any = ids.find(x => !isSpanFill(x, day, p));
            if (any) toggleLock(any);
            return;
          }
          // move
          if (state.ui.selectedId) {
            placeItem(state.ui.selectedId, day, p, { mode: state.ui.drop });
          } else {
            // select if exists
            const any = ids.find(x => !isSpanFill(x, day, p));
            if (any) selectId(any, 'grid');
          }
        };
      }
    }

    // row header drag for reordering (teacher manual)
    root.querySelectorAll('tbody th[draggable="true"]').forEach(th => {
      th.ondragstart = (ev) => {
        ev.dataTransfer.setData('rowkey', th.dataset.rowkey);
        ev.dataTransfer.effectAllowed = 'move';
      };
      th.ondblclick = (ev) => { ev.preventDefault(); openFloat(state.ui.viewMode, th.dataset.rowkey); };
      th.ondragover = (ev) => { if (state.ui.viewMode === 'teacher' && state.ui.teacherSort === 'manual') ev.preventDefault(); };
      th.oncontextmenu = (ev) => {
        ev.preventDefault();
        const k = th.dataset.rowkey;
        const menu = [];
        menu.push({ label: 'この行をフロート表示', on: () => openFloat(state.ui.viewMode, k) });
        menu.push({ sep: true });
        menu.push({ label: '並び替え(ドラッグ)の説明', muted: true });
        showCtxMenu(menu, ev.clientX, ev.clientY);
      };
      th.ondrop = (ev) => {
        if (!(state.ui.viewMode === 'teacher' && state.ui.teacherSort === 'manual')) return;
        ev.preventDefault();
        const from = ev.dataTransfer.getData('rowkey');
        const to = th.dataset.rowkey;
        if (!from || !to || from === to) return;
        pushHistory('teaOrder');
        const ord = Array.isArray(state.ui.teacherOrder) ? state.ui.teacherOrder.slice() : getAxisKeys('teacher');
        const a = ord.filter(x => x !== from);
        const idx = a.indexOf(to);
        a.splice(Math.max(idx, 0), 0, from);
        state.ui.teacherOrder = a;
        markDirty('ui');
        renderGrid();
        broadcastState();
      };
    });

    // v41: ヒートマップ再適用
    if (typeof _heatmapActive !== 'undefined' && _heatmapActive) requestAnimationFrame(() => { try { applyHeatmap(); } catch (e) { } });

    // ── 列リサイズ (Excelライク) ──
    _initColResize(root);
  }

  function _initColResize(root) {
    const table = root.querySelector('table.timetable');
    if (!table) return;

    // 2行目のヘッダ（曜日×時限）にリサイズハンドルを注入
    const headerRow2 = table.querySelectorAll('thead tr')[1];
    if (!headerRow2) return;

    // col幅の状態を保持
    state.ui.colWidths = state.ui.colWidths || {};

    // 保存済み幅を適用
    const allCols = table.querySelectorAll('col');
    // colgroup がなければ作成
    let colgroup = table.querySelector('colgroup');
    if (!colgroup) {
      colgroup = document.createElement('colgroup');
      // 先頭(行ラベル列)
      const c0 = document.createElement('col');
      c0.dataset.colkey = '_row';
      if (state.ui.colWidths['_row']) c0.style.width = state.ui.colWidths['_row'] + 'px';
      colgroup.appendChild(c0);
      // 各曜日×時限
      const days = [...table.querySelectorAll('thead tr:first-child th')];
      days.shift(); // skip first (row label)
      for (const th of table.querySelectorAll('thead tr:nth-child(2) th')) {
        const c = document.createElement('col');
        const key = (th.dataset.day || '') + (th.dataset.p || th.textContent.trim());
        c.dataset.colkey = key;
        if (state.ui.colWidths[key]) c.style.width = state.ui.colWidths[key] + 'px';
        colgroup.appendChild(c);
      }
      table.insertBefore(colgroup, table.firstChild);
    }

    // ヘッダ各thにリサイズハンドルを追加
    const thList = [...headerRow2.querySelectorAll('th')];
    thList.forEach((th, i) => {
      th.style.position = 'relative';
      th.style.userSelect = 'none';
      if (th.querySelector('.col-resize-handle')) return; // 重複防止
      const handle = document.createElement('div');
      handle.className = 'col-resize-handle';
      handle.title = 'ドラッグで列幅変更';
      th.appendChild(handle);

      let startX, startW;
      handle.addEventListener('mousedown', ev => {
        ev.preventDefault();
        ev.stopPropagation();
        startX = ev.clientX;
        // 現在の列幅を取得
        const col = colgroup.children[i + 1]; // +1 for row col
        startW = col ? (parseInt(col.style.width) || th.offsetWidth) : th.offsetWidth;

        const onMove = e => {
          const diff = e.clientX - startX;
          const newW = Math.max(32, startW + diff);
          if (col) col.style.width = newW + 'px';
          const key = col?.dataset.colkey || String(i);
          state.ui.colWidths[key] = newW;
        };
        const onUp = () => {
          markDirty('ui');
          window.removeEventListener('mousemove', onMove);
          window.removeEventListener('mouseup', onUp);
          document.body.style.cursor = '';
        };
        document.body.style.cursor = 'col-resize';
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
      });
    });
  }

  function idsInCellForRow(mode, rowKey, day, p, idx) {
    const out = [];
    if (mode === 'teacher') {
      const ids = idx.tea?.[rowKey]?.[day]?.[p] || [];
      ids.forEach(id => out.push(id));
    } else if (mode === 'class') {
      const ids = idx.cls?.[rowKey]?.[day]?.[p] || [];
      ids.forEach(id => out.push(id));
    } else if (mode === 'room') {
      const ids = idx.room?.[rowKey]?.[day]?.[p] || [];
      ids.forEach(id => out.push(id));
    }
    return uniq(out);
  }


  function violationSummary(id) {
    const it = state.items[id]; const plc = state.placements[id];
    if (!it || !plc) return '';
    const idx = buildIndex();
    const msgs = [];
    for (let dp = 0; dp < (it.span || 1); dp++) {
      const day = plc.day; const p = plc.period + dp;
      // teacher conflicts
      for (const t of it.teas) {
        const arr = (idx.tea?.[t]?.[day]?.[p] || []).filter(x => x !== id);
        if (arr.length) msgs.push(`教員重複:${t}(${DAYJP[day]}${p})`);
      }
      // class conflicts
      for (const c of it.cls) {
        const arr = (idx.cls?.[c]?.[day]?.[p] || []).filter(x => x !== id);
        if (arr.length) msgs.push(`クラス重複:${c}(${DAYJP[day]}${p})`);
      }
      // room conflicts (only if room is set)
      for (const r of it.rooms || []) {
        const arr = (idx.room?.[r]?.[day]?.[p] || []).filter(x => x !== id);
        if (arr.length) msgs.push(`教室重複:${r}(${DAYJP[day]}${p})`);
      }
      // teacher unavailable
      if (state.ui.viewMode === 'teacher') { /* not needed */ }
      for (const t of it.teas) {
        if (isUnavailableForTeacher(t, day, p)) msgs.push(`教員不可:${t}(${DAYJP[day]}${p})`);
      }
    }
    // daily same subject ban (if enabled)
    if (state.settings?.noSameSubjectPerDay) {
      for (const c of it.cls) {
        const maxP = maxPeriod(plc.day);
        let cnt = 0;
        for (let pp = 1; pp <= maxP; pp++) {
          const ids = (idx.cls?.[c]?.[plc.day]?.[pp] || []);
          ids.forEach(x => { if (x !== id && state.items[x]?.subjKey === it.subjKey) cnt++; });
        }
        if (cnt) msgs.push(`同日同科目:${c}`);
      }
    }
    return uniq(msgs).slice(0, 6).join(' / ');
  }

  function renderLessonCard(id, mode, rowKey, isCont = false) {
    const it = state.items[id];
    const plc = state.placements[id];
    if (!it || !plc) return null;

    const scfg = state.subjectCfg[it.subjKey] || {};
    const color = getItemDisplayColor(id);
    const abbr = (scfg.abbr || it.subj || '').trim();

    const teaLabel = (it.teas||[]).map(t => state.teacherCfg[t]?.abbr || normalizeAbbr(t, 12) || t).join(',');
    const clsLabel = (it.cls||[]).join(',');
    const roomLabel = (it.rooms||[]).join(',');

    // Continuation card (2nd period of 2-span lesson)
    if (isCont) {
      const el = document.createElement('div');
      el.className = 'lesson span-cont' + (plc.locked ? ' locked' : '') + (state.ui.selectedId === id ? ' sel' : '');
      el.dataset.id = id;
      el.draggable = true;
      el.classList.add(mode === 'teacher' ? 'mode-teacher' : mode === 'class' ? 'mode-class' : 'mode-room');
      const contLabel = mode === 'teacher' ? (it.cls[0] || '') : (abbr || '');
      // el.title removed: browser tooltip suppressed (custom hover-tip used instead)
      el.style.background = color;
      el.style.color = isDark(color) ? 'rgba(255,255,255,.75)' : 'rgba(15,23,42,.6)';
      el.innerHTML = `<div class="l1"><div class="subj">↓ ${escapeHtml(contLabel)}</div></div>`;
      el.ondragstart = (ev) => {
        window._currentDragId = id;
        window._dragPending = true;
        ev.dataTransfer.setData('text/plain', id);
        try { ev.dataTransfer.setData('id', id); } catch { }
        ev.dataTransfer.effectAllowed = 'move';
      };
      el.ondragend = () => {
        window._dragPending = false;
        setTimeout(() => { if (!window._dragPending) window._currentDragId = null; }, 100);
      };
      el.onclick = (ev) => { ev.stopPropagation(); selectId(id, 'grid'); };
      el.ondblclick = (ev) => { ev.stopPropagation(); openPropSuggestions(id); };
      el.onmouseenter = (ev) => { try { showHoverTip(itemDetailText(id), ev.clientX, ev.clientY); } catch { } };
      el.onmousemove = (ev) => { try { showHoverTip(itemDetailText(id), ev.clientX, ev.clientY); } catch { } };
      el.onmouseleave = () => hideHoverTip();
      return el;
    }

    // Normal display rules
    let mainText = abbr;
    let subText = '';
    let footText = '';
    let showSecondRow = false;

    if (mode === 'teacher') {
      // Teacher axis: show class on 1st row, subject on 2nd row (readable)
      mainText = (it.cls && it.cls.length) ? it.cls.join(',') : '(未)';
      subText = ''; // avoid tiny right label
      showSecondRow = true;
      footText = (abbr || it.subjKey || it.subj || '').toString();
    } else if (mode === 'class') {
      mainText = abbr || it.subjKey || '(未)';
      // クラス窓：教員名を2行目に表示
      if (teaLabel) { footText = teaLabel; showSecondRow = true; }
    } else if (mode === 'room') {
      // 教室窓: クラス名（全体表示）+ 科目略称 + 教員略称
      mainText = (it.cls && it.cls.length) ? it.cls.join(',') : '(未)';
      subText = abbr;
      footText = teaLabel;
      showSecondRow = !!(footText);
    }

    const el = document.createElement('div');
    el.className = 'lesson' + (plc.locked ? ' locked' : '') + (state.ui.selectedId === id ? ' sel' : '');
    let vio = '';
    try { vio = violationSummary(id) || ''; } catch (e) { vio = ''; }
    if (vio) el.classList.add('violate');
    // v47-B4: スナップ差分ハイライト
    try {
      const diffCls = getSnapDiffForId(id);
      if (diffCls) el.classList.add(diffCls);
    } catch (e) { }
    el.draggable = true;
    el.dataset.id = id;
    el.classList.add(mode === 'teacher' ? 'mode-teacher' : mode === 'class' ? 'mode-class' : 'mode-room');
    // el.title removed: browser tooltip suppressed (custom hover-tip used instead)
    el.style.background = color;
    el.style.color = isDark(color) ? '#fff' : '#0f172a';

    el.innerHTML = `
    <div class="l1">
      <div class="subj">${escapeHtml(mainText)}</div>
      ${it.span === 2 ? '<span class="badge2">2連</span>' : ''}
      ${it.simul ? `<span class="badge-simul" title="同時展開（相乗り）${it.realSubj ? '：' + escapeHtml(it.realSubj) : ''}">同</span>` : ''}
      ${vio ? '<span class="vio-badge" title="' + escapeHtml(vio) + '">⚠</span>' : ''}
      ${(mode === 'room' || mode === 'teacher') && subText ? `<div class="rightlab">${escapeHtml(mode === 'room' ? subText.slice(0, 6) : subText.slice(0, 4))}</div>` : ``}
    </div>
    ${showSecondRow ? `
      <div class="l2">
        <div class="teacher">${escapeHtml(footText || '')}</div>
        ${mode === 'teacher' && roomLabel ? `<div class="roommini">${escapeHtml(roomLabel)}</div>` : ''}
      </div>
    ` : ``}
  `;

    el.ondragstart = (ev) => {
      window._currentDragId = id;
      window._dragPending = true;
      ev.dataTransfer.setData('text/plain', id);
      try { ev.dataTransfer.setData('id', id); } catch { }
      ev.dataTransfer.effectAllowed = 'move';
      setTimeout(() => highlightValidSlots(id), 0);
    };
    el.ondragend = () => {
      window._dragPending = false;
      // 遅延クリア: drop が先に完了する場合がある（Firefox等）
      setTimeout(() => { if (!window._dragPending) window._currentDragId = null; }, 100);
    };
    el.ondragover = (ev) => { ev.preventDefault(); ev.dataTransfer.dropEffect = 'move'; };
    el.ondrop = (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      const dropId = ev.dataTransfer.getData('text/plain') || ev.dataTransfer.getData('id') || window._currentDragId;
      if (!dropId || dropId === id) return;
      // drop onto a card - get the td parent and place there
      const tdEl = ev.target.closest('td[data-day]');
      if (tdEl) { const dday = tdEl.dataset.day; const dp = parseInt(tdEl.dataset.p, 10); if (dday && dp) placeItem(dropId, dday, dp, { mode: state.ui.drop || 'safe' }); }
    };
    el.onclick = (ev) => {
      ev.stopPropagation();
      if (ev.ctrlKey || ev.metaKey) {
        const sel = state.ui.gridMultiSel = state.ui.gridMultiSel || new Set();
        if (sel.has(id)) { sel.delete(id); el.classList.remove('grid-multi-sel'); }
        else { sel.add(id); el.classList.add('grid-multi-sel'); }
        _updateGridMultiBar();
      } else {
        selectId(id, 'grid');
      }
    };
    el.ondblclick = (ev) => { ev.stopPropagation(); openPropSuggestions(id); };

    el.oncontextmenu = (ev) => {
      ev.preventDefault();
      const menu = [
        { muted: true, label: `${abbr || it.subjKey}` },
        { label: '在庫へ', act: 'to_stock', on: () => toStock(id) },
        { label: (plc.locked ? 'ロック解除' : 'ロック'), act: 'lock', on: () => toggleLock(id) },
        { label: '配置/移動の提案', act: 'sug', on: () => openPropSuggestions(id) },
        { label: 'コピー（複製）', act: 'copy', on: () => copyItem(id) },
        { sep: true },
        { label: 'Ctrl+クリックで複数選択', muted: true },
        { label: '選択', act: 'sel', on: () => selectId(id, 'grid') }
      ];
      showCtxMenu(menu, ev.clientX, ev.clientY);
    };

    el.onmouseenter = (ev) => {
      try { showHoverTip(itemDetailText(id), ev.clientX, ev.clientY); } catch { }
      // v49 B-3: 関連コマをハイライト（同教員・同クラス）
      try { highlightRelated(id, true); } catch { }
    };
    el.onmousemove = (ev) => { try { showHoverTip(itemDetailText(id), ev.clientX, ev.clientY); } catch { } };
    el.onmouseleave = () => {
      hideHoverTip();
      try { highlightRelated(id, false); } catch { }
    };

    return el;
  }

  // v49 B-3: 関連コマ (同教員・同クラス) のハイライト
  function highlightRelated(id, on) {
    const it = state.items[id]; if (!it) return;
    // 関連IDを収集
    const relIds = new Set();
    const idx = buildIndex();
    for (const tea of it.teas || []) {
      for (const d of DAYS) for (let p = 1; p <= maxPeriod(d); p++) {
        (idx.tea?.[tea]?.[d]?.[p] || []).forEach(x => { if (x !== id) relIds.add(x); });
      }
    }
    for (const cls of it.cls || []) {
      for (const d of DAYS) for (let p = 1; p <= maxPeriod(d); p++) {
        (idx.cls?.[cls]?.[d]?.[p] || []).forEach(x => { if (x !== id) relIds.add(x); });
      }
    }
    // DOM要素に関連クラスを付与
    document.querySelectorAll('.lesson[data-id]').forEach(el2 => {
      const eid = el2.dataset.id;
      if (!eid) return;
      if (on && relIds.has(eid)) el2.classList.add('related-highlight');
      else el2.classList.remove('related-highlight');
    });
    // 在庫アイテムにも
    document.querySelectorAll('.stock-item[data-id]').forEach(el2 => {
      const eid = el2.dataset.id;
      if (!eid) return;
      if (on && relIds.has(eid)) el2.classList.add('related-highlight');
      else el2.classList.remove('related-highlight');
    });
  }

  function selectId(id, from) {
    if (!id) clearValidSlots();  // Fix: clear arrows when deselecting
    state.ui.selectedId = id || null;
    state.ui.selectedFrom = from;
    renderProp();
    // highlight in grid/stock by rerender parts
    renderGrid();
    renderStock();

    // Show/hide quick action bar (v34.4)
    renderQuickActionBar();
    // F6: constraint overlay if active
    try { if (state.ui.constraintOverlay) applyConstraintOverlay(); } catch (e) {}
  }

  /* =======================
     Quick Action Bar (v34.4)
  ======================= */
  function renderQuickActionBar() {
    let bar = document.getElementById('quick-action-bar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'quick-action-bar';
      document.body.appendChild(bar);
    }

    const id = state.ui.selectedId;
    if (!id) {
      bar.classList.remove('show');
      return;
    }

    const it = state.items[id];
    if (!it) {
      bar.classList.remove('show');
      return;
    }

    const plc = state.placements[id];
    const scfg = state.subjectCfg[it.subjKey] || {};
    const abbr = (scfg.abbr || it.subj || '').slice(0, 6);
    const color = scfg.color || pickColor(it.subjKey);
    const cls = it.cls.join(',').slice(0, 12);
    const plcText = plc ? `${DAYJP[plc.day]}${plc.period}` : '未配置';

    bar.innerHTML = `
    <div class="qab-info">
      <div class="qab-chip" style="background:${color};color:${isDark(color) ? '#fff' : '#0f172a'}">${escapeHtml(abbr)}</div>
      <div class="qab-details">
        <div class="qab-cls">${escapeHtml(cls)}</div>
        <div class="qab-plc">${escapeHtml(plcText)}</div>
      </div>
    </div>
    <div class="qab-actions">
      ${!plc?.day ? `<button class="qab-btn qab-autoplace" title="最適な空き枠に即配置 (Space)">⚡ 即配置</button>` : ''}
      <button class="qab-btn qab-suggest" title="提案を開く (S)">💡 提案</button>
      <button class="qab-btn qab-lock" title="ロック/解除 (L)">${plc ? (plc.locked ? '🔓' : '🔒') : ''} ${plc ? (plc.locked ? '解除' : 'ロック') : 'ロック'}</button>
      ${plc?.day ? `<button class="qab-btn qab-stock" title="在庫へ (Del)">📦 在庫へ</button>` : ''}
      <button class="qab-btn qab-close" title="選択解除 (Esc)">✕</button>
    </div>
  `;

    bar.classList.add('show');

    // Bind actions
    if (bar.querySelector('.qab-autoplace')) {
      bar.querySelector('.qab-autoplace').onclick = () => quickAutoPlace(id);
    }
    bar.querySelector('.qab-suggest').onclick = () => openPropSuggestions(id);
    bar.querySelector('.qab-lock').onclick = () => { if (plc) toggleLock(id); else showToast('未配置のコマはロックできません', 'warning'); };
    const stockBtn = bar.querySelector('.qab-stock');
    if (stockBtn) stockBtn.onclick = () => toStock(id);
    bar.querySelector('.qab-close').onclick = () => { selectId(null, ''); };
  }

  /* =======================
     Valid slot highlighting (drag/select)
  ======================= */
  function highlightValidSlots(id) {
    clearValidSlots();
    const st = (window.state || state);
    const it = st.items[id]; if (!it) return;
    const saved = st.placements[id]; st.placements[id] = null; invalidateIndex();
    const mode = st.ui.viewMode;
    const tdList = [];
    try {
      const root = document.getElementById('grid');
      root && root.querySelectorAll('tbody tr[data-row]').forEach(tr => {
        if (isRelevantRowByMode(tr, it, mode)) {
          tr.querySelectorAll('td[data-day][data-p]').forEach(td => tdList.push(td));
        }
      });
    } catch (e) { }
    try {
      document.querySelectorAll('.float-win').forEach(win => {
        const kind = win.getAttribute('data-kind'); const key = win.getAttribute('data-key');
        if ((mode === 'teacher' && kind !== 'teacher') || (mode === 'class' && kind !== 'class') || (mode === 'room' && kind !== 'room')) return;
        if (mode === 'teacher') { let ok = false; for (const t of (it.teas || [])) { if (teacherCandidates(t).includes(normalizeKey(key))) { ok = true; break; } } if (!ok) return; }
        else if (mode === 'class') { let ok = false; for (const c of (it.cls || [])) { if (classCandidates(c).includes(normalizeKey(key))) { ok = true; break; } } if (!ok) return; }
        else if (mode === 'room') { let ok = false; for (const r of (it.rooms || [])) { if (roomCandidates(r).includes(normalizeKey(key))) { ok = true; break; } } if (!ok) return; }
        const grid = win.querySelector('.float-grid'); if (!grid) return;
        grid.querySelectorAll('td[data-day][data-p]').forEach(td => tdList.push(td));
      });
    } catch (e) { }
    if (!tdList.length) { st.placements[id] = saved; invalidateIndex(); return; }
    const idx = buildIndex(); const span = it.span || 1;
    for (const td of tdList) {
      const day = td.dataset.day; const p = parseInt(td.dataset.p, 10);
      const v = validatePlacement(id, day, p, 'safe', null);
      let grade, label;
      if (v.blocks.length === 0) {
        let occ = false;
        for (let d = 0; d < span; d++) {
          const pp = p + d; if (pp < 1) continue;
          for (const t of (it.teas || [])) { if ((idx.tea?.[t]?.[day]?.[pp] || []).length) { occ = true; break; } }
          for (const c of (it.cls || [])) { if ((idx.cls?.[c]?.[day]?.[pp] || []).length) { occ = true; break; } }
        }
        if (occ) { grade = 'swap-slot'; label = '○'; } else { grade = 'valid-slot'; label = '◎'; }
      } else {
        const hard = v.blocks.some(isAbsoluteBlockMsg);
        if (hard) { grade = 'invalid-slot'; label = '×'; } else { grade = 'hard-slot'; label = '△'; }
      }
      td.classList.add(grade);
      const badge = document.createElement('div'); badge.className = 'slot-grade-badge ' + (label === '◎' ? 'grade-maru' : label === '○' ? 'grade-swap' : label === '△' ? 'grade-hard' : 'grade-ng');
      badge.textContent = label; badge.style.cssText = 'position:absolute;top:3px;right:4px;font-size:13px;font-weight:900;pointer-events:none;z-index:10;line-height:1';
      td.style.position = 'relative'; td.appendChild(badge);
    }
    st.placements[id] = saved; invalidateIndex();
    const clear = () => { clearValidSlots(); window.removeEventListener('dragend', clear); };
    window.addEventListener('dragend', clear, { once: true });
  }

  /* =======================
     SVG Arrow Suggestion Overlay — shows WITHIN teacher float windows
     Called when the user hovers a suggestion card in the proposal panel.
     For each move in the suggestion: opens the teacher's float window and
     draws an animated SVG arrow from the FROM cell to the TO cell.
  ======================= */
  let _previewSugCleanup = null;

  function clearSuggestionArrows() {
    try {
      // Remove viewport overlay (legacy cleanup)
      document.querySelectorAll('#suggestion-svg-overlay, .float-suggestion-svg').forEach(el => el.remove());
      if (_previewSugCleanup) { _previewSugCleanup(); _previewSugCleanup = null; }
    } catch { }
  }

  function previewSuggestionMoves(moves) {
    clearSuggestionArrows();
    if (!moves || !moves.length) return;

    // メイングリッドへの矢印オーバーレイ（全移動ステップを可視化）
    try { _drawMainGridArrows(moves); } catch (e) { console.warn('grid arrow error:', e); }

    const drawTimer = setTimeout(() => {
      // 既に開いている個人窓にも矢印を描画
      for (const m of moves) {
        const it = state.items[m.id];
        if (!it) continue;
        const fromPlc = state.placements[m.id];
        for (const tea of (it.teas || [])) {
          try {
            const floatWin = state.ui?.floats?.find(w => w.kind === 'teacher' && w.key === tea);
            if (!floatWin) continue;
            const floatEl = document.querySelector(`.float-win[data-id="${CSS.escape(floatWin.id)}"]`);
            if (!floatEl) continue;
            const gridEl = floatEl.querySelector('[data-role="grid"]');
            if (!gridEl) continue;
            const toTd = gridEl.querySelector(`td[data-day="${m.day}"][data-p="${m.period}"]`);
            const fromTd = fromPlc ? gridEl.querySelector(`td[data-day="${fromPlc.day}"][data-p="${fromPlc.period}"]`) : null;
            if (!toTd) continue;
            _drawFloatArrow(floatEl, fromTd, toTd, it);
          } catch (e) { console.warn('Arrow draw error:', e); }
        }
      }
    }, 80);

    _previewSugCleanup = () => {
      clearTimeout(drawTimer);
      document.querySelectorAll('.float-suggestion-svg, #main-grid-sug-svg').forEach(el => el.remove());
      document.querySelectorAll('.cell-suggest-from, .cell-suggest-to').forEach(el => {
        el.classList.remove('cell-suggest-from', 'cell-suggest-to');
      });
    };
  }

  function _drawMainGridArrows(moves) {
    document.getElementById('main-grid-sug-svg')?.remove();
    document.querySelectorAll('.cell-suggest-from,.cell-suggest-to').forEach(el => {
      el.classList.remove('cell-suggest-from', 'cell-suggest-to');
    });

    const root = document.getElementById('grid');
    if (!root || !moves || !moves.length) return;
    const mode = state.ui.viewMode;

    // Collect pairs: {fromRect, toRect, color, label}
    const arrows = [];
    for (const m of moves) {
      const it = state.items[m.id]; if (!it) continue;
      const fromPlc = state.placements[m.id];
      const scfg = state.subjectCfg[it.subjKey] || {};
      const color = scfg.color || '#ef4444';
      const label = (scfg.abbr || it.subj || '').slice(0, 4);

      const rowKeys = mode === 'teacher' ? (it.teas || [])
        : mode === 'class' ? (it.cls || [])
          : (it.rooms || []);

      // Fall back: if no row matched current mode, try all modes
      let found = false;
      for (const rk of rowKeys) {
        const tr = root.querySelector(`tbody tr[data-row="${CSS.escape(rk)}"]`);
        if (!tr) continue;
        found = true;
        const toTd = tr.querySelector(`td[data-day="${CSS.escape(m.day)}"][data-p="${m.period}"]`);
        const fromTd = fromPlc ? tr.querySelector(`td[data-day="${CSS.escape(fromPlc.day)}"][data-p="${fromPlc.period}"]`) : null;
        if (fromTd) fromTd.classList.add('cell-suggest-from');
        if (toTd) toTd.classList.add('cell-suggest-to');
        if (fromTd && toTd) {
          arrows.push({ from: fromTd.getBoundingClientRect(), to: toTd.getBoundingClientRect(), color, label });
        } else if (toTd) {
          // Only destination known (unplaced item): just mark TO
          arrows.push({ from: null, to: toTd.getBoundingClientRect(), color, label });
        }
      }

      // If no row found in current mode, highlight by day/period across all rows
      if (!found) {
        const toTds = root.querySelectorAll(`tbody td[data-day="${CSS.escape(m.day)}"][data-p="${m.period}"]`);
        toTds.forEach(td => td.classList.add('cell-suggest-to'));
        if (fromPlc) {
          const fromTds = root.querySelectorAll(`tbody td[data-day="${CSS.escape(fromPlc.day)}"][data-p="${fromPlc.period}"]`);
          fromTds.forEach(td => td.classList.add('cell-suggest-from'));
        }
      }
    }

    if (!arrows.length) return;

    // Create full-viewport SVG overlay
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.id = 'main-grid-sug-svg';
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svg.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;pointer-events:none;z-index:19999;overflow:visible';

    let defs = `<defs>`;
    let body = '';

    arrows.forEach(({ from, to, color, label }, i) => {
      const uid = `mgar${i}`;
      // Large arrowhead marker (white outline + colored fill)
      defs += `<marker id="${uid}o" markerWidth="14" markerHeight="10" refX="13" refY="5" orient="auto">
        <polygon points="0 0,14 5,0 10" fill="white"/>
      </marker>
      <marker id="${uid}" markerWidth="12" markerHeight="8" refX="11" refY="4" orient="auto">
        <polygon points="0 0,12 4,0 8" fill="${color}"/>
      </marker>`;

      const tx = to.left + to.width / 2;
      const ty = to.top + to.height / 2;

      if (from) {
        const fx = from.left + from.width / 2;
        const fy = from.top + from.height / 2;
        const dx = tx - fx, dy = ty - fy;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const r = 16; // cell half-size offset from center
        const sx = fx + dx / len * r, sy = fy + dy / len * r;
        const ex = tx - dx / len * (r + 14), ey = ty - dy / len * (r + 14);
        const mx = (sx + ex) / 2, my = (sy + ey) / 2; // midpoint for label
        // White shadow line then colored line
        body += `<line x1="${sx}" y1="${sy}" x2="${ex}" y2="${ey}" stroke="white" stroke-width="6" opacity="0.85" stroke-linecap="round" marker-end="url(#${uid}o)"/>`;
        body += `<line x1="${sx}" y1="${sy}" x2="${ex}" y2="${ey}" stroke="${color}" stroke-width="3.5" opacity="1" stroke-linecap="round" marker-end="url(#${uid})"/>`;
        // FROM badge: circle with "発" label
        body += `<circle cx="${fx}" cy="${fy}" r="11" fill="white" stroke="${color}" stroke-width="2.5"/>`;
        body += `<text x="${fx}" y="${fy + 4}" font-size="11" fill="${color}" text-anchor="middle" font-weight="900">発</text>`;
        // subject label midway
        if (label) {
          body += `<rect x="${mx - label.length * 4 - 4}" y="${my - 9}" width="${label.length * 8 + 8}" height="16" rx="3" fill="white" opacity="0.9"/>`;
          body += `<text x="${mx}" y="${my + 4}" font-size="11" fill="${color}" text-anchor="middle" font-weight="bold">${escapeHtml(label)}</text>`;
        }
      }
      // TO badge: circle with "着" label
      body += `<circle cx="${tx}" cy="${ty}" r="11" fill="white" stroke="#16a34a" stroke-width="2.5"/>`;
      body += `<text x="${tx}" y="${ty + 4}" font-size="11" fill="#16a34a" text-anchor="middle" font-weight="900">着</text>`;
    });

    defs += '</defs>';
    svg.innerHTML = defs + body;
    document.body.appendChild(svg);
  }

  function _drawFloatArrow(floatEl, fromTd, toTd, item) {
    // Add highlight classes to FROM/TO cells
    if (fromTd) fromTd.classList.add('cell-suggest-from');
    if (toTd) toTd.classList.add('cell-suggest-to');

    if (!fromTd || !toTd) return; // no arrow if only destination known (from stock)

    // Get positions relative to floatEl
    const floatRect = floatEl.getBoundingClientRect();
    const fromRect = fromTd.getBoundingClientRect();
    const toRect = toTd.getBoundingClientRect();
    if (!fromRect.width || !toRect.width) return;

    const fx = (fromRect.left + fromRect.width / 2) - floatRect.left;
    const fy = (fromRect.top + fromRect.height / 2) - floatRect.top;
    const tx = (toRect.left + toRect.width / 2) - floatRect.left;
    const ty = (toRect.top + toRect.height / 2) - floatRect.top;

    // Bezier control point
    const cx = (fx + tx) / 2 + (ty - fy) * 0.3;
    const cy = (fy + ty) / 2 - (tx - fx) * 0.3;

    const scfg = state.subjectCfg[item?.subjKey] || {};
    const color = scfg.color || '#0ea5e9';

    // Build SVG (positioned absolute over the float window)
    const uid = 'fsug_' + Math.random().toString(36).slice(2, 8);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.className = 'float-suggestion-svg';
    svg.style.cssText = `position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:200;overflow:visible`;
    svg.innerHTML = `
    <defs>
      <marker id="${uid}-head" markerWidth="9" markerHeight="7" refX="9" refY="3.5" orient="auto">
        <polygon points="0 0, 9 3.5, 0 7" fill="${color}" opacity="0.95"/>
      </marker>
      <filter id="${uid}-glow">
        <feGaussianBlur stdDeviation="2.5" result="blur"/>
        <feComposite in="SourceGraphic" in2="blur" operator="over"/>
      </filter>
    </defs>
    <!-- Glow -->
    <path d="M ${fx} ${fy} Q ${cx} ${cy} ${tx} ${ty}"
          stroke="${color}" stroke-width="7" fill="none" opacity="0.18"/>
    <!-- Main arrow -->
    <path d="M ${fx} ${fy} Q ${cx} ${cy} ${tx} ${ty}"
          stroke="${color}" stroke-width="2.8" fill="none" opacity="0.92"
          stroke-dasharray="7,4"
          marker-end="url(#${uid}-head)">
      <animate attributeName="stroke-dashoffset" from="0" to="-22" dur="0.9s" repeatCount="indefinite"/>
    </path>
    <!-- Start dot -->
    <circle cx="${fx}" cy="${fy}" r="5" fill="${color}" opacity="0.85">
      <animate attributeName="r" values="5;7;5" dur="1.2s" repeatCount="indefinite"/>
    </circle>
  `;
    // Float el must be position:relative (should be already)
    const oldStyle = floatEl.style.position;
    if (!floatEl.style.position || floatEl.style.position === '') floatEl.style.position = 'relative';
    floatEl.appendChild(svg);
  }

  function drawSuggestionArrows(id, fromPlc) {
    // Legacy function — now a no-op (arrows moved to previewSuggestionMoves)
  }
  function clearValidSlots() {
    $$('.valid-slot').forEach(el => el.classList.remove('valid-slot'));
    $$('.invalid-slot').forEach(el => el.classList.remove('invalid-slot'));
    $$('.swap-slot').forEach(el => el.classList.remove('swap-slot'));
    $$('.hard-slot').forEach(el => el.classList.remove('hard-slot'));
    $$('.slot-grade-badge').forEach(el => el.remove());
    // Remove all SVG overlays (main + float windows)
    document.querySelectorAll('#suggestion-svg-overlay, .float-suggestion-svg').forEach(el => el.remove());
    document.querySelectorAll('.cell-suggest-from,.cell-suggest-to').forEach(el => { el.classList.remove('cell-suggest-from'); el.classList.remove('cell-suggest-to'); });
    if (_previewSugCleanup) { try { _previewSugCleanup(); } catch { } _previewSugCleanup = null; }
  }

  /* =======================
     Drag Preview (v34.3)
  ======================= */
  let _dragPreviewId = null;
  function showDragPreview(td, id, day, period) {
    // Get dragged item from global drag state or selected
    if (!id && window._currentDragId) id = window._currentDragId;
    if (!id) return;

    const it = state.items[id];
    if (!it) return;

    // Check if placement would be valid
    const v = validatePlacement(id, day, period, 'safe', null);
    const isValid = v.blocks.length === 0;

    // Remove any existing preview in this cell
    hideDragPreview(td);

    // Create preview element
    const preview = document.createElement('div');
    preview.className = 'drag-preview' + (isValid ? ' valid-preview' : ' invalid-preview');
    preview.dataset.previewFor = id;

    const scfg = state.subjectCfg[it.subjKey] || {};
    const abbr = (scfg.abbr || it.subj || '').slice(0, 4);
    const color = scfg.color || pickColor(it.subjKey);
    const icon = isValid ? '✓' : '✗';

    preview.style.background = color;
    preview.style.color = isDark(color) ? '#fff' : '#0f172a';
    preview.innerHTML = `
    <div class="preview-abbr">${escapeHtml(abbr)}</div>
    <div class="preview-icon ${isValid ? 'ok' : 'ng'}">${icon}</div>
  `;

    td.appendChild(preview);
    _dragPreviewId = id;
  }

  function hideDragPreview(td) {
    const preview = td.querySelector('.drag-preview');
    if (preview) preview.remove();
  }

  function tdBelongsToRelevantRow(td, id) {
    try {
      if (!td || !id) return false;
      const st = (window.state || state); const it = st.items[id]; if (!it) return false;
      const tr = td.closest('tr[data-row]'); if (!tr) return false;
      const mode = st.ui.viewMode;
      return isRelevantRowByMode(tr, it, mode);
    } catch (e) { return false; }
  }


  function renderStock() {
    const list = $('#stock-list'); if (!list) return;
    const showPlaced = !!state.ui.showPlaced;
    const q = (state.ui.stockSearch || '').trim();
    const byDept = !!state.ui.groupStock; // v32.2: "教科順"
    const idsAll = Object.keys(state.items).filter(id => {
      const plc = state.placements[id];
      if (!showPlaced && plc) return false;
      const it = state.items[id];
      const blob = `${it.subj} ${it.cls.join(' ')} ${it.teas.join(' ')} ${it.rooms.join(' ')} ${(state.subjectCfg[it.subjKey]?.dept) || ''}`;
      return !q || blob.includes(q);
    });

    $('#stock-count').textContent = String(idsAll.length);
    list.innerHTML = '';

    // sort helpers
    const deptOf = (id) => (state.subjectCfg[state.items[id]?.subjKey]?.dept) || '';
    const subjKeyOf = (id) => (state.items[id]?.subjKey) || '';
    const clsOf = (id) => (state.items[id]?.cls || []).join(',');
    const key = (id) => `${deptOf(id)}${subjKeyOf(id)}${clsOf(id)}${id}`;

    const ids = idsAll.slice().sort((a, b) => key(a).localeCompare(key(b), 'ja'));

    if (!byDept) {
      ids.forEach(id => list.appendChild(stockItemEl(id)));
      _initBlockerAnalysis();
      return;
    }

    // Insert dept separators that span columns (no collapsible)
    let curDept = null;
    let cntDept = 0;
    const flush = () => {
      if (curDept == null) return;
      // update last sep count if needed (already set when created)
    };

    const deptCounts = new Map();
    ids.forEach(id => deptCounts.set(deptOf(id) || '（未設定）', (deptCounts.get(deptOf(id) || '（未設定）') || 0) + 1));

    for (const id of ids) {
      const d = deptOf(id) || '（未設定）';
      if (d !== curDept) {
        curDept = d;
        const sep = document.createElement('div');
        sep.className = 'stock-sep';
        // 教科の未配置コマ数を取得
        const unplacedInDept = ids.filter(x => deptOf(x) === d && !state.placements[x]).length;
        sep.innerHTML = `<span>${escapeHtml(d)}</span><span class="cnt">${deptCounts.get(d)}</span>${unplacedInDept > 0 ? `<button class="stock-sep-ai-btn" data-dept="${escapeAttr(d)}" title="${unplacedInDept}コマをAI配置">🤖</button>` : ''}`;
        sep.querySelector('.stock-sep-ai-btn')?.addEventListener('click', (e) => {
          e.stopPropagation();
          const targetIds = ids.filter(x => deptOf(x) === d && !state.placements[x]);
          if (!targetIds.length) { flash('未配置なし'); return; }
          aiPlaceSelected(new Set(targetIds));
        });
        list.appendChild(sep);
      }
      list.appendChild(stockItemEl(id));
    }
    // v48: イベント委譲でバッジクリックを処理
    _initBlockerAnalysis();
    // v49 B-1: 進捗バー更新
    try { updatePlacementProgress(); } catch (e) { }
  }

  function stockItemEl(id) {
    const it = state.items[id];
    const plc = state.placements[id];
    const scfg = state.subjectCfg[it.subjKey] || {};
    const color = getItemDisplayColor(id);
    // Abbreviation: up to 3 characters
    const rawAbbr = scfg.abbr || it.subj || '';
    const abbr3 = rawAbbr.slice(0, 3);
    const tea = it.teas.map(t => state.teacherCfg[t]?.abbr || normalizeAbbr(t, 8) || t).join(',');
    const cls = it.cls.join(',');
    const room = it.rooms.join(',');
    const el = document.createElement('div');
    const _isMultiSel = state.ui.stockMultiSel instanceof Set && state.ui.stockMultiSel.has(id);
    el.className = 'stock-item'
      + (state.ui.selectedId === id ? ' selected' : '')
      + (_isMultiSel ? ' stock-multi-sel' : '');
    el.draggable = true;
    el.dataset.id = id;
    el.style.borderLeft = `6px solid ${color}`;
    el.style.background = hexWithAlpha(color, 0.07);

    // Placement text
    let placeText, placeClass;
    if (plc) {
      const span2 = it.span === 2 ? `-${plc.period + 1}` : '';
      placeText = `${DAYJP[plc.day]}${plc.period}${span2}`;
      if (plc.locked) placeText += ' 🔒';
      placeClass = '';
    } else {
      placeText = '未配置';
      placeClass = 'unplaced';
    }

    // v46-C1: 配置可能性バッジ（未配置コマのみ）
    let placeabilityBadge = '';
    if (!plc) {
      try {
        const slotCount = _countValidSlots(id);
        if (slotCount === 0) {
          placeabilityBadge = `<span class="si-slot-badge slot-ng" title="配置できる枠がありません！クリックで原因分析" data-blocker-id="${id}" style="cursor:pointer">🚫 0</span>`;
        } else if (slotCount <= 2) {
          placeabilityBadge = `<span class="si-slot-badge slot-warn" title="${slotCount}枠のみ配置可能（クリックで原因分析）" data-blocker-id="${id}" style="cursor:pointer">⚠${slotCount}</span>`;
        } else if (slotCount <= 9) {
          placeabilityBadge = `<span class="si-slot-badge slot-caution" title="${slotCount}枠に配置可能">△${slotCount}</span>`;
        } else {
          placeabilityBadge = `<span class="si-slot-badge slot-ok" title="${slotCount}枠に配置可能">✓${slotCount}</span>`;
        }
      } catch (e) { placeabilityBadge = ''; }
    }

    // v49 B-4: 配置済みコマの違反チェック
    let stockVio = '';
    if (plc?.day) { try { stockVio = violationSummary(id) || ''; } catch (e) { } }

    el.innerHTML = `
    <div class="si-name">${escapeHtml(abbr3)}</div>
    <div class="si-chips">
      <span class="chip si-cls">${escapeHtml(cls.slice(0, 12))}</span>
      ${tea ? `<span class="chip si-tea">${escapeHtml(tea.slice(0, 10))}</span>` : ''}
      ${it.span === 2 ? `<span class="chip chip-span">2連</span>` : ''}
    </div>
    <div class="si-place-row">
      <div class="si-place ${placeClass}">${escapeHtml(placeText)}</div>
      ${stockVio ? `<span class="vio-badge" title="${escapeHtml(stockVio)}">⚠</span>` : ''}
      ${placeabilityBadge}
    </div>
  `;
    el.ondragstart = (ev) => {
      window._currentDragId = id;
      window._dragPending = true;
      ev.dataTransfer.setData('text/plain', id);
      try { ev.dataTransfer.setData('id', id); } catch { }
      ev.dataTransfer.effectAllowed = 'move';
      setTimeout(() => highlightValidSlots(id), 0); // v42: DOM変更をdragstart後に遅延（ドラッグ壊れ対策）
    };
    el.ondragend = () => {
      window._dragPending = false;
      setTimeout(() => { if (!window._dragPending) window._currentDragId = null; }, 100);
    };
    el.onclick = (ev) => {
      if (ev.ctrlKey || ev.metaKey) {
        // CTRL+クリック: 複数選択（toggleで追加/除去）
        const sel = state.ui.stockMultiSel = state.ui.stockMultiSel || new Set();
        if (sel.has(id)) { sel.delete(id); } else { sel.add(id); }
        el.classList.toggle('stock-multi-sel', sel.has(id));
        // ツールバーを更新
        _updateStockMultiBar();
        return;
      }
      // 通常クリック: 単一選択
      if (state.ui.stockMultiSel?.size) { state.ui.stockMultiSel.clear(); document.querySelectorAll('.stock-multi-sel').forEach(e => e.classList.remove('stock-multi-sel')); _updateStockMultiBar(); }
      selectId(id, 'stock');
    };
    el.ondblclick = (ev) => {
      ev.preventDefault();
      selectId(id, 'stock');
      const plc = state.placements[id];

      // v62.5: 在庫(未配置)のダブルクリックは「提案」を優先（Alt+ダブルクリックで即配置）
      if (ev.altKey && !plc?.day) {
        quickAutoPlace(id);
        return;
      }
      openPropSuggestions(id);

      // v62.5: 教員一覧（全授業）を開いている/教員軸のときは、その教員が見える位置へスクロール
      try {
        const it = state.items[id];
        const teaRaw = (it?.teas || [])[0];
        if (teaRaw) {
          const teaKey = resolveAxisKey('teacher', teaRaw);
          if (state.ui.viewMode === 'teacher') scrollMainRowIntoView('teacher', teaKey);
          scrollAllWindowToKey('teacher', teaKey);
        }
      } catch (e) { }
    };
    el.oncontextmenu = (ev) => {
      ev.preventDefault();
      const it2 = state.items[id];
      const abbr2 = (state.subjectCfg[it2?.subjKey]?.abbr || it2?.subj || id).slice(0, 12);
      const plc2 = state.placements[id];
      showCtxMenu([
        { muted: true, label: abbr2 },
        ...(plc2?.day ? [{ label: '在庫へ', act: 'to_stock', on: () => toStock(id) }] : []),
        { label: '削除（在庫から除去）', act: 'del_stock', on: () => {
          pushHistory('delStock');
          if (plc2?.day) toStock(id);
          delete state.items[id];
          delete state.placements[id];
          markDirty('items');
          rerenderAll();
        }},
        { label: 'コピー（複製）', act: 'copy', on: () => copyItem(id) },
        { label: '提案を開く', act: 'sug', on: () => openPropSuggestions(id) },
        { sep: true },
        { label: '選択', act: 'sel', on: () => selectId(id, 'stock') },
      ], ev.clientX, ev.clientY);
    };
    // hover tip
    el.onmouseenter = (ev) => {
      try { showHoverTip(itemDetailText(id), ev.clientX, ev.clientY); } catch { }
      try { highlightRelated(id, true); } catch { }
    };
    el.onmousemove = (ev) => { try { showHoverTip(itemDetailText(id), ev.clientX, ev.clientY); } catch { } };
    el.onmouseleave = () => {
      hideHoverTip();
      try { highlightRelated(id, false); } catch { }
    };
    return el;
  }

  /* v48: 配置不能コマ原因分析 - イベント委譲 */
  function _initBlockerAnalysis() {
    const list = document.getElementById('stock-list');
    if (!list || list._blockerBound) return;
    list._blockerBound = true;
    list.addEventListener('click', (ev) => {
      const badge = ev.target.closest('[data-blocker-id]');
      if (!badge) return;
      ev.stopPropagation();
      showBlockerAnalysis(badge.dataset.blockerId);
    });
  }

  function showBlockerAnalysis(id) {
    const it = state.items[id]; if (!it) return;
    const scfg = state.subjectCfg[it.subjKey] || {};
    const abbr = scfg.abbr || it.subj || id;

    // 全スロットをチェックして制約カテゴリ別集計
    const savedPlc = state.placements[id];
    state.placements[id] = null;
    invalidateIndex();

    const blockerMap = {}; // blockType -> count
    const slotDetails = []; // {day, p, blocks[], warns[]}

    for (const day of DAYS) {
      const maxP = maxPeriod(day);
      for (let p = 1; p <= maxP; p++) {
        if (it.span === 2 && p === maxP) continue;
        const v = validatePlacement(id, day, p, 'safe', null);
        if (v.blocks.length || v.warns.length) {
          for (const b of v.blocks) {
            // カテゴリ分類
            const cat = b.startsWith('固定禁則') ? '固定禁則'
              : b.startsWith('教員不可') ? '教員不可'
                : b.startsWith('教員重複') ? '教員重複'
                  : b.startsWith('クラス重複') ? 'クラス重複'
                    : b.startsWith('教室重複') ? '教室重複'
                      : b.startsWith('クラス時限上限') ? 'クラス時限超過'
                        : 'その他';
            blockerMap[cat] = (blockerMap[cat] || 0) + 1;
          }
          slotDetails.push({ day, p, blocks: v.blocks, warns: v.warns });
        }
      }
    }

    state.placements[id] = savedPlc;
    invalidateIndex();

    const totalSlots = DAYS.reduce((s, d) => s + maxPeriod(d), 0) - (it.span === 2 ? DAYS.length : 0);
    const blockedCount = slotDetails.filter(s => s.blocks.length).length;
    const warnOnly = slotDetails.filter(s => !s.blocks.length && s.warns.length).length;
    const freeCount = totalSlots - blockedCount - warnOnly;

    // カテゴリ別サマリ
    const catRows = Object.entries(blockerMap).sort((a, b) => b[1] - a[1])
      .map(([cat, cnt]) => `<div class="blocker-cat-row">
      <span class="blocker-cat-name">${escapeHtml(cat)}</span>
      <div class="blocker-cat-bar"><div class="blocker-cat-fill" style="width:${Math.round(cnt / totalSlots * 100)}%"></div></div>
      <span class="blocker-cat-cnt">${cnt}コマ</span>
    </div>`).join('');

    // スロット詳細グリッド (曜日×時限)
    const maxP2 = Math.max(...DAYS.map(d => maxPeriod(d)));
    let gridHTML = `<table class="blocker-grid"><thead><tr><th></th>`;
    for (const d of DAYS) gridHTML += `<th>${DAYJP[d]}</th>`;
    gridHTML += `</tr></thead><tbody>`;
    for (let p = 1; p <= maxP2; p++) {
      gridHTML += `<tr><th>${p}</th>`;
      for (const day of DAYS) {
        if (p > maxPeriod(day)) { gridHTML += `<td class="blocker-cell-off"></td>`; continue; }
        if (it.span === 2 && p === maxPeriod(day)) { gridHTML += `<td class="blocker-cell-off" title="2連は最終時限不可">—</td>`; continue; }
        const slot = slotDetails.find(s => s.day === day && s.p === p);
        if (!slot) { gridHTML += `<td class="blocker-cell-ok" title="◎ 配置可">◎</td>`; continue; }
        if (slot.blocks.length) {
          const tip = slot.blocks[0];
          gridHTML += `<td class="blocker-cell-ng" title="${escapeHtml(tip)}">✗</td>`;
        } else {
          gridHTML += `<td class="blocker-cell-warn" title="${escapeHtml(slot.warns[0] || '')}">△</td>`;
        }
      }
      gridHTML += `</tr>`;
    }
    gridHTML += `</tbody></table>`;

    const html = `
    <div class="blocker-wrap">
      <div class="blocker-summary">
        <span class="blocker-stat ok-stat">◎ 配置可: ${freeCount}</span>
        <span class="blocker-stat warn-stat">△ 警告あり: ${warnOnly}</span>
        <span class="blocker-stat ng-stat">✗ 不可: ${blockedCount}</span>
      </div>
      ${Object.keys(blockerMap).length ? `<div class="blocker-cats">${catRows}</div>` : ''}
      <div class="blocker-hint">◎=配置可  △=警告あり  ✗=配置不可（セルにカーソルで詳細）</div>
      ${gridHTML}
    </div>`;

    showModalHTML(`🔍 原因分析: 「${escapeHtml(abbr)}」${escapeHtml(it.cls.join(','))}`, html, null, '閉じる', '閉じる');
  }

  /* v47-B5: 在庫一括選択 */
  function _stockSelectAll(mode) {
    // 現在表示されているstock-itemを対象に選択
    const sel = state.ui.stockMultiSel = state.ui.stockMultiSel || new Set();
    const items = document.querySelectorAll('#stock-list .stock-item');
    if (!items.length) { flash('表示中のコマがありません'); return; }

    // modeに応じて対象を絞る
    let pivotSubjKey = null, pivotCls = null;
    const selId = state.ui.selectedId;
    if ((mode === 'dept' || mode === 'cls') && selId && state.items[selId]) {
      pivotSubjKey = state.items[selId].subjKey;
      pivotCls = (state.items[selId].cls || [])[0];
    }

    let added = 0;
    items.forEach(el => {
      const id = el.dataset.id; if (!id) return;
      const it = state.items[id]; if (!it) return;
      if (state.placements[id]) return; // 配置済みは除外

      if (mode === 'dept' && pivotSubjKey) {
        const scfg = state.subjectCfg[it.subjKey] || {};
        const pivotScfg = state.subjectCfg[pivotSubjKey] || {};
        if ((scfg.dept || it.subjKey) !== (pivotScfg.dept || pivotSubjKey)) return;
      }
      if (mode === 'cls' && pivotCls) {
        if (!(it.cls || []).includes(pivotCls)) return;
      }

      if (!sel.has(id)) { sel.add(id); el.classList.add('stock-multi-sel'); added++; }
    });

    if (added === 0 && mode !== 'displayed') {
      // 選択中コマがなければ全表示コマを選ぶ
      items.forEach(el => {
        const id = el.dataset.id; if (!id || state.placements[id]) return;
        if (!sel.has(id)) { sel.add(id); el.classList.add('stock-multi-sel'); added++; }
      });
    }
    _updateStockMultiBar();
    flash(added > 0 ? `${added}コマを追加選択` : '選択対象がありません');
  }

  /* v45: 在庫複数選択 (CTRL+クリック) */
  // v46-C1: 配置可能スロット数を高速カウント（インデックス利用）
  function _countValidSlots(id) {
    const it = state.items[id]; if (!it) return 0;
    const idx = buildIndex();
    const span = it.span || 1;
    let count = 0;
    for (const d of DAYS) {
      const maxP = maxPeriod(d);
      for (let p = 1; p <= maxP; p++) {
        if (span === 2 && p === maxP) continue;
        let ok = true;
        for (let dp = 0; dp < span && ok; dp++) {
          const pp = p + dp;
          if (pp > maxP) { ok = false; break; }
          if (isForbiddenForSubject(it.subjKey, d, pp)) { ok = false; break; }
          for (const t of it.teas || []) {
            if (isUnavailableForTeacher(t, d, pp)) { ok = false; break; }
            if ((idx.tea?.[t]?.[d]?.[pp] || []).length) { ok = false; break; }
            const maxD = teacherDailyMax(t);
            if (maxD != null && dp === 0) {
              let cnt = 0;
              for (let pp2 = 1; pp2 <= maxP; pp2++) if ((idx.tea?.[t]?.[d]?.[pp2] || []).length) cnt++;
              if (cnt + 1 > maxD) { ok = false; break; }
            }
          }
          for (const c of it.cls || []) {
            if ((idx.cls?.[c]?.[d]?.[pp] || []).length) { ok = false; break; }
          }
        }
        if (ok) count++;
      }
    }
    return count;
  }


  function _updateStockMultiBar() {
    const bar = document.getElementById('stock-multi-bar');
    const countEl = document.getElementById('stock-multi-count');
    const sel = state.ui.stockMultiSel;
    const n = sel?.size || 0;
    if (!bar) return;
    bar.style.display = n > 0 ? 'flex' : 'none';
    if (countEl) countEl.textContent = `${n}コマ選択中 (Ctrl+クリックで追加)`;
  }

  /* ─── F1: グリッド複数選択バー ─── */
  function _updateGridMultiBar() {
    const bar = document.getElementById('grid-multi-bar');
    const countEl = document.getElementById('grid-multi-count');
    const sel = state.ui.gridMultiSel;
    const n = sel?.size || 0;
    if (!bar) return;
    bar.style.display = n > 0 ? 'flex' : 'none';
    if (countEl) countEl.textContent = `${n}コマ選択中`;
  }
  function clearGridMultiSel() {
    if (state.ui.gridMultiSel) state.ui.gridMultiSel.clear();
    document.querySelectorAll('.grid-multi-sel').forEach(e => e.classList.remove('grid-multi-sel'));
    _updateGridMultiBar();
  }

  /* ─── F8: コピー（複製） ─── */
  function copyItem(id) {
    const it = state.items[id]; if (!it) return;
    pushHistory('copy');
    const newId = 'copy_' + id + '_' + Date.now().toString(36);
    state.items[newId] = deepClone(it);
    state.placements[newId] = null;
    markDirty('items');
    rerenderAll();
    flash(`📋 「${it.subj || it.subjKey}」を複製しました（在庫へ）`);
  }

  /* ─── F2: 履歴パネル ─── */
  function openHistoryPanel() {
    let panel = document.getElementById('history-panel');
    if (panel) { panel.classList.toggle('show'); return; }
    panel = document.createElement('div');
    panel.id = 'history-panel';
    panel.className = 'history-panel show';
    document.body.appendChild(panel);
    _renderHistoryPanel(panel);
  }
  function _renderHistoryPanel(panel) {
    const REASON_LABELS = {
      ai: 'AI配置', undo: 'Undo', redo: 'Redo', place: 'コマ配置',
      toStock: '在庫へ', swap: '入替', lock: 'ロック', delStock: '削除',
      copy: 'コピー', projectImport: '読込', 'ai-run': 'AI探索',
    };
    const rows = historyPast.map((_, i) => {
      const meta = historyMeta[i] || {};
      const label = REASON_LABELS[meta.reason] || meta.reason || '操作';
      const t = meta.time ? new Date(meta.time).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
      return `<div class="hist-row" data-idx="${i}"><span class="hist-label">${escapeHtml(label)}</span><span class="hist-time">${t}</span></div>`;
    }).reverse().join('') || '<div class="muted small" style="padding:8px">履歴なし</div>';
    panel.innerHTML = `
      <div class="hist-header"><strong>📜 操作履歴</strong>
        <span class="muted small" style="flex:1;text-align:right">${historyPast.length}件</span>
        <button id="hist-close" style="background:none;border:none;cursor:pointer;font-size:16px;color:#64748b">✕</button>
      </div>
      <div class="hist-note muted small">クリックでその時点に戻す</div>
      <div class="hist-body">${rows}</div>`;
    panel.querySelector('#hist-close').onclick = () => panel.classList.remove('show');
    panel.querySelectorAll('.hist-row').forEach(row => {
      row.onclick = () => {
        const idx = parseInt(row.dataset.idx, 10);
        // Undo to this index: pop until historyPast.length === idx+1
        const targetLen = historyPast.length - idx;
        for (let k = 0; k < targetLen - 1; k++) {
          const cur = snapshotForHistory();
          const prev = historyPast.pop(); historyMeta.pop();
          historyFuture.push(cur);
          restoreFromHistory(prev);
        }
        markDirty('history');
        rerenderAll();
        panel.classList.remove('show');
        flash(`↩ ${historyMeta[idx]?.reason || '操作'} へ戻しました`);
      };
    });
  }

  /* ─── F3: コマ検索ハイライト ─── */
  function applyItemSearchHighlight() {
    const q = (state.ui.itemSearchQuery || '').trim().toLowerCase();
    let count = 0;
    document.querySelectorAll('.lesson, .stock-item').forEach(el => {
      if (!q) { el.classList.remove('search-match', 'search-dim'); return; }
      const id = el.dataset.id;
      if (!id) return;
      const it = state.items[id];
      if (!it) return;
      const text = [it.subj, it.subjKey, ...(it.teas || []), ...(it.cls || []), ...(it.rooms || [])].join(' ').toLowerCase();
      const match = text.includes(q);
      el.classList.toggle('search-match', match);
      el.classList.toggle('search-dim', !match);
      if (match) count++;
    });
    const countEl = document.getElementById('item-search-count');
    if (countEl) countEl.textContent = q ? `${count}件` : '';
  }

  /* ─── F6: 制約オーバーレイ（配置可否） ─── */
  function applyConstraintOverlay() {
    const active = state.ui.constraintOverlay;
    const selId = state.ui.selectedId;
    // clear
    document.querySelectorAll('.slot-ok, .slot-ng').forEach(e => { e.classList.remove('slot-ok', 'slot-ng'); });
    if (!active || !selId) return;
    const it = state.items[selId]; if (!it) return;
    const idx = buildIndex();
    document.querySelectorAll('td[data-day][data-p]').forEach(td => {
      const day = td.dataset.day; const period = parseInt(td.dataset.p, 10);
      if (!day || !period) return;
      // temporary placement check
      const ok = _canPlaceOnSlot(selId, it, day, period, idx);
      td.classList.add(ok ? 'slot-ok' : 'slot-ng');
    });
  }
  function _canPlaceOnSlot(id, it, day, period, idx) {
    const span = it.span || 1;
    const maxP = maxPeriod(day);
    if (period < 1 || period > maxP) return false;
    if (span === 2 && period === maxP) return false;
    for (let dp = 0; dp < span; dp++) {
      const p = period + dp;
      if (typeof isForbiddenForSubject === 'function' && isForbiddenForSubject(it.subjKey, day, p)) return false;
      for (const t of it.teas || []) {
        if (typeof isUnavailableForTeacher === 'function' && isUnavailableForTeacher(t, day, p)) return false;
        const occ = (idx.tea?.[t]?.[day]?.[p] || []).filter(x => x !== id);
        if (occ.length) return false;
      }
      for (const c of it.cls || []) {
        const occ = (idx.cls?.[c]?.[day]?.[p] || []).filter(x => x !== id);
        if (occ.length) return false;
      }
    }
    return true;
  }

  /* ─── F7: 競合ダッシュボード ─── */
  function showDashboard() {
    const idx = buildIdxFromPlacements(state.placements);
    const allIds = Object.keys(state.items);
    const placed = allIds.filter(id => state.placements[id]?.day);
    const unplaced = allIds.filter(id => !state.placements[id]?.day);

    // 教員負荷集計
    const teaLoad = {}; // tea -> {total, byDay:{Mon:n,...}, conflicts:n}
    for (const id of placed) {
      const it = state.items[id]; if (!it) continue;
      const plc = state.placements[id];
      const span = it.span || 1;
      for (const t of it.teas || []) {
        if (!teaLoad[t]) teaLoad[t] = { total: 0, byDay: {}, conflicts: 0 };
        teaLoad[t].total += span;
        teaLoad[t].byDay[plc.day] = (teaLoad[t].byDay[plc.day] || 0) + span;
      }
    }
    // 衝突カウント
    for (const t in idx.tea) {
      if (!teaLoad[t]) teaLoad[t] = { total: 0, byDay: {}, conflicts: 0 };
      for (const d of DAYS) for (let p = 1; p <= maxPeriod(d); p++) {
        const occ = idx.tea[t]?.[d]?.[p] || [];
        if (occ.length > 1) teaLoad[t].conflicts += occ.length - 1;
      }
    }
    // クラス充填率
    const clsFill = {}; // cls -> {filled, total}
    const classes = [...new Set(allIds.flatMap(id => state.items[id]?.cls || []))].sort();
    for (const cls of classes) {
      let total = 0, filled = 0;
      for (const d of DAYS) { const mp = maxPeriod(d); total += mp; for (let p = 1; p <= mp; p++) { if ((idx.cls?.[cls]?.[d]?.[p] || []).length) filled++; } }
      clsFill[cls] = { filled, total };
    }

    const teaSorted = Object.entries(teaLoad).sort((a, b) => b[1].total - a[1].total);
    const teaRows = teaSorted.map(([t, l]) => {
      const maxD = typeof teacherDailyMax === 'function' ? teacherDailyMax(t) : null;
      const over = maxD && l.total > maxD * DAYS.length;
      const conflStr = l.conflicts > 0 ? `<span style="color:#ef4444">衝突${l.conflicts}</span>` : '<span style="color:#10b981">✓</span>';
      const dayStr = DAYS.map(d => `${DAYJP[d]}:${l.byDay[d]||0}`).join(' ');
      return `<tr class="${over ? 'dash-over' : ''}"><td>${escapeHtml((state.teacherCfg[t]?.abbr||t).slice(0,8))}</td><td>${l.total}</td><td class="muted small">${dayStr}</td><td>${conflStr}</td></tr>`;
    }).join('');

    const clsRows = classes.map(cls => {
      const f = clsFill[cls] || { filled: 0, total: 0 };
      const pct = f.total ? Math.round(f.filled / f.total * 100) : 0;
      const bar = `<div style="width:${pct}%;height:6px;background:${pct>=100?'#10b981':pct>=80?'#3b82f6':'#f59e0b'};border-radius:3px"></div>`;
      return `<tr><td>${escapeHtml(cls)}</td><td>${f.filled}/${f.total}</td><td style="min-width:80px"><div style="background:#e5e7eb;border-radius:3px">${bar}</div></td><td class="muted small">${pct}%</td></tr>`;
    }).join('');

    const html = `
      <div class="dash-wrap">
        <div class="dash-summary">
          <div class="dash-card"><div class="dash-num">${placed.length}</div><div class="dash-lbl">配置済み</div></div>
          <div class="dash-card warn"><div class="dash-num">${unplaced.length}</div><div class="dash-lbl">未配置（在庫）</div></div>
          <div class="dash-card"><div class="dash-num">${teaSorted.filter(([,l])=>l.conflicts>0).length}</div><div class="dash-lbl">衝突教員</div></div>
          <div class="dash-card"><div class="dash-num">${classes.length}</div><div class="dash-lbl">クラス数</div></div>
        </div>
        <details open><summary class="dash-section-title">👩‍🏫 教員週コマ数</summary>
        <div class="dash-scroll"><table class="dash-table"><thead><tr><th>教員</th><th>計</th><th>曜日別</th><th>衝突</th></tr></thead><tbody>${teaRows||'<tr><td colspan="4" class="muted">データなし</td></tr>'}</tbody></table></div></details>
        <details open><summary class="dash-section-title">🏫 クラス充填率</summary>
        <div class="dash-scroll"><table class="dash-table"><thead><tr><th>クラス</th><th>配置/合計</th><th>充填</th><th>率</th></tr></thead><tbody>${clsRows||'<tr><td colspan="4" class="muted">データなし</td></tr>'}</tbody></table></div></details>
      </div>`;
    showModalHTML('📊 競合・負荷ダッシュボード', html, null, '閉じる', null);
  }

  /* v45: 指定コマIDのリストをAI配置する */
  function aiPlaceSelected(ids) {
    const targetIds = [...ids].filter(id => !state.placements[id]);
    if (!targetIds.length) { flash('未配置コマがありません（選択中コマはすでに配置済み）'); return; }

    const mode = $('#ai-mode')?.value || 'normal';
    const rand = clampNum(Number($('#ai-rand')?.value || 0) / 100, 0, 1, 0.20);
    const tries = 60;

    // 現在の配置をベースに選択コマだけ挿入試行
    const basePlacements = {};
    for (const id in state.placements) { if (state.placements[id]) basePlacements[id] = state.placements[id]; }
    // 対象コマは除外（未配置として扱う）
    for (const id of targetIds) basePlacements[id] = null;

    let best = null;

    for (let t = 0; t < tries; t++) {
      const placements = Object.assign({}, basePlacements);
      const idx = buildIdxFromPlacements(placements);

      // 難しい順にソート
      const order = targetIds.slice().sort((a, b) => {
        const slotCount = (id) => {
          const it = state.items[id]; if (!it) return 999;
          let c = 0;
          for (const d of DAYS) {
            for (let p = 1; p <= maxPeriod(d); p++) {
              let ok = true;
              for (let dp = 0; dp < (it.span || 1) && ok; dp++) {
                const pp = p + dp;
                if (isForbiddenForSubject(it.subjKey, d, pp)) ok = false;
                for (const tea of it.teas || []) { if (isUnavailableForTeacher(tea, d, pp)) ok = false; }
              }
              if (ok) c++;
            }
          }
          return c;
        };
        return slotCount(a) - slotCount(b);
      });
      if (rand > 0.15 && t > 0) shuffle(order);

      let placed = 0;
      for (const id of order) {
        const it = state.items[id]; if (!it) continue;
        const cands = [];
        for (const d of DAYS) {
          const mP = maxPeriod(d);
          for (let p = 1; p <= mP; p++) {
            if ((it.span || 1) === 2 && p === mP) continue;
            // hard constraints
            let ok = true;
            for (let dp = 0; dp < (it.span || 1) && ok; dp++) {
              const pp = p + dp;
              if (isForbiddenForSubject(it.subjKey, d, pp)) { ok = false; break; }
              for (const tea of it.teas || []) {
                if (isUnavailableForTeacher(tea, d, pp)) { ok = false; break; }
                if ((idx.tea?.[tea]?.[d]?.[pp] || []).length) { ok = false; break; }
                // 教員1日上限チェック
                const maxD = teacherDailyMax(tea);
                if (maxD != null) {
                  let cnt = 0;
                  for (let pp2 = 1; pp2 <= mP; pp2++) if ((idx.tea?.[tea]?.[d]?.[pp2] || []).length) cnt++;
                  if (dp === 0 && cnt + 1 > maxD) { ok = false; break; }
                }
              }
              for (const c of it.cls || []) { if ((idx.cls?.[c]?.[d]?.[pp] || []).length) { ok = false; break; } }
            }
            if (!ok) continue;
            // soft score (simple spread)
            let pen = 0;
            for (const c of it.cls || []) {
              for (const d2 of DAYS) for (let p2 = 1; p2 <= maxPeriod(d2); p2++) {
                for (const oid of (idx.cls?.[c]?.[d2]?.[p2] || [])) {
                  if (state.items[oid]?.subjKey === it.subjKey && d2 === d) pen += 2;
                }
              }
            }
            cands.push({ day: d, period: p, score: 100 - pen });
          }
        }
        if (!cands.length) continue;
        cands.sort((a, b) => b.score - a.score);
        const pick = (rand > 0.1 && cands.length > 1) ? cands[Math.floor(Math.random() * Math.min(4, cands.length))] : cands[0];
        placements[id] = { day: pick.day, period: pick.period, locked: false };
        // add to local idx
        const addIdx = (type, key, d, p) => { if (!idx[type]) idx[type] = {}; if (!idx[type][key]) idx[type][key] = {}; if (!idx[type][key][d]) idx[type][key][d] = {}; if (!idx[type][key][d][p]) idx[type][key][d][p] = []; idx[type][key][d][p].push(id); };
        for (let dp = 0; dp < (it.span || 1); dp++) {
          for (const tea of it.teas || []) addIdx('tea', tea, pick.day, pick.period + dp);
          for (const c of it.cls || []) addIdx('cls', c, pick.day, pick.period + dp);
        }
        placed++;
      }
      const remain = targetIds.filter(id => !placements[id]).length;
      if (!best || remain < best.remain) { best = { placements, remain, placed }; }
      if (best.remain === 0) break;
    }

    if (!best) { flash('AI配置失敗'); return; }

    pushHistory('ai-selected');
    for (const id of targetIds) {
      if (best.placements[id]) state.placements[id] = best.placements[id];
    }
    invalidateIndex(); markDirty('ai'); rerenderAll();

    // 選択解除
    state.ui.stockMultiSel?.clear();
    document.querySelectorAll('.stock-multi-sel').forEach(e => e.classList.remove('stock-multi-sel'));
    _updateStockMultiBar();

    flash(`AI: 選択${targetIds.length}コマ中${best.placed}コマ配置, 残${best.remain}`);
  }

  /* v45: 教科別一括AI配置（在庫の教科見出しからも呼べる） */
  function aiPlaceBySubjKey(subjKey) {
    const ids = Object.keys(state.items).filter(id => state.items[id]?.subjKey === subjKey && !state.placements[id]);
    if (!ids.length) { flash(`「${subjKey}」の未配置コマなし`); return; }
    aiPlaceSelected(new Set(ids));
  }


  let _dragPopEl = null;
  let _dragPopTimer = null;
  function hideDragPopup() {
    if (_dragPopEl) { _dragPopEl.remove(); _dragPopEl = null; }
    if (_dragPopTimer) { clearTimeout(_dragPopTimer); _dragPopTimer = null; }
  }
  function showDragPopup(id, x, y) {
    hideDragPopup();
    const it = state.items[id]; if (!it) return;
    let pack = null; try { pack = computeSuggestionPack(id); } catch (e) { console.error('computeSuggestionPack', e); showModal('エラー', '提案の計算でエラー: ' + e.message); return; }
    const allSugs = [...(pack.empty || []), ...(pack.swap || []), ...(pack.linked || [])]
      .sort((a, b) => b.score - a.score).slice(0, 3);
    if (!allSugs.length) return;

    const scfg = state.subjectCfg[it.subjKey] || {};
    const abbr = scfg.abbr || it.subj || '?';
    const color = scfg.color || pickColor(it.subjKey);
    const textCol = isDark(color) ? '#fff' : '#0f172a';

    // Build teacher mini-timetables
    function buildTeaTab(tea) {
      const idx = buildIndex();
      let html = `<div style="margin-right:12px;min-width:110px">
      <div style="font-size:10px;font-weight:900;color:#94a3b8;margin-bottom:3px">${escapeHtml(state.teacherCfg[tea]?.abbr || tea)}</div>
      <table style="border-collapse:collapse;font-size:9px">`;
      const maxP = Math.max(...DAYS.map(d => maxPeriod(d)));
      html += `<tr><th style="padding:1px 2px;color:#64748b"></th>${DAYS.map(d => `<th style="padding:1px 3px;color:#94a3b8">${DAYJP[d]}</th>`).join('')}</tr>`;
      for (let p = 1; p <= maxP; p++) {
        html += `<tr><td style="padding:1px 2px;color:#64748b;font-size:8px">${p}</td>`;
        for (const d of DAYS) {
          const ids = (idx.tea?.[tea]?.[d]?.[p] || []).filter(x => !isSpanFill(x, d, p));
          if (ids.length) {
            const fid = ids[0];
            const fitScfg = state.subjectCfg[state.items[fid]?.subjKey] || {};
            const fcol = fitScfg.color || pickColor(state.items[fid]?.subjKey || '');
            const fab = (fitScfg.abbr || state.items[fid]?.subj || '').slice(0, 3);
            html += `<td style="padding:1px 2px;background:${fcol};color:${isDark(fcol) ? '#fff' : '#000'};border-radius:2px;font-size:8px;font-weight:900;text-align:center;min-width:24px">${escapeHtml(fab)}</td>`;
          } else if (p > maxPeriod(d)) {
            html += `<td style="background:#1a2332;min-width:24px"></td>`;
          } else {
            html += `<td style="border:1px solid #1a2332;min-width:24px"></td>`;
          }
        }
        html += `</tr>`;
      }
      html += `</table></div>`;
      return html;
    }

    const teas = it.teas || [];
    const teaTabsHTML = teas.length
      ? `<div style="display:flex;gap:0;margin-bottom:10px;overflow-x:auto;padding-bottom:4px">${teas.map(buildTeaTab).join('')}</div>`
      : '';

    // Build suggestion rows
    const sugRowsHTML = allSugs.map((s, i) => {
      const m0 = s.moves?.[0]; if (!m0) return '';
      const moveCount = s.moves?.length || 1;
      const score = Math.round(s.score || 0);
      const sColor = score >= 75 ? '#22c55e' : score >= 50 ? '#f59e0b' : '#f43f5e';
      return `<div class="dp-sug-row" data-i="${i}" style="display:flex;align-items:center;gap:8px;padding:5px 6px;border-radius:6px;cursor:pointer;border-bottom:1px solid rgba(148,163,184,.15)">
      <div style="background:${scfg.color || '#334155'};color:${textCol};border-radius:4px;padding:2px 5px;font-size:11px;font-weight:900;min-width:24px;text-align:center">${escapeHtml(abbr.slice(0, 3))}</div>
      <div style="flex:1;font-size:11px;color:#e2e8f0">${escapeHtml(s.title || '')}</div>
      ${moveCount > 1 ? `<div style="font-size:9px;color:#64748b">${moveCount}コマ</div>` : ''}
      <div style="font-size:10px;font-weight:900;color:${sColor}">${score}</div>
    </div>`;
    }).join('');

    const pop = document.createElement('div');
    pop.className = 'drag-pop';
    pop.style.cssText = 'max-width:460px;min-width:300px;pointer-events:auto';
    pop.innerHTML = `
    <div class="dp-title" style="display:flex;align-items:center;gap:6px;margin-bottom:8px">
      <span style="background:${color};color:${textCol};border-radius:6px;padding:2px 8px;font-size:12px;font-weight:900">${escapeHtml(abbr.slice(0, 6))}</span>
      <span style="color:#94a3b8;font-size:11px">の配置案（クリックで適用）</span>
      <span style="margin-left:auto;font-size:10px;cursor:pointer;color:#64748b" data-close="1">✕</span>
    </div>
    ${teaTabsHTML}
    <div>${sugRowsHTML}</div>
    <div style="font-size:9px;color:#475569;margin-top:6px">右クリック→「提案」でより詳しく見られます</div>
  `;

    document.body.appendChild(pop);
    const rect = pop.getBoundingClientRect();
    let px = x + 14, py = y + 14;
    if (px + rect.width > window.innerWidth) px = Math.max(4, x - rect.width - 10);
    if (py + rect.height > window.innerHeight) py = Math.max(4, y - rect.height - 10);
    pop.style.left = px + 'px'; pop.style.top = py + 'px';

    // Bind row clicks
    pop.querySelectorAll('.dp-sug-row').forEach(row => {
      row.onmouseenter = () => row.style.background = 'rgba(148,163,184,.15)';
      row.onmouseleave = () => row.style.background = '';
      row.onclick = (ev) => {
        ev.stopPropagation();
        const i = parseInt(row.dataset.i, 10);
        const s = allSugs[i]; if (!s) return;
        hideDragPopup();
        applySuggestion(s);
      };
    });
    // Close button
    pop.querySelector('[data-close]')?.addEventListener('click', (ev) => { ev.stopPropagation(); hideDragPopup(); });

    _dragPopEl = pop;
    _dragPopTimer = setTimeout(hideDragPopup, 12000);
    setTimeout(() => {
      const close = (ev) => { if (!pop.contains(ev.target)) { hideDragPopup(); window.removeEventListener('mousedown', close); } };
      window.addEventListener('mousedown', close, { once: false });
    }, 100);
  }

  function renderProp() {
    const box = $('#prop-body'); if (!box) return;
    if (!state.ui.propOn) { box.innerHTML = ''; return; }
    const id = state.ui.selectedId;
    if (!id) {
      box.innerHTML = `<div class="prop-empty">在庫やコマをクリックすると詳細が表示されます。<br>ダブルクリックで「配置候補」を表示。</div>`;
      return;
    }
    const it = state.items[id];
    if (!it) { box.innerHTML = '<div class="prop-empty">不明</div>'; return; }
    const plc = state.placements[id];
    const scfg = state.subjectCfg[it.subjKey] || {};
    const tlabels = it.teas.map(t => state.teacherCfg[t]?.abbr || normalizeAbbr(t, 12) || t).join(',');

    // Compute available slots
    let validCount = 0, swapCount = 0, hardCount = 0;
    const savedPlc = state.placements[id];
    state.placements[id] = null;
    invalidateIndex();
    for (const day of DAYS) {
      const mP = maxPeriod(day);
      for (let p = 1; p <= mP; p++) {
        if (it.span === 2 && p === mP) continue;
        const v = validatePlacement(id, day, p, 'safe', null);
        if (v.blocks.length === 0) validCount++;
        else {
          const idx = buildIndex();
          let hasOcc = false;
          for (let dp = 0; dp < (it.span || 1); dp++) {
            for (const t of it.teas || []) { if ((idx.tea?.[t]?.[day]?.[p + dp] || []).length) { hasOcc = true; break; } }
            for (const c of it.cls || []) { if ((idx.cls?.[c]?.[day]?.[p + dp] || []).length) { hasOcc = true; break; } }
          }
          if (hasOcc) swapCount++;
          else hardCount++;
        }
      }
    }
    state.placements[id] = savedPlc;
    invalidateIndex();

    // Current violations
    let vioHTML = '';
    if (plc) {
      const v = validatePlacement(id, plc.day, plc.period, 'safe', null);
      if (v.blocks.length) {
        vioHTML = `<div class="prop-vio-box"><strong>⚠ 制約違反</strong><ul>${v.blocks.map(b => `<li>${escapeHtml(b)}</li>`).join('')}</ul></div>`;
      } else if (v.warns.length) {
        vioHTML = `<div class="prop-warn-box"><strong>⚡ 警告</strong><ul>${v.warns.map(w => `<li>${escapeHtml(w)}</li>`).join('')}</ul></div>`;
      } else {
        vioHTML = `<div class="prop-ok-box">✓ 制約OK</div>`;
      }
    }

    box.innerHTML = `
    <div class="prop-grid">
      <label>科目</label><div><strong>${escapeHtml(it.subj)}</strong> <span class="muted small">(${escapeHtml(scfg.dept || '')})</span>${it.simul ? ' <span class="real-subj-tag" title="同時展開（相乗り）授業">同時展開</span>' : ''}${it.realSubj ? ` <span class="real-subj-tag" title="開講科目">科目: ${escapeHtml(it.realSubj)}</span>` : ''}</div>
      <label>クラス</label><div>${escapeHtml(it.cls.join(', '))}</div>
      <label>教員</label><div>${escapeHtml(it.teas.join(', '))}</div>
      <label>教室</label><div>${escapeHtml(it.rooms.join(', '))}</div>
      <label>コマ</label><div>${plc ? `${DAYJP[plc.day]} ${plc.period}${it.span === 2 ? '-' + (plc.period + 1) : ''}` : '未配置'}</div>
      <label>2連</label><div>${it.span === 2 ? 'はい' : 'いいえ'}</div>
      <label>ロック</label><div>${plc ? (plc.locked ? '🔒 あり' : 'なし') : '—'}</div>
    </div>
    ${vioHTML}
    <div class="prop-slots-status">
      <div class="slot-stat valid-stat"><span class="slot-label">◎ 即配置可</span><span class="slot-count">${validCount}</span></div>
      <div class="slot-stat swap-stat"><span class="slot-label">○ 交換可</span><span class="slot-count">${swapCount}</span></div>
      <div class="slot-stat hard-stat"><span class="slot-label">△ 難</span><span class="slot-count">${hardCount}</span></div>
    </div>
    <div class="prop-actions">
      <button class="sec" id="prop-lock">${plc ? (plc.locked ? '🔓 ロック解除' : '🔒 ロック') : '🔒 ロック'}</button>
      <button class="danger" id="prop-stock">📦 在庫へ</button>
    </div>
    <div class="suggest" id="suggest-box"></div>
  `;
    $('#prop-lock').onclick = () => { if (plc) toggleLock(id); else flash('未配置'); };
    $('#prop-stock').onclick = () => toStock(id);
  }


  // v63.4: 空きセルをダブルクリック→「ここに来れるコマ」の提案を表示
  function openSlotSuggestions(day, p) {
    const idx = buildIndex();
    const mode = state.ui.viewMode || 'teacher';
    const candidates = [];

    // 全コマを対象に、このスロットに配置できるかチェック
    for (const [id, it] of Object.entries(state.items)) {
      if (!it) continue;
      // 2コマ連続の2つ目は除外
      if ((it.span || 1) === 2 && p >= maxPeriod(day)) continue;

      // 既にこのセルに配置済みのコマは除外
      const plc = state.placements[id];
      if (plc && plc.day === day && plc.period === p) continue;

      const v = validatePlacement(id, day, p, 'safe', null) || { blocks: [], warns: [] };
      const blocks = v.blocks.length;
      const warns = v.warns.length;

      let rank, label;
      if (blocks === 0 && warns === 0) { rank = 0; label = '◎'; }
      else if (blocks === 0) { rank = 1; label = '〇'; }
      else if (blocks <= 2) { rank = 2; label = '△'; }
      else { rank = 3; label = '×'; }

      // ×(不可)は非表示にしない: ユーザーは全体を把握したい
      const isStock = !plc || !plc.day;
      const scfg = state.subjectCfg[it.subjKey] || {};
      const abbr = scfg.abbr || it.subj || it.subjKey || '';
      const teas = it.teas.map(t => state.teacherCfg[t]?.abbr || t).join(',');
      const cls = it.cls.join(',');

      candidates.push({
        id, rank, label, abbr, teas, cls, isStock,
        blocks, warns, blockMsgs: v.blocks, warnMsgs: v.warns
      });
    }

    // ◎→〇→△→×の順にソート（同ランク内は在庫優先、次に科目名）
    candidates.sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;
      if (a.isStock !== b.isStock) return a.isStock ? -1 : 1;
      return (a.abbr || '').localeCompare(b.abbr || '');
    });

    // ×以外を主に表示（×は折りたたみ）
    const good = candidates.filter(c => c.rank <= 2);
    const bad = candidates.filter(c => c.rank === 3);

    let overlay = document.getElementById('sug-popup-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'sug-popup-overlay';
      overlay.className = 'sug-popup-overlay';
      document.body.appendChild(overlay);
    }

    const rankColors = { '◎': '#22c55e', '〇': '#3b82f6', '△': '#f59e0b', '×': '#ef4444' };

    const goodHtml = good.map(c => `
      <div class="slot-sug-item" data-id="${c.id}" style="cursor:pointer;padding:6px 10px;border-bottom:1px solid #1e293b;display:flex;gap:8px;align-items:center"
           title="${c.blockMsgs.concat(c.warnMsgs).join('\n')}">
        <span style="font-weight:800;font-size:16px;color:${rankColors[c.label]};min-width:24px">${c.label}</span>
        <span style="flex:1;font-size:12px;color:#e2e8f0">
          ${escapeHtml(c.abbr)} <span style="color:#94a3b8">${escapeHtml(c.teas)}</span>
          <span style="color:#64748b">${escapeHtml(c.cls)}</span>
          ${c.isStock ? '<span style="color:#f59e0b;font-size:10px;margin-left:4px">📦在庫</span>' : ''}
        </span>
        <span style="font-size:10px;color:#94a3b8">${c.blocks > 0 ? c.blocks + 'ブロック' : c.warns > 0 ? c.warns + '警告' : '制約なし'}</span>
      </div>
    `).join('');

    const badHtml = bad.length > 0 ? `
      <details style="margin-top:4px">
        <summary style="padding:6px 10px;color:#94a3b8;font-size:11px;cursor:pointer">× 不可 (${bad.length}件) — クリックで展開</summary>
        ${bad.map(c => `
          <div class="slot-sug-item" data-id="${c.id}" style="cursor:pointer;padding:4px 10px;border-bottom:1px solid #1e293b;display:flex;gap:8px;align-items:center;opacity:0.6"
               title="${c.blockMsgs.join('\n')}">
            <span style="font-weight:800;font-size:14px;color:${rankColors['×']};min-width:24px">×</span>
            <span style="flex:1;font-size:11px;color:#94a3b8">
              ${escapeHtml(c.abbr)} ${escapeHtml(c.teas)} ${escapeHtml(c.cls)}
            </span>
          </div>
        `).join('')}
      </details>
    ` : '';

    overlay.innerHTML = `
    <div class="sug-popup-box" id="sug-popup-box" style="max-width:500px">
      <div class="sug-popup-header">
        <div class="sug-popup-title">📍 ${DAYJP[day]}${p}限に来れるコマ (${good.length}件)</div>
        <span class="sug-popup-hint">クリックでそのコマの提案を表示</span>
        <button class="sug-popup-close" id="sug-popup-close-btn">✕</button>
      </div>
      <div class="sug-popup-body" style="max-height:60vh;overflow-y:auto">
        ${good.length > 0 ? goodHtml : '<div style="padding:16px;text-align:center;color:#94a3b8">配置可能なコマがありません</div>'}
        ${badHtml}
      </div>
    </div>
    `;
    overlay.style.display = 'flex';

    document.getElementById('sug-popup-close-btn').onclick = () => { overlay.style.display = 'none'; };

    // 各コマクリックでそのコマの提案を開く
    overlay.querySelectorAll('.slot-sug-item').forEach(el => {
      el.onclick = () => {
        const cid = el.dataset.id;
        overlay.style.display = 'none';
        if (cid) openPropSuggestions(cid);
      };
      el.onmouseenter = () => { el.style.background = '#334155'; };
      el.onmouseleave = () => { el.style.background = ''; };
    });

    // ESCで閉じる
    const escHandler = (ev) => {
      if (ev.key === 'Escape') { overlay.style.display = 'none'; document.removeEventListener('keydown', escHandler); }
    };
    document.addEventListener('keydown', escHandler);
  }

  function openPropSuggestions(id) {
    try { if (!id) id = ((window.state || state).ui || {}).selectedId; } catch (e) { }
    if (!id) return;
    try { selectId(id, state.ui.selectedFrom || 'grid'); } catch (e) { }

    // v38: Show suggestions in a floating popup instead of bottom of prop panel
    let overlay = document.getElementById('sug-popup-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'sug-popup-overlay';
      overlay.className = 'sug-popup-overlay';
      document.body.appendChild(overlay);
    }
    // Create a temporary sugBox inside the popup
    const it_name = (() => {
      const it = state.items[id];
      if (!it) return id;
      const scfg = state.subjectCfg[it.subjKey] || {};
      const abbr = scfg.abbr || it.subj || it.subjKey;
      return abbr + (it.cls.length ? ` [${it.cls.join(',')}]` : '');
    })();
    overlay.innerHTML = `
    <div class="sug-popup-box" id="sug-popup-box">
      <div class="sug-popup-header">
        <div class="sug-popup-title">💡 配置提案: <strong>${escapeHtml(it_name)}</strong></div>
        <span class="sug-popup-hint">↑↓ 移動 · Enter 採用 · Esc 閉じる</span>
        <button class="sug-popup-deep" id="sug-popup-deep-btn">🧠 深読み:OFF</button>
        <button class="sug-popup-lns" id="sug-popup-lns-btn">🧩 LNS:OFF</button>
        <button class="sug-popup-close" id="sug-popup-close-btn">✕</button>
      </div>
      <div class="sug-popup-body">
        <div id="sug-popup-content" class="suggest suggest-popup"></div>
      </div>
    </div>
  `;
    overlay.style.display = 'flex';
    document.getElementById('sug-popup-close-btn').onclick = () => closeSuggestionPopup();
    // Deep toggle (🧠 深読み) - v59
    try {
      window.__SUG_DEEP = !!window.__SUG_DEEP;
      const deepBtn = document.getElementById('sug-popup-deep-btn');
      if (deepBtn) {
        const updateDeepBtn = () => { deepBtn.textContent = window.__SUG_DEEP ? '🧠 深読み:ON' : '🧠 深読み:OFF'; deepBtn.classList.toggle('on', !!window.__SUG_DEEP); };
        updateDeepBtn();
        deepBtn.onclick = () => {
          window.__SUG_DEEP = !window.__SUG_DEEP;
          updateDeepBtn();
          try { pack = computeSuggestionPack(id); } catch (e) { console.error('computeSuggestionPack', e); }
          try { render(); } catch (e) { console.error('render', e); }
        };
      }
    } catch (e) { console.error('deep toggle init', e); }

    // LNS toggle (🧩 Large Neighborhood Search) - v60
    try {
      window.__SUG_LNS = !!window.__SUG_LNS;
      const lnsBtn = document.getElementById('sug-popup-lns-btn');
      if (lnsBtn) {
        const updateLnsBtn = () => { lnsBtn.textContent = window.__SUG_LNS ? '🧩 LNS:ON' : '🧩 LNS:OFF'; lnsBtn.classList.toggle('on', !!window.__SUG_LNS); };
        updateLnsBtn();
        lnsBtn.onclick = () => {
          window.__SUG_LNS = !window.__SUG_LNS;
          updateLnsBtn();
          try { pack = computeSuggestionPack(id); } catch (e) { console.error('computeSuggestionPack', e); }
          try { render(); } catch (e) { console.error('render', e); }
        };
      }
    } catch (e) { console.error('lns toggle init', e); }

    overlay.onclick = (e) => { if (e.target === overlay) closeSuggestionPopup(); };
    // Make popup draggable
    makeSugPopupDraggable(overlay.querySelector('#sug-popup-box'));
    // v39: 前回位置を復元
    if (_sugPopupSavedPos) {
      const box = overlay.querySelector('#sug-popup-box');
      if (box) {
        box.style.position = 'fixed';
        box.style.left = _sugPopupSavedPos.left;
        box.style.top = _sugPopupSavedPos.top;
        box.style.transform = 'none';
      }
    }
    // v63.2: キーボードキャプチャ（Esc・Enter）マトリクスUI向け
    _sugPopupKeyHandler = (ev) => {
      const ovl = document.getElementById('sug-popup-overlay');
      if (!ovl || ovl.style.display === 'none') { window.removeEventListener('keydown', _sugPopupKeyHandler, true); return; }

      if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); closeSuggestionPopup(); window.removeEventListener('keydown', _sugPopupKeyHandler, true); return; }
      if (ev.key === 'Enter') { ev.preventDefault(); ev.stopPropagation(); const btn = document.getElementById('idea-btn-apply'); if (btn && !btn.disabled) btn.click(); return; }
      if (ev.key === 'ArrowRight') { ev.preventDefault(); ev.stopPropagation(); const btn = document.getElementById('idea-slot-next'); if (btn && !btn.disabled) btn.click(); return; }
      if (ev.key === 'ArrowLeft') { ev.preventDefault(); ev.stopPropagation(); const btn = document.getElementById('idea-slot-prev'); if (btn && !btn.disabled) btn.click(); return; }
    };
    window.addEventListener('keydown', _sugPopupKeyHandler, true);

    let sugBox = overlay.querySelector('#sug-popup-content') || document.getElementById('sug-popup-content');
    let pack = null; try { pack = computeSuggestionPack(id); } catch (e) { console.error('computeSuggestionPack', e); showModal('エラー', '提案の計算でエラー: ' + e.message); return; }
    const tabs = [
      { k: 'empty', label: '🟢 空き枠' },
      { k: 'swap', label: '🔄 入替' },
      { k: 'cycle', label: '🔺 回転' },
      { k: 'linked', label: '🔗 連動' },
      { k: 'lookahead', label: '🔭 先読み' },
      { k: 'lns', label: '🧩 LNS' },
      { k: 'force', label: '⚠️ 強制' },
    ];
    let cur = pack._tab || 'empty';
    if (!pack[cur] || !pack[cur].length) cur = (tabs.find(t => pack[t.k]?.length)?.k) || 'empty';
    pack._tab = cur; try { ['empty', 'swap', 'cycle', 'linked', 'lookahead', 'lns', 'force'].forEach(k => { if (!Array.isArray(pack[k])) pack[k] = []; }); } catch (e) { }
    if (pack.empty.length === 0) { try { pack.empty = computeEmptySuggestions(id) || []; } catch (e) { } }
    if (pack.force.length === 0) { try { pack.force = computeForceSuggestions(id) || []; } catch (e) { } }
    function render() {
      // v63.2: 全タブ横断でスロット(day,period)ごとにベスト提案をマッピング
      const allSugs = [];
      ['empty', 'swap', 'cycle', 'linked', 'lookahead', 'lns', 'force'].forEach(k => {
        (pack[k] || []).forEach(s => { if (s && s.moves && s.moves.length) allSugs.push(s); });
      });

      // スロットごとにグループ化: 対象アイテム(id)の移動先をキーにする
      const slotMap = {};  // key "day-period" => { sugs: [...], best: suggestion }
      for (const sg of allSugs) {
        const mTarget = sg.moves.find(m => m.id === id);
        if (!mTarget) continue;
        const k = `${mTarget.day}-${mTarget.period}`;
        if (!slotMap[k]) slotMap[k] = { sugs: [], best: null };
        slotMap[k].sugs.push(sg);
      }
      // 各スロット内でスコア降順にソートしベストを設定
      for (const k of Object.keys(slotMap)) {
        slotMap[k].sugs.sort((a, b) => (b.score || 0) - (a.score || 0));
        slotMap[k].best = slotMap[k].sugs[0];
      }

      // 選択中スロット
      const selDay = pack._selDay || null;
      const selPer = pack._selPer || null;
      const selKey = selDay && selPer ? `${selDay}-${selPer}` : null;
      const selSlot = selKey ? slotMap[selKey] : null;
      const selSugs = selSlot ? selSlot.sugs : [];
      let selIdx = pack._selIdx || 0;
      if (selIdx >= selSugs.length) selIdx = Math.max(0, selSugs.length - 1);
      pack._selIdx = selIdx;
      const selSug = selSugs[selIdx] || null;

      // ── マトリクスUI（時間割表）の生成 ──
      const maxP = Math.max(...DAYS.map(d => maxPeriod(d)));
      const curPlc = state.placements[id];
      let matrixTrs = '';

      for (let p = 1; p <= maxP; p++) {
        matrixTrs += `<tr><th>${p}限</th>`;
        for (const d of DAYS) {
          const k = `${d}-${p}`;
          const cell = slotMap[k];
          const isCurrent = curPlc && curPlc.day === d && curPlc.period === p;
          const isSelected = selKey === k;

          if (isCurrent && (!cell || !cell.sugs.length)) {
            matrixTrs += `<td class="idea-matrix-cell mark-ng" style="background:#fef3c7;color:#b45309;font-weight:900">現</td>`;
          } else if (!cell || !cell.sugs.length) {
            matrixTrs += `<td class="idea-matrix-cell mark-ng">×</td>`;
          } else {
            const best = cell.best;
            const depth = (best.moves || []).length - 1; // 0=直接配置, 1=1手玉突き, 2+=複雑
            const hasVio = (best.score || 0) < 0;
            let mark, className;
            if (depth === 0 && !hasVio) { mark = '◎'; className = 'mark-perfect'; }
            else if (depth <= 1 && !hasVio) { mark = '〇'; className = 'mark-good'; }
            else if (!hasVio) { mark = '△'; className = 'mark-ok'; }
            else { mark = '△'; className = 'mark-ok'; }

            const activeCls = isSelected ? 'active-cell' : '';
            const cntBadge = cell.sugs.length > 1 ? `<span style="font-size:8px;color:#94a3b8;display:block;line-height:1">${cell.sugs.length}</span>` : '';
            const currentFlag = isCurrent ? '<span style="font-size:9px;vertical-align:top">現</span>' : '';

            matrixTrs += `<td class="idea-matrix-cell js-matrix-cell ${className} ${activeCls}" data-day="${d}" data-per="${p}" title="${DAYJP[d]}${p}限: ${cell.sugs.length}件 (最高スコア:${Math.round(best.score || 0)})">${currentFlag}${mark}${cntBadge}</td>`;
          }
        }
        matrixTrs += `</tr>`;
      }

      const matrixHtml = `
        <div class="idea-matrix-wrap">
          <table class="idea-matrix-table">
            <thead><tr><th></th>${DAYS.map(d => `<th>${DAYJP[d]}</th>`).join('')}</tr></thead>
            <tbody>${matrixTrs}</tbody>
          </table>
        </div>
      `;

      // ── 選択中提案の詳細パネル ──
      let detailHtml = '';
      if (selSug) {
        const miniGridsHtml = buildSugMiniGridHTML(selSug.moves) || '';
        const movesListHtml = (selSug.moves || []).map((m, i) => {
          const it_m = state.items[m.id];
          const sc_m = state.subjectCfg[it_m?.subjKey] || {};
          const plc = state.placements[m.id];
          const fromStr = plc ? `${DAYJP[plc.day]}曜${plc.period}` : '在庫';
          const toStr = `${DAYJP[m.day]}曜${m.period}`;
          const subjAbbr = (sc_m.abbr || it_m?.subj || m.id).slice(0, 8);
          const teasStr = (it_m?.teas || []).join(', ').slice(0, 12);
          const clsStr = (it_m?.cls || []).join(', ').slice(0, 12);
          return `<div class="idea-move-row">
            <span class="im-idx">${String(i + 1).padStart(3, '0')}</span>
            <span class="im-subj2">${escapeHtml(subjAbbr)}</span>
            <span class="im-fromto">${fromStr} ➜ ${toStr}</span>
            <span class="im-tea">${escapeHtml(teasStr)}</span>
            <span class="im-cls">${escapeHtml(clsStr)}</span>
          </div>`;
        }).join('');

        const isForce = (selSug.title || '').includes('強制');
        const scoreVal = Math.round(selSug.score || 0);
        const depth = (selSug.moves || []).length;

        detailHtml = `
          <div class="idea-detail-panel">
            <div class="idea-detail-header">
              <span class="idea-detail-title">${escapeHtml(selSug.title || '提案')}</span>
              <span class="ish-score">スコア: ${scoreVal} / ${depth}手</span>
              <span class="idea-detail-nav">${selIdx + 1}/${selSugs.length}件
                <button class="idea-btn-sm" id="idea-slot-prev" ${selIdx <= 0 ? 'disabled' : ''}>◀</button>
                <button class="idea-btn-sm" id="idea-slot-next" ${selIdx >= selSugs.length - 1 ? 'disabled' : ''}>▶</button>
              </span>
            </div>
            ${miniGridsHtml ? `<div class="idea-sug-grids">${miniGridsHtml}</div>` : ''}
            <div class="idea-sug-moves-list">${movesListHtml || '<div style="padding:8px;color:#94a3b8">移動なし</div>'}</div>
            ${selSug.reason ? `<div class="idea-sug-reason">${escapeHtml((selSug.reason || []).join(' · '))}</div>` : ''}
            <div class="idea-detail-actions">
              <button class="idea-btn" id="idea-btn-reason">詳細</button>
              <button class="idea-btn apply ${isForce ? 'apply-force' : ''}" id="idea-btn-apply">${isForce ? '⚠ 強制採用' : '採 用'}</button>
            </div>
          </div>
        `;
      } else if (selKey) {
        detailHtml = `<div class="idea-detail-panel"><div style="padding:24px;text-align:center;color:#94a3b8">${selKey ? `${DAYJP[selDay]}${selPer}限: 提案なし` : 'セルを選択してください'}</div></div>`;
      } else {
        detailHtml = `<div class="idea-detail-panel"><div style="padding:24px;text-align:center;color:#94a3b8;font-size:13px">⬆ 上の時間割表で◎〇△をクリックすると、詳しい移動手順が表示されます</div></div>`;
      }

      sugBox.innerHTML = `
      <div class="sug-head">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
          <div class="sug-hint" style="color:#475569;font-size:12px;font-weight:800;flex:1">コマ入れ提案 — ${escapeHtml((state.items[id]?.subj || id).slice(0, 20))}</div>
          <button class="idea-btn" id="idea-btn-deep" style="width:auto;padding:4px 12px;font-size:11px;background:#7c3aed;color:#fff;border:none">🤔 将棋モード (長考・8秒)</button>
        </div>
        <div class="sug-hint" style="color:#94a3b8;font-size:11px">◎直接配置 〇1手 △2手以上 ×不可 ｜ セルクリックで詳細表示</div>
      </div>
      ${matrixHtml}
      ${detailHtml}
      <div style="text-align:right;padding:4px 8px">
        <button class="idea-btn btn-cancel" id="idea-btn-cancel" style="width:auto;display:inline-block;padding:6px 16px">閉じる</button>
      </div>
    `;

      // ── イベントバインド ──
      // マトリクスセルクリック（シングル: スロット選択、ダブル: ベスト提案を即採用）
      sugBox.querySelectorAll('.js-matrix-cell').forEach(cell => {
        cell.onclick = () => {
          pack._selDay = cell.dataset.day;
          pack._selPer = parseInt(cell.dataset.per, 10);
          pack._selIdx = 0;
          render();
        };
        cell.ondblclick = (ev) => {
          ev.stopPropagation();
          const day = cell.dataset.day;
          const per = parseInt(cell.dataset.per, 10);
          const key = `${day}-${per}`;
          // slotMap は render() のスコープ外なので再計算
          const allSugsD = [];
          ['empty', 'swap', 'cycle', 'linked', 'lookahead', 'lns', 'force'].forEach(k => {
            (pack[k] || []).forEach(s => { if (s && s.moves && s.moves.length) allSugsD.push(s); });
          });
          const sugsForSlot = allSugsD.filter(sg => {
            const m = sg.moves.find(m => m.id === id);
            return m && `${m.day}-${m.period}` === key;
          }).sort((a, b) => (b.score || 0) - (a.score || 0));
          if (sugsForSlot.length) {
            applySuggestion(sugsForSlot[0]);
            closeSuggestionPopup();
          }
        };
      });

      // スロット内の次/前
      const slotNext = sugBox.querySelector('#idea-slot-next');
      if (slotNext) slotNext.onclick = () => { if (pack._selIdx < selSugs.length - 1) { pack._selIdx++; render(); } };
      const slotPrev = sugBox.querySelector('#idea-slot-prev');
      if (slotPrev) slotPrev.onclick = () => { if (pack._selIdx > 0) { pack._selIdx--; render(); } };

      // 採用
      const btnApply = sugBox.querySelector('#idea-btn-apply');
      if (btnApply && selSug) btnApply.onclick = () => { applySuggestion(selSug); closeSuggestionPopup(); };

      // 詳細
      const btnReason = sugBox.querySelector('#idea-btn-reason');
      if (btnReason && selSug) btnReason.onclick = () => showSuggestionDetail(selSug);

      // 閉じる
      const btnCancel = sugBox.querySelector('#idea-btn-cancel');
      if (btnCancel) btnCancel.onclick = () => closeSuggestionPopup();

      // v63.4: 将棋的長考モード（深探索）— 1つの時間枠で全スロットを深く探索
      const btnDeep = sugBox.querySelector('#idea-btn-deep');
      if (btnDeep) {
        btnDeep.onclick = async () => {
          btnDeep.disabled = true;
          const originalBg = btnDeep.style.background;
          btnDeep.style.background = '#94a3b8';
          btnDeep.textContent = '🤔 長考開始...';

          const it = state.items[id];
          if (!it) return;

          let foundAny = false;
          let totalVisits = 0;
          let slotsSearched = 0;
          const globalStart = performance.now();
          const GLOBAL_TIMEOUT = 10000; // 全体10秒

          // 候補スロットを事前にスコアリングして有望順にソート
          const candidateSlots = [];
          for (const day of DAYS) {
            const mp = maxPeriod(day);
            for (let p = 1; p <= mp; p++) {
              if ((it.span || 1) === 2 && p >= mp) continue;
              const curPlc = state.placements[id];
              if (curPlc && curPlc.day === day && curPlc.period === p) continue;

              const v = validatePlacement(id, day, p, 'safe', null) || { blocks: [], warns: [] };
              // 完全空き（blocks=0, warns=0）は既にemptyタブにあるのでスキップ
              if (v.blocks.length === 0 && v.warns.length === 0) continue;

              // 優先度: ブロッカーが少ないほど有望
              const priority = 100 - v.blocks.length * 15 - v.warns.length * 5 + (p <= 3 ? 3 : 0);
              candidateSlots.push({ day, p, priority, blocks: v.blocks.length });
            }
          }
          candidateSlots.sort((a, b) => b.priority - a.priority);

          // 全スロットを探索（ただし有望順上位60に絞る）
          const topSlots = candidateSlots.slice(0, 60);
          const totalSlots = topSlots.length;
          if (totalSlots === 0) {
            btnDeep.textContent = '探索対象スロットがありません';
            btnDeep.style.background = originalBg; btnDeep.disabled = false;
            return;
          }

          for (const slot of topSlots) {
            // 全体タイムアウトチェック
            if (performance.now() - globalStart > GLOBAL_TIMEOUT) break;

            slotsSearched++;

            // 1スロットあたりの時間を残り時間から動的に配分
            const elapsed = performance.now() - globalStart;
            const remaining = GLOBAL_TIMEOUT - elapsed;
            const slotsLeft = totalSlots - slotsSearched + 1;
            const perSlotMs = Math.max(100, Math.min(2000, remaining / slotsLeft));

            try {
              const moves = await window.puzSearchOptAsync(id, slot.day, slot.p, {
                shogi: true,
                maxMs: Math.round(perSlotMs),
                maxVisits: 50000,
                maxInvolved: 20
              }, (visits, max) => {
                totalVisits = Math.max(totalVisits, visits); // 最大値を追跡
                const pct = Math.round((slotsSearched / totalSlots) * 100);
                btnDeep.textContent = `🤔 長考中... ${pct}% (${slotsSearched}/${totalSlots}スロット)`;
              });

              if (moves && moves.length) {
                const mTarget = moves.find(m => m.id === id);
                if (mTarget) {
                  const depth = moves.length - 1;
                  const typeLabel = depth === 0 ? '直接'
                    : depth === 1 ? '2手連動'
                      : depth === 2 ? '3手連動'
                        : `${depth + 1}手連動`;
                  const sug = {
                    title: `♛将棋AI ${typeLabel}: ${DAYJP[slot.day]}${slot.p}限へ`,
                    score: Math.max(30, 95 - depth * 5),
                    reason: [`${depth}コマを連携移動 (将棋モード長考結果・${depth + 1}手読み)`],
                    moves: moves,
                    noStock: true,
                    isDeep: true
                  };

                  if (!pack.linked) pack.linked = [];
                  pack.linked.push(sug);
                  foundAny = true;
                }
              }
            } catch (e) {
              console.warn('将棋モード探索エラー:', e);
            }
          }

          // ── 結果後処理 ──
          // 同じ移動先への重複提案をまとめ、スコア降順でソート
          if (pack.linked) {
            const byDest = {};
            for (const s of pack.linked) {
              const mt = s.moves?.find(m => m.id === id);
              if (!mt) continue;
              const k = `${mt.day}-${mt.period}`;
              if (!byDest[k] || (s.score || 0) > (byDest[k].score || 0)) byDest[k] = s;
            }
            // 将棋モード以外の既存提案は保持し、深探索分だけ差し替え
            const nonDeep = pack.linked.filter(s => !s.isDeep);
            pack.linked = [...nonDeep, ...Object.values(byDest).filter(s => s.isDeep)];
            pack.linked.sort((a, b) => (b.score || 0) - (a.score || 0));
          }

          const totalSec = ((performance.now() - globalStart) / 1000).toFixed(1);

          // ボタンを常に再有効化（再探索可能にする）
          const resetBtn = () => {
            if (btnDeep) {
              btnDeep.style.background = originalBg;
              btnDeep.disabled = false;
            }
          };

          if (!foundAny) {
            btnDeep.textContent = `見つかりませんでした (${totalSec}秒)`;
            setTimeout(resetBtn, 3000);
          } else {
            const cnt = (pack.linked || []).filter(s => s.isDeep).length;
            btnDeep.textContent = `♛ ${cnt}件の新手! (${totalSec}秒) — 再探索`;
            resetBtn(); // 即座に再有効化（再クリックで再探索できる）
            // 🔗連動タブに自動切替して結果を表示
            pack._tab = 'linked';
            const deepSugs = (pack.linked || []).filter(s => s.isDeep);
            if (deepSugs.length > 0) {
              const best = deepSugs.sort((a, b) => (b.score || 0) - (a.score || 0))[0];
              const mTarget = best.moves.find(m => m.id === id);
              if (mTarget) {
                pack._selDay = String(mTarget.day);
                pack._selPer = String(mTarget.period);
                pack._selIdx = 0;
              }
            }
            render();
          }
        };
      }

      // 矢印プレビュー
      if (selSug && selSug.moves) {
        try { setTimeout(() => previewSuggestionMoves(selSug.moves), 10); } catch (e) { }
      } else {
        clearSuggestionArrows();
      }
    }
    render();
  }

  // v39: ポップアップ位置記憶・キーボードハンドラ（モジュール変数）
  let _sugPopupSavedPos = null;
  let _sugPopupKeyHandler = null; // モジュールスコープで保持し closeSuggestionPopup から解除可能に

  function closeSuggestionPopup() {
    const overlay = document.getElementById('sug-popup-overlay');
    if (overlay) {
      // v39: 位置を保存してから閉じる
      const box = overlay.querySelector('#sug-popup-box');
      if (box) {
        const style = box.style;
        if (style.left || style.top) {
          _sugPopupSavedPos = { left: style.left, top: style.top };
        }
      }
      overlay.style.display = 'none';
    }
    // v39 fix: キーボードハンドラを明示的に解除（ゴースト防止）
    if (_sugPopupKeyHandler) {
      window.removeEventListener('keydown', _sugPopupKeyHandler, true);
      _sugPopupKeyHandler = null;
    }
    clearSuggestionArrows();
  }
  function makeSugPopupDraggable(box) {
    if (!box) return;
    const header = box.querySelector('.sug-popup-header');
    if (!header) return;
    let startX, startY, startLeft, startTop;
    header.style.cursor = 'move';
    header.onmousedown = (e) => {
      if (e.target.id === 'sug-popup-close-btn') return;
      startX = e.clientX; startY = e.clientY;
      const r = box.getBoundingClientRect();
      startLeft = r.left; startTop = r.top;
      box.style.position = 'fixed';
      box.style.left = startLeft + 'px'; box.style.top = startTop + 'px';
      box.style.transform = 'none';
      const onMove = (e2) => {
        box.style.left = Math.max(0, startLeft + (e2.clientX - startX)) + 'px';
        box.style.top = Math.max(0, startTop + (e2.clientY - startY)) + 'px';
      };
      const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    };

    // リサイズハンドル（右下）
    const resizer = document.createElement('div');
    resizer.className = 'sug-popup-resizer';
    resizer.title = 'ドラッグでリサイズ';
    box.appendChild(resizer);
    resizer.onmousedown = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const startW = box.offsetWidth;
      const startH = box.offsetHeight;
      const sx = e.clientX, sy = e.clientY;
      const onMove = (e2) => {
        const newW = Math.max(480, startW + (e2.clientX - sx));
        const newH = Math.max(300, startH + (e2.clientY - sy));
        box.style.width = newW + 'px';
        box.style.maxHeight = newH + 'px';
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.style.cursor = '';
      };
      document.body.style.cursor = 'se-resize';
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    };
  }
  function buildMiniTimetableHTML(moves) {
    // Build a compact mini timetable showing source → destination for each move
    if (!moves || !moves.length) return '';

    // Collect all relevant day/period combinations
    const cells = new Map(); // 'day-period' -> {from:[], to:[]}
    for (const m of moves) {
      const it = state.items[m.id];
      const scfg = state.subjectCfg[it?.subjKey] || {};
      const abbr = (scfg.abbr || it?.subj || m.id).slice(0, 3);
      const color = scfg.color || pickColor(it?.subjKey || '');
      const curPlc = state.placements[m.id];
      // Source cell
      if (curPlc) {
        const srcKey = `${curPlc.day}-${curPlc.period}`;
        if (!cells.has(srcKey)) cells.set(srcKey, { day: curPlc.day, period: curPlc.period, from: [], to: [] });
        cells.get(srcKey).from.push({ abbr, color, id: m.id });
      }
      // Destination cell
      const dstKey = `${m.day}-${m.period}`;
      if (!cells.has(dstKey)) cells.set(dstKey, { day: m.day, period: m.period, from: [], to: [] });
      cells.get(dstKey).to.push({ abbr, color, id: m.id, fromDay: curPlc?.day, fromPeriod: curPlc?.period });
    }

    // Determine unique days and periods to show
    const allDays = [...new Set([...cells.values()].map(c => c.day))].sort();
    const allPeriods = [...new Set([...cells.values()].map(c => c.period))].sort((a, b) => a - b);

    if (!allDays.length || !allPeriods.length) return '';

    // Build grid with enhanced visual indicators
    let grid = `<div class="mini-tt-wrap"><table class="mini-tt">`;
    grid += `<thead><tr><th></th>${allDays.map(d => `<th>${DAYJP[d] || d}</th>`).join('')}</tr></thead><tbody>`;
    for (const p of allPeriods) {
      grid += `<tr><th>${p}</th>`;
      for (const d of allDays) {
        const key = `${d}-${p}`;
        const cell = cells.get(key);
        if (!cell) {
          grid += `<td class="mini-tt-empty"></td>`;
        } else {
          let content = '';
          // FROM chips (leaving this cell) - red border
          for (const f of cell.from) {
            const isDarkColor = isDark(f.color);
            const textColor = isDarkColor ? '#fff' : '#0f172a';
            content += `<span class="mini-chip mini-from" style="background:${f.color};color:${textColor};border-color:#ef4444" title="${escapeAttr(f.abbr)} が退出">
            ${escapeHtml(f.abbr)}<span style="font-size:9px">↗</span>
          </span>`;
          }
          // TO chips (arriving at this cell) - green border
          for (const t of cell.to) {
            const fromStr = t.fromDay ? `${DAYJP[t.fromDay] || t.fromDay}${t.fromPeriod}` : '在庫';
            const isDarkColor = isDark(t.color);
            const textColor = isDarkColor ? '#fff' : '#0f172a';
            content += `<span class="mini-chip mini-to" style="background:${t.color};color:${textColor};border-color:#22c55e" title="${escapeAttr(fromStr)}→着">
            <span style="font-size:9px">↙</span>${escapeHtml(t.abbr)}
          </span>`;
          }
          grid += `<td class="mini-tt-cell">${content}</td>`;
        }
      }
      grid += `</tr>`;
    }
    grid += `</tbody></table></div>`;
    return grid;
  }

  /* ── 提案カードの「操作テキスト」生成（例：言語文化１−１を在庫から水５へ） ── */
  function buildMoveDescLines(moves, opts) {
    // 各moveを「〇〇（クラス/担当）を△△から◇◇へ」の行に変換
    // opts.chainSwap=true の場合: 最後のコマが主役（目標）、それ以前が退避ステップ
    const moveIdSet = new Set(moves.map(m => m.id));
    const isChain = !!(opts && opts.chainSwap && moves.length >= 2);
    const mainIdx = isChain ? moves.length - 1 : 0; // 主役のインデックス

    return moves.map((m, mi) => {
      const it = state.items[m.id];
      const scfg = state.subjectCfg[it?.subjKey] || {};
      const subjName = scfg.abbr || it?.subj || m.id;
      const cls = (it?.cls || []).join('・');
      const tea = (it?.teas || []).map(t => state.teacherCfg[t]?.abbr || t).join('・');
      const fromPlc = state.placements[m.id];
      const span = it?.span || 1;
      const toStr = `${DAYJP[m.day]}${m.period}${span === 2 ? `–${m.period + 1}` : ''}限`;
      const fromStr = fromPlc
        ? `${DAYJP[fromPlc.day]}${fromPlc.period}${span === 2 ? `–${fromPlc.period + 1}` : ''}限`
        : '在庫';

      // 移動先に別のコマがあるか調べる
      let displacedNote = '';
      try {
        for (const [pid, plc] of Object.entries(state.placements)) {
          if (!plc || moveIdSet.has(pid)) continue;
          if (plc.day === m.day && plc.period === m.period) {
            const dIt = state.items[pid];
            if (!dIt) continue;
            const sharedCls = (it?.cls || []).some(c => (dIt.cls || []).includes(c));
            if (sharedCls) {
              const dsc = state.subjectCfg[dIt.subjKey] || {};
              const dAbbr = dsc.abbr || dIt.subj || '';
              displacedNote = `（${escapeHtml(dAbbr)}を退かす）`;
            }
          }
        }
      } catch (e) { }

      // 連鎖移動のprefix: 退避ステップには「まず/次に」、主役には「→ 目的」マーク
      let prefix, rowClass;
      if (isChain) {
        if (mi === mainIdx) {
          prefix = '🎯 ';
          rowClass = 'mdc-row mdc-main mdc-chain-goal';
        } else if (mi === 0) {
          prefix = moves.length - 1 === 1 ? 'まず ' : `①退避 `;
          rowClass = 'mdc-row mdc-chain-prereq';
        } else {
          prefix = `${'①②③④⑤'[mi]}退避 `;
          rowClass = 'mdc-row mdc-chain-prereq';
        }
      } else {
        prefix = mi === 0 ? '' : 'そして ';
        rowClass = `mdc-row${mi === 0 ? ' mdc-main' : ''}`;
      }

      return `<div class="${rowClass}">
      <span class="mdc-prefix">${escapeHtml(prefix)}</span>
      <span class="mdc-subj">${escapeHtml(subjName)}</span>
      ${cls ? `<span class="mdc-cls">${escapeHtml(cls)}</span>` : ''}
      ${tea ? `<span class="mdc-tea">${escapeHtml(tea)}</span>` : ''}
      <span class="mdc-from">${escapeHtml(fromStr)}</span>
      <span class="mdc-arr">➜</span>
      <span class="mdc-to">${escapeHtml(toStr)}</span>
      ${displacedNote ? `<span class="mdc-displaced">${displacedNote}</span>` : ''}
    </div>`;
    }).join('');
  }

  function renderSugItem(s, idx) {
    const title = s.title || '';
    const moves = s.moves || [];
    const reasonStr = (s.reason || []).join(' · ');
    const hasViolation = (s.score || 0) < 0;
    const isForceItem = (title || '').includes('強制');

    // ── 操作説明テキスト（メイン表示）
    const descLines = buildMoveDescLines(moves, { chainSwap: !!(s.chainSwap) });

    // ── ミニ時間割グリッド（教員視点・移動元→移動先を矢印で示す）
    // duplication回避: miniTT（テーブル形式）はgrid代替なので一方のみ表示
    const miniGridHTML = buildSugMiniGridHTML(moves);

    const scoreVal = Math.round(s.score || 0);
    const scoreBarW = Math.min(100, Math.max(0, scoreVal + 20)) + '%';
    const scoreColor = scoreVal >= 80 ? '#22c55e' : scoreVal >= 50 ? '#f59e0b' : scoreVal >= 0 ? '#94a3b8' : '#ef4444';
    const scoreHTML = `<div class="sug-score-wrap" title="スコア: ${scoreVal}">
    <div class="sug-score-bar" style="width:${scoreBarW};background:${scoreColor}"></div>
    <span class="sug-score-num" style="color:${scoreColor}">${scoreVal}</span>
  </div>`;

    const isForceStr = isForceItem ? '<span class="sug-type-badge force-badge">⚠ 強制</span>' : '';
    const noStockBadge = s.noStock ? '<span class="sug-type-badge nostk-badge">✓ 在庫不使用</span>' : '';
    const chainBadge = (s.chainDepth >= 2) ? `<span class="sug-type-badge chain-badge">${s.chainDepth}手連動</span>` : '';

    return `
    <div class="sug-item${hasViolation ? ' sug-warn' : ''}${isForceItem ? ' sug-force' : ''}" data-moves='${JSON.stringify(moves).replace(/'/g, "&apos;")}'>
      <div class="sug-item-header">
        <div class="sug-title">${isForceStr}${noStockBadge}${chainBadge}${escapeHtml(title)}${hasViolation ? ' <span class="sug-vbadge">⚠ 違反あり</span>' : ''}</div>
        ${scoreHTML}
      </div>
      <div class="mdc-wrap">${descLines}</div>
      ${reasonStr ? `<div class="sug-reason">${escapeHtml(reasonStr)}</div>` : ''}
      ${miniGridHTML ? `<div class="sug-mini-grids">${miniGridHTML}</div>` : ''}
      <div class="btnrow">
        <button class="apply${isForceItem ? ' apply-force' : ''}" data-idx="${idx}">${isForceItem ? '⚠ 強制採用' : '✓ 採用'}</button>
        <button class="why" data-idx="${idx}">詳細</button>
        <button class="sug-pin-btn" data-idx="${idx}" title="ピン留め (P)">📌</button>
      </div>
    </div>
  `;
  }

  /**
   * v42: 提案カード内に表示する簡易個人窓グリッド
   * 関係する教員(最大2名)の時間割をミニ表示し、移動元/先を色付け
   */
  function buildSugMiniGridHTML(moves) {
    if (!moves || !moves.length) return '';
    try {
      // 関係する教員を収集（最大3名）
      const teas = [];
      for (const m of moves) {
        const it = state.items[m.id];
        if (!it) continue;
        for (const t of it.teas || []) { if (!teas.includes(t)) teas.push(t); }
      }
      if (!teas.length) return '';
      const showTeas = teas.slice(0, 3);
      const idx = buildIndex();
      const maxP = Math.max(...DAYS.map(d => maxPeriod(d)));

      return showTeas.map(tea => {
        const abbr = state.teacherCfg[tea]?.abbr || tea.slice(0, 4);
        // FROM/TO cells for this teacher
        const myFromCells = new Set();
        const myToCells = new Set();
        for (const m of moves) {
          const it = state.items[m.id];
          if (!it) continue;
          if (!(it.teas || []).includes(tea)) continue;
          const fromPlc = state.placements[m.id];
          if (fromPlc) for (let dp = 0; dp < (it.span || 1); dp++) myFromCells.add(`${fromPlc.day}|${fromPlc.period + dp}`);
          for (let dp = 0; dp < (it.span || 1); dp++) myToCells.add(`${m.day}|${m.period + dp}`);
        }

        let rows = '';
        // Collect which cells need highlighting for this teacher (only show rows that matter + 1 context row)
        const highlightPeriods = new Set();
        for (const k of [...myFromCells, ...myToCells]) {
          const [, p] = k.split('|');
          const pi = parseInt(p);
          for (let dp = -1; dp <= 1; dp++) {
            if (pi + dp >= 1 && pi + dp <= maxP) highlightPeriods.add(pi + dp);
          }
        }

        for (let p = 1; p <= maxP; p++) {
          rows += `<tr>`;
          rows += `<td class="smg-h">${p}</td>`;
          for (const d of DAYS) {
            const cellKey = `${d}|${p}`;
            const isFrom = myFromCells.has(cellKey);
            const isTo = myToCells.has(cellKey);
            const cellIds = (idx.tea?.[tea]?.[d]?.[p] || []).filter(x => !isSpanFill(x, d, p));
            let cellContent = '';
            let cellStyle = '';
            let cellClass = 'smg-c';

            if (isFrom && isTo) {
              cellStyle = 'background:#8b5cf6;color:#fff;font-weight:900;font-size:10px';
              cellContent = '↔';
            } else if (isFrom) {
              // 移動元：赤系濃い背景 + 出発矢印
              cellStyle = 'background:#ef4444;color:#fff;font-weight:900;font-size:10px;position:relative';
              const it0 = cellIds.length ? state.items[cellIds[0]] : null;
              const ab0 = it0 ? (state.subjectCfg[it0.subjKey]?.abbr || it0.subj || '').slice(0, 3) : '';
              cellContent = `<div style="font-size:7px;opacity:.85">${escapeHtml(ab0)}</div><div style="font-size:13px">↑</div>`;
              cellClass = 'smg-c smg-from';
            } else if (isTo) {
              // 移動先：緑系濃い背景 + 到着矢印
              cellStyle = 'background:#16a34a;color:#fff;font-weight:900;font-size:10px;position:relative';
              const it0 = cellIds.length ? state.items[cellIds[0]] : null;
              const ab0 = it0 ? (state.subjectCfg[it0.subjKey]?.abbr || it0.subj || '').slice(0, 3) : '';
              cellContent = `<div style="font-size:7px;opacity:.85">${it0 ? escapeHtml(ab0) : '空'}</div><div style="font-size:13px">↓</div>`;
              cellClass = 'smg-c smg-to';
            } else if (cellIds.length) {
              const id0 = cellIds[0];
              const it0 = state.items[id0];
              const sc0 = state.subjectCfg[it0?.subjKey] || {};
              const col0 = sc0.color || pickColor(it0?.subjKey || '');
              const ab0 = (sc0.abbr || it0?.subj || '').slice(0, 3);
              cellStyle = `background:${col0}28;border-left:3px solid ${col0}`;
              cellContent = escapeHtml(ab0);
            }
            if (p > maxPeriod(d)) {
              rows += `<td class="smg-fd"></td>`;
            } else {
              rows += `<td class="${cellClass}" style="${cellStyle}">${cellContent}</td>`;
            }
          }
          rows += `</tr>`;
        }

        // Build SVG arrow overlay: connect FROM cells to TO cells
        // We'll add a CSS arrow indicator below the table instead
        const arrowPairs = [];
        for (const m of moves) {
          const it = state.items[m.id];
          if (!it || !(it.teas || []).includes(tea)) continue;
          const fromPlc = state.placements[m.id];
          if (fromPlc) {
            arrowPairs.push({
              from: `${DAYJP[fromPlc.day]}${fromPlc.period}限`,
              to: `${DAYJP[m.day]}${m.period}限`,
              subj: (state.subjectCfg[it.subjKey]?.abbr || it.subj || '').slice(0, 4)
            });
          }
        }
        const arrowHTML = arrowPairs.map(ap =>
          `<div class="smg-arrow-row">` +
          `<span class="smg-ar-from" style="background:#fef2f2;border:1px solid #ef4444;border-radius:4px;padding:2px 6px;color:#b91c1c;font-size:11px;font-weight:700">` +
          `↑ ${escapeHtml(ap.subj)} ${escapeHtml(ap.from)}</span>` +
          `<svg class="smg-ar-svg" viewBox="0 0 48 14" fill="none" style="width:48px;height:14px;flex-shrink:0">` +
          `<line x1="2" y1="7" x2="40" y2="7" stroke="url(#smgar-grad-${Math.random().toString(36).slice(2,6)})" stroke-width="2.5" stroke-linecap="round"/>` +
          `<polygon points="36,3 48,7 36,11" fill="#16a34a"/>` +
          `</svg>` +
          `<span class="smg-ar-to" style="background:#f0fdf4;border:1px solid #16a34a;border-radius:4px;padding:2px 6px;color:#15803d;font-size:11px;font-weight:700">` +
          `↓ ${escapeHtml(ap.to)}</span>` +
          `</div>`
        ).join('');

        // Compact FROM→TO summary below table
        const summaryHTML = arrowPairs.map(ap =>
          `<div class="smg-summary"><span class="smg-from-lbl">↑ ${escapeHtml(ap.subj)} ${escapeHtml(ap.from)}</span>` +
          `<span class="smg-arr-lbl">▶</span>` +
          `<span class="smg-to-lbl">${escapeHtml(ap.to)} ↓</span></div>`
        ).join('');

        return `<div class="smg-block">
        <div class="smg-title smg-title-mover">📋 ${escapeHtml(abbr)}</div>
        <div style="position:relative">
          <table class="smg-table">
            <thead><tr><th></th>${DAYS.map(d => `<th>${DAYJP[d]}</th>`).join('')}</tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        ${summaryHTML}
      </div>`;
      }).join('') + (() => {
        // ── どかされる教員の簡易時間割 ──
        // 移動先スロットに既存コマがある場合、その教員の時間割を表示
        try {
          const moveIdSet = new Set(moves.map(m => m.id));
          const displacedTeaSet = new Set();
          for (const m of moves) {
            const it = state.items[m.id];
            if (!it) continue;
            // find items at destination that aren't in moves
            for (const [pid, plc] of Object.entries(state.placements)) {
              if (!plc || moveIdSet.has(pid)) continue;
              if (plc.day === m.day && plc.period === m.period) {
                const dIt = state.items[pid];
                if (!dIt) continue;
                // same class check
                const sharedCls = (it.cls || []).some(c => (dIt.cls || []).includes(c));
                if (sharedCls) {
                  for (const t of dIt.teas || []) displacedTeaSet.add(t);
                }
              }
            }
          }
          const displacedTeas = [...displacedTeaSet].filter(t => !teas.includes(t)).slice(0, 2);
          if (!displacedTeas.length) return '';

          return displacedTeas.map(tea => {
            const abbr = state.teacherCfg[tea]?.abbr || tea.slice(0, 4);
            let rows = '';
            for (let p = 1; p <= maxP; p++) {
              rows += `<tr><td class="smg-h">${p}</td>`;
              for (const d of DAYS) {
                const cellIds = (idx.tea?.[tea]?.[d]?.[p] || []).filter(x => !isSpanFill(x, d, p));
                // Highlight destination slot (where this teacher's lesson is being displaced FROM)
                let isDisplacedFrom = false;
                for (const m of moves) {
                  if (m.day === d && m.period === p) {
                    if ((idx.tea?.[tea]?.[d]?.[p] || []).some(pid => !moveIdSet.has(pid))) {
                      isDisplacedFrom = true;
                    }
                  }
                }
                let cellContent = '';
                let cellStyle = '';
                if (isDisplacedFrom) {
                  const it0 = cellIds.length ? state.items[cellIds[0]] : null;
                  const ab0 = it0 ? (state.subjectCfg[it0.subjKey]?.abbr || it0.subj || '').slice(0, 3) : '';
                  cellStyle = 'background:#f59e0b;color:#fff;font-weight:900;font-size:10px;border:2px solid #b45309;';
                  cellContent = `<div style="font-size:7px;opacity:.9">${escapeHtml(ab0)}</div><div>退</div>`;
                } else if (cellIds.length) {
                  const id0 = cellIds[0];
                  const it0 = state.items[id0];
                  const sc0 = state.subjectCfg[it0?.subjKey] || {};
                  const col0 = sc0.color || pickColor(it0?.subjKey || '');
                  const ab0 = (sc0.abbr || it0?.subj || '').slice(0, 3);
                  cellStyle = `background:${col0}20;border-left:3px solid ${col0}`;
                  cellContent = escapeHtml(ab0);
                }
                if (p > maxPeriod(d)) {
                  rows += `<td class="smg-fd"></td>`;
                } else {
                  rows += `<td class="smg-c" style="${cellStyle}">${cellContent}</td>`;
                }
              }
              rows += `</tr>`;
            }
            return `<div class="smg-block smg-displaced">
            <div class="smg-title smg-title-displaced">⬅ ${escapeHtml(abbr)} (退避)</div>
            <table class="smg-table">
              <thead><tr><th></th>${DAYS.map(d => `<th>${DAYJP[d]}</th>`).join('')}</tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>`;
          }).join('');
        } catch (e) { return ''; }
      })();
    } catch (e) { console.error('buildSugMiniGridHTML error', e); return ''; }
  }
  function isSamePositionSuggestion(s) {
    // すべてのmoveが現在位置と同じなら無意味な提案
    if (!s.moves || !s.moves.length) return false;
    return s.moves.every(m => {
      const plc = state.placements[m.id];
      return plc && plc.day === m.day && plc.period === m.period;
    });
  }

  /* movesを正規化したキー（全タブ横断で重複排除に使う） */
  function movesKey(moves) {
    if (!moves || !moves.length) return '';
    return moves.map(m => `${m.id}:${m.day}:${m.period}`).sort().join('|');
  }

  /* ============================================================
     v49+: 提案精度改善 — グリッド内連動提案の共通コア
     
     在庫不使用の連動移動提案を生成する。
     puzSearch（パズルソルバー）を活用し、
     ブロッカーが別のブロッカーの場所へ連鎖的に移動するケースも検出する。
     ============================================================ */

  /**
   * chainQualityScore(moves)
   * movesが完了した後の各コマの配置品質を評価する。
   * validatePlacement を全コマに対して実行し、
   * 警告・ブロックの少ない提案を高く評価する。
   */
  function chainQualityScore(moves) {
    if (!moves || !moves.length) return 0;
    return puzWithTempMoves(moves, () => {
      let score = 0;
      for (const m of moves) {
        const v = validatePlacement(m.id, m.day, m.period, 'safe', null) || { blocks: [], warns: [] };
        score -= v.blocks.length * 20;
        score -= v.warns.length * 5;
        // ボーナス: 午前中・教員コマ数が少ない日
        const it = state.items[m.id];
        if (it) {
          for (const tea of (it.teas || [])) score -= teacherDayCount(tea, m.day) * 2;
        }
        score += m.period <= 3 ? 3 : 0;
      }
      return score;
    });
  }

  /**
   * computeGridChainCore(id, targetSlots)
   * puzSearch を使って、id を targetSlots のどれかに配置する
   * グリッド内連動移動を探索する。
   * 在庫不使用・全コマ制約満足を保証する。
   */
  function computeGridChainCore(id, targetSlots, maxResults = 16) {
    const it = state.items[id];
    if (!it) return [];
    const out = [];
    const seen = new Set();
    const startTime = Date.now();

    for (const { day, p } of targetSlots) {
      // v63.2: 探索時間上限を延長（800ms→1200ms）退避なし提案を増やすため
      if (Date.now() - startTime > 1200) break;
      if (out.length >= maxResults * 2) break;

      const moves = puzSearch(id, day, p);
      if (!moves || !moves.length) continue;

      // 重複排除
      const k = moves.map(m => `${m.id}:${m.day}:${m.period}`).sort().join('|');
      if (seen.has(k)) continue;
      seen.add(k);

      // 品質スコア計算（全移動先の制約を検証）
      const qualScore = chainQualityScore(moves);
      const depth = moves.length - 1; // ブロッカーの移動手数
      const baseScore = Math.max(20, 88 - depth * 12) + qualScore;

      // 各移動の説明
      const prereqs = moves.filter(m => m.id !== id);
      const desc = prereqs.length > 0
        ? prereqs.map(m => {
          const subj = state.items[m.id]?.subjKey || m.id;
          const from = state.placements[m.id]
            ? `${DAYJP[state.placements[m.id].day]}${state.placements[m.id].period}`
            : '在庫';
          return `${subj} ${from}→${DAYJP[m.day]}${m.period}`;
        }).join(' → ')
        : '直接移動可能';

      const typeLabel = depth === 0 ? '直接'
        : depth === 1 ? '2手連動'
          : depth === 2 ? '3手連動'
            : `${depth + 1}手連動`;

      out.push({
        title: `${typeLabel}: ${DAYJP[day]}${p}限へ`,
        score: Math.round(baseScore),
        reason: [
          depth === 0 ? '空き枠あり' : `${prereqs.length}コマを連動移動（グリッド内、在庫なし）`,
          desc,
          ...(prereqs.length > 0 ? ['✓ 全コマ制約チェック済み'] : []),
        ],
        moves,
        noStock: true,
        chainDepth: depth,
      });
    }

    out.sort((a, b) => b.score - a.score);
    // 重複手順が多い場合は間引き
    const deduped = [];
    const depthCount = {};
    for (const s of out) {
      const d = s.chainDepth;
      depthCount[d] = (depthCount[d] || 0) + 1;
      if (depthCount[d] <= 4) deduped.push(s); // 各手数最大4件
    }
    return deduped.slice(0, maxResults);
  }

  /**
   * computeLinkedSuggestions(id)
   * 配置済み・未配置どちらにも対応する連動提案。
   * puzSearch で 1〜4手先まで探索し、在庫不使用の解のみ返す。
   */
  function computeLinkedSuggestions(id) {
    const it = state.items[id];
    if (!it) return [];

    const curPlc = state.placements[id];

    // 候補スロットを事前にスコアリング
    const slots = [];
    for (const day of DAYS) {
      const maxP = maxPeriod(day);
      for (let p = 1; p <= maxP; p++) {
        if ((it.span || 1) === 2 && p >= maxP) continue;
        if (curPlc && curPlc.day === day && curPlc.period === p) continue;

        const v = validatePlacement(id, day, p, 'safe', null) || { blocks: [], warns: [] };
        // 直接置ける場合は empty タブに任せる（ただし0〜1警告のみの場合は含める）
        if (v.blocks.length === 0 && v.warns.length === 0) continue; // 完全空きはスキップ

        // ブロッカー数が少ない順に優先（見込みが高い）
        const priority = 100 - v.blocks.length * 15 - v.warns.length * 5 + (p <= 3 ? 3 : 0);
        slots.push({ day, p, priority, blocks: v.blocks.length });
      }
    }
    slots.sort((a, b) => b.priority - a.priority);

    // v63.2: 上位スロットで探索（最大32スロットに拡張、結果24件）
    const topSlots = slots.slice(0, 32);
    return computeGridChainCore(id, topSlots, 24);
  }

  /* v45.2: 複合提案 — 複数コマを同時に移動させることで配置を解決する提案 */
  function computeComboSuggestions(id) {
    const it = state.items[id];
    if (!it || state.placements[id]) return [];

    const MAX_COMBO = 5;   // v63.2: 3→5 より複雑な複合移動を許可
    const MAX_DEST = 10;   // v63.2: 5→10 退避先候補を拡大
    const TIME_LIMIT = 400; // v63.2: 200→400ms
    const startTime = Date.now();
    const timeUp = () => (Date.now() - startTime) > TIME_LIMIT;

    const out = [];

    function getOccupants(xid, day, p, tempPl) {
      const xi = state.items[xid]; if (!xi) return [];
      const occ = [];
      for (const [oid, oPlc] of Object.entries(tempPl)) {
        if (!oPlc || oid === xid) continue;
        const oi = state.items[oid]; if (!oi) continue;
        if (oPlc.day !== day) continue;
        const ospan = oi.span || 1;
        const oPeriods = [oPlc.period]; if (ospan === 2) oPeriods.push(oPlc.period + 1);
        const xspan = xi.span || 1;
        const xPeriods = [p]; if (xspan === 2) xPeriods.push(p + 1);
        if (!oPeriods.some(pp => xPeriods.includes(pp))) continue;
        if (xi.teas.some(t => oi.teas.includes(t)) || xi.cls.some(c => oi.cls.includes(c)) ||
          (xi.rooms || []).some(r => r && (oi.rooms || []).includes(r))) occ.push(oid);
      }
      return occ;
    }

    function canPlace(xid, day, p, tempPl) {
      const xi = state.items[xid]; if (!xi) return false;
      if ((xi.span || 1) === 2 && p >= maxPeriod(day)) return false;
      return getOccupants(xid, day, p, tempPl).length === 0;
    }

    function destCandidates(blkId, tempPl) {
      const bi = state.items[blkId]; if (!bi) return [];
      const cands = [];
      for (const d of DAYS) {
        const maxP2 = maxPeriod(d);
        for (let p = 1; p <= maxP2; p++) {
          if ((bi.span || 1) === 2 && p >= maxP2) continue;
          const cur = tempPl[blkId];
          if (cur && cur.day === d && cur.period === p) continue;
          if (canPlace(blkId, d, p, tempPl)) cands.push({ day: d, period: p });
          if (cands.length >= MAX_DEST * 3) break;
        }
        if (cands.length >= MAX_DEST * 3) break;
      }
      return cands.slice(0, MAX_DEST);
    }

    function tryResolveAll(tDay, tPeriod, initTempPl) {
      const blockers = getOccupants(id, tDay, tPeriod, initTempPl)
        .filter(x => !initTempPl[x]?.locked);
      if (!blockers.length) return null;
      if (blockers.length > MAX_COMBO) return null;

      const destLists = blockers.map(blk => destCandidates(blk, initTempPl));
      if (destLists.some(d => d.length === 0)) return null;

      function* cartesian(lists, idx, cur) {
        if (idx === lists.length) { yield cur; return; }
        for (const item of lists[idx]) yield* cartesian(lists, idx + 1, [...cur, item]);
      }

      for (const combo of cartesian(destLists, 0, [])) {
        if (timeUp()) return null;
        let tempPl = { ...initTempPl };
        const movesArr = [];
        let valid = true;
        for (let i = 0; i < blockers.length; i++) {
          const blkId = blockers[i];
          const dest = combo[i];
          const itBlk = state.items[blkId]; if (!itBlk) { valid = false; break; }
          if (movesArr.some(m => m.day === dest.day && m.period === dest.period)) {
            valid = false; break;
          }
          const tempPl2 = { ...tempPl };
          delete tempPl2[blkId];
          if (!canPlace(blkId, dest.day, dest.period, tempPl2)) { valid = false; break; }
          tempPl = { ...tempPl, [blkId]: { day: dest.day, period: dest.period, locked: false } };
          movesArr.push({ id: blkId, day: dest.day, period: dest.period, span: itBlk.span || 1 });
        }
        if (!valid) continue;
        if (!canPlace(id, tDay, tPeriod, tempPl)) continue;

        const allMoves = [...movesArr, { id, day: tDay, period: tPeriod, span: it.span || 1 }];
        const sim = simulateMoves(allMoves);
        if (!sim.ok) continue;

        const numMoved = movesArr.length;
        const stepsLabel = movesArr.map(m => `${state.items[m.id]?.subjKey || m.id}→${DAYJP[m.day]}${m.period}`).join(', ');
        return {
          title: `複合${numMoved}手: ${DAYJP[tDay]}${tPeriod}限`,
          score: Math.max(25, 65 - numMoved * 10),
          reason: [`${numMoved}コマを移動して配置可能`, stepsLabel],
          moves: allMoves,
          stashChain: true,
        };
      }
      return null;
    }

    for (const day of DAYS) {
      const maxP = maxPeriod(day);
      for (let p = 1; p <= maxP; p++) {
        if (timeUp()) break;
        if ((it.span || 1) === 2 && p >= maxP) continue;
        const v0 = validatePlacement(id, day, p, 'safe', null);
        if (!v0.blocks.length) continue;

        const tempPl0 = { ...state.placements };
        delete tempPl0[id];
        const res = tryResolveAll(day, p, tempPl0);
        if (!res) continue;
        out.push(res);
        if (out.length >= 6) return out;
      }
    }
    return out;
  }

  function computeSuggestionPack(id) {
    const deep = !!(window && window.__SUG_DEEP);
    const safeCompute = (fn, label) => {
      try {
        return fn() || [];
      } catch (e) {
        console.error(`提案計算エラー (${label}):`, e);
        return [];
      }
    };

    const filterSame = arr => arr.filter(s => !isSamePositionSuggestion(s));

    // v49+: スコア降順にソート（各タブ内で品質順）
    const sortByScore = arr => [...arr].sort((a, b) => (b.score || 0) - (a.score || 0));

    // v45.2: 全タブ横断で重複排除（movesキーで管理）
    const globalSeenKeys = new Set();
    const dedupGlobal = (arr) => arr.filter(s => {
      const k = movesKey(s.moves);
      if (!k || globalSeenKeys.has(k)) return false;
      globalSeenKeys.add(k);
      return true;
    });

    // v49+: 連動提案（グリッド内・在庫不使用）を主軸に
    // computeLinkedSuggestions は puzSearch ベースでブロッカーの連鎖も解決
    const linkedRaw = sortByScore(filterSame(safeCompute(() => (deep && typeof computeLinkedSuggestionsDeep === 'function') ? computeLinkedSuggestionsDeep(id) : computeLinkedSuggestions(id), '連動')));

    // 入替: 2コマ入替 + 連動提案の1手分
    const swapRaw = sortByScore(filterSame([
      ...safeCompute(() => computeSwapSuggestions(id), '入替'),
    ]));

    // 回転: 3〜4コマの回転（全グリッド内）
    const cycleRaw = sortByScore(filterSame(safeCompute(() => (deep && typeof computeCycleSuggestionsDeep === 'function') ? computeCycleSuggestionsDeep(id) : computeCycleSuggestions(id), '回転')));

    // パズル: 全体最適・先読み
    const lookaheadRaw = sortByScore(filterSame([
      ...(deep && typeof computeDeepOptimizeSuggestions === 'function' ? safeCompute(() => computeDeepOptimizeSuggestions(id), '深読み') : []),
      ...safeCompute(() => computePuzzleSuggestions(id), 'パズル'),
      ...safeCompute(() => computeLookaheadSuggestions(id), '先読み')
    ]));

    // LNS: Large Neighborhood Search（部分破壊→再配置で「全体の収まり」を改善）
    const lnsRaw = sortByScore(filterSame(safeCompute(() => (typeof window !== 'undefined' && window.__SUG_LNS && typeof computeLNSSuggestions === 'function') ? computeLNSSuggestions(id) : [], 'LNS')));

    const raw = {
      empty: filterSame(safeCompute(() => computeEmptySuggestions(id), '空き枠')),
      swap: swapRaw,
      cycle: cycleRaw,
      linked: linkedRaw,   // v49: stash → linked (グリッド内連動)
      lookahead: lookaheadRaw,
      lns: lnsRaw,
      force: filterSame(safeCompute(() => computeForceSuggestions(id), '強制')),
    };

    // タブ順に重複排除（先に出たタブ優先）
    return {
      empty: dedupGlobal(raw.empty),
      swap: dedupGlobal(raw.swap),
      cycle: dedupGlobal(raw.cycle),
      linked: dedupGlobal(raw.linked),
      lookahead: dedupGlobal(raw.lookahead),
      lns: dedupGlobal(raw.lns || []),
      force: dedupGlobal(raw.force),
    };
  }


  function simulateMoves(moves) {
    const backup = {};
    for (const m of moves) { backup[m.id] = state.placements[m.id]; }
    try {
      // remove
      for (const m of moves) { state.placements[m.id] = null; }
      // apply
      for (const m of moves) {
        state.placements[m.id] = { day: m.day, period: m.period, locked: backup[m.id]?.locked || false };
      }
      invalidateIndex();
      // warm cache
      buildIndex();
      // validate all
      const errors = [];
      for (const m of moves) {
        const v = validatePlacement(m.id, m.day, m.period, 'safe', null);
        if (v.blocks.length) errors.push(...v.blocks.map(x => `[${m.id}] ${x}`));
      }
      return { ok: errors.length === 0, errors };
    } finally {
      for (const k in backup) { state.placements[k] = backup[k]; }
      invalidateIndex();
    }
  }

  /* v39: 印刷自動フィット — A4縦1枚に収まるようcellStep/fontStepを自動算出 */
  function printAutoFit() {
    const type = $('#print-type')?.value || 'class';
    const keys = getAxisKeys(type);
    if (!keys.length) { flash('データがありません'); return; }
    const maxP = Math.max(...DAYS.map(d => maxPeriod(d)));

    // A4縦の利用可能高さ（mm→px換算, 96dpi）: 297mm - マージン30mm ≈ 267mm → 1013px
    // ただしブラウザのCSSピクセルとmm変換は近似
    const pageH = 960; // px (conservative)
    const rowCount = maxP + 1; // +1 for header
    const targetCellH = Math.floor((pageH / rowCount) - 2); // -2px for borders

    const cellSizes = [28, 34, 40, 46, 52, 58, 66, 76, 88, 100, 120, 140];
    const fontSizes = [8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 20, 24];
    const baseIdx = 3;

    // cellStep: cellSizes[baseIdx+step] <= targetCellH
    let bestCellStep = -4;
    for (let s = -4; s <= 8; s++) {
      if (cellSizes[clamp(baseIdx + s, 0, cellSizes.length - 1)] <= targetCellH) bestCellStep = s;
    }

    // fontStep: 対応するフォントサイズ（cellの比率で決定）
    const bestFontStep = Math.max(-4, bestCellStep - 1);

    state.ui.printCellStep = bestCellStep;
    state.ui.printFontStep = bestFontStep;
    markDirty('ui');
    renderPrint();
    flash(`自動フィット: セル高${cellSizes[clamp(baseIdx + bestCellStep, 0, cellSizes.length - 1)]}px / 文字${fontSizes[clamp(baseIdx + bestFontStep, 0, fontSizes.length - 1)]}px`);
  }

  function applySuggestion(s) {
    const moves0 = s?.moves || [];
    if (!moves0.length) return;

    // ロックは動かさない（安全側）
    const moves = moves0.filter(m => !state.placements[m.id]?.locked);
    if (!moves.length) { flash('移動対象がロックされています'); return; }

    // 強制提案かどうか判定（タイトルに「強制」が含まれる場合はvalidation skip）
    const isForce = !!(s.force || (s.title || '').includes('強制') || (s.title || '').includes('⚠'));

    if (!isForce) {
      const sim = simulateMoves(moves);
      if (!sim.ok) {
        // 強制適用の確認ダイアログを出す
        const errMsg = sim.errors.slice(0, 3).join('\n');
        showModal(
          '制約違反があります — 強制適用しますか？',
          `${errMsg}\n\n「OK」で強制的に配置します（違反は残ります）。`,
          () => {
            _doApplySuggestion(moves);
          }
        );
        return;
      }
    }

    _doApplySuggestion(moves);
  }

  function _doApplySuggestion(moves) {
    pushHistory('suggest');

    // ★原子適用：いったん全員外す→まとめて置く
    const lockMap = {};
    for (const m of moves) {
      lockMap[m.id] = !!state.placements[m.id]?.locked;
      state.placements[m.id] = null;
    }
    invalidateIndex();

    for (const m of moves) {
      doPlace(m.id, m.day, m.period, null);
      if (state.placements[m.id]) state.placements[m.id].locked = lockMap[m.id];
    }

    invalidateIndex();
    markDirty('place');
    rerenderAll();
    broadcastState();
  }
  function computeEmptySuggestions(id) {
    const it = state.items[id];
    if (!it) return [];
    const curPlc = state.placements[id]; // 現在の配置
    const out = [];
    for (const day of DAYS) {
      const maxP = maxPeriod(day);
      for (let p = 1; p <= maxP; p++) {
        if (it.span === 2 && p === maxP) continue;
        // v42: 同じ位置への移動は除外（意味がない）
        if (curPlc && curPlc.day === day && curPlc.period === p) continue;
        const v = validatePlacement(id, day, p, 'safe', null);
        if (v.blocks.length) continue;
        let score = 100;
        const reason = [];
        for (const tea of it.teas) {
          const taught = teacherDayCount(tea, day);
          score -= taught * 2;
          reason.push(`${tea}:本日${taught}コマ`);
        }
        score -= v.warns.length * 8;
        if (v.warns.length) reason.push('警告:' + v.warns.join(','));
        score += (p <= 2) ? 3 : 0;
        out.push({ title: `空き: ${DAYJP[day]}${p}`, score, reason, moves: [{ id, day, period: p, span: it.span || 1 }] });
      }
    }

    // 空き枠がない場合、パズル提案を追加（4手先まで探索）
    if (out.length === 0) {
      try {
        const puzzleSuggestions = computePuzzleSuggestions(id);
        if (puzzleSuggestions && puzzleSuggestions.length > 0) {
          // パズル提案を追加（最大5件）
          out.push(...puzzleSuggestions.slice(0, 5));
        }
      } catch (e) {
        console.error('パズル提案計算エラー:', e);
      }
    }

    out.sort((a, b) => b.score - a.score);
    return out.slice(0, 14);
  }
  function teacherDayCount(tea, day) {
    const idx = buildIndex();
    const maxP = maxPeriod(day);
    let cnt = 0;
    for (let p = 1; p <= maxP; p++) {
      const ids = idx.tea?.[tea]?.[day]?.[p] || [];
      if (ids.some(x => !isSpanFill(x, day, p))) cnt++;
    }
    return cnt;
  }
  function computeSwapSuggestions(id) {
    const it = state.items[id]; const plc = state.placements[id];
    if (!it || !plc) return []; // swap needs origin
    const idx = buildIndex();
    const out = [];
    // candidates: cells that are currently occupied (teacher/class/room conflicts likely)
    const candIds = Object.keys(state.placements).filter(x => state.placements[x]).slice(0, 200);
    for (const other of candIds) {
      if (other === id) continue;
      const po = state.placements[other];
      const ito = state.items[other]; if (!po || !ito) continue;
      // v42: 自分が既にその位置にいる場合はスキップ（意味のない入替）
      if (plc.day === po.day && plc.period === po.period) continue;
      // try swap id<->other
      const moves = [
        { id, day: po.day, period: po.period, span: it.span || 1 },
        { id: other, day: plc.day, period: plc.period, span: ito.span || 1 },
      ];
      const sim = simulateMoves(moves);
      if (!sim.ok) continue;
      const score = 80 - (sim.errors.length * 10);
      out.push({ title: `入替: ${DAYJP[po.day]}${po.period} ↔ ${DAYJP[plc.day]}${plc.period}`, score, reason: [`相手:${ito.subjKey}`], moves });
      if (out.length >= 14) break;
    }
    return out;
  }
  function computeCycleSuggestions(id) {
    const it = state.items[id]; const plc = state.placements[id];
    if (!it || !plc) return [];
    const out = [];
    const T0 = Date.now();
    const placed = Object.keys(state.placements)
      .filter(x => state.placements[x] && x !== id && !state.placements[x].locked)
      .slice(0, 200);

    // --- 3コマ回転 ---
    outer3:
    for (let i = 0; i < placed.length; i++) {
      if (Date.now() - T0 > 200) break;
      const a = placed[i]; const pa = state.placements[a]; const ita = state.items[a]; if (!pa || !ita) continue;
      for (let j = i + 1; j < placed.length; j++) {
        const b = placed[j]; const pb = state.placements[b]; const itb = state.items[b]; if (!pb || !itb) continue;
        const moves = [
          { id, day: pa.day, period: pa.period, span: it.span || 1 },
          { id: a, day: pb.day, period: pb.period, span: ita.span || 1 },
          { id: b, day: plc.day, period: plc.period, span: itb.span || 1 },
        ];
        const sim = simulateMoves(moves);
        if (!sim.ok) continue;
        const qs = chainQualityScore(moves);
        out.push({
          title: `3コマ回転: →${DAYJP[pa.day]}${pa.period}`,
          score: 72 + qs,
          reason: [`${ita.subjKey}→${DAYJP[pb.day]}${pb.period}, ${itb.subjKey}→${DAYJP[plc.day]}${plc.period}`],
          moves, noStock: true,
        });
        if (out.length >= 5) break outer3;
      }
    }

    // --- 4コマ回転 ---
    if (Date.now() - T0 < 280 && placed.length >= 3) {
      outer4:
      for (let i = 0; i < Math.min(placed.length, 100); i++) {
        if (Date.now() - T0 > 320) break;
        const a = placed[i]; const pa = state.placements[a]; const ita = state.items[a]; if (!pa || !ita) continue;
        for (let j = i + 1; j < Math.min(placed.length, 100); j++) {
          const b = placed[j]; const pb = state.placements[b]; const itb = state.items[b]; if (!pb || !itb) continue;
          for (let k = j + 1; k < Math.min(placed.length, 80); k++) {
            if (Date.now() - T0 > 350) break;
            const c = placed[k]; const pc = state.placements[c]; const itc = state.items[c]; if (!pc || !itc) continue;
            const moves4 = [
              { id, day: pa.day, period: pa.period, span: it.span || 1 },
              { id: a, day: pb.day, period: pb.period, span: ita.span || 1 },
              { id: b, day: pc.day, period: pc.period, span: itb.span || 1 },
              { id: c, day: plc.day, period: plc.period, span: itc.span || 1 },
            ];
            const sim4 = simulateMoves(moves4);
            if (!sim4.ok) continue;
            const qs4 = chainQualityScore(moves4);
            out.push({
              title: `4コマ回転: →${DAYJP[pa.day]}${pa.period}`,
              score: 60 + qs4,
              reason: [`4コマ連鎖回転（在庫不使用）`,
                `${ita.subjKey}→${DAYJP[pb.day]}${pb.period}, ${itb.subjKey}→${DAYJP[pc.day]}${pc.period}, ${itc.subjKey}→${DAYJP[plc.day]}${plc.period}`],
              moves: moves4, noStock: true,
            });
            if (out.length >= 8) break outer4;
          }
        }
      }
    }

    out.sort((a, b) => b.score - a.score);
    return out.slice(0, 8);
  }

  /**
   * v49+: computeChainSwapSuggestions
   * puzSearch を使ったグリッド内連動提案（配置済みコマ用）
   * 在庫退避なし・全コマ制約チェック済み
   */
  function computeChainSwapSuggestions(id) {
    return computeLinkedSuggestions(id);
  }

  function computeForceSuggestions(id) {
    const it = state.items[id];
    if (!it) return [];
    const curPlc = state.placements[id];
    const out = [];
    for (const day of DAYS) {
      const maxP = maxPeriod(day);
      for (let p = 1; p <= maxP; p++) {
        if ((it.span || 1) === 2 && p === maxP) continue;
        if (curPlc && curPlc.day === day && curPlc.period === p) continue;
        const v = validatePlacement(id, day, p, 'safe', null);
        // 違反あり OR 警告のみのコマを対象とする（完全OKはemptyタブで扱う）
        if (v.blocks.length === 0 && v.warns.length === 0) continue; // 完全空きはスキップ
        const score = -v.blocks.length * 20 - v.warns.length * 5 + (p <= 3 ? 5 : 0);
        const reason = [...v.blocks.map(b => `🔴${b}`), ...v.warns.map(w => `⚠${w}`)];
        const label = v.blocks.length > 0 ? `強制: ${DAYJP[day]}${p}限（違反${v.blocks.length}件）` : `警告: ${DAYJP[day]}${p}限`;
        out.push({ title: label, score, reason, moves: [{ id, day, period: p, span: it.span || 1 }] });
      }
    }
    out.sort((a, b) => (b.score || 0) - (a.score || 0));
    return out.slice(0, 12);
  }
  /**
   * v49+: computeStashSuggestions
   * 未配置コマ向け。puzSearch を使ったグリッド内連動提案。
   * 在庫退避なし・全コマ制約チェック付き。
   */
  function computeStashSuggestions(id) {
    const it = state.items[id];
    if (!it || state.placements[id]) return []; // 未配置コマのみ対象

    // computeLinkedSuggestions は配置済み・未配置どちらにも対応
    return computeLinkedSuggestions(id);
  }


  /* =======================
     Lookahead (先読み) suggestions — mini beam search
  ======================= */
  function computeLookaheadSuggestions(id) {
    // 改善版を使用
    if (typeof computeEnhancedLookaheadSuggestions === 'function') {
      try {
        return computeEnhancedLookaheadSuggestions(id);
      } catch (e) {
        console.error('改善版提案でエラー:', e);
        // フォールバック
      }
    }

    // For each candidate placement of 'id', simulate placing it then greedily
    // place the next N hardest unplaced items. Score = how many we can place + quality.
    const it = state.items[id]; if (!it) return [];
    const BEAM = 6;   // candidate placements to evaluate
    const DEPTH = 4;  // how many subsequent items to look ahead

    // Gather unplaced ids (excluding target)
    const allIds = Object.keys(state.items);
    const unplacedOthers = allIds.filter(x => x !== id && !state.placements[x]);

    // Sort by constraint hardness
    const hardness = (xid) => {
      const xi = state.items[xid]; if (!xi) return 0;
      const forbid = countForbid(xi.subjKey) || 0;
      return ((xi.span || 1) === 2 ? 10 : 0) + (xi.cls?.length > 1 ? 6 : 0) + (xi.teas?.length > 1 ? 5 : 0) + forbid * 0.4;
    };
    const nextIds = unplacedOthers.slice().sort((a, b) => hardness(b) - hardness(a)).slice(0, DEPTH);

    // Candidate placements for target
    const targetCands = [];
    for (const day of DAYS) {
      const maxP = maxPeriod(day);
      for (let p = 1; p <= maxP; p++) {
        if ((it.span || 1) === 2 && p === maxP) continue;
        const v = validatePlacement(id, day, p, 'safe', null);
        if (v.blocks.length) continue;
        targetCands.push({ day, period: p, score: 100 - v.warns.length * 5 });
      }
    }
    targetCands.sort((a, b) => b.score - a.score);
    const evalCands = targetCands.slice(0, BEAM);
    if (!evalCands.length) return [];

    // For each candidate, simulate
    const results = [];
    for (const cand of evalCands) {
      // temporarily place target
      const backup = deepClone(state.placements);
      state.placements[id] = { day: cand.day, period: cand.period, locked: false };
      invalidateIndex();

      // greedily place next items
      let placed = 0;
      const placedIds = [id];
      for (const nid of nextIds) {
        const nit = state.items[nid]; if (!nit) continue;
        let best = null, bestScore = -99999;
        for (const day2 of DAYS) {
          const maxP2 = maxPeriod(day2);
          for (let p2 = 1; p2 <= maxP2; p2++) {
            if ((nit.span || 1) === 2 && p2 === maxP2) continue;
            const v2 = validatePlacement(nid, day2, p2, 'safe', null);
            if (v2.blocks.length) continue;
            const sc = 100 - v2.warns.length * 5;
            if (sc > bestScore) { bestScore = sc; best = { day: day2, period: p2 }; }
          }
        }
        if (best) {
          state.placements[nid] = { day: best.day, period: best.period, locked: false };
          invalidateIndex();
          placed++;
          placedIds.push(nid);
        }
      }

      // restore
      state.placements = backup;
      invalidateIndex();

      const totalScore = 50 + placed * 20 + cand.score * 0.3;
      const moves = [{ id, day: cand.day, period: cand.period, span: it.span || 1 }];
      results.push({
        title: `先読み: ${DAYJP[cand.day]}${cand.period} (後続+${placed})`,
        score: Math.round(totalScore),
        reason: [`この後 ${placed}/${nextIds.length} コマ配置可能`, `難しいコマ優先で探索`],
        moves,
      });
    }
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, 6);
  }

  /* =======================
     Misc helpers
  ======================= */
  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function escapeAttr(s) { return escapeHtml(s).replace(/"/g, '&quot;'); }

  function showHoverTip(text, x, y) {
    const tip = document.getElementById('hover-tip');
    if (!tip) return;
    tip.textContent = text;
    tip.style.display = 'block';
    const pad = 14;
    const vw = window.innerWidth, vh = window.innerHeight;

    // measure after display
    const rect = tip.getBoundingClientRect();
    const w = rect.width || 320;
    const h = rect.height || 120;

    const left = Math.min(x + pad, vw - w - 10);
    const top = Math.min(y + pad, vh - h - 10);
    tip.style.left = Math.max(6, left) + 'px';
    tip.style.top = Math.max(6, top) + 'px';
  }
  function hideHoverTip() {
    const tip = document.getElementById('hover-tip');
    if (tip) tip.style.display = 'none';
  }
  function itemDetailText(id) {
    const it = state.items[id];
    const plc = state.placements[id];
    if (!it) return '';
    const scfg = state.subjectCfg[it.subjKey] || {};
    const abbr = scfg.abbr || it.subj || '';
    const cls = it.cls.join(',') || '(未)';
    const teas = it.teas.join(',') || '(未)';
    const rooms = it.rooms.join(',') || '(未)';
    const when = plc ? `${DAYJP[plc.day]}${plc.period}〜${plc.period + it.span - 1}` : '(未配置)';
    const lock = (plc && plc.locked) ? '🔒ロック' : '';
    const span = it.span === 2 ? '2連' : '1コマ';
    return `科目: ${abbr} (${it.subj})\nクラス: ${cls}\n教員: ${teas}\n教室: ${rooms}\n時刻: ${when}\n${span} ${lock}`.trim();
  }
  function hexWithAlpha(hex, a) {
    const m = hex.replace('#', '');
    const r = parseInt(m.slice(0, 2), 16), g = parseInt(m.slice(2, 4), 16), b = parseInt(m.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${a})`;
  }

  /* =======================
     CSV import / export
  ======================= */
  async function readFileText(file, enc) {
    const buf = await file.arrayBuffer();
    if (enc === 'utf-8') {
      return new TextDecoder('utf-8', { fatal: false }).decode(buf);
    }
    if (enc === 'shift-jis') {
      return new TextDecoder('shift-jis', { fatal: false }).decode(buf);
    }
    // auto: try utf-8 then shift-jis
    let t = new TextDecoder('utf-8', { fatal: false }).decode(buf);
    // if too many replacement chars, fallback
    const rep = (t.match(/\uFFFD/g) || []).length;
    if (rep > 5) {
      try { t = new TextDecoder('shift-jis', { fatal: false }).decode(buf); } catch (e) { }
    }
    return t;
  }
  function parseCSV(text) {
    // basic CSV parser for quoted fields
    const rows = [];
    let i = 0, field = '', row = [], inQ = false;
    const pushField = () => { row.push(field); field = ''; };
    const pushRow = () => { rows.push(row); row = []; };
    while (i < text.length) {
      const c = text[i];
      if (inQ) {
        if (c === '"' && text[i + 1] === '"') { field += '"'; i += 2; continue; }
        if (c === '"') { inQ = false; i++; continue; }
        field += c; i++; continue;
      } else {
        if (c === '"') { inQ = true; i++; continue; }
        if (c === ',') { pushField(); i++; continue; }
        if (c === '\r') { i++; continue; }
        if (c === '\n') { pushField(); pushRow(); i++; continue; }
        field += c; i++; continue;
      }
    }
    pushField(); pushRow();
    // remove last empty row
    if (rows.length && rows[rows.length - 1].every(x => x === '')) rows.pop();
    return rows;
  }
  function importCSVText(text) {
    const rows = parseCSV(text);
    if (!rows.length) return;
    const header = rows[0].map(h => h.trim());
    const hasHeader = header.includes('クラス') || header.includes('科目');
    const start = hasHeader ? 1 : 0;
    const idx = (name) => header.indexOf(name);
    const get = (arr, i) => (i >= 0 && i < arr.length) ? arr[i] : '';
    pushHistory('csvImport');
    for (let r = start; r < rows.length; r++) {
      const a = rows[r];
      const row = {
        _id: null,
        cls: get(a, idx('クラス')) || get(a, 0),
        subj: get(a, idx('科目')) || get(a, 1),
        subjAbbr: get(a, idx('科目略')) || get(a, 2),
        dept: get(a, idx('教科')) || get(a, 3),
        tea: get(a, idx('教員')) || get(a, 4),
        teaAbbr: get(a, idx('教員略')) || get(a, 5),
        room: get(a, idx('教室')) || get(a, 6),
        count: parseInt(get(a, idx('コマ数')) || get(a, 7) || '1', 10) || 1,
        dbl: String(get(a, idx('2連')) || get(a, 8) || '').trim() === '1' || String(get(a, idx('2連')) || '').toLowerCase() === 'true'
      };
      ensureRowId(row);
      state.rawRows.push(row);
    }
    markDirty('csvImport');
    rebuildMastersFromRaw();
    renderInputTable();
  }

  function exportCSV() {
    const header = ['クラス', '科目', '科目略', '教科', '教員', '教員略', '教室', 'コマ数', '2連'];
    const lines = [];
    lines.push(header.map(csvEscape).join(','));
    for (const r of state.rawRows) {
      lines.push([
        r.cls || '', r.subj || '', r.subjAbbr || '', r.dept || '',
        r.tea || '', r.teaAbbr || '', r.room || '',
        r.count || 1, r.dbl ? 1 : 0
      ].map(csvEscape).join(','));
    }
    const bom = '\uFEFF';
    const blob = new Blob([bom + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'timetable_stock.csv';
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }


  function exportTeacherMatrixCSV() {
    // rows: teachers, cols: Mon1..FriN (N=max(6, max periods))
    const idx = buildIndex();
    const teachers = getAxisKeys('teacher'); // respects sort settings
    const maxP = Math.max(6, ...DAYS.map(d => maxPeriod(d)));
    const header = ['教員'];
    for (const d of DAYS) {
      for (let p = 1; p <= maxP; p++) {
        header.push(`${DAYJP[d]}${p}`);
      }
    }
    const lines = [];
    lines.push(header.map(csvEscape).join(','));
    for (const t of teachers) {
      const row = [t];
      for (const d of DAYS) {
        for (let p = 1; p <= maxP; p++) {
          if (p > maxPeriod(d)) { row.push(''); continue; }
          const ids = idsInCellForRow('teacher', t, d, p, idx) || [];
          if (!ids.length) { row.push(''); continue; }
          const vals = [];
          for (const id of ids) {
            const it = state.items[id]; if (!it) continue;
            const scfg = state.subjectCfg[it.subjKey] || {};
            const abbr = (scfg.abbr || it.subj || it.subjKey || '').trim();
            const cls = (it.cls || []).join(',');
            const room = (it.rooms || []).join(',');
            let s = `${cls} ${abbr}`.trim();
            if (room) s += `@${room}`;
            vals.push(s);
          }
          row.push(vals.join(' | '));
        }
      }
      lines.push(row.map(csvEscape).join(','));
    }
    const bom = '\uFEFF';
    const blob = new Blob([bom + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'teachers_timetable_matrix.csv';
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  function exportClassMatrixCSV() {
    const idx = buildIndex();
    const classes = getAxisKeys('class');
    const maxP = Math.max(6, ...DAYS.map(d => maxPeriod(d)));
    const header = ['クラス'];
    for (const d of DAYS) {
      for (let p = 1; p <= maxP; p++) {
        header.push(`${DAYJP[d]}${p}`);
      }
    }
    const lines = [];
    lines.push(header.map(csvEscape).join(','));
    for (const cls of classes) {
      const row = [cls];
      for (const d of DAYS) {
        for (let p = 1; p <= maxP; p++) {
          if (p > maxPeriod(d)) { row.push(''); continue; }
          const ids = idsInCellForRow('class', cls, d, p, idx) || [];
          if (!ids.length) { row.push(''); continue; }
          const vals = [];
          for (const id of ids) {
            const it = state.items[id]; if (!it) continue;
            const scfg = state.subjectCfg[it.subjKey] || {};
            const abbr = (scfg.abbr || it.subj || it.subjKey || '').trim();
            const tea = (it.teas || []).map(t => state.teacherCfg[t]?.abbr || t).join(',');
            let s = abbr;
            if (tea) s += `(${tea})`;
            vals.push(s);
          }
          row.push(vals.join(' | '));
        }
      }
      lines.push(row.map(csvEscape).join(','));
    }
    const bom = '﻿';
    const blob = new Blob([bom + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'classes_timetable_matrix.csv';
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }


  /* =======================
     XLSX export (teacher / class matrix)
     Format mirrors the school's 先生の授業時間割一覧 xlsx:
       Row 1: title
       Row 2: day headers (merged)
       Row 3: period numbers
       Per entity: 2 rows — row A = class names, row B = subject names
       Col A = entity name (merged A/B), Col B = homeroom/担当, Col C = role (merged)
  ======================= */
  function _xlsxDownload(wb, filename) {
    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true });
    const blob = new Blob([wbout], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  function _buildXlsxMatrixSheet(axisType) {
    const idx = buildIndex();
    const maxP = Math.max(6, ...DAYS.map(d => maxPeriod(d)));
    const DAY_NAMES = { Mon: '月曜日', Tue: '火曜日', Wed: '水曜日', Thu: '木曜日', Fri: '金曜日' };

    // 教科順ソート（教員のみ）
    const DEPT_ORDER = ['国語','地歴公民','数学','情報','理科','保健体育','芸術','外国語','家庭科'];
    function deptRank(dept) {
      const i = DEPT_ORDER.indexOf(dept);
      return i >= 0 ? i : DEPT_ORDER.length;
    }
    let keys;
    if (axisType === 'teacher') {
      const set = new Set();
      for (const it of Object.values(state.items)) {
        (it.teas && it.teas.length ? it.teas : ['(未)']).forEach(t => set.add(t));
      }
      keys = Array.from(set).sort((a, b) => {
        const da = inferTeacherDept(a), db = inferTeacherDept(b);
        const ra = deptRank(da), rb = deptRank(db);
        if (ra !== rb) return ra - rb;
        return a.localeCompare(b, 'ja');
      });
    } else {
      keys = getAxisKeys(axisType);
    }

    const LEAD = 3; // A=name, B=homeroom, C=role
    const totalCols = LEAD + DAYS.length * maxP;
    const dataStartRow = 3; // rows 0=title,1=day,2=period

    // ボーダーオブジェクトは毎回新規生成（共有参照によるxlsx-js-style内部mutation回避）
    const T = () => ({ style: 'thin', color: { rgb: '000000' } });
    const H = () => ({ style: 'hair', color: { rgb: '000000' } });

    const bdr = (t, b, l, r) => {
      const o = {};
      if (t) o.top = t; if (b) o.bottom = b;
      if (l) o.left = l; if (r) o.right = r;
      return o;
    };

    // セルスタイル適用（空セルは t:'s' で確実に書き込み）
    const setS = (ws, r, c, s) => {
      const addr = XLSX.utils.encode_cell({ r, c });
      if (!ws[addr]) ws[addr] = { t: 's', v: '' };
      ws[addr].s = s;
    };

    // 曜日境界=thin、時限間=hair（毎回新規オブジェクト）
    const slotL = (sc) => sc % maxP === 0 ? T() : H();
    const slotR = (sc) => sc % maxP === maxP - 1 ? T() : H();

    // ── AOA ──
    const aoa = [];
    const titleRow = Array(totalCols).fill(null);
    titleRow[0] = axisType === 'teacher' ? '＜先生の授業時間割一覧＞' : '＜クラス時間割一覧＞';
    aoa.push(titleRow);

    const dayRow = Array(totalCols).fill(null);
    let col = LEAD;
    for (const d of DAYS) { dayRow[col] = DAY_NAMES[d]; col += maxP; }
    aoa.push(dayRow);

    const pRow = Array(totalCols).fill(null);
    col = LEAD;
    for (const d of DAYS) { for (let p = 1; p <= maxP; p++) pRow[col++] = p; }
    aoa.push(pRow);

    for (const key of keys) {
      const rowA = Array(totalCols).fill(null);
      const rowB = Array(totalCols).fill(null);
      rowA[0] = key;
      if (axisType === 'teacher') {
        const hrItem = Object.values(state.items).find(it =>
          (it.teas || []).includes(key) && (it.subj || '').includes('HR'));
        rowA[1] = hrItem ? (hrItem.cls || [])[0] || '' : '';
        rowB[1] = '担';
        rowA[2] = (state.teacherCfg[key] || {}).role || '';
      } else {
        rowA[1] = key; rowB[1] = '担'; rowA[2] = '';
      }
      col = LEAD;
      for (const d of DAYS) {
        for (let p = 1; p <= maxP; p++) {
          if (p <= maxPeriod(d)) {
            const ids = idsInCellForRow(axisType, key, d, p, idx) || [];
            if (ids.length) {
              const it = state.items[ids[0]];
              if (it) {
                const scfg = state.subjectCfg[it.subjKey] || {};
                const abbr = (scfg.abbr || it.subj || it.subjKey || '').trim();
                if (axisType === 'teacher') {
                  rowA[col] = (it.cls || []).join(',') || '';
                  rowB[col] = abbr;
                } else {
                  rowA[col] = abbr;
                  rowB[col] = (it.teas || []).map(t => state.teacherCfg[t]?.abbr || t).join(',');
                }
              }
            }
          }
          col++;
        }
      }
      aoa.push(rowA);
      aoa.push(rowB);
    }

    const ws = XLSX.utils.aoa_to_sheet(aoa);

    // ── マージ ──
    // 曜日ヘッダー行のマージはxlsx-js-styleの列オフセットバグで正常に動作しないため使用しない。
    // 名前・役割列（col 0, 2）の2行マージと、lead block（rows 1-2, cols 0-2）のみ設定する。
    const merges = [];
    merges.push({ s: { r: 1, c: 0 }, e: { r: 2, c: 2 } }); // lead block rows1-2, cols0-2
    for (let i = 0; i < keys.length; i++) {
      const r = dataStartRow + i * 2;
      merges.push({ s: { r, c: 0 }, e: { r: r + 1, c: 0 } }); // 名前列 2行マージ
      merges.push({ s: { r, c: 2 }, e: { r: r + 1, c: 2 } }); // 役割列 2行マージ
    }
    ws['!merges'] = merges;

    // 列幅: 4.80 wch = 55px相当（参考Excel準拠）
    const CW = 4.80;
    ws['!cols'] = Array(totalCols).fill(null).map(() => ({ wch: CW }));

    // 行高さ: 16.5pt = 22px相当
    const RH = 16.5;
    const rows = [];
    rows[0] = { hpt: RH };
    rows[1] = { hpt: RH };
    rows[2] = { hpt: RH };
    for (let i = 0; i < keys.length; i++) {
      rows[dataStartRow + i * 2]     = { hpt: RH };
      rows[dataStartRow + i * 2 + 1] = { hpt: RH };
    }
    ws['!rows'] = rows;

    // ── スタイル: 全セルに4辺の罫線を必ず設定 ──
    const ctr = { horizontal: 'center', vertical: 'center' };
    const ctrW = { horizontal: 'center', vertical: 'center', wrapText: true };
    const sz10 = { sz: 10 };

    // Row 0: タイトル（罫線なし）
    setS(ws, 0, 0, { font: { sz: 11 }, alignment: { vertical: 'center' } });

    // Rows 1-2: ヘッダー lead 3列（マージ範囲内の全セルにも罫線を設定）
    setS(ws, 1, 0, { border: bdr(T(),T(),T(),T()), alignment: ctr, font: sz10 });
    setS(ws, 2, 0, { border: bdr(T(),T(),T(),T()), alignment: ctr, font: sz10 });
    setS(ws, 1, 1, { border: bdr(T(),T(),H(),H()), alignment: ctr, font: sz10 });
    setS(ws, 2, 1, { border: bdr(T(),T(),H(),H()), alignment: ctr, font: sz10 });
    setS(ws, 1, 2, { border: bdr(T(),T(),H(),T()), alignment: ctr, font: sz10 });
    setS(ws, 2, 2, { border: bdr(T(),T(),H(),T()), alignment: ctr, font: sz10 });

    // row1-2 スロット列（マージ内部セルを含む全セルに罫線）
    for (let sc = 0; sc < DAYS.length * maxP; sc++) {
      setS(ws, 1, LEAD + sc, { border: bdr(T(),T(),slotL(sc),slotR(sc)), alignment: ctr, font: sz10 });
      setS(ws, 2, LEAD + sc, { border: bdr(T(),T(),slotL(sc),slotR(sc)), alignment: ctr, font: sz10 });
    }

    // エンティティ行
    for (let i = 0; i < keys.length; i++) {
      const rA = dataStartRow + i * 2;
      const rB = rA + 1;

      // Col A: 2行マージ
      setS(ws, rA, 0, { border: bdr(T(),T(),T(),H()), alignment: ctrW, font: sz10 });
      setS(ws, rB, 0, { border: bdr(T(),T(),T(),H()), alignment: ctrW, font: sz10 });

      // Col B
      setS(ws, rA, 1, { border: bdr(T(),H(),H(),H()), alignment: ctr, font: sz10 });
      setS(ws, rB, 1, { border: bdr(H(),T(),H(),H()), alignment: ctr, font: sz10 });

      // Col C: 2行マージ
      setS(ws, rA, 2, { border: bdr(T(),T(),H(),T()), alignment: ctr, font: sz10 });
      setS(ws, rB, 2, { border: bdr(T(),T(),H(),T()), alignment: ctr, font: sz10 });

      // スロット列: rA=上半分(top=thin,bot=hair), rB=下半分(top=hair,bot=thin)
      for (let sc = 0; sc < DAYS.length * maxP; sc++) {
        setS(ws, rA, LEAD + sc, { border: bdr(T(),H(),slotL(sc),slotR(sc)), alignment: ctrW, font: sz10 });
        setS(ws, rB, LEAD + sc, { border: bdr(H(),T(),slotL(sc),slotR(sc)), alignment: ctrW, font: sz10 });
      }
    }

    return ws;
  }

  function _ensureXLSX(cb) {
    if (typeof XLSX !== 'undefined') { cb(); return; }
    // 動的ロード: xlsx.min.js が未読込の場合にスクリプトを挿入して待つ
    const s = document.createElement('script');
    s.src = 'xlsx.min.js';
    s.onload = () => { if (typeof XLSX !== 'undefined') { cb(); } else { alert('xlsx.min.js の読み込みに失敗しました。ファイルが存在するか確認してください。'); } };
    s.onerror = () => alert('xlsx.min.js が見つかりません。リポジトリに xlsx.min.js が含まれているか確認してください。');
    document.head.appendChild(s);
  }

  function exportTeacherMatrixXLSX() {
    _ensureXLSX(() => {
      const wb = XLSX.utils.book_new();
      const ws = _buildXlsxMatrixSheet('teacher');
      XLSX.utils.book_append_sheet(wb, ws, '教員時間割');
      _xlsxDownload(wb, 'teachers_timetable.xlsx');
    });
  }

  function exportClassMatrixXLSX() {
    _ensureXLSX(() => {
      const wb = XLSX.utils.book_new();
      const ws = _buildXlsxMatrixSheet('class');
      XLSX.utils.book_append_sheet(wb, ws, 'クラス時間割');
      _xlsxDownload(wb, 'classes_timetable.xlsx');
    });
  }

  function _buildEntityTimetableSheet(kind, key, idx) {
    const adays = DAYS.filter(d => maxPeriod(d) > 0);
    const maxP = Math.max(...adays.map(d => maxPeriod(d)));

    const T = () => ({ style: 'thin', color: { rgb: '000000' } });
    const H = () => ({ style: 'hair', color: { rgb: '000000' } });
    const bdr = (t, b, l, r) => { const o = {}; if(t) o.top=t; if(b) o.bottom=b; if(l) o.left=l; if(r) o.right=r; return o; };
    const setS = (ws, r, c, s) => { const addr = XLSX.utils.encode_cell({r, c}); if(!ws[addr]) ws[addr] = {t:'s',v:''}; ws[addr].s = s; };
    const ctr = { horizontal: 'center', vertical: 'center', wrapText: true };
    const sz9 = { sz: 9 };

    const aoa = [];
    // Row 0: title
    const titleRow = Array(1 + adays.length).fill(null);
    titleRow[0] = key;
    aoa.push(titleRow);
    // Row 1: day headers
    const dayRow = Array(1 + adays.length).fill(null);
    dayRow[0] = '時限';
    adays.forEach((d, i) => { dayRow[1 + i] = {Mon:'月',Tue:'火',Wed:'水',Thu:'木',Fri:'金',Sat:'土',Sun:'日'}[d] || d; });
    aoa.push(dayRow);
    // Data rows
    for (let p = 1; p <= maxP; p++) {
      const rowA = Array(1 + adays.length).fill(null);
      const rowB = Array(1 + adays.length).fill(null);
      rowA[0] = p;
      adays.forEach((d, di) => {
        if (p > maxPeriod(d)) return;
        const ids = (kind === 'class'
          ? (idx.cls?.[key]?.[d]?.[p] || [])
          : (idx.tea?.[key]?.[d]?.[p] || [])
        ).filter(id => !isSpanFill(id, d, p));
        if (!ids.length) return;
        const it = state.items[ids[0]];
        if (!it) return;
        const scfg = state.subjectCfg[it.subjKey] || {};
        const subjAbbr = scfg.abbr || it.subj || '';
        if (kind === 'class') {
          rowA[1 + di] = subjAbbr;
          rowB[1 + di] = it.teas.map(t => state.teacherCfg[t]?.abbr || t).join(',') + (it.rooms.length ? ' ' + it.rooms.join(',') : '');
        } else {
          rowA[1 + di] = (it.cls || []).join(',');
          rowB[1 + di] = subjAbbr + (it.rooms.length ? ' ' + it.rooms.join(',') : '');
        }
      });
      aoa.push(rowA);
      aoa.push(rowB);
    }

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const totalCols = 1 + adays.length;

    ws['!cols'] = [{ wch: 5 }, ...adays.map(() => ({ wch: 10 }))];
    ws['!rows'] = aoa.map(() => ({ hpt: 14 }));

    const merges = [];
    for (let p = 0; p < maxP; p++) {
      const r = 2 + p * 2;
      merges.push({ s: {r, c: 0}, e: {r: r+1, c: 0} });
    }
    ws['!merges'] = merges;

    setS(ws, 0, 0, { font: { sz: 11, bold: true }, alignment: { vertical: 'center' } });
    for (let c = 0; c < totalCols; c++) {
      setS(ws, 1, c, { border: bdr(T(),T(),T(),T()), alignment: ctr, font: { ...sz9, bold: true } });
    }
    for (let p = 0; p < maxP; p++) {
      const rA = 2 + p * 2, rB = rA + 1;
      setS(ws, rA, 0, { border: bdr(T(),T(),T(),T()), alignment: ctr, font: sz9 });
      setS(ws, rB, 0, { border: bdr(T(),T(),T(),T()), alignment: ctr, font: sz9 });
      for (let di = 0; di < adays.length; di++) {
        const c = 1 + di;
        setS(ws, rA, c, { border: bdr(T(),H(),T(),T()), alignment: ctr, font: sz9 });
        setS(ws, rB, c, { border: bdr(H(),T(),T(),T()), alignment: ctr, font: sz9 });
      }
    }

    return ws;
  }

  // Excelのシート名は31文字以内・:\/?*[]禁止・重複不可。安全名を採番して返す
  function _uniqueSheetName(rawKey, used) {
    let base = String(rawKey || '').replace(/[:\\\/\?\*\[\]]/g, '').slice(0, 31) || 'Sheet';
    let name = base, n = 2;
    while (used.has(name)) {
      const suffix = '_' + n++;
      name = base.slice(0, 31 - suffix.length) + suffix;
    }
    used.add(name);
    return name;
  }

  function exportClassSheetsXLSX() {
    _ensureXLSX(() => {
      const idx = buildIndex();
      const keys = getAxisKeys('class');
      if (!keys.length) { flash('クラスがありません'); return; }
      const wb = XLSX.utils.book_new();
      const used = new Set();
      for (const key of keys) {
        const ws = _buildEntityTimetableSheet('class', key, idx);
        XLSX.utils.book_append_sheet(wb, ws, _uniqueSheetName(key, used));
      }
      _xlsxDownload(wb, 'classes_sheets.xlsx');
      flash(`📊 クラス別シートXLSX（${keys.length}クラス）を出力しました`);
    });
  }

  function exportTeacherSheetsXLSX() {
    _ensureXLSX(() => {
      const idx = buildIndex();
      const keys = getAxisKeys('teacher');
      if (!keys.length) { flash('教員がありません'); return; }
      const wb = XLSX.utils.book_new();
      const used = new Set();
      for (const key of keys) {
        const ws = _buildEntityTimetableSheet('teacher', key, idx);
        XLSX.utils.book_append_sheet(wb, ws, _uniqueSheetName(key, used));
      }
      _xlsxDownload(wb, 'teachers_sheets.xlsx');
      flash(`📊 教員別シートXLSX（${keys.length}名）を出力しました`);
    });
  }

  /* =======================
     Snapshots
  ======================= */
  function renderSnapshotList() {
    const sel = $('#snap-list'); if (!sel) return;
    sel.innerHTML = '';
    for (const s of state.snapshots) {
      const opt = document.createElement('option');
      opt.value = s.name;
      opt.textContent = `${s.name} (${new Date(s.savedAt).toLocaleString('ja-JP')})`;
      sel.appendChild(opt);
    }
  }
  function saveSnapshot(name) {
    name = (name || '').trim() || `Snapshot ${state.snapshots.length + 1}`;
    pushHistory('snapSave');
    const data = { placements: deepClone(state.placements) };
    const snap = { name, savedAt: now(), data };
    // overwrite if same name
    const i = state.snapshots.findIndex(x => x.name === name);
    if (i >= 0) state.snapshots[i] = snap; else state.snapshots.push(snap);
    markDirty('snapshot');
    renderSnapshotList();
    flash('保存しました');
  }
  function loadSnapshot(name) {
    const snap = state.snapshots.find(x => x.name === name);
    if (!snap) { flash('見つかりません'); return; }
    pushHistory('snapLoad');
    state.placements = deepClone(snap.data.placements);
    // restore locked flags if missing
    for (const id in state.items) {
      if (!state.placements[id]) state.placements[id] = null;
      if (state.placements[id] && state.placements[id].locked == null) state.placements[id].locked = false;
    }
    state.ui.selectedId = null;
    markDirty('snapshot');
    rerenderAll();
    broadcastState();
  }
  function deleteSnapshot(name) {
    pushHistory('snapDel');
    state.snapshots = state.snapshots.filter(x => x.name !== name);
    markDirty('snapshot');
    renderSnapshotList();
  }

  /* v47-B4: スナップショット差分表示 */
  let _snapDiffActive = false;
  let _snapDiffData = null; // {name, placements}

  function showSnapDiff(name) {
    const snap = state.snapshots.find(x => x.name === name);
    if (!snap) { flash('スナップが見つかりません'); return; }
    _snapDiffActive = true;
    _snapDiffData = { name, placements: snap.data.placements };
    const banner = document.getElementById('snap-diff-banner');
    const label = document.getElementById('snap-diff-label');
    if (banner) banner.style.display = 'flex';
    if (label) label.textContent = `差分表示中: 「${name}」との比較 — 青:移動後 橙:移動元(スナップ時)`;
    rerenderAll();
    flash(`「${name}」との差分をグリッドにハイライト`);
  }

  function hideSnapDiff() {
    _snapDiffActive = false;
    _snapDiffData = null;
    const banner = document.getElementById('snap-diff-banner');
    if (banner) banner.style.display = 'none';
    rerenderAll();
  }

  // v48: スナップ差分テキストレポート生成
  function showSnapDiffReport() {
    if (!_snapDiffData) { flash('差分表示モードで実行してください'); return; }
    const oldPlc = _snapDiffData.placements;
    const newPlc = state.placements;
    const allIds = new Set([...Object.keys(oldPlc), ...Object.keys(newPlc)]);

    const lines = [];
    const added = [], removed = [], moved = [], unchanged = [];

    for (const id of allIds) {
      const it = state.items[id]; if (!it) continue;
      const scfg = state.subjectCfg[it.subjKey] || {};
      const name = `「${scfg.abbr || it.subj}」${it.cls.join(',')}`;
      const cur = newPlc[id];
      const old2 = oldPlc[id];
      const curStr = cur?.day ? `${DAYJP[cur.day]}${cur.period}${it.span === 2 ? `-${cur.period + 1}` : ''}` : null;
      const oldStr = old2?.day ? `${DAYJP[old2.day]}${old2.period}${it.span === 2 ? `-${old2.period + 1}` : ''}` : null;
      if (curStr === oldStr) continue;
      if (curStr && !oldStr) added.push(`  + ${name}  →  ${curStr} に新規配置`);
      else if (!curStr && oldStr) removed.push(`  - ${name}  ${oldStr} → 在庫に戻す`);
      else moved.push(`  ↔ ${name}  ${oldStr} → ${curStr}`);
    }

    if (!added.length && !removed.length && !moved.length) {
      showModal('差分なし', `「${_snapDiffData.name}」と現在の配置に変化はありません。`);
      return;
    }

    lines.push(`=== 差分レポート: 「${_snapDiffData.name}」との比較 ===`);
    lines.push(`作成日時: ${new Date().toLocaleString('ja-JP')}`);
    lines.push('');
    if (moved.length) { lines.push(`【移動】 ${moved.length}件`); lines.push(...moved); lines.push(''); }
    if (added.length) { lines.push(`【新規配置】 ${added.length}件`); lines.push(...added); lines.push(''); }
    if (removed.length) { lines.push(`【在庫戻し】 ${removed.length}件`); lines.push(...removed); lines.push(''); }
    lines.push(`合計変更: ${moved.length + added.length + removed.length}件`);

    const text = lines.join('\n');
    const html = `
    <div style="display:flex;flex-direction:column;gap:8px">
      <div class="muted small">変更: 移動${moved.length}件 / 新規${added.length}件 / 在庫戻し${removed.length}件</div>
      <textarea style="width:100%;height:300px;font-family:monospace;font-size:12px;border:1px solid #e2e8f0;border-radius:8px;padding:8px" readonly>${escapeHtml(text)}</textarea>
      <button class="btn secondary" onclick="this.previousElementSibling.select();document.execCommand('copy');this.textContent='✅ コピーしました'">📋 クリップボードにコピー</button>
    </div>`;
    showModalHTML('📋 差分レポート', html, null, '閉じる', '閉じる');
  }

  // 差分情報を取得（レンダリング時に参照）
  function getSnapDiffForId(id) {
    if (!_snapDiffActive || !_snapDiffData) return null;
    const cur = state.placements[id];
    const old = _snapDiffData.placements[id];
    const curStr = cur?.day ? `${cur.day}-${cur.period}` : null;
    const oldStr = old?.day ? `${old.day}-${old.period}` : null;
    if (curStr === oldStr) return null; // 変化なし
    if (curStr && !oldStr) return 'diff-added';      // 新しく配置された
    if (!curStr && oldStr) return 'diff-removed';    // 在庫に戻った
    return 'diff-moved';                            // 別の場所に移動
  }

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
    let gap = 0, balance = 0;
    for (const day in byDay) {
      const ps = byDay[day];
      balance += ps.size * ps.size;
      if (ps.size < 2) continue;
      let mn = Infinity, mx = -Infinity;
      for (const p of ps) { if (p < mn) mn = p; if (p > mx) mx = p; }
      gap += (mx - mn + 1) - ps.size;
    }
    return { gap, balance };
  }

  // 1クラス分のソフト指標（bias/consec/noSameDay）の生値を算出。
  // 全体のソフト指標はクラス単位で完全に分解できるため、これを合算すると
  // softMetricsFromPlacements と一致する（差分評価との整合を保証）。
  function classSoftContribution(placements, c, ids) {
    const deptOf = (id) => (state.subjectCfg[state.items[id]?.subjKey]?.dept) || '';
    const deptAgg = {};   // dept -> {sum, cnt}
    const cell = {};      // day -> period -> 先頭item id
    const noSame = {};    // `c|subjKey|day` -> count
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
    return { bias, consec, noSameDay };
  }

  function softMetricsFromPlacements(placements, optBalance = true, optNoConsec = true) {
    const itemsByClass = getItemsByClass();
    let bias = 0, consec = 0, noSameDayPenalty = 0;
    for (const c in itemsByClass) {
      const r = classSoftContribution(placements, c, itemsByClass[c]);
      bias += r.bias; consec += r.consec; noSameDayPenalty += r.noSameDay;
    }
    let teaGap = 0, teaBal = 0;
    const gapOn = aiMinGapOn(), balOn = aiBalanceLoadOn();
    if (gapOn || balOn) {
      const itemsByTea = getItemsByTeacher();
      for (const t in itemsByTea) { const r = teacherSoftContribution(placements, t, itemsByTea[t]); teaGap += r.gap; teaBal += r.balance; }
    }
    const score = (optBalance ? bias : 0) + (optNoConsec ? consec * 4 : 0) + noSameDayPenalty
      + (gapOn ? teaGap * TEACHER_GAP_W : 0) + (balOn ? teaBal * TEACHER_BAL_W : 0);
    return { bias, consec, noSameDayPenalty, teaGap, teaBal, score };
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
    const _teaOn = _gapOn || _balOn;
    const _scBias = {}, _scConsec = {}, _scNoSame = {}, _scGap = {}, _scBal = {};
    let _biasT = 0, _consecT = 0, _noSameT = 0, _gapT = 0, _balT = 0;
    function _initSoftCaches() {
      _biasT = 0; _consecT = 0; _noSameT = 0; _gapT = 0; _balT = 0;
      for (const c in _itemsByClass) {
        const r = classSoftContribution(placements, c, _itemsByClass[c]);
        _scBias[c] = r.bias; _scConsec[c] = r.consec; _scNoSame[c] = r.noSameDay;
        _biasT += r.bias; _consecT += r.consec; _noSameT += r.noSameDay;
      }
      if (_teaOn) for (const t in _itemsByTea) { const r = teacherSoftContribution(placements, t, _itemsByTea[t]); _scGap[t] = r.gap; _scBal[t] = r.balance; _gapT += r.gap; _balT += r.balance; }
    }
    function _flaggedSoft() {
      return (optBalance ? _biasT : 0) + (optNoConsec ? _consecT * 4 : 0) + _noSameT
        + (_gapOn ? _gapT * TEACHER_GAP_W : 0) + (_balOn ? _balT * TEACHER_BAL_W : 0);
    }
    function _updateSoftForClasses(classes) {
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
      let dG = 0, dBal = 0;
      if (_teaOn) {
        const affTea = new Set([..._teaOf(id), ...(swapId ? _teaOf(swapId) : [])]);
        for (const t of affTea) { const r = teacherSoftContribution(placements, t, _itemsByTea[t] || []); dG += r.gap - (_scGap[t] || 0); dBal += r.balance - (_scBal[t] || 0); }
      }
      const newSoft = _flaggedSoft() + (optBalance ? dB : 0) + (optNoConsec ? dC * 4 : 0) + dN
        + (_gapOn ? dG * TEACHER_GAP_W : 0) + (_balOn ? dBal * TEACHER_BAL_W : 0);
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

  function computeSuggestionPackAsync(id, onDone) {
    // 既存のバッチをキャンセル
    if (_sugBatchId) { cancelIdleCallback ? _sugBatchId : clearTimeout(_sugBatchId); _sugBatchId = null; }

    const doCompute = () => {
      try {
        const pack = computeSuggestionPack(id);
        onDone(pack, null);
      } catch (e) {
        onDone(null, e);
      }
      _sugBatchId = null;
    };

    if (typeof requestIdleCallback === 'function') {
      _sugBatchId = requestIdleCallback(doCompute, { timeout: 800 });
    } else {
      _sugBatchId = setTimeout(doCompute, 0);
    }
  }


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

  function buildPopoutHTML(kind) {
    const css = document.querySelector('link[rel="stylesheet"]')?.href || 'style.css';
    return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Popout ${kind}</title>
  <link rel="stylesheet" href="${css}">
  <style>
    body{height:auto;overflow:auto}
    .pop-wrap{padding:10px;display:flex;flex-direction:column;gap:10px}
    .pop-top{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
    .pop-top .sel{min-width:240px}
    .pop-grid{background:#fff;border:1px solid #cbd5e1;border-radius:12px;padding:10px;overflow:auto}
    .pop-stock{display:grid;grid-template-columns:minmax(320px,380px) 1fr;gap:10px;min-height:420px}
    .pop-stock .stock-list{height:calc(100vh - 200px)}
    .t2{width:100%;border-collapse:collapse;table-layout:auto;font-size:12px}
    .t2 th,.t2 td{border:1px solid #94a3b8;text-align:center;padding:0}
    .t2 th{background:#e2e8f0;height:30px;position:sticky;top:0;z-index:2;font-weight:1000}
    .t2 td{height:46px}
    .t2 td.selected{outline:3px solid rgba(37,99,235,.8);outline-offset:-3px}
  </style>
</head><body class="theme">
<div class="pop-wrap">
  <div class="pop-top">
    <strong>${kind === 'teacher' ? '教員' : kind === 'class' ? 'クラス' : kind === 'room' ? '教室' : '在庫'}</strong>
    ${kind === 'stock' ? '' : `<select id="target" class="sel"></select>`}
    <label class="chk"><input type="checkbox" id="swap">入替</label>
    <button class="btn secondary" id="clearSel">選択解除</button>
    <button class="btn secondary" id="req">再同期</button>
    <span class="muted small" id="info"></span>
  </div>
  <div id="main"></div>
</div>
<script>
(() => {
  const DAYS=${JSON.stringify(DAYS)};
  const DAYJP=${JSON.stringify(DAYJP)};
  const BC_NAME=${JSON.stringify(BC_NAME)};
  let bc=null; try{ bc = new BroadcastChannel(BC_NAME); }catch(e){}
  const hasOpener = !!window.opener;
  function send(msg){ try{ bc && bc.postMessage(msg); }catch(e){}; try{ hasOpener && window.opener.postMessage(msg,'*'); }catch(e){} }
  let data = {placements:{}, items:{}, subjectCfg:{}, teacherCfg:{}, settings:{}};
  let selectedId = null;

  function maxPeriod(day){ return data.settings?.periodsByDay?.[day]||6; }
  function isDark(hex){ try{
    const m=hex.replace('#',''); const r=parseInt(m.slice(0,2),16), g=parseInt(m.slice(2,4),16), b=parseInt(m.slice(4,6),16);
    const lum=(0.2126*r+0.7152*g+0.0722*b)/255; return lum<0.55;
  }catch(e){ return false; } }
  function pickColor(key){
    const pal=${JSON.stringify(PALETTE)};
    let h=2166136261>>>0; for(let i=0;i<key.length;i++){ h^=key.charCodeAt(i); h=(h*16777619)>>>0; }
    return pal[h%pal.length];
  }
  function abbrSubj(subjKey, subj){
    return (data.subjectCfg?.[subjKey]?.abbr)||subj||'';
  }
  function abbrTea(t){
    return (data.teacherCfg?.[t]?.abbr)||t||'';
  }
  function idCovers(id, day, p){
    const plc = data.placements[id]; if(!plc) return false;
    const it = data.items[id]; if(!it) return false;
    if(plc.day!==day) return false;
    return p>=plc.period && p<plc.period+(it.span||1);
  }
  function isSpanFill(id,day,p){
    const plc=data.placements[id]; const it=data.items[id];
    return plc && it && it.span===2 && plc.day===day && p===plc.period+1;
  }
  let __idxCache = null;
function invalidateIndex(){ __idxCache = null; }

function buildIndex(){
  if(__idxCache) return __idxCache;
    const idx={tea:{},cls:{},room:{}};
    for(const id in data.items){
      const it=data.items[id]; const plc=data.placements[id]; if(!plc) continue;
      for(let dp=0;dp<(it.span||1);dp++){
        const day=plc.day; const p=plc.period+dp;
        (it.teas?.length?it.teas:['(未)']).forEach(t=>{ idx.tea[t]??={}; idx.tea[t][day]??={}; (idx.tea[t][day][p]??=[]).push(id);});
        (it.cls||[]).forEach(c=>{ idx.cls[c]??={}; idx.cls[c][day]??={}; (idx.cls[c][day][p]??=[]).push(id);});
        (it.rooms?.length?it.rooms:['(未)']).forEach(r=>{ idx.room[r]??={}; idx.room[r][day]??={}; (idx.room[r][day][p]??=[]).push(id);});
      }
    }
    return idx;
  }

  function render(){
    const main=document.getElementById('main');
    const KIND=${JSON.stringify(kind)};
    if(KIND==='stock'){
      main.innerHTML = \`
        <div class="pop-stock">
          <div class="panel stock">
            <div class="panel-head">
              <div class="row"><strong>在庫</strong><span class="muted">（未配置）</span></div>
              <input id="s" class="search" placeholder="検索">
            </div>
            <div id="list" class="stock-list"></div>
          </div>
          <div class="pop-grid">
            <div class="muted small" style="margin-bottom:8px;">在庫を選択/ドラッグ → 右の表で配置（クリック/ドロップ）。Delで在庫へ。</div>
            <div id="grid"></div>
          </div>
        </div>\`;
      renderStockPop();
      return;
    }
    if(KIND==='teacher' || KIND==='class'){
      main.innerHTML = \`
        <div class="pop-stock">
          <div class="panel stock">
            <div class="panel-head">
              <div class="row"><strong>在庫</strong><span class="muted">（この対象）</span></div>
              <input id="s" class="search" placeholder="検索">
            </div>
            <div id="list" class="stock-list"></div>
          </div>
          <div class="pop-grid">
            <div class="muted small" style="margin-bottom:8px;">左は「この教員/クラスの未配置在庫」。選択/ドラッグして配置できます。</div>
            <div id="grid"></div>
          </div>
        </div>\`;
      renderTargetSelect();
      renderTargetGrid();
      renderScopedStock();
      document.getElementById('s').oninput=()=>{ renderScopedStock(); };
      return;
    }
    main.innerHTML = \`<div class="pop-grid"><div id="grid"></div></div>\`;
    renderTargetSelect();
    renderTargetGrid();
  }

  function renderTargetSelect(){
    const sel=document.getElementById('target');
    const kind=${JSON.stringify(kind)};
    const set=new Set();
    for(const id in data.items){
      const it=data.items[id];
      if(kind==='teacher') (it.teas?.length?it.teas:['(未)']).forEach(x=>set.add(x));
      if(kind==='class') (it.cls||[]).forEach(x=>set.add(x));
      if(kind==='room') (it.rooms?.length?it.rooms:['(未)']).forEach(x=>set.add(x));
    }
    const keys=[...set].sort((a,b)=>a.localeCompare(b,'ja'));
    const prev=sel.value;
    sel.innerHTML = keys.map(k=>\`<option value="\${k}">\${k}</option>\`).join('');
    if(prev && keys.includes(prev)) sel.value=prev;
    sel.onchange=()=>{ renderTargetGrid(); try{ renderScopedStock(); }catch(e){} };
  }

  function idsForCell(kind,target,day,p,idx){
    if(kind==='teacher') return (idx.tea?.[target]?.[day]?.[p]||[]);
    if(kind==='class') return (idx.cls?.[target]?.[day]?.[p]||[]);
    if(kind==='room') return (idx.room?.[target]?.[day]?.[p]||[]);
    return [];
  }

  function renderTargetGrid(){
    const kind=${JSON.stringify(kind)};
    const target=document.getElementById('target').value;
    const grid=document.getElementById('grid');
    const idx=buildIndex();
    const maxP = Math.max(...DAYS.map(d=>maxPeriod(d)));
    let html=\`<table class="t2"><thead><tr><th>時限</th>\${DAYS.map(d=>\`<th>\${DAYJP[d]}</th>\`).join('')}</tr></thead><tbody>\`;
    for(let p=1;p<=maxP;p++){
      html+=\`<tr><th>\${p}</th>\`;
      for(const d of DAYS){
        const disabled = p>maxPeriod(d);
        html+=\`<td data-day="\${d}" data-p="\${p}" class="\${disabled?'forbidden':''}"></td>\`;
      }
      html+='</tr>';
    }
    html+='</tbody></table>';
    grid.innerHTML=html;

    grid.querySelectorAll('td[data-day]').forEach(td=>{
      const day=td.dataset.day; const p=parseInt(td.dataset.p,10);
      if(p>maxPeriod(day)) return;
      const ids = [...new Set(idsForCell(kind,target,day,p,idx))];
      if(ids.some(id=>isSpanFill(id,day,p))) td.classList.add('spanfill');
      const wrap=document.createElement('div'); wrap.className='cell-stack';
      ids.forEach(id=>{
        if(isSpanFill(id,day,p)) return;
        const it=data.items[id]; const plc=data.placements[id];
        const sc=data.subjectCfg[it.subjKey]||{};
        const col=sc.color||pickColor(it.subjKey);
        const ab=abbrSubj(it.subjKey,it.subj);
        const tea=(it.teas||[]).map(abbrTea).join(',');
        const cls=(it.cls||[]).join(',');
        const room=(it.rooms||[]).join(',');
        let right = (kind==='teacher')?cls:(kind==='class')?tea:cls;
        let bottom = (kind==='room')?tea:room;
        const card=document.createElement('div');
        card.className='lesson'+(selectedId===id?' sel':'')+((data.placements[id]&&data.placements[id].locked)?' locked':'');
        card.style.background=col; card.style.color=isDark(col)?'#fff':'#0f172a';
        card.innerHTML=\`
          <div class="l1"><div class="subj">\${ab}</div>\${it.span===2?'<span class="badge2">2連</span>':''}<div class="rightlab">\${right}</div></div>
          <div class="l2"><div class="teacher">\${tea}</div><div class="roommini">\${bottom}</div></div>\`;
        card.draggable=true;
        card.ondragstart=(ev)=>{ selectedId=id; ev.dataTransfer.setData('text/plain', id); document.getElementById('info').textContent='ドラッグ: '+ab; };
        card.onclick=(ev)=>{ ev.stopPropagation(); selectedId=id; renderTargetGrid(); document.getElementById('info').textContent='選択: '+ab+' / '+right; };
        wrap.appendChild(card);
      });
      td.appendChild(wrap);
      td.ondragover=(ev)=>{ 
        ev.preventDefault();
        const draggedId = ev.dataTransfer.getData('text/plain') || selectedId;
        if (day && p && draggedId && typeof showHoverSuggestion === 'function') {
          showHoverSuggestion(draggedId, day, p);
        }
      };
      td.ondrop=(ev)=>{
        ev.preventDefault();
        if (typeof clearHoverSuggestion === 'function') {
          clearHoverSuggestion();
        }
        const did = ev.dataTransfer.getData('text/plain') || selectedId;
        if(!did) return;
        const swap=document.getElementById('swap').checked;
        send({type:'action', action:{kind:'MOVE', id:did, day, period:p, mode: swap?'swap':'safe'}});
        setTimeout(()=>send({type:'req'}), 50);
      };
      td.oncontextmenu=(ev)=>{
        ev.preventDefault();
        const ids = [...new Set(idsForCell(kind,target,day,p,idx))].filter(x=>!isSpanFill(x,day,p));
        const any = ids[0];
        if(any) send({type:'action', action:{kind:'STOCK', id:any}});
        setTimeout(()=>send({type:'req'}), 50);
      };
      td.ondragover=(ev)=>{ ev.preventDefault(); };
      td.ondrop=(ev)=>{ ev.preventDefault(); const did=ev.dataTransfer.getData('text/plain')||selectedId; if(!did) return; const swap=document.getElementById('swap').checked; send({type:'action', action:{kind:'MOVE', id:did, day, period:p, mode: swap?'swap':'safe'}});
        setTimeout(()=>send({type:'req'}), 50); };
      td.onclick=()=>{
        if(!selectedId) return;
        const swap=document.getElementById('swap').checked;
        send({type:'action', action:{kind:'MOVE', id:selectedId, day, period:p, mode: swap?'swap':'safe'}});
        setTimeout(()=>send({type:'req'}), 50);
      };
    });
  }


  function renderScopedStock(){
    const KIND=${JSON.stringify(kind)};
    const list=document.getElementById('list'); if(!list) return;
    const sel=document.getElementById('target'); const target=sel?sel.value:'';
    const q=(document.getElementById('s')?.value||'').trim();
    if(!(KIND==='teacher' || KIND==='class')){ list.innerHTML=''; return; }
    const ids = Object.keys(data.items).filter(id=>!data.placements[id]).filter(id=>{
      const it=data.items[id];
      if(KIND==='teacher'){
        if(!(it.teas||[]).includes(target)) return false;
      }else{
        if(!(it.cls||[]).includes(target)) return false;
      }
      if(!q) return true;
      const blob=(it.subj+' '+(it.cls||[]).join(' ')+' '+(it.teas||[]).join(' ')+' '+(it.rooms||[]).join(' '));
      return blob.includes(q);
    });
    list.innerHTML='';
    if(!ids.length){
      list.innerHTML='<div class="muted small" style="padding:10px;">(在庫なし)</div>';
      return;
    }
    ids.forEach(id=>{
      const it=data.items[id];
      const sc=data.subjectCfg[it.subjKey]||{};
      const col=sc.color||pickColor(it.subjKey);
      const ab=abbrSubj(it.subjKey,it.subj);
      const tea=(it.teas||[]).map(abbrTea).join(',');
      const cls=(it.cls||[]).join(',');
      const el=document.createElement('div');
      el.className='stock-item' + (state.ui.selectedId===id?' selected':'');
      el.style.borderLeft='10px solid '+col;
      el.innerHTML=
        '<div class="line1"><span class="sub">'+ab+'</span><span class="right">未配置</span></div>'+
        '<div class="meta"><span class="chip">'+(KIND==='teacher'?cls:tea)+'</span>'+(it.span===2?'<span class="chip">2連</span>':'')+'</div>';
      el.draggable=true;
      el.ondragstart=(ev)=>{ selectedId=id; ev.dataTransfer.setData('id', id); document.getElementById('info').textContent='ドラッグ: '+ab; };
      el.onclick=()=>{ selectedId=id; renderScopedStock(); document.getElementById('info').textContent='選択: '+ab; };
      if(selectedId===id) el.style.outline='3px solid rgba(37,99,235,.7)';
      list.appendChild(el);
    });
  }

  function renderStockPop(){
    const list=document.getElementById('list');
    const q=(document.getElementById('s').value||'').trim();
    const ids = Object.keys(data.items).filter(id=>!data.placements[id]).filter(id=>{
      if(!q) return true;
      const it=data.items[id];
      const blob=\`\${it.subj} \${(it.cls||[]).join(' ')} \${(it.teas||[]).join(' ')} \${(it.rooms||[]).join(' ')}\`;
      return blob.includes(q);
    });
    list.innerHTML='';
    ids.forEach(id=>{
      const it=data.items[id];
      const sc=data.subjectCfg[it.subjKey]||{};
      const col=sc.color||pickColor(it.subjKey);
      const ab=abbrSubj(it.subjKey,it.subj);
      const tea=(it.teas||[]).map(abbrTea).join(',');
      const cls=(it.cls||[]).join(',');
      const el=document.createElement('div');
      el.className='stock-item' + (state.ui.selectedId===id?' selected':'');
      el.style.borderLeft='10px solid '+col;
      el.innerHTML=\`
        <div class="line1"><span class="sub">\${ab}</span><span class="right">未配置</span></div>
        <div class="meta"><span class="chip">\${cls}</span>\${tea?'<span class="chip">'+tea+'</span>':''}\${it.span===2?'<span class="chip">2連</span>':''}</div>\`;
      el.onclick=()=>{ selectedId=id; renderStockPop(); document.getElementById('info').textContent='選択: '+ab; };
      if(selectedId===id) el.style.outline='3px solid rgba(37,99,235,.7)';
      list.appendChild(el);
    });
    renderStockGrid();
    document.getElementById('s').oninput=()=>renderStockPop();
  }

  function renderStockGrid(){
    const grid=document.getElementById('grid');
    const maxP=Math.max(...DAYS.map(d=>maxPeriod(d)));
    let html=\`<table class="t2"><thead><tr><th>時限</th>\${DAYS.map(d=>\`<th>\${DAYJP[d]}</th>\`).join('')}</tr></thead><tbody>\`;
    for(let p=1;p<=maxP;p++){
      html+=\`<tr><th>\${p}</th>\`;
      for(const d of DAYS){
        const disabled=p>maxPeriod(d);
        html+=\`<td data-day="\${d}" data-p="\${p}" class="\${disabled?'forbidden':''}"></td>\`;
      }
      html+='</tr>';
    }
    html+='</tbody></table>';
    grid.innerHTML=html;
    grid.querySelectorAll('td[data-day]').forEach(td=>{
      const day=td.dataset.day; const p=parseInt(td.dataset.p,10);
      if(p>maxPeriod(day)) return;
      td.ondragover=(ev)=>{ 
        ev.preventDefault();
        const draggedId = ev.dataTransfer.getData('text/plain') || selectedId;
        if (day && p && draggedId && typeof showHoverSuggestion === 'function') {
          showHoverSuggestion(draggedId, day, p);
        }
      };
      td.ondrop=(ev)=>{
        ev.preventDefault();
        if (typeof clearHoverSuggestion === 'function') {
          clearHoverSuggestion();
        }
        const did = ev.dataTransfer.getData('text/plain') || selectedId;
        if(!did) return;
        const swap=document.getElementById('swap').checked;
        send({type:'action', action:{kind:'MOVE', id:did, day, period:p, mode: swap?'swap':'safe'}});
        setTimeout(()=>send({type:'req'}), 50);
      };
      td.oncontextmenu=(ev)=>{
        ev.preventDefault();
        const ids = [...new Set(idsForCell(kind,target,day,p,idx))].filter(x=>!isSpanFill(x,day,p));
        const any = ids[0];
        if(any) send({type:'action', action:{kind:'STOCK', id:any}});
        setTimeout(()=>send({type:'req'}), 50);
      };
      td.onclick=()=>{
        if(!selectedId) return;
        const swap=document.getElementById('swap').checked;
        send({type:'action', action:{kind:'MOVE', id:selectedId, day, period:p, mode: swap?'swap':'safe'}});
        setTimeout(()=>send({type:'req'}), 50);
      };
    });
  }

  // receive updates
  function onMsg(msg){
    msg = msg||{};
    if(msg.type==='state' && msg.data){
      data = {...data, ...msg.data};
      render();
    }
  }
  if(bc){ bc.onmessage=(ev)=>onMsg(ev.data||{}); }
  window.addEventListener('message',(ev)=>onMsg(ev.data||{}));

  document.getElementById('clearSel').onclick=()=>{ selectedId=null; document.getElementById('info').textContent=''; render(); };
  document.getElementById('req').onclick=()=>send({type:'req'});
  render();
  send({type:'req'});
})();
</script>
</body></html>`;
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
        const ids = idsInCellForRow(kind, key, d, p, idx).filter(id => !isSpanFill(id, d, p));
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
     Splitters
  ======================= */
  /* =======================
  /* =======================
     教員一覧 / クラス一覧ウィンドウ (v45)
     縦=時限、横=曜日（月～金）
     ドラッグ&ドロップ対応
  ======================= */
  function openAllTeachersWindow() {
    _openAllItemsWindow('teacher');
  }
  function openAllClassesWindow() {
    _openAllItemsWindow('class');
  }

  function _openAllItemsWindow(kind) {
    const existId = `__all_${kind}__`;
    const layer = document.getElementById('float-layer');
    if (!layer) return;
    const existing = layer.querySelector(`[data-id="${CSS.escape(existId)}"]`);
    if (existing) { existing.remove(); return; }

    const keys = getAxisKeys(kind);
    if (!keys.length) { flash(kind === 'teacher' ? '教員データなし' : 'クラスデータなし'); return; }

    const title = kind === 'teacher' ? '👥 教員一覧' : '🏫 クラス一覧';
    const searchPlaceholder = kind === 'teacher' ? '教員名で絞り込み…' : 'クラス名で絞り込み…';
    const el = document.createElement('div');
    el.className = 'float-win atw-win';
    el.dataset.id = existId;
    el.style.cssText = `left:20px;top:20px;width:${Math.min(window.innerWidth - 40, 1400)}px;height:${Math.min(window.innerHeight - 60, 720)}px;z-index:9990;position:fixed`;
    el.innerHTML = `
    <div class="float-head atw-head" data-handle="1">
      <span class="title">${title}</span>
      <span class="atw-count muted small"></span>
      <div class="spacer"></div>
      <input class="atw-search" placeholder="${searchPlaceholder}">
      <button class="btn secondary" data-act="close-atw">×</button>
    </div>
    <div class="atw-tiles" data-kind="${kind}"></div>
    <div class="float-resize-handle"></div>
  `;
    layer.appendChild(el);
    _atwBind(el, existId, kind, keys);
  }

  function _atwBind(el, existId, kind, keys) {
    const tilesEl = el.querySelector('.atw-tiles');

    // ウィンドウドラッグ
    const head = el.querySelector('[data-handle]');
    if (head) {
      let sx, sy, sl, st;
      head.onmousedown = (e) => {
        if (e.target.closest('button,input')) return;
        sx = e.clientX; sy = e.clientY;
        const r = el.getBoundingClientRect(); sl = r.left; st = r.top;
        el.style.left = sl + 'px'; el.style.top = st + 'px'; el.style.transform = 'none';
        const onM = (e2) => { el.style.left = Math.max(0, sl + (e2.clientX - sx)) + 'px'; el.style.top = Math.max(0, st + (e2.clientY - sy)) + 'px'; };
        const onU = () => { document.removeEventListener('mousemove', onM); document.removeEventListener('mouseup', onU); };
        document.addEventListener('mousemove', onM); document.addEventListener('mouseup', onU);
      };
    }
    el.querySelector('[data-act="close-atw"]').onclick = () => el.remove();

    // 検索
    el.querySelector('.atw-search').oninput = (e) => {
      const q = e.target.value.toLowerCase();
      el.querySelectorAll('.atw-block').forEach(b => {
        const key = b.dataset.key || '';
        const abbr = kind === 'teacher' ? (state.teacherCfg[key]?.abbr || key).toLowerCase() : key.toLowerCase();
        b.style.display = (!q || key.toLowerCase().includes(q) || abbr.includes(q)) ? '' : 'none';
      });
    };

    // 描画
    _atwRender(el, tilesEl, kind, keys);
  }

  function _atwRender(el, tilesEl, kind, keys) {
    const idx = buildIndex();
    const maxP = Math.max(...DAYS.map(d => maxPeriod(d)));

    function buildMini(key) {
      const labelAbbr = kind === 'teacher' ? (state.teacherCfg[key]?.abbr || key) : key;
      // 時限数カウント
      let total = 0;
      for (const d of DAYS) for (let p = 1; p <= maxPeriod(d); p++) {
        const ids = kind === 'teacher'
          ? (idx.tea?.[key]?.[d]?.[p] || []).filter(x => !isSpanFill(x, d, p))
          : (idx.cls?.[key]?.[d]?.[p] || []).filter(x => !isSpanFill(x, d, p));
        total += ids.length;
      }

      // テーブル構築: 縦=時限, 横=曜日
      const dayHeaders = DAYS.map(d => `<th class="atw-th-day">${DAYJP[d]}</th>`).join('');
      let rows = '';
      for (let p = 1; p <= maxP; p++) {
        rows += `<tr><th class="atw-th-p">${p}</th>`;
        for (const d of DAYS) {
          if (p > maxPeriod(d)) { rows += `<td class="atw-forb"></td>`; continue; }
          const ids = kind === 'teacher'
            ? (idx.tea?.[key]?.[d]?.[p] || []).filter(x => !isSpanFill(x, d, p))
            : (idx.cls?.[key]?.[d]?.[p] || []).filter(x => !isSpanFill(x, d, p));
          if (!ids.length) {
            rows += `<td class="atw-cell" data-day="${d}" data-p="${p}"></td>`; continue;
          }
          const cards = ids.map(id => {
            const it = state.items[id]; if (!it) return '';
            const scfg = state.subjectCfg[it.subjKey] || {};
            const color = scfg.color || pickColor(it.subjKey);
            const subjAbbr = (scfg.abbr || it.subj || it.subjKey).slice(0, 6);
            const sub = kind === 'teacher' ? (it.cls || []).join(',').slice(0, 6) : (state.teacherCfg[(it.teas || [])[0]]?.abbr || (it.teas || [])[0] || '').slice(0, 5);
            const bg = hexWithAlpha(color, 0.8);
            const fg = isDark(color) ? '#fff' : '#0f172a';
            const plc = state.placements[id];
            const locked = plc?.locked ? ' atw-locked' : '';
            return `<div class="atw-card${locked}" draggable="true" data-id="${escapeAttr(id)}"
            style="background:${bg};color:${fg}"
            title="${escapeHtml(subjAbbr)} ${escapeHtml(sub)}">
            ${escapeHtml(subjAbbr)}<div class="atw-cls">${escapeHtml(sub)}</div>
          </div>`;
          }).join('');
          rows += `<td class="atw-cell" data-day="${d}" data-p="${p}">${cards}</td>`;
        }
        rows += `</tr>`;
      }

      return `<div class="atw-block" data-key="${escapeAttr(key)}" data-kind="${kind}">
      <div class="atw-name" title="ダブルクリックで個人窓 / ${labelAbbr}">
        ${escapeHtml(labelAbbr)}<span class="atw-cnt">${total}</span>
      </div>
      <div class="atw-scroll">
        <table class="atw-table">
          <thead><tr><th class="atw-th-blank"></th>${dayHeaders}</tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
    }

    tilesEl.innerHTML = keys.map(buildMini).join('');
    const countEl = el.querySelector('.atw-count');
    if (countEl) countEl.textContent = `${keys.length}${kind === 'teacher' ? '名' : 'クラス'}`;

    // --- ダブルクリックで個人窓 ---
    tilesEl.querySelectorAll('.atw-name').forEach(nm => {
      nm.ondblclick = () => {
        const b = nm.closest('.atw-block');
        if (!b) return;
        openFloat(b.dataset.kind, b.dataset.key);
        rerenderAll();
      };
    });

    // --- ドラッグ開始 (カードから) ---
    tilesEl.querySelectorAll('.atw-card[draggable]').forEach(card => {
      card.ondragstart = (e) => {
        const id = card.dataset.id;
        window._currentDragId = id;
        window._dragPending = true;
        e.dataTransfer.setData('text/plain', id);
        try { e.dataTransfer.setData('id', id); } catch { }
        e.dataTransfer.effectAllowed = 'move';
        // ★Fix5: 元のコマ（配置済みの場合）をフェードアウト表示
        const plc = state.placements[id];
        if (plc) {
          // 同じ一覧内の元コマのセルをハイライト
          const fromCell = tilesEl.querySelector(`td.atw-cell[data-day="${plc.day}"][data-p="${plc.period}"]`);
          if (fromCell) {
            fromCell.classList.add('atw-drag-from');
            // どのブロックから出発したかも表示
            const block = card.closest('.atw-block');
            if (block) block.classList.add('atw-dragging-from');
          }
        }
        card.style.opacity = '0.45';
      };
      card.ondragend = () => {
        window._dragPending = false;
        setTimeout(() => { if (!window._dragPending) window._currentDragId = null; }, 100);
        card.style.opacity = '';
        tilesEl.querySelectorAll('.atw-drag-from,.atw-dragging-from').forEach(x => {
          x.classList.remove('atw-drag-from', 'atw-dragging-from');
        });
      };
    });

    // --- ドラッグ受け入れ (空きセルへ) ---
    tilesEl.querySelectorAll('td.atw-cell').forEach(td => {
      td.ondragover = (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        tilesEl.querySelectorAll('.atw-cell.atw-drag-over').forEach(x => x.classList.remove('atw-drag-over'));
        td.classList.add('atw-drag-over');
        // ドラッグ中プレビュー（制約チェック）
        const dragId = window._currentDragId;
        if (dragId && dragId !== td._atwPreviewId) {
          td._atwPreviewId = dragId;
          td.classList.remove('drag-preview-ok', 'drag-preview-warn', 'drag-preview-ng');
          try {
            const day2 = td.dataset.day, p2 = parseInt(td.dataset.p, 10);
            const v2 = validatePlacement(dragId, day2, p2, 'safe', null);
            if (v2.blocks.length) td.classList.add('drag-preview-ng');
            else if (v2.warns.length) td.classList.add('drag-preview-warn');
            else td.classList.add('drag-preview-ok');
          } catch (_) { }
        }
      };
      td.ondragleave = () => {
        td.classList.remove('atw-drag-over', 'drag-preview-ok', 'drag-preview-warn', 'drag-preview-ng');
        td._atwPreviewId = null;
      };
      td.ondrop = (e) => {
        e.preventDefault();
        td.classList.remove('atw-drag-over');
        const id = e.dataTransfer.getData('text/plain') || e.dataTransfer.getData('id') || window._currentDragId;
        if (!id) return;
        const day = td.dataset.day, p = parseInt(td.dataset.p, 10);
        if (!day || !p) return;
        // doPlace→rerenderAll→_atwRefreshAll が自動的に ATW を再描画するため
        // ここで手動 replaceWith は不要（二重更新・ウィンドウ消滅の原因になる）
        placeItem(id, day, p, { mode: state.ui.drop || 'safe' });
      };
    });
  }

  function _atwBuildOneMini(key, kind, idx) {
    // atwRenderの単一ブロック版（再描画用）
    const maxP = Math.max(...DAYS.map(d => maxPeriod(d)));
    const labelAbbr = kind === 'teacher' ? (state.teacherCfg[key]?.abbr || key) : key;
    let total = 0;
    for (const d of DAYS) for (let p = 1; p <= maxPeriod(d); p++) {
      const ids = kind === 'teacher'
        ? (idx.tea?.[key]?.[d]?.[p] || []).filter(x => !isSpanFill(x, d, p))
        : (idx.cls?.[key]?.[d]?.[p] || []).filter(x => !isSpanFill(x, d, p));
      total += ids.length;
    }
    const dayHeaders = DAYS.map(d => `<th class="atw-th-day">${DAYJP[d]}</th>`).join('');
    let rows = '';
    for (let p = 1; p <= maxP; p++) {
      rows += `<tr><th class="atw-th-p">${p}</th>`;
      for (const d of DAYS) {
        if (p > maxPeriod(d)) { rows += `<td class="atw-forb"></td>`; continue; }
        const ids = kind === 'teacher'
          ? (idx.tea?.[key]?.[d]?.[p] || []).filter(x => !isSpanFill(x, d, p))
          : (idx.cls?.[key]?.[d]?.[p] || []).filter(x => !isSpanFill(x, d, p));
        if (!ids.length) { rows += `<td class="atw-cell" data-day="${d}" data-p="${p}"></td>`; continue; }
        const cards = ids.map(id => {
          const it = state.items[id]; if (!it) return '';
          const scfg = state.subjectCfg[it.subjKey] || {};
          const color = scfg.color || pickColor(it.subjKey);
          const subjAbbr = (scfg.abbr || it.subj || it.subjKey).slice(0, 6);
          const sub = kind === 'teacher' ? (it.cls || []).join(',').slice(0, 6) : (state.teacherCfg[(it.teas || [])[0]]?.abbr || (it.teas || [])[0] || '').slice(0, 5);
          const bg = hexWithAlpha(color, 0.8);
          const fg = isDark(color) ? '#fff' : '#0f172a';
          const locked = state.placements[id]?.locked ? ' atw-locked' : '';
          return `<div class="atw-card${locked}" draggable="true" data-id="${escapeAttr(id)}"
          style="background:${bg};color:${fg}"
          title="${escapeHtml(subjAbbr)} ${escapeHtml(sub)}">
          ${escapeHtml(subjAbbr)}<div class="atw-cls">${escapeHtml(sub)}</div>
        </div>`;
        }).join('');
        rows += `<td class="atw-cell" data-day="${d}" data-p="${p}">${cards}</td>`;
      }
      rows += `</tr>`;
    }
    return `<div class="atw-block" data-key="${escapeAttr(key)}" data-kind="${kind}">
    <div class="atw-name">${escapeHtml(labelAbbr)}<span class="atw-cnt">${total}</span></div>
    <div class="atw-scroll">
      <table class="atw-table">
        <thead><tr><th class="atw-th-blank"></th>${dayHeaders}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </div>`;
  }

  function _atwBindBlock(tilesEl, block) {
    block.querySelector('.atw-name').ondblclick = () => {
      openFloat(block.dataset.kind, block.dataset.key);
      rerenderAll();
    };
    block.querySelectorAll('.atw-card[draggable]').forEach(card => {
      card.ondragstart = (e) => {
        window._currentDragId = card.dataset.id; window._dragPending = true;
        e.dataTransfer.setData('text/plain', card.dataset.id);
        try { e.dataTransfer.setData('id', card.dataset.id); } catch { }
        e.dataTransfer.effectAllowed = 'move';
      };
      card.ondragend = () => { window._dragPending = false; setTimeout(() => { if (!window._dragPending) window._currentDragId = null; }, 100); };
    });
    block.querySelectorAll('td.atw-cell').forEach(td => {
      td.ondragover = (e) => {
        e.preventDefault(); e.dataTransfer.dropEffect = 'move';
        td.classList.add('atw-drag-over');
        const dragId = window._currentDragId;
        if (dragId && dragId !== td._atwPreviewId) {
          td._atwPreviewId = dragId;
          td.classList.remove('drag-preview-ok', 'drag-preview-warn', 'drag-preview-ng');
          try {
            const v2 = validatePlacement(dragId, td.dataset.day, parseInt(td.dataset.p, 10), 'safe', null);
            if (v2.blocks.length) td.classList.add('drag-preview-ng');
            else if (v2.warns.length) td.classList.add('drag-preview-warn');
            else td.classList.add('drag-preview-ok');
          } catch (_) { }
        }
      };
      td.ondragleave = () => {
        td.classList.remove('atw-drag-over', 'drag-preview-ok', 'drag-preview-warn', 'drag-preview-ng');
        td._atwPreviewId = null;
      };
      td.ondrop = (e) => {
        e.preventDefault();
        td.classList.remove('atw-drag-over', 'drag-preview-ok', 'drag-preview-warn', 'drag-preview-ng');
        const id = e.dataTransfer.getData('text/plain') || e.dataTransfer.getData('id') || window._currentDragId; if (!id) return;
        const day = td.dataset.day, p = parseInt(td.dataset.p, 10); if (!day || !p) return;
        placeItem(id, day, p, { mode: state.ui.drop || 'safe' });
      };
    });
  }



  /* =======================
  Timetable Analysis (v32.6)
======================= */
  /* =======================
     AI問題提案ウィザード (v45)
     未解決の問題を優先度順に提示し、
     1件ずつ「これをこう解決しますか？」と提案する
  ======================= */
  let _wizardIssues = null;
  let _wizardIdx = 0;
  let _wizardEl = null;

  function openAiWizard() {
    // 既に開いていれば閉じる
    if (_wizardEl) { _wizardEl.remove(); _wizardEl = null; return; }

    _wizardIssues = _buildWizardIssues();
    _wizardIdx = 0;

    _wizardEl = document.createElement('div');
    _wizardEl.id = 'ai-wizard';
    _wizardEl.className = 'ai-wizard';
    document.body.appendChild(_wizardEl);

    _renderWizardCard();
  }

  function _buildWizardIssues() {
    const issues = [];
    const idx = buildIndex();
    const allIds = Object.keys(state.items);

    // 1. 未配置コマ（最高優先）
    const unplaced = allIds.filter(id => !state.placements[id]);
    for (const id of unplaced) {
      const it = state.items[id]; if (!it) continue;
      const scfg = state.subjectCfg[it.subjKey] || {};
      const abbr = scfg.abbr || it.subj || id;
      const cls = it.cls.join(',');
      issues.push({
        priority: 100,
        type: 'unplaced',
        title: `「${abbr}」${cls} が未配置`,
        desc: 'このコマはまだどこにも配置されていません。',
        id,
        action: async () => {
          // 空き枠を探して提案
          const sugs = computeEmptySuggestions(id);
          if (!sugs?.length) { flash('配置できる枠がありません（制約が厳しい可能性があります）'); return; }
          const best = sugs[0];
          showModal(`「${abbr}」${cls} を ${DAYJP[best.moves[0].day]}${best.moves[0].period}時限に配置しますか？`, '提案を適用します。', () => {
            pushHistory('wizard');
            for (const m of best.moves) doPlace(m.id, m.day, m.period, null);
            invalidateIndex(); markDirty('wizard'); rerenderAll();
            _wizardIssues = _buildWizardIssues(); _wizardIdx = 0; _renderWizardCard();
          });
        }
      });
    }

    // 2. 教員1日上限超過
    for (const [tea, tcfg] of Object.entries(state.teacherCfg || {})) {
      const maxD = tcfg.maxDaily;
      if (maxD == null) continue;
      for (const d of DAYS) {
        let cnt = 0;
        const dayIds = [];
        for (let p = 1; p <= maxPeriod(d); p++) {
          const ids2 = (idx.tea?.[tea]?.[d]?.[p] || []).filter(x => !isSpanFill(x, d, p));
          if (ids2.length) { cnt++; dayIds.push(...ids2); }
        }
        if (cnt > maxD) {
          const over = cnt - maxD;
          const teaAbbr = tcfg.abbr || tea;
          const movable = dayIds.filter(id => !state.placements[id]?.locked);
          issues.push({
            priority: 90,
            type: 'teacher-overload',
            title: `${teaAbbr} — ${DAYJP[d]}に${cnt}コマ（上限${maxD}）`,
            desc: `1日上限(${maxD}コマ)を${over}コマ超えています。${movable.length > 0 ? `「${(state.subjectCfg[state.items[movable[0]]?.subjKey]?.abbr || state.items[movable[0]]?.subj || movable[0])}」などを別の日に移動できます。` : ''}`,
            ids: movable.slice(0, 3), tea, day: d,
            action: async () => {
              if (!movable.length) { flash('ロック解除できるコマがありません'); return; }
              const toMove = movable[0];
              const it = state.items[toMove]; if (!it) return;
              const sugs = computeEmptySuggestions(toMove);
              const otherDay = sugs?.find(s => s.moves[0]?.day !== d);
              if (!otherDay) { flash('移動先が見つかりません'); return; }
              const m = otherDay.moves[0];
              const abbr2 = state.subjectCfg[it.subjKey]?.abbr || it.subj || toMove;
              showModal(`「${abbr2}」を ${DAYJP[m.day]}${m.period}時限に移動して上限超過を解消しますか？`, '提案を適用します。', () => {
                pushHistory('wizard');
                doPlace(m.id, m.day, m.period, null);
                invalidateIndex(); markDirty('wizard'); rerenderAll();
                _wizardIssues = _buildWizardIssues(); _wizardIdx = 0; _renderWizardCard();
              });
            }
          });
        }
      }
    }

    // 3. クラス競合
    for (const cls of [...new Set(Object.values(state.items).flatMap(it => it.cls || []))]) {
      for (const d of DAYS) {
        for (let p = 1; p <= maxPeriod(d); p++) {
          const ids2 = (idx.cls?.[cls]?.[d]?.[p] || []).filter(x => !isSpanFill(x, d, p));
          if (ids2.length > 1) {
            const labels = ids2.map(id => state.subjectCfg[state.items[id]?.subjKey]?.abbr || state.items[id]?.subj || id).join('・');
            const movable = ids2.filter(id => !state.placements[id]?.locked);
            issues.push({
              priority: 80,
              type: 'class-conflict',
              title: `${cls} — ${DAYJP[d]}${p}限に競合 (${labels})`,
              desc: `同じクラスが同時刻に${ids2.length}コマ重複しています。`,
              ids: movable,
              action: async () => {
                if (!movable.length) { flash('移動できるコマがありません'); return; }
                const toMove = movable[movable.length - 1];
                const it = state.items[toMove]; if (!it) return;
                const sugs = computeEmptySuggestions(toMove);
                if (!sugs?.length) { flash('移動先が見つかりません'); return; }
                const m = sugs[0].moves[0];
                const abbr2 = state.subjectCfg[it.subjKey]?.abbr || it.subj || toMove;
                showModal(`「${abbr2}」を ${DAYJP[m.day]}${m.period}時限に移動して競合を解消しますか？`, '提案を適用します。', () => {
                  pushHistory('wizard');
                  doPlace(m.id, m.day, m.period, null);
                  invalidateIndex(); markDirty('wizard'); rerenderAll();
                  _wizardIssues = _buildWizardIssues(); _wizardIdx = 0; _renderWizardCard();
                });
              }
            });
          }
        }
      }
    }

    // ── v46-A1-3: 教員連続上限超過 ─────────────────────────────────
    for (const [tea, tcfg] of Object.entries(state.teacherCfg || {})) {
      const maxC = teacherConsecMax(tea);
      if (maxC == null) continue;
      for (const d of DAYS) {
        const run = teacherConsecRun(tea, d); // {best, bestRun}
        if (run.best <= maxC) continue;
        const over = run.best - maxC;
        const teaAbbr = tcfg.abbr || tea;
        const movable = run.bestRun
          .flatMap(p => (idx.tea?.[tea]?.[d]?.[p] || []))
          .filter(id => !state.placements[id]?.locked && !isSpanFill(id, d, 0));
        if (!movable.length) continue;
        issues.push({
          priority: 85,
          type: 'teacher-consec',
          title: `${teaAbbr} — ${DAYJP[d]}に${run.best}連続（上限${maxC}）`,
          desc: `連続授業が上限(${maxC}コマ)を${over}コマ超えています。間に空きを作ることで解消できます。`,
          ids: movable.slice(0, 2),
          action: async () => {
            if (!movable.length) { flash('移動できるコマがありません'); return; }
            const toMove = movable[0];
            const it = state.items[toMove]; if (!it) return;
            const sugs = computeEmptySuggestions(toMove);
            // 別の日、または少なくとも連続が切れる枠を優先
            const best2 = sugs?.find(s => {
              const m = s.moves[0];
              return m && (m.day !== d || Math.abs(m.period - run.bestRun[0]) > maxC);
            }) || sugs?.[0];
            if (!best2) { flash('移動先が見つかりません'); return; }
            const m = best2.moves[0];
            const abbr2 = state.subjectCfg[it.subjKey]?.abbr || it.subj || toMove;
            showModal(`「${abbr2}」を ${DAYJP[m.day]}${m.period}時限に移動して連続超過を解消しますか？`, '提案を適用します。', () => {
              pushHistory('wizard');
              doPlace(m.id, m.day, m.period, null);
              invalidateIndex(); markDirty('wizard'); rerenderAll();
              _wizardIssues = _buildWizardIssues(); _wizardIdx = 0; _renderWizardCard();
            });
          }
        });
      }
    }

    // ── v46-A1-4: 教室競合 ──────────────────────────────────────────
    if (state.settings.roomConflict) {
      const allRooms = [...new Set(Object.values(state.items).flatMap(it => it.rooms || []))];
      for (const room of allRooms) {
        for (const d of DAYS) {
          for (let p = 1; p <= maxPeriod(d); p++) {
            const ids2 = (idx.room?.[room]?.[d]?.[p] || []).filter(x => !isSpanFill(x, d, p));
            if (ids2.length < 2) continue;
            const labels = ids2.map(id => state.subjectCfg[state.items[id]?.subjKey]?.abbr || state.items[id]?.subj || id).join('・');
            const movable = ids2.filter(id => !state.placements[id]?.locked);
            if (!movable.length) continue;
            issues.push({
              priority: 75,
              type: 'room-conflict',
              title: `教室「${room}」— ${DAYJP[d]}${p}限に競合 (${labels})`,
              desc: `同じ教室に${ids2.length}コマが重複しています。どちらかを別の教室または別の時間に移動してください。`,
              ids: movable,
              action: async () => {
                const toMove = movable[movable.length - 1];
                const it = state.items[toMove]; if (!it) return;
                const sugs = computeEmptySuggestions(toMove);
                if (!sugs?.length) { flash('移動先が見つかりません'); return; }
                const m = sugs[0].moves[0];
                const abbr2 = state.subjectCfg[it.subjKey]?.abbr || it.subj || toMove;
                showModal(`「${abbr2}」を ${DAYJP[m.day]}${m.period}時限に移動して教室競合を解消しますか？`, '提案を適用します。', () => {
                  pushHistory('wizard');
                  doPlace(m.id, m.day, m.period, null);
                  invalidateIndex(); markDirty('wizard'); rerenderAll();
                  _wizardIssues = _buildWizardIssues(); _wizardIdx = 0; _renderWizardCard();
                });
              }
            });
          }
        }
      }
    }

    // ── v46-A1-5: 同日同科目違反 ────────────────────────────────────
    for (const id of Object.keys(state.items)) {
      const plc = state.placements[id]; if (!plc?.day) continue;
      const it = state.items[id]; if (!it) continue;
      const scfg = state.subjectCfg[it.subjKey] || {};
      if (!scfg.noSameDay) continue;
      for (const c of it.cls || []) {
        if (hasSameDaySubjectDuplicate(c, it.subjKey, plc.day, id)) {
          if (state.placements[id]?.locked) continue;
          const abbr2 = scfg.abbr || it.subj || id;
          const existingIssue = issues.find(x => x.type === 'same-day-subj' && x.id === id);
          if (existingIssue) continue;
          issues.push({
            priority: 70,
            type: 'same-day-subj',
            title: `「${abbr2}」${c} — ${DAYJP[plc.day]}に同科目が複数`,
            desc: `同日同科目禁止が設定されているのに、${DAYJP[plc.day]}に複数コマ配置されています。`,
            id,
            action: async () => {
              const sugs = computeEmptySuggestions(id);
              const otherDay = sugs?.find(s => s.moves[0]?.day !== plc.day);
              if (!otherDay) { flash('別の日への移動先が見つかりません'); return; }
              const m = otherDay.moves[0];
              showModal(`「${abbr2}」を ${DAYJP[m.day]}${m.period}時限に移動して同日重複を解消しますか？`, '提案を適用します。', () => {
                pushHistory('wizard');
                doPlace(m.id, m.day, m.period, null);
                invalidateIndex(); markDirty('wizard'); rerenderAll();
                _wizardIssues = _buildWizardIssues(); _wizardIdx = 0; _renderWizardCard();
              });
            }
          });
          break;
        }
      }
    }

    // 優先度順にソート
    issues.sort((a, b) => b.priority - a.priority);
    return issues;
  }

  function _renderWizardCard() {
    if (!_wizardEl) return;
    const issues = _wizardIssues || [];

    if (!issues.length || _wizardIdx >= issues.length) {
      _wizardEl.innerHTML = `
      <div class="wiz-head">
        <span class="wiz-title">🎉 AI問題提案</span>
        <button class="wiz-close">×</button>
      </div>
      <div class="wiz-body">
        <div class="wiz-done">✅ 現在の問題はすべて確認しました</div>
        <button class="wiz-btn-secondary" id="wiz-refresh">再スキャン</button>
      </div>`;
      _wizardEl.querySelector('.wiz-close').onclick = () => { _wizardEl?.remove(); _wizardEl = null; };
      _wizardEl.querySelector('#wiz-refresh').onclick = () => { _wizardIssues = _buildWizardIssues(); _wizardIdx = 0; _renderWizardCard(); };
      return;
    }

    const issue = issues[_wizardIdx];
    const _typeIcons = { 'unplaced': '📦', 'teacher-overload': '⚠️', 'class-conflict': '💥', 'teacher-consec': '🔄', 'room-conflict': '🏫', 'same-day-subj': '📅' };
    const _typeLabels = { 'unplaced': '未配置', 'teacher-overload': '教員超過', 'class-conflict': 'クラス競合', 'teacher-consec': '連続超過', 'room-conflict': '教室競合', 'same-day-subj': '同日重複' };
    const typeIcon = _typeIcons[issue.type] || '❓';
    const remaining = issues.length - _wizardIdx;

    _wizardEl.innerHTML = `
    <div class="wiz-head">
      <span class="wiz-title">🤖 AI問題提案</span>
      <span class="wiz-remain">${remaining}件残り</span>
      <button class="wiz-close">×</button>
    </div>
    <div class="wiz-body">
      <div class="wiz-issue-type">${typeIcon} ${_typeLabels[issue.type] || issue.type}</div>
      <div class="wiz-issue-title">${escapeHtml(issue.title)}</div>
      <div class="wiz-issue-desc">${escapeHtml(issue.desc)}</div>
    </div>
    <div class="wiz-actions">
      <button class="wiz-btn-primary" id="wiz-apply">✅ 提案を適用</button>
      <button class="wiz-btn-secondary" id="wiz-skip">スキップ →</button>
      <button class="wiz-btn-secondary" id="wiz-open">詳細を見る</button>
    </div>
    <div class="wiz-progress">
      <div class="wiz-progress-bar" style="width:${Math.round((_wizardIdx / Math.max(1, issues.length)) * 100)}%"></div>
    </div>`;

    _wizardEl.querySelector('.wiz-close').onclick = () => { _wizardEl?.remove(); _wizardEl = null; };
    _wizardEl.querySelector('#wiz-apply').onclick = () => issue.action?.();
    _wizardEl.querySelector('#wiz-skip').onclick = () => _advanceWizard();
    _wizardEl.querySelector('#wiz-open').onclick = () => {
      if (issue.id) openPropSuggestions(issue.id);
      else if (issue.ids?.[0]) openPropSuggestions(issue.ids[0]);
    };
  }

  function _advanceWizard() {
    _wizardIdx++;
    _renderWizardCard();
  }

  function showTimetableAnalysis() {
    try {
      const issues = analyzeTimetable();
      if (!issues.length) {
        showModalHTML('✅ 分析結果：問題なし',
          '<div class="muted small" style="margin:8px 0">検出できる問題はありませんでした。</div>',
          null, '閉じる', '閉じる');
        return;
      }
      const byLevel = { warn: [], info: [] };
      for (const iss of issues) {
        (byLevel[iss.level] || byLevel.info).push(iss);
      }
      const renderSection = (items, icon, cls) =>
        items.map((iss, idx_) => `<div class="analysis-item ${cls}" data-iss-level="${cls}" data-iss-idx="${idx_}">
        <span class="analysis-icon">${icon}</span>
        <div class="analysis-text">
          <strong>${escapeHtml(iss.title)}</strong>
          ${iss.detail ? `<div class="analysis-detail">${escapeHtml(iss.detail)}</div>` : ''}
          <div class="analysis-actions">
            ${iss.fixableIds?.length ? `<button class="fix-btn btn-mini" data-fix-idx="${cls}_${idx_}">🔧 修正提案</button>` : ''}
            ${iss.fixTea || iss.fixDay || iss.fixableIds?.length ? `<button class="highlight-btn btn-mini" data-hl-idx="${cls}_${idx_}">📍 ハイライト</button>` : ''}
          </div>
        </div>
      </div>`).join('');
      const warnCount = byLevel.warn.length;
      const infoCount = byLevel.info.length;
      // v47-C4: 教員コマ数バーチャート
      const teaChartHTML = (() => {
        const idx2 = buildIndex();
        const placed = Object.keys(state.items).filter(id => state.placements[id]?.day);
        const allTea = [...new Set(placed.flatMap(id => state.items[id].teas || []))].sort((a, b) => a.localeCompare(b, 'ja'));
        if (!allTea.length) return '';
        const counts = allTea.map(t => {
          let n = 0;
          for (const d of DAYS) for (let p = 1; p <= maxPeriod(d); p++) n += (idx2.tea?.[t]?.[d]?.[p] || []).filter(id => !isSpanFill(id, d, p)).length;
          return { t, n, maxD: teacherDailyMax(t) };
        });
        const maxN = Math.max(...counts.map(c => c.n), 1);
        const bars = counts.map(c => {
          const pct = Math.round(c.n / maxN * 100);
          const over = c.maxD != null && c.n > c.maxD * DAYS.length;
          const barColor = over ? '#ef4444' : (pct > 70 ? '#f59e0b' : '#3b82f6');
          const abbr = (state.teacherCfg[c.t]?.abbr || c.t).slice(0, 5);
          return `<div class="teabar-row" title="${escapeHtml(c.t)}: ${c.n}コマ${c.maxD != null ? ' (上限' + c.maxD + '/日)' : ''}">
          <div class="teabar-name">${escapeHtml(abbr)}</div>
          <div class="teabar-bar"><div class="teabar-fill" style="width:${pct}%;background:${barColor}"></div></div>
          <div class="teabar-cnt${over ? ' teabar-over' : ''}">${c.n}</div>
        </div>`;
        }).join('');
        return `<details class="tea-chart-wrap" open><summary class="tea-chart-title">📊 教員週コマ数バランス</summary><div class="tea-chart">${bars}</div></details>`;
      })();

      const html = `
      <div class="analysis-wrap" id="analysis-wrap-root">
        <div class="analysis-summary">
          ${warnCount > 0 ? `<span class="analysis-badge warn-badge">⚠ ${warnCount}件</span>` : ''}
          ${infoCount > 0 ? `<span class="analysis-badge info-badge">ℹ ${infoCount}件</span>` : ''}
        </div>
        ${teaChartHTML}
        ${byLevel.warn.length ? renderSection(byLevel.warn, '⚠️', 'warn') : ''}
        ${byLevel.info.length ? renderSection(byLevel.info, 'ℹ️', 'info') : ''}
      </div>
    `;
      showModalHTML(`📋 時間割分析（全${issues.length}件）`, html,
        null, '閉じる', null,
        () => {
          // Bind fix buttons
          document.querySelectorAll('.fix-btn[data-fix-idx]').forEach(btn => {
            btn.onclick = () => {
              const parts = btn.dataset.fixIdx.split('_');
              const level = parts[0];
              const i = parseInt(parts[1], 10);
              const iss = (byLevel[level] || [])[i];
              if (!iss) return;
              try {
                // Fix: 分析モーダルを先に閉じてから修正提案モーダルを開く
                document.getElementById('modal-cancel')?.click();
                setTimeout(() => {
                  try { showIssueFixSuggestion(iss); } catch (e2) {
                    console.error('Error in showIssueFixSuggestion:', e2);
                    flash('修正提案の表示に失敗しました');
                  }
                }, 80);
              } catch (e) {
                console.error('Error in showIssueFixSuggestion:', e);
                flash('修正提案の表示に失敗しました');
              }
            };
          });
          // Bind highlight buttons
          document.querySelectorAll('.highlight-btn[data-hl-idx]').forEach(btn => {
            btn.onclick = () => {
              const parts = btn.dataset.hlIdx.split('_');
              const level = parts[0];
              const i = parseInt(parts[1], 10);
              const iss = (byLevel[level] || [])[i];
              if (!iss) return;
              try {
                highlightIssue(iss);
              } catch (e) {
                console.error('Error in highlightIssue:', e);
                flash('ハイライト表示に失敗しました');
              }
              // Visual feedback
              btn.textContent = '✓ ハイライト済';
              btn.disabled = true;
              setTimeout(() => { btn.textContent = '📍 ハイライト'; btn.disabled = false; }, 2000);
            };
          });
        }
      );
    } catch (e) {
      console.error('Error in showTimetableAnalysis:', e);
      showModal('エラー', `分析処理中にエラーが発生しました:\n${e.message}`);
    }
  }

  function highlightIssue(iss) {
    // Clear previous highlights
    $$('.issue-highlight').forEach(el => el.classList.remove('issue-highlight'));

    if (iss.fixableIds && iss.fixableIds.length) {
      // Highlight specific lesson cards
      for (const id of iss.fixableIds) {
        const cards = document.querySelectorAll(`.lesson[data-id="${CSS.escape(id)}"]`);
        cards.forEach(c => c.classList.add('issue-highlight'));
      }
      // Scroll to first one
      const first = document.querySelector(`.lesson[data-id="${CSS.escape(iss.fixableIds[0])}"]`);
      if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
      flash(`問題のコマを赤枠でハイライトしました`);
    } else if (iss.fixTea && iss.fixDay) {
      // 教員ビューに切り替えて該当教員の当該曜日セルをハイライト
      try { switchTab('edit'); } catch (e) { }
      state.ui.viewMode = 'teacher';
      try { rerenderAll(); } catch (e) { }
      setTimeout(() => {
        const row = document.querySelector(`.grid-wrapper tr[data-row="${CSS.escape(iss.fixTea)}"]`);
        if (row) {
          row.querySelectorAll(`td[data-day="${iss.fixDay}"]`).forEach(td => td.classList.add('issue-highlight'));
          row.scrollIntoView({ behavior: 'smooth', block: 'center' });
          flash(`${iss.fixTea} の ${DAYJP[iss.fixDay] || iss.fixDay} をハイライトしました`);
        } else {
          flash(`${iss.fixTea} の行が見つかりませんでした`);
        }
      }, 200);
    }
  }

  /* v33.0: データ登録不備分析 */
  function analyzeRawData() {
    const issues = [];
    const rows = state.rawRows || [];

    if (!rows.length) {
      return [{ level: 'info', title: 'データがありません', detail: 'データ登録タブで行を追加してください。' }];
    }

    // 1. コマ数が多すぎる行
    for (const r of rows) {
      const cnt = parseInt(r.count || 1, 10) || 1;
      const subj = (r.subj || '').trim();
      const cls = (r.cls || '').trim();
      if (cnt > 10) {
        issues.push({ level: 'warn', title: `「${subj}」(${cls}) コマ数が${cnt}と非常に多い`, detail: '週あたり10コマ超は通常あり得ません。入力ミスの可能性があります。' });
      } else if (cnt > 6) {
        issues.push({ level: 'info', title: `「${subj}」(${cls}) コマ数が${cnt}コマ`, detail: '週6コマ超は多めです。確認をお勧めします。' });
      }
    }

    // 2. 教員名が似ている（1文字以内の差）→ 同一人物の入力ミスの可能性
    const teaNames = [...new Set(rows.flatMap(r => splitList(r.tea)))].filter(Boolean);
    const simGroups = new Set();
    for (let i = 0; i < teaNames.length; i++) {
      for (let j = i + 1; j < teaNames.length; j++) {
        const a = teaNames[i], b = teaNames[j];
        if (Math.abs(a.length - b.length) <= 1 && levenshtein(a, b) <= 1 && a.length >= 2) {
          const key = [a, b].sort().join('|');
          if (!simGroups.has(key)) {
            simGroups.add(key);
            issues.push({ level: 'warn', title: `教員名が類似: 「${a}」と「${b}」`, detail: '同一人物の入力ミスの可能性があります。どちらかに統一してください。' });
          }
        }
      }
    }

    // 3. 科目名が似ている
    const subjNames = [...new Set(rows.map(r => (r.subj || '').trim()))].filter(Boolean);
    for (let i = 0; i < subjNames.length; i++) {
      for (let j = i + 1; j < subjNames.length; j++) {
        const a = subjNames[i], b = subjNames[j];
        if (Math.abs(a.length - b.length) <= 1 && levenshtein(a, b) === 1 && a.length >= 3) {
          const key = [a, b].sort().join('|');
          issues.push({ level: 'info', title: `科目名が類似: 「${a}」と「${b}」`, detail: '同じ科目の入力ゆれの可能性があります。' });
        }
      }
    }

    // 4. 同一クラス+科目の合計コマが多すぎる
    const csCount = {}; // 'cls|subj' -> total
    for (const r of rows) {
      const cnt = parseInt(r.count || 1, 10) || 1;
      for (const c of splitList(r.cls)) {
        const k = `${c}|${(r.subj || '').trim()}`;
        csCount[k] = (csCount[k] || 0) + cnt;
      }
    }
    const totalSlots = DAYS.reduce((s, d) => s + maxPeriod(d), 0);
    for (const [k, cnt] of Object.entries(csCount)) {
      const [cls, subj] = k.split('|');
      if (cnt > totalSlots * 0.4) {
        issues.push({ level: 'warn', title: `「${subj}」(${cls}) 週${cnt}コマ`, detail: `全スロット(${totalSlots})の40%超です。配置可能性を確認してください。` });
      }
    }

    // 5. 教員が未設定の行
    const noTea = rows.filter(r => (r.subj || '').trim() && !(r.tea || '').trim());
    if (noTea.length) {
      issues.push({ level: 'info', title: `教員未設定の行が${noTea.length}件あります`, detail: noTea.slice(0, 3).map(r => `「${(r.subj || '').trim()}」(${(r.cls || '').trim()})`).join('、') + (noTea.length > 3 ? `…` : '') });
    }

    // 6. クラスが未設定の行
    const noCls = rows.filter(r => (r.subj || '').trim() && !(r.cls || '').trim());
    if (noCls.length) {
      issues.push({ level: 'warn', title: `クラス未設定の行が${noCls.length}件あります`, detail: noCls.slice(0, 3).map(r => `「${(r.subj || '').trim()}」`).join('、') + (noCls.length > 3 ? '…' : '') });
    }

    // 7. 同一教員が異なる教科で登録されている（参考情報）
    const teaDeptMap = {};
    for (const r of rows) {
      const dept = (r.dept || '').trim();
      if (!dept) continue;
      for (const t of splitList(r.tea)) {
        if (!teaDeptMap[t]) teaDeptMap[t] = new Set();
        teaDeptMap[t].add(dept);
      }
    }
    for (const [t, depts] of Object.entries(teaDeptMap)) {
      if (depts.size >= 3) {
        issues.push({ level: 'info', title: `教員「${t}」が${depts.size}教科を担当`, detail: [...depts].join('、') });
      }
    }

    // 8. 合計コマ数の確認
    const totalItems = rows.reduce((s, r) => s + (parseInt(r.count || 1, 10) || 1), 0);
    const allSlots = Object.keys(state.items).length || totalItems;
    if (totalItems > totalSlots * Object.keys(csCount).length / 5 && totalItems > 50) {
      issues.push({ level: 'info', title: `合計コマ数: ${totalItems}件`, detail: `配置スロット合計:${totalSlots}。クラス数によっては配置困難になる場合があります。` });
    }

    return issues;
  }

  // Simple Levenshtein for short strings
  function levenshtein(a, b) {
    if (!a.length) return b.length; if (!b.length) return a.length;
    const m = a.length, n = b.length;
    const dp = Array.from({ length: m + 1 }, (_, i) => Array.from({ length: n + 1 }, (_, j) => i ? j ? 0 : i : j));
    for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    return dp[m][n];
  }

  function showDataAnalysis() {
    const issues = analyzeRawData();
    if (!issues.length) {
      showModalHTML('✅ データ分析：問題なし', '<div class="muted small" style="margin:8px 0">検出できる問題はありませんでした。</div>', null, '閉じる', '閉じる');
      return;
    }
    const icon = { warn: '⚠️', info: 'ℹ️', err: '🚨' };
    const html = `<div class="data-issue-wrap">${issues.map(i => `
    <div class="data-issue-item ${i.level}">
      <div class="di-icon">${icon[i.level] || 'ℹ️'}</div>
      <div class="di-text"><strong>${escapeHtml(i.title)}</strong>${i.detail ? `<div class="di-detail">${escapeHtml(i.detail)}</div>` : ''}</div>
    </div>`).join('')}
    <div class="muted small" style="margin-top:8px">${issues.length}件の指摘事項</div>
  </div>`;
    showModalHTML(`🔍 データ分析（${issues.length}件）`, html, null, '閉じる', '閉じる');
  }

  /* v33.0: Show fix suggestion for a specific analysis issue */
  function showIssueFixSuggestion(iss) {
    try {
      if (!iss.fixableIds || !iss.fixableIds.length) {
        flash('この問題の自動修正提案はありません');
        return;
      }
      const firstId = iss.fixableIds[0];
      const pack = computeSuggestionPack(firstId);
      const allAlts = [
        ...(pack.empty || []).slice(0, 3),
        ...(pack.swap || []).slice(0, 3),
        ...(pack.linked || []).slice(0, 2),
      ].filter(Boolean).sort((a, b) => b.score - a.score).slice(0, 5);

      if (!allAlts.length) {
        // No suggestions found - show info and allow manual placement
        const it = state.items[firstId];
        const scfg = state.subjectCfg[it?.subjKey] || {};
        const abbr = scfg.abbr || it?.subj || '?';
        const plc = state.placements[firstId];
        const curWhere = plc ? `${DAYJP[plc.day]}${plc.period}` : '在庫';
        showModalHTML(
          `🔧 修正提案: 「${abbr}」(${curWhere})`,
          `<div style="padding:12px 4px">
          <div style="color:#64748b;margin-bottom:12px">自動提案が見つかりませんでした。</div>
          <div style="font-size:12px;color:#94a3b8">
            • コマをドラッグして手動で移動してください<br>
            • または在庫に戻してAI配置をお試しください
          </div>
        </div>`,
          null, '閉じる', '閉じる'
        );
        return;
      }

      const it = state.items[firstId];
      const scfg = state.subjectCfg[it?.subjKey] || {};
      const abbr = scfg.abbr || it?.subj || '?';
      const plc = state.placements[firstId];
      const curWhere = plc ? `${DAYJP[plc.day]}${plc.period}` : '在庫';

      // Open float windows for each involved teacher (will draw arrows on hover)
      const involvedTeas = [];
      for (const alt of allAlts) {
        for (const m of (alt.moves || [])) {
          const mit = state.items[m.id];
          for (const tea of (mit?.teas || [])) { if (!involvedTeas.includes(tea)) involvedTeas.push(tea); }
        }
      }
      involvedTeas.slice(0, 3).forEach(tea => { try { openFloat('teacher', tea); } catch { } });

      // Build visual move arrows HTML
      function buildMoveArrow(m) {
        try {
          const mit = state.items[m.id]; if (!mit) return '';
          const ms = state.subjectCfg[mit.subjKey] || {};
          const ma = ms.abbr || mit.subj || '?';
          const col = ms.color || pickColor(mit.subjKey) || '#64748b';
          const from = m.fromDay ? `${DAYJP[m.fromDay]}${m.fromPeriod}` : (state.placements[m.id] ? `${DAYJP[state.placements[m.id].day]}${state.placements[m.id].period}` : '在庫');
          const to = `${DAYJP[m.day]}${m.period}`;
          return `<span class="move-chip" style="background:${hexWithAlpha(col, 0.18)};border:1px solid ${col};color:#1e293b;border-radius:6px;padding:2px 7px;margin:2px;display:inline-flex;align-items:center;gap:4px;font-size:12px;white-space:nowrap">
          <span style="font-weight:900;color:${col}">${escapeHtml(ma)}</span>
          <span style="color:#94a3b8">${escapeHtml(from)}</span>
          <span style="color:#ef4444;font-size:16px;font-weight:900">➜</span>
          <span style="font-weight:700">${escapeHtml(to)}</span>
        </span>`;
        } catch (e) {
          console.error('Error in buildMoveArrow:', e, m);
          return '';
        }
      }

      const altsHTML = allAlts.map((s, i) => {
        try {
          const moves = s.moves || [];
          const arrowsHTML = moves.map(buildMoveArrow).filter(Boolean).join('');
          // Build score bar
          const scoreColor = s.score >= 70 ? '#22c55e' : s.score >= 40 ? '#f59e0b' : '#f43f5e';
          return `<div class="sug-item issueFix-item" data-isf-idx="${i}" style="margin-bottom:10px;padding:10px;background:#f8fafc;border-radius:10px;border:1px solid #e2e8f0;cursor:pointer;transition:box-shadow .15s">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
            <span class="badge2">案${i + 1}</span>
            <span style="font-size:11px;color:#64748b">${escapeHtml(s.label || s.title || '')}</span>
            <span style="margin-left:auto;font-size:11px;color:${scoreColor};font-weight:900">★${s.score}</span>
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px;align-items:center">${arrowsHTML}</div>
          ${moves.length > 1 ? `<div style="font-size:10px;color:#94a3b8;margin-bottom:6px">↑ ${moves.length}コマの連動移動（ホバーで矢印表示）</div>` :
              `<div style="font-size:10px;color:#94a3b8;margin-bottom:4px">ホバーで個人窓に矢印表示</div>`}
          <button class="btn" style="font-size:11px;padding:3px 12px" data-fix-sug="${i}">✅ 適用</button>
        </div>`;
        } catch (e) {
          console.error('Error in mapping alternatives:', e, s);
          return '';
        }
      }).join('');

      showModalHTML(
        `🔧 修正提案: 「${abbr}」(${curWhere})`,
        `<div style="max-height:60vh;overflow-y:auto;padding-right:4px">${altsHTML}</div>`,
        null, '閉じる', '閉じる',
        () => {
          // Bind apply buttons
          document.querySelectorAll('[data-fix-sug]').forEach(btn => {
            btn.onclick = () => {
              const i = parseInt(btn.dataset.fixSug, 10);
              const s = allAlts[i]; if (!s) return;
              clearSuggestionArrows();
              pushHistory('issueFix');
              for (const m of (s.moves || [])) {
                if (state.placements[m.id]?.locked) continue;
                state.placements[m.id] = m.day ? { day: m.day, period: m.period, locked: false } : null;
              }
              invalidateIndex(); markDirty('issueFix'); rerenderAll(); broadcastState();
              $('#modal-ok')?.click();
              flash('修正案を適用しました');
              setTimeout(() => showTimetableAnalysis(), 400);
            };
          });
          // Hover: show arrows in teacher float windows
          document.querySelectorAll('.issueFix-item').forEach(item => {
            item.onmouseenter = () => {
              const i2 = parseInt(item.dataset.isfIdx, 10);
              const s2 = allAlts[i2]; if (!s2?.moves?.length) return;
              previewSuggestionMoves(s2.moves);
            };
            item.onmouseleave = () => { clearSuggestionArrows(); };
          });
        }
      );
    } catch (e) {
      console.error('Error in showIssueFixSuggestion:', e);
      console.error('Full error:', e.stack);
      flash('修正案の表示に失敗しました: ' + e.message);
    }
  }

  function analyzeTimetable() {
    const issues = [];
    const idx = buildIndex();
    const placed = Object.keys(state.items).filter(id => state.placements[id]?.day);
    const allTeachers = [...new Set(placed.flatMap(id => state.items[id].teas || []))];
    const allClasses = [...new Set(placed.flatMap(id => state.items[id].cls || []))];
    const DAYS_JP = DAYS.map(d => DAYJP[d] || d);
    const maxP = Math.max(...DAYS.map(d => maxPeriod(d)));

    // --- 1. Teacher consecutive run violations (soft: no maxConsec set but >=3) ---
    for (const tea of allTeachers) {
      const tcfg = state.teacherCfg[tea] || {};
      const maxC = teacherConsecMax(tea);
      for (const day of DAYS) {
        const mP = maxPeriod(day);
        const taught = new Set();
        const teachSlotIds = {};
        for (let p = 1; p <= mP; p++) {
          const ids = idx.tea?.[tea]?.[day]?.[p] || [];
          if (ids.length) { taught.add(p); teachSlotIds[p] = ids; }
        }
        // compute longest run
        let best = 0, cur = 0, runStart = 0;
        const lunchAfter = Number(state.settings.lunchAfter || 0);
        let bestRun = [];
        let curRun = [];
        for (let p = 1; p <= mP; p++) {
          if (lunchAfter && p === lunchAfter + 1) { cur = 0; curRun = []; }
          if (taught.has(p)) { cur++; curRun.push(p); if (cur > best) { best = cur; bestRun = [...curRun]; } }
          else { cur = 0; curRun = []; }
        }
        const fixIds = bestRun.flatMap(p => (teachSlotIds[p] || [])).filter(id => !state.placements[id]?.locked);
        if (maxC == null && best >= 3) {
          issues.push({ level: 'warn', title: `${tea} — ${DAYJP[day]}に${best}連続授業`, detail: '連続授業上限未設定。見直しを推奨します。', fixableIds: fixIds.slice(0, 3), fixTea: tea, fixDay: day });
        } else if (maxC != null && best > maxC) {
          issues.push({ level: 'warn', title: `${tea} — ${DAYJP[day]}に連続${best}コマ（上限${maxC}）`, detail: '教員連続上限を超えています。', fixableIds: fixIds.slice(0, 3), fixTea: tea, fixDay: day });
        }
      }
    }

    // --- 2. Teacher overloaded on one day ---
    for (const tea of allTeachers) {
      for (const day of DAYS) {
        const mP = maxPeriod(day);
        let cnt = 0;
        for (let p = 1; p <= mP; p++) cnt += (idx.tea?.[tea]?.[day]?.[p] || []).length > 0 ? 1 : 0;
        if (cnt >= Math.ceil(mP * 0.75) && mP >= 4) {
          issues.push({ level: 'info', title: `${tea} — ${DAYJP[day]}に${cnt}/${mP}コマ集中`, detail: '1日の授業が多い傾向があります。' });
        }
      }
    }

    // --- 3. Teacher all lessons in period 1 or last period ---
    for (const tea of allTeachers) {
      const teacherIds = placed.filter(id => state.items[id].teas?.includes(tea));
      if (teacherIds.length < 2) continue;
      const periods = teacherIds.map(id => state.placements[id].period);
      if (periods.every(p => p === 1)) {
        issues.push({ level: 'info', title: `${tea} — 全授業が1時限目`, detail: '授業が1時限目に集中しています。' });
      } else if (periods.every(p => p === maxP)) {
        issues.push({ level: 'info', title: `${tea} — 全授業が最終時限(${maxP})`, detail: '授業が最終時限に集中しています。' });
      }
      // majority in period 1
      const p1count = periods.filter(p => p === 1).length;
      if (p1count / periods.length >= 0.6 && periods.length >= 3) {
        issues.push({ level: 'info', title: `${tea} — ${periods.length}コマ中${p1count}コマが1時限目`, detail: '1時限目への集中傾向があります。' });
      }
    }

    // --- 4. Subject all lessons in same period for a class ---
    const subjClassMap = new Map(); // 'cls|subjKey' -> [ids]
    for (const id of placed) {
      const it = state.items[id];
      for (const c of it.cls || []) {
        const k = `${c}|${it.subjKey}`;
        if (!subjClassMap.has(k)) subjClassMap.set(k, []);
        subjClassMap.get(k).push(id);
      }
    }
    for (const [key, ids] of subjClassMap) {
      if (ids.length < 2) continue;
      const [cls, subjKey] = key.split('|');
      const scfg = state.subjectCfg[subjKey] || {};
      const abbr = scfg.abbr || subjKey;
      const periods = ids.map(id => state.placements[id].period);
      if (periods.every(p => p === periods[0])) {
        issues.push({ level: 'info', title: `${cls} 「${abbr}」— 全${ids.length}コマが${periods[0]}時限目`, detail: '同じ時限への集中。バランスの見直しを検討してください。' });
      }
      // Check same day concentration
      const days = ids.map(id => state.placements[id].day);
      const dayCounts = {};
      for (const d of days) dayCounts[d] = (dayCounts[d] || 0) + 1;
      for (const [d, cnt] of Object.entries(dayCounts)) {
        if (cnt >= 2 && ids.length >= 3) {
          issues.push({ level: 'info', title: `${cls} 「${abbr}」— ${DAYJP[d]}に${cnt}コマ集中`, detail: '同一曜日に同科目が複数。' });
        }
      }
    }

    // --- 5. Hard violations (conflicts, forbidden) ---
    const vioIds = placed.filter(id => {
      const it = state.items[id];
      const plc = state.placements[id];
      for (let dp = 0; dp < (it.span || 1); dp++) {
        if (isForbiddenForSubject(it.subjKey, plc.day, plc.period + dp)) return true;
      }
      return false;
    });
    for (const id of vioIds) {
      const it = state.items[id];
      const scfg = state.subjectCfg[it.subjKey] || {};
      const plc = state.placements[id];
      issues.push({ level: 'warn', title: `「${scfg.abbr || it.subj}」— 禁則スロットに配置済み`, detail: `${DAYJP[plc.day]}${plc.period} (${(it.cls || []).join(',')})`, fixableIds: [id] });
    }

    // --- 6. Unplaced items ---
    const unplaced = Object.keys(state.items).filter(id => !state.placements[id]);
    if (unplaced.length) {
      const names = unplaced.slice(0, 5).map(id => { const it = state.items[id]; const sc = state.subjectCfg[it.subjKey] || {}; return (sc.abbr || it.subj || id) + `(${(it.cls || []).join(',')})`; });
      issues.push({ level: 'warn', title: `未配置コマが${unplaced.length}件あります`, detail: names.join('、') + (unplaced.length > 5 ? `他${unplaced.length - 5}件…` : ''), fixableIds: unplaced.slice(0, 8) });
    }

    return issues;
  }

  // Build full matrix: rows=all keys (teachers or classes), cols=day×period
  // Optimized for A3 single-sheet output with adjustable cell size
  function buildMatrixHTML(kind, keys, idx, maxP, opt, layout, cellH = 32, fontSize = 9) {
    const align = state.ui.printAlign || 'center';
    const fontFam = state.ui.printFontFamily || 'system';
    const fontFamilyCSS = _printFontCSS(fontFam);
    const colW = Math.max(28, clamp(cellH, 28, 80));
    const rowH = cellH;
    const mFS = Math.max(7, fontSize - 1);
    const nameW = 72;
    // Build header
    let html = `<div style="overflow-x:auto;font-size:${mFS}px;font-family:${fontFamilyCSS}">`;
    html += `<table class="t2 print-matrix" style="table-layout:fixed;width:${nameW + DAYS.length * maxP * colW + 20}px;font-family:${fontFamilyCSS}">`;
    html += `<thead>`;
    // Row 1: name + day headers
    html += `<tr><th rowspan="2" style="width:${nameW}px;min-width:${nameW}px;vertical-align:middle;text-align:center;background:#e8f0fe">${kind === 'teacher' ? '教員' : kind === 'class' ? 'クラス' : kind === 'room' ? '教室' : '対象'}</th>`;
    for (const day of DAYS) {
      const periodsInDay = maxPeriod(day);
      html += `<th colspan="${maxP}" style="text-align:center;background:#f1f5f9;font-size:${mFS + 1}px;font-weight:900">${DAYJP[day]}</th>`;
    }
    html += `</tr>`;
    // Row 2: period numbers
    html += `<tr>`;
    for (const day of DAYS) {
      for (let p = 1; p <= maxP; p++) {
        const overMaxP = p > maxPeriod(day);
        html += `<th style="width:${colW}px;min-width:${colW}px;background:${overMaxP ? '#f8fafc' : '#f8fafc'};font-size:${mFS - 1}px;color:${overMaxP ? '#cbd5e1' : '#64748b'};padding:2px 0;text-align:center">${p}</th>`;
      }
    }
    html += `</tr></thead><tbody>`;
    // Data rows: one per key (teacher or class)
    for (const key of keys) {
      const shortKey = key.length > 8 ? key.slice(0, 7) + '…' : key;
      html += `<tr><th style="height:${rowH}px;width:${nameW}px;min-width:${nameW}px;font-size:${mFS}px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;background:#fafcff;padding:1px 4px;text-align:left" title="${escapeHtml(key)}">${escapeHtml(shortKey)}</th>`;
      for (const day of DAYS) {
        for (let p = 1; p <= maxP; p++) {
          const overMaxP = p > maxPeriod(day);
          if (overMaxP) { html += `<td class="forbidden" style="height:${rowH}px;width:${colW}px;min-width:${colW}px"></td>`; continue; }
          const ids = idsInCellForRow(kind, key, day, p, idx).filter(id => !isSpanFill(id, day, p));
          if (!ids.length) { html += `<td style="height:${rowH}px;width:${colW}px;min-width:${colW}px"></td>`; continue; }
          const cells = ids.map(id => {
            const it = state.items[id]; if (!it) return '';
            const scfg = state.subjectCfg[it.subjKey] || {};
            const abbr = scfg.abbr || it.subj || '';
            const color = scfg.color || pickColor(it.subjKey) || '#e2e8f0';
            const bg = hexWithAlpha(color, 0.28);
            const line2parts = [];
            if (opt.showTea && kind !== 'teacher' && it.teas?.length) line2parts.push(it.teas.map(t => (state.teacherCfg[t]?.abbr || t)).join(','));
            if (opt.showCls && kind !== 'class' && it.cls?.length) line2parts.push(it.cls.join(','));
            if (opt.showRoom && it.rooms?.length) line2parts.push(it.rooms.join(','));
            const sub2 = line2parts.length ? `<div style="font-size:${mFS - 2}px;color:#475569;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(line2parts.join(' '))}</div>` : '';
            return `<div style="background:${bg};border-left:2px solid ${color};border-radius:2px;padding:1px 2px;margin-bottom:1px;overflow:hidden;text-align:${align};font-family:${fontFamilyCSS}" title="${escapeHtml(abbr)}"><div style="font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(abbr.slice(0, 7))}</div>${sub2}</div>`;
          }).join('');
          html += `<td style="height:${rowH}px;width:${colW}px;min-width:${colW}px;padding:1px;vertical-align:top">${cells}</td>`;
        }
      }
      html += `</tr>`;
    }
    html += `</tbody></table></div>`;
    return html;
  }

  /* =======================
     Keyboard Help Modal (v34.3)
  ======================= */
  function showKeyboardHelp() {
    const shortcuts = [
      { key: 'Ctrl+Z', desc: '元に戻す' },
      { key: 'Ctrl+Y / Ctrl+Shift+Z', desc: 'やり直し' },
      { key: 'Esc', desc: '選択解除' },
      { key: 'Delete / Backspace', desc: '選択中のコマを在庫へ' },
      { key: '→ / ←', desc: '次/前の未配置コマへジャンプ' },
      { key: 'Space / Enter', desc: '選択中の未配置コマを即配置' },
      { key: 'L', desc: '選択中のコマをロック/解除' },
      { key: 'S', desc: '選択中のコマの提案を開く' },
      { key: 'A', desc: 'AI探索 開始/停止' },
      { key: 'R', desc: '修復モード実行' },
      { key: 'Ctrl+A', desc: '在庫を全選択（編集タブ）' },
      { key: 'Ctrl+クリック', desc: '在庫の複数選択（追加/除去）' },
      { key: '?', desc: 'このヘルプを表示' },
    ];
    const html = `
    <div class="kb-help-wrap">
      <table class="kb-help-table">
        <thead>
          <tr><th>キー</th><th>機能</th></tr>
        </thead>
        <tbody>
          ${shortcuts.map(s => `<tr>
            <td class="kb-key">${escapeHtml(s.key)}</td>
            <td class="kb-desc">${escapeHtml(s.desc)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
      <div class="kb-hint">💡 コマを選択してから S キーを押すと提案が開きます</div>
      <div style="margin-top:12px;text-align:center">
        <button onclick="showVersionInfo()" style="font-size:11px;padding:4px 12px;background:#f1f5f9;border:1px solid #cbd5e1;border-radius:6px;cursor:pointer">
          📋 バージョン情報・修正履歴を見る
        </button>
      </div>
    </div>
  `;
    showModalHTML('⌨️ キーボードショートカット', html, null, '閉じる', '閉じる');
  }

  function showVersionInfo() {
    const html = `
    <div style="padding:8px;max-height:70vh;overflow-y:auto">
      <h2 style="font-size:18px;font-weight:900;margin-bottom:8px;color:#0f172a">📦 時間割作成アプリ v49.0</h2>
      <div style="font-size:12px;color:#64748b;margin-bottom:16px">最終更新: 2026年2月20日</div>
      
      <h3 style="font-size:14px;font-weight:900;margin:12px 0 6px;color:#0f172a">🚀 v49.0 新機能・修正</h3>
      <ul style="font-size:12px;line-height:1.6;color:#334155;margin:0;padding-left:20px">
        <li><strong>📄 PDFエクスポート:</strong> 印刷タブから直接PDF保存（html2canvas + jsPDF）</li>
        <li><strong>⇉ 並列授業グループ表示:</strong> 同一セルの並列コマを視覚的にグループ化（左ボーダー＋ヘッダ）</li>
        <li><strong>🎨 フロート窓ドラッグプレビュー強化:</strong> 3色（緑/黄/赤）でリアルタイム制約表示</li>
        <li><strong>🔴 強制上書ドロップモード:</strong> 確認ダイアログなしで即配置（移動先コマを在庫へ）</li>
        <li><strong>🐛 印刷設定初期化バグ修正:</strong> 保存済み揃え・フォント設定が正しく復元されるように</li>
        <li><strong>⌨️ キーボードヘルプ更新:</strong> Ctrl+A・Ctrl+クリック を追加</li>
      </ul>

      <h3 style="font-size:14px;font-weight:900;margin:12px 0 6px;color:#0f172a">📦 v46〜v48 主要機能</h3>
      <ul style="font-size:12px;line-height:1.6;color:#334155;margin:0;padding-left:20px">
        <li><strong>v48:</strong> ドラッグ中リアルタイム制約プレビュー（メイングリッド）、配置不能原因分析、仮配置サンドボックス、スナップ差分テキストレポート</li>
        <li><strong>v47:</strong> 在庫複数選択（Ctrl+クリック/全選択）、スナップ差分表示、教員休憩コマ設定、複数時間割セット管理、教員コマ数バーチャート</li>
        <li><strong>v46:</strong> AIウィザード強化（教員連続/教室競合/同日重複）、SA停滞再加熱、教員/クラス一覧ウィンドウ自動再描画、科目連続禁止制約、教室マトリクス印刷、在庫配置可能性バッジ</li>
      </ul>

      <h3 style="font-size:14px;font-weight:900;margin:12px 0 6px;color:#0f172a">🎯 主要機能一覧</h3>
      <ul style="font-size:12px;line-height:1.6;color:#334155;margin:0;padding-left:20px">
        <li>CSV一括インポート/エクスポート（BOM付きUTF-8対応）</li>
        <li>ドラッグ&ドロップ配置（制約プレビュー付き）</li>
        <li>AI自動配置（SA＋GA＋Greedy・停滞再加熱）</li>
        <li>多視点表示（教員別・クラス別・教室別）＋フロート個人窓</li>
        <li>制約管理（固定禁則・許可枠モード・同日禁止・連続禁止）</li>
        <li>2連続コマ・並列展開・仮配置サンドボックス</li>
        <li>衝突解決ダイアログ・配置提案（6種タブ）</li>
        <li>Undo/Redo・スナップショット差分・複数時間割セット管理</li>
        <li>印刷・PDFエクスポート（マトリクス・個人表・多列対応）</li>
      </ul>

      <h3 style="font-size:14px;font-weight:900;margin:12px 0 6px;color:#0f172a">🔧 技術情報（他AI引き継ぎ用）</h3>
      <div style="font-size:11px;background:#f8fafc;padding:8px;border-radius:6px;border:1px solid #e2e8f0;font-family:monospace;white-space:pre-wrap;line-height:1.5;color:#1e293b">state構造:
  rawRows: 入力データ配列
  items: {id: {subjKey, cls[], teas[], rooms[], span, parallel}}
  placements: {id: {day, period, locked}}
  subjectCfg: {key: {abbr, color, dept, fixedForbid, allowedMode, allowedSlots, noSameDay, noConsec, maxPerDay}}
  teacherCfg: {key: {abbr, maxDaily, maxConsec, unavailable, allowedMode, allowedSlots, breakSlots}}
  settings: {periodsByDay, lunchAfter, roomConflict, teaDefaultMaxDaily, teaDefaultMaxConsec}
  ui: {viewMode, selectedId, stockMultiSel, floats[], drop, printAlign, printFontFamily, ...}

主要関数:
  buildIndex() — idx.tea/cls/room キャッシュ構築
  validatePlacement(id, day, period, mode, swapTarget) — 制約チェック
  placeItem(id, day, period, opts) — UIから配置（衝突ダイアログあり）
  doPlace(id, day, period, swapTarget) — 直接配置
  computeSuggestionPack(id) — 提案生成（6タブ）
  aiTrialOnce(basePlacements) — AI 1トライアル
  exportPDF() — PDF直接保存

デバッグ:
  buildIndex()
  _wizardIssues = _buildWizardIssues(); console.log(_wizardIssues)
  localStorage: ultimate_tt_state_v271</div>
    </div>
  `;
    showModalHTML('📋 バージョン情報 v36.3', html, null, '閉じる', '閉じる');
  }
  window.showVersionInfo = showVersionInfo;

  function bindSplitters() {
    const splitV = $('#split-stock');
    const splitP = $('#split-prop');
    const splitTop = $('#split-stock-top');
    const stock = $('#stock-panel');
    const prop = $('#prop-panel');
    const grid = $('#grid-wrapper');

    function dragV(split, leftEl, propName, min = 200, max = 600) {
      let startX = 0, startW = 0;
      split.onmousedown = (ev) => {
        startX = ev.clientX; startW = leftEl.getBoundingClientRect().width;
        const move = (e) => {
          const dx = e.clientX - startX;
          const w = clamp(startW + dx, min, max);
          leftEl.style.width = w + 'px';
        };
        const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); applyDensity(); };
        window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
      };
    }
    if (splitV && stock) dragV(splitV, stock, 'width', 280, 720);
    if (splitP && prop) dragV(splitP, prop, 'width', 260, 620);

    if (splitTop) {
      // In stock-top mode the grid row height is driven by --stockTopH on body,
      // NOT by stock.style.height. Read CSS var for startH.
      let startY = 0, startH = 0;
      const getStockTopH = () => {
        const v = document.body.style.getPropertyValue('--stockTopH');
        return v ? parseInt(v) : (state.ui.stockTopH || 260);
      };
      splitTop.onmousedown = (ev) => {
        ev.preventDefault();
        startY = ev.clientY;
        startH = getStockTopH();
        const move = (e) => {
          const dy = e.clientY - startY;
          const h = clamp(startH + dy, 80, window.innerHeight - 200);
          state.ui.stockTopH = h;
          document.body.style.setProperty('--stockTopH', h + 'px');
        };
        const up = () => {
          window.removeEventListener('mousemove', move);
          window.removeEventListener('mouseup', up);
          markDirty('ui');
        };
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
      };
    }
  }

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
      const doReflect = () => { reflectRawToItems(); switchTab('edit'); };
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
    ['#p-mon', '#p-tue', '#p-wed', '#p-thu', '#p-fri', '#lunch-after', '#chk-room-conflict', '#school-tea-maxdaily', '#school-tea-maxconsec']
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
      showCtxMenu(modes.map(m => ({
        label: (m.value === cur ? '✓ ' : '　') + m.label,
        on: () => { state.ui.colorMode = m.value; markDirty('ui'); rerenderAll(); }
      })), ev.clientX, ev.clientY);
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
          flash('未配置・違反ともにありません（探索不要）');
          aiRunner.running = false;
          btnRun.textContent = 'AI探索開始'; btnRun.classList.remove('danger'); btnRun.disabled = false;
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
    $('#btn-pdf-export')?.addEventListener('click', () => { try { exportPDF(); } catch (e) { console.error(e); flash('PDFエラー: ' + e.message); } });
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
    const btnAnalyze = document.getElementById('btn-analyze');
    if (btnAnalyze) {
      btnAnalyze.onclick = () => {
        if (typeof showProblemAnalysisPanel === 'function') {
          showProblemAnalysisPanel();
        } else {
          console.warn('showProblemAnalysisPanel not available');
        }
      };
    }

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

    for (const key of candidates) {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const obj = JSON.parse(raw);
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
    if (!state.rawRows.length) addRow();
    rebuildMastersFromRaw();
    if (!Object.keys(state.items).length) reflectRawToItems(); // build initial
    bindEvents();
    renderSnapshotList();
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
        buildIndex, clampInt, deepClone, flash, isSpanFill,
        teacherDailyMax, teacherConsecMax, teacherDayCount,
        chainQualityScore, clearValidSlots, simulateMoves,
        normalizeAbbr, showModal, showModalHTML
      });
    } catch (e) { }
  }

  document.addEventListener('DOMContentLoaded', init);

})(); // IIFE end

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

  for (const day of DAYS) {
    const maxP = maxPeriod(day);
    for (let p = 1; p <= maxP; p++) {
      if ((it.span || 1) === 2 && p === maxP) continue;
      if (curPlc && curPlc.day === day && curPlc.period === p) continue;

      const testMoves = [...baseMovesArr, { id, day, period: p, span: it.span || 1 }];
      const info = puzWithTempMoves(testMoves, () => {
        const idx = buildIndex();
        const v = validatePlacement(id, day, p, 'safe', null) || { blocks: ['不明'], warns: [] };
        const blockers = puzBlockerIdsFromIdx(it, id, day, p, idx);
        return { v, blockers };
      });

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

      out.push({ day, p, score, blockersN: blockers.length });
    }
  }

  out.sort((a, b) => b.score - a.score);
  return out.slice(0, PUZ_CFG.SLOT_CANDS);
}


function puzSearch(targetId, targetDay, targetP) {
  const tIt = state.items[targetId]; if (!tIt) return null;

  let visits = 0;
  const seen = new Set();

  function keyOf(moveById) {
    const ent = Object.values(moveById)
      .map(m => `${m.id}@${m.day}${m.period}`)
      .sort()
      .join('|');
    return ent;
  }

  function pickNextConflict(moves) {
    let worst = null;
    for (const m of moves) {
      const inf = puzEvalMove(moves, m.id);
      if (inf.blocks.length === 0) continue;
      if (!worst || (inf.blockers.length > worst.blockers.length)) worst = inf;
    }
    return worst;
  }

  function dfs(moveById) {
    visits++;
    if (visits > PUZ_CFG.MAX_VISITS) return null;
    if (Object.keys(moveById).length > PUZ_CFG.MAX_INVOLVED) return null;

    const moves = Object.values(moveById);

    for (const m of moves) {
      const inf = puzEvalMove(moves, m.id);
      if (inf.blocks.length && inf.blockers.length === 0) return null;
    }

    const sig = keyOf(moveById);
    if (seen.has(sig)) return null;
    seen.add(sig);

    const worst = pickNextConflict(moves);
    if (!worst) {
      const sim = simulateMoves(moves);
      return sim.ok ? moves : null;
    }

    const blockers = (worst.blockers || []).filter(b => puzIsMovable(b, moveById));
    if (!blockers.length) return null;

    for (const blk of blockers) {
      const baseMovesArr = Object.values(moveById);
      const slots = puzCandidateSlots(blk, baseMovesArr);
      for (const s of slots) {
        const bit = state.items[blk];
        const next = { ...moveById };
        next[blk] = { id: blk, day: s.day, period: s.p, span: bit?.span || 1 };
        const res = dfs(next);
        if (res) return res;
      }
    }
    return null;
  }

  const init = {};
  init[targetId] = { id: targetId, day: targetDay, period: targetP, span: tIt.span || 1 };
  return dfs(init);
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
  for (const t of candTargets) {
    if (out.length >= PUZ_CFG.MAX_SUGS) break;
    const moves = puzSearch(id, t.day, t.p);
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
    <button onclick="this.closest('[style*=fixed]').remove()" style="
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
          重大問題 (${problems.critical.length}件)
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
    overlay.onclick = () => {
      overlay.remove();
      modal.remove();
    };

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

    for (const day of DAYS) {
      const maxP = maxPeriod(day);
      for (let p = 1; p <= maxP; p++) {
        if ((it.span || 1) === 2 && p === maxP) continue;
        if (curPlc && curPlc.day === day && curPlc.period === p) continue;

        const testMoves = [...baseMovesArr, { id, day, period: p, span: it.span || 1 }];
        const info = puzWithTempMoves(testMoves, () => {
          const idx = buildIndex();
          const v = validatePlacement(id, day, p, 'safe', null) || { blocks: ['不明'], warns: [] };
          const blockers = puzBlockerIdsFromIdx(it, id, day, p, idx);
          return { v, blockers, idx };
        });

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

      let dead = false;
      for (const m of moves) {
        const inf = puzEvalMove(moves, m.id);
        if (inf.blocks.length && inf.blockers.length === 0) { dead = true; break; }
      }
      if (dead) continue;

      const worst = pickWorstBlock(moves);

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

      const blkList = blockers.slice(0, deep ? 6 : 3);
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
      let dead = false;
      for (const m of moves) {
        const inf = puzEvalMove(moves, m.id);
        if (inf.blocks.length && inf.blockers.length === 0) { dead = true; break; }
      }
      if (dead) continue;

      const worst = pickWorstBlock(moves);

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
      const blkList = blockers.slice(0, deep ? 6 : 3);
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
