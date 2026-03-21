import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { ShogiState, ShogiAction } from "@engine/shared/rules/ShogiRuleset";

export class Shogi3DUI {
  private onAction: (action: ShogiAction) => void;
  private onRequirePromotion: (from: number, to: number) => void;
  private container: HTMLElement;

  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private renderer!: THREE.WebGLRenderer;
  private controls!: OrbitControls;
  private raycaster!: THREE.Raycaster;
  private mouse!: THREE.Vector2;

  private boardGroup = new THREE.Group();
  private piecesGroup = new THREE.Group();
  private highlightGroup = new THREE.Group();

  private pieceMeshes: Map<number, THREE.Object3D> = new Map(); // fromIndex -> Object3D
  private cellMeshes: THREE.Mesh[] = [];

  private currentState: ShogiState | null = null;
  private selectedIndex: number | null = null; // index on board or -1 for hand (not yet implemented for hand)
  private animationId: number | null = null;
  private isDisposed = false;

  private loader = new GLTFLoader();
  private modelCache: Map<string, THREE.Object3D> = new Map();

  constructor(
    container: HTMLElement,
    onActionCallback: (action: ShogiAction) => void,
    onRequirePromotion: (from: number, to: number) => void,
  ) {
    this.container = container;
    this.onAction = onActionCallback;
    this.onRequirePromotion = onRequirePromotion;
    this.initThreeJS(container);
  }

