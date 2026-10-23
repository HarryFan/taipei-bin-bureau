"""【模擬資料】產生每個垃圾桶的填滿率與「幾天前有人確認過」，代替不存在的 IoT 感測與巡查紀錄。

checkedDaysAgo 用相對天數而不是日期，靜態檔放久了也不會變成「全部很久沒確認」。

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
        {
            "id": b["id"],
            "fill": round(min(1.0, rng.betavariate(2.4, 2.6)), 2),
            "updatedAt": now,
            "checkedDaysAgo": min(90, int(rng.expovariate(1 / 12))),
            "simulated": True,
        }
        for b in json.loads(BINS.read_text(encoding="utf-8"))
    ]
    OUT.write_text(json.dumps(levels, ensure_ascii=False, indent=1), encoding="utf-8")
    full = sum(l["fill"] >= 0.8 for l in levels)
    stale = sum(l["checkedDaysAgo"] >= 14 for l in levels)
    print(f"→ {OUT.relative_to(ROOT)}：{len(levels)} 個，{full} 個 ≥ 80%，{stale} 個超過 14 天沒人確認")


if __name__ == "__main__":
    main()
