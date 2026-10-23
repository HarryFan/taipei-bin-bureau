"""把「人潮熱點清潔箱設置處數」CSV（130 個熱點）轉成 hotspots.json。

來源：data/open/hotspot-bins-130.csv，欄位 行政區、地址（熱點名稱）、經度、緯度、備註（N處）。
這份資料有北投區，可以補 121355 北投 0 筆的缺口；同一個捷運站可能同時列在兩個行政區（共 7 站），
輸出時依名稱合併，保留第一筆座標，處數取較大值、行政區全部列出。
處數單位是「處」，不能和 121355 的點位筆數或官方「組」數直接相加。
"""
import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "data" / "open" / "hotspot-bins-130.csv"
OUT = ROOT / "apps" / "web" / "public" / "data" / "hotspots.json"


def main() -> None:
    merged: dict[str, dict] = {}
    with SRC.open(encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            name = row["地址"].strip()
            count = int(row["備註"].strip().rstrip("處") or 0)
            if name in merged:
                h = merged[name]
                h["count"] = max(h["count"], count)
                if row["行政區"] not in h["districts"]:
                    h["districts"].append(row["行政區"])
                continue
            merged[name] = {
                "id": f"hot-{len(merged):03d}",
                "name": name,
                "districts": [row["行政區"]],
                "count": count,
                "lat": round(float(row["緯度"]), 6),
                "lng": round(float(row["經度"]), 6),
            }
    hotspots = list(merged.values())
    OUT.write_text(json.dumps(hotspots, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{SRC.name} → {OUT.relative_to(ROOT)}：{len(hotspots)} 個熱點，共 {sum(h['count'] for h in hotspots)} 處")


if __name__ == "__main__":
    main()
