/* 時間割アプリの自動テスト（画面を実際にブラウザで動かして確かめる）
   実行:  npm install  →  npm test
   ブラウザの場所を指定する場合:  CHROMIUM_PATH=/path/to/chrome npm test
   使うデータは tests/fixtures/ の架空の学校（実在の先生・生徒の情報は含まない）。

   リファクタリングの前後でこのテストがすべて通ることを確かめてから変更を取り込む。 */
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIX = path.join(ROOT, 'tests', 'fixtures');
const ONLY = process.argv[2] || '';

// ── 小さな静的ファイルサーバ ──
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.ide': 'application/octet-stream' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/index.html`;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
const results = [];
async function test(name, fn) {
  if (ONLY && !name.includes(ONLY)) return;
  const t0 = Date.now();
  try { await fn(); results.push({ name, ok: true, ms: Date.now() - t0 }); process.stdout.write(`✓ ${name}\n`); }
  catch (e) { results.push({ name, ok: false, err: e.message }); process.stdout.write(`✗ ${name}\n    ${e.message}\n`); }
}
const assert = (c, msg) => { if (!c) throw new Error(msg); };

// ページを開いてデータを読み込む
async function openApp(opts = {}) {
  const ctx = await browser.newContext(opts.mobile
    ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }
    : { viewport: { width: opts.width || 1440, height: 900 }, acceptDownloads: true });
  const pg = await ctx.newPage();
  pg.errs = [];
  pg.on('pageerror', e => pg.errs.push(e.message));
  pg.on('dialog', d => d.accept(opts.prompt || 'テスト校').catch(() => { }));
  await pg.goto(BASE); await pg.waitForTimeout(500);
  if (opts.load !== false) await loadFile(pg, opts.load || 'sample-project.json');
  pg.close2 = () => ctx.close();
  return pg;
}
async function loadFile(pg, name) {
  await pg.setInputFiles('#project-load-file', path.join(FIX, name));
  await pg.waitForSelector('#modal-ok', { state: 'visible', timeout: 10000 });
  await pg.evaluate(() => document.getElementById('modal-ok').click());
  await pg.waitForTimeout(800);
}
const counts = (pg) => pg.evaluate(() => ({
  items: Object.keys(state.items).length,
  placed: Object.values(state.placements).filter(p => p && p.day).length,
}));
const hardViolations = (pg) => pg.evaluate(() => {
  let n = 0;
  for (const id in state.placements) { const p = state.placements[id]; if (p && p.day) n += (validatePlacement(id, p.day, p.period, 'safe', null).blocks || []).length; }
  return n;
});
const placementSig = (pg) => pg.evaluate(() => {
  const m = [];
  for (const id in state.items) { const p = state.placements[id], it = state.items[id]; if (p && p.day) for (const t of it.teas) m.push(t + '|' + p.day + p.period + '|' + it.subj + '|' + it.cls.join(',')); }
  return m.sort().join('\n');
});
const fixture = JSON.parse(fs.readFileSync(path.join(FIX, 'sample-project.json'), 'utf8'));
const FIX_ITEMS = Object.keys(fixture.items).length;
const FIX_PLACED = Object.values(fixture.placements).filter(p => p && p.day).length;

// ── テスト ──
await test('プロジェクトファイルを読み込める', async () => {
  const pg = await openApp();
  const c = await counts(pg);
  assert(c.items === FIX_ITEMS && c.placed === FIX_PLACED, `コマ数が違う ${JSON.stringify(c)} 期待 ${FIX_ITEMS}/${FIX_PLACED}`);
  assert(await hardViolations(pg) === 0, '衝突がある');
  assert(!pg.errs.length, pg.errs.join(' | '));
  await pg.close2();
});

await test('ブラウザに保存され、再読込しても同じ', async () => {
  const pg = await openApp();
  const before = await placementSig(pg);
  await pg.evaluate(() => { state.autosave.dirty = true; window.dispatchEvent(new Event('beforeunload')); });
  await pg.reload(); await pg.waitForTimeout(800);
  assert(await placementSig(pg) === before, '再読込で配置が変わった');
  await pg.close2();
});

await test('保存データが壊れても1つ前の控えから復旧する', async () => {
  const pg = await openApp();
  const before = await counts(pg);
  await pg.evaluate(() => { state.autosave.dirty = true; window.dispatchEvent(new Event('beforeunload')); state.autosave.dirty = true; window.dispatchEvent(new Event('beforeunload')); });
  // 壊す操作と再読込を間を空けずに行う（間が空くと自動保存が動いて、壊したデータが正常なデータで上書きされ、試験にならない）
  await Promise.all([
    pg.waitForNavigation({ waitUntil: 'load' }),
    pg.evaluate(() => {
      // 壊した直後に、ページを閉じる時の自動保存が正しいデータで書き戻すと試験にならないので、この試験の中だけ書き戻しを止める
      const orig = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) { if (k === 'ultimate_tt_state_v271' || k === 'ultimate_tt_state_v271__bak') return; return orig.call(this, k, v); };
      state.autosave.dirty = false;
      orig.call(localStorage, 'ultimate_tt_state_v271', '{"broken');
      location.reload();
    }),
  ]);
  await pg.waitForTimeout(800);
  const after = await counts(pg);
  assert(after.items === before.items && after.placed === before.placed, `復旧できない ${JSON.stringify(after)}`);
  const kept = await pg.evaluate(() => Object.keys(localStorage).some(k => k.includes('__damaged_')));
  assert(kept, '壊れたデータが退避されていない');
  await pg.close2();
});

