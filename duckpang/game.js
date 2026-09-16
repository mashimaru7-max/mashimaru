import {
  SIZE,
  STAGE_CONFIGS,
  TYPE_COUNT,
  areAdjacent,
  calculateScore,
  countPossibleMoves,
  createBoard,
  expandSpecialCells,
  findMatchGroups,
  findObstacleHits,
  hasPossibleMove,
  keyOf,
  resolveSpecialCombo,
  specialKindForGroup,
  specialKindForMove,
  swapCells,
  totalBestScore,
  unlockedStageCount,
} from './game-core.js?v=11';

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
const stageSelect = document.querySelector('#stage-select');
const stageList = document.querySelector('#stage-list');
const totalBestElement = document.querySelector('#total-best');
const stageLabelElement = document.querySelector('#stage-label');
const startStageName = document.querySelector('#start-stage-name');
const startStageInfo = document.querySelector('#start-stage-info');
const resultDetail = document.querySelector('#result-detail');
const legendMeter = document.querySelector('.legend-meter');
const legendButtonTitle = legendButton.querySelector('b');
const legendButtonCaption = legendButton.querySelector('small');
const legendBurst = document.querySelector('#legend-burst');
const howPanel = document.querySelector('#how-panel');
const startStageImage = startOverlay.querySelector('img');

let nextTileId = 1;
let currentStageIndex = Math.min(4, Math.max(0, Number(localStorage.getItem('duckpang-last-stage') || 1) - 1));
let currentStage = STAGE_CONFIGS[currentStageIndex];
let bests;
try {
  bests = JSON.parse(localStorage.getItem('duckpang-bests') || '[]');
} catch {
  bests = [];
}
if (!Array.isArray(bests)) bests = [];
if (!bests[0]) bests[0] = Number(localStorage.getItem('duckpang-best') || 0);
let waterCells = new Set();
let board = makePlayableBoard();
let score = 0;
let best = Number(bests[currentStageIndex]) || 0;
let comboCount = 0;
let maxCombo = 0;
let lastMatchAt = 0;
let gauge = 0;
let deadline = 0;
let timerHandle = null;
let selected = null;
let pointerStart = null;
let busy = false;
let running = false;
let legendUntil = 0;
let legendHandle = null;

function newTile(type, special = null, locked = false) {
  return { id: nextTileId++, type, special, locked };
}

function makePlayableBoard(initializeObstacles = true) {
  const lockCount = initializeObstacles ? currentStage.locks : (board?.flat().filter((tile) => tile.locked).length || 0);
  let fallback;
  let fallbackWater = new Set(waterCells);
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const next = createBoard().map((row) => row.map((type) => newTile(type)));
    const cells = Array.from({ length: SIZE * SIZE }, (_, index) => index).sort(() => Math.random() - .5);
    const nextWater = initializeObstacles
      ? new Set(cells.slice(0, currentStage.water).map((index) => keyOf(Math.floor(index / SIZE), index % SIZE)))
      : new Set(waterCells);
    const lockStart = initializeObstacles ? currentStage.water : 0;
    for (const index of cells.slice(lockStart, lockStart + lockCount)) {
      next[Math.floor(index / SIZE)][index % SIZE].locked = true;
    }
    fallback = next;
    fallbackWater = nextWater;
    if (countPossibleMoves(next) >= 3) {
      waterCells = nextWater;
      return next;
    }
  }
  waterCells = fallbackWater;
  return fallback;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function registerPlayerCombo() {
  const now = Date.now();
  comboCount = now - lastMatchAt <= currentStage.comboWindow ? comboCount + 1 : 1;
  lastMatchAt = now;
  maxCombo = Math.max(maxCombo, comboCount);
}

function isLegendActive() {
  return legendUntil > Date.now();
}

function duckImage(type) {
  const advancedSkin = currentStage.id >= 4;
  return `./assets/duck-${type + (advancedSkin ? 6 : 1)}.png`;
}

function stageFeature(stage) {
  if (stage.id === 1) return '기본 규칙 · 75초';
  if (stage.id === 2) return '물방울 4칸 · 60초';
  if (stage.id === 3) return '잠금 오리 6마리 · 60초';
  if (stage.id === 4) return '물방울 4 + 잠금 6 · 상급 외형';
  return '장애물 12 · 상급 외형';
}

