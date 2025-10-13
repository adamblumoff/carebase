/**
 * Camera Screen
 * Redesigned capture flow for scanning bills
 */
import React, { useState } from 'react';
import {
  SafeAreaView,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  Alert,
  ActivityIndicator,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import * as ImagePicker from 'expo-image-picker';
import apiClient from '../api/client';
import { API_ENDPOINTS } from '../config';
import { palette, spacing, radius, shadow } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Camera'>;

export default function CameraScreen({ navigation }: Props) {
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);

  const requestPermissions = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission required', 'Camera access is needed to scan bills.');
      return false;
    }
    return true;
  };

  const handleTakePhoto = async () => {
    const hasPermission = await requestPermissions();
    if (!hasPermission) return;

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      quality: 0.85,
    });

    if (!result.canceled && result.assets[0]) {
      setImageUri(result.assets[0].uri);
    }
  };

  const handleChoosePhoto = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      quality: 0.85,
    });

    if (!result.canceled && result.assets[0]) {
      setImageUri(result.assets[0].uri);
    }
  };

  const handleUpload = async () => {
    if (!imageUri) return;

    setUploading(true);
    try {
      const formData = new FormData();
      const filename = imageUri.split('/').pop() || 'photo.jpg';
      const match = /\.(\w+)$/.exec(filename);
      const type = match ? `image/${match[1]}` : 'image/jpeg';

      formData.append('photo', {
        uri: imageUri,
        name: filename,
        type,
      } as any);

      const response = await apiClient.post(API_ENDPOINTS.uploadPhoto, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      const { classification, extracted, overdue } = response.data;
      const details: string[] = [];
      if (extracted?.amount) {
        details.push(`Amount due: ${formatCurrency(extracted.amount)}`);
      }
      if (extracted?.dueDate) {
        details.push(`Due date: ${extracted.dueDate}`);
      }
      if (overdue) {
        details.push('Status: overdue');
      }

      const message = details.length > 0
        ? `Captured a ${classification.type} document.\n${details.join('\n')}`
        : `Captured a ${classification.type} document.`;

      Alert.alert('Uploaded', message, [{ text: 'View plan', onPress: () => navigation.goBack() }]);
    } catch (error: any) {
      console.error('Upload error:', error);
      Alert.alert('Error', error.response?.data?.error || 'Failed to upload photo');
    } finally {
      setUploading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        {imageUri ? (
          <View style={[styles.previewCard, shadow.card]}>
            <Image source={{ uri: imageUri }} style={styles.preview} />
            <View style={styles.previewFooter}>
              <TouchableOpacity style={styles.secondaryButton} onPress={() => setImageUri(null)}>
                <Text style={styles.secondaryButtonText}>Retake</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.primaryButton, uploading && styles.primaryButtonDisabled]}
                onPress={handleUpload}
                disabled={uploading}
              >
                {uploading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.primaryButtonText}>Upload & process</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <View style={styles.content}>
            <Text style={styles.title}>Scan a bill</Text>
            <Text style={styles.subtitle}>
              Capture a clear photo of the statement to pull in amounts, due dates, and providers.
            </Text>

            <TouchableOpacity style={styles.heroAction} onPress={handleTakePhoto}>
              <Text style={styles.heroActionIcon}>📷</Text>
              <Text style={styles.heroActionText}>Take a photo</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.secondaryButton} onPress={handleChoosePhoto}>
              <Text style={styles.secondaryButtonText}>Choose from library</Text>
            </TouchableOpacity>

            <Text style={styles.helperText}>
              Tip: place the document on a flat surface with good lighting. Avoid glare for best
              results.
            </Text>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: palette.surfaceMuted,
  },
  container: {
    flex: 1,
    padding: spacing(3),
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: palette.textPrimary,
    textAlign: 'center',
  },
  subtitle: {
    marginTop: spacing(1.5),
    fontSize: 15,
    color: palette.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
  heroAction: {
    marginTop: spacing(4),
    backgroundColor: palette.primary,
    borderRadius: radius.lg,
    paddingVertical: spacing(2),
    paddingHorizontal: spacing(3),
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.card,
  },
  heroActionIcon: {
    color: '#fff',
    fontSize: 20,
    marginRight: spacing(1),
  },
  heroActionText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  secondaryButton: {
    marginTop: spacing(2),
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: palette.textMuted,
    paddingVertical: spacing(1.5),
    paddingHorizontal: spacing(3),
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: palette.textSecondary,
    fontSize: 15,
    fontWeight: '600',
  },
  helperText: {
    marginTop: spacing(3),
    fontSize: 13,
    color: palette.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  previewCard: {
    flex: 1,
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing(2),
    justifyContent: 'space-between',
    ...shadow.card,
  },
  preview: {
    width: '100%',
    height: '80%',
    borderRadius: radius.md,
  },
  previewFooter: {
    flexDirection: 'row',
    gap: spacing(2),
  },
  primaryButton: {
    flex: 1,
    backgroundColor: palette.primary,
    borderRadius: radius.sm,
    paddingVertical: spacing(1.5),
    alignItems: 'center',
  },
  primaryButtonDisabled: {
    opacity: 0.7,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
});