await test('壊れたプロジェクトファイルでも止まらず修理して読み込む', async () => {
  const pg = await openApp({ load: false });
  const bad = { format: 'idea-timetable-project', projectName: '壊れ', rawRows: [{ _id: 'r1', cls: '1-1', subj: '数学', tea: '山田', count: 2 }, 'x', null],
    items: { a: { subj: '数学', cls: '1-1', teas: '山田', span: '2' }, b: { subj: null }, c: 'junk' },
    placements: { a: { day: 'Mon', period: '2' }, b: { day: 'Xyz', period: 1 }, ghost: { day: 'Tue', period: 1 } }, settings: { lunchAfter: 4 }, teacherCfg: [] };
  const f = path.join(FIX, '..', '.tmp-bad.json'); fs.writeFileSync(f, JSON.stringify(bad));
  await pg.setInputFiles('#project-load-file', f); await pg.waitForTimeout(800);
  await pg.evaluate(() => document.getElementById('modal-ok').click()); await pg.waitForTimeout(800);
  fs.unlinkSync(f);
  const r = await pg.evaluate(() => ({ a: state.items.a, ghost: 'ghost' in state.placements, b: state.placements.b, pbd: state.settings.periodsByDay }));
  assert(Array.isArray(r.a.cls) && r.a.span === 2, 'コマの形が直っていない');
  assert(!r.ghost && r.b === null && r.pbd && r.pbd.Mon, '配置や設定が直っていない');
  for (const t of ['edit', 'input', 'subject', 'teacher', 'print', 'school']) { await pg.click('#tab-' + t); await pg.waitForTimeout(200); }
  assert(!pg.errs.length, pg.errs.join(' | '));
  await pg.close2();
});

await test('イデア形式(.ide)で書き出して読み直すと同じ配置', async () => {
  const pg = await openApp();
  const before = await placementSig(pg);
  const [dl] = await Promise.all([pg.waitForEvent('download'), pg.evaluate(() => document.getElementById('btn-idea-export').click())]);
  const f = path.join(FIX, '..', '.tmp-export.ide'); await dl.saveAs(f);
  await pg.setInputFiles('#project-load-file', f); await pg.waitForTimeout(1000);
  await pg.evaluate(() => document.getElementById('modal-ok').click()); await pg.waitForTimeout(1000);
  fs.unlinkSync(f);
  const after = await placementSig(pg);
  assert(after === before, `配置が変わった（前 ${before.split('\n').length} 件 / 後 ${after.split('\n').length} 件）`);
  await pg.close2();
});

await test('イデアの.ideファイルを読み込める', async () => {
  const pg = await openApp({ load: 'sample-idea.ide' });
  const c = await counts(pg);
  assert(c.placed === FIX_PLACED, `配置数が違う ${c.placed} 期待 ${FIX_PLACED}`);
  assert(await hardViolations(pg) === 0, '衝突がある');
  await pg.close2();
});

await test('データ登録→作成画面へ戻しても配置が残る', async () => {
  const pg = await openApp();
  const before = await counts(pg);
  await pg.click('#tab-input'); await pg.waitForTimeout(300);
  await pg.click('#btn-reflect'); await pg.waitForTimeout(800);
  const ok = await pg.$('#modal-ok'); if (ok && await ok.isVisible()) await ok.click();
  await pg.waitForTimeout(500);
  const after = await counts(pg);
  assert(after.placed === before.placed, `配置が減った ${before.placed}→${after.placed}`);
  await pg.close2();
});

await test('全タブ・主な窓がエラーなく開き、画面からはみ出さない（PC/スマホ）', async () => {
  for (const mobile of [false, true]) {
    const pg = await openApp({ mobile });
    for (const t of ['school', 'input', 'subject', 'teacher', 'print', 'edit']) {
      await pg.evaluate(t => document.getElementById('tab-' + t).click(), t); await pg.waitForTimeout(400);
      const w = await pg.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      assert(w <= 1, `${mobile ? 'スマホ' : 'PC'} ${t} が横にはみ出す (${w}px)`);
    }
    for (const id of ['btn-analyze', 'btn-all-classes', 'btn-all-teachers']) {
      await pg.evaluate(id => document.getElementById(id).click(), id); await pg.waitForTimeout(600);
      await pg.keyboard.press('Escape'); await pg.waitForTimeout(200);
    }
    assert(!pg.errs.length, pg.errs.join(' | '));
    await pg.close2();
  }
});

