import * as THREE from 'three';
import {
  BoardEngine,
  BoardedPassengerEvent,
  TapResult,
} from '../game/BoardEngine';
import { COLOR_PALETTE, VehicleState } from '../game/types';
import {
  CELL_SIZE,
  VehicleMeshFactory,
  VehicleVisual,
  createPassengerFigure,
  directionToYaw,
} from './VehicleMeshFactory';

interface DrivingAnim {
  vehicleId: string;
  waypoints: THREE.Vector3[];
  segmentIndex: number;
  segmentProgress: number;
  speed: number;
  onArrive: () => void;
}

interface BumpAnim {
  vehicleId: string;
  startPos: THREE.Vector3;
  targetPos: THREE.Vector3;
  elapsed: number;
  duration: number;
}

interface ShakeAnim {
  vehicleId: string;
  basePos: THREE.Vector3;
  elapsed: number;
  duration: number;
}

interface BoardingHopAnim {
  mesh: THREE.Group;
  startPos: THREE.Vector3;
  endPos: THREE.Vector3;
  elapsed: number;
  duration: number;
  onDone: () => void;
}

interface DepartAnim {
  vehicleId: string;
  elapsed: number;
  duration: number;
  startPos: THREE.Vector3;
  onDone: () => void;
}

export interface SceneCallbacks {
  onVehicleTapped: (vehicleId: string) => void;
  onVehicleDocked: (vehicleId: string) => void;
  onVehicleDeparted: (vehicleId: string) => void;
}

export class SceneManager {
  private container: HTMLElement;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private factory = new VehicleMeshFactory();
  private engine: BoardEngine;
  private callbacks: SceneCallbacks;

  private envGroup = new THREE.Group();
  private vehiclesGroup = new THREE.Group();
  private passengersGroup = new THREE.Group();
  private hopsGroup = new THREE.Group();
  private dockGroup = new THREE.Group();

  private vehicleVisuals = new Map<string, VehicleVisual>();
  private tunnelUpdaters = new Map<string, (n: number) => void>();
  private dockSlotMeshes: Array<{ pad: THREE.Mesh; lockIcon: THREE.Mesh }> = [];
  private dockPositions: THREE.Vector3[] = [];

  private drivingAnims: DrivingAnim[] = [];
  private bumpAnims: BumpAnim[] = [];
  private shakeAnims: ShakeAnim[] = [];
  private boardingHops: BoardingHopAnim[] = [];
  private departAnims: DepartAnim[] = [];

  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private clock = new THREE.Clock();
  private rafId = 0;

  private gridCenterZ = 1.4;
  private cameraShakeTime = 0;
  private baseCameraPos = new THREE.Vector3();
  private baseCameraLookAt = new THREE.Vector3();

  private queueCount = 0;

  constructor(
    container: HTMLElement,
    engine: BoardEngine,
    callbacks: SceneCallbacks
  ) {
    this.container = container;
    this.engine = engine;
    this.callbacks = callbacks;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#0f172a');
    this.scene.fog = new THREE.Fog('#0f172a', 26, 48);

    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(32, w / h, 0.1, 100);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;

    container.appendChild(this.renderer.domElement);

    this.setupLights();
    this.scene.add(this.envGroup);
    this.scene.add(this.dockGroup);
    this.scene.add(this.vehiclesGroup);
    this.scene.add(this.passengersGroup);
    this.scene.add(this.hopsGroup);

    this.bindEvents();
    this.rebuildFromEngine();
    this.animate();
  }

