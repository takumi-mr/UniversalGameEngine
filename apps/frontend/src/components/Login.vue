<template>
  <v-app>
    <v-main class="bg-grey-darken-4 d-flex align-center justify-center">
      <v-container>
        <v-row justify="center">
          <v-col
            cols="12"
            sm="8"
            md="6"
            lg="4"
          >
            <v-card
              class="rounded-xl pa-8 elevation-24 bg-surface"
              border="none"
            >
              <div class="d-flex justify-end mb-4">
                <v-menu>
                  <template #activator="{ props }">
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
                <div class="text-h2 mb-4">
                  🎮
                </div>
                <h1 class="text-h4 font-weight-bold mb-2">
                  {{ $t('common.title') }}
                </h1>
                <p class="text-body-1 text-medium-emphasis">
                  {{ $t('common.login_desc') }}
                </p>
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
                />

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
import { useAuthStore } from '../store/auth';

const router = useRouter();
const authStore = useAuthStore();
const username = ref('');
const loading = ref(false);
const error = ref('');

// API logic moved to authStore

const handleLogin = async () => {
  if (!username.value.trim()) return;
  
  loading.value = true;
  error.value = '';

  try {
    await authStore.login(username.value);
    router.push('/selection');
  } catch (err) {
    error.value = (err as Error).message;
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
