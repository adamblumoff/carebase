import cron from 'node-cron';
import db from '../db/client.js';
import { getUpcomingAppointments, getUpcomingBills } from '../db/queries.js';
import { sendDigestEmail } from '../services/email.js';

/**
 * Send Friday digest to all users
 */
async function sendFridayDigests(): Promise<void> {
  try {
    console.log('Starting Friday digest job...');

    // Get all users with their recipients
    const result = await db.query(`
      SELECT u.id as user_id, u.email, r.id as recipient_id, r.display_name, u.plan_secret
      FROM users u
      JOIN recipients r ON u.id = r.user_id
    `);

    if (result.rows.length === 0) {
      console.log('No users found for digest');
      return;
    }

    // Get next 7 days
    const startDate = new Date();
    startDate.setHours(0, 0, 0, 0);

    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + 7);

    let sentCount = 0;

    // Send digest to each user
    for (const row of result.rows) {
      try {
        const appointments = await getUpcomingAppointments(
          row.recipient_id,
          startDate.toISOString(),
          endDate.toISOString()
        );

        const bills = await getUpcomingBills(
          row.recipient_id,
          startDate.toISOString(),
          endDate.toISOString()
        );

        const planUrl = `${process.env.BASE_URL}/plan?token=${row.plan_secret}`;

        await sendDigestEmail(row.email, {
          recipient: {
            display_name: row.display_name
          },
          appointments,
          bills,
          planUrl
        });

        sentCount++;
        console.log(`Sent digest to ${row.email}`);
      } catch (error) {
        console.error(`Failed to send digest to ${row.email}:`, error);
      }
    }

    console.log(`Friday digest job complete. Sent ${sentCount} emails.`);
  } catch (error) {
    console.error('Friday digest job error:', error);
  }
}

/**
 * Schedule Friday digest job
 * Runs every Friday at 9 AM (cron: 0 9 * * 5)
 */
export function scheduleFridayDigest(): void {
  // Run every Friday at 9 AM
  cron.schedule('0 9 * * 5', () => {
    console.log('Friday digest cron triggered');
    sendFridayDigests();
  }, {
    timezone: 'America/New_York' // Can be configured per user in production
  });

  console.log('Friday digest job scheduled (Fridays at 9 AM)');
}

/**
 * Run digest immediately (for testing)
 */
export async function runDigestNow(): Promise<void> {
  await sendFridayDigests();
}
