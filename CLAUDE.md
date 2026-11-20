# トランジット通知Bot

毎朝その日のトランジット天体と出生図のアスペクトを計算して、LINEに届ける Google Apps Script（GAS）Bot。
天文計算は外部APIを使わず、GAS単体で完結させる。

## セッション開始時にやること

1. 前提ツールの確認: `node --version` と `python --version`（Windows。mac/Linux は `python3`）。どちらかが無ければユーザーに伝えて止まる
2. 検証環境: `python -m pip install -r test/requirements.txt`（pyswisseph。初回のみ）
3. `python test/compare.py` が全項目 OK になることを確認（＝Step 1 が壊れていない）
4. 下の「ロードマップ」で次のStepを確認し、未確定の仕様をユーザーに聞いてから着手

## 進め方のルール

- 返答・コメントは日本語
- **1回に1つの変更**。変更したら検証してから次へ進む
- コードは差分ではなく、**そのまま貼れる完全なファイル**で提示する（GASエディタに手で貼る運用もあるため）
- 新しいStepに入るときは、未確定の仕様を先にユーザーに確認する

## 構成

```
transit-bot/
├── CLAUDE.md
├── .clasp.json.example   # clasp を使う場合にコピーして scriptId を入れる
├── src/                  # GASに載せるファイル（clasp の rootDir）
│   ├── appsscript.json   # V8 / Asia/Tokyo
│   └── ephemeris.gs      # Step 1: 天体位置計算
└── test/
    ├── run_gas.js        # src/*.gs を Node で実行するハーネス（GAS APIはスタブ）
    ├── compare.py        # Swiss Ephemeris との精度比較テスト
    └── requirements.txt
```

GASは全 `.gs` が同じグローバルスコープを共有する。ファイル間で関数名・定数名を衝突させないこと。
非公開ヘルパーは末尾 `_`（例: `dayNumber_`）。GASの実行メニューに出さないための慣習。

## 現状

### Step 1 天体位置計算 — 完了（`src/ephemeris.gs`）

公開関数:

| 関数 | 戻り値 |
|---|---|
| `planetLongitudes(date)` | `{ 太陽: 黄経, 月: …, …, 冥王星: … }`（度・0〜360） |
| `planetPositions(date)` | `{ 太陽: { lon, speed, retro }, … }`（speed は°/日、前後12時間差分） |
| `angles(date, lat, lon)` | `{ ASC, MC }`（度） |
| `formatLon(lon)` | `"山羊座 6°13'"` 形式の文字列 |
| `testStep1()` | 出生図と現在のトランジットをログ出力 |

定数: `NATAL`（出生データ）、`PLANETS`（天体名の配列・日本語）、`SIGNS`（星座名）。

精度（Swiss Ephemeris Moshier と比較、1950〜2050年のランダム2000時点）:

| 天体 | 最大誤差 |
|---|---|
| 月 | 6.4′ |
| 火星 / 土星 | 3.4′ / 3.2′ |
| その他の惑星・太陽 | 2.4′以内 |
| ASC / MC | 0.8′ / 0.6′ |
| 逆行判定 | 不一致 0 件（留の付近は除外） |

出生図の計算値（**ユーザーが手元のチャートと照合済み・一致**）:
太陽 山羊座6°13'／月 牡羊座28°48'／ASC 牡牛座6°18'／MC 山羊座22°25'

### 計算上の注意

- 計算法は Paul Schlyter「How to compute planetary positions」。トロピカル、分点は観測日（of date）
- **冥王星の近似式はそのまま観測日分点として使う**。歳差補正（`+3.82394e-5 * d`）を足すと二重補正になり、年あたり約50″ずれる（実際に一度この誤りで最大43′ずれ、修正済み）
- 冥王星の近似式は1885〜2099年の範囲でだけ有効
- 光行差・章動は未補正（誤差は上の表の範囲に収まっている）
- ハウスはASC/MCだけ。ハウスシステム（プラシーダス等）は未実装
- 月は1時間に約0.5°動くので、アスペクト判定は通知時刻を基準に計算する

## ロードマップ

### Step 2 アスペクト判定（`src/aspects.gs`）— 次にやる

- 判定対象: トランジット10天体 × 出生図（10天体＋ASC＋MC）
- 確定した仕様（2026-11-20 ユーザー確認済み）:
  - アスペクト11種: メジャー 0°・60°・90°・120°・180°、マイナー 30°・45°・135°・150°、クインタイル系 72°・144°
  - オーブ（度）はトランジット天体のグループ × アスペクトで決める（広め案）:

    | アスペクト | 月 | 太陽〜火星 | 木星〜冥王星 |
    |---|---|---|---|
    | 0° / 180° | 5 | 2.5 | 1.5 |
    | 90° / 120° | 5 | 2.5 | 1.5 |
    | 60° | 3 | 2 | 1 |
    | 150° | 2 | 1.5 | 1 |
    | 30° / 45° / 135° | 1.5 | 1 | 0.5 |
    | 72° / 144° | 1.5 | 1 | 0.5 |

  - 出生図側が 太陽・月・ASC・MC のときは、上の値に **+0.5°**
- 出力イメージ: `[{ transit, natal, aspect, orb, applying }]`（applying は speed から接近か分離かを判定）
- 検証: 既知の日付で手計算（または Swiss Ephemeris）と照合するテストを `test/` に足す

### Step 3 LINE送信（`src/line.gs`）

- LINE Notify は2025年3月末で終了しているので、**Messaging API の push メッセージ**を使う
- `LINE_CHANNEL_ACCESS_TOKEN` と `LINE_USER_ID` はスクリプトプロパティに保存し、コードやリポジトリに書かない
- 無料プランの月間送信数の上限は、着手時に現行のものを確認する
- 検証: `run_gas.js` に `UrlFetchApp` / `PropertiesService` のスタブを足し、送信ペイロードを Node 上で確かめてから実送信する

### Step 4 定期実行（`src/main.gs`）

- 時間主導型トリガーで毎朝実行（時刻は未定、仮に7:00 JST）
- トリガー設定用の関数（`setupTrigger()` など）を用意し、二重登録を防ぐ

### 未定事項

- 通知文の解釈を定型文にするか、LLMで生成するか
- 通知時刻

## 検証コマンド

```bash
python -m pip install -r test/requirements.txt   # 初回のみ（pyswisseph）
python test/compare.py                           # 精度テスト。NGなら終了コード1
node test/run_gas.js --call testStep1            # GAS関数を Node で実行
```

- 開発PCは Windows。`python3` ではなく `python`（または `py`）を使う
- `src/` を変えたら、まず `python test/compare.py` が通ることを確認する
- Node が書き出すJSONはUTF-8（天体名が日本語キー）。Python側で読むときは必ず `encoding='utf-8'` を付ける（Windowsの既定は cp932）

## デプロイ

- 手動: GASエディタで新規プロジェクトを作り、`src/*.gs` を同名ファイルとして貼る。プロジェクトのタイムゾーンは Asia/Tokyo
- clasp（任意）: `.clasp.json.example` を `.clasp.json` にコピーして scriptId を入れ、`clasp push`。`.clasp.json` は git に入れない
