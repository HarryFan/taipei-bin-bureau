# 🗑️ 台北桶報局

> 市政 debug松 #2「找回消失的垃圾桶」｜隊伍：同流 One Flow

市民一鍵找到最近的垃圾桶、回報滿了或不見了；市府從同一份回報看見「垃圾桶沙漠」，並依填滿率安排清運。

工作清單與分工進度見 [TODO.md](TODO.md)。

## 結構

```
apps/web    Vue 3 + Vite + TS + Tailwind + Leaflet（市民端 / 、市府端 /admin）
apps/api    暫用的 Node 小 API，正式版由 Pamis 以 ASP.NET Core 實作（端點相同）
data        Python 資料管線，輸出到 apps/web/public/data
docs/slides 團隊規劃簡報（直接用瀏覽器開 index.html，← → 翻頁、F 全螢幕）
```

前端只讀靜態 JSON 也能完整運作，API 掛掉 Demo 不受影響。

## 快速開始

```bash
npm install
npm run dev          # http://localhost:5173
npm run data:build   # 重新產生 bins / grid / fill_levels（有 data/raw 用真實資料，否則用 data/mock）
npm run data:mock    # 重新產生模擬資料再建置
npm run api          # 選配，啟動後在 apps/web/.env 設定 VITE_API_URL
npm run slides       # 團隊簡報 http://localhost:4321（← → 翻頁、F 全螢幕、R 重播動畫）
```

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
| [臺北市行人專用清潔箱（位置）](https://data.gov.tw/dataset/121355) | 真實開放資料 |
| [臺北捷運各站分時進出量](https://data.taipei/dataset/detail?id=63f31c7e-7fc3-418b-bd82-b95158755b4d) | 真實開放資料 |
| [臺北市公車站牌位置圖](https://data.taipei/dataset/detail?id=48aa5bca-2a4f-4fb7-a658-43cba51d5d56) | 真實開放資料 |
| [臺北市陳情系統類別資料](https://data.taipei/dataset/detail?id=cb423c17-88eb-4231-a725-f1b93247d1bf) | 真實開放資料 |
| 「市長你給我聽好了」資料集 | 真實（去識別化，僅限本活動，未收錄於本 repo） |
| 垃圾桶填滿率 | **模擬資料**（`data/scripts/simulate_fill.py`） |
| 市民回報 | **模擬／Demo 現場產生** |
| `data/mock/*` | **模擬資料**：全台北市約 800 個垃圾桶、捷運站人流、公車站、陳情、商圈（`data/scripts/generate_mock.py` 產生，捷運站與商圈為約略座標，人流為假設量級） |

地圖圖資：© OpenStreetMap contributors © CARTO

## 使用的開源套件與 AI 工具

- Vue、Vue Router、Vite、Tailwind CSS、Leaflet、GSAP
- 字型：Chiron GoRound TC、Barlow Semi Condensed（@fontsource，打包在專案內）
- 底圖：CARTO Voyager / Dark Matter（© OpenStreetMap contributors © CARTO）
- 簡報動畫：GSAP 3.12.5（docs/slides/gsap.min.js）
- AI 工具：Claude（專案規劃與程式骨架）
- TODO：其他成員使用的工具

## 如果市府上任 100 天內要落地

TODO（Kyra）：哪個局處、需要哪些資料、試辦範圍、成本估算。

## 授權

MIT
