import contract from '../../../services/source_span_contract.json';
import { resolveSourceSpan, sliceUtf16 } from '@/ai/sourceSpan';

describe('shared source-span contract', () => {
  it.each(contract.cases)('$id', async (testCase) => {
    const result = await resolveSourceSpan(testCase.source, testCase.evidence, {
      contextBefore: 'contextBefore' in testCase ? testCase.contextBefore : undefined,
      contextAfter: 'contextAfter' in testCase ? testCase.contextAfter : undefined,
      expectedSourceTextSha256: 'expectedSourceTextSha256' in testCase
        ? testCase.expectedSourceTextSha256 : undefined,
    });
    expect(result).toEqual(expect.objectContaining(testCase.expected));
    expect(result.sourceTextSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.evidenceTextSha256).toMatch(/^[a-f0-9]{64}$/);
    if (result.startOffset !== null && result.endOffset !== null) {
      expect(sliceUtf16(testCase.source, result.startOffset, result.endOffset)).not.toBeNull();
    }
  });

  it('rejects UTF-16 boundaries that split a surrogate pair', () => {
    expect(sliceUtf16('A😀B', 1, 2)).toBeNull();
    expect(sliceUtf16('A😀B', 1, 3)).toBe('😀');
  });
});
