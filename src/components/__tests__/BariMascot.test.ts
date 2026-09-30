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

  it('renders static non-animated version when animated=false', () => {
    const element = BariMascot({ size: 'sm', animated: false });
    expect(element).toBeDefined();
    expect(element.props.accessibilityLabel).toBe('Bari Mascot (idle)');
  });

  it('renders interactive pressable when interactive=true', () => {
    const element = BariMascot({ size: 'lg', interactive: true, onPress: () => {} });
    expect(element).toBeDefined();
    // Element children contains pressable wrapper
    expect(element.props.accessibilityRole).toBe('image');
  });
});