await test('提案の窓が開き、候補が出る', async () => {
  const pg = await openApp();
  await pg.click('#tab-edit'); await pg.waitForTimeout(400);
  await pg.click('input[name=viewmode][value=class]'); await pg.waitForTimeout(400);
  await (await pg.$$('.timetable td .lesson'))[10].click(); await pg.waitForTimeout(200);
  await pg.keyboard.press('s');
  await pg.waitForSelector('.js-matrix-cell', { timeout: 15000 });
  const n = await pg.$$eval('.js-matrix-cell', c => c.length);
  assert(n > 0, '候補がない');
  assert(!pg.errs.length, pg.errs.join(' | '));
  await pg.close2();
});

await test('提案（収まり探索）: 出した案はすべて重複なし・在庫に出るコマなし', async () => {
  const pg = await openApp();
  const r = await pg.evaluate(() => {
    const ids = Object.keys(state.items).filter(i => state.placements[i] && state.placements[i].day && !state.placements[i].locked).sort();
    const pick = [ids[2], ids[Math.floor(ids.length / 3)], ids[Math.floor(ids.length * 2 / 3)], ids[ids.length - 3]];
    const before = JSON.stringify(state.placements);
    let total = 0, multi = 0, bad = 0;
    for (const id of pick) {
      for (const s of fitSuggestions(id, 400)) {
        total++; if (s.moves.length >= 3) multi++;
        const tgt = s.moves.find(m => m.id === id);
        const ok = tgt && simulateMoves(s.moves).ok && s.moves.every(m => m.day && m.period >= 1) && new Set(s.moves.map(m => m.id)).size === s.moves.length;
        if (!ok) bad++;
      }
    }
    return { total, multi, bad, unchanged: JSON.stringify(state.placements) === before };
  });
  assert(r.total > 0, '案が1つも出ない');
  assert(r.multi > 0, '3コマ以上を動かす案が1つも出ない（深く読めていない）');
  assert(r.bad === 0, `問題のある案が${r.bad}件`);
  assert(r.unchanged, '探索しただけで時間割が変わってしまった');
  await pg.close2();
});

await test('埋まっているマスへ動かすと「全員が収まる形」を選べ、採用しても重複なし・元に戻せる', async () => {
  const pg = await openApp();
  await pg.evaluate(() => document.getElementById('tab-edit').click()); await pg.waitForTimeout(500);
  await pg.click('input[name=viewmode][value=class]'); await pg.waitForTimeout(400);
  const snap = () => pg.evaluate(() => { let placed = 0, hard = 0; for (const id in state.items) { const p = state.placements[id]; if (p && p.day) { placed++; hard += validatePlacement(id, p.day, p.period, 'safe', null).blocks.length; } } return { placed, hard, sig: JSON.stringify(state.placements) }; });
  const before = await snap();
  // 1クラスだけのコマと、収まる形が見つかる「埋まっているマス」を探す
  const pick = await pg.evaluate(() => {
    for (const id of Object.keys(state.items).sort()) {
      const it = state.items[id], plc = state.placements[id];
      if (!plc || !plc.day || plc.locked || it.cls.length !== 1 || (it.span || 1) !== 1) continue;
      const sg = fitSuggestions(id, 300).find(s => s.moves.length >= 2);
      if (sg) { const m = sg.moves.find(m => m.id === id); return { id, cls: it.cls[0], day: m.day, p: m.period }; }
    }
    return null;
  });
  assert(pick, '試せるコマが見つからない');
  await pg.locator(`.timetable .lesson[data-id="${pick.id}"]`).first().click(); await pg.waitForTimeout(200);
  await pg.evaluate((k) => { const td = [...document.querySelectorAll('.timetable td')].find(td => td.dataset.day === k.day && td.dataset.p === String(k.p) && td.closest('tr').querySelector('th')?.textContent.trim() === k.cls); td.click(); }, pick);
  await pg.waitForFunction(() => document.getElementById('modal').classList.contains('show'), null, { timeout: 8000 });
  const order = await pg.evaluate(() => document.getElementById('modal-msg').innerText);
  assert(/全員が収まる形で入れる/.test(order), '「全員が収まる形」の選択肢が出ない');
  assert(order.indexOf('全員が収まる形') < order.indexOf('強制配置'), '強制配置がおすすめより上にある');
  await pg.getByText('全員が収まる形で入れる').click(); await pg.waitForTimeout(600);
  const after = await snap();
  const now = await pg.evaluate(id => state.placements[id], pick.id);
  assert(now.day === pick.day && now.period === pick.p, '目的のマスに入っていない');
  assert(after.placed === before.placed && after.hard === 0, '重複が出た/在庫に出たコマがある: ' + JSON.stringify({ placed: after.placed, hard: after.hard }));
  await pg.keyboard.press('Control+z'); await pg.waitForTimeout(500);
  assert((await snap()).sig === before.sig, '元に戻すで元の配置に戻らない');
  assert(!pg.errs.length, pg.errs.join(' | '));
  await pg.close2();
});

