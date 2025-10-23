interface FakeEvent {
  id: string;
  status: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: Record<string, unknown>;
  end?: Record<string, unknown>;
  extendedProperties?: {
    private?: Record<string, string>;
  };
  updated: string;
  etag: string;
  version: number;
}

interface CalendarState {
  events: Map<string, FakeEvent>;
  version: number;
  forceInvalidNextSync: boolean;
}

interface FetchResult {
  status: number;
  body?: Record<string, unknown> | null;
}

interface CalendarMetadata {
  id: string;
  summary: string;
  timeZone: string;
}

interface CalendarAclEntry {
  role: string;
  scopeType: string;
  scopeValue: string;
}

export class FakeGoogleCalendarApi {
  private calendars = new Map<string, CalendarState>();
  private calendarMetadata = new Map<string, CalendarMetadata>();
  private calendarAcls = new Map<string, Map<string, CalendarAclEntry>>();
  private requestLog: Array<{ method: string; url: string }> = [];
  private tokenCounter = 1;
  private eventCounter = 1;
  private calendarCounter = 1;
  private clockMs = Date.parse('2025-10-17T00:00:00.000Z');
  private originalFetch: typeof fetch | null = null;

  install(): void {
    if (this.originalFetch) {
      return;
    }
    this.originalFetch = globalThis.fetch;
    const handler = this.createFetchHandler();
    globalThis.fetch = handler as typeof fetch;
  }

  restore(): void {
    if (this.originalFetch) {
      globalThis.fetch = this.originalFetch;
      this.originalFetch = null;
    }
    this.requestLog = [];
    this.calendars.clear();
    this.calendarMetadata.clear();
    this.calendarAcls.clear();
    this.tokenCounter = 1;
    this.eventCounter = 1;
    this.calendarCounter = 1;
    this.clockMs = Date.parse('2025-10-17T00:00:00.000Z');
  }

  log(): Array<{ method: string; url: string }> {
    return [...this.requestLog];
  }

  seedCalendarList(calendars: Array<{ id: string; summary: string; timeZone?: string }>): void {
    for (const calendar of calendars) {
      this.calendarMetadata.set(calendar.id, {
        id: calendar.id,
        summary: calendar.summary,
        timeZone: calendar.timeZone ?? 'UTC'
      });
      this.ensureCalendar(calendar.id);
    }
  }

  seedCalendarAcl(calendarId: string, entries: Array<{ email: string; role: string }>): void {
    const acl = this.ensureCalendarAcl(calendarId);
    for (const entry of entries) {
      const normalized = entry.email.toLowerCase();
      acl.set(normalized, {
        role: entry.role,
        scopeType: 'user',
        scopeValue: normalized
      });
    }
  }

  getCalendarAcl(calendarId: string): CalendarAclEntry[] {
    const acl = this.calendarAcls.get(calendarId);
    if (!acl) {
      return [];
    }
    return Array.from(acl.values()).map((entry) => ({ ...entry }));
  }

  seedCalendar(calendarId: string, events: FakeEvent[]): void {
    const state = this.ensureCalendar(calendarId);
    state.events.clear();
    for (const event of events) {
      state.events.set(event.id, { ...event });
    }
    state.version = Math.max(
      state.version,
      ...events.map((event) => event.version ?? 0),
      events.length > 0 ? 1 : 0
    );
  }

  createRemoteEvent(calendarId: string, payload: Record<string, unknown>): FakeEvent {
    const state = this.ensureCalendar(calendarId);
    const id = payload.id && typeof payload.id === 'string' ? payload.id : `evt-${this.eventCounter++}`;
    const version = ++state.version;
    const updated = this.bumpClock();
    const event: FakeEvent = {
      id,
      status: 'confirmed',
      summary: payload.summary as string | undefined,
      description: payload.description as string | undefined,
      location: payload.location as string | undefined,
      start: payload.start as Record<string, unknown> | undefined,
      end: payload.end as Record<string, unknown> | undefined,
      extendedProperties: payload.extendedProperties as FakeEvent['extendedProperties'],
      updated,
      etag: `"${version}"`,
      version
    };
    state.events.set(id, event);
    return { ...event };
  }

