import { Platform } from 'react-native';

import type { StudyProfile } from '@/domain/types';

const REMINDER_KIND = 'barion-study-reminder';
const CHANNEL_ID = 'barion-study-plan';

export type ReminderSyncResult = 'scheduled' | 'disabled' | 'denied' | 'unsupported';

export async function syncStudyReminders(profile: StudyProfile): Promise<ReminderSyncResult> {
  if (Platform.OS === 'web') return 'unsupported';

  const Notifications = await import('expo-notifications');
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: false,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });

  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled
      .filter((request) => request.content.data?.kind === REMINDER_KIND)
      .map((request) => Notifications.cancelScheduledNotificationAsync(request.identifier)),
  );

  if (!profile.reminderEnabled) return 'disabled';

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'Study plan reminders',
      importance: Notifications.AndroidImportance.DEFAULT,
      vibrationPattern: [0, 180],
      lightColor: '#3B82F6',
    });
  }

  const existing = await Notifications.getPermissionsAsync();
  const permission = existing.status === 'granted' ? existing : await Notifications.requestPermissionsAsync();
  if (permission.status !== 'granted') return 'denied';

  for (const day of profile.weeklyStudyDays) {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Your Barion plan is ready',
        body: 'A short, focused medical review is waiting—open Barion to continue.',
        data: { kind: REMINDER_KIND, url: '/' },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
        weekday: day + 1,
        hour: profile.reminderHour,
        minute: 0,
        channelId: CHANNEL_ID,
      },
    });
  }

  return 'scheduled';
}
