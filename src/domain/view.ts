/**
 * View models: a board, turned into the rows and blocks two components render.
 *
 * A component is allowed to lay things out and nothing else, so every decision
 * that is really a decision *about the board* is made here: what a block is
 * called, how tall it is in its column, whether a finger may drag it, which
 * color it wears, and what a row of the task list says. What is left over for a
 * component is layout, which is legitimately its own.
 *
 * These are pure functions of a `Board`. They change nothing and refuse nothing,
 * and they never reach past their argument. A view model that also asked the
 * domain a question would be a rule wearing a component's clothes, which is the
 * one thing this split exists to prevent.
 *
 * Selection is deliberately *not* here. Which task is chosen in order to place
 * it is interface state rather than board state, so it travels as a prop and
 * cannot be baked into a model that is a function of the board alone.
 *
 * Decisions recorded here, each pinned by a test:
 *
 * - **The grid is drawn from occupancy, not by walking the four lists.** Every
 *   rectangle on the week chart is a stretch, and `dayOccupancy` already reports
 *   all of them in clock order with the work, the commute, the activities, and
 *   the travels of a day in one list. Building the view out of that list is why
 *   a commute cannot be forgotten, why a block with travel is three strips
 *   rather than one, and why the order on screen is the order in time rather than
 *   the order things were created.
 * - **A travel strip is its own block, and it is a quiet one.** The product says
 *   travel is drawn *on* the block and is visually distinct in the same color
 *   family, so it gets its own `topPercent` and `heightPercent` and its own tone.
 *   That is also why a grid resize reports the *activity's* edge: the rectangle a
 *   finger lands on is the activity, and the minute a drag reports is that
 *   rectangle's edge. A travel strip is not independently draggable or
 *   resizable, and its `target` is the block that owns it, so a tap on it opens
 *   that block's editor rather than doing nothing.
 * - **A commute has no target, because it belongs to the day.** It hangs off the
 *   outer ends of the day's work, so there is no block behind it to open and it
 *   is not draggable at all; the day header is what opens the day editor. It is
 *   never `done`, because work is not a task and there is nothing to have done.
 * - **Only work and activity carry their own color.** A block's name and color
 *   live on its *goal*, never on the session, which is why a rename or a recolor
 *   needs no loop here to reach every block of that task. Work and commute have
 *   no task color at all and are drawn in stone, so blocked time is never
 *   mistaken for a task. A travel strip takes the color of the block it belongs
 *   to, and the component picks the soft shade because the tone says `travel`.
 * - **`done` mirrors the block, and a travel strip inherits it.** The grid has to
 *   make a done block look settled without losing its color, and a strip on a
 *   settled block is settled. The word itself is in `detail` rather than left to
 *   a component, so the two facts — how long, and that it is done — travel
 *   together and a done visit still shows its length, which the product scope
 *   asks for.
 * - **A detail is one short line or nothing.** A five-minute travel strip has no
 *   room for text, so a commute and a travel strip carry none; a work interval
 *   carries its clock range, because that is the fact a reader wants from a
 *   blocked rectangle at a glance.
 * - **`id` is a view key, and it is unique across the whole model.** It is not a
 *   board id, because a commute has no board id and the same field has to be a
 *   string for all four tones. A key names the kind, the board id, and — where a
 *   block is drawn as more than one strip — which part of it this is, so a
 *   session's activity and its two travel strips are three keys and not one. A
 *   work interval and a session that somehow shared a raw id still get different
 *   keys, because the kind is in there too.
 * - **A row's `status` is `progress.ts`'s, not a second opinion.** A goal row
 *   carries the whole `GoalProgress` rather than two copied fields, so the
 *   sentence and the status cannot come from different calculations, and task 18
 *   does not have to re-derive a number it is about to show.
 * - **A one-off row is not a progress row.** The product scope gives a one-off no
 *   fraction — done is only a mark on that event — so a one-off row is a
 *   different case of the union with its own day and clock range and no quota at
 *   all. It is also not selectable, since selecting a task is what places that
 *   task's defaults and a one-off has none.
 * - **The list is goals first, then one-offs, and neither is sorted.** Goals are
 *   appended and never sorted by design, and a block list keeps the order the
 *   person made it, so a row appears in the order it was created.
 * - **The hour lines are decided here, so the grid never does geometry.** Hour
 *   lines are the main guides and half hours are faint, from 6:00 through 22:00
 *   inclusive, and each carries the percentage it sits at. A component that drew
 *   them itself would be inventing a scale the product scope states in words.
 * - **A session whose task is not on the board is still drawn.** A stored blob
 *   can name a task that is gone, and the block holds real minutes, so hiding it
 *   would hide a real conflict. It is labelled as the broken thing it is and
 *   given no color, because there is no task color to inherit and inventing one
 *   would be a lie.
 */

import { findGoal } from '@/domain/goals'
import { goalProgress, type GoalProgress } from '@/domain/progress'
import {
  dayOccupancy,
  footprintRange,
  oneOffFootprint,
  type BlockTarget,
  type OccupiedStretch,
  type PlacedTarget,
} from '@/domain/schedule'
import { formatClock, formatDuration, heightPercent, topPercent } from '@/domain/time'
import {
  DAYS,
  DAY_END_MINUTE,
  DAY_START_MINUTE,
  type Board,
  type ColorId,
  type DayId,
  type Goal,
  type OneOff,
} from '@/domain/types'

/**
 * Whatever a grid block belongs to. Re-exported because the plan's rule is that a
 * component may not import from `schedule.ts`, while `WeekGrid` still has to be
 * able to *name* this in `onBlockTap(target)`. It is vocabulary, not a rule, so
 * the view model carries it out to the edge where it is needed.
 */
export type { BlockTarget } from '@/domain/schedule'

/** How a strip is colored. Work and commute are stone; the rest wear a hue. */
export type GridTone = 'work' | 'commute' | 'activity' | 'travel'

/**
 * One rectangle on the week chart, with everything needed to draw it and
 * everything needed to decide what a touch on it means.
 *
 * `topPercent` and `heightPercent` are read off the geometry, not invented by
 * the component: 6:00 is 0 and 22:00 is 100, and a fifteen-minute block is
 * `15 / 960` of its column. The grid applies them.
 */
export interface GridBlockView {
  /**
   * A key unique across the whole model, made of the kind, the board id, and the
   * part of the block this is: `work:w-am`, `session:s1:activity`,
   * `session:s1:before`, `commute:monday:after`.
   */
  id: string
  day: DayId
  topPercent: number
  heightPercent: number
  /** The name on the block, or `Work` or `Travel` for the two quiet tones. */
  label: string
  /** The second line, or `null` when there is nothing useful to say. */
  detail: string | null
  tone: GridTone
  /** `null` for work, commute, and a block whose task is missing. */
  colorId: ColorId | null
  done: boolean
  /** What a touch on this block acts on, or `null` for a commute. */
  target: BlockTarget | null
  draggable: boolean
  resizable: boolean
}

/** One column: the day's name and its rectangles, in clock order. */
export interface GridDayView {
  day: DayId
  label: string
  blocks: GridBlockView[]
}

/** One horizontal rule in the chart. Hours are guides, half hours are faint. */
export interface GridLineView {
  minute: number
  /** The clock text, on an hour line only. A half hour has no label. */
  label: string | null
  major: boolean
  topPercent: number
}

/** Everything `WeekGrid` draws. It owns the layout and nothing else. */
export interface GridModel {
  days: GridDayView[]
  lines: GridLineView[]
}

/** A day and its name, for a day select. */
export interface DayOption {
  day: DayId
  label: string
}

/** A task in the list, with its progress. */
export interface GoalListRow {
  kind: 'goal'
  id: string
  name: string
  colorId: ColorId
  /**
   * The whole record from `progress.ts`, so the sentence and the status a row
   * renders cannot come from two different calculations, and the orchestrator
   * does not re-derive a number it is about to show.
   */
  progress: GoalProgress
}

/** An event in the list. It has a time and a mark, and no fraction at all. */
export interface OneOffListRow {
  kind: 'one-off'
  id: string
  name: string
  colorId: ColorId
  day: DayId
  dayLabel: string
  /** The span the event occupies, travel included: `18:00-19:00`. */
  when: string
  done: boolean
}

export type TaskListRow = GoalListRow | OneOffListRow

/** The day names, as the column headers and a day select show them. */
const DAY_LABELS: Record<DayId, string> = {
  monday: 'Monday',
  tuesday: 'Tuesday',
  wednesday: 'Wednesday',
  thursday: 'Thursday',
  friday: 'Friday',
  saturday: 'Saturday',
  sunday: 'Sunday',
}

/** The seven days in board order, ready to hand to a day select. */
export const DAY_OPTIONS: readonly DayOption[] = DAYS.map((day) => ({
  day,
  label: DAY_LABELS[day],
}))

const WORK_LABEL = 'Work'
const TRAVEL_LABEL = 'Travel'
const DONE_LABEL = 'Done'
/** Between the two ends of a range. The two are the same fact, not a sentence. */
const RANGE_SEPARATOR = '–'
/** The two middles, for a detail that carries a length and a state. */
const DETAIL_SEPARATOR = ' · '

/** A session whose task is not on this board. Nobody can name it. */
const MISSING_TASK_LABEL = 'Task not on this board'
/** A block `dayOccupancy` named but the board cannot account for. */
const MISSING_BLOCK_LABEL = 'Unknown block'

/** What one placed block shows: its name, its hue, and whether it is settled. */
interface OwnerView {
  name: string
  colorId: ColorId | null
  done: boolean
}

/**
 * The fallback for a stretch whose owner is not on the board.
 *
 * `dayOccupancy` only reports stretches for blocks that are on the board, so
 * nothing a real board produces reaches this. It exists because a `Map` lookup
 * is `T | undefined` and this module may not assert its way out of one, and
 * because a view model that threw would take the whole week down over one
 * rectangle.
 */
const MISSING_OWNER: OwnerView = {
  name: MISSING_BLOCK_LABEL,
  colorId: null,
  done: false,
}

/**
 * The week, as seven columns of rectangles and the rules behind them.
 *
 * Nothing here is filtered, clamped, or repaired. If a stretch reaches outside
 * the day — which only a board that skipped every check can do — the percentage
 * says so rather than being tidied into the column, because a view model that
 * invents a geometry is a view model that can disagree with the one next to it.
 */
export function toGridModel(board: Board): GridModel {
  const owners = ownerViews(board)
  return {
    days: DAYS.map((day) => ({
      day,
      label: DAY_LABELS[day],
      blocks: dayOccupancy(board, day).map((stretch) => stretchView(owners, day, stretch)),
    })),
    lines: gridLines(),
  }
}

/**
 * One stretch, drawn.
 *
 * The geometry is read off the stretch rather than off the block that produced
 * it, so the rectangle and the numbers that placed it can never disagree: a
 * travel strip's height is its own minutes even though the block's length lives
 * on the activity.
 */
function stretchView(
  owners: Map<string, OwnerView>,
  day: DayId,
  stretch: OccupiedStretch,
): GridBlockView {
  const place = {
    day,
    topPercent: topPercent(stretch.startMinute),
    heightPercent: heightPercent(stretch.endMinute - stretch.startMinute),
  }

  if (stretch.role === 'commute') {
    return {
      ...place,
      id: `commute:${day}:${stretch.direction}`,
      label: TRAVEL_LABEL,
      detail: null,
      tone: 'commute',
      colorId: null,
      done: false,
      target: null,
      draggable: false,
      resizable: false,
    }
  }

  if (stretch.role === 'work') {
    return {
      ...place,
      id: `work:${stretch.target.id}`,
      label: WORK_LABEL,
      detail: clockRange(stretch.startMinute, stretch.endMinute),
      tone: 'work',
      colorId: null,
      done: false,
      target: stretch.target,
      draggable: true,
      resizable: true,
    }
  }

  const key = ownerKey(stretch.target)
  const owner = owners.get(key) ?? MISSING_OWNER

  if (stretch.role === 'travel') {
    return {
      ...place,
      id: `${key}:${stretch.direction}`,
      label: TRAVEL_LABEL,
      detail: null,
      tone: 'travel',
      colorId: owner.colorId,
      done: owner.done,
      target: stretch.target,
      draggable: false,
      resizable: false,
    }
  }

  const length = formatDuration(stretch.endMinute - stretch.startMinute)
  return {
    ...place,
    id: `${key}:activity`,
    label: owner.name,
    detail: owner.done ? `${DONE_LABEL}${DETAIL_SEPARATOR}${length}` : length,
    tone: 'activity',
    colorId: owner.colorId,
    done: owner.done,
    target: stretch.target,
    draggable: true,
    resizable: true,
  }
}

