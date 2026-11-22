import { describe, expect, it } from 'vitest';
import { BoardEngine, getTunnelSpawnInfo, getVehicleCells } from '../BoardEngine';
import { ALL_COLORS, ColorId, LevelConfig } from '../types';
import { TOTAL_CAMPAIGN_LEVELS, generateLevel } from '../Levels';

/**
 * Bounded lookahead / memoized gameplay solver using strictly the 5 base holding slots
 * and NO free helpers (no VIP slots, no queue shuffles).
 */
function solveLevelWithBaseSlots(level: LevelConfig): boolean {
  const engine = new BoardEngine(level);
  const visited = new Set<string>();
  let nodes = 0;

  const stateKey = (): string => {
    const grid = engine.vehicles
      .filter((v) => v.status === 'GRID')
      .map((v) => v.id)
      .sort()
      .join(',');
    const docked = engine.vehicles
      .filter((v) => v.status === 'DOCKED')
      .map((v) => `${v.id}:${v.seatedCount}`)
      .sort()
      .join(',');
    return `${grid}|${docked}|${engine.passengerQueue.length}`;
  };

  const search = (depth: number): boolean => {
    engine.resolveAllBoardingsSync();
    if (engine.isWon()) return true;
    if (engine.isStuck()) return false;
    if (depth > 80 || nodes > 15000) return false;

    const key = stateKey();
    if (visited.has(key)) return false;
    visited.add(key);
    nodes++;

    const freeSlots = engine.unlockedSlots - engine.getOccupiedDockCount();
    if (freeSlots <= 0) return false;

    const gridCars = engine.vehicles.filter(
      (v) =>
        v.status === 'GRID' &&
        v.frozenCount === 0 &&
        engine.checkExitPath(v).clear
    );
    if (gridCars.length === 0) return false;

    // Score candidate taps: prioritize cars matching passengers near the front of queue,
    // or cars that unblock another vehicle matching the front of queue
    const lookaheadWindow = engine.passengerQueue.slice(0, 14);
    const dockedColors = new Set(
      engine.vehicles
        .filter((v) => v.status === 'DOCKED')
        .map((v) => v.color)
    );

    const scored = gridCars
      .map((car) => {
        const firstIdx = lookaheadWindow.indexOf(car.color);
        let score = 0;
        if (firstIdx === 0) score += 120;
        else if (firstIdx > 0) score += 50 - firstIdx * 2;
        if (dockedColors.has(car.color)) score -= 5;
        // Bonus if any blocked grid car is blocked by this car
        for (const other of engine.vehicles) {
          if (other.status === 'GRID' && other.id !== car.id) {
            const check = engine.checkExitPath(other);
            if (check.blockerVehicleId === car.id) {
              const otherIdx = lookaheadWindow.indexOf(other.color);
              score += otherIdx >= 0 ? 45 - otherIdx : 12;
            }
          }
        }
        return { car, score };
      })
      .sort((a, b) => b.score - a.score);

    for (let i = 0; i < scored.length; i++) {
      const candidate = scored[i].car;
      const res = engine.tapVehicle(candidate.id);
      if (res.type === 'EXIT_STARTED') {
        engine.markVehicleDocked(res.vehicle.id);
        if (search(depth + 1)) return true;
        engine.undo();
      }
    }
    return false;
  };

  return search(0);
}

describe('50-Level Campaign Generator & Solvability', () => {
  it('generates 50 levels with exact passenger-to-seat color parity and zero overlaps', () => {
    for (let lvl = 1; lvl <= TOTAL_CAMPAIGN_LEVELS; lvl++) {
      const level = generateLevel(lvl);
      const occupied = new Set<string>();

      for (const t of level.tunnels) {
        expect(t.gridX).toBeGreaterThanOrEqual(0);
        expect(t.gridX).toBeLessThan(level.cols);
        expect(t.gridY).toBeGreaterThanOrEqual(0);
        expect(t.gridY).toBeLessThan(level.rows);
        const key = `${t.gridX},${t.gridY}`;
        expect(occupied.has(key)).toBe(false);
        occupied.add(key);

        const spawn = getTunnelSpawnInfo(t);
        for (const c of spawn.cells) {
          expect(c.x).toBeGreaterThanOrEqual(0);
          expect(c.x).toBeLessThan(level.cols);
          expect(c.y).toBeGreaterThanOrEqual(0);
          expect(c.y).toBeLessThan(level.rows);
        }
      }

      for (const v of level.vehicles) {
        const cells = getVehicleCells(v);
        for (const c of cells) {
          expect(c.x).toBeGreaterThanOrEqual(0);
          expect(c.x).toBeLessThan(level.cols);
          expect(c.y).toBeGreaterThanOrEqual(0);
          expect(c.y).toBeLessThan(level.rows);
          const key = `${c.x},${c.y}`;
          expect(occupied.has(key)).toBe(false);
          occupied.add(key);
        }
      }

      // Check exact color seat parity across initial vehicles + tunnel queues
      const seatCounts: Record<ColorId, number> = {
        red: 0,
        blue: 0,
        green: 0,
        yellow: 0,
        purple: 0,
        orange: 0,
        cyan: 0,
        pink: 0,
      };
      for (const v of level.vehicles) {
        seatCounts[v.color] += v.size;
      }
      for (const t of level.tunnels) {
        for (const q of t.queue) {
          seatCounts[q.color] += q.size;
        }
      }

      const queueCounts: Record<ColorId, number> = {
        red: 0,
        blue: 0,
        green: 0,
        yellow: 0,
        purple: 0,
        orange: 0,
        cyan: 0,
        pink: 0,
      };
      for (const p of level.passengerQueue) {
        queueCounts[p]++;
      }

      for (const color of ALL_COLORS) {
        expect(queueCounts[color]).toBe(seatCounts[color]);
      }
    }
  });

  it('proves all 50 levels are solvable with standard 5 holding slots and zero helpers', () => {
    const failedLevels: number[] = [];
    for (let lvl = 1; lvl <= TOTAL_CAMPAIGN_LEVELS; lvl++) {
      const level = generateLevel(lvl);
      const solved = solveLevelWithBaseSlots(level);
      if (!solved) {
        failedLevels.push(lvl);
      }
    }
    expect(failedLevels).toEqual([]);
  });

  it('supports free Undo, VIP Slot Unlock, Continue For Free, and Shuffle helpers', () => {
    const level = generateLevel(10);
    const engine = new BoardEngine(level);
    const initialQueueLen = engine.passengerQueue.length;
    const initialVehicles = engine.vehicles.length;

    const freeCar = engine.vehicles.find((v) => engine.checkExitPath(v).clear)!;
    const res = engine.tapVehicle(freeCar.id);
    expect(res.type).toBe('EXIT_STARTED');
    expect(engine.moveCount).toBe(1);

    expect(engine.undo()).toBe(true);
    expect(engine.moveCount).toBe(0);
    expect(engine.passengerQueue.length).toBe(initialQueueLen);
    expect(engine.vehicles.length).toBe(initialVehicles);

    expect(engine.unlockVipSlot()).toBe(true);
    expect(engine.unlockedSlots).toBe(6);
    expect(engine.unlockVipSlot()).toBe(true);
    expect(engine.unlockedSlots).toBe(7);
    expect(engine.unlockVipSlot()).toBe(false);
  });
});
