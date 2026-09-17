// src/three/RubiksCubeUI.ts
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { RubiksState, RubiksAction, FaceName } from "@engine/shared/rules/RubicCubeRuleset";

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

export class RubiksCubeUI {
  private onAction: (action: RubiksAction) => void;
  private container: HTMLElement;

  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private renderer!: THREE.WebGLRenderer;
  private controls!: OrbitControls;

  // ステッカーメッシュのリスト: [face][row][col] -> Mesh
  private stickers: Map<string, THREE.Mesh> = new Map();
  private stickerGeom = new THREE.BoxGeometry(0.85, 0.05, 0.85);
  // クリック可能な면 ボタンメッシュ
  private facePanels: { face: FaceName; dir: 1 | -1; mesh: THREE.Mesh }[] = [];

  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();
  private hoveredPanel: THREE.Mesh | null = null;

  private animationId: number | null = null;
  private isDisposed = false;

  constructor(container: HTMLElement, onActionCallback: (action: RubiksAction) => void) {
    this.container = container;
    this.onAction = onActionCallback;

    this.onPointerDown = this.onPointerDown.bind(this);
    this.onPointerUp = this.onPointerUp.bind(this);
    this.onMouseMove = this.onMouseMove.bind(this);
    this.onResize = this.onResize.bind(this);

    this.initThreeJS(container);
    this.buildCube();
    this.buildFacePanels();
  }

  private initThreeJS(container: HTMLElement) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x111827);

    this.camera = new THREE.PerspectiveCamera(
      55,
      container.clientWidth / container.clientHeight,
      0.1,
      1000,
    );
    this.camera.position.set(5.5, 5.5, 5.5);
    this.camera.lookAt(0, 0, 0);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 4;
    this.controls.maxDistance = 20;

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

    this.renderer.domElement.addEventListener("pointerdown", this.onPointerDown);
    this.renderer.domElement.addEventListener("pointerup", this.onPointerUp);
    this.renderer.domElement.addEventListener("pointermove", this.onMouseMove);
    window.addEventListener("resize", this.onResize);

    this.animate();
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
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

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

    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const panelMeshes = this.facePanels.map((p) => p.mesh);
    const hits = this.raycaster.intersectObjects(panelMeshes);

    if (hits.length > 0) {
      const { face, dir } = hits[0].object.userData;
      const action: RubiksAction = { type: "ROTATE", face, direction: dir };
      this.onAction(action);
    }
  }

  private onResize() {
    if (!this.container) return;
    this.camera.aspect = this.container.clientWidth / this.container.clientHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
  }

  private animate() {
    if (this.isDisposed) return;
    this.animationId = requestAnimationFrame(this.animate.bind(this));
    if (this.controls) this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  public dispose() {
    this.isDisposed = true;
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
    }
    this.renderer.domElement.removeEventListener("pointerdown", this.onPointerDown);
    this.renderer.domElement.removeEventListener("pointerup", this.onPointerUp);
    this.renderer.domElement.removeEventListener("pointermove", this.onMouseMove);
    window.removeEventListener("resize", this.onResize);

    this.renderer.dispose();
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        if (Array.isArray(object.material)) {
          object.material.forEach((m) => m.dispose());
        } else {
          object.material.dispose();
        }
      }
    });

    if (this.container && this.renderer.domElement) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
