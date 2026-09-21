import * as Crypto from 'expo-crypto';

export const SOURCE_SPAN_VERSION = '1.0.0' as const;
export const OFFSET_ENCODING = 'utf16-code-units' as const;
export const BOUNDARY_CONVENTION = 'half-open' as const;

export type SourceSpanStatus =
  | 'exact' | 'normalized' | 'context-disambiguated' | 'ambiguous'
  | 'not-found' | 'invalid' | 'stale-source';

export type SourceSpan = {
  version: typeof SOURCE_SPAN_VERSION;
  offsetEncoding: typeof OFFSET_ENCODING;
  boundaryConvention: typeof BOUNDARY_CONVENTION;
  status: SourceSpanStatus;
  startOffset: number | null;
  endOffset: number | null;
  evidenceTextSha256: string;
  sourceTextSha256: string;
  matchCount: number;
};

export async function sha256Utf8(value: string) {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value);
}

export function sliceUtf16(value: string, start: number, end: number) {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > value.length) return null;
  if (splitsSurrogatePair(value, start) || splitsSurrogatePair(value, end)) return null;
  return value.slice(start, end);
}

export async function resolveSourceSpan(
  sourceText: string,
  evidenceText: string,
  options: { contextBefore?: string; contextAfter?: string; expectedSourceTextSha256?: string } = {},
): Promise<SourceSpan> {
  const sourceTextSha256 = await sha256Utf8(sourceText);
  const evidenceTextSha256 = await sha256Utf8(evidenceText);
  const base = { version: SOURCE_SPAN_VERSION, offsetEncoding: OFFSET_ENCODING,
    boundaryConvention: BOUNDARY_CONVENTION, evidenceTextSha256, sourceTextSha256 };
  if (!evidenceText) return { ...base, status: 'invalid', startOffset: null, endOffset: null, matchCount: 0 };
  if (options.expectedSourceTextSha256 !== undefined && options.expectedSourceTextSha256 !== sourceTextSha256) {
    return { ...base, status: 'stale-source', startOffset: null, endOffset: null, matchCount: 0 };
  }
  const exact = allOccurrences(sourceText, evidenceText);
  if (exact.length === 1) return resolved(base, 'exact', exact[0], exact[0] + evidenceText.length, 1);
  if (exact.length > 1) {
    const selected = selectWithContext(sourceText, exact.map((start) => ({ start, end: start + evidenceText.length })), options);
    return selected
      ? resolved(base, 'context-disambiguated', selected.start, selected.end, exact.length)
      : { ...base, status: 'ambiguous', startOffset: null, endOffset: null, matchCount: exact.length };
  }

  const source = normalizeWithMap(sourceText);
  const evidence = normalizeWithMap(evidenceText).text;
  if (!evidence) return { ...base, status: 'invalid', startOffset: null, endOffset: null, matchCount: 0 };
  const normalized = allOccurrences(source.text, evidence).map((index) => ({
    start: source.starts[index], end: source.ends[index + evidence.length - 1],
  }));
  if (normalized.length === 1) return resolved(base, 'normalized', normalized[0].start, normalized[0].end, 1);
  if (normalized.length > 1) {
    const selected = selectWithContext(sourceText, normalized, options);
    return selected
      ? resolved(base, 'context-disambiguated', selected.start, selected.end, normalized.length)
      : { ...base, status: 'ambiguous', startOffset: null, endOffset: null, matchCount: normalized.length };
  }
  return { ...base, status: 'not-found', startOffset: null, endOffset: null, matchCount: 0 };
}

function resolved(base: Omit<SourceSpan, 'status' | 'startOffset' | 'endOffset' | 'matchCount'>,
  status: SourceSpanStatus, start: number, end: number, matchCount: number): SourceSpan {
  return { ...base, status, startOffset: start, endOffset: end, matchCount };
}

function allOccurrences(value: string, needle: string) {
  const output: number[] = [];
  for (let offset = 0; needle && offset <= value.length;) {
    const found = value.indexOf(needle, offset);
    if (found < 0) break;
    output.push(found); offset = found + 1;
  }
  return output;
}


function selectWithContext(source: string, candidates: { start: number; end: number }[],
  options: { contextBefore?: string; contextAfter?: string }) {
  if (!options.contextBefore && !options.contextAfter) return null;
  const before = normalize(options.contextBefore ?? '');
  const after = normalize(options.contextAfter ?? '');
  const matches = candidates.filter(({ start, end }) => {
    const prefix = normalize(source.slice(Math.max(0, start - Math.max(64, (options.contextBefore?.length ?? 0) * 3)), start));
    const suffix = normalize(source.slice(end, end + Math.max(64, (options.contextAfter?.length ?? 0) * 3)));
    return (!before || prefix.endsWith(before)) && (!after || suffix.startsWith(after));
  });
  return matches.length === 1 ? matches[0] : null;
}

function normalize(value: string) {
  return normalizeWithMap(value).text;
}

function normalizeWithMap(value: string) {
  let text = '';
  const starts: number[] = [];
  const ends: number[] = [];
  let pendingSpace: { start: number; end: number } | null = null;
  for (let index = 0; index < value.length;) {
    const codePoint = value.codePointAt(index);
    if (codePoint === undefined) break;
    const character = String.fromCodePoint(codePoint);
    const characterEnd = index + character.length;
    for (const item of character.normalize('NFKC')) {
      if (/\s/u.test(item)) {
        if (text) pendingSpace = { start: index, end: characterEnd };
        continue;
      }
      if (pendingSpace) {
        text += ' '; starts.push(pendingSpace.start); ends.push(pendingSpace.end); pendingSpace = null;
      }
      for (let unit = 0; unit < item.length; unit += 1) {
        text += item[unit]; starts.push(index); ends.push(characterEnd);
      }
    }
    index = characterEnd;
  }
  return { text, starts, ends };
}

function splitsSurrogatePair(value: string, offset: number) {
  if (offset <= 0 || offset >= value.length) return false;
  const left = value.charCodeAt(offset - 1);
  const right = value.charCodeAt(offset);
  return left >= 0xd800 && left <= 0xdbff && right >= 0xdc00 && right <= 0xdfff;
}
