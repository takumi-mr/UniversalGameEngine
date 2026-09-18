// packages/shared/rules/CyberStrikeRuleset.ts
//
// Cyber Strike: 入力予測とロールバックの検証用リアルタイム 2D アリーナ対戦。
//
// 時間の扱い（エンジンは純粋なステートマシンのまま）:
//   - 物理は 30Hz の固定ティック。ただしティックは「イベント」ではなく時間の関数として扱う
//   - START で startedAt（action.timestamp）を記録し、以後のアクションはその timestamp から
//     目標ティック = floor((timestamp - startedAt) * TICK_RATE / 1000) を求め、そこまで追いつく
//   - したがってサーバーに届くのはプレイヤーの INPUT と、無入力時のハートビート（TICK）だけでよい。
//     クライアントは同じ計算をローカル時計で行って予測し、確定状態で巻き戻して再適用する
//   - timestamp が無い TICK（テスト等）は 1 ティックだけ進める。tick を指定した TICK はそのティックまで進める
//
// CPU ボットはシミュレーションの一部（毎ティック内で決定論的に判断）。
// 1 人で開始すると cpu_bot がスロット外の相手として現れ、後から人間が着席すると入れ替わる。
import type { BaseGameState, GameRuleset, GameResult } from "@engine/shared/GameRules";
import type { IGameRNG } from "@engine/shared/utils/IGameRNG";

export interface CyberInput {
  moveX: number; // -1, 0, 1
  moveY: number; // -1, 0, 1
  dash?: boolean;
  fire?: boolean;
  aimAngle?: number; // ラジアン
}

export interface CyberPlayerEntity {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  radius: number;
  hp: number;
  maxHp: number;
  energy: number;
  maxEnergy: number;
  dashCooldown: number;
  dashRemaining: number;
  shootCooldown: number;
  shield: boolean;
  score: number;
  lastProcessedSeq?: number;
}

export interface CyberProjectile {
  id: string;
  ownerId: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  bouncesLeft: number;
  damage: number;
  lifespan: number;
}

export interface CyberObstacle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CyberPowerUp {
  id: string;
  type: "HEAL" | "SHIELD" | "ENERGY";
  x: number;
  y: number;
  radius: number;
}

export interface CyberStrikeState extends BaseGameState {
  tick: number;
  maxTicks: number;
  tickRate: number;
  /** START 時刻（epoch ms）。無ければ時刻駆動しない（TICK でだけ進む） */
  startedAt?: number;
  arenaWidth: number;
  arenaHeight: number;
  playersData: Record<string, CyberPlayerEntity>;
  /** シミュレーション内の CPU ボット（着席していない相手）の id */
  botId: string | null;
  projectiles: CyberProjectile[];
  powerUps: CyberPowerUp[];
  obstacles: CyberObstacle[];
  nextProjectileId: number;
  nextPowerUpId: number;
}

export type CyberStrikeAction =
  | {
      type: "INPUT";
      playerId: string;
      seq?: number;
      tick?: number;
      timestamp?: number;
      input: CyberInput;
    }
  | {
      /** 時刻（timestamp）または目標ティック（tick）まで進める。どちらも無ければ 1 ティック */
      type: "TICK";
      playerId?: string;
      seq?: number;
      tick?: number;
      timestamp?: number;
    }
  | { type: "START"; playerId?: string; timestamp?: number }
  | { type: "RESET"; playerId?: string; timestamp?: number }
  | { type: "JOIN"; playerId?: string; slot?: string; timestamp?: number };

export const ARENA_WIDTH = 800;
export const ARENA_HEIGHT = 500;
export const TICK_RATE = 30;
export const BOT_ID = "cpu_bot";
const PLAYER_SPEED = 4.5;
const DASH_SPEED = 12.0;
const DASH_DURATION = 8;
const DASH_COOLDOWN = 24;
const DASH_ENERGY = 30;
const SHOOT_COOLDOWN = 10;
const SHOOT_ENERGY = 20;
const PROJECTILE_SPEED = 11.0;
const MAX_TICKS = TICK_RATE * 60; // 60 秒
/** 1 回のアクションで追いつく上限。これを超えて遅れていたら開始時刻をずらして諦める */
const MAX_CATCHUP_TICKS = TICK_RATE * 3;
const BOT_DECISION_INTERVAL = 4; // ティック

