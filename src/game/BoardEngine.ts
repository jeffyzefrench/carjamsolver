import {
  BoardSnapshot,
  ColorId,
  ExitCheckResult,
  GridCell,
  LevelConfig,
  TunnelSpawner,
  VehicleState,
} from './types';

export function getVehicleCells(
  v: Pick<VehicleState, 'gridX' | 'gridY' | 'lengthCells' | 'dir'>
): GridCell[] {
  const cells: GridCell[] = [];
  const horizontal = v.dir === 'LEFT' || v.dir === 'RIGHT';
  for (let i = 0; i < v.lengthCells; i++) {
    cells.push({
      x: horizontal ? v.gridX + i : v.gridX,
      y: horizontal ? v.gridY : v.gridY + i,
    });
  }
  return cells;
}

export function getTunnelSpawnInfo(
  t: Pick<TunnelSpawner, 'gridX' | 'gridY' | 'exitDir'>
): { gridX: number; gridY: number; cells: GridCell[] } {
  switch (t.exitDir) {
    case 'UP':
      return {
        gridX: t.gridX,
        gridY: t.gridY - 2,
        cells: [
          { x: t.gridX, y: t.gridY - 2 },
          { x: t.gridX, y: t.gridY - 1 },
        ],
      };
    case 'DOWN':
      return {
        gridX: t.gridX,
        gridY: t.gridY + 1,
        cells: [
          { x: t.gridX, y: t.gridY + 1 },
          { x: t.gridX, y: t.gridY + 2 },
        ],
      };
    case 'LEFT':
      return {
        gridX: t.gridX - 2,
        gridY: t.gridY,
        cells: [
          { x: t.gridX - 2, y: t.gridY },
          { x: t.gridX - 1, y: t.gridY },
        ],
      };
    case 'RIGHT':
      return {
        gridX: t.gridX + 1,
        gridY: t.gridY,
        cells: [
          { x: t.gridX + 1, y: t.gridY },
          { x: t.gridX + 2, y: t.gridY },
        ],
      };
  }
}

export function getExitRayCells(
  v: Pick<VehicleState, 'gridX' | 'gridY' | 'lengthCells' | 'dir'>,
  cols: number,
  rows: number
): GridCell[] {
  const cells: GridCell[] = [];
  switch (v.dir) {
    case 'UP':
      for (let y = v.gridY - 1; y >= 0; y--) {
        cells.push({ x: v.gridX, y });
      }
      break;
    case 'DOWN':
      for (let y = v.gridY + v.lengthCells; y < rows; y++) {
        cells.push({ x: v.gridX, y });
      }
      break;
    case 'LEFT':
      for (let x = v.gridX - 1; x >= 0; x--) {
        cells.push({ x, y: v.gridY });
      }
      break;
    case 'RIGHT':
      for (let x = v.gridX + v.lengthCells; x < cols; x++) {
        cells.push({ x, y: v.gridY });
      }
      break;
  }
  return cells;
}

export function areCellSetsAdjacent(a: GridCell[], b: GridCell[]): boolean {
  for (const ca of a) {
    for (const cb of b) {
      if (Math.abs(ca.x - cb.x) + Math.abs(ca.y - cb.y) === 1) {
        return true;
      }
    }
  }
  return false;
}

export interface IceTickEvent {
  vehicle: VehicleState;
  shattered: boolean;
}

export interface TunnelSpawnEvent {
  tunnelId: string;
  vehicle: VehicleState;
}

export type TapResult =
  | { type: 'IGNORED' }
  | { type: 'FROZEN'; vehicle: VehicleState }
  | {
      type: 'BLOCKED';
      vehicle: VehicleState;
      blockerVehicleId?: string;
      blockerIsTunnel?: boolean;
      freeSteps: number;
    }
  | { type: 'DOCK_FULL' }
  | {
      type: 'EXIT_STARTED';
      vehicle: VehicleState;
      slotIndex: number;
      revealedVehicles: VehicleState[];
      iceUpdates: IceTickEvent[];
      spawnedFromTunnels: TunnelSpawnEvent[];
    };

export interface BoardedPassengerEvent {
  vehicle: VehicleState;
  color: ColorId;
  seatIndex: number;
  isFull: boolean;
}

export class BoardEngine {
  public level: LevelConfig;
  public vehicles: VehicleState[] = [];
  public tunnels: TunnelSpawner[] = [];
  public passengerQueue: ColorId[] = [];
  public unlockedSlots = 5;
  public maxSlots = 7;
  public moveCount = 0;
  public undoStack: BoardSnapshot[] = [];

