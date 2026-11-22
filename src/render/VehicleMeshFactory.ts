import * as THREE from 'three';
import { COLOR_PALETTE, ColorId, Direction, VehicleState } from '../game/types';

export const CELL_SIZE = 1.25;

export interface VehicleVisual {
  root: THREE.Group;
  bodyMeshes: THREE.Mesh[];
  seatPassengers: THREE.Group[];
  iceMesh: THREE.Mesh;
  iceBadge: THREE.Sprite;
  mysteryBadge: THREE.Sprite;
  arrowMesh: THREE.Mesh;
  baseColor: ColorId;
  lastFrozenCount: number;
  lastMystery: boolean;
}

function makeBadgeTexture(
  text: string,
  bgHex: string,
  fgHex: string,
  borderHex: string
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;

  ctx.clearRect(0, 0, 128, 128);
  ctx.beginPath();
  ctx.arc(64, 64, 52, 0, Math.PI * 2);
  ctx.fillStyle = bgHex;
  ctx.fill();
  ctx.lineWidth = 8;
  ctx.strokeStyle = borderHex;
  ctx.stroke();

  ctx.fillStyle = fgHex;
  ctx.font = 'bold 58px system-ui, -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 64, 68);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createPassengerFigure(colorHex: string, lightHex: string): THREE.Group {
  const g = new THREE.Group();

  const bodyMat = new THREE.MeshStandardMaterial({
    color: colorHex,
    roughness: 0.4,
    metalness: 0.05,
  });
  const headMat = new THREE.MeshStandardMaterial({
    color: lightHex,
    roughness: 0.35,
    metalness: 0.05,
  });

  const torso = new THREE.Mesh(
    new THREE.CylinderGeometry(0.11, 0.14, 0.24, 12),
    bodyMat
  );
  torso.position.y = 0.12;
  torso.castShadow = true;
  g.add(torso);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 14, 12), headMat);
  head.position.y = 0.31;
  head.castShadow = true;
  g.add(head);

  return g;
}

export function directionToYaw(dir: Direction): number {
  switch (dir) {
    case 'DOWN':
      return 0;
    case 'UP':
      return Math.PI;
    case 'RIGHT':
      return Math.PI / 2;
    case 'LEFT':
      return -Math.PI / 2;
  }
}

export class VehicleMeshFactory {
  private sharedDarkMat = new THREE.MeshStandardMaterial({
    color: '#0f172a',
    roughness: 0.65,
  });
  private sharedGlassMat = new THREE.MeshStandardMaterial({
    color: '#1e293b',
    roughness: 0.12,
    metalness: 0.35,
  });
  private sharedTireMat = new THREE.MeshStandardMaterial({
    color: '#111827',
    roughness: 0.85,
  });
  private sharedRimMat = new THREE.MeshStandardMaterial({
    color: '#cbd5e1',
    roughness: 0.3,
    metalness: 0.6,
  });
  private sharedWhiteMat = new THREE.MeshStandardMaterial({
    color: '#f8fafc',
    roughness: 0.3,
  });
  private sharedHeadlightMat = new THREE.MeshStandardMaterial({
    color: '#fef08a',
    emissive: '#fde047',
    emissiveIntensity: 0.4,
  });
  private sharedTaillightMat = new THREE.MeshStandardMaterial({
    color: '#ef4444',
    emissive: '#dc2626',
    emissiveIntensity: 0.35,
  });
  private mysteryTexture: THREE.CanvasTexture;
  private iceTextures = new Map<number, THREE.CanvasTexture>();

  constructor() {
    this.mysteryTexture = makeBadgeTexture('?', '#1e293b', '#facc15', '#facc15');
  }

  private getIceTexture(count: number): THREE.CanvasTexture {
    if (!this.iceTextures.has(count)) {
      this.iceTextures.set(
        count,
        makeBadgeTexture(`❄${count}`, '#0ea5e9', '#ffffff', '#e0f2fe')
      );
    }
    return this.iceTextures.get(count)!;
  }

