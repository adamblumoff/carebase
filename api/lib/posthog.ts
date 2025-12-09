import { PostHog } from 'posthog-node';

const apiKey = process.env.POSTHOG_API_KEY;
const host = process.env.POSTHOG_HOST ?? 'https://us.i.posthog.com';

export const posthog = apiKey ? new PostHog(apiKey, { host }) : null;

process.on('beforeExit', async () => {
  if (posthog) {
    try {
      await posthog.shutdown();
    } catch (err) {
      console.warn('posthog shutdown failed', err);
    }
  }
});
