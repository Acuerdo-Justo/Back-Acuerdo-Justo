import assert from 'node:assert/strict';
import test from 'node:test';
import { validateBookingDate } from './bookingRules.js';

test('permite reservar desde dos dias despues', () => {
  assert.doesNotThrow(() => validateBookingDate('2026-06-11', 'morning', '2026-06-09'));
});

test('rechaza hoy y el dia siguiente', () => {
  assert.throws(() => validateBookingDate('2026-06-09', 'morning', '2026-06-09'));
  assert.throws(() => validateBookingDate('2026-06-10', 'morning', '2026-06-09'));
});

test('rechaza domingos y permite solo manana los sabados', () => {
  assert.throws(() => validateBookingDate('2026-06-14', 'morning', '2026-06-09'));
  assert.doesNotThrow(() => validateBookingDate('2026-06-13', 'morning', '2026-06-09'));
  assert.throws(() => validateBookingDate('2026-06-13', 'afternoon', '2026-06-09'));
});

test('rechaza fechas inexistentes', () => {
  assert.throws(() => validateBookingDate('2026-02-30', 'morning', '2026-01-01'));
});
