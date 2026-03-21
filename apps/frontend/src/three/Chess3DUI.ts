// src/three/Chess3DUI.ts
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { ChessState, ChessAction } from '@engine/shared/rules/ChessRuleset';

export class Chess3DUI {
    private onAction: (action: ChessAction) => void;
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

    private pieceMeshes: Map<number, THREE.Object3D> = new Map(); // index -> Mesh
    private cellMeshes: THREE.Mesh[] = [];

    private currentState: ChessState | null = null;
    private selectedIndex: number | null = null;
    private animationId: number | null = null;
    private isDisposed = false;

    private loader = new GLTFLoader();

    // Materials
    private matLightSquare = new THREE.MeshLambertMaterial({ color: 0xf0d9b5 });
    private matDarkSquare = new THREE.MeshLambertMaterial({ color: 0xb58863 });
    private matSelected = new THREE.MeshBasicMaterial({ color: 0xffff33, transparent: true, opacity: 0.5 });

    constructor(
        container: HTMLElement,
        onActionCallback: (action: ChessAction) => void,
        onRequirePromotion: (from: number, to: number) => void
    ) {
        this.container = container;
        this.onAction = onActionCallback;
        this.onRequirePromotion = onRequirePromotion;
        this.initThreeJS(container);
    }

    private initThreeJS(container: HTMLElement) {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x111111);

        this.camera = new THREE.PerspectiveCamera(60, container.clientWidth / container.clientHeight, 0.1, 1000);
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

        // Hemisphere light for natural top/bottom lighting
        const hemiLight = new THREE.HemisphereLight(0xffffff, 0x000000, 0.8);
        this.scene.add(hemiLight);

        const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
        dirLight.position.set(5, 12, 8);
        dirLight.castShadow = true;
        this.scene.add(dirLight);

        // Add a secondary light from the back to catch edges
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
        window.addEventListener('click', this.onClick, false);
        window.addEventListener('resize', this.onResize, false);

