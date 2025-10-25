import { describe, it, expect } from 'vitest';
import appointmentsRouter from '../appointments.js';
import authRouter from '../auth.js';
import billsRouter from '../bills.js';
import reviewRouter from '../review.js';

function summarize(router: any) {
  const map = new Map<string, Set<string>>();

  router.stack
    .filter((layer: any) => layer.route)
    .forEach((layer: any) => {
      const path = layer.route.path as string;
      const methods = Object.entries(layer.route.methods)
        .filter(([, enabled]: [string, boolean]) => enabled)
        .map(([method]) => method);

      if (!map.has(path)) {
        map.set(path, new Set());
      }

      const set = map.get(path)!;
      methods.forEach((method) => set.add(method));
    });

  return Array.from(map.entries())
    .map(([path, methods]) => ({
      path,
      methods: Array.from(methods).sort()
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

describe('api route wiring', () => {
  it('registers appointment CRUD endpoints', () => {
    expect(summarize(appointmentsRouter)).toEqual([
      { path: '/:id', methods: ['delete', 'get', 'patch'] }
    ]);
  });

  it('registers auth endpoints', () => {
    expect(summarize(authRouter)).toEqual([
      { path: '/logout', methods: ['post'] },
      { path: '/session', methods: ['get'] },
      { path: '/user', methods: ['get'] }
    ]);
  });

  it('registers bill endpoints including mark-paid', () => {
    expect(summarize(billsRouter)).toEqual([
      { path: '/:id', methods: ['delete', 'get', 'patch'] },
      { path: '/:id/mark-paid', methods: ['post'] }
    ]);
  });

  it('registers review endpoints', () => {
    expect(summarize(reviewRouter)).toEqual([
      { path: '/:itemId', methods: ['patch'] },
      { path: '/pending', methods: ['get'] }
    ]);
  });
});
