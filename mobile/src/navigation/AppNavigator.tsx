/**
 * Main app navigation
 */
import React from 'react';
import { NavigationContainer, DefaultTheme, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTheme } from '../theme';
import type { RootStackParamList } from './types';
export type { RootStackParamList } from './types';

// Screens
import LoginScreen from '../screens/LoginScreen';
import PlanScreen from '../screens/PlanScreen';
import AppointmentDetailScreen from '../screens/AppointmentDetailScreen';
import BillDetailScreen from '../screens/BillDetailScreen';
import SettingsScreen from '../screens/SettingsScreen';
import CameraScreen from '../screens/CameraScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();

interface AppNavigatorProps {
  isSignedIn: boolean;
  onSignedIn?: (user?: any) => void;
  onSignedOut?: () => void;
}

export default function AppNavigator({ isSignedIn }: AppNavigatorProps) {
  const { palette, colorScheme } = useTheme();

  const navigationTheme = React.useMemo(
    () => {
      const base = colorScheme === 'dark' ? DarkTheme : DefaultTheme;
      return {
        ...base,
        colors: {
          ...base.colors,
          primary: palette.primary,
          background: palette.background,
          card: palette.canvas,
          text: palette.textPrimary,
          border: palette.border,
          notification: palette.accent,
        },
      };
    },
    [palette, colorScheme]
  );

  return (
    <NavigationContainer theme={navigationTheme} key={isSignedIn ? 'app-stack' : 'auth-stack'}>
      <Stack.Navigator
        initialRouteName={isSignedIn ? 'Plan' : 'Login'}
        screenOptions={{
          headerStyle: {
            backgroundColor: palette.canvas,
          },
          headerTintColor: palette.textPrimary,
          headerTitleStyle: {
            fontWeight: 'bold',
            color: palette.textPrimary,
          },
        }}
      >
        {isSignedIn ? (
          <>
            <Stack.Screen
              name="Plan"
              component={PlanScreen}
              options={{ title: 'My Plan' }}
            />
            <Stack.Screen
              name="AppointmentDetail"
              component={AppointmentDetailScreen}
              options={{ title: 'Appointment' }}
            />
            <Stack.Screen
              name="BillDetail"
              component={BillDetailScreen}
              options={{ title: 'Bill' }}
            />
            <Stack.Screen
              name="Settings"
              component={SettingsScreen}
              options={{ title: 'Settings' }}
            />
            <Stack.Screen
              name="Camera"
              component={CameraScreen}
              options={{ title: 'Scan Document' }}
            />
          </>
        ) : (
          <Stack.Screen
            name="Login"
            component={LoginScreen}
            options={{ headerShown: false }}
          />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
