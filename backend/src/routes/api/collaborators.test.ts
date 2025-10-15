import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emailsMatch } from './collaborators.js';

test('emailsMatch treats case and whitespace insensitively', () => {
  assert.equal(emailsMatch('User@Example.com ', ' user@example.com'), true);
  assert.equal(emailsMatch('owner@example.com', 'invited@example.com'), false);
});
