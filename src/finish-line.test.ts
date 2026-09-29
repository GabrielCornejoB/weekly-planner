/**
 * The checks that only make sense at the end of the build.
 *
 * Every other test in this project asks whether something *behaves*: a rule, a
 * sentence, a view model, a flow. This one asks whether the build is finished —
 * whether the pieces the plan said there would be are the pieces that are here,
 * whether anything was left behind by the scaffolder, and whether anything is
 * exported that nothing can reach.
 *
 * They are checked from source and from the two documents at the root of the
 * repository, for the same reason the component and orchestrator rules are: this
 * project renders nothing, so a file tree and a dependency list are text
 * questions, and a rule that can only be checked by reading is a rule that has
 * to be written down somewhere.
 *
 * The dead-export sweep is the one worth explaining at length, and it is at the
 * bottom of the file.
 */

import { describe, expect, it } from 'vitest'

/**
 * Every source file in this project, as text.
 *
 * The glob covers `src/` at both depths and no deeper, which is a fact about the
 * plan's own file tree rather than a guess: a fourth folder would have to be
 * written into the plan before this found it.
 */
const sources: Record<string, string> = import.meta.glob<string>(
  ['./*.{ts,tsx,css}', './*/*.{ts,tsx,css}'],
  { query: '?raw', import: 'default', eager: true },
)

/** The two documents at the root of the repository, as text. */
const plan: string = import.meta.glob<string>('../PRD.md', {
  query: '?raw',
  import: 'default',
  eager: true,
})['../PRD.md']

const manifest: string = import.meta.glob<string>('../package.json', {
  query: '?raw',
  import: 'default',
  eager: true,
})['../package.json']

function sourceOf(path: string): string {
  const source = sources[path]
  if (source === undefined) throw new Error(`no source at ${path}`)
  return source
}

const CODE_FILES = Object.keys(sources)
  .filter((path) => !path.includes('.test.'))
  .sort()

const ALL_FILES = Object.keys(sources).sort()

/**
 * This file's own path in the tree.
 *
 * A glob does not match the file that declares it — a module cannot glob itself
 * into its own graph — so the one file in the list that cannot be seen from here
 * is added by hand. It is written out rather than derived from `import.meta.url`
 * because the list is a claim about the repository's shape, and a claim that
 * computed its own subject would be the one thing in it that could not fail.
 */
const THIS_FILE = 'finish-line.test.ts'

/**
 * Every source file with its comments and its string literals taken out.
 *
 * A check about *code* must not be able to pass because a comment or a sentence
 * said the word, and the checks here are all about code: `any`, and dead export
 * names. A comment in this project explains itself at length, so an unstripped
 * read would be answering a different question from the one being asked.
 */
function codeOf(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^[ \t]*\/\/.*$/gm, ' ')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``')
}

