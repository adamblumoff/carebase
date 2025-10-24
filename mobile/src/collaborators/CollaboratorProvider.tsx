import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useAuth } from '../auth/AuthContext';
import {
  acceptCollaboratorInvite,
  fetchCollaborators,
  inviteCollaborator as apiInviteCollaborator,
  type CollaboratorResponse,
} from '../api/collaborators';
import { addPlanDeltaListener } from '../utils/realtime';
import type { PlanItemDelta } from '@carebase/shared';

interface CollaboratorContextValue {
  collaborators: CollaboratorResponse[];
  loading: boolean;
  error: string | null;
  canInvite: boolean;
  refresh: (options?: { silent?: boolean }) => Promise<void>;
  invite: (email: string) => Promise<CollaboratorResponse>;
  acceptInviteToken: (token: string) => Promise<CollaboratorResponse | null>;
}

const CollaboratorContext = createContext<CollaboratorContextValue | null>(null);

const sortCollaborators = (entries: CollaboratorResponse[]) =>
  [...entries].sort((a, b) => a.email.localeCompare(b.email));

export function CollaboratorProvider({ children }: { children: React.ReactNode }) {
  const auth = useAuth();
  const [collaborators, setCollaborators] = useState<CollaboratorResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [canInvite, setCanInvite] = useState(true);
  const loadPromiseRef = useRef<Promise<void> | null>(null);

  const resetState = useCallback(() => {
    setCollaborators([]);
    setError(null);
    setCanInvite(true);
  }, []);

  const loadCollaborators = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      if (auth.status !== 'signedIn') {
        if (auth.status === 'signedOut') {
          resetState();
        }
        return;
      }

      if (loadPromiseRef.current) {
        await loadPromiseRef.current;
        return;
      }

      const promise = (async () => {
        if (!silent) {
          setLoading(true);
        }
        try {
          const data = await fetchCollaborators();
          setCollaborators(sortCollaborators(data));
          setError(null);
          setCanInvite(true);
        } catch (err: any) {
          const statusCode = err?.response?.status;
          if (statusCode === 403) {
            setCanInvite(false);
            setError('Only the plan owner can manage collaborators.');
          } else {
            setError('Unable to load collaborators.');
          }
        } finally {
          loadPromiseRef.current = null;
          setLoading(false);
        }
      })();

      loadPromiseRef.current = promise;
      await promise;
    },
    [auth.status, resetState]
  );

  useEffect(() => {
    let active = true;
    if (auth.status === 'signedOut') {
      resetState();
      return;
    }

    if (auth.status !== 'signedIn') {
      return;
    }

    loadCollaborators().catch(() => {
      // errors handled in loadCollaborators
    });

    return () => {
      active = false;
      if (!active) {
        loadPromiseRef.current = null;
      }
    };
  }, [auth.status, auth.user?.id, loadCollaborators, resetState]);

  const refresh = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      if (auth.status !== 'signedIn') {
        if (auth.status === 'signedOut') {
          resetState();
        }
        return;
      }
      await loadCollaborators({ silent });
    },
    [auth.status, loadCollaborators, resetState]
  );

  const invite = useCallback(
    async (email: string) => {
      const collaborator = await apiInviteCollaborator(email);
      setCollaborators((prev) => sortCollaborators([...prev.filter((entry) => entry.id !== collaborator.id), collaborator]));
      setError(null);
      setCanInvite(true);
      return collaborator;
    },
    []
  );

  const acceptInviteToken = useCallback(
    async (token: string) => {
      try {
        const collaborator = await acceptCollaboratorInvite(token);
        await refresh();
        return collaborator;
      } catch (err) {
        throw err;
      }
    },
    [refresh]
  );

  useEffect(() => {
    if (auth.status !== 'signedIn') {
      return undefined;
    }

    let refreshScheduled = false;
    const scheduleRefresh = () => {
      if (refreshScheduled) return;
      refreshScheduled = true;
      Promise.resolve().then(() => {
        refreshScheduled = false;
        loadCollaborators({ silent: true }).catch(() => {});
      });
    };

    const unsubscribeDelta = addPlanDeltaListener((delta: PlanItemDelta) => {
      if (delta.itemType !== 'plan') {
        return;
      }
      const section = (delta.data as { section?: string } | undefined)?.section;
      if (!section || section === 'collaborators') {
        scheduleRefresh();
      }
    });

    return () => {
      unsubscribeDelta();
    };
  }, [auth.status, loadCollaborators]);

  const value = useMemo<CollaboratorContextValue>(
    () => ({
      collaborators,
      loading,
      error,
      canInvite,
      refresh,
      invite,
      acceptInviteToken,
    }),
    [collaborators, loading, error, canInvite, refresh, invite, acceptInviteToken]
  );

  return <CollaboratorContext.Provider value={value}>{children}</CollaboratorContext.Provider>;
}

export function useCollaborators(): CollaboratorContextValue {
  const context = useContext(CollaboratorContext);
  if (!context) {
    throw new Error('useCollaborators must be used within a CollaboratorProvider');
  }
  return context;
}
