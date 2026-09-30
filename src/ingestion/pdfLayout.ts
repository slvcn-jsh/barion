export type PdfLayoutTextItem = {
  str?: string;
  hasEOL?: boolean;
  width?: number;
  height?: number;
  fontName?: string;
  transform?: number[];
};

type PositionedItem = {
  text: string;
  x: number;
  y: number;
  size: number;
  width: number;
  bold: boolean;
  hasEOL: boolean;
};

type TableColumn = {
  label: string;
  x: number;
  minY: number;
  maxY: number;
};

type TextLine = {
  y: number;
  items: PositionedItem[];
  text: string;
};

const TABLE_LABELS = [
  { pattern: /^methods?$/i, label: 'Method' },
  { pattern: /^(?:description|what\s+it\s+is)$/i, label: 'Description' },
  { pattern: /^(?:how\s+it\s+works|mechanism)$/i, label: 'How it works' },
  { pattern: /^(?:how\s+it\s+is\s+used|how\s+to\s+use|use)$/i, label: 'How it is used' },
  { pattern: /^(?:effectiveness|efficacy)$/i, label: 'Effectiveness' },
  { pattern: /^(?:advantages?|benefits?)$/i, label: 'Advantages' },
  { pattern: /^(?:disadvantages?|possible\s+side[\s-]*effects?|side[\s-]*effects?|risks?)$/i, label: 'Disadvantages' },
  { pattern: /^(?:availability|where\s+(?:available|to\s+get)|where\s+obtained)$/i, label: 'Availability' },
];

export function structurePdfText(items: PdfLayoutTextItem[]) {
  const positioned = positionItems(items);
  if (!positioned.length) return '';
  const bodySize = median(positioned.map((item) => item.size)) || 11;
  const lines = groupIntoLines(positioned, bodySize);
  const table = detectTable(lines, bodySize);
  if (table) {
    const reconstructed = reconstructTable(lines, table.columns, table.headerMinY, table.headerMaxY, bodySize);
    if (reconstructed) return reconstructed;
  }
  return reconstructReadingOrder(lines, bodySize);
}

function positionItems(items: PdfLayoutTextItem[]): PositionedItem[] {
  return items.flatMap((item): PositionedItem[] => {
    const text = item.str?.replace(/\s+/g, ' ').trim();
    const x = item.transform?.[4];
    const y = item.transform?.[5];
    if (!text || !Number.isFinite(x) || !Number.isFinite(y)) return [];
    const size = Math.abs(item.height ?? item.transform?.[3] ?? 11) || 11;
    return [{
      text,
      x: Number(x),
      y: Number(y),
      size,
      width: Math.max(Number(item.width ?? 0), text.length * size * 0.35),
      bold: /bold|black|semibold|demi/i.test(item.fontName ?? ''),
      hasEOL: Boolean(item.hasEOL),
    }];
  });
}

function groupIntoLines(items: PositionedItem[], bodySize: number): TextLine[] {
  const tolerance = Math.max(2, bodySize * 0.38);
  const sorted = [...items].sort((left, right) => right.y - left.y || left.x - right.x);
  const lines: TextLine[] = [];
  for (const item of sorted) {
    const line = lines.find((candidate) => Math.abs(candidate.y - item.y) <= tolerance);
    if (line) {
      line.items.push(item);
      line.y = line.items.reduce((total, current) => total + current.y, 0) / line.items.length;
    } else {
      lines.push({ y: item.y, items: [item], text: '' });
    }
  }
  return lines
    .sort((left, right) => right.y - left.y)
    .map((line) => {
      const lineItems = line.items.sort((left, right) => left.x - right.x);
      return { ...line, items: lineItems, text: joinItems(lineItems) };
    });
}

