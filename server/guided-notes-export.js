// Guided Notes 匯出：由判定結果找出答案、決定每格寫入內容、產生 xlsx、寫回前重新對位。
// 全部是純函式，不連網路、不讀 session；design 第 2、3、5 節。
import ExcelJS from 'exceljs';

export class GuidedNotesExportError extends Error {
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

// 勝者由 computeResults() 決定，這裡只依 questionId + winner.rank 查出那一筆的答案
export function winningAnswers(results, submissions) {
  const answers = new Map();
  for (const result of results) {
    if (!result.winner) continue;
    const record = submissions.find((submission) => (
      submission.questionId === result.questionId && submission.rank === result.winner.rank
    ));
    if (record) answers.set(result.questionId, [...record.answers]);
  }
  return answers;
}

// 前綴在合併填答區（答案位置等於前綴格）時寫「前綴＋答案」，其他情況只寫答案；無勝者的題目不寫
export function buildCellWrites(questions, winners) {
  const writes = [];
  for (const question of questions) {
    const answers = winners.get(question.id);
    if (!answers) continue;
    question.blanks.forEach((blank, position) => {
      const answer = answers[position];
      if (answer === undefined) return;
      const value = blank.prefix && blank.answerCell === blank.anchorCell ? `${blank.prefix}${answer}` : answer;
      writes.push({ cell: blank.answerCell, value: String(value) });
    });
  }
  return writes;
}

export async function buildAnswerWorkbook({ fileBuffer, sheetName, writes }) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(fileBuffer);
  const worksheet = workbook.getWorksheet(sheetName);
  if (!worksheet) throw new GuidedNotesExportError('EXPORT_SHEET_MISSING', `原匯入檔中找不到工作表「${sheetName}」。`, 500);
  // 一律以字串寫入；exceljs 只有 { formula } 物件才會寫成公式，所以「=1+1」會是文字
  for (const { cell, value } of writes) worksheet.getCell(cell).value = String(value);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

const MODIFIED_HINT = '請重新匯入學習單後再寫回，或改用下載 xlsx。';

function modified(detail) {
  return new GuidedNotesExportError('SHEET_MODIFIED', `線上試算表的題目與匯入時不同：${detail}${MODIFIED_HINT}`, 409);
}

// imported：匯入時保存的 exportSource()；fresh：重新讀取線上試算表後的 parseGuidedNotes() 結果
export function relocateQuestions(imported, fresh) {
  const freshById = new Map(fresh.questions.map((question) => [question.id, question]));
  const importedIds = new Set(imported.questions.map(({ id }) => id));
  for (const question of imported.questions) {
    if (!freshById.has(question.id)) throw modified(`線上試算表找不到第 ${question.id} 題。`);
  }
  const extra = fresh.questions.find(({ id }) => !importedIds.has(id));
  if (extra) throw modified(`線上試算表多了第 ${extra.id} 題。`);

  let remapped = fresh.sheetName !== imported.sheetName;
  const questions = imported.questions.map((question) => {
    const current = freshById.get(question.id);
    if (current.blanks.length !== question.blanks.length) {
      throw modified(`第 ${question.id} 題的空格數由 ${question.blanks.length} 變成 ${current.blanks.length}。`);
    }
    return {
      id: question.id,
      blanks: question.blanks.map((blank, position) => {
        const { anchorCell, answerCell } = current.blanks[position];
        if (anchorCell !== blank.anchorCell || answerCell !== blank.answerCell) remapped = true;
        // 寫回過的 04 型格子會變成「（1）甲」，解析器已讀不出前綴，所以沿用匯入時的前綴
        return { index: blank.index, prefix: blank.prefix, anchorCell, answerCell };
      }),
    };
  });
  return { sheetName: fresh.sheetName, questions, remapped };
}
