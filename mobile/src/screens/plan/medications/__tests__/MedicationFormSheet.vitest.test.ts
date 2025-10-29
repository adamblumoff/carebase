import { describe, expect, it } from 'vitest';
import { validateMedicationForm, type MedicationFormValues } from '../MedicationFormSheet';

const buildValues = (overrides: Partial<MedicationFormValues> = {}): MedicationFormValues => ({
  name: 'Lipitor',
  instructions: 'Take once daily',
  timeOfDay: '08:00',
  timezone: 'America/New_York',
  ...overrides
});

describe('validateMedicationForm', () => {
  it('returns normalized values when input is valid', () => {
    const { errors, normalized } = validateMedicationForm(
      buildValues({
        name: '  Lipitor  ',
        instructions: ' Take with water ',
        timeOfDay: '08:00',
        timezone: 'America/Chicago'
      })
    );

    expect(errors).toEqual({});
    expect(normalized).toEqual({
      name: 'Lipitor',
      instructions: 'Take with water',
      timeOfDay: '08:00',
      timezone: 'America/Chicago'
    });
  });

  it('flags missing name', () => {
    const { errors } = validateMedicationForm(buildValues({ name: '   ' }));
    expect(errors.name).toBe('Enter a medication name.');
  });

  it('flags invalid time format', () => {
    const { errors } = validateMedicationForm(buildValues({ timeOfDay: '8:30' }));
    expect(errors.timeOfDay).toBe('Enter time as HH:mm (24-hour).');
  });

  it('flags invalid timezone', () => {
    const { errors } = validateMedicationForm(buildValues({ timezone: 'Mars/Olympus' }));
    expect(errors.timezone).toBe('Enter a valid IANA timezone (e.g. America/Chicago).');
  });
});
