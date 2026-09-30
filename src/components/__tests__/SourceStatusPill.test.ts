jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

import { getSourceStatusMeta } from '@/components/SourceStatusPill';

describe('getSourceStatusMeta', () => {
  it('keeps unknown persisted source states from crashing the library', () => {
    expect(getSourceStatusMeta(undefined)).toMatchObject({
      label: 'Needs attention',
      tone: 'warning',
    });
    expect(getSourceStatusMeta('legacy-unknown-status')).toMatchObject({
      label: 'Needs attention',
      tone: 'warning',
    });
  });

  it('preserves known source status presentation', () => {
    expect(getSourceStatusMeta('ready')).toMatchObject({
      label: 'Ready to study',
      tone: 'success',
    });
  });

  it('shows queued generation as waiting instead of active or failed', () => {
    expect(getSourceStatusMeta('waiting-for-generation')).toMatchObject({
      label: 'Waiting for Smart Generation',
      tone: 'waiting',
    });
  });
});
