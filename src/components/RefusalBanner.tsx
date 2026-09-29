/**
 * The one line that says a change was refused, and why.
 *
 * The sentence is a prop. It was written in `domain/refusal.ts` and handed down
 * by the orchestrator, so this component cannot phrase a refusal differently
 * from any other and cannot decide that a refusal is worth explaining in its own
 * words. It shows what it was given and offers one way to put it away.
 *
 * Decisions recorded here:
 *
 * - **Stone, not a hue.** A color on this board means a task, and a banner is not
 *   one. Wearing a palette color would put something on screen that the grid
 *   says is a placed block, and the person would look for it.
 * - **`role="status"`, which is polite.** A refusal is the answer to something the
 *   person just did, so it should be read out and left on screen rather than
 *   interrupting whatever a screen reader is in the middle of saying. It stays
 *   until it is dismissed or the next successful change replaces it; the board
 *   behind it has not changed, and a refusal that vanished on a timer would be a
 *   refusal nobody could act on.
 */

export interface RefusalBannerProps {
  /** The whole sentence, already worded. This component builds nothing. */
  message: string
  onDismiss: () => void
}

export function RefusalBanner({ message, onDismiss }: RefusalBannerProps) {
  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-xl border border-stone-300 bg-stone-100 px-3 py-2 text-sm text-stone-900"
    >
      <p className="flex-1">{message}</p>
      <button
        type="button"
        onClick={onDismiss}
        className="min-h-11 shrink-0 rounded-lg px-3 text-stone-600"
      >
        Dismiss
      </button>
    </div>
  )
}