  private setupLights(): void {
    const hemi = new THREE.HemisphereLight('#e0f2fe', '#1e293b', 0.95);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight('#fffbeb', 1.65);
    sun.position.set(9, 18, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.width = 2048;
    sun.shadow.mapSize.height = 2048;
    sun.shadow.camera.near = 2;
    sun.shadow.camera.far = 45;
    const d = 13;
    sun.shadow.camera.left = -d;
    sun.shadow.camera.right = d;
    sun.shadow.camera.top = d;
    sun.shadow.camera.bottom = -d;
    sun.shadow.bias = -0.0005;
    this.scene.add(sun);

    const rim = new THREE.DirectionalLight('#60a5fa', 0.4);
    rim.position.set(-10, 8, -10);
    this.scene.add(rim);
  }

  private bindEvents(): void {
    window.addEventListener('resize', this.handleResize);
    this.renderer.domElement.addEventListener(
      'pointerdown',
      this.handlePointerDown
    );
  }

  private handleResize = (): void => {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.updateCameraFraming();
  };

  private handlePointerDown = (e: PointerEvent): void => {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(
      this.vehiclesGroup.children,
      true
    );
    if (hits.length === 0) return;

    let obj: THREE.Object3D | null = hits[0].object;
    while (obj && !obj.userData.vehicleId) {
      obj = obj.parent;
    }
    if (obj?.userData.vehicleId) {
      this.callbacks.onVehicleTapped(obj.userData.vehicleId as string);
    }
  };

  private getBoardMetrics() {
    const { cols, rows } = this.engine.level;
    const lotW = cols * CELL_SIZE;
    const lotD = rows * CELL_SIZE;
    const minX = -lotW / 2;
    const maxX = lotW / 2;
    const minZ = this.gridCenterZ - lotD / 2;
    const maxZ = this.gridCenterZ + lotD / 2;
    return { cols, rows, lotW, lotD, minX, maxX, minZ, maxZ };
  }

  private gridToWorld(gx: number, gy: number): THREE.Vector3 {
    const { cols, rows } = this.engine.level;
    const x = (gx - (cols - 1) / 2) * CELL_SIZE;
    const z = this.gridCenterZ + (gy - (rows - 1) / 2) * CELL_SIZE;
    return new THREE.Vector3(x, 0, z);
  }

  private getVehicleWorldPos(v: VehicleState): THREE.Vector3 {
    const horiz = v.dir === 'LEFT' || v.dir === 'RIGHT';
    const cx = horiz ? v.gridX + (v.lengthCells - 1) / 2 : v.gridX;
    const cy = horiz ? v.gridY : v.gridY + (v.lengthCells - 1) / 2;
    return this.gridToWorld(cx, cy);
  }

  private updateCameraFraming(): void {
    const { lotW, lotD, minZ, maxZ } = this.getBoardMetrics();
    const totalDepth = lotD + 5.8; // includes dock + queue sidewalk
    const totalWidth = Math.max(lotW + 2.8, 10.5);

    const aspect = this.camera.aspect || 1;
    const vFovRad = THREE.MathUtils.degToRad(this.camera.fov);
    const hFovRad = 2 * Math.atan(Math.tan(vFovRad / 2) * aspect);

    const distForHeight = (totalDepth * 0.62) / Math.tan(vFovRad / 2);
    const distForWidth = (totalWidth * 0.56) / Math.tan(hFovRad / 2);
    const dist = Math.max(distForHeight, distForWidth, 16.5);

    const centerZ = (minZ - 3.6 + maxZ) * 0.5 + 0.15;
    this.baseCameraLookAt.set(0, 0, centerZ);
    // 2.5D elevated top-down angle (~60 deg pitch)
    this.baseCameraPos.set(0, dist * 0.87, centerZ + dist * 0.46);

    this.camera.position.copy(this.baseCameraPos);
    this.camera.lookAt(this.baseCameraLookAt);
  }

  public rebuildFromEngine(): void {
    this.drivingAnims = [];
    this.bumpAnims = [];
    this.shakeAnims = [];
    this.boardingHops = [];
    this.departAnims = [];

    this.clearGroup(this.envGroup);
    this.clearGroup(this.dockGroup);
    this.clearGroup(this.vehiclesGroup);
    this.clearGroup(this.passengersGroup);
    this.clearGroup(this.hopsGroup);
    this.vehicleVisuals.clear();
    this.tunnelUpdaters.clear();
    this.dockSlotMeshes = [];
    this.dockPositions = [];

    this.buildEnvironment();
    this.buildDockSlots();
    this.syncAllEntities();
    this.updateCameraFraming();
  }

  private clearGroup(group: THREE.Group): void {
    while (group.children.length > 0) {
      group.remove(group.children[0]);
    }
  }

  private buildEnvironment(): void {
    const { cols, rows, lotW, lotD, minZ, maxZ } = this.getBoardMetrics();

    // Base plaza ground
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(80, 80),
      new THREE.MeshStandardMaterial({ color: '#1e293b', roughness: 0.95 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.14;
    ground.receiveShadow = true;
    this.envGroup.add(ground);

    // Perimeter Road Ring around the parking lot
    const roadW = lotW + 2.4;
    const roadD = lotD + 2.4;
    const roadMesh = new THREE.Mesh(
      new THREE.BoxGeometry(roadW, 0.12, roadD),
      new THREE.MeshStandardMaterial({ color: '#334155', roughness: 0.85 })
    );
    roadMesh.position.set(0, -0.07, this.gridCenterZ);
    roadMesh.receiveShadow = true;
    this.envGroup.add(roadMesh);

    // Road center lane dashed accent border
    const borderGeo = new THREE.EdgesGeometry(
      new THREE.BoxGeometry(lotW + 1.25, 0.02, lotD + 1.25)
    );
    const borderLines = new THREE.LineSegments(
      borderGeo,
      new THREE.LineBasicMaterial({ color: '#94a3b8', transparent: true, opacity: 0.35 })
    );
    borderLines.position.set(0, 0.0, this.gridCenterZ);
    this.envGroup.add(borderLines);

    // Elevated Parking Lot Slab
    const lotSlab = new THREE.Mesh(
      new THREE.BoxGeometry(lotW + 0.16, 0.12, lotD + 0.16),
      new THREE.MeshStandardMaterial({ color: '#475569', roughness: 0.78 })
    );
    lotSlab.position.set(0, -0.04, this.gridCenterZ);
    lotSlab.receiveShadow = true;
    this.envGroup.add(lotSlab);

    // Checkerboard / parking cell tiles for ultra crisp grid readability
    const tileGeo = new THREE.PlaneGeometry(CELL_SIZE * 0.9, CELL_SIZE * 0.9);
    tileGeo.rotateX(-Math.PI / 2);
    const matA = new THREE.MeshStandardMaterial({ color: '#3f4b5e', roughness: 0.85 });
    const matB = new THREE.MeshStandardMaterial({ color: '#46546a', roughness: 0.85 });
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const tile = new THREE.Mesh(tileGeo, (x + y) % 2 === 0 ? matA : matB);
        const pos = this.gridToWorld(x, y);
        tile.position.set(pos.x, 0.025, pos.z);
        tile.receiveShadow = true;
        this.envGroup.add(tile);
      }
    }

    // Passenger Boarding Sidewalk at the top
    const sidewalkZ = minZ - 3.65;
    const sidewalkW = Math.max(lotW + 2.4, 10.6);
    const sidewalk = new THREE.Mesh(
      new THREE.BoxGeometry(sidewalkW, 0.22, 1.35),
      new THREE.MeshStandardMaterial({ color: '#64748b', roughness: 0.72 })
    );
    sidewalk.position.set(0, 0.05, sidewalkZ);
    sidewalk.receiveShadow = true;
    this.envGroup.add(sidewalk);

    // Curb accent along sidewalk edge
    const curb = new THREE.Mesh(
      new THREE.BoxGeometry(sidewalkW, 0.08, 0.12),
      new THREE.MeshStandardMaterial({ color: '#facc15', roughness: 0.5 })
    );
    curb.position.set(0, 0.17, sidewalkZ + 0.65);
    this.envGroup.add(curb);

    // Decorative corner trees/bollards outside the road for visual warmth
    const postGeo = new THREE.CylinderGeometry(0.18, 0.22, 0.55, 10);
    const treeTopGeo = new THREE.SphereGeometry(0.45, 12, 10);
    const trunkMat = new THREE.MeshStandardMaterial({ color: '#78350f', roughness: 0.9 });
    const leafMat = new THREE.MeshStandardMaterial({ color: '#16a34a', roughness: 0.75 });
    const cornerOffsets = [
      [-roadW / 2 - 0.8, minZ - 0.6],
      [roadW / 2 + 0.8, minZ - 0.6],
      [-roadW / 2 - 0.8, maxZ + 0.6],
      [roadW / 2 + 0.8, maxZ + 0.6],
    ];
    for (const [tx, tz] of cornerOffsets) {
      const trunk = new THREE.Mesh(postGeo, trunkMat);
      trunk.position.set(tx, 0.2, tz);
      trunk.castShadow = true;
      this.envGroup.add(trunk);

      const leaves = new THREE.Mesh(treeTopGeo, leafMat);
      leaves.position.set(tx, 0.72, tz);
      leaves.castShadow = true;
      this.envGroup.add(leaves);
    }
  }

  private buildDockSlots(): void {
    const { minZ } = this.getBoardMetrics();
    const dockZ = minZ - 2.1;
    const totalSlots = this.engine.maxSlots;
    const slotSpacing = 1.38;
    const startX = -((totalSlots - 1) * slotSpacing) / 2;

    const padGeo = new THREE.BoxGeometry(1.16, 0.08, 1.56);
    const lockGeo = new THREE.BoxGeometry(0.38, 0.28, 0.32);
    const lockMat = new THREE.MeshStandardMaterial({
      color: '#facc15',
      roughness: 0.35,
      metalness: 0.25,
    });

    for (let i = 0; i < totalSlots; i++) {
      const x = startX + i * slotSpacing;
      const isVip = i >= this.engine.level.baseSlots;
      const unlocked = i < this.engine.unlockedSlots;

      const pad = new THREE.Mesh(
        padGeo,
        new THREE.MeshStandardMaterial({
          color: unlocked ? '#1e293b' : '#312e81',
          roughness: 0.6,
        })
      );
      pad.position.set(x, 0.01, dockZ);
      pad.receiveShadow = true;
      this.dockGroup.add(pad);

      // Painted bay rim
      const frame = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(1.14, 0.02, 1.54)),
        new THREE.LineBasicMaterial({
          color: isVip ? '#facc15' : '#38bdf8',
          transparent: true,
          opacity: unlocked ? 0.8 : 0.45,
        })
      );
      frame.position.set(x, 0.06, dockZ);
      this.dockGroup.add(frame);

      const lockIcon = new THREE.Mesh(lockGeo, lockMat);
      lockIcon.position.set(x, 0.24, dockZ);
      lockIcon.visible = !unlocked;
      this.dockGroup.add(lockIcon);

      this.dockSlotMeshes.push({ pad, lockIcon });
      this.dockPositions.push(new THREE.Vector3(x, 0, dockZ));
    }
  }

  public syncDockLocks(): void {
    for (let i = 0; i < this.dockSlotMeshes.length; i++) {
      const unlocked = i < this.engine.unlockedSlots;
      const { pad, lockIcon } = this.dockSlotMeshes[i];
      lockIcon.visible = !unlocked;
      (pad.material as THREE.MeshStandardMaterial).color.set(
        unlocked ? '#1e293b' : '#312e81'
      );
    }
  }

  public syncAllEntities(): void {
    // Sync tunnels
    for (const tunnel of this.engine.tunnels) {
      let updater = this.tunnelUpdaters.get(tunnel.id);
      if (!updater) {
        const built = this.factory.createTunnelMesh(
          tunnel.exitDir,
          tunnel.queue.length
        );
        const pos = this.gridToWorld(tunnel.gridX, tunnel.gridY);
        built.group.position.copy(pos);
        this.envGroup.add(built.group);
        updater = built.updateCount;
        this.tunnelUpdaters.set(tunnel.id, updater);
      }
      updater(tunnel.queue.length);
    }

    // Remove visuals that no longer exist in engine (e.g. after Undo of tunnel spawn)
    const activeIds = new Set(this.engine.vehicles.map((v) => v.id));
    for (const [id, vis] of this.vehicleVisuals.entries()) {
      if (!activeIds.has(id)) {
        this.vehiclesGroup.remove(vis.root);
        this.vehicleVisuals.delete(id);
      }
    }

    // Create/sync vehicles
    for (const v of this.engine.vehicles) {
      let vis = this.vehicleVisuals.get(v.id);
      if (!vis) {
        vis = this.factory.createVehicleVisual(v);
        vis.root.userData.vehicleId = v.id;
        this.vehiclesGroup.add(vis.root);
        this.vehicleVisuals.set(v.id, vis);
      }

      if (v.status === 'CLEARED') {
        vis.root.visible = false;
      } else if (v.status === 'GRID') {
        vis.root.visible = true;
        vis.root.scale.setScalar(1);
        vis.root.position.copy(this.getVehicleWorldPos(v));
        vis.root.rotation.set(0, directionToYaw(v.dir), 0);
      } else if (v.status === 'DOCKED' && v.dockSlotIndex !== null) {
        vis.root.visible = true;
        vis.root.scale.setScalar(v.size === 8 ? 0.66 : 0.8);
        vis.root.position.copy(this.dockPositions[v.dockSlotIndex]);
        vis.root.rotation.set(0, Math.PI, 0);
      }

      this.factory.syncVisualState(vis, v);
    }

    this.syncDockLocks();
    this.syncPassengerQueueVisual();
  }

  public syncPassengerQueueVisual(): void {
    this.clearGroup(this.passengersGroup);
    const { minZ } = this.getBoardMetrics();
    const sidewalkZ = minZ - 3.65;
    const maxShown = Math.min(20, this.engine.passengerQueue.length);
    this.queueCount = maxShown;

    for (let i = 0; i < maxShown; i++) {
      const color = this.engine.passengerQueue[i];
      const meta = COLOR_PALETTE[color];
      const fig = createPassengerFigure(meta.hex, meta.lightHex);
      const px = -4.2 + i * 0.48;
      fig.position.set(px, 0.16, sidewalkZ);
      fig.scale.setScalar(i === 0 ? 1.15 : 0.95);
      this.passengersGroup.add(fig);
    }
  }

  private getPerimeterWaypoints(v: VehicleState, slotIndex: number): THREE.Vector3[] {
    const { minX, maxX, minZ, maxZ } = this.getBoardMetrics();
    const start = this.getVehicleWorldPos(v);
    const slotPos = this.dockPositions[slotIndex];

    const roadLeftX = minX - 0.85;
    const roadRightX = maxX + 0.85;
    const roadTopZ = minZ - 0.85;
    const roadBottomZ = maxZ + 0.85;

    const pts: THREE.Vector3[] = [];
    if (v.dir === 'UP') {
      pts.push(new THREE.Vector3(start.x, 0, roadTopZ));
      pts.push(new THREE.Vector3(slotPos.x, 0, roadTopZ));
      pts.push(slotPos.clone());
    } else if (v.dir === 'LEFT') {
      pts.push(new THREE.Vector3(roadLeftX, 0, start.z));
      pts.push(new THREE.Vector3(roadLeftX, 0, roadTopZ));
      pts.push(new THREE.Vector3(slotPos.x, 0, roadTopZ));
      pts.push(slotPos.clone());
    } else if (v.dir === 'RIGHT') {
      pts.push(new THREE.Vector3(roadRightX, 0, start.z));
      pts.push(new THREE.Vector3(roadRightX, 0, roadTopZ));
      pts.push(new THREE.Vector3(slotPos.x, 0, roadTopZ));
      pts.push(slotPos.clone());
    } else {
      // DOWN: exit bottom then route around closer side
      pts.push(new THREE.Vector3(start.x, 0, roadBottomZ));
      const sideX = start.x < 0 ? roadLeftX : roadRightX;
      pts.push(new THREE.Vector3(sideX, 0, roadBottomZ));
      pts.push(new THREE.Vector3(sideX, 0, roadTopZ));
      pts.push(new THREE.Vector3(slotPos.x, 0, roadTopZ));
      pts.push(slotPos.clone());
    }
    return pts;
  }

  public playTapReaction(result: TapResult): void {
    if (result.type === 'FROZEN') {
      const vis = this.vehicleVisuals.get(result.vehicle.id);
      if (vis) {
        this.shakeAnims.push({
          vehicleId: result.vehicle.id,
          basePos: this.getVehicleWorldPos(result.vehicle),
          elapsed: 0,
          duration: 0.28,
        });
      }
      return;
    }

    if (result.type === 'BLOCKED') {
      const startPos = this.getVehicleWorldPos(result.vehicle);
      const stepDist = Math.max(0.28, result.freeSteps * CELL_SIZE + 0.28);
      const offset = new THREE.Vector3();
      switch (result.vehicle.dir) {
        case 'UP':
          offset.z = -stepDist;
          break;
        case 'DOWN':
          offset.z = stepDist;
          break;
        case 'LEFT':
          offset.x = -stepDist;
          break;
        case 'RIGHT':
          offset.x = stepDist;
          break;
      }
      this.bumpAnims.push({
        vehicleId: result.vehicle.id,
        startPos,
        targetPos: startPos.clone().add(offset),
        elapsed: 0,
        duration: 0.28,
      });
      this.cameraShakeTime = 0.16;
      return;
    }

    if (result.type === 'EXIT_STARTED') {
      // Refresh tunnel counters, revealed mystery cars, and thawed ice immediately
      for (const tunnel of this.engine.tunnels) {
        this.tunnelUpdaters.get(tunnel.id)?.(tunnel.queue.length);
      }
      for (const rev of result.revealedVehicles) {
        const vis = this.vehicleVisuals.get(rev.id);
        if (vis) this.factory.syncVisualState(vis, rev);
      }
      for (const ice of result.iceUpdates) {
        const vis = this.vehicleVisuals.get(ice.vehicle.id);
        if (vis) this.factory.syncVisualState(vis, ice.vehicle);
      }
      for (const spawned of result.spawnedFromTunnels) {
        const vis = this.factory.createVehicleVisual(spawned.vehicle);
        vis.root.userData.vehicleId = spawned.vehicle.id;
        vis.root.position.copy(this.getVehicleWorldPos(spawned.vehicle));
        vis.root.rotation.set(0, directionToYaw(spawned.vehicle.dir), 0);
        vis.root.scale.setScalar(0.1);
        this.vehiclesGroup.add(vis.root);
        this.vehicleVisuals.set(spawned.vehicle.id, vis);
        // Quick pop-in via small shake/scale reset handled in animate
        setTimeout(() => {
          vis.root.scale.setScalar(1);
        }, 40);
      }

      const waypoints = this.getPerimeterWaypoints(
        result.vehicle,
        result.slotIndex
      );
      this.drivingAnims.push({
        vehicleId: result.vehicle.id,
        waypoints,
        segmentIndex: 0,
        segmentProgress: 0,
        speed: 14.5,
        onArrive: () => {
          const vis = this.vehicleVisuals.get(result.vehicle.id);
          if (vis) {
            vis.root.scale.setScalar(result.vehicle.size === 8 ? 0.66 : 0.8);
            vis.root.rotation.set(0, Math.PI, 0);
          }
          this.callbacks.onVehicleDocked(result.vehicle.id);
        },
      });
    }
  }

  public playBoardingHop(ev: BoardedPassengerEvent): void {
    const vis = this.vehicleVisuals.get(ev.vehicle.id);
    if (!vis) return;

    const { minZ } = this.getBoardMetrics();
    const sidewalkZ = minZ - 3.65;
    const startPos = new THREE.Vector3(-4.2, 0.16, sidewalkZ);

    const slotPos =
      ev.vehicle.dockSlotIndex !== null
        ? this.dockPositions[ev.vehicle.dockSlotIndex]
        : vis.root.position;
    const endPos = slotPos.clone().add(new THREE.Vector3(0, 0.5, 0));

    const meta = COLOR_PALETTE[ev.color];
    const hopper = createPassengerFigure(meta.hex, meta.lightHex);
    hopper.position.copy(startPos);
    this.hopsGroup.add(hopper);

    this.syncPassengerQueueVisual();

    this.boardingHops.push({
      mesh: hopper,
      startPos,
      endPos,
      elapsed: 0,
      duration: 0.22,
      onDone: () => {
        this.hopsGroup.remove(hopper);
        this.factory.syncVisualState(vis, ev.vehicle);
        if (ev.isFull) {
          this.playVehicleDeparture(ev.vehicle);
        }
      },
    });
  }

  public playVehicleDeparture(vehicle: VehicleState): void {
    const vis = this.vehicleVisuals.get(vehicle.id);
    if (!vis) {
      this.callbacks.onVehicleDeparted(vehicle.id);
      return;
    }
    this.factory.syncVisualState(vis, vehicle);
    this.departAnims.push({
      vehicleId: vehicle.id,
      elapsed: 0,
      duration: 0.34,
      startPos: vis.root.position.clone(),
      onDone: () => {
        vis.root.visible = false;
        this.callbacks.onVehicleDeparted(vehicle.id);
      },
    });
  }

  private animate = (): void => {
    this.rafId = requestAnimationFrame(this.animate);
    const dt = Math.min(0.05, this.clock.getDelta());

    // Update driving vehicles
    for (let i = this.drivingAnims.length - 1; i >= 0; i--) {
      const anim = this.drivingAnims[i];
      const vis = this.vehicleVisuals.get(anim.vehicleId);
      if (!vis) {
        this.drivingAnims.splice(i, 1);
        continue;
      }

      const currentStart =
        anim.segmentIndex === 0
          ? vis.root.position.clone()
          : anim.waypoints[anim.segmentIndex - 1];
      const target = anim.waypoints[anim.segmentIndex];

      const dist = currentStart.distanceTo(target);
      if (dist < 0.001) {
        anim.segmentIndex++;
      } else {
        const step = (anim.speed * dt) / dist;
        anim.segmentProgress += step;
        const t = Math.min(1, anim.segmentProgress);
        vis.root.position.lerpVectors(currentStart, target, t);

        // Face travel direction smoothly
        const dirVec = target.clone().sub(currentStart);
        if (dirVec.lengthSq() > 0.0001) {
          const desiredYaw = Math.atan2(dirVec.x, dirVec.z);
          vis.root.rotation.y = desiredYaw;
        }

        if (t >= 1) {
          vis.root.position.copy(target);
          anim.segmentIndex++;
          anim.segmentProgress = 0;
        }
      }

      if (anim.segmentIndex >= anim.waypoints.length) {
        this.drivingAnims.splice(i, 1);
        anim.onArrive();
      }
    }

    // Update blocked bumps
    for (let i = this.bumpAnims.length - 1; i >= 0; i--) {
      const b = this.bumpAnims[i];
      const vis = this.vehicleVisuals.get(b.vehicleId);
      b.elapsed += dt;
      const p = Math.min(1, b.elapsed / b.duration);
      const pingPong = p < 0.4 ? p / 0.4 : 1 - (p - 0.4) / 0.6;
      if (vis) {
        vis.root.position.lerpVectors(b.startPos, b.targetPos, pingPong);
      }
      if (p >= 1) {
        if (vis) vis.root.position.copy(b.startPos);
        this.bumpAnims.splice(i, 1);
      }
    }

    // Update frozen shakes
    for (let i = this.shakeAnims.length - 1; i >= 0; i--) {
      const s = this.shakeAnims[i];
      const vis = this.vehicleVisuals.get(s.vehicleId);
      s.elapsed += dt;
      const p = Math.min(1, s.elapsed / s.duration);
      if (vis) {
        const offset = Math.sin(p * Math.PI * 6) * (1 - p) * 0.09;
        vis.root.position.set(
          s.basePos.x + offset,
          s.basePos.y,
          s.basePos.z
        );
      }
      if (p >= 1) {
        if (vis) vis.root.position.copy(s.basePos);
        this.shakeAnims.splice(i, 1);
      }
    }

    // Update parabolic boarding hops
    for (let i = this.boardingHops.length - 1; i >= 0; i--) {
      const h = this.boardingHops[i];
      h.elapsed += dt;
      const p = Math.min(1, h.elapsed / h.duration);
      h.mesh.position.lerpVectors(h.startPos, h.endPos, p);
      h.mesh.position.y += Math.sin(p * Math.PI) * 1.1;
      if (p >= 1) {
        this.boardingHops.splice(i, 1);
        h.onDone();
      }
    }

    // Update departing vehicles zooming away
    for (let i = this.departAnims.length - 1; i >= 0; i--) {
      const d = this.departAnims[i];
      const vis = this.vehicleVisuals.get(d.vehicleId);
      d.elapsed += dt;
      const p = Math.min(1, d.elapsed / d.duration);
      if (vis) {
        vis.root.position.set(
          d.startPos.x + p * 8.5,
          d.startPos.y + Math.sin(p * Math.PI) * 0.25,
          d.startPos.z - p * 3.0
        );
        vis.root.rotation.y = Math.PI * 0.72;
        vis.root.scale.setScalar(Math.max(0.01, (1 - p) * 0.75));
      }
      if (p >= 1) {
        this.departAnims.splice(i, 1);
        d.onDone();
      }
    }

    // Gentle bounce on front queue passenger
    if (this.queueCount > 0 && this.passengersGroup.children.length > 0) {
      const t = this.clock.elapsedTime;
      const first = this.passengersGroup.children[0];
      first.position.y = 0.16 + Math.abs(Math.sin(t * 5)) * 0.08;
    }

    // Micro camera shake on bump
    if (this.cameraShakeTime > 0) {
      this.cameraShakeTime = Math.max(0, this.cameraShakeTime - dt);
      const amt = this.cameraShakeTime * 0.55;
      this.camera.position.set(
        this.baseCameraPos.x + (Math.random() - 0.5) * amt,
        this.baseCameraPos.y + (Math.random() - 0.5) * amt,
        this.baseCameraPos.z
      );
    } else {
      this.camera.position.copy(this.baseCameraPos);
    }

    this.renderer.render(this.scene, this.camera);
  };

  public dispose(): void {
    cancelAnimationFrame(this.rafId);
    window.removeEventListener('resize', this.handleResize);
    this.renderer.domElement.removeEventListener(
      'pointerdown',
      this.handlePointerDown
    );
    this.renderer.dispose();
  }
}
