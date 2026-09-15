import {
  SIZE,
  TYPE_COUNT,
  areAdjacent,
  calculateScore,
  createBoard,
  expandSpecialCells,
  findMatchGroups,
  hasPossibleMove,
  keyOf,
  specialKindForGroup,
  swapCells,
} from './game-core.js?v=4';

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

let nextTileId = 1;
let board = makePlayableBoard();
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

function newTile(type, special = null) {
  return { id: nextTileId++, type, special };
}

function makePlayableBoard() {
  return createBoard().map((row) => row.map((type) => newTile(type)));
}

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

function cellElement(cell) {
  return boardElement.querySelector(`[data-row="${cell.row}"][data-col="${cell.col}"]`);
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

function specialLabel(special) {
  return { row: '가로 줄 특수', col: '세로 줄 특수', bomb: '폭발 특수', sun: '태양 특수' }[special] || '';
}

function renderBoard(dropRows = new Map()) {
  boardElement.innerHTML = '';
  const fragment = document.createDocumentFragment();
  const cellStep = boardElement.clientWidth / SIZE;
  let longestDrop = 0;
  for (let row = 0; row < SIZE; row += 1) {
    for (let col = 0; col < SIZE; col += 1) {
      const tile = board[row][col];
      const button = document.createElement('button');
      button.className = 'cell';
      button.dataset.row = row;
      button.dataset.col = col;
      button.dataset.tileId = tile.id;
      if (tile.special) button.classList.add(`special-${tile.special}`);
      const extraLabel = tile.special ? ` ${specialLabel(tile.special)}` : '';
      button.setAttribute('aria-label', `${row + 1}행 ${col + 1}열 ${DUCK_NAMES[tile.type]}${extraLabel}`);
      if (selected?.row === row && selected?.col === col) button.classList.add('selected');
      const image = document.createElement('img');
      image.src = duckImage(tile.type);
      image.alt = '';
      image.draggable = false;
      button.append(image);
      if (tile.special) {
        const badge = document.createElement('span');
        badge.className = 'special-badge';
        badge.textContent = { row: '↔', col: '↕', bomb: '✦', sun: '☀' }[tile.special];
        button.append(badge);
      }
      const rows = dropRows.get(tile.id) || 0;
      if (rows > 0) {
        const duration = Math.min(620, 330 + rows * 42);
        const delay = Math.min(36, row * 5);
        button.style.setProperty('--drop-distance', `${Math.round(rows * cellStep)}px`);
        button.style.setProperty('--drop-duration', `${duration}ms`);
        button.style.setProperty('--drop-delay', `${delay}ms`);
        button.classList.add('dropping');
        longestDrop = Math.max(longestDrop, duration + delay);
      }
      fragment.append(button);
    }
  }
  boardElement.append(fragment);
  return longestDrop;
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

function unionCells(groups) {
  const cells = new Set();
  for (const group of groups) for (const cell of group.cells) cells.add(keyOf(cell.row, cell.col));
  return cells;
}

function chooseSpecial(group, preferredCells = []) {
  const special = specialKindForGroup(group);
  if (!special) return null;
  const inGroup = (candidate) => group.cells.some((cell) => cell.row === candidate.row && cell.col === candidate.col);
  let cell = preferredCells.find((candidate) => inGroup(candidate) && !board[candidate.row][candidate.col].special);
  if (!cell) cell = group.cells.find((candidate) => !board[candidate.row][candidate.col].special);
  if (!cell) cell = group.cells[Math.floor(group.cells.length / 2)];
  return { cell, special, type: group.type };
}

function collapseTiles() {
  const nextBoard = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
  const dropRows = new Map();
  for (let col = 0; col < SIZE; col += 1) {
    let writeRow = SIZE - 1;
    for (let readRow = SIZE - 1; readRow >= 0; readRow -= 1) {
      const tile = board[readRow][col];
      if (!tile) continue;
      nextBoard[writeRow][col] = tile;
      if (writeRow > readRow) dropRows.set(tile.id, writeRow - readRow);
      writeRow -= 1;
    }
    const newCount = writeRow + 1;
    for (let row = writeRow; row >= 0; row -= 1) {
      const tile = newTile(Math.floor(Math.random() * TYPE_COUNT));
      nextBoard[row][col] = tile;
      dropRows.set(tile.id, newCount);
    }
  }
  board = nextBoard;
  return dropRows;
}

async function resolveMatches(initialGroups, preferredCells = []) {
  let groups = initialGroups;
  let chain = 0;
  while (groups.length && running) {
    chain += 1;
    comboElement.textContent = chain > 1 ? `${chain} CHAIN!` : 'GOOD!';
    comboElement.classList.add('visible');
    const creations = groups.map((group) => chooseSpecial(group, preferredCells)).filter(Boolean);
    const spawnKeys = new Set(creations.map(({ cell }) => keyOf(cell.row, cell.col)));
    const matched = expandSpecialCells(board, unionCells(groups));
    for (const spawnKey of spawnKeys) matched.delete(spawnKey);
    markCells(matched, 'matched');
    const earned = calculateScore(matched.size + creations.length, chain, isLegendActive());
    score += earned;
    gauge = Math.min(LEGEND_TARGET, gauge + matched.size + creations.length + (chain - 1) * 3);
    showBurst(earned);
    updateHud();
    await wait(190);
    for (const key of matched) {
      const [row, col] = key.split(',').map(Number);
      board[row][col] = null;
    }
    for (const creation of creations) {
      const { row, col } = creation.cell;
      if (board[row][col]) board[row][col].special = creation.special;
      else board[row][col] = newTile(creation.type, creation.special);
    }
    const dropRows = collapseTiles();
    const dropTime = renderBoard(dropRows);
    await wait(dropTime + 25);
    groups = findMatchGroups(board);
    preferredCells = [];
  }
  await wait(60);
  comboElement.classList.remove('visible');
  if (!hasPossibleMove(board) && running) {
    comboElement.textContent = '자동 셔플!';
    comboElement.classList.add('visible');
    board = makePlayableBoard();
    const dropTime = renderBoard(new Map(board.flat().map((tile) => [tile.id, SIZE])));
    await wait(dropTime + 25);
    comboElement.classList.remove('visible');
  }
}

async function activateSpecials(cells) {
  const initial = new Set(cells.map((cell) => keyOf(cell.row, cell.col)));
  const affected = expandSpecialCells(board, initial);
  comboElement.textContent = cells.length > 1 ? 'SPECIAL COMBO!' : 'SPECIAL!';
  comboElement.classList.add('visible');
  markCells(affected, 'matched');
  const earned = calculateScore(affected.size, cells.length > 1 ? 2 : 1, isLegendActive());
  score += earned;
  gauge = Math.min(LEGEND_TARGET, gauge + affected.size);
  showBurst(earned);
  updateHud();
  await wait(210);
  for (const key of affected) {
    const [row, col] = key.split(',').map(Number);
    board[row][col] = null;
  }
  const dropRows = collapseTiles();
  const dropTime = renderBoard(dropRows);
  await wait(dropTime + 25);
  const cascade = findMatchGroups(board);
  if (cascade.length) await resolveMatches(cascade);
  comboElement.classList.remove('visible');
}

async function animateSwap(a, b, valid) {
  const first = cellElement(a);
  const second = cellElement(b);
  if (!first || !second) return;
  const firstRect = first.getBoundingClientRect();
  const secondRect = second.getBoundingClientRect();
  const dx = secondRect.left - firstRect.left;
  const dy = secondRect.top - firstRect.top;
  first.classList.add('moving');
  second.classList.add('moving');
  first.style.transform = `translate(${dx}px, ${dy}px)`;
  second.style.transform = `translate(${-dx}px, ${-dy}px)`;
  await wait(150);
  if (!valid) {
    first.style.transform = '';
    second.style.transform = '';
    await wait(145);
  }
}

async function tryMove(a, b) {
  if (!running || busy || !areAdjacent(a, b)) return;
  busy = true;
  selected = null;
  const firstSpecial = board[a.row][a.col].special;
  const secondSpecial = board[b.row][b.col].special;
  swapCells(board, a, b);
  const groups = findMatchGroups(board);
  swapCells(board, a, b);
  const immediateSpecial = firstSpecial || secondSpecial;
  const valid = immediateSpecial || groups.length > 0;
  await animateSwap(a, b, valid);
  if (!valid) {
    renderBoard();
    markCells(new Set([keyOf(a.row, a.col), keyOf(b.row, b.col)]), 'invalid');
    await wait(120);
  } else {
    swapCells(board, a, b);
    renderBoard();
    if (immediateSpecial) {
      const cells = [];
      if (firstSpecial) cells.push(b);
      if (secondSpecial) cells.push(a);
      await activateSpecials(cells);
    } else {
      await resolveMatches(findMatchGroups(board), [b, a]);
    }
  }
  renderBoard();
  busy = false;
}

function handleTap(cell) {
  if (!running || busy) return;
  if (board[cell.row][cell.col].special) {
    selected = null;
    busy = true;
    void activateSpecials([cell]).finally(() => {
      renderBoard();
      busy = false;
    });
    return;
  }
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

boardElement.addEventListener('pointercancel', () => { pointerStart = null; });

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
  board = makePlayableBoard();
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
  renderBoard(new Map(board.flat().map((tile) => [tile.id, SIZE])));
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
  renderBoard();
  boardElement.classList.add('awakening');
  setTimeout(() => boardElement.classList.remove('awakening'), 480);
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
document.querySelector('#how-button').addEventListener('click', () => document.querySelector('#how-panel').classList.toggle('open'));

bestElement.textContent = best.toLocaleString('ko-KR');
renderBoard();
updateHud();
