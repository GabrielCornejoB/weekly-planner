/**
 * The week chart: seven columns, an hour gutter, and the rectangles on them.
 *
 * Everything this component draws comes out of the `GridModel` it is handed. It
 * computes no percentage, invents no label, and decides nothing about whether a
 * block may go where a finger dropped it: `topPercent` and `heightPercent` are
 * applied as given, and every tap and every drag leaves as a callback for the
 * orchestrator to ask the domain about. The two things it works out for itself
 * are the two that cannot come from a model of a board — where a finger is, and
 * what quarter hour that is.
 *
 * The events, from the plan: an empty tap, a block tap, a drop, a resize, and a
 * day header. A tap on a travel strip or a commute reports the block behind it,
 * which is the session or one-off whose editor the person is asking for, so a
 * five-minute strip is not a dead zone.
 *
 * Decisions recorded here:
 *
 * - **A drag is started on the block and finished on its column.** A block hands
 *   the pointer to the column it lives in, so a drag that has wandered out of
 *   that column still knows which column it is in and can be dropped there.
 *   That is how a block moves from Monday to Friday without the grid ever
 *   holding a day of its own opinion about anything.
 * - **A press is a tap until it has moved.** Six pixels is about the width of a
 *   thumb's drift on a phone. Below it the press is a tap and the block opens;
 *   above it, it is a move or a resize and the block goes where it was dropped.
 * - **An empty tap is cancelled by a scroll, and a block drag cannot be.** Free
 *   space keeps the browser's own touch handling, so a finger that slides down
 *   the chart scrolls the day, the browser sends `pointercancel`, and nothing is
 *   placed. A block and its resize handles are `touch-action: none`, so a finger
 *   that lands on one has already said it means to move it. The cost is that the
 *   day is scrolled from the gutter, the headers, or any free stretch of a
 *   column, which on a week is most of the surface.
 * - **A drag keeps the offset it was grabbed at.** Pressing the middle of a
 *   block and moving it an hour puts its middle an hour later, rather than
 *   throwing the block to the top of the column the way a bare "drop where the
 *   finger is" would.
 * - **A resize reports the finger's own minute, with no offset at all**, because
 *   the strip that was grabbed *is* the edge being moved. For an activity that
 *   is the minute at the end of the activity and the travel stays attached to
 *   the outside; for a work interval it is the work interval's own edge. The
 *   same call serves both, and the domain already knows the difference.
 * - **The column is a fixed height and the day scrolls inside the chart.** The
 *   day headers stay put while the day moves under them, which is what the
 *   product asks for, and a column that grew with its contents would make a
 *   fifteen-minute block as tall as a four-hour one. The scroll box is bounded to
 *   a share of the viewport, which is what makes that true on a phone: a box with
 *   no height bound is never the thing that scrolls, so the *page* would scroll
 *   and a sticky header inside it would go up with the page.
 * - **The hour gutter sticks to the left while the week moves sideways.** Seven
 *   columns are wider than a phone, so the chart scrolls horizontally and a
 *   column stays wide enough to show a name. If the hours scrolled away with the
 *   days, Friday would be a column of shapes with no way to say what time it is,
 *   and the person would be placing blocks by eye. The gutter is painted over
 *   the columns rather than under them, which is what the z-order here is for: the
 *   hour labels are below the blocks in reading order and must not be below them
 *   on screen.
 * - **Nothing is repaired.** A block outside 6:00–22:00 — which only a board that
 *   skipped every check can hold — keeps the percentage the model gave it and
 *   runs out of the column. A chart that tidied it would be showing a different
 *   truth from the one the numbers hold.
 * - **The block does not clip its own overflow; the box of text inside it does.**
 *   The resize strips reach half a handle outside the top and bottom edges, so
 *   clipping the parent would cut them off — which is how a resize handle goes
 *   missing on a quarter-hour block and nobody can work out why. Clipping one
 *   level in costs only the tail of a very short block's name, which is the truth
 *   about it: a fifteen-minute block is fifteen minutes tall.
 * - **The drop is placed in the column the finger is over, asked from its x
 *   coordinate.** The drag captures the pointer on the body rather than on the
 *   block, so a drag that crosses into another column is still tracked and lands
 *   where it was released. Taking the day from whichever column the drag *began*
 *   in would move a block visibly sideways and put it back on the day it came
 *   from, which is the worst answer available: it looks like it worked.
 * - **The gutter is asked about before any column, so a drop over the hours keeps
 *   the day it came from.** This is a consequence of the gutter being sticky: a
 *   pinned gutter means Monday's column slides *underneath* it, and a column's
 *   measured width does not know whether it is on screen. Testing the columns
 *   alone would hand Monday to a finger that is plainly over the hours, and the
 *   block would jump to the far left of the week — the one place a person is
 *   least likely to mean Monday.
 */

