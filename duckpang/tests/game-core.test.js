import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STAGE_CONFIGS,
  areAdjacent,
  calculateScore,
  clearMatches,
  collapseBoard,
  createBoard,
  expandSpecialCells,
  findMatchGroups,
  findMatches,
  findObstacleHits,
  hasPossibleMove,
  moveCreatesMatch,
  resolveSpecialCombo,
  specialKindForGroup,
  specialKindForMove,
  totalBestScore,
  unlockedStageCount,
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

test('같은 오리 2×2 정사각형을 하나의 매치로 찾는다', () => {
  const board = [
    [1, 1, 2, 3],
    [1, 1, 3, 4],
    [2, 3, 4, 0],
    [3, 4, 0, 2],
  ];
  const groups = findMatchGroups(board);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].shape, 'square');
  assert.equal(groups[0].cells.length, 4);
  assert.equal(findMatches(board).size, 4);
});

test('직선 4개와 5개를 특수 생성 가능한 그룹으로 구분한다', () => {
  const four = [
    [2, 2, 2, 2, 0],
    [0, 1, 3, 4, 1],
    [1, 3, 4, 0, 2],
    [3, 4, 0, 1, 3],
    [4, 0, 1, 3, 4],
  ];
  const five = [
    [0, 1, 2, 3, 4],
    [1, 2, 3, 4, 0],
    [3, 3, 3, 3, 3],
    [2, 3, 4, 0, 1],
    [4, 0, 1, 2, 3],
  ];
  const fourGroup = findMatchGroups(four)[0];
  const fiveGroup = findMatchGroups(five)[0];
  assert.equal(fourGroup.cells.length, 4);
  assert.equal(fourGroup.orientation, 'row');
  assert.equal(specialKindForGroup(fourGroup), 'row');
  assert.equal(fiveGroup.cells.length, 5);
  assert.equal(specialKindForGroup(fiveGroup), 'sun');
});

test('직선 4개 특수 방향은 완성 줄이 아니라 마지막 이동 방향을 따른다', () => {
  const board = [
    [0, 1, 2, 3],
    [2, 2, 2, 2],
    [1, 3, 4, 0],
    [3, 4, 0, 1],
  ];
  const group = findMatchGroups(board)[0];
  assert.equal(group.orientation, 'row');
  assert.equal(specialKindForMove(group, { row: 0, col: 2 }, { row: 1, col: 2 }), 'col');
  assert.equal(specialKindForMove(group, { row: 1, col: 3 }, { row: 1, col: 2 }), 'row');
});

test('정사각형은 프로펠러 특수로 결정한다', () => {
  const group = {
    shape: 'square',
    orientation: 'square',
    type: 1,
    cells: [{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 1, col: 0 }, { row: 1, col: 1 }],
  };
  assert.equal(specialKindForGroup(group), 'propeller');
});

test('T·L·십자 모양은 줄 특수 두 개가 아니라 폭발 특수 하나로 합친다', () => {
  const board = [
    [0, 1, 2, 3, 4],
    [1, 2, 3, 4, 0],
    [2, 2, 2, 2, 3],
    [3, 4, 2, 0, 1],
    [4, 0, 2, 1, 3],
  ];
  const groups = findMatchGroups(board);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].shape, 'junction');
  assert.equal(groups[0].cells.length, 6);
  assert.equal(specialKindForGroup(groups[0]), 'bomb');
});

test('서로 겹치지 않은 같은 색 줄은 하나의 십자 모양으로 합치지 않는다', () => {
  const board = [
    [1, 1, 1, 2, 3],
    [0, 2, 3, 4, 1],
    [1, 3, 4, 0, 2],
    [2, 4, 0, 1, 3],
    [1, 1, 1, 3, 4],
  ];
  const groups = findMatchGroups(board);
  assert.equal(groups.length, 2);
  assert(groups.every((group) => group.shape === 'line'));
});

test('객체 타일에서도 type 기준으로 매치를 찾는다', () => {
  const tile = (id, type, special = null) => ({ id, type, special });
  const board = [
    [tile(1, 0), tile(2, 0, 'row'), tile(3, 0)],
    [tile(4, 1), tile(5, 2), tile(6, 3)],
    [tile(7, 2), tile(8, 3), tile(9, 4)],
  ];
  assert.equal(findMatches(board).size, 3);
});

test('특수오리를 단독 발동하면 정해진 범위를 즉시 반환한다', () => {
  let id = 0;
  const board = Array.from({ length: 5 }, (_, row) =>
    Array.from({ length: 5 }, (_, col) => ({ id: ++id, type: (row + col) % 5, special: null })),
  );
  board[2][2].special = 'row';
  const horizontal = expandSpecialCells(board, new Set(['2,2']));
  assert.equal(horizontal.size, 5);
  assert(horizontal.has('2,0'));
  assert(!horizontal.has('0,2'));
  board[2][2].special = 'col';
  const vertical = expandSpecialCells(board, new Set(['2,2']));
  assert.equal(vertical.size, 5);
  assert(vertical.has('0,2'));
  assert(!vertical.has('2,0'));
  board[2][2].special = null;
  board[0][0].special = 'bomb';
  assert.equal(expandSpecialCells(board, new Set(['0,0'])).size, 9);
});