  constructor(level: LevelConfig) {
    this.level = level;
    this.loadLevel(level);
  }

  public loadLevel(level: LevelConfig): void {
    this.level = level;
    this.vehicles = level.vehicles.map((v) => ({ ...v }));
    this.tunnels = level.tunnels.map((t) => ({
      ...t,
      queue: t.queue.map((q) => ({ ...q })),
    }));
    this.passengerQueue = [...level.passengerQueue];
    this.unlockedSlots = level.baseSlots;
    this.maxSlots = level.baseSlots + level.maxVipSlots;
    this.moveCount = 0;
    this.undoStack = [];
  }

  private createSnapshot(): BoardSnapshot {
    return {
      vehicles: this.vehicles.map((v) => ({ ...v })),
      tunnels: this.tunnels.map((t) => ({
        ...t,
        queue: t.queue.map((q) => ({ ...q })),
      })),
      passengerQueue: [...this.passengerQueue],
      unlockedSlots: this.unlockedSlots,
      moveCount: this.moveCount,
    };
  }

  public getVehicle(id: string): VehicleState | undefined {
    return this.vehicles.find((v) => v.id === id);
  }

  public getGridOccupancyMap(): Map<string, string> {
    const map = new Map<string, string>();
    for (const v of this.vehicles) {
      if (v.status === 'GRID') {
        for (const c of getVehicleCells(v)) {
          map.set(`${c.x},${c.y}`, v.id);
        }
      }
    }
    for (const t of this.tunnels) {
      map.set(`${t.gridX},${t.gridY}`, `TUNNEL:${t.id}`);
    }
    return map;
  }

  public checkExitPath(vehicle: VehicleState): ExitCheckResult {
    const occupancy = this.getGridOccupancyMap();
    const ray = getExitRayCells(vehicle, this.level.cols, this.level.rows);
    let freeSteps = 0;
    for (const cell of ray) {
      const occupant = occupancy.get(`${cell.x},${cell.y}`);
      if (occupant) {
        if (occupant.startsWith('TUNNEL:')) {
          return { clear: false, blockerIsTunnel: true, freeSteps };
        }
        return { clear: false, blockerVehicleId: occupant, freeSteps };
      }
      freeSteps++;
    }
    return { clear: true, freeSteps };
  }

  public findFirstFreeDockSlot(): number {
    const used = new Set<number>();
    for (const v of this.vehicles) {
      if (
        (v.status === 'EXITING' || v.status === 'DOCKED' || v.status === 'DEPARTING') &&
        v.dockSlotIndex !== null
      ) {
        used.add(v.dockSlotIndex);
      }
    }
    for (let i = 0; i < this.unlockedSlots; i++) {
      if (!used.has(i)) return i;
    }
    return -1;
  }

  public getOccupiedDockCount(): number {
    let count = 0;
    for (const v of this.vehicles) {
      if (
        (v.status === 'EXITING' || v.status === 'DOCKED' || v.status === 'DEPARTING') &&
        v.dockSlotIndex !== null
      ) {
        count++;
      }
    }
    return count;
  }

