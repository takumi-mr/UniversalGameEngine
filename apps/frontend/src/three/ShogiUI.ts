// src/three/Shogi3DUI.ts
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { ShogiState, ShogiAction } from '@engine/shared/rules/ShogiRuleset';

export class ShogiUI {
    private onAction: (action: ShogiAction, canPromote: boolean) => void;
    private container: HTMLElement;

    private scene!: THREE.Scene;
    private camera!: THREE.PerspectiveCamera;
    private renderer!: THREE.WebGLRenderer;
    private controls!: OrbitControls;
    private raycaster!: THREE.Raycaster;
    private mouse!: THREE.Vector2;

    private gridPlanes: THREE.Mesh[] = [];
    private pieceMeshes: Map<number, THREE.Mesh> = new Map(); // fromIndex -> Mesh

    private currentState: ShogiState | null = null;

    // UIステート（2ステップ操作用）
    private selectedFromIndex: number | null = null;
    private animationId: number | null = null;
    private isDisposed = false;

    // マテリアル
    private matBoard = new THREE.MeshLambertMaterial({ color: 0xdeb887 }); // 木目色
    private matHighlightValid = new THREE.MeshBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.5 });
    private matHighlightSelected = new THREE.MeshBasicMaterial({ color: 0xff0000, transparent: true, opacity: 0.5 });
    private matInvisible = new THREE.MeshBasicMaterial({ visible: false });

    // 簡易的な駒のテクスチャ（文字）生成用キャンバス
    private pieceGeom = new THREE.BoxGeometry(0.8, 0.2, 0.9);

    constructor(container: HTMLElement, onActionCallback: (action: ShogiAction, canPromote: boolean) => void) {
        this.container = container;
        this.onAction = onActionCallback;
        this.initThreeJS(container);
    }

    private initThreeJS(container: HTMLElement) {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x222222);

        this.camera = new THREE.PerspectiveCamera(60, container.clientWidth / container.clientHeight, 0.1, 1000);
        this.camera.position.set(0, 8, 10);

        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(container.clientWidth, container.clientHeight);
        container.appendChild(this.renderer.domElement);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.target.set(0, 0, 0);

        this.scene.add(new THREE.AmbientLight(0xffffff, 0.6));
        const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
        dirLight.position.set(5, 10, 5);
        this.scene.add(dirLight);

        this.initBoard();

        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();

        this.onClick = this.onClick.bind(this);
        this.onResize = this.onResize.bind(this);
        window.addEventListener('click', this.onClick, false);
        window.addEventListener('resize', this.onResize, false);

        this.animate();
    }

    private initBoard() {
        // 9x9の盤面を生成 (x: -4 to 4, z: -4 to 4)
        for (let i = 0; i < 81; i++) {
            const x = (i % 9) - 4;
            const z = Math.floor(i / 9) - 4;

            // 盤面のマス
            const planeGeom = new THREE.PlaneGeometry(0.95, 0.95);
            const plane = new THREE.Mesh(planeGeom, this.matBoard);
            plane.rotation.x = -Math.PI / 2;
            plane.position.set(x, 0, z);

            // レイキャスト用の透明なボックス（クリック判定用）を重ねる
            const hitGeom = new THREE.BoxGeometry(1, 0.1, 1);
            const hitBox = new THREE.Mesh(hitGeom, this.matInvisible);
            hitBox.position.set(x, 0.05, z);
            hitBox.userData = { index: i, type: 'cell' };

            this.scene.add(plane);
            this.scene.add(hitBox);
            this.gridPlanes.push(hitBox);
        }
    }

    // --- 簡易的な駒のテクスチャ生成 ---
    private createPieceMaterial(val: number): THREE.Material {
        const PIECE_TEXTS: Record<number, string> = {
            1: "歩", 2: "香", 3: "桂", 4: "銀", 5: "金", 6: "角", 7: "飛", 8: "玉",
            9: "と", 10: "杏", 11: "圭", 12: "全", 13: "馬", 14: "龍"
        };
        const canvas = document.createElement('canvas');
        canvas.width = 128; canvas.height = 128;
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = "#ffddaa"; // 駒の色
        ctx.fillRect(0, 0, 128, 128);
        ctx.fillStyle = Math.abs(val) > 8 && Math.abs(val) !== 13 && Math.abs(val) !== 14 ? "#ff0000" : "#000000"; // 成り駒は赤（馬と龍は黒のままが多い）
        ctx.font = "bold 80px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(PIECE_TEXTS[Math.abs(val)] || "?", 64, 64);

        const tex = new THREE.CanvasTexture(canvas);
        return new THREE.MeshLambertMaterial({ map: tex });
    }

    public renderState(state: ShogiState) {
        this.currentState = state;

        // 既存の駒を一旦消去 (※実運用では差分更新が望ましいが簡易化のため)
        this.pieceMeshes.forEach(mesh => this.scene.remove(mesh));
        this.pieceMeshes.clear();

        // 盤面の駒を描画
        for (let i = 0; i < 81; i++) {
            const val = state.board[i];
            if (val !== 0) {
                const x = (i % 9) - 4;
                const z = Math.floor(i / 9) - 4;

                const mat = this.createPieceMaterial(val);
                const piece = new THREE.Mesh(this.pieceGeom, mat);
                piece.position.set(x, 0.15, z);

                // 後手の駒は180度回転
                if (Math.sign(val) === -1) {
                    piece.rotation.y = Math.PI;
                }

                piece.userData = { index: i, type: 'piece', owner: Math.sign(val) };
                this.scene.add(piece);
                this.pieceMeshes.set(i, piece);
            }
        }

        this.clearHighlights();
    }

    private clearHighlights() {
        this.gridPlanes.forEach(p => p.material = this.matInvisible);
    }

    private isPromotionZone(y: number, turn: number) {
        return turn === 1 ? y <= 2 : y >= 6;
    }

    private onClick(event: MouseEvent) {
        if (!this.currentState || this.currentState.status !== 'PLAYING') return;

        const rect = this.renderer.domElement.getBoundingClientRect();
        const clientX = event.clientX - rect.left;
        const clientY = event.clientY - rect.top;
        this.mouse.x = (clientX / rect.width) * 2 - 1;
        this.mouse.y = -(clientY / rect.height) * 2 + 1;

        this.raycaster.setFromCamera(this.mouse, this.camera);

        // セル（マス）と駒の両方を対象にレイキャスト
        const interactables = [...this.gridPlanes, ...Array.from(this.pieceMeshes.values())];
        const intersects = this.raycaster.intersectObjects(interactables);

        if (intersects.length > 0) {
            const hit = intersects[0].object.userData;
            const clickedIndex = hit.index;

            if (this.selectedFromIndex === null) {
                // --- Step 1: 駒の選択 ---
                const pieceVal = this.currentState.board[clickedIndex];
                if (pieceVal !== 0 && Math.sign(pieceVal) === this.currentState.turn) {
                    this.selectedFromIndex = clickedIndex;
                    this.clearHighlights();
                    this.gridPlanes[clickedIndex].material = this.matHighlightSelected;
                    // ※ ここで本来は engine.getLegalActions を使って移動可能マスを青くハイライトする
                }
            } else {
                // --- Step 2: 移動先の選択 ---
                // もう一度同じ駒をクリックしたらキャンセル
                if (this.selectedFromIndex === clickedIndex) {
                    this.selectedFromIndex = null;
                    this.clearHighlights();
                    return;
                }

                // 이동アクションの発行
                const fromY = Math.floor(this.selectedFromIndex / 9);
                const toY = Math.floor(clickedIndex / 9);
                const type = Math.abs(this.currentState.board[this.selectedFromIndex]);

                // 成れる可能性があるか判定（Vue側でダイアログを出すため）
                // ※本来はRulesetのPROMOTE_MAPを参照するべきですが、ここでは簡易判定
                const canPromote = type <= 7 && type !== 5 && type !== 8 &&
                    (this.isPromotionZone(fromY, this.currentState.turn) || this.isPromotionZone(toY, this.currentState.turn));

                this.onAction({
                    type: 'MOVE',
                    from: this.selectedFromIndex,
                    to: clickedIndex
                }, canPromote);

                this.selectedFromIndex = null;
                this.clearHighlights();
            }
        } else {
            // 盤外クリックでキャンセル
            this.selectedFromIndex = null;
            this.clearHighlights();
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
        if (this.animationId !== null) {
            cancelAnimationFrame(this.animationId);
        }
        window.removeEventListener('click', this.onClick);
        window.removeEventListener('resize', this.onResize);
        
        this.renderer.dispose();
        this.scene.traverse((object) => {
            if (object instanceof THREE.Mesh) {
                object.geometry.dispose();
                const materials = Array.isArray(object.material) ? object.material : [object.material];
                materials.forEach(m => {
                    if ((m as any).map) (m as any).map.dispose();
                    m.dispose();
                });
            }
        });

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