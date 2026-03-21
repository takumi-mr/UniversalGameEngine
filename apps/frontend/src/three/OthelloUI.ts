// src/three/OthelloUI.ts
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { OthelloState, OthelloAction } from '@engine/shared/rules/OthelloRuleset';

export class OthelloUI {
    private onAction: (action: OthelloAction) => void;
    private container: HTMLElement;

    private scene!: THREE.Scene;
    private camera!: THREE.PerspectiveCamera;
    private renderer!: THREE.WebGLRenderer;
    private controls!: OrbitControls;
    private raycaster!: THREE.Raycaster;
    private mouse!: THREE.Vector2;

    private pieces: (THREE.Mesh | null)[][] = [];
    private hitBoxes: THREE.Mesh[][] = [];

    private currentState: OthelloState | null = null;

    // アニメーション管理用
    private flipAnimations: { mesh: THREE.Mesh, startRot: number, targetRot: number, progress: number }[] = [];
    private animationId: number | null = null;
    private isDisposed = false;

    // マテリアル定義
    private matBoard = new THREE.MeshLambertMaterial({ color: 0x1e5631 }); // 深い緑色（フェルト生地風）
    private matBorder = new THREE.MeshLambertMaterial({ color: 0x4a2e00 }); // 木枠風
    private matHighlight = new THREE.MeshBasicMaterial({ color: 0x00ffcc, transparent: true, opacity: 0.3 });
    private matInvisible = new THREE.MeshBasicMaterial({ visible: false });

    // 石のジオメトリ（円柱）とマテリアル [側面, 上面(黒), 下面(白)]
    private pieceGeom = new THREE.CylinderGeometry(0.4, 0.4, 0.1, 32);
    private pieceMaterials = [
        new THREE.MeshPhongMaterial({ color: 0x444444, shininess: 30 }), // 側面
        new THREE.MeshPhongMaterial({ color: 0x111111, shininess: 80 }), // 黒
        new THREE.MeshPhongMaterial({ color: 0xeeeeee, shininess: 80 })  // 白
    ];

    constructor(container: HTMLElement, onActionCallback: (action: OthelloAction) => void) {
        this.container = container;
        this.onAction = onActionCallback;

        // 8x8の配列を初期化
        for (let y = 0; y < 8; y++) {
            this.pieces[y] = Array(8).fill(null);
            this.hitBoxes[y] = [];
        }

        this.initThreeJS(container);
    }

    private initThreeJS(container: HTMLElement) {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x1a1a2e); // 少し青みがかったダークな背景

        this.camera = new THREE.PerspectiveCamera(50, container.clientWidth / container.clientHeight, 0.1, 1000);
        this.camera.position.set(0, 7, 7);

        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(container.clientWidth, container.clientHeight);
        this.renderer.shadowMap.enabled = true; // 影を有効化してリッチに
        container.appendChild(this.renderer.domElement);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.maxPolarAngle = Math.PI / 2 - 0.1; // 真下からは見えないように制限

        // --- ライティング ---
        this.scene.add(new THREE.AmbientLight(0xffffff, 0.4));
        const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
        dirLight.position.set(5, 10, 5);
        dirLight.castShadow = true;
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
        // 1. 盤面のベース（緑の部分）
        const boardGeom = new THREE.BoxGeometry(8, 0.3, 8);
        const boardMesh = new THREE.Mesh(boardGeom, this.matBoard);
        boardMesh.position.y = -0.145;
        boardMesh.receiveShadow = true;
        this.scene.add(boardMesh);

        // 2. 木枠
        const borderGeom = new THREE.BoxGeometry(8.4, 0.4, 8.4);
        const borderMesh = new THREE.Mesh(borderGeom, this.matBorder);
        borderMesh.position.y = -0.2;
        borderMesh.receiveShadow = true;
        this.scene.add(borderMesh);

        // 3. グリッド線
        const gridHelper = new THREE.GridHelper(8, 8, 0x000000, 0x000000);
        gridHelper.position.y = 0.01;

        // 型を明示してあげることで ts-ignore 自体を消し去る
        const material = gridHelper.material as THREE.Material;
        material.transparent = true;
        material.opacity = 0.3;

        this.scene.add(gridHelper);

