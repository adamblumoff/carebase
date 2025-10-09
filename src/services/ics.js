/**
 * Generate ICS (iCalendar) file content for calendar integration
 */

/**
 * Format date for ICS format (YYYYMMDDTHHMMSS)
 * @param {Date|string} date - Date to format
 * @returns {string} - Formatted date string
 */
function formatICSDate(date) {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');

  return `${year}${month}${day}T${hours}${minutes}${seconds}`;
}

/**
 * Escape text for ICS format
 * @param {string} text - Text to escape
 * @returns {string} - Escaped text
 */
function escapeICSText(text) {
  if (!text) return '';
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

/**
 * Generate ICS file content for an appointment
 * @param {Object} appointment - Appointment data
 * @returns {string} - ICS file content
 */
export function generateICS(appointment) {
  const now = new Date();
  const startDate = formatICSDate(appointment.start_local);
  const endDate = formatICSDate(appointment.end_local);
  const createdDate = formatICSDate(now);

  const summary = escapeICSText(appointment.summary);
  const location = escapeICSText(appointment.location);
  const description = escapeICSText(appointment.prep_note || appointment.summary);

  // Generate unique UID using ics_token
  const uid = `${appointment.ics_token}@inbox-to-week`;

  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Inbox to Week//Healthcare Coordination//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${createdDate}`,
    `DTSTART:${startDate}`,
    `DTEND:${endDate}`,
    `SUMMARY:${summary}`,
    location ? `LOCATION:${location}` : null,
    `DESCRIPTION:${description}`,
    'STATUS:CONFIRMED',
    'SEQUENCE:0',
    'END:VEVENT',
    'END:VCALENDAR'
  ]
    .filter(Boolean)
    .join('\r\n');

  return ics;
}
