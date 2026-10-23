"""把環保局「行人專用清潔箱」CSV 轉成前端用的 bins.json。

用法：python3 data/scripts/build_bins.py [CSV 路徑]
未指定時讀 data/raw/bins.csv，不存在就用 data/sample/bins.sample.csv。
"""
import csv
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "data" / "raw" / "bins.csv"
SAMPLE = ROOT / "data" / "sample" / "bins.sample.csv"
OUT = ROOT / "apps" / "web" / "public" / "data" / "bins.json"


def read_rows(path: Path) -> list[dict]:
    for enc in ("utf-8-sig", "cp950", "big5"):
        try:
            with path.open(encoding=enc, newline="") as f:
                return list(csv.DictReader(f))
        except UnicodeDecodeError:
            continue
    raise SystemExit(f"無法辨識 {path} 的編碼")


def pick(row: dict, *keys: str) -> str:
    for k in keys:
        if row.get(k):
            return row[k].strip()
    return ""


def main() -> None:
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else (RAW if RAW.exists() else SAMPLE)
    bins = []
    for i, row in enumerate(read_rows(src)):
        try:
            lat = float(pick(row, "緯度", "lat", "Latitude"))
            lng = float(pick(row, "經度", "lng", "Longitude"))
        except ValueError:
            continue
        bins.append({
            "id": f"bin-{i:04d}",
            "district": pick(row, "行政區"),
            "road": pick(row, "路名") + pick(row, "段號及其他註明"),
            "note": pick(row, "備註"),
            "lat": round(lat, 6),
            "lng": round(lng, 6),
        })
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(bins, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{src.name} → {OUT.relative_to(ROOT)}：{len(bins)} 個垃圾桶")


if __name__ == "__main__":
    main()