const DEFAULT_OBSTACLES: CyberObstacle[] = [
  { x: 370, y: 150, width: 60, height: 60 },
  { x: 370, y: 290, width: 60, height: 60 },
  { x: 180, y: 220, width: 40, height: 60 },
  { x: 580, y: 220, width: 40, height: 60 },
];

const round1 = (v: number) => Math.round(v * 10) / 10;
const round2 = (v: number) => Math.round(v * 100) / 100;

function circleIntersectsRect(
  cx: number,
  cy: number,
  r: number,
  rx: number,
  ry: number,
  rw: number,
  rh: number,
): boolean {
  const closestX = Math.max(rx, Math.min(cx, rx + rw));
  const closestY = Math.max(ry, Math.min(cy, ry + rh));
  const dx = cx - closestX;
  const dy = cy - closestY;
  return dx * dx + dy * dy < r * r;
}

const seatedPlayers = (state: CyberStrikeState): string[] =>
  Object.values(state.players ?? {}).filter((p): p is string => typeof p === "string");

function spawnEntity(id: string, x: number, y: number, angle: number): CyberPlayerEntity {
  return {
    id,
    x,
    y,
    vx: 0,
    vy: 0,
    angle,
    radius: 18,
    hp: 100,
    maxHp: 100,
    energy: 100,
    maxEnergy: 100,
    dashCooldown: 0,
    dashRemaining: 0,
    shootCooldown: 0,
    shield: false,
    score: 0,
  };
}

/** timestamp に対応するティック番号 */
export function tickAt(state: Pick<CyberStrikeState, "startedAt" | "tickRate">, timestamp: number) {
  if (state.startedAt === undefined) return 0;
  return Math.max(0, Math.floor(((timestamp - state.startedAt) * state.tickRate) / 1000));
}

/** 試合開始状態（着席者 1 人ならボットが相手になる） */
function startMatch(state: CyberStrikeState, timestamp?: number): CyberStrikeState {
  const seated = seatedPlayers(state);
  const p1Id = seated[0];
  if (!p1Id) return state;
  const p2Id = seated[1] ?? BOT_ID;

  return {
    ...state,
    status: "PLAYING",
    message: "",
    activePlayers: seated,
    playersData: {
      [p1Id]: spawnEntity(p1Id, 120, ARENA_HEIGHT / 2, 0),
      [p2Id]: spawnEntity(p2Id, ARENA_WIDTH - 120, ARENA_HEIGHT / 2, Math.PI),
    },
    botId: seated[1] ? null : BOT_ID,
    projectiles: [],
    powerUps: [],
    tick: 0,
    startedAt: timestamp,
    nextProjectileId: 1,
    nextPowerUpId: 1,
  };
}

