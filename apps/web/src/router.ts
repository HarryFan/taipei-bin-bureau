import { createRouter, createWebHashHistory } from 'vue-router'
import CitizenView from './views/CitizenView.vue'

// hash 模式：部署到 GitHub Pages / 任何靜態主機都不用設定 rewrite
export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'citizen', component: CitizenView },
    // 掃垃圾桶上的 QR Code 開到這裡：/#/bin/bin-0012?s=簽章
    { path: '/bin/:id', name: 'bin', component: CitizenView },
    { path: '/qr', name: 'qr', component: () => import('./views/QrSheetView.vue') },
    { path: '/admin', name: 'admin', component: () => import('./views/AdminView.vue') },
    // 實驗：3D 城市戰情室（three.js 只在這一頁載入）
    { path: '/3d', name: 'admin3d', component: () => import('./views/Admin3DView.vue') },
  ],
})
