"""【模擬資料】產生全台北市規模的垃圾桶與需求點，讓 Demo 在拿到真實資料前就能跑。

輸出：
  data/mock/bins.mock.csv           661 個垃圾桶點位（筆數與欄位同環保局開放資料 121355）
  data/mock/demand_points.mock.csv  捷運、公車、陳情、商圈四類需求點

注意：
  - 捷運站與商圈座標為「約略位置」，人流數字為依站點規模假設的量級，不是真實統計。
  - 垃圾桶刻意在部分高人流區少放，模擬「垃圾桶沙漠」，讓缺口模型有東西可以找。
  - 固定亂數種子，每次產生的結果相同。拿到真實資料後放進 data/raw/ 即可取代。

用法：python3 data/scripts/generate_mock.py
"""
import csv
import math
import random
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "mock"
SEED = 20261023
TARGET_BINS = 661  # 對齊開放資料 121355（2026-10-21 版）的點位筆數

# 行政區約略中心（用來替模擬點標上行政區）
DISTRICTS = {
    "中正區": (25.0324, 121.5199), "大同區": (25.0634, 121.5130), "中山區": (25.0685, 121.5266),
    "松山區": (25.0597, 121.5577), "大安區": (25.0264, 121.5435), "萬華區": (25.0286, 121.4979),
    "信義區": (25.0306, 121.5716), "士林區": (25.0927, 121.5245), "北投區": (25.1321, 121.5015),
    "內湖區": (25.0790, 121.5868), "南港區": (25.0548, 121.6066), "文山區": (24.9982, 121.5562),
}

# 捷運站：名稱、緯度、經度、每日進出量級（假設值，台北車站最大）、垃圾桶覆蓋係數（<1 代表刻意少放＝沙漠）
STATIONS = [
    ("台北車站", 25.0478, 121.5170, 300, 0.9), ("西門", 25.0421, 121.5081, 160, 1.1), ("中山", 25.0527, 121.5204, 120, 0.6),
    ("雙連", 25.0577, 121.5206, 45, 0.5), ("民權西路", 25.0626, 121.5193, 60, 0.7), ("圓山", 25.0713, 121.5200, 35, 0.8),
    ("劍潭", 25.0849, 121.5250, 55, 1.2), ("士林", 25.0935, 121.5262, 70, 0.6), ("芝山", 25.1030, 121.5225, 30, 0.9),
    ("石牌", 25.1146, 121.5155, 40, 0.8), ("北投", 25.1320, 121.4986, 35, 1.0), ("善導寺", 25.0446, 121.5232, 30, 1.0),
    ("忠孝新生", 25.0423, 121.5330, 75, 0.7), ("忠孝復興", 25.0416, 121.5438, 130, 0.5), ("忠孝敦化", 25.0414, 121.5509, 90, 0.4),
    ("國父紀念館", 25.0413, 121.5577, 60, 1.0), ("市政府", 25.0411, 121.5651, 110, 1.1), ("永春", 25.0408, 121.5761, 40, 0.7),
    ("後山埤", 25.0450, 121.5826, 30, 0.8), ("龍山寺", 25.0353, 121.5000, 50, 0.9), ("小南門", 25.0360, 121.5110, 15, 1.0),
    ("中正紀念堂", 25.0327, 121.5181, 45, 1.3), ("古亭", 25.0263, 121.5228, 50, 0.7), ("台電大樓", 25.0207, 121.5281, 45, 0.6),
    ("公館", 25.0149, 121.5343, 80, 0.8), ("萬隆", 25.0019, 121.5390, 30, 0.6), ("景美", 24.9928, 121.5408, 35, 0.7),
    ("東門", 25.0339, 121.5287, 65, 0.6), ("大安森林公園", 25.0336, 121.5355, 30, 1.2), ("大安", 25.0330, 121.5434, 70, 0.5),
    ("信義安和", 25.0332, 121.5527, 40, 0.6), ("台北101/世貿", 25.0330, 121.5628, 85, 1.0), ("科技大樓", 25.0261, 121.5436, 35, 0.7),
    ("六張犁", 25.0237, 121.5530, 25, 0.8), ("南京復興", 25.0521, 121.5440, 95, 0.5), ("中山國中", 25.0608, 121.5442, 25, 0.9),
    ("松山機場", 25.0630, 121.5519, 30, 1.1), ("大直", 25.0794, 121.5469, 25, 0.9), ("劍南路", 25.0848, 121.5555, 30, 0.8),
    ("西湖", 25.0821, 121.5672, 35, 0.6), ("港墘", 25.0802, 121.5751, 40, 0.5), ("內湖", 25.0838, 121.5943, 35, 0.8),
    ("南京三民", 25.0516, 121.5640, 30, 0.9), ("松山", 25.0500, 121.5778, 55, 1.0), ("行天宮", 25.0597, 121.5331, 45, 0.6),
    ("松江南京", 25.0520, 121.5330, 70, 0.5), ("動物園", 24.9982, 121.5795, 30, 1.2), ("南港展覽館", 25.0553, 121.6176, 35, 1.0),
    ("南港", 25.0520, 121.6070, 40, 0.9), ("昆陽", 25.0504, 121.5933, 30, 0.8),
]

