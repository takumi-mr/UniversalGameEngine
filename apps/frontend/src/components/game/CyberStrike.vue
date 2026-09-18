<template>
  <div class="cyber-strike-container">
    <!-- Top HUD: Player Status & Timer -->
    <div class="cyber-hud">
      <!-- Player 1 Status (Cyan) -->
      <div class="player-hud p1" :class="{ active: myPlayerSlot === '0' }">
        <div class="player-badge">
          <span class="p-dot cyan-dot" />
          <span class="p-name">{{ p1Name }} {{ myPlayerSlot === "0" ? "(YOU)" : "" }}</span>
          <span class="p-score">{{ p1Score }} PTS</span>
        </div>
        <div class="bar-container">
          <div class="bar-label">HP {{ p1Hp }}/100</div>
          <div class="bar-track">
            <div class="bar-fill hp-fill-cyan" :style="{ width: `${p1Hp}%` }" />
          </div>
        </div>
        <div class="bar-container mini">
          <div class="bar-label">ENERGY {{ Math.round(p1Energy) }}</div>
          <div class="bar-track">
            <div class="bar-fill energy-fill" :style="{ width: `${p1Energy}%` }" />
          </div>
        </div>
      </div>

      <!-- Match Info & Timer -->
      <div class="match-info">
        <div class="match-title">⚡ CYBER STRIKE</div>
        <div class="match-timer" :class="{ urgent: remainingMatchSeconds <= 10 }">
          ⏱ {{ remainingMatchSeconds }}s
        </div>
        <div class="game-status-text" :class="state.status.toLowerCase()">
          {{ state.status }}
        </div>
      </div>

      <!-- Player 2 Status (Magenta) -->
      <div class="player-hud p2" :class="{ active: myPlayerSlot === '1' }">
        <div class="player-badge">
          <span class="p-score">{{ p2Score }} PTS</span>
          <span class="p-name">{{ p2Name }} {{ myPlayerSlot === "1" ? "(YOU)" : "" }}</span>
          <span class="p-dot magenta-dot" />
        </div>
        <div class="bar-container">
          <div class="bar-label">HP {{ p2Hp }}/100</div>
          <div class="bar-track">
            <div class="bar-fill hp-fill-magenta" :style="{ width: `${p2Hp}%` }" />
          </div>
        </div>
        <div class="bar-container mini">
          <div class="bar-label">ENERGY {{ Math.round(p2Energy) }}</div>
          <div class="bar-track">
            <div class="bar-fill energy-fill" :style="{ width: `${p2Energy}%` }" />
          </div>
        </div>
      </div>
    </div>

    <!-- Main Canvas Arena -->
    <div class="arena-wrapper">
      <canvas
        ref="canvasRef"
        :width="ARENA_WIDTH"
        :height="ARENA_HEIGHT"
        class="cyber-canvas"
        @mousedown="handleCanvasClick"
      />

      <!-- Game Over Overlay -->
      <div v-if="state.status === 'FINISHED'" class="overlay-modal">
        <div class="overlay-card glass-panel">
          <div class="result-title">{{ matchResultTitle }}</div>
          <p class="result-message">{{ state.message }}</p>
          <div class="final-score">
            <span>{{ p1Name }}: {{ p1Score }} pts</span> |
            <span>{{ p2Name }}: {{ p2Score }} pts</span>
          </div>
          <button class="cyber-btn primary-pulse" @click="playAgain">🔄 PLAY AGAIN</button>
        </div>
      </div>
    </div>

    <!-- Prediction & Rollback Control Deck -->
    <div class="control-deck glass-panel">
      <div class="deck-header">
        <span class="deck-title">🔮 PREDICTION & ROLLBACK VERIFICATION CONSOLE</span>
        <span class="deck-badge" :class="predictionEnabled ? 'badge-on' : 'badge-off'">
          {{ predictionEnabled ? "PREDICTION ACTIVE (0ms)" : "PREDICTION OFF (LAG SIMULATED)" }}
        </span>
      </div>

      <div class="deck-grid">
        <!-- Prediction Toggle -->
        <div class="control-box">
          <div class="control-label">
            <span>Client-Side Prediction:</span>
            <span class="label-hint">（入力予測）</span>
          </div>
          <div class="toggle-buttons">
            <button
              class="t-btn"
              :class="{ active: predictionEnabled }"
              @click="togglePrediction(true)"
            >
              ⚡ ON (Instant 0ms)
            </button>
            <button
              class="t-btn"
              :class="{ active: !predictionEnabled }"
              @click="togglePrediction(false)"
            >
              ⏳ OFF (Authoritative Only)
            </button>
          </div>
          <div class="control-desc">
            {{
              predictionEnabled
                ? "キー入力が即座にローカルに反映され、確定状態でロールバック＆再計算されます。"
                : "サーバーから応答が届くまで自機が動かず、レイテンシによる操作遅延が発生します。"
            }}
          </div>
        </div>

        <!-- Artificial Latency -->
        <div class="control-box">
          <div class="control-label">
            <span>Simulated Latency (RTT):</span>
            <span class="label-hint">（人工遅延）</span>
          </div>
          <div class="ping-buttons">
            <button
              v-for="lat in [0, 50, 100, 200, 300]"
              :key="lat"
              class="ping-btn"
              :class="{ active: simulatedLatency === lat }"
              @click="setSimulatedLatency(lat)"
            >
              {{ lat }}ms
            </button>
          </div>
          <div class="control-desc">
            遅延を上げることで、高Ping環境での「入力予測の恩恵」と「ロールバック補正」の挙動が鮮明に確認できます。
          </div>
        </div>

        <!-- Visual Debug & Stats -->
        <div class="control-box">
          <div class="control-label">
            <span>Debug Visualizer:</span>
          </div>
          <div class="checkbox-row">
            <label class="cyber-checkbox">
              <input v-model="showServerGhost" type="checkbox" />
              <span>👻 Show Server Ghost (確定真位置を半透明表示)</span>
            </label>
          </div>
          <div class="checkbox-row">
            <label class="cyber-checkbox">
              <input v-model="showAimLine" type="checkbox" />
              <span>🎯 Show Aiming Vector</span>
            </label>
          </div>
        </div>

        <!-- Live Metrics HUD -->
        <div class="control-box metrics-box">
          <div class="control-label">
            <span>Rollback & Engine Metrics:</span>
          </div>
          <div class="metrics-grid">
            <div class="metric-cell">
              <div class="m-val">{{ simulatedLatency }} ms</div>
              <div class="m-lbl">Simulated Ping</div>
            </div>
            <div class="metric-cell">
              <div class="m-val">{{ metrics.rollbackCount }}</div>
              <div class="m-lbl">Rollbacks</div>
            </div>
            <div class="metric-cell">
              <div class="m-val">{{ metrics.pendingActionsCount }}</div>
              <div class="m-lbl">Pending Queue</div>
            </div>
            <div class="metric-cell">
              <div class="m-val">{{ metrics.lastRollbackActions }}</div>
              <div class="m-lbl">Replayed Inputs</div>
            </div>
            <div class="metric-cell">
              <div class="m-val">{{ metrics.reconcileCount }}</div>
              <div class="m-lbl">Server Updates</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Controls Guide -->
      <div class="controls-guide">
        <span class="guide-item"
          ><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> or <kbd>▲</kbd><kbd>◀</kbd><kbd>▼</kbd
          ><kbd>▶</kbd> : Move</span
        >
        <span class="guide-item"><kbd>Space</kbd> : Boost Dash (Invincible)</span>
        <span class="guide-item">1 人なら CPU が相手。2 人目が入室すると CPU と交代</span>
        <span class="guide-item"
          ><kbd>Left Click</kbd> or <kbd>J</kbd> / <kbd>Enter</kbd> : Laser Shot</span
        >
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// Cyber Strike の画面。
// - ローカルには PredictiveEngine（サーバーと同じルールセット）を持ち、自分の入力を即座に反映する
// - 物理は時刻の関数なので、ローカルは自分の時計（サーバー時計に補正済み）で毎フレーム進める
// - サーバーの確定状態が届いたら巻き戻し → 未処理の入力を再適用 → 予測していたティックまで進め直す
// - サーバーへ送るのは入力の変化とショット、無入力時のハートビートだけ
import { ref, shallowRef, computed, onMounted, onUnmounted, watch, toRaw } from "vue";
import {
  CyberStrikeRuleset,
  TICK_RATE,
  type CyberStrikeState,
  type CyberStrikeAction,
  type CyberInput,
  type CyberObstacle,
  type CyberPowerUp,
  type CyberPlayerEntity,
  type CyberProjectile,
} from "@engine/shared/rules/CyberStrikeRuleset";
import { PredictiveEngine } from "@engine/shared/PredictiveEngine";

