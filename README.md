# 🗑️ 台北桶報局

> 市政 debug松 #2「找回消失的垃圾桶」｜隊伍：同流 One Flow

市民一鍵找到最近的垃圾桶、回報滿了或不見了；市府從同一份回報看見「垃圾桶沙漠」，並依填滿率安排清運。

工作清單與分工進度見 [TODO.md](TODO.md)；提交清單與 YouTube 影片腳本見 [docs/SUBMISSION.md](docs/SUBMISSION.md)。

**資料來源、數字單位與資料驅動的開發需求見 [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md)，動工前請先讀第 0 節。**

## 結構

```
apps/web    Vue 3 + Vite + TS + Tailwind + Leaflet（市民端 / 、市府端 /admin）
apps/api    暫用的 Node 小 API，正式版由 Pamis 以 ASP.NET Core 實作（端點相同）
data        Python 資料管線，輸出到 apps/web/public/data
docs/slides 團隊規劃簡報（直接用瀏覽器開 index.html，← → 翻頁、F 全螢幕）
```

前端只讀靜態 JSON 也能完整運作，API 掛掉 Demo 不受影響。

## 如何啟動專案

### 1. 準備環境（第一次才需要）

| 工具 | 版本 | 用途 |
| --- | --- | --- |
| [Node.js](https://nodejs.org/) | 22 LTS 以上 | 前端、簡報、暫用 API |
| [Python](https://www.python.org/) | 3.9 以上 | 資料管線（只有要重建資料時才需要） |
| Git、[GitHub CLI](https://cli.github.com/) | — | 取得程式碼 |

> Windows 安裝 Python 時請勾選 **Add python.exe to PATH**。

### 2. 取得程式碼並安裝

```bash
gh repo clone HarryFan/taipei-bin-bureau
cd taipei-bin-bureau
npm install
```

### 3. 啟動前端

```bash
npm run dev
```

打開 http://localhost:5173

| 網址 | 畫面 | 適合 |
| --- | --- | --- |
| http://localhost:5173/ | 市民端：找最近的垃圾桶、回報 | 手機（電腦也能看，清單在左側） |
| http://localhost:5173/#/admin | 市府戰情：缺口熱區、清運調度、即時回報 | 電腦、投影 |

不用啟動後端也能完整操作：資料讀 `apps/web/public/data/` 的靜態檔，回報存在瀏覽器裡。

### 4. 用手機看

```bash
npm run dev -- --host
```

終端機會顯示一個區網網址（例如 `http://192.168.1.23:5173`），手機連同一個 Wi-Fi 打開即可。

> 手機透過區網的 http 連線**拿不到定位**，會改用台北車站示範。要測定位，請用部署後的 HTTPS 網址。

### 5. Demo：手機回報 → 大螢幕即時出現

- **沒有後端時**：同一個瀏覽器開兩個分頁，一個開市民端、一個開 `/#/admin`。在市民端按「這桶滿了」，儀表板 3 秒內會跳出來。
- **有後端時**：先啟動 API，再讓前端連過去，手機和大螢幕就能跨裝置同步。

```bash
npm run api                                           # 暫用的 Node API，http://localhost:8787
cp apps/web/.env.example apps/web/.env                # 內容是 VITE_API_URL=http://localhost:8787
npm run dev                                           # 重新啟動前端
```

儀表板左上角會顯示「即時連線」或「離線模式」。Demo 前可以按儀表板上的「清空」清掉測試回報（離線模式才有）。

### 6. 其他指令

```bash
npm run build        # 打包到 apps/web/dist，部署用
npm run slides       # 團隊簡報 http://localhost:4321（← → 翻頁、F 全螢幕、R 重播動畫）
npm run data:build   # 重建地圖資料（有 data/raw 用真實資料，否則用 data/mock）
npm run data:mock    # 重新產生模擬資料再建置
```

### 常見問題

- **地圖只有點，沒有底圖**：底圖從 CARTO 線上載入，網路不通時會顯示「地圖底圖載入失敗，請檢查網路」。垃圾桶位置與功能不受影響。
- **`npm run data:build` 說找不到 Python**：安裝 Python 3.9 以上並加入 PATH，Windows 可以用 `py --version` 確認。
- **畫面上寫「模擬資料」**：還沒放真實資料，見 [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md) 第 4 節。
- **port 被占用**：`npm run dev -- --port 5180` 換一個。

## 分工

| 成員 | 負責 |
| --- | --- |
| Harry | 前端主架構與視覺、地圖元件 |
| Swimming | 市民端手機頁面 |
| 青 Ian | 需求分數與缺口模型、陳情資料 |
| Pamis | 後端主力：ASP.NET Core API、回報 API、部署 |
| Vicky | 協助後端：填滿率模擬、清運路線 |
| Kyra | PM、README、Demo 腳本 |

## 資料來源

| 資料 | 類型 |
| --- | --- |
| [臺北市行人專用清潔箱（121355）](https://data.gov.tw/dataset/121355) | 真實開放資料（點位，尚未取得最新版） |
| [臺北市環境衛生管理概況（145763）](https://data.gov.tw/dataset/145763) | 真實開放資料（官方年度數量） |
| `apps/web/public/data/official_counts.json` | 官方數量摘錄，引自 [臺北行人專用清潔箱數量整理](https://data.bin.ianwu.net/) |
| [臺北捷運各站分時進出量](https://data.taipei/dataset/detail?id=63f31c7e-7fc3-418b-bd82-b95158755b4d) | 真實開放資料 |
| [臺北市公車站牌位置圖](https://data.taipei/dataset/detail?id=48aa5bca-2a4f-4fb7-a658-43cba51d5d56) | 真實開放資料 |
| [臺北市陳情系統類別資料](https://data.taipei/dataset/detail?id=cb423c17-88eb-4231-a725-f1b93247d1bf) | 真實開放資料 |
| 「市長你給我聽好了」資料集 | 真實（去識別化，僅限本活動，未收錄於本 repo） |
| 垃圾桶填滿率 | **模擬資料**（`data/scripts/simulate_fill.py`） |
| 市民回報 | **模擬／Demo 現場產生** |
| `data/mock/*` | **模擬資料**：全台北市 661 個垃圾桶點位、捷運站人流、公車站、陳情、商圈（`data/scripts/generate_mock.py` 產生，捷運站與商圈為約略座標，人流為假設量級） |

地圖圖資：© OpenStreetMap contributors © CARTO

## 使用的開源套件與 AI 工具

- Vue、Vue Router、Vite、Tailwind CSS、Leaflet、GSAP
- 字型：Chiron GoRound TC、Barlow Semi Condensed（@fontsource，打包在專案內）
- 底圖：CARTO Voyager / Dark Matter（© OpenStreetMap contributors © CARTO）
- 簡報動畫：GSAP 3.12.5（docs/slides/gsap.min.js）
- AI 工具：Claude（專案規劃與程式骨架）
- TODO：其他成員使用的工具

## 掃碼巡桶與綠點（Demo 為示意）

- 每個垃圾桶貼 QR Code，掃了直接開到那一桶的回報頁（`/#/bin/<編號>?s=<簽章>`），不用下載 App。
- 列印 Demo 用貼紙：打開 `/#/qr`（市府戰情右上角「列印 QR」），最後一張是故意做壞的假貼紙，掃了會顯示驗證失敗。
- 「巡桶任務」依資料價值排序：很久沒人確認的桶、疑似沒有垃圾桶的地方。
- 綠點規則：掃碼回報 +5，超過 14 天沒人確認的桶再 +5，在沒有垃圾桶處回報 +3，每天上限 30。
- 防弊三原則：**回報什麼狀態都拿一樣的點數**（沒有說謊的誘因）、同一桶一天只算一次且點數先列為待確認、**丟垃圾不給點**（只獎勵檢查與回報）。
- Demo 版點數只存在瀏覽器，QR 簽章在前端計算，都只是示意。正式版要用台北通實名登入、後端簽章與驗證，並可接環保集點綠點。

## 未來需要的資源

> 審核要件之一。以下為草稿，經費數字為示意估算，標有「待估」的需由相關局處評估。

### 局處

| 局處 | 角色 |
| --- | --- |
| **環保局**（主責） | 管理行人專用清潔箱、張貼與維護 QR 貼紙、清潔隊依回報調整清運、把市民回報納入會勘 |
| 資訊局 | 台北通身分驗證、系統開發維運、開放資料平台 |
| 研考會（1999） | 與 1999 陳情整合，避免市民重複反映 |
| 民政局、區公所、里辦公處 | 會勘時提供行人回報彙整，讓行人的需求被看見 |
| 交通局、臺北捷運公司 | 捷運站與公車站周邊的設置評估、人流資料 |

### 資料

| 需要的資料 | 現況 | 需要做的事 |
| --- | --- | --- |
| 行人專用清潔箱點位（121355） | 661 筆點位，北投區 0 筆，沒有組數欄位 | 補齊缺漏、加上組數與座數欄位、正式定義「組、座、處、個」 |
| 清運與滿溢紀錄 | 未公開 | 清潔隊提供去識別化的清運時間與滿溢紀錄，取代模擬的填滿率 |
| 會勘紀錄 | 未公開 | 公開會勘時間、地點、結果與理由 |
| 1999 垃圾相關案件 | 有類別、沒有地點 | 提供去識別化的案件地點（到網格或里即可） |
| 公車上下車人次 | 未公開 | 開放各站上下車量，補足人流需求 |

### 經費（示意）

| 項目 | 估算方式 | 金額 |
| --- | --- | --- |
| QR 貼紙 | 試辦區先貼；全市 806 組 × 2 座 = 1,612 張耐候貼紙 | 單價待估 |
| 回報獎勵 | 接環保集點：806 組 × 每週確認 2 次 × 每次 1 元 | 約每年 8.4 萬元 |
| 系統開發與維運 | 沿用台北通與開放資料平台，新增回報與戰情模組 | 待資訊局估算 |
| 智慧感測器（選配） | 不建議一開始全面安裝，先在高滿溢點試辦，與市民回報比較成效 | 待估 |

### 推廣計畫

- **貼紙就是入口**：每個垃圾桶上的 QR Code 本身就是宣傳，路過就能用。
- **台北通與環保集點**：推播巡桶任務，回報可領綠點。
- **捷運站與公車站**：在人流最多、最需要垃圾桶的地方張貼說明。
- **里辦公處與清潔隊**：說明回報如何用在會勘與清運，爭取第一線支持。
- **學校與社區**：結合志工服務時數或社區活動，辦「巡桶日」補齊資料缺漏的區域。
- **公開戰情儀表板**：讓市民看到回報被處理、垃圾桶真的增加，形成回饋。

### 上任 100 天

| 期間 | 工作 |
| --- | --- |
| 第 1–30 天 | 環保局公布單位定義、補齊開放資料；選定試辦區（建議北投區，同時補資料缺漏）；訂出會勘納入市民回報的程序 |
| 第 31–60 天 | 試辦區張貼 QR 貼紙、回報系統上線、清潔隊開始依回報調整清運 |
| 第 61–100 天 | 檢討回報量、滿溢改善與會勘結果；決定是否擴大到全市並接上環保集點 |

## 授權

MIT
