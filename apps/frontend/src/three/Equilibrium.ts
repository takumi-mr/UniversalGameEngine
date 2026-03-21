// Equilibrium3D.ts
import * as THREE from "three";
import type { EquilibriumState } from "@engine/shared/rules/EquilibriumRuleset";

export class Equilibrium {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private animationId: number = 0;

  private cardMeshes: THREE.Group = new THREE.Group();

  constructor(canvas: HTMLCanvasElement) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0f172a); // Tailwindのslate-900

    this.camera = new THREE.PerspectiveCamera(
      50,
      window.innerWidth / window.innerHeight,
      0.1,
      1000,
    );
    this.camera.position.set(0, 12, 12);
    this.camera.lookAt(0, 0, 0);

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
    });
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // パフォーマンス最適化

    this.scene.add(this.cardMeshes);

    this.setupLighting();
    this.setupTable();
    this.startLoop();
  }

  private setupLighting() {
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambientLight);

    const spotLight = new THREE.SpotLight(0x8b5cf6, 2); // 紫がかった怪しい光
    spotLight.position.set(0, 20, 0);
    spotLight.angle = Math.PI / 4;
    spotLight.penumbra = 0.5;
    this.scene.add(spotLight);
  }

  private setupTable() {
    // 魂の闘技場（テーブル）
    const geo = new THREE.CylinderGeometry(10, 10, 0.5, 32);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.8,
    });
    const table = new THREE.Mesh(geo, mat);
    table.position.y = -0.25;
    this.scene.add(table);

    // 中央のオークションエリアのハイライト
    const ringGeo = new THREE.RingGeometry(3, 3.2, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x6366f1,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.5,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.01;
    this.scene.add(ring);
  }

  // ★ VueからStateが更新されるたびに呼ばれる
  public updateState(state: EquilibriumState, myPlayerId: string) {
    // 古いカードをクリア
    this.cardMeshes.clear();

    // 1. 中央のオークションプール
    if (state.phase === "AUCTION") {
      state.auctionPool.forEach((card, i) => {
        const offset = (i - (state.auctionPool.length - 1) / 2) * 2.5;
        this.createCard(card.name, offset, 0, 0, 0xffd700); // ゴールド
      });
    }

    // 2. プレイヤーの盤面 (Board)
    Object.entries(state.playerData).forEach(([pId, pData]) => {
      const isMe = pId === myPlayerId;
      const zBase = isMe ? 6 : -6; // 自分は手前、相手は奥

      pData.board.forEach((card, i) => {
        const offset = (i - (pData.board.length - 1) / 2) * 2;
        this.createCard(card.name, offset, 0, zBase, isMe ? 0x4ade80 : 0xf87171);
      });
    });
  }

  private createCard(name: string, x: number, y: number, z: number, colorHex: number) {
    const geo = new THREE.BoxGeometry(1.5, 0.05, 2.2);
    const mat = new THREE.MeshStandardMaterial({
      color: colorHex,
      roughness: 0.4,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);

    // アニメーション用にデータを仕込む
    mesh.userData = {
      initialY: y,
      floatSpeed: Math.random() * 0.02 + 0.01,
      floatOffset: Math.random() * Math.PI * 2,
    };

    this.cardMeshes.add(mesh);
  }

  private startLoop() {
    const animate = () => {
      this.animationId = requestAnimationFrame(animate);

      // カードをフワフワ浮遊させるアニメーション
      const time = Date.now() * 0.002;
      this.cardMeshes.children.forEach((child) => {
        const mesh = child as THREE.Mesh;
        const { initialY, floatSpeed, floatOffset } = mesh.userData;
        mesh.position.y = initialY + Math.sin(time * floatSpeed + floatOffset) * 0.2 + 0.2;
        mesh.rotation.y = Math.sin(time * floatSpeed * 0.5) * 0.1;
      });

      this.renderer.render(this.scene, this.camera);
    };
    animate();
  }

  public resize(width: number, height: number) {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  public destroy() {
    cancelAnimationFrame(this.animationId);
    this.renderer.dispose();
  }
}