test('프로펠러와 TNT의 제거 범위가 서로 다르다', () => {
  let id = 0;
  const board = Array.from({ length: 7 }, (_, row) =>
    Array.from({ length: 7 }, (_, col) => ({ id: ++id, type: (row + col) % 5, special: null })),
  );
  board[3][3].special = 'propeller';
  assert.equal(expandSpecialCells(board, new Set(['3,3'])).size, 10);
  board[3][3].special = 'bomb';
  assert.equal(expandSpecialCells(board, new Set(['3,3'])).size, 25);
});

test('특수끼리 닿으면 연쇄 범위까지 함께 발동한다', () => {
  let id = 0;
  const board = Array.from({ length: 5 }, (_, row) =>
    Array.from({ length: 5 }, (_, col) => ({ id: ++id, type: (row + col) % 5, special: null })),
  );
  board[2][0].special = 'row';
  board[2][3].special = 'bomb';
  const affected = expandSpecialCells(board, new Set(['2,0']));
  assert(affected.has('1,3'));
  assert(affected.has('3,4'));
  assert(affected.size > 5);
});

test('로얄매치식 특수 결합은 개별 발동이 아닌 새로운 합성 범위를 만든다', () => {
  let id = 0;
  const makeBoard = () => Array.from({ length: 7 }, (_, row) =>
    Array.from({ length: 7 }, (_, col) => ({ id: ++id, type: (row + col) % 5, special: null })),
  );
  const cells = [{ row: 3, col: 3 }, { row: 3, col: 4 }];

  let board = makeBoard();
  board[3][3].special = 'row';
  board[3][4].special = 'col';
  let combo = resolveSpecialCombo(board, cells);
  assert.equal(combo.kind, 'rocket-rocket');
  assert.equal(combo.affected.size, 13);

  board = makeBoard();
  board[3][3].special = 'row';
  board[3][4].special = 'bomb';
  combo = resolveSpecialCombo(board, cells);
  assert.equal(combo.kind, 'rocket-bomb');
  assert.equal(combo.affected.size, 33);

  board = makeBoard();
  board[3][3].special = 'bomb';
  board[3][4].special = 'bomb';
  combo = resolveSpecialCombo(board, cells);
  assert.equal(combo.kind, 'bomb-bomb');
  assert.equal(combo.affected.size, 49);

  board = makeBoard();
  board[3][3].special = 'sun';
  board[3][4].special = 'sun';
  combo = resolveSpecialCombo(board, cells);
  assert.equal(combo.kind, 'sun-sun');
  assert.equal(combo.affected.size, 49);
});

test('프로펠러 운반과 태양 변환 조합도 조합별 전용 효과를 선택한다', () => {
  let nextId = 1000;
  const cells = [{ row: 3, col: 3 }, { row: 3, col: 4 }];
  const cases = [
    ['propeller', 'propeller', 'propeller-propeller'],
    ['propeller', 'row', 'propeller-rocket'],
    ['propeller', 'bomb', 'propeller-bomb'],
    ['sun', 'row', 'sun-rocket'],
    ['sun', 'bomb', 'sun-bomb'],
    ['sun', 'propeller', 'sun-propeller'],
  ];
  for (const [first, second, expected] of cases) {
    const board = Array.from({ length: 7 }, (_, row) =>
      Array.from({ length: 7 }, (_, col) => ({ id: ++nextId, type: (row + col) % 5, special: null })),
    );
    board[3][3].special = first;
    board[3][4].special = second;
    const combo = resolveSpecialCombo(board, cells);
    assert.equal(combo.kind, expected);
    assert(combo.affected.size > 2);
  }
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

test('5개 난이도 설정과 단계별 시간·장애물·게이지가 정확하다', () => {
  assert.equal(STAGE_CONFIGS.length, 5);
  assert.deepEqual(STAGE_CONFIGS.map((stage) => stage.seconds), [75, 60, 60, 60, 60]);
  assert.deepEqual(STAGE_CONFIGS.map((stage) => stage.water + stage.locks), [0, 4, 6, 10, 12]);
  assert.deepEqual(STAGE_CONFIGS.map((stage) => stage.legendTarget), [60, 60, 65, 70, 80]);
  assert.deepEqual(STAGE_CONFIGS.map((stage) => stage.comboWindow), [1800, 1800, 1800, 1600, 1400]);
});

test('해금은 직전 단계 최고 점수로만 결정하고 종합 점수는 단계별 최고를 합산한다', () => {
  assert.equal(unlockedStageCount([39999, 999999, 999999, 999999, 0]), 1);
  assert.equal(unlockedStageCount([40000, 65000, 90000, 120000, 0]), 5);
  assert.equal(totalBestScore([40000, 65000, 90000, 120000, 50000]), 365000);
});

test('잠긴 오리는 가능한 교환에서 제외한다', () => {
  const tile = (type, locked = false) => ({ type, locked });
  const board = [
    [tile(0), tile(1, true), tile(0)],
    [tile(2), tile(0), tile(2)],
    [tile(3), tile(0), tile(4)],
  ];
  assert.equal(hasPossibleMove(board), false);
});

test('잠금은 직접 매치로, 물방울은 인접 매치로 제거 대상이 된다', () => {
  const board = Array.from({ length: 3 }, (_, row) =>
    Array.from({ length: 3 }, (_, col) => ({ type: (row + col) % 3, locked: row === 1 && col === 1 })),
  );
  const hits = findObstacleHits(board, new Set(['0,0', '2,2']), new Set(['1,1', '0,1']));
  assert.deepEqual([...hits.locked], ['1,1']);
  assert(hits.water.has('0,0'));
  assert(!hits.water.has('2,2'));
});