const props = defineProps<{
  state: CyberStrikeState;
  gameId: string;
  myPlayerId: string;
  /** クライアント時計 − サーバー時計（ms）。無ければ 0 */
  clockSkew?: number;
}>();

const emit = defineEmits<{
  (e: "action", action: CyberStrikeAction): void;
}>();

const ARENA_WIDTH = 800;
const ARENA_HEIGHT = 500;
const TICK_MS = 1000 / TICK_RATE;
/** 入力が無いときにサーバーの物理を進めるためのハートビート間隔 */
const HEARTBEAT_MS = 100;

const canvasRef = ref<HTMLCanvasElement | null>(null);

const simulatedLatency = ref<number>(50); // 人工遅延（RTT, ms）
const showServerGhost = ref<boolean>(true);
const showAimLine = ref<boolean>(true);
const predictionEnabled = ref<boolean>(true);

// 予測エンジン。状態は Vue の外にあるので、変更のたびに shallowRef へ写して描画と HUD に知らせる
const predictiveEngine = new PredictiveEngine<CyberStrikeState, CyberStrikeAction>(
  CyberStrikeRuleset,
  {},
);
const localState = shallowRef<CyberStrikeState>(predictiveEngine.getState());
const metrics = ref({ ...predictiveEngine.metrics });
const syncView = () => {
  localState.value = predictiveEngine.getState();
  metrics.value = { ...predictiveEngine.metrics };
};