function renderStageSelect() {
  const unlocked = unlockedStageCount(bests);
  totalBestElement.textContent = totalBestScore(bests).toLocaleString('ko-KR');
  stageList.innerHTML = '';
  STAGE_CONFIGS.forEach((stage, index) => {
    const locked = index >= unlocked;
    const previousBest = Number(bests[index - 1]) || 0;
    const progress = locked ? Math.min(100, Math.round((previousBest / stage.unlockScore) * 100)) : 100;
    const previewDuck = index < 3 ? index + 1 : index + 6;
    const button = document.createElement('button');
    button.className = 'stage-card';
    button.disabled = locked;
    button.style.setProperty('--stage-hue', String(205 + index * 19));
    button.innerHTML = `
      <span class="stage-art"><img src="./assets/duck-${previewDuck}.png" alt="" />${locked ? '<i>🔒</i>' : `<i>${stage.icon}</i>`}</span>
      <span class="stage-copy">
        <span class="stage-level"><b>${stage.id}단계 · ${stage.name}</b><em>${'●'.repeat(stage.id)}${'○'.repeat(5 - stage.id)}</em></span>
        <small>${locked ? `이전 단계 ${stage.unlockScore.toLocaleString('ko-KR')}점 달성 시 해금` : stageFeature(stage)}</small>
        ${locked ? `<span class="unlock-track"><i style="width:${progress}%"></i></span>` : ''}
      </span>
      <span class="stage-record"><small>BEST</small><b>${(Number(bests[index]) || 0).toLocaleString('ko-KR')}</b><em>${locked ? `${progress}%` : 'PLAY ›'}</em></span>`;
    if (!locked) button.addEventListener('click', () => selectStage(index));
    stageList.append(button);
  });
}

function selectStage(index, pushHistory = true) {
  running = false;
  clearInterval(timerHandle);
  clearInterval(legendHandle);
  legendUntil = 0;
  busy = false;
  selected = null;
  currentStageIndex = index;
  currentStage = STAGE_CONFIGS[index];
  best = Number(bests[index]) || 0;
  localStorage.setItem('duckpang-last-stage', String(currentStage.id));
  document.body.dataset.stage = String(currentStage.id);
  stageLabelElement.textContent = `${currentStage.id}단계 · ${currentStage.name}`;
  startStageName.textContent = currentStage.name;
  startStageInfo.textContent = `${currentStage.seconds}초 · ${stageFeature(currentStage)}`;
  startStageImage.src = `./assets/duck-${index < 3 ? index + 1 : index + 6}.png`;
  stageSelect.hidden = true;
  startOverlay.hidden = false;
  resultOverlay.hidden = true;
  board = makePlayableBoard();
  renderBoard();
  updateHud();
  if (pushHistory) history.pushState({ duckpang: true, view: 'intro', stage: index }, '');
}

function showHome(pushHistory = true) {
  running = false;
  clearInterval(timerHandle);
  clearInterval(legendHandle);
  legendUntil = 0;
  startOverlay.hidden = true;
  resultOverlay.hidden = true;
  renderStageSelect();
  stageSelect.hidden = false;
  updateHud();
  if (pushHistory) history.pushState({ duckpang: true, view: 'select', stage: currentStageIndex }, '');
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
  const gaugePercent = Math.min(100, (gauge / currentStage.legendTarget) * 100);
  const gaugeRounded = Math.round(gaugePercent);
  const active = isLegendActive();
  const ready = gauge >= currentStage.legendTarget && !active && running;
  gaugeFill.style.width = `${gaugePercent}%`;
  gaugeText.textContent = active
    ? `🔥 ${Math.max(0, (legendUntil - Date.now()) / 1000).toFixed(1)}초`
    : ready ? '⚡ 발동 가능!' : `${gaugeRounded}% · ${gauge}/${currentStage.legendTarget}`;
  legendButton.disabled = !ready;
  legendButton.classList.toggle('ready', ready);
  legendButton.classList.toggle('active', active);
  legendMeter.classList.toggle('ready', ready);
  legendMeter.classList.toggle('active', active);
  legendButtonTitle.textContent = active ? '전설 각성 중!' : ready ? '지금 각성!' : '전설 각성';
  legendButtonCaption.textContent = active
    ? `점수 2배 · ${Math.max(0, (legendUntil - Date.now()) / 1000).toFixed(1)}초 남음`
    : ready ? '눌러서 10초간 점수 2배!' : `${gaugeRounded}% 충전 중`;
  document.body.classList.toggle('legend-active', active);
}