        this.animate();
    }

    private initBoard() {
        const squareSize = 1;
        const offset = 3.5;

        for (let i = 0; i < 64; i++) {
            const x = (i % 8);
            const y = Math.floor(i / 8);

            const isLight = (x + y) % 2 === 0;
            const geom = new THREE.BoxGeometry(squareSize, 0.2, squareSize);
            const mat = isLight ? this.matLightSquare : this.matDarkSquare;

            const square = new THREE.Mesh(geom, mat);
            square.position.set(x - offset, -0.1, y - offset);
            square.receiveShadow = true;
            square.userData = { index: i, type: 'cell' };

            this.boardGroup.add(square);
            this.cellMeshes[i] = square;
        }
    }

    private initEnvironment() {
        // Floor
        const floorGeom = new THREE.PlaneGeometry(100, 100);
        const floorMat = new THREE.MeshStandardMaterial({
            color: 0x1a1a1a,
            roughness: 0.8,
            metalness: 0.2
        });
        const floor = new THREE.Mesh(floorGeom, floorMat);
        floor.rotation.x = -Math.PI / 2;
        floor.position.y = -0.2;
        floor.receiveShadow = true;
        this.scene.add(floor);

        // Grid helper for a more "space-like" or "tech-like" feel
        const grid = new THREE.GridHelper(40, 40, 0x444444, 0x222222);
        grid.position.y = -0.19;
        this.scene.add(grid);

        // Update scene background
        this.scene.background = new THREE.Color(0x050505);
        this.scene.fog = new THREE.Fog(0x050505, 10, 50);
    }

    private modelCache: Map<string, THREE.Object3D> = new Map();

    public async renderState(state: ChessState) {
        this.currentState = state;

        this.piecesGroup.clear();
        this.pieceMeshes.clear();

        const offset = 3.5;

        // Pre-load unique models to avoid redundant loads
        const uniquePieces = new Set<number>();
        for (const val of state.board) {
            if (val !== 0) uniquePieces.add(val);
        }

        for (const val of uniquePieces) {
            await this.getOrLoadModel(val);
        }

        for (let i = 0; i < 64; i++) {
            const val = state.board[i];
            if (val !== 0) {
                const x = (i % 8) - offset;
                const z = Math.floor(i / 8) - offset;

                const pieceObj = await this.createPieceObject(val);
                pieceObj.position.set(x, 0, z);
                pieceObj.userData = { index: i, type: 'piece', value: val };
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
            1: 'pawn', 2: 'knight', 3: 'bishop', 4: 'rook', 5: 'queen', 6: 'king'
        };
        const pieceName = typeMap[type];
        const cacheKey = `${pieceName}_${color}`;

        if (this.modelCache.has(cacheKey)) {
            return this.modelCache.get(cacheKey)!;
        }

        const modelPath = `/assets/games/chess/models/${pieceName}.glb?v=${Date.now()}`;

        try {
            const gltf = await this.loader.loadAsync(modelPath);
            const scene = gltf.scene;

            // --- Robust model extraction ---
            // Often exports contain extra stuff (lights, cameras, floors).
            // We search for meshes and try to group them.
            const meshes: THREE.Mesh[] = [];
            scene.traverse((node) => {
                if (node instanceof THREE.Mesh) {
                    // Ignore things that look like floors or huge blocks
                    if (node.name.toLowerCase().includes('floor') || node.name.toLowerCase().includes('plane')) {
                        return;
                    }
                    meshes.push(node);
                }
            });

            const group = new THREE.Group();

            // Calculate center and box once for the loaded scene
            const box = new THREE.Box3().setFromObject(scene);
            const center = box.getCenter(new THREE.Vector3());
            const bottom = box.min.y;

            if (meshes.length > 0) {
                meshes.forEach(m => {
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

            // --- Force Material Application ---
            // "Tinted Glass" look for both pieces
            const glassMaterial = new THREE.MeshPhysicalMaterial({
                color: color === 1 ? 0xffffff : 0x000000,
                metalness: 0.1,
                roughness: 0.05,
                transmission: 0.95, // High transparency
                thickness: 2.0,
                ior: 1.5,
                reflectivity: 0.8,
                transparent: true,
                opacity: 0.7,
                // Add internal color tint
                attenuationColor: color === 1 ? 0xfff0d0 : 0x001030, // Warm tint for white, cool tint for black
                attenuationDistance: 0.4,
                clearcoat: 1.0,
                clearcoatRoughness: 0.05,
            });

            group.traverse((node: any) => {
                if (node.isMesh) {
                    node.material = glassMaterial;
                    node.material.map = null;
                    node.material.vertexColors = false;
                    node.material.needsUpdate = true;

                    node.castShadow = true;
                    node.receiveShadow = true;
                }
            });

            console.log(`Applied glass material to piece: ${pieceName} (${color === 1 ? 'White' : 'Black'})`);

            // --- Scaling ---
            const finalBox = new THREE.Box3().setFromObject(group);
            const size = finalBox.getSize(new THREE.Vector3());
            const maxDim = Math.max(size.x, size.z);
            const scale = 0.85 / (maxDim || 1);
            group.scale.set(scale, scale, scale);

            // --- Rotation ---
            if (pieceName === 'knight') {
                group.rotation.y = Math.PI; // Bases Knight rotation
            }

            if (color === -1) {
                group.rotation.y += Math.PI;
            }

            this.modelCache.set(cacheKey, group);
            return group;
        } catch (e) {
            console.warn(`Failed to load model: ${modelPath}`, e);
            const placeholder = this.createPlaceholderPiece(type, color);
            this.modelCache.set(cacheKey, placeholder);
            return placeholder;
        }
    }

    private async createPieceObject(val: number): Promise<THREE.Object3D> {
        const model = await this.getOrLoadModel(val);
        return model ? model.clone() : new THREE.Group();
    }

    private createPlaceholderPiece(type: number, color: number): THREE.Object3D {
        let geom: THREE.BufferGeometry;

        switch (type) {
            case 1: geom = new THREE.CylinderGeometry(0.3, 0.35, 0.8); break; // Pawn
            case 2: geom = new THREE.BoxGeometry(0.4, 1.0, 0.6); break;      // Knight
            case 3: geom = new THREE.CylinderGeometry(0.2, 0.4, 1.2); break; // Bishop
            case 4: geom = new THREE.BoxGeometry(0.5, 0.9, 0.5); break;      // Rook
            case 5: geom = new THREE.CylinderGeometry(0.3, 0.4, 1.5); break; // Queen
            case 6: geom = new THREE.BoxGeometry(0.6, 1.6, 0.6); break;      // King
            default: geom = new THREE.SphereGeometry(0.4);
        }

        const mat = new THREE.MeshStandardMaterial({
            color: color === 1 ? 0xe0e0e0 : 0x222222,
            roughness: 0.5
        });

        const mesh = new THREE.Mesh(geom, mat);
        mesh.translateY(geom.type === 'BoxGeometry' ? 0.5 : 0.4);
        mesh.castShadow = true;

        const group = new THREE.Group();
        group.add(mesh);
        return group;
    }

    private updateHighlights() {
        this.highlightGroup.clear();
        if (this.selectedIndex === null || !this.currentState) return;

        // Highlight selected
        this.addHighlight(this.selectedIndex, this.matSelected);

        // Highlight valid moves
        // Note: In ChessRuleset, promotion is handled separately. 
        // For simplicity, we just highlight the 'to' squares.

        // This is a bit inefficient (recalculating legal actions on every click)
        // But for Chess it's fine.
        // We'd ideally take validMoves as a param.
    }

    private addHighlight(index: number, mat: THREE.Material) {
        const offset = 3.5;
        const x = (index % 8) - offset;
        const z = Math.floor(index / 8) - offset;

        const geom = new THREE.PlaneGeometry(0.95, 0.95);
        const mesh = new THREE.Mesh(geom, mat);
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.set(x, 0.01, z);
        this.highlightGroup.add(mesh);
    }

    private onClick(event: MouseEvent) {
        if (!this.currentState || this.currentState.status !== 'PLAYING') return;

        const rect = this.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        this.raycaster.setFromCamera(this.mouse, this.camera);
        // Use recursive: true to hit meshes inside groups
        const intersects = this.raycaster.intersectObjects([...this.cellMeshes, ...Array.from(this.pieceMeshes.values())], true);

        if (intersects.length > 0) {
            // Find the first parent that has an index (either a cell or a piece group)
            let hit: THREE.Object3D | null = intersects[0].object;
            while (hit && hit.userData.index === undefined) {
                hit = hit.parent;
            }

            if (!hit) return;

            const index = hit.userData.index;

            if (this.selectedIndex === null) {
                // Select piece
                const val = this.currentState.board[index];
                if (val !== 0 && Math.sign(val) === this.currentState.turn) {
                    this.selectedIndex = index;
                    this.updateHighlights();
                }
            } else {
                // Move or Re-select
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
                    // Check if move is legal (simplification: emit to component to handle)
                    this.handleMoveAttempt(this.selectedIndex, index);
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
        const isPawn = Math.abs(piece) === 1;
        const isPromotionRank = (this.currentState.turn === 1 && Math.floor(to / 8) === 0) ||
            (this.currentState.turn === -1 && Math.floor(to / 8) === 7);

        if (isPawn && isPromotionRank) {
            this.onRequirePromotion(from, to);
        } else {
            this.onAction({ type: 'MOVE', from, to });
        }

        this.selectedIndex = null;
        this.updateHighlights();
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
        window.removeEventListener('click', this.onClick);
        window.removeEventListener('resize', this.onResize);
        this.renderer.dispose();
    }
}
