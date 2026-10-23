"""把需求點與垃圾桶彙整成網格，算出缺口與建議新設點。

輸入：data/interim/demand_points.csv（不存在就用 sample）
  欄位 lat,lng,source,value；source 為 mrt / bus / complaint / market
  每份開放資料先各自轉成這個格式，模型就不用管原始資料長怎樣。
輸出：apps/web/public/data/grid.json
"""
import csv
import json
import math
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
POINTS = ROOT / "data" / "interim" / "demand_points.csv"
SAMPLE_POINTS = ROOT / "data" / "sample" / "demand_points.sample.csv"
BINS = ROOT / "apps" / "web" / "public" / "data" / "bins.json"
OUT = ROOT / "apps" / "web" / "public" / "data" / "grid.json"

CELL_M = 250
LAT_STEP = CELL_M / 111_320
LNG_STEP = CELL_M / (111_320 * math.cos(math.radians(25.05)))

# 需求權重：可在提案時調整並說明
WEIGHTS = {"mrt": 0.4, "complaint": 0.3, "bus": 0.2, "market": 0.1}
# 每個垃圾桶抵銷多少需求（0~1 尺度）
SUPPLY_PER_BIN = 0.25
TOP_N = 10


def cell_key(lat: float, lng: float) -> tuple[int, int]:
    return math.floor(lat / LAT_STEP), math.floor(lng / LNG_STEP)


def cell_center(k: tuple[int, int]) -> tuple[float, float]:
    return (k[0] + 0.5) * LAT_STEP, (k[1] + 0.5) * LNG_STEP


def main() -> None:
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else (POINTS if POINTS.exists() else SAMPLE_POINTS)

    raw: dict[tuple[int, int], dict[str, float]] = defaultdict(lambda: defaultdict(float))
    with src.open(encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            raw[cell_key(float(row["lat"]), float(row["lng"]))][row["source"]] += float(row["value"])

    max_by_source: dict[str, float] = defaultdict(float)
    for sources in raw.values():
        for s, v in sources.items():
            max_by_source[s] = max(max_by_source[s], v)

    supply: dict[tuple[int, int], int] = defaultdict(int)
    for b in json.loads(BINS.read_text(encoding="utf-8")):
        supply[cell_key(b["lat"], b["lng"])] += 1

    cells = []
    for k in set(raw) | set(supply):
        demand = sum(
            WEIGHTS.get(s, 0) * v / max_by_source[s]
            for s, v in raw.get(k, {}).items()
            if max_by_source[s] > 0
        )
        lat, lng = cell_center(k)
        cells.append({
            "id": f"c{k[0]}_{k[1]}",
            "lat": round(lat, 6),
            "lng": round(lng, 6),
            "demand": round(demand, 4),
            "supply": supply.get(k, 0),
            "gap": round(demand - SUPPLY_PER_BIN * supply.get(k, 0), 4),
        })

    suggestions = [c["id"] for c in sorted(cells, key=lambda c: -c["gap"]) if c["gap"] > 0][:TOP_N]
    OUT.write_text(json.dumps({
        "cellMeters": CELL_M,
        "cellSizeDeg": {"lat": LAT_STEP, "lng": LNG_STEP},
        "weights": WEIGHTS,
        "cells": cells,
        "suggestions": suggestions,
    }, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{src.name} → {OUT.relative_to(ROOT)}：{len(cells)} 格，建議 {len(suggestions)} 處")


if __name__ == "__main__":
    main()
