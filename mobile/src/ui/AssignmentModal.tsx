import React, { useMemo } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import type { CollaboratorResponse } from '../api/collaborators';
import { useTheme, spacing, radius, type Palette, type Shadow } from '../theme';

interface AssignmentModalProps {
  visible: boolean;
  selectedId: number | null;
  collaborators: CollaboratorResponse[];
  loading?: boolean;
  title?: string;
  emptyMessage?: string;
  onSelect: (collaboratorId: number | null) => void;
  onClose: () => void;
}

export const AssignmentModal: React.FC<AssignmentModalProps> = ({
  visible,
  selectedId,
  collaborators,
  loading = false,
  title = 'Assign to…',
  emptyMessage = 'Invite a collaborator to assign this item.',
  onSelect,
  onClose,
}) => {
  const { palette, shadow } = useTheme();
  const styles = useMemo(() => createStyles(palette, shadow), [palette, shadow]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={() => {
        if (!loading) onClose();
      }}
    >
      <View style={styles.modalBackdrop}>
        <View style={[styles.modalCard, shadow.card]}>
          <Text style={styles.modalTitle}>{title}</Text>
          <TouchableOpacity
            style={[
              styles.modalOption,
              selectedId === null && styles.modalOptionSelected,
            ]}
            onPress={() => onSelect(null)}
            disabled={loading}
          >
            <Text style={styles.modalOptionText}>
              {loading && selectedId === null ? 'Assigning…' : 'Unassigned'}
            </Text>
          </TouchableOpacity>
          {collaborators.length === 0 ? (
            <Text style={styles.modalEmpty}>{emptyMessage}</Text>
          ) : (
            collaborators.map((collaborator) => {
              const isSelected = collaborator.id === selectedId;
              return (
                <TouchableOpacity
                  key={collaborator.id}
                  style={[
                    styles.modalOption,
                    isSelected && styles.modalOptionSelected,
                  ]}
                  onPress={() => onSelect(collaborator.id)}
                  disabled={loading}
                >
                  <Text style={styles.modalOptionText}>
                    {loading && isSelected ? 'Assigning…' : collaborator.email}
                  </Text>
                </TouchableOpacity>
              );
            })
          )}
          <TouchableOpacity
            style={styles.modalCancel}
            onPress={onClose}
            disabled={loading}
          >
            <Text style={styles.modalCancelText}>Close</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const createStyles = (palette: Palette, shadow: Shadow) =>
  StyleSheet.create({
    modalBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: spacing(3),
    },
    modalCard: {
      backgroundColor: palette.surface,
      borderRadius: radius.md,
      padding: spacing(3),
      width: '100%',
      maxWidth: 340,
      ...shadow.card,
    },
    modalTitle: {
      fontSize: 18,
      fontWeight: '600',
      color: palette.textPrimary,
      marginBottom: spacing(2),
      textAlign: 'center',
    },
    modalOption: {
      paddingVertical: spacing(1),
      paddingHorizontal: spacing(1.5),
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: 'transparent',
      marginBottom: spacing(1),
      backgroundColor: palette.surfaceMuted,
    },
    modalOptionSelected: {
      borderColor: palette.primary,
      backgroundColor: palette.primarySoft,
    },
    modalOptionText: {
      color: palette.textPrimary,
      fontSize: 14,
    },
    modalEmpty: {
      marginTop: spacing(1),
      fontSize: 13,
      color: palette.textMuted,
      textAlign: 'center',
    },
    modalCancel: {
      marginTop: spacing(2),
      alignSelf: 'center',
      paddingVertical: spacing(1),
      paddingHorizontal: spacing(2.5),
    },
    modalCancelText: {
      color: palette.primary,
      fontSize: 15,
      fontWeight: '600',
    },
  });

export default AssignmentModal;