# 夜市與商圈：名稱、緯度、經度、強度、垃圾桶覆蓋係數
MARKETS = [
    ("士林夜市", 25.0880, 121.5241, 1.0, 1.3), ("饒河街夜市", 25.0511, 121.5776, 0.8, 1.2), ("寧夏夜市", 25.0566, 121.5154, 0.8, 1.2),
    ("華西街夜市", 25.0372, 121.4986, 0.5, 1.0), ("通化街夜市", 25.0302, 121.5543, 0.6, 0.7), ("師大夜市", 25.0242, 121.5288, 0.6, 0.5),
    ("南機場夜市", 25.0297, 121.5072, 0.5, 0.9), ("公館商圈", 25.0141, 121.5343, 0.6, 0.8), ("東區商圈", 25.0415, 121.5480, 0.9, 0.4),
    ("信義商圈", 25.0365, 121.5670, 0.9, 1.0), ("西門町", 25.0434, 121.5070, 1.0, 1.1), ("永康街", 25.0323, 121.5296, 0.6, 0.5),
    ("北投市場", 25.1316, 121.5016, 0.4, 0.9), ("內湖科學園區", 25.0790, 121.5745, 0.7, 0.4), ("赤峰街", 25.0547, 121.5200, 0.5, 0.4),
]


def jitter(rng: random.Random, lat: float, lng: float, meters: float) -> tuple[float, float]:
    """以常態分布在某點附近灑點，meters 為標準差"""
    dlat = rng.gauss(0, meters) / 111_320
    dlng = rng.gauss(0, meters) / (111_320 * math.cos(math.radians(lat)))
    return round(lat + dlat, 6), round(lng + dlng, 6)


def nearest_district(lat: float, lng: float) -> str:
    return min(DISTRICTS, key=lambda d: (DISTRICTS[d][0] - lat) ** 2 + (DISTRICTS[d][1] - lng) ** 2)


def main() -> None:
    rng = random.Random(SEED)
    OUT.mkdir(parents=True, exist_ok=True)

    # ---- 垃圾桶：依人流 × 覆蓋係數分配名額，集中在站點與商圈周邊 ----
    anchors = [(f"捷運{n}站", lat, lng, math.sqrt(flow) * cov, 220) for n, lat, lng, flow, cov in STATIONS]
    anchors += [(n, lat, lng, 10 * w * cov, 160) for n, lat, lng, w, cov in MARKETS]
    total_w = sum(a[3] for a in anchors)
    bins = []
    for name, lat, lng, w, spread in anchors:
        count = max(2, round(TARGET_BINS * 0.85 * w / total_w))
        for k in range(count):
            blat, blng = jitter(rng, lat, lng, spread)
            bins.append((nearest_district(blat, blng), f"{name}周邊", f"第 {k + 1} 組", blng, blat))
    # 其餘零星散布在各區住宅區
    while len(bins) < TARGET_BINS:
        d = rng.choice(list(DISTRICTS))
        blat, blng = jitter(rng, *DISTRICTS[d], 900)
        bins.append((nearest_district(blat, blng), f"{d}巷弄", f"散點 {len(bins) + 1}", blng, blat))
    bins = bins[:TARGET_BINS]

    with (OUT / "bins.mock.csv").open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow(["行政區", "路名", "段號及其他註明", "經度", "緯度", "備註"])
        for row in bins:
            w.writerow([*row, "模擬資料"])

    # ---- 需求點：統一格式 lat,lng,source,value ----
    points = []
    for _, lat, lng, flow, _ in STATIONS:
        points.append((lat, lng, "mrt", flow * 1000))  # 每日進出人次量級（假設）
        for _ in range(round(flow / 12) + 2):  # 站點周邊公車站
            points.append((*jitter(rng, lat, lng, 350), "bus", 1))
    for _, lat, lng, strength, _ in MARKETS:
        points.append((lat, lng, "market", strength))
        for _ in range(round(strength * 14)):  # 商圈周邊的陳情通報
            points.append((*jitter(rng, lat, lng, 200), "complaint", 1))
    for d, (lat, lng) in DISTRICTS.items():  # 各區零星公車站與陳情
        for _ in range(18):
            points.append((*jitter(rng, lat, lng, 1000), "bus", 1))
        for _ in range(6):
            points.append((*jitter(rng, lat, lng, 800), "complaint", 1))

    with (OUT / "demand_points.mock.csv").open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow(["lat", "lng", "source", "value"])
        w.writerows(points)

    print(f"→ data/mock：{len(bins)} 個垃圾桶、{len(points)} 個需求點（模擬資料）")


if __name__ == "__main__":
    main()
