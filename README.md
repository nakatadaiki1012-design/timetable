# timetable
## 自動テスト

画面を実際にブラウザで動かして、主な機能が壊れていないかを確かめます。変更を取り込む前に必ず実行してください。

```
npm install
npm test                      # アプリ全体（14項目）
npm run test:cloud            # クラウドのアクセスの決まり（Java が必要）
```

ブラウザの場所を指定する場合は `CHROMIUM_PATH=/path/to/chrome npm test`。
テストには `tests/fixtures/` の架空の学校のデータを使います（実在の先生・生徒の情報は入れないでください）。
