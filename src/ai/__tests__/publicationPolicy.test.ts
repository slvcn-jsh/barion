import { decidePublication, EVALUATION_CONTRACT_VERSION, policyContract, PUBLICATION_POLICY_VERSION } from '@/ai/publicationPolicy';

describe('shared production publication policy', () => {
  const contract = policyContract();
  it.each(contract.cases)('$id', (testCase) => {
    expect(decidePublication(testCase.facts)).toBe(testCase.expected);
  });
  it('keeps contract and policy versions synchronized', () => {
    expect(contract.contractVersion).toBe(EVALUATION_CONTRACT_VERSION);
    expect(contract.policyVersion).toBe(PUBLICATION_POLICY_VERSION);
  });
});
