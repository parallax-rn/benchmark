export function daysAgo(iso: string): string {
  const days = Math.round((Date.now() - Date.parse(iso)) / 86400000);
  try {
    return new Intl.RelativeTimeFormat('en', { numeric: 'always' }).format(-days, 'day');
  } catch {
    return '';
  }
}
