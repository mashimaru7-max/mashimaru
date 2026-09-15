import {
  SIZE,
  TYPE_COUNT,
  areAdjacent,
  calculateScore,
  clearMatches,
  collapseBoard,
  createBoard,
  findMatches,
  hasPossibleMove,
  keyOf,
  swapCells,
} from './game-core.js';

const ROUND_SECONDS = 75;
const LEGEND_TARGET = 60;
const LEGEND_DURATION = 10_000;
const DUCK_NAMES = ['아기오리', '흰오리', '리본오리', '탐험오리', '달빛오리'];

const boardElement = document.querySelector('#board');
const scoreElement = document.querySelector('#score');
const bestElement = document.querySelector('#best');
const timeElement = document.querySelector('#time');
const comboElement = document.querySelector('#combo');
const gaugeFill = document.querySelector('#gauge-fill');
const gaugeText = document.querySelector('#gauge-text');
const legendButton = document.querySelector('#legend-button');
const startOverlay = document.querySelector('#start-overlay');
const resultOverlay = document.querySelector('#result-overlay');
const finalScoreElement = document.querySelector('#final-score');
const newBestElement = document.querySelector('#new-best');
const scoreBurst = document.querySelector('#score-burst');

let board = createBoard();
let score = 0;
let best = Number(localStorage.getItem('duckpang-best') || 0);
let gauge = 0;
let deadline = 0;
let timerHandle = null;
let selected = null;
let pointerStart = null;
let busy = false;
let running = false;
let legendUntil = 0;
let legendHandle = null;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isLegendActive() {
  return legendUntil > Date.now();
}

function duckImage(type) {
  return `./assets/duck-${type + (isLegendActive() ? 6 : 1)}.png`;
}

function cellAt(target) {
  const cell = target.closest('.cell');
  if (!cell) return null;
  return { row: Number(cell.dataset.row), col: Number(cell.dataset.col) };
}

function updateHud() {
  scoreElement.textContent = score.toLocaleString('ko-KR');
  bestElement.textContent = best.toLocaleString('ko-KR');
  const gaugePercent = Math.min(100, (gauge / LEGEND_TARGET) * 100);
  gaugeFill.style.width = `${gaugePercent}%`;
  gaugeText.textContent = isLegendActive() ? `각성 ${Math.max(0, (legendUntil - Date.now()) / 1000).toFixed(1)}초` : `${gauge} / ${LEGEND_TARGET}`;
  legendButton.disabled = gauge < LEGEND_TARGET || isLegendActive() || !running;
  legendButton.classList.toggle('ready', gauge >= LEGEND_TARGET && !isLegendActive() && running);
  document.body.classList.toggle('legend-active', isLegendActive());
}

function renderBoard(extraClass = '') {
  boardElement.innerHTML = '';
  const fragment = document.createDocumentFragment();
  for (let row = 0; row < SIZE; row += 1) {
    for (let col = 0; col < SIZE; col += 1) {
      const type = board[row][col];
      const button = document.createElement('button');
      button.className = `cell ${extraClass}`;
      button.dataset.row = row;
      button.dataset.col = col;
      button.setAttribute('aria-label', `${row + 1}행 ${col + 1}열 ${DUCK_NAMES[type]}`);
      if (selected?.row === row && selected?.col === col) button.classList.add('selected');
      const image = document.createElement('img');
      image.src = duckImage(type);
      image.alt = '';
      image.draggable = false;
      button.append(image);
      fragment.append(button);
    }
  }
  boardElement.append(fragment);
}

function markCells(keys, className) {
  for (const key of keys) {
    const [row, col] = key.split(',');
    boardElement.querySelector(`[data-row="${row}"][data-col="${col}"]`)?.classList.add(className);
  }
}

function showBurst(amount) {
  scoreBurst.textContent = `+${amount.toLocaleString('ko-KR')}`;
  scoreBurst.classList.remove('show');
  void scoreBurst.offsetWidth;
  scoreBurst.classList.add('show');
}

async function resolveMatches(initialMatches) {
  let matches = initialMatches;
  let chain = 0;
  while (matches.size && running) {
    chain += 1;
    comboElement.textContent = chain > 1 ? `${chain} CHAIN!` : 'GOOD!';
    comboElement.classList.add('visible');
    markCells(matches, 'matched');
    const earned = calculateScore(matches.size, chain, isLegendActive());
    score += earned;
    gauge = Math.min(LEGEND_TARGET, gauge + matches.size + (chain - 1) * 3);
    showBurst(earned);
    updateHud();
    await wait(170);
    clearMatches(board, matches);
    collapseBoard(board);
    renderBoard('dropping');
    await wait(210);
    matches = findMatches(board);
  }
  await wait(80);
  comboElement.classList.remove('visible');
  if (!hasPossibleMove(board) && running) {
    comboElement.textContent = '자동 셔플!';
    comboElement.classList.add('visible');
    do board = createBoard(); while (!hasPossibleMove(board));
    renderBoard('shuffle');
    await wait(350);
    comboElement.classList.remove('visible');
  }
}

