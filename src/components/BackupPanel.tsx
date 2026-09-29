/**
 * The way a board leaves this device and comes back.
 *
 * Two text areas and three buttons. The first area is the whole board as text,
 * read-only, and is there to be copied. The second is where a backup is pasted
 * to replace the board. The panel is handed the export text already made; it
 * never builds it, and it never reads the pasted text as anything but a string.
 * Whether a paste is a board at all, and whether it is one that could go on the
 * chart, is not this component's question — that is asked before anybody is
 * asked to confirm anything, which is what lets "Nothing was replaced." be true
 * when they decide not to.
 *
 * Decisions recorded here:
 *
 * - **The text area is always there, and it is the fallback.** A clipboard can
 *   refuse — an unsecured page, a browser with the permission turned off, a paste
 *   the browser blocks — and the plan's own answer to that is the text. It is
 *   read-only so it cannot be edited into something that is not a backup by
 *   accident, and selectable so a long press is a copy on a phone.
 * - **Copy is attempted here rather than handed up, and a failure is not an
 *   error.** The clipboard is browser plumbing, not a fact about the board, and
 *   a copy that reported success while having failed is worse than one that
 *   reports nothing at all. So the button tries, and if it cannot it selects the
 *   text instead, which is the next thing a person would do anyway. Neither
 *   outcome is a refusal and neither puts a sentence on screen.
 * - **Nothing is announced after a copy.** The text area sits right there under
 *   the button, already holding what was copied, and a label that says `Copied`
 *   for a moment is one more thing to read on a small screen.
 * - **The import is a textarea and a button, not a file picker.** The plan calls
 *   this a manual transfer and a text one, and a file picker is a whole dialog
 *   on a phone to reach the same place.
 */

import { useState } from 'react'

import { Modal } from './Modal'

/** One look for both areas, and for a code box on a phone. */
const AREA =
  'h-40 w-full rounded-lg border border-stone-300 bg-stone-50 p-2 font-mono text-xs text-stone-800'

const BUTTON = 'min-h-11 rounded-lg border border-stone-300 px-3 text-sm text-stone-700'
const PRIMARY = 'min-h-11 rounded-lg bg-stone-900 px-4 text-sm font-medium text-white'

export interface BackupPanelProps {
  /** The whole board as the export function already wrote it. */
  text: string
  /** The copy was put on the clipboard. Nothing more is said about it. */
  onCopy: () => void
  /** The pasted string, exactly as it was pasted. Nothing has read it yet. */
  onImport: (raw: string) => void
  onClose: () => void
}

export function BackupPanel({ text, onCopy, onImport, onClose }: BackupPanelProps) {
  const [pasted, setPasted] = useState('')
  const [area, setArea] = useState<HTMLTextAreaElement | null>(null)

  async function copy() {
    try {
      // A browser that has no clipboard at all throws here rather than handing
      // back an absent one, and the catch is the same either way.
      await navigator.clipboard.writeText(text)
    } catch {
      area?.select()
      return
    }
    onCopy()
  }

  return (
    <Modal title="Backup" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div>
          <p className="mb-1 text-sm text-stone-600">
            This is the whole board as text. Copy it to keep it.
          </p>
          <textarea
            ref={setArea}
            readOnly
            value={text}
            aria-label="The board as text"
            className={AREA}
          />
          <div className="mt-2 flex justify-end">
            <button type="button" onClick={copy} className={PRIMARY}>
              Copy
            </button>
          </div>
        </div>

        <div>
          <p className="mb-1 text-sm text-stone-600">
            Paste a backup to replace the current board. It does not merge.
          </p>
          <textarea
            value={pasted}
            onChange={(event) => setPasted(event.target.value)}
            aria-label="Paste a backup here"
            className={AREA}
          />
          <div className="mt-2 flex flex-wrap justify-end gap-2">
            <button type="button" onClick={onClose} className={BUTTON}>
              Close
            </button>
            <button
              type="button"
              onClick={() => onImport(pasted)}
              className={PRIMARY}
            >
              Import and replace
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
