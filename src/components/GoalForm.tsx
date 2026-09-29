/**
 * A task definition: a name, a color, a quota, and the defaults its first block
 * will start with.
 *
 * The form holds the whole draft and hands all of it up at once. That is not a
 * style choice: a draft *is* the whole goal in the domain, so a form that
 * submitted a patch would be a second shape for the same thing, and a name edit
 * that could be half applied would be a name edit that sometimes is.
 *
 * It validates nothing. An empty name, a quota of zero, a three-minute default
 * block, and a name one character over the limit all come out of here as drafts
 * and are answered by the mutation that owns the rule, in that rule's own words.
 * The only thing this form decides is which kind a *new* task is.
 *
 * Decisions recorded here:
 *
 * - **The kind is chosen once, and a task being edited does not get to choose it
 *   at all.** The product is explicit that a time budget cannot become a visit
 *   count or the reverse, so an existing task's kind is shown as a line of text
 *   with no control beside it. The condition the plan calls `kindLocked` is that
 *   one, and it is *read off* the goal rather than passed in beside it: two props
 *   both saying which task is being edited could disagree, and the one that
 *   decides which fields the form even has is not the place for that.
 * - **Switching kind on a new task keeps the name, the color, and the block
 *   defaults, and starts the other quota at something sane.** Nothing is thrown
 *   away by looking at the other kind, and nothing is invented silently either —
 *   the number that appears is a starting point the person can overwrite.
 * - **A count is a plain number box and a time budget is hours and minutes.**
 *   They are not the same field: `3` is three visits and a typo, while `180` is
 *   three hours. A visit count is held to whole numbers because a third of a
 *   visit is not a thing anybody means, and a half-typed box reports nothing at
 *   all rather than a quota of zero.
 * - **Both kinds ask for a default block length and default travel**, because a
 *   count goal's blocks still take time and can still need a journey there. The
 *   product's own table is explicit that a visit count cares about the number of
 *   visits and never about the length of one.
 * - **The name box is not capped at the length a block can show.** Forty-one
 *   characters is refused by the domain, with a sentence, and capping the field
 *   would silently shorten a person's words instead — which is the one thing the
 *   domain decided never to do.
 * - **The parts of this form are handed instructions, not callbacks.** A field
 *   inside the form is told to `changeKind` rather than given a callback to
 *   call, and the reason is narrow but real: the rule this folder is tested
 *   against reads every callback a file *declares* as a thing the app hands it,
 *   so a private detail wearing that shape would turn up on the list of public
 *   events and be read as one. Naming it after what it changes keeps the two
 *   apart, which is the same reasoning `DaySelect` uses about the shape of a
 *   day option.
 */

import { useId, useState } from 'react'

import type { ColorId, Goal, TravelMinutes } from '@/domain/types'
import type { GoalDraft } from '@/domain/view'

import { ColorSwatches } from './ColorSwatches'
import { DurationInput } from './DurationInput'
import { Modal } from './Modal'

/** The one look for a plain text box, the same one the fields use. */
const BOX =
  'w-full min-h-11 rounded-lg border border-stone-300 bg-white px-3 py-2 text-stone-900'

/** How a kind reads in the one place a new task picks one. */
const KIND_CHOICES: ReadonlyArray<{ kind: Goal['kind']; label: string; hint: string }> = [
  { kind: 'time', label: 'Time budget', hint: 'Total activity time this week.' },
  { kind: 'count', label: 'Visit count', hint: 'A number of visits, whatever each lasts.' },
]

/** The fields both kinds share, which is every field except the quota. */
interface SharedFields {
  name: string
  colorId: ColorId
  defaultActivityMinutes: number
  defaultTravel: TravelMinutes
}

export interface GoalFormProps {
  /** The task being edited, or `null` for a new one. Its kind is the kind lock. */
  goal: Goal | null
  /** The color a new task starts on, so it is not handed one already in use. */
  newGoalColorId: ColorId
  onSubmit: (draft: GoalDraft) => void
  onCancel: () => void
}