async function tryMove(a, b) {
  if (!running || busy || !areAdjacent(a, b)) return;
  busy = true;
  selected = null;
  swapCells(board, a, b);
  renderBoard('swapping');
  await wait(130);
  const matches = findMatches(board);
  if (!matches.size) {
    swapCells(board, a, b);
    renderBoard();
    const aKey = keyOf(a.row, a.col);
    const bKey = keyOf(b.row, b.col);
    markCells(new Set([aKey, bKey]), 'invalid');
    await wait(170);
  } else {
    await resolveMatches(matches);
  }
  renderBoard();
  busy = false;
}

function handleTap(cell) {
  if (!running || busy) return;
  if (!selected) {
    selected = cell;
    renderBoard();
    return;
  }
  if (selected.row === cell.row && selected.col === cell.col) {
    selected = null;
    renderBoard();
    return;
  }
  if (areAdjacent(selected, cell)) {
    const first = selected;
    selected = null;
    void tryMove(first, cell);
  } else {
    selected = cell;
    renderBoard();
  }
}

boardElement.addEventListener('pointerdown', (event) => {
  const cell = cellAt(event.target);
  if (!cell || !running || busy) return;
  pointerStart = { ...cell, x: event.clientX, y: event.clientY };
  event.currentTarget.setPointerCapture?.(event.pointerId);
});

boardElement.addEventListener('pointerup', (event) => {
  if (!pointerStart) return;
  const start = pointerStart;
  pointerStart = null;
  const dx = event.clientX - start.x;
  const dy = event.clientY - start.y;
  if (Math.max(Math.abs(dx), Math.abs(dy)) < 16) {
    handleTap({ row: start.row, col: start.col });
    return;
  }
  const target = { row: start.row, col: start.col };
  if (Math.abs(dx) > Math.abs(dy)) target.col += dx > 0 ? 1 : -1;
  else target.row += dy > 0 ? 1 : -1;
  if (target.row >= 0 && target.row < SIZE && target.col >= 0 && target.col < SIZE) void tryMove(start, target);
});

boardElement.addEventListener('pointercancel', () => {
  pointerStart = null;
});

function tick() {
  if (!running) return;
  const remaining = Math.max(0, deadline - Date.now());
  timeElement.textContent = Math.ceil(remaining / 1000);
  timeElement.classList.toggle('danger', remaining <= 10_000);
  updateHud();
  if (remaining <= 0) endGame();
}

function startGame() {
  clearInterval(timerHandle);
  clearInterval(legendHandle);
  board = createBoard();
  score = 0;
  gauge = 0;
  legendUntil = 0;
  selected = null;
  busy = false;
  running = true;
  deadline = Date.now() + ROUND_SECONDS * 1000;
  timeElement.textContent = ROUND_SECONDS;
  startOverlay.hidden = true;
  resultOverlay.hidden = true;
  renderBoard();
  updateHud();
  timerHandle = setInterval(tick, 100);
}

function endGame() {
  if (!running) return;
  running = false;
  clearInterval(timerHandle);
  clearInterval(legendHandle);
  const previousBest = best;
  if (score > best) {
    best = score;
    localStorage.setItem('duckpang-best', String(best));
  }
  finalScoreElement.textContent = score.toLocaleString('ko-KR');
  newBestElement.hidden = score <= previousBest;
  resultOverlay.hidden = false;
  selected = null;
  updateHud();
}

legendButton.addEventListener('click', () => {
  if (!running || gauge < LEGEND_TARGET || isLegendActive()) return;
  gauge = 0;
  legendUntil = Date.now() + LEGEND_DURATION;
  renderBoard('awakened');
  updateHud();
  legendHandle = setInterval(() => {
    if (!isLegendActive()) {
      clearInterval(legendHandle);
      legendUntil = 0;
      renderBoard();
    }
    updateHud();
  }, 100);
});

document.querySelectorAll('[data-action="start"]').forEach((button) => button.addEventListener('click', startGame));
document.querySelector('#how-button').addEventListener('click', () => {
  document.querySelector('#how-panel').classList.toggle('open');
});

bestElement.textContent = best.toLocaleString('ko-KR');
renderBoard();
updateHud();
