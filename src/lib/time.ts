export function addMonths(date: Date, months: number) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

export function toIsoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}