function specialLabel(special) {
  return { row: '가로 로켓', col: '세로 로켓', propeller: '프로펠러', bomb: 'TNT 폭탄', sun: '태양 특수' }[special] || '';
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
      const water = waterCells.has(keyOf(row, col));
      if (water) button.classList.add('has-water');
      if (tile.locked) button.classList.add('locked');
      if (tile.special) button.classList.add(`special-${tile.special}`);
      const extraLabel = tile.special ? ` ${specialLabel(tile.special)}` : '';
      button.setAttribute('aria-label', `${row + 1}행 ${col + 1}열 ${DUCK_NAMES[tile.type]}${extraLabel}${water ? ' 물방울' : ''}${tile.locked ? ' 잠금' : ''}`);
      if (selected?.row === row && selected?.col === col) button.classList.add('selected');
      const image = document.createElement('img');
      image.src = duckImage(tile.type);
      image.alt = '';
      image.draggable = false;
      button.append(image);
      if (tile.special) {
        const badge = document.createElement('span');
        badge.className = 'special-badge';
        badge.textContent = { row: '↔', col: '↕', propeller: '✣', bomb: '💥', sun: '☀' }[tile.special];
        button.append(badge);
      }
      if (water || tile.locked) {
        const obstacle = document.createElement('span');
        obstacle.className = `obstacle-badge${water ? ' water' : ''}${tile.locked ? ' lock' : ''}`;
        obstacle.textContent = `${water ? '💧' : ''}${tile.locked ? '🔒' : ''}`;
        button.append(obstacle);
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

function playSpecialEffects(keys) {
  const boardRect = boardElement.getBoundingClientRect();
  let played = false;
  for (const key of keys) {
    const [row, col] = key.split(',').map(Number);
    const special = board[row]?.[col]?.special;
    if (!special) continue;
    const cell = cellElement({ row, col });
    if (!cell) continue;
    const rect = cell.getBoundingClientRect();
    const effect = document.createElement('span');
    effect.className = `power-effect effect-${special}`;
    effect.style.left = `${rect.left - boardRect.left + rect.width / 2}px`;
    effect.style.top = `${rect.top - boardRect.top + rect.height / 2}px`;
    if (special === 'propeller') {
      const targets = [...keys].map((targetKey) => targetKey.split(',').map(Number));
      const target = targets.sort((a, b) =>
        (Math.abs(b[0] - row) + Math.abs(b[1] - col)) - (Math.abs(a[0] - row) + Math.abs(a[1] - col)),
      )[0];
      const targetCell = target && cellElement({ row: target[0], col: target[1] });
      if (targetCell) {
        const targetRect = targetCell.getBoundingClientRect();
        effect.style.setProperty('--fly-x', `${targetRect.left - rect.left}px`);
        effect.style.setProperty('--fly-y', `${targetRect.top - rect.top}px`);
      }
    }
    effect.setAttribute('aria-hidden', 'true');
    boardElement.append(effect);
    played = true;
  }
  return played ? 460 : 0;
}

function playComboEffect(combo, cell) {
  const source = cellElement(cell);
  if (!source) return 0;
  const boardRect = boardElement.getBoundingClientRect();
  const rect = source.getBoundingClientRect();
  const effect = document.createElement('span');
  effect.className = `combo-power-effect combo-${combo.kind}`;
  effect.style.left = `${rect.left - boardRect.left + rect.width / 2}px`;
  effect.style.top = `${rect.top - boardRect.top + rect.height / 2}px`;
  effect.textContent = {
    'rocket-rocket': '↔↕',
    'rocket-bomb': '💥',
    'bomb-bomb': '💥',
    'propeller-propeller': '✣✣✣',
    'propeller-rocket': '✣➤',
    'propeller-bomb': '✣💥',
    'sun-rocket': '☀➤',
    'sun-bomb': '☀💥',
    'sun-propeller': '☀✣',
    'sun-sun': '☀☀',
  }[combo.kind] || 'SPECIAL';
  effect.setAttribute('aria-hidden', 'true');
  boardElement.append(effect);
  boardElement.classList.add('combo-flash');
  setTimeout(() => boardElement.classList.remove('combo-flash'), 600);
  return 600;
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

function applyObstacleHits(keys) {
  const hits = findObstacleHits(board, waterCells, keys);
  for (const key of hits.locked) {
    const [row, col] = key.split(',').map(Number);
    board[row][col].locked = false;
  }
  for (const key of hits.water) waterCells.delete(key);
  const removed = hits.locked.size + hits.water.size;
  return { protectedKeys: hits.locked, bonus: removed * 150, gaugeBonus: removed * 2 };
}

function chooseSpecial(group, preferredCells = [], move = null) {
  let special = specialKindForGroup(group);
  if (!special) return null;
  const inGroup = (candidate) => group.cells.some((cell) => cell.row === candidate.row && cell.col === candidate.col);
  let cell = preferredCells.find((candidate) => inGroup(candidate) && !board[candidate.row][candidate.col].special && !board[candidate.row][candidate.col].locked);
  if (!cell) cell = group.cells.find((candidate) => !board[candidate.row][candidate.col].special && !board[candidate.row][candidate.col].locked);
  if (!cell) cell = group.cells[Math.floor(group.cells.length / 2)];
  if (move && cell.row === move.to.row && cell.col === move.to.col) {
    special = specialKindForMove(group, move.from, move.to);
  }
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

async function resolveMatches(initialGroups, preferredCells = [], move = null) {
  let groups = initialGroups;
  let chain = 0;
  if (move) registerPlayerCombo();
  while (groups.length && running) {
    chain += 1;
    const activeCombo = comboCount + chain - 1;
    maxCombo = Math.max(maxCombo, activeCombo);
    comboElement.textContent = activeCombo > 1 ? `${activeCombo} COMBO!` : 'GOOD!';
    comboElement.classList.add('visible');
    const creations = groups.map((group) => chooseSpecial(group, preferredCells, move)).filter(Boolean);
    const spawnKeys = new Set(creations.map(({ cell }) => keyOf(cell.row, cell.col)));
    const matched = expandSpecialCells(board, unionCells(groups));
    for (const spawnKey of spawnKeys) matched.delete(spawnKey);
    const obstacleHit = applyObstacleHits(matched);
    const effectTime = playSpecialEffects(matched);
    if (effectTime) await wait(110);
    markCells(matched, 'matched');
    const earned = calculateScore(matched.size + creations.length, activeCombo, isLegendActive()) + obstacleHit.bonus;
    score += earned;
    gauge = Math.min(currentStage.legendTarget, gauge + matched.size + creations.length + (chain - 1) * 3 + obstacleHit.gaugeBonus);
    showBurst(earned);
    updateHud();
    await wait(Math.max(210, effectTime - 110));
    for (const key of matched) {
      const [row, col] = key.split(',').map(Number);
      if (!obstacleHit.protectedKeys.has(key)) board[row][col] = null;
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
    move = null;
  }
  await wait(60);
  comboElement.classList.remove('visible');
  if (!hasPossibleMove(board) && running) {
    comboElement.textContent = '자동 셔플!';
    comboElement.classList.add('visible');
    board = makePlayableBoard(false);
    const dropTime = renderBoard(new Map(board.flat().map((tile) => [tile.id, SIZE])));
    await wait(dropTime + 25);
    comboElement.classList.remove('visible');
  }
}

async function activateSpecials(cells) {
  registerPlayerCombo();
  const initial = new Set(cells.map((cell) => keyOf(cell.row, cell.col)));
  const combo = cells.length === 2 ? resolveSpecialCombo(board, cells) : null;
  const affected = combo?.affected || expandSpecialCells(board, initial);
  const obstacleHit = applyObstacleHits(affected);
  comboElement.textContent = combo ? 'POWER COMBO!' : 'SPECIAL!';
  comboElement.classList.add('visible');
  const effectTime = combo ? playComboEffect(combo, cells[0]) : playSpecialEffects(affected);
  if (effectTime) await wait(110);
  markCells(affected, 'matched');
  const earned = calculateScore(affected.size, comboCount + (cells.length > 1 ? 1 : 0), isLegendActive()) + obstacleHit.bonus;
  score += earned;
  gauge = Math.min(currentStage.legendTarget, gauge + affected.size + obstacleHit.gaugeBonus);
  showBurst(earned);
  updateHud();
  await wait(Math.max(230, effectTime - 110));
  for (const key of affected) {
    const [row, col] = key.split(',').map(Number);
    if (!obstacleHit.protectedKeys.has(key)) board[row][col] = null;
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
  await wait(220);
  if (!valid) {
    first.style.transform = '';
    second.style.transform = '';
    await wait(210);
  }
}

async function tryMove(a, b) {
  if (!running || busy || !areAdjacent(a, b)) return;
  busy = true;
  selected = null;
  if (board[a.row][a.col].locked || board[b.row][b.col].locked) {
    await animateSwap(a, b, false);
    renderBoard();
    markCells(new Set([keyOf(a.row, a.col), keyOf(b.row, b.col)]), 'invalid');
    await wait(120);
    busy = false;
    return;
  }
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
      await resolveMatches(findMatchGroups(board), [b, a], { from: a, to: b });
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

function startGame(pushHistory = true) {
  clearInterval(timerHandle);
  clearInterval(legendHandle);
  board = makePlayableBoard();
  score = 0;
  comboCount = 0;
  maxCombo = 0;
  lastMatchAt = 0;
  gauge = 0;
  legendUntil = 0;
  selected = null;
  busy = false;
  running = true;
  deadline = Date.now() + currentStage.seconds * 1000;
  timeElement.textContent = currentStage.seconds;
  startOverlay.hidden = true;
  resultOverlay.hidden = true;
  renderBoard(new Map(board.flat().map((tile) => [tile.id, SIZE])));
  updateHud();
  timerHandle = setInterval(tick, 100);
  if (pushHistory && history.state?.view !== 'game') {
    history.pushState({ duckpang: true, view: 'game', stage: currentStageIndex }, '');
  }
}

function endGame() {
  if (!running) return;
  running = false;
  clearInterval(timerHandle);
  clearInterval(legendHandle);
  legendUntil = 0;
  const previousBest = best;
  const unlockedBefore = unlockedStageCount(bests);
  if (score > best) {
    best = score;
    bests[currentStageIndex] = best;
    localStorage.setItem('duckpang-bests', JSON.stringify(bests));
    if (currentStageIndex === 0) localStorage.setItem('duckpang-best', String(best));
  }
  const unlockedAfter = unlockedStageCount(bests);
  finalScoreElement.textContent = score.toLocaleString('ko-KR');
  newBestElement.hidden = score <= previousBest;
  resultDetail.textContent = unlockedAfter > unlockedBefore
    ? `🎉 ${STAGE_CONFIGS[unlockedAfter - 1].name} 해금!`
    : `${currentStage.name} 최고 ${best.toLocaleString('ko-KR')}점 · 최고 ${maxCombo}콤보`;
  resultOverlay.hidden = false;
  selected = null;
  updateHud();
}

legendButton.addEventListener('click', () => {
  if (!running || gauge < currentStage.legendTarget || isLegendActive()) return;
  gauge = 0;
  legendUntil = Date.now() + LEGEND_DURATION;
  legendBurst.classList.remove('show');
  void legendBurst.offsetWidth;
  legendBurst.classList.add('show');
  legendBurst.setAttribute('aria-hidden', 'false');
  setTimeout(() => {
    legendBurst.classList.remove('show');
    legendBurst.setAttribute('aria-hidden', 'true');
  }, 1000);
  boardElement.classList.add('awakening');
  setTimeout(() => boardElement.classList.remove('awakening'), 480);
  updateHud();
  legendHandle = setInterval(() => {
    if (!isLegendActive()) {
      clearInterval(legendHandle);
      legendUntil = 0;
    }
    updateHud();
  }, 100);
});

document.querySelectorAll('[data-action="start"]').forEach((button) => button.addEventListener('click', () => startGame()));
document.querySelectorAll('[data-action="home"]').forEach((button) => button.addEventListener('click', () => showHome()));
document.querySelector('#home-button').addEventListener('click', () => showHome());
document.querySelector('#how-button').addEventListener('click', () => {
  if (howPanel.classList.contains('open')) {
    history.back();
    return;
  }
  howPanel.classList.add('open');
  history.pushState({ duckpang: true, view: 'how', stage: currentStageIndex }, '');
});

window.addEventListener('popstate', (event) => {
  if (howPanel.classList.contains('open')) {
    howPanel.classList.remove('open');
    return;
  }
  const state = event.state;
  if (!state?.duckpang) {
    showHome(false);
    history.pushState({ duckpang: true, view: 'select', stage: currentStageIndex, guard: true }, '');
    return;
  }
  const stage = Math.min(STAGE_CONFIGS.length - 1, Math.max(0, Number(state.stage) || 0));
  if (state.view === 'select') {
    showHome(false);
    if (state.root) history.pushState({ duckpang: true, view: 'select', stage, guard: true }, '');
    return;
  }
  selectStage(stage, false);
});

bestElement.textContent = best.toLocaleString('ko-KR');
renderBoard();
updateHud();
startOverlay.hidden = true;
renderStageSelect();
history.replaceState({ duckpang: true, view: 'select', stage: currentStageIndex, root: true }, '');
history.pushState({ duckpang: true, view: 'select', stage: currentStageIndex, guard: true }, '');