        // 4. 当たり判定（レイキャスト用）とハイライト用の見えないマス
        for (let y = 0; y < 8; y++) {
            for (let x = 0; x < 8; x++) {
                const px = x - 3.5;
                const pz = y - 3.5;

                const hitGeom = new THREE.PlaneGeometry(0.9, 0.9);
                const hitMesh = new THREE.Mesh(hitGeom, this.matInvisible);
                hitMesh.rotation.x = -Math.PI / 2;
                hitMesh.position.set(px, 0.02, pz);
                hitMesh.userData = { x, y }; // 座標を記録

                this.scene.add(hitMesh);
                this.hitBoxes[y][x] = hitMesh;
            }
        }
    }

    public renderState(state: OthelloState, legalActions: OthelloAction[] = []) {
        this.currentState = state;
        const validMoves = legalActions.map(a => ({ x: a.x, y: a.y }));

        for (let y = 0; y < 8; y++) {
            for (let x = 0; x < 8; x++) {
                const color = state.board[y][x];
                let piece = this.pieces[y][x];

                // --- 1. 石の新規配置 ---
                if (color !== 0 && !piece) {
                    piece = new THREE.Mesh(this.pieceGeom, this.pieceMaterials);
                    piece.position.set(x - 3.5, 0.06, y - 3.5); // Z-fighting回避のため0.05から少し上げる
                    piece.castShadow = true;
                    // 黒なら上面が上(0)、白ならひっくり返す(Math.PI)
                    piece.rotation.x = color === 1 ? 0 : Math.PI;
                    piece.userData = { color };
                    this.scene.add(piece);
                    this.pieces[y][x] = piece;

                    // 置いた瞬間のちょっとした落下アニメーション（オプション）
                    piece.position.y = 0.5;
                }

                // --- 2. 石の裏返り検知とアニメーション登録 ---
                if (piece && color !== 0 && piece.userData.color !== color) {
                    piece.userData.color = color; // 色を更新

                    const targetRot = color === 1 ? 0 : Math.PI;
                    // キューにアニメーションを積む
                    this.flipAnimations.push({
                        mesh: piece,
                        startRot: piece.rotation.x,
                        targetRot: targetRot,
                        progress: 0
                    });
                }

                // --- 3. 合法手のハイライト表示 ---
                const hitBox = this.hitBoxes[y][x];
                const isValid = validMoves.some(m => m.x === x && m.y === y);
                hitBox.material = isValid ? this.matHighlight : this.matInvisible;
            }
        }
    }

    private onClick(event: MouseEvent) {
        if (!this.currentState || this.currentState.status !== 'PLAYING') return;

        const rect = this.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        this.raycaster.setFromCamera(this.mouse, this.camera);

        // 当たり判定用ボックス（hitBoxes）のみを対象にする
        const targets = this.hitBoxes.flat();
        const intersects = this.raycaster.intersectObjects(targets);

        if (intersects.length > 0) {
            const hit = intersects[0].object.userData;
            // UI側での再チェックは行わず、上位層にアクションを投げる
            // または、renderStateで受け取ったvalidMovesをメンバ変数に保持してチェックする
            // ここではシンプルに、クリック座標をそのまま投げてサーバー側のバリデーションに任せるか、
            // メンバ変数として保持しておく。
            this.onAction({
                type: 'PLACE_PIECE',
                x: hit.x,
                y: hit.y,
                color: this.currentState.currentTurn
            });
        }
    }

    private onResize() {
        if (!this.container) return;
        this.camera.aspect = this.container.clientWidth / this.container.clientHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    }

    // --- イージング関数（滑らかなアニメーション用） ---
    private easeInOutSine(x: number): number {
        return -(Math.cos(Math.PI * x) - 1) / 2;
    }

    public dispose() {
        this.isDisposed = true;
        if (this.animationId !== null) {
            cancelAnimationFrame(this.animationId);
        }
        window.removeEventListener('click', this.onClick);
        window.removeEventListener('resize', this.onResize);

        // リソースの解放
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

    private animate() {
        if (this.isDisposed) return;
        this.animationId = requestAnimationFrame(this.animate.bind(this));
        if (this.controls) this.controls.update();

        // --- アニメーションの進行処理 ---
        for (let i = this.flipAnimations.length - 1; i >= 0; i--) {
            const anim = this.flipAnimations[i];
            anim.progress += 0.05; // アニメーション速度

            if (anim.progress >= 1) {
                // 完了
                anim.mesh.rotation.x = anim.targetRot;
                anim.mesh.position.y = 0.05; // 元の高さに戻す
                this.flipAnimations.splice(i, 1);
            } else {
                // イージングを適用して回転
                const t = this.easeInOutSine(anim.progress);
                anim.mesh.rotation.x = THREE.MathUtils.lerp(anim.startRot, anim.targetRot, t);

                // フワッと浮き上がる演出（放物線を描く）
                // sinカーブを使って、progress 0.5 の時に一番高くなるようにする
                anim.mesh.position.y = 0.05 + Math.sin(anim.progress * Math.PI) * 0.4;
            }
        }

        // 新規配置時の落下アニメーション（簡易）
        for (let y = 0; y < 8; y++) {
            for (let x = 0; x < 8; x++) {
                const piece = this.pieces[y][x];
                if (piece && piece.position.y > 0.06 && !this.flipAnimations.find(a => a.mesh === piece)) {
                    piece.position.y -= 0.05;
                    if (piece.position.y < 0.06) piece.position.y = 0.06;
                }
            }
        }

        this.renderer.render(this.scene, this.camera);
    }
}