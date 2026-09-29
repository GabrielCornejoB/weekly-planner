import { describe, expect, it } from 'vitest'

import {
  DAY_SPAN_MINUTES,
  formatClock,
  formatDuration,
  heightPercent,
  isOnTypedStep,
  isWithinDay,
  rangesOverlap,
  snapDragMinute,
  topPercent,
} from '@/domain/time'
import {
  DAY_END_MINUTE,
  DAY_START_MINUTE,
  DRAG_SNAP_MINUTES,
  TYPED_STEP_MINUTES,
} from '@/domain/types'

describe('formatClock', () => {
  it('prints the 24-hour clock the plan uses', () => {
    expect([formatClock(480), formatClock(570), formatClock(1020)]).toEqual([
      '8:00',
      '9:30',
      '17:00',
    ])
  })

  it('prints both ends of the visible day', () => {
    expect(formatClock(DAY_START_MINUTE)).toBe('6:00')
    expect(formatClock(DAY_END_MINUTE)).toBe('22:00')
  })

  it('keeps two digits on the minutes, and none on the hour', () => {
    expect(formatClock(485)).toBe('8:05')
    expect(formatClock(100)).toBe('1:40')
    expect(formatClock(605)).toBe('10:05')
  })

  it('holds for every whole minute of a day', () => {
    for (let minute = 0; minute <= 24 * 60; minute += 1) {
      expect(formatClock(minute)).toMatch(/^\d{1,2}:\d{2}$/)
    }
  })
})

describe('formatDuration', () => {
  it('prints the four documented lengths', () => {
    expect([
      formatDuration(15),
      formatDuration(60),
      formatDuration(120),
      formatDuration(100),
    ]).toEqual(['15 minutes', '1 hour', '2 hours', '1 hour 40 minutes'])
  })

  it('drops the minutes on a whole hour, and the hours before one', () => {
    expect(formatDuration(59)).toBe('59 minutes')
    expect(formatDuration(60)).toBe('1 hour')
    expect(formatDuration(90)).toBe('1 hour 30 minutes')
  })

  it('agrees on one and on many', () => {
    expect(formatDuration(1)).toBe('1 minute')
    expect(formatDuration(2)).toBe('2 minutes')
    expect(formatDuration(61)).toBe('1 hour 1 minute')
  })

  it('says zero out loud, because absent travel is a length', () => {
    expect(formatDuration(0)).toBe('0 minutes')
  })

  it('never prints 60 minutes, because an hour is spelled as an hour', () => {
    for (let minutes = 0; minutes <= 12 * 60; minutes += 1) {
      expect(formatDuration(minutes)).not.toContain('60 minutes')
    }
  })
})

describe('snapDragMinute', () => {
  /**
   * The rule is nearest quarter hour, which for whole minutes is never a tie:
   * a 15-minute step would have to cut a minute in half to reach one, and 7.5
   * minutes past is not a time the board can hold. So 6:07 is 7 minutes past
   * 6:00 and 8 short of 6:15 and snaps back to 6:00, and one minute later the
   * distance flips and 6:08 snaps forward to 6:15.
   */
  it('takes 6:07 back to 6:00 and 6:08 forward to 6:15', () => {
    expect(formatClock(snapDragMinute(6 * 60 + 7))).toBe('6:00')
    expect(snapDragMinute(6 * 60 + 7)).toBe(6 * 60)
    expect(formatClock(snapDragMinute(6 * 60 + 8))).toBe('6:15')
    expect(snapDragMinute(6 * 60 + 8)).toBe(6 * 60 + 15)
  })

  it('snaps either way across the day', () => {
    expect(formatClock(snapDragMinute(9 * 60 + 23))).toBe('9:30')
    expect(formatClock(snapDragMinute(21 * 60 + 53))).toBe('22:00')
    expect(formatClock(snapDragMinute(21 * 60 + 52))).toBe('21:45')
  })

  it('lands on the step, lands once, and never moves more than half a step', () => {
    for (let minute = 0; minute <= 24 * 60; minute += 1) {
      const snapped = snapDragMinute(minute)
      expect(snapped % DRAG_SNAP_MINUTES).toBe(0)
      expect(Math.abs(snapped - minute)).toBeLessThanOrEqual(DRAG_SNAP_MINUTES / 2)
      expect(snapDragMinute(snapped)).toBe(snapped)
    }
  })
})

