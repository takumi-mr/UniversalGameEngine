// packages/shared/rules/mahjong/MahjongRuleset.ts
//
// リーチ麻雀の 1 局。東風戦・半荘戦としての局の連なりは MahjongMatchRuleset が担当する。
//
// 進行:
//   START → 配牌し、親が第一自摸を引いた状態で親の手番（自摸は自動。DRAW アクションは無い）
//   手番（phase=PLAYING）: DISCARD / RIICHI / TSUMO / ANKAN / KAKAN / KYUUSHU_KYUUHAI
//   打牌後（phase=INTERRUPTING）: 鳴き・ロンができるプレイヤーだけが activePlayers になり、
//     CALL(CHI/PON/KAN) / RON / PASS を返す。誰も何もできなければ即座に次の手番へ進む。
//   加槓後は搶槓の窓（pendingKan）を開く。
//
// 実装しているルール:
//   役の無い和了は不可 / 場風・自風・親の点数 / 本場・供託 / ドラ・赤ドラ・裏ドラ・槓ドラ /
//   立直（聴牌・門前・1000 点・残り 4 枚以上）・ダブル立直・一発・立直後は自摸切り /
//   フリテン（捨て牌・同巡見逃し・立直後見逃し） / 喰い替え禁止 / 大明槓・暗槓・加槓・嶺上開花・搶槓 /
//   海底摸月・河底撈魚・天和・地和 / ダブロン（供託は頭ハネ）・三家和は流局 /
//   荒牌流局のノーテン罰符と連荘 / 途中流局（九種九牌・四風連打・四家立直・四開槓）
import { requireRng } from "@engine/shared/utils/requireRng";
import { createSecret, type Secret } from "@engine/shared/GameRules";
import type { BaseGameState, BaseGameAction, GameRuleset } from "@engine/shared/GameRules";
import type { IGameRNG } from "@engine/shared/utils/IGameRNG";
import {
  MahjongHandEvaluator,
  type EvaluatedHand,
  type WinContext,
  type WindNumber,
} from "@engine/shared/rules/mahjong/MahjongHandEvaluator";
import {
  countTile,
  distinctTerminalHonorCount,
  isCompleteHand,
  isHonor,
  isSameTile,
  isSequence,
  normalizeTile,
  removeTiles,
  sortTiles,
  tileNumber,
  tileSuit,
  waitingTiles,
  type Tile,
} from "@engine/shared/rules/mahjong/MahjongTiles";

export type { Tile } from "@engine/shared/rules/mahjong/MahjongTiles";

// --- Types & Interfaces ---

export type MeldType = "CHI" | "PON" | "DAIMINKAN" | "ANKAN" | "KAKAN";

/** 副露（鳴き）の情報 */
export interface Meld {
  type: MeldType;
  /** 鳴いた牌（暗槓では手牌から出した 1 枚目、加槓では元のポンで鳴いた牌） */
  tile: Tile;
  /** 手牌から出した牌（暗槓は 4 枚、加槓はポンの 2 枚 + 加えた 1 枚） */
  consumed: Tile[];
  /** 鳴いた相手（暗槓には無い） */
  from?: string;
}

export type Wind = "EAST" | "SOUTH" | "WEST" | "NORTH";
export const WINDS: Wind[] = ["EAST", "SOUTH", "WEST", "NORTH"];

export interface MahjongWinner {
  playerId: string;
  /** 放銃者（自摸なら undefined） */
  from?: string;
  isTsumo: boolean;
  winTile: Tile;
  han: number;
  fu: number;
  yakuman: number;
  ten: number; // 本場・供託を含まない基本点
  yaku: Record<string, string>;
  text: string;
}

/** 局の結果 */
export interface MahjongHandResult {
  type: "WIN" | "EXHAUSTIVE_DRAW" | "ABORTIVE_DRAW";
  reason?: string;
  winners: MahjongWinner[];
  /** 荒牌流局時の聴牌者 */
  tenpai: string[];
  scoreDeltas: Record<string, number>;
  /** 連荘（親が続投）か */
  renchan: boolean;
}

interface PendingResponse {
  playerId: string;
  action: MahjongAction;
}

/** 麻雀のゲーム状態 */
export interface MahjongState extends BaseGameState {
  phase: "WAITING" | "PLAYING" | "INTERRUPTING" | "FINISHED";
  playerIds: string[]; // 席順（players のスロット順）
  wind: Wind; // 場風
  round: number; // 局（東1局 = 1）
  dealerIndex: number; // 親の席（playerIds のインデックス）
  honba: number;
  riichiSticks: number; // 供託（持ち越し分を含む）

  wall: Secret<Tile[]>; // 山牌（末尾から自摸る）
  /**
   * 王牌。[0..3] 嶺上牌、[4..8] ドラ表示牌、[9..13] 裏ドラ表示牌。位置は固定で、嶺上牌は
   * rinshanDrawn 枚目まで自摸済み（配列からは取り除かない）。槓のたびに山の先頭（海底牌）が末尾へ移される
   */
  deadWall: Secret<Tile[]>;
  doraIndicators: Tile[]; // 公開済みのドラ表示牌
  uraDoraIndicators: Tile[]; // 立直者の和了時に公開
  rinshanDrawn: number;
  kanCount: number;
  pendingDoraReveals: number; // 大明槓・加槓の後、打牌時にめくる槓ドラの数

  hands: Record<string, Secret<Tile[]>>; // 手牌。自摸牌は末尾
  discards: Record<string, Tile[]>; // 河（鳴かれた牌も残す）
  melds: Record<string, Meld[]>;

  turnIndex: number; // 手番（playerIds のインデックス）
  scores: Record<string, number>;
  riichi: Record<string, boolean>;
  doubleRiichi: Record<string, boolean>;
  ippatsu: Record<string, boolean>;
  /** 見逃しによるフリテン（立直中は局の終わりまで、それ以外は次の自摸まで） */
  furiten: Record<string, boolean>;
  akaDora: boolean;

  /** まだ誰も鳴いていない（九種九牌・四風連打・天和・地和・ダブル立直の条件） */
  uninterrupted: boolean;
  /** 手番プレイヤーの直前の自摸が嶺上牌か（嶺上開花） */
  afterKan: boolean;
  /** 鳴いた直後の打牌で禁止される牌（喰い替え、正規化済み） */
  kuikaeForbidden: Tile[];

