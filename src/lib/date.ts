export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function monthKey(dateIso: string): string {
  return dateIso.slice(0, 7);
}

export function monthStart(month: string): string {
  return `${month}-01`;
}

export function previousMonth(month: string): string {
  const [year, monthIndex] = month.split("-").map(Number);
  const date = new Date(year, monthIndex - 2, 1);
  return date.toISOString().slice(0, 7);
}

export function enumerateMonths(fromMonth: string, toMonth: string): string[] {
  const months: string[] = [];
  let cursor = `${fromMonth}-01`;

  while (monthKey(cursor) <= toMonth) {
    months.push(monthKey(cursor));
    const [year, monthIndex] = monthKey(cursor).split("-").map(Number);
    cursor = new Date(year, monthIndex, 1).toISOString().slice(0, 10);
  }

  return months;
}

export function addFrequency(dateIso: string, frequency: "weekly" | "monthly" | "yearly"): string {
  const date = new Date(`${dateIso}T12:00:00`);
  if (frequency === "weekly") date.setDate(date.getDate() + 7);
  if (frequency === "monthly") date.setMonth(date.getMonth() + 1);
  if (frequency === "yearly") date.setFullYear(date.getFullYear() + 1);
  return date.toISOString().slice(0, 10);
}
