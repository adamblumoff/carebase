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
  const timezoneInFlightRef = useRef(false);
  const lastTimezoneAttemptAtRef = useRef(0);
  const didRegisterPushRef = useRef(false);
  const pushInFlightRef = useRef(false);
  const lastPushAttemptAtRef = useRef(0);

  useEffect(() => {
    if (!isSignedIn) {
      didSyncTimezoneRef.current = false;
      timezoneInFlightRef.current = false;
      lastTimezoneAttemptAtRef.current = 0;
      return;
    }
    if (didSyncTimezoneRef.current) return;
    if (timezoneInFlightRef.current) return;
    if (Date.now() - lastTimezoneAttemptAtRef.current < 15_000) return;
    const tz = getDeviceTimeZone();
    if (!tz) return;
    timezoneInFlightRef.current = true;
    lastTimezoneAttemptAtRef.current = Date.now();
    mutateTimezone(
      { timezone: tz },
      {
        onSuccess: () => {
          didSyncTimezoneRef.current = true;
          timezoneInFlightRef.current = false;
        },
        onError: () => {
          timezoneInFlightRef.current = false;
        },
      }
    );
  }, [isSignedIn, mutateTimezone]);

  useEffect(() => {
    if (!isSignedIn) {
      didRegisterPushRef.current = false;
      pushInFlightRef.current = false;
      lastPushAttemptAtRef.current = 0;
      return;
    }
    if (didRegisterPushRef.current) return;
    if (pushInFlightRef.current) return;
    if (Date.now() - lastPushAttemptAtRef.current < 30_000) return;
    pushInFlightRef.current = true;
    lastPushAttemptAtRef.current = Date.now();

    let cancelled = false;
    void (async () => {
      const token = await registerForPushNotificationsAsync();
      if (cancelled) return;
      if (!token) {
        pushInFlightRef.current = false;
        return;
      }
      const platform =
        Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web';
      mutatePushToken(
        { token, platform },
        {
          onSuccess: () => {
            didRegisterPushRef.current = true;
            pushInFlightRef.current = false;
          },
          onError: () => {
            pushInFlightRef.current = false;
          },
        }
      );
    })();

    return () => {
      cancelled = true;
    };
  }, [isSignedIn, mutatePushToken]);

  return null;
}
