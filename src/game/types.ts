export type ColorId =
  | 'red'
  | 'blue'
  | 'green'
  | 'yellow'
  | 'purple'
  | 'orange'
  | 'cyan'
  | 'pink';

export type Direction = 'UP' | 'DOWN' | 'LEFT' | 'RIGHT';

/**
 * 4 = 1x2 Sedan (4 seats)
 * 6 = 1x2 Van (6 seats)
 * 8 = 1x3 Bus (8 seats)
 */
export type VehicleSize = 4 | 6 | 8;

export type VehicleStatus =
  | 'GRID'
  | 'EXITING'
  | 'DOCKED'
  | 'DEPARTING'
  | 'CLEARED';

export interface GridCell {
  x: number;
  y: number;
}

export interface VehicleState {
  id: string;
  color: ColorId;
  size: VehicleSize;
  /** Top-left grid coordinate of the vehicle's occupied cells */
  gridX: number;
  gridY: number;
  lengthCells: 2 | 3;
  dir: Direction;
  /** True while color is concealed behind mystery wrap until adjacent vehicle exits */
  mystery: boolean;
  /** Remaining vehicle exits needed to shatter ice block (0 = thawed) */
  frozenCount: number;
  status: VehicleStatus;
  seatedCount: number;
  dockSlotIndex: number | null;
}

export interface TunnelQueuedVehicle {
  id: string;
  color: ColorId;
  size: VehicleSize;
  lengthCells: 2;
  mystery: boolean;
}

export interface TunnelSpawner {
  id: string;
  gridX: number;
  gridY: number;
  exitDir: Direction;
  queue: TunnelQueuedVehicle[];
}

export type MechanicTag =
  | 'cars'
  | 'vans-buses'
  | 'tunnels'
  | 'mystery'
  | 'frozen'
  | 'master';

export interface LevelConfig {
  levelNumber: number;
  title: string;
  subtitle: string;
  cols: number;
  rows: number;
  baseSlots: number;
  maxVipSlots: number;
  mechanics: MechanicTag[];
  vehicles: VehicleState[];
  tunnels: TunnelSpawner[];
  passengerQueue: ColorId[];
}

export interface BoardSnapshot {
  vehicles: VehicleState[];
  tunnels: TunnelSpawner[];
  passengerQueue: ColorId[];
  unlockedSlots: number;
  moveCount: number;
}

export interface ExitCheckResult {
  clear: boolean;
  blockerVehicleId?: string;
  blockerIsTunnel?: boolean;
  /** Number of unobstructed grid steps before reaching blocker or exiting edge */
  freeSteps: number;
}

export interface ColorMeta {
  id: ColorId;
  label: string;
  hex: string;
  lightHex: string;
  darkHex: string;
}

export const COLOR_PALETTE: Record<ColorId, ColorMeta> = {
  red: {
    id: 'red',
    label: 'Ruby Red',
    hex: '#ef4444',
    lightHex: '#fca5a5',
    darkHex: '#b91c1c',
  },
  blue: {
    id: 'blue',
    label: 'Cobalt Blue',
    hex: '#3b82f6',
    lightHex: '#93c5fd',
    darkHex: '#1d4ed8',
  },
  green: {
    id: 'green',
    label: 'Emerald',
    hex: '#22c55e',
    lightHex: '#86efac',
    darkHex: '#15803d',
  },
  yellow: {
    id: 'yellow',
    label: 'Taxi Gold',
    hex: '#eab308',
    lightHex: '#fde047',
    darkHex: '#a16207',
  },
  purple: {
    id: 'purple',
    label: 'Violet',
    hex: '#a855f7',
    lightHex: '#d8b4fe',
    darkHex: '#7e22ce',
  },
  orange: {
    id: 'orange',
    label: 'Tangerine',
    hex: '#f97316',
    lightHex: '#fdba74',
    darkHex: '#c2410c',
  },
  cyan: {
    id: 'cyan',
    label: 'Aqua Cyan',
    hex: '#06b6d4',
    lightHex: '#67e8f9',
    darkHex: '#0e7490',
  },
  pink: {
    id: 'pink',
    label: 'Flamingo',
    hex: '#ec4899',
    lightHex: '#f9a8d4',
    darkHex: '#be185d',
  },
};

export const ALL_COLORS: ColorId[] = [
  'red',
  'blue',
  'green',
  'yellow',
  'purple',
  'orange',
  'cyan',
  'pink',
];
