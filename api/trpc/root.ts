import { taskRouter } from '../modules/tasks/router';
import { router } from './trpc';
import { userThemeRouter } from '../modules/user-theme/router';
import { sourcesRouter } from '../modules/sources/router';
import { ingestionRouter } from '../modules/ingestion/router';
import { watchRouter } from '../modules/watch/router';
import { ingestionEventsRouter } from '../modules/ingestion/events';

export const appRouter = router({
  tasks: taskRouter,
  userTheme: userThemeRouter,
  sources: sourcesRouter,
  ingestion: ingestionRouter,
  watch: watchRouter,
  ingestionEvents: ingestionEventsRouter,
});

export type AppRouter = typeof appRouter;
