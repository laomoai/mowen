import { createRouter, createWebHistory } from 'vue-router'
import { getCurrentUser, type CurrentUser } from '@/api/client'

// 模块级缓存，避免每次路由跳转都发请求
let authState: { authed: boolean; user: CurrentUser | null } = {
  authed: false,
  user: null,
}
let authChecked = false

export function resetAuthState() {
  authState = { authed: false, user: null }
  authChecked = false
}

export function getCachedUser() {
  return authState.user
}

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/login',
      component: () => import('@/pages/LoginPage.vue'),
      meta: { guest: true },
    },
    {
      path: '/reset-password',
      component: () => import('@/pages/ResetPasswordPage.vue'),
      meta: { guest: true },
    },
    {
      path: '/',
      component: () => import('@/components/AppLayout.vue'),
      children: [
        { path: '', component: () => import('@/pages/TableList.vue') },
        { path: 'tables/:tableName', component: () => import('@/pages/TableView.vue') },
        { path: 'settings', component: () => import('@/pages/Settings.vue') },
        { path: 'administration', component: () => import('@/pages/Administration.vue'), meta: { admin: true } },
        { path: 'notes', component: () => import('@/pages/NotesPage.vue') },
        { path: 'notes/:noteId', component: () => import('@/pages/NotesPage.vue') },
        { path: 'archive', component: () => import('@/pages/KnowledgeBase.vue') },
        { path: 'archive/:folderId', component: () => import('@/pages/KnowledgeBaseDetail.vue') },
        { path: 'knowledge-base', redirect: '/archive' },
        { path: 'knowledge-base/:rootId', redirect: (to) => `/archive/${to.params.rootId}` },
      ],
    },
  ],
})

router.beforeEach(async (to) => {
  if (!authChecked) {
    try {
      const user = await getCurrentUser()
      authState = { authed: true, user }
    } catch {
      authState = { authed: false, user: null }
    }
    authChecked = true
  }
  if (!authState.authed && !to.meta.guest) return '/login'
  if (authState.authed && to.path === '/login') return '/'
  if (authState.authed && to.path === '/reset-password' && !to.query.token) return '/'
  if (to.meta.admin && authState.user?.role !== 'admin') return '/'
})

export default router
