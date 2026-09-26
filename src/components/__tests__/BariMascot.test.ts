jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

import { BariMascot } from '@/components/BariMascot';

describe('BariMascot Component', () => {
  it('renders with default idle expression', () => {
    const element = BariMascot({ size: 'md', expression: 'idle' });
    expect(element).toBeDefined();
    expect(element.props.accessibilityLabel).toBe('Bari Mascot (idle)');
  });

  it('renders thinking expression', () => {
    const element = BariMascot({ size: 'sm', expression: 'thinking' });
    expect(element.props.accessibilityLabel).toBe('Bari Mascot (thinking)');
  });

  it('renders explaining expression', () => {
    const element = BariMascot({ size: 'lg', expression: 'explaining' });
    expect(element.props.accessibilityLabel).toBe('Bari Mascot (explaining)');
  });
});
