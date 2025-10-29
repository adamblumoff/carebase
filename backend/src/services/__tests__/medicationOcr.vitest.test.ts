import { describe, expect, it } from 'vitest';
import { extractMedicationDraft } from '../medicationOcr.js';

describe('extractMedicationDraft', () => {
  it('extracts name, instructions, and times', () => {
    const text = `Lipitor 20 mg Tablet\nTake one tablet by mouth every morning and evening\n8 AM\n8 PM`;
    const draft = extractMedicationDraft(text, 'America/New_York');
    expect(draft.name).toBe('Lipitor 20 mg Tablet');
    expect(draft.instructions).toContain('Take one tablet');
    expect(draft.doses).toHaveLength(2);
    expect(draft.doses[0]?.timeOfDay).toBe('20:00');
    expect(draft.doses[1]?.timeOfDay).toBe('08:00');
  });

  it('falls back to defaults when text lacks signals', () => {
    const draft = extractMedicationDraft('', 'UTC');
    expect(draft.name).toBeNull();
    expect(draft.instructions).toBeNull();
    expect(draft.doses).toHaveLength(1);
    expect(draft.doses[0]).toEqual({ label: null, timeOfDay: '08:00', timezone: 'UTC' });
  });
});
