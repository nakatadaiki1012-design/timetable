/* =====================================================================
   クラウド保存・共有（Firebase Realtime Database + Googleログイン）
   - 設定は firebase-config.js の window.FIREBASE_CONFIG
   - Firebase の部品は「☁ クラウド」を押した時にだけ読み込む（使わない人には影響しない）
   - データの形:
       timetables/{id}/meta    … {owner(uid), ownerEmail, name, updatedAt, updatedBy}
       timetables/{id}/members … {メールキー: 'view' | 'edit'}
       timetables/{id}/data    … 時間割（ファイル保存と同じ中身）をJSON文字列で
       userTimetables/{uid}/{id}      … 自分が作った時間割の一覧（名前）
       sharedWith/{メールキー}/{id}   … 自分に共有された時間割の一覧（名前）
   - 読み書きの許可は database.rules.json（本人と共有相手だけ）
   ===================================================================== */
(() => {
  'use strict';
  const SDK = 'https://www.gstatic.com/firebasejs/10.14.1/';
  const LS_CUR = 'tt_cloud_current_v1';
  const emu = /[?&]emu=1\b/.test(location.search); // 試験用データベース（開発用）
  let fb = null, auth = null, db = null, user = null, loading = null;
  let cur = null;        // {id, name, role, updatedAt}
  let unwatch = null;

  const emailKey = (e) => String(e || '').trim().toLowerCase().replace(/\./g, ',');
  const keyToEmail = (k) => String(k || '').replace(/,/g, '.');
  const esc = (s) => (window.escapeHtml ? window.escapeHtml(s) : String(s ?? ''));
  const say = (m, ms) => { try { window.flash(m, ms); } catch (e) { console.log(m); } };
  const newId = () => 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const configured = () => !!(window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.apiKey && window.FIREBASE_CONFIG.projectId);
  const LS_DBURL = 'tt_cloud_dburl_v1';

  // Realtime Database の住所は「プロジェクト名＋保存場所」で決まる。設定に無い場合は候補を順に確かめて実在するものを使う。
  //   実在するDBは（ロック中でも）401/200 を返し、存在しない住所は 404 などを返す。
  async function resolveDatabaseURL() {
    const cfg = window.FIREBASE_CONFIG;
    if (cfg.databaseURL) return cfg.databaseURL;
    try { const c = localStorage.getItem(LS_DBURL); if (c) return c; } catch (e) { }
    const p = cfg.projectId;
    const cands = [
      `https://${p}-default-rtdb.asia-southeast1.firebasedatabase.app`,
      `https://${p}-default-rtdb.firebaseio.com`,
      `https://${p}-default-rtdb.europe-west1.firebasedatabase.app`,
    ];
    for (const u of cands) {
      try {
        const r = await fetch(u + '/.json?shallow=true', { method: 'GET' });
        if (r.status === 200 || r.status === 401) {
          try { localStorage.setItem(LS_DBURL, u); } catch (e) { }
          return u;
        }
      } catch (e) { /* 通信できない候補は飛ばす */ }
    }
    const err = new Error('Realtime Database がまだ作られていないようです。Firebaseコンソールの「構築」→「Realtime Database」→「データベースを作成」で作ってください（場所はシンガポール、ルールはロックモード）。');
    err.code = 'no-database';
    throw err;
  }

  try { cur = JSON.parse(localStorage.getItem(LS_CUR) || 'null'); } catch (e) { cur = null; }
  const saveCur = () => { try { localStorage.setItem(LS_CUR, JSON.stringify(cur)); } catch (e) { } updateBadge(); };

  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement('script'); s.src = src; s.onload = res;
      s.onerror = () => rej(new Error('Firebaseの部品を読み込めませんでした（ネットワークを確認してください）'));
      document.head.appendChild(s);
    });
  }
  function ensureFirebase() {
    if (fb) return Promise.resolve();
    if (loading) return loading;
    loading = (async () => {
      if (!window.firebase) {
        await loadScript(SDK + 'firebase-app-compat.js');
        await loadScript(SDK + 'firebase-auth-compat.js');
        await loadScript(SDK + 'firebase-database-compat.js');
      }
      fb = window.firebase;
      const cfg = { ...window.FIREBASE_CONFIG };
      if (!emu) cfg.databaseURL = await resolveDatabaseURL();
      const app = fb.apps.length ? fb.app() : fb.initializeApp(cfg);
      auth = app.auth(); db = app.database();
      if (emu) { auth.useEmulator('http://127.0.0.1:9099'); db.useEmulator('127.0.0.1', 9000); }
      await new Promise(r => { const off = auth.onAuthStateChanged(u => { user = u; off(); r(); }); });
      auth.onAuthStateChanged(u => { user = u; updateBadge(); if (!u) stopWatch(); else if (cur) watch(cur.id); });
      if (user && cur) watch(cur.id);
    })();
    loading.catch(() => { loading = null; });
    return loading;
  }

  async function signIn() {
    const p = new fb.auth.GoogleAuthProvider();
    p.setCustomParameters({ prompt: 'select_account' });
    try { await auth.signInWithPopup(p); }
    catch (e) {
      // スマホ等でポップアップが使えない場合は画面遷移方式で
      if (/popup/i.test(e.code || '')) { await auth.signInWithRedirect(p); return; }
      throw e;
    }
  }

  // ── 一覧 ──
  async function listMine() {
    const s = await db.ref('userTimetables/' + user.uid).get();
    return Object.entries(s.val() || {}).map(([id, name]) => ({ id, name, role: 'owner' }));
  }
  async function listShared() {
    const s = await db.ref('sharedWith/' + emailKey(user.email)).get();
    const out = [];
    for (const [id, name] of Object.entries(s.val() || {})) {
      // 共有が解除済みなら読めないので一覧から外す
      try {
        const m = await db.ref('timetables/' + id + '/members/' + emailKey(user.email)).get();
        if (m.exists()) out.push({ id, name, role: m.val() });
      } catch (e) { }
    }
    return out;
  }

  // ── 保存 ──
  async function saveAs(name) {
    const id = newId();
    const payload = window.buildProjectPayload(name);
    const t = Date.now();
    await db.ref().update({
      ['timetables/' + id + '/meta']: { owner: user.uid, ownerEmail: user.email, name, updatedAt: t, updatedBy: user.email },
      ['timetables/' + id + '/data']: JSON.stringify(payload),
      ['userTimetables/' + user.uid + '/' + id]: name,
    });
    cur = { id, name, role: 'owner', updatedAt: t }; saveCur(); watch(id);
    say('☁ 「' + name + '」をクラウドに保存しました');
  }
  async function saveOver() {
    if (!cur) throw new Error('クラウドの時間割が選ばれていません');
    if (cur.role === 'view') throw new Error('この時間割は「見るだけ」で共有されているため、上書きできません。「新しく保存」で自分の時間割として保存できます');
    const metaSnap = await db.ref('timetables/' + cur.id + '/meta').get();
    const meta = metaSnap.val();
    if (!meta) throw new Error('クラウドの時間割が見つかりません（削除された可能性があります）');
    // 他の人が後から保存していたら、上書きしてよいか確認
    if (meta.updatedAt > (cur.updatedAt || 0) && meta.updatedBy !== user.email) {
      const when = new Date(meta.updatedAt).toLocaleString('ja-JP');
      if (!confirm(`${meta.updatedBy} さんが ${when} に保存した内容があります。\nこのまま保存すると、その変更は上書きされて消えます。\n\n上書きしますか？（キャンセルして「開く」で最新を読み込むこともできます）`)) return false;
    }
    const payload = window.buildProjectPayload(cur.name);
    const t = Date.now();
    await db.ref('timetables/' + cur.id).update({ data: JSON.stringify(payload), 'meta/updatedAt': t, 'meta/updatedBy': user.email });
    cur.updatedAt = t; saveCur();
    say('☁ 「' + cur.name + '」をクラウドに上書き保存しました');
    return true;
  }

  // ── 開く ──
  async function open(item) {
    const s = await db.ref('timetables/' + item.id).get();
    const v = s.val();
    if (!v || !v.data) throw new Error('時間割のデータがありません');
    let data; try { data = JSON.parse(v.data); } catch (e) { throw new Error('クラウドのデータが壊れているため開けません'); }
    if (!confirm(`クラウドの「${v.meta.name}」を開きます。\n今の作業内容は置き換わります（Ctrl+Zで元に戻せます）。よろしいですか？`)) return false;
    window.applyProjectData(data, { reason: 'cloudOpen' });
    const role = v.meta.owner === user.uid ? 'owner' : ((v.members || {})[emailKey(user.email)] || 'view');
    cur = { id: item.id, name: v.meta.name, role, updatedAt: v.meta.updatedAt }; saveCur(); watch(item.id);
    say('☁ 「' + v.meta.name + '」を開きました' + (role === 'view' ? '（見るだけ）' : ''));
    return true;
  }

  // ── 共有 ──
  async function getMembers(id) { return (await db.ref('timetables/' + id + '/members').get()).val() || {}; }
  async function setMember(id, name, email, role) {
    const k = emailKey(email);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(email).trim())) throw new Error('メールアドレスの形が正しくありません');
    if (k === emailKey(user.email)) throw new Error('自分自身は追加できません');
    await db.ref().update({ ['timetables/' + id + '/members/' + k]: role, ['sharedWith/' + k + '/' + id]: name });
  }
  async function removeMember(id, k) {
    await db.ref().update({ ['timetables/' + id + '/members/' + k]: null, ['sharedWith/' + k + '/' + id]: null });
  }
  async function deleteTimetable(id) {
    const members = await getMembers(id);
    const up = { ['timetables/' + id + '/data']: null, ['timetables/' + id + '/members']: null, ['timetables/' + id + '/meta']: null, ['userTimetables/' + user.uid + '/' + id]: null };
    for (const k in members) up['sharedWith/' + k + '/' + id] = null;
    await db.ref().update(up);
    if (cur && cur.id === id) { cur = null; saveCur(); stopWatch(); }
  }

  // ── 他の人の保存をお知らせ ──
  function stopWatch() { if (unwatch) { try { unwatch(); } catch (e) { } unwatch = null; } }
  function watch(id) {
    stopWatch();
    if (!db || !user) return;
    const r = db.ref('timetables/' + id + '/meta');
    const cb = r.on('value', (s) => {
      const m = s.val(); if (!m || !cur || cur.id !== id) return;
      if (m.updatedAt > (cur.updatedAt || 0) && m.updatedBy !== user.email) {
        say(`☁ ${m.updatedBy} さんがクラウドの「${m.name}」を更新しました。最新にするには「☁ クラウド」から開き直してください`, 8000);
      }
    }, () => { });
    unwatch = () => r.off('value', cb);
  }

  // ── 画面 ──
  function updateBadge() {
    const b = document.getElementById('btn-cloud'); if (!b) return;
    b.textContent = cur ? '☁ ' + (cur.name.length > 10 ? cur.name.slice(0, 10) + '…' : cur.name) : '☁ クラウド';
    b.title = cur ? 'クラウドの「' + cur.name + '」を開いています' + (cur.role === 'view' ? '（見るだけ）' : '') : 'クラウドに保存・共有';
  }
  const roleLabel = (r) => r === 'owner' ? '作成者' : r === 'edit' ? '編集できる' : '見るだけ';

  async function openPanel() {
    if (!configured()) {
      window.showModalHTML('☁ クラウド', '<div>クラウドの設定がまだありません。<br>管理者が firebase-config.js にFirebaseの設定値を書き込むと使えるようになります。</div>', null, '閉じる', null);
      return;
    }
    window.showModalHTML('☁ クラウド', '<div id="cloud-body" class="cloud-body">読み込み中…</div>', null, '閉じる', null);
    try { await ensureFirebase(); } catch (e) { setBody(`<div class="cloud-err">${esc(e.message)}</div>`); return; }
    render();
  }
  function setBody(html) { const el = document.getElementById('cloud-body'); if (el) el.innerHTML = html; return el; }
  const act = (fn) => async (ev) => {
    const btn = ev && ev.currentTarget; if (btn) btn.disabled = true;
    try { await fn(ev); } catch (e) { console.error(e); say('⚠ ' + friendly(e), 6000); }
    finally { if (btn) btn.disabled = false; render(); }
  };
  function friendly(e) {
    const m = String(e && (e.code || e.message) || e);
    if (/permission[_-]denied/i.test(m)) return 'この操作をする権限がありません（共有の設定を確認してください）';
    if (/network|offline|unavailable/i.test(m)) return 'インターネットにつながっていないため、クラウドと通信できません';
    if (/popup-closed/i.test(m)) return 'ログインが中断されました';
    if (/unauthorized-domain/i.test(m)) return 'このページのアドレスがFirebaseで許可されていません（承認済みドメインに追加してください）';
    return e.message || m;
  }

  async function render() {
    const el = document.getElementById('cloud-body'); if (!el) return;
    if (!user) {
      setBody(`<p>Googleアカウントでログインすると、時間割をクラウドに保存し、選んだ相手と共有できます。</p>
        <button class="btn primary" id="cl-login">Googleでログイン</button>`);
      document.getElementById('cl-login').onclick = act(signIn);
      return;
    }
    setBody('読み込み中…');
    let mine = [], shared = [];
    try { [mine, shared] = await Promise.all([listMine(), listShared()]); }
    catch (e) { setBody(`<div class="cloud-err">${esc(friendly(e))}</div>`); return; }
    const row = (it) => `<li class="cl-item${cur && cur.id === it.id ? ' on' : ''}">
        <span class="cl-name">${esc(it.name)}</span><span class="cl-role">${roleLabel(it.role)}</span>
        <button class="btn secondary cl-open" data-id="${esc(it.id)}">開く</button>
        ${it.role === 'owner' ? `<button class="btn danger cl-del" data-id="${esc(it.id)}" title="クラウドから削除">削除</button>` : ''}</li>`;
    const isOwner = cur && cur.role === 'owner';
    let html = `<div class="cl-user">ログイン中: <b>${esc(user.email)}</b> <button class="btn secondary" id="cl-logout">ログアウト</button></div>
      <div class="cl-sec"><h4>今の時間割</h4>
        ${cur ? `<div>クラウドの「<b>${esc(cur.name)}</b>」（${roleLabel(cur.role)}）を開いています</div>` : '<div class="muted">まだクラウドに保存していません</div>'}
        <div class="cl-btns">
          ${cur && cur.role !== 'view' ? '<button class="btn primary" id="cl-save">クラウドに上書き保存</button>' : ''}
          <button class="btn secondary" id="cl-saveas">新しくクラウドに保存</button>
        </div></div>
      <div class="cl-sec"><h4>自分の時間割</h4>${mine.length ? '<ul class="cl-list">' + mine.map(row).join('') + '</ul>' : '<div class="muted">ありません</div>'}</div>
      <div class="cl-sec"><h4>共有された時間割</h4>${shared.length ? '<ul class="cl-list">' + shared.map(row).join('') + '</ul>' : '<div class="muted">ありません</div>'}</div>`;
    if (isOwner) {
      let members = {};
      try { members = await getMembers(cur.id); } catch (e) { }
      const mrows = Object.entries(members).map(([k, r]) => `<li class="cl-item"><span class="cl-name">${esc(keyToEmail(k))}</span>
          <select class="sel cl-mrole" data-k="${esc(k)}"><option value="view"${r === 'view' ? ' selected' : ''}>見るだけ</option><option value="edit"${r === 'edit' ? ' selected' : ''}>編集できる</option></select>
          <button class="btn danger cl-mdel" data-k="${esc(k)}">共有をやめる</button></li>`).join('');
      html += `<div class="cl-sec"><h4>「${esc(cur.name)}」を共有する相手</h4>
        ${mrows ? '<ul class="cl-list">' + mrows + '</ul>' : '<div class="muted">まだ誰とも共有していません</div>'}
        <div class="cl-add"><input id="cl-email" class="sel" type="email" placeholder="相手のGoogleアカウントのメールアドレス">
        <select id="cl-role" class="sel"><option value="view">見るだけ</option><option value="edit">編集できる</option></select>
        <button class="btn primary" id="cl-addbtn">共有する</button></div>
        <div class="muted small">相手は同じページで「☁ クラウド」→ Googleでログイン すると「共有された時間割」に表示されます。</div></div>`;
    }
    setBody(html);
    const $ = (s) => document.getElementById(s);
    $('cl-logout').onclick = act(async () => { await auth.signOut(); });
    if ($('cl-save')) $('cl-save').onclick = act(saveOver);
    $('cl-saveas').onclick = act(async () => {
      const name = prompt('クラウドに保存する名前', (cur && cur.name) || ('時間割 ' + new Date().toLocaleDateString('ja-JP')));
      if (name && name.trim()) await saveAs(name.trim().slice(0, 100));
    });
    document.querySelectorAll('#cloud-body .cl-open').forEach(b => b.onclick = act(async () => {
      const it = [...mine, ...shared].find(x => x.id === b.dataset.id); if (it) await open(it);
    }));
    document.querySelectorAll('#cloud-body .cl-del').forEach(b => b.onclick = act(async () => {
      const it = mine.find(x => x.id === b.dataset.id);
      if (it && confirm(`クラウドの「${it.name}」を削除します。共有していた人も見られなくなります。よろしいですか？\n（今の画面の時間割は消えません）`)) { await deleteTimetable(it.id); say('☁ 削除しました'); }
    }));
    if (isOwner) {
      $('cl-addbtn').onclick = act(async () => { await setMember(cur.id, cur.name, $('cl-email').value, $('cl-role').value); say('☁ 共有しました'); });
      document.querySelectorAll('#cloud-body .cl-mrole').forEach(s => s.onchange = act(async () => { await setMember(cur.id, cur.name, keyToEmail(s.dataset.k), s.value); }));
      document.querySelectorAll('#cloud-body .cl-mdel').forEach(b => b.onclick = act(async () => {
        if (confirm(keyToEmail(b.dataset.k) + ' との共有をやめますか？')) await removeMember(cur.id, b.dataset.k);
      }));
    }
  }

  function init() {
    const btn = document.getElementById('btn-cloud');
    if (btn) btn.addEventListener('click', openPanel);
    updateBadge();
    // ログイン済みなら、他の人の保存のお知らせを受け取るため裏で接続
    if (configured() && cur) ensureFirebase().catch(() => { });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  // 開発・試験用（試験用データベース使用時のみ）
  if (emu) window.__cloud = {
    ensureFirebase, saveAs, saveOver, open, setMember, removeMember, deleteTimetable, listMine, listShared,
    get user() { return user; }, get cur() { return cur; },
    async testLogin(email) {
      await ensureFirebase();
      const cred = fb.auth.GoogleAuthProvider.credential(JSON.stringify({ sub: 'u_' + email.replace(/\W/g, '_'), email, email_verified: true }));
      await auth.signInWithCredential(cred); user = auth.currentUser;
    },
  };
})();
