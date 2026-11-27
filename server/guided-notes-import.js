import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';

export const MAX_GUIDED_NOTES_BYTES = 5 * 1024 * 1024;
const HEADER_TEXTS = { number: '題號', prompt: '題目', answer: '作答' };
const PREFIX_PATTERN = /^[（(]\s*\d+\s*[）)]$/;
const LINK_TIMEOUT_MS = 10_000;

export class GuidedNotesImportError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function fail(code, message, status) {
  throw new GuidedNotesImportError(code, message, status);
}

function columnName(column) {
  let name = '';
  for (let value = column; value > 0; value = Math.floor((value - 1) / 26)) {
    name = String.fromCharCode(65 + ((value - 1) % 26)) + name;
  }
  return name;
}

function address(row, column) {
  return `${columnName(column)}${row}`;
}

function parseAddress(text) {
  const match = /^([A-Z]+)(\d+)$/.exec(text);
  let column = 0;
  for (const letter of match[1]) column = column * 26 + letter.charCodeAt(0) - 64;
  return { row: Number(match[2]), column };
}

function buildMergeIndex(worksheet) {
  const index = new Map();
  for (const range of worksheet.model.merges ?? []) {
    const [start, end = start] = range.split(':');
    const from = parseAddress(start);
    const to = parseAddress(end);
    const merged = { top: from.row, left: from.column, bottom: to.row, right: to.column };
    for (let row = merged.top; row <= merged.bottom; row += 1) {
      for (let column = merged.left; column <= merged.right; column += 1) index.set(`${row},${column}`, merged);
    }
  }
  return index;
}

function valueText(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== 'object') return String(value);
  if (Array.isArray(value.richText)) return value.richText.map((part) => part.text ?? '').join('');
  if ('result' in value) return valueText(value.result);
  if ('text' in value) return valueText(value.text);
  if ('error' in value) return String(value.error);
  return '';
}

function createSheetReader(worksheet) {
  const merges = buildMergeIndex(worksheet);
  const rangeAt = (row, column) => merges.get(`${row},${column}`) ?? { top: row, left: column, bottom: row, right: column };
  const masterAddress = (row, column) => {
    const range = rangeAt(row, column);
    return address(range.top, range.left);
  };
  const textAt = (row, column) => {
    const range = rangeAt(row, column);
    return valueText(worksheet.getCell(range.top, range.left).value).trim();
  };
  const rawValueAt = (row, column) => {
    const range = rangeAt(row, column);
    return worksheet.getCell(range.top, range.left).value;
  };
  return { rangeAt, masterAddress, textAt, rawValueAt, lastRow: worksheet.rowCount, lastColumn: worksheet.columnCount };
}

function findHeader(reader) {
  for (let row = 1; row <= reader.lastRow; row += 1) {
    const found = {};
    for (let column = 1; column <= reader.lastColumn; column += 1) {
      const range = reader.rangeAt(row, column);
      if (range.top !== row || range.left !== column) continue;
      const text = reader.textAt(row, column);
      for (const [key, label] of Object.entries(HEADER_TEXTS)) {
        if (text === label && !found[key]) found[key] = range;
      }
    }
    if (found.number && found.prompt && found.answer) {
      return {
        row,
        numberColumn: found.number.left,
        promptColumn: found.prompt.left,
        answerLeft: found.answer.left,
        answerRight: found.answer.right,
      };
    }
  }
  return null;
}

function questionNumber(value) {
  const resolved = value && typeof value === 'object' && 'result' in value ? value.result : value;
  if (typeof resolved === 'number') return Number.isInteger(resolved) && resolved > 0 ? resolved : null;
  if (typeof resolved === 'string' && /^\s*\d+\s*$/.test(resolved)) {
    const number = Number(resolved.trim());
    return number > 0 ? number : null;
  }
  return null;
}