function detectTable(lines: TextLine[], bodySize: number) {
  const verticalTolerance = Math.max(8, bodySize * 2.8);
  const documentMinX = Math.min(...lines.flatMap((line) => line.items.map((item) => item.x)));

  for (const line of lines) {
    const bandLines = lines.filter((other) => Math.abs(other.y - line.y) <= verticalTolerance);
    const bandItems = bandLines.flatMap((l) => l.items);

    const columns = extractColumnsFromItems(bandItems, bodySize);
    const uniqueColumns = dedupeColumns(columns).sort((left, right) => left.x - right.x);

    if (uniqueColumns.length >= 2 && bandItems.some((item) => item.size >= bodySize || item.bold)) {
      if (uniqueColumns[0]?.label !== 'Method') {
        uniqueColumns.unshift({
          label: 'Method',
          x: documentMinX,
          minY: Math.min(...uniqueColumns.map((column) => column.minY)),
          maxY: Math.max(...uniqueColumns.map((column) => column.maxY)),
        });
      }
      const headerMinY = Math.min(...uniqueColumns.map((column) => column.minY));
      const headerMaxY = Math.max(...uniqueColumns.map((column) => column.maxY));
      return { columns: uniqueColumns, headerMinY, headerMaxY };
    }
  }
  return null;
}

function extractColumnsFromItems(items: PositionedItem[], bodySize: number): TableColumn[] {
  const sorted = [...items].sort((left, right) => left.x - right.x || right.y - left.y);
  const columns: TableColumn[] = [];
  let i = 0;
  while (i < sorted.length) {
    let bestMatch: { label: string; x: number; count: number; minY: number; maxY: number } | null = null;
    let accumulatedText = '';
    for (let count = 1; count <= 5 && i + count <= sorted.length; count++) {
      const currentItem = sorted[i + count - 1];
      if (count > 1) {
        const prevItem = sorted[i + count - 2];
        const horizontalGap = currentItem.x - (prevItem.x + prevItem.width);
        const xOffset = Math.abs(currentItem.x - prevItem.x);
        if (horizontalGap > bodySize * 6.0 && xOffset > bodySize * 4.0) {
          break;
        }
      }
      accumulatedText = count === 1 ? currentItem.text : `${accumulatedText} ${currentItem.text}`;
      const normalized = accumulatedText.replace(/\s+/g, ' ').trim();
      const known = TABLE_LABELS.find(({ pattern }) => pattern.test(normalized));
      if (known) {
        const matchedItems = sorted.slice(i, i + count);
        bestMatch = {
          label: known.label,
          x: Math.min(...matchedItems.map((item) => item.x)),
          count,
          minY: Math.min(...matchedItems.map((item) => item.y)),
          maxY: Math.max(...matchedItems.map((item) => item.y)),
        };
      }
    }
    if (bestMatch) {
      columns.push({
        label: bestMatch.label,
        x: bestMatch.x,
        minY: bestMatch.minY,
        maxY: bestMatch.maxY,
      });
      i += bestMatch.count;
    } else {
      i++;
    }
  }
  return columns;
}

