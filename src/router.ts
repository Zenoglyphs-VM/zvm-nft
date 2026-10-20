import {createRouter, createWebHistory} from 'vue-router'

// Real paths, not hashes: an item page is the thing people share, and
// /item/0xabc…/7 reads as a thing rather than a fragment. GitHub Pages has no
// SPA rewrite, so the build leaves a copy of index.html at 404.html
// (vite.config.ts) and unmatched paths boot the app with the URL intact.
export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  scrollBehavior: (to, from, saved) => saved ?? (to.path === from.path ? false : {top: 0}),
  routes: [
    {path: '/', name: 'explore', component: () => import('./pages/NftExplorePage.vue')},
    {path: '/collection/:addr', name: 'collection', component: () => import('./pages/NftCollectionPage.vue')},
    {path: '/item/:addr/:id', name: 'item', component: () => import('./pages/NftItemPage.vue')},
    {path: '/account/:addr', name: 'account', component: () => import('./pages/NftAccountPage.vue')},
    {path: '/create', name: 'create', component: () => import('./pages/NftCreatePage.vue')},
    {path: '/about', name: 'about', component: () => import('./pages/AboutPage.vue')},
    {path: '/:pathMatch(.*)*', name: 'notfound', component: () => import('./pages/NotFoundPage.vue')},
  ],
})
