// src/three/Othello3DUI.ts
import * as THREE from "three";
import type { GameState, MoveAction } from "@engine/shared/rules/Othello3DRuleset";
import { BaseThreeUI } from "./BaseThreeUI";

export class Othello3DUI extends BaseThreeUI {
  private size: number;
  private onAction: (action: MoveAction) => void;

  private spheres: (THREE.Mesh | null)[][][] = [];
  private gridCubes: THREE.Mesh[][][] = [];
  private interactableCubes: THREE.Mesh[] = [];

  private currentHovered: THREE.Mesh | null = null;
  private currentState: GameState | null = null;

  // マテリアル
  private matEmpty = new THREE.MeshBasicMaterial({
    color: 0x444444,
    transparent: true,
    opacity: 0.02,
    depthWrite: false,
  });
  private matValidBlack = new THREE.MeshBasicMaterial({
    color: 0x00ffff,
    transparent: true,
    opacity: 0.25,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  private matHoverBlack = new THREE.MeshBasicMaterial({
    color: 0x0088ff,
    transparent: true,
    opacity: 0.7,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  private matValidWhite = new THREE.MeshBasicMaterial({
    color: 0xff00ff,
    transparent: true,
    opacity: 0.25,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  private matHoverWhite = new THREE.MeshBasicMaterial({
    color: 0xff0088,
    transparent: true,
    opacity: 0.7,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  private currentValidMat = this.matValidBlack;
  private currentHoverMat = this.matHoverBlack;

  constructor(
    container: HTMLElement,
    size: number,
    onActionCallback: (action: MoveAction) => void,
  ) {
    super(container, {
      fov: 75,
      cameraPosition: [size * 1.8, size * 1.8, size * 2.8],
      background: 0x1a1a1a,
    });
    this.size = size;
    this.onAction = onActionCallback;

    this.scene.add(new THREE.AmbientLight(0x404040, 2));
    const dirLight = new THREE.DirectionalLight(0xffffff, 1);
    dirLight.position.set(10, 10, 10).normalize();
    this.scene.add(dirLight);

    this.initGrid();

    this.addListener(window, "click", this.onClick.bind(this));
    this.addListener(window, "mousemove", this.onMouseMove.bind(this));
  }

  private initGrid() {
    const offset = (this.size - 1) / 2;
    const geomCube = new THREE.BoxGeometry(1, 1, 1);
    const edgesGeom = new THREE.EdgesGeometry(geomCube);
    const lineMat = new THREE.LineBasicMaterial({
      color: 0x555555,
      transparent: true,
      opacity: 0.5,
    });

    for (let z = 0; z < this.size; z++) {
      this.spheres[z] = [];
      this.gridCubes[z] = [];
      for (let y = 0; y < this.size; y++) {
        this.spheres[z][y] = [];
        this.gridCubes[z][y] = [];
        for (let x = 0; x < this.size; x++) {
          const meshCube = new THREE.Mesh(geomCube, this.matEmpty);
          meshCube.position.set(x - offset, y - offset, z - offset);
          meshCube.userData = { x, y, z, isValid: false };
          this.scene.add(meshCube);
          this.gridCubes[z][y][x] = meshCube;
          this.interactableCubes.push(meshCube);

          const line = new THREE.LineSegments(edgesGeom, lineMat);
          line.position.copy(meshCube.position);
          this.scene.add(line);

          this.spheres[z][y][x] = null;
        }
      }
    }
  }

  public renderState(state: GameState) {
    this.currentState = state;
    const offset = (this.size - 1) / 2;

    this.currentValidMat = state.currentTurn === 1 ? this.matValidBlack : this.matValidWhite;
    this.currentHoverMat = state.currentTurn === 1 ? this.matHoverBlack : this.matHoverWhite;

    for (let z = 0; z < this.size; z++) {
      for (let y = 0; y < this.size; y++) {
        for (let x = 0; x < this.size; x++) {
          const color = state.board[z][y][x];
          let sphere = this.spheres[z][y][x];

          if (color !== 0) {
            if (!sphere) {
              const geom = new THREE.SphereGeometry(0.4, 32, 32);
              const mat = new THREE.MeshPhongMaterial({ shininess: 50 });
              sphere = new THREE.Mesh(geom, mat);
              sphere.position.set(x - offset, y - offset, z - offset);
              this.scene.add(sphere);
              this.spheres[z][y][x] = sphere;
            }
            const targetColor = color === 1 ? new THREE.Color(0x111111) : new THREE.Color(0xffffff);
            (sphere.material as THREE.MeshPhongMaterial).color.lerp(targetColor, 1);
          }

          const cube = this.gridCubes[z][y][x];
          cube.userData.isValid = false;
          cube.visible = color === 0;
          cube.material = this.matEmpty;
        }
      }
    }

    if (state.status === "PLAYING") {
      state.validMoves.forEach((pos: { x: number; y: number; z: number }) => {
        const cube = this.gridCubes[pos.z][pos.y][pos.x];
        if (cube) {
          cube.userData.isValid = true;
          cube.material = this.currentValidMat;
        }
      });
    }
  }

  private restoreCubeMaterial(cube: THREE.Mesh) {
    cube.material = cube.userData.isValid ? this.currentValidMat : this.matEmpty;
  }

  private onMouseMove(event: MouseEvent) {
    if (!this.currentState || this.currentState.status !== "PLAYING") return;

    this.updateMouse(event);
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const validTargets = this.interactableCubes.filter((c) => c.userData.isValid);
    const intersects = this.raycaster.intersectObjects(validTargets);

    if (intersects.length > 0) {
      const obj = intersects[0].object as THREE.Mesh;
      if (this.currentHovered !== obj) {
        if (this.currentHovered) this.restoreCubeMaterial(this.currentHovered);
        this.currentHovered = obj;
        this.currentHovered.material = this.currentHoverMat;
      }
    } else {
      if (this.currentHovered) {
        this.restoreCubeMaterial(this.currentHovered);
        this.currentHovered = null;
      }
    }
  }

  private onClick(event: MouseEvent) {
    if (!this.currentState || this.currentState.status !== "PLAYING") return;

    this.updateMouse(event);
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const validTargets = this.interactableCubes.filter((c) => c.userData.isValid);
    const intersects = this.raycaster.intersectObjects(validTargets);

    if (intersects.length > 0) {
      const obj = intersects[0].object as THREE.Mesh;
      const { x, y, z, isValid } = obj.userData;
      if (isValid) {
        this.onAction({
          type: "MOVE",
          x,
          y,
          z,
          color: this.currentState.currentTurn,
        });
      }
    }
  }
}
