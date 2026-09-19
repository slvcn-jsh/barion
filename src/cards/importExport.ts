import { learnerAnswer } from '@/cards/answerView';

export type CardImportFieldSeparator = 'tab' | 'comma' | 'semicolon' | 'pipe' | 'custom';

export type CardImportCardSeparator = 'newline' | 'blank-line' | 'semicolon' | 'custom';

export type CardImportSettings = {
  fieldSeparator: CardImportFieldSeparator;
  customFieldSeparator?: string;
  cardSeparator: CardImportCardSeparator;
  customCardSeparator?: string;
  firstRowIsHeader?: boolean;
  cardType?: string;
  clozeEnabled?: boolean;
};

export type CardImportPreviewRow = {
  id: string;
  rowNumber: number;
  front: string;
  back: string;
  cardType: string;
  clozeCount: number;
  generatedCardCount: number;
  status: 'ready' | 'invalid';
  issue?: string;
};

export type CardImportReadyRow = Omit<CardImportPreviewRow, 'status' | 'issue'>;

export type ImportedCardPayload = {
  prompt: string;
  answer: string;
  cardType: string;
};

const CLOZE_PATTERN = /\{\{c(\d+)::(.*?)(?:::(.*?))?\}\}/g;

export function parseCardImportText(text: string, settings: CardImportSettings): CardImportPreviewRow[] {
  const fieldSeparator = resolveFieldSeparator(settings);
  const cardSeparator = resolveCardSeparator(settings);
  const cardType = normalizeCardType(settings.cardType);
  const clozeEnabled = settings.clozeEnabled !== false;

  if (!text.trim()) {
    return [];
  }

  const ambiguousSeparators =
    settings.cardSeparator !== 'newline' &&
    settings.cardSeparator !== 'blank-line' &&
    fieldSeparator === cardSeparator;

  if (ambiguousSeparators) {
    return [
      {
        id: 'separator-error',
        rowNumber: 1,
        front: '',
        back: '',
        cardType,
        clozeCount: 0,
        generatedCardCount: 0,
        status: 'invalid',
        issue: 'Use different separators for cards and front/back.',
      },
    ];
  }

  const records = splitRecords(text, settings, fieldSeparator, cardSeparator);
  const rows = settings.firstRowIsHeader ? records.slice(1) : records;
  const offset = settings.firstRowIsHeader ? 2 : 1;

  return rows
    .slice(0, 1000)
    .map((fields, index) => toPreviewRow(fields, index + offset, cardType, clozeEnabled))
    .filter((row) => row.front || row.back || row.status === 'invalid');
}

export function buildImportedCardsForRow(row: CardImportReadyRow): ImportedCardPayload[] {
  const clozeGroups = extractClozeGroups(row.front);
  if (row.cardType === 'cloze' && clozeGroups.length) {
    const fullStatement = stripClozeMarkup(row.front);
    return clozeGroups.map((group) => ({
      prompt: `Complete: ${buildClozePrompt(row.front, group.index)}`,
      answer: row.back.trim() ? `${group.answers.join('; ')} — ${fullStatement}. ${row.back.trim()}` : group.answers.join('; '),
      cardType: 'cloze',
    }));
  }

  return [
    {
      prompt: row.front.trim(),
      answer: row.back.trim(),
      cardType: row.cardType || 'basic',
    },
  ];
}

export function exportCardsToCsv(
  rows: { prompt: string; answer: string; cardType: string; deckTitle?: string }[],
) {
  return exportCardsToDelimited(rows, ',');
}

export function exportCardsToTsv(
  rows: { prompt: string; answer: string; cardType: string; deckTitle?: string }[],
) {
  return exportCardsToDelimited(rows, '\t');
}

function exportCardsToDelimited(
  rows: { prompt: string; answer: string; cardType: string; deckTitle?: string }[],
  separator: ',' | '\t',
) {
  const header = ['Front', 'Back', 'Type', 'Deck'];
  const body = rows.map((row) => [
    row.prompt,
    learnerAnswer(row.answer),
    row.cardType,
    row.deckTitle ?? '',
  ]);
  return [header, ...body]
    .map((line) => line.map((value) => escapeDelimitedCell(value, separator)).join(separator))
    .join('\n');
}

export function stripClozeMarkup(value: string) {
  return value.replace(CLOZE_PATTERN, (_, _index: string, answer: string) => answer.trim());
}

function toPreviewRow(
  fields: string[],
  rowNumber: number,
  defaultCardType: string,
  clozeEnabled: boolean,
): CardImportPreviewRow {
  const front = (fields[0] ?? '').trim();
  const back = fields.slice(1).join(resolveDisplayJoiner(defaultCardType)).trim();
  const clozeCount = clozeEnabled ? extractClozeGroups(front).length : 0;
  const cardType = clozeCount ? 'cloze' : defaultCardType;
  const generatedCardCount = clozeCount || 1;

  if (!front) {
    return invalidRow(rowNumber, front, back, cardType, clozeCount, 'Front side is empty.');
  }

  if (!back && !clozeCount) {
    return invalidRow(rowNumber, front, back, cardType, clozeCount, 'Back side is empty.');
  }

  return {
    id: `row-${rowNumber}`,
    rowNumber,
    front,
    back,
    cardType,
    clozeCount,
    generatedCardCount,
    status: 'ready',
  };
}

