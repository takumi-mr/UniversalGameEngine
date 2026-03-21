// src/three/Mancala3DUI.ts
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { MancalaState, MancalaAction } from "@engine/shared/rules/MancalaRuleset";

export class MancalaUI {
  private container: HTMLElement;
  private onAction: (action: MancalaAction) => void;

  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private renderer!: THREE.WebGLRenderer;
  private controls!: OrbitControls;
  private raycaster!: THREE.Raycaster;
  private mouse!: THREE.Vector2;

  // メッシュの保持
  private pitMeshes: THREE.Mesh[] = [];
  private stoneMeshes: THREE.Mesh[] = []; // すべての石を管理
  private stonePool: THREE.Mesh[] = []; // 石のプール（パフォーマンス最適化）
  private myPlayerId: string;

  private currentState: MancalaState | null = null;

  // アニメーション管理
  private isAnimating = false;

  // イベントリスナーの参照（解除用）
  private onClickBound: (event: MouseEvent) => void;
  private onMouseMoveBound: (event: MouseEvent) => void;
  private onResizeBound: () => void;

  // --- マテリアルとジオメトリ ---

  // ボード（木製）
  private matBoard = new THREE.MeshStandardMaterial({
    color: 0x8b5a2b,
    roughness: 0.8,
    metalness: 0.1,
  });

  // ポケットの内部（暗がり）
  private matPitInterior = new THREE.MeshStandardMaterial({
    color: 0x3a2312,
    roughness: 1.0,
    metalness: 0.0,
  });

  // クリック可能なポケットのハイライト
  private matHighlight = new THREE.MeshBasicMaterial({
    color: 0xfbbf24,
    transparent: true,
    opacity: 0.3, // 通常時は薄く
    side: THREE.DoubleSide,
  });

  // ★おはじき（透明なガラス質）
  private matStone = new THREE.MeshPhysicalMaterial({
    color: 0xfbbf24,
    metalness: 0,
    roughness: 0.05,
    transmission: 0.95,
    ior: 1.5,
    thickness: 0.5,
    specularIntensity: 1,
    specularColor: 0xffffff,
    envMapIntensity: 1,
    transparent: true,
  });

  private geomStone = new THREE.SphereGeometry(0.12, 32, 16);

  constructor(
    container: HTMLElement,
    onActionCallback: (action: MancalaAction) => void,
    myPlayerId: string = "",
  ) {
    this.container = container;
    this.onAction = onActionCallback;
    this.myPlayerId = myPlayerId;
    this.geomStone.scale(1, 0.6, 1);

    // イベントハンドラのバインド
    this.onClickBound = this.onClick.bind(this);
    this.onMouseMoveBound = this.onMouseMove.bind(this);
    this.onResizeBound = this.onResize.bind(this);

    this.initThreeJS();
    this.initBoard();
    this.initStonePool();
    this.animate();
  }