  updateRemoteEvent(
    calendarId: string,
    eventId: string,
    payload: Record<string, unknown>
  ): FakeEvent | null {
    const state = this.ensureCalendar(calendarId);
    const existing = state.events.get(eventId);
    if (!existing) {
      return null;
    }
    const version = ++state.version;
    const updated = this.bumpClock();
    const next: FakeEvent = {
      ...existing,
      ...payload,
      extendedProperties: payload.extendedProperties
        ? (payload.extendedProperties as FakeEvent['extendedProperties'])
        : existing.extendedProperties,
      start: payload.start ? (payload.start as Record<string, unknown>) : existing.start,
      end: payload.end ? (payload.end as Record<string, unknown>) : existing.end,
      summary: payload.summary ? (payload.summary as string) : existing.summary,
      description: payload.description ? (payload.description as string) : existing.description,
      location: payload.location ? (payload.location as string) : existing.location,
      updated,
      etag: `"${version}"`,
      version
    };
    state.events.set(eventId, next);
    return { ...next };
  }

  forceInvalidSyncToken(calendarId: string): void {
    const state = this.ensureCalendar(calendarId);
    state.forceInvalidNextSync = true;
  }

  getEvent(calendarId: string, eventId: string): FakeEvent | null {
    const state = this.ensureCalendar(calendarId);
    const event = state.events.get(eventId);
    return event ? { ...event } : null;
  }

  private ensureCalendar(calendarId: string): CalendarState {
    const normalized = decodeURIComponent(calendarId);
    const existing = this.calendars.get(normalized);
    if (existing) {
      return existing;
    }
    if (!this.calendarMetadata.has(normalized)) {
      this.calendarMetadata.set(normalized, {
        id: normalized,
        summary: normalized,
        timeZone: 'UTC'
      });
    }
    if (!this.calendarAcls.has(normalized)) {
      this.calendarAcls.set(normalized, new Map());
    }
    const created: CalendarState = {
      events: new Map<string, FakeEvent>(),
      version: 0,
      forceInvalidNextSync: false
    };
    this.calendars.set(normalized, created);
    return created;
  }