function invalidRow(
  rowNumber: number,
  front: string,
  back: string,
  cardType: string,
  clozeCount: number,
  issue: string,
): CardImportPreviewRow {
  return {
    id: `row-${rowNumber}`,
    rowNumber,
    front,
    back,
    cardType,
    clozeCount,
    generatedCardCount: 0,
    status: 'invalid',
    issue,
  };
}

function splitRecords(
  text: string,
  settings: CardImportSettings,
  fieldSeparator: string,
  cardSeparator: string,
) {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  if (settings.cardSeparator === 'newline') {
    return parseDelimitedTable(normalized, fieldSeparator);
  }

  if (settings.cardSeparator === 'blank-line') {
    return normalized
      .split(/\n\s*\n+/)
      .map((record) => parseDelimitedRecord(record.replace(/\n+/g, ' ').trim(), fieldSeparator));
  }

  return splitOutsideQuotes(normalized, cardSeparator)
    .map((record) => parseDelimitedRecord(record.trim(), fieldSeparator));
}

function parseDelimitedTable(text: string, separator: string) {
  if (separator.length !== 1) {
    return text
      .split('\n')
      .map((line) => parseDelimitedRecord(line, separator));
  }

  const records: string[][] = [];
  let fields: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && char === separator) {
      fields.push(field.trim());
      field = '';
      continue;
    }

    if (!inQuotes && char === '\n') {
      fields.push(field.trim());
      if (fields.some(Boolean)) records.push(fields);
      fields = [];
      field = '';
      continue;
    }

    field += char;
  }

  fields.push(field.trim());
  if (fields.some(Boolean)) records.push(fields);
  return records;
}

function parseDelimitedRecord(record: string, separator: string) {
  if (!record.trim()) return [''];
  if (separator.length !== 1) {
    return record.split(separator).map((field) => cleanCell(field));
  }
  return splitOutsideQuotes(record, separator).map((field) => cleanCell(field));
}

function splitOutsideQuotes(value: string, separator: string) {
  const parts: string[] = [];
  let part = '';
  let inQuotes = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    const next = value[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        part += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && value.startsWith(separator, index)) {
      parts.push(part);
      part = '';
      index += separator.length - 1;
      continue;
    }

    part += char;
  }

  parts.push(part);
  return parts;
}

function extractClozeGroups(value: string) {
  const groups = new Map<number, { index: number; answers: string[]; hints: string[] }>();
  CLOZE_PATTERN.lastIndex = 0;
  let match = CLOZE_PATTERN.exec(value);
  while (match) {
    const index = Number(match[1]);
    const answer = match[2]?.trim();
    const hint = match[3]?.trim();
    if (Number.isFinite(index) && answer) {
      const group = groups.get(index) ?? { index, answers: [], hints: [] };
      group.answers.push(answer);
      if (hint) group.hints.push(hint);
      groups.set(index, group);
    }
    match = CLOZE_PATTERN.exec(value);
  }
  return [...groups.values()].sort((left, right) => left.index - right.index);
}

function buildClozePrompt(value: string, targetIndex: number) {
  CLOZE_PATTERN.lastIndex = 0;
  return value.replace(CLOZE_PATTERN, (_, index: string, answer: string, hint?: string) => {
    if (Number(index) === targetIndex) {
      return hint?.trim() ? `[${hint.trim()}]` : '[...]';
    }
    return answer.trim();
  });
}

function resolveFieldSeparator(settings: CardImportSettings) {
  if (settings.fieldSeparator === 'tab') return '\t';
  if (settings.fieldSeparator === 'comma') return ',';
  if (settings.fieldSeparator === 'semicolon') return ';';
  if (settings.fieldSeparator === 'pipe') return '|';
  return settings.customFieldSeparator || '\t';
}

function resolveCardSeparator(settings: CardImportSettings) {
  if (settings.cardSeparator === 'newline') return '\n';
  if (settings.cardSeparator === 'blank-line') return '\n\n';
  if (settings.cardSeparator === 'semicolon') return ';';
  return settings.customCardSeparator || '\n';
}

function normalizeCardType(value?: string) {
  const normalized = (value || 'basic').trim().toLowerCase().replace(/\s+/g, '-');
  return normalized || 'basic';
}

function cleanCell(value: string) {
  return value.trim().replace(/^"|"$/g, '').replace(/""/g, '"');
}

function resolveDisplayJoiner(defaultCardType: string) {
  return defaultCardType === 'cloze' ? ' ' : ', ';
}

function escapeDelimitedCell(value: string, separator: ',' | '\t') {
  const normalized = value.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!normalized.includes(separator) && !/["\n]/.test(normalized)) return normalized;
  return `"${normalized.replace(/"/g, '""')}"`;
}
