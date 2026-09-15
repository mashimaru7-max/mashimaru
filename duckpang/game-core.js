export const SIZE = 7;
export const TYPE_COUNT = 5;

export const STAGE_CONFIGS = [
  { id: 1, name: '오리마을', seconds: 75, water: 0, locks: 0, legendTarget: 60, comboWindow: 1800, unlockScore: 0, icon: '🏡' },
  { id: 2, name: '구름초원', seconds: 60, water: 4, locks: 0, legendTarget: 60, comboWindow: 1800, unlockScore: 40000, icon: '☁️' },
  { id: 3, name: '별빛호수', seconds: 60, water: 0, locks: 6, legendTarget: 65, comboWindow: 1800, unlockScore: 65000, icon: '🌙' },
  { id: 4, name: '황금왕국', seconds: 60, water: 4, locks: 6, legendTarget: 70, comboWindow: 1600, unlockScore: 90000, icon: '👑' },
  { id: 5, name: '태양신전', seconds: 60, water: 6, locks: 6, legendTarget: 80, comboWindow: 1400, unlockScore: 120000, icon: '☀️' },
];

export function unlockedStageCount(bests) {
  let count = 1;
  for (let index = 1; index < STAGE_CONFIGS.length; index += 1) {
    if ((Number(bests[index - 1]) || 0) < STAGE_CONFIGS[index].unlockScore) break;
    count += 1;
  }
  return count;
}

export function totalBestScore(bests) {
  return STAGE_CONFIGS.reduce((total, _, index) => total + (Number(bests[index]) || 0), 0);
}

export function findObstacleHits(board, waterCells, affectedKeys) {
  const locked = new Set();
  const water = new Set();
  for (const key of affectedKeys) {
    const [row, col] = key.split(',').map(Number);
    if (board[row]?.[col]?.locked) locked.add(key);
  }
  for (const waterKey of waterCells) {
    const [waterRow, waterCol] = waterKey.split(',').map(Number);
    for (const key of affectedKeys) {
      const [row, col] = key.split(',').map(Number);
      if (Math.abs(row - waterRow) + Math.abs(col - waterCol) <= 1) {
        water.add(waterKey);
        break;
      }
    }
  }
  return { locked, water };
}

export function keyOf(row, col) {
  return `${row},${col}`;
}

export function cloneBoard(board) {
  return board.map((row) => [...row]);
}

export function swapCells(board, a, b) {
  const value = board[a.row][a.col];
  board[a.row][a.col] = board[b.row][b.col];
  board[b.row][b.col] = value;
}

export function areAdjacent(a, b) {
  return Math.abs(a.row - b.row) + Math.abs(a.col - b.col) === 1;
}

export function tileType(tile) {
  return typeof tile === 'object' && tile !== null ? tile.type : tile;
}

export function findMatchGroups(board) {
  const rawGroups = [];
  const size = board.length;

  for (let row = 0; row < size; row += 1) {
    let start = 0;
    for (let col = 1; col <= size; col += 1) {
      if (col < size && tileType(board[row][col]) !== null && tileType(board[row][col]) === tileType(board[row][start])) continue;
      if (tileType(board[row][start]) !== null && col - start >= 3) {
        rawGroups.push({
          shape: 'line',
          orientation: 'row',
          type: tileType(board[row][start]),
          cells: Array.from({ length: col - start }, (_, offset) => ({ row, col: start + offset })),
        });
      }
      start = col;
    }
  }

  for (let col = 0; col < size; col += 1) {
    let start = 0;
    for (let row = 1; row <= size; row += 1) {
      if (row < size && tileType(board[row][col]) !== null && tileType(board[row][col]) === tileType(board[start][col])) continue;
      if (tileType(board[start]?.[col]) !== null && row - start >= 3) {
        rawGroups.push({
          shape: 'line',
          orientation: 'col',
          type: tileType(board[start][col]),
          cells: Array.from({ length: row - start }, (_, offset) => ({ row: start + offset, col })),
        });
      }
      start = row;
    }
  }

  for (let row = 0; row < size - 1; row += 1) {
    for (let col = 0; col < size - 1; col += 1) {
      const type = tileType(board[row][col]);
      if (
        type !== null
        && tileType(board[row][col + 1]) === type
        && tileType(board[row + 1][col]) === type
        && tileType(board[row + 1][col + 1]) === type
      ) {
        rawGroups.push({
          shape: 'square',
          orientation: 'square',
          type,
          cells: [
            { row, col }, { row, col: col + 1 },
            { row: row + 1, col }, { row: row + 1, col: col + 1 },
          ],
        });
      }
    }
  }

  // 한 번의 모양을 방향별 그룹으로 쪼개 특수를 중복 생성하지 않는다.
  const merged = [];
  for (const raw of rawGroups) {
    const rawKeys = new Set(raw.cells.map((cell) => keyOf(cell.row, cell.col)));
    const touching = [];
    for (let index = 0; index < merged.length; index += 1) {
      const group = merged[index];
      if (group.type === raw.type && group.cells.some((cell) => rawKeys.has(keyOf(cell.row, cell.col)))) touching.push(index);
    }
    if (!touching.length) {
      merged.push({ ...raw, sources: [raw] });
      continue;
    }
    const sources = [raw];
    const cells = new Map(raw.cells.map((cell) => [keyOf(cell.row, cell.col), cell]));
    for (const index of touching.reverse()) {
      const group = merged.splice(index, 1)[0];
      sources.push(...group.sources);
      for (const cell of group.cells) cells.set(keyOf(cell.row, cell.col), cell);
    }
    const orientations = new Set(sources.filter((source) => source.shape === 'line').map((source) => source.orientation));
    const hasSquare = sources.some((source) => source.shape === 'square');
    merged.push({
      shape: orientations.size > 1 ? 'junction' : hasSquare && sources.length > 1 ? 'cluster' : sources[0].shape,
      orientation: orientations.size === 1 && !hasSquare ? [...orientations][0] : 'mixed',
      type: raw.type,
      cells: [...cells.values()],
      sources,
    });
  }
  return merged;
}

