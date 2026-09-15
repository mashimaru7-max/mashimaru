export const SIZE = 7;
export const TYPE_COUNT = 5;

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

export function findMatches(board) {
  const matches = new Set();
  const size = board.length;

  for (let row = 0; row < size; row += 1) {
    let start = 0;
    for (let col = 1; col <= size; col += 1) {
      if (col < size && board[row][col] !== null && board[row][col] === board[row][start]) continue;
      if (board[row][start] !== null && col - start >= 3) {
        for (let cursor = start; cursor < col; cursor += 1) matches.add(keyOf(row, cursor));
      }
      start = col;
    }
  }

  for (let col = 0; col < size; col += 1) {
    let start = 0;
    for (let row = 1; row <= size; row += 1) {
      if (row < size && board[row][col] !== null && board[row][col] === board[start][col]) continue;
      if (board[start]?.[col] !== null && row - start >= 3) {
        for (let cursor = start; cursor < row; cursor += 1) matches.add(keyOf(cursor, col));
      }
      start = row;
    }
  }

  return matches;
}

export function moveCreatesMatch(board, a, b) {
  if (!areAdjacent(a, b)) return false;
  swapCells(board, a, b);
  const valid = findMatches(board).size > 0;
  swapCells(board, a, b);
  return valid;
}

export function hasPossibleMove(board) {
  const size = board.length;
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      if (col + 1 < size && moveCreatesMatch(board, { row, col }, { row, col: col + 1 })) return true;
      if (row + 1 < size && moveCreatesMatch(board, { row, col }, { row: row + 1, col })) return true;
    }
  }
  return false;
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
