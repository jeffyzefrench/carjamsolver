import './styles/main.css';
import confetti from 'canvas-confetti';
import { SoundEffects } from './audio/SoundEffects';
import { BoardEngine } from './game/BoardEngine';
import { TOTAL_CAMPAIGN_LEVELS, generateLevel } from './game/Levels';
import { COLOR_PALETTE } from './game/types';
import { SceneManager } from './render/SceneManager';
import { ProgressStore } from './storage/ProgressStore';

const store = new ProgressStore();
const sfx = new SoundEffects();
sfx.setMuted(store.getProgress().muted);

let currentLevelNum = store.getProgress().currentLevel;
const engine = new BoardEngine(generateLevel(currentLevelNum));

// DOM Elements
const canvasHost = document.getElementById('canvas-host')!;
const hudLevelNum = document.getElementById('hud-level-num')!;
const hudLevelTitle = document.getElementById('hud-level-title')!;
const hudLevelSubtitle = document.getElementById('hud-level-subtitle')!;
const hudPassengers = document.getElementById('hud-passengers')!;
const hudMoves = document.getElementById('hud-moves')!;
const hudQueueDots = document.getElementById('hud-queue-dots')!;
const toastEl = document.getElementById('toast')!;

const btnLevels = document.getElementById('btn-levels') as HTMLButtonElement;
const btnSound = document.getElementById('btn-sound') as HTMLButtonElement;
const btnUndo = document.getElementById('btn-undo') as HTMLButtonElement;
const btnVip = document.getElementById('btn-vip') as HTMLButtonElement;
const btnShuffle = document.getElementById('btn-shuffle') as HTMLButtonElement;
const btnRestart = document.getElementById('btn-restart') as HTMLButtonElement;

const dialogStuck = document.getElementById('dialog-stuck') as HTMLDialogElement;
const btnStuckContinue = document.getElementById('btn-stuck-continue')!;
const btnStuckUndo = document.getElementById('btn-stuck-undo')!;
const btnStuckRestart = document.getElementById('btn-stuck-restart')!;

const dialogWin = document.getElementById('dialog-win') as HTMLDialogElement;
const winSummary = document.getElementById('win-summary')!;
const btnWinNext = document.getElementById('btn-win-next')!;
const btnWinReplay = document.getElementById('btn-win-replay')!;

const dialogLevels = document.getElementById('dialog-levels') as HTMLDialogElement;
const btnLevelsClose = document.getElementById('btn-levels-close')!;
const chkUnlockAll = document.getElementById('chk-unlock-all') as HTMLInputElement;
const levelsGrid = document.getElementById('levels-grid')!;

// Light-dismiss fallback for browsers without native <dialog closedby="any">
if (!('closedBy' in HTMLDialogElement.prototype)) {
  const outside = (e: PointerEvent, dialog: HTMLDialogElement) => {
    const r = dialog.getBoundingClientRect();
    return (
      e.clientX < r.left ||
      e.clientX > r.right ||
      e.clientY < r.top ||
      e.clientY > r.bottom
    );
  };
  let pressedOutside = false;
  dialogLevels.addEventListener('pointerdown', (e) => {
    pressedOutside = outside(e, dialogLevels);
  });
  dialogLevels.addEventListener('pointerup', (e) => {
    if (pressedOutside && outside(e, dialogLevels)) {
      dialogLevels.close();
    }
  });
}

let toastTimer: number | null = null;
function showToast(msg: string): void {
  toastEl.textContent = msg;
  toastEl.classList.add('visible');
  if (toastTimer !== null) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toastEl.classList.remove('visible');
  }, 1900);
}

let boardingTimer: number | null = null;
let pendingWinHandled = false;

