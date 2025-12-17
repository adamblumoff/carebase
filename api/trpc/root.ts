import { taskRouter } from '../modules/tasks/router';
import { router } from './trpc';
import { userThemeRouter } from '../modules/user-theme/router';
import { sourcesRouter } from '../modules/sources/router';
import { ingestionRouter } from '../modules/ingestion/router';
import { watchRouter } from '../modules/watch/router';
import { ingestionEventsRouter } from '../modules/ingestion/events';
import { senderSuppressionsRouter } from '../modules/sender-suppressions/router';
import { careRecipientsRouter } from '../modules/care-recipients/router';
import { caregiversRouter } from '../modules/caregivers/router';

export const appRouter = router({
  tasks: taskRouter,
  userTheme: userThemeRouter,
  sources: sourcesRouter,
  ingestion: ingestionRouter,
  watch: watchRouter,
  ingestionEvents: ingestionEventsRouter,
  senderSuppressions: senderSuppressionsRouter,
  careRecipients: careRecipientsRouter,
  caregivers: caregiversRouter,
});

export type AppRouter = typeof appRouter;
