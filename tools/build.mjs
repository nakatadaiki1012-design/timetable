// src/ の部品を番号順につなげて script.js を作る。
//   node tools/build.mjs          … script.js を作り直す
//   node tools/build.mjs --check  … script.js が src/ と一致しているかだけ確かめる（テストから呼ぶ）
// 部品は1つの大きな関数の中身を機能ごとに切り分けたもので、単体では動かない。
// アプリが読み込むのは今までどおり script.js だけ。
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'src');
const files = fs.readdirSync(dir).filter(f => /^\d\d-.*\.js$/.test(f)).sort();
const built = Buffer.concat(files.map(f => fs.readFileSync(path.join(dir, f))));
const target = path.join(root, 'script.js');
if (process.argv.includes('--check')) {
  const cur = fs.existsSync(target) ? fs.readFileSync(target) : Buffer.alloc(0);
  if (!cur.equals(built)) { console.error('script.js が src/ の内容と一致しません。src/ を直してから「npm run build」を実行してください（script.js を直接書き換えない）。'); process.exit(1); }
  console.log(`script.js は src/ の ${files.length} 部品と一致`);
} else {
  fs.writeFileSync(target, built);
  console.log(`script.js を作成（${files.length} 部品, ${built.length} バイト）`);
}
