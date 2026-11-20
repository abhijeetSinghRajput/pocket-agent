import { describe, expect, it } from 'vitest';
import { isQuietTime, NOTIFICATION_CATEGORIES, UpdateNotificationSettings } from '../src/index.js';

const at = (iso: string) => new Date(iso);

describe('isQuietTime', () => {
  it('handles same-day windows', () => {
    const q = { start: '13:00', end: '14:00', timezone: 'UTC' };
    expect(isQuietTime(q, at('2026-11-20T13:30:00Z'))).toBe(true);
    expect(isQuietTime(q, at('2026-11-20T14:00:00Z'))).toBe(false);
    expect(isQuietTime(q, at('2026-11-20T12:59:00Z'))).toBe(false);
  });
  it('handles windows crossing midnight, in the user’s time zone', () => {
    const q = { start: '22:00', end: '07:00', timezone: 'Asia/Kolkata' }; // UTC+5:30
    expect(isQuietTime(q, at('2026-11-20T17:00:00Z'))).toBe(true); // 22:30 IST
    expect(isQuietTime(q, at('2026-11-20T01:00:00Z'))).toBe(true); // 06:30 IST
    expect(isQuietTime(q, at('2026-11-20T02:00:00Z'))).toBe(false); // 07:30 IST
  });
  it('is never quiet without a window or with an unknown zone', () => {
    expect(isQuietTime(null, new Date())).toBe(false);
    expect(isQuietTime({ start: '00:00', end: '23:59', timezone: 'Mars/Base' }, new Date())).toBe(false);
  });
});

describe('notification settings', () => {
  it('accepts partial category updates and rejects unknown categories', () => {
    expect(UpdateNotificationSettings.safeParse({ categories: { agent_started: true } }).success).toBe(true);
    expect(UpdateNotificationSettings.safeParse({ categories: { bogus: true } }).success).toBe(false);
  });
  it('permission requests are critical and on by default', () => {
    expect(NOTIFICATION_CATEGORIES.permission_required).toMatchObject({
      priority: 'critical',
      defaultEnabled: true,
    });
    expect(NOTIFICATION_CATEGORIES.agent_started.defaultEnabled).toBe(false);
  });
});
