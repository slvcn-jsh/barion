import { Ionicons } from '@expo/vector-icons';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { colors, fonts, radii } from '@/theme/colors';

type Props = {
  visible: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  confirmIcon?: keyof typeof Ionicons.glyphMap;
  eyebrow?: string;
  busyLabel?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  reviewedCardCount?: number;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function ConfirmDialog({
  visible,
  title,
  body,
  confirmLabel,
  confirmIcon = 'trash-outline',
  eyebrow = 'MOVE TO TRASH',
  busyLabel = 'Moving…',
  icon = 'trash-outline',
  reviewedCardCount = 0,
  busy = false,
  onCancel,
  onConfirm,
}: Props) {
  return (
    <Modal
      animationType="fade"
      onRequestClose={onCancel}
      transparent
      visible={visible}
    >
      <View style={styles.backdrop}>
        <Pressable accessibilityLabel="Close confirmation" onPress={onCancel} style={StyleSheet.absoluteFill} />
        <View accessibilityRole="alert" style={styles.dialog}>
          <View style={styles.icon}>
            <Ionicons name={icon} size={24} color={colors.red} />
          </View>
          <View style={styles.copy}>
            <Text style={styles.eyebrow}>{eyebrow}</Text>
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.body}>{body}</Text>
          </View>
          {reviewedCardCount > 0 ? (
            <View style={styles.warning}>
              <Ionicons name="warning-outline" size={19} color={colors.red} />
              <Text style={styles.warningText}>
                {reviewedCardCount} reviewed card{reviewedCardCount === 1 ? '' : 's'} with scheduling history will be hidden too. Restoring this item restores that history.
              </Text>
            </View>
          ) : null}
          <View style={styles.actions}>
            <AppButton disabled={busy} label="Cancel" variant="secondary" onPress={onCancel} />
            <AppButton
              disabled={busy}
              icon={confirmIcon}
              label={busy ? busyLabel : confirmLabel}
              variant="danger"
              onPress={onConfirm}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 9, justifyContent: 'flex-end' },
  backdrop: { alignItems: 'center', backgroundColor: 'rgba(15, 45, 96, 0.42)', flex: 1, justifyContent: 'center', padding: 18 },
  body: { color: colors.muted, fontFamily: fonts.regular, fontSize: 13, lineHeight: 20 },
  copy: { gap: 6 },
  dialog: { backgroundColor: colors.surface, borderRadius: radii.lg, gap: 16, maxWidth: 500, padding: 22, width: '100%' },
  eyebrow: { color: colors.red, fontFamily: fonts.bold, fontSize: 10, letterSpacing: 1.25 },
  icon: { alignItems: 'center', backgroundColor: colors.dangerSurface, borderRadius: 15, height: 50, justifyContent: 'center', width: 50 },
  title: { color: colors.ink, fontFamily: fonts.extraBold, fontSize: 21, lineHeight: 28 },
  warning: { alignItems: 'flex-start', backgroundColor: colors.dangerSurface, borderRadius: radii.sm, flexDirection: 'row', gap: 9, padding: 12 },
  warningText: { color: colors.red, flex: 1, fontFamily: fonts.semibold, fontSize: 12, lineHeight: 18 },
});
