export type SetActiveFn = (params: { session: string }) => Promise<void> | void;

export interface ClerkAuthSnapshot {
  sessionId?: string | null;
  session?: { id?: string | null } | null;
  isSignedIn?: boolean;
  setActive?: SetActiveFn | null;
}

export const resolveSessionId = (
  candidate: string | null | undefined,
  clerkAuth: ClerkAuthSnapshot
): string | null => {
  if (candidate && candidate.length > 0) {
    return candidate;
  }
  if (clerkAuth.sessionId && clerkAuth.sessionId.length > 0) {
    return clerkAuth.sessionId;
  }
  const inferred = clerkAuth.session?.id;
  return typeof inferred === 'string' && inferred.length > 0 ? inferred : null;
};

export const isAlreadySignedInError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const anyError = error as {
    message?: string;
    errors?: Array<{ message?: string; code?: string }>;
  };

  const directMessage = anyError.message ?? anyError.errors?.[0]?.message;
  if (typeof directMessage === 'string' && directMessage.toLowerCase().includes('already signed in')) {
    return true;
  }

  if (Array.isArray(anyError.errors)) {
    return anyError.errors.some(
      (entry) => typeof entry?.code === 'string' && entry.code.includes('session')
    );
  }

  return false;
};

export interface FinishSignInArgs {
  candidateSessionId?: string | null;
  clerkAuth: ClerkAuthSnapshot;
  activeSetter?: SetActiveFn | null;
  fallbackActiveSetter?: SetActiveFn | null;
  signIn: () => Promise<void> | void;
}

export async function finishSignInWithFallback({
  candidateSessionId,
  clerkAuth,
  activeSetter,
  fallbackActiveSetter,
  signIn
}: FinishSignInArgs): Promise<boolean> {
  const sessionToActivate = resolveSessionId(candidateSessionId ?? null, clerkAuth);

  if (!sessionToActivate) {
    if (clerkAuth.isSignedIn) {
      await signIn();
      return true;
    }
    return false;
  }

  const setter = activeSetter ?? fallbackActiveSetter ?? clerkAuth.setActive ?? null;

  if (setter) {
    try {
      await setter({ session: sessionToActivate });
    } catch (error: any) {
      const message = typeof error?.message === 'string' ? error.message.toLowerCase() : '';
      if (!message.includes('already active')) {
        console.warn('[Auth] Unable to activate Clerk session', {
          sessionId: sessionToActivate,
          error
        });
      }
    }
  }

  await signIn();
  return true;
}
