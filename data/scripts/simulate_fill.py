"""【模擬資料】產生每個垃圾桶的填滿率，代替不存在的 IoT 感測資料。

固定亂數種子，每次產生的結果一樣，Demo 才穩定。
"""
import json
import random
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BINS = ROOT / "apps" / "web" / "public" / "data" / "bins.json"
OUT = ROOT / "apps" / "web" / "public" / "data" / "fill_levels.json"
SEED = 20261024


def main() -> None:
    rng = random.Random(SEED)
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    levels = [
        {"id": b["id"], "fill": round(min(1.0, rng.betavariate(2.4, 2.6)), 2), "updatedAt": now}
        for b in json.loads(BINS.read_text(encoding="utf-8"))
    ]
    OUT.write_text(json.dumps(levels, ensure_ascii=False, indent=1), encoding="utf-8")
    full = sum(l["fill"] >= 0.8 for l in levels)
    print(f"→ {OUT.relative_to(ROOT)}：{len(levels)} 個，{full} 個 ≥ 80%")


if __name__ == "__main__":
    main()
