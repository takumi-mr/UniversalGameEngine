<template>
  <div class="chat-panel">
    <div class="chat-header">
      <v-icon
        icon="mdi-chat"
        size="small"
        class="mr-2"
      />
      <span class="header-title">Room Chat</span>
      <v-spacer />
      <v-btn-toggle
        v-model="channel"
        density="compact"
        mandatory
        variant="tonal"
        class="channel-toggle"
      >
        <v-btn
          value="public"
          size="x-small"
        >
          Public
        </v-btn>
        <v-btn
          value="private"
          size="x-small"
          :disabled="!isPlayer"
        >
          Private
        </v-btn>
      </v-btn-toggle>
    </div>

    <!-- 宛先選択 (Privateの場合のみ表示) -->
    <div
      v-if="channel === 'private'"
      class="recipient-selector"
    >
      <span class="text-caption mr-2">To:</span>
      <v-select
        v-model="recipientId"
        :items="recipientOptions"
        density="compact"
        hide-details
        variant="plain"
        class="inline-select"
        item-title="name"
        item-value="id"
      />
    </div>

    <div
      ref="messageContainer"
      class="chat-messages"
    >
      <div
        v-for="(msg, index) in messages"
        :key="index"
        :class="['message-row', msg.channel, { 'is-me': msg.userId === myPlayerId }]"
      >
        <div class="message-meta">
          <span class="message-user">{{ msg.userId }}</span>
          <span
            v-if="msg.recipientId && msg.recipientId !== 'all'"
            class="message-to"
          >
            ➔ {{ msg.recipientId }}
          </span>
          <v-spacer />
          <span class="message-time">{{ formatTime(msg.timestamp) }}</span>
        </div>
        <div class="message-content">
          {{ msg.message }}
        </div>
      </div>
      <div
        v-if="messages.length === 0"
        class="empty-chat"
      >
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
        class="msg-input"
        @keyup.enter="send"
      >
        <template #append-inner>
          <v-btn
            icon="mdi-send"
            variant="text"
            size="small"
            color="primary"
            :disabled="!inputText.trim()"
            @click="send"
          />
        </template>
      </v-text-field>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onUpdated, nextTick, computed } from 'vue';

interface ChatMessage {
  userId: string;
  message: string;
  channel: 'public' | 'private';
  recipientId?: string;
  timestamp: string;
}

const props = defineProps<{
  messages: ChatMessage[];
  isPlayer: boolean;
  myPlayerId: string;
  players: string[]; // 全プレイヤーリスト
}>();

const emit = defineEmits<{
  (e: 'send', payload: { message: string, channel: 'public' | 'private', recipientId?: string }): void;
}>();

const channel = ref<'public' | 'private'>('public');
const recipientId = ref('all');
const inputText = ref('');
const messageContainer = ref<HTMLElement | null>(null);

const recipientOptions = computed(() => {
  const options = [{ id: 'all', name: 'All Players' }];
  props.players.filter(p => p !== props.myPlayerId).forEach(p => {
    options.push({ id: p, name: p });
  });
  return options;
});

const formatTime = (ts: string) => {
  const date = new Date(ts);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const send = () => {
  if (!inputText.value.trim()) return;
  emit('send', {
    message: inputText.value.trim(),
    channel: channel.value,
    recipientId: channel.value === 'private' ? recipientId.value : undefined
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
  padding: 6px 10px;
  background: rgba(var(--v-theme-on-surface), 0.05);
  display: flex;
  align-items: center;
  font-size: 0.75rem;
  font-weight: 600;
  flex-shrink: 0;
}

.header-title {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.channel-toggle {
  height: 22px !important;
}

.recipient-selector {
  padding: 4px 10px;
  background: rgba(var(--v-theme-secondary), 0.05);
  display: flex;
  align-items: center;
  border-bottom: 1px solid rgba(var(--v-border-color), 0.1);
  flex-shrink: 0;
}

.inline-select :deep(.v-input__control) {
  min-height: 24px;
}
.inline-select :deep(.v-field__input) {
  padding: 0;
  min-height: 24px;
  font-size: 0.75rem;
}

.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 0; /* Important for flex child overflow */
}

.message-row {
  display: flex;
  flex-direction: column;
  max-width: 95%;
  padding: 6px 8px;
  border-radius: 8px;
  background: rgba(var(--v-theme-on-surface), 0.03);
  font-size: 0.8rem;
  align-self: flex-start;
  word-break: break-all;
}

.message-row.is-me {
  align-self: flex-end;
  background: rgba(var(--v-theme-primary), 0.1);
}

.message-row.private {
  background: rgba(var(--v-theme-secondary), 0.1);
  border-left: 3px solid rgb(var(--v-theme-secondary));
}

.message-meta {
  display: flex;
  align-items: center;
  margin-bottom: 2px;
  gap: 4px;
}

.message-user {
  font-weight: 700;
  font-size: 0.7rem;
  color: rgb(var(--v-theme-primary));
  white-space: nowrap;
}

.message-to {
  font-size: 0.65rem;
  opacity: 0.7;
  color: rgb(var(--v-theme-secondary));
}

.message-time {
  font-size: 0.6rem;
  opacity: 0.5;
}

.message-content {
  line-height: 1.3;
}

.empty-chat {
  text-align: center;
  opacity: 0.4;
  font-size: 0.75rem;
  margin-top: 15px;
}

.chat-input-area {
  padding: 8px;
  background: rgba(var(--v-theme-on-surface), 0.02);
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  flex-shrink: 0;
}

.msg-input :deep(.v-field__input) {
  font-size: 0.8rem;
  padding-top: 4px;
  padding-bottom: 4px;
}
</style>