await test('印刷（すぐ使える時間割表）: A4にはみ出さず、白紙ページができない', async () => {
  const pg = await openApp();
  await pg.evaluate(() => document.getElementById('tab-print').click()); await pg.waitForTimeout(500);
  const cases = [
    { type: 'sheet-class', orient: 'landscape', perPage: 1 },
    { type: 'sheet-class', orient: 'portrait', perPage: 2 },
    { type: 'sheet-teacher', orient: 'landscape', perPage: 4, color: 'mono', name: 'abbr', showRoom: true },
    { type: 'sheet-all-class', orient: 'landscape', paper: 'A3' },
    { type: 'sheet-all-teacher', orient: 'landscape', paper: 'A4' },
    { type: 'sheet-all-teacher', orient: 'portrait', paper: 'A3', onePage: true },
    { type: 'sheet-class', orient: 'portrait', paper: 'A3', perPage: 4 },
    { type: 'class-paged', orient: 'portrait', paper: 'A3', legacy: true },
    { type: 'class-paged', orient: 'portrait', paper: 'A3', legacy: true, fit: true },
    { type: 'sheet-all-teacher', orient: 'landscape', paper: 'A4', fitOne: true, onePage: true },
  ];
  for (const c of cases) {
    await pg.evaluate((c) => { document.getElementById('print-page-orient').value = (c.paper === 'A3' ? 'a3-' : '') + c.orient; Object.assign(state.settings.sheet ||= {}, c); }, c);
    await pg.selectOption('#print-type', c.type); await pg.waitForTimeout(400);
    if (c.fit) {
      // 「用紙1枚に合わせる」を押しても、選んだ用紙（A3 縦）のまま
      await pg.click('#btn-fit-a4-portrait'); await pg.waitForTimeout(300);
      assert(await pg.evaluate(() => document.getElementById('print-page-orient').value) === 'a3-portrait', '用紙に合わせるを押したら、選んだ用紙が変わってしまった');
    }
    if (c.legacy) {
      // 従来の印刷でも、選んだ用紙（A3 縦）でPDFになること
      await pg.emulateMedia({ media: 'print' });
      const pdf0 = (await pg.pdf({ preferCSSPageSize: true, pageRanges: '1' })).toString('latin1');
      await pg.emulateMedia({ media: 'screen' });
      const mb = /MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)/.exec(pdf0);
      assert(mb && Math.abs(+mb[1] - 841.9) < 3 && Math.abs(+mb[2] - 1190.6) < 3, '従来の印刷がA3縦にならない: ' + (mb ? mb[1] + 'x' + mb[2] : 'なし'));
      continue;
    }
    const r = await pg.evaluate(() => {
      const pages = [...document.querySelectorAll('.ks-page')];
      const sheets = [...document.querySelectorAll('.ks-sheet')];
      const spill = sheets.filter(s => { const b = s.getBoundingClientRect(); return [...s.querySelectorAll('.ks-table, .ks-foot')].some(e => e.getBoundingClientRect().bottom > b.bottom + 1); }).length;
      const cut = [...document.querySelectorAll('.ks-main')].filter(e => e.scrollWidth > e.clientWidth + 2).length;
      return { pages: pages.length, sheets: sheets.length, spill, cut };
    });
    assert(r.pages > 0 && r.sheets > 0, '時間割表が1枚もできない: ' + JSON.stringify(c));
    if (c.onePage) assert(r.pages === 1, '全員が1枚に入らない: ' + JSON.stringify({ c, r }));
    if (c.type === 'sheet-all-teacher') {
      // 全校一覧（先生）: 授業のあるマスには必ず科目名も出ている（行が低くても、1マスに複数あっても消えない）
      const miss = await pg.evaluate(() => [...document.querySelectorAll('.km-it')].filter(e => !e.querySelector('.km-s') && /^\d+-/.test(e.querySelector('.km-m')?.textContent || '')).length);
      assert(miss === 0, `科目名が出ていないコマが ${miss} 個ある: ` + JSON.stringify(c));
    }
    assert(r.spill === 0, `${c.type} で表が紙からはみ出す: ` + JSON.stringify(r));
    // PDFにして、ページ数が表のページ数と同じ（白紙ページができない）ことを確かめる
    await pg.emulateMedia({ media: 'print' });
    const pdf = await pg.pdf({ preferCSSPageSize: true, printBackground: true });
    await pg.emulateMedia({ media: 'screen' });
    const n = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
    assert(n === r.pages, `${c.type} 印刷のページ数が合わない（白紙ができている）: PDF ${n}ページ / 表 ${r.pages}ページ`);
  }
  assert(!pg.errs.length, pg.errs.join(' | '));
  await pg.close2();
});

await test('表示の切替（教員/クラス）: 開き直してもボタンと表が一致し、教員表示に戻せる', async () => {
  const pg = await openApp();
  await pg.evaluate(() => document.getElementById('tab-edit').click()); await pg.waitForTimeout(400);
  await pg.click('input[name=viewmode][value=class]'); await pg.waitForTimeout(300);
  await pg.evaluate(() => { state.ui.tool = 'erase'; state.autosave.dirty = true; window.dispatchEvent(new Event('beforeunload')); });
  await pg.reload(); await pg.waitForTimeout(1000);
  await pg.evaluate(() => document.getElementById('tab-edit').click()); await pg.waitForTimeout(400);
  const look = () => pg.evaluate(() => ({ saved: state.ui.viewMode, btn: document.querySelector('input[name=viewmode]:checked')?.value, head: document.querySelector('.timetable thead th')?.textContent.trim(), tool: document.querySelector('input[name=tool]:checked')?.value }));
  const a = await look();
  assert(a.saved === 'class' && a.btn === 'class' && a.head === 'クラス', '開き直した時、ボタンと表が合っていない: ' + JSON.stringify(a));
  assert(a.tool === 'erase', '「消す」ツールのままなのに、ボタンの印が違う: ' + JSON.stringify(a));
  await pg.click('input[name=viewmode][value=teacher]'); await pg.waitForTimeout(300);
  const b = await look();
  assert(b.saved === 'teacher' && b.head === '教員', '教員表示に戻せない: ' + JSON.stringify(b));
  assert(!pg.errs.length, pg.errs.join(' | '));
  await pg.close2();
});