function locateBlank(reader, header, row) {
  const anchorRange = reader.rangeAt(row, header.answerLeft);
  const anchorCell = address(anchorRange.top, anchorRange.left);
  const anchorText = reader.textAt(row, header.answerLeft);
  const prefix = PREFIX_PATTERN.test(anchorText) ? anchorText : '';
  const existingContent = anchorText !== '' && prefix === '';
  const coversWholeArea = anchorRange.left <= header.answerLeft && anchorRange.right >= header.answerRight;
  if (coversWholeArea || !prefix) return { anchorCell, answerCell: anchorCell, prefix, existingContent };

  // 優先取前綴右側第一個空白格；都已有內容時（例如寫回過一次），取前綴合併範圍右側第一個起始格並提出警告，
  // 不能退回前綴格，否則第二次寫回會蓋掉前綴
  let firstRightCell = null;
  for (let column = anchorRange.right + 1; column <= header.answerRight; column += 1) {
    const range = reader.rangeAt(row, column);
    if (range.left !== column) continue;
    const cell = reader.masterAddress(row, column);
    if (reader.textAt(row, column) === '') return { anchorCell, answerCell: cell, prefix, existingContent };
    firstRightCell ??= cell;
  }
  if (firstRightCell) return { anchorCell, answerCell: firstRightCell, prefix, existingContent: true };
  return { anchorCell, answerCell: anchorCell, prefix, existingContent };
}

function readQuestions(reader, header) {
  const questions = [];
  const warnings = [];
  // 與 warnings 一一對應的結構化提醒，供前端依語言組句（add-teacher-language-switch design 第 5 節）
  const warningDetails = [];
  const seen = new Map();
  for (let row = header.row + 1; row <= reader.lastRow; row += 1) {
    const numberRange = reader.rangeAt(row, header.numberColumn);
    if (numberRange.top !== row) continue;
    const id = questionNumber(reader.rawValueAt(row, header.numberColumn));
    if (id === null) continue;
    if (seen.has(id)) {
      fail('IMPORT_DUPLICATE_NUMBER', `題號 ${id} 重複：第 ${seen.get(id)} 列與第 ${row} 列。請修正題號後重新匯入。`);
    }
    seen.set(id, row);

    const blanks = [];
    for (let blankRow = numberRange.top; blankRow <= numberRange.bottom; blankRow += 1) {
      const blank = locateBlank(reader, header, blankRow);
      const index = blanks.length + 1;
      if (blank.existingContent) {
        warnings.push(`第 ${id} 題第 ${index} 格（${blank.answerCell}）已有內容，匯出時會被取代。`);
        warningDetails.push({ code: 'ANSWER_CELL_NOT_EMPTY', questionId: id, blankIndex: index, cell: blank.answerCell });
      }
      blanks.push({
        index,
        prefix: blank.prefix,
        prompt: reader.textAt(blankRow, header.promptColumn),
        anchorCell: blank.anchorCell,
        answerCell: blank.answerCell,
      });
    }
    const prompt = blanks.map((blank) => blank.prompt).filter(Boolean).join('\n');
    questions.push({ id, prompt, blanks });
    row = numberRange.bottom;
  }
  return { questions, warnings, warningDetails };
}

function isZip(buffer) {
  return buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04;
}

export async function parseGuidedNotes(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) fail('IMPORT_INVALID_FILE', '沒有收到檔案內容，請重新選擇 xlsx 檔。');
  if (buffer.length > MAX_GUIDED_NOTES_BYTES) fail('IMPORT_FILE_TOO_LARGE', '檔案超過 5 MiB 上限。', 413);
  if (!isZip(buffer)) fail('IMPORT_INVALID_FILE', '檔案不是 xlsx 格式，請另存為 .xlsx 後重新匯入。');

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch {
    fail('IMPORT_INVALID_FILE', '無法讀取這個 xlsx 檔，檔案可能已損壞。');
  }

  let sawHeader = false;
  for (const worksheet of workbook.worksheets) {
    const reader = createSheetReader(worksheet);
    const header = findHeader(reader);
    if (!header) continue;
    sawHeader = true;
    const { questions, warnings, warningDetails } = readQuestions(reader, header);
    if (questions.length === 0) continue;
    return { sheetName: worksheet.name, headerRow: header.row, questions, warnings, warningDetails };
  }
  if (sawHeader) fail('IMPORT_NO_QUESTIONS', '找到「題號／題目／作答」表頭，但表頭下方沒有任何數字題號。');
  fail('IMPORT_NO_HEADER', '找不到同一列包含「題號」「題目」「作答」的表頭列，請確認欄位名稱後重新匯入。');
}

function toPublicQuestions(questions) {
  return questions.map((question) => ({
    id: question.id,
    prompt: question.prompt,
    blanks: question.blanks.map(({ index, prefix, prompt }) => ({ index, prefix, prompt })),
  }));
}