/** サーバー時計での「いま」 */
const serverNow = () => Date.now() - (props.clockSkew ?? 0);

// キー入力
const keysDown: Record<string, boolean> = {};
let mouseX = ARENA_WIDTH / 2;
let mouseY = ARENA_HEIGHT / 2;
let firePrev = false;
let dashPrev = false;
let lastSentMove = "";
let lastSentAt = 0;

let animationFrameId: number | null = null;
let tickIntervalId: ReturnType<typeof setInterval> | null = null;

// パーティクル & エフェクト
interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  size: number;
  alpha: number;
  life: number;
}
const particles: Particle[] = [];

interface Shockwave {
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  color: string;
  alpha: number;
}
const shockwaves: Shockwave[] = [];

// --- 表示用の派生値（すべてローカルの予測状態から） ---
const currentState = computed(() => localState.value);
const seatedIds = computed(
  () => Object.values(currentState.value.players ?? {}).filter(Boolean) as string[],
);
const myPlayerKey = computed(() => props.myPlayerId);
const myPlayerSlot = computed(() => (seatedIds.value[0] === props.myPlayerId ? "0" : "1"));
const myEntity = computed(() => currentState.value.playersData[myPlayerKey.value]);

const p1Data = computed(() => {
  const id = seatedIds.value[0];
  return id ? currentState.value.playersData[id] : undefined;
});
const p2Data = computed(() => {
  const s = currentState.value;
  const id = seatedIds.value[1] ?? s.botId ?? undefined;
  return id ? s.playersData[id] : undefined;
});

const p1Name = computed(() => p1Data.value?.id ?? "Player 1");
const p2Name = computed(() => p2Data.value?.id ?? "Player 2");
const p1Hp = computed(() => p1Data.value?.hp ?? 100);
const p2Hp = computed(() => p2Data.value?.hp ?? 100);
const p1Energy = computed(() => p1Data.value?.energy ?? 100);
const p2Energy = computed(() => p2Data.value?.energy ?? 100);
const p1Score = computed(() => p1Data.value?.score ?? 0);
const p2Score = computed(() => p2Data.value?.score ?? 0);

const remainingMatchSeconds = computed(() => {
  const s = currentState.value;
  const remainingTicks = Math.max(0, s.maxTicks - s.tick);
  return Math.ceil(remainingTicks / s.tickRate);
});

const matchResultTitle = computed(() => {
  const win = CyberStrikeRuleset.checkWinCondition({ ...currentState.value, status: "PLAYING" });
  if (!win.isFinished) return "";
  if (!win.winnerIds || win.winnerIds.length === 0) return "DRAW MATCH";
  if (win.winnerIds.includes(myPlayerKey.value)) return "VICTORY! YOU WIN!";
  return "DEFEAT! OPPONENT WINS";
});

// --- サーバー確定状態の取り込み ---
const applyServerState = (serverState: CyberStrikeState) => {
  const myP = serverState.playersData?.[myPlayerKey.value];
  predictiveEngine.reconcile(serverState, myP?.lastProcessedSeq, {
    // 予測していたティックまで進め直してから予測と比較する
    catchUp: (predicted) =>
      predicted.status === "PLAYING" ? { type: "TICK", tick: predicted.tick } : null,
  });
  syncView();
};

watch(
  () => props.state,
  (newServerState) => {
    if (!newServerState) return;
    // Vue のリアクティブプロキシは structuredClone できないので生のオブジェクトを渡す
    const raw = toRaw(newServerState);
    const delay = simulatedLatency.value / 2;
    if (delay > 0) setTimeout(() => applyServerState(raw), delay);
    else applyServerState(raw);
  },
  { deep: true, immediate: true },
);

// --- 設定 ---
const togglePrediction = (enabled: boolean) => {
  predictionEnabled.value = enabled;
  predictiveEngine.isPredictionEnabled = enabled;
  if (!enabled) predictiveEngine.clearPendingActions();
  syncView();
};

const setSimulatedLatency = (lat: number) => {
  simulatedLatency.value = lat;
};

// --- サーバーへの送信（人工遅延つき） ---
const sendToServer = (action: CyberStrikeAction) => {
  lastSentAt = serverNow();
  const delay = simulatedLatency.value / 2;
  if (delay > 0) setTimeout(() => emit("action", action), delay);
  else emit("action", action);
};

