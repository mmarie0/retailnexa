import { WEEKDAYS, type DayShift } from '@/lib/staff/payroll';

/** Seven day rows (Sunday first): a check box to work that day, start, end and lunch minutes. */
export function WeekFields({ prefix, days, clock }: { prefix: 'reg' | 'wk'; days: (DayShift & { actIn?: string | null; actOut?: string | null } | null)[]; clock?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[460px] text-[14px]">
        <thead className="text-left"><tr><th className="py-1 pr-2">Day</th><th className="px-1">Start</th><th className="px-1">End</th><th className="px-1">Lunch (min)</th>{clock && <th className="px-1">Clocked in–out</th>}</tr></thead>
        <tbody>
          {WEEKDAYS.map((d, i) => {
            const r = days[i];
            return (
              <tr key={d} className="border-t border-line">
                <td className="py-1.5 pr-2"><label className="flex items-center gap-2 font-semibold"><input type="checkbox" name={`${prefix}-on-${i}`} defaultChecked={!!r} className="size-4 accent-[#3f63de]" />{d.slice(0, 3)}</label></td>
                <td className="px-1"><input type="time" name={`${prefix}-in-${i}`} defaultValue={r?.in ?? '09:00'} aria-label={`${d} start`} className="w-full rounded-lg bg-soft px-2 py-1" /></td>
                <td className="px-1"><input type="time" name={`${prefix}-out-${i}`} defaultValue={r?.out ?? '17:00'} aria-label={`${d} end`} className="w-full rounded-lg bg-soft px-2 py-1" /></td>
                <td className="px-1"><input type="number" min={0} max={240} name={`${prefix}-lunch-${i}`} defaultValue={r?.lunch ?? 30} aria-label={`${d} lunch minutes`} className="w-20 rounded-lg bg-soft px-2 py-1" /></td>
                {clock && (
                  <td className="px-1"><span className="flex gap-1">
                    <input type="time" name={`wk-ai-${i}`} defaultValue={r?.actIn ?? ''} aria-label={`${d} clocked in`} className="w-full rounded-lg bg-soft px-2 py-1" />
                    <input type="time" name={`wk-ao-${i}`} defaultValue={r?.actOut ?? ''} aria-label={`${d} clocked out`} className="w-full rounded-lg bg-soft px-2 py-1" />
                  </span></td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
