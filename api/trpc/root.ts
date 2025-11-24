import { taskRouter } from '../modules/tasks/router';
import { router } from './trpc';
import { userThemeRouter } from '../modules/user-theme/router';

export const appRouter = router({
  tasks: taskRouter,
  userTheme: userThemeRouter,
});

export type AppRouter = typeof appRouter;