/** もう一度（サーバーが RESET を処理して新しい試合を配る） */
const playAgain = () => {
  sendToServer({ type: "RESET", playerId: myPlayerKey.value });
};

// --- 入力 ---
const readMovement = () => {
  let moveX = 0;
  let moveY = 0;
  if (keysDown["w"] || keysDown["arrowup"]) moveY -= 1;
  if (keysDown["s"] || keysDown["arrowdown"]) moveY += 1;
  if (keysDown["a"] || keysDown["arrowleft"]) moveX -= 1;
  if (keysDown["d"] || keysDown["arrowright"]) moveX += 1;
  return { moveX, moveY };
};

const aimAtMouse = () => {
  const me = myEntity.value;
  if (!me) return undefined;
  return Math.atan2(mouseY - me.y, mouseX - me.x);
};

/** 入力を予測として即座に適用し、サーバーへ送る */
const dispatchPlayerInput = (input: CyberInput) => {
  const action: CyberStrikeAction = {
    type: "INPUT",
    playerId: myPlayerKey.value,
    seq: predictiveEngine.allocateSeq(),
    timestamp: serverNow(),
    input,
  };
  predictiveEngine.predictAction(action);
  syncView();

  if (input.fire) createMuzzleParticles(myPlayerKey.value, input.aimAngle);
  if (input.dash) createDashShockwave(myPlayerKey.value);

  sendToServer(action);
};

const handleCanvasClick = (e: MouseEvent) => {
  const canvas = canvasRef.value;
  if (!canvas || currentState.value.status !== "PLAYING" || !myEntity.value) return;
  const rect = canvas.getBoundingClientRect();
  const clickX = (e.clientX - rect.left) * (canvas.width / rect.width);
  const clickY = (e.clientY - rect.top) * (canvas.height / rect.height);
  const me = myEntity.value;
  dispatchPlayerInput({
    ...readMovement(),
    fire: true,
    aimAngle: Math.atan2(clickY - me.y, clickX - me.x),
  });
};

// エフェクト生成
const createMuzzleParticles = (playerId: string, angle?: number) => {
  const p = currentState.value.playersData[playerId];
  if (!p) return;
  const theta = angle !== undefined ? angle : p.angle;
  const col = playerId === p1Name.value ? "#00f0ff" : "#ff007f";
  for (let i = 0; i < 6; i++) {
    const spread = (Math.random() - 0.5) * 0.5;
    const speed = 3 + Math.random() * 4;
    particles.push({
      x: p.x + Math.cos(theta) * p.radius,
      y: p.y + Math.sin(theta) * p.radius,
      vx: Math.cos(theta + spread) * speed,
      vy: Math.sin(theta + spread) * speed,
      color: col,
      size: 2 + Math.random() * 3,
      alpha: 1,
      life: 15,
    });
  }
};

const createDashShockwave = (playerId: string) => {
  const p = currentState.value.playersData[playerId];
  if (!p) return;
  const col = playerId === p1Name.value ? "#00f0ff" : "#ff007f";
  shockwaves.push({
    x: p.x,
    y: p.y,
    radius: p.radius,
    maxRadius: p.radius * 2.8,
    color: col,
    alpha: 0.8,
  });
};

const handleKeyDown = (e: KeyboardEvent) => {
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space", " "].includes(e.key)) {
    e.preventDefault();
  }
  keysDown[e.key.toLowerCase()] = true;
};

const handleKeyUp = (e: KeyboardEvent) => {
  keysDown[e.key.toLowerCase()] = false;
};

const handleMouseMove = (e: MouseEvent) => {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  mouseX = (e.clientX - rect.left) * (canvas.width / rect.width);
  mouseY = (e.clientY - rect.top) * (canvas.height / rect.height);
};

/**
 * 固定レート（30Hz）の更新。
 * 入力の変化・ショット・ダッシュはその場でサーバーへ、何も無ければハートビート。
 * ローカルの物理は毎回「いま」まで進める（サーバーへは送らない）
 */
