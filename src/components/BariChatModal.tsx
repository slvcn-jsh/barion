import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { sendBariChatMessage } from '@/ai/bariChat';
import type { BariChatSourceSegment, BariCitation } from '@/ai/types';
import { BariMascot } from '@/components/BariMascot';
import { clearBariConversation, getOrCreateBariConversation, saveBariMessage } from '@/storage/repository';
import { colors, fonts, radii } from '@/theme/colors';

export type ChatMessage = {
  id: string;
  role: 'user' | 'bari';
  text: string;
  citations?: BariCitation[];
  evidence?: BariChatSourceSegment[];
  createdAt: string;
};

type Props = {
  visible: boolean;
  onClose: () => void;
  contextType?: 'card' | 'deck' | 'general';
  contextId?: string;
  contextTitle?: string;
  evidence?: BariChatSourceSegment[];
  initialPrompt?: string;
};

const SUGGESTIONS = [
  'Why does this matter clinically?',
  'Explain the mechanism',
  'Key memory hook to remember',
  'What are the main risks or contraindications?',
];

export function BariChatModal({
  visible,
  onClose,
  contextType = 'general',
  contextId,
  contextTitle,
  evidence = [],
  initialPrompt,
}: Props) {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [expandedCitation, setExpandedCitation] = useState<string | null>(null);
  const scrollViewRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (!visible) return;
    let active = true;
    void (async () => {
      try {
        const conv = await getOrCreateBariConversation(
          contextType,
          contextId,
          contextTitle || 'Study Assistant',
        );
        if (!active) return;
        setConversationId(conv.id);
        if (conv.messages.length > 0) {
          setMessages(
            conv.messages.map((m) => ({
              id: m.id,
              role: m.role,
              text: m.text,
              citations: m.citations,
              evidence: m.evidence,
              createdAt: m.createdAt,
            })),
          );
        } else {
          setMessages([{
            id: 'msg-greeting',
            role: 'bari',
            text: "Hi! I'm Bari, your medical study assistant. Ask me anything about this concept or select a suggestion below.",
            createdAt: new Date().toISOString(),
          }]);
        }
        if (initialPrompt) {
          void handleSend(initialPrompt, conv.id);
        }
      } catch {
        if (!active) return;
        setMessages([{
          id: 'msg-greeting-fallback',
          role: 'bari',
          text: "Hi! I'm Bari, your study assistant. Ask me anything about your notes!",
          createdAt: new Date().toISOString(),
        }]);
      }
    })();
    return () => { active = false; };
  }, [visible, contextId, contextType]);

  async function handleSend(promptText?: string, explicitConvId?: string) {
    const textToSend = (promptText || input).trim();
    const activeConvId = explicitConvId || conversationId;
    if (!textToSend || loading) return;

    const userMessage: ChatMessage = {
      id: `msg-user-${Date.now()}`,
      role: 'user',
      text: textToSend,
      createdAt: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMessage]);
    if (!promptText) setInput('');
    setLoading(true);
    if (activeConvId) { void saveBariMessage(activeConvId, 'user', textToSend); }

    try {
      const response = await sendBariChatMessage({
        message: textToSend,
        evidence,
        mode: 'source-strict',
      });

      const bariMessage: ChatMessage = {
        id: `msg-bari-${Date.now()}`,
        role: 'bari',
        text: response.message,
        citations: response.citations,
        evidence: response.evidence,
        createdAt: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, bariMessage]);
      if (activeConvId) { void saveBariMessage(activeConvId, 'bari', response.message, response.citations, response.evidence); }
    } catch (error) {
      const errorMessage: ChatMessage = {
        id: `msg-err-${Date.now()}`,
        role: 'bari',
        text: "I couldn't complete that explanation right now. Here is what your note segment mentions: " +
          (evidence[0]?.text ? `"${evidence[0].text.slice(0, 200)}…"` : 'No source notes linked.'),
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, errorMessage]);
      if (activeConvId) { void saveBariMessage(activeConvId, 'bari', errorMessage.text); }
    } finally {
      setLoading(false);
      setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 150);
    }
  }

  function toggleCitation(locator: string) {
    setExpandedCitation((prev) => (prev === locator ? null : locator));
  }

  return (
    <Modal animationType="slide" transparent visible={visible} onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.modalOverlay}
      >
        <View style={styles.modalContent}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <BariMascot size="sm" expression={loading ? 'thinking' : 'idle'} showBadge />
              <View style={styles.headerTitles}>
                <Text style={styles.headerTitle}>Ask Bari</Text>
                {contextTitle ? (
                  <Text numberOfLines={1} style={styles.headerSubtitle}>
                    {contextTitle}
                  </Text>
                ) : null}
              </View>
            </View>
            <Pressable accessibilityLabel="Close Bari chat" onPress={onClose} style={styles.closeButton}>
              <Ionicons name="close" size={22} color={colors.inkSoft} />
            </Pressable>
          </View>

          {/* Chat Messages */}
          <ScrollView
            ref={scrollViewRef}
            contentContainerStyle={styles.messageList}
            onContentSizeChange={() => scrollViewRef.current?.scrollToEnd({ animated: true })}
            style={styles.scrollArea}
          >
            {messages.length <= 1 && !loading ? (
              <View style={styles.mascotHero}>
                <BariMascot size="lg" expression="happy" showBadge interactive />
                <View style={styles.mascotHeroText}>
                  <Text style={styles.mascotHeroTitle}>Bari Study Companion</Text>
                  <Text style={styles.mascotHeroTagline}>LEARN TODAY. HEAL TOMORROW.</Text>
                  <Text style={styles.mascotHeroBody}>
                    Source-grounded explanations directly from your study materials.
                  </Text>
                </View>
              </View>
            ) : null}

            {messages.map((msg) => (
              <View
                key={msg.id}
                style={[
                  styles.messageBubble,
                  msg.role === 'user' ? styles.userBubble : styles.bariBubble,
                ]}
              >
                {msg.role === 'bari' ? (
                  <View style={styles.bariHeaderRow}>
                    <BariMascot size="sm" expression={loading ? 'thinking' : 'explaining'} showBadge />
                    <Text style={styles.bariName}>Bari</Text>
                  </View>
                ) : null}

                <Text
                  style={[
                    styles.messageText,
                    msg.role === 'user' ? styles.userMessageText : styles.bariMessageText,
                  ]}
                >
                  {msg.text}
                </Text>

                {/* Citations */}
                {msg.citations && msg.citations.length > 0 ? (
                  <View style={styles.citationsContainer}>
                    <Text style={styles.citationsLabel}>SOURCE EVIDENCE</Text>
                    <View style={styles.citationPills}>
                      {msg.citations.map((cit, idx) => {
                        const locator = cit.locator || `Source ${idx + 1}`;
                        const isExpanded = expandedCitation === locator;
                        const matchingSegment = (msg.evidence || evidence).find(
                          (e) => e.locator === cit.locator || e.segmentId === cit.segmentId,
                        );

                        return (
                          <View key={`cit-${idx}`} style={styles.citationItem}>
                            <Pressable
                              accessibilityLabel={`View citation: ${locator}`}
                              onPress={() => toggleCitation(locator)}
                              style={[styles.citationPill, isExpanded && styles.citationPillActive]}
                            >
                              <Ionicons name="bookmark-outline" size={13} color={colors.tealDark} />
                              <Text style={styles.citationText}>{locator}</Text>
                              <Ionicons
                                name={isExpanded ? 'chevron-up' : 'chevron-down'}
                                size={12}
                                color={colors.tealDark}
                              />
                            </Pressable>

                            {isExpanded && matchingSegment ? (
                              <View style={styles.expandedCitationCard}>
                                <Text style={styles.expandedCitationPath}>
                                  {matchingSegment.sectionPath || matchingSegment.locator}
                                </Text>
                                <Text style={styles.expandedCitationText}>
                                  {matchingSegment.text}
                                </Text>
                              </View>
                            ) : null}
                          </View>
                        );
                      })}
                    </View>
                  </View>
                ) : null}
              </View>
            ))}

            {loading ? (
              <View style={[styles.messageBubble, styles.bariBubble, styles.loadingBubble]}>
                <BariMascot size="sm" expression="thinking" />
                <ActivityIndicator color={colors.teal} size="small" style={styles.loadingSpinner} />
                <Text style={styles.loadingText}>Bari is reading your notes…</Text>
              </View>
            ) : null}
          </ScrollView>

          {/* Suggested Prompts */}
          {messages.length <= 2 && !loading ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.suggestionRow}
            >
              {SUGGESTIONS.map((sugg, i) => (
                <Pressable
                  key={`sugg-${i}`}
                  onPress={() => void handleSend(sugg)}
                  style={styles.suggestionChip}
                >
                  <Ionicons name="sparkles-outline" size={12} color={colors.blueDark} />
                  <Text style={styles.suggestionText}>{sugg}</Text>
                </Pressable>
              ))}
            </ScrollView>
          ) : null}

          {/* Input Row */}
          <View style={styles.inputContainer}>
            <TextInput
              accessibilityLabel="Message Bari"
              editable={!loading}
              multiline
              onChangeText={setInput}
              placeholder="Ask about this concept or mechanism…"
              placeholderTextColor={colors.slate}
              style={styles.textInput}
              value={input}
            />
            <Pressable
              accessibilityLabel="Send message"
              disabled={!input.trim() || loading}
              onPress={() => void handleSend()}
              style={[
                styles.sendButton,
                (!input.trim() || loading) && styles.sendButtonDisabled,
              ]}
            >
              <Ionicons
                name="arrow-up"
                size={20}
                color={!input.trim() || loading ? colors.slate : colors.surface}
              />
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  mascotHero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: '#EEF6FF',
    borderRadius: radii.lg,
    padding: 14,
    borderWidth: 1,
    borderColor: '#D0E4FF',
    marginBottom: 8,
  },
  mascotHeroText: {
    flex: 1,
    gap: 2,
  },
  mascotHeroTitle: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: colors.blueDark,
  },
  mascotHeroTagline: {
    fontFamily: fonts.semibold,
    fontSize: 9,
    letterSpacing: 1.2,
    color: colors.tealDark,
  },
  mascotHeroBody: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.inkSoft,
    lineHeight: 16,
    marginTop: 2,
  },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 45, 96, 0.45)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    maxHeight: '88%',
    minHeight: '60%',
    display: 'flex',
    flexDirection: 'column',
    ...(Platform.OS === 'web'
      ? { boxShadow: '0 -4px 10px rgba(0, 0, 0, 0.15)' }
      : {
          elevation: 8,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: -4 },
          shadowOpacity: 0.15,
          shadowRadius: 10,
        }),
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  headerTitles: {
    flex: 1,
  },
  headerTitle: {
    fontFamily: fonts.semibold,
    fontSize: 16,
    color: colors.ink,
  },
  headerSubtitle: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.inkSoft,
    marginTop: 1,
  },
  closeButton: {
    padding: 6,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceMuted,
  },
  scrollArea: {
    flex: 1,
  },
  messageList: {
    padding: 16,
    gap: 12,
  },
  messageBubble: {
    borderRadius: radii.lg,
    padding: 14,
    maxWidth: '88%',
  },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: colors.blueDark,
    borderBottomRightRadius: radii.sm,
  },
  bariBubble: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surfaceMuted,
    borderBottomLeftRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.line,
  },
  bariHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  bariName: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: colors.blueDark,
  },
  messageText: {
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 20,
  },
  userMessageText: {
    color: colors.surface,
  },
  bariMessageText: {
    color: colors.ink,
  },
  loadingBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
  },
  loadingSpinner: {
    marginLeft: 4,
  },
  loadingText: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: colors.tealDark,
  },
  citationsContainer: {
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  citationsLabel: {
    fontFamily: fonts.bold,
    fontSize: 10,
    letterSpacing: 0.5,
    color: colors.tealDark,
    marginBottom: 4,
  },
  citationPills: {
    gap: 6,
  },
  citationItem: {
    flexDirection: 'column',
    gap: 4,
  },
  citationPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 5,
    backgroundColor: colors.surfaceTeal,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.line,
  },
  citationPillActive: {
    backgroundColor: colors.line,
  },
  citationText: {
    fontFamily: fonts.medium,
    fontSize: 11,
    color: colors.tealDark,
  },
  expandedCitationCard: {
    backgroundColor: colors.surface,
    padding: 10,
    borderRadius: radii.sm,
    borderLeftWidth: 3,
    borderLeftColor: colors.teal,
    marginVertical: 4,
  },
  expandedCitationPath: {
    fontFamily: fonts.semibold,
    fontSize: 11,
    color: colors.inkSoft,
    marginBottom: 3,
  },
  expandedCitationText: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.ink,
    lineHeight: 16,
  },
  suggestionRow: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
  },
  suggestionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.line,
  },
  suggestionText: {
    fontFamily: fonts.medium,
    fontSize: 12,
    color: colors.blueDark,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
    backgroundColor: colors.surface,
  },
  textInput: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.ink,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radii.pill,
    maxHeight: 80,
    borderWidth: 1,
    borderColor: colors.line,
  },
  sendButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.blue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: colors.surfaceMuted,
  },
});