  /** 打牌に対する鳴き・ロン待ち */
  pendingDiscard?: {
    playerId: string;
    tile: Tile;
    riichi: boolean; // 立直宣言牌か（ロンされたら立直不成立）
    pendingActions: PendingResponse[];
  };
  /** 加槓に対する搶槓待ち */
  pendingKan?: {
    playerId: string;
    tile: Tile;
    pendingActions: PendingResponse[];
  };

  result?: MahjongHandResult;
}

/** 麻雀のコマンドアクション */
export interface MahjongAction extends BaseGameAction {
  type:
    | "START"
    | "DISCARD"
    | "RIICHI"
    | "TSUMO"
    | "ANKAN"
    | "KAKAN"
    | "KYUUSHU_KYUUHAI"
    | "CALL"
    | "RON"
    | "PASS";
  tile?: Tile; // DISCARD / RIICHI: 捨てる牌、ANKAN / KAKAN: 槓する牌
  meldType?: "CHI" | "PON" | "KAN"; // CALL の種類（KAN は大明槓）
  consumed?: Tile[]; // CALL で手牌から出す牌（PON / KAN は省略可）
}

export interface MahjongOptions {
  // エンジンのシード（serverSeed / clientSeed）などもこのオブジェクトで渡される
  [key: string]: unknown;
  playerIds?: string[];
  wind?: Wind;
  round?: number;
  dealerIndex?: number;
  honba?: number;
  riichiSticks?: number;
  initialScores?: Record<string, number>;
  akaDora?: boolean;
}

// --- Constants & Helpers ---

const INITIAL_SCORE = 25_000;
const DEAD_WALL_SIZE = 14;
const DORA_INDICATOR_OFFSET = 4;
const URA_DORA_OFFSET = 9;
const MAX_KANS = 4;
const RIICHI_DEPOSIT = 1_000;
const HONBA_BONUS = 300;
const NOTEN_PENALTY_TOTAL = 3_000;
const MIN_WALL_FOR_RIICHI = 4;
const CLAIM_TIMEOUT_MS = 10_000;

/** 山牌の生成（赤五は各色 1 枚） */
function createWall(rng: IGameRNG | undefined, akaDora: boolean): Tile[] {
  const wall: Tile[] = [];
  for (let copy = 0; copy < 4; copy++) {
    for (const suit of ["m", "p", "s"]) {
      for (let n = 1; n <= 9; n++) {
        wall.push(akaDora && copy === 0 && n === 5 ? `0${suit}` : `${n}${suit}`);
      }
    }
    for (let n = 1; n <= 7; n++) wall.push(`${n}z`);
  }
  const random = requireRng(rng);
  for (let i = wall.length - 1; i > 0; i--) {
    const j = random.nextInt(0, i);
    [wall[i], wall[j]] = [wall[j]!, wall[i]!];
  }
  return wall;
}

function secretTiles(tiles: Tile[], visibleTo: string[]): Secret<Tile[]> {
  return createSecret(tiles, visibleTo, Array(tiles.length).fill("?"));
}

function handOf(state: MahjongState, playerId: string): Tile[] {
  return state.hands[playerId]?.value ?? [];
}

function meldsOf(state: MahjongState, playerId: string): Meld[] {
  return state.melds[playerId] ?? [];
}

/** 副露を除いた手牌の枚数（自摸前） */
function concealedHandSize(state: MahjongState, playerId: string): number {
  return 13 - meldsOf(state, playerId).length * 3;
}

function isMenzen(melds: Meld[]): boolean {
  return melds.every((meld) => meld.type === "ANKAN");
}

function dealerId(state: MahjongState): string {
  return state.playerIds[state.dealerIndex]!;
}

function seatWind(state: MahjongState, playerId: string): WindNumber {
  const index = state.playerIds.indexOf(playerId);
  return (((((index - state.dealerIndex) % 4) + 4) % 4) + 1) as WindNumber;
}

function roundWind(state: MahjongState): WindNumber {
  return (WINDS.indexOf(state.wind) + 1) as WindNumber;
}

function nextIndex(state: MahjongState, index: number): number {
  return (index + 1) % state.playerIds.length;
}

/** 指定プレイヤーから見た手番順（頭ハネの順序） */
function turnOrderFrom(state: MahjongState, playerId: string): string[] {
  const start = state.playerIds.indexOf(playerId);
  const ordered: string[] = [];
  for (let step = 1; step < state.playerIds.length; step++) {
    ordered.push(state.playerIds[(start + step) % state.playerIds.length]!);
  }
  return ordered;
}

function isPlayersTurn(state: MahjongState, playerId: string): boolean {
  return state.phase === "PLAYING" && state.activePlayers?.includes(playerId) === true;
}

function canRespond(state: MahjongState, playerId: string): boolean {
  return state.phase === "INTERRUPTING" && state.activePlayers?.includes(playerId) === true;
}

/** 自摸後（打牌前）の枚数か */
function hasFullHand(state: MahjongState, playerId: string): boolean {
  return handOf(state, playerId).length === concealedHandSize(state, playerId) + 1;
}

function uraDoraIndicators(state: MahjongState): Tile[] {
  return state.deadWall.value.slice(URA_DORA_OFFSET, URA_DORA_OFFSET + state.doraIndicators.length);
}

function revealDora(state: MahjongState, count: number): Partial<MahjongState> {
  const doraIndicators = [...state.doraIndicators];
  for (let i = 0; i < count; i++) {
    const indicator = state.deadWall.value[DORA_INDICATOR_OFFSET + doraIndicators.length];
    if (indicator) doraIndicators.push(indicator);
  }
  return { doraIndicators, pendingDoraReveals: 0 };
}

function withHand(state: MahjongState, playerId: string, hand: Tile[]): MahjongState {
  return { ...state, hands: { ...state.hands, [playerId]: secretTiles(hand, [playerId]) } };
}

function allFalse(playerIds: string[]): Record<string, boolean> {
  return Object.fromEntries(playerIds.map((id) => [id, false]));
}

// --- 和了判定 ---

interface WinOptions {
  chankan?: boolean;
}

