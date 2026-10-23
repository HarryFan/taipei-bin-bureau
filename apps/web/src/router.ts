import { createRouter, createWebHashHistory } from 'vue-router'
import CitizenView from './views/CitizenView.vue'

// hash 模式：部署到 GitHub Pages / 任何靜態主機都不用設定 rewrite
export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'citizen', component: CitizenView },
    { path: '/admin', name: 'admin', component: () => import('./views/AdminView.vue') },
  ],
})
