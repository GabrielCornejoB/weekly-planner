/**
 * Clock text, duration text, snapping, and column geometry.
 *
 * Everything here is a pure function of numbers, so the grid, the editors, and
 * the progress sentences cannot disagree about what 100 minutes looks like.
 * There is no `Date` anywhere: a time is minutes from midnight, and the visible
 * day is the 960 minutes between 6:00 and 22:00.
 */

import {
  DAY_END_MINUTE,
  DAY_START_MINUTE,
  DRAG_SNAP_MINUTES,
  TYPED_STEP_MINUTES,
} from '@/domain/types'

/** The height of one day column: 22:00 minus 6:00. */
export const DAY_SPAN_MINUTES = DAY_END_MINUTE - DAY_START_MINUTE

/** A stretch of the day. Half-open, so its end is the next thing's start. */
export interface MinuteRange {
  startMinute: number
  endMinute: number
}

/** 24-hour clock text, no leading zero on the hour: `8:00`, `9:30`, `17:00`. */
export function formatClock(minute: number): string {
  const hours = Math.floor(minute / 60)
  const minutes = Math.floor(minute % 60)
  return `${hours}:${String(minutes).padStart(2, '0')}`
}

/**
 * `15 minutes`, `1 hour`, `2 hours`, `1 hour 40 minutes`.
 *
 * The minutes are dropped on a whole hour, so a 300-minute quota reads
 * `5 hours` and a 100-minute session reads `1 hour 40 minutes` rather than a
 * decimal. Zero is `0 minutes`: a length, not a silence, because travel can
 * legitimately be absent.
 */
export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  const parts: string[] = []
  if (hours > 0) parts.push(`${hours} ${hours === 1 ? 'hour' : 'hours'}`)
  if (rest > 0) parts.push(`${rest} ${rest === 1 ? 'minute' : 'minutes'}`)
  if (parts.length === 0) return '0 minutes'
  return parts.join(' ')
}

/**
 * Drag and grid resize land on the nearest quarter hour.
 *
 * `Math.round` on its own would leave a half-step tie to go up, but a
 * 15-minute step cannot split a whole minute in half: 7.5 minutes past the hour
 * is not a time this app can hold, so the tie is unreachable and nearest is
 * unambiguous.
 */
export function snapDragMinute(minute: number): number {
  return Math.round(minute / DRAG_SNAP_MINUTES) * DRAG_SNAP_MINUTES
}

/**
 * Typed time fields step by five minutes, so 1:40 is valid and 1:37 is not. A
 * field that misses the step is refused, not quietly snapped for the person.
 */
export function isOnTypedStep(minute: number): boolean {
  return Number.isInteger(minute) && minute % TYPED_STEP_MINUTES === 0
}

/**
 * Whether both ends of a stretch sit inside 6:00–22:00. A block may start at
 * 6:00 and end at 22:00; 5:55 and 22:05 are outside. This says nothing about
 * length, which the minimum-length rules own.
 */
export function isWithinDay(range: MinuteRange): boolean {
  return range.startMinute >= DAY_START_MINUTE && range.endMinute <= DAY_END_MINUTE
}

/**
 * Only one thing may occupy a moment. Touching stretches are fine, so
 * 8:00–12:00 and 12:00–14:00 do not overlap; anything sharing real minutes
 * does.
 */
export function rangesOverlap(a: MinuteRange, b: MinuteRange): boolean {
  return a.startMinute < b.endMinute && b.startMinute < a.endMinute
}

/** Where the top of a block sits in its column: 6:00 is 0, 22:00 is 100. */
export function topPercent(minute: number): number {
  return ((minute - DAY_START_MINUTE) / DAY_SPAN_MINUTES) * 100
}

/** How tall a block is against the 16-hour column: 15 minutes is 15 / 960. */
export function heightPercent(minutes: number): number {
  return (minutes / DAY_SPAN_MINUTES) * 100
}