describe('what the build is made of', () => {
  it('has no `any` anywhere, in any of the three spellings the plan bans', () => {
    // The plan's Types row: no `any`, no `as any`, no `@ts-ignore`. Two of the
    // three are already linted (`typescript/no-explicit-any` and
    // `typescript/ban-ts-comment` are errors in `.oxlintrc.json`), so checking
    // them here as well is deliberate: the lint rules are this project's
    // configuration and a `npx oxlint --fix` is not the only thing that can
    // change a file.
    const offences = CODE_FILES.flatMap((path) => {
      const code = codeOf(sourceOf(path))
      const banned: [RegExp, string][] = [
        [/\bany\b/, 'any'],
        [/@ts-(?:ignore|expect-error|nocheck)\b/, 'a ts-comment'],
        [/\bas\s+unknown\s+as\b/, 'a double assertion'],
      ]
      return banned.flatMap(([pattern, what]) => (pattern.test(code) ? [`${path} contains ${what}`] : []))
    })
    expect(offences).toEqual([])
  })

  it('is only the files the plan lists, in the folders the plan lists', () => {
    // The plan's architecture section is a tree, and this is that tree asked of
    // what is on disk. The paths carry their folder, so a file moved into the
    // wrong one fails here rather than merely still existing: `goalProgress` in
    // `components/` would be a different design, not a filing mistake.
    //
    // Five names are not in the plan's tree and all five were written into the
    // plan by the task that needed them: `TimeInput` and `BlockFields`
    // (task 17), `actions.ts`, `actions.test.ts`, and `orchestrator-rules.test.ts`
    // (task 18), which the plan's architecture section was updated to name. This
    // file and `product-walk.test.ts` are task 21's own, and the plan's Task 21
    // entry says so.
    const planned = [
      'App.tsx',
      'colors/palette.test.ts',
      'colors/palette.ts',
      'components/BackupPanel.tsx',
      'components/BlockFields.tsx',
      'components/ColorSwatches.tsx',
      'components/ConfirmDialog.tsx',
      'components/DayEditor.tsx',
      'components/DaySelect.tsx',
      'components/DurationInput.tsx',
      'components/GoalForm.tsx',
      'components/Modal.tsx',
      'components/OneOffForm.tsx',
      'components/RefusalBanner.tsx',
      'components/SessionEditor.tsx',
      'components/TaskList.tsx',
      'components/TimeInput.tsx',
      'components/WeekGrid.tsx',
      'components/component-rules.test.ts',
      'domain/board.test.ts',
      'domain/board.ts',
      'domain/goals.test.ts',
      'domain/goals.ts',
      'domain/progress.test.ts',
      'domain/progress.ts',
      'domain/refusal.test.ts',
      'domain/refusal.ts',
      'domain/schedule.test.ts',
      'domain/schedule.ts',
      'domain/sessions.test.ts',
      'domain/sessions.ts',
      'domain/time.test.ts',
      'domain/time.ts',
      'domain/types.test.ts',
      'domain/types.ts',
      'domain/view.test.ts',
      'domain/view.ts',
      'domain/work.test.ts',
      'domain/work.ts',
      'finish-line.test.ts',
      'index.css',
      'main.tsx',
      'orchestrators/BoardOrchestrator.tsx',
      'orchestrators/actions.test.ts',
      'orchestrators/actions.ts',
      'orchestrators/orchestrator-rules.test.ts',
      'orchestrators/product-walk.test.ts',
      'persistence/storage.test.ts',
      'persistence/storage.ts',
      'persistence/transfer.test.ts',
      'persistence/transfer.ts',
    ]
    const found = [...ALL_FILES.map((path) => path.replace(/^\.\//, '')), THIS_FILE].sort()
    expect(found).toEqual([...planned].sort())
    // And the plan still describes this tree, so a file added to the code and
    // forgotten in the document is caught from the other side. The document writes
    // its tree by file name inside the folder and names two of them in prose
    // rather than in the tree, so both the folder and the extension come off and
    // what is asked is whether the document has heard of the file at all. This half
    // is the tripwire; the equality above is the check.
    for (const file of planned) {
      const name = file.split('/').pop()?.replace(/\.[^.]+$/, '') ?? file
      expect(plan, `${name} is not in the plan`).toContain(name)
    }
  })

  it('depends on nothing at run time but React and React DOM', () => {
    // The plan's Libraries row, and the one that decides the size of the bundle.
    // `JSON.parse` is read out of the manifest text rather than imported, because
    // the manifest is not part of the module graph and this project narrows
    // `unknown` with a guard rather than a cast.
    const parsed: unknown = JSON.parse(manifest)
    const dependencies = dependenciesOf(parsed)
    expect(dependencies).toEqual(['react', 'react-dom'])
  })
})

/**
 * The `dependencies` of a parsed manifest, or nothing if it is not a manifest.
 *
 * A guard rather than an assertion, for the same reason `storage.ts` and
 * `transfer.ts` narrow their own JSON: nothing in this project casts.
 */
function dependenciesOf(manifestText: unknown): string[] | null {
  if (typeof manifestText !== 'object' || manifestText === null) return null
  if (!('dependencies' in manifestText)) return null
  const dependencies: unknown = manifestText.dependencies
  if (typeof dependencies !== 'object' || dependencies === null) return null
  return Object.keys(dependencies).sort()
}

/**
 * Nothing exported that nothing can reach.
 *
 * An export is a promise that somebody will name it. Most of them here are kept:
 * a function the orchestrator calls, a type a component's props are built from, a
 * sentence a test pins. The three ways a name survives this sweep are:
 *
 * - **something names it.** Any other file in `src/`, including a test — a test
 *   is a reader like any other, and `STORAGE_KEY` and `ColorClasses` are read by
 *   one each.
 * - **the plan declares it.** The plan's own type listing writes out
 *   `export interface GridBlockView` and eleven other names, and a file that
 *   implements what the plan prints is not adding to the public vocabulary, it
 *   is matching it. `GridLineView` is the only export in the project that exists
 *   for that reason alone, and asking the document rather than keeping a
 *   hand-written allowlist is what stops the two drifting apart.
 * - **it is not a name at all**: a default export, which is the entry point.
 *
 * What is left over is a leftover. The fifteen `*Props` interfaces were the first
 * real find, and they are worth naming: an exported props type is a second
 * version of a component's public shape, so it can drift from the component and
 * nothing would notice — a props type nobody imports cannot disagree with
 * anything, because the only copy of it that is ever checked is the one written
 * beside the component it belongs to.
 */
describe('what is exported', () => {
  it('is reachable, or written down in the plan', () => {
    const offences: string[] = []
    for (const path of CODE_FILES) {
      const declaring = sourceOf(path)
      for (const name of exportedNames(declaring)) {
        if (reachedFrom(name, path)) continue
        if (declaredByPlan(name)) continue
        offences.push(`${path} exports ${name}, which nothing names`)
      }
    }
    expect(offences).toEqual([])
  })
})

/**
 * Every name a file exports, with the kind of thing it is.
 *
 * Four spellings cover this project: a declaration, a `export { a, b }` list, a
 * `export { a } from` re-export, and a `export type { a }` re-export. A default
 * export is skipped on purpose — it is the module itself rather than a name in
 * it, and the one default export here is `App`, which the entry point reaches
 * through a file this sweep does not even look at.
 */
function exportedNames(source: string): string[] {
  const names: string[] = []
  const declared = /export\s+(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:function|const|let|class|interface|type|enum)\s+([A-Za-z0-9_]+)/g
  for (const match of source.matchAll(declared)) names.push(match[1])
  // The two list forms, and the two re-export forms, all of which end in a name
  // or a `}` with a name in it.
  const listed = /export\s+(?:type\s+)?\{([^}]*)\}(?!\s*\{)/g
  for (const match of source.matchAll(listed)) {
    for (const part of match[1].split(',')) {
      const name = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim()
      if (name.length > 0) names.push(name)
    }
  }
  return [...new Set(names)]
}

/** Is this name written anywhere but the file that declares it? */
function reachedFrom(name: string, declaring: string): boolean {
  const word = new RegExp(`\\b${name}\\b`)
  return ALL_FILES.some((path) => path !== declaring && word.test(sourceOf(path)))
}

/**
 * Does the plan print this name as an export?
 *
 * The plan's Domain model and View model sections write their type listing out
 * as it should be, `export interface` and all, so the document is asked the same
 * question the code is: not "does this word appear" but "does the plan call this
 * a public name of this kind".
 */
function declaredByPlan(name: string): boolean {
  return new RegExp(`export\\s+(?:declare\\s+)?(?:function|const|class|interface|type|enum)\\s+${name}\\b`).test(plan)
}
