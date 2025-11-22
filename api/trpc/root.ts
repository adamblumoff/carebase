import { taskRouter } from "../modules/tasks/router";
import { router } from "./trpc";

export const appRouter = router({
    tasks: taskRouter,
});

export type AppRouter = typeof appRouter;
