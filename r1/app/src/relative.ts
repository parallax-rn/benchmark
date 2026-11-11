export function daysAgo(iso: string): string {
  const days = Math.round((Date.now() - Date.parse(iso)) / 86400000);
  return days === 1 ? '1 day ago' : `${days} days ago`;
}