function winContext(
  state: MahjongState,
  playerId: string,
  isTsumo: boolean,
  options: WinOptions = {},
): WinContext {
  const noDiscards = Object.values(state.discards).every((discards) => discards.length === 0);
  const firstTurn = state.uninterrupted && (state.discards[playerId]?.length ?? 0) === 0;
  const isDealer = playerId === dealerId(state);
  const wallEmpty = state.wall.value.length === 0;
  return {
    roundWind: roundWind(state),
    seatWind: seatWind(state, playerId),
    doraIndicators: state.doraIndicators,
    uraDoraIndicators: state.riichi[playerId] ? uraDoraIndicators(state) : undefined,
    riichi: state.riichi[playerId],
    doubleRiichi: state.doubleRiichi[playerId],
    ippatsu: state.ippatsu[playerId],
    rinshan: isTsumo && state.afterKan,
    chankan: !isTsumo && options.chankan === true,
    haitei: isTsumo && wallEmpty && !state.afterKan,
    houtei: !isTsumo && wallEmpty && !options.chankan,
    tenhou: isTsumo && isDealer && state.uninterrupted && noDiscards,
    chiihou: isTsumo && !isDealer && firstTurn,
    akaDora: state.akaDora,
  };
}

/** 自摸和了の評価（手牌の末尾が自摸牌）。役が無ければ undefined */
function evaluateTsumo(state: MahjongState, playerId: string): EvaluatedHand | undefined {
  const hand = handOf(state, playerId);
  if (!hasFullHand(state, playerId) || !isCompleteHand(hand)) return undefined;
  const winTile = hand[hand.length - 1]!;
  const evaluated = MahjongHandEvaluator.evaluate(
    hand,
    meldsOf(state, playerId),
    winTile,
    true,
    winContext(state, playerId, true),
  );
  return evaluated.isAgari ? evaluated : undefined;
}

/** 捨て牌によるフリテン: 待ち牌のいずれかを自分で捨てている */
function isDiscardFuriten(state: MahjongState, playerId: string): boolean {
  const waits = waitingTiles(handOf(state, playerId));
  const discarded = new Set((state.discards[playerId] ?? []).map(normalizeTile));
  return waits.some((tile) => discarded.has(tile));
}

/** ロン（搶槓を含む）の評価。役があり、フリテンでなければ結果を返す */
function evaluateRon(
  state: MahjongState,
  playerId: string,
  tile: Tile,
  options: WinOptions = {},
): EvaluatedHand | undefined {
  const hand = handOf(state, playerId);
  if (hand.length !== concealedHandSize(state, playerId)) return undefined;
  const fullHand = [...hand, tile];
  if (!isCompleteHand(fullHand)) return undefined;
  if (state.furiten[playerId] || isDiscardFuriten(state, playerId)) return undefined;
  const evaluated = MahjongHandEvaluator.evaluate(
    fullHand,
    meldsOf(state, playerId),
    tile,
    false,
    winContext(state, playerId, false, options),
  );
  return evaluated.isAgari ? evaluated : undefined;
}

function canRon(state: MahjongState, playerId: string): boolean {
  if (state.pendingKan) {
    return evaluateRon(state, playerId, state.pendingKan.tile, { chankan: true }) !== undefined;
  }
  if (state.pendingDiscard) {
    return evaluateRon(state, playerId, state.pendingDiscard.tile) !== undefined;
  }
  return false;
}

// --- 鳴きの候補 ---

/** チーで手牌から出せる 2 枚の組み合わせ（赤五の有無で別候補） */
function chiOptions(hand: Tile[], tile: Tile): Tile[][] {
  if (isHonor(tile)) return [];
  const suit = tileSuit(tile);
  const number = tileNumber(tile);
  const distinct = [...new Set(hand.filter((candidate) => tileSuit(candidate) === suit))];
  const options: Tile[][] = [];
  for (const [a, b] of [
    [number - 2, number - 1],
    [number - 1, number + 1],
    [number + 1, number + 2],
  ]) {
    if (a! < 1 || b! > 9) continue;
    for (const first of distinct.filter((candidate) => tileNumber(candidate) === a)) {
      for (const second of distinct.filter((candidate) => tileNumber(candidate) === b)) {
        options.push([first, second]);
      }
    }
  }
  return options;
}

/** ポンで手牌から出せる 2 枚の組み合わせ（赤五の有無で別候補） */
function ponOptions(hand: Tile[], tile: Tile): Tile[][] {
  const matching = hand.filter((candidate) => isSameTile(candidate, tile));
  if (matching.length < 2) return [];
  const seen = new Set<string>();
  const options: Tile[][] = [];
  for (let i = 0; i < matching.length; i++) {
    for (let j = i + 1; j < matching.length; j++) {
      const pair = [matching[i]!, matching[j]!].sort();
      const key = pair.join(",");
      if (seen.has(key)) continue;
      seen.add(key);
      options.push(pair);
    }
  }
  return options;
}

function kanOption(hand: Tile[], tile: Tile): Tile[] | undefined {
  const matching = hand.filter((candidate) => isSameTile(candidate, tile));
  return matching.length >= 3 ? matching.slice(0, 3) : undefined;
}

function isNextPlayer(state: MahjongState, discarderId: string, playerId: string): boolean {
  return state.playerIds[nextIndex(state, state.playerIds.indexOf(discarderId))] === playerId;
}

/** CALL アクションで実際に手牌から出す牌を検証して返す */
function callConsumedTiles(state: MahjongState, action: MahjongAction): Tile[] | undefined {
  const pending = state.pendingDiscard;
  const playerId = action.playerId!;
  if (!pending || !action.meldType || state.riichi[playerId]) return undefined;
  // 河底牌は鳴けない（槓には嶺上牌も必要）
  if (state.wall.value.length === 0) return undefined;
  const hand = handOf(state, playerId);
  if (hand.length !== concealedHandSize(state, playerId)) return undefined;
  const tile = pending.tile;

  if (action.meldType === "PON") {
    const consumed = action.consumed ?? ponOptions(hand, tile)[0];
    if (!consumed || consumed.length !== 2 || !consumed.every((t) => isSameTile(t, tile))) {
      return undefined;
    }
    return removeTiles(hand, consumed) ? consumed : undefined;
  }

  if (action.meldType === "KAN") {
    if (state.kanCount >= MAX_KANS) return undefined;
    const consumed = action.consumed ?? kanOption(hand, tile);
    if (!consumed || consumed.length !== 3 || !consumed.every((t) => isSameTile(t, tile))) {
      return undefined;
    }
    return removeTiles(hand, consumed) ? consumed : undefined;
  }

  // CHI: 上家の捨て牌のみ
  if (!isNextPlayer(state, pending.playerId, playerId)) return undefined;
  const consumed = action.consumed;
  if (!consumed || consumed.length !== 2 || !removeTiles(hand, consumed)) return undefined;
  return isSequence([...consumed, tile]) ? consumed : undefined;
}