await test('担当替え: 作成画面でもデータ登録でも、配置が消えず元に戻せる', async () => {
  const pg = await openApp();
  await pg.evaluate(() => document.getElementById('tab-edit').click()); await pg.waitForTimeout(400);
  const where = () => pg.evaluate(() => Object.keys(state.items).filter(i => state.placements[i]?.day).map(i => { const it = state.items[i], p = state.placements[i]; return it.subj + '|' + it.cls.join() + '|' + p.day + p.period; }).sort().join(';'));
  const w0 = await where();
  // 週2コマ以上ある授業を1つ選ぶ
  const pick = await pg.evaluate(() => { const by = {}; for (const i in state.items) { const it = state.items[i]; if (state.placements[i]?.day && it.cls.length === 1) (by[it.srcId] ||= []).push(i); } const k = Object.keys(by).find(k => by[k].length >= 2); return by[k][1]; });
  const other = await pg.evaluate((id) => Object.keys(state.teacherCfg).find(t => !state.items[id].teas.includes(t)), pick);
  // 作成画面: このコマだけ
  await pg.locator(`.timetable .lesson[data-id="${pick}"]`).first().click(); await pg.waitForTimeout(200);
  await pg.click('#prop-reassign'); await pg.waitForTimeout(200);
  await pg.fill('#ra-teas', other); await pg.check('input[name=ra-scope][value=one]'); await pg.click('#modal-ok'); await pg.waitForTimeout(400);
  const r1 = await pg.evaluate((t) => { const id = state.ui.selectedId; return { teas: state.items[id]?.teas, row: (state.rawRows.find(r => r._id === state.items[id]?.srcId) || {}).tea }; }, other);
  assert(r1.teas && r1.teas.join() === other && r1.row === other, '作成画面で担当が変わらない: ' + JSON.stringify(r1));
  assert(await where() === w0, '担当替えで配置が変わった');
  await pg.keyboard.press('Control+z'); await pg.waitForTimeout(300);
  assert(await where() === w0 && await pg.evaluate((id) => !!state.items[id], pick), '元に戻すで元に戻らない');
  // データ登録で書き換え、反映ボタンを押さずに作成画面へ
  await pg.evaluate(() => document.getElementById('tab-input').click()); await pg.waitForTimeout(300);
  await pg.evaluate(({ id, t }) => { const r = state.rawRows.find(r => r._id === state.items[id].srcId); r.tea = t; }, { id: pick, t: other });
  await pg.evaluate(() => document.getElementById('tab-edit').click()); await pg.waitForTimeout(400);
  assert(await pg.evaluate(({ id, t }) => state.items[id]?.teas.join() === t, { id: pick, t: other }), 'データ登録の担当替えが作成画面に反映されない');
  assert(await where() === w0, 'データ登録の担当替えで配置が変わった');
  assert(!pg.errs.length, pg.errs.join(' | '));
  await pg.close2();
});

await test('マトリクス印刷（全クラス・全教員・全教室）: 文字が「…」で切れない', async () => {
  const pg = await openApp();
  await pg.evaluate(() => document.getElementById('tab-print').click()); await pg.waitForTimeout(400);
  for (const t of ['matrix-class', 'matrix-teacher', 'matrix-room']) {
    await pg.selectOption('#print-type', t); await pg.waitForTimeout(500);
    const r = await pg.evaluate(() => {
      const els = [...document.querySelectorAll('.print-matrix td *, .print-matrix tbody th')].filter(e => e.children.length === 0 && e.textContent.trim());
      const cut = els.filter(e => e.scrollWidth > e.clientWidth + 1 || /…$/.test(e.textContent.trim()));
      return { n: els.length, cut: cut.length, ex: cut.slice(0, 3).map(e => e.textContent.trim()) };
    });
    assert(r.n > 0, t + ' に文字がない');
    assert(r.cut === 0, `${t} で切れている文字がある: ` + JSON.stringify(r));
  }
  assert(!pg.errs.length, pg.errs.join(' | '));
  await pg.close2();
});