  private initThreeJS() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1a1a);

    this.camera = new THREE.PerspectiveCamera(
      50,
      this.container.clientWidth / this.container.clientHeight,
      0.1,
      1000,
    );
    this.camera.position.set(0, 8, 5);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0, 0);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.1;

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.5));

    const spotLight = new THREE.SpotLight(0xffffff, 1);
    spotLight.position.set(5, 10, 5);
    spotLight.castShadow = true;
    spotLight.shadow.mapSize.width = 2048;
    spotLight.shadow.mapSize.height = 2048;
    this.scene.add(spotLight);

    const backLight = new THREE.PointLight(0xffffff, 0.5);
    backLight.position.set(-5, -2, -5);
    this.scene.add(backLight);

    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

    this.container.addEventListener("click", this.onClickBound, false);
    this.container.addEventListener("mousemove", this.onMouseMoveBound, false);
    window.addEventListener("resize", this.onResizeBound, false);
  }

  private initBoard() {
    const boardGeom = new THREE.BoxGeometry(8, 0.5, 3);
    const boardMesh = new THREE.Mesh(boardGeom, this.matBoard);
    boardMesh.position.y = -0.25;
    boardMesh.receiveShadow = true;
    this.scene.add(boardMesh);

    this.pitMeshes = Array(14).fill(null);

    const createPit = (
      index: number,
      x: number,
      z: number,
      r: number,
      h: number,
      isStore = false,
    ) => {
      const geom = new THREE.CylinderGeometry(r, r * 0.8, h, 32);
      const mesh = new THREE.Mesh(geom, this.matPitInterior);
      mesh.position.set(x, -h / 2 + 0.01, z);
      mesh.receiveShadow = true;
      this.scene.add(mesh);

      mesh.userData = { index, isStore, radius: r };
      this.pitMeshes[index] = mesh;

      // 2. クリック判定およびハイライト用のディスク（CircleGeometryに修正して判定を確実に）
      const highlightGeom = new THREE.CircleGeometry(r, 32);
      const highlightMesh = new THREE.Mesh(highlightGeom, this.matHighlight.clone()); // 各ポケットで個別のマテリアルにする（ホバー制御用）
      highlightMesh.rotation.x = -Math.PI / 2;
      highlightMesh.position.set(x, 0.02, z);
      highlightMesh.visible = false;
      highlightMesh.userData = { index, isHighlight: true };
      this.scene.add(highlightMesh);
    };

    for (let i = 0; i < 6; i++) createPit(i, i - 2.5, 0.8, 0.4, 0.3);
    createPit(6, 3.3, 0, 0.6, 0.3, true);
    for (let i = 0; i < 6; i++) createPit(12 - i, i - 2.5, -0.8, 0.4, 0.3);
    createPit(13, -3.3, 0, 0.6, 0.3, true);
  }

  private initStonePool() {
    for (let i = 0; i < 72; i++) {
      const stone = new THREE.Mesh(this.geomStone, this.matStone);
      stone.castShadow = true;
      stone.receiveShadow = true;
      stone.visible = false;
      this.scene.add(stone);
      this.stonePool.push(stone);
    }
  }

  private arrangeStonesInPit(pitIndex: number, count: number) {
    const pitMesh = this.pitMeshes[pitIndex];
    const { radius, isStore } = pitMesh.userData;
    const pitPos = pitMesh.position;

    const stonesInThisPit = this.stoneMeshes.filter((s) => s.userData.pitIndex === pitIndex);
    stonesInThisPit.forEach((s) => {
      s.visible = false;
      s.userData.pitIndex = -1;
    });
    this.stoneMeshes = this.stoneMeshes.filter((s) => s.userData.pitIndex !== pitIndex);

    for (let i = 0; i < count; i++) {
      let stone = this.stonePool.find((s) => !s.visible);
      if (!stone) {
        stone = new THREE.Mesh(this.geomStone, this.matStone);
        stone.castShadow = true;
        this.scene.add(stone);
        this.stonePool.push(stone);
      }

      stone.visible = true;
      stone.userData.pitIndex = pitIndex;
      this.stoneMeshes.push(stone);

      if (isStore) {
        const angle = Math.random() * Math.PI * 2;
        const r = Math.random() * radius * 0.7;
        stone.position.set(
          pitPos.x + Math.cos(angle) * r,
          0.05 + i * 0.02,
          pitPos.z + Math.sin(angle) * r,
        );
        stone.rotation.set(Math.random() * 0.2, Math.random() * Math.PI, Math.random() * 0.2);
      } else {
        const floor = Math.floor(i / 4);
        const indexInFloor = i % 4;
        const angle = indexInFloor * ((Math.PI * 2) / 4) + floor * 0.5;
        const r = radius * 0.5;

        stone.position.set(
          pitPos.x + Math.cos(angle) * r,
          0.05 + floor * 0.12,
          pitPos.z + Math.sin(angle) * r,
        );
        stone.rotation.set(-0.2, angle + Math.PI / 2, 0);
      }
    }
  }

  public renderState(state: MancalaState) {
    this.currentState = state;

    if (!this.isAnimating) {
      for (let i = 0; i < 14; i++) {
        this.arrangeStonesInPit(i, state.board[i]);
      }
    }

    this.scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh && obj.userData && obj.userData.isHighlight) {
        const index = obj.userData.index;
        const isP1Turn = state.turn === 1;
        const isP1Pit = index >= 0 && index <= 5;
        const isP2Pit = index >= 7 && index <= 12;

        if (
          state.status === "PLAYING" &&
          state.board[index] > 0 &&
          ((isP1Turn && isP1Pit) || (!isP1Turn && isP2Pit))
        ) {
          obj.visible = true;
        } else {
          obj.visible = false;
        }
      }
    });
  }

  private onMouseMove(event: MouseEvent) {
    if (!this.currentState || this.currentState.status !== "PLAYING" || this.isAnimating) return;

    // 自分のターンでない場合は何もしない
    const isMyTurn = this.currentState.players?.[this.currentState.turn] === this.myPlayerId;
    if (!isMyTurn) {
      this.container.style.cursor = "default";
      return;
    }

    const rect = this.container.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const highlights = this.scene.children.filter(
      (obj) => obj.userData && obj.userData.isHighlight && obj.visible,
    );
    const intersects = this.raycaster.intersectObjects(highlights);

    // すべてのハイライトをデフォルトに戻す
    highlights.forEach((h) => {
      if (h instanceof THREE.Mesh && h.material instanceof THREE.MeshBasicMaterial) {
        h.material.opacity = 0.3;
        h.material.color.set(0xfbbf24);
      }
    });

    if (intersects.length > 0) {
      const hit = intersects[0].object;
      if (hit instanceof THREE.Mesh && hit.material instanceof THREE.MeshBasicMaterial) {
        hit.material.opacity = 0.7; // ホバー時は明るく
        hit.material.color.set(0xffffff); // 白っぽく強調
        this.container.style.cursor = "pointer";
      }
    } else {
      this.container.style.cursor = "default";
    }
  }

  private onClick(event: MouseEvent) {
    if (!this.currentState || this.currentState.status !== "PLAYING" || this.isAnimating) return;

    const rect = this.container.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const highlights = this.scene.children.filter(
      (obj) => obj.userData && obj.userData.isHighlight && obj.visible,
    );
    const intersects = this.raycaster.intersectObjects(highlights);

    if (intersects.length > 0) {
      const pitIndex = intersects[0].object.userData.index;
      const currentPlayerId = this.currentState.players?.[this.currentState.turn] || "player1";

      this.onAction({
        type: "SOW",
        pitIndex,
        playerId: currentPlayerId,
      });
    }
  }

  private onResize() {
    if (!this.container) return;
    this.camera.aspect = this.container.clientWidth / this.container.clientHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
  }

  private animate() {
    requestAnimationFrame(this.animate.bind(this));
    if (this.controls) this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  public dispose() {
    this.container.removeEventListener("click", this.onClickBound);
    this.container.removeEventListener("mousemove", this.onMouseMoveBound);
    window.removeEventListener("resize", this.onResizeBound);
    this.renderer.dispose();
    this.geomStone.dispose();
    this.matBoard.dispose();
    this.matPitInterior.dispose();
    this.matHighlight.dispose();
    this.matStone.dispose();
  }
}
