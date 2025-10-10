import { test } from 'node:test';
import assert from 'node:assert';
import { generateICS } from './ics.js';

test('ICS: generates valid calendar file', () => {
  const appointment = {
    ics_token: 'test-token-12345',
    summary: 'Test Appointment',
    location: 'Test Clinic, 123 Main St',
    start_local: '2025-10-14T14:30:00',
    end_local: '2025-10-14T15:30:00',
    prep_note: 'Bring insurance card'
  };

  const ics = generateICS(appointment);

  // Check basic structure
  assert.ok(ics.includes('BEGIN:VCALENDAR'), 'Should have VCALENDAR start');
  assert.ok(ics.includes('END:VCALENDAR'), 'Should have VCALENDAR end');
  assert.ok(ics.includes('BEGIN:VEVENT'), 'Should have VEVENT start');
  assert.ok(ics.includes('END:VEVENT'), 'Should have VEVENT end');

  // Check content
  assert.ok(ics.includes('SUMMARY:Test Appointment'), 'Should include summary');
  assert.ok(ics.includes('LOCATION:Test Clinic'), 'Should include location');
  assert.ok(ics.includes('DESCRIPTION:Bring insurance card'), 'Should include prep note');
  assert.ok(ics.includes('UID:test-token-12345@inbox-to-week'), 'Should include UID');
});

test('ICS: handles special characters in location', () => {
  const appointment = {
    ics_token: 'test-token',
    summary: 'Appointment',
    location: 'Test Clinic, Suite 100, Main St',
    start_local: '2025-10-14T14:30:00',
    end_local: '2025-10-14T15:30:00',
    prep_note: null
  };

  const ics = generateICS(appointment);

  // Commas should be escaped
  assert.ok(ics.includes('LOCATION:Test Clinic\\, Suite 100\\, Main St'), 'Should escape commas');
});

test('ICS: handles missing optional fields', () => {
  const appointment = {
    ics_token: 'test-token',
    summary: 'Appointment',
    location: null,
    start_local: '2025-10-14T14:30:00',
    end_local: '2025-10-14T15:30:00',
    prep_note: null
  };

  const ics = generateICS(appointment);

  // Should still generate valid ICS
  assert.ok(ics.includes('BEGIN:VCALENDAR'), 'Should generate valid ICS');
  assert.ok(ics.includes('SUMMARY:Appointment'), 'Should include summary');
});
