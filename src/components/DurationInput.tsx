/**
 * A length in minutes, typed as hours and the minutes after them.
 *
 * This one field is behind every duration in the app: a time budget, a task's
 * default block length, the minutes of travel on either side of a block, an
 * event's own length, and a commute. It exists because a single box asking for
 * `300` is a worse question than two boxes asking for `5` and `0`, and because
 * "1 hour 40 minutes" has to be reachable at all — a stepper in whole quarters
 * cannot express it and a number of minutes typed by thumb rarely lands on one.
 *
 * The field reports minutes and nothing else. It does not know what the length is
 * for, so it cannot refuse one: a ten-minute quota, a three-minute walk, and a
 * length that is not on the five-minute step all come out of here as plain
 * numbers, and the mutation that owns the rule says no in its own words. What
 * this component holds is the two boxes the person is typing into.
 *
 * Decisions recorded here:
 *
 * - **The two boxes are held as text, and re-read the props only when the props
 *   actually move.** A controlled number box cannot be emptied — clearing it
 *   would immediately put a number back and the next digit would append to that
 *   — so the text is kept here. It is replaced from the props when the value
 *   arrives from somewhere else, which is the other block in the same editor, an
 *   imported board, or a change the domain made somewhere else entirely. It is
 *   *not* replaced when an edit was refused, because a refusal leaves the prop
 *   exactly where it was, and wiping the box would throw away the number the
 *   person just fixed in favour of the number that was already wrong.
 * - **An empty or half-typed box reports nothing.** There is no value to report
 *   yet, and reporting `0` would mean the domain was being asked about a length
 *   nobody had finished typing.
 * - **The minutes box steps by five, and the hours box does not.** An hour is 60
 *   minutes, so a whole number of hours added to a multiple of five is always a
 *   multiple of five: whatever this field reports is already on the step the
 *   domain asks about, and the two rules cannot contradict each other. The
 *   minutes box is also left uncapped, because `100` typed there is a fair way of
 *   writing one hour and forty minutes and is read as exactly that.
 */

import { useId, useState } from 'react'

import { TYPED_STEP_MINUTES } from '@/domain/types'

/** There is no date in this app, but there are still sixty minutes in an hour. */
const MINUTES_IN_HOUR = 60

/** The one look for every text box in the app. */
const BOX =
  'w-full min-h-11 rounded-lg border border-stone-300 bg-white px-3 py-2 text-stone-900'

export interface DurationInputProps {
  label: string
  /** The length in minutes, as the board currently holds it. */
  minutes: number
  onChange: (minutes: number) => void
}

export function DurationInput({ label, minutes, onChange }: DurationInputProps) {
  const hoursId = useId()
  const minutesId = useId()

  const hours = Math.floor(minutes / MINUTES_IN_HOUR)
  const rest = minutes - hours * MINUTES_IN_HOUR

  const [hoursText, setHoursText] = useState(() => String(hours))
  const [restText, setRestText] = useState(() => String(rest))
  const [readFrom, setReadFrom] = useState(minutes)

  // A value that moved while these boxes were open is one this component did not
  // put there, so the boxes are refilled from it. Adjusting state during the
  // render that noticed the change is React's own way of doing this without an
  // effect, and it cannot loop: the value it records is the one it acted on.
  if (minutes !== readFrom) {
    setReadFrom(minutes)
    setHoursText(String(hours))
    setRestText(String(rest))
  }

  function edit(field: 'hours' | 'rest', text: string) {
    const whole = count(field === 'hours' ? text : hoursText)
    const part = count(field === 'rest' ? text : restText)
    if (field === 'hours') setHoursText(text)
    else setRestText(text)
    if (whole === null || part === null) return
    onChange(whole * MINUTES_IN_HOUR + part)
  }

  return (
    <fieldset>
      <legend className="mb-1 text-sm text-stone-600">{label}</legend>
      <div className="flex items-end gap-3">
        <div className="flex-1">
          <label htmlFor={hoursId} className="mb-1 block text-xs text-stone-500">
            Hours
          </label>
          <input
            id={hoursId}
            type="number"
            inputMode="numeric"
            min={0}
            value={hoursText}
            onChange={(event) => edit('hours', event.target.value)}
            className={BOX}
          />
        </div>
        <div className="flex-1">
          <label htmlFor={minutesId} className="mb-1 block text-xs text-stone-500">
            Minutes
          </label>
          <input
            id={minutesId}
            type="number"
            inputMode="numeric"
            min={0}
            step={TYPED_STEP_MINUTES}
            value={restText}
            onChange={(event) => edit('rest', event.target.value)}
            className={BOX}
          />
        </div>
      </div>
    </fieldset>
  )
}

/**
 * What a box of digits means, or `null` when it does not mean anything yet.
 *
 * One to three digits and nothing else, so an empty box, a box holding a sign,
 * and a box holding a decimal point all report nothing rather than reporting a
 * length nobody typed.
 */
function count(text: string): number | null {
  return /^\d{1,3}$/.test(text) ? Number(text) : null
}
