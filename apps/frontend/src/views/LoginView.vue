<template>
  <Login @login-success="onLoginSuccess" />
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router';
import Login from '../components/Login.vue';

const router = useRouter();

const onLoginSuccess = (_token: string, _username: string) => {
  // Login component already saves to localStorage
  router.push('/selection');
};
</script>
