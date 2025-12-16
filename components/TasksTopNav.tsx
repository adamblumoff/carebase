import { Link, usePathname } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

type TabKey = 'all' | 'upcoming' | 'review';

const tabs: { key: TabKey; label: string; href: string }[] = [
  { key: 'all', label: 'All', href: '/tasks' },
  { key: 'upcoming', label: 'Upcoming', href: '/tasks/upcoming' },
  { key: 'review', label: 'Review', href: '/tasks/review' },
];

const isActiveTab = (pathname: string, key: TabKey) => {
  if (key === 'all') return pathname === '/tasks' || pathname === '/tasks/index';
  return pathname === `/tasks/${key}`;
};

export const TasksTopNav = ({
  pendingReviewCount,
  upcomingCount,
}: {
  pendingReviewCount?: number;
  upcomingCount?: number;
}) => {
  const pathname = usePathname();

  const badgeFor = (key: TabKey) => {
    if (key === 'review' && typeof pendingReviewCount === 'number') return pendingReviewCount;
    if (key === 'upcoming' && typeof upcomingCount === 'number') return upcomingCount;
    return null;
  };

  return (
    <View className="mb-3 flex-row items-center gap-2">
      {tabs.map((tab) => {
        const active = isActiveTab(pathname, tab.key);
        const badge = badgeFor(tab.key);
        return (
          <Link key={tab.key} href={tab.href} asChild>
            <Pressable
              className={`flex-row items-center gap-2 rounded-full border px-3 py-2 ${
                active ? 'border-primary bg-primary/10' : 'border-border dark:border-border-dark'
              }`}
              style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}>
              <Text
                className={`text-sm font-semibold ${
                  active ? 'text-primary' : 'text-text dark:text-text-dark'
                }`}>
                {tab.label}
              </Text>
              {badge !== null && badge > 0 ? (
                <View className="min-w-[20px] items-center justify-center rounded-full bg-primary px-2 py-0.5">
                  <Text className="text-xs font-semibold text-white">{badge}</Text>
                </View>
              ) : null}
            </Pressable>
          </Link>
        );
      })}
    </View>
  );
};