  private initThreeJS(container: HTMLElement) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x050505);
    this.scene.fog = new THREE.Fog(0x050505, 10, 50);

    this.camera = new THREE.PerspectiveCamera(
      60,
      container.clientWidth / container.clientHeight,
      0.1,
      1000,
    );
    this.camera.position.set(0, 10, 12);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0, 0);
    this.controls.enableDamping = true;

    // Lights
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.4));
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x000000, 0.8);
    this.scene.add(hemiLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
    dirLight.position.set(5, 12, 8);
    dirLight.castShadow = true;
    this.scene.add(dirLight);

    const backLight = new THREE.DirectionalLight(0xffffff, 0.8);
    backLight.position.set(-5, 5, -5);
    this.scene.add(backLight);

    this.scene.add(this.boardGroup);
    this.scene.add(this.piecesGroup);
    this.scene.add(this.highlightGroup);

    this.initBoard();
    this.initEnvironment();

    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

    this.onClick = this.onClick.bind(this);
    this.onResize = this.onResize.bind(this);
    window.addEventListener("click", this.onClick, false);
    window.addEventListener("resize", this.onResize, false);

    this.animate();
  }

  private initBoard() {
    const squareSize = 1;
    const offset = 4; // 9x9 board -> offset 4

    const boardMat = new THREE.MeshLambertMaterial({ color: 0xdeb887 });

    for (let i = 0; i < 81; i++) {
      const x = (i % 9) - offset;
      const z = Math.floor(i / 9) - offset;

      const geom = new THREE.BoxGeometry(squareSize * 0.95, 0.2, squareSize * 0.95);
      const square = new THREE.Mesh(geom, boardMat);
      square.position.set(x, -0.1, z);
      square.receiveShadow = true;
      square.userData = { index: i, type: "cell" };

      this.boardGroup.add(square);
      this.cellMeshes[i] = square;
    }
  }

  private initEnvironment() {
    const floorGeom = new THREE.PlaneGeometry(100, 100);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x1a1a1a,
      roughness: 0.8,
      metalness: 0.2,
    });
    const floor = new THREE.Mesh(floorGeom, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.21;
    floor.receiveShadow = true;
    this.scene.add(floor);

    const grid = new THREE.GridHelper(40, 40, 0x444444, 0x222222);
    grid.position.y = -0.2;
    this.scene.add(grid);
  }

  public async renderState(state: ShogiState) {
    this.currentState = state;

    this.piecesGroup.clear();
    this.pieceMeshes.clear();

    const offset = 4;

    // Pre-load unique models
    const uniquePieces = new Set<number>();
    for (const val of state.board) {
      if (val !== 0) uniquePieces.add(val);
    }

    for (const val of uniquePieces) {
      await this.getOrLoadModel(val);
    }

    for (let i = 0; i < 81; i++) {
      const val = state.board[i];
      if (val !== 0) {
        const x = (i % 9) - offset;
        const z = Math.floor(i / 9) - offset;

        const pieceObj = await this.createPieceObject(val);
        pieceObj.position.set(x, 0, z);
        pieceObj.userData = { index: i, type: "piece", value: val };
        this.piecesGroup.add(pieceObj);
        this.pieceMeshes.set(i, pieceObj);
      }
    }

    this.updateHighlights();
  }

  private async getOrLoadModel(val: number): Promise<THREE.Object3D | null> {
    const type = Math.abs(val);
    const color = Math.sign(val);
    const typeMap: Record<number, string> = {
      1: "fu",
      2: "ky",
      3: "ke",
      4: "gi",
      5: "ki",
      6: "ka",
      7: "hi",
      8: "ou",
      9: "to",
      10: "ny",
      11: "nk",
      12: "ng",
      13: "um",
      14: "ry",
    };
    const pieceName = typeMap[type];
    const cacheKey = `${pieceName}_${color}`;

    if (this.modelCache.has(cacheKey)) {
      return this.modelCache.get(cacheKey)!;
    }

    const modelPath = `/assets/games/shogi/models/${pieceName}.glb?v=${Date.now()}`;

    try {
      const gltf = await this.loader.loadAsync(modelPath);
      const scene = gltf.scene;

      const meshes: THREE.Mesh[] = [];
      scene.traverse((node) => {
        if (node instanceof THREE.Mesh) {
          if (
            node.name.toLowerCase().includes("floor") ||
            node.name.toLowerCase().includes("plane")
          ) {
            return;
          }
          meshes.push(node);
        }
      });

      const group = new THREE.Group();
      const box = new THREE.Box3().setFromObject(scene);
      const center = box.getCenter(new THREE.Vector3());
      const bottom = box.min.y;

      if (meshes.length > 0) {
        meshes.forEach((m) => {
          const clone = m.clone();
          clone.position.x -= center.x;
          clone.position.y -= bottom;
          clone.position.z -= center.z;
          group.add(clone);
        });
      } else {
        const sceneClone = scene.clone();
        sceneClone.position.x -= center.x;
        sceneClone.position.y -= bottom;
        sceneClone.position.z -= center.z;
        group.add(sceneClone);
      }

      const glassMaterial = new THREE.MeshPhysicalMaterial({
        color: color === 1 ? 0xffffff : 0x111111,
        metalness: 0.1,
        roughness: 0.05,
        transmission: 0.95,
        thickness: 2.0,
        ior: 1.5,
        reflectivity: 0.8,
        transparent: true,
        opacity: 0.7,
        attenuationColor: color === 1 ? 0xfff0d0 : 0x001030,
        attenuationDistance: 0.4,
        clearcoat: 1.0,
        clearcoatRoughness: 0.05,
      });

      group.traverse((node) => {
        if (node instanceof THREE.Mesh) {
          node.material = glassMaterial;
          node.castShadow = true;
          node.receiveShadow = true;
        }
      });

      const finalBox = new THREE.Box3().setFromObject(group);
      const size = finalBox.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.z);
      const scale = 0.8 / (maxDim || 1);
      group.scale.set(scale, scale, scale);

      if (color === -1) {
        group.rotation.y = Math.PI;
      }

      this.modelCache.set(cacheKey, group);
      return group;
    } catch (e) {
      console.warn(`Failed to load shogi model: ${modelPath}`, e);
      const placeholder = this.createPlaceholderPiece(type, color);
      this.modelCache.set(cacheKey, placeholder);
      return placeholder;
    }
  }

  private createPlaceholderPiece(type: number, color: number): THREE.Object3D {
    const group = new THREE.Group();
    const geom = new THREE.BoxGeometry(0.7, 0.15, 0.85);
    const mat = new THREE.MeshPhysicalMaterial({
      color: color === 1 ? 0xffffff : 0x222222,
      transmission: 0.5,
      transparent: true,
      thickness: 0.5,
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.y = 0.075;
    mesh.castShadow = true;
    group.add(mesh);

    if (color === -1) {
      group.rotation.y = Math.PI;
    }
    return group;
  }

  private async createPieceObject(val: number): Promise<THREE.Object3D> {
    const model = await this.getOrLoadModel(val);
    return model ? model.clone() : new THREE.Group();
  }

  private updateHighlights() {
    this.highlightGroup.clear();
    if (this.selectedIndex === null || !this.currentState) return;

    const offset = 4;
    const x = (this.selectedIndex % 9) - offset;
    const z = Math.floor(this.selectedIndex / 9) - offset;

    const geom = new THREE.PlaneGeometry(0.9, 0.9);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffff33,
      transparent: true,
      opacity: 0.5,
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.01, z);
    this.highlightGroup.add(mesh);
  }

  private onClick(event: MouseEvent) {
    if (!this.currentState || this.currentState.status !== "PLAYING") return;

    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const intersects = this.raycaster.intersectObjects(
      [...this.cellMeshes, ...Array.from(this.pieceMeshes.values())],
      true,
    );

    if (intersects.length > 0) {
      let hit: THREE.Object3D | null = intersects[0].object;
      while (hit && hit.userData.index === undefined) {
        hit = hit.parent;
      }

      if (!hit) return;
      const index = hit.userData.index;

      if (this.selectedIndex === null) {
        const val = this.currentState.board[index];
        if (val !== 0 && Math.sign(val) === this.currentState.turn) {
          this.selectedIndex = index;
          this.updateHighlights();
        }
      } else {
        if (this.selectedIndex === index) {
          this.selectedIndex = null;
          this.updateHighlights();
          return;
        }

        const targetVal = this.currentState.board[index];
        if (targetVal !== 0 && Math.sign(targetVal) === this.currentState.turn) {
          this.selectedIndex = index;
          this.updateHighlights();
        } else {
          this.handleMoveAttempt(this.selectedIndex, index);
          this.selectedIndex = null;
          this.updateHighlights();
        }
      }
    } else {
      this.selectedIndex = null;
      this.updateHighlights();
    }
  }

  private handleMoveAttempt(from: number, to: number) {
    if (!this.currentState) return;

    const piece = this.currentState.board[from];
    const type = Math.abs(piece);
    const turn = this.currentState.turn;
    const fromY = Math.floor(from / 9);
    const toY = Math.floor(to / 9);

    // Basic Shogi promotion check
    const isPromotionZone = turn === 1 ? fromY <= 2 || toY <= 2 : fromY >= 6 || toY >= 6;
    const canPromote = type <= 7 && type !== 5 && isPromotionZone;

    if (canPromote) {
      this.onRequirePromotion(from, to);
    } else {
      this.onAction({ type: "MOVE", from, to });
    }
  }

  private onResize() {
    this.camera.aspect = this.container.clientWidth / this.container.clientHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
  }

  private animate() {
    if (this.isDisposed) return;
    this.animationId = requestAnimationFrame(this.animate.bind(this));
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  public dispose() {
    this.isDisposed = true;
    if (this.animationId) cancelAnimationFrame(this.animationId);
    window.removeEventListener("click", this.onClick);
    window.removeEventListener("resize", this.onResize);
    this.renderer.dispose();
  }
}
