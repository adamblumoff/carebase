/**
 * Carebase Mobile App
 * Healthcare coordination: Show Up (appointments) + Pay (bills)
 */
import { StatusBar } from 'expo-status-bar';
import AppNavigator from './src/navigation/AppNavigator';
import { ThemeProvider, useTheme } from './src/theme';

function AppContent() {
  const { colorScheme } = useTheme();
  const statusBarStyle = colorScheme === 'dark' ? 'light' : 'dark';

  return (
    <>
      <AppNavigator />
      <StatusBar style={statusBarStyle} />
    </>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AppContent />
    </ThemeProvider>
  );
}
