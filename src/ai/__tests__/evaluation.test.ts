import { localExtractiveEvaluation, sourceSpanEvaluation } from '@/ai/evaluation';
import { resolveSourceSpan } from '@/ai/sourceSpan';

test('evidence substring proves coordinates, not claim support or medical truth', async () => {
  const evaluation = sourceSpanEvaluation(await resolveSourceSpan('Lithium dose is 300 mg.', 'Lithium dose is 300 mg.'));
  expect(evaluation.evidenceSpanVerified).toBe(true);
  expect(evaluation.sourceClaimSupported).toBe('not_evaluated');
  expect(evaluation.medicalVerificationStatus).toBe('verification_not_required');
  expect(evaluation.publicationDisposition).toBe('REVIEW');
});


test('local deterministic extraction may publish only with resolved evidence', async () => {
  const resolved = await resolveSourceSpan('Lithium dose is 300 mg.', 'Lithium dose is 300 mg.');
  expect(localExtractiveEvaluation(resolved).publicationDisposition).toBe('PUBLISH');
  const unresolved = await resolveSourceSpan('Lithium dose is 300 mg.', 'missing');
  expect(localExtractiveEvaluation(unresolved).publicationDisposition).toBe('REJECT');
});