function summarize(entry) {
  return {
    source: { ...entry.source },
    sheetName: entry.sheetName,
    headerRow: entry.headerRow,
    questionCount: entry.questions.length,
    blankCount: entry.questions.reduce((total, question) => total + question.blanks.length, 0),
    questions: entry.questions.map((question) => ({
      id: question.id,
      type: question.blanks.length > 1 ? 'group' : 'single',
      blankCount: question.blanks.length,
      prefixes: question.blanks.map((blank) => blank.prefix),
    })),
    warnings: [...entry.warnings],
    warningDetails: (entry.warningDetails ?? []).map((detail) => ({ ...detail })),
  };
}

export function createGuidedNotesImport() {
  let pending = null;
  let current = null;

  return {
    // target：連結來源為 { spreadsheetId }，上傳來源為 null。不放進 source，避免 summarize() 把它帶進老師摘要
    createPreview({ parsed, source, fileBuffer, replacesExisting, target = null }) {
      pending = { ...parsed, source, fileBuffer, target: target ? { ...target } : null, previewId: randomUUID() };
      return { previewId: pending.previewId, ...summarize(pending), replacesExisting: Boolean(replacesExisting) };
    },
    confirm(previewId) {
      if (!pending || typeof previewId !== 'string' || pending.previewId !== previewId) {
        fail('IMPORT_PREVIEW_EXPIRED', '這份匯入摘要已過期，請以最新的摘要確認，或重新匯入。', 409);
      }
      current = { ...pending, importedAt: new Date().toISOString() };
      pending = null;
      return { questions: toPublicQuestions(current.questions), summary: this.currentSummary() };
    },
    currentSummary() {
      return current ? { ...summarize(current), importedAt: current.importedAt } : null;
    },
    exportSource() {
      if (!current) return null;
      return {
        fileBuffer: current.fileBuffer,
        sheetName: current.sheetName,
        target: current.target ? { ...current.target } : null,
        questions: current.questions.map((question) => ({
          id: question.id,
          blanks: question.blanks.map(({ index, prefix, anchorCell, answerCell }) => ({ index, prefix, anchorCell, answerCell })),
        })),
      };
    },
  };
}

export function toGoogleSheetsExportUrl(input) {
  let url;
  try {
    url = new URL(String(input ?? '').trim());
  } catch {
    fail('IMPORT_INVALID_LINK', '請貼上 Google 試算表的連結（https://docs.google.com/spreadsheets/d/...）。');
  }
  const match = /^\/spreadsheets\/d\/([A-Za-z0-9_-]{10,})(?:\/|$)/.exec(url.pathname);
  if (url.protocol !== 'https:' || url.hostname !== 'docs.google.com' || !match) {
    fail('IMPORT_INVALID_LINK', '只接受 Google 試算表的連結（https://docs.google.com/spreadsheets/d/...）。');
  }
  return { id: match[1], exportUrl: `https://docs.google.com/spreadsheets/d/${match[1]}/export?format=xlsx` };
}

function fileNameFromDisposition(header) {
  if (!header) return '';
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (encoded) {
    try {
      return decodeURIComponent(encoded[1]);
    } catch {
      return '';
    }
  }
  return /filename="([^"]+)"/i.exec(header)?.[1] ?? '';
}

async function readLimited(body, maxBytes) {
  const chunks = [];
  let total = 0;
  for await (const chunk of body) {
    total += chunk.length;
    if (total > maxBytes) fail('IMPORT_FILE_TOO_LARGE', '試算表超過 5 MiB 上限。', 413);
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export async function downloadGuidedNotes(link, { fetchImpl = fetch, timeoutMs = LINK_TIMEOUT_MS, maxBytes = MAX_GUIDED_NOTES_BYTES } = {}) {
  const { id, exportUrl } = toGoogleSheetsExportUrl(link);
  const unreachable = '無法下載這份試算表。請確認已設為「知道連結者可檢視」，或改用上傳 xlsx。';
  let buffer;
  let response;
  try {
    response = await fetchImpl(exportUrl, { redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok || !response.body) fail('IMPORT_LINK_UNREACHABLE', unreachable, 502);
    buffer = await readLimited(response.body, maxBytes);
  } catch (error) {
    if (error instanceof GuidedNotesImportError) throw error;
    fail('IMPORT_LINK_UNREACHABLE', unreachable, 502);
  }
  if (!isZip(buffer)) fail('IMPORT_LINK_UNREACHABLE', unreachable, 502);
  const name = fileNameFromDisposition(response.headers.get('content-disposition')) || `Google 試算表 ${id}`;
  return { buffer, name, spreadsheetId: id };
}
