/**
 * The board vocabulary. Every rule and every component reads its shapes from
 * here, so the UI and the schedule cannot drift apart.
 *
 * Times are plain minutes from midnight. There are no `Date` objects and the
 * board is not tied to a calendar: `monday` is just the first column.
 */

export const BOARD_VERSION = 1 as const

/** The visible day runs 6:00 to 22:00. Nothing starts earlier or ends later. */
export const DAY_START_MINUTE = 360
export const DAY_END_MINUTE = 1320

/** Drag and grid resize land on a quarter hour. */
export const DRAG_SNAP_MINUTES = 15
/** Typed time fields step by five minutes, so 1:40 is a valid time. */
export const TYPED_STEP_MINUTES = 5

/** Activity and work intervals are never shorter than a quarter hour. */
export const MIN_ACTIVITY_MINUTES = 15
/** Travel and commute are either nothing, or at least five minutes. */
export const MIN_TRAVEL_MINUTES = 5
export const MIN_WORK_MINUTES = 15

export const MAX_NAME_LENGTH = 40

export const DAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const

export type DayId = (typeof DAYS)[number]

/** Commute is stored as a length, not as a range, and it brackets the work day. */
export interface TravelMinutes {
  beforeMinutes: number
  afterMinutes: number
}

export interface WorkInterval {
  id: string
  startMinute: number
  endMinute: number
}

/**
 * Which end of a block a resize grabs. The grid reports one edge at a time and
 * the mutation keeps the other end where it is, so a drag never has to restate
 * a whole range to shorten a block by a minute.
 */
export type ResizeEdge = 'start' | 'end'

export interface DayPlan {
  workIntervals: WorkInterval[]
  commuteBeforeMinutes: number
  commuteAfterMinutes: number
}

/** The twelve palette ids. A task or one-off picks one, never a free hex. */
export type ColorId =
  | 'red'
  | 'orange'
  | 'amber'
  | 'lime'
  | 'green'
  | 'teal'
  | 'sky'
  | 'blue'
  | 'indigo'
  | 'violet'
  | 'pink'
  | 'rose'

/** Quota in minutes. A count goal does not carry one. */
export interface TimeGoal {
  id: string
  kind: 'time'
  name: string
  colorId: ColorId
  goalMinutes: number
  defaultActivityMinutes: number
  defaultTravel: TravelMinutes
}

/** Quota in visits. The length of each visit does not count toward it. */
export interface CountGoal {
  id: string
  kind: 'count'
  name: string
  colorId: ColorId
  goalCount: number
  defaultActivityMinutes: number
  defaultTravel: TravelMinutes
}

/**
 * The definition of a task. The kind is fixed at create time: a time goal
 * cannot become a count goal.
 */
export type Goal = TimeGoal | CountGoal

/** One placed block of a goal. The UI says "task", the code says "session". */
export interface Session {
  id: string
  goalId: string
  day: DayId
  startMinute: number
  activityMinutes: number
  travel: TravelMinutes
  travelFollowsDefault: boolean
  done: boolean
}

/** A one-off is a placed block with no goal, no quota, and no default travel. */
export interface OneOff {
  id: string
  name: string
  colorId: ColorId
  day: DayId
  startMinute: number
  activityMinutes: number
  travel: TravelMinutes
  done: boolean
}

export interface Board {
  version: typeof BOARD_VERSION
  days: Record<DayId, DayPlan>
  goals: Goal[]
  sessions: Session[]
  oneOffs: OneOff[]
}

/**
 * Every reason a mutation may refuse, in one closed set. The wording lives in
 * `refusalMessage`, so components render a sentence instead of building one.
 */
export type RefusalReason =
  | 'outside-day'
  | 'overlaps'
  | 'too-short'
  | 'not-a-step'
  | 'empty-name'
  | 'name-too-long'
  | 'invalid-quota'
  | 'kind-locked'
  | 'missing-goal'
  | 'missing-work'
  | 'missing-block'
  | 'commute-without-work'
  | 'invalid-backup'
  | 'storage-unavailable'

/** Mutations are immutable and refuse rather than repair. */
export type Result<T> = { ok: true; value: T } | { ok: false; reason: RefusalReason }
