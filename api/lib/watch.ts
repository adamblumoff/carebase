import { randomUUID } from 'crypto';
import { google } from 'googleapis';

import { db } from '../db/client';
import { sources } from '../db/schema';
import { syncSource } from '../modules/ingestion/router';
import { syncCalendarSource } from '../modules/ingestion/calendar';
import { debounceRun } from './pubsub';
import { createGmailClient } from './google';
import { eq } from 'drizzle-orm';

const useProd =
  process.env.EXPO_PUBLIC_APP_ENV === 'prod' ||
  process.env.APP_ENV === 'prod' ||
  process.env.NODE_ENV === 'production';

const topicShort = useProd
  ? process.env.GOOGLE_PUBSUB_TOPIC_PROD
  : process.env.GOOGLE_PUBSUB_TOPIC_DEV;

const pubsubProject = process.env.GOOGLE_PUBSUB_PROJECT;

const webhookUrl = useProd ? process.env.GOOGLE_WEBHOOK_URL_PROD : process.env.GOOGLE_WEBHOOK_URL;

const getWebhookAddress = () => {
  if (webhookUrl) return webhookUrl;
  // Derive from configured OAuth redirect host as a fallback
  const redirect = process.env.GOOGLE_REDIRECT_URI;
  try {
    if (redirect) {
      const u = new URL(redirect);
      u.pathname = '/webhooks/google/push';
      u.search = '';
      return u.toString();
    }
  } catch {
    // ignore
  }
  return undefined;
};

const toTopicPath = (short?: string) => {
  if (!short) return undefined;
  if (short.startsWith('projects/')) return short;
  if (!pubsubProject) return undefined;
  return `projects/${pubsubProject}/topics/${short}`;
};

export const getWatchTopic = () => toTopicPath(topicShort);

export const registerGmailWatch = async (
  gmail: ReturnType<typeof google.gmail>,
  callbackToken?: string
) => {
  const topicName = getWatchTopic();
  if (!topicName) throw new Error('Missing Pub/Sub topic env');

  const res = await gmail.users.watch({
    userId: 'me',
    requestBody: {
      topicName,
      labelIds: ['INBOX'],
      labelFilterAction: 'include',
      labelIdsToAdd: [],
      labelIdsToRemove: [],
      historyTypes: ['messageAdded'],
    },
  });

  return {
    historyId: res.data.historyId ?? null,
    watchId: res.data.expiration ? res.data.expiration.toString() : (res.data.id ?? null),
    expiration: res.data.expiration ? new Date(Number(res.data.expiration)) : null,
  };
};

export const registerCalendarWatch = async (
  calendar: ReturnType<typeof google.calendar>,
  callbackToken?: string
) => {
  const address = getWebhookAddress();
  if (!address) throw new Error('Missing webhook URL env for calendar watch');

  const channelId = randomUUID();

  const res = await calendar.events.watch({
    calendarId: 'primary',
    requestBody: {
      id: channelId,
      type: 'web_hook',
      address,
      token: callbackToken,
    },
  });

  return {
    channelId,
    resourceId: res.data.resourceId ?? null,
    expiration: res.data.expiration ? new Date(Number(res.data.expiration)) : null,
    syncToken: res.data.nextSyncToken ?? null,
  };
};

const nowPlus = (ms: number) => new Date(Date.now() + ms);

export const needsRenewal = (source: typeof sources.$inferSelect) => {
  if (!source.watchExpiration) return true;
  return source.watchExpiration < nowPlus(24 * 60 * 60 * 1000);
};

export const renewSource = async (source: typeof sources.$inferSelect) => {
  const { gmail, auth } = createGmailClient(source.refreshToken);
  const gmailWatch = await registerGmailWatch(gmail);
  const calendarWatch = await registerCalendarWatch(google.calendar({ version: 'v3', auth }));

  await db
    .update(sources)
    .set({
      watchId: gmailWatch.watchId ?? source.watchId,
      watchExpiration: gmailWatch.expiration ?? source.watchExpiration,
      historyId: gmailWatch.historyId ?? source.historyId,
      calendarChannelId: calendarWatch.channelId ?? source.calendarChannelId,
      calendarResourceId: calendarWatch.resourceId ?? source.calendarResourceId,
      calendarSyncToken: calendarWatch.syncToken ?? source.calendarSyncToken,
      updatedAt: new Date(),
    })
    .where(eq(sources.id, source.id));
};

export const fallbackPoll = async (source: typeof sources.$inferSelect) => {
  // simple debounce to avoid overlap
  debounceRun(`poll-${source.id}`, 0, async () => {
    if (source.calendarChannelId) {
      await syncCalendarSource({
        ctx: { db },
        sourceId: source.id,
        caregiverId: source.caregiverId,
      });
    }
    await syncSource({
      ctx: { db },
      sourceId: source.id,
      caregiverIdOverride: source.caregiverId,
      reason: 'poll',
    });
  });
};