/**
 * What every placed block on this board is called, keyed by the same string its
 * view key is made of.
 *
 * Built once rather than looked up per stretch, and built from the goal rather
 * than from the session, because a session carries no name and no color of its
 * own — that is what makes a rename reach every block of a task without this
 * module keeping a list of them.
 */
function ownerViews(board: Board): Map<string, OwnerView> {
  const owners = new Map<string, OwnerView>()
  for (const session of board.sessions) {
    const goal = findGoal(board, session.goalId)
    owners.set(ownerKey({ kind: 'session', id: session.id }), {
      name: goal === null ? MISSING_TASK_LABEL : goal.name,
      colorId: goal === null ? null : goal.colorId,
      done: session.done,
    })
  }
  for (const oneOff of board.oneOffs) {
    owners.set(ownerKey({ kind: 'one-off', id: oneOff.id }), {
      name: oneOff.name,
      colorId: oneOff.colorId,
      done: oneOff.done,
    })
  }
  return owners
}

/** `session:s1`. The kind is in the key, so no two kinds can collide. */
function ownerKey(target: PlacedTarget): string {
  return `${target.kind}:${target.id}`
}

/** `8:00–12:00`. */
function clockRange(startMinute: number, endMinute: number): string {
  return `${formatClock(startMinute)}${RANGE_SEPARATOR}${formatClock(endMinute)}`
}

/**
 * The horizontal rules, from 6:00 to 22:00 inclusive.
 *
 * Hours are the main guides and half hours are faint, and there is no line every
 * fifteen minutes, because the product says a quarter-hour line is not a guide
 * and a phone column is too narrow for the noise it would add. 22:00 is included:
 * it is the bottom of the visible day, not a half hour past it.
 */
function gridLines(): GridLineView[] {
  const lines: GridLineView[] = []
  for (let minute = DAY_START_MINUTE; minute <= DAY_END_MINUTE; minute += 30) {
    const major = minute % 60 === 0
    lines.push({
      minute,
      label: major ? formatClock(minute) : null,
      major,
      topPercent: topPercent(minute),
    })
  }
  return lines
}

/**
 * The task list, goals first and then one-offs, in the order the board holds
 * them.
 *
 * A goal row carries its `GoalProgress` whole rather than a sentence and a status
 * copied out of it, so the two facts a row renders cannot come from two different
 * calculations. A one-off row is a different case of the union: it has a day, a
 * clock span, and a done mark, and deliberately no quota, no fraction, and no way
 * to be selected for placement.
 */
export function toTaskListModel(board: Board): TaskListRow[] {
  return [...board.goals.map((goal) => goalRow(board, goal)), ...board.oneOffs.map(oneOffRow)]
}

function goalRow(board: Board, goal: Goal): GoalListRow {
  return {
    kind: 'goal',
    id: goal.id,
    name: goal.name,
    colorId: goal.colorId,
    progress: goalProgress(board, goal),
  }
}

/**
 * The span a one-off occupies, which is its whole footprint: travel before,
 * activity, travel after.
 *
 * Read through the footprint rather than from `startMinute` and
 * `activityMinutes`, so the row cannot say 18:00–19:00 for an event that really
 * runs 17:45 to 19:15.
 */
function oneOffRow(oneOff: OneOff): OneOffListRow {
  const range = footprintRange(oneOffFootprint(oneOff))
  return {
    kind: 'one-off',
    id: oneOff.id,
    name: oneOff.name,
    colorId: oneOff.colorId,
    day: oneOff.day,
    dayLabel: DAY_LABELS[oneOff.day],
    when: clockRange(range.startMinute, range.endMinute),
    done: oneOff.done,
  }
}
