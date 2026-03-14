<template>
  <div v-if="isAuthenticated" class="app-wrapper">
    <div class="user-info">Logged in as: <strong>{{ username }}</strong> | <button @click="logout" class="logout-btn">Logout</button></div>
    <Othello3D :authToken="authToken" />
  </div>
  <Login v-else @login-success="onLoginSuccess" />
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import Othello3D from "./components/Othello3D.vue";
import Login from "./components/Login.vue";

const isAuthenticated = ref(false);
const authToken = ref('');
const username = ref('');

onMounted(() => {
  const token = localStorage.getItem('game_token');
  const storedUser = localStorage.getItem('game_username');
  if (token && storedUser) {
    authToken.value = token;
    username.value = storedUser;
    isAuthenticated.value = true;
  }
});

const onLoginSuccess = (token: string, user: string) => {
  authToken.value = token;
  username.value = user;
  isAuthenticated.value = true;
};

const logout = () => {
  localStorage.removeItem('game_token');
  localStorage.removeItem('game_username');
  isAuthenticated.value = false;
  authToken.value = '';
  username.value = '';
  // 強制リロードしてWebSocket接続などをリセット
  window.location.reload();
};
</script>

<style>
.user-info {
  background-color: #333;
  color: #fff;
  padding: 8px 16px;
  display: flex;
  justify-content: flex-end;
  align-items: center;
  font-family: sans-serif;
  font-size: 14px;
  position: absolute;
  top: 0;
  right: 0;
  z-index: 1000;
  border-bottom-left-radius: 8px;
}
.logout-btn {
  background: #ff5555;
  color: white;
  border: none;
  padding: 4px 10px;
  border-radius: 4px;
  cursor: pointer;
  margin-left: 15px;
}
.logout-btn:hover {
  background: #ff3333;
}
</style>
