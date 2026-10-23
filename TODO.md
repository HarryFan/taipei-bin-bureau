# TODO：台北桶報局

> 市政 debug松 #2「找回消失的垃圾桶」｜同流 One Flow
> 提交截止：**10/24（六）16:00**，團隊目標 **15:45 前提交**

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
- [ ] `npm install`
- [ ] `npm run dev` → 開 http://localhost:5173 ，確認市民端與 `/#/admin` 都能顯示
      ⚠️ 前端套件版本（Vite 7、Tailwind 4、vue-tsc 3）還沒實際安裝驗證過，有錯先修這裡
- [ ] `npm run build` 確認可以打包
- [ ] `npm run slides` → 開 http://localhost:4321 ，確認簡報與動畫正常（Google Meet 分享這個分頁）
- [ ] `npm run data:build` 確認資料管線能跑（會自動找 `python3` / `python` / `py`）
- [ ] 邀請組員進 repo（private 需要邀請）：
      `gh api -X PUT repos/HarryFan/taipei-bin-bureau/collaborators/Pamis-Wang`
      ⚠️ Vicky、Swimming 報名時沒填 GitHub，青的 GitHub 帳號也要問

> Mac 那份 repo 的 `.git` 裡有幾個 `stale-*` 檔案，是先前留下的鎖定檔，不會被 push，可以忽略。

---

## 1. 13:30 會議要決定

- [ ] 確認題目切角：市民端（找桶、回報）＋市府端（沙漠地圖、清運）
- [ ] 確認 Vicky、Swimming 平常用的語言與框架
- [ ] 部署主機：前端（Vercel 或 GitHub Pages）、.NET API（Azure App Service、Render 等）
- [ ] 今晚 19:00 Discord 由誰提案（Kyra 20:00–21:00 不在，建議 Harry 或青）
- [ ] 統一數字口徑：官網「近 3,000 組 → 約 800 組」vs 主計處「2023/6 底 1,984 個」
- [ ] 每個人 clone repo、確認自己下午做什麼

---

## 2. 前端（Harry 主架構、Swimming 市民端）

### Harry
- [ ] 跑通 `npm install` / `dev` / `build`（見第 0 節）
- [ ] **儀表板加輪詢**：`AdminView.vue` 目前只在載入時讀一次資料，要每 3 秒重新抓 `loadReports()` 與 `loadFillLevels()`，手機回報才會即時出現在大螢幕（Demo 關鍵）
- [ ] 視覺：配色、Logo、首頁標語，跟簡報一致（深綠 `#14302A`、橘 `#E8833A`）
- [ ] 地圖底圖（選做）：改用國土測繪中心通用版電子地圖，比較有市政感
- [ ] 部署前端：設定 `VITE_API_URL` 指向 .NET API；GitHub Pages 要設 `BASE_PATH=/taipei-bin-bureau/`
- [ ] 用手機開**部署後的 HTTPS 網址**測定位（localhost 在手機上拿不到位置）

### Swimming
- [ ] 熟悉 `apps/web/src/views/CitizenView.vue`
- [ ] 市民端手機版 UI：最近垃圾桶列表、步行時間、回報按鈕
- [ ] 回報成功的回饋（toast、按鈕狀態），避免重複點擊
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

流程與格式見 [`data/README.md`](data/README.md)。原始檔放 `data/raw/`（不進版控），轉成 `data/interim/demand_points.csv`，再跑 `npm run data:build`。

- [ ] 下載[行人專用清潔箱位置](https://data.gov.tw/dataset/121355)，存成 `data/raw/bins.csv`
- [ ] 捷運分時進出量 → `source=mrt`
      ⚠️ 這份資料沒有座標，需要另外找捷運車站座標對應
- [ ] 公車站牌位置 → `source=bus`，`value=1`
- [ ] 陳情系統類別資料 → 篩出垃圾、環境清潔相關 → `source=complaint`
- [ ] 商圈／夜市座標 → `source=market`（可手動標註幾個）
- [ ] 調整 `build_grid.py` 的權重與網格大小，確認建議新設點合理
- [ ] 從「市長你給我聽好了」資料集找出 2–3 則垃圾桶相關抱怨，給 Demo 開場用
      ⚠️ 資料放 `data/private/`（已 gitignore），**不要丟進外部 AI 服務**，用關鍵字篩選即可

---

## 5. PM（Kyra）

- [ ] 19:00 Discord 提案稿（1–2 分鐘）
- [ ] README「如果市府上任 100 天內要落地」：哪個局處、需要哪些資料、試辦範圍、成本估算
- [ ] README 資料來源表確認：哪些真實、哪些模擬
- [ ] README 補上每個人用到的 AI 工具與開源套件
- [ ] 2 分鐘 Demo 講稿（結構見簡報第 10 頁）
- [ ] 票選拉票文案（10/24 16:30 開放，10/31 18:00 截止）
- [ ] 時程控管：10/24 12:00 看 Demo 名單、15:00 凍結功能

---

## 6. 明天 10/24 檢查清單

- [ ] 09:30 報到：臺北市中正區北平東路 30-1 號 1 樓（至少一人到場）
- [ ] 10:00–12:00 核心功能：沙漠地圖、找桶、模擬填滿率
- [ ] 12:00 看 Demo 名單與順序
- [ ] 13:00–15:00 前後端串接、部署、補 README
- [ ] 15:00 凍結功能，彩排 2 分鐘 Demo
- [ ] **15:45 前提交**：作品名稱、作品網址、GitHub 網址
- [ ] 若要公開程式碼給票選者看，記得把 repo 改成 public（README 已用 MIT 授權）

### Demo 備案
- API 掛掉：前端自動改讀靜態 JSON，畫面不會壞，但回報不會跨裝置
- 網路不穩：同一台筆電開兩個分頁，一個市民端、一個 `/#/admin`（localStorage 在同一瀏覽器的分頁間共用）

---

## 已知問題

- [ ] 前端套件尚未實際 `npm install` 驗證
- [ ] 目前所有資料都是 `data/sample/` 的樣本（台北車站到西門一帶 12 個垃圾桶）
- [ ] 儀表板沒有輪詢，回報不會即時出現（見第 2 節）
- [ ] 簡報有兩份：線上 Slides 與 `docs/slides/`，內容修改不會自動同步
