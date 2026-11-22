export interface LevelRecord {
  completed: boolean;
  bestMoves: number;
}

export interface PlayerProgress {
  currentLevel: number;
  highestUnlocked: number;
  unlockAllFree: boolean;
  muted: boolean;
  records: Record<number, LevelRecord>;
}

const STORAGE_KEY = 'car_jam_solver_pwa_v1';

const DEFAULT_PROGRESS: PlayerProgress = {
  currentLevel: 1,
  highestUnlocked: 1,
  unlockAllFree: false,
  muted: false,
  records: {},
};

export class ProgressStore {
  private state: PlayerProgress;

  constructor() {
    this.state = this.load();
  }

  private load(): PlayerProgress {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { ...DEFAULT_PROGRESS, records: {} };
      const parsed = JSON.parse(raw) as Partial<PlayerProgress>;
      return {
        currentLevel: parsed.currentLevel ?? 1,
        highestUnlocked: parsed.highestUnlocked ?? 1,
        unlockAllFree: parsed.unlockAllFree ?? false,
        muted: parsed.muted ?? false,
        records: parsed.records ?? {},
      };
    } catch {
      return { ...DEFAULT_PROGRESS, records: {} };
    }
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      // Ignore storage quota / private mode failures
    }
  }

  public getProgress(): PlayerProgress {
    return this.state;
  }

  public setCurrentLevel(level: number): void {
    this.state.currentLevel = level;
    if (level > this.state.highestUnlocked) {
      this.state.highestUnlocked = level;
    }
    this.save();
  }

  public markLevelCompleted(level: number, moves: number): void {
    const existing = this.state.records[level];
    this.state.records[level] = {
      completed: true,
      bestMoves: existing ? Math.min(existing.bestMoves, moves) : moves,
    };
    if (level + 1 > this.state.highestUnlocked) {
      this.state.highestUnlocked = level + 1;
    }
    this.save();
  }

  public setMuted(muted: boolean): void {
    this.state.muted = muted;
    this.save();
  }

  public setUnlockAllFree(enabled: boolean): void {
    this.state.unlockAllFree = enabled;
    this.save();
  }

  public isLevelUnlocked(level: number): boolean {
    return this.state.unlockAllFree || level <= this.state.highestUnlocked;
  }
}
