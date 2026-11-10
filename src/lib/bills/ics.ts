import type { DueItem } from './due';

/** Text escaping for iCalendar (RFC 5545 §3.3.11). */
export const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
/** Lines longer than 75 octets are folded with CRLF + space (§3.1). */
function fold(line: string): string {
  const out: string[] = [];
  let cur = '';
  for (const ch of line) {
    if (Buffer.byteLength(cur + ch) > 74) { out.push(cur); cur = ' ' + ch; } else cur += ch;
  }
  out.push(cur);
  return out.join('\r\n');
}
const ymd = (d: string) => d.replace(/-/g, '');
const usd = (c: number) => (c / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

/** An all-day event per due item: "Hair Zone · $1,934.00 due". */
export function icsCalendar(name: string, items: DueItem[], now: Date): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//RetailNexa//Bills//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${esc(name)}`];
  for (const i of items) {
    const end = new Date(Date.parse(`${i.dueDate}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    lines.push('BEGIN:VEVENT', `UID:${i.id.replace(/[^A-Za-z0-9:-]/g, '')}@retailnexa`, `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${ymd(i.dueDate)}`, `DTEND;VALUE=DATE:${ymd(end)}`,
      `SUMMARY:${esc(`${i.name} · ${usd(i.leftCents)} due`)}`,
      `DESCRIPTION:${esc(`${i.detail}${i.stage === 'draft' ? ' (draft, needs approval)' : i.stage === 'scheduled' ? ' (recurring, not created yet)' : ''}`)}`,
      'TRANSP:TRANSPARENT', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
