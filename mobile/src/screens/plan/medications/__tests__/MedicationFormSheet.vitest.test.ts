import { describe, expect, it } from 'vitest';
import {
  validateMedicationForm,
  type MedicationFormValues,
  type DoseFormValue
} from '../MedicationFormSheet';

const buildDose = (overrides: Partial<DoseFormValue> = {}): DoseFormValue => ({
  id: 10,
  label: 'Morning',
  timeOfDay: '08:00',
  timezone: 'America/New_York',
  ...overrides
});

const buildValues = (overrides: Partial<MedicationFormValues> = {}): MedicationFormValues => ({
  name: 'Lipitor',
  instructions: 'Take once daily',
  doses: [buildDose()],
  ...overrides
});

describe('validateMedicationForm', () => {
  it('returns normalized values when input is valid', () => {
    const { errors, normalized } = validateMedicationForm(
      buildValues({
        name: '  Lipitor  ',
        instructions: ' Take with water ',
        doses: [
          buildDose({
            id: 42,
            label: ' Morning ',
            timeOfDay: '08:30',
            timezone: 'America/Chicago'
          })
        ]
      })
    );

    expect(errors).toEqual({});
    expect(normalized).toEqual({
      name: 'Lipitor',
      instructions: 'Take with water',
      doses: [
        {
          id: 42,
          label: 'Morning',
          timeOfDay: '08:30',
          timezone: 'America/Chicago'
        }
      ]
    });
  });

  it('flags missing name', () => {
    const { errors } = validateMedicationForm(buildValues({ name: '   ' }));
    expect(errors.name).toBe('Enter a medication name.');
  });

  it('flags invalid dose time format', () => {
    const { errors } = validateMedicationForm(
      buildValues({
        doses: [
          buildDose({ timeOfDay: '8:30' })
        ]
      })
    );
    expect(errors.doses?.[0]?.timeOfDay).toBe('Enter time as HH:mm (24-hour).');
  });

  it('flags invalid timezone', () => {
    const { errors } = validateMedicationForm(
      buildValues({
        doses: [
          buildDose({ timezone: 'Mars/Olympus' })
        ]
      })
    );
    expect(errors.doses?.[0]?.timezone).toBe('Enter a valid IANA timezone (e.g. America/Chicago).');
  });

  it('requires at least one dose', () => {
    const { errors } = validateMedicationForm(buildValues({ doses: [] }));
    expect(errors.doses?.[0]?.timeOfDay).toBe('Add at least one dose.');
  });
});