const runFixedUpdate = () => {
  if (currentState.value.status !== "PLAYING" || !myEntity.value) return;
  const now = serverNow();

  const { moveX, moveY } = readMovement();
  const fireHeld = !!(keysDown["j"] || keysDown["enter"]);
  const dashHeld = !!(keysDown[" "] || keysDown["space"]);
  const fire = fireHeld && !firePrev;
  const dash = dashHeld && !dashPrev;
  firePrev = fireHeld;
  dashPrev = dashHeld;

  const moveKey = `${moveX},${moveY}`;
  if (fire || dash || moveKey !== lastSentMove) {
    lastSentMove = moveKey;
    dispatchPlayerInput({
      moveX,
      moveY,
      fire,
      dash,
      aimAngle: fire || dash ? aimAtMouse() : undefined,
    });
  } else if (now - lastSentAt >= HEARTBEAT_MS) {
    sendToServer({ type: "TICK", timestamp: now });
  }

  predictiveEngine.advanceLocal({ type: "TICK", timestamp: now });
  syncView();
};
// Canvas 描画ループ (60fps)
const renderFrame = () => {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const state = currentState.value;

  // 1. 背景クリア & サイバーグリッド
  ctx.fillStyle = "#0a0c16";
  ctx.fillRect(0, 0, ARENA_WIDTH, ARENA_HEIGHT);

  drawCyberGrid(ctx);

  // 2. 障害物の描画
  drawObstacles(ctx, state.obstacles);

  // 3. パワーアップの描画
  drawPowerUps(ctx, state.powerUps);

  // 4. サーバーゴーストの描画（デバッグ用）
  if (showServerGhost.value) {
    drawServerGhost(ctx);
  }

  // 5. プレイヤーの描画
  for (const p of Object.values(state.playersData)) {
    drawPlayer(ctx, p);
  }

  // 6. 弾（プロジェクタイル）の描画
  drawProjectiles(ctx, state.projectiles);

  // 7. パーティクル & ショックウェーブの更新と描画
  updateAndDrawEffects(ctx);

  // 8. 照準線の描画
  if (showAimLine.value && myEntity.value && state.status === "PLAYING") {
    drawAimingLine(ctx, myEntity.value);
  }

  animationFrameId = requestAnimationFrame(renderFrame);
};

// サイバーグリッド描画
const drawCyberGrid = (ctx: CanvasRenderingContext2D) => {
  ctx.save();
  ctx.strokeStyle = "rgba(0, 240, 255, 0.05)";
  ctx.lineWidth = 1;
  const gridSize = 40;
  for (let x = 0; x < ARENA_WIDTH; x += gridSize) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, ARENA_HEIGHT);
    ctx.stroke();
  }
  for (let y = 0; y < ARENA_HEIGHT; y += gridSize) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(ARENA_WIDTH, y);
    ctx.stroke();
  }

  // アリーナ境界グロー
  ctx.strokeStyle = "rgba(0, 240, 255, 0.4)";
  ctx.lineWidth = 2;
  ctx.shadowColor = "#00f0ff";
  ctx.shadowBlur = 10;
  ctx.strokeRect(2, 2, ARENA_WIDTH - 4, ARENA_HEIGHT - 4);
  ctx.restore();
};

// 障害物描画
const drawObstacles = (ctx: CanvasRenderingContext2D, obstacles: CyberObstacle[]) => {
  if (!obstacles) return;
  ctx.save();
  for (const obs of obstacles) {
    ctx.fillStyle = "rgba(16, 24, 48, 0.85)";
    ctx.strokeStyle = "rgba(0, 240, 255, 0.7)";
    ctx.lineWidth = 2;
    ctx.shadowColor = "#00f0ff";
    ctx.shadowBlur = 8;
    ctx.fillRect(obs.x, obs.y, obs.width, obs.height);
    ctx.strokeRect(obs.x, obs.y, obs.width, obs.height);

    // 斜めハッチング
    ctx.strokeStyle = "rgba(0, 240, 255, 0.15)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(obs.x, obs.y);
    ctx.lineTo(obs.x + obs.width, obs.y + obs.height);
    ctx.stroke();
  }
  ctx.restore();
};

// パワーアップ描画
const drawPowerUps = (ctx: CanvasRenderingContext2D, powerUps: CyberPowerUp[]) => {
  if (!powerUps) return;
  ctx.save();
  const time = Date.now() * 0.005;
  for (const pu of powerUps) {
    const pulse = Math.sin(time) * 3;
    let col = "#00ff66";
    let icon = "❤️";
    if (pu.type === "SHIELD") {
      col = "#00f0ff";
      icon = "🛡️";
    } else if (pu.type === "ENERGY") {
      col = "#ffe600";
      icon = "⚡";
    }

    ctx.fillStyle = col;
    ctx.shadowColor = col;
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(pu.x, pu.y, pu.radius + pulse, 0, Math.PI * 2);
    ctx.fill();

    ctx.font = "12px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(icon, pu.x, pu.y);
  }
  ctx.restore();
};

// サーバーゴースト描画（ロールバック・予測の検証用）
const drawServerGhost = (ctx: CanvasRenderingContext2D) => {
  const authState = predictiveEngine.getAuthoritativeState();
  if (!authState || !authState.playersData) return;

  ctx.save();
  for (const [pid, p] of Object.entries(authState.playersData)) {
    const isP1 = pid === p1Name.value;
    const col = isP1 ? "rgba(0, 240, 255, 0.3)" : "rgba(255, 0, 127, 0.3)";

    // 半透明点線のゴーストサークル
    ctx.strokeStyle = col;
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = col;
    ctx.font = "9px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("SERVER GHOST", p.x, p.y - p.radius - 4);
  }
  ctx.restore();
};

