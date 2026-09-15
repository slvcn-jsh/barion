import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { initializeDatabase } from '@/storage/database';
import { createDeck } from '@/storage/repository';
import { colors, fonts, radii } from '@/theme/colors';

export default function NewDeckScreen() {
  const params = useLocalSearchParams<{ moduleId?: string }>();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!title.trim()) {
      Alert.alert('Deck needs a title', 'Name the deck before saving.');
      return;
    }

    setSaving(true);
    try {
      await initializeDatabase();
      const deckId = await createDeck({ title, description, moduleId: params.moduleId });
      router.replace({ pathname: '/deck/[id]', params: { id: deckId } });
    } catch (error) {
      Alert.alert('Unable to save deck', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.panel}>
        <Text style={styles.title}>{params.moduleId ? 'Create Deck in Folder' : 'Create Deck'}</Text>
        <Text style={styles.subtitle}>
          Group related concepts into a focused review space. You can add your own cards or approve source-grounded drafts into it.
        </Text>

        <View style={styles.field}>
          <Text style={styles.label}>Title</Text>
          <TextInput
            autoFocus
            placeholder="Example: Renal physiology"
            placeholderTextColor={colors.muted}
            style={styles.input}
            value={title}
            onChangeText={setTitle}
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Description</Text>
          <TextInput
            multiline
            placeholder="Short study goal or course context"
            placeholderTextColor={colors.muted}
            style={[styles.input, styles.multiline]}
            value={description}
            onChangeText={setDescription}
          />
        </View>

        <AppButton disabled={saving} label={saving ? 'Saving' : 'Save Deck'} icon="save-outline" onPress={save} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 'auto',
    maxWidth: 720,
    padding: 18,
    width: '100%',
  },
  field: {
    gap: 8,
  },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderRadius: radii.md,
    borderWidth: 1,
    color: colors.ink,
    fontFamily: fonts.medium,
    fontSize: 16,
    minHeight: 48,
    paddingHorizontal: 12,
  },
  label: {
    color: colors.ink,
    fontFamily: fonts.bold,
    fontSize: 13,
    textTransform: 'uppercase',
  },
  multiline: {
    minHeight: 110,
    paddingTop: 12,
    textAlignVertical: 'top',
  },
  panel: {
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderRadius: radii.md,
    borderWidth: 1,
    gap: 16,
    padding: 18,
  },
  subtitle: {
    color: colors.muted,
    fontFamily: fonts.regular,
    fontSize: 15,
    lineHeight: 22,
  },
  title: {
    color: colors.ink,
    fontFamily: fonts.extraBold,
    fontSize: 28,
  },
});
