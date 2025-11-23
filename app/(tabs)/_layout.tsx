import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { useColorScheme } from 'nativewind';

const headerLight = '#F5F7F6';
const headerDark = '#1C2521';
const textLight = '#0E1A14';
const textDark = '#FFFFFF';
const primary = '#4A8F6A';
const mutedLight = '#32493D';
const mutedDark = '#B6C7BC';

export default function TabsLayout() {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: isDark ? headerDark : headerLight },
        headerShadowVisible: false,
        headerTintColor: isDark ? textDark : textLight,
        tabBarActiveTintColor: primary,
        tabBarInactiveTintColor: isDark ? mutedDark : mutedLight,
        tabBarStyle: {
          backgroundColor: isDark ? headerDark : headerLight,
          borderTopColor: isDark ? '#2F3C35' : '#D6E0D9',
        },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="home-outline" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="tasks/index"
        options={{
          title: 'Tasks',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="list-outline" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person-circle-outline" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="details"
        options={{
          href: null,
          title: 'Details',
        }}
      />
    </Tabs>
  );
}
