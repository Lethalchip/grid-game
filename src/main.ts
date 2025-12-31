import "./style.css";

const GRID_SIZE = 4;
const NUM_CELLS = GRID_SIZE * GRID_SIZE;
const LIT_COUNT = 3;
const GAME_DURATION_MS = 30_000;

const HOLD_TO_START_MS = 1000;
const DRAIN_MS = 180;

type Phase = "idle" | "countdown" | "running" | "ended";

type GameState = {
  phase: Phase;
  score: number;
  highScore: number;
  timeLeftMs: number;
  lit: Set<number>;
  timerId: number | null;
  countdownId: number | null;
  lastTickMs: number;
  overlayText: string;
  overlayIsError: boolean;
};

const HIGH_SCORE_KEY = "grid-click-high-score";

function loadHighScore(): number {
  const raw = localStorage.getItem(HIGH_SCORE_KEY);
  const n = raw ? Number(raw) : 0;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function saveHighScore(value: number) {
  localStorage.setItem(HIGH_SCORE_KEY, String(value));
}

function mustGetEl<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
}

const boardWrapEl = mustGetEl<HTMLDivElement>("boardWrap");
const boardEl = mustGetEl<HTMLDivElement>("board");
const overlayEl = mustGetEl<HTMLDivElement>("overlay");
const overlayTextEl = mustGetEl<HTMLDivElement>("overlayText");
const scoreEl = mustGetEl<HTMLDivElement>("score");
const highScoreEl = mustGetEl<HTMLDivElement>("highScore");
const timeEl = mustGetEl<HTMLSpanElement>("time");

const state: GameState = {
  phase: "idle",
  score: 0,
  highScore: loadHighScore(),
  timeLeftMs: GAME_DURATION_MS,
  lit: new Set<number>(),
  timerId: null,
  countdownId: null,
  lastTickMs: 0,
  overlayText: "Click the lit squares\n\nGame ends when you misclick or whe the timer hits 0s\n\nClick & hold to start",
  overlayIsError: false,
};

const cellButtons: HTMLButtonElement[] = [];

let holdMode: "none" | "holding" | "draining" = "none";
let holdProgress = 0;
let holdPointerId: number | null = null;
let holdStartMs = 0;

let holdRafId: number | null = null;
let drainRafId: number | null = null;
let drainStartMs = 0;
let drainStartProgress = 0;

function clamp01(v: number) {
  return Math.min(1, Math.max(0, v));
}

function setHoldProgress(p: number) {
  holdProgress = clamp01(p);
  boardWrapEl.style.setProperty("--hold", `${(holdProgress * 100).toFixed(2)}%`);
  boardWrapEl.classList.toggle("hold-visible", holdProgress > 0.001);
}

function cancelHoldAnimations() {
  if (holdRafId !== null) {
    cancelAnimationFrame(holdRafId);
    holdRafId = null;
  }
  if (drainRafId !== null) {
    cancelAnimationFrame(drainRafId);
    drainRafId = null;
  }
}

function resetHold() {
  cancelHoldAnimations();
  holdMode = "none";
  holdPointerId = null;
  setHoldProgress(0);
}

function buildBoard() {
  boardEl.innerHTML = "";
  cellButtons.length = 0;

  for (let i = 0; i < NUM_CELLS; i++) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cell";
    btn.dataset.index = String(i);
    btn.setAttribute("aria-label", `Cell ${i + 1}`);
    boardEl.appendChild(btn);
    cellButtons.push(btn);
  }
}

function setOverlay(text: string, isError = false) {
  state.overlayText = text;
  state.overlayIsError = isError;
}

function formatSeconds(ms: number): string {
  const s = Math.max(0, ms) / 1000;
  return s.toFixed(1);
}

function render() {
  scoreEl.textContent = String(state.score);
  highScoreEl.textContent = String(state.highScore);

  timeEl.textContent = `${formatSeconds(state.timeLeftMs)}s`;

  const warn = state.phase === "running" && state.timeLeftMs <= 15_000 && state.timeLeftMs > 5_000;
  const danger = state.phase === "running" && state.timeLeftMs <= 5_000;
  timeEl.classList.toggle("time-warn", warn);
  timeEl.classList.toggle("time-danger", danger);

  for (let i = 0; i < cellButtons.length; i++) {
    cellButtons[i].classList.toggle("lit", state.lit.has(i));
  }

  const showOverlay = state.phase !== "running";
  overlayTextEl.textContent = state.overlayText;
  overlayEl.classList.toggle("hidden", !showOverlay);
  overlayEl.classList.toggle("error", state.overlayIsError);
}

function randInt(maxExclusive: number): number {
  return Math.floor(Math.random() * maxExclusive);
}

function pickRandomUnlitIndex(excludeIndex: number | null): number | null {
  const candidates: number[] = [];
  for (let i = 0; i < NUM_CELLS; i++) {
    if (state.lit.has(i)) continue;
    if (excludeIndex !== null && i === excludeIndex) continue;
    candidates.push(i);
  }

  if (candidates.length === 0) return null;
  return candidates[randInt(candidates.length)];
}

function fillLitSquares() {
  state.lit.clear();
  while (state.lit.size < LIT_COUNT) {
    const idx = pickRandomUnlitIndex(null);
    if (idx === null) break;
    state.lit.add(idx);
  }
}

