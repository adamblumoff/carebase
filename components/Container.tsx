import { SafeAreaView } from 'react-native-safe-area-context';
import React from 'react';

type Props = {
  children: React.ReactNode;
  className?: string;
};

export const Container = ({ children, className }: Props) => {
  const classes = className ?? 'flex flex-1 px-6 pb-6 pt-4';
  return (
    <SafeAreaView edges={['left', 'right']} className={classes}>
      {children}
    </SafeAreaView>
  );
};