describe('isOnTypedStep', () => {
  it('accepts a typed 1:40, and 6:00 through 22:00', () => {
    expect(isOnTypedStep(100)).toBe(true)
    expect(isOnTypedStep(DAY_START_MINUTE)).toBe(true)
    expect(isOnTypedStep(DAY_END_MINUTE)).toBe(true)
  })

  it('rejects a minute that misses the five-minute step', () => {
    expect(isOnTypedStep(97)).toBe(false)
    expect(isOnTypedStep(22 * 60 + 1)).toBe(false)
  })
})

describe('isWithinDay', () => {
  it('accepts the whole visible day, so both ends may sit on the edges', () => {
    expect(isWithinDay({ startMinute: 360, endMinute: 1320 })).toBe(true)
  })

  it('accepts a block in the free stretch between work intervals', () => {
    expect(isWithinDay({ startMinute: 720, endMinute: 840 })).toBe(true)
  })

  it('rejects 5:55 and 22:05, which cross the edges', () => {
    expect(isWithinDay({ startMinute: 355, endMinute: 1320 })).toBe(false)
    expect(isWithinDay({ startMinute: 360, endMinute: 1325 })).toBe(false)
  })
})

describe('rangesOverlap', () => {
  const work: { startMinute: number; endMinute: number } = {
    startMinute: 480,
    endMinute: 720,
  }

  it('allows touching stretches, because one may end where the next begins', () => {
    expect(rangesOverlap(work, { startMinute: 720, endMinute: 840 })).toBe(false)
    expect(rangesOverlap(work, { startMinute: 450, endMinute: 480 })).toBe(false)
  })

  it('refuses a stretch with real minutes in common', () => {
    expect(rangesOverlap(work, { startMinute: 660, endMinute: 840 })).toBe(true)
    expect(rangesOverlap(work, { startMinute: 540, endMinute: 600 })).toBe(true)
  })

  it('leaves a genuinely free stretch alone', () => {
    // 14:10–15:00, well clear of the 8:00–12:00 interval above.
    expect(rangesOverlap(work, { startMinute: 850, endMinute: 900 })).toBe(false)
  })
})

describe('column geometry', () => {
  it('measures the column as the 960 minutes between 6:00 and 22:00', () => {
    expect(DAY_SPAN_MINUTES).toBe(960)
  })

  it('scales a block by its real length', () => {
    expect(heightPercent(15)).toBe((15 / 960) * 100)
    expect(heightPercent(100)).toBe((100 / 960) * 100)
  })

  it('puts 6:00 at the top and 22:00 at the bottom', () => {
    expect(topPercent(DAY_START_MINUTE)).toBe(0)
    expect(topPercent(DAY_END_MINUTE)).toBe(100)
    expect(topPercent(720)).toBe(37.5)
  })

  it('places a 100-minute block at 8:00 by its own top and height', () => {
    expect(topPercent(480)).toBe(12.5)
    expect(heightPercent(100)).toBeCloseTo(10.416666, 5)
  })
})

describe('the two steps stay separate', () => {
  it('drags on quarters and types on fives', () => {
    expect(DRAG_SNAP_MINUTES).toBe(15)
    expect(TYPED_STEP_MINUTES).toBe(5)
    // 1:40 is a legal typed time but not a legal drag position.
    expect(isOnTypedStep(100)).toBe(true)
    expect(snapDragMinute(100)).toBe(105)
  })
})
