import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { GoState, GoAction } from "@engine/shared/rules/GoRuleset";

export class Go3DUI {
  private container: HTMLElement;
  private size: number;
  private onAction: (action: GoAction) => void;

  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private renderer!: THREE.WebGLRenderer;
  private controls!: OrbitControls;
  private raycaster!: THREE.Raycaster;
  private mouse!: THREE.Vector2;

  private stones: (THREE.Mesh | null)[] = [];
  private hitBoxes: THREE.Mesh[] = [];

  private currentState: GoState | null = null;
  private currentHovered: THREE.Mesh | null = null;
  private ghostStone: THREE.Mesh | null = null;

  private animationId: number | null = null;
  private isDisposed = false;

  // --- マテリアルとジオメトリ ---
  private matBoard = new THREE.MeshLambertMaterial({ color: 0xdeb887 }); // 碁盤（木目調）
  private matLine = new THREE.LineBasicMaterial({ color: 0x3e2723 }); // 線
  private matBlack = new THREE.MeshPhongMaterial({
    color: 0x111111,
    shininess: 80,
  });
  private matWhite = new THREE.MeshPhongMaterial({
    color: 0xffffff,
    shininess: 80,
  });
  private matInvisible = new THREE.MeshBasicMaterial({ visible: false });

  // 碁石のジオメトリ（球体を後でY軸に潰す）
  private stoneGeom = new THREE.SphereGeometry(0.48, 32, 16);
  // 潰した後の実際の高さの半分（地面から浮かせる用）
  private stoneYOffset = 0.48 * 0.4;

  constructor(container: HTMLElement, size: number, onActionCallback: (action: GoAction) => void) {
    this.container = container;
    this.size = size;
    this.onAction = onActionCallback;
    this.stones = Array(size * size).fill(null);

    this.initThreeJS(container);
  }

