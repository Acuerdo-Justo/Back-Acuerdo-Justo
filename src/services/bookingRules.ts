import { HttpError } from '../utils/httpError.js';

const limaDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Lima',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export type AppointmentPeriod = 'morning' | 'afternoon';

export function validateBookingDate(dateKey: string, period: AppointmentPeriod, todayKey = currentLimaDateKey()) {
  const date = parseDateKey(dateKey);
  const minimum = addDays(parseDateKey(todayKey), 2);

  if (date < minimum) throw new HttpError(400, 'La cita debe reservarse con al menos un dia completo de anticipacion.');
  if (date.getUTCDay() === 0) throw new HttpError(400, 'Los domingos no se realizan atenciones.');
  if (date.getUTCDay() === 6 && period === 'afternoon') throw new HttpError(400, 'Los sabados solo se atiende en turno manana.');
}

export function currentLimaDateKey() {
  return limaDateFormatter.format(new Date());
}

function parseDateKey(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new HttpError(400, 'La fecha no es valida.');
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new HttpError(400, 'La fecha no es valida.');
  }
  return date;
}

function addDays(date: Date, days: number) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}