/** 打牌に対して何かできる（ロン・鳴き）プレイヤー */
function claimants(state: MahjongState, discarderId: string, tile: Tile): string[] {
  const wallLeft = state.wall.value.length > 0;
  return state.playerIds.filter((playerId) => {
    if (playerId === discarderId) return false;
    if (evaluateRon(state, playerId, tile)) return true;
    if (state.riichi[playerId] || !wallLeft) return false;
    const hand = handOf(state, playerId);
    if (countTile(hand, tile) >= 2) return true;
    return isNextPlayer(state, discarderId, playerId) && chiOptions(hand, tile).length > 0;
  });
}

/** 喰い替えで禁止される打牌（正規化済み） */
function kuikaeForbiddenTiles(meld: Meld): Tile[] {
  const called = normalizeTile(meld.tile);
  if (meld.type !== "CHI") return [called];
  const numbers = meld.consumed.map(tileNumber).sort((a, b) => a - b);
  const calledNumber = tileNumber(meld.tile);
  const suit = tileSuit(meld.tile);
  const forbidden = [called];
  if (numbers[0]! + 1 === numbers[1]!) {
    // 両端の牌をチーした場合は反対側の筋も禁止（例: 45 で 3 をチー → 6 も禁止）
    const other = calledNumber < numbers[0]! ? calledNumber + 3 : calledNumber - 3;
    if (other >= 1 && other <= 9) forbidden.push(`${other}${suit}`);
  }
  return forbidden;
}

// --- 局の終了 ---

function finishHand(
  state: MahjongState,
  result: MahjongHandResult,
  message: string,
  extra: Partial<MahjongState> = {},
): MahjongState {
  const scores = { ...state.scores };
  for (const [playerId, delta] of Object.entries(result.scoreDeltas)) {
    scores[playerId] = (scores[playerId] ?? 0) + delta;
  }
  return {
    ...state,
    ...extra,
    status: "FINISHED",
    phase: "FINISHED",
    scores,
    result,
    message,
    activePlayers: [],
    pendingDiscard: undefined,
    pendingKan: undefined,
    turnDeadline: undefined,
  };
}

function abortiveDraw(state: MahjongState, reason: string): MahjongState {
  return finishHand(
    state,
    { type: "ABORTIVE_DRAW", reason, winners: [], tenpai: [], scoreDeltas: {}, renchan: true },
    `${reason}による途中流局。`,
  );
}

/** 荒牌流局: ノーテン罰符と親の聴牌による連荘 */
function exhaustiveDraw(state: MahjongState): MahjongState {
  const tenpai = state.playerIds.filter(
    (playerId) => waitingTiles(handOf(state, playerId)).length > 0,
  );
  const scoreDeltas: Record<string, number> = {};
  if (tenpai.length > 0 && tenpai.length < state.playerIds.length) {
    const noten = state.playerIds.length - tenpai.length;
    for (const playerId of state.playerIds) {
      scoreDeltas[playerId] = tenpai.includes(playerId)
        ? NOTEN_PENALTY_TOTAL / tenpai.length
        : -NOTEN_PENALTY_TOTAL / noten;
    }
  }
  const renchan = tenpai.includes(dealerId(state));
  return finishHand(
    state,
    { type: "EXHAUSTIVE_DRAW", reason: "荒牌", winners: [], tenpai, scoreDeltas, renchan },
    `荒牌流局。聴牌: ${tenpai.length > 0 ? tenpai.join(", ") : "なし"}`,
  );
}

function winnerRecord(
  playerId: string,
  evaluated: EvaluatedHand,
  winTile: Tile,
  from?: string,
): MahjongWinner {
  return {
    playerId,
    from,
    isTsumo: from === undefined,
    winTile,
    han: evaluated.han,
    fu: evaluated.fu,
    yakuman: evaluated.yakuman,
    ten: evaluated.ten,
    yaku: evaluated.yaku,
    text: evaluated.text,
  };
}

function describeWin(winner: MahjongWinner): string {
  const yaku = Object.entries(winner.yaku)
    .map(([name, value]) => `${name} ${value}`)
    .join(", ");
  const kind = winner.isTsumo ? "TSUMO" : "RON";
  return `Player ${winner.playerId} won by ${kind}! [${winner.ten}pts] ${winner.text} (${yaku})`;
}

/** 自摸和了。親は子全員から oya[0]、子は親から ko[0]・子から ko[1] を受け取る（本場は 100 点ずつ） */
function finishByTsumo(state: MahjongState, playerId: string): MahjongState {
  const revealed = { ...state, ...revealDora(state, state.pendingDoraReveals) };
  const evaluated = evaluateTsumo(revealed, playerId)!;
  const hand = handOf(revealed, playerId);
  const winner = winnerRecord(playerId, evaluated, hand[hand.length - 1]!);
  const isDealer = playerId === dealerId(revealed);
  const scoreDeltas: Record<string, number> = {};
  let total = 0;
  for (const other of revealed.playerIds) {
    if (other === playerId) continue;
    const base = isDealer
      ? evaluated.oya[0]!
      : other === dealerId(revealed)
        ? evaluated.ko[0]!
        : evaluated.ko[1]!;
    const payment = base + revealed.honba * (HONBA_BONUS / 3);
    scoreDeltas[other] = -payment;
    total += payment;
  }
  scoreDeltas[playerId] = total + revealed.riichiSticks * RIICHI_DEPOSIT;
  return finishHand(
    revealed,
    { type: "WIN", winners: [winner], tenpai: [], scoreDeltas, renchan: isDealer },
    describeWin(winner),
    {
      riichiSticks: 0,
      uraDoraIndicators: revealed.riichi[playerId] ? uraDoraIndicators(revealed) : [],
    },
  );
}

