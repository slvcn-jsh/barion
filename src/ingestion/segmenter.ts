import { createId } from '@/domain/ids';

import type { ExtractedPage, ParsedSegment } from './types';

const TARGET_CHARS = 1100;
const MAX_CHARS = 1600;
const MIN_CHARS = 50;

export function segmentExtractedPages(pages: ExtractedPage[], sourceTitle: string): ParsedSegment[] {
  const segments: ParsedSegment[] = [];

  for (const page of pages) {
    const blocks = splitIntoBlocks(page.text);
    let sectionPath = sourceTitle;
    let buffer = '';
    let offset = 0;

    const flush = () => {
      const text = buffer.trim();
      if (text.length >= MIN_CHARS) {
        const startOffset = page.text.indexOf(text.slice(0, Math.min(text.length, 80)), offset);
        const safeStart = startOffset >= 0 ? startOffset : offset;
        segments.push({
          id: createId('seg'),
          locator: page.locator,
          sectionPath,
          text,
          startOffset: safeStart,
          endOffset: safeStart + text.length,
        });
        offset = safeStart + text.length;
      }
      buffer = '';
    };

    for (const block of blocks) {
      if (isHeading(block)) {
        flush();
        sectionPath = cleanHeading(block) || sourceTitle;
        continue;
      }

      if (buffer && buffer.length + block.length + 2 > MAX_CHARS) {
        flush();
      }

      buffer = buffer ? `${buffer}\n\n${block}` : block;
      if (buffer.length >= TARGET_CHARS) {
        flush();
      }
    }

    flush();
  }

  return segments;
}

function splitIntoBlocks(text: string) {
  const normalized = text
    .replace(/\r\n/g, '\n')
    .replace(/\f/g, '\n')
    .replace(/\u0000/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim();

  const paragraphs = normalized.split(/\n{2,}/).map((value) => value.trim()).filter(Boolean);
  if (paragraphs.length > 1) {
    return paragraphs;
  }

  const lines = normalized
    .split('\n')
    .map((value) => value.trim())
    .filter((value) => value && !isPageNoise(value));
  if (lines.length > 1) {
    return groupLinesIntoBlocks(lines);
  }

  return normalized
    .split(/(?<=[.!?])\s+(?=[A-Z0-9#*-])/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function isHeading(value: string) {
  const trimmed = value.trim();
  const words = trimmed.split(/\s+/).filter(Boolean);
  const hasSentenceVerb = /\b(is|are|was|were|has|have|include|includes|causes|reduces|increases|treated|managed|presents)\b/i.test(trimmed);

  if (/^[-*]\s+/.test(trimmed)) return false;
  if (/^#{1,6}\s+/.test(trimmed)) return true;
  if (hasSentenceVerb && words.length > 4) return false;
  if (trimmed.endsWith(':') && trimmed.length <= 90) return true;
  return trimmed.length <= 80 && words.length <= 10 && !/[.!?]$/.test(trimmed);
}

function cleanHeading(value: string) {
  return value.replace(/^#{1,6}\s+/, '').replace(/:$/, '').trim();
}

function groupLinesIntoBlocks(lines: string[]) {
  const blocks: string[] = [];
  let buffer = '';

  const flush = () => {
    if (buffer.trim()) {
      blocks.push(buffer.trim());
      buffer = '';
    }
  };

  for (const line of lines) {
    const startsListItem = /^([-*]|\d+[.)])\s+/.test(line);
    const headingLike = isHeading(line);

    if (headingLike || startsListItem || buffer.length + line.length + 1 > MAX_CHARS) {
      flush();
    }

    buffer = buffer ? `${buffer}\n${line}` : line;

    if (headingLike || startsListItem || buffer.length >= TARGET_CHARS) {
      flush();
    }
  }

  flush();
  return blocks;
}

function isPageNoise(value: string) {
  const trimmed = value.trim();
  return /^\d+$/.test(trimmed) || /^page\s+\d+(\s+of\s+\d+)?$/i.test(trimmed);
}
