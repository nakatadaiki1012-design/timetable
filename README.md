# timetable
## プログラムの構成（メインの script.js は部品から作る）

`script.js` は大きいので、機能ごとの部品を `src/` に置き、番号順につなげて作っています。
アプリが読み込むのは今までどおり `script.js` だけです。

| 部品 | 内容 |
|---|---|
| `src/01-core-utils.js` | 共通の道具・色分け |
| `src/02-state-save.js` | データの持ち方・データ保護・プロジェクトファイル |
| `src/03-idea-file.js` | イデア形式（.ide）の読み書き |
| `src/04-history-parse.js` | 元に戻す・自動保存・データ登録 |
| `src/05-rules-moves.js` | 置ける/置けないの判定・コマの移動 |
| `src/06-ui-settings.js` | 画面の共通部品・科目/教員設定 |
| `src/07-edit-view.js` | 作成画面（時間割・在庫・スマホ表示） |
| `src/08-suggestions.js` | 提案・連続/偏り改善 |
| `src/09-import-export.js` | CSV・Excel・スナップショット |
| `src/10-ai-placement.js` | AI配置 |
| `src/11-print.js` | 印刷・PDF |
| `src/12-windows.js` | 一覧の窓・分析・ヘルプ |
| `src/13-init.js` | ボタンの配線・起動 |

直すときは **`src/` の部品を直してから `npm run build`**（`script.js` を直接書き換えない）。
`npm test` は最初に「`script.js` が `src/` と一致しているか」を確かめます。

## 自動テスト

画面を実際にブラウザで動かして、主な機能が壊れていないかを確かめます。変更を取り込む前に必ず実行してください。

```
npm install
npm test                      # アプリ全体（14項目）
npm run test:cloud            # クラウドのアクセスの決まり（Java が必要）
```

ブラウザの場所を指定する場合は `CHROMIUM_PATH=/path/to/chrome npm test`。
テストには `tests/fixtures/` の架空の学校のデータを使います（実在の先生・生徒の情報は入れないでください）。