const sceneManager = new SceneManager(canvasHost, engine, {
  onVehicleTapped: (vehicleId) => {
    if (dialogStuck.open || dialogWin.open || dialogLevels.open) return;
    const res = engine.tapVehicle(vehicleId);

    switch (res.type) {
      case 'IGNORED':
        return;
      case 'FROZEN':
        sfx.playFrozenTap();
        sceneManager.playTapReaction(res);
        showToast(
          `Frozen! Clear ${res.vehicle.frozenCount} more car${
            res.vehicle.frozenCount === 1 ? '' : 's'
          } to thaw`
        );
        return;
      case 'BLOCKED':
        sfx.playBlockedBump();
        sceneManager.playTapReaction(res);
        return;
      case 'DOCK_FULL':
        sfx.playStuckAlert();
        showToast('All holding slots busy! Unlock a +1 VIP Slot for free.');
        checkEndConditions();
        return;
      case 'EXIT_STARTED':
        sfx.playCarStart();
        if (res.revealedVehicles.length > 0) {
          setTimeout(() => sfx.playMysteryReveal(), 120);
        }
        if (res.iceUpdates.some((u) => u.shattered)) {
          setTimeout(() => sfx.playIceShatter(), 160);
        }
        sceneManager.playTapReaction(res);
        updateHud();
        return;
    }
  },
  onVehicleDocked: (vehicleId) => {
    if (engine.markVehicleDocked(vehicleId)) {
      scheduleBoardingPump();
    }
  },
  onVehicleDeparted: (vehicleId) => {
    engine.completeVehicleDeparture(vehicleId);
    sfx.playVehicleDepart();
    updateHud();
    scheduleBoardingPump();
    checkEndConditions();
  },
});

function scheduleBoardingPump(): void {
  if (boardingTimer !== null) return;
  boardingTimer = window.setInterval(() => {
    const ev = engine.claimNextPassenger();
    if (!ev) {
      if (boardingTimer !== null) {
        window.clearInterval(boardingTimer);
        boardingTimer = null;
      }
      checkEndConditions();
      return;
    }
    sfx.playPassengerBoard();
    sceneManager.playBoardingHop(ev);
    updateHud();
  }, 95);
}

function stopBoardingPump(): void {
  if (boardingTimer !== null) {
    window.clearInterval(boardingTimer);
    boardingTimer = null;
  }
}

function checkEndConditions(): void {
  if (engine.isWon() && !pendingWinHandled) {
    pendingWinHandled = true;
    stopBoardingPump();
    store.markLevelCompleted(engine.level.levelNumber, engine.moveCount);
    sfx.playLevelWin();
    void confetti({
      particleCount: 85,
      spread: 75,
      origin: { y: 0.6 },
    });
    winSummary.textContent = `Level ${engine.level.levelNumber} cleared in ${engine.moveCount} moves!`;
    if (!dialogWin.open) {
      dialogWin.showModal();
    }
    return;
  }

  if (engine.isStuck() && !dialogStuck.open && !dialogWin.open) {
    sfx.playStuckAlert();
    dialogStuck.showModal();
  }
}

function updateHud(): void {
  const lvl = engine.level;
  const labelMax =
    lvl.levelNumber <= TOTAL_CAMPAIGN_LEVELS
      ? `${lvl.levelNumber} / ${TOTAL_CAMPAIGN_LEVELS}`
      : `${lvl.levelNumber} (Endless)`;
  hudLevelNum.textContent = labelMax;
  hudLevelTitle.textContent = lvl.title;
  hudLevelSubtitle.textContent = lvl.subtitle;
  hudPassengers.textContent = String(engine.getRemainingPassengersCount());
  hudMoves.textContent = String(engine.moveCount);

  btnSound.textContent = sfx.isMuted() ? '🔇' : '🔊';
  btnUndo.disabled = !engine.canUndo();
  btnVip.disabled = !engine.canUnlockVipSlot();
  btnShuffle.disabled = engine.passengerQueue.length <= 1;

  // Render upcoming 8 passengers as crisp color dots
  hudQueueDots.innerHTML = '';
  const nextSlice = engine.passengerQueue.slice(0, 8);
  nextSlice.forEach((color, idx) => {
    const dot = document.createElement('span');
    dot.className = idx === 0 ? 'queue-dot first' : 'queue-dot';
    dot.style.backgroundColor = COLOR_PALETTE[color].hex;
    dot.title = COLOR_PALETTE[color].label;
    hudQueueDots.appendChild(dot);
  });
}

function loadLevelNumber(num: number): void {
  stopBoardingPump();
  pendingWinHandled = false;
  currentLevelNum = num;
  store.setCurrentLevel(num);
  engine.loadLevel(generateLevel(num));
  sceneManager.rebuildFromEngine();
  updateHud();
}

