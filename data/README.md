# 資料管線

> 資料來源、單位與限制請先讀 [`docs/DATA_SOURCES.md`](../docs/DATA_SOURCES.md)。

流程：**原始資料 → 統一格式 → 模型 → 前端 JSON**

```
data/raw/        自行下載的原始開放資料（不進版控）
data/interim/    轉成統一格式的中間檔（不進版控）
data/private/    「市長你給我聽好了」資料集（僅限本活動，絕對不 commit）
data/mock/       模擬資料（全台北市規模），沒有真實資料時的預設來源
data/scripts/    轉換與模型腳本（只用 Python 標準庫）
```

執行：`npm run data:build`（在 repo 根目錄）

**優先順序**：`data/raw/bins.csv`、`data/interim/demand_points.csv` 存在就用真實資料，否則用 `data/mock/`。前端會讀 `meta.json`，用模擬資料時畫面上會標示「模擬資料」。

**模擬資料**：`npm run data:mock` 重新產生。約 800 個垃圾桶集中在捷運站與商圈周邊，並在忠孝復興、東區、內科等人流大的地方刻意少放，模擬「垃圾桶沙漠」。捷運站與商圈為約略座標，人流數字是假設量級，不是真實統計。

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
