# PC の Claude Code と Codex で開発を回す手順

PC 上の Claude Code が、Codex プラグイン（OpenAI 公式 `codex-plugin-cc`）で Codex に作業を渡し、戻ってきた結果を確認して、次の依頼を出す。これを人の手を借りずに繰り返すための手順書。

- 対象はハクスラゲーム「灯守りの迷宮」（`game/`）だけ。通知Bot（`src/`・`test/`）には触らない
- ブランチは `claude/sweet-fermi-lehos0`。push はこのブランチだけ
- 返答・報告・コミットメッセージは日本語

## 準備（初回だけ・ユーザーが行う）

1. PC でこのリポジトリのフォルダを開き、Claude Code を起動する（ターミナルで `claude`、またはデスクトップアプリでこのフォルダを開く）
2. Claude Code の中で Codex プラグインを入れる
   ```
   /plugin marketplace add openai/codex-plugin-cc
   /plugin install codex@openai-codex
   /reload-plugins
   /codex:setup
   ```
   `/codex:setup` が「準備できている」と言えばよい。Codex にログインしていなければ `!codex login`
3. テストの準備（Node.js 18 以上）
   ```
   cd game/test
   npm install
   npx playwright install chromium
   ```
4. ブランチを最新にする
   ```
   git fetch origin claude/sweet-fermi-lehos0
   git checkout claude/sweet-fermi-lehos0
   git pull --ff-only origin claude/sweet-fermi-lehos0
   ```
5. Claude Code に「`codex/LOOP.md` の手順で、次の依頼から進めて」と伝える

## Claude Code がすること（1回分）

1. **次の依頼を決める**: `codex/README.md` の状況表で、「完了」になっていない最小番号の依頼を選ぶ。`codex/task-NN.md` が無ければ、`game/ART_SPEC.md` と既存の依頼を手本にして書く
2. **Codex に渡す**: Codex プラグインの rescue（`/codex:rescue`、または `codex:codex-rescue` サブエージェント）で、次のように頼む
   > `codex/task-NN.md` を読んで、その指示どおりに `game/index.html` を変更し、`codex/report-NN.md` に報告を書いてください。コミットと push は Claude がするので、しないでください。終わったら報告の中身を返してください。

   長くかかるときはバックグラウンドで動かし、`/codex:status`・`/codex:result` で結果を受け取る
3. **結果を読む**: `codex/report-NN.md` と `git diff` を読み、依頼どおりか、ほかのファイルを触っていないかを見る
4. **確かめる**: `node game/test/play.js` を実行し、全項目 OK であること
   - 依頼で増えた仕組み（例: 痺れ・盾・引き寄せ）は、`game/test/play.js` に確認を足す。足した確認が NG を出すことも、一度わざと壊して確かめる
   - `node game/test/play.js --shots` の画面写真で、新しい敵の図形と色が `game/ART_SPEC.md` に合っているかを見る
5. **直す**: NG や仕様とのずれがあれば、Codex に直しを頼む（`/codex:rescue --resume`。何が・どう違うかを具体的に）。同じ依頼で直しは3回まで
6. **記録して送る**: `game/index.html`・`codex/report-NN.md`・足したテストを1つのコミットにする（メッセージ例 `Codex: task-NN 区画2の敵6体と主3・主4（Claude 確認済み）`）。push して、`codex/README.md` の状況表を「完了」に更新する
7. 次の依頼へ（1 に戻る）

## 止めてユーザーに聞くとき

次のときは先へ進まず、何が起きたかと、決めてほしいことを短く伝えて待つ。

- 同じ依頼で直しを3回頼んでも、テストが通らない
- 依頼や `game/ART_SPEC.md` に書いていないことを決める必要がある（新しい敵・数値の大きな変更・操作の変更など）
- `src/`・`test/`（通知Bot）や、ほかのブランチを触る必要が出た
- 全部の依頼が終わった（このときは、遊んで手触りを確かめてほしいと伝える）

## 決まりごと

- 1回に1つの依頼。確かめてから次へ進む
- 成長式（`hpMul` / `dmgMul` / `xpMul`）は変えない
- テストを消す・飛ばす・弱めることはしない。force push・rebase・amend もしない
- 公開中のゲーム（claude.ai の Artifact）の更新は、全部の依頼が終わってから、ユーザーがクラウドの Claude に頼む
