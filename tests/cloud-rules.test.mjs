import fs from 'fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { ref, set, get, update, remove } from 'firebase/database';

const env = await initializeTestEnvironment({
  projectId: 'timetable-69cee',
  database: { host: '127.0.0.1', port: 9000, rules: fs.readFileSync(new URL('../database.rules.json', import.meta.url), 'utf8') },
});
const ek = (e) => e.toLowerCase().replace(/\./g, ',');
const owner = env.authenticatedContext('uOwner', { email: 'owner@school.jp', email_verified: true }).database();
const editor = env.authenticatedContext('uEd', { email: 'Ed.Itor@school.jp', email_verified: true }).database();
const viewer = env.authenticatedContext('uView', { email: 'viewer@school.jp', email_verified: true }).database();
const stranger = env.authenticatedContext('uX', { email: 'x@evil.com', email_verified: true }).database();
const unverified = env.authenticatedContext('uU', { email: 'viewer@school.jp', email_verified: false }).database();
const anon = env.unauthenticatedContext().database();

const results = [];
const t = async (name, p) => { try { await p; results.push(['OK ', name]); } catch (e) { results.push(['NG ', name + ' :: ' + e.message.slice(0, 120)]); } };
const now = Date.now();
const tt = 'tt1';
// 1. 作成（オーナー）
await t('owner creates timetable (meta+members+data at once)', assertSucceeds(update(ref(owner), {
  [`timetables/${tt}/meta`]: { owner: 'uOwner', ownerEmail: 'owner@school.jp', name: '2026前期', updatedAt: now, updatedBy: 'owner@school.jp' },
  [`timetables/${tt}/members`]: { [ek('Ed.Itor@school.jp')]: 'edit', [ek('viewer@school.jp')]: 'view' },
  [`timetables/${tt}/data`]: JSON.stringify({ hello: '文/C312' }),
  [`userTimetables/uOwner/${tt}`]: '2026前期',
  [`sharedWith/${ek('Ed.Itor@school.jp')}/${tt}`]: '2026前期',
  [`sharedWith/${ek('viewer@school.jp')}/${tt}`]: '2026前期',
})));
await t('stranger cannot create with someone else as owner', assertFails(set(ref(stranger, 'timetables/tt2/meta'), { owner: 'uOwner', name: 'x', updatedAt: now })));
// 2. 読み取り
await t('owner reads', assertSucceeds(get(ref(owner, `timetables/${tt}`))));
await t('editor reads (mixed-case email)', assertSucceeds(get(ref(editor, `timetables/${tt}`))));
await t('viewer reads', assertSucceeds(get(ref(viewer, `timetables/${tt}`))));
await t('stranger cannot read', assertFails(get(ref(stranger, `timetables/${tt}`))));
await t('unverified email cannot read', assertFails(get(ref(unverified, `timetables/${tt}`))));
await t('not logged in cannot read', assertFails(get(ref(anon, `timetables/${tt}`))));
await t('nobody can list all timetables', assertFails(get(ref(owner, 'timetables'))));
// 3. 書き込み
await t('editor saves data + meta', assertSucceeds(update(ref(editor, `timetables/${tt}`), { data: '{"v":2}', 'meta/updatedAt': now + 1, 'meta/updatedBy': 'ed.itor@school.jp' })));
await t('viewer cannot save data', assertFails(set(ref(viewer, `timetables/${tt}/data`), '{"v":3}')));
await t('stranger cannot save data', assertFails(set(ref(stranger, `timetables/${tt}/data`), '{"v":3}')));
await t('editor cannot take ownership', assertFails(set(ref(editor, `timetables/${tt}/meta/owner`), 'uEd')));
await t('editor cannot change members', assertFails(set(ref(editor, `timetables/${tt}/members/${ek('x@evil.com')}`), 'edit')));
await t('viewer cannot add themselves as editor', assertFails(set(ref(viewer, `timetables/${tt}/members/${ek('viewer@school.jp')}`), 'edit')));
await t('owner adds member', assertSucceeds(set(ref(owner, `timetables/${tt}/members/${ek('new@school.jp')}`), 'view')));
await t('owner cannot set bogus permission', assertFails(set(ref(owner, `timetables/${tt}/members/${ek('new@school.jp')}`), 'admin')));
// 4. 一覧
await t('viewer reads own shared list', assertSucceeds(get(ref(viewer, `sharedWith/${ek('viewer@school.jp')}`))));
await t('stranger cannot read others shared list', assertFails(get(ref(stranger, `sharedWith/${ek('viewer@school.jp')}`))));
await t('stranger cannot plant entry in someone shared list', assertFails(set(ref(stranger, `sharedWith/${ek('viewer@school.jp')}/evil`), 'x')));
await t('owner reads own list', assertSucceeds(get(ref(owner, 'userTimetables/uOwner'))));
await t('stranger cannot read owner list', assertFails(get(ref(stranger, 'userTimetables/uOwner'))));
// 5. 削除
await t('editor cannot delete timetable meta', assertFails(remove(ref(editor, `timetables/${tt}/meta`))));
await t('owner removes viewer', assertSucceeds(remove(ref(owner, `timetables/${tt}/members/${ek('viewer@school.jp')}`))));
await t('removed viewer can no longer read', assertFails(get(ref(viewer, `timetables/${tt}`))));
await t('owner deletes timetable', assertSucceeds(update(ref(owner), { [`timetables/${tt}/data`]: null, [`timetables/${tt}/members`]: null, [`timetables/${tt}/meta`]: null })));

for (const r of results) console.log(r.join(' '));
console.log('PASS', results.filter(r => r[0] === 'OK ').length, '/', results.length);
await env.cleanup();
process.exit(0);