export function findMatches(board) {
  const matches = new Set();
  for (const group of findMatchGroups(board)) {
    for (const cell of group.cells) matches.add(keyOf(cell.row, cell.col));
  }
  return matches;
}

export function specialKindForGroup(group) {
  if (group.shape === 'square') return 'propeller';
  if (group.shape === 'junction' || group.shape === 'cluster') return 'bomb';
  if (group.cells.length >= 5) return 'sun';
  if (group.cells.length === 4) return group.orientation;
  return null;
}

export function specialKindForMove(group, from, to) {
  const special = specialKindForGroup(group);
  if ((special !== 'row' && special !== 'col') || !from || !to) return special;
  const destinationIsMatched = group.cells.some((cell) => cell.row === to.row && cell.col === to.col);
  if (!destinationIsMatched) return special;
  return from.row !== to.row ? 'col' : 'row';
}

export function expandSpecialCells(board, initialCells, skippedSpecialIds = new Set()) {
  const size = board.length;
  const expanded = new Set(initialCells);
  const queue = [...initialCells];
  const activated = new Set(skippedSpecialIds);
  const add = (row, col) => {
    if (row < 0 || row >= size || col < 0 || col >= size) return;
    const key = keyOf(row, col);
    if (!expanded.has(key)) {
      expanded.add(key);
      queue.push(key);
    }
  };

  while (queue.length) {
    const key = queue.shift();
    const [row, col] = key.split(',').map(Number);
    const tile = board[row][col];
    if (!tile?.special || activated.has(tile.id)) continue;
    activated.add(tile.id);
    if (tile.special === 'row') for (let cursor = 0; cursor < size; cursor += 1) add(row, cursor);
    if (tile.special === 'col') for (let cursor = 0; cursor < size; cursor += 1) add(cursor, col);
    if (tile.special === 'propeller') {
      for (let r = row - 1; r <= row + 1; r += 1) {
        for (let c = col - 1; c <= col + 1; c += 1) add(r, c);
      }
      const start = tile.id % (size * size);
      for (let offset = 0; offset < size * size; offset += 1) {
        const target = (start + offset) % (size * size);
        const targetKey = keyOf(Math.floor(target / size), target % size);
        if (!expanded.has(targetKey)) {
          add(Math.floor(target / size), target % size);
          break;
        }
      }
    }
    if (tile.special === 'bomb') {
      for (let r = row - 2; r <= row + 2; r += 1) {
        for (let c = col - 2; c <= col + 2; c += 1) add(r, c);
      }
    }
    if (tile.special === 'sun') {
      for (let r = 0; r < size; r += 1) {
        for (let c = 0; c < size; c += 1) if (tileType(board[r][c]) === tile.type) add(r, c);
      }
    }
  }
  return expanded;
}

function isRocket(special) {
  return special === 'row' || special === 'col';
}

