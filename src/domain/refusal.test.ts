import { describe, expect, it } from 'vitest'

import { refusalMessage } from '@/domain/refusal'
import type { RefusalReason } from '@/domain/types'

/**
 * Every reason the closed set holds, in the order `types.ts` lists them.
 *
 * The table below walks exactly this list, so a reason that joins the union
 * without a sentence fails here rather than showing a person nothing. The
 * last two have no producer yet — `invalid-backup` is task 15's and
 * `storage-unavailable` is task 14's — and are covered now so those tasks
 * arrive with their wording pinned rather than each inventing a voice.
 */
const REASONS: RefusalReason[] = [
  'outside-day',
  'overlaps',
  'too-short',
  'not-a-step',
  'empty-name',
  'name-too-long',
  'invalid-quota',
  'kind-locked',
  'missing-goal',
  'missing-work',
  'missing-block',
  'commute-without-work',
  'invalid-backup',
  'storage-unavailable',
]

/**
 * The fourteen sentences, word for word. A `Record` rather than a list of
 * pairs, so the compiler is the one that says a reason is missing from the
 * table — the same total-map check `PALETTE` uses — and the runtime sweep is
 * left to say what the wording is.
 */
const SENTENCES: Record<RefusalReason, string> = {
  'outside-day': 'That is outside the day. The visible day runs from 6:00 to 22:00.',
  overlaps: 'That overlaps something already on the grid. Nothing is moved to make room.',
  'too-short':
    'That is too short. An activity or work block is 15 minutes at least, and travel is 5 minutes or nothing.',
  'not-a-step': 'That is not on the five-minute step. Use a number on the step, such as 35 or 40 rather than 37.',
  'empty-name': 'A name is needed. Spaces alone do not name anything.',
  'name-too-long': 'That name is too long. A name is 40 characters at most.',
  'invalid-quota':
    'That quota is not a target. A time budget is 15 minutes at least, and a visit count is a whole number of one or more.',
  'kind-locked': 'The kind of a task is fixed when the task is created. A time task cannot become a count task.',
  'missing-goal': 'That task is not on this board. It may have been deleted.',
  'missing-work': 'That work block is not on that day. Work stays on the day it is on.',
  'missing-block': 'That block is not on this board. It may have been moved or removed.',
  'commute-without-work': 'A commute hangs off work, so a day with no work cannot have one.',
  'invalid-backup': 'That text is not a Weekly Planner backup. Nothing was replaced.',
  'storage-unavailable': 'The board could not be saved. Keep a copy with Backup.',
}

describe('refusalMessage', () => {
  it('gives every reason one stable sentence, word for word', () => {
    for (const reason of REASONS) {
      expect(refusalMessage(reason)).toBe(SENTENCES[reason])
    }
  })

  it('holds exactly the closed set, so the list and the table cannot drift', () => {
    expect(Object.keys(SENTENCES).sort()).toEqual([...REASONS].sort())
  })

  it('never shows an empty sentence', () => {
    for (const reason of REASONS) {
      expect(refusalMessage(reason).trim().length).toBeGreaterThan(0)
    }
  })

  it('never gives two reasons the same sentence', () => {
    const sentences = REASONS.map(refusalMessage)
    expect(new Set(sentences).size).toBe(REASONS.length)
  })

  it('ends every sentence with a full stop, like the progress sentences', () => {
    for (const reason of REASONS) {
      expect(refusalMessage(reason).endsWith('.')).toBe(true)
    }
  })

  /**
   * The first version of this check asked every sentence not to contain its
   * own reason code, and running it caught the sentence rather than the
   * module: `overlaps` is the one code that is also a plain English word, and
   * using that word in its own sentence is what the sentence is for. The
   * hyphenated identifiers are the codes a person should never read — those
   * are unmistakably code, while a plain word is what sentences are made of —
   * so the check is against them, across every sentence.
   */
  it('never shows a person a hyphenated reason code', () => {
    const hyphenated = REASONS.filter((reason) => reason.includes('-'))
    for (const reason of REASONS) {
      const sentence = refusalMessage(reason)
      for (const code of hyphenated) {
        expect(sentence).not.toContain(code)
      }
    }
  })
})