  public createVehicleVisual(v: VehicleState): VehicleVisual {
    const root = new THREE.Group();
    const meta = COLOR_PALETTE[v.color];

    const bodyColor = v.mystery ? '#475569' : meta.hex;
    const paintMat = new THREE.MeshStandardMaterial({
      color: bodyColor,
      roughness: 0.32,
      metalness: 0.08,
    });

    const isBus = v.size === 8;
    const isVan = v.size === 6;

    const width = isBus ? 0.94 : isVan ? 0.9 : 0.84;
    const length =
      v.lengthCells === 3 ? CELL_SIZE * 2.74 : CELL_SIZE * 1.72;
    const bodyHeight = isBus ? 0.56 : isVan ? 0.52 : 0.42;

    const bodyMeshes: THREE.Mesh[] = [];

    // Main lower chassis
    const chassis = new THREE.Mesh(
      new THREE.BoxGeometry(width, bodyHeight * 0.62, length),
      paintMat
    );
    chassis.position.y = bodyHeight * 0.31 + 0.12;
    chassis.castShadow = true;
    chassis.receiveShadow = true;
    root.add(chassis);
    bodyMeshes.push(chassis);

    // Front hood + windshield block (+Z is forward)
    const hoodLen = isBus ? 0.42 : 0.48;
    const hood = new THREE.Mesh(
      new THREE.BoxGeometry(width * 0.94, bodyHeight * 0.42, hoodLen),
      paintMat
    );
    hood.position.set(0, bodyHeight * 0.62 + 0.12, length * 0.5 - hoodLen * 0.52);
    hood.castShadow = true;
    root.add(hood);
    bodyMeshes.push(hood);

    const windshield = new THREE.Mesh(
      new THREE.BoxGeometry(width * 0.84, 0.18, 0.24),
      this.sharedGlassMat
    );
    windshield.position.set(
      0,
      bodyHeight * 0.82 + 0.12,
      length * 0.5 - hoodLen - 0.05
    );
    windshield.rotation.x = 0.25;
    root.add(windshield);

    // Open-top cabin rim & interior dark floor
    const cabinLen = length - hoodLen - 0.22;
    const cabinCenterZ = -0.06 - (hoodLen * 0.35);

    const cabinWallLeft = new THREE.Mesh(
      new THREE.BoxGeometry(0.09, bodyHeight * 0.38, cabinLen),
      paintMat
    );
    cabinWallLeft.position.set(-width * 0.45, bodyHeight * 0.72 + 0.12, cabinCenterZ);
    cabinWallLeft.castShadow = true;
    root.add(cabinWallLeft);
    bodyMeshes.push(cabinWallLeft);

    const cabinWallRight = new THREE.Mesh(
      new THREE.BoxGeometry(0.09, bodyHeight * 0.38, cabinLen),
      paintMat
    );
    cabinWallRight.position.set(width * 0.45, bodyHeight * 0.72 + 0.12, cabinCenterZ);
    cabinWallRight.castShadow = true;
    root.add(cabinWallRight);
    bodyMeshes.push(cabinWallRight);

    const cabinWallBack = new THREE.Mesh(
      new THREE.BoxGeometry(width * 0.96, bodyHeight * 0.38, 0.1),
      paintMat
    );
    cabinWallBack.position.set(0, bodyHeight * 0.72 + 0.12, -length * 0.5 + 0.06);
    cabinWallBack.castShadow = true;
    root.add(cabinWallBack);
    bodyMeshes.push(cabinWallBack);

    const cabinFloor = new THREE.Mesh(
      new THREE.BoxGeometry(width * 0.82, 0.06, cabinLen * 0.92),
      this.sharedDarkMat
    );
    cabinFloor.position.set(0, bodyHeight * 0.62 + 0.11, cabinCenterZ);
    root.add(cabinFloor);

    // Bumpers & Headlights / Taillights
    const hlGeo = new THREE.BoxGeometry(0.14, 0.09, 0.05);
    [-width * 0.32, width * 0.32].forEach((hx) => {
      const hl = new THREE.Mesh(hlGeo, this.sharedHeadlightMat);
      hl.position.set(hx, 0.26, length * 0.5 + 0.01);
      root.add(hl);

      const tl = new THREE.Mesh(hlGeo, this.sharedTaillightMat);
      tl.position.set(hx, 0.26, -length * 0.5 - 0.01);
      root.add(tl);
    });

    // Wheels
    const wheelGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.12, 14);
    wheelGeo.rotateZ(Math.PI / 2);
    const rimGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.13, 10);
    rimGeo.rotateZ(Math.PI / 2);

    const wheelZPositions =
      v.lengthCells === 3
        ? [-length * 0.35, 0.05, length * 0.34]
        : [-length * 0.32, length * 0.32];

    for (const wz of wheelZPositions) {
      for (const wx of [-width * 0.5, width * 0.5]) {
        const tire = new THREE.Mesh(wheelGeo, this.sharedTireMat);
        tire.position.set(wx, 0.16, wz);
        tire.castShadow = true;
        root.add(tire);

        const rim = new THREE.Mesh(rimGeo, this.sharedRimMat);
        rim.position.set(wx, 0.16, wz);
        root.add(rim);
      }
    }

    // Crisp Direction Arrow on Hood (+Z pointing)
    const arrowShape = new THREE.Shape();
    arrowShape.moveTo(0, 0.16);
    arrowShape.lineTo(0.16, -0.04);
    arrowShape.lineTo(0.06, -0.04);
    arrowShape.lineTo(0.06, -0.15);
    arrowShape.lineTo(-0.06, -0.15);
    arrowShape.lineTo(-0.06, -0.04);
    arrowShape.lineTo(-0.16, -0.04);
    arrowShape.closePath();

    const arrowGeo = new THREE.ShapeGeometry(arrowShape);
    arrowGeo.rotateX(Math.PI / 2); // +Y in 2D shape becomes +Z in 3D!
    const arrowMesh = new THREE.Mesh(arrowGeo, this.sharedWhiteMat);
    arrowMesh.position.set(0, bodyHeight * 0.84 + 0.14, length * 0.5 - hoodLen * 0.45);
    root.add(arrowMesh);

    // Seat wells + pre-attached hidden passenger meshes
    const colsSeats = 2;
    const rowsSeats = v.size / 2; // 2, 3, or 4 rows
    const seatPassengers: THREE.Group[] = [];
    const seatWellGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.03, 12);
    const seatWellMat = new THREE.MeshStandardMaterial({
      color: '#334155',
      roughness: 0.7,
    });

    for (let r = 0; r < rowsSeats; r++) {
      for (let c = 0; c < colsSeats; c++) {
        const sx = (c === 0 ? -1 : 1) * (width * 0.21);
        const t = rowsSeats === 1 ? 0.5 : r / (rowsSeats - 1);
        const sz =
          cabinCenterZ + (0.5 - t) * (cabinLen * 0.68);

        const pad = new THREE.Mesh(seatWellGeo, seatWellMat);
        pad.position.set(sx, bodyHeight * 0.66 + 0.12, sz);
        root.add(pad);

        const passenger = createPassengerFigure(meta.hex, meta.lightHex);
        passenger.position.set(sx, bodyHeight * 0.67 + 0.12, sz);
        passenger.visible = false;
        passenger.scale.setScalar(0.01);
        root.add(passenger);
        seatPassengers.push(passenger);
      }
    }

    // Ice Block Overlay
    const iceMat = new THREE.MeshStandardMaterial({
      color: '#bae6fd',
      roughness: 0.15,
      metalness: 0.1,
      transparent: true,
      opacity: 0.48,
    });
    const iceMesh = new THREE.Mesh(
      new THREE.BoxGeometry(width + 0.2, bodyHeight + 0.36, length + 0.2),
      iceMat
    );
    iceMesh.position.y = (bodyHeight + 0.36) * 0.5 + 0.05;
    iceMesh.visible = v.frozenCount > 0;
    root.add(iceMesh);

    const iceBadge = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.getIceTexture(Math.max(1, v.frozenCount)),
        transparent: true,
        depthTest: false,
      })
    );
    iceBadge.scale.set(0.58, 0.58, 1);
    iceBadge.position.set(0, bodyHeight + 0.72, 0);
    iceBadge.renderOrder = 10;
    iceBadge.visible = v.frozenCount > 0;
    root.add(iceBadge);

    // Mystery (?) Badge
    const mysteryBadge = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.mysteryTexture,
        transparent: true,
        depthTest: false,
      })
    );
    mysteryBadge.scale.set(0.62, 0.62, 1);
    mysteryBadge.position.set(0, bodyHeight + 0.68, 0);
    mysteryBadge.renderOrder = 10;
    mysteryBadge.visible = v.mystery;
    root.add(mysteryBadge);

    return {
      root,
      bodyMeshes,
      seatPassengers,
      iceMesh,
      iceBadge,
      mysteryBadge,
      arrowMesh,
      baseColor: v.color,
      lastFrozenCount: v.frozenCount,
      lastMystery: v.mystery,
    };
  }

  public syncVisualState(visual: VehicleVisual, state: VehicleState): void {
    // Update seated passengers
    for (let i = 0; i < visual.seatPassengers.length; i++) {
      const p = visual.seatPassengers[i];
      const shouldBeVisible = i < state.seatedCount;
      if (shouldBeVisible && !p.visible) {
        p.visible = true;
        p.scale.setScalar(1);
      } else if (!shouldBeVisible && p.visible) {
        p.visible = false;
        p.scale.setScalar(0.01);
      }
    }

    // Update mystery paint
    if (visual.lastMystery !== state.mystery) {
      visual.lastMystery = state.mystery;
      const targetColor = state.mystery
        ? '#475569'
        : COLOR_PALETTE[state.color].hex;
      for (const mesh of visual.bodyMeshes) {
        (mesh.material as THREE.MeshStandardMaterial).color.set(targetColor);
      }
      visual.mysteryBadge.visible = state.mystery;
    }

    // Update frozen ice state
    if (visual.lastFrozenCount !== state.frozenCount) {
      visual.lastFrozenCount = state.frozenCount;
      const frozen = state.frozenCount > 0;
      visual.iceMesh.visible = frozen;
      visual.iceBadge.visible = frozen;
      if (frozen) {
        (visual.iceBadge.material as THREE.SpriteMaterial).map =
          this.getIceTexture(state.frozenCount);
        visual.iceBadge.material.needsUpdate = true;
      }
    }
  }

  public createTunnelMesh(
    exitDir: Direction,
    remainingCount: number
  ): { group: THREE.Group; updateCount: (n: number) => void } {
    const group = new THREE.Group();

    const concreteMat = new THREE.MeshStandardMaterial({
      color: '#475569',
      roughness: 0.8,
    });
    const darkPortalMat = new THREE.MeshStandardMaterial({
      color: '#020617',
      roughness: 0.9,
    });
    const hazardMat = new THREE.MeshStandardMaterial({
      color: '#facc15',
      roughness: 0.4,
    });

    const box = new THREE.Mesh(
      new THREE.BoxGeometry(CELL_SIZE * 0.92, 0.68, CELL_SIZE * 0.92),
      concreteMat
    );
    box.position.y = 0.34;
    box.castShadow = true;
    box.receiveShadow = true;
    group.add(box);

    const roofTrim = new THREE.Mesh(
      new THREE.BoxGeometry(CELL_SIZE * 0.96, 0.1, CELL_SIZE * 0.96),
      hazardMat
    );
    roofTrim.position.y = 0.72;
    group.add(roofTrim);

    // Portal opening facing +Z (rotated by directionToYaw)
    const portal = new THREE.Mesh(
      new THREE.BoxGeometry(CELL_SIZE * 0.66, 0.48, 0.12),
      darkPortalMat
    );
    portal.position.set(0, 0.25, CELL_SIZE * 0.44);
    group.add(portal);

    group.rotation.y = directionToYaw(exitDir);

    const countSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: makeBadgeTexture(`×${remainingCount}`, '#0f172a', '#facc15', '#facc15'),
        transparent: true,
        depthTest: false,
      })
    );
    countSprite.scale.set(0.6, 0.6, 1);
    countSprite.position.set(0, 1.15, 0);
    countSprite.renderOrder = 12;
    countSprite.visible = remainingCount > 0;
    group.add(countSprite);

    const updateCount = (n: number) => {
      countSprite.visible = n > 0;
      if (n > 0) {
        (countSprite.material as THREE.SpriteMaterial).map = makeBadgeTexture(
          `×${n}`,
          '#0f172a',
          '#facc15',
          '#facc15'
        );
        countSprite.material.needsUpdate = true;
      }
    };

    return { group, updateCount };
  }
}