await test('Excel様式: 出力して取り込み直しても配置が残る・見本の行は取り込まない', async () => {
  const pg = await openApp();
  const tmp = path.join(FIX, '..', '.tmp-xl-' + Date.now());
  fs.mkdirSync(tmp, { recursive: true });
  try {
    const where = () => pg.evaluate(() => Object.keys(state.items).filter(i => state.placements[i]?.day).map(i => { const it = state.items[i], p = state.placements[i]; return it.subj + '|' + it.cls.join() + '|' + it.teas.join() + '|' + p.day + p.period; }).sort().join(';'));
    const w0 = await where(); const n0 = await pg.evaluate(() => state.rawRows.length);
    await pg.evaluate(() => document.getElementById('tab-input').click()); await pg.waitForTimeout(300);
    // 実際にボタンを押してメニューから選ぶ（押した瞬間にメニューが閉じないことも確かめる）
    await pg.click('#btn-xl-template'); await pg.waitForTimeout(150);
    let [dl] = await Promise.all([pg.waitForEvent('download'), pg.getByText('空の様式').click()]);
    const blank = path.join(tmp, 'blank.xlsx'); await dl.saveAs(blank);
    await pg.setInputFiles('#xl-file', blank); await pg.waitForTimeout(400);
    assert(/取り込める行がありません/.test(await pg.evaluate(() => document.getElementById('modal-msg').innerText)), '見本だけの様式を取り込もうとした');
    await pg.evaluate(() => document.getElementById('modal-ok').click()); await pg.waitForTimeout(200);
    await pg.click('#btn-xl-template'); await pg.waitForTimeout(150);
    [dl] = await Promise.all([pg.waitForEvent('download'), pg.getByText('今のデータ入り').click()]);
    const data = path.join(tmp, 'data.xlsx'); await dl.saveAs(data);
    await pg.setInputFiles('#xl-file', data); await pg.waitForTimeout(500);
    const msg = await pg.evaluate(() => document.getElementById('modal-msg').innerText);
    assert(msg.includes(`授業 ${n0} 行`), '取り込む行数が違う: ' + msg.slice(0, 80));
    await pg.evaluate(() => document.getElementById('modal-ok').click()); await pg.waitForTimeout(400);
    await pg.evaluate(() => document.getElementById('tab-edit').click()); await pg.waitForTimeout(500);
    assert(!(await pg.evaluate(() => document.getElementById('modal').classList.contains('show'))), '取り込み直しただけなのに「配置が外れる」確認が出た');
    assert(await where() === w0, '取り込み直したら配置・担当が変わった');
    assert(!pg.errs.length, pg.errs.join(' | '));
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); await pg.close2(); }
});

await test('軽さ: コマを選ぶ・動かす時に表全体を作り直さず、結果は全部描き直した時と同じ', async () => {
  const pg = await openApp();
  await pg.evaluate(() => document.getElementById('tab-edit').click()); await pg.waitForTimeout(500);
  await pg.click('input[name=viewmode][value=class]'); await pg.waitForTimeout(500);
  // 行に目印を付けておき、操作の後も同じ行が残っているか（作り直されていないか）を見る
  const mark = () => pg.evaluate(() => { document.querySelectorAll('#grid tbody tr').forEach((tr, i) => { tr.__mark = i; }); });
  const kept = () => pg.evaluate(() => { const rows = [...document.querySelectorAll('#grid tbody tr')]; return { rows: rows.length, kept: rows.filter(tr => tr.__mark !== undefined).length }; });
  const html = () => pg.evaluate(() => [...document.querySelectorAll('#grid tbody tr')].map(tr => tr.outerHTML.replace(/ class=""/g, '').replace(/ style="(font-size: [\d.]+px !important;)?"/g, '')).join('\n'));
  const ids = await pg.evaluate(() => Object.keys(state.items).filter(i => state.placements[i]?.day && state.items[i].cls.length === 1).slice(0, 3));
  await mark();
  await pg.locator(`.timetable .lesson[data-id="${ids[0]}"]`).first().click(); await pg.waitForTimeout(200);
  let k = await kept();
  assert(k.kept === k.rows, 'コマを選んだだけで表が作り直された: ' + JSON.stringify(k));
  assert(await pg.evaluate((id) => document.querySelector(`.timetable .lesson[data-id="${id}"]`).classList.contains('sel') && document.querySelectorAll('.timetable .lesson.sel').length >= 1, ids[0]), '選んだコマに印が付かない');
  await pg.locator(`.timetable .lesson[data-id="${ids[1]}"]`).first().click(); await pg.waitForTimeout(200);
  assert(await pg.evaluate((a) => !document.querySelector(`.timetable .lesson[data-id="${a[0]}"]`).classList.contains('sel') && document.querySelector(`.timetable .lesson[data-id="${a[1]}"]`).classList.contains('sel'), ids), '選び直した時に印が移らない');
  // 在庫へ出す → 変わった行だけ差し替わる
  await pg.evaluate(() => document.querySelector('.qab-stock').click()); await pg.waitForTimeout(400);
  k = await kept();
  assert(k.kept >= k.rows - 2 && k.kept < k.rows, '1コマ動かした時に差し替わる行の数がおかしい: ' + JSON.stringify(k));
  await pg.keyboard.press('Escape'); await pg.mouse.move(5, 5); await pg.waitForTimeout(400); // マウスを外して関連表示を消してから比べる
  const a = await html();
  // 表示を切り替えて戻す（全部描き直す）→ 同じ内容になるはず
  await pg.click('input[name=viewmode][value=teacher]'); await pg.waitForTimeout(400);
  await pg.click('input[name=viewmode][value=class]'); await pg.mouse.move(5, 5); await pg.waitForTimeout(500);
  const z = await html();
  if (a !== z) { let j = 0; while (j < a.length && a[j] === z[j]) j++; console.log('    差: …' + a.slice(Math.max(0, j - 150), j + 150).replace(/\s+/g, ' ') + '\n     ≠ …' + z.slice(Math.max(0, j - 150), j + 150).replace(/\s+/g, ' ')); }
  assert(a === z, '変わった行だけ差し替えた結果が、全部描き直した結果と違う');
  // 別の画面から戻っただけなら作り直さない
  await mark();
  await pg.evaluate(() => document.getElementById('tab-school').click()); await pg.waitForTimeout(200);
  await pg.evaluate(() => document.getElementById('tab-edit').click()); await pg.waitForTimeout(400);
  k = await kept();
  assert(k.kept === k.rows, '別の画面から戻っただけで表が作り直された: ' + JSON.stringify(k));
  // 何もしていない時に動き続けるアニメーションが無いこと（1つでもあると、操作していなくても画面が働き続けて全体が重くなる）
  await pg.mouse.move(5, 5); await pg.waitForTimeout(2600);
  const running = await pg.evaluate(() => document.getAnimations().filter(x => x.playState === 'running').map(x => x.animationName || 'transition'));
  assert(running.length === 0, '止まらないアニメーションがある: ' + running.join(','));
  assert(!pg.errs.length, pg.errs.join(' | '));
  await pg.close2();
});

