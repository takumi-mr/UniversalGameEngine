// src/three/MahjongUI.ts
//
// リーチ麻雀の卓を Three.js で描く。1 局分の MahjongState（マスク済み）を受け取り、
// 自分を手前（+Z）に置いて 4 家の手牌・河・副露・ドラ表示牌・立直棒を配置する。
// 操作は自分の手牌クリックだけで、打牌か立直かの判断や操作ボタンは Vue 側が担当する。
//
// 牌は /assets/games/mahjong/models/<kind>.glb（1m..9m, 1p.., 1s.., 1z..7z, 赤五 0m/0p/0s, 裏面 back）を
// 読み込む。規約: 立てた状態で牌面が +Z、幅が X、高さが Y。読み込めない牌は
// 手続き描画の牌面テクスチャを貼った箱で代用する（public/assets/games/mahjong/models/README.md 参照）。
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { MahjongState, Meld, Tile } from "@engine/shared/rules/mahjong/MahjongRuleset";
import { TILE_KINDS, tileFromIndex } from "@engine/shared/rules/mahjong/MahjongTiles";
import { revealed } from "@/utils/revealed";
import { BaseThreeUI } from "./BaseThreeUI";
import { createTileFaceTexture } from "./mahjongTileTexture";

const MODEL_DIR = "/assets/games/mahjong/models";
const BACK = "back";
const MODEL_KINDS = [
  ...Array.from({ length: TILE_KINDS }, (_, i) => tileFromIndex(i)),
  "0m",
  "0p",
  "0s",
  BACK,
];

/** 牌の幅は固定し、高さ・厚みはモデルの比率に従う（フォールバック時は既定値） */
const TILE_W = 0.62;
const DEFAULT_TILE_H = 0.85;
const DEFAULT_TILE_D = 0.42;
const TILE_GAP = 0.03;
const TSUMO_GAP = 0.3;

const HAND_Z = 6.8;
const DISCARD_Z = 2.3;
const DISCARDS_PER_ROW = 6;
const DISCARD_ROWS = 3;
const RIICHI_STICK_Z = 1.75;
const DORA_Z = -0.5;
const DORA_SLOTS = 5;
const HIGHLIGHT_LIFT = 0.1;
const HOVER_LIFT = 0.25;
/** 自分の手牌はカメラから牌面が見えるよう少し後ろへ倒す */
const VIEWER_HAND_LEAN = 0.55;

export interface MahjongRenderOptions {
  /** クリックできる自分の手牌（打牌・立直宣言できる牌）。空なら操作不可 */
  selectableTiles?: Tile[];
}

interface RenderRequest {
  state: MahjongState;
  viewerId: string;
  options: MahjongRenderOptions;
}

export class MahjongUI extends BaseThreeUI {
  private onTileClick: (tile: Tile, index: number) => void;

  /** モデル読み込み完了。renderState はこれを待ってから描く */
  public readonly ready: Promise<void>;
  private loader = new GLTFLoader();
  /** 牌種 → 正規化済みモデル（中心が原点、幅 TILE_W）。clone して使う */
  private models = new Map<string, THREE.Object3D>();
  private tileH = DEFAULT_TILE_H;
  private tileD = DEFAULT_TILE_D;
  private pendingRender: RenderRequest | null = null;

  // フォールバック用
  private placeholderGeom: THREE.BoxGeometry | null = null;
  private matSide = new THREE.MeshStandardMaterial({ color: 0xf7f3e8, roughness: 0.35 });
  private matBack = new THREE.MeshStandardMaterial({ color: 0x1f6b3a, roughness: 0.5 });
  private faceMaterials = new Map<Tile, THREE.MeshStandardMaterial>();

  private highlightGeom = new THREE.PlaneGeometry(TILE_W, 0.22);
  private matHighlight = new THREE.MeshBasicMaterial({
    color: 0x4dd0e1,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  });

  /** 局ごとに作り直す牌・棒のグループ */
  private tableGroup = new THREE.Group();
  /** 自分の手牌（クリック判定用） */
  private handTiles: THREE.Object3D[] = [];
  private hovered: THREE.Object3D | null = null;
  private pointerDownPos = new THREE.Vector2();

