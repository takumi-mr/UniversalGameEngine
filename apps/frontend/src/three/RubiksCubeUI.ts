// src/three/RubiksCubeUI.ts
import * as THREE from "three";
import type { RubiksState, RubiksAction, FaceName } from "@engine/shared/rules/RubicCubeRuleset";
import { BaseThreeUI } from "./BaseThreeUI";

type Color = "W" | "Y" | "G" | "B" | "O" | "R";

// 標準色マップ: ルービックキューブの色に合わせた鮮やかな色
const CUBE_COLORS: Record<Color, number> = {
  W: 0xfafafa, // 白 (Top)
  Y: 0xfce844, // 黄 (Bottom)
  G: 0x2dca44, // 緑 (Front)
  B: 0x1e6ef6, // 青 (Back)
  O: 0xff8c00, // 橙 (Left)
  R: 0xe63232, // 赤 (Right)
};

// Rubik's Cubeの26個のキューブレット(中心除く)
// 各ステッカーはfaceの法線方向で決まる
// faceの配置: U=Y+, D=Y-, F=Z+, B=Z-, R=X+, L=X-
const FACE_NORMALS: Record<FaceName, THREE.Vector3> = {
  U: new THREE.Vector3(0, 1, 0),
  D: new THREE.Vector3(0, -1, 0),
  F: new THREE.Vector3(0, 0, 1),
  B: new THREE.Vector3(0, 0, -1),
  R: new THREE.Vector3(1, 0, 0),
  L: new THREE.Vector3(-1, 0, 0),
};

// 各面を「外側から見た」ときの上方向・右方向（RubicCubeRuleset の展開図規約と一致させる）
//   U: 上から見て上側が B、D: 下から見て上側が F、F/B/L/R: 上側が U
const FACE_UP: Record<FaceName, THREE.Vector3> = {
  U: new THREE.Vector3(0, 0, -1),
  D: new THREE.Vector3(0, 0, 1),
  F: new THREE.Vector3(0, 1, 0),
  B: new THREE.Vector3(0, 1, 0),
  R: new THREE.Vector3(0, 1, 0),
  L: new THREE.Vector3(0, 1, 0),
};
const FACE_RIGHT: Record<FaceName, THREE.Vector3> = {
  U: new THREE.Vector3(1, 0, 0),
  D: new THREE.Vector3(1, 0, 0),
  F: new THREE.Vector3(1, 0, 0),
  B: new THREE.Vector3(-1, 0, 0),
  R: new THREE.Vector3(0, 0, -1),
  L: new THREE.Vector3(0, 0, 1),
};

// ステッカーの3x3グリッドマッピング (行=row, 列=col -> position)
// state.faces[face][row][col] は面を外側から見て row 0 が上、col 0 が左
const STICKER_GRID_POSITIONS: Record<FaceName, (row: number, col: number) => THREE.Vector3> = {
  U: (r, c) => new THREE.Vector3(-1 + c, 1.5, -1 + r), // Y+面: row 0 が B 側 (z=-1)
  D: (r, c) => new THREE.Vector3(-1 + c, -1.5, 1 - r), // Y-面: row 0 が F 側 (z=+1)
  F: (r, c) => new THREE.Vector3(-1 + c, 1 - r, 1.5), // Z+面
  B: (r, c) => new THREE.Vector3(1 - c, 1 - r, -1.5), // Z-面: col 0 が R 側
  R: (r, c) => new THREE.Vector3(1.5, 1 - r, 1 - c), // X+面: col 0 が F 側
  L: (r, c) => new THREE.Vector3(-1.5, 1 - r, -1 + c), // X-面: col 0 が B 側
};

// 回転ボタンパネルの配置
const PANEL_SIZE = 2.7; // 面全体をカバーする一辺の長さ
const PANEL_HALF_WIDTH = PANEL_SIZE / 2; // 左右半分ずつ CW / CCW に割り当てる
const PANEL_OFFSET = 1.6; // ステッカー面 (1.5 + 厚み) のすぐ外側
const PANEL_IDLE_OPACITY = 0.18;
const PANEL_HOVER_OPACITY = 0.7;