// プレイヤー描画
const drawPlayer = (ctx: CanvasRenderingContext2D, p: CyberPlayerEntity) => {
  ctx.save();
  const isP1 = p.id === p1Name.value;
  const col = isP1 ? "#00f0ff" : "#ff007f";

  // ダッシュ中の無敵残像
  if (p.dashRemaining > 0) {
    ctx.shadowColor = col;
    ctx.shadowBlur = 20;
    ctx.strokeStyle = col;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.radius * 1.3, 0, Math.PI * 2);
    ctx.stroke();
  }

  // シールド展開中
  if (p.shield) {
    ctx.strokeStyle = "rgba(0, 255, 255, 0.8)";
    ctx.lineWidth = 3;
    ctx.shadowColor = "#00ffff";
    ctx.shadowBlur = 15;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.radius + 6, 0, Math.PI * 2);
    ctx.stroke();
  }

  // 本体サークル
  ctx.fillStyle = isP1 ? "#003b46" : "#4a0026";
  ctx.strokeStyle = col;
  ctx.lineWidth = 3;
  ctx.shadowColor = col;
  ctx.shadowBlur = 12;
  ctx.beginPath();
  ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // 砲身（エイム方向）
  ctx.beginPath();
  ctx.moveTo(p.x, p.y);
  ctx.lineTo(p.x + Math.cos(p.angle) * (p.radius + 10), p.y + Math.sin(p.angle) * (p.radius + 10));
  ctx.lineWidth = 4;
  ctx.stroke();

  // ミニHPバー
  const hpBarW = 34;
  const hpBarH = 4;
  const hpPercent = Math.max(0, p.hp / 100);
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.fillRect(p.x - hpBarW / 2, p.y - p.radius - 12, hpBarW, hpBarH);
  ctx.fillStyle = col;
  ctx.fillRect(p.x - hpBarW / 2, p.y - p.radius - 12, hpBarW * hpPercent, hpBarH);

  // プレイヤー名
  ctx.font = "10px sans-serif";
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.fillText(p.id, p.x, p.y - p.radius - 16);

  ctx.restore();
};

// 弾（プロジェクタイル）描画
const drawProjectiles = (ctx: CanvasRenderingContext2D, projectiles: CyberProjectile[]) => {
  if (!projectiles) return;
  ctx.save();
  for (const proj of projectiles) {
    const isP1 = proj.ownerId === p1Name.value;
    const col = isP1 ? "#00f0ff" : "#ff007f";

    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = col;
    ctx.lineWidth = 2;
    ctx.shadowColor = col;
    ctx.shadowBlur = 14;

    ctx.beginPath();
    ctx.arc(proj.x, proj.y, proj.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // 軌跡（トレイル）
    ctx.strokeStyle = col;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(proj.x, proj.y);
    ctx.lineTo(proj.x - proj.vx * 2, proj.y - proj.vy * 2);
    ctx.stroke();
  }
  ctx.restore();
};

// 照準線描画
const drawAimingLine = (ctx: CanvasRenderingContext2D, p: CyberPlayerEntity) => {
  ctx.save();
  ctx.strokeStyle = "rgba(0, 240, 255, 0.25)";
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 6]);
  ctx.beginPath();
  ctx.moveTo(p.x, p.y);
  ctx.lineTo(mouseX, mouseY);
  ctx.stroke();

  // マウスカーソル位置のレティクル
  ctx.strokeStyle = "#00f0ff";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(mouseX, mouseY, 8, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
};

