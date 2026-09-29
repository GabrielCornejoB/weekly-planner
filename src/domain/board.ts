/**
 * The blank week: what the board looks like the first time it opens, and what
 * Reset puts back. It is work hours and nothing else.
 *
 * Ids are injected rather than generated here, so the same builder is used by
 * the app, which passes `crypto.randomUUID`, and by tests, which pass a counter
 * and get a board they can assert on.
 */

import { BOARD_VERSION, type Board, type DayPlan } from '@/domain/types'

/** Where every new id comes from. The app passes `crypto.randomUUID` at the edge. */
export type CreateId = () => string

/** The usual weekday, in minutes from midnight. */
const MORNING_START_MINUTE = 480 // 8:00
const MORNING_END_MINUTE = 720 // 12:00
const AFTERNOON_START_MINUTE = 840 // 14:00
const AFTERNOON_END_MINUTE = 1020 // 17:00

/** No commute, no tasks, no blocks: a day with nothing on it. */
function emptyDay(): DayPlan {
  return { workIntervals: [], commuteBeforeMinutes: 0, commuteAfterMinutes: 0 }
}

/**
 * 8:00–12:00 and 14:00–17:00. The 12:00–14:00 hole is not an object: it is
 * free because no interval covers it.
 */
function workday(createId: CreateId): DayPlan {
  return {
    workIntervals: [
      {
        id: createId(),
        startMinute: MORNING_START_MINUTE,
        endMinute: MORNING_END_MINUTE,
      },
      {
        id: createId(),
        startMinute: AFTERNOON_START_MINUTE,
        endMinute: AFTERNOON_END_MINUTE,
      },
    ],
    commuteBeforeMinutes: 0,
    commuteAfterMinutes: 0,
  }
}

/**
 * The preset board. A fresh `DayPlan` per day, so two calls share no object
 * reference and editing one board cannot reach into another.
 *
 * The days are spelled out rather than looped over `DAYS` so that a new day in
 * the union fails the build here instead of turning into a day with no plan.
 */
export function createDefaultBoard(createId: CreateId): Board {
  return {
    version: BOARD_VERSION,
    days: {
      monday: workday(createId),
      tuesday: workday(createId),
      wednesday: workday(createId),
      thursday: workday(createId),
      friday: workday(createId),
      saturday: emptyDay(),
      sunday: emptyDay(),
    },
    goals: [],
    sessions: [],
    oneOffs: [],
  }
}

/**
 * What Reset installs. It takes no board on purpose: reset discards the whole
 * document, task definitions included, so there is nothing to carry over. The
 * caller replaces its state with the result and saves.
 */
export function resetBoard(createId: CreateId): Board {
  return createDefaultBoard(createId)
}
