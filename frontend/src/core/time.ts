import { app } from '../state';

export const fDay = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' });
export const fHr = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false });
export const fWk = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', weekday: 'short' });
export const fYr = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', year: 'numeric' });

/** UTC ms of hour index i. */
export function tms(i: number): number {
  return app.D.nowMs + (i - app.D.now) * 3600e3;
}
/** Hour of day in IST (fractional) for index i. */
export function hIST(i: number): number {
  return (((app.D.nowMs / 3600e3 + 5.5 + (i - app.D.now)) % 24) + 24) % 24;
}
export function stamp(i: number): string {
  return fDay.format(tms(i)) + ', ' + fHr.format(tms(i)) + ' IST';
}
