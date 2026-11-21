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
  // 【A-3】土曜(6日制)・日曜対応。DAYS は参照を保ったまま中身を差し替える（148箇所の参照を壊さない）。
  // 既定は月〜金。6日制ファイル読込時などに setActiveDayCount(6) で土曜を含む形に伸縮する。
  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  const DAYJP = { Mon: '月', Tue: '火', Wed: '水', Thu: '木', Fri: '金', Sat: '土', Sun: '日' };
  const ALL_DAY_KEYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  // 土曜の時限数が1以上なら6日制、0なら5日制として曜日列を伸縮する（保存データ読込時にも効く）
  function syncDaysFromSettings() {
    const sat = parseInt(state?.settings?.periodsByDay?.Sat, 10) || 0;
    const want = sat > 0 ? 6 : 5;
    if (DAYS.length !== want) setActiveDayCount(want);
  }
  function setActiveDayCount(n) {
    n = Math.max(1, Math.min(7, parseInt(n, 10) || 5));
    DAYS.length = 0;
    for (let i = 0; i < n; i++) DAYS.push(ALL_DAY_KEYS[i]);
  }
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
  /* 教科グループ別の色系統（同じ教科は近い色、教科どうしは離れた色）
     学校で慣れた配色（国語=赤、数学=青、理科=緑…）に寄せる */
  const SUBJ_FAMILIES = [
    { g: 'kokugo', name: '国語', h: 352, s: 78, l: 50, re: /国語|現代の国|言語文化|論理国|文学国|古典|古文|漢文|現国|言文|^文[\/／]|^古総|国表/ },
    { g: 'chireki', name: '地理歴史', h: 26, s: 85, l: 46, re: /地理|歴史|日本史|世界史|地歴|^日世|^世地|^日[物化生]|社会/ },
    { g: 'koumin', name: '公民', h: 44, s: 85, l: 40, re: /公民|公共|倫理|政治|政経|現社/ },
    { g: 'sugaku', name: '数学', h: 218, s: 82, l: 50, re: /数学|^数|言語数/ },
    { g: 'rika', name: '理科', h: 142, s: 62, l: 38, re: /理科|^理$|物理|化学|生物|地学|^(物|化|生)(基|$)/ },
    { g: 'eigo', name: '英語', h: 272, s: 60, l: 52, re: /英語|外国語|^英|コミュ|論理・表現|論表/ },
    { g: 'taiiku', name: '保健体育', h: 190, s: 85, l: 38, re: /保健|体育|^保体/ },
    { g: 'geijutsu', name: '芸術', h: 322, s: 70, l: 50, re: /芸術|音楽|美術|書道|工芸|^音|^美|^書|クラフト|器楽/ },
    { g: 'katei', name: '家庭', h: 66, s: 75, l: 34, re: /家庭|家基|家総|フード|保育|服飾|^家/ },
    { g: 'joho', name: '情報', h: 236, s: 30, l: 46, re: /情報|^情/ },
    { g: 'tokkatsu', name: '総探・LHR・行事など', h: 210, s: 12, l: 50, re: /LHR|ＬＨＲ|HR|総合|探究の時間|総探|行事|クラブ|参観|自由選択|^選択$/ },
    { g: 'kaigi', name: '会議・研修など', h: 30, s: 8, l: 44, re: /会議|研修|企画|G$|委員/ },
  ];
  function subjFamily(key) {
    const sc = state?.subjectCfg?.[key] || {};
    const dept = String(sc.dept || '');
    const name = String(key || '');
    // 「自選物理基礎」「自選(月)英語…」などは中身の教科で判定
    const core = name.replace(/^自選(\([^)]*\))?/, '');
    for (const f of SUBJ_FAMILIES) if (f.g !== 'tokkatsu' && f.g !== 'kaigi' && dept && f.re.test(dept)) return f;
    for (const f of SUBJ_FAMILIES) if (core && f.re.test(core)) return f;
    for (const f of SUBJ_FAMILIES) if (f.re.test(name)) return f;
    return null;
  }
  let _famIdxCache = null, _famIdxSig = '';
  function familyMemberIndex(fam, key) {
    const keys = Object.keys(state?.subjectCfg || {});
    const sig = keys.length + ':' + keys.slice(0, 3).join('|');
    if (!_famIdxCache || _famIdxSig !== sig) {
      _famIdxCache = {}; _famIdxSig = sig;
      for (const k of keys) { const f = subjFamily(k); if (f) (_famIdxCache[f.g] ||= []).push(k); }
    }
    const list = _famIdxCache[fam.g] || [key];
    const i = list.indexOf(key);
    return { i: i < 0 ? hashStr(key) % Math.max(1, list.length) : i, n: Math.max(1, list.length) };
  }
  // 色の見本：どの色がどの教科か、しま模様が何を表すかを一覧で見せる
  function showColorLegend() {
    const groups = new Map();
    const used = new Set(Object.values(state.items).map(it => it.subjKey));
    for (const k of Object.keys(state.subjectCfg || {})) {
      if (!used.has(k)) continue;
      const f = subjFamily(k);
      const name = f ? f.name : 'その他';
      if (!groups.has(name)) groups.set(name, { order: f ? SUBJ_FAMILIES.indexOf(f) : 99, items: [] });
      const sc = state.subjectCfg[k] || {};
      groups.get(name).items.push({ label: sc.abbr || k, color: sc.color || pickColor(k) });
    }
    const chip = (label, color, stripe) => `<span style="display:inline-block;margin:2px 4px 2px 0;padding:3px 8px;border-radius:6px;border-left:${stripe ? '6px double' : '4px solid'} ${color};font-weight:800;font-size:12px;color:#0f172a;background:${stripe ? `repeating-linear-gradient(135deg, ${paleColor(color, 0.2)} 0 6px, ${paleColor(color, 0.34)} 6px 9px)` : paleColor(color, 0.2)}">${escapeHtml(label)}</span>`;
    const rows = [...groups.entries()].sort((a, b) => a[1].order - b[1].order).map(([name, g]) =>
      `<tr><th style="text-align:left;white-space:nowrap;padding:4px 10px 4px 0;vertical-align:top;font-size:13px">${escapeHtml(name)}</th><td style="padding:2px 0">${g.items.slice(0, 14).map(x => chip(x.label, x.color)).join('')}${g.items.length > 14 ? `<span style="color:#64748b;font-size:11px">ほか${g.items.length - 14}科目</span>` : ''}</td></tr>`).join('');
    const html = `<div style="max-height:60vh;overflow:auto;text-align:left">
      <div style="margin-bottom:10px;padding:8px 10px;background:#f8fafc;border-radius:8px;font-size:13px;line-height:1.9">
        ${chip('無地', '#2563eb')} 1クラスだけの授業<br>
        ${chip('しま模様', '#2563eb', true)} 他のクラスと一緒の授業（合同・選択・並列・同時展開）
      </div>
      <table style="border-collapse:collapse;width:100%">${rows}</table>
      <div style="margin-top:8px;color:#64748b;font-size:11px">色は「2 科目設定」で科目ごとに変えられます。</div></div>`;
    showModalHTML('🎨 色の見本', html.replace(/\n\s*/g, ''), null, '閉じる', null);
  }
  function pickColor(key) {
    try {
      const fam = subjFamily(key);
      if (fam) {
        // 同じ教科グループ内は色相±16°・明度±8%で散らす（系統を保ったまま見分けられる程度）
        const { i, n } = familyMemberIndex(fam, key);
        const t = n <= 1 ? 0.5 : i / (n - 1);
        const hShift = Math.round((t - 0.5) * 32);
        const lShift = ((i % 3) - 1) * 8;
        return hslToHex((fam.h + hShift + 360) % 360, fam.s, Math.max(28, Math.min(60, fam.l + lShift)));
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
  // 【B-3】コマ背景用の淡色（明度88%前後）を返す。文字は濃色にしコントラスト比4.5以上を確保する。
  function paleColor(hex, mix = 0.16) {
    try {
      const m = (hex || '#888888').replace('#', '');
      const r = parseInt(m.slice(0, 2), 16), g = parseInt(m.slice(2, 4), 16), b = parseInt(m.slice(4, 6), 16);
      const pr = Math.round(255 - (255 - r) * mix);
      const pg = Math.round(255 - (255 - g) * mix);
      const pb = Math.round(255 - (255 - b) * mix);
      return `rgb(${pr},${pg},${pb})`;
    } catch (e) { return '#f1f5f9'; }
  }
  // コマの背景：単独コマ＝無地、他クラス展開（合同・選択・並列・同時展開）＝斜めストライプ
  function isMultiClassLesson(it) {
    return !!(it && (((it.cls || []).length > 1) || it.parallel || it.simul));
  }
  function applyLessonBg(el, it, color) {
    const base = paleColor(color, 0.2);
    if (state.ui?.colorMode !== 'type' && isMultiClassLesson(it)) {
      const stripe = paleColor(color, 0.34);
      el.style.background = `repeating-linear-gradient(135deg, ${base} 0 6px, ${stripe} 6px 9px)`;
      el.classList.add('multi-cls');
    } else {
      el.style.background = base;
    }
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

