import { useCallback, useEffect } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { navigate } from '../navigation/navigationRef';
import { useToast } from '../ui/ToastProvider';
import {
  parseMedicationNotificationPayload,
  type MedicationNotificationPayload,
} from './payload';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

async function configureNotificationChannels(): Promise<void> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'General',
      importance: Notifications.AndroidImportance.MAX,
    });
  }
}

async function configureNotificationCategories(): Promise<void> {
  await Notifications.setNotificationCategoryAsync('medication-reminder', [
    {
      identifier: 'MARK_TAKEN',
      buttonTitle: 'Mark taken',
      options: {
        opensAppToForeground: true,
      },
    },
    {
      identifier: 'VIEW_PLAN',
      buttonTitle: 'View plan',
      options: {
        opensAppToForeground: true,
      },
    },
  ]);

  await Notifications.setNotificationCategoryAsync('medication-missed', [
    {
      identifier: 'REVIEW_MEDICATION',
      buttonTitle: 'Review medication',
      options: {
        opensAppToForeground: true,
      },
    },
  ]);
}

function formatToastMessage(
  notification: Notifications.Notification,
  payload: MedicationNotificationPayload
): string {
  const title = notification.request.content.title;
  const body = notification.request.content.body;
  if (title && body) {
    return `${title} · ${body}`;
  }
  if (body) {
    return body;
  }
  if (title) {
    return title;
  }
  if (payload.medicationName) {
    return `Reminder: ${payload.medicationName}`;
  }
  return 'Medication reminder';
}

export function useNotifications(): void {
  const toast = useToast();

  const handleMedicationNavigation = useCallback(
    (payload: MedicationNotificationPayload) => {
      navigate('Plan', {
        focusMedicationId: payload.medicationId,
      });
    },
    []
  );

  const handleNotificationResponse = useCallback(
    (response: Notifications.NotificationResponse) => {
      const payload = parseMedicationNotificationPayload(
        response.notification.request.content.data
      );

      if (!payload) {
        return;
      }

      handleMedicationNavigation(payload);
    },
    [handleMedicationNavigation]
  );

  useEffect(() => {
    const setup = async () => {
      try {
        await configureNotificationChannels();
        await configureNotificationCategories();
      } catch (error) {
        console.warn('Notification configuration failed', error);
      }
    };

    setup().catch(() => {});

    const receivedSub = Notifications.addNotificationReceivedListener((notification) => {
      const payload = parseMedicationNotificationPayload(notification.request.content.data);
      if (!payload) {
        return;
      }

      const message = formatToastMessage(notification, payload);
      toast.showToast(message);
    });

    const responseSub = Notifications.addNotificationResponseReceivedListener(
      handleNotificationResponse
    );

    Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (response) {
          handleNotificationResponse(response);
        }
      })
      .catch(() => {});

    return () => {
      receivedSub.remove();
      responseSub.remove();
    };
  }, [handleNotificationResponse, toast]);
}