// パーティクル＆ショックウェーブ更新
const updateAndDrawEffects = (ctx: CanvasRenderingContext2D) => {
  ctx.save();
  // 1. パーティクル
  for (let i = particles.length - 1; i >= 0; i--) {
    const pt = particles[i];
    pt.x += pt.vx;
    pt.y += pt.vy;
    pt.alpha -= 1 / pt.life;
    if (pt.alpha <= 0) {
      particles.splice(i, 1);
      continue;
    }
    ctx.fillStyle = pt.color;
    ctx.globalAlpha = Math.max(0, pt.alpha);
    ctx.shadowColor = pt.color;
    ctx.shadowBlur = 6;
    ctx.fillRect(pt.x, pt.y, pt.size, pt.size);
  }

  // 2. ショックウェーブ
  ctx.globalAlpha = 1;
  for (let i = shockwaves.length - 1; i >= 0; i--) {
    const sw = shockwaves[i];
    sw.radius += 2.5;
    sw.alpha -= 0.05;
    if (sw.alpha <= 0 || sw.radius >= sw.maxRadius) {
      shockwaves.splice(i, 1);
      continue;
    }
    ctx.strokeStyle = sw.color;
    ctx.lineWidth = 2;
    ctx.shadowColor = sw.color;
    ctx.shadowBlur = 10;
    ctx.globalAlpha = Math.max(0, sw.alpha);
    ctx.beginPath();
    ctx.arc(sw.x, sw.y, sw.radius, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
};

onMounted(() => {
  window.addEventListener("keydown", handleKeyDown);
  window.addEventListener("keyup", handleKeyUp);
  window.addEventListener("mousemove", handleMouseMove);

  renderFrame(); // 描画ループ (60fps)
  tickIntervalId = setInterval(runFixedUpdate, TICK_MS); // 入力と物理 (30Hz)
});

onUnmounted(() => {
  window.removeEventListener("keydown", handleKeyDown);
  window.removeEventListener("keyup", handleKeyUp);
  window.removeEventListener("mousemove", handleMouseMove);

  if (animationFrameId !== null) cancelAnimationFrame(animationFrameId);
  if (tickIntervalId !== null) clearInterval(tickIntervalId);
});
</script>

<style scoped>
.cyber-strike-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  width: 100%;
  max-width: 960px;
  margin: 0 auto;
  color: #e0f7fa;
  font-family:
    "Outfit",
    "Inter",
    -apple-system,
    sans-serif;
  user-select: none;
}

/* Glassmorphism Panel */
.glass-panel {
  background: rgba(10, 15, 30, 0.75);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(0, 240, 255, 0.2);
  border-radius: 12px;
  box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.37);
}

/* HUD Top Bar */
.cyber-hud {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  background: rgba(8, 12, 24, 0.85);
  border: 1px solid rgba(0, 240, 255, 0.25);
  border-radius: 10px;
  padding: 12px 20px;
  box-shadow: 0 4px 20px rgba(0, 240, 255, 0.1);
}

.player-hud {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 220px;
}

.player-badge {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 700;
  font-size: 0.95rem;
  letter-spacing: 0.5px;
}

.p-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
}
.cyan-dot {
  background: #00f0ff;
  box-shadow: 0 0 8px #00f0ff;
}
.magenta-dot {
  background: #ff007f;
  box-shadow: 0 0 8px #ff007f;
}

.p-score {
  font-size: 0.85rem;
  color: #ffe600;
}

.bar-container {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.bar-label {
  font-size: 0.75rem;
  font-weight: 600;
  color: #8be9fd;
}
.bar-track {
  width: 100%;
  height: 8px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  overflow: hidden;
}
.bar-container.mini .bar-track {
  height: 4px;
}
.hp-fill-cyan {
  height: 100%;
  background: linear-gradient(90deg, #00b4d8, #00f0ff);
  box-shadow: 0 0 8px #00f0ff;
  transition: width 0.1s ease-out;
}
.hp-fill-magenta {
  height: 100%;
  background: linear-gradient(90deg, #d90429, #ff007f);
  box-shadow: 0 0 8px #ff007f;
  transition: width 0.1s ease-out;
}
.energy-fill {
  height: 100%;
  background: linear-gradient(90deg, #ffb703, #ffe600);
  box-shadow: 0 0 6px #ffe600;
  transition: width 0.1s ease-out;
}

/* Match Info Center */
.match-info {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}
.match-title {
  font-size: 0.85rem;
  letter-spacing: 2px;
  color: #00f0ff;
  font-weight: 800;
}
.match-timer {
  font-size: 1.6rem;
  font-weight: 900;
  font-family: monospace;
  color: #ffffff;
  text-shadow: 0 0 10px rgba(0, 240, 255, 0.6);
}
.match-timer.urgent {
  color: #ff3366;
  text-shadow: 0 0 12px #ff3366;
  animation: pulse 0.5s infinite alternate;
}
.game-status-text {
  font-size: 0.75rem;
  padding: 2px 8px;
  border-radius: 12px;
  font-weight: 700;
  letter-spacing: 1px;
}
.game-status-text.playing {
  background: rgba(0, 255, 128, 0.2);
  color: #00ff80;
}
.game-status-text.waiting {
  background: rgba(255, 180, 0, 0.2);
  color: #ffb400;
}
.game-status-text.finished {
  background: rgba(255, 50, 100, 0.2);
  color: #ff3264;
}

/* Arena Canvas Wrapper */
.arena-wrapper {
  position: relative;
  width: 100%;
  max-width: 800px;
  aspect-ratio: 800 / 500;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.6);
}
.cyber-canvas {
  width: 100%;
  height: 100%;
  display: block;
  cursor: crosshair;
}

/* Overlays */
.overlay-modal {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(5, 8, 18, 0.85);
  backdrop-filter: blur(8px);
  z-index: 10;
}
.overlay-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 28px 36px;
  max-width: 480px;
  text-align: center;
}
.glitch-title {
  font-size: 2rem;
  font-weight: 900;
  color: #00f0ff;
  letter-spacing: 3px;
  text-shadow: 0 0 15px #00f0ff;
}
.overlay-desc {
  font-size: 0.9rem;
  color: #a0c4ff;
  margin: 0;
}
.mode-select-box {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}
.box-title {
  font-size: 0.8rem;
  color: #8be9fd;
  text-align: left;
}
.mode-btn-group {
  display: flex;
  gap: 8px;
  width: 100%;
}
.mode-btn {
  flex: 1;
  padding: 8px 10px;
  font-size: 0.8rem;
  font-weight: 600;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(0, 240, 255, 0.3);
  border-radius: 6px;
  color: #e0f7fa;
  cursor: pointer;
  transition: all 0.2s;
}
.mode-btn:hover {
  background: rgba(0, 240, 255, 0.15);
}
.mode-btn.active {
  background: rgba(0, 240, 255, 0.3);
  border-color: #00f0ff;
  box-shadow: 0 0 10px rgba(0, 240, 255, 0.4);
}

.cyber-btn {
  padding: 12px 28px;
  font-size: 1rem;
  font-weight: 800;
  letter-spacing: 1px;
  color: #050812;
  background: #00f0ff;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
  box-shadow: 0 0 20px rgba(0, 240, 255, 0.5);
}
.cyber-btn:hover {
  transform: scale(1.04);
  box-shadow: 0 0 30px rgba(0, 240, 255, 0.8);
}
.result-title {
  font-size: 1.8rem;
  font-weight: 900;
  color: #ffe600;
  text-shadow: 0 0 15px rgba(255, 230, 0, 0.6);
}

/* Control Deck */
.control-deck {
  width: 100%;
  padding: 18px 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.deck-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid rgba(0, 240, 255, 0.2);
  padding-bottom: 10px;
}
.deck-title {
  font-weight: 800;
  font-size: 0.95rem;
  letter-spacing: 1px;
  color: #00f0ff;
}
.deck-badge {
  font-size: 0.75rem;
  font-weight: 700;
  padding: 4px 10px;
  border-radius: 12px;
}
.badge-on {
  background: rgba(0, 255, 128, 0.2);
  color: #00ff80;
  border: 1px solid #00ff80;
}
.badge-off {
  background: rgba(255, 50, 100, 0.2);
  color: #ff3264;
  border: 1px solid #ff3264;
}

.deck-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.control-box {
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: rgba(0, 0, 0, 0.25);
  padding: 12px 14px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.05);
}
.control-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.85rem;
  font-weight: 700;
  color: #ffffff;
}
.label-hint {
  font-size: 0.75rem;
  color: #8be9fd;
  font-weight: normal;
}
.control-desc {
  font-size: 0.75rem;
  color: #a0c4ff;
  line-height: 1.4;
}