function renderLevelGrid(): void {
  const prog = store.getProgress();
  chkUnlockAll.checked = prog.unlockAllFree;
  levelsGrid.innerHTML = '';

  const totalToShow = Math.max(TOTAL_CAMPAIGN_LEVELS, prog.highestUnlocked + 2);
  for (let i = 1; i <= totalToShow; i++) {
    const btn = document.createElement('button');
    btn.type = 'button';
    const unlocked = store.isLevelUnlocked(i);
    const rec = prog.records[i];
    btn.className = 'level-cell';
    if (i === currentLevelNum) btn.classList.add('current');
    if (rec?.completed) btn.classList.add('completed');
    btn.disabled = !unlocked;

    const numSpan = document.createElement('span');
    numSpan.textContent = String(i);
    btn.appendChild(numSpan);

    const tagSpan = document.createElement('span');
    tagSpan.className = 'level-tag';
    if (!unlocked) {
      tagSpan.textContent = '🔒';
    } else if (rec?.completed) {
      tagSpan.textContent = `★ ${rec.bestMoves}`;
    } else if (i <= 5) {
      tagSpan.textContent = 'Cars';
    } else if (i <= 12) {
      tagSpan.textContent = 'Buses';
    } else if (i <= 20) {
      tagSpan.textContent = 'Tunnel';
    } else if (i <= 30) {
      tagSpan.textContent = '? Car';
    } else if (i <= 40) {
      tagSpan.textContent = 'Ice';
    } else if (i <= 50) {
      tagSpan.textContent = 'Boss';
    } else {
      tagSpan.textContent = 'End';
    }
    btn.appendChild(tagSpan);

    btn.addEventListener('click', () => {
      dialogLevels.close();
      loadLevelNumber(i);
    });
    levelsGrid.appendChild(btn);
  }
}

// Button Handlers
btnSound.addEventListener('click', () => {
  const nextMuted = !sfx.isMuted();
  sfx.setMuted(nextMuted);
  store.setMuted(nextMuted);
  updateHud();
});

btnUndo.addEventListener('click', () => {
  stopBoardingPump();
  if (engine.undo()) {
    sceneManager.rebuildFromEngine();
    updateHud();
    showToast('Move undone!');
  }
});

btnVip.addEventListener('click', () => {
  if (engine.unlockVipSlot()) {
    sceneManager.syncDockLocks();
    updateHud();
    showToast(`VIP Slot unlocked (${engine.unlockedSlots} total)!`);
    scheduleBoardingPump();
  }
});

btnShuffle.addEventListener('click', () => {
  if (engine.shuffleQueue()) {
    sceneManager.syncPassengerQueueVisual();
    updateHud();
    showToast('Matching passengers moved to front!');
    scheduleBoardingPump();
  }
});

btnRestart.addEventListener('click', () => {
  loadLevelNumber(currentLevelNum);
  showToast('Level restarted!');
});

// Stuck Modal Actions (Ad-Free Continue or Restart)
btnStuckContinue.addEventListener('click', () => {
  dialogStuck.close();
  const outcome = engine.continueForFree();
  if (outcome.action === 'VIP_UNLOCKED') {
    sceneManager.syncDockLocks();
    showToast('Free VIP Slot unlocked! Keep going!');
  } else if (outcome.vehicle) {
    sceneManager.syncPassengerQueueVisual();
    sceneManager.playVehicleDeparture(outcome.vehicle);
    showToast('Cleared a parked car for free!');
  }
  updateHud();
  scheduleBoardingPump();
});

btnStuckUndo.addEventListener('click', () => {
  dialogStuck.close();
  stopBoardingPump();
  if (engine.undo()) {
    sceneManager.rebuildFromEngine();
    updateHud();
  }
});

btnStuckRestart.addEventListener('click', () => {
  dialogStuck.close();
  loadLevelNumber(currentLevelNum);
});

// Win Modal Actions
btnWinNext.addEventListener('click', () => {
  dialogWin.close();
  loadLevelNumber(currentLevelNum + 1);
});

btnWinReplay.addEventListener('click', () => {
  dialogWin.close();
  loadLevelNumber(currentLevelNum);
});

// Level Selector Modal Actions
btnLevels.addEventListener('click', () => {
  renderLevelGrid();
  dialogLevels.showModal();
});

btnLevelsClose.addEventListener('click', () => {
  dialogLevels.close();
});

chkUnlockAll.addEventListener('change', () => {
  store.setUnlockAllFree(chkUnlockAll.checked);
  renderLevelGrid();
});

// Initial HUD Sync
updateHud();
