import { inferAsyncReturnType } from "@trpc/server";
import { db } from "../db/client";

export const createContext = async () => ({
    db,
});

export type Context = inferAsyncReturnType<typeof createContext>;