.toggle-buttons,
.ping-buttons {
  display: flex;
  gap: 6px;
}
.t-btn,
.ping-btn {
  flex: 1;
  padding: 6px 10px;
  font-size: 0.75rem;
  font-weight: 700;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(0, 240, 255, 0.2);
  border-radius: 4px;
  color: #e0f7fa;
  cursor: pointer;
  transition: all 0.2s;
}
.t-btn.active,
.ping-btn.active {
  background: #00f0ff;
  color: #050812;
  border-color: #00f0ff;
  box-shadow: 0 0 10px rgba(0, 240, 255, 0.4);
}

.checkbox-row {
  display: flex;
  align-items: center;
}
.cyber-checkbox {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.8rem;
  color: #e0f7fa;
  cursor: pointer;
}
.cyber-checkbox input {
  accent-color: #00f0ff;
}

/* Metrics Grid */
.metrics-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
}
.metric-cell {
  background: rgba(0, 240, 255, 0.05);
  border: 1px solid rgba(0, 240, 255, 0.15);
  border-radius: 4px;
  padding: 6px 4px;
  text-align: center;
}
.m-val {
  font-size: 1rem;
  font-weight: 800;
  font-family: monospace;
  color: #ffe600;
}
.m-lbl {
  font-size: 0.65rem;
  color: #8be9fd;
  text-transform: uppercase;
}

/* Controls Guide */
.controls-guide {
  display: flex;
  justify-content: center;
  gap: 20px;
  padding-top: 6px;
  border-top: 1px solid rgba(255, 255, 255, 0.05);
  font-size: 0.8rem;
  color: #a0c4ff;
}
.guide-item kbd {
  background: rgba(0, 240, 255, 0.15);
  border: 1px solid rgba(0, 240, 255, 0.4);
  border-radius: 4px;
  padding: 2px 6px;
  font-family: monospace;
  color: #ffffff;
  font-weight: 700;
}

@keyframes pulse {
  from {
    transform: scale(1);
  }
  to {
    transform: scale(1.05);
  }
}

@media (max-width: 680px) {
  .deck-grid {
    grid-template-columns: 1fr;
  }
  .controls-guide {
    flex-direction: column;
    align-items: center;
    gap: 6px;
  }
}
</style>
