"""
aspects.gs のアスペクト判定を検証するテスト

使い方（リポジトリ直下で）:
    python test/compare_aspects.py        （mac/Linux は python3）

1. 手計算ケース: 位置と速度を直接与えて、判定・オーブ・接近/分離を確かめる
2. Swiss Ephemeris との照合: 1950〜2050年のランダム1000時点で、Swiss Ephemeris（Moshier）の
   位置に aspects.gs と同じオーブ表を当てた結果と比べる。
   位置の誤差（compare.py の許容値）の範囲でオーブの境界・正確な角度・留にかかるものは除外して数える
NGがあれば終了コード1を返す。
"""
import datetime as dt
import json
import os
import random
import subprocess
import sys

import swisseph as swe

from compare import IDS, LAT, LIMITS, LON, NAMES

HERE = os.path.dirname(os.path.abspath(__file__))
IN_PATH = os.path.join(HERE, 'aspects_in.tmp.json')
OUT_PATH = os.path.join(HERE, 'aspects_out.tmp.json')

NATAL_UTC = dt.datetime(1998, 12, 28, 4, 8, tzinfo=dt.timezone.utc)  # 13:08 JST

# 手計算ケース: (説明, transit, natal, 期待値 [(transit, natal, aspect, orb, applying)])
CASES = [
    ('スクエア・順行で接近（火星99° → 太陽10°、離角89°）',
     {'火星': {'lon': 99.0, 'speed': 0.6}}, {'太陽': 10.0},
     [('火星', '太陽', 'スクエア', 1.0, True)]),
    ('スクエア・逆行で分離（同じ位置で速度が負）',
     {'火星': {'lon': 99.0, 'speed': -0.3}}, {'太陽': 10.0},
     [('火星', '太陽', 'スクエア', 1.0, False)]),
    ('0°をまたぐコンジャンクション・接近（月358° → 月2°）',
     {'月': {'lon': 358.0, 'speed': 13.0}}, {'月': 2.0},
     [('月', '月', 'コンジャンクション', 4.0, True)]),
    ('オポジション・分離（土星190.8° ↔ 金星10°）',
     {'土星': {'lon': 190.8, 'speed': 0.05}}, {'金星': 10.0},
     [('土星', '金星', 'オポジション', 0.8, False)]),
    ('+0.5°の有無（冥王星 離角30.6°: 太陽は1.0°まで入る・水星は0.5°までで外れる）',
     {'冥王星': {'lon': 40.6, 'speed': 0.01}}, {'太陽': 10.0, '水星': 10.0},
     [('冥王星', '太陽', 'セミセクスタイル', 0.6, False)]),
    ('クインタイル（金星 離角73.2°: ASCは1.5°まで入る・火星は1.0°までで外れる）',
     {'金星': {'lon': 83.2, 'speed': 1.2}}, {'ASC': 10.0, '火星': 10.0},
     [('金星', 'ASC', 'クインタイル', 1.2, False)]),
    ('クインカンクス・月が接近（離角148.5°、144°側には入らない）',
     {'月': {'lon': 158.5, 'speed': 13.0}}, {'水星': 10.0},
     [('月', '水星', 'クインカンクス', 1.5, True)]),
    ('オーブの外は出さない（木星 離角91.6°、スクエアは1.5°まで）',
     {'木星': {'lon': 101.6, 'speed': 0.1}}, {'水星': 10.0},
     []),
]


def julday(d):
    return swe.julday(d.year, d.month, d.day, d.hour + d.minute / 60 + d.second / 3600)


def swe_positions(d):
    """Swiss Ephemeris の地心黄経と速度 {天体: (lon, speed)}"""
    jd = julday(d)
    out = {}
    for name, pid in zip(NAMES, IDS):
        x, _ = swe.calc_ut(jd, pid, swe.FLG_MOSEPH | swe.FLG_SPEED)
        out[name] = (x[0], x[3])
    return out


def swe_natal():
    pos = swe_positions(NATAL_UTC)
    points = {name: lon for name, (lon, _) in pos.items()}
    _, ascmc = swe.houses(julday(NATAL_UTC), LAT, LON, b'P')
    points['ASC'], points['MC'] = ascmc[0], ascmc[1]
    return points


def run_gas(timestamps, cases):
    with open(IN_PATH, 'w', encoding='utf-8') as f:
        json.dump({'timestamps': timestamps,
                   'cases': [{'transit': t, 'natal': n} for _, t, n, _ in cases]}, f)
    subprocess.run(['node', os.path.join(HERE, 'run_gas.js'), '--aspects', IN_PATH, OUT_PATH],
                   check=True)
    with open(OUT_PATH, encoding='utf-8') as f:
        out = json.load(f)
    for p in (IN_PATH, OUT_PATH):
        os.remove(p)
    return out


