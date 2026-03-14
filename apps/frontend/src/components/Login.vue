<template>
  <div class="login-container">
    <div class="login-box">
      <h2>Welcome to Universal Game Engine</h2>
      <p>Please enter a username to login.</p>
      <form @submit.prevent="handleLogin">
        <input 
          type="text" 
          v-model="username" 
          placeholder="Username" 
          required 
          class="login-input"
        />
        <button type="submit" class="login-button" :disabled="loading">
          {{ loading ? 'Logging in...' : 'Login' }}
        </button>
      </form>
      <p v-if="error" class="error-msg">{{ error }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';

const emit = defineEmits<{
  (e: 'login-success', token: string, username: string): void
}>();

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

    // トークンをLocalStorageに保存し、親コンポーネントに通知
    localStorage.setItem('game_token', data.token);
    localStorage.setItem('game_username', data.userId);
    emit('login-success', data.token, data.userId);
  } catch (err: any) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
};
</script>

<style scoped>
.login-container {
  display: flex;
  justify-content: center;
  align-items: center;
  width: 100vw;
  height: 100vh;
  background-color: #1a1a1a;
  color: white;
  font-family: sans-serif;
}
.login-box {
  background: rgba(40, 40, 40, 0.9);
  padding: 40px;
  border-radius: 12px;
  box-shadow: 0 10px 30px rgba(0,0,0,0.5);
  text-align: center;
  max-width: 400px;
  width: 100%;
}
.login-box h2 { margin-top: 0; color: #88ff88; }
.login-box p { color: #ccc; margin-bottom: 20px;}
.login-input {
  width: 100%;
  padding: 12px;
  margin-bottom: 20px;
  box-sizing: border-box;
  background: #333;
  border: 1px solid #555;
  color: white;
  border-radius: 6px;
  font-size: 16px;
}
.login-button {
  width: 100%;
  padding: 12px;
  background: #007bff;
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 16px;
  cursor: pointer;
  transition: background 0.3s;
}
.login-button:hover:not(:disabled) { background: #0056b3; }
.login-button:disabled { background: #555; cursor: not-allowed; }
.error-msg { color: #ff5555 !important; margin-top: 15px !important; }
</style>
