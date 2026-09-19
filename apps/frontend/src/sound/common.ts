// apps/frontend/src/sound/common.ts
//
// 全ゲーム共通の効果音。開始・自分の手番・勝敗は BaseGameState と ruleset.checkWinCondition から
// 導けるので、ゲームごとのプロファイルを書かなくてもここで鳴る。
// ゲーム側が同じキーを se に定義すれば、そのゲームだけ音を差し替えられる。
import type { BaseGameState, GameRuleset, BaseGameAction } from "@engine/shared/GameRules";
import type { SoundAssetDef, SoundContext, SoundCue } from "@/sound/types";

export const SPECTATOR_ID = "SPECTATOR";

export const CommonSound = {
  /** WAITING → PLAYING */
  GAME_START: "game_start",
  /** 自分が activePlayers に新たに入った（観戦者には鳴らない） */
  MY_TURN: "my_turn",
  /** 終局: 自分が勝者に含まれる */
  VICTORY: "victory",
  /** 終局: 勝者がいて自分は含まれない */
  DEFEAT: "defeat",
  /** 終局: 勝者なし */
  DRAW: "draw",
  /** 終局: 観戦者・リプレイ視点 */
  GAME_END: "game_end",
} as const;

export const commonSounds: Record<string, SoundAssetDef> = {
  [CommonSound.GAME_START]: { src: "/sounds/common/game_start.mp3", cooldownMs: 500 },
  [CommonSound.MY_TURN]: { src: "/sounds/common/my_turn.mp3", cooldownMs: 300 },
  [CommonSound.VICTORY]: { src: "/sounds/common/victory.mp3" },
  [CommonSound.DEFEAT]: { src: "/sounds/common/defeat.mp3" },
  [CommonSound.DRAW]: { src: "/sounds/common/draw.mp3" },
  [CommonSound.GAME_END]: { src: "/sounds/common/game_end.mp3" },
};

/**
 * 状態差分から共通イベントの効果音を導く純関数。
 * ruleset は勝者判定（checkWinCondition）に使う。省略時は終局を GAME_END として扱う。
 */
export function deriveCommonCues(
  prev: BaseGameState,
  next: BaseGameState,
  ctx: SoundContext,
  ruleset?: Pick<GameRuleset<BaseGameState, BaseGameAction>, "checkWinCondition">,
): SoundCue[] {
  const cues: SoundCue[] = [];
  const me = ctx.myPlayerId;
  const isSpectator = !me || me === SPECTATOR_ID;

  if (prev.status === "WAITING" && next.status === "PLAYING") {
    cues.push(CommonSound.GAME_START);
  }

  if (prev.status !== "FINISHED" && next.status === "FINISHED") {
    cues.push(deriveResultCue(next, ctx, ruleset));
    return cues; // 終局と同時に手番音は鳴らさない
  }

  if (!isSpectator && next.status === "PLAYING") {
    const wasMine = prev.activePlayers?.includes(me) ?? false;
    const isMine = next.activePlayers?.includes(me) ?? false;
    if (isMine && !wasMine) cues.push(CommonSound.MY_TURN);
  }

  return cues;
}

/** 終局時の音（勝ち / 負け / 引き分け / 観戦者） */
export function deriveResultCue(
  next: BaseGameState,
  ctx: SoundContext,
  ruleset?: Pick<GameRuleset<BaseGameState, BaseGameAction>, "checkWinCondition">,
): SoundCue {
  const me = ctx.myPlayerId;
  if (!me || me === SPECTATOR_ID || !ruleset) return CommonSound.GAME_END;
  let winners: string[] | undefined;
  try {
    winners = ruleset.checkWinCondition(next).winnerIds;
  } catch {
    return CommonSound.GAME_END;
  }
  if (!winners || winners.length === 0) return CommonSound.DRAW;
  return winners.includes(me) ? CommonSound.VICTORY : CommonSound.DEFEAT;
}
