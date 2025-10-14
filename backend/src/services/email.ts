import { Resend } from 'resend';
import type { BillStatus } from '@carebase/shared';

const resend = new Resend(process.env.RESEND_API_KEY);

interface DigestAppointment {
  summary: string;
  start_local: Date | string;
  location?: string | null;
  prep_note?: string | null;
}

interface DigestBill {
  amount?: number | null;
  due_date?: Date | string | null;
  status: BillStatus;
}

interface DigestRecipient {
  display_name: string;
}

interface DigestEmailData {
  recipient: DigestRecipient;
  appointments: DigestAppointment[];
  bills: DigestBill[];
  planUrl: string;
}

/**
 * Generate HTML email for Friday digest
 * @param data - Email data
 * @returns HTML content
 */
function generateDigestHTML(data: DigestEmailData): string {
  const { recipient, appointments, bills, planUrl } = data;

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your Weekly Plan</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #2563eb; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
    .content { background: #f9fafb; padding: 20px; }
    .section { background: white; padding: 20px; margin-bottom: 20px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .section-title { font-size: 18px; font-weight: bold; margin-bottom: 15px; color: #1f2937; }
    .item { padding: 15px; background: #f9fafb; border-radius: 6px; margin-bottom: 10px; }
    .item-title { font-weight: 600; margin-bottom: 5px; }
    .item-details { font-size: 14px; color: #6b7280; }
    .button { display: inline-block; background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 20px 0; }
    .footer { text-align: center; color: #9ca3af; font-size: 12px; padding: 20px; }
    .empty { text-align: center; color: #9ca3af; padding: 20px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1 style="margin: 0;">${recipient.display_name}'s Weekly Plan</h1>
      <p style="margin: 10px 0 0 0; opacity: 0.9;">Your plan for the next 7 days</p>
    </div>

    <div class="content">
      <!-- Appointments -->
      <div class="section">
        <div class="section-title">📅 Show Up</div>
        ${appointments.length === 0
          ? '<div class="empty">No appointments scheduled</div>'
          : appointments.map(appt => `
            <div class="item">
              <div class="item-title">${appt.summary}</div>
              <div class="item-details">
                ${new Date(appt.start_local).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
                at ${new Date(appt.start_local).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}
                ${appt.location ? `<br>📍 ${appt.location}` : ''}
                ${appt.prep_note ? `<br>💡 ${appt.prep_note}` : ''}
              </div>
            </div>
          `).join('')
        }
      </div>

      <!-- Bills -->
      <div class="section">
        <div class="section-title">💵 Pay</div>
        ${bills.length === 0
          ? '<div class="empty">No bills due</div>'
          : bills.map(bill => `
            <div class="item">
              <div class="item-title">
                ${bill.amount ? `$${parseFloat(bill.amount.toString()).toFixed(2)}` : 'Bill'}
                ${
                  bill.status === 'paid'
                    ? ' ✅'
                    : bill.status === 'overdue'
                    ? ' ⚠️'
                    : ' ⏰'
                }
              </div>
              <div class="item-details">
                ${bill.due_date ? `Due: ${new Date(bill.due_date).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}` : 'No due date'}
              </div>
            </div>
          `).join('')
        }
      </div>

      <div style="text-align: center;">
        <a href="${planUrl}" class="button">View Full Plan</a>
      </div>
    </div>

    <div class="footer">
      <p>This is your weekly care coordination digest from Inbox to Week</p>
    </div>
  </div>
</body>
</html>
  `.trim();
}

/**
 * Send Friday digest email
 * @param to - Recipient email
 * @param data - Email data (recipient, appointments, bills, planUrl)
 * @returns Resend response
 */
export async function sendDigestEmail(to: string, data: DigestEmailData): Promise<any> {
  const html = generateDigestHTML(data);

  const result = await resend.emails.send({
    from: 'Inbox to Week <noreply@' + (process.env.INBOUND_EMAIL_DOMAIN || 'yourdomain.com') + '>',
    to,
    subject: `${data.recipient.display_name}'s Weekly Plan`,
    html
  });

  return result;
}