  constructor(container: HTMLElement, onTileClick: (tile: Tile, index: number) => void) {
    super(container, {
      fov: 45,
      cameraPosition: [0, 15, 13],
      background: 0x101418,
      shadowMap: true,
    });
    this.onTileClick = onTileClick;

    const controls = this.controls!;
    controls.target.set(0, 0, 1);
    controls.minDistance = 10;
    controls.maxDistance = 26;
    controls.maxPolarAngle = Math.PI / 2 - 0.2;
    controls.enablePan = false;

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
    dirLight.position.set(5, 14, 6);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.set(2048, 2048);
    dirLight.shadow.camera.left = -12;
    dirLight.shadow.camera.right = 12;
    dirLight.shadow.camera.top = 12;
    dirLight.shadow.camera.bottom = -12;
    this.scene.add(dirLight);

    this.buildTable();
    this.scene.add(this.tableGroup);

    const canvas = this.renderer.domElement;
    this.addListener(canvas, "pointerdown", this.onPointerDown.bind(this));
    this.addListener(canvas, "pointerup", this.onPointerUp.bind(this));
    this.addListener(canvas, "pointermove", this.onPointerMove.bind(this));

    this.ready = this.preloadModels();
  }

  private buildTable() {
    const table = new THREE.Mesh(
      new THREE.BoxGeometry(20, 0.6, 20),
      new THREE.MeshStandardMaterial({ color: 0x1b5e3a, roughness: 0.9 }),
    );
    table.position.y = -0.3;
    table.receiveShadow = true;
    this.scene.add(table);

    const rim = new THREE.Mesh(
      new THREE.BoxGeometry(21, 0.5, 21),
      new THREE.MeshStandardMaterial({ color: 0x3e2723, roughness: 0.8 }),
    );
    rim.position.y = -0.45;
    rim.receiveShadow = true;
    this.scene.add(rim);
  }

  // --- 牌モデル ---

  private async preloadModels() {
    const results = await Promise.allSettled(MODEL_KINDS.map((kind) => this.loadModel(kind)));
    if (this.isDisposed) return;
    const missing = MODEL_KINDS.filter((_, i) => results[i].status === "rejected");
    if (missing.length > 0) {
      console.warn(
        `[MahjongUI] ${missing.length}/${MODEL_KINDS.length} tile models not found under ${MODEL_DIR}; using placeholders for: ${missing.join(", ")}`,
      );
    }
  }

