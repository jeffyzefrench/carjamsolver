import {
  areCellSetsAdjacent,
  getExitRayCells,
  getTunnelSpawnInfo,
  getVehicleCells,
} from './BoardEngine';
import {
  ALL_COLORS,
  ColorId,
  Direction,
  LevelConfig,
  MechanicTag,
  TunnelQueuedVehicle,
  TunnelSpawner,
  VehicleSize,
  VehicleState,
} from './types';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function flipDirection(dir: Direction): Direction {
  switch (dir) {
    case 'UP':
      return 'DOWN';
    case 'DOWN':
      return 'UP';
    case 'LEFT':
      return 'RIGHT';
    case 'RIGHT':
      return 'LEFT';
  }
}

interface TierSpec {
  cols: number;
  rows: number;
  numColors: number;
  targetVehicles: number;
  vanChance: number;
  busChance: number;
  tunnelCount: number;
  tunnelQueueSize: number;
  mysteryRatio: number;
  frozenTarget: number;
  windowSize: number;
  mechanics: MechanicTag[];
  title: string;
  subtitle: string;
}

function getTierSpec(levelNumber: number): TierSpec {
  if (levelNumber <= 5) {
    return {
      cols: 6,
      rows: 6,
      numColors: levelNumber <= 2 ? 3 : 4,
      targetVehicles: 7 + levelNumber,
      vanChance: 0,
      busChance: 0,
      tunnelCount: 0,
      tunnelQueueSize: 0,
      mysteryRatio: 0,
      frozenTarget: 0,
      windowSize: levelNumber <= 2 ? 2 : 3,
      mechanics: ['cars'],
      title: levelNumber === 1 ? 'First Shift' : 'Warm-Up Lot',
      subtitle: 'Tap unblocked cars to match waiting passengers',
    };
  }
  if (levelNumber <= 12) {
    return {
      cols: 7,
      rows: 7,
      numColors: levelNumber <= 8 ? 4 : 5,
      targetVehicles: 11 + Math.floor((levelNumber - 6) * 0.8),
      vanChance: 0.25,
      busChance: levelNumber >= 8 ? 0.22 : 0,
      tunnelCount: 0,
      tunnelQueueSize: 0,
      mysteryRatio: 0,
      frozenTarget: 0,
      windowSize: 3,
      mechanics: ['cars', 'vans-buses'],
      title: 'Heavy Fleet',
      subtitle: '6-seat Vans & 8-seat Buses need more passengers!',
    };
  }
  if (levelNumber <= 20) {
    return {
      cols: 8,
      rows: 8,
      numColors: 5,
      targetVehicles: 12 + Math.floor((levelNumber - 13) * 0.7),
      vanChance: 0.24,
      busChance: 0.2,
      tunnelCount: levelNumber >= 17 ? 2 : 1,
      tunnelQueueSize: 2,
      mysteryRatio: 0,
      frozenTarget: 0,
      windowSize: 3,
      mechanics: ['cars', 'vans-buses', 'tunnels'],
      title: 'Underground Garage',
      subtitle: 'Clear space in front of tunnels to reveal new cars',
    };
  }
  if (levelNumber <= 30) {
    return {
      cols: 8,
      rows: 8,
      numColors: 6,
      targetVehicles: 14 + Math.floor((levelNumber - 21) * 0.5),
      vanChance: 0.24,
      busChance: 0.2,
      tunnelCount: levelNumber >= 25 ? 2 : 1,
      tunnelQueueSize: 2,
      mysteryRatio: 0.28,
      frozenTarget: 0,
      windowSize: 3,
      mechanics: ['cars', 'vans-buses', 'tunnels', 'mystery'],
      title: 'Mystery Grid',
      subtitle: 'Move adjacent vehicles to unveil hidden (?) cars',
    };
  }
  if (levelNumber <= 40) {
    return {
      cols: 8,
      rows: 9,
      numColors: levelNumber >= 36 ? 7 : 6,
      targetVehicles: 16 + Math.floor((levelNumber - 31) * 0.5),
      vanChance: 0.25,
      busChance: 0.22,
      tunnelCount: 2,
      tunnelQueueSize: 2,
      mysteryRatio: 0.22,
      frozenTarget: levelNumber >= 35 ? 2 : 1,
      windowSize: 3,
      mechanics: ['cars', 'vans-buses', 'tunnels', 'mystery', 'frozen'],
      title: 'Deep Freeze',
      subtitle: 'Clear other cars to crack the ice counters',
    };
  }
  return {
    cols: 9,
    rows: 10,
    numColors: levelNumber >= 46 ? 8 : 7,
    targetVehicles: Math.min(25, 19 + Math.floor((levelNumber - 41) * 0.6)),
    vanChance: 0.26,
    busChance: 0.24,
    tunnelCount: 2,
    tunnelQueueSize: 3,
    mysteryRatio: 0.25,
    frozenTarget: 3,
    windowSize: 3,
    mechanics: ['cars', 'vans-buses', 'tunnels', 'mystery', 'frozen', 'master'],
    title: levelNumber <= 50 ? 'Rush Hour Boss' : `Endless Jam #${levelNumber}`,
    subtitle: 'All mechanics active — plan your holding slots wisely!',
  };
}

function doesRayHitTunnel(
  v: Pick<VehicleState, 'gridX' | 'gridY' | 'lengthCells' | 'dir'>,
  cols: number,
  rows: number,
  tunnelSet: Set<string>
): boolean {
  const ray = getExitRayCells(v, cols, rows);
  return ray.some((c) => tunnelSet.has(`${c.x},${c.y}`));
}

function getRayBlockerCount(
  v: VehicleState,
  cols: number,
  rows: number,
  occupancy: Map<string, string>
): { hitsTunnel: boolean; blockers: number } {
  const ray = getExitRayCells(v, cols, rows);
  let blockers = 0;
  for (const c of ray) {
    const occ = occupancy.get(`${c.x},${c.y}`);
    if (occ) {
      if (occ.startsWith('TUNNEL:')) {
        return { hitsTunnel: true, blockers: 999 };
      }
      blockers++;
    }
  }
  return { hitsTunnel: false, blockers };
}

function buildPassengerQueueFromOrder(
  escapeOrder: VehicleState[],
  windowSize: number,
  rng: () => number
): ColorId[] {
  const queue: ColorId[] = [];
  const active: Array<{ color: ColorId; remaining: number }> = [];
  let cursor = 0;

  while (cursor < escapeOrder.length || active.length > 0) {
    while (active.length < windowSize && cursor < escapeOrder.length) {
      const v = escapeOrder[cursor++];
      active.push({ color: v.color, remaining: v.size });
    }

    if (active.length === 0) break;

    // Slight bias toward oldest window slot so players aren't forced to hold all slots forever
    const pickIdx =
      rng() < 0.48 || active.length === 1
        ? 0
        : Math.floor(rng() * active.length);
    const entry = active[pickIdx];
    const burst = Math.min(entry.remaining, 1 + Math.floor(rng() * 2));
    for (let b = 0; b < burst; b++) {
      queue.push(entry.color);
    }
    entry.remaining -= burst;
    if (entry.remaining <= 0) {
      active.splice(pickIdx, 1);
    }
  }

  return queue;
}

export function generateLevel(levelNumber: number): LevelConfig {
  const spec = getTierSpec(levelNumber);
  const rng = mulberry32(levelNumber * 2654435761 + 1337);
  const palette = ALL_COLORS.slice(0, spec.numColors);

  const occupied = new Set<string>();
  const tunnelSet = new Set<string>();
  const tunnels: TunnelSpawner[] = [];

  // 1. Place Tunnels (if any) ensuring their 2 spawn cells and exit ray have no tunnel collisions
  const dirOptions: Direction[] = ['DOWN', 'UP', 'RIGHT', 'LEFT'];
  for (let tIdx = 0; tIdx < spec.tunnelCount; tIdx++) {
    for (let attempt = 0; attempt < 80; attempt++) {
      const gx = 1 + Math.floor(rng() * (spec.cols - 2));
      const gy = 1 + Math.floor(rng() * (spec.rows - 2));
      if (occupied.has(`${gx},${gy}`)) continue;

      const exitDir = dirOptions[Math.floor(rng() * dirOptions.length)];
      const candidate: TunnelSpawner = {
        id: `t_${levelNumber}_${tIdx}`,
        gridX: gx,
        gridY: gy,
        exitDir,
        queue: [],
      };
      const spawnInfo = getTunnelSpawnInfo(candidate);
      const validSpawn = spawnInfo.cells.every(
        (c) =>
          c.x >= 0 &&
          c.x < spec.cols &&
          c.y >= 0 &&
          c.y < spec.rows &&
          !tunnelSet.has(`${c.x},${c.y}`)
      );
      if (!validSpawn) continue;

      // Ensure tunnel exit ray doesn't hit an already-placed tunnel
      const ray = getExitRayCells(
        {
          gridX: spawnInfo.gridX,
          gridY: spawnInfo.gridY,
          lengthCells: 2,
          dir: exitDir,
        },
        spec.cols,
        spec.rows
      );
      const rayHitsTunnel = ray.some((c) => tunnelSet.has(`${c.x},${c.y}`));
      if (rayHitsTunnel) continue;

      // Also check existing tunnels' rays don't hit this new tunnel cell
      const blocksExistingTunnel = tunnels.some((other) => {
        const otherSpawn = getTunnelSpawnInfo(other);
        const otherRay = getExitRayCells(
          {
            gridX: otherSpawn.gridX,
            gridY: otherSpawn.gridY,
            lengthCells: 2,
            dir: other.exitDir,
          },
          spec.cols,
          spec.rows
        );
        return (
          otherSpawn.cells.some((c) => c.x === gx && c.y === gy) ||
          otherRay.some((c) => c.x === gx && c.y === gy)
        );
      });
      if (blocksExistingTunnel) continue;

      occupied.add(`${gx},${gy}`);
      tunnelSet.add(`${gx},${gy}`);
      tunnels.push(candidate);
      break;
    }
  }

  // 2. Pack non-overlapping grid vehicles
  const draftVehicles: VehicleState[] = [];
  let vCounter = 0;

  for (let i = 0; i < spec.targetVehicles * 6 && draftVehicles.length < spec.targetVehicles; i++) {
    const roll = rng();
    let size: VehicleSize = 4;
    let lengthCells: 2 | 3 = 2;
    if (roll < spec.busChance) {
      size = 8;
      lengthCells = 3;
    } else if (roll < spec.busChance + spec.vanChance) {
      size = 6;
      lengthCells = 2;
    }

    const horizontal = rng() < 0.5;
    const maxX = horizontal ? spec.cols - lengthCells : spec.cols - 1;
    const maxY = horizontal ? spec.rows - 1 : spec.rows - lengthCells;
    if (maxX < 0 || maxY < 0) continue;

    const gridX = Math.floor(rng() * (maxX + 1));
    const gridY = Math.floor(rng() * (maxY + 1));
    const dirA: Direction = horizontal ? 'RIGHT' : 'DOWN';
    const dirB: Direction = horizontal ? 'LEFT' : 'UP';
    const preferredDir = rng() < 0.5 ? dirA : dirB;

    const candidateCells = getVehicleCells({
      gridX,
      gridY,
      lengthCells,
      dir: preferredDir,
    });

    if (candidateCells.some((c) => occupied.has(`${c.x},${c.y}`))) continue;

    // Choose direction that avoids static tunnels
    const hitPreferred = doesRayHitTunnel(
      { gridX, gridY, lengthCells, dir: preferredDir },
      spec.cols,
      spec.rows,
      tunnelSet
    );
    const altDir = flipDirection(preferredDir);
    const hitAlt = doesRayHitTunnel(
      { gridX, gridY, lengthCells, dir: altDir },
      spec.cols,
      spec.rows,
      tunnelSet
    );
    if (hitPreferred && hitAlt) continue; // Trapped between two tunnels

    const chosenDir = hitPreferred ? altDir : preferredDir;
    for (const c of candidateCells) {
      occupied.add(`${c.x},${c.y}`);
    }

    draftVehicles.push({
      id: `v_${levelNumber}_${vCounter++}`,
      color: palette[Math.floor(rng() * palette.length)],
      size,
      gridX,
      gridY,
      lengthCells,
      dir: chosenDir,
      mystery: false,
      frozenCount: 0,
      status: 'GRID',
      seatedCount: 0,
      dockSlotIndex: null,
    });
  }

  // Populate tunnel queues with 1x2 sedans/vans
  for (const t of tunnels) {
    for (let q = 0; q < spec.tunnelQueueSize; q++) {
      const size: VehicleSize = rng() < spec.vanChance ? 6 : 4;
      const queued: TunnelQueuedVehicle = {
        id: `v_${levelNumber}_${vCounter++}`,
        color: palette[Math.floor(rng() * palette.length)],
        size,
        lengthCells: 2,
        mystery: false,
      };
      t.queue.push(queued);
    }
  }

  // 3. Deadlock-Resolution Peel Pass:
  //    Guarantees every vehicle on the grid + tunnels can physically escape in sequence.
  const repairVehicles = draftVehicles.map((v) => ({ ...v }));
  const simTunnels = tunnels.map((t) => ({
    ...t,
    queue: t.queue.map((q) => ({ ...q })),
  }));
  const activeGrid: VehicleState[] = [...repairVehicles];
  const initialOrderIds: string[] = [];

  const buildOccupancy = (list: VehicleState[]): Map<string, string> => {
    const map = new Map<string, string>();
    for (const v of list) {
      for (const c of getVehicleCells(v)) {
        map.set(`${c.x},${c.y}`, v.id);
      }
    }
    for (const t of tunnels) {
      map.set(`${t.gridX},${t.gridY}`, `TUNNEL:${t.id}`);
    }
    return map;
  };

  const spawnReadyTunnels = (
    list: VehicleState[],
    tList: TunnelSpawner[]
  ): boolean => {
    let spawnedAny = false;
    const occ = buildOccupancy(list);
    for (const t of tList) {
      if (t.queue.length === 0) continue;
      const spawnInfo = getTunnelSpawnInfo(t);
      const free = spawnInfo.cells.every(
        (c) =>
          c.x >= 0 &&
          c.x < spec.cols &&
          c.y >= 0 &&
          c.y < spec.rows &&
          !occ.has(`${c.x},${c.y}`)
      );
      if (free) {
        const nextQ = t.queue.shift()!;
        const spawned: VehicleState = {
          id: nextQ.id,
          color: nextQ.color,
          size: nextQ.size,
          gridX: spawnInfo.gridX,
          gridY: spawnInfo.gridY,
          lengthCells: 2,
          dir: t.exitDir,
          mystery: false,
          frozenCount: 0,
          status: 'GRID',
          seatedCount: 0,
          dockSlotIndex: null,
        };
        list.push(spawned);
        for (const c of spawnInfo.cells) {
          occ.set(`${c.x},${c.y}`, spawned.id);
        }
        spawnedAny = true;
      }
    }
    return spawnedAny;
  };

  // Spawn any tunnel whose front cells happened to start empty
  spawnReadyTunnels(activeGrid, simTunnels);

  while (
    activeGrid.length > 0 ||
    simTunnels.some((t) => t.queue.length > 0)
  ) {
    if (activeGrid.length === 0) {
      if (spawnReadyTunnels(activeGrid, simTunnels)) continue;
      // Clear unreachable tunnel queue entries if impossible
      for (const t of simTunnels) t.queue = [];
      for (const t of tunnels) t.queue = [];
      break;
    }

    const occ = buildOccupancy(activeGrid);
    const unblocked: VehicleState[] = [];
    for (const v of activeGrid) {
      const check = getRayBlockerCount(v, spec.cols, spec.rows, occ);
      if (!check.hitsTunnel && check.blockers === 0) {
        unblocked.push(v);
      }
    }

    if (unblocked.length > 0) {
      const chosen = unblocked[Math.floor(rng() * unblocked.length)];
      const idx = activeGrid.indexOf(chosen);
      activeGrid.splice(idx, 1);
      initialOrderIds.push(chosen.id);
      spawnReadyTunnels(activeGrid, simTunnels);
      continue;
    }

    // Deadlock detected: try flipping a grid vehicle's direction to break the cycle
    let fixed = false;
    for (const v of activeGrid) {
      const draftRef = draftVehicles.find((d) => d.id === v.id);
      if (!draftRef) continue;
      const flippedDir = flipDirection(v.dir);
      const flippedProbe: VehicleState = { ...v, dir: flippedDir };
      const flippedCheck = getRayBlockerCount(
        flippedProbe,
        spec.cols,
        spec.rows,
        occ
      );
      if (!flippedCheck.hitsTunnel && flippedCheck.blockers === 0) {
        v.dir = flippedDir;
        draftRef.dir = flippedDir;
        fixed = true;
        break;
      }
    }

    if (!fixed) {
      let removedIdx = activeGrid.findIndex((v) =>
        draftVehicles.some((d) => d.id === v.id)
      );
      if (removedIdx === -1) removedIdx = 0;
      const removed = activeGrid[removedIdx];
      activeGrid.splice(removedIdx, 1);
      const draftIdx = draftVehicles.findIndex((d) => d.id === removed.id);
      if (draftIdx !== -1) {
        draftVehicles.splice(draftIdx, 1);
      } else {
        for (const t of tunnels) {
          const qIdx = t.queue.findIndex((q) => q.id === removed.id);
          if (qIdx !== -1) t.queue.splice(qIdx, 1);
        }
      }
      spawnReadyTunnels(activeGrid, simTunnels);
    }
  }

  // 4. Assign Ice-Frozen counts safely from vehicles appearing later in initialOrderIds
  if (spec.frozenTarget > 0 && initialOrderIds.length >= 6) {
    let frozenAssigned = 0;
    const minIdx = Math.max(3, Math.floor(initialOrderIds.length * 0.35));
    for (
      let i = minIdx;
      i < initialOrderIds.length && frozenAssigned < spec.frozenTarget;
      i += 2
    ) {
      const v = draftVehicles.find((d) => d.id === initialOrderIds[i]);
      if (v) {
        v.frozenCount = Math.min(3, Math.max(1, Math.floor(i / 2)));
        frozenAssigned++;
      }
    }
  }

  // 5. Assign Mystery (?) flags ONLY to vehicles orthogonally adjacent to an earlier-peeling vehicle
  const orderIndexMap = new Map<string, number>();
  initialOrderIds.forEach((id, idx) => orderIndexMap.set(id, idx));

  if (spec.mysteryRatio > 0) {
    const maxMystery = Math.max(1, Math.floor(draftVehicles.length * spec.mysteryRatio));
    let mysteryCount = 0;

    for (const v of draftVehicles) {
      if (mysteryCount >= maxMystery) break;
      if (v.frozenCount > 0) continue; // keep frozen & mystery visually distinct
      const vOrder = orderIndexMap.get(v.id) ?? 0;
      const vCells = getVehicleCells(v);
      const hasEarlierNeighbor = draftVehicles.some((other) => {
        if (other.id === v.id) return false;
        const otherOrder = orderIndexMap.get(other.id) ?? 999;
        if (otherOrder >= vOrder) return false;
        return areCellSetsAdjacent(vCells, getVehicleCells(other));
      });
      if (hasEarlierNeighbor && rng() < 0.65) {
        v.mystery = true;
        mysteryCount++;
      }
    }
  }

  // 6. Run final clean forward simulation WITH ice & tunnels enforced,
  //    following initialOrderIds priority so tunnel spawn races never happen.
  let escapeOrder: VehicleState[] = [];
  for (let simTry = 0; simTry < 2; simTry++) {
    const finalActive: VehicleState[] = draftVehicles.map((v) => ({ ...v }));
    const finalTunnels = tunnels.map((t) => ({
      ...t,
      queue: t.queue.map((q) => ({ ...q })),
    }));
    escapeOrder = [];
    let stalled = false;

    spawnReadyTunnels(finalActive, finalTunnels);

    while (
      finalActive.length > 0 ||
      finalTunnels.some((t) => t.queue.length > 0)
    ) {
      if (finalActive.length === 0) {
        if (spawnReadyTunnels(finalActive, finalTunnels)) continue;
        stalled = true;
        break;
      }

      const occ = buildOccupancy(finalActive);
      const candidates = finalActive
        .filter((v) => {
          if (v.frozenCount > 0) return false;
          const check = getRayBlockerCount(v, spec.cols, spec.rows, occ);
          return !check.hitsTunnel && check.blockers === 0;
        })
        .sort(
          (a, b) =>
            (orderIndexMap.get(a.id) ?? 999) - (orderIndexMap.get(b.id) ?? 999)
        );

      if (candidates.length === 0) {
        stalled = true;
        break;
      }

      const pick = candidates[0];
      const idx = finalActive.indexOf(pick);
      finalActive.splice(idx, 1);
      escapeOrder.push({ ...pick });

      // Decrement ice on remaining vehicles
      for (const rem of finalActive) {
        if (rem.frozenCount > 0) rem.frozenCount--;
      }

      spawnReadyTunnels(finalActive, finalTunnels);
    }

    if (!stalled) break;
    for (const d of draftVehicles) {
      d.frozenCount = 0;
    }
  }

  // 7. Build color-balanced, solver-guaranteed passengerQueue
  const passengerQueue = buildPassengerQueueFromOrder(
    escapeOrder,
    spec.windowSize,
    rng
  );

  return {
    levelNumber,
    title: spec.title,
    subtitle: spec.subtitle,
    cols: spec.cols,
    rows: spec.rows,
    baseSlots: 5,
    maxVipSlots: 2,
    mechanics: spec.mechanics,
    vehicles: draftVehicles,
    tunnels,
    passengerQueue,
  };
}

export const TOTAL_CAMPAIGN_LEVELS = 50;

export function getAllCampaignLevels(): LevelConfig[] {
  const list: LevelConfig[] = [];
  for (let i = 1; i <= TOTAL_CAMPAIGN_LEVELS; i++) {
    list.push(generateLevel(i));
  }
  return list;
}