/** 栄和（ダブロン・搶槓を含む）。winnerIds は放銃者からの手番順 */
function finishByRon(
  state: MahjongState,
  winnerIds: string[],
  discarderId: string,
  tile: Tile,
  options: WinOptions = {},
): MahjongState {
  let current: MahjongState = { ...state, ...revealDora(state, state.pendingDoraReveals) };
  // 立直宣言牌をロンされた場合、立直は成立しない（供託も戻す）
  if (current.pendingDiscard?.riichi) {
    current = {
      ...current,
      scores: {
        ...current.scores,
        [discarderId]: current.scores[discarderId]! + RIICHI_DEPOSIT,
      },
      riichiSticks: current.riichiSticks - 1,
      riichi: { ...current.riichi, [discarderId]: false },
      doubleRiichi: { ...current.doubleRiichi, [discarderId]: false },
      ippatsu: { ...current.ippatsu, [discarderId]: false },
    };
  }

  const winners: MahjongWinner[] = [];
  const scoreDeltas: Record<string, number> = {};
  let paid = 0;
  let anyRiichi = false;
  winnerIds.forEach((winnerId, index) => {
    const evaluated = evaluateRon(current, winnerId, tile, options)!;
    const winner = winnerRecord(winnerId, evaluated, tile, discarderId);
    winners.push(winner);
    // 本場は各和了者へ、供託は頭ハネ（放銃者から最も近い和了者）へ
    let gain = evaluated.ten + current.honba * HONBA_BONUS;
    paid += gain;
    if (index === 0) gain += current.riichiSticks * RIICHI_DEPOSIT;
    scoreDeltas[winnerId] = gain;
    if (current.riichi[winnerId]) anyRiichi = true;
  });
  scoreDeltas[discarderId] = -paid;

  // 和了牌を手牌に加えて公開する
  const hands = { ...current.hands };
  for (const winnerId of winnerIds) {
    hands[winnerId] = secretTiles([...handOf(current, winnerId), tile], [winnerId]);
  }

  return finishHand(
    { ...current, hands },
    {
      type: "WIN",
      winners,
      tenpai: [],
      scoreDeltas,
      renchan: winnerIds.includes(dealerId(current)),
    },
    winners.map(describeWin).join(" | "),
    { riichiSticks: 0, uraDoraIndicators: anyRiichi ? uraDoraIndicators(current) : [] },
  );
}

// --- 手番の進行 ---

/** 山から自摸る（末尾から）。山が無ければ荒牌流局 */
function drawFromWall(state: MahjongState, playerId: string): MahjongState {
  const wall = [...state.wall.value];
  const tile = wall.pop();
  if (!tile) return exhaustiveDraw(state);
  const next = withHand(state, playerId, [...handOf(state, playerId), tile]);
  return { ...next, wall: secretTiles(wall, []) };
}

/** 嶺上牌を自摸り、山の先頭（海底牌）を王牌へ移す */
function drawFromDeadWall(state: MahjongState, playerId: string): MahjongState {
  const deadWall = [...state.deadWall.value];
  const wall = [...state.wall.value];
  const tile = deadWall[state.rinshanDrawn]!;
  const moved = wall.shift();
  if (moved) deadWall.push(moved);
  const next = withHand(state, playerId, [...handOf(state, playerId), tile]);
  return {
    ...next,
    wall: secretTiles(wall, []),
    deadWall: secretTiles(deadWall, []),
    rinshanDrawn: state.rinshanDrawn + 1,
    afterKan: true,
  };
}

function beginTurn(state: MahjongState, index: number): MahjongState {
  const playerId = state.playerIds[index]!;
  return {
    ...state,
    turnIndex: index,
    activePlayers: [playerId],
    phase: "PLAYING",
    pendingDiscard: undefined,
    pendingKan: undefined,
    turnDeadline: undefined,
    afterKan: false,
    kuikaeForbidden: [],
  };
}

/** 次のプレイヤーの手番にして自摸らせる */
function advanceTurn(state: MahjongState, index: number): MahjongState {
  if (state.wall.value.length === 0) return exhaustiveDraw(state);
  const playerId = state.playerIds[index]!;
  const started = beginTurn(state, index);
  // 同巡フリテンは自摸で解消（立直中は解消しない）
  const furiten = state.riichi[playerId]
    ? started.furiten
    : { ...started.furiten, [playerId]: false };
  return drawFromWall({ ...started, furiten }, playerId);
}

/** 四開槓: 4 回の槓が複数人によるもの */
function isFourKanAbort(state: MahjongState): boolean {
  if (state.kanCount < MAX_KANS) return false;
  const owners = state.playerIds.filter((id) =>
    meldsOf(state, id).some((meld) => meld.type !== "CHI" && meld.type !== "PON"),
  );
  return owners.length > 1;
}

/** 打牌を実行し、鳴き・ロン待ちに入る（誰もできなければ次の手番へ） */
function discardTile(
  state: MahjongState,
  action: MahjongAction,
  riichiDeclared: boolean,
): MahjongState {
  const playerId = action.playerId!;
  const tile = action.tile!;
  const hand = removeTiles(handOf(state, playerId), [tile])!;

  let next: MahjongState = {
    ...withHand(state, playerId, hand),
    ...revealDora(state, state.pendingDoraReveals),
    discards: { ...state.discards, [playerId]: [...(state.discards[playerId] ?? []), tile] },
    // 一発は立直宣言後の最初の打牌までに限る
    ippatsu: { ...state.ippatsu, [playerId]: riichiDeclared },
    kuikaeForbidden: [],
    afterKan: false,
  };

  // 四風連打: 最初の一巡で全員が同じ風牌を捨てた
  const rivers = state.playerIds.map((id) => next.discards[id] ?? []);
  if (
    next.uninterrupted &&
    isHonor(tile) &&
    tileNumber(tile) <= 4 &&
    rivers.every((river) => river.length === 1 && isSameTile(river[0]!, tile))
  ) {
    return abortiveDraw(next, "四風連打");
  }

  const responders = claimants(next, playerId, tile);
  next = {
    ...next,
    pendingDiscard: { playerId, tile, riichi: riichiDeclared, pendingActions: [] },
  };
  if (responders.length === 0) return resolveDiscard(next);
  return {
    ...next,
    phase: "INTERRUPTING",
    activePlayers: responders,
    turnDeadline: (action.timestamp || 0) + CLAIM_TIMEOUT_MS,
  };
}