function stopTimer() {
  if (state.timerId !== null) {
    window.clearInterval(state.timerId);
    state.timerId = null;
  }
}

function stopCountdown() {
  if (state.countdownId !== null) {
    window.clearTimeout(state.countdownId);
    state.countdownId = null;
  }
}

function maybeUpdateHighScoreNow() {
  if (state.score > state.highScore) {
    state.highScore = state.score;
    saveHighScore(state.highScore);
  }
}

function endGame(message: string, isError: boolean) {
  state.phase = "ended";
  stopTimer();
  stopCountdown();
  resetHold();

  state.lit.clear();
  maybeUpdateHighScoreNow();

  setOverlay(`${message}\n\nClick & hold to restart`, isError);
  render();
}

function tickTimer() {
  const now = performance.now();
  const delta = now - state.lastTickMs;
  state.lastTickMs = now;

  state.timeLeftMs -= delta;
  if (state.timeLeftMs <= 0) {
    state.timeLeftMs = 0;
    endGame(`Time's up! Score: ${state.score}`, false);
    return;
  }

  render();
}

function startRunning() {
  resetHold();

  state.phase = "running";
  state.score = 0;
  state.timeLeftMs = GAME_DURATION_MS;

  fillLitSquares();
  setOverlay("", false);

  state.lastTickMs = performance.now();
  state.timerId = window.setInterval(tickTimer, 50);

  render();
}

function startCountdown() {
  stopTimer();
  stopCountdown();
  resetHold();

  state.phase = "countdown";
  state.score = 0;
  state.timeLeftMs = GAME_DURATION_MS;
  state.lit.clear();

  let n = 3;
  const step = () => {
    if (state.phase !== "countdown") return;

    if (n > 0) {
      setOverlay(`Starting in ${n}...`, false);
      n -= 1;
      render();
      state.countdownId = window.setTimeout(step, 1000);
      return;
    }

    state.countdownId = null;
    startRunning();
  };

  step();
}

function handleCellDown(index: number) {
  if (state.phase !== "running") return;

  if (!state.lit.has(index)) {
    endGame(`Game over! Score: ${state.score}`, false);
    return;
  }

  state.score += 1;
  maybeUpdateHighScoreNow();

  state.lit.delete(index);

  const replacement = pickRandomUnlitIndex(index);
  if (replacement !== null) state.lit.add(replacement);

  render();
}

function getCellIndexFromPointer(e: PointerEvent): number | null {
  const rect = boardEl.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  if (x < 0 || y < 0 || x >= rect.width || y >= rect.height) return null;

  const col = Math.min(GRID_SIZE - 1, Math.max(0, Math.floor((x / rect.width) * GRID_SIZE)));
  const row = Math.min(GRID_SIZE - 1, Math.max(0, Math.floor((y / rect.height) * GRID_SIZE)));

  return row * GRID_SIZE + col;
}

function startHold(pointerId: number) {
  cancelHoldAnimations();
  holdMode = "holding";
  holdPointerId = pointerId;
  holdStartMs = performance.now();
  setHoldProgress(0);

  const loop = () => {
    if (holdMode !== "holding") return;

    const now = performance.now();
    const p = (now - holdStartMs) / HOLD_TO_START_MS;
    setHoldProgress(p);

    if (holdProgress >= 1) {
      completeHold();
      return;
    }

    holdRafId = requestAnimationFrame(loop);
  };

  holdRafId = requestAnimationFrame(loop);
}

function startDrain() {
  cancelHoldAnimations();
  holdMode = "draining";
  drainStartMs = performance.now();
  drainStartProgress = holdProgress;

  const loop = () => {
    if (holdMode !== "draining") return;

    const now = performance.now();
    const t = (now - drainStartMs) / DRAIN_MS;
    const p = drainStartProgress * (1 - t);
    setHoldProgress(p);

    if (t >= 1 || holdProgress <= 0.001) {
      holdMode = "none";
      holdPointerId = null;
      setHoldProgress(0);
      return;
    }

    drainRafId = requestAnimationFrame(loop);
  };

  drainRafId = requestAnimationFrame(loop);
}

function completeHold() {
  const pid = holdPointerId;
  resetHold();
  if (pid !== null) {
    try {
      overlayEl.releasePointerCapture(pid);
    } catch {}
  }
  startCountdown();
}

buildBoard();
render();

boardEl.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  e.preventDefault();

  const idx = getCellIndexFromPointer(e);
  if (idx === null) return;

  handleCellDown(idx);
});

overlayEl.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  e.preventDefault();

  if (state.phase !== "idle" && state.phase !== "ended") return;

  resetHold();

  holdPointerId = e.pointerId;
  try {
    overlayEl.setPointerCapture(e.pointerId);
  } catch {}

  startHold(e.pointerId);
});

overlayEl.addEventListener("pointerup", (e) => {
  e.preventDefault();

  if (holdMode === "holding" && holdPointerId === e.pointerId) {
    try {
      overlayEl.releasePointerCapture(e.pointerId);
    } catch {}
    startDrain();
  }
});

overlayEl.addEventListener("pointercancel", (e) => {
  e.preventDefault();

  if (holdMode === "holding" && holdPointerId === e.pointerId) {
    startDrain();
  }
});

overlayEl.addEventListener("lostpointercapture", () => {
  if (holdMode === "holding") startDrain();
});