function reconstructTable(
  lines: TextLine[],
  columns: TableColumn[],
  headerMinY: number,
  headerMaxY: number,
  bodySize: number,
) {
  const bodyLines = lines.filter((line) => line.y < headerMinY - bodySize * 0.5);
  const firstColumnEnd = columns[1]?.x ?? Number.POSITIVE_INFINITY;
  const firstColumnLines = bodyLines
    .map((line) => ({
      line,
      items: line.items.filter((item) => item.x < firstColumnEnd - bodySize * 0.25),
    }))
    .filter(({ items }) => items.length)
    .map(({ line, items }) => ({ ...line, items, text: joinItems(items) }));
  const anchors = mergeMethodAnchors(
    firstColumnLines.filter((line) => isMethodAnchor(line, bodySize)),
    bodySize,
  );
  if (anchors.length < 2) return '';

  const prefix = reconstructReadingOrder(lines.filter((line) => line.y > headerMaxY + bodySize * 0.5), bodySize);
  const rows = anchors.map((anchor, index) => {
    const nextY = anchors[index + 1]?.y ?? Number.NEGATIVE_INFINITY;
    const rowItems = bodyLines
      .filter((line) => line.y <= anchor.y + bodySize * 0.5 && line.y > nextY + bodySize * 0.5)
      .flatMap((line) => line.items);
    const cells = columns.map((column, columnIndex) => {
      const nextX = columns[columnIndex + 1]?.x ?? Number.POSITIVE_INFINITY;
      const cellItems = rowItems.filter((item) => item.x >= column.x - bodySize * 0.35 && item.x < nextX - bodySize * 0.2);
      return { label: column.label, text: cellText(cellItems, bodySize) };
    });
    const method = anchor.text.replace(/^#+\s*/, '').trim();
    const fields = cells
      .filter((cell) => cell.label !== 'Method' && cell.text)
      .map((cell) => `${cell.label}: ${cell.text}`);
    const methodCell = cells.find((cell) => cell.label === 'Method')?.text ?? '';
    const availability = methodCell.replace(method, '').replace(/^\s*[:\-]?\s*/, '').trim();
    if (availability) fields.unshift(`Availability: ${availability}`);
    return `# ${method}\n\n${fields.join('\n\n')}`.trim();
  });
  return [prefix, rows.join('\n\n')].filter(Boolean).join('\n\n');
}

function isMethodAnchor(line: TextLine, bodySize: number) {
  const text = line.text.trim();
  const words = text.split(/\s+/).filter(Boolean);
  if (!text || text.length > 100 || words.length > 10) return false;
  if (/^(available|schedule|if interested|talk with|university|page\s+\d+|call\b)/i.test(text)) return false;
  if (/^(method|how it|effectiveness|advantages?|disadvantages?)$/i.test(text)) return false;
  if (/[!?]$/.test(text) || /:\s+\S/.test(text)) return false;
  const titleLike = line.items.some((item) => item.bold || item.size >= bodySize * 1.08)
    || /^[A-Z0-9][A-Z0-9.()&\-\s]+$/.test(text);
  return titleLike;
}

function mergeMethodAnchors(lines: TextLine[], bodySize: number) {
  const sorted = [...lines].sort((left, right) => right.y - left.y);
  const anchors: TextLine[] = [];
  for (const line of sorted) {
    const previous = anchors.at(-1);
    const gap = previous ? previous.y - line.y : Number.POSITIVE_INFINITY;
    const continuation = previous
      && gap > 0
      && gap <= bodySize * 1.65
      && (line.text.startsWith('(') || (previous.text.split(/\s+/).length + line.text.split(/\s+/).length <= 10));
    if (continuation) {
      previous.text = `${previous.text} ${line.text}`.replace(/\s+/g, ' ').trim();
      previous.items.push(...line.items);
    } else {
      anchors.push({ ...line, items: [...line.items] });
    }
  }
  return anchors;
}

function cellText(items: PositionedItem[], bodySize: number) {
  if (!items.length) return '';
  return groupIntoLines(items, bodySize)
    .map((line) => line.text)
    .filter((line) => !isPageNoise(line))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function reconstructReadingOrder(lines: TextLine[], bodySize: number) {
  let output = '';
  let previousY: number | undefined;
  for (const line of lines) {
    if (isPageNoise(line.text)) continue;
    const largestSize = Math.max(...line.items.map((item) => item.size));
    const heading = largestSize >= bodySize * 1.3 && line.text.length <= 120;
    const gap = previousY === undefined ? 0 : previousY - line.y;
    if (output) output += heading || gap > bodySize * 1.8 ? '\n\n' : '\n';
    output += heading ? `# ${line.text}` : line.text;
    if (heading) output += '\n';
    previousY = line.y;
  }
  return output.trim();
}

function joinItems(items: PositionedItem[]) {
  let output = '';
  let previous: PositionedItem | undefined;
  for (const item of items) {
    const expectedEnd = previous ? previous.x + previous.width : item.x;
    const gap = item.x - expectedEnd;
    const separator = previous && gap > Math.max(1.5, item.size * 0.12) ? ' ' : '';
    output += `${separator}${item.text}`;
    previous = item;
  }
  return output.replace(/\s+/g, ' ').trim();
}

function dedupeColumns(columns: TableColumn[]) {
  const seen = new Set<string>();
  return columns.filter((column) => {
    if (seen.has(column.label)) return false;
    seen.add(column.label);
    return true;
  });
}

function isPageNoise(value: string) {
  const text = value.trim();
  return /^page\s+\d+(?:\s+of\s+\d+)?$/i.test(text) || /^\d+$/.test(text);
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}
