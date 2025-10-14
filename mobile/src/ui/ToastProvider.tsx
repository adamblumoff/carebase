import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { useTheme, spacing, radius } from '../theme';

interface ToastContextValue {
  showToast: (message: string, duration?: number) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { palette } = useTheme();
  const [message, setMessage] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const opacityRef = useRef(new Animated.Value(0));
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  React.useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const hide = useCallback(() => {
    Animated.timing(opacityRef.current, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start(() => {
      setVisible(false);
      setMessage(null);
    });
  }, []);

  const showToast = useCallback(
    (nextMessage: string, duration: number = 2500) => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      setMessage(nextMessage);
      setVisible(true);
      Animated.timing(opacityRef.current, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }).start(() => {
        timeoutRef.current = setTimeout(() => {
          hide();
        }, duration);
      });
    },
    [hide]
  );

  const value = useMemo<ToastContextValue>(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {visible && message ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.container,
            { opacity: opacityRef.current, bottom: spacing(4), backgroundColor: palette.canvas },
          ]}
        >
          <View style={[styles.toast, { borderColor: palette.primarySoft }]}>
            <Text style={[styles.text, { color: palette.textPrimary }]}>{message}</Text>
          </View>
        </Animated.View>
      ) : null}
    </ToastContext.Provider>
  );
};

export const useToast = (): ToastContextValue => {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return ctx;
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  toast: {
    maxWidth: '90%',
    borderRadius: radius.sm,
    borderWidth: 1,
    paddingHorizontal: spacing(2),
    paddingVertical: spacing(1.25),
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  text: {
    fontSize: 14,
    fontWeight: '600',
  },
});