/** 1 人分の入力を反映する（向き・ダッシュ・移動速度・ショット）。物理はティックで進む */
function applyInput(
  state: CyberStrikeState,
  pid: string,
  input: CyberInput,
  seq?: number,
): CyberStrikeState {
  const p = state.playersData[pid];
  if (!p) return state;

  let { angle, energy, dashCooldown, dashRemaining, shootCooldown } = p;
  const projectiles = [...state.projectiles];
  let nextProjId = state.nextProjectileId;

  if (input.aimAngle !== undefined) {
    angle = input.aimAngle;
  } else if (input.moveX !== 0 || input.moveY !== 0) {
    angle = Math.atan2(input.moveY, input.moveX);
  }

  let isDashing = dashRemaining > 0;
  if (input.dash && dashCooldown <= 0 && energy >= DASH_ENERGY && !isDashing) {
    isDashing = true;
    dashRemaining = DASH_DURATION;
    dashCooldown = DASH_COOLDOWN;
    energy -= DASH_ENERGY;
  }

  const speed = isDashing ? DASH_SPEED : PLAYER_SPEED;
  let normX = input.moveX;
  let normY = input.moveY;
  const len = Math.sqrt(normX * normX + normY * normY);
  if (len > 0) {
    normX = (normX / len) * speed;
    normY = (normY / len) * speed;
  }
  const vx = round2(normX);
  const vy = round2(normY);

  if (input.fire && shootCooldown <= 0 && energy >= SHOOT_ENERGY) {
    shootCooldown = SHOOT_COOLDOWN;
    energy -= SHOOT_ENERGY;
    const spawnDist = p.radius + 8;
    projectiles.push({
      id: `proj_${nextProjId++}`,
      ownerId: pid,
      x: round1(p.x + Math.cos(angle) * spawnDist),
      y: round1(p.y + Math.sin(angle) * spawnDist),
      vx: round2(Math.cos(angle) * PROJECTILE_SPEED),
      vy: round2(Math.sin(angle) * PROJECTILE_SPEED),
      radius: 5,
      bouncesLeft: 1,
      damage: 18,
      lifespan: 90,
    });
  }

  return {
    ...state,
    playersData: {
      ...state.playersData,
      [pid]: {
        ...p,
        vx,
        vy,
        angle,
        energy,
        dashCooldown,
        dashRemaining,
        shootCooldown,
        lastProcessedSeq: seq ?? p.lastProcessedSeq,
      },
    },
    projectiles,
    nextProjectileId: nextProjId,
  };
}

/** CPU ボットの判断（決定論的。乱数は rng から、無ければティック番号から） */
function botInput(state: CyberStrikeState, botId: string, rng?: IGameRNG): CyberInput | null {
  const bot = state.playersData[botId];
  const target = Object.values(state.playersData).find((p) => p.id !== botId);
  if (!bot || !target) return null;

  const dx = target.x - bot.x;
  const dy = target.y - bot.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const aimAngle = Math.atan2(dy, dx);

  // 適正距離（180〜300px）を保ちつつ横に動く
  let moveX = 0;
  let moveY = 0;
  if (dist > 300) {
    moveX = Math.sign(dx);
    moveY = Math.sign(dy);
  } else if (dist < 180) {
    moveX = -Math.sign(dx);
    moveY = -Math.sign(dy);
  } else {
    moveX = dy > 0 ? -1 : 1;
    moveY = dx > 0 ? 1 : -1;
  }

  const r1 = rng ? rng.nextFloat() : ((state.tick * 7919) % 100) / 100;
  const r2 = rng ? rng.nextFloat() : ((state.tick * 104729) % 100) / 100;
  const fire = r1 < 0.35 && bot.energy >= SHOOT_ENERGY;
  const dash = r2 < 0.1 && bot.energy >= DASH_ENERGY;
  return { moveX, moveY, dash, fire, aimAngle };
}

