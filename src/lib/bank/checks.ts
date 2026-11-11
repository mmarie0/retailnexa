/**
 * Bank (#109), copied from the owner's RetailNexa app: a check register with
 * checks and withdrawals on a calendar, and card sales checked against card
 * deposits. Pure; money in integer cents.
 */
const DAY = 86_400_000;
const ms = (d: string) => Date.parse(`${d}T00:00:00Z`);
const addDays = (d: string, n: number) => new Date(ms(d) + n * DAY).toISOString().slice(0, 10);
const between = (a: string, b: string) => Math.round((ms(b) - ms(a)) / DAY);

export interface PaymentIn { id: string; paid_on: string; amount_cents: number; reference: string | null; payee: string; journal_entry_id: string }
export interface BankLineIn { id: string; posted_on: string; description: string; amount_cents: number; status: string; journal_entry_id: string | null }
export interface CheckRow { id: string; date: string; number: string | null; payee: string; amountCents: number; clearedOn: string | null; days: number; stale: boolean }

/** A check number is a reference of 3–10 digits, optionally written "#1234" or "Check 1234". */
export const checkNumber = (ref: string | null) => /^(?:check\s*|chk\s*|#\s*)?(\d{3,10})$/i.exec((ref ?? '').trim())?.[1] ?? null;

/**
 * Bank payments that weren't voided, newest first. Cleared = a bank line was
 * matched to the payment's journal entry. Outstanding over 14 days is flagged.
 */
export function checkRegister(payments: PaymentIn[], voided: Set<string>, lines: BankLineIn[], today: string, checksOnly: boolean): CheckRow[] {
  const cleared = new Map(lines.filter((l) => l.status === 'matched' && l.journal_entry_id).map((l) => [l.journal_entry_id!, l.posted_on]));
  return payments
    .filter((p) => !voided.has(p.id) && (!checksOnly || checkNumber(p.reference)))
    .map((p) => {
      const on = cleared.get(p.journal_entry_id) ?? null, days = between(p.paid_on, on ?? today);
      return { id: p.id, date: p.paid_on, number: checkNumber(p.reference) ?? (p.reference || null), payee: p.payee, amountCents: Number(p.amount_cents), clearedOn: on, days, stale: !on && days > 14 };
    })
    .sort((a, b) => b.date.localeCompare(a.date) || (b.number ?? '').localeCompare(a.number ?? ''));
}

/** Checks written and bank withdrawals for each day of a month (calendar view). */
export function calendarMonth(ym: string, checks: CheckRow[], lines: BankLineIn[]) {
  const dim = new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).getUTCDate();
  const lead = new Date(ms(`${ym}-01`)).getUTCDay();
  const days = Array.from({ length: dim }, (_, i) => {
    const date = `${ym}-${String(i + 1).padStart(2, '0')}`;
    const cs = checks.filter((c) => c.date === date), ws = lines.filter((l) => l.posted_on === date && Number(l.amount_cents) < 0);
    return { date, checks: cs, withdrawals: ws, checkCents: cs.reduce((a, c) => a + c.amountCents, 0), outCents: ws.reduce((a, l) => a - Number(l.amount_cents), 0) };
  });
  return { lead, days };
}

export interface CardDay { date: string; cardCents: number }
export interface Deposit { id: string; date: string; amountCents: number; description: string }
export interface DepositMatch { deposit: Deposit; from: string; to: string; expectedCents: number; feePct: number }

/**
 * The owner's card-deposit check: each deposit is compared with 1 to 3
 * consecutive days of card sales ending 1 to 5 days before it. It fits when the
 * deposit is 93% to 100.5% of those sales; the best fit is the one closest to
 * 97.5% (a typical processing fee). Each sales day is used once. Card days
 * more than 5 days old with no deposit are "missing".
 */
export function matchCardDeposits(days: CardDay[], deposits: Deposit[], today: string) {
  const card = new Map(days.filter((d) => d.cardCents > 0).map((d) => [d.date, d.cardCents]));
  const used = new Set<string>();
  const matches: DepositMatch[] = [], other: Deposit[] = [];
  for (const dep of [...deposits].filter((d) => d.amountCents > 0).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))) {
    let best: DepositMatch | null = null, bestScore = Infinity;
    for (let lag = 1; lag <= 5; lag++) {
      const end = addDays(dep.date, -lag);
      for (let span = 1; span <= 3; span++) {
        const ds = Array.from({ length: span }, (_, i) => addDays(end, -i));
        if (ds.some((d) => used.has(d) || !card.has(d))) continue;
        const expected = ds.reduce((a, d) => a + card.get(d)!, 0), ratio = dep.amountCents / expected;
        if (ratio < 0.93 || ratio > 1.005) continue;
        const score = Math.abs(ratio - 0.975) + lag * 0.0001 + span * 0.00001;
        if (score < bestScore) { bestScore = score; best = { deposit: dep, from: ds[ds.length - 1], to: end, expectedCents: expected, feePct: Math.round((1 - ratio) * 10_000) / 100 }; }
      }
    }
    if (best) { matches.push(best); for (let d = best.from; d <= best.to; d = addDays(d, 1)) used.add(d); } else other.push(dep);
  }
  const missing = [...card.entries()].filter(([d]) => !used.has(d) && between(d, today) > 5).map(([date, cardCents]) => ({ date, cardCents })).sort((a, b) => a.date.localeCompare(b.date));
  const fees = matches.reduce((a, m) => a + (m.expectedCents - m.deposit.amountCents), 0), expected = matches.reduce((a, m) => a + m.expectedCents, 0);
  return { matches, missing, other, feePct: expected ? Math.round((fees / expected) * 10_000) / 100 : null };
}
