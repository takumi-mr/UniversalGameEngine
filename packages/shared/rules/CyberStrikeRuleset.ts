import type { BaseGameState, GameRuleset, GameResult } from "../GameRules";
import type { IGameRNG } from "../utils/IGameRNG";
import { requireRng } from "../utils/requireRng";

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
  arenaWidth: number;
  arenaHeight: number;
  playersData: Record<string, CyberPlayerEntity>;
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
      input: CyberInput;
    }
  | {
      type: "TICK";
      playerId?: string;
      seq?: number;
      tick?: number;
      dt?: number;
    }
  | {
      type: "START";
      playerId?: string;
    }
  | {
      type: "RESET";
      playerId?: string;
    };

const ARENA_WIDTH = 800;
const ARENA_HEIGHT = 500;
const PLAYER_SPEED = 4.5;
const DASH_SPEED = 12.0;
const DASH_DURATION = 8;
const DASH_COOLDOWN = 24;
const DASH_ENERGY = 30;
const SHOOT_COOLDOWN = 10;
const SHOOT_ENERGY = 20;
const PROJECTILE_SPEED = 11.0;
const MAX_TICKS = 1800; // 30Hz * 60秒 = 1800 ticks

const DEFAULT_OBSTACLES: CyberObstacle[] = [
  { x: 370, y: 150, width: 60, height: 60 },
  { x: 370, y: 290, width: 60, height: 60 },
  { x: 180, y: 220, width: 40, height: 60 },
  { x: 580, y: 220, width: 40, height: 60 },
];

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

