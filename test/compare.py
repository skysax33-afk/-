"""
ephemeris.gs の計算結果を Swiss Ephemeris（Moshier）と比較する精度テスト

使い方（リポジトリ直下で）:
    python -m pip install -r test/requirements.txt
    python test/compare.py        （mac/Linux は python3）

1950〜2050年のランダム2000時点＋出生時刻で、各天体の黄経・ASC/MC・逆行判定を比較。
しきい値を超えたら終了コード1を返す。
"""
import datetime as dt
import json
import os
import random
import subprocess
import sys

import swisseph as swe

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
IN_PATH = os.path.join(HERE, 'positions_in.tmp.json')
OUT_PATH = os.path.join(HERE, 'positions_out.tmp.json')

LAT, LON = 35.0116, 135.7681  # 京都市中京区（NATALと同じ）
NAMES = ['太陽', '月', '水星', '金星', '火星', '木星', '土星', '天王星', '海王星', '冥王星']
IDS = [swe.SUN, swe.MOON, swe.MERCURY, swe.VENUS, swe.MARS,
       swe.JUPITER, swe.SATURN, swe.URANUS, swe.NEPTUNE, swe.PLUTO]

# 許容誤差（分角）
LIMITS = {name: 5.0 for name in NAMES}
LIMITS['月'] = 10.0
LIMITS['ASC'] = 2.0
LIMITS['MC'] = 2.0


def diff_arcmin(a, b):
    return abs((a - b + 180) % 360 - 180) * 60


def main():
    # Windows でパイプ出力（Claude Code 経由など）のとき cp932 で化けたり落ちたりしないように
    if not (sys.stdout.encoding or '').lower().startswith('utf'):
        sys.stdout.reconfigure(encoding='utf-8')
    random.seed(1)
    natal = dt.datetime(1998, 12, 28, 4, 8, tzinfo=dt.timezone.utc)  # 13:08 JST
    base = dt.datetime(1950, 1, 1, tzinfo=dt.timezone.utc)
    stamps = [natal] + [base + dt.timedelta(days=random.uniform(0, 365.25 * 100)) for _ in range(2000)]
    ts = [int(s.timestamp() * 1000) for s in stamps]

    with open(IN_PATH, 'w', encoding='utf-8') as f:
        json.dump({'lat': LAT, 'lon': LON, 'timestamps': ts}, f)
    subprocess.run(['node', os.path.join(HERE, 'run_gas.js'), '--positions', IN_PATH, OUT_PATH],
                   check=True)
    with open(OUT_PATH, encoding='utf-8') as f:
        results = json.load(f)

    worst = {k: 0.0 for k in LIMITS}
    retro_mismatch = 0
    for t, r in zip(ts, results):
        d = dt.datetime.fromtimestamp(t / 1000, dt.timezone.utc)
        jd = swe.julday(d.year, d.month, d.day, d.hour + d.minute / 60 + d.second / 3600)
        for name, pid in zip(NAMES, IDS):
            x, _ = swe.calc_ut(jd, pid, swe.FLG_MOSEPH | swe.FLG_SPEED)
            worst[name] = max(worst[name], diff_arcmin(r['p'][name]['lon'], x[0]))
            # 留の付近（速度ほぼ0）は判定が揺れるので除外
            if abs(x[3]) > 0.02 and (x[3] < 0) != r['p'][name]['retro']:
                retro_mismatch += 1
        _, ascmc = swe.houses(jd, LAT, LON, b'P')
        worst['ASC'] = max(worst['ASC'], diff_arcmin(r['a']['ASC'], ascmc[0]))
        worst['MC'] = max(worst['MC'], diff_arcmin(r['a']['MC'], ascmc[1]))

    for p in (IN_PATH, OUT_PATH):
        os.remove(p)

    ok = True
    print(f'最大誤差（分角） / 許容値  — {len(ts)}時点')
    for k, v in worst.items():
        flag = 'OK ' if v <= LIMITS[k] else 'NG '
        ok &= v <= LIMITS[k]
        print(f'  {flag}{k:<4} {v:6.2f}′ / {LIMITS[k]:.0f}′')
    print(f'  {"OK " if retro_mismatch == 0 else "NG "}逆行判定の不一致: {retro_mismatch}')
    ok &= retro_mismatch == 0
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
