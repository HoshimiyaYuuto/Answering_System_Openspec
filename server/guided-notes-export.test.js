import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import ExcelJS from 'exceljs';
import {
  buildAnswerWorkbook,
  buildCellWrites,
  GuidedNotesExportError,
  relocateQuestions,
  winningAnswers,
} from './guided-notes-export.js';
import { parseGuidedNotes } from './guided-notes-import.js';
import { computeResults } from './results.js';

const fixtureDirectory = new URL('../fixtures/guided-notes/', import.meta.url);
const fixture = (name) => readFile(new URL(name, fixtureDirectory));

function record(questionId, groupId, rank, answers, status = 'valid') {
  return { questionId, groupId, answers, submittedAt: '2026-11-22T00:00:00.000Z', rank, status };
}

function winnersFor(questions, submissions) {
  return winningAnswers(computeResults({ questions, submissions }), submissions);
}

async function readSheet(buffer, sheetName) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  return workbook.getWorksheet(sheetName);
}

// 匯入時保存的形狀（與 exportSource() 相同）
function importedShape(parsed) {
  return {
    sheetName: parsed.sheetName,
    questions: parsed.questions.map(({ id, blanks }) => ({
      id,
      blanks: blanks.map(({ index, prefix, anchorCell, answerCell }) => ({ index, prefix, anchorCell, answerCell })),
    })),
  };
}

test('the lowest valid rank wins and its answers are used', () => {
  const questions = [{ id: 1, blanks: [{}] }, { id: 2, blanks: [{}] }];
  const winners = winnersFor(questions, [record(1, 2, 2, ['乙']), record(1, 1, 1, ['甲'])]);
  assert.deepEqual([...winners], [[1, ['甲']]]);
});

test('a voided first submission gives way to rank 2', () => {
  const questions = [{ id: 1, blanks: [{}] }];
  const winners = winnersFor(questions, [record(1, 1, 1, ['作廢'], 'voided'), record(1, 2, 2, ['乙'])]);
  assert.deepEqual(winners.get(1), ['乙']);
});

test('questions without a winner produce no writes', () => {
  const questions = [{ id: 3, blanks: [{ index: 1, prefix: '', anchorCell: 'G5', answerCell: 'G5' }] }];
  assert.deepEqual(buildCellWrites(questions, winnersFor(questions, [])), []);
});

test('02 group answers go to H5 and H6 while G5 and G6 keep their prefixes', async () => {
  const fileBuffer = await fixture('02-official-group.xlsx');
  const parsed = await parseGuidedNotes(fileBuffer);
  const writes = buildCellWrites(parsed.questions, new Map([[1, ['甲', '乙']]]));
  assert.deepEqual(writes, [{ cell: 'H5', value: '甲' }, { cell: 'H6', value: '乙' }]);

  const sheet = await readSheet(await buildAnswerWorkbook({ fileBuffer, sheetName: parsed.sheetName, writes }), parsed.sheetName);
  assert.equal(sheet.getCell('H5').value, '甲');
  assert.equal(sheet.getCell('H6').value, '乙');
  assert.equal(sheet.getCell('G5').value, '（1）');
  assert.equal(sheet.getCell('G6').value, '（2）');
});

test('04 prefixes inside the merged answer area are written together with the answer', async () => {
  const parsed = await parseGuidedNotes(await fixture('04-mixed-groups.xlsx'));
  const writes = buildCellWrites(parsed.questions, new Map([[parsed.questions[1].id, ['甲', '乙', '丙']]]));
  assert.deepEqual(writes, [
    { cell: 'G7', value: '（1）甲' },
    { cell: 'G8', value: '（2）乙' },
    { cell: 'G9', value: '（3）丙' },
  ]);
});

test('01 single answers go to G5 and formula-like answers stay text', async () => {
  const fileBuffer = await fixture('01-official-single.xlsx');
  const parsed = await parseGuidedNotes(fileBuffer);
  const writes = buildCellWrites(parsed.questions, new Map([[1, ['光合作用']], [2, ['=1+1']]]));
  assert.equal(writes[0].cell, 'G5');
  const output = await buildAnswerWorkbook({ fileBuffer, sheetName: parsed.sheetName, writes });
  const sheet = await readSheet(output, parsed.sheetName);
  const original = await readSheet(fileBuffer, parsed.sheetName);
  assert.equal(sheet.getCell('G5').value, '光合作用');
  const formulaCell = sheet.getCell(writes[1].cell);
  assert.equal(formulaCell.value, '=1+1');
  assert.equal(formulaCell.type, ExcelJS.ValueType.String);
  // 沒有寫入的題目維持原內容
  const untouched = parsed.questions[2].blanks[0].answerCell;
  assert.deepEqual(sheet.getCell(untouched).value, original.getCell(untouched).value);
});

