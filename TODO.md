# TODO：台北桶報局

> 市政 debug松 #2「找回消失的垃圾桶」｜同流 One Flow
> 審核截止：**10/24（六）15:00**（通過才能抽現場 Demo 順序；16:00 前通過才能參加票選），團隊目標 **14:30 前提交**

狀態說明：`[ ]` 未開始、`[~]` 進行中、`[x]` 完成。做完請直接改這份檔案並 commit。

---

## 0. 搬到 Windows 11 繼續開發（Harry，現在）

在 Mac 上建立 GitHub repo：

```bash
cd ~/Documents/github/taipei-bin-bureau
gh repo create taipei-bin-bureau --private --source=. --remote=origin --push
```

- [ ] 在 Mac 建立 private repo 並 push
- [ ] Windows 安裝：Node.js 22 LTS、Python 3.12（安裝時勾選 **Add python.exe to PATH**）、Git、GitHub CLI
- [ ] Windows：`gh auth login` → `gh repo clone HarryFan/taipei-bin-bureau`
- [ ] `npm install`（已有 `package-lock.json`，版本會一致）
- [ ] `npm run dev` → 開 http://localhost:5173 ，確認市民端與 `/#/admin` 都能顯示
- [x] `npm install` / `npm run build` 已在 Linux 驗證通過（Vite 7.3、Tailwind 4.3、vue-tsc 型別檢查無錯誤）
- [ ] `npm run slides` → 開 http://localhost:4321 ，確認簡報與動畫正常（Google Meet 分享這個分頁）
- [ ] `npm run data:build` 確認資料管線能跑（會自動找 `python3` / `python` / `py`）
- [ ] 邀請組員進 repo（private 需要邀請）：
      `gh api -X PUT repos/HarryFan/taipei-bin-bureau/collaborators/Pamis-Wang`
      ⚠️ Vicky、Swimming 報名時沒填 GitHub，青的 GitHub 帳號也要問

> Mac 那份 repo 的 `.git` 裡有幾個 `stale-*` 檔案，是先前留下的鎖定檔，不會被 push，可以忽略。

---

## ⚠️ 提交要件與截止（主辦單位 10/23 公布）

- 要交：**MVP、YouTube 介紹影片、未來需要的資源（局處、資料、經費、推廣）**
- **10/24 15:00 前**通過審核才能抽現場 Demo 順序（前 15 組）；16:00 前通過才能參加票選
- 團隊目標 **14:30 前提交**。清單與影片腳本見 [`docs/SUBMISSION.md`](docs/SUBMISSION.md)，資源需求草稿在 README「未來需要的資源」

## 範圍凍結（10/23 12:40）

功能到此為止，不再加新功能。剩下的時間只做：部署、換真實資料（拿得到的話）、README、印 QR 貼紙、彩排 Demo。

已完成：市民端、市府戰情、全市模擬資料、QR 掃碼回報、巡桶任務、綠點示意。

## 1. 13:30 會議要決定

- [ ] 確認題目切角：市民端（找桶、回報）＋市府端（沙漠地圖、清運）
- [ ] 確認 Vicky、Swimming 平常用的語言與框架
- [ ] 部署主機：前端（Vercel 或 GitHub Pages）、.NET API（Azure App Service、Render 等）
- [ ] 今晚 19:00 Discord 由誰提案（Kyra 20:00–21:00 不在，建議 Harry 或青）
- [ ] 統一數字口徑：官網「近 3,000 組 → 約 800 組」vs 主計處「2023/6 底 1,984 個」
- [ ] 每個人 clone repo、確認自己下午做什麼

---

## 2. 前端（Harry 主架構、Swimming 市民端）

> 前端依 `docs/DATA_SOURCES.md` 第 3.2 節：數字標單位、缺資料與沒有垃圾桶分開、新設點寫成候選。已完成前三項，剩資料來源標示與會勘佐證視角。