/** 打牌への応答が出揃った（または誰も応答できない）ときの解決 */
function resolveDiscard(state: MahjongState): MahjongState {
  const pending = state.pendingDiscard!;
  const discarderId = pending.playerId;
  const tile = pending.tile;
  const responded = new Map(pending.pendingActions.map((entry) => [entry.playerId, entry.action]));

  // 優先順位: ロン > ポン・大明槓 > チー
  const ronners = turnOrderFrom(state, discarderId).filter(
    (playerId) => responded.get(playerId)?.type === "RON",
  );
  if (ronners.length >= 3) return abortiveDraw(state, "三家和");
  if (ronners.length > 0) return finishByRon(state, ronners, discarderId, tile);

  // ロンできたのに見逃した（パス・鳴き）プレイヤーはフリテン
  let next: MahjongState = state;
  for (const playerId of state.playerIds) {
    if (playerId === discarderId) continue;
    if (evaluateRon(state, playerId, tile)) {
      next = { ...next, furiten: { ...next.furiten, [playerId]: true } };
    }
  }

  const calls = pending.pendingActions.filter((entry) => entry.action.type === "CALL");
  const call = calls.find((entry) => entry.action.meldType !== "CHI") ?? calls[0];
  if (call) {
    const consumed = callConsumedTiles(next, call.action);
    if (consumed) return applyCall(next, call.playerId, call.action.meldType!, consumed);
  }

  // 全員パス
  if (state.playerIds.every((playerId) => next.riichi[playerId])) {
    return abortiveDraw(next, "四家立直");
  }
  if (isFourKanAbort(next)) return abortiveDraw(next, "四開槓");
  return advanceTurn(next, nextIndex(next, next.playerIds.indexOf(discarderId)));
}

/** 鳴きを成立させ、鳴いたプレイヤーの手番にする */
function applyCall(
  state: MahjongState,
  playerId: string,
  meldType: "CHI" | "PON" | "KAN",
  consumed: Tile[],
): MahjongState {
  const pending = state.pendingDiscard!;
  const hand = removeTiles(handOf(state, playerId), consumed)!;
  const meld: Meld = {
    type: meldType === "KAN" ? "DAIMINKAN" : meldType,
    tile: pending.tile,
    consumed,
    from: pending.playerId,
  };
  const next: MahjongState = {
    ...beginTurn(withHand(state, playerId, hand), state.playerIds.indexOf(playerId)),
    melds: { ...state.melds, [playerId]: [...meldsOf(state, playerId), meld] },
    ippatsu: allFalse(state.playerIds),
    uninterrupted: false,
  };
  if (meld.type === "DAIMINKAN") {
    return drawFromDeadWall(
      { ...next, kanCount: next.kanCount + 1, pendingDoraReveals: next.pendingDoraReveals + 1 },
      playerId,
    );
  }
  return { ...next, kuikaeForbidden: kuikaeForbiddenTiles(meld) };
}

/** 加槓を成立させて嶺上牌を自摸る */
function completeKakan(state: MahjongState): MahjongState {
  const pending = state.pendingKan!;
  const playerId = pending.playerId;
  const melds = meldsOf(state, playerId).map((meld): Meld => {
    if (meld.type !== "PON" || !isSameTile(meld.tile, pending.tile)) return meld;
    return { ...meld, type: "KAKAN", consumed: [...meld.consumed, pending.tile] };
  });
  const next: MahjongState = {
    ...beginTurn(state, state.playerIds.indexOf(playerId)),
    melds: { ...state.melds, [playerId]: melds },
    ippatsu: allFalse(state.playerIds),
    uninterrupted: false,
    kanCount: state.kanCount + 1,
    pendingDoraReveals: state.pendingDoraReveals + 1,
  };
  return drawFromDeadWall(next, playerId);
}

/** 加槓への応答（搶槓）が出揃ったときの解決 */
function resolveKan(state: MahjongState): MahjongState {
  const pending = state.pendingKan!;
  const responded = new Map(pending.pendingActions.map((entry) => [entry.playerId, entry.action]));
  const ronners = turnOrderFrom(state, pending.playerId).filter(
    (playerId) => responded.get(playerId)?.type === "RON",
  );
  if (ronners.length >= 3) return abortiveDraw(state, "三家和");
  if (ronners.length > 0) {
    return finishByRon(state, ronners, pending.playerId, pending.tile, { chankan: true });
  }
  let next = state;
  for (const playerId of state.playerIds) {
    if (playerId === pending.playerId) continue;
    if (evaluateRon(state, playerId, pending.tile, { chankan: true })) {
      next = { ...next, furiten: { ...next.furiten, [playerId]: true } };
    }
  }
  return completeKakan(next);
}

/** 割り込みアクション（RON / CALL / PASS）の記録と、全員分が揃ったときの解決 */
function handleInterruption(state: MahjongState, action: MahjongAction): MahjongState {
  const playerId = action.playerId!;
  const entry: PendingResponse = { playerId, action };
  const activePlayers = (state.activePlayers ?? []).filter((id) => id !== playerId);
  if (state.pendingKan) {
    const next: MahjongState = {
      ...state,
      activePlayers,
      pendingKan: {
        ...state.pendingKan,
        pendingActions: [...state.pendingKan.pendingActions, entry],
      },
    };
    return activePlayers.length > 0 ? next : resolveKan(next);
  }
  if (!state.pendingDiscard) return state;
  const next: MahjongState = {
    ...state,
    activePlayers,
    pendingDiscard: {
      ...state.pendingDiscard,
      pendingActions: [...state.pendingDiscard.pendingActions, entry],
    },
  };
  return activePlayers.length > 0 ? next : resolveDiscard(next);
}

// --- Action Validators ---

function canDiscard(state: MahjongState, playerId: string, tile: Tile): boolean {
  const hand = handOf(state, playerId);
  if (!hand.includes(tile) || !hasFullHand(state, playerId)) return false;
  // 立直後は自摸切りのみ
  if (state.riichi[playerId] && tile !== hand[hand.length - 1]) return false;
  // 喰い替え禁止（他に捨てられる牌が無い場合は許す）
  if (state.kuikaeForbidden.length > 0) {
    const forbidden = new Set(state.kuikaeForbidden);
    const allowed = hand.filter((candidate) => !forbidden.has(normalizeTile(candidate)));
    if (allowed.length > 0 && forbidden.has(normalizeTile(tile))) return false;
  }
  return true;
}