  private initThreeJS(container: HTMLElement) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1a2e);

    this.camera = new THREE.PerspectiveCamera(
      50,
      container.clientWidth / container.clientHeight,
      0.1,
      1000,
    );
    this.camera.position.set(0, this.size * 1.2, this.size * 1.0);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.1; // 真下からは見えないように

    // ライト設定
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(5, 15, 5);
    dirLight.castShadow = true;
    this.scene.add(dirLight);

    this.initBoard();

    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

    this.onClick = this.onClick.bind(this);
    this.onMouseMove = this.onMouseMove.bind(this);
    this.onResize = this.onResize.bind(this);

    window.addEventListener("click", this.onClick, false);
    window.addEventListener("mousemove", this.onMouseMove, false);
    window.addEventListener("resize", this.onResize, false);

    this.animate();
  }

  private initBoard() {
    const offset = (this.size - 1) / 2;

    // 1. 碁盤（木材部分）
    // 端の余白を作るため、サイズは +1 する
    const boardGeom = new THREE.BoxGeometry(this.size, 1.5, this.size);
    const boardMesh = new THREE.Mesh(boardGeom, this.matBoard);
    boardMesh.position.y = -0.75; // 天面をぴったり Y=0 にする
    boardMesh.receiveShadow = true;
    this.scene.add(boardMesh);

    // 2. 線の描画（Zファイティング防止のため Y=0.005 に浮かせる）
    for (let i = 0; i < this.size; i++) {
      const pos = i - offset;

      // 縦線
      const vPoints = [
        new THREE.Vector3(pos, 0.005, -offset),
        new THREE.Vector3(pos, 0.005, offset),
      ];
      const vLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(vPoints), this.matLine);
      this.scene.add(vLine);

      // 横線
      const hPoints = [
        new THREE.Vector3(-offset, 0.005, pos),
        new THREE.Vector3(offset, 0.005, pos),
      ];
      const hLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(hPoints), this.matLine);
      this.scene.add(hLine);
    }

    // 3. 星（Hoshi）の描画
    this.drawHoshi(offset);

    // 4. 当たり判定（HitBox）とゴースト石の設定
    const hitBoxGeom = new THREE.BoxGeometry(0.9, 0.2, 0.9);
    for (let i = 0; i < this.size * this.size; i++) {
      const x = (i % this.size) - offset;
      const z = Math.floor(i / this.size) - offset;

      const hitBox = new THREE.Mesh(hitBoxGeom, this.matInvisible);
      hitBox.position.set(x, 0.1, z); // 盤面より少し上
      hitBox.userData = { index: i, x, z };
      this.scene.add(hitBox);
      this.hitBoxes.push(hitBox);
    }

    // ホバー用のゴースト石
    this.ghostStone = new THREE.Mesh(
      this.stoneGeom,
      new THREE.MeshPhongMaterial({ transparent: true, opacity: 0.5 }),
    );
    this.ghostStone.scale.set(1, 0.4, 1); // 碁石型に潰す
    this.ghostStone.visible = false;
    this.scene.add(this.ghostStone);
  }

  private drawHoshi(offset: number) {
    const hoshiGeom = new THREE.CylinderGeometry(0.08, 0.08, 0.01, 16);
    const matHoshi = new THREE.MeshBasicMaterial({ color: 0x3e2723 });
    const addHoshi = (xPos: number, zPos: number) => {
      const hoshi = new THREE.Mesh(hoshiGeom, matHoshi);
      hoshi.position.set(xPos - offset, 0.008, zPos - offset); // 線より少し上
      this.scene.add(hoshi);
    };

    if (this.size === 9) {
      [2, 4, 6].forEach((x) => [2, 4, 6].forEach((z) => addHoshi(x, z)));
    } else if (this.size === 13) {
      [3, 6, 9].forEach((x) => [3, 6, 9].forEach((z) => addHoshi(x, z)));
    } else if (this.size === 19) {
      [3, 9, 15].forEach((x) => [3, 9, 15].forEach((z) => addHoshi(x, z)));
    }
  }

  public renderState(state: GoState) {
    this.currentState = state;
    const offset = (this.size - 1) / 2;

    for (let i = 0; i < state.board.length; i++) {
      const color = state.board[i];
      let stoneMesh = this.stones[i];

      if (color === 0) {
        // 石が打ち上げられた（または元々ない）場合、メッシュを削除
        if (stoneMesh) {
          this.scene.remove(stoneMesh);
          this.stones[i] = null;
        }
      } else if (!stoneMesh) {
        // 新しい石を配置
        const x = (i % this.size) - offset;
        const z = Math.floor(i / this.size) - offset;

        stoneMesh = new THREE.Mesh(this.stoneGeom, color === 1 ? this.matBlack : this.matWhite);

        // 【超重要】碁石型にするためY軸だけ 0.4 倍に潰す
        stoneMesh.scale.set(1, 0.4, 1);

        stoneMesh.position.set(x, this.stoneYOffset, z);
        stoneMesh.castShadow = true;
        this.scene.add(stoneMesh);
        this.stones[i] = stoneMesh;
      }
    }
  }

  private onMouseMove(event: MouseEvent) {
    if (!this.currentState || this.currentState.status !== "PLAYING") return;

    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const intersects = this.raycaster.intersectObjects(this.hitBoxes);

    if (intersects.length > 0) {
      const hit = intersects[0].object as THREE.Mesh;
      const index = hit.userData.index;

      // 空いている場所ならゴースト石を表示
      if (this.currentState.board[index] === 0) {
        this.ghostStone!.position.set(hit.userData.x, this.stoneYOffset, hit.userData.z);
        const ghostMat = this.ghostStone!.material as THREE.MeshPhongMaterial;
        ghostMat.color.setHex(this.currentState.turn === 1 ? 0x111111 : 0xffffff);
        this.ghostStone!.visible = true;
        return;
      }
    }

    this.ghostStone!.visible = false;
  }

  private onClick(_event: MouseEvent) {
    if (!this.currentState || this.currentState.status !== "PLAYING") return;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const intersects = this.raycaster.intersectObjects(this.hitBoxes);

    if (intersects.length > 0) {
      const index = intersects[0].object.userData.index;
      if (this.currentState.board[index] === 0) {
        this.onAction({ type: "PLACE", index });
        this.ghostStone!.visible = false;
      }
    }
  }

  private onResize() {
    if (!this.container) return;
    this.camera.aspect = this.container.clientWidth / this.container.clientHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
  }

  public dispose() {
    this.isDisposed = true;
    if (this.animationId !== null) cancelAnimationFrame(this.animationId);

    window.removeEventListener("click", this.onClick);
    window.removeEventListener("mousemove", this.onMouseMove);
    window.removeEventListener("resize", this.onResize);

    this.renderer.dispose();
    if (this.container && this.renderer.domElement) {
      this.container.removeChild(this.renderer.domElement);
    }
  }

  private animate() {
    if (this.isDisposed) return;
    this.animationId = requestAnimationFrame(this.animate.bind(this));
    if (this.controls) this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
