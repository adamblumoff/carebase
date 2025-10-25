import { describe, it, expect } from 'vitest';
import { emailsMatch } from './collaborators.js';

describe('collaborator utils', () => {
  it('emailsMatch treats case and whitespace insensitively', () => {
    expect(emailsMatch('User@Example.com ', ' user@example.com')).toBe(true);
    expect(emailsMatch('owner@example.com', 'invited@example.com')).toBe(false);
  });
});
