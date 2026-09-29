/**
 * The one place a reason is given words.
 *
 * A mutation refuses with a reason and nothing else. The orchestrator hands
 * that reason here and shows the sentence it gets back, so every "no" in the
 * app reads the same wherever it came from: an overlap refused by a drag and
 * the same overlap refused by a typed field are the same sentence, and a
 * person who reads it twice does not have to work out whether it was the same
 * rule.
 *
 * The function takes the reason and nothing else, and that is the whole shape
 * of the sentences. A reason carries no block, no day, and no task, so the
 * sentence cannot name one: the banner is shown at the moment of the refusal,
 * where the person already knows what they were trying to do. Its only jobs
 * are to say what is wrong and, where there is one, the next move — and the
 * next move is one the app really offers, so `storage-unavailable` points at
 * Backup and `missing-work` points at the day the work is actually on.
 *
 * One sentence per reason, and each is honest everywhere its reason is
 * produced. That is the load-bearing rule: `too-short` comes back for an
 * activity under fifteen minutes, for a work interval under fifteen, and for
 * travel or commute under five, so its sentence names all three floors rather
 * than the one the check that happens to be nearest happens to produce. A
 * sentence that named the caller would be a lie in the next module that
 * returns the same reason.
 *
 * Two of these reasons have no producer yet. `invalid-backup` is task 15's
 * and `storage-unavailable` is task 14's, and their sentences are written now
 * from what the plan says about them, so those tasks arrive with their
 * wording already pinned rather than each inventing a voice.
 *
 * Decisions recorded here, each pinned by a test:
 *
 * - **The sentence is words, never the reason code.** A hyphenated identifier
 *   is what the code calls the rule; the sentence is what a person reads, and
 *   the banner never leaks the identifier back out.
 * - **Every sentence ends with a full stop**, like the progress sentences, so
 *   a one-line banner never ends mid-air.
 * - **The numbers quoted are the numbers the rules use.** The floors and
 *   limits named here are the constants `types.ts` owns and pins; if one ever
 *   moves, the sentence moves with it as a deliberate edit to the table in
 *   the test, not as a quiet rewording.
 * - **The switch is exhaustive with no default.** A reason that joins the
 *   union fails the build here until it has a sentence, which is the same
 *   compile-time guarantee `types.test.ts` gives the closed set itself.
 */

import type { RefusalReason } from '@/domain/types'

/**
 * The sentence a refusal shows. One per reason, pinned word for word by the
 * test, so the wording cannot drift quietly.
 */
export function refusalMessage(reason: RefusalReason): string {
  switch (reason) {
    case 'outside-day':
      return 'That is outside the day. The visible day runs from 6:00 to 22:00.'
    case 'overlaps':
      return 'That overlaps something already on the grid. Nothing is moved to make room.'
    case 'too-short':
      return 'That is too short. An activity or work block is 15 minutes at least, and travel is 5 minutes or nothing.'
    case 'not-a-step':
      return 'That is not on the five-minute step. Use a number on the step, such as 35 or 40 rather than 37.'
    case 'empty-name':
      return 'A name is needed. Spaces alone do not name anything.'
    case 'name-too-long':
      return 'That name is too long. A name is 40 characters at most.'
    case 'invalid-quota':
      return 'That quota is not a target. A time budget is 15 minutes at least, and a visit count is a whole number of one or more.'
    case 'kind-locked':
      return 'The kind of a task is fixed when the task is created. A time task cannot become a count task.'
    case 'missing-goal':
      return 'That task is not on this board. It may have been deleted.'
    case 'missing-work':
      return 'That work block is not on that day. Work stays on the day it is on.'
    case 'missing-block':
      return 'That block is not on this board. It may have been moved or removed.'
    case 'commute-without-work':
      return 'A commute hangs off work, so a day with no work cannot have one.'
    case 'invalid-backup':
      return 'That text is not a Weekly Planner backup. Nothing was replaced.'
    case 'storage-unavailable':
      return 'The board could not be saved. Keep a copy with Backup.'
  }
}
