/**
 * The shell every dialog in the app sits in.
 *
 * A modal is a panel over the page, a title, and a way out. It knows nothing
 * about what it is showing: the title and the contents arrive as props, and
 * whether Escape means "put the editor back" or "keep the board as it was" is
 * the orchestrator's question, not this component's. So the whole of this
 * component's behavior is that it can call `onClose` and nothing else.
 *
 * That is why it holds no state. There is no `open` prop to honor and no
 * `setOpen` to call, so it cannot decide to close itself, cannot reopen itself,
 * and cannot disagree with the orchestrator about whether a dialog is showing.
 * If a dialog is on screen, the orchestrator put it there; when it is gone, the
 * orchestrator took it away.
 *
 * Decisions recorded here:
 *
 * - **There are two ways out, and the obvious third one is deliberately not
 *   one of them.** The Close button and the Escape key both call `onClose`. A
 *   tap on the dim area behind the panel does not: on a phone a thumb lands
 *   there by accident all the time, and every dialog in this app holds a form
 *   somebody has already typed half of. Losing that draft to a stray tap is a
 *   worse fault than having one button too many on screen.
 * - **Escape is listened for on the document, not on the panel.** A key handler
 *   on the panel only fires while something inside it has focus, which is not
 *   guaranteed the moment a dialog appears. The listener is removed again on
 *   cleanup, so a closed dialog leaves nothing behind that would eat a keystroke
 *   meant for the page.
 * - **The page behind cannot scroll.** A dialog that lets the week slide under it
 *   on a phone is a dialog that has moved the thing the person was reading. The
 *   previous value of `overflow` is put back rather than cleared, so a page that
 *   had its own scrolling still has it afterwards.
 * - **The panel takes focus when it opens.** There is no focus trap — that is a
 *   loop of key handling this app has no other use for — but a dialog that
 *   leaves focus on the page behind it is read aloud as nothing at all. The
 *   scroll position is left alone, because opening a form should never move the
 *   week out from under the thumb that opened it.
 */

import { useEffect, useId, useRef, type ReactNode } from 'react'

interface ModalProps {
  /** The one line that says which dialog this is. */
  title: string
  /** Whatever this dialog is for: a message and its buttons, or a whole form. */
  children: ReactNode
  /** The single thing this component can do. */
  onClose: () => void
}

export function Modal({ title, children, onClose }: ModalProps) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    panelRef.current?.focus({ preventScroll: true })
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-stone-900/50 sm:items-center sm:p-4">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="max-h-[90dvh] w-full overflow-y-auto rounded-t-2xl bg-white p-4 text-stone-900 shadow-xl outline-none sm:max-w-md sm:rounded-2xl"
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <h2 id={titleId} className="text-lg font-semibold">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 shrink-0 rounded-lg px-3 text-sm text-stone-600"
          >
            Close
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
