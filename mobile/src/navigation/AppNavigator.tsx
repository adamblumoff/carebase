/**
 * Main app navigation
 */
import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { Appointment, Bill } from '@carebase/shared';
import { palette } from '../theme';

// Screens
import LoginScreen from '../screens/LoginScreen';
import PlanScreen from '../screens/PlanScreen';
import AppointmentDetailScreen from '../screens/AppointmentDetailScreen';
import BillDetailScreen from '../screens/BillDetailScreen';
import SettingsScreen from '../screens/SettingsScreen';
import CameraScreen from '../screens/CameraScreen';

export type RootStackParamList = {
  Login: undefined;
  Plan: undefined;
  AppointmentDetail: { appointment: Appointment };
  BillDetail: { bill: Bill };
  Settings: undefined;
  Camera: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function AppNavigator() {
  return (
    <NavigationContainer>
      <Stack.Navigator
        initialRouteName="Login"
        screenOptions={{
          headerStyle: {
            backgroundColor: palette.canvas,
          },
          headerTintColor: '#fff',
          headerTitleStyle: {
            fontWeight: 'bold',
          },
        }}
      >
        <Stack.Screen
          name="Login"
          component={LoginScreen}
          options={{ headerShown: false }}
        />
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
          options={{ title: 'Scan Bill' }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
