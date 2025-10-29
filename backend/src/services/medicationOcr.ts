import type { MedicationDraft } from '@carebase/shared';

const TIME_PATTERN = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/gi;
const INSTRUCTION_KEYWORDS = ['take', 'tablet', 'capsule', 'mouth', 'daily', 'evening', 'morning', 'night', 'before', 'after'];

function toTwoDigits(value: number): string {
  return value.toString().padStart(2, '0');
}

function normalizeTime(hours: number, minutes: number, meridiem: string | null): string {
  let h = hours;
  let m = minutes;
  if (Number.isNaN(h)) h = 0;
  if (Number.isNaN(m)) m = 0;
  if (meridiem) {
    const lower = meridiem.toLowerCase();
    if (lower === 'pm' && h < 12) {
      h += 12;
    } else if (lower === 'am' && h === 12) {
      h = 0;
    }
  }
  h = Math.max(0, Math.min(23, h));
  m = Math.max(0, Math.min(59, m));
  return `${toTwoDigits(h)}:${toTwoDigits(m)}`;
}

function extractTimes(text: string): string[] {
  const times = new Set<string>();
  let match: RegExpExecArray | null;
  TIME_PATTERN.lastIndex = 0;
  while ((match = TIME_PATTERN.exec(text)) != null) {
    const hours = Number(match[1]);
    const minutes = match[2] ? Number(match[2]) : 0;
    const meridiem = match[3] ?? null;
    times.add(normalizeTime(hours, minutes, meridiem));
  }
  return Array.from(times);
}

function extractName(lines: string[]): string | null {
  for (const line of lines) {
    const candidate = line.trim();
    if (candidate.length < 2) continue;
    if (!/[a-zA-Z]/.test(candidate)) continue;
    if (/rx\b/i.test(candidate)) continue;
    return candidate;
  }
  return null;
}

function extractInstructions(lines: string[]): string | null {
  const matches = lines.filter((line) => {
    const lower = line.toLowerCase();
    return INSTRUCTION_KEYWORDS.some((keyword) => lower.includes(keyword));
  });
  if (matches.length === 0) {
    return null;
  }
  return matches.join(' ');
}

export function extractMedicationDraft(text: string, defaultTimezone: string): MedicationDraft {
  const cleaned = text.replace(/\r\n/g, '\n');
  const lines = cleaned
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const name = extractName(lines);
  const instructions = extractInstructions(lines);
  const times = extractTimes(cleaned);

  const doses = (times.length > 0 ? times : ['08:00']).map((time, index) => ({
    label: times.length > 1 ? `Dose ${index + 1}` : null,
    timeOfDay: time,
    timezone: defaultTimezone
  }));

  return {
    name,
    instructions,
    doses
  };
}
