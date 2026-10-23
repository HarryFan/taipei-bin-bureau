"""行政區相關的近似範圍。

開放資料 121355 的北投區是 0 筆，不是北投沒有垃圾桶，而是資料缺漏。
還沒拿到行政區界 GeoJSON 前，先用手描的粗略多邊形把北投圈起來，
讓缺口模型不要把北投的需求算成「最缺垃圾桶」。拿到正式區界後請換掉。
"""

# (lng, lat)，沿北投區與士林區交界（磺溪一帶）粗略描出，誤差約數百公尺
BEITOU_APPROX = [
    (121.455, 25.115), (121.480, 25.100), (121.505, 25.103), (121.515, 25.105),
    (121.522, 25.110), (121.528, 25.125), (121.540, 25.150), (121.560, 25.210),
    (121.480, 25.210), (121.455, 25.150),
]

# 開放資料裡沒有點位的區域：網格標成 missingData，不列入缺口排名與候選新設點
MISSING_DATA_AREAS = {"北投區": BEITOU_APPROX}


def in_polygon(lng: float, lat: float, poly: list[tuple[float, float]]) -> bool:
    inside = False
    j = len(poly) - 1
    for i, (xi, yi) in enumerate(poly):
        xj, yj = poly[j]
        if (yi > lat) != (yj > lat) and lng < (xj - xi) * (lat - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def missing_area(lat: float, lng: float) -> str | None:
    for name, poly in MISSING_DATA_AREAS.items():
        if in_polygon(lng, lat, poly):
            return name
    return None