export const CyberStrikeRuleset: GameRuleset<CyberStrikeState, CyberStrikeAction> = {
  getInitialState: (_options?: unknown, _rng?: IGameRNG): CyberStrikeState => {
    return {
      status: "WAITING",
      players: { "0": null, "1": null },
      activePlayers: [],
      version: 0,
      tick: 0,
      maxTicks: MAX_TICKS,
      arenaWidth: ARENA_WIDTH,
      arenaHeight: ARENA_HEIGHT,
      playersData: {},
      projectiles: [],
      powerUps: [],
      obstacles: DEFAULT_OBSTACLES,
      nextProjectileId: 1,
      nextPowerUpId: 1,
    };
  },

  isValidAction: (state, action) => {
    if (action.type === "START") {
      const seated = Object.values(state.players ?? {}).filter(Boolean);
      return state.status === "WAITING" && seated.length >= 1;
    }
    if (action.type === "RESET") {
      return true;
    }
    if (state.status !== "PLAYING") {
      return false;
    }
    if (action.type === "INPUT") {
      if (!action.playerId) return false;
      const seatedPlayers = Object.values(state.players ?? {}).filter(Boolean);
      return seatedPlayers.includes(action.playerId);
    }
    if (action.type === "TICK") {
      return true;
    }
    return false;
  },

  reduce: (state, action, rng?: IGameRNG): CyberStrikeState => {
    if (action.type === "RESET") {
      return CyberStrikeRuleset.getInitialState(undefined, rng);
    }

    if (action.type === "START") {
      const seated = Object.values(state.players ?? {}).filter(Boolean) as string[];
      const p1Id = seated[0] ?? "player1";
      const p2Id = seated[1] ?? (seated.length === 1 ? "cpu_bot" : "player2");

      const playersData: Record<string, CyberPlayerEntity> = {
        [p1Id]: {
          id: p1Id,
          x: 120,
          y: ARENA_HEIGHT / 2,
          vx: 0,
          vy: 0,
          angle: 0,
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
        },
        [p2Id]: {
          id: p2Id,
          x: ARENA_WIDTH - 120,
          y: ARENA_HEIGHT / 2,
          vx: 0,
          vy: 0,
          angle: Math.PI,
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
        },
      };

      const playersSlot: Record<string, string | null> = {
        "0": p1Id,
        "1": p2Id,
      };

      return {
        ...state,
        status: "PLAYING",
        players: playersSlot,
        activePlayers: [p1Id, p2Id],
        playersData,
        projectiles: [],
        powerUps: [],
        tick: 0,
      };
    }

    if (action.type === "INPUT") {
      const pid = action.playerId;
      const p = state.playersData[pid];
      if (!p) return state;

      const { input, seq } = action;
      const { x, y } = p;
      let { vx, vy, angle, energy, dashCooldown, dashRemaining, shootCooldown } = p;
      const projectiles = [...state.projectiles];
      let nextProjId = state.nextProjectileId;

      // 向きの更新
      if (input.aimAngle !== undefined) {
        angle = input.aimAngle;
      } else if (input.moveX !== 0 || input.moveY !== 0) {
        angle = Math.atan2(input.moveY, input.moveX);
      }

      // ダッシュ判定
      let isDashing = dashRemaining > 0;
      if (input.dash && dashCooldown <= 0 && energy >= DASH_ENERGY && !isDashing) {
        isDashing = true;
        dashRemaining = DASH_DURATION;
        dashCooldown = DASH_COOLDOWN;
        energy -= DASH_ENERGY;
      }

      // 移動入力の適用
      const currentSpeed = isDashing ? DASH_SPEED : PLAYER_SPEED;
      let normX = input.moveX;
      let normY = input.moveY;
      const len = Math.sqrt(normX * normX + normY * normY);
      if (len > 0) {
        normX = (normX / len) * currentSpeed;
        normY = (normY / len) * currentSpeed;
      }
      vx = Math.round(normX * 100) / 100;
      vy = Math.round(normY * 100) / 100;

      // ショット判定
      if (input.fire && shootCooldown <= 0 && energy >= SHOOT_ENERGY) {
        shootCooldown = SHOOT_COOLDOWN;
        energy -= SHOOT_ENERGY;

        const pSpeed = PROJECTILE_SPEED;
        const fireAngle = angle;
        const spawnDist = p.radius + 8;
        const projX = Math.round((x + Math.cos(fireAngle) * spawnDist) * 10) / 10;
        const projY = Math.round((y + Math.sin(fireAngle) * spawnDist) * 10) / 10;

        projectiles.push({
          id: `proj_${nextProjId++}`,
          ownerId: pid,
          x: projX,
          y: projY,
          vx: Math.round(Math.cos(fireAngle) * pSpeed * 100) / 100,
          vy: Math.round(Math.sin(fireAngle) * pSpeed * 100) / 100,
          radius: 5,
          bouncesLeft: 1,
          damage: 18,
          lifespan: 90,
        });
      }

      const updatedPlayer: CyberPlayerEntity = {
        ...p,
        vx,
        vy,
        angle,
        energy,
        dashCooldown,
        dashRemaining,
        shootCooldown,
        lastProcessedSeq: seq ?? p.lastProcessedSeq,
      };

      return {
        ...state,
        playersData: {
          ...state.playersData,
          [pid]: updatedPlayer,
        },
        projectiles,
        nextProjectileId: nextProjId,
      };
    }

    if (action.type === "TICK") {
      const nextTick = state.tick + 1;
      const updatedPlayers: Record<string, CyberPlayerEntity> = {};
      const obstacles = state.obstacles;

      // 1. 各プレイヤーの位置更新とアリーナ/障害物衝突判定
      for (const [id, p] of Object.entries(state.playersData)) {
        const { x, y, maxEnergy, shield } = p;
        let { vx, vy, energy, dashCooldown, dashRemaining, shootCooldown } = p;

        // 位置の更新
        let newX = x + vx;
        let newY = y + vy;

        // アリーナ境界との衝突判定
        if (newX - p.radius < 0) {
          newX = p.radius;
          vx = 0;
        } else if (newX + p.radius > state.arenaWidth) {
          newX = state.arenaWidth - p.radius;
          vx = 0;
        }
        if (newY - p.radius < 0) {
          newY = p.radius;
          vy = 0;
        } else if (newY + p.radius > state.arenaHeight) {
          newY = state.arenaHeight - p.radius;
          vy = 0;
        }

        // 障害物との衝突判定
        for (const obs of obstacles) {
          if (circleIntersectsRect(newX, newY, p.radius, obs.x, obs.y, obs.width, obs.height)) {
            // 単純な押し戻し
            newX = x;
            newY = y;
            vx = 0;
            vy = 0;
            break;
          }
        }

        // クールダウンとエナジー回復
        if (dashRemaining > 0) dashRemaining--;
        if (dashCooldown > 0) dashCooldown--;
        if (shootCooldown > 0) shootCooldown--;
        if (energy < maxEnergy) {
          energy = Math.min(maxEnergy, Math.round((energy + 0.6) * 10) / 10);
        }

        updatedPlayers[id] = {
          ...p,
          x: Math.round(newX * 10) / 10,
          y: Math.round(newY * 10) / 10,
          vx,
          vy,
          energy,
          dashRemaining,
          dashCooldown,
          shootCooldown,
          shield,
        };
      }

      // 2. 弾の移動・反射・被弾判定
      const survivingProjectiles: CyberProjectile[] = [];
      for (const proj of state.projectiles) {
        const { x, y } = proj;
        let { vx, vy, bouncesLeft, lifespan } = proj;
        lifespan--;
        if (lifespan <= 0) continue;

        let nextX = x + vx;
        let nextY = y + vy;
        let bounced = false;

        // 壁反射
        if (nextX - proj.radius <= 0 || nextX + proj.radius >= state.arenaWidth) {
          if (bouncesLeft > 0) {
            vx = -vx;
            nextX = x + vx;
            bouncesLeft--;
            bounced = true;
          } else {
            continue; // 消失
          }
        }
        if (nextY - proj.radius <= 0 || nextY + proj.radius >= state.arenaHeight) {
          if (bouncesLeft > 0) {
            vy = -vy;
            nextY = y + vy;
            bouncesLeft--;
            bounced = true;
          } else {
            continue; // 消失
          }
        }

        // 障害物との反射
        for (const obs of obstacles) {
          if (
            circleIntersectsRect(nextX, nextY, proj.radius, obs.x, obs.y, obs.width, obs.height)
          ) {
            if (bouncesLeft > 0 && !bounced) {
              vx = -vx;
              vy = -vy;
              nextX = x + vx;
              nextY = y + vy;
              bouncesLeft--;
              bounced = true;
            } else {
              bouncesLeft = -1; // 消失フラグ
            }
            break;
          }
        }
        if (bouncesLeft < 0) continue;

        // プレイヤーへの命中判定
        let hitPlayerId: string | null = null;
        for (const [pId, p] of Object.entries(updatedPlayers)) {
          if (pId === proj.ownerId && lifespan > 80) {
            // 発射直後は自機に当たらない
            continue;
          }
          const dx = nextX - p.x;
          const dy = nextY - p.y;
          const distSq = dx * dx + dy * dy;
          const hitDist = p.radius + proj.radius;
          if (distSq < hitDist * hitDist) {
            // ダッシュ無敵時間中はダメージ無効
            if (p.dashRemaining <= 0) {
              hitPlayerId = pId;
            }
            break;
          }
        }

        if (hitPlayerId) {
          const target = updatedPlayers[hitPlayerId];
          if (target.shield) {
            target.shield = false;
          } else {
            target.hp = Math.max(0, target.hp - proj.damage);
            // ノックバック効果
            target.x += Math.round(vx * 0.8 * 10) / 10;
            target.y += Math.round(vy * 0.8 * 10) / 10;
          }
          // 発射元のスコア加算
          const shooter = updatedPlayers[proj.ownerId];
          if (shooter) {
            shooter.score += 10;
          }
          // 弾は消滅
          continue;
        }

        survivingProjectiles.push({
          ...proj,
          x: Math.round(nextX * 10) / 10,
          y: Math.round(nextY * 10) / 10,
          vx,
          vy,
          bouncesLeft,
          lifespan,
        });
      }

      // 3. パワーアップアイテムの出現と取得判定
      let powerUps = [...state.powerUps];
      let nextPowerUpId = state.nextPowerUpId;

      // 300 tick (約10秒) ごとに新しいパワーアップをランダム生成 (最大2個まで)
      if (nextTick % 300 === 0 && powerUps.length < 2 && rng) {
        const gameRng = requireRng(rng);
        const randX = gameRng.nextInt(100, state.arenaWidth - 100);
        const randY = gameRng.nextInt(80, state.arenaHeight - 80);
        const types: ("HEAL" | "SHIELD" | "ENERGY")[] = ["HEAL", "SHIELD", "ENERGY"];
        const pType = types[gameRng.nextInt(0, types.length - 1)] ?? "HEAL";

        powerUps.push({
          id: `pu_${nextPowerUpId++}`,
          type: pType,
          x: randX,
          y: randY,
          radius: 12,
        });
      }

      // 取得判定
      powerUps = powerUps.filter((pu) => {
        for (const p of Object.values(updatedPlayers)) {
          const dx = p.x - pu.x;
          const dy = p.y - pu.y;
          if (dx * dx + dy * dy < (p.radius + pu.radius) * (p.radius + pu.radius)) {
            if (pu.type === "HEAL") {
              p.hp = Math.min(p.maxHp, p.hp + 25);
            } else if (pu.type === "SHIELD") {
              p.shield = true;
            } else if (pu.type === "ENERGY") {
              p.energy = p.maxEnergy;
            }
            p.score += 5;
            return false; // 取得されたので削除
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

    return state;
  },

  checkWinCondition: (state): GameResult => {
    if (state.status !== "PLAYING") {
      return { isFinished: false };
    }

    const players = Object.values(state.playersData);
    if (players.length < 2) {
      return { isFinished: false };
    }

    const p1 = players[0];
    const p2 = players[1];

    if (p1.hp <= 0 && p2.hp <= 0) {
      return {
        isFinished: true,
        winnerIds: [],
        message: "Draw! Both players eliminated simultaneously.",
      };
    }
    if (p1.hp <= 0) {
      return {
        isFinished: true,
        winnerIds: [p2.id],
        message: `${p2.id} wins by eliminating opponent!`,
      };
    }
    if (p2.hp <= 0) {
      return {
        isFinished: true,
        winnerIds: [p1.id],
        message: `${p1.id} wins by eliminating opponent!`,
      };
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
      return {
        isFinished: true,
        winnerIds: [],
        message: "Draw! Time expired with equal health.",
      };
    }

    return { isFinished: false };
  },

  getLegalActions: (state, playerId) => {
    if (state.status !== "PLAYING") {
      return [{ type: "START", playerId }];
    }
    const p = state.playersData[playerId];
    if (!p) return [];

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