// 回転ボタン用の矢印テクスチャ（↻ / ↺）を Canvas で描く
function createArrowTexture(dir: 1 | -1, tint: string): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = tint;
  ctx.fillRect(0, 0, size, size);

  const cx = size / 2;
  const cy = size / 2;
  const radius = size * 0.26;
  // Canvas は y が下向きなので、角度が増える向き = 画面上の時計回り
  const start = dir === 1 ? Math.PI * 0.75 : Math.PI * 0.25;
  const end = dir === 1 ? Math.PI * 2.25 : -Math.PI * 1.25;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = size * 0.07;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(cx, cy, radius, start, end, dir === -1);
  ctx.stroke();

  // 矢じり: 弧の終点で進行方向を向ける
  const tip = new THREE.Vector2(cx + radius * Math.cos(end), cy + radius * Math.sin(end));
  const tangent = new THREE.Vector2(-Math.sin(end), Math.cos(end)).multiplyScalar(dir);
  const normal = new THREE.Vector2(-tangent.y, tangent.x);
  const headLen = size * 0.14;
  const headWidth = size * 0.1;
  const head = tip.clone().addScaledVector(tangent, headLen);
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.moveTo(head.x, head.y);
  ctx.lineTo(tip.x + normal.x * headWidth, tip.y + normal.y * headWidth);
  ctx.lineTo(tip.x - normal.x * headWidth, tip.y - normal.y * headWidth);
  ctx.closePath();
  ctx.fill();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export class RubiksCubeUI extends BaseThreeUI {
  private onAction: (action: RubiksAction) => void;

  // ステッカーメッシュのリスト: [face][row][col] -> Mesh
  private stickers: Map<string, THREE.Mesh> = new Map();
  private stickerGeom = new THREE.BoxGeometry(0.85, 0.05, 0.85);
  // クリック可能な면 ボタンメッシュ
  private facePanels: { face: FaceName; dir: 1 | -1; mesh: THREE.Mesh }[] = [];

  private hoveredPanel: THREE.Mesh | null = null;

  constructor(container: HTMLElement, onActionCallback: (action: RubiksAction) => void) {
    super(container, {
      fov: 55,
      cameraPosition: [5.5, 5.5, 5.5],
      background: 0x111827,
      shadowMap: true,
      pixelRatio: window.devicePixelRatio,
    });
    this.onAction = onActionCallback;

    const controls = this.controls!;
    controls.dampingFactor = 0.08;
    controls.minDistance = 4;
    controls.maxDistance = 20;

    // ライティング
    const ambient = new THREE.AmbientLight(0xffffff, 0.5);
    this.scene.add(ambient);
    const dir1 = new THREE.DirectionalLight(0xffffff, 1.2);
    dir1.position.set(8, 10, 8);
    dir1.castShadow = true;
    this.scene.add(dir1);
    const dir2 = new THREE.DirectionalLight(0x8888ff, 0.4);
    dir2.position.set(-8, -5, -8);
    this.scene.add(dir2);

    const canvas = this.renderer.domElement;
    this.addListener(canvas, "pointerdown", this.onPointerDown.bind(this));
    this.addListener(canvas, "pointerup", this.onPointerUp.bind(this));
    this.addListener(canvas, "pointermove", this.onMouseMove.bind(this));

    this.buildCube();
    this.buildFacePanels();
  }

  private buildCube() {
    // 3x3x3のキューブレット本体(黒いベース)を作成
    const cubeletGeom = new THREE.BoxGeometry(0.92, 0.92, 0.92);
    for (let x = -1; x <= 1; x++) {
      for (let y = -1; y <= 1; y++) {
        for (let z = -1; z <= 1; z++) {
          if (x === 0 && y === 0 && z === 0) continue; // 中心は不要
          const mat = new THREE.MeshStandardMaterial({
            color: 0x111111,
            roughness: 0.6,
          });
          const mesh = new THREE.Mesh(cubeletGeom, mat);
          mesh.position.set(x, y, z);
          this.scene.add(mesh);
        }
      }
    }
  }

  private buildFacePanels() {
    // 各面を左右半分に分け、左半分=反時計回り(↺)・右半分=時計回り(↻) の「回転ボタン」パネルを配置する
    // （面を外側から見た向きで左右を決める）
    const faces: FaceName[] = ["U", "D", "F", "B", "R", "L"];
    const panelGeom = new THREE.PlaneGeometry(PANEL_HALF_WIDTH, PANEL_SIZE);
    const textures = {
      1: createArrowTexture(1, "rgba(0, 204, 255, 0.45)"),
      [-1]: createArrowTexture(-1, "rgba(255, 102, 0, 0.45)"),
    } as const;

    for (const face of faces) {
      const normal = FACE_NORMALS[face];
      const up = FACE_UP[face];
      const right = FACE_RIGHT[face];
      // PlaneGeometry のローカル +x を「右」、+y を「上」、+z を法線に合わせる
      const orientation = new THREE.Matrix4().makeBasis(right, up, normal);

      for (const dir of [1, -1] as const) {
        const mat = new THREE.MeshBasicMaterial({
          map: textures[dir],
          side: THREE.FrontSide, // カメラから見えない裏側の面はクリック対象外にする
          transparent: true,
          opacity: PANEL_IDLE_OPACITY,
          depthWrite: false,
        });
        const mesh = new THREE.Mesh(panelGeom, mat);

        // ステッカーのすぐ外側に、左右にずらして配置
        mesh.position
          .copy(normal)
          .multiplyScalar(PANEL_OFFSET)
          .addScaledVector(right, (dir * PANEL_HALF_WIDTH) / 2);
        mesh.setRotationFromMatrix(orientation);
        mesh.userData = { face, dir, isFacePanel: true };

        this.scene.add(mesh);
        this.facePanels.push({ face, dir, mesh });
      }
    }
  }

  public renderState(state: RubiksState) {
    // 既存ステッカーを一旦全部削除して新たに描画
    this.stickers.forEach((m) => {
      this.scene.remove(m);
      (m.material as THREE.Material).dispose();
    });
    this.stickers.clear();

    const stickerGeom = this.stickerGeom;
    const faces: FaceName[] = ["U", "D", "F", "B", "R", "L"];

    for (const face of faces) {
      const grid = state.faces[face];
      if (!grid) continue;

      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          const colorKey = grid[r][c] as Color;
          const hexColor = CUBE_COLORS[colorKey] ?? 0x888888;

          const mat = new THREE.MeshStandardMaterial({
            color: hexColor,
            roughness: 0.3,
            metalness: 0.1,
            emissive: new THREE.Color(hexColor).multiplyScalar(0.05),
          });

          const sticker = new THREE.Mesh(stickerGeom, mat);
          const pos = STICKER_GRID_POSITIONS[face](r, c);
          sticker.position.copy(pos);

          // ステッカーを面の法線方向に向ける
          if (face === "U" || face === "D") {
            sticker.rotation.set(0, 0, 0);
          } else if (face === "F" || face === "B") {
            sticker.rotation.set(Math.PI / 2, 0, 0);
          } else {
            sticker.rotation.set(0, 0, Math.PI / 2);
          }

          this.scene.add(sticker);
          this.stickers.set(`${face}-${r}-${c}`, sticker);
        }
      }
    }
  }

  private onMouseMove(event: MouseEvent) {
    this.updateMouse(event);
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const panelMeshes = this.facePanels.map((p) => p.mesh);
    const hits = this.raycaster.intersectObjects(panelMeshes);

    if (hits.length > 0) {
      const hit = hits[0].object as THREE.Mesh;
      if (this.hoveredPanel !== hit) {
        this.setPanelOpacity(this.hoveredPanel, PANEL_IDLE_OPACITY);
        this.hoveredPanel = hit;
        this.setPanelOpacity(this.hoveredPanel, PANEL_HOVER_OPACITY);
        this.renderer.domElement.style.cursor = "pointer";
      }
    } else {
      if (this.hoveredPanel) {
        this.setPanelOpacity(this.hoveredPanel, PANEL_IDLE_OPACITY);
        this.hoveredPanel = null;
        this.renderer.domElement.style.cursor = "default";
      }
    }
  }

  private setPanelOpacity(panel: THREE.Mesh | null, opacity: number) {
    if (!panel) return;
    (panel.material as THREE.MeshBasicMaterial).opacity = opacity;
  }

  private pointerDownPos = new THREE.Vector2();

  private onPointerDown(event: PointerEvent) {
    this.pointerDownPos.set(event.clientX, event.clientY);
  }

  private onPointerUp(event: PointerEvent) {
    // ドラッグ（視点回転）とクリックを区別する
    const dragDist = Math.hypot(
      event.clientX - this.pointerDownPos.x,
      event.clientY - this.pointerDownPos.y,
    );
    if (dragDist > 5) return; // 5px以上動いたらドラッグとみなす

    this.updateMouse(event);
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const panelMeshes = this.facePanels.map((p) => p.mesh);
    const hits = this.raycaster.intersectObjects(panelMeshes);

    if (hits.length > 0) {
      const { face, dir } = hits[0].object.userData;
      const action: RubiksAction = { type: "ROTATE", face, direction: dir };
      this.onAction(action);
    }
  }
}
