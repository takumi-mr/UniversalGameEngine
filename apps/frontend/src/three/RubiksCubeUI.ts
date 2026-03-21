// src/three/RubiksCubeUI.ts
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { RubiksState, RubiksAction, FaceName } from '@engine/shared/rules/RubicCubeRuleset';

type Color = 'W' | 'Y' | 'G' | 'B' | 'O' | 'R';

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


// ステッカーの3x3グリッドマッピング (行=row, 列=col -> position)
// FaceNameとgridの対応は3x3 state.faces[face][row][col]
const STICKER_GRID_POSITIONS: Record<FaceName, (row: number, col: number) => THREE.Vector3> = {
    U: (r, c) => new THREE.Vector3(-1 + c, 1.5, 1 - r),     // Y+面: z=-1..1 (正面向きのグリッド)
    D: (r, c) => new THREE.Vector3(-1 + c, -1.5, -1 + r),    // Y-面
    F: (r, c) => new THREE.Vector3(-1 + c, 1 - r, 1.5),      // Z+面
    B: (r, c) => new THREE.Vector3(1 - c, 1 - r, -1.5),      // Z-面
    R: (r, c) => new THREE.Vector3(1.5, 1 - r, 1 - c),       // X+面
    L: (r, c) => new THREE.Vector3(-1.5, 1 - r, -1 + c),     // X-面
};

export class RubiksCubeUI {
    private onAction: (action: RubiksAction) => void;
    private container: HTMLElement;

    private scene!: THREE.Scene;
    private camera!: THREE.PerspectiveCamera;
    private renderer!: THREE.WebGLRenderer;
    private controls!: OrbitControls;

    // ステッカーメッシュのリスト: [face][row][col] -> Mesh
    private stickers: Map<string, THREE.Mesh> = new Map();
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

        this.camera = new THREE.PerspectiveCamera(55, container.clientWidth / container.clientHeight, 0.1, 1000);
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

        this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown);
        this.renderer.domElement.addEventListener('pointerup', this.onPointerUp);
        this.renderer.domElement.addEventListener('pointermove', this.onMouseMove);
        window.addEventListener('resize', this.onResize);

        this.animate();
    }

    private buildCube() {
        // 3x3x3のキューブレット本体(黒いベース)を作成
        const cubeletGeom = new THREE.BoxGeometry(0.92, 0.92, 0.92);
        for (let x = -1; x <= 1; x++) {
            for (let y = -1; y <= 1; y++) {
                for (let z = -1; z <= 1; z++) {
                    if (x === 0 && y === 0 && z === 0) continue; // 中心は不要
                    const mat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.6 });
                    const mesh = new THREE.Mesh(cubeletGeom, mat);
                    mesh.position.set(x, y, z);
                    this.scene.add(mesh);
                }
            }
        }
    }

    private buildFacePanels() {
        // 各面の6方向に「回転ボタン」として使える透過パネルを配置
        const faces: FaceName[] = ['U', 'D', 'F', 'B', 'R', 'L'];
        const panelGeom = new THREE.PlaneGeometry(2.6, 2.6);

        for (const face of faces) {
            const normal = FACE_NORMALS[face];
            for (const dir of [1, -1] as const) {
                const mat = new THREE.MeshBasicMaterial({
                    color: dir === 1 ? 0x00ccff : 0xff6600,
                    side: THREE.DoubleSide,
                    transparent: true,
                    opacity: 0,
                    depthWrite: false,
                });
                const mesh = new THREE.Mesh(panelGeom, mat);

                // 面の外側に少しオフセット
                mesh.position.copy(normal.clone().multiplyScalar(2.0));
                mesh.lookAt(normal.clone().multiplyScalar(10));
                mesh.userData = { face, dir, isFacePanel: true };

                this.scene.add(mesh);
                this.facePanels.push({ face, dir, mesh });
            }
        }
    }

    public renderState(state: RubiksState) {
        // 既存ステッカーを一旦全部削除して新たに描画
        this.stickers.forEach(m => this.scene.remove(m));
        this.stickers.clear();

        const stickerGeom = new THREE.BoxGeometry(0.85, 0.05, 0.85);
        const faces: FaceName[] = ['U', 'D', 'F', 'B', 'R', 'L'];

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
                    if (face === 'U' || face === 'D') {
                        sticker.rotation.set(0, 0, 0);
                    } else if (face === 'F' || face === 'B') {
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
        const panelMeshes = this.facePanels.map(p => p.mesh);
        const hits = this.raycaster.intersectObjects(panelMeshes);

        if (hits.length > 0) {
            const hit = hits[0].object as THREE.Mesh;
            if (this.hoveredPanel !== hit) {
                if (this.hoveredPanel) (this.hoveredPanel.material as THREE.MeshBasicMaterial).opacity = 0;
                this.hoveredPanel = hit;
                (this.hoveredPanel.material as THREE.MeshBasicMaterial).opacity = 0.28;
                this.renderer.domElement.style.cursor = 'pointer';
            }
        } else {
            if (this.hoveredPanel) {
                (this.hoveredPanel.material as THREE.MeshBasicMaterial).opacity = 0;
                this.hoveredPanel = null;
                this.renderer.domElement.style.cursor = 'default';
            }
        }
    }

    private pointerDownPos = new THREE.Vector2();

    private onPointerDown(event: PointerEvent) {
        this.pointerDownPos.set(event.clientX, event.clientY);
    }

    private onPointerUp(event: PointerEvent) {
        // ドラッグ（視点回転）とクリックを区別する
        const dragDist = Math.hypot(event.clientX - this.pointerDownPos.x, event.clientY - this.pointerDownPos.y);
        if (dragDist > 5) return; // 5px以上動いたらドラッグとみなす

        const rect = this.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        this.raycaster.setFromCamera(this.mouse, this.camera);
        const panelMeshes = this.facePanels.map(p => p.mesh);
        const hits = this.raycaster.intersectObjects(panelMeshes);

        if (hits.length > 0) {
            const { face, dir } = hits[0].object.userData;
            const action: RubiksAction = { type: 'ROTATE', face, direction: dir };
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
        this.renderer.domElement.removeEventListener('pointerdown', this.onPointerDown);
        this.renderer.domElement.removeEventListener('pointerup', this.onPointerUp);
        this.renderer.domElement.removeEventListener('pointermove', this.onMouseMove);
        window.removeEventListener('resize', this.onResize);

        this.renderer.dispose();
        this.scene.traverse((object) => {
            if (object instanceof THREE.Mesh) {
                object.geometry.dispose();
                if (Array.isArray(object.material)) {
                    object.material.forEach(m => m.dispose());
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