  public tapVehicle(vehicleId: string): TapResult {
    const vehicle = this.getVehicle(vehicleId);
    if (!vehicle || vehicle.status !== 'GRID') {
      return { type: 'IGNORED' };
    }
    if (vehicle.frozenCount > 0) {
      return { type: 'FROZEN', vehicle };
    }
    const exitCheck = this.checkExitPath(vehicle);
    if (!exitCheck.clear) {
      return {
        type: 'BLOCKED',
        vehicle,
        blockerVehicleId: exitCheck.blockerVehicleId,
        blockerIsTunnel: exitCheck.blockerIsTunnel,
        freeSteps: exitCheck.freeSteps,
      };
    }

    const slotIndex = this.findFirstFreeDockSlot();
    if (slotIndex === -1) {
      return { type: 'DOCK_FULL' };
    }

    // Save snapshot for unlimited free Undo
    this.undoStack.push(this.createSnapshot());

    const exitedCells = getVehicleCells(vehicle);
    vehicle.status = 'EXITING';
    vehicle.dockSlotIndex = slotIndex;
    this.moveCount++;

    // Reveal orthogonally adjacent mystery vehicles
    const revealedVehicles: VehicleState[] = [];
    for (const other of this.vehicles) {
      if (other.status === 'GRID' && other.mystery) {
        if (areCellSetsAdjacent(exitedCells, getVehicleCells(other))) {
          other.mystery = false;
          revealedVehicles.push(other);
        }
      }
    }

    // Tick down ice on remaining frozen vehicles
    const iceUpdates: IceTickEvent[] = [];
    for (const other of this.vehicles) {
      if (other.status === 'GRID' && other.frozenCount > 0) {
        other.frozenCount = Math.max(0, other.frozenCount - 1);
        iceUpdates.push({
          vehicle: other,
          shattered: other.frozenCount === 0,
        });
      }
    }

    // Spawn from tunnels whose 2 front cells are now clear
    const spawnedFromTunnels: TunnelSpawnEvent[] = [];
    const occupancy = this.getGridOccupancyMap();
    for (const tunnel of this.tunnels) {
      if (tunnel.queue.length === 0) continue;
      const spawnInfo = getTunnelSpawnInfo(tunnel);
      const canSpawn = spawnInfo.cells.every(
        (c) =>
          c.x >= 0 &&
          c.x < this.level.cols &&
          c.y >= 0 &&
          c.y < this.level.rows &&
          !occupancy.has(`${c.x},${c.y}`)
      );
      if (canSpawn) {
        const nextSpec = tunnel.queue.shift()!;
        const spawned: VehicleState = {
          id: nextSpec.id,
          color: nextSpec.color,
          size: nextSpec.size,
          gridX: spawnInfo.gridX,
          gridY: spawnInfo.gridY,
          lengthCells: nextSpec.lengthCells,
          dir: tunnel.exitDir,
          mystery: nextSpec.mystery,
          frozenCount: 0,
          status: 'GRID',
          seatedCount: 0,
          dockSlotIndex: null,
        };
        this.vehicles.push(spawned);
        for (const c of spawnInfo.cells) {
          occupancy.set(`${c.x},${c.y}`, spawned.id);
        }
        spawnedFromTunnels.push({
          tunnelId: tunnel.id,
          vehicle: spawned,
        });
      }
    }

    return {
      type: 'EXIT_STARTED',
      vehicle,
      slotIndex,
      revealedVehicles,
      iceUpdates,
      spawnedFromTunnels,
    };
  }

  public markVehicleDocked(vehicleId: string): boolean {
    const v = this.getVehicle(vehicleId);
    if (!v || v.status !== 'EXITING') return false;
    v.status = 'DOCKED';
    return true;
  }

  public claimNextPassenger(): BoardedPassengerEvent | null {
    if (this.passengerQueue.length === 0) return null;
    const frontColor = this.passengerQueue[0];

    // Prefer a docked vehicle of matching color that already has the most seated passengers
    const candidates = this.vehicles
      .filter(
        (v) =>
          v.status === 'DOCKED' &&
          v.color === frontColor &&
          v.seatedCount < v.size
      )
      .sort((a, b) => b.seatedCount - a.seatedCount);

    if (candidates.length === 0) return null;
    const target = candidates[0];
    this.passengerQueue.shift();
    const seatIndex = target.seatedCount;
    target.seatedCount++;
    const isFull = target.seatedCount >= target.size;
    if (isFull) {
      target.status = 'DEPARTING';
    }

    return {
      vehicle: target,
      color: frontColor,
      seatIndex,
      isFull,
    };
  }

  public completeVehicleDeparture(vehicleId: string): void {
    const v = this.getVehicle(vehicleId);
    if (!v) return;
    v.status = 'CLEARED';
    v.dockSlotIndex = null;
  }

  /** Instant synchronous boarding pass (useful for headless simulation/tests) */
  public resolveAllBoardingsSync(): BoardedPassengerEvent[] {
    const events: BoardedPassengerEvent[] = [];
    while (true) {
      const ev = this.claimNextPassenger();
      if (!ev) break;
      events.push(ev);
      if (ev.isFull) {
        this.completeVehicleDeparture(ev.vehicle.id);
      }
    }
    return events;
  }

  public isWon(): boolean {
    if (this.passengerQueue.length > 0) return false;
    const anyTunnelLeft = this.tunnels.some((t) => t.queue.length > 0);
    if (anyTunnelLeft) return false;
    return this.vehicles.every(
      (v) => v.status === 'DEPARTING' || v.status === 'CLEARED'
    );
  }

