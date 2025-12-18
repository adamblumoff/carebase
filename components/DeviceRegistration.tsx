import { useAuth } from '@clerk/clerk-expo';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

import { getDeviceTimeZone } from '@/lib/device-timezone';
import { trpc } from '@/lib/trpc/client';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

async function registerForPushNotificationsAsync() {
  if (Platform.OS === 'web') return null;
  if (!Device.isDevice) return null;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#4A8F6A',
    });
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== 'granted') return null;

  const projectId =
    (Constants.expoConfig as any)?.extra?.eas?.projectId ??
    (Constants as any)?.easConfig?.projectId ??
    null;

  const token = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
  return token.data;
}

export function DeviceRegistration() {
  const { isSignedIn } = useAuth();
  const { mutate: mutateTimezone } = trpc.caregivers.setTimezone.useMutation();
  const { mutate: mutatePushToken } = trpc.pushTokens.register.useMutation();
  const didSyncTimezoneRef = useRef(false);
  const didRegisterPushRef = useRef(false);

  useEffect(() => {
    if (!isSignedIn) {
      didSyncTimezoneRef.current = false;
      return;
    }
    if (didSyncTimezoneRef.current) return;
    const tz = getDeviceTimeZone();
    if (!tz) return;
    didSyncTimezoneRef.current = true;
    mutateTimezone({ timezone: tz });
  }, [isSignedIn, mutateTimezone]);

  useEffect(() => {
    if (!isSignedIn) {
      didRegisterPushRef.current = false;
      return;
    }
    if (didRegisterPushRef.current) return;
    didRegisterPushRef.current = true;

    let cancelled = false;
    void (async () => {
      const token = await registerForPushNotificationsAsync();
      if (cancelled) return;
      if (!token) return;
      const platform =
        Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web';
      mutatePushToken({ token, platform });
    })();

    return () => {
      cancelled = true;
    };
  }, [isSignedIn, mutatePushToken]);

  return null;
}
