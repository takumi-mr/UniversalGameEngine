// src/three/BaseThreeUI.ts
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

export interface BaseThreeUIOptions {
  /** カメラの視野角（度） */
  fov?: number;
  /** カメラの初期位置 */
  cameraPosition?: [number, number, number];
  /** 背景色 */
  background?: number;
  /** 影を有効にするか */
  shadowMap?: boolean;
  /** OrbitControls を生成するか（デフォルト true） */
  orbitControls?: boolean;
  /** renderer に設定する pixelRatio。未指定なら setPixelRatio しない */
  pixelRatio?: number;
  /** 既存の canvas に描画する場合に指定。未指定なら container に canvas を追加する */
  canvas?: HTMLCanvasElement;
}

/**
 * Three.js ベースのゲーム UI 共通基底クラス。
 * scene / camera / renderer / OrbitControls / raycaster の初期化、
 * リサイズ・描画ループ・イベントリスナー・リソース破棄を共通化する。
 *
 * サブクラスはコンストラクタで super() を呼んだ後にライトや盤面を組み立て、
 * addListener() でイベントを登録する。描画ループは自動で開始される。
 */
export abstract class BaseThreeUI {
  protected container: HTMLElement;
  protected scene: THREE.Scene;
  protected camera: THREE.PerspectiveCamera;
  protected renderer: THREE.WebGLRenderer;
  protected controls: OrbitControls | null = null;
  protected raycaster = new THREE.Raycaster();
  protected mouse = new THREE.Vector2();
  protected isDisposed = false;

  private animationId: number | null = null;
  private ownsCanvas: boolean;
  private listeners: { target: EventTarget; type: string; handler: EventListener }[] = [];

  constructor(container: HTMLElement, options: BaseThreeUIOptions = {}) {
    this.container = container;
    this.ownsCanvas = !options.canvas;

    this.scene = new THREE.Scene();
    if (options.background !== undefined) {
      this.scene.background = new THREE.Color(options.background);
    }

    this.camera = new THREE.PerspectiveCamera(
      options.fov ?? 50,
      container.clientWidth / container.clientHeight,
      0.1,
      1000,
    );
    if (options.cameraPosition) this.camera.position.set(...options.cameraPosition);
    this.camera.lookAt(0, 0, 0);

    this.renderer = new THREE.WebGLRenderer({ canvas: options.canvas, antialias: true });
    if (options.pixelRatio !== undefined) this.renderer.setPixelRatio(options.pixelRatio);
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = options.shadowMap ?? false;
    if (this.ownsCanvas) container.appendChild(this.renderer.domElement);

    if (options.orbitControls ?? true) {
      this.controls = new OrbitControls(this.camera, this.renderer.domElement);
      this.controls.enableDamping = true;
    }

    this.addListener(window, "resize", () => this.onResize());

    // requestAnimationFrame は非同期なので、最初のフレームはサブクラスの初期化完了後に走る
    this.animate();
  }

  /** イベントリスナーを登録する。dispose() 時にまとめて解除される */
  protected addListener<K extends keyof GlobalEventHandlersEventMap>(
    target: Window | HTMLElement,
    type: K,
    handler: (event: GlobalEventHandlersEventMap[K]) => void,
  ) {
    const listener = handler as EventListener;
    target.addEventListener(type, listener, false);
    this.listeners.push({ target, type, handler: listener });
  }

  /** マウス座標を NDC（-1〜1）に変換して this.mouse に格納する */
  protected updateMouse(event: { clientX: number; clientY: number }) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  /** 毎フレーム render の直前に呼ばれる。アニメーション処理はここに書く */
  protected onFrame() {}

  protected onResize() {
    this.resize(this.container.clientWidth, this.container.clientHeight);
  }

  public resize(width: number, height: number) {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  private animate = () => {
    if (this.isDisposed) return;
    this.animationId = requestAnimationFrame(this.animate);
    this.controls?.update();
    this.onFrame();
    this.renderer.render(this.scene, this.camera);
  };

  public dispose() {
    this.isDisposed = true;
    if (this.animationId !== null) cancelAnimationFrame(this.animationId);

    this.listeners.forEach(({ target, type, handler }) =>
      target.removeEventListener(type, handler),
    );
    this.listeners = [];

    this.controls?.dispose();
    this.renderer.dispose();
    this.scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((m) => {
        if ("map" in m && m.map instanceof THREE.Texture) m.map.dispose();
        m.dispose();
      });
    });

    if (this.ownsCanvas && this.renderer.domElement.parentNode === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