/** 物理を 1 ティック進める（移動・弾・パワーアップ・ボット） */
function stepTick(state: CyberStrikeState, rng?: IGameRNG): CyberStrikeState {
  const nextTick = state.tick + 1;

  // 0. ボットの判断（プレイヤーの INPUT と同じ経路で反映する）
  if (state.botId && nextTick % BOT_DECISION_INTERVAL === 0) {
    const input = botInput(state, state.botId, rng);
    if (input) state = applyInput(state, state.botId, input);
  }

  const obstacles = state.obstacles;
  const updatedPlayers: Record<string, CyberPlayerEntity> = {};

  // 1. 各プレイヤーの位置更新とアリーナ / 障害物との衝突。
  //    速度は入力で決まる（次の INPUT まで保持）ので、ぶつかっても速度は消さず位置だけ止める。
  //    軸ごとに判定するので、障害物に沿って滑れる
  const blocked = (cx: number, cy: number, r: number) =>
    obstacles.some((o) => circleIntersectsRect(cx, cy, r, o.x, o.y, o.width, o.height));
  for (const [id, p] of Object.entries(state.playersData)) {
    const { x, y, maxEnergy, vx, vy } = p;
    let { energy, dashCooldown, dashRemaining, shootCooldown } = p;

    let newX = Math.min(state.arenaWidth - p.radius, Math.max(p.radius, x + vx));
    if (blocked(newX, y, p.radius)) newX = x;
    let newY = Math.min(state.arenaHeight - p.radius, Math.max(p.radius, y + vy));
    if (blocked(newX, newY, p.radius)) newY = y;

    if (dashRemaining > 0) dashRemaining--;
    if (dashCooldown > 0) dashCooldown--;
    if (shootCooldown > 0) shootCooldown--;
    if (energy < maxEnergy) energy = Math.min(maxEnergy, round1(energy + 0.6));

    updatedPlayers[id] = {
      ...p,
      x: round1(newX),
      y: round1(newY),
      energy,
      dashRemaining,
      dashCooldown,
      shootCooldown,
    };
  }

  // 2. 弾の移動・反射・命中
  const survivingProjectiles: CyberProjectile[] = [];
  for (const proj of state.projectiles) {
    const { x, y } = proj;
    let { vx, vy, bouncesLeft, lifespan } = proj;
    lifespan--;
    if (lifespan <= 0) continue;

    let nextX = x + vx;
    let nextY = y + vy;
    let bounced = false;

    if (nextX - proj.radius <= 0 || nextX + proj.radius >= state.arenaWidth) {
      if (bouncesLeft <= 0) continue;
      vx = -vx;
      nextX = x + vx;
      bouncesLeft--;
      bounced = true;
    }
    if (nextY - proj.radius <= 0 || nextY + proj.radius >= state.arenaHeight) {
      if (bouncesLeft <= 0) continue;
      vy = -vy;
      nextY = y + vy;
      bouncesLeft--;
      bounced = true;
    }

    for (const obs of obstacles) {
      if (circleIntersectsRect(nextX, nextY, proj.radius, obs.x, obs.y, obs.width, obs.height)) {
        if (bouncesLeft > 0 && !bounced) {
          vx = -vx;
          vy = -vy;
          nextX = x + vx;
          nextY = y + vy;
          bouncesLeft--;
          bounced = true;
        } else {
          bouncesLeft = -1;
        }
        break;
      }
    }
    if (bouncesLeft < 0) continue;

    let hitPlayerId: string | null = null;
    for (const [pId, p] of Object.entries(updatedPlayers)) {
      if (pId === proj.ownerId && lifespan > 80) continue; // 発射直後は自機に当たらない
      const dx = nextX - p.x;
      const dy = nextY - p.y;
      const hitDist = p.radius + proj.radius;
      if (dx * dx + dy * dy < hitDist * hitDist) {
        if (p.dashRemaining <= 0) hitPlayerId = pId; // ダッシュ中は無敵
        break;
      }
    }

    if (hitPlayerId) {
      const target = updatedPlayers[hitPlayerId];
      if (target.shield) {
        target.shield = false;
      } else {
        target.hp = Math.max(0, target.hp - proj.damage);
        target.x = round1(target.x + vx * 0.8);
        target.y = round1(target.y + vy * 0.8);
      }
      const shooter = updatedPlayers[proj.ownerId];
      if (shooter) shooter.score += 10;
      continue;
    }

    survivingProjectiles.push({
      ...proj,
      x: round1(nextX),
      y: round1(nextY),
      vx,
      vy,
      bouncesLeft,
      lifespan,
    });
  }

  // 3. パワーアップの出現（約 10 秒ごと、最大 2 個）と取得
  let powerUps = [...state.powerUps];
  let nextPowerUpId = state.nextPowerUpId;
  if (nextTick % 300 === 0 && powerUps.length < 2 && rng) {
    const types: CyberPowerUp["type"][] = ["HEAL", "SHIELD", "ENERGY"];
    powerUps.push({
      id: `pu_${nextPowerUpId++}`,
      type: types[rng.nextInt(0, types.length - 1)] ?? "HEAL",
      x: rng.nextInt(100, state.arenaWidth - 100),
      y: rng.nextInt(80, state.arenaHeight - 80),
      radius: 12,
    });
  }
  powerUps = powerUps.filter((pu) => {
    for (const p of Object.values(updatedPlayers)) {
      const dx = p.x - pu.x;
      const dy = p.y - pu.y;
      const reach = p.radius + pu.radius;
      if (dx * dx + dy * dy < reach * reach) {
        if (pu.type === "HEAL") p.hp = Math.min(p.maxHp, p.hp + 25);
        else if (pu.type === "SHIELD") p.shield = true;
        else p.energy = p.maxEnergy;
        p.score += 5;
        return false;
      }
    }
    return true;
  });

  return {
    ...state,
    tick: nextTick,
    playersData: updatedPlayers,
    projectiles: survivingProjectiles,
    powerUps,
    nextPowerUpId,
  };
}