export function GoalForm({ goal, newGoalColorId, onSubmit, onCancel }: GoalFormProps) {
  const [draft, setDraft] = useState<GoalDraft>(() => startingDraft(newGoalColorId, goal))

  /** Change the fields a quota does not touch, whichever kind this draft is. */
  function edit(shared: Partial<SharedFields>) {
    setDraft((held) => (held.kind === 'time' ? { ...held, ...shared } : { ...held, ...shared }))
  }

  function setKind(kind: Goal['kind']) {
    setDraft((held) => (held.kind === kind ? held : asKind(held, kind)))
  }

  return (
    <Modal title={goal === null ? 'Add a task' : 'Edit task'} onClose={onCancel}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          onSubmit(draft)
        }}
      >
        <NameField
          name={draft.name}
          changeName={(name) => edit({ name })}
        />

        <ColorSwatches
          label="Color"
          value={draft.colorId}
          onChange={(colorId) => edit({ colorId })}
        />

        <KindField kind={draft.kind} locked={goal !== null} changeKind={setKind} />

        {draft.kind === 'time' ? (
          <DurationInput
            label="Weekly budget"
            minutes={draft.goalMinutes}
            onChange={(goalMinutes) =>
              setDraft((held) => (held.kind === 'time' ? { ...held, goalMinutes } : held))
            }
          />
        ) : (
          <CountField
            count={draft.goalCount}
            changeCount={(goalCount) =>
              setDraft((held) => (held.kind === 'count' ? { ...held, goalCount } : held))
            }
          />
        )}

        <DurationInput
          label="Default block length"
          minutes={draft.defaultActivityMinutes}
          onChange={(defaultActivityMinutes) => edit({ defaultActivityMinutes })}
        />

        <DurationInput
          label="Default travel before"
          minutes={draft.defaultTravel.beforeMinutes}
          onChange={(beforeMinutes) =>
            edit({ defaultTravel: { ...draft.defaultTravel, beforeMinutes } })
          }
        />

        <DurationInput
          label="Default travel after"
          minutes={draft.defaultTravel.afterMinutes}
          onChange={(afterMinutes) =>
            edit({ defaultTravel: { ...draft.defaultTravel, afterMinutes } })
          }
        />

        <div className="mt-2 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="min-h-11 rounded-lg border border-stone-300 px-4 text-sm text-stone-700"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="min-h-11 rounded-lg bg-stone-900 px-4 text-sm font-medium text-white"
          >
            {goal === null ? 'Add task' : 'Save task'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

interface NameFieldProps {
  name: string
  changeName: (name: string) => void
}

function NameField({ name, changeName }: NameFieldProps) {
  const id = useId()
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm text-stone-600">
        Name
      </label>
      <input
        id={id}
        type="text"
        value={name}
        onChange={(event) => changeName(event.target.value)}
        className={BOX}
      />
    </div>
  )
}

interface KindFieldProps {
  kind: Goal['kind']
  /** A task being edited. Its kind is a fact about it, not a choice. */
  locked: boolean
  changeKind: (kind: Goal['kind']) => void
}

function KindField({ kind, locked, changeKind }: KindFieldProps) {
  const choice = KIND_CHOICES.find((option) => option.kind === kind)
  if (locked) {
    return (
      <fieldset>
        <legend className="mb-1 text-sm text-stone-600">Kind</legend>
        <p className="min-h-11 rounded-lg bg-stone-100 px-3 py-2 text-sm text-stone-700">
          {choice === undefined ? 'Time budget' : choice.label}
          <span className="block text-xs text-stone-500">
            A task cannot change what kind of task it is.
          </span>
        </p>
      </fieldset>
    )
  }
  return (
    <fieldset>
      <legend className="mb-1 text-sm text-stone-600">Kind</legend>
      <div className="grid grid-cols-2 gap-2">
        {KIND_CHOICES.map((option) => (
          <button
            key={option.kind}
            type="button"
            aria-pressed={option.kind === kind}
            onClick={() => changeKind(option.kind)}
            className={`min-h-11 rounded-lg border px-3 py-2 text-left text-sm ${
              option.kind === kind
                ? 'border-2 border-stone-900 font-medium'
                : 'border-stone-300 text-stone-700'
            }`}
          >
            {option.label}
            <span className="block text-xs text-stone-500">{option.hint}</span>
          </button>
        ))}
      </div>
    </fieldset>
  )
}

interface CountFieldProps {
  count: number
  changeCount: (count: number) => void
}

function CountField({ count, changeCount }: CountFieldProps) {
  const id = useId()
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm text-stone-600">
        Visits this week
      </label>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={1}
        step={1}
        value={String(count)}
        onChange={(event) => {
          // An empty box is a number nobody has finished typing, not a quota of
          // zero, so the draft is left exactly as it was until there is a whole
          // number in there.
          const typed = Number(event.target.value)
          if (Number.isInteger(typed)) changeCount(typed)
        }}
        className={BOX}
      />
    </div>
  )
}

/** The draft a new task starts on, or the one the task being edited holds. */
function startingDraft(colorId: ColorId, goal: Goal | null): GoalDraft {
  if (goal === null) {
    return {
      kind: 'time',
      name: '',
      colorId,
      goalMinutes: 300,
      defaultActivityMinutes: 60,
      defaultTravel: { beforeMinutes: 0, afterMinutes: 0 },
    }
  }
  const shared = {
    name: goal.name,
    colorId: goal.colorId,
    defaultActivityMinutes: goal.defaultActivityMinutes,
    defaultTravel: { ...goal.defaultTravel },
  }
  return goal.kind === 'time'
    ? { ...shared, kind: 'time', goalMinutes: goal.goalMinutes }
    : { ...shared, kind: 'count', goalCount: goal.goalCount }
}

/**
 * The same draft read as the other kind.
 *
 * Everything except the quota is carried over, because none of it depends on
 * which kind this is, and the quota that comes with the other kind is a
 * starting point rather than a decision.
 */
function asKind(draft: GoalDraft, kind: Goal['kind']): GoalDraft {
  const shared = {
    name: draft.name,
    colorId: draft.colorId,
    defaultActivityMinutes: draft.defaultActivityMinutes,
    defaultTravel: { ...draft.defaultTravel },
  }
  return kind === 'time'
    ? { ...shared, kind: 'time', goalMinutes: draft.kind === 'time' ? draft.goalMinutes : 300 }
    : { ...shared, kind: 'count', goalCount: draft.kind === 'count' ? draft.goalCount : 3 }
}
