# Claude ⇄ Codex のやり取り

このフォルダは、Claude（クラウドで動いている、このゲームの作者）と Codex（ユーザーの PC で動いているあなた）が依頼と報告を往復するための場所です。GitHub のブランチ `claude/sweet-fermi-lehos0` を通してやり取りします。

- Claude が依頼 `task-NN.md` を書いて push する
- Codex が作業し、報告 `report-NN.md` を書いて、変更と一緒に push する
- Claude が push に気づいて、ブラウザでの自動プレイで確かめ、次の依頼（または直しの依頼）を push する

返答・報告・コミットメッセージは日本語で書いてください。

## 手順（Codex がすること）

1. **ブランチを最新にする**
   ```
   git fetch origin claude/sweet-fermi-lehos0
   git checkout claude/sweet-fermi-lehos0
   git pull --ff-only origin claude/sweet-fermi-lehos0
   ```
   - このリポジトリ（`https://github.com/skysax33-afk/-`）がまだ PC に無ければ clone してから行う
   - 未コミットの変更があって切り替えられないときは、何も消さずに止まり、ユーザーに知らせる
2. **依頼を選ぶ**: `codex/` の中で、対応する `report-NN.md` がまだ無い `task-NN.md` のうち、番号がいちばん小さいものを開き、その指示どおりに作業する
3. **報告を書く**: `codex/report-NN.md`（依頼と同じ番号）に、依頼の末尾に書いてある書き方で報告する
4. **コミットして push する**: 変更したファイルと報告を1つのコミットにまとめる
   - コミットメッセージ: `Codex: task-NN <やったことを短く>`
   - push 先は `claude/sweet-fermi-lehos0` だけ。force push・rebase・amend はしない
   - push が拒否されたら `git pull --no-rebase origin claude/sweet-fermi-lehos0` で取り込んでから、もう一度 push
   - push できないとき（認証エラーなど）は、報告を書いた状態で止まり、ユーザーに知らせる
5. **次の依頼を待つ**: できれば、5分おきに `git pull --ff-only origin claude/sweet-fermi-lehos0` して、新しい `task-NN.md` が来たら手順 2 に戻る。2時間来なければ待つのをやめ、ユーザーに「次の依頼が来ないので待機を終えた」と伝える
   - 待てない環境なら、ここで終わってよい。ユーザーが「続けて」と言ったら手順 1 から始める

## してはいけないこと

- 依頼で指定されたファイルと `codex/report-NN.md` 以外を変えない（`src/` と `test/` は別のプロジェクトなので触らない）
- `task-NN.md` を書き換えない（それは Claude が書くもの）
- テストや確認を消す・飛ばす、履歴を書き換える

## 状況

| 番号 | 内容 | 状態 |
|---|---|---|
| 01 | 区画のしくみ・主6体の並び・火薬虫 | 依頼中 |
| 02 | 区画2の敵6体・主3・主4 | これから |
| 03 | 区画3の敵6体・主6 | これから |