def check_cases(results):
    ok = True
    for (desc, _, _, expected), got in zip(CASES, results):
        got_t = sorted((h['transit'], h['natal'], h['aspect'], h['orb'], h['applying']) for h in got)
        exp_t = sorted(expected)
        same = len(got_t) == len(exp_t) and all(
            g[:3] == e[:3] and abs(g[3] - e[3]) < 1e-9 and g[4] == e[4] for g, e in zip(got_t, exp_t))
        print(f'  {"OK " if same else "NG "}{desc}')
        if not same:
            print(f'       期待: {exp_t}\n       結果: {got_t}')
        ok &= same
    return ok


def check_swe(stamps, dates, table, gas_natal):
    natal = swe_natal()
    # 出生図の位置が GAS と Swiss Ephemeris で許容値内か（前提の確認）
    natal_ok = all(abs((gas_natal[k] - v + 180) % 360 - 180) * 60 <= LIMITS[k] for k, v in natal.items())

    mismatch, boundary, orb_ng, appl_ng, appl_skip, total = 0, 0, 0, 0, 0, 0
    worst_orb = 0.0
    for d, gas_hits in zip(stamps, dates):
        transit = swe_positions(d)
        gas = {(h['transit'], h['natal'], h['aspect']): h for h in gas_hits}
        for t, (lon, speed) in transit.items():
            for n, nlon in natal.items():
                tol = (LIMITS[t] + LIMITS[n]) / 60  # 位置誤差の上限（度）
                delta = (lon - nlon + 180) % 360 - 180
                sep = abs(delta)
                for a in table['aspects']:
                    orb = abs(sep - a['angle'])
                    limit = a['orb'][table['group'][t]] + table['bonus'].get(n, 0)
                    expected = orb <= limit
                    hit = gas.get((t, n, a['name']))
                    if expected != (hit is not None):
                        if abs(orb - limit) <= tol:
                            boundary += 1
                        else:
                            mismatch += 1
                            print(f'    不一致 {d:%Y-%m-%d %H:%M} {t}→{n} {a["name"]} '
                                  f'SWEオーブ {orb:.3f}° 許容 {limit}° GAS {"あり" if hit else "なし"}')
                        continue
                    if hit is None:
                        continue
                    total += 1
                    diff = abs(hit['orb'] - orb)
                    worst_orb = max(worst_orb, diff * 60)
                    if diff > tol:
                        orb_ng += 1
                    # 正確な角度の付近・留の付近は接近/分離が揺れるので除外
                    if orb <= tol or abs(speed) <= 0.02:
                        appl_skip += 1
                        continue
                    applying = (sep - a['angle']) * (1 if delta >= 0 else -1) * speed < 0
                    if applying != hit['applying']:
                        appl_ng += 1

    print(f'  {"OK " if natal_ok else "NG "}出生図の位置（GAS と Swiss Ephemeris の差が compare.py の許容値内）')
    print(f'  {"OK " if mismatch == 0 else "NG "}判定の不一致: {mismatch}（オーブの境界で除外: {boundary}）')
    print(f'  {"OK " if orb_ng == 0 else "NG "}オーブの最大差: {worst_orb:.2f}′（位置の許容値を超えたもの: {orb_ng}）')
    print(f'  {"OK " if appl_ng == 0 else "NG "}接近/分離の不一致: {appl_ng}（正確・留の付近で除外: {appl_skip}）')
    print(f'  判定件数: {total}（1時点あたり平均 {total / len(stamps):.1f} 件）')
    return natal_ok and mismatch == 0 and orb_ng == 0 and appl_ng == 0


def main():
    # Windows でパイプ出力（Claude Code 経由など）のとき cp932 で化けたり落ちたりしないように
    if not (sys.stdout.encoding or '').lower().startswith('utf'):
        sys.stdout.reconfigure(encoding='utf-8')
    random.seed(2)
    base = dt.datetime(1950, 1, 1, tzinfo=dt.timezone.utc)
    stamps = [base + dt.timedelta(days=random.uniform(0, 365.25 * 100)) for _ in range(1000)]
    ts = [int(s.timestamp() * 1000) for s in stamps]
    stamps = [dt.datetime.fromtimestamp(t / 1000, dt.timezone.utc) for t in ts]  # ミリ秒に丸めた時刻で揃える

    out = run_gas(ts, CASES)

    print(f'手計算ケース（{len(CASES)}件）')
    ok = check_cases(out['cases'])
    print(f'Swiss Ephemeris との照合（{len(stamps)}時点）')
    ok &= check_swe(stamps, out['dates'], out['table'], out['natal'])
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
