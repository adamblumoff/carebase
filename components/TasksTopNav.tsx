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
    <View className="flex-1 flex-row rounded-full border border-border bg-surface-strong p-1 dark:border-border-dark dark:bg-surface-card-dark">
      {tabs.map((tab) => {
        const active = isActiveTab(pathname, tab.key);
        const badge = badgeFor(tab.key);

        return (
          <Link key={tab.key} href={tab.href} asChild>
            <Pressable
              className={`flex-1 flex-row items-center justify-center gap-2 rounded-full px-3 py-2 ${
                active ? 'bg-primary' : ''
              }`}
              style={({ pressed }) => ({
                opacity: pressed ? 0.85 : 1,
              })}>
              <Text
                className={`text-sm font-semibold ${
                  active ? 'text-white' : 'text-text dark:text-text-dark'
                }`}>
                {tab.label}
              </Text>
              {badge !== null && badge > 0 ? (
                <View
                  className={`min-w-[20px] items-center justify-center rounded-full px-2 py-0.5 ${
                    active ? 'bg-white/20' : 'bg-primary/10'
                  }`}>
                  <Text
                    className={`text-xs font-semibold ${active ? 'text-white' : 'text-primary'}`}>
                    {badge}
                  </Text>
                </View>
              ) : null}
            </Pressable>
          </Link>
        );
      })}
    </View>
  );
};
