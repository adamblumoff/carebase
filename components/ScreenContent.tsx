import React from 'react';
import { Text, View } from 'react-native';

import { EditScreenInfo } from './EditScreenInfo';

type ScreenContentProps = {
  title: string;
  path: string;
  children?: React.ReactNode;
};

export const ScreenContent = ({ title, path, children }: ScreenContentProps) => {
  return (
    <View className={styles.container}>
      <Text className={styles.title}>{title}</Text>
      <View className={styles.separator} />
      <EditScreenInfo path={path} />
      {children}
    </View>
  );
};
const styles = {
  container: `flex-1 items-start gap-4 bg-surface dark:bg-surface-dark`,
  separator: `h-[1px] my-2 w-full bg-border dark:bg-border-dark`,
  title: `text-xl font-bold text-text dark:text-text-dark`,
};
