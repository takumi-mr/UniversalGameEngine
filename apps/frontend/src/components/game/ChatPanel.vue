<template>
  <div class="chat-panel">
    <div class="chat-header">
      <v-icon icon="mdi-chat" size="small" class="mr-2"></v-icon>
      <span>Room Chat</span>
      <v-spacer></v-spacer>
      <v-btn-toggle
        v-model="channel"
        density="compact"
        mandatory
        variant="tonal"
        class="channel-toggle"
      >
        <v-btn value="public" size="x-small">Public</v-btn>
        <v-btn value="private" size="x-small" :disabled="!isPlayer">Private</v-btn>
      </v-btn-toggle>
    </div>

    <div class="chat-messages" ref="messageContainer">
      <div
        v-for="(msg, index) in messages"
        :key="index"
        :class="['message-row', msg.channel]"
      >
        <div class="message-meta">
          <span class="message-user">{{ msg.userId }}</span>
          <span class="message-time">{{ formatTime(msg.timestamp) }}</span>
          <v-chip
            v-if="msg.channel === 'private'"
            size="x-small"
            color="secondary"
            variant="flat"
            class="ml-2 px-1"
          >
            Private
          </v-chip>
        </div>
        <div class="message-content">{{ msg.message }}</div>
      </div>
      <div v-if="messages.length === 0" class="empty-chat">
        No messages yet.
      </div>
    </div>

    <div class="chat-input-area">
      <v-text-field
        v-model="inputText"
        placeholder="Type a message..."
        density="compact"
        hide-details
        variant="solo-filled"
        flat
        @keyup.enter="send"
      >
        <template v-slot:append-inner>
          <v-btn
            icon="mdi-send"
            variant="text"
            size="small"
            color="primary"
            :disabled="!inputText.trim()"
            @click="send"
          ></v-btn>
        </template>
      </v-text-field>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onUpdated, nextTick } from 'vue';

interface ChatMessage {
  userId: string;
  message: string;
  channel: 'public' | 'private';
  timestamp: string;
}

const props = defineProps<{
  messages: ChatMessage[];
  isPlayer: boolean;
}>();

const emit = defineEmits<{
  (e: 'send', payload: { message: string, channel: 'public' | 'private' }): void;
}>();

const channel = ref<'public' | 'private'>('public');
const inputText = ref('');
const messageContainer = ref<HTMLElement | null>(null);

const formatTime = (ts: string) => {
  const date = new Date(ts);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const send = () => {
  if (!inputText.value.trim()) return;
  emit('send', {
    message: inputText.value.trim(),
    channel: channel.value
  });
  inputText.value = '';
};

const scrollToBottom = () => {
  if (messageContainer.value) {
    messageContainer.value.scrollTop = messageContainer.value.scrollHeight;
  }
};

onUpdated(() => {
  nextTick(scrollToBottom);
});
</script>

<style scoped>
.chat-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: rgba(var(--v-theme-surface), 0.6);
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

.chat-header {
  padding: 8px 12px;
  background: rgba(var(--v-theme-on-surface), 0.05);
  display: flex;
  align-items: center;
  font-size: 0.8rem;
  font-weight: 600;
}

.channel-toggle {
  height: 24px !important;
}

.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.message-row {
  display: flex;
  flex-direction: column;
  max-width: 90%;
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(var(--v-theme-on-surface), 0.03);
  font-size: 0.85rem;
}

.message-row.private {
  background: rgba(var(--v-theme-secondary), 0.1);
  border-left: 3px solid rgb(var(--v-theme-secondary));
}

.message-meta {
  display: flex;
  align-items: center;
  margin-bottom: 4px;
}

.message-user {
  font-weight: 700;
  font-size: 0.75rem;
  color: rgb(var(--v-theme-primary));
}

.message-time {
  font-size: 0.65rem;
  margin-left: 8px;
  opacity: 0.6;
}

.message-content {
  line-height: 1.4;
}

.empty-chat {
  text-align: center;
  opacity: 0.4;
  font-size: 0.8rem;
  margin-top: 20px;
}

.chat-input-area {
  padding: 12px;
  background: rgba(var(--v-theme-on-surface), 0.02);
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
</style>