  private async loadModel(kind: string) {
    const gltf = await this.loader.loadAsync(`${MODEL_DIR}/${kind}.glb`);
    const scene = gltf.scene;
    const box = new THREE.Box3().setFromObject(scene);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const scale = TILE_W / (size.x || 1);

    // 中心を原点に寄せ、幅を TILE_W に揃える。高さ・厚みは最初に読めたモデルに合わせる
    scene.position.sub(center);
    scene.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        node.castShadow = true;
        node.receiveShadow = true;
      }
    });
    const model = new THREE.Group();
    model.add(scene);
    model.scale.setScalar(scale);
    if (this.models.size === 0) {
      this.tileH = size.y * scale || DEFAULT_TILE_H;
      this.tileD = size.z * scale || DEFAULT_TILE_D;
    }
    this.models.set(kind, model);
  }

  private faceMaterial(tile: Tile): THREE.MeshStandardMaterial {
    let mat = this.faceMaterials.get(tile);
    if (!mat) {
      mat = new THREE.MeshStandardMaterial({ map: createTileFaceTexture(tile), roughness: 0.35 });
      this.faceMaterials.set(tile, mat);
    }
    return mat;
  }

  /** モデルが無い牌の代用: 牌面テクスチャを貼った箱（face が +Z、back が -Z） */
  private placeholderTile(tile: Tile | "?"): THREE.Mesh {
    this.placeholderGeom ??= new THREE.BoxGeometry(TILE_W, this.tileH, this.tileD);
    const face = tile === "?" ? this.matBack : this.faceMaterial(tile);
    const mesh = new THREE.Mesh(this.placeholderGeom, [
      this.matSide,
      this.matSide,
      this.matSide,
      this.matSide,
      face,
      this.matBack,
    ]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  private createTile(tile: Tile | "?"): THREE.Object3D {
    const model = this.models.get(tile === "?" ? BACK : tile);
    return model ? model.clone() : this.placeholderTile(tile);
  }

  /** 立てた牌（自分の方を向く）。lean で後ろへ倒す（下辺が卓に着くよう高さを補正） */
  private standingTile(tile: Tile | "?", x: number, z: number, lean = 0): THREE.Object3D {
    const obj = this.createTile(tile);
    const y = (this.tileH / 2) * Math.cos(lean) + (this.tileD / 2) * Math.sin(lean);
    obj.position.set(x, y, z);
    obj.rotation.x = -lean;
    return obj;
  }

  /**
   * 寝かせた牌。faceUp=false で裏向き、sideways=true で横向き（鳴いた牌）。
   * Euler XYZ は Z → Y → X の順に掛かるので、先に牌面内で 90° 回してから倒す
   */
  private flatTile(tile: Tile | "?", x: number, z: number, faceUp = true, sideways = false) {
    const obj = this.createTile(tile);
    obj.position.set(x, this.tileD / 2, z);
    obj.rotation.set(faceUp ? -Math.PI / 2 : Math.PI / 2, 0, sideways ? Math.PI / 2 : 0);
    return obj;
  }

  // --- 描画 ---

  /** モデル読み込み前に呼ばれた場合は完了後に最後の状態だけ描く */
  public renderState(state: MahjongState, viewerId: string, options: MahjongRenderOptions = {}) {
    this.pendingRender = { state, viewerId, options };
    void this.ready.then(() => {
      const request = this.pendingRender;
      if (!request || this.isDisposed) return;
      this.pendingRender = null;
      this.build(request);
    });
  }

  private build({ state, viewerId, options }: RenderRequest) {
    this.tableGroup.clear();
    this.handTiles = [];
    this.hovered = null;

    const playerIds = state.playerIds ?? [];
    const viewerIndex = Math.max(0, playerIds.indexOf(viewerId));

    playerIds.forEach((playerId, index) => {
      const seat = new THREE.Group();
      // 下家（次の手番）が右に来るように、席順に応じて時計回りに回す
      seat.rotation.y = (((index - viewerIndex + 4) % 4) * Math.PI) / 2;
      this.buildSeat(seat, state, playerId, playerId === viewerId, options);
      this.tableGroup.add(seat);
    });

    this.buildCenter(state);
  }

  private buildSeat(
    seat: THREE.Group,
    state: MahjongState,
    playerId: string,
    isViewer: boolean,
    options: MahjongRenderOptions,
  ) {
    const hand = revealed<(Tile | "?")[]>(state.hands[playerId]) ?? [];
    const melds = state.melds[playerId] ?? [];
    const discards = state.discards[playerId] ?? [];

    // --- 手牌（自摸牌は末尾で、少し離す） ---
    const step = TILE_W + TILE_GAP;
    const hasTsumo = hand.length % 3 === 2;
    const handWidth = hand.length * step + (hasTsumo ? TSUMO_GAP : 0);
    // 副露がある分だけ手牌を左へ寄せる
    const meldsWidth = melds.reduce((sum, meld) => sum + this.meldWidth(meld) + 0.4, 0);
    const handStart = -handWidth / 2 - meldsWidth / 2;
    const selectable = new Set(options.selectableTiles ?? []);

    hand.forEach((tile, i) => {
      const tsumoGap = hasTsumo && i === hand.length - 1 ? TSUMO_GAP : 0;
      const x = handStart + i * step + step / 2 + tsumoGap;
      const obj = this.standingTile(tile, x, HAND_Z, isViewer ? VIEWER_HAND_LEAN : 0);
      seat.add(obj);
      if (!isViewer || tile === "?") return;

      const isSelectable = selectable.has(tile);
      if (isSelectable) obj.position.y += HIGHLIGHT_LIFT;
      obj.userData = { tile, index: i, selectable: isSelectable, baseY: obj.position.y };
      if (isSelectable) {
        const glow = new THREE.Mesh(this.highlightGeom, this.matHighlight);
        glow.rotation.x = -Math.PI / 2;
        glow.position.set(x, 0.01, HAND_Z + this.tileD / 2 + 0.18);
        seat.add(glow);
      }
      this.handTiles.push(obj);
    });

    // --- 副露（手牌の右に寝かせて並べる。鳴いた牌は横向き、暗槓は両端を裏向き） ---
    let meldX = handStart + handWidth + 0.4;
    for (const meld of melds) {
      meldX = this.buildMeld(seat, meld, meldX);
    }

    // --- 河（6 枚ずつ 3 段。溢れた分は最下段の右へ続ける） ---
    const rowStep = this.tileH + 0.04;
    discards.forEach((tile, i) => {
      const row = Math.min(Math.floor(i / DISCARDS_PER_ROW), DISCARD_ROWS - 1);
      const col = i - row * DISCARDS_PER_ROW;
      const x = (col - (DISCARDS_PER_ROW - 1) / 2) * step;
      seat.add(this.flatTile(tile, x, DISCARD_Z + row * rowStep + this.tileH / 2));
    });

    // --- 立直棒 ---
    if (state.riichi[playerId]) {
      const stick = new THREE.Mesh(
        new THREE.BoxGeometry(1.7, 0.07, 0.18),
        new THREE.MeshStandardMaterial({ color: 0xfafafa, roughness: 0.4 }),
      );
      stick.position.set(0, 0.035, RIICHI_STICK_Z);
      stick.castShadow = true;
      seat.add(stick);
      const dot = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05, 0.05, 0.02, 12),
        new THREE.MeshBasicMaterial({ color: 0xd32f2f }),
      );
      dot.position.set(0, 0.08, RIICHI_STICK_Z);
      seat.add(dot);
    }
  }

  private meldWidth(meld: Meld): number {
    if (meld.type === "ANKAN") return 4 * (TILE_W + TILE_GAP);
    return this.tileH + TILE_GAP + meld.consumed.length * (TILE_W + TILE_GAP);
  }

  /** 副露 1 組を x から右へ並べ、次の開始位置を返す */
  private buildMeld(seat: THREE.Group, meld: Meld, startX: number): number {
    const z = HAND_Z - 0.3;
    let x = startX;
    const place = (tile: Tile | "?", faceUp: boolean, sideways: boolean) => {
      const width = sideways ? this.tileH : TILE_W;
      seat.add(this.flatTile(tile, x + width / 2, z, faceUp, sideways));
      x += width + TILE_GAP;
    };

    if (meld.type === "ANKAN") {
      meld.consumed.forEach((tile, i) => place(tile, i === 1 || i === 2, false));
      return x + 0.4;
    }
    // 鳴いた牌を先頭に横向きで置き、手牌から出した牌を続ける
    place(meld.tile, true, true);
    for (const tile of meld.consumed) place(tile, true, false);
    return x + 0.4;
  }

  /** 卓の中央: ドラ表示牌（未公開分は裏向き） */
  private buildCenter(state: MahjongState) {
    const indicators = state.doraIndicators ?? [];
    const step = TILE_W + TILE_GAP;
    for (let i = 0; i < DORA_SLOTS; i++) {
      const x = (i - (DORA_SLOTS - 1) / 2) * step;
      const tile = indicators[i];
      this.tableGroup.add(this.flatTile(tile ?? "?", x, DORA_Z, tile !== undefined));
    }
  }

  // --- 操作 ---

  private pickHandTile(event: PointerEvent): THREE.Object3D | null {
    this.updateMouse(event);
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const hits = this.raycaster.intersectObjects(this.handTiles, true);
    // モデルは Group なので、牌情報を持つ親まで遡る
    let hit: THREE.Object3D | null = hits[0]?.object ?? null;
    while (hit && hit.userData.tile === undefined) hit = hit.parent;
    return hit && hit.userData.selectable ? hit : null;
  }

  private setHovered(obj: THREE.Object3D | null) {
    if (this.hovered === obj) return;
    if (this.hovered) this.hovered.position.y = this.hovered.userData.baseY;
    this.hovered = obj;
    if (obj) obj.position.y = obj.userData.baseY + HOVER_LIFT;
    this.renderer.domElement.style.cursor = obj ? "pointer" : "default";
  }

  private onPointerMove(event: PointerEvent) {
    this.setHovered(this.pickHandTile(event));
  }

  private onPointerDown(event: PointerEvent) {
    this.pointerDownPos.set(event.clientX, event.clientY);
  }

  private onPointerUp(event: PointerEvent) {
    // 視点操作のドラッグとクリックを区別する
    const dragDist = Math.hypot(
      event.clientX - this.pointerDownPos.x,
      event.clientY - this.pointerDownPos.y,
    );
    if (dragDist > 5) return;
    const obj = this.pickHandTile(event);
    if (!obj) return;
    this.setHovered(null);
    this.onTileClick(obj.userData.tile, obj.userData.index);
  }
}
