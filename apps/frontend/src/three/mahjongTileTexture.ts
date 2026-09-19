// src/three/mahjongTileTexture.ts
//
// 麻雀牌の牌面を Canvas に手続き描画して CanvasTexture にする。
// 画像アセットやフォント依存（Unicode の麻雀牌グリフは環境によって出ない）を避けるため、
// 萬子は漢数字、筒子は円、索子は竹、字牌は漢字で描く。
import * as THREE from "three";
import type { Tile } from "@engine/shared/rules/mahjong/MahjongTiles";

export const FACE_WIDTH = 128;
export const FACE_HEIGHT = 176;

const IVORY = "#f7f3e8";
const INK = "#1f1f1f";
const RED = "#c62828";
const GREEN = "#2e7d32";
const BLUE = "#1e5aa8";

const KANJI_NUMBERS = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
const HONOR_KANJI: Record<string, { text: string; color: string }> = {
  "1z": { text: "東", color: INK },
  "2z": { text: "南", color: INK },
  "3z": { text: "西", color: INK },
  "4z": { text: "北", color: INK },
  "5z": { text: "", color: BLUE }, // 白
  "6z": { text: "發", color: GREEN },
  "7z": { text: "中", color: RED },
};

/** 筒子の円の配置（0〜1 の相対座標） */
const PIN_LAYOUTS: Record<number, [number, number][]> = {
  1: [[0.5, 0.5]],
  2: [
    [0.5, 0.28],
    [0.5, 0.72],
  ],
  3: [
    [0.28, 0.25],
    [0.5, 0.5],
    [0.72, 0.75],
  ],
  4: [
    [0.3, 0.28],
    [0.7, 0.28],
    [0.3, 0.72],
    [0.7, 0.72],
  ],
  5: [
    [0.28, 0.25],
    [0.72, 0.25],
    [0.5, 0.5],
    [0.28, 0.75],
    [0.72, 0.75],
  ],
  6: [
    [0.32, 0.22],
    [0.68, 0.22],
    [0.32, 0.5],
    [0.68, 0.5],
    [0.32, 0.78],
    [0.68, 0.78],
  ],
  7: [
    [0.25, 0.18],
    [0.5, 0.3],
    [0.75, 0.42],
    [0.32, 0.62],
    [0.68, 0.62],
    [0.32, 0.84],
    [0.68, 0.84],
  ],
  8: [
    [0.32, 0.17],
    [0.68, 0.17],
    [0.32, 0.39],
    [0.68, 0.39],
    [0.32, 0.61],
    [0.68, 0.61],
    [0.32, 0.83],
    [0.68, 0.83],
  ],
  9: [
    [0.25, 0.2],
    [0.5, 0.2],
    [0.75, 0.2],
    [0.25, 0.5],
    [0.5, 0.5],
    [0.75, 0.5],
    [0.25, 0.8],
    [0.5, 0.8],
    [0.75, 0.8],
  ],
};

/** 索子の竹の配置（行ごとの本数） */
const SOU_ROWS: Record<number, number[]> = {
  1: [1],
  2: [1, 1],
  3: [1, 2],
  4: [2, 2],
  5: [2, 1, 2],
  6: [3, 3],
  7: [1, 3, 3],
  8: [3, 2, 3],
  9: [3, 3, 3],
};

function drawBase(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = IVORY;
  ctx.fillRect(0, 0, FACE_WIDTH, FACE_HEIGHT);
  // 縁を少し落として牌らしく
  ctx.strokeStyle = "rgba(0,0,0,0.12)";
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, FACE_WIDTH - 6, FACE_HEIGHT - 6);
}

function drawMan(ctx: CanvasRenderingContext2D, number: number, red: boolean) {
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = red ? RED : INK;
  ctx.font = "bold 62px serif";
  ctx.fillText(KANJI_NUMBERS[number]!, FACE_WIDTH / 2, FACE_HEIGHT * 0.3);
  ctx.fillStyle = RED;
  ctx.font = "bold 64px serif";
  ctx.fillText("萬", FACE_WIDTH / 2, FACE_HEIGHT * 0.7);
}

function drawPin(ctx: CanvasRenderingContext2D, number: number, red: boolean) {
  const points = PIN_LAYOUTS[number]!;
  const radius = number === 1 ? 40 : number <= 4 ? 22 : 16;
  points.forEach(([px, py], i) => {
    const x = px * FACE_WIDTH;
    const y = py * FACE_HEIGHT;
    // 赤五は中央の円を赤く、それ以外は色を交互に
    const color = red && i === 2 ? RED : i % 2 === 0 ? BLUE : GREEN;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, radius * 0.45, 0, Math.PI * 2);
    ctx.fillStyle = IVORY;
    ctx.fill();
  });
}

function drawSou(ctx: CanvasRenderingContext2D, number: number, red: boolean) {
  const rows = SOU_ROWS[number]!;
  const rowHeight = FACE_HEIGHT / (rows.length + 0.4);
  const stickW = number === 1 ? 26 : 16;
  const stickH = number === 1 ? 110 : rowHeight * 0.78;
  rows.forEach((count, r) => {
    const y = rowHeight * (r + 0.7);
    for (let c = 0; c < count; c++) {
      const x = (FACE_WIDTH * (c + 1)) / (count + 1);
      const isRed = red && r === Math.floor(rows.length / 2) && c === Math.floor(count / 2);
      ctx.fillStyle = isRed ? RED : GREEN;
      roundRect(ctx, x - stickW / 2, y - stickH / 2, stickW, stickH, stickW / 2);
      ctx.fillStyle = IVORY;
      // 竹の節
      ctx.fillRect(x - stickW / 2, y - 2, stickW, 4);
    }
  });
}

function drawHonor(ctx: CanvasRenderingContext2D, tile: Tile) {
  const { text, color } = HONOR_KANJI[tile]!;
  if (!text) {
    // 白: 青い枠だけ
    ctx.strokeStyle = BLUE;
    ctx.lineWidth = 8;
    ctx.strokeRect(24, 30, FACE_WIDTH - 48, FACE_HEIGHT - 60);
    return;
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = color;
  ctx.font = "bold 96px serif";
  ctx.fillText(text, FACE_WIDTH / 2, FACE_HEIGHT / 2);
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fill();
}

/** 牌面を描いた CanvasTexture を作る。"0m" 等は赤五 */
export function createTileFaceTexture(tile: Tile): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = FACE_WIDTH;
  canvas.height = FACE_HEIGHT;
  const ctx = canvas.getContext("2d")!;
  drawBase(ctx);

  const red = tile[0] === "0";
  const number = red ? 5 : Number(tile[0]);
  const suit = tile[1];
  if (suit === "m") drawMan(ctx, number, red);
  else if (suit === "p") drawPin(ctx, number, red);
  else if (suit === "s") drawSou(ctx, number, red);
  else if (suit === "z") drawHonor(ctx, tile);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}
