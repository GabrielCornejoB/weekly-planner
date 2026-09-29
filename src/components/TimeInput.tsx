/**
 * A time of day, typed as the hour and the minutes after it.
 *
 * This is a sibling of `DurationInput`, not a copy of it, and the difference is
 * the question being asked. A duration is "how long" and a clock is "when", so
 * `5:00` here is five in the morning rather than five hours, and the two boxes
 * are labelled for the time rather than for a length. They are still two boxes
 * rather than one box asking for `8:00`, for the reason `DurationInput` gives:
 * a controlled number box cannot be emptied, and a colon is a character a thumb
 * has to find.
 *
 * The field reports minutes from midnight and nothing else. It does not know
 * that a block may not start before 6:00 or end after 22:00, and it does not
 * snap: a 1:37 typed here comes out as 97 and the mutation that owns the rule
 * says no in its own words.
 *
 * Decisions recorded here:
 *
 * - **The boxes are held as text and re-read the prop only when the prop moves.**
 *    Exactly `DurationInput`'s rule, for exactly its reason: clearing a
 *    controlled number box puts a number straight back and the next digit
 *    appends to that, and a refusal leaves the prop where it was, so refilling
 *    from it would throw away the number the person just fixed.
 * - **The minutes box steps by five, which is the typed step the domain asks
 *    about.** A whole number of hours added to a multiple of five is a multiple
 *    of five, so whatever this field reports is already on the step and the two
 *    rules cannot contradict each other. `100` typed in the minutes box is read
 *    as exactly that rather than being capped, since 1:40 after an hour is a
 *    perfectly ordinary time to type.
 * - **Neither box is capped.** A time outside 6:00–22:00 is a real possibility
 *    while somebody is still typing, and the refusal that says so belongs to
 *    the domain and arrives with a sentence. Capping the field would hide the
 *    number the person typed and replace it with a neighbouring one.
 */

import { useId, useState } from 'react'

import { TYPED_STEP_MINUTES } from '@/domain/types'

/** There is no date in this app, but there are still sixty minutes in an hour. */
const MINUTES_IN_HOUR = 60

/** The one look for every text box in the app, the same one `DurationInput` uses. */
const BOX =
  'w-full min-h-11 rounded-lg border border-stone-300 bg-white px-3 py-2 text-stone-900'

interface TimeInputProps {
  label: string
  /** The time as minutes from midnight, the way the board holds every time. */
  minute: number
  onChange: (minute: number) => void
}

export function TimeInput({ label, minute, onChange }: TimeInputProps) {
  const hourId = useId()
  const minuteId = useId()

  const hours = Math.floor(minute / MINUTES_IN_HOUR)
  const rest = minute - hours * MINUTES_IN_HOUR

  const [hoursText, setHoursText] = useState(() => String(hours))
  const [restText, setRestText] = useState(() => String(rest))
  const [readFrom, setReadFrom] = useState(minute)

  // A value that moved while these boxes were open came from somewhere else: the
  // other field in the same editor, an imported board, or a change made away
  // from this dialog. Adjusting state during the render that noticed it is
  // React's own way of doing that without an effect, and it cannot loop,
  // because the value it records is the one it acted on.
  if (minute !== readFrom) {
    setReadFrom(minute)
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
          <label htmlFor={hourId} className="mb-1 block text-xs text-stone-500">
            Hour
          </label>
          <input
            id={hourId}
            type="number"
            inputMode="numeric"
            min={0}
            value={hoursText}
            onChange={(event) => edit('hours', event.target.value)}
            className={BOX}
          />
        </div>
        <div className="flex-1">
          <label htmlFor={minuteId} className="mb-1 block text-xs text-stone-500">
            Minute
          </label>
          <input
            id={minuteId}
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
 * Digits and nothing else, so an empty box, a box holding a sign, and a box
 * holding a decimal point all report nothing rather than reporting a time
 * nobody finished typing.
 */
function count(text: string): number | null {
  return /^\d{1,3}$/.test(text) ? Number(text) : null
}