test('a missing worksheet is reported', async () => {
  await assert.rejects(
    buildAnswerWorkbook({ fileBuffer: await fixture('01-official-single.xlsx'), sheetName: '不存在', writes: [] }),
    (error) => error instanceof GuidedNotesExportError && error.code === 'EXPORT_SHEET_MISSING',
  );
});

// 3.2 重新對位
async function sheetBuffer(build) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('學習單');
  build(sheet);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

// 表頭在第 4 列：E 題號、F 題目、G:H 作答。第 1、3 題是單題（G:H 合併），第 2 題是前綴在 G、答案在 H 的題組
function layout(sheet, { offset = 0, number3 = 3, extraBlank = false } = {}) {
  const row = (n) => n + offset;
  const set = (cell, value) => { sheet.getCell(cell).value = value; };
  set(`E${row(4)}`, '題號');
  set(`F${row(4)}`, '題目');
  set(`G${row(4)}`, '作答');
  sheet.mergeCells(`G${row(4)}:H${row(4)}`);
  set(`E${row(5)}`, 1);
  set(`F${row(5)}`, '第一題');
  sheet.mergeCells(`G${row(5)}:H${row(5)}`);
  set(`E${row(6)}`, 2);
  sheet.mergeCells(`E${row(6)}:E${row(7)}`);
  set(`F${row(6)}`, '第二題第一空');
  set(`G${row(6)}`, '（1）');
  set(`F${row(7)}`, '第二題第二空');
  set(`G${row(7)}`, '（2）');
  set(`E${row(8)}`, number3);
  set(`F${row(8)}`, '第三題');
  if (extraBlank) {
    sheet.mergeCells(`E${row(8)}:E${row(9)}`);
    set(`F${row(9)}`, '第三題第二空');
  } else {
    sheet.mergeCells(`G${row(8)}:H${row(8)}`);
  }
}

test('unchanged layout keeps the imported cells', async () => {
  const imported = importedShape(await parseGuidedNotes(await sheetBuffer((sheet) => layout(sheet))));
  const fresh = await parseGuidedNotes(await sheetBuffer((sheet) => layout(sheet)));
  const relocated = relocateQuestions(imported, fresh);
  assert.equal(relocated.remapped, false);
  assert.deepEqual(relocated.questions, imported.questions);
});

test('a row inserted after import moves every answer cell down and marks remapped', async () => {
  const imported = importedShape(await parseGuidedNotes(await sheetBuffer((sheet) => layout(sheet))));
  const fresh = await parseGuidedNotes(await sheetBuffer((sheet) => layout(sheet, { offset: 1 })));
  const relocated = relocateQuestions(imported, fresh);
  assert.equal(relocated.remapped, true);
  assert.equal(relocated.questions[0].blanks[0].answerCell, 'G6');
  assert.deepEqual(relocated.questions[1].blanks.map(({ answerCell }) => answerCell), ['H7', 'H8']);
  assert.deepEqual(relocated.questions[1].blanks.map(({ prefix }) => prefix), ['（1）', '（2）']);
});

test('a changed question number is refused with SHEET_MODIFIED', async () => {
  const imported = importedShape(await parseGuidedNotes(await sheetBuffer((sheet) => layout(sheet))));
  const fresh = await parseGuidedNotes(await sheetBuffer((sheet) => layout(sheet, { number3: 30 })));
  assert.throws(
    () => relocateQuestions(imported, fresh),
    (error) => error instanceof GuidedNotesExportError && error.code === 'SHEET_MODIFIED' && error.status === 409 && /第 3 題/.test(error.message),
  );
});

test('a changed blank count is refused with SHEET_MODIFIED', async () => {
  const imported = importedShape(await parseGuidedNotes(await sheetBuffer((sheet) => layout(sheet))));
  const fresh = await parseGuidedNotes(await sheetBuffer((sheet) => layout(sheet, { extraBlank: true })));
  assert.throws(
    () => relocateQuestions(imported, fresh),
    (error) => error.code === 'SHEET_MODIFIED' && /第 3 題的空格數由 1 變成 2/.test(error.message),
  );
});

test('a sheet that was already written back relocates to the same cells with the imported prefixes', async () => {
  for (const [name, questionIndex, answers] of [['02-official-group.xlsx', 0, ['甲', '乙']], ['04-mixed-groups.xlsx', 1, ['甲', '乙', '丙']]]) {
    const fileBuffer = await fixture(name);
    const parsed = await parseGuidedNotes(fileBuffer);
    const imported = importedShape(parsed);
    const question = parsed.questions[questionIndex];
    const writes = buildCellWrites(parsed.questions, new Map([[question.id, answers]]));
    const written = await buildAnswerWorkbook({ fileBuffer, sheetName: parsed.sheetName, writes });

    const relocated = relocateQuestions(imported, await parseGuidedNotes(written));
    assert.equal(relocated.remapped, false, name);
    assert.deepEqual(relocated.questions, imported.questions, name);
    assert.deepEqual(buildCellWrites(relocated.questions, new Map([[question.id, answers]])), writes, name);
  }
});
