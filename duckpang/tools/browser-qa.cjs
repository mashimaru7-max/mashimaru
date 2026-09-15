const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const names = ['아기오리', '흰오리', '리본오리', '탐험오리', '달빛오리'];

function matches(board) {
  for (let row = 0; row < 7; row += 1) {
    for (let col = 0; col < 7; col += 1) {
      if (col < 5 && board[row][col] === board[row][col + 1] && board[row][col] === board[row][col + 2]) return true;
      if (row < 5 && board[row][col] === board[row + 1][col] && board[row][col] === board[row + 2][col]) return true;
    }
  }
  return false;
}

function findMove(board) {
  for (let row = 0; row < 7; row += 1) {
    for (let col = 0; col < 7; col += 1) {
      for (const [dr, dc] of [[0, 1], [1, 0]]) {
        const nextRow = row + dr;
        const nextCol = col + dc;
        if (nextRow >= 7 || nextCol >= 7) continue;
        [board[row][col], board[nextRow][nextCol]] = [board[nextRow][nextCol], board[row][col]];
        const valid = matches(board);
        [board[row][col], board[nextRow][nextCol]] = [board[nextRow][nextCol], board[row][col]];
        if (valid) return [{ row, col }, { row: nextRow, col: nextCol }];
      }
    }
  }
  return null;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('http://127.0.0.1:4173', { waitUntil: 'networkidle' });
  assert.equal(await page.locator('.stage-card').count(), 5);
  await page.getByRole('button', { name: /1단계 · 오리마을/ }).click();
  assert.equal(await page.locator('.cell').count(), 49);
  await page.screenshot({ path: 'qa-start.png', fullPage: true });
  await page.getByRole('button', { name: '게임 시작' }).click();
  await page.waitForTimeout(250);

  const labels = await page.locator('.cell').evaluateAll((cells) => cells.map((cell) => cell.getAttribute('aria-label')));
  const board = labels.map((label) => names.findIndex((name) => label.endsWith(name)));
  const matrix = Array.from({ length: 7 }, (_, row) => board.slice(row * 7, row * 7 + 7));
  const move = findMove(matrix);
  assert(move, '플레이 가능한 이동을 찾지 못했습니다.');
  for (const cell of move) await page.locator(`.cell[data-row="${cell.row}"][data-col="${cell.col}"]`).click();
  await page.waitForTimeout(2400);
  const score = Number((await page.locator('#score').textContent()).replaceAll(',', ''));
  assert(score > 0, '유효 이동 뒤 점수가 증가하지 않았습니다.');
  assert.equal(await page.locator('.cell').count(), 49);
  assert.equal(errors.length, 0, errors.join('\n'));
  await page.screenshot({ path: 'qa-playing.png', fullPage: true });
  console.log(JSON.stringify({ score, cells: 49, errors: 0 }));
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