const someoneDown = (state: CyberStrikeState) =>
  Object.values(state.playersData).some((p) => p.hp <= 0);

/** targetTick まで物理を進める（決着したらそこで止まる。遅れすぎていれば開始時刻をずらす） */
export function advanceTo(
  state: CyberStrikeState,
  targetTick: number,
  rng?: IGameRNG,
): CyberStrikeState {
  const behind = targetTick - state.tick;
  if (behind <= 0) return state;

  let steps = behind;
  if (behind > MAX_CATCHUP_TICKS) {
    steps = MAX_CATCHUP_TICKS;
    if (state.startedAt !== undefined) {
      const skipped = behind - steps;
      state = { ...state, startedAt: state.startedAt + (skipped * 1000) / state.tickRate };
    }
  }
  for (let i = 0; i < steps; i++) {
    if (someoneDown(state) || state.tick >= state.maxTicks) break;
    state = stepTick(state, rng);
  }
  return state;
}

/**
 * action.timestamp があれば、その時刻まで物理を追いつかせる。
 * START に時刻が無かった場合は、最初の時刻付きアクションの時刻を「現在のティックの時刻」として採用する
 */
function catchUp(state: CyberStrikeState, timestamp: number | undefined, rng?: IGameRNG) {
  if (timestamp === undefined) return state;
  if (state.startedAt === undefined) {
    return { ...state, startedAt: timestamp - (state.tick * 1000) / state.tickRate };
  }
  return advanceTo(state, tickAt(state, timestamp), rng);
}

