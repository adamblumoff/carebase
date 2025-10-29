import { useCallback, useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import type { PermissionResponse, Subscription } from 'expo-notifications';
import Constants from 'expo-constants';
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

const EXPO_GO_WARNING = 'Use a development build to test medication notifications.';
const PERMISSION_DENIED_WARNING =
  'Enable notifications in Settings to get medication reminders.';

function isNotificationGranted(response: PermissionResponse): boolean {
  return response.status === 'granted' || response.status === 'provisional';
}

export function useNotifications(): void {
  const toast = useToast();
  const warnedExpoGoRef = useRef(false);

  const handleMedicationNavigation = useCallback(
    (payload: MedicationNotificationPayload) => {
      navigate('Plan', {
        focusMedicationId: payload.medicationId,
      });
    },
    []
  );

  const ensureNotificationPermissions = useCallback(async () => {
    try {
      const initial = await Notifications.getPermissionsAsync();
      if (isNotificationGranted(initial)) {
        return true;
      }

      if (!initial.canAskAgain) {
        toast.showToast(PERMISSION_DENIED_WARNING);
        return false;
      }

      const requested = await Notifications.requestPermissionsAsync();
      if (isNotificationGranted(requested)) {
        return true;
      }

      toast.showToast(PERMISSION_DENIED_WARNING);
      return false;
    } catch (error) {
      console.warn('Notification permission request failed', error);
      return false;
    }
  }, [toast]);

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
    let isActive = true;
    let receivedSub: Subscription | null = null;
    let responseSub: Subscription | null = null;

    const setup = async () => {
      try {
        if (Constants.appOwnership === 'expo' && !warnedExpoGoRef.current) {
          warnedExpoGoRef.current = true;
          toast.showToast(EXPO_GO_WARNING);
        }

        const permissionGranted = await ensureNotificationPermissions();
        if (!permissionGranted || !isActive) {
          return;
        }

        await configureNotificationChannels();
        await configureNotificationCategories();

        if (!isActive) {
          return;
        }

        receivedSub = Notifications.addNotificationReceivedListener((notification) => {
          const payload = parseMedicationNotificationPayload(notification.request.content.data);
          if (!payload) {
            return;
          }

          const message = formatToastMessage(notification, payload);
          toast.showToast(message);
        });

        responseSub = Notifications.addNotificationResponseReceivedListener(
          handleNotificationResponse
        );

        const getLastResponse =
          typeof Notifications.getLastNotificationResponseAsync === 'function'
            ? Notifications.getLastNotificationResponseAsync
            : null;

        if (getLastResponse) {
          try {
            const lastResponse = await getLastResponse();
            if (lastResponse) {
              handleNotificationResponse(lastResponse);
            }
          } catch (lastResponseError) {
            const message = String(lastResponseError || '');
            const isUnsupported = message.includes('not available');
            if (!isUnsupported) {
              console.warn('Failed to read last notification response', lastResponseError);
            }
          }
        }
      } catch (error) {
        console.warn('Notification configuration failed', error);
      }
    };

    setup().catch(() => {});

    return () => {
      isActive = false;
      receivedSub?.remove();
      responseSub?.remove();
    };
  }, [ensureNotificationPermissions, handleNotificationResponse, toast]);
}