export function resolveSpecialCombo(board, cells) {
  if (cells.length !== 2) return null;
  const size = board.length;
  const first = board[cells[0].row]?.[cells[0].col];
  const second = board[cells[1].row]?.[cells[1].col];
  if (!first?.special || !second?.special) return null;
  const specials = [first.special, second.special];
  const center = cells[0];
  const affected = new Set(cells.map((cell) => keyOf(cell.row, cell.col)));
  const skipped = new Set([first.id, second.id]);
  const add = (row, col) => {
    if (row >= 0 && row < size && col >= 0 && col < size) affected.add(keyOf(row, col));
  };
  const radius = (cell, amount) => {
    for (let row = cell.row - amount; row <= cell.row + amount; row += 1) {
      for (let col = cell.col - amount; col <= cell.col + amount; col += 1) add(row, col);
    }
  };
  const powerAt = (cell, special) => {
    if (special === 'row') for (let col = 0; col < size; col += 1) add(cell.row, col);
    if (special === 'col') for (let row = 0; row < size; row += 1) add(row, cell.col);
    if (special === 'bomb') radius(cell, 2);
    if (special === 'propeller') radius(cell, 1);
  };
  let kind = 'dual';

  if (specials.every((special) => special === 'sun')) {
    kind = 'sun-sun';
    for (let row = 0; row < size; row += 1) for (let col = 0; col < size; col += 1) add(row, col);
  } else if (specials.includes('sun')) {
    const other = specials.find((special) => special !== 'sun');
    kind = `sun-${isRocket(other) ? 'rocket' : other}`;
    const counts = Array(TYPE_COUNT).fill(0);
    for (const row of board) for (const tile of row) if (tile && tile.special !== 'sun') counts[tile.type] += 1;
    const targetType = counts.indexOf(Math.max(...counts));
    for (let row = 0; row < size; row += 1) {
      for (let col = 0; col < size; col += 1) if (board[row][col]?.type === targetType) powerAt({ row, col }, other);
    }
  } else if (specials.every(isRocket)) {
    kind = 'rocket-rocket';
    powerAt(center, 'row');
    powerAt(center, 'col');
  } else if (specials.includes('bomb') && specials.some(isRocket)) {
    kind = 'rocket-bomb';
    for (let offset = -1; offset <= 1; offset += 1) {
      powerAt({ row: center.row + offset, col: center.col }, 'row');
      powerAt({ row: center.row, col: center.col + offset }, 'col');
    }
  } else if (specials.every((special) => special === 'bomb')) {
    kind = 'bomb-bomb';
    radius(center, 4);
  } else if (specials.every((special) => special === 'propeller')) {
    kind = 'propeller-propeller';
    const seed = (first.id + second.id) % (size * size);
    for (let index = 0; index < 3; index += 1) {
      const target = (seed + index * 17) % (size * size);
      radius({ row: Math.floor(target / size), col: target % size }, 1);
    }
  } else if (specials.includes('propeller')) {
    const other = specials.find((special) => special !== 'propeller');
    kind = `propeller-${isRocket(other) ? 'rocket' : other}`;
    const target = { row: size - 1 - center.row, col: size - 1 - center.col };
    radius(center, 1);
    powerAt(target, other);
  }

  return { kind, affected: expandSpecialCells(board, affected, skipped) };
}

export function moveCreatesMatch(board, a, b) {
  if (!areAdjacent(a, b)) return false;
  swapCells(board, a, b);
  const valid = findMatches(board).size > 0;
  swapCells(board, a, b);
  return valid;
}

export function countPossibleMoves(board) {
  const size = board.length;
  let count = 0;
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      if (col + 1 < size && !board[row][col]?.locked && !board[row][col + 1]?.locked && moveCreatesMatch(board, { row, col }, { row, col: col + 1 })) count += 1;
      if (row + 1 < size && !board[row][col]?.locked && !board[row + 1][col]?.locked && moveCreatesMatch(board, { row, col }, { row: row + 1, col })) count += 1;
    }
  }
  return count;
}

export function hasPossibleMove(board) {
  return countPossibleMoves(board) > 0;
}

export function createBoard(size = SIZE, typeCount = TYPE_COUNT, rng = Math.random) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const board = Array.from({ length: size }, () => Array(size).fill(0));
    for (let row = 0; row < size; row += 1) {
      for (let col = 0; col < size; col += 1) {
        const banned = new Set();
        if (col >= 2 && board[row][col - 1] === board[row][col - 2]) banned.add(board[row][col - 1]);
        if (row >= 2 && board[row - 1][col] === board[row - 2][col]) banned.add(board[row - 1][col]);
        const choices = Array.from({ length: typeCount }, (_, index) => index).filter((type) => !banned.has(type));
        board[row][col] = choices[Math.floor(rng() * choices.length) % choices.length];
      }
    }
    if (findMatches(board).size === 0 && hasPossibleMove(board)) return board;
  }
  throw new Error('유효한 보드를 만들지 못했습니다.');
}

export function clearMatches(board, matches) {
  for (const key of matches) {
    const [row, col] = key.split(',').map(Number);
    board[row][col] = null;
  }
}

export function collapseBoard(board, typeCount = TYPE_COUNT, rng = Math.random) {
  const size = board.length;
  for (let col = 0; col < size; col += 1) {
    const values = [];
    for (let row = size - 1; row >= 0; row -= 1) {
      if (board[row][col] !== null) values.push(board[row][col]);
    }
    for (let row = size - 1; row >= 0; row -= 1) {
      board[row][col] = values[size - 1 - row] ?? Math.floor(rng() * typeCount) % typeCount;
    }
  }
  return board;
}

export function calculateScore(removed, chain, legendActive = false) {
  const chainMultiplier = 1 + Math.max(0, chain - 1) * 0.25;
  return Math.round(removed * 100 * chainMultiplier * (legendActive ? 2 : 1));
}