function canRiichi(state: MahjongState, playerId: string, tile: Tile): boolean {
  if (
    state.riichi[playerId] ||
    (state.scores[playerId] ?? 0) < RIICHI_DEPOSIT ||
    !isMenzen(meldsOf(state, playerId)) ||
    state.wall.value.length < MIN_WALL_FOR_RIICHI ||
    !hasFullHand(state, playerId)
  ) {
    return false;
  }
  const rest = removeTiles(handOf(state, playerId), [tile]);
  return rest !== undefined && waitingTiles(rest).length > 0;
}

function canAnkan(state: MahjongState, playerId: string, tile: Tile): boolean {
  const hand = handOf(state, playerId);
  if (
    !hasFullHand(state, playerId) ||
    countTile(hand, tile) !== 4 ||
    state.wall.value.length === 0 ||
    state.kanCount >= MAX_KANS
  ) {
    return false;
  }
  if (!state.riichi[playerId]) return true;
  // 立直後の暗槓は自摸った牌で、待ちが変わらない場合に限る
  const drawn = hand[hand.length - 1]!;
  if (!isSameTile(drawn, tile)) return false;
  const before = waitingTiles(hand.slice(0, -1));
  const after = waitingTiles(hand.filter((candidate) => !isSameTile(candidate, tile)));
  return before.length === after.length && before.every((wait, i) => wait === after[i]);
}

function canKakan(state: MahjongState, playerId: string, tile: Tile): boolean {
  const hand = handOf(state, playerId);
  return (
    hasFullHand(state, playerId) &&
    hand.includes(tile) &&
    state.wall.value.length > 0 &&
    state.kanCount < MAX_KANS &&
    meldsOf(state, playerId).some((meld) => meld.type === "PON" && isSameTile(meld.tile, tile))
  );
}

const ACTION_VALIDATORS: Record<
  MahjongAction["type"],
  (state: MahjongState, action: MahjongAction) => boolean
> = {
  START: (state) => {
    const joined = Object.values(state.players || {}).filter((p) => p !== null);
    return state.status === "WAITING" && joined.length === 4;
  },
  DISCARD: (state, action) =>
    isPlayersTurn(state, action.playerId!) &&
    !!action.tile &&
    canDiscard(state, action.playerId!, action.tile),
  RIICHI: (state, action) =>
    isPlayersTurn(state, action.playerId!) &&
    !!action.tile &&
    canRiichi(state, action.playerId!, action.tile) &&
    canDiscard(state, action.playerId!, action.tile),
  TSUMO: (state, action) =>
    isPlayersTurn(state, action.playerId!) && evaluateTsumo(state, action.playerId!) !== undefined,
  ANKAN: (state, action) =>
    isPlayersTurn(state, action.playerId!) &&
    !!action.tile &&
    canAnkan(state, action.playerId!, action.tile),
  KAKAN: (state, action) =>
    isPlayersTurn(state, action.playerId!) &&
    !!action.tile &&
    canKakan(state, action.playerId!, action.tile),
  KYUUSHU_KYUUHAI: (state, action) =>
    isPlayersTurn(state, action.playerId!) &&
    state.uninterrupted &&
    (state.discards[action.playerId!]?.length ?? 0) === 0 &&
    handOf(state, action.playerId!).length === 14 &&
    distinctTerminalHonorCount(handOf(state, action.playerId!)) >= 9,
  CALL: (state, action) =>
    canRespond(state, action.playerId!) &&
    !state.pendingKan &&
    callConsumedTiles(state, action) !== undefined,
  RON: (state, action) => canRespond(state, action.playerId!) && canRon(state, action.playerId!),
  PASS: (state, action) => canRespond(state, action.playerId!),
};

// --- Action Handlers ---

const ACTION_HANDLERS: Record<
  MahjongAction["type"],
  (state: MahjongState, action: MahjongAction, rng?: IGameRNG) => MahjongState
> = {
  START: (state, _action, rng) => {
    const playerIds = Object.values(state.players || {}).filter((p): p is string => p !== null);
    const wall = createWall(rng, state.akaDora);
    const deadWall = wall.splice(-DEAD_WALL_SIZE);
    const dealerIndex = ((state.dealerIndex % 4) + 4) % 4;

    const hands: Record<string, Secret<Tile[]>> = {};
    const discards: Record<string, Tile[]> = {};
    const melds: Record<string, Meld[]> = {};
    const scores: Record<string, number> = {};
    for (const playerId of playerIds) {
      scores[playerId] = state.scores[playerId] ?? INITIAL_SCORE;
      discards[playerId] = [];
      melds[playerId] = [];
      hands[playerId] = secretTiles(sortTiles(wall.splice(0, 13)), [playerId]);
    }

    const dealt: MahjongState = {
      ...state,
      status: "PLAYING",
      phase: "PLAYING",
      playerIds,
      dealerIndex,
      wall: secretTiles(wall, []),
      deadWall: secretTiles(deadWall, []),
      doraIndicators: [deadWall[DORA_INDICATOR_OFFSET]!],
      uraDoraIndicators: [],
      rinshanDrawn: 0,
      kanCount: 0,
      pendingDoraReveals: 0,
      hands,
      discards,
      melds,
      scores,
      riichi: allFalse(playerIds),
      doubleRiichi: allFalse(playerIds),
      ippatsu: allFalse(playerIds),
      furiten: allFalse(playerIds),
      uninterrupted: true,
      afterKan: false,
      kuikaeForbidden: [],
      pendingDiscard: undefined,
      pendingKan: undefined,
      result: undefined,
      message: undefined,
    };
    return advanceTurn(dealt, dealerIndex);
  },

  DISCARD: (state, action) => discardTile(state, action, false),

  RIICHI: (state, action) => {
    const playerId = action.playerId!;
    const declared: MahjongState = {
      ...state,
      scores: { ...state.scores, [playerId]: state.scores[playerId]! - RIICHI_DEPOSIT },
      riichi: { ...state.riichi, [playerId]: true },
      doubleRiichi: {
        ...state.doubleRiichi,
        [playerId]: state.uninterrupted && (state.discards[playerId]?.length ?? 0) === 0,
      },
      riichiSticks: state.riichiSticks + 1,
    };
    return discardTile(declared, action, true);
  },

  TSUMO: (state, action) => finishByTsumo(state, action.playerId!),

  ANKAN: (state, action) => {
    const playerId = action.playerId!;
    const hand = handOf(state, playerId);
    const consumed = hand.filter((candidate) => isSameTile(candidate, action.tile!));
    const meld: Meld = { type: "ANKAN", tile: consumed[0]!, consumed };
    const rest = hand.filter((candidate) => !isSameTile(candidate, action.tile!));
    const next: MahjongState = {
      ...beginTurn(withHand(state, playerId, rest), state.turnIndex),
      melds: { ...state.melds, [playerId]: [...meldsOf(state, playerId), meld] },
      ippatsu: allFalse(state.playerIds),
      uninterrupted: false,
      kanCount: state.kanCount + 1,
    };
    // 暗槓のドラは即座にめくる（保留中の槓ドラがあればそれも）
    return drawFromDeadWall(
      { ...next, ...revealDora(next, next.pendingDoraReveals + 1) },
      playerId,
    );
  },

  KAKAN: (state, action) => {
    const playerId = action.playerId!;
    const tile = action.tile!;
    const hand = removeTiles(handOf(state, playerId), [tile])!;
    const next: MahjongState = {
      ...withHand(state, playerId, hand),
      pendingKan: { playerId, tile, pendingActions: [] },
    };
    const responders = state.playerIds.filter(
      (id) => id !== playerId && evaluateRon(next, id, tile, { chankan: true }) !== undefined,
    );
    if (responders.length === 0) return completeKakan(next);
    return {
      ...next,
      phase: "INTERRUPTING",
      activePlayers: responders,
      turnDeadline: (action.timestamp || 0) + CLAIM_TIMEOUT_MS,
    };
  },

  KYUUSHU_KYUUHAI: (state) => abortiveDraw(state, "九種九牌"),

  RON: handleInterruption,
  CALL: handleInterruption,
  PASS: handleInterruption,
};

