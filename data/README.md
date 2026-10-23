# 資料管線

流程：**原始資料 → 統一格式 → 模型 → 前端 JSON**

```
data/raw/        自行下載的原始開放資料（不進版控）
data/interim/    轉成統一格式的中間檔（不進版控）
data/private/    「市長你給我聽好了」資料集（僅限本活動，絕對不 commit）
data/sample/     樣本資料，讓前端在沒下載資料前也能跑
data/scripts/    轉換與模型腳本（只用 Python 標準庫）
```

執行：`npm run data:build`（在 repo 根目錄）

## 資料集與分工

| 資料 | 放到 | 轉成 | 真實／模擬 |
| --- | --- | --- | --- |
| [臺北市行人專用清潔箱（位置）](https://data.gov.tw/dataset/121355) | `raw/bins.csv` | `build_bins.py` 直接讀 | 真實 |
| [臺北捷運各站分時進出量](https://data.taipei/dataset/detail?id=63f31c7e-7fc3-418b-bd82-b95158755b4d) | `raw/` | `interim/demand_points.csv`，source=`mrt`（需另外對應車站座標） | 真實 |
| [臺北市公車站牌位置圖](https://data.taipei/dataset/detail?id=48aa5bca-2a4f-4fb7-a658-43cba51d5d56) | `raw/` | source=`bus`，value=1 | 真實 |
| [臺北市陳情系統類別資料](https://data.taipei/dataset/detail?id=cb423c17-88eb-4231-a725-f1b93247d1bf) | `raw/` | source=`complaint` | 真實 |
| 商圈／夜市 | `raw/` | source=`market` | 真實或手動標註 |
| 填滿率 | — | `simulate_fill.py` | **模擬** |

`interim/demand_points.csv` 格式：

```csv
lat,lng,source,value
25.0478,121.5170,mrt,300000
```

權重與網格大小在 `build_grid.py` 最上面調整。
