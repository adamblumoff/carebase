export type PushSyncTarget = 'gmail' | 'calendar';

export const getPushSyncTarget = ({
  isPubsubPush,
  channelId,
  calendarChannelId,
}: {
  isPubsubPush: boolean;
  channelId?: string | null;
  calendarChannelId?: string | null;
}): PushSyncTarget => {
  if (isPubsubPush) return 'gmail';
  if (channelId && calendarChannelId && channelId === calendarChannelId) return 'calendar';
  return 'gmail';
};