export const CyberStrikeRuleset: GameRuleset<CyberStrikeState, CyberStrikeAction> = {
  getInitialState: (_options?: unknown, _rng?: IGameRNG): CyberStrikeState => ({
    status: "WAITING",
    players: { "0": null, "1": null },
    activePlayers: [],
    tick: 0,
    maxTicks: MAX_TICKS,
    tickRate: TICK_RATE,
    arenaWidth: ARENA_WIDTH,
    arenaHeight: ARENA_HEIGHT,
    playersData: {},
    botId: null,
    projectiles: [],
    powerUps: [],
    obstacles: DEFAULT_OBSTACLES,
    nextProjectileId: 1,
    nextPowerUpId: 1,
  }),

  isValidAction: (state, action) => {
    const seated = seatedPlayers(state);
    switch (action.type) {
      case "START":
        return state.status === "WAITING" && seated.length >= 1;
      case "JOIN":
        // 進行中の飛び入り（エンジンが着席させた後に呼ばれる）: ボットと入れ替わる
        return (
          state.status === "PLAYING" &&
          !!action.playerId &&
          seated.includes(action.playerId) &&
          !state.playersData[action.playerId]
        );
      case "RESET":
        return state.status !== "WAITING" && !!action.playerId && seated.includes(action.playerId);
      case "INPUT":
        return (
          state.status === "PLAYING" &&
          seated.includes(action.playerId) &&
          !!state.playersData[action.playerId]
        );
      case "TICK":
        return state.status === "PLAYING";
      default:
        return false;
    }
  },

  reduce: (state, action, rng?: IGameRNG): CyberStrikeState => {
    switch (action.type) {
      case "START":
      case "RESET":
        return startMatch(state, action.timestamp);

      case "JOIN": {
        // 着席済みの新入りがボットの席を引き継ぐ（位置はボットのまま、HP は満タン）
        const pid = action.playerId!;
        const bot = state.botId ? state.playersData[state.botId] : undefined;
        const playersData = { ...state.playersData };
        if (state.botId) delete playersData[state.botId];
        playersData[pid] = spawnEntity(
          pid,
          bot?.x ?? ARENA_WIDTH - 120,
          bot?.y ?? ARENA_HEIGHT / 2,
          Math.PI,
        );
        return {
          ...state,
          playersData,
          botId: null,
          activePlayers: seatedPlayers(state),
        };
      }

      case "INPUT": {
        const advanced = catchUp(state, action.timestamp, rng);
        if (advanced.status !== "PLAYING" || someoneDown(advanced)) return advanced;
        return applyInput(advanced, action.playerId, action.input, action.seq);
      }

      case "TICK": {
        if (action.tick !== undefined) return advanceTo(state, action.tick, rng);
        if (action.timestamp !== undefined) return catchUp(state, action.timestamp, rng);
        return advanceTo(state, state.tick + 1, rng);
      }

      default:
        return state;
    }
  },

  checkWinCondition: (state): GameResult => {
    if (state.status !== "PLAYING") return { isFinished: false };
    const players = Object.values(state.playersData);
    if (players.length < 2) return { isFinished: false };
    const [p1, p2] = players;

    if (p1.hp <= 0 && p2.hp <= 0) {
      return { isFinished: true, winnerIds: [], message: "Draw! Both players eliminated." };
    }
    if (p1.hp <= 0) {
      return { isFinished: true, winnerIds: [p2.id], message: `${p2.id} wins by elimination!` };
    }
    if (p2.hp <= 0) {
      return { isFinished: true, winnerIds: [p1.id], message: `${p1.id} wins by elimination!` };
    }
    if (state.tick >= state.maxTicks) {
      if (p1.hp > p2.hp) {
        return {
          isFinished: true,
          winnerIds: [p1.id],
          message: `${p1.id} wins on health (${p1.hp} vs ${p2.hp})!`,
        };
      }
      if (p2.hp > p1.hp) {
        return {
          isFinished: true,
          winnerIds: [p2.id],
          message: `${p2.id} wins on health (${p2.hp} vs ${p1.hp})!`,
        };
      }
      return { isFinished: true, winnerIds: [], message: "Draw! Time expired with equal health." };
    }
    return { isFinished: false };
  },

  getLegalActions: (state, playerId) => {
    if (state.status !== "PLAYING") return [];
    const p = state.playersData[playerId];
    if (!p || !seatedPlayers(state).includes(playerId)) return [];

    const actions: CyberStrikeAction[] = [
      { type: "INPUT", playerId, input: { moveX: 0, moveY: 0 } },
      { type: "INPUT", playerId, input: { moveX: 1, moveY: 0 } },
      { type: "INPUT", playerId, input: { moveX: -1, moveY: 0 } },
      { type: "INPUT", playerId, input: { moveX: 0, moveY: 1 } },
      { type: "INPUT", playerId, input: { moveX: 0, moveY: -1 } },
      { type: "INPUT", playerId, input: { moveX: 0, moveY: 0, fire: true } },
    ];
    if (p.energy >= DASH_ENERGY && p.dashCooldown <= 0) {
      actions.push({ type: "INPUT", playerId, input: { moveX: 1, moveY: 0, dash: true } });
    }
    return actions;
  },
};