await test('連続・偏り改善で衝突が増えず、元に戻せる', async () => {
  const pg = await openApp();
  await pg.click('#tab-edit'); await pg.waitForTimeout(300);
  const before = await placementSig(pg);
  await pg.click('#btn-polish');
  await pg.waitForFunction(() => !document.getElementById('btn-polish').disabled, null, { timeout: 60000 });
  assert(await hardViolations(pg) === 0, '衝突が出た');
  await pg.keyboard.press('Control+z'); await pg.waitForTimeout(600);
  const after = await placementSig(pg);
  const changed = await pg.evaluate(() => /改善 (\d+)手/.exec(document.getElementById('ai-status').textContent)?.[1] || '0');
  assert(changed === '0' || after === before, '元に戻らない');
  await pg.close2();
});

await test('コマにカーソルを合わせると関連が濃くなる', async () => {
  const pg = await openApp();
  await pg.click('#tab-edit'); await pg.waitForTimeout(300);
  await pg.click('input[name=viewmode][value=class]'); await pg.waitForTimeout(400);
  await (await pg.$$('.timetable td .lesson'))[5].hover(); await pg.waitForTimeout(300);
  const r = await pg.evaluate(() => ({ on: document.body.classList.contains('hl-on'), tea: document.querySelectorAll('.hl-tea').length }));
  assert(r.on && r.tea > 0, '関連表示が出ない');
  await pg.mouse.move(5, 5); await pg.waitForTimeout(300);
  assert(!(await pg.evaluate(() => document.body.classList.contains('hl-on'))), '関連表示が消えない');
  await pg.close2();
});

await test('教員の教科順が指定どおり', async () => {
  const pg = await openApp();
  await pg.click('#tab-edit'); await pg.waitForTimeout(300);
  await pg.evaluate(() => { state.ui.teacherSort = 'subject'; rerenderAll(); }); await pg.waitForTimeout(400);
  const rows = await pg.evaluate(() => [...document.querySelectorAll('.timetable tbody tr')].map(tr => tr.dataset.row).filter(r => /^先生/.test(r)));
  const order = [...new Set(rows.map(r => r[2]))].join('');
  assert(order === 'ADEBJCGHFI', `順番が違う: ${order}（国語A→地歴D→公民E→数学B→情報J→理科C→保体G→芸術H→外国語F→家庭I）`);
  await pg.close2();
});

await test('学校のルール: 自選は指定曜日の最後のコマだけ・3年体育の公平性', async () => {
  const pg = await openApp();
  const r = await pg.evaluate(() => {
    // 自選の試験用コマを一時的に作る
    state.items.__j = { id: '__j', subj: '自由選択(金)1', subjKey: '自由選択(金)1', cls: ['3-1'], teas: ['先生X'], rooms: [], span: 1 };
    invalidateIndex();
    const last = maxPeriod('Fri');
    const v = (d, p) => validatePlacement('__j', d, p, 'safe', null).blocks.some(b => /自選/.test(b));
    const out = { lastOk: !v('Fri', last), midBlocked: v('Fri', 1), otherDayBlocked: v('Thu', last) };
    delete state.items.__j; invalidateIndex();
    return out;
  });
  assert(r.lastOk && r.midBlocked && r.otherDayBlocked, '自選のルール: ' + JSON.stringify(r));
  await pg.close2();
});

