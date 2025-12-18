import { Stack } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Pressable,
  Platform,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';

import { Container } from '@/components/Container';
import { trpc } from '@/lib/trpc/client';

type ContactDraft = {
  id?: string;
  name: string;
  relationship?: string;
  phone?: string;
  email?: string;
  address?: string;
  isEmergency?: boolean;
};

export default function CareProfileScreen() {
  const utils = trpc.useUtils();
  const [isBasicsOpen, setIsBasicsOpen] = useState(false);
  const [isContactOpen, setIsContactOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [showDobPicker, setShowDobPicker] = useState(false);
  const [basicsDraft, setBasicsDraft] = useState({
    fullName: '',
    dob: '',
    notes: '',
  });
  const [dobDate, setDobDate] = useState<Date | null>(null);
  const [contactDraft, setContactDraft] = useState<ContactDraft>({
    name: '',
    relationship: '',
    phone: '',
    email: '',
    address: '',
    isEmergency: false,
  });

  const profileQuery = trpc.careProfile.get.useQuery(undefined, {
    staleTime: 30 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  const documentsQuery = trpc.documents.list.useQuery(undefined, {
    staleTime: 30 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  const membershipQuery = trpc.careRecipients.my.useQuery(undefined, {
    staleTime: 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const isOwner = membershipQuery.data?.membership.role === 'owner';

  useEffect(() => {
    if (!profileQuery.data?.basics) return;
    setBasicsDraft({
      fullName: profileQuery.data.basics.fullName ?? '',
      dob: profileQuery.data.basics.dob ?? '',
      notes: profileQuery.data.basics.notes ?? '',
    });
    const nextDob = (() => {
      if (!profileQuery.data.basics.dob) return null;
      const [year, month, day] = profileQuery.data.basics.dob.split('-').map(Number);
      if (!year || !month || !day) return null;
      const localDate = new Date(year, month - 1, day);
      return Number.isNaN(localDate.getTime()) ? null : localDate;
    })();
    setDobDate(nextDob && !Number.isNaN(nextDob.getTime()) ? nextDob : null);
  }, [profileQuery.data?.basics]);

  const upsertBasics = trpc.careProfile.upsertBasics.useMutation({
    onSuccess: () => {
      void utils.careProfile.get.invalidate();
      setIsBasicsOpen(false);
    },
    onError: (error) => {
      Alert.alert('Could not save basics', error.message);
    },
  });

  const upsertContact = trpc.careProfile.upsertContact.useMutation({
    onSuccess: () => {
      void utils.careProfile.get.invalidate();
      setIsContactOpen(false);
    },
    onError: (error) => {
      Alert.alert('Could not save contact', error.message);
    },
  });

  const deleteContact = trpc.careProfile.deleteContact.useMutation({
    onSuccess: () => {
      void utils.careProfile.get.invalidate();
    },
    onError: (error) => {
      Alert.alert('Could not delete contact', error.message);
    },
  });

  const createUploadUrl = trpc.documents.createUploadUrl.useMutation();
  const confirmUpload = trpc.documents.confirmUpload.useMutation({
    onSuccess: () => {
      void utils.documents.list.invalidate();
    },
  });

  const deleteDocument = trpc.documents.delete.useMutation({
    onSuccess: () => {
      void utils.documents.list.invalidate();
    },
  });

  const exportQuery = trpc.exports.weeklySummary.useQuery(undefined, {
    enabled: false,
  });

  const closeBasics = () => {
    setShowDobPicker(false);
    setIsBasicsOpen(false);
  };

  const openNewContact = () => {
    setContactDraft({
      name: '',
      relationship: '',
      phone: '',
      email: '',
      address: '',
      isEmergency: false,
    });
    setIsContactOpen(true);
  };

  const openEditContact = (contact: any) => {
    setContactDraft({
      id: contact.id,
      name: contact.name ?? '',
      relationship: contact.relationship ?? '',
      phone: contact.phone ?? '',
      email: contact.email ?? '',
      address: contact.address ?? '',
      isEmergency: contact.isEmergency ?? false,
    });
    setIsContactOpen(true);
  };

  const handleDeleteContact = (contactId: string) => {
    Alert.alert('Delete contact', 'Remove this contact?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => deleteContact.mutate({ id: contactId }),
      },
    ]);
  };

  const uploadDocument = async () => {
    if (!isOwner) return;
    try {
      const result = await DocumentPicker.getDocumentAsync({
        multiple: false,
        copyToCacheDirectory: true,
        type: ['image/*', 'application/pdf'],
      });
      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];
      const filename = asset.name ?? 'document';
      const mimeType = asset.mimeType ?? 'application/octet-stream';
      let sizeBytes = asset.size ?? null;

      if (!sizeBytes) {
        const info = await FileSystem.getInfoAsync(asset.uri);
        sizeBytes = info.size ?? null;
      }

      if (!sizeBytes) {
        Alert.alert('Upload failed', 'Could not determine file size.');
        return;
      }

      setIsUploading(true);
      const { uploadUrl, storageKey } = await createUploadUrl.mutateAsync({
        filename,
        mimeType,
        sizeBytes,
      });

      await FileSystem.uploadAsync(uploadUrl, asset.uri, {
        httpMethod: 'PUT',
        uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
        headers: { 'Content-Type': mimeType },
      });

      await confirmUpload.mutateAsync({
        filename,
        mimeType,
        sizeBytes,
        storageKey,
      });
    } catch (error: any) {
      Alert.alert('Upload failed', error?.message ?? 'Please try again.');
    } finally {
      setIsUploading(false);
    }
  };

  const exportWeeklySummary = async () => {
    try {
      setIsExporting(true);
      const result = await exportQuery.refetch();
      const url = result.data?.url;
      if (!url) {
        Alert.alert('Export failed', 'No file was generated.');
        return;
      }

      const filename = `weekly-summary-${Date.now()}.pdf`;
      const downloadPath = `${FileSystem.cacheDirectory}${filename}`;
      const download = await FileSystem.downloadAsync(url, downloadPath);
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(download.uri);
      } else {
        await Linking.openURL(url);
      }
    } catch (error: any) {
      Alert.alert('Export failed', error?.message ?? 'Please try again.');
    } finally {
      setIsExporting(false);
    }
  };

  const handleDeleteDocument = (documentId: string) => {
    Alert.alert('Delete document', 'Delete this file and its extracted tasks?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => deleteDocument.mutate({ id: documentId }),
      },
    ]);
  };

  const formatDob = (date: Date | null) => {
    if (!date) return '';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const handleDobChange = (_event: DateTimePickerEvent, selected?: Date) => {
    const eventType = _event?.type;
    if (eventType === 'dismissed') {
      setShowDobPicker(false);
      return;
    }
    if (selected) {
      const localDate = new Date(selected.getFullYear(), selected.getMonth(), selected.getDate());
      setDobDate(localDate);
      setBasicsDraft((prev) => ({ ...prev, dob: formatDob(localDate) }));
    }
    if (Platform.OS !== 'ios') {
      setShowDobPicker(false);
    }
  };

  const contacts = profileQuery.data?.contacts ?? [];
  const documents = documentsQuery.data ?? [];

  const basicsDisplayName =
    profileQuery.data?.basics?.fullName ?? profileQuery.data?.careRecipientName ?? 'Care recipient';

  const placeholderCard = (label: string, body: string) => (
    <View className="rounded-2xl border border-border bg-white p-4 dark:border-border-dark dark:bg-surface-card-dark">
      <Text className="text-sm font-semibold text-text dark:text-text-dark">{label}</Text>
      <Text className="mt-1 text-xs text-text-muted dark:text-text-muted-dark">{body}</Text>
    </View>
  );

  return (
    <View className="flex flex-1 bg-surface dark:bg-surface-dark">
      <Stack.Screen options={{ title: 'Care Profile' }} />
      <Container className="px-4 pb-8 pt-4">
        <View className="mb-6 gap-3 rounded-2xl border border-border bg-white p-4 dark:border-border-dark dark:bg-surface-card-dark">
          <View className="flex-row items-start justify-between">
            <View className="flex-1">
              <Text className="text-base font-semibold text-text dark:text-text-dark">Basics</Text>
              <Text className="mt-1 text-xs text-text-muted dark:text-text-muted-dark">
                Structured summary for the care team.
              </Text>
            </View>
            {isOwner ? (
              <Pressable
                onPress={() => setIsBasicsOpen(true)}
                className="rounded-full border border-border px-3 py-2 dark:border-border-dark"
                style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}>
                <Text className="text-sm font-semibold text-primary">Edit</Text>
              </Pressable>
            ) : null}
          </View>
          <View className="gap-2">
            <Text className="text-sm text-text dark:text-text-dark">Name: {basicsDisplayName}</Text>
            <Text className="text-sm text-text-muted dark:text-text-muted-dark">
              DOB: {profileQuery.data?.basics?.dob ?? '—'}
            </Text>
            <Text className="text-sm text-text-muted dark:text-text-muted-dark">
              Notes: {profileQuery.data?.basics?.notes ?? '—'}
            </Text>
          </View>
        </View>

        <View className="mb-6 gap-3 rounded-2xl border border-border bg-white p-4 dark:border-border-dark dark:bg-surface-card-dark">
          <View className="flex-row items-start justify-between">
            <View className="flex-1">
              <Text className="text-base font-semibold text-text dark:text-text-dark">
                Contacts
              </Text>
              <Text className="mt-1 text-xs text-text-muted dark:text-text-muted-dark">
                Key people involved in care.
              </Text>
            </View>
            {isOwner ? (
              <Pressable
                onPress={openNewContact}
                className="rounded-full border border-border px-3 py-2 dark:border-border-dark"
                style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}>
                <Text className="text-sm font-semibold text-primary">Add</Text>
              </Pressable>
            ) : null}
          </View>
          {contacts.length ? (
            <View className="gap-3">
              {contacts.map((contact) => (
                <View
                  key={contact.id}
                  className="rounded-2xl border border-border bg-surface px-4 py-3 dark:border-border-dark dark:bg-surface-dark">
                  <View className="flex-row items-start justify-between">
                    <View className="flex-1">
                      <Text className="text-sm font-semibold text-text dark:text-text-dark">
                        {contact.name}
                      </Text>
                      <Text className="text-xs text-text-muted dark:text-text-muted-dark">
                        {contact.relationship ?? 'Contact'}
                        {contact.isEmergency ? ' • Emergency' : ''}
                      </Text>
                      {contact.phone ? (
                        <Text className="text-xs text-text-muted dark:text-text-muted-dark">
                          {contact.phone}
                        </Text>
                      ) : null}
                      {contact.email ? (
                        <Text className="text-xs text-text-muted dark:text-text-muted-dark">
                          {contact.email}
                        </Text>
                      ) : null}
                    </View>
                    {isOwner ? (
                      <View className="flex-row gap-2">
                        <Pressable
                          onPress={() => openEditContact(contact)}
                          style={({ pressed }) => ({
                            opacity: pressed ? 0.7 : 1,
                          })}>
                          <Ionicons name="create-outline" size={18} color="#4A8F6A" />
                        </Pressable>
                        <Pressable
                          onPress={() => handleDeleteContact(contact.id)}
                          style={({ pressed }) => ({
                            opacity: pressed ? 0.7 : 1,
                          })}>
                          <Ionicons name="trash-outline" size={18} color="#B91C1C" />
                        </Pressable>
                      </View>
                    ) : null}
                  </View>
                </View>
              ))}
            </View>
          ) : (
            <Text className="text-sm text-text-muted dark:text-text-muted-dark">
              No contacts yet.
            </Text>
          )}
        </View>

        <View className="mb-6 gap-3 rounded-2xl border border-border bg-white p-4 dark:border-border-dark dark:bg-surface-card-dark">
          <View className="flex-row items-start justify-between">
            <View className="flex-1">
              <Text className="text-base font-semibold text-text dark:text-text-dark">
                Documents
              </Text>
              <Text className="mt-1 text-xs text-text-muted dark:text-text-muted-dark">
                Upload photos or PDFs to extract tasks.
              </Text>
            </View>
            {isOwner ? (
              <Pressable
                onPress={uploadDocument}
                disabled={isUploading}
                className="rounded-full bg-primary px-4 py-2 dark:bg-primary-deep"
                style={({ pressed }) => ({
                  opacity: isUploading ? 0.6 : pressed ? 0.85 : 1,
                })}>
                {isUploading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text className="text-sm font-semibold text-white">Upload</Text>
                )}
              </Pressable>
            ) : null}
          </View>
          {documents.length ? (
            <View className="gap-3">
              {documents.map((doc) => (
                <View
                  key={doc.id}
                  className="rounded-2xl border border-border bg-surface px-4 py-3 dark:border-border-dark dark:bg-surface-dark">
                  <View className="flex-row items-start justify-between gap-3">
                    <View className="flex-1">
                      <Text className="text-sm font-semibold text-text dark:text-text-dark">
                        {doc.filename}
                      </Text>
                      <Text className="text-xs text-text-muted dark:text-text-muted-dark">
                        Status: {doc.status}
                      </Text>
                      {doc.errorMessage ? (
                        <Text className="text-xs text-amber-700 dark:text-amber-300">
                          {doc.errorMessage}
                        </Text>
                      ) : null}
                    </View>
                    {isOwner ? (
                      <Pressable
                        onPress={() => handleDeleteDocument(doc.id)}
                        style={({ pressed }) => ({
                          opacity: pressed ? 0.7 : 1,
                        })}>
                        <Ionicons name="trash-outline" size={18} color="#B91C1C" />
                      </Pressable>
                    ) : null}
                  </View>
                </View>
              ))}
            </View>
          ) : (
            <Text className="text-sm text-text-muted dark:text-text-muted-dark">
              No documents yet.
            </Text>
          )}
        </View>

        <View className="mb-6 gap-3 rounded-2xl border border-border bg-white p-4 dark:border-border-dark dark:bg-surface-card-dark">
          <View className="flex-row items-start justify-between">
            <View className="flex-1">
              <Text className="text-base font-semibold text-text dark:text-text-dark">
                Weekly summary
              </Text>
              <Text className="mt-1 text-xs text-text-muted dark:text-text-muted-dark">
                Export the last 7 days of updates.
              </Text>
            </View>
            <Pressable
              onPress={exportWeeklySummary}
              disabled={isExporting}
              className="rounded-full bg-primary px-4 py-2 dark:bg-primary-deep"
              style={({ pressed }) => ({
                opacity: isExporting ? 0.6 : pressed ? 0.85 : 1,
              })}>
              {isExporting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text className="text-sm font-semibold text-white">Share</Text>
              )}
            </Pressable>
          </View>
        </View>

        <View className="gap-3">
          {placeholderCard(
            'Emergency card',
            'Allergies, meds snapshot, and emergency contacts are coming soon.'
          )}
          {placeholderCard('Providers & pharmacies', 'Structured provider list is coming soon.')}
          {placeholderCard('Insurance', 'Insurance cards and details are coming soon.')}
        </View>
      </Container>

      <Modal
        visible={isBasicsOpen}
        transparent
        animationType="fade"
        onRequestClose={closeBasics}
        statusBarTranslucent>
        <Pressable
          className="flex-1 items-center justify-center bg-black/40 px-6"
          onPress={closeBasics}>
          <Pressable
            onPress={() => {}}
            className="w-full max-w-md rounded-2xl border border-border bg-surface p-5 dark:border-border-dark dark:bg-surface-card-dark">
            <View className="mb-3 flex-row items-center justify-between">
              <Text className="text-base font-semibold text-text dark:text-text-dark">
                Edit basics
              </Text>
              <Pressable
                onPress={closeBasics}
                style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
                <Ionicons name="close" size={20} color="#9CA3AF" />
              </Pressable>
            </View>

            <View className="gap-3">
              <TextInput
                value={basicsDraft.fullName}
                onChangeText={(text) => setBasicsDraft((prev) => ({ ...prev, fullName: text }))}
                placeholder="Full name"
                className="rounded-xl border border-border bg-white px-3 py-2 text-sm dark:border-border-dark dark:bg-surface-dark dark:text-text-dark"
              />
              <TextInput
                value={basicsDraft.dob}
                editable={false}
                placeholder="DOB"
                className="rounded-xl border border-border bg-white px-3 py-2 text-sm text-text-muted dark:border-border-dark dark:bg-surface-dark dark:text-text-muted-dark"
              />
              <Pressable
                onPress={() => setShowDobPicker(true)}
                className="self-start rounded-full border border-border px-3 py-2 dark:border-border-dark"
                style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}>
                <Text className="text-sm font-semibold text-primary">
                  {dobDate ? 'Change date' : 'Select date'}
                </Text>
              </Pressable>
              {showDobPicker ? (
                <View className="rounded-xl border border-border bg-white p-2 dark:border-border-dark dark:bg-surface-dark">
                  <DateTimePicker
                    value={dobDate ?? new Date()}
                    mode="date"
                    display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                    onChange={handleDobChange}
                    maximumDate={new Date()}
                  />
                  {Platform.OS === 'ios' ? (
                    <Pressable
                      onPress={() => setShowDobPicker(false)}
                      className="mt-2 self-end rounded-full border border-border px-3 py-2 dark:border-border-dark"
                      style={({ pressed }) => ({
                        opacity: pressed ? 0.8 : 1,
                      })}>
                      <Text className="text-sm font-semibold text-primary">Done</Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}
              <TextInput
                value={basicsDraft.notes}
                onChangeText={(text) => setBasicsDraft((prev) => ({ ...prev, notes: text }))}
                placeholder="Notes"
                multiline
                numberOfLines={4}
                className="rounded-xl border border-border bg-white px-3 py-2 text-sm dark:border-border-dark dark:bg-surface-dark dark:text-text-dark"
                style={{ minHeight: 90, textAlignVertical: 'top' }}
              />
            </View>

            <View className="mt-4 flex-row justify-end gap-3">
              <Pressable
                onPress={closeBasics}
                style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
                <Text className="text-sm text-text-muted">Cancel</Text>
              </Pressable>
              <Pressable
                onPress={() =>
                  upsertBasics.mutate({
                    fullName: basicsDraft.fullName,
                    dob: basicsDraft.dob || undefined,
                    notes: basicsDraft.notes || undefined,
                  })
                }
                disabled={upsertBasics.isPending || !basicsDraft.fullName.trim()}
                className="rounded-full bg-primary px-4 py-2 dark:bg-primary-deep"
                style={({ pressed }) => ({
                  opacity:
                    upsertBasics.isPending || !basicsDraft.fullName.trim()
                      ? 0.5
                      : pressed
                        ? 0.85
                        : 1,
                })}>
                <Text className="text-sm font-semibold text-white">
                  {upsertBasics.isPending ? 'Saving…' : 'Save'}
                </Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={isContactOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setIsContactOpen(false)}
        statusBarTranslucent>
        <Pressable
          className="flex-1 items-center justify-center bg-black/40 px-6"
          onPress={() => setIsContactOpen(false)}>
          <Pressable
            onPress={() => {}}
            className="w-full max-w-md rounded-2xl border border-border bg-surface p-5 dark:border-border-dark dark:bg-surface-card-dark">
            <View className="mb-3 flex-row items-center justify-between">
              <Text className="text-base font-semibold text-text dark:text-text-dark">
                {contactDraft.id ? 'Edit contact' : 'Add contact'}
              </Text>
              <Pressable
                onPress={() => setIsContactOpen(false)}
                style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
                <Ionicons name="close" size={20} color="#9CA3AF" />
              </Pressable>
            </View>

            <View className="gap-3">
              <TextInput
                value={contactDraft.name}
                onChangeText={(text) => setContactDraft((prev) => ({ ...prev, name: text }))}
                placeholder="Name"
                className="rounded-xl border border-border bg-white px-3 py-2 text-sm dark:border-border-dark dark:bg-surface-dark dark:text-text-dark"
              />
              <TextInput
                value={contactDraft.relationship ?? ''}
                onChangeText={(text) =>
                  setContactDraft((prev) => ({ ...prev, relationship: text }))
                }
                placeholder="Relationship"
                className="rounded-xl border border-border bg-white px-3 py-2 text-sm dark:border-border-dark dark:bg-surface-dark dark:text-text-dark"
              />
              <TextInput
                value={contactDraft.phone ?? ''}
                onChangeText={(text) => setContactDraft((prev) => ({ ...prev, phone: text }))}
                placeholder="Phone"
                className="rounded-xl border border-border bg-white px-3 py-2 text-sm dark:border-border-dark dark:bg-surface-dark dark:text-text-dark"
              />
              <TextInput
                value={contactDraft.email ?? ''}
                onChangeText={(text) => setContactDraft((prev) => ({ ...prev, email: text }))}
                placeholder="Email"
                autoCapitalize="none"
                keyboardType="email-address"
                className="rounded-xl border border-border bg-white px-3 py-2 text-sm dark:border-border-dark dark:bg-surface-dark dark:text-text-dark"
              />
              <TextInput
                value={contactDraft.address ?? ''}
                onChangeText={(text) => setContactDraft((prev) => ({ ...prev, address: text }))}
                placeholder="Address"
                className="rounded-xl border border-border bg-white px-3 py-2 text-sm dark:border-border-dark dark:bg-surface-dark dark:text-text-dark"
              />
              <Pressable
                onPress={() =>
                  setContactDraft((prev) => ({
                    ...prev,
                    isEmergency: !prev.isEmergency,
                  }))
                }
                className="flex-row items-center gap-2">
                <View
                  className={`h-5 w-5 rounded border ${
                    contactDraft.isEmergency
                      ? 'border-primary bg-primary'
                      : 'border-border dark:border-border-dark'
                  }`}
                />
                <Text className="text-sm text-text dark:text-text-dark">Emergency contact</Text>
              </Pressable>
            </View>

            <View className="mt-4 flex-row justify-end gap-3">
              <Pressable
                onPress={() => setIsContactOpen(false)}
                style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
                <Text className="text-sm text-text-muted">Cancel</Text>
              </Pressable>
              <Pressable
                onPress={() =>
                  upsertContact.mutate({
                    id: contactDraft.id,
                    name: contactDraft.name,
                    relationship: contactDraft.relationship || undefined,
                    phone: contactDraft.phone || undefined,
                    email: contactDraft.email || undefined,
                    address: contactDraft.address || undefined,
                    isEmergency: contactDraft.isEmergency,
                  })
                }
                disabled={upsertContact.isPending || !contactDraft.name.trim()}
                className="rounded-full bg-primary px-4 py-2 dark:bg-primary-deep"
                style={({ pressed }) => ({
                  opacity:
                    upsertContact.isPending || !contactDraft.name.trim() ? 0.5 : pressed ? 0.85 : 1,
                })}>
                <Text className="text-sm font-semibold text-white">
                  {upsertContact.isPending ? 'Saving…' : 'Save'}
                </Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
