import React, { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { useTheme, spacing, radius } from '../theme';

type DateTimeMode = 'date' | 'time';

type Props = {
  visible: boolean;
  mode: DateTimeMode;
  value: Date;
  onDismiss: () => void;
  onConfirm: (value: Date) => void;
};

const DateTimePickerModal: React.FC<Props> = ({ visible, mode, value, onDismiss, onConfirm }) => {
  const { palette, shadow } = useTheme();
  const [tempValue, setTempValue] = useState(value);

  useEffect(() => {
    setTempValue(value);
  }, [value, visible]);

  useEffect(() => {
    if (Platform.OS === 'android' && visible) {
      DateTimePickerAndroid.open({
        value,
        mode,
        is24Hour: false,
        onChange: (event, selectedDate) => {
          if (event.type === 'set' && selectedDate) {
            onConfirm(selectedDate);
          }
          onDismiss();
        },
      });
    }
  }, [visible, mode, value, onConfirm, onDismiss]);

  const styles = useMemo(() => createStyles(), []);

  if (!visible || Platform.OS === 'android') {
    return null;
  }

  return (
    <Modal
      transparent
      animationType="fade"
      visible={visible}
      onRequestClose={onDismiss}
    >
      <View style={[styles.backdrop]}>
        <View style={[styles.container, shadow.card, { backgroundColor: palette.canvas }]}>
          <Text style={[styles.title, { color: palette.textPrimary }]}>
            {mode === 'date' ? 'Select date' : 'Select time'}
          </Text>
          <DateTimePicker
            value={tempValue}
            mode={mode}
            display="spinner"
            onChange={(_, selectedDate) => {
              if (selectedDate) {
                setTempValue(selectedDate);
              }
            }}
            style={styles.picker}
          />
          <View style={styles.actions}>
            <TouchableOpacity style={[styles.buttonSecondary, { borderColor: palette.border }]} onPress={onDismiss}>
              <Text style={[styles.buttonSecondaryText, { color: palette.textSecondary }]}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.buttonPrimary, { backgroundColor: palette.primary }]}
              onPress={() => {
                onConfirm(tempValue);
                onDismiss();
              }}
            >
              <Text style={styles.buttonPrimaryText}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const createStyles = () =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.35)',
      justifyContent: 'center',
      alignItems: 'center',
      padding: spacing(3),
    },
    container: {
      width: '100%',
      borderRadius: radius.lg,
      padding: spacing(3),
    },
    title: {
      fontSize: 16,
      fontWeight: '600',
      textAlign: 'center',
      marginBottom: spacing(2),
    },
    picker: {
      alignSelf: 'stretch',
    },
    actions: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: spacing(2),
      marginTop: spacing(3),
    },
    buttonSecondary: {
      flex: 1,
      borderWidth: 1,
      borderRadius: radius.sm,
      paddingVertical: spacing(1.25),
      alignItems: 'center',
    },
    buttonSecondaryText: {
      fontSize: 15,
      fontWeight: '600',
    },
    buttonPrimary: {
      flex: 1,
      borderRadius: radius.sm,
      paddingVertical: spacing(1.25),
      alignItems: 'center',
    },
    buttonPrimaryText: {
      color: '#ffffff',
      fontSize: 15,
      fontWeight: '700',
    },
  });

export default DateTimePickerModal;
