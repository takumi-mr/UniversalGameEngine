// src/three/Mancala3DUI.ts
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { MancalaState, MancalaAction } from '@engine/shared/rules/MancalaRuleset';

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
    private stonePool: THREE.Mesh[] = [];   // 石のプール（パフォーマンス最適化）

    private currentState: MancalaState | null = null;

    // アニメーション管理
    private isAnimating = false;

    // --- マテリアルとジオメトリ ---

    // ボード（木製）
    private matBoard = new THREE.MeshStandardMaterial({
        color: 0x8B5A2B,
        roughness: 0.8,
        metalness: 0.1,
        // 本来はここに木目のテクスチャを貼るとよりリアルになります
    });

    // ポケットの内部（暗がり）
    private matPitInterior = new THREE.MeshStandardMaterial({
        color: 0x3A2312,
        roughness: 1.0,
        metalness: 0.0,
    });

    // クリック可能なポケットのハイライト
    private matHighlight = new THREE.MeshBasicMaterial({
        color: 0xfbbf24,
        transparent: true,
        opacity: 0.4,
        side: THREE.DoubleSide
    });

    // ★おはじき（透明なガラス質）
    // MeshPhysicalMaterial の Transmission 機能を使用
    private matStone = new THREE.MeshPhysicalMaterial({
        color: 0xfbbf24,       // 琥珀色
        metalness: 0,
        roughness: 0.05,        // 表面の滑らかさ
        transmission: 0.95,     // ★透過率（ほぼ透明）
        ior: 1.5,               // ★屈折率（ガラス）
        thickness: 0.5,         // ★厚み（屈折に影響）
        specularIntensity: 1,
        specularColor: 0xffffff,
        envMapIntensity: 1,
        transparent: true,      // 透過に必要
    });

    private geomStone = new THREE.SphereGeometry(0.12, 32, 16); // おはじき用の少し扁平な球

    constructor(container: HTMLElement, onActionCallback: (action: MancalaAction) => void) {
        this.container = container;
        this.onAction = onActionCallback;
        this.geomStone.scale(1, 0.6, 1); // おはじきっぽく扁平にする

        this.initThreeJS();
        this.initBoard();
        this.initStonePool();
        this.animate();
    }

    private initThreeJS() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x1a1a1a); // ダークな背景

        this.camera = new THREE.PerspectiveCamera(50, this.container.clientWidth / this.container.clientHeight, 0.1, 1000);
        // ボード全体を見渡せる位置にカメラを配置
        this.camera.position.set(0, 8, 5);

        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
        this.renderer.shadowMap.enabled = true; // 影を有効化
        this.renderer.shadowMap.type = THREE.PCFShadowMap;
        this.container.appendChild(this.renderer.domElement);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.target.set(0, 0, 0);
        this.controls.enableDamping = true;
        this.controls.maxPolarAngle = Math.PI / 2 - 0.1; // 真横より下には行かせない

        // --- ライティング (透明感と影のために重要) ---
        this.scene.add(new THREE.AmbientLight(0xffffff, 0.5)); // 環境光

        // メインのスポットライト（影を作る）
        const spotLight = new THREE.SpotLight(0xffffff, 1);
        spotLight.position.set(5, 10, 5);
        spotLight.castShadow = true;
        spotLight.shadow.mapSize.width = 2048;
        spotLight.shadow.mapSize.height = 2048;
        this.scene.add(spotLight);

        // おはじきの透過感を出すための裏打ちのライト
        const backLight = new THREE.PointLight(0xffffff, 0.5);
        backLight.position.set(-5, -2, -5);
        this.scene.add(backLight);

        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();

        window.addEventListener('click', this.onClick.bind(this), false);
        window.addEventListener('resize', this.onResize.bind(this), false);
    }

    private initBoard() {
        // --- ボード本体 ---
        const boardGeom = new THREE.BoxGeometry(8, 0.5, 3);
        // 角を丸くしたい場合は、本来は外部モデルを読み込むか、複雑な形状定義が必要ですが、
        // ここでは簡易的にボックスで。
        const boardMesh = new THREE.Mesh(boardGeom, this.matBoard);
        boardMesh.position.y = -0.25;
        boardMesh.receiveShadow = true;
        this.scene.add(boardMesh);

        // --- ポケットとストアの作成 ---
        this.pitMeshes = Array(14).fill(null);

        // ヘルパー：ポケット（穴）を作成する関数
        const createPit = (index: number, x: number, z: number, r: number, h: number, isStore = false) => {
            // 1. 穴の内部（シリンダー）
            const geom = new THREE.CylinderGeometry(r, r * 0.8, h, 32);
            const mesh = new THREE.Mesh(geom, this.matPitInterior);
            mesh.position.set(x, -h / 2 + 0.01, z); // 盤面よりわずかに上に配置してちらつきを防ぐ
            mesh.receiveShadow = true;
            this.scene.add(mesh);

            // 穴の位置情報を保持（石の配置用）
            mesh.userData = { index, isStore, radius: r };
            this.pitMeshes[index] = mesh;

            // 2. クリック判定およびハイライト用のリング
            const ringGeom = new THREE.RingGeometry(r, r + 0.05, 32);
            const ringMesh = new THREE.Mesh(ringGeom, this.matHighlight);
            ringMesh.rotation.x = -Math.PI / 2;
            ringMesh.position.set(x, 0.02, z); // 盤面のすぐ上
            ringMesh.visible = false; // 初期は非表示
            ringMesh.userData = { index, isHighlight: true };
            this.scene.add(ringMesh);
        };

        // P1 ポケット (下段 0~5)
        for (let i = 0; i < 6; i++) {
            createPit(i, i - 2.5, 0.8, 0.4, 0.3);
        }
        // P1 ストア (右端 6)
        createPit(6, 3.3, 0, 0.6, 0.3, true);

        // P2 ポケット (上段 7~12)
        for (let i = 0; i < 6; i++) {
            createPit(12 - i, i - 2.5, -0.8, 0.4, 0.3);
        }
        // P2 ストア (左端 13)
        createPit(13, -3.3, 0, 0.6, 0.3, true);
    }

    // パフォーマンスのため、石を事前に作成してプールしておく
    private initStonePool() {
        for (let i = 0; i < 72; i++) { // マンカラ全体の石の数は通常48だが、横取り等で偏るため多めに
            const stone = new THREE.Mesh(this.geomStone, this.matStone);
            stone.castShadow = true;
            stone.receiveShadow = true;
            stone.visible = false; // 初期は非表示
            this.scene.add(stone);
            this.stonePool.push(stone);
        }
    }

    // --- 石の配置アルゴリズム (物理演算なし) ---
    // ポケットの中で石が自然に重なっているように見せる
    private arrangeStonesInPit(pitIndex: number, count: number) {
        const pitMesh = this.pitMeshes[pitIndex];
        const { radius, isStore } = pitMesh.userData;
        const pitPos = pitMesh.position;

        // このポケットに割り当てられた石のメッシュを取得
        const stonesInThisPit = this.stoneMeshes.filter(s => s.userData.pitIndex === pitIndex);

        // 既存の石をプールに戻す
        stonesInThisPit.forEach(s => {
            s.visible = false;
            s.userData.pitIndex = -1;
        });
        this.stoneMeshes = this.stoneMeshes.filter(s => s.userData.pitIndex !== pitIndex);

        for (let i = 0; i < count; i++) {
            let stone = this.stonePool.find(s => !s.visible);
            if (!stone) {
                // プールが空なら新規作成（通常は起きない）
                stone = new THREE.Mesh(this.geomStone, this.matStone);
                stone.castShadow = true;
                this.scene.add(stone);
                this.stonePool.push(stone);
            }

            stone.visible = true;
            stone.userData.pitIndex = pitIndex;
            this.stoneMeshes.push(stone);

            // --- 配置ロジック ---
            // ストア（ゴール）は広いので、ランダムに散らす。ポケットは狭いので、円周上に配置してから上に積む。
            if (isStore) {
                const angle = Math.random() * Math.PI * 2;
                const r = Math.random() * radius * 0.7; // 縁ギリギリには置かない
                stone.position.set(
                    pitPos.x + Math.cos(angle) * r,
                    0.05 + (i * 0.02), // 少しずつ上に積む
                    pitPos.z + Math.sin(angle) * r
                );
                // ランダムな回転を入れて自然に
                stone.rotation.set(Math.random() * 0.2, Math.random() * Math.PI, Math.random() * 0.2);
            } else {
                // 通常ポケット：螺旋状に配置して、3個ごとに上の段へ
                const floor = Math.floor(i / 4); // 1段に4個
                const indexInFloor = i % 4;
                const angle = (indexInFloor * (Math.PI * 2 / 4)) + (floor * 0.5); // 段ごとに少し角度をずらす
                const r = radius * 0.5;

                stone.position.set(
                    pitPos.x + Math.cos(angle) * r,
                    0.05 + (floor * 0.12), // 段の高さ
                    pitPos.z + Math.sin(angle) * r
                );
                // 穴の内側に沿うように少し傾ける
                stone.rotation.set(-0.2, angle + Math.PI / 2, 0);
            }
        }
    }

    public renderState(state: MancalaState) {
        this.currentState = state;

        // すべてのポケットの石を再配置（アニメーション中は除く）
        if (!this.isAnimating) {
            for (let i = 0; i < 14; i++) {
                this.arrangeStonesInPit(i, state.board[i]);
            }
        }

        // ハイライトの更新
        this.scene.traverse((obj) => {
            if (obj.userData && obj.userData.isHighlight) {
                const index = obj.userData.index;
                const isP1Turn = state.turn === 1;
                const isP1Pit = index >= 0 && index <= 5;
                const isP2Pit = index >= 7 && index <= 12;

                if (state.status === 'PLAYING' && state.board[index] > 0 &&
                    ((isP1Turn && isP1Pit) || (!isP1Turn && isP2Pit))) {
                    obj.visible = true;
                } else {
                    obj.visible = false;
                }
            }
        });
    }

    private onClick(event: MouseEvent) {
        if (!this.currentState || this.currentState.status !== 'PLAYING' || this.isAnimating) return;

        const rect = this.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        this.raycaster.setFromCamera(this.mouse, this.camera);

        // ハイライト（RingGeometry）を対象にレイキャスト
        const intersects = this.raycaster.intersectObjects(this.scene.children);
        const hitHighlight = intersects.find(ins => ins.object.userData && ins.object.userData.isHighlight && ins.object.visible);

        if (hitHighlight) {
            const pitIndex = hitHighlight.object.userData.index;
            // サーバー手番プレイヤーID（モック）
            const currentPlayerId = this.currentState.players?.[this.currentState.turn] || 'player1';

            // 種まきアニメーションを開始（今回はアニメーションの完了を待たずにアクションを送信する簡易実装）
            // this.playSowingAnimation(pitIndex); // ★アニメーションの実装は今回は省略

            this.onAction({
                type: 'SOW',
                pitIndex,
                playerId: currentPlayerId
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
        this.controls.update();
        this.renderer.render(this.scene, this.camera);
    }

    // 終了処理
    public dispose() {
        window.removeEventListener('click', this.onClick);
        window.removeEventListener('resize', this.onResize);
        this.renderer.dispose();
        this.geomStone.dispose();
        // マテリアルのdisposeも本来は必要
    }
}