  public isStuck(): boolean {
    if (this.isWon()) return false;
    // Wait while any vehicle is still driving to dock or departing to free a slot
    const anyInTransit = this.vehicles.some(
      (v) => v.status === 'EXITING' || v.status === 'DEPARTING'
    );
    if (anyInTransit) return false;

    const docked = this.vehicles.filter((v) => v.status === 'DOCKED');
    if (docked.length < this.unlockedSlots) return false;

    // All unlocked slots are full with DOCKED vehicles; check if front passenger can board
    if (this.passengerQueue.length === 0) return false;
    const frontColor = this.passengerQueue[0];
    return !docked.some(
      (v) => v.color === frontColor && v.seatedCount < v.size
    );
  }

  public canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  public undo(): boolean {
    const snap = this.undoStack.pop();
    if (!snap) return false;
    this.vehicles = snap.vehicles.map((v) => ({ ...v }));
    this.tunnels = snap.tunnels.map((t) => ({
      ...t,
      queue: t.queue.map((q) => ({ ...q })),
    }));
    this.passengerQueue = [...snap.passengerQueue];
    this.unlockedSlots = snap.unlockedSlots;
    this.moveCount = snap.moveCount;
    return true;
  }

  public canUnlockVipSlot(): boolean {
    return this.unlockedSlots < this.maxSlots;
  }

  public unlockVipSlot(): boolean {
    if (this.unlockedSlots >= this.maxSlots) return false;
    this.unlockedSlots++;
    return true;
  }

  /**
   * Free player-friendly recovery when stuck:
   * - Unlocks a VIP slot if one is still locked, OR
   * - If all VIP slots are already unlocked, clears the oldest docked car
   *   and pulls its remaining matching passengers out of the queue.
   */
  public continueForFree(): { action: 'VIP_UNLOCKED' | 'CLEARED_DOCKED'; vehicle?: VehicleState } {
    if (this.unlockVipSlot()) {
      return { action: 'VIP_UNLOCKED' };
    }
    const docked = this.vehicles
      .filter((v) => v.status === 'DOCKED')
      .sort((a, b) => (a.dockSlotIndex ?? 0) - (b.dockSlotIndex ?? 0));
    if (docked.length > 0) {
      const target = docked[0];
      let needed = target.size - target.seatedCount;
      for (let i = 0; i < this.passengerQueue.length && needed > 0; ) {
        if (this.passengerQueue[i] === target.color) {
          this.passengerQueue.splice(i, 1);
          target.seatedCount++;
          needed--;
        } else {
          i++;
        }
      }
      target.status = 'DEPARTING';
      return { action: 'CLEARED_DOCKED', vehicle: target };
    }
    return { action: 'VIP_UNLOCKED' };
  }

  /**
   * Free Queue Shuffle: pulls matching passengers for currently docked
   * (or unblocked grid) vehicles to the front of the queue to untangle jams.
   */
  public shuffleQueue(): boolean {
    if (this.passengerQueue.length <= 1) return false;

    const priorityColors: ColorId[] = [];
    const docked = this.vehicles.filter((v) => v.status === 'DOCKED');
    for (const v of docked) {
      if (!priorityColors.includes(v.color)) {
        priorityColors.push(v.color);
      }
    }

    if (priorityColors.length === 0) {
      for (const v of this.vehicles) {
        if (
          v.status === 'GRID' &&
          v.frozenCount === 0 &&
          !v.mystery &&
          this.checkExitPath(v).clear &&
          !priorityColors.includes(v.color)
        ) {
          priorityColors.push(v.color);
        }
      }
    }

    if (priorityColors.length === 0) {
      // Fallback: group current front color together
      priorityColors.push(this.passengerQueue[0]);
    }

    const frontTarget = priorityColors[0];
    const matching: ColorId[] = [];
    const rest: ColorId[] = [];
    for (const c of this.passengerQueue) {
      if (c === frontTarget) {
        matching.push(c);
      } else {
        rest.push(c);
      }
    }
    this.passengerQueue = [...matching, ...rest];
    return matching.length > 0;
  }

  public getRemainingPassengersCount(): number {
    return this.passengerQueue.length;
  }

  public getRemainingVehiclesCount(): number {
    const active = this.vehicles.filter((v) => v.status !== 'CLEARED').length;
    const queued = this.tunnels.reduce((sum, t) => sum + t.queue.length, 0);
    return active + queued;
  }
}
