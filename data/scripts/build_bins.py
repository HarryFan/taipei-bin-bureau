"""把環保局「行人專用清潔箱」CSV 轉成前端用的 bins.json。

用法：python3 data/scripts/build_bins.py [CSV 路徑]
未指定時依序找：
  data/raw/bins.csv                       自行下載的最新版（不進版控）
  data/open/121355-pedestrian-bins.csv    repo 內附的開放資料（2026-10 下載，661 筆）
  data/mock/bins.mock.csv                 模擬資料

開放資料有少數髒資料，這裡會自動修正並印出來：
  - 經緯度填反（經度 25.x、緯度 121.x）→ 對調
  - 小數點多一個（121.513.652）→ 只留第一個小數點
  - 修正後仍不在台北市範圍內 → 略過
"""
import csv
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "data" / "raw" / "bins.csv"
OPEN = ROOT / "data" / "open" / "121355-pedestrian-bins.csv"
MOCK = ROOT / "data" / "mock" / "bins.mock.csv"
META = ROOT / "apps" / "web" / "public" / "data" / "meta.json"
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


# 台北市大致範圍，用來判斷座標是否合理
LAT_RANGE = (24.95, 25.22)
LNG_RANGE = (121.45, 121.67)


def to_float(text: str) -> float:
    """「121.513.652」這種多一個小數點的，只保留第一個小數點"""
    head, dot, tail = text.strip().partition(".")
    return float(head + dot + tail.replace(".", ""))


def in_taipei(lat: float, lng: float) -> bool:
    return LAT_RANGE[0] < lat < LAT_RANGE[1] and LNG_RANGE[0] < lng < LNG_RANGE[1]


def clean_coords(row: dict) -> tuple[float, float, str] | None:
    """回傳 (lat, lng, 修正說明)；無法修正回傳 None"""
    raw_lat, raw_lng = pick(row, "緯度", "lat", "Latitude"), pick(row, "經度", "lng", "Longitude")
    try:
        lat, lng = float(raw_lat), float(raw_lng)
        fix = ""
    except ValueError:
        try:
            lat, lng = to_float(raw_lat), to_float(raw_lng)
        except ValueError:
            return None
        fix = f"小數點多一個（{raw_lng}, {raw_lat}）"
    if not in_taipei(lat, lng) and in_taipei(lng, lat):
        lat, lng = lng, lat
        fix = "經緯度填反"
    return (lat, lng, fix) if in_taipei(lat, lng) else None


def pick_source() -> Path:
    if len(sys.argv) > 1:
        return Path(sys.argv[1])
    return next(p for p in (RAW, OPEN, MOCK) if p.exists())


def main() -> None:
    src = pick_source()
    bins = []
    for i, row in enumerate(read_rows(src)):
        place = pick(row, "地址") or pick(row, "路名") + pick(row, "段號及其他註明")
        got = clean_coords(row)
        if got is None:
            print(f"  略過第 {i + 2} 行：{pick(row, '行政區')} {place} 座標無法辨識")
            continue
        lat, lng, fix = got
        if fix:
            print(f"  修正第 {i + 2} 行：{pick(row, '行政區')} {place}，{fix}")
        bins.append({
            "id": f"bin-{i:04d}",
            "district": pick(row, "行政區"),
            "road": place,
            "note": pick(row, "備註"),
            "lat": round(lat, 6),
            "lng": round(lng, 6),
        })
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(bins, ensure_ascii=False, indent=1), encoding="utf-8")
    write_meta("bins", "mock" if src == MOCK else "real", src.name)
    print(f"{src.name} → {OUT.relative_to(ROOT)}：{len(bins)} 個垃圾桶")


def write_meta(key: str, kind: str, source: str) -> None:
    """記錄前端用的是真實還是模擬資料，畫面上會標示"""
    meta = json.loads(META.read_text(encoding="utf-8")) if META.exists() else {}
    meta[key] = {"kind": kind, "source": source}
    META.write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