### Harry
- [ ] 跑通 `npm install` / `dev` / `build`（見第 0 節）
- [x] **儀表板即時更新**：每 3 秒輪詢；新回報會跳通知、地圖標記閃爍、自動移到該位置，回報「滿了」時自動切到清運分頁
- [x] API 逾時 4 秒自動退回本機資料，左上角顯示「即時連線 / 離線模式」
- [x] 頂部列換成品牌色（深綠 `#14302A`、橘 `#E8833A`）
- [x] **旗艦版視覺**：設計語彙是「台灣道路指示牌 × 清潔隊垃圾車」
      - 市民端：綠色路牌顯示最近垃圾桶的方向箭頭、距離、步行時間、填滿程度；快滿時推薦下一個
      - 市府端：深色戰情室，頂部即時數字、缺口熱區光暈、垃圾車沿清運路線行駛、即時回報動態、各區缺口排名
      - 字型打包在專案內（Chiron GoRound TC、Barlow Semi Condensed），現場網路不穩也不影響
- [ ] 換上真實地圖後再看一次視覺（我這邊的開發環境連不到地圖圖磚，只驗證過版面）
- [ ] 地圖底圖（選做）：改用國土測繪中心通用版電子地圖，比較有市政感
- [ ] 部署前端（設定檔已備好，二選一）：
      - **GitHub Pages**：`.github/workflows/deploy.yml`，Settings → Pages → Source 選 GitHub Actions。⚠️ private repo 需要 GitHub Pro 才能用 Pages
      - **Vercel**：匯入 repo 即可（`vercel.json` 已設定），private repo 免費可用
      - 兩者都會把簡報一起放在 `<網址>/slides/`
      - 有 .NET API 後，在 Actions Variables 或 Vercel 環境變數設定 `VITE_API_URL`
- [ ] 用手機開**部署後的 HTTPS 網址**測定位（localhost 在手機上拿不到位置）

### Swimming
- [ ] 熟悉 `apps/web/src/views/CitizenView.vue`
- [x] 市民端旗艦版已完成（路牌、回報、附近清單、快滿推薦）
- [ ] 用自己的手機實測：定位、單手操作、按鈕大小
- [ ] 定位失敗時的引導（目前會退回台北車站示範並提示）
- [ ] 「這附近都找不到垃圾桶」的回報可以讓使用者在地圖上點選位置（選做）
- [ ] 「這裡需要一個」可以讓使用者在地圖上點選位置（選做）

---

## 3. 後端（Pamis 主力、Vicky 協助）

`apps/api` 目前是 Node 暫用版，前端已經串好。.NET 版只要端點和 JSON 格式一樣，改 `VITE_API_URL` 就能切過去。

### API 規格

| 方法 | 路徑 | 回傳 |
| --- | --- | --- |
| GET | `/api/health` | `{ "ok": true }` |
| GET | `/api/fill-levels` | `[{ "id": "bin-0000", "fill": 0.82, "updatedAt": "ISO 時間" }]` |
| GET | `/api/reports` | 回報陣列，新的在前 |
| POST | `/api/reports` | 收 `{ id, kind, lat, lng, binId?, createdAt }`，回 201 |

- `kind` 只能是 `full`（滿了）、`missing`（不見了）、`need`（這裡需要一個）
- 被回報 `full` 的 `binId`，在 `/api/fill-levels` 要變成 `fill: 1`
- CORS 開放前端的部署網域與 `http://localhost:5173`

> 動工前先讀 `docs/DATA_SOURCES.md` 第 3.3 節：回報要能依區、網格彙總，並匯出給現場會勘；填滿率回應要帶 `simulated: true`。

### Pamis
- [ ] 建立 `apps/api-dotnet`（ASP.NET Core Minimal API）
- [ ] 實作上面四個端點（資料先存記憶體即可）
- [ ] CORS、Dockerfile
- [ ] **今天就部署一個 hello world 測通**，不要等到明天
- [ ] 部署後把網址告訴 Harry 設定 `VITE_API_URL`
- [ ] 留意免費主機休眠：票選期間（到 10/31）冷啟動可能要幾十秒，前端已有退回靜態 JSON 的備案

### Vicky
- [ ] 填滿率模擬：以 `apps/web/public/data/fill_levels.json` 為基礎，讓數值隨時間緩慢上升，Demo 時看得出變化
- [ ] 清運路線（選做）：目前前端用最近鄰居法排序，若時間夠可改由 API 計算並回傳順序
- [ ] 協助 Pamis 測試 API

---

## 4. 資料（青）

