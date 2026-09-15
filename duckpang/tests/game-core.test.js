import test from 'node:test';
import assert from 'node:assert/strict';
import {
  areAdjacent,
  calculateScore,
  clearMatches,
  collapseBoard,
  createBoard,
  findMatches,
  hasPossibleMove,
  moveCreatesMatch,
} from '../game-core.js';

test('가로·세로·교차 매치를 중복 없이 찾는다', () => {
  const board = [
    [1, 1, 1, 2, 3],
    [0, 2, 1, 3, 4],
    [2, 2, 1, 2, 0],
    [3, 4, 1, 0, 2],
    [4, 0, 1, 2, 3],
  ];
  const matches = findMatches(board);
  assert.equal(matches.size, 7);
  assert(matches.has('0,0'));
  assert(matches.has('4,2'));
});

test('인접 여부를 상하좌우만 허용한다', () => {
  assert.equal(areAdjacent({ row: 1, col: 1 }, { row: 1, col: 2 }), true);
  assert.equal(areAdjacent({ row: 1, col: 1 }, { row: 2, col: 2 }), false);
});

test('유효한 교환만 매치로 인정한다', () => {
  const board = [
    [0, 1, 0],
    [2, 0, 2],
    [3, 0, 4],
  ];
  assert.equal(moveCreatesMatch(board, { row: 0, col: 1 }, { row: 1, col: 1 }), true);
  assert.equal(moveCreatesMatch(board, { row: 1, col: 0 }, { row: 1, col: 1 }), false);
});

test('생성 보드는 즉시 매치가 없고 가능한 이동이 있다', () => {
  for (let seed = 1; seed <= 100; seed += 1) {
    let value = seed;
    const rng = () => {
      value = (value * 16807) % 2147483647;
      return value / 2147483647;
    };
    const board = createBoard(7, 5, rng);
    assert.equal(findMatches(board).size, 0);
    assert.equal(hasPossibleMove(board), true);
  }
});

test('제거 후 각 열이 아래로 내려오고 빈칸이 채워진다', () => {
  const board = [
    [0, 1, 2],
    [3, 4, 0],
    [1, 2, 3],
  ];
  clearMatches(board, new Set(['1,0', '2,0']));
  collapseBoard(board, 5, () => 0.8);
  assert.deepEqual(board.map((row) => row[0]), [4, 4, 0]);
});

test('연쇄와 각성 배율이 점수에 반영된다', () => {
  assert.equal(calculateScore(3, 1, false), 300);
  assert.equal(calculateScore(4, 2, false), 500);
  assert.equal(calculateScore(4, 2, true), 1000);
});
