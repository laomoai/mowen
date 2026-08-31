<template>
  <div class="login-page">
    <div class="login-card">
      <div class="login-brand">
        <img src="/logo.svg" class="login-logo-img" alt="墨问" />
        <div class="login-logo">墨问</div>
        <div class="login-subtitle">表格与笔记</div>
      </div>

      <n-alert v-if="errorMsg" type="error" style="margin-bottom: 16px;">
        {{ errorMsg }}
      </n-alert>
      <n-alert v-if="infoMsg" type="success" style="margin-bottom: 16px;">
        {{ infoMsg }}
      </n-alert>

      <n-form v-if="mode !== 'forgot'" @submit.prevent="submit">
        <n-form-item label="邮箱">
          <n-input v-model:value="email" type="text" placeholder="you@example.com" />
        </n-form-item>
        <n-form-item v-if="mode === 'register'" label="名称">
          <n-input v-model:value="name" placeholder="显示名称" />
        </n-form-item>
        <n-form-item v-if="mode === 'register' && !bootstrapOpen" label="邀请码">
          <n-input v-model:value="inviteCode" placeholder="输入空间邀请码" />
        </n-form-item>
        <n-form-item label="密码">
          <n-input
            v-model:value="password"
            type="password"
            show-password-on="click"
            placeholder="至少 8 位"
            @keyup.enter="submit"
          />
        </n-form-item>
        <n-button type="primary" block :loading="loading" @click="submit">
          {{ registerButtonText }}
        </n-button>
      </n-form>

      <n-form v-else @submit.prevent="sendReset">
        <n-form-item label="邮箱">
          <n-input v-model:value="email" placeholder="you@example.com" />
        </n-form-item>
        <n-button type="primary" block :loading="loading" @click="sendReset">
          发送重置链接
        </n-button>
      </n-form>

      <div class="login-links">
        <button v-if="mode === 'login'" type="button" class="link-btn" @click="mode = 'forgot'">忘记密码</button>
        <button v-if="mode === 'login' && inviteRegisterOpen" type="button" class="link-btn" @click="mode = 'register'">
          使用邀请码注册
        </button>
        <button v-if="mode === 'login' && bootstrapOpen" type="button" class="link-btn" @click="mode = 'register'">
          首次初始化
        </button>
        <button v-if="mode !== 'login'" type="button" class="link-btn" @click="mode = 'login'">返回登录</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NAlert, NButton, NForm, NFormItem, NInput } from 'naive-ui'
import { http } from '@/api/client'
import { resetAuthState } from '@/router'

const route = useRoute()
const router = useRouter()
const email = ref('')
const name = ref('')
const password = ref('')
const inviteCode = ref('')
const loading = ref(false)
const errorMsg = ref('')
const infoMsg = ref('')
const mode = ref<'login' | 'register' | 'forgot'>('login')
const bootstrapOpen = ref(false)
const publicRegisterOpen = ref(false)

const inviteRegisterOpen = computed(() => !bootstrapOpen.value)
const registerButtonText = computed(() => {
  if (mode.value !== 'register') return '登录'
  return bootstrapOpen.value ? '创建管理员账号' : '注册并加入空间'
})

const queryError = computed(() => {
  const err = route.query.error as string
  if (!err) return ''
  return '登录失败，请重试。'
})

onMounted(() => {
  if (queryError.value) errorMsg.value = queryError.value
  if (typeof route.query.invite === 'string' && route.query.invite) {
    inviteCode.value = route.query.invite
    mode.value = 'register'
  }
  http.get<{ data: { bootstrap: boolean; publicRegister: boolean } }>('/auth/setup-status')
    .then((r) => {
      bootstrapOpen.value = !!r.data.data.bootstrap
      publicRegisterOpen.value = !!r.data.data.publicRegister
      if (bootstrapOpen.value) mode.value = 'register'
    })
    .catch(() => {})
})

async function submit() {
  errorMsg.value = ''
  infoMsg.value = ''
  loading.value = true
  try {
    if (mode.value === 'register') {
      await http.post('/auth/register', {
        email: email.value,
        password: password.value,
        name: name.value || undefined,
        invite_code: inviteCode.value || undefined,
      })
    } else {
      await http.post('/auth/login', {
        email: email.value,
        password: password.value,
      })
    }
    resetAuthState()
    await router.replace('/')
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Request failed'
    if (msg.toLowerCase().includes('closed') || msg.toLowerCase().includes('403')) {
      errorMsg.value = publicRegisterOpen.value ? msg : '注册已关闭，请联系管理员提供邀请码。'
    } else {
      errorMsg.value = msg
    }
  } finally {
    loading.value = false
  }
}

async function sendReset() {
  errorMsg.value = ''
  infoMsg.value = ''
  loading.value = true
  try {
    await http.post('/auth/forgot-password', { email: email.value })
    infoMsg.value = '如果该账号存在，重置邮件已发出。'
    mode.value = 'login'
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Request failed'
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.login-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #f5f7ff 0%, #e8ecff 100%);
  padding-top: var(--net-banner-h, 0px);
}
.login-card {
  width: 400px;
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 8px 40px rgba(79, 110, 247, 0.12);
  padding: 40px 36px 32px;
}
.login-brand {
  text-align: center;
  margin-bottom: 28px;
}
.login-logo-img {
  width: 56px;
  height: 56px;
  object-fit: contain;
  margin-bottom: 12px;
}
.login-logo {
  font-size: 28px;
  font-weight: 800;
  color: #1A1917;
  letter-spacing: 0.04em;
}
.login-subtitle {
  font-size: 13px;
  color: #999;
  margin-top: 6px;
}
.login-links {
  margin-top: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: center;
}
.link-btn {
  border: 0;
  background: none;
  color: #4F6EF7;
  cursor: pointer;
  font-size: 13px;
}
</style>
