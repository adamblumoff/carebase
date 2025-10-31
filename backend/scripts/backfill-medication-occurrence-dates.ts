#!/usr/bin/env node

/**
 * Align medication intake occurrence_date values with their dose timezones.
 *
 * Dry run (default):
 *   npx tsx backend/scripts/backfill-medication-occurrence-dates.ts
 *
 * Apply updates:
 *   npx tsx backend/scripts/backfill-medication-occurrence-dates.ts --apply
 *
 * Optional filters:
 *   --medication-id <id>
 */

import '../src/env.js';

import db from '../src/db/client.js';
import { combineDateWithTimeZone, getDefaultTimeZone } from '../src/utils/timezone.js';

interface CliOptions {
  apply: boolean;
  medicationId?: number;
}

interface IntakeRow {
  id: number;
  medication_id: number;
  dose_id: number | null;
  scheduled_for: Date;
  occurrence_date: Date;
  status: string;
  time_of_day: string | null;
  timezone: string | null;
}

interface UpdateAction {
  intakeId: number;
  medicationId: number;
  prevOccurrenceDate: string;
  nextOccurrenceDate: string;
  prevScheduledFor: string;
  nextScheduledFor: string;
  status: string;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { apply: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--apply':
        options.apply = true;
        break;
      case '--medication-id': {
        const next = argv[index + 1];
        if (!next) {
          throw new Error('--medication-id requires a numeric value');
        }
        const medicationId = Number.parseInt(next, 10);
        if (Number.isNaN(medicationId) || medicationId <= 0) {
          throw new Error(`Invalid medication id: ${next}`);
        }
        options.medicationId = medicationId;
        index += 1;
        break;
      }
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;
      default:
        if (arg.startsWith('-')) {
          throw new Error(`Unknown option: ${arg}`);
        }
    }
  }
  return options;
}

function printHelp(): void {
  console.log(`
Backfill medication occurrence dates
------------------------------------

Dry run (default):
  npx tsx backend/scripts/backfill-medication-occurrence-dates.ts

Apply updates:
  npx tsx backend/scripts/backfill-medication-occurrence-dates.ts --apply

Filter:
  --medication-id <id>   Only adjust a single medication
`);
}

function toOccurrenceDate(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function computeZoneOccurrenceDate(reference: Date, timeZone: string): Date {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  let year = reference.getUTCFullYear();
  let month = reference.getUTCMonth() + 1;
  let day = reference.getUTCDate();
  for (const part of formatter.formatToParts(reference)) {
    if (part.type === 'year') {
      year = Number.parseInt(part.value, 10);
    } else if (part.type === 'month') {
      month = Number.parseInt(part.value, 10);
    } else if (part.type === 'day') {
      day = Number.parseInt(part.value, 10);
    }
  }
  return new Date(Date.UTC(year, month - 1, day));
}

function sameDate(a: Date, b: Date): boolean {
  return a.getUTCFullYear() === b.getUTCFullYear()
    && a.getUTCMonth() === b.getUTCMonth()
    && a.getUTCDate() === b.getUTCDate();
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const defaultTimeZone = getDefaultTimeZone();

  const params: Array<number> = [];
  const conditions: string[] = [];
  if (options.medicationId) {
    params.push(options.medicationId);
    conditions.push(`mi.medication_id = $${params.length}`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const result = await db.query<IntakeRow>(
    `SELECT
       mi.id,
       mi.medication_id,
       mi.dose_id,
       mi.scheduled_for,
       mi.occurrence_date,
       mi.status,
       md.time_of_day,
       md.timezone
     FROM medication_intakes mi
     LEFT JOIN medication_doses md ON md.id = mi.dose_id
     ${whereClause}
     ORDER BY mi.medication_id, mi.id`,
    params
  );

  const updates: UpdateAction[] = [];

  for (const row of result.rows) {
    const timeZone = row.timezone && row.timezone.trim().length > 0 ? row.timezone.trim() : defaultTimeZone;
    const scheduledFor = row.scheduled_for instanceof Date ? row.scheduled_for : new Date(row.scheduled_for);
    const occurrenceDate = row.occurrence_date instanceof Date ? row.occurrence_date : new Date(row.occurrence_date);

    const expectedOccurrence = computeZoneOccurrenceDate(scheduledFor, timeZone);

    let expectedScheduled = scheduledFor;
    if (row.time_of_day) {
      expectedScheduled = combineDateWithTimeZone(expectedOccurrence, row.time_of_day, timeZone);
    }

    const occurrenceChanged = !sameDate(occurrenceDate, expectedOccurrence);
    const scheduledChanged =
      row.status === 'pending'
      && (Math.abs(expectedScheduled.getTime() - scheduledFor.getTime()) > 60 * 1000);

    if (!occurrenceChanged && !scheduledChanged) {
      continue;
    }

    updates.push({
      intakeId: row.id,
      medicationId: row.medication_id,
      prevOccurrenceDate: occurrenceDate.toISOString().slice(0, 10),
      nextOccurrenceDate: expectedOccurrence.toISOString().slice(0, 10),
      prevScheduledFor: scheduledFor.toISOString(),
      nextScheduledFor: expectedScheduled.toISOString(),
      status: row.status
    });

    if (options.apply) {
      await db.query(
        `UPDATE medication_intakes
           SET occurrence_date = $1,
               scheduled_for = CASE WHEN $4 THEN scheduled_for ELSE $2 END,
               updated_at = NOW()
         WHERE id = $3`,
        [
          toOccurrenceDate(expectedOccurrence),
          expectedScheduled,
          row.id,
          row.status !== 'pending' // keep scheduled_for untouched for non-pending rows
        ]
      );
    }
  }

  if (updates.length === 0) {
    console.log('No occurrence dates required adjustment.');
  } else {
    console.log(`${options.apply ? 'Updated' : 'Would update'} ${updates.length} intake(s):`);
    for (const update of updates) {
      console.log(
        `  intake ${update.intakeId} (med ${update.medicationId}) ` +
        `status=${update.status} ${update.prevOccurrenceDate} -> ${update.nextOccurrenceDate}`
      );
    }
  }

  await db.end();
}

main().catch((error) => {
  console.error('Backfill failed:', error);
  void db.end().finally(() => process.exit(1));
});