流程與格式見 [`data/README.md`](data/README.md)，**每份資料的來源、單位、限制與下載指令見 [`docs/DATA_SOURCES.md`](docs/DATA_SOURCES.md)**。

> 沒有真實資料也能 Demo：目前預設使用 `data/mock/` 的全市模擬資料，畫面會標示「模擬資料」。真實資料拿到多少就換多少（例如先只換垃圾桶位置）。原始檔放 `data/raw/`（不進版控），轉成 `data/interim/demand_points.csv`，再跑 `npm run data:build`。

- [ ] 下載[行人專用清潔箱位置](https://data.gov.tw/dataset/121355)，存成 `data/raw/bins.csv`
- [ ] 捷運分時進出量 → `source=mrt`
      ⚠️ 這份資料沒有座標，需要另外找捷運車站座標對應
- [ ] 公車站牌位置 → `source=bus`，`value=1`
- [ ] 陳情系統類別資料 → 篩出垃圾、環境清潔相關 → `source=complaint`
- [ ] 商圈／夜市座標 → `source=market`（可手動標註幾個）
- [ ] 調整 `build_grid.py` 的權重與網格大小，確認建議新設點合理
- [ ] 下載 145763 主計處年度數量，補齊 `official_counts.json` 的歷年資料
- [ ] 捷運出入口用 ArcGIS 查詢（指令在 DATA_SOURCES.md 第 4 節）
- [ ] **取得行政區界，遮掉資料缺漏的北投區**（不然北投的需求會被算到士林）
- [ ] 從「市長你給我聽好了」資料集找出 2–3 則垃圾桶相關抱怨，給 Demo 開場用
      ⚠️ 資料放 `data/private/`（已 gitignore），**不要丟進外部 AI 服務**，用關鍵字篩選即可

---

## 5. PM（Kyra）

- [ ] 19:00 Discord 提案稿（1–2 分鐘）
- [ ] README「如果市府上任 100 天內要落地」：哪個局處、需要哪些資料、試辦範圍、成本估算
- [ ] README 資料來源表確認：哪些真實、哪些模擬
- [ ] README 補上每個人用到的 AI 工具與開源套件
- [ ] 2 分鐘 Demo 講稿（結構見簡報第 11 頁）
- [ ] 講稿的數字照 `docs/DATA_SOURCES.md` 第 0 節：2018 年 7 月 2,004 處 → 2026 年 6 月 806 組，不要講「近 3,000 減到 800」
- [ ] 100 天落地計畫參考 DATA_SOURCES.md 第 1 節「會勘須里長同意、行人沒有代表」，我們的回報就是行人的聲音
- [ ] 票選拉票文案（10/24 16:30 開放，10/31 18:00 截止）
- [ ] 時程控管：10/24 12:00 看 Demo 名單、15:00 凍結功能

---

## 6. 明天 10/24 檢查清單

- [ ] 09:30 報到：臺北市中正區北平東路 30-1 號 1 樓（至少一人到場）
- [ ] 10:00–12:00 核心功能：沙漠地圖、找桶、模擬填滿率
- [ ] 12:00 看 Demo 名單與順序
- [ ] 13:00–15:00 前後端串接、部署、補 README
- [ ] 15:00 凍結功能，彩排 2 分鐘 Demo
- [ ] **14:30 前提交**（15:00 審核截止）：作品網址、GitHub、YouTube 影片、資源需求
- [ ] 若要公開程式碼給票選者看，記得把 repo 改成 public（README 已用 MIT 授權）

- [ ] 印 QR 貼紙：部署後打開 `<網址>/#/qr` 列印（貼紙上的網址會是部署網址，**要部署後再印**）

### Demo 備案
- Demo 前：儀表板「市民回報」旁的「清空」可以清掉測試回報（離線模式才有）
- API 掛掉：前端自動改讀靜態 JSON，畫面不會壞，但回報不會跨裝置
- 網路不穩：同一台筆電開兩個分頁，一個市民端、一個 `/#/admin`（localStorage 在同一瀏覽器的分頁間共用）

---

## 已知問題

- [ ] 目前是 `data/mock/` 的全市模擬資料（800 個垃圾桶），拿到真實資料後放進 `data/raw/` 重跑 `npm run data:build`
- [ ] 簡報有兩份：線上 Slides 與 `docs/slides/`，內容修改不會自動同步