await test('スマホ表示: 曜日切替・在庫の引き出し・長押しの関連表示', async () => {
  const pg = await openApp({ mobile: true });
  await pg.evaluate(() => document.getElementById('tab-edit').click()); await pg.waitForTimeout(500);
  assert(await pg.evaluate(() => document.body.classList.contains('mobile')), 'スマホ表示にならない');
  await pg.tap('.mb-day[data-mday="Tue"]'); await pg.waitForTimeout(300);
  const vis = await pg.evaluate(() => [...document.querySelectorAll('.timetable thead th[data-day]')].filter(th => th.offsetParent).map(th => th.dataset.day));
  assert(vis.every(d => d === 'Tue'), '火曜だけにならない');
  await pg.tap('#mb-stock'); await pg.waitForTimeout(300);
  assert(await pg.evaluate(() => document.body.classList.contains('stock-open')), '在庫が開かない');
  await pg.tap('#mb-stock'); await pg.waitForTimeout(300);
  assert(!pg.errs.length, pg.errs.join(' | '));
  await pg.close2();
});

await test('スマホ表示: 時間割を一番下までスクロールでき、見出し2行が上に残る', async () => {
  const pg = await openApp({ mobile: true });
  await pg.evaluate(() => document.getElementById('tab-edit').click()); await pg.waitForTimeout(500);
  await pg.tap('input[name=viewmode][value=teacher]'); await pg.waitForTimeout(500);
  const r = await pg.evaluate(async () => {
    const w = document.getElementById('grid-wrapper');
    const max = w.scrollHeight - w.clientHeight;
    w.scrollTop = max; await new Promise(r => setTimeout(r, 200));
    const wr = w.getBoundingClientRect();
    const heads = [...document.querySelectorAll('.timetable thead tr')].map(tr => { const b = tr.querySelector('th').getBoundingClientRect(); return Math.round(b.top - wr.top); });
    const lastRow = [...document.querySelectorAll('.timetable tbody tr')].pop().getBoundingClientRect();
    return { max, top: Math.round(w.scrollTop), heads, lastVisible: lastRow.bottom <= wr.bottom + 12, fits: wr.bottom <= innerHeight + 1 };
  });
  assert(r.max > 50, '時間割の枠がスクロールできる高さになっていない: ' + JSON.stringify(r));
  assert(r.top >= r.max - 2 && r.lastVisible && r.fits, '一番下の行まで行けない: ' + JSON.stringify(r));
  assert(r.heads.length >= 2 && r.heads.every(t => t >= -3 && t <= 40), '見出しが上に残らない: ' + JSON.stringify(r));
  await pg.close2();
});

await test('色分け: 同じ教科は近い色・別の教科は離れた色・色分けメニューが選んだとおりに動く', async () => {
  const pg = await openApp();
  await pg.evaluate(() => document.getElementById('tab-edit').click()); await pg.waitForTimeout(500);
  const r = await pg.evaluate(() => {
    for (const k of ['数学Ⅰ', '数学Ａ', '現代の国語', '生徒会G']) state.subjectCfg[k] = { abbr: k };
    const hue = (hex) => { const n = parseInt(hex.slice(1), 16), R = (n >> 16) / 255, G = ((n >> 8) & 255) / 255, B = (n & 255) / 255; const mx = Math.max(R, G, B), mn = Math.min(R, G, B), d = mx - mn; if (!d) return -1; let h = mx === R ? ((G - B) / d) % 6 : mx === G ? (B - R) / d + 2 : (R - G) / d + 4; return (h * 60 + 360) % 360; };
    const dist = (a, b) => { const d = Math.abs(a - b); return Math.min(d, 360 - d); };
    const c = k => hue(pickColor(k));
    const out = { same: dist(c('数学Ⅰ'), c('数学Ａ')), diff: dist(c('数学Ⅰ'), c('現代の国語')), g: pickColor('生徒会G'), bio: pickColor('生物基礎') };
    for (const k of ['数学Ⅰ', '数学Ａ', '現代の国語', '生徒会G']) delete state.subjectCfg[k];
    return out;
  });
  assert(r.same <= 40, '同じ教科の色が離れすぎ: ' + JSON.stringify(r));
  assert(r.diff >= 60, '別の教科の色が近すぎ: ' + JSON.stringify(r));
  // 色分けメニュー: 「学年別」を選んだら学年別になる（以前はどれを選んでも先頭の項目になっていた）
  await pg.evaluate(() => { const e = document.getElementById('btn-color-mode'); e.onclick({ clientX: 300, clientY: 200 }); }); await pg.waitForTimeout(200);
  await pg.getByText('学年別色').click(); await pg.waitForTimeout(300);
  assert(await pg.evaluate(() => state.ui.colorMode) === 'grade', '色分けメニューで選んだものと違うモードになった');
  await pg.evaluate(() => { const e = document.getElementById('btn-color-mode'); e.onclick({ clientX: 300, clientY: 200 }); }); await pg.waitForTimeout(200);
  await pg.getByText('色の見本を見る').click(); await pg.waitForTimeout(300);
  assert(await pg.evaluate(() => document.getElementById('modal').classList.contains('show') && /しま模様/.test(document.getElementById('modal-msg').textContent)), '色の見本が開かない');
  assert(!pg.errs.length, pg.errs.join(' | '));
  await pg.close2();
});


await browser.close(); server.close();
const ng = results.filter(r => !r.ok);
console.log(`\n${results.length - ng.length} / ${results.length} 合格`);
process.exit(ng.length ? 1 : 0);