// --- Ruleset Definition ---

export const MahjongRuleset: GameRuleset<MahjongState, MahjongAction, MahjongOptions> = {
  getInitialState: (options = {}, _rng?: IGameRNG): MahjongState => {
    const playerIds = (options.playerIds ?? []).filter((id) => !!id);
    return {
      status: "WAITING",
      phase: "WAITING",
      players: { 0: null, 1: null, 2: null, 3: null },
      playerIds,
      activePlayers: [],
      wind: options.wind ?? "EAST",
      round: options.round ?? 1,
      dealerIndex: options.dealerIndex ?? 0,
      honba: options.honba ?? 0,
      riichiSticks: options.riichiSticks ?? 0,
      wall: secretTiles([], []),
      deadWall: secretTiles([], []),
      doraIndicators: [],
      uraDoraIndicators: [],
      rinshanDrawn: 0,
      kanCount: 0,
      pendingDoraReveals: 0,
      hands: {},
      discards: {},
      melds: {},
      turnIndex: 0,
      scores: options.initialScores ?? {},
      riichi: {},
      doubleRiichi: {},
      ippatsu: {},
      furiten: {},
      akaDora: options.akaDora !== false,
      uninterrupted: true,
      afterKan: false,
      kuikaeForbidden: [],
    };
  },

  isValidAction: (state, action) => {
    const validator = ACTION_VALIDATORS[action.type];
    return validator ? validator(state, action) : false;
  },

  reduce: (state, action, rng) => {
    const handler = ACTION_HANDLERS[action.type];
    return handler ? handler(state, action, rng) : state;
  },

  getLegalActions: (state, playerId): MahjongAction[] => {
    const actions: MahjongAction[] = [];
    const push = (action: MahjongAction) => {
      if (MahjongRuleset.isValidAction(state, action)) actions.push(action);
    };

    if (state.status === "WAITING") {
      push({ type: "START", playerId });
      return actions;
    }
    if (state.status !== "PLAYING") return actions;

    if (state.phase === "PLAYING" && state.activePlayers?.includes(playerId)) {
      const hand = handOf(state, playerId);
      const distinct = [...new Set(hand)];
      push({ type: "TSUMO", playerId });
      push({ type: "KYUUSHU_KYUUHAI", playerId });
      for (const tile of distinct) push({ type: "RIICHI", playerId, tile });
      for (const tile of new Set(distinct.map(normalizeTile))) {
        push({ type: "ANKAN", playerId, tile });
      }
      for (const tile of distinct) push({ type: "KAKAN", playerId, tile });
      for (const tile of distinct) push({ type: "DISCARD", playerId, tile });
      return actions;
    }

    if (state.phase === "INTERRUPTING" && state.activePlayers?.includes(playerId)) {
      push({ type: "RON", playerId });
      if (state.pendingDiscard && !state.pendingKan) {
        const hand = handOf(state, playerId);
        const tile = state.pendingDiscard.tile;
        for (const consumed of ponOptions(hand, tile)) {
          push({ type: "CALL", playerId, meldType: "PON", consumed });
        }
        const kan = kanOption(hand, tile);
        if (kan) push({ type: "CALL", playerId, meldType: "KAN", consumed: kan });
        for (const consumed of chiOptions(hand, tile)) {
          push({ type: "CALL", playerId, meldType: "CHI", consumed });
        }
      }
      push({ type: "PASS", playerId });
    }
    return actions;
  },

  checkWinCondition: (state) => {
    if (state.status !== "FINISHED" && !state.result) return { isFinished: false };
    return {
      isFinished: true,
      winnerIds: state.result?.winners.map((winner) => winner.playerId) ?? [],
      message: state.message,
    };
  },

  getTimeoutAction: (state, playerId) => {
    if (!state.activePlayers?.includes(playerId)) return null;
    if (state.phase === "INTERRUPTING") return { type: "PASS", playerId };
    if (state.phase === "PLAYING") {
      const hand = handOf(state, playerId);
      const tile = hand[hand.length - 1];
      return tile ? { type: "DISCARD", playerId, tile } : null;
    }
    return null;
  },

  applyWinResult: (state, winResult) => ({
    ...state,
    status: "FINISHED",
    phase: "FINISHED",
    message: winResult.message ?? state.message,
    activePlayers: [],
    turnDeadline: undefined,
  }),
};

/** テスト・AI 向けに内部判定を公開する */
export const MahjongRules = {
  waitingTiles,
  isCompleteHand,
  chiOptions,
  ponOptions,
  seatWind,
  claimants,
};
