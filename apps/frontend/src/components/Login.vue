<template>
  <v-app>
    <v-main class="bg-grey-darken-4 d-flex align-center justify-center">
      <v-container>
        <v-row justify="center">
          <v-col cols="12" sm="8" md="6" lg="4">
            <v-card class="rounded-xl pa-8 elevation-24 bg-surface" border="none">
              <div class="d-flex justify-end mb-4">
                <v-menu>
                  <template v-slot:activator="{ props }">
                    <v-btn
                      v-bind="props"
                      variant="text"
                      density="compact"
                      prepend-icon="mdi-translate"
                    >
                      {{ $i18n.locale === 'ja' ? '日本語' : 'English' }}
                    </v-btn>
                  </template>
                  <v-list>
                    <v-list-item @click="$i18n.locale = 'en'">
                      <v-list-item-title>English</v-list-item-title>
                    </v-list-item>
                    <v-list-item @click="$i18n.locale = 'ja'">
                      <v-list-item-title>日本語</v-list-item-title>
                    </v-list-item>
                  </v-list>
                </v-menu>
              </div>

              <div class="text-center mb-8">
                <div class="text-h2 mb-4">🎮</div>
                <h1 class="text-h4 font-weight-bold mb-2">{{ $t('common.title') }}</h1>
                <p class="text-body-1 text-medium-emphasis">{{ $t('common.login_desc') }}</p>
              </div>

              <v-form @submit.prevent="handleLogin">
                <v-text-field
                  v-model="username"
                  :label="$t('common.username')"
                  placeholder="e.g. MasterGamer"
                  variant="outlined"
                  required
                  :disabled="loading"
                  prepend-inner-icon="mdi-account"
                  class="mb-4"
                  color="primary"
                ></v-text-field>

                <v-btn
                  block
                  size="x-large"
                  color="primary"
                  type="submit"
                  :loading="loading"
                  class="font-weight-bold rounded-lg"
                >
                  {{ $t('common.enter_arena') }}
                </v-btn>
              </v-form>

              <v-alert
                v-if="error"
                type="error"
                variant="tonal"
                class="mt-6 rounded-lg"
                density="compact"
              >
                {{ error }}
              </v-alert>
            </v-card>
          </v-col>
        </v-row>
      </v-container>
    </v-main>
  </v-app>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';

const router = useRouter();
const username = ref('');
const loading = ref(false);
const error = ref('');

const API_BASE_URL = "http://127.0.0.1:3000";

const handleLogin = async () => {
  if (!username.value.trim()) return;
  
  loading.value = true;
  error.value = '';

  try {
    const res = await fetch(`${API_BASE_URL}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username.value })
    });

    const data = await res.json();
    
    if (!res.ok) throw new Error(data.error || 'Login failed');

    localStorage.setItem('game_token', data.token);
    localStorage.setItem('game_username', data.userId);
    
    router.push('/selection');
  } catch (err: any) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
};
</script>

<style scoped>
.v-btn {
  text-transform: none;
  letter-spacing: normal;
}
</style>
