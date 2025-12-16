import React, { useMemo, useState } from 'react';
import { Alert, FlatList, Modal, Pressable, Text, TextInput, View } from 'react-native';
import { Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Container } from '@/components/Container';
import { Button } from '@/components/Button';
import { trpc } from '@/lib/trpc/client';

const normalizeDomain = (value: string) => value.trim().toLowerCase().replace(/^@+/, '');

export default function SuppressedSendersScreen() {
  const utils = trpc.useUtils();
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [domainInput, setDomainInput] = useState('');

  const listQuery = trpc.senderSuppressions.list.useQuery(
    { includeUnsuppressed: true },
    { staleTime: 30 * 1000 }
  );

  const suppressed = useMemo(() => {
    const rows = listQuery.data ?? [];
    return {
      suppressed: rows.filter((r) => r.suppressed),
      unsuppressed: rows.filter((r) => !r.suppressed),
    };
  }, [listQuery.data]);

  const suppress = trpc.senderSuppressions.suppress.useMutation({
    onMutate: async (input) => {
      const nextDomain = normalizeDomain(input.senderDomain);
      await utils.senderSuppressions.list.cancel({ includeUnsuppressed: true });
      const previous = utils.senderSuppressions.list.getData({ includeUnsuppressed: true });
      const optimistic = {
        id: `temp-${Date.now()}`,
        caregiverId: 'me',
        provider: 'gmail' as const,
        senderDomain: nextDomain,
        ignoreCount: 0,
        suppressed: true,
        lastIgnoredAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      utils.senderSuppressions.list.setData({ includeUnsuppressed: true }, (current) => {
        const existing = current ?? [];
        const without = existing.filter((r) => r.senderDomain !== nextDomain);
        return [optimistic, ...without];
      });

      return { previous };
    },
    onError: (err, _input, ctx) => {
      console.error('senderSuppressions.suppress failed', err);
      if (ctx?.previous) {
        utils.senderSuppressions.list.setData({ includeUnsuppressed: true }, ctx.previous);
      }
    },
    onSuccess: (row) => {
      utils.senderSuppressions.list.setData({ includeUnsuppressed: true }, (current) => {
        const existing = current ?? [];
        const without = existing.filter((r) => r.senderDomain !== row.senderDomain);
        return [row, ...without];
      });
    },
    onSettled: () => {
      utils.senderSuppressions.list.invalidate({ includeUnsuppressed: true });
      utils.senderSuppressions.stats.invalidate();
    },
  });

  const unsuppress = trpc.senderSuppressions.unsuppress.useMutation({
    onMutate: async (input) => {
      await utils.senderSuppressions.list.cancel({ includeUnsuppressed: true });
      const previous = utils.senderSuppressions.list.getData({ includeUnsuppressed: true });

      utils.senderSuppressions.list.setData({ includeUnsuppressed: true }, (current) => {
        const rows = current ?? [];
        return rows.map((r) =>
          r.id === input.id
            ? { ...r, suppressed: false, ignoreCount: input.resetCount ? 0 : r.ignoreCount }
            : r
        );
      });

      return { previous };
    },
    onError: (err, _input, ctx) => {
      console.error('senderSuppressions.unsuppress failed', err);
      if (ctx?.previous) {
        utils.senderSuppressions.list.setData({ includeUnsuppressed: true }, ctx.previous);
      }
    },
    onSuccess: (row) => {
      utils.senderSuppressions.list.setData({ includeUnsuppressed: true }, (current) => {
        const rows = current ?? [];
        return rows.map((r) => (r.id === row.id ? row : r));
      });
    },
    onSettled: () => {
      utils.senderSuppressions.list.invalidate({ includeUnsuppressed: true });
      utils.senderSuppressions.stats.invalidate();
    },
  });

  const remove = trpc.senderSuppressions.remove.useMutation({
    onMutate: async (input) => {
      await utils.senderSuppressions.list.cancel({ includeUnsuppressed: true });
      const previous = utils.senderSuppressions.list.getData({ includeUnsuppressed: true });
      utils.senderSuppressions.list.setData({ includeUnsuppressed: true }, (current) => {
        const rows = current ?? [];
        return rows.filter((r) => r.id !== input.id);
      });
      return { previous };
    },
    onError: (err, _input, ctx) => {
      console.error('senderSuppressions.remove failed', err);
      if (ctx?.previous) {
        utils.senderSuppressions.list.setData({ includeUnsuppressed: true }, ctx.previous);
      }
    },
    onSettled: () => {
      utils.senderSuppressions.list.invalidate({ includeUnsuppressed: true });
      utils.senderSuppressions.stats.invalidate();
    },
  });

  const confirmRemove = (id: string) => {
    Alert.alert('Remove domain', 'Remove this domain from the list?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => remove.mutate({ id }) },
    ]);
  };

  const confirmUnsuppress = (id: string) => {
    Alert.alert('Unsuppress', 'Allow this domain again?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Unsuppress', onPress: () => unsuppress.mutate({ id }) },
      {
        text: 'Unsuppress + reset count',
        onPress: () => unsuppress.mutate({ id, resetCount: true }),
      },
    ]);
  };

  const submitAdd = () => {
    const normalized = normalizeDomain(domainInput);
    if (!normalized) return;
    suppress.mutate({ senderDomain: normalized });
    setDomainInput('');
    setIsAddOpen(false);
  };

  const renderRow = (row: (typeof listQuery.data)[number]) => {
    return (
      <View className="mb-3 w-full rounded-xl border border-border bg-white p-4 dark:border-border-dark dark:bg-surface-card-dark">
        <View className="flex-row items-center justify-between">
          <View className="flex-1 pr-3">
            <Text className="text-base font-semibold text-text dark:text-text-dark">
              {row.senderDomain}
            </Text>
            <Text className="mt-1 text-sm text-text-muted dark:text-text-muted-dark">
              Ignored {row.ignoreCount} time{row.ignoreCount === 1 ? '' : 's'}
            </Text>
          </View>
          <View className="flex-row items-center gap-2">
            {row.suppressed ? (
              <Pressable
                onPress={() => confirmUnsuppress(row.id)}
                className="rounded-full bg-surface px-3 py-2 dark:bg-surface-strong">
                <Text className="text-sm font-semibold text-text dark:text-text-dark">
                  Unsuppress
                </Text>
              </Pressable>
            ) : (
              <Pressable
                onPress={() => suppress.mutate({ senderDomain: row.senderDomain })}
                className="rounded-full bg-surface px-3 py-2 dark:bg-surface-strong">
                <Text className="text-sm font-semibold text-text dark:text-text-dark">
                  Suppress
                </Text>
              </Pressable>
            )}
            <Pressable onPress={() => confirmRemove(row.id)} className="p-2">
              <Ionicons name="trash-outline" size={18} color="#9B1C1C" />
            </Pressable>
          </View>
        </View>
      </View>
    );
  };

  const allRows = listQuery.data ?? [];
  const isBusy = suppress.isLoading || unsuppress.isLoading || remove.isLoading;

  return (
    <View className="flex flex-1 bg-surface px-4 dark:bg-surface-dark">
      <Stack.Screen
        options={{
          title: 'Suppressed senders',
        }}
      />
      <Container>
        <View className="mt-4 w-full gap-3 rounded-xl border border-border bg-white p-4 dark:border-border-dark dark:bg-surface-card-dark">
          <Text className="text-sm text-text-muted dark:text-text-muted-dark">
            After you ignore tasks from the same sender domain 3 times, we suppress it
            automatically. Add domains here to suppress them immediately.
          </Text>
          <Button
            title={isBusy ? 'Working…' : 'Add domain'}
            onPress={() => setIsAddOpen(true)}
            disabled={isBusy}
          />
        </View>

        <View className="mt-6 w-full">
          {listQuery.isLoading ? (
            <Text className="text-sm text-text-muted dark:text-text-muted-dark">Loading…</Text>
          ) : allRows.length === 0 ? (
            <Text className="text-sm text-text-muted dark:text-text-muted-dark">
              No suppressed senders yet.
            </Text>
          ) : (
            <FlatList
              data={[...suppressed.suppressed, ...suppressed.unsuppressed]}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => renderRow(item)}
              showsVerticalScrollIndicator={false}
            />
          )}
        </View>
      </Container>

      <Modal
        visible={isAddOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setIsAddOpen(false)}>
        <Pressable
          className="flex-1 justify-center bg-black/40 px-4"
          onPress={() => setIsAddOpen(false)}>
          <Pressable
            className="w-full rounded-2xl bg-white p-4 dark:bg-surface-card-dark"
            onPress={(e) => e.stopPropagation()}>
            <Text className="text-lg font-semibold text-text dark:text-text-dark">Add domain</Text>
            <Text className="mt-1 text-sm text-text-muted dark:text-text-muted-dark">
              Example: 1800contacts.com
            </Text>
            <TextInput
              value={domainInput}
              onChangeText={setDomainInput}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="example.com"
              placeholderTextColor="#6B7280"
              className="mt-3 rounded-xl border border-border bg-white p-3 text-base text-text dark:border-border-dark dark:bg-surface-dark dark:text-text-dark"
            />
            <View className="mt-4 flex-row gap-3">
              <Pressable
                className="flex-1 items-center rounded-[28px] bg-surface p-4 dark:bg-surface-strong"
                onPress={() => setIsAddOpen(false)}>
                <Text className="text-base font-semibold" style={{ color: '#000' }}>
                  Cancel
                </Text>
              </Pressable>
              <Pressable
                className="flex-1 items-center rounded-[28px] bg-primary p-4 dark:bg-primary-deep"
                onPress={submitAdd}
                disabled={!domainInput.trim()}>
                <Text className="text-base font-semibold text-text dark:text-text-dark">Add</Text>
              </Pressable>
            </View>
            {suppress.error ? (
              <Text className="mt-3 text-sm text-red-700">{String(suppress.error.message)}</Text>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