  private createFetchHandler(): typeof fetch {
    return (async (input: any, init?: any): Promise<Response> => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method ?? (typeof input === 'object' && 'method' in input ? (input as any).method : 'GET'))
        .toString()
        .toUpperCase();
      this.requestLog.push({ method, url });

      if (!url.startsWith('https://www.googleapis.com/calendar/v3')) {
        if (this.originalFetch) {
          return this.originalFetch(input, init);
        }
        throw new Error(`Unhandled fetch URL: ${url}`);
      }

      const bodyText =
        typeof init?.body === 'string'
          ? init.body
          : init?.body instanceof Buffer
            ? init.body.toString('utf8')
            : init?.body
              ? JSON.stringify(init.body)
              : null;
      let payload: Record<string, unknown> | undefined;
      if (bodyText) {
        try {
          payload = JSON.parse(bodyText);
        } catch {
          payload = undefined;
        }
      }

      const result = this.handleCalendarRequest(url, method, payload);
      return this.buildResponse(result);
    }) as typeof fetch;
  }

  private handleCalendarRequest(url: string, method: string, payload?: Record<string, unknown>): FetchResult {
    const parsed = new URL(url);
    const segments = parsed.pathname.split('/').filter(Boolean);

    if (segments[2] === 'users' && segments[3] === 'me' && segments[4] === 'calendarList' && method === 'GET') {
      return this.handleCalendarList();
    }

    if (segments[2] === 'calendars' && segments.length === 3) {
      if (method === 'POST') {
        return this.handleInsertCalendar(payload ?? {});
      }
      if (method === 'GET') {
        return this.handleCalendarList();
      }
    }

    if (segments[2] === 'calendars' && segments.length === 4 && method === 'GET') {
      const calendarId = decodeURIComponent(segments[3]);
      return this.handleGetCalendar(calendarId);
    }

    const calendarId = segments[3] ? decodeURIComponent(segments[3]) : 'primary';
    const resource = segments[4] ?? '';

    if (resource === 'events') {
      if (method === 'POST' && segments.length > 6 && segments[6] === 'move') {
        const eventId = decodeURIComponent(segments[5]);
        const destination = parsed.searchParams.get('destination');
        return this.handleMoveEvent(calendarId, eventId, destination);
      }
      if (method === 'GET') {
        if (segments.length > 5) {
          const eventId = decodeURIComponent(segments[5]);
          return this.handleGetEvent(calendarId, eventId);
        }
        return this.handleListEvents(calendarId, parsed.searchParams);
      }
      if (method === 'POST') {
        if (segments.length > 5 && segments[5] === 'watch') {
          return this.handleWatch(calendarId);
        }
        return this.handleCreateEvent(calendarId, payload ?? {});
      }
      if (method === 'PATCH' && segments.length > 5) {
        const eventId = decodeURIComponent(segments[5]);
        return this.handlePatchEvent(calendarId, eventId, payload ?? {});
      }
    }

    if (resource === 'acl') {
      if (method === 'GET') {
        return this.handleAclList(calendarId);
      }
      if (method === 'POST') {
        return this.handleAclInsert(calendarId, payload ?? {});
      }
    }

    if (segments[2] === 'channels' && segments[3] === 'stop' && method === 'POST') {
      return { status: 204, body: null };
    }

    return {
      status: 404,
      body: {
        error: {
          code: 404,
          message: `Unhandled fake endpoint for ${method} ${url}`
        }
      }
    };
  }

  private handleListEvents(calendarId: string, params: URLSearchParams): FetchResult {
    const state = this.ensureCalendar(calendarId);
    if (state.forceInvalidNextSync) {
      state.forceInvalidNextSync = false;
      return {
        status: 410,
        body: {
          error: {
            code: 410,
            message: 'The requested minimum modification time lies too far in the past.'
          }
        }
      };
    }

    const syncToken = params.get('syncToken');
    let sinceVersion = 0;
    if (syncToken) {
      const parsed = Number(syncToken.replace('sync-', ''));
      if (Number.isFinite(parsed)) {
        sinceVersion = parsed;
      } else {
        return {
          status: 410,
          body: {
            error: {
              code: 410,
              message: 'Invalid sync token.'
            }
          }
        };
      }
    }

    const items = Array.from(state.events.values())
      .filter((event) => event.version > sinceVersion)
      .map((event) => ({ ...event }));

    const nextToken = `sync-${Math.max(state.version, sinceVersion)}`;
    return {
      status: 200,
      body: {
        items,
        nextSyncToken: nextToken
      }
    };
  }

  private handleGetEvent(calendarId: string, eventId: string): FetchResult {
    const state = this.ensureCalendar(calendarId);
    const event = state.events.get(eventId);
    if (!event) {
      return {
        status: 404,
        body: {
          error: {
            code: 404,
            message: 'Event not found'
          }
        }
      };
    }
    return {
      status: 200,
      body: { ...event }
    };
  }

  private handleCreateEvent(calendarId: string, payload: Record<string, unknown>): FetchResult {
    const event = this.createRemoteEvent(calendarId, payload);
    return {
      status: 200,
      body: event
    };
  }

  private handlePatchEvent(calendarId: string, eventId: string, payload: Record<string, unknown>): FetchResult {
    const updated = this.updateRemoteEvent(calendarId, eventId, payload);
    if (!updated) {
      return {
        status: 404,
        body: {
          error: {
            code: 404,
            message: 'Event not found'
          }
        }
      };
    }
    return {
      status: 200,
      body: updated
    };
  }

  private handleMoveEvent(
    calendarId: string,
    eventId: string,
    destinationCalendarId: string | null
  ): FetchResult {
    if (!destinationCalendarId) {
      return {
        status: 400,
        body: {
          error: {
            code: 400,
            message: 'Missing destination calendar'
          }
        }
      };
    }

    const sourceState = this.ensureCalendar(calendarId);
    const existing = sourceState.events.get(eventId);
    if (!existing) {
      return {
        status: 404,
        body: {
          error: {
            code: 404,
            message: 'Event not found'
          }
        }
      };
    }

    sourceState.events.delete(eventId);

    const destinationState = this.ensureCalendar(destinationCalendarId);
    const version = ++destinationState.version;
    const updated = this.bumpClock();
    const moved: FakeEvent = {
      ...existing,
      updated,
      etag: `"${version}"`,
      version
    };
    destinationState.events.set(eventId, moved);

    return {
      status: 200,
      body: { ...moved }
    };
  }

  private handleWatch(calendarId: string): FetchResult {
    return {
      status: 200,
      body: {
        resourceId: `resource-${calendarId}`,
        expiration: Date.now() + 60 * 60 * 1000
      }
    };
  }

  private handleAclInsert(calendarId: string, payload: Record<string, unknown>): FetchResult {
    const scope = payload.scope as { type?: string; value?: string } | undefined;
    const role = typeof payload.role === 'string' ? payload.role : undefined;
    if (!role || !scope?.type || !scope.value) {
      return {
        status: 400,
        body: {
          error: {
            code: 400,
            message: 'Invalid ACL payload'
          }
        }
      };
    }

    const normalizedValue = scope.value.toLowerCase();
    const acl = this.ensureCalendarAcl(calendarId);
    if (acl.has(normalizedValue)) {
      return {
        status: 409,
        body: {
          error: {
            code: 409,
            message: 'Scope already exists'
          }
        }
      };
    }

    acl.set(normalizedValue, {
      role,
      scopeType: scope.type,
      scopeValue: normalizedValue
    });

    return {
      status: 200,
      body: {
        id: normalizedValue,
        role,
        scope: {
          type: scope.type,
          value: normalizedValue
        }
      }
    };
  }

  private handleAclList(calendarId: string): FetchResult {
    const acl = this.ensureCalendarAcl(calendarId);
    const items = Array.from(acl.values()).map((entry) => ({
      id: entry.scopeValue,
      role: entry.role,
      scope: {
        type: entry.scopeType,
        value: entry.scopeValue
      }
    }));
    return {
      status: 200,
      body: {
        items
      }
    };
  }

  private handleCalendarList(): FetchResult {
    const items = Array.from(this.calendarMetadata.values()).map((calendar) => ({
      id: calendar.id,
      summary: calendar.summary,
      timeZone: calendar.timeZone
    }));
    return {
      status: 200,
      body: { items }
    };
  }

  private handleInsertCalendar(payload: Record<string, unknown>): FetchResult {
    const summary =
      typeof payload.summary === 'string' && payload.summary.trim().length > 0
        ? payload.summary.trim()
        : `Calendar ${this.calendarCounter}`;
    const timeZone =
      typeof payload.timeZone === 'string' && payload.timeZone.trim().length > 0
        ? payload.timeZone.trim()
        : 'UTC';
    const id = `fake-calendar-${this.calendarCounter++}`;
    this.calendarMetadata.set(id, {
      id,
      summary,
      timeZone
    });
    this.ensureCalendar(id);
    return {
      status: 200,
      body: {
        id,
        summary,
        timeZone
      }
    };
  }

  private handleGetCalendar(calendarId: string): FetchResult {
    const metadata = this.calendarMetadata.get(calendarId);
    if (!metadata) {
      return {
        status: 404,
        body: {
          error: {
            code: 404,
            message: 'Calendar not found'
          }
        }
      };
    }
    return {
      status: 200,
      body: { ...metadata }
    };
  }

  private ensureCalendarAcl(calendarId: string): Map<string, CalendarAclEntry> {
    const normalized = decodeURIComponent(calendarId);
    let acl = this.calendarAcls.get(normalized);
    if (!acl) {
      acl = new Map<string, CalendarAclEntry>();
      this.calendarAcls.set(normalized, acl);
    }
    return acl;
  }

  private buildResponse(result: FetchResult): Response {
    const body = result.body === undefined ? {} : result.body;
    if (result.status === 204) {
      return new Response(null, { status: 204 });
    }
    return new Response(JSON.stringify(body), {
      status: result.status,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }

  private bumpClock(): string {
    this.clockMs += 60_000;
    return new Date(this.clockMs).toISOString();
  }
}
