/**
 * The one question the app ever asks before it throws something away.
 *
 * Resetting the board, deleting a task, and replacing everything with a pasted
 * backup all come through here, and this component cannot tell which one it is:
 * the title, the message, and both button labels are props. That is deliberate.
 * A confirm dialog that knew it was a reset would grow its own wording, and the
 * three confirmations in this app would end up sounding like three different
 * apps.
 *
 * Decisions recorded here:
 *
 * - **Escape and the Close button both cancel.** Both are routed through
 *   `onCancel`, so a keyboard and a stray tap on the corner of the panel agree
 *   on what "back out" means. Escape is the answer that destroys nothing, so it
 *   is the answer it gives.
 * - **Cancel sits first and cancel is quiet.** The filled button is the one that
 *   does the thing, and it is the one on the far side of the row, so the thumb
 *   that lands on the edge of a dialog on a phone lands on the safe answer.
 *   Nothing here is red: on this board a hue means a task, and a red button would
 *   be read as another task to place.
 */

import { Modal } from './Modal'

interface ConfirmDialogProps {
  /** `Reset the board`, `Delete Study`, `Replace the board`. */
  title: string
  /** One sentence saying what happens, and what is lost. */
  message: string
  /** What the button that goes ahead says: `Clear the whole board`. */
  confirmLabel: string
  /** What the button that stops says: `Keep this board`. */
  cancelLabel: string
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Modal title={title} onClose={onCancel}>
      <p className="text-sm text-stone-700">{message}</p>
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="min-h-11 rounded-lg border border-stone-300 px-4 text-sm text-stone-700"
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className="min-h-11 rounded-lg bg-stone-900 px-4 text-sm font-medium text-white"
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  )
}