import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

import { PALETTE } from '@/colors/palette'
import { DAY_SPAN_MINUTES, snapDragMinute } from '@/domain/time'
import { DAY_START_MINUTE, type DayId, type ResizeEdge } from '@/domain/types'
import type { BlockTarget, GridBlockView, GridModel } from '@/domain/view'

/**
 * How tall one day column is, in pixels.
 *
 * A layout number and not a rule: the model's percentages are of the column
 * whatever the column measures, so this only decides how tall sixteen hours is.
 * It is an hour every 56 pixels, which leaves a fifteen-minute block fourteen
 * pixels tall — small, which is the truth, and the reason a name is clipped
 * rather than a block's height being stretched to fit it.
 */
const DAY_COLUMN_PIXELS = 896

/** How far a finger may drift before a press stops being a tap. */
const TAP_SLOP_PIXELS = 6

/** How tall a resize strip is, reaching half of that outside each edge. */
const HANDLE_PIXELS = 16

/**
 * How much of the screen the chart takes, and what the track inside it is.
 *
 * The height is a share of the viewport rather than a number of pixels, because
 * the day is sixteen hours tall and a phone is not: the day has to scroll inside
 * the chart, and only a box with a height bound is the thing that scrolls. Given
 * no bound, the box grows to the day and the *page* scrolls instead, and a sticky
 * header inside a box that never scrolls goes up with the page — which is exactly
 * the header the product says must stay put. The `min-h` keeps a landscape phone,
 * where a share of the screen is very little, from showing a strip of hours.
 *
 * The track is one complete class and the same width appears twice, in the track
 * and in the floor under it. Tailwind only emits a class it can read whole in the
 * source, so both are written out rather than built from a gutter width and a
 * column count: a name assembled from parts survives in `npm run dev` and compiles
 * to nothing in a production build, which would leave the week in one auto-width
 * pile. It is the same trap `palette.ts` records for a color, and a test in this
 * folder's own source reads for it.
 */
const CHART_BOX = 'h-[70dvh] min-h-[18rem] overflow-auto rounded-xl border border-stone-300 bg-white'
const SEVEN_COLUMNS = 'grid grid-cols-[3rem_repeat(7,minmax(5.5rem,1fr))]'
const WEEK_FLOOR = 'w-full min-w-[42rem]'

/**
 * The one look for a plain text box, and the chart's seven columns.
 *
 * The width is already in the track, so this is only the column's own minimum,
 * which keeps a column from collapsing when the day is a very tall one.
 */
const COLUMN_CLASS = 'min-w-16'

/**
 * What is painted over what, in one place.
 *
 * The chart scrolls in two directions, so three things have to stay legible while
 * it does: the day headers, the hour gutter, and the block under the finger. They
 * are the three numbers here rather than six scattered ones, because a z-index
 * written at a call site is a z-index nobody can reason about. The headers are on
 * top of everything, the gutter is on top of the day columns it covers, and the
 * drop guide is on top of the blocks it points at but under both — it is a line
 * drawn under the finger, and a line that ran across the day names or across the
 * hours would be a line saying something untrue.
 *
 * The handles tie with the guide and lose to it, which is harmless: the guide is
 * `pointer-events-none`, so it can be painted over a handle without ever being
 * able to take a tap from one.
 */
const Z_GUIDE = 10
const Z_HANDLE = 10
const Z_GUTTER = 20
const Z_HEADERS = 30

/**
 * A press that has not become anything else yet.
 *
 * It is held in a ref rather than in state because it has no visual answer:
 * re-rendering the whole week sixty times a second for a press nobody can see
 * would buy nothing.
 */
type Pending =
  | { kind: 'block'; target: BlockTarget; startY: number }
  | { kind: 'free'; day: DayId; startY: number }

/** A press on a draggable block that has become a drag. */
interface Drag {
  kind: 'move' | 'resize'
  target: BlockTarget
  /** Which edge, for a resize. Meaningless for a move, and never read there. */
  edge: ResizeEdge
  pointerId: number
  /** Minutes between the top of the block and the finger that grabbed it. */
  grabMinutes: number
  startY: number
  day: DayId
  /** The raw minute under the finger. Snapping happens when it is reported. */
  fingerMinute: number
  moved: boolean
}

export interface WeekGridProps {
  model: GridModel
  /** A finger landed on free time, at a quarter hour. */
  onEmptyTap: (day: DayId, minute: number) => void
  /** A block was tapped, not dragged. A travel strip reports the block behind it. */
  onBlockTap: (target: BlockTarget) => void
  /** A block was dragged, keeping the offset it was grabbed at. */
  onBlockDrop: (target: BlockTarget, day: DayId, minute: number) => void
  /** One edge of a block was dragged to a quarter hour. */
  onBlockResize: (target: BlockTarget, edge: ResizeEdge, minute: number) => void
  /** A day name was tapped. Work and commute are edited from here. */
  onDayHeaderTap: (day: DayId) => void
}

export function WeekGrid({
  model,
  onEmptyTap,
  onBlockTap,
  onBlockDrop,
  onBlockResize,
  onDayHeaderTap,
}: WeekGridProps) {
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const gutterRef = useRef<HTMLDivElement | null>(null)
  const columns = useRef(new Map<DayId, HTMLDivElement | null>())
  const pending = useRef<Pending | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)

  /**
   * The minute under a finger, unsnapped.
   *
   * The inverse of the model's own `topPercent`: the body's height is one
   * sixteen-hour day, so a finger a tenth of the way down it is ninety-six
   * minutes past 6:00. It is measured rather than assumed, because the column's
   * height is a layout decision made in CSS and the two cannot be allowed to
   * disagree about what a pixel is worth.
   */
  function minuteAt(clientY: number): number {
    const box = bodyRef.current?.getBoundingClientRect()
    if (box === undefined || box.height === 0) return DAY_START_MINUTE
    return DAY_START_MINUTE + ((clientY - box.top) / box.height) * DAY_SPAN_MINUTES
  }

  /** The minutes from the top of a block down to the finger that grabbed it. */
  function offsetWithin(clientY: number, top: number): number {
    const height = bodyRef.current?.getBoundingClientRect().height ?? 0
    if (height === 0) return 0
    return ((clientY - top) / height) * DAY_SPAN_MINUTES
  }

  /**
   * The column a finger is over, or `null` when it is over the hour gutter.
   *
   * Asked from the x coordinate rather than taken from whichever column the drag
   * began in, because the whole of "move a block from Monday to Friday" happens
   * in this one function. A drag that reports the day it started on would move a
   * block sideways on screen and put it back on the same day, which is the worst
   * possible answer: it looks like it worked.
   *
   * The gutter is asked about first, and it is a real question rather than a
   * formality. The gutter is pinned to the left of the scroll box, so the first
   * day's column slides *underneath* it as the week moves sideways, and a column's
   * box keeps reporting the width it really has whether or not it is on screen.
   * Testing the columns alone would therefore hand Monday to a finger that is
   * plainly over the hours, and a block dropped there would jump to the left edge
   * of the week — the one place a person is least likely to mean Monday.
   */
  function dayAt(clientX: number): DayId | null {
    const gutter = gutterRef.current?.getBoundingClientRect()
    if (gutter !== undefined && clientX >= gutter.left && clientX < gutter.right) return null
    for (const [day, column] of columns.current) {
      if (column === null) continue
      const box = column.getBoundingClientRect()
      if (clientX >= box.left && clientX < box.right) return day
    }
    return null
  }

  /** The minute a live drag is reporting: the block's new start, or the new edge. */
  function reported(dragged: Drag): number {
    return snapDragMinute(
      dragged.fingerMinute - (dragged.kind === 'move' ? dragged.grabMinutes : 0),
    )
  }

  function pressBlock(block: GridBlockView, event: ReactPointerEvent<HTMLElement>) {
    // A press on a block is never a press on the free time underneath it, so the
    // column's own press must not see this one.
    event.stopPropagation()
    const target = block.target
    if (target === null) return
    pending.current = { kind: 'block', target, startY: event.clientY }
    if (!block.draggable) return

    // The capture goes on the body rather than on this block, so a drag that
    // crosses into another column is still being tracked and can be dropped
    // there. `dayAt` below is what turns its x coordinate into a day.
    bodyRef.current?.setPointerCapture(event.pointerId)
    setDrag({
      kind: 'move',
      target,
      edge: 'start',
      pointerId: event.pointerId,
      grabMinutes: offsetWithin(event.clientY, event.currentTarget.getBoundingClientRect().top),
      startY: event.clientY,
      day: block.day,
      fingerMinute: minuteAt(event.clientY),
      moved: false,
    })
  }

  function pressEdge(
    block: GridBlockView,
    edge: ResizeEdge,
    event: ReactPointerEvent<HTMLElement>,
  ) {
    event.stopPropagation()
    const target = block.target
    if (target === null) return
    pending.current = { kind: 'block', target, startY: event.clientY }
    bodyRef.current?.setPointerCapture(event.pointerId)
    setDrag({
      kind: 'resize',
      target,
      edge,
      pointerId: event.pointerId,
      grabMinutes: 0,
      startY: event.clientY,
      day: block.day,
      fingerMinute: minuteAt(event.clientY),
      moved: false,
    })
  }

  function pressFree(day: DayId, event: ReactPointerEvent<HTMLElement>) {
    if (drag !== null) return
    pending.current = { kind: 'free', day, startY: event.clientY }
  }

  function track(event: ReactPointerEvent<HTMLElement>) {
    if (drag === null || drag.pointerId !== event.pointerId) return
    setDrag({
      ...drag,
      // A drag that has wandered over the gutter keeps the day it came from,
      // rather than snapping back to the nearest column it happened to leave.
      day: dayAt(event.clientX) ?? drag.day,
      fingerMinute: minuteAt(event.clientY),
      moved: drag.moved || Math.abs(event.clientY - drag.startY) >= TAP_SLOP_PIXELS,
    })
  }

  function settle(event: ReactPointerEvent<HTMLElement>) {
    const dragging = drag
    const pressed = pending.current
    pending.current = null
    setDrag(null)

    if (dragging !== null && dragging.pointerId === event.pointerId) {
      if (!dragging.moved) {
        onBlockTap(dragging.target)
        return
      }
      // Asked once more here, because the last move of a drag is the one that
      // decides where it landed and it may have been the only event to cross
      // into the next column.
      const day = dayAt(event.clientX) ?? dragging.day
      const minute = reported(dragging)
      if (dragging.kind === 'move') onBlockDrop(dragging.target, day, minute)
      else onBlockResize(dragging.target, dragging.edge, minute)
      return
    }

    if (pressed === null) return
    if (Math.abs(event.clientY - pressed.startY) >= TAP_SLOP_PIXELS) return
    if (pressed.kind === 'block') onBlockTap(pressed.target)
    else onEmptyTap(pressed.day, snapDragMinute(minuteAt(event.clientY)))
  }

  /**
   * A gesture the browser took back: a scroll, or a finger that left the page.
   *
   * The press is dropped rather than acted on, which is the difference between
   * a free tap and a scroll on a touch screen and the whole reason free time
   * keeps the browser's own touch handling.
   */
  function abandon() {
    pending.current = null
    setDrag(null)
  }

  return (
    <div className={CHART_BOX}>
      <div className={WEEK_FLOOR}>
        {/* The headers sit above the whole chart while the day scrolls under them. */}
        <div
          className={`sticky top-0 border-b border-stone-300 bg-white ${SEVEN_COLUMNS}`}
          style={{ zIndex: Z_HEADERS }}
        >
          {/*
           * The empty cell over the hour gutter.
           *
           * It carries the chart's own white because it sits over the gutter
           * below it, and a day name sliding left under a transparent cell would
           * show through it.
           */}
          <div className="bg-white" />
          {model.days.map((day) => (
            <button
              key={day.day}
              type="button"
              onClick={() => onDayHeaderTap(day.day)}
              className="min-h-11 border-l border-stone-200 px-1 py-2 text-xs font-medium text-stone-700"
            >
              {day.label}
            </button>
          ))}
        </div>

        <div
          ref={bodyRef}
          className={SEVEN_COLUMNS}
          onPointerMove={track}
          onPointerUp={settle}
          onPointerCancel={abandon}
        >
          {/*
           * The hour gutter, pinned to the left of the scroll box.
           *
           * It scrolls with the day vertically, because the hours belong to the
           * minute they name, and it stays put horizontally, because a week is
           * wider than a phone and a column of shapes with no times on it is a
           * picture rather than a chart. The white background is what makes it
           * usable: the columns pass underneath it, so anything that scrolls in
           * from the right would otherwise show through the numbers.
           */}
          <div
            ref={gutterRef}
            className="sticky left-0 bg-white"
            style={{ height: DAY_COLUMN_PIXELS, zIndex: Z_GUTTER }}
          >
            <div className="relative h-full">
              {model.lines
                .filter((line) => line.label !== null)
                .map((line) => (
                  <span
                    key={line.minute}
                    style={{ top: `${line.topPercent}%` }}
                    className={`absolute right-1 text-[10px] tabular-nums text-stone-500 ${
                      line.topPercent >= 100 ? '-translate-y-full' : '-translate-y-1/2'
                    }`}
                  >
                    {line.label}
                  </span>
                ))}
            </div>
          </div>

          {model.days.map((day) => (
            <div
              key={day.day}
              ref={(node) => {
                columns.current.set(day.day, node)
              }}
              style={{ height: DAY_COLUMN_PIXELS }}
              className={`relative ${COLUMN_CLASS} border-l border-stone-200`}
              onPointerDown={(event) => pressFree(day.day, event)}
            >
              {model.lines.map((line) => (
                <div
                  key={line.minute}
                  style={{ top: `${line.topPercent}%` }}
                  className={`pointer-events-none absolute inset-x-0 h-px ${
                    line.major ? 'bg-stone-300' : 'bg-stone-100'
                  }`}
                />
              ))}

              {day.blocks.map((block) => (
                <Block key={block.id} block={block} pressBlock={pressBlock} grabEdge={pressEdge} />
              ))}

              {drag !== null && drag.moved && drag.day === day.day && (
                <div
                  style={{ top: `${dayPercent(reported(drag))}%`, zIndex: Z_GUIDE }}
                  className="pointer-events-none absolute inset-x-0 h-0.5 rounded bg-stone-900/70"
                />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/**
 * A minute as a percentage of the day, for the one line the chart draws itself.
 *
 * The inverse of `topPercent` again, and the only geometry invented here: it is
 * a guide for the finger, not a block, so it has no model to come from.
 */
function dayPercent(minute: number): number {
  const within = Math.min(DAY_START_MINUTE + DAY_SPAN_MINUTES, Math.max(DAY_START_MINUTE, minute))
  return ((within - DAY_START_MINUTE) / DAY_SPAN_MINUTES) * 100
}

/**
 * One rectangle.
 *
 * The two things a block reports upwards are named after what they do rather
 * than like callbacks, for the reason `GoalForm` records: a component's
 * *declared* callbacks are read as the events the app hands it, so a private
 * detail wearing that shape would be counted among the public ones.
 */
interface BlockProps {
  block: GridBlockView
  pressBlock: (block: GridBlockView, event: ReactPointerEvent<HTMLElement>) => void
  grabEdge: (
    block: GridBlockView,
    edge: ResizeEdge,
    event: ReactPointerEvent<HTMLElement>,
  ) => void
}

function Block({ block, pressBlock, grabEdge }: BlockProps) {
  const canResize = block.resizable && block.target !== null
  return (
    <div
      style={{ top: `${block.topPercent}%`, height: `${block.heightPercent}%` }}
      className={`absolute inset-x-0 rounded px-1 ${classesFor(block)}`}
    >
      <div
        onPointerDown={(event) => pressBlock(block, event)}
        className={`absolute inset-0 ${block.draggable ? 'touch-none' : ''}`}
      />
      {/*
       * The block's own text, clipped to the block.
       *
       * The clipping is here rather than on the block, because the block's
       * resize strips reach half a handle outside its top and bottom edges and
       * clipping the parent would cut them off. Here it costs only the last line
       * of a quarter-hour block, which is the honest outcome: the block really
       * is that short, and letting a name run out over the block underneath it
       * would draw a word on minutes the block does not occupy.
       */}
      <div className="pointer-events-none overflow-hidden py-0.5">
        <p className="truncate text-[10px] font-medium leading-tight">{block.label}</p>
        {block.detail !== null && (
          <p className="truncate text-[9px] leading-tight opacity-80">{block.detail}</p>
        )}
      </div>
      {canResize &&
        (['start', 'end'] as const).map((edge) => (
          <div
            key={edge}
            aria-hidden="true"
            onPointerDown={(event) => grabEdge(block, edge, event)}
            style={{
              zIndex: Z_HANDLE,
              ...(edge === 'start'
                ? { height: HANDLE_PIXELS, top: -HANDLE_PIXELS / 2 }
                : { height: HANDLE_PIXELS, bottom: -HANDLE_PIXELS / 2 }),
            }}
            className="absolute inset-x-0 cursor-ns-resize touch-none"
          />
        ))}
    </div>
  )
}

/**
 * The classes one rectangle wears.
 *
 * Work and commute are stone, and stay stone, because a hue on this board means
 * a task and blocked time is not one. A travel strip takes the soft shade of the
 * block it belongs to, so the two read as one thing. A block whose task is not
 * on the board has no hue to inherit, so it falls back to stone rather than being
 * given a made-up one.
 */
function classesFor(block: GridBlockView): string {
  if (block.tone === 'commute') return 'border border-stone-300 bg-stone-200 text-stone-700'
  if (block.tone === 'work') return 'border border-stone-400 bg-stone-300 text-stone-900'
  const palette = block.colorId === null ? null : PALETTE[block.colorId]
  if (block.tone === 'travel') {
    return palette === null
      ? 'border border-stone-300 bg-stone-200 text-stone-700'
      : `border border-stone-300 ${palette.soft} ${palette.text}`
  }
  if (palette === null) return 'border border-stone-400 bg-stone-300 text-stone-900'
  return `border border-transparent ${palette.solid} text-white`
}
