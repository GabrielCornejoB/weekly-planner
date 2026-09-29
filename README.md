# Weekly Planner

A week planner that runs entirely in the browser. One chart, seven days,
6:00 to 22:00, with work intervals, travel, tasks, and one-off events placed
on it. Nothing is sent anywhere; the plan lives in this browser's
`localStorage`.

This README is about running and working on the app. What the app does is
written down elsewhere, and neither document is repeated here:

- **[docs/product-scope.md](docs/product-scope.md)** — the behaviour, in
  plain language. Read this to find out what the app is supposed to do.
- **[PRD.md](PRD.md)** — the technical decisions and the numbered build
  plan, with the notes each task left behind. Read this to find out why the
  code looks the way it does.

## Requirements

Node.js **22 LTS** is what this is developed against. Vite itself asks for
20.19+ or 22.12+, and there is no other runtime to install: the only
runtime dependencies are `react` and `react-dom`.

```sh
npm install
```

## Running it

```sh
npm run dev        # dev server with hot reload
npm run preview    # serve the production build from dist/
```

Open the URL the dev server prints. It is a phone-first app, so a narrow
window or a device's inspector is the honest way to look at it.

Opening `dist/index.html` from the filesystem does not work: the built
page loads its script and its stylesheet from absolute `/assets/…` paths,
so it has to be served. Use `npm run preview`, or any static host, to look
at a build.

## Commands

| Command          | What it does                                                        |
| ---------------- | ------------------------------------------------------------------- |
| `npm run dev`    | Dev server with hot reload, on the Vite default port.                |
| `npm test`       | Runs the whole Vitest suite once and exits. No watch mode.           |
| `npm run lint`   | oxlint over the repository. `any` and `@ts-ignore` are errors.       |
| `npm run build`  | `tsc -b` first, then a minified static build into `dist/`.          |
| `npm run preview`| Serves `dist/` as it will be deployed.                              |

`npm run build` is the one that has to be green: it typechecks the whole
tree, tests included, and the emitted `dist/` is the deliverable.

## Where things live

```text
src/
  main.tsx               mounts the app
  App.tsx                renders the orchestrator, nothing else
  index.css              the whole stylesheet: one @import of Tailwind
  domain/                the rules. Pure functions of a Board. No React.
    types.ts             the board's vocabulary: the interfaces, the
                         closed string unions, and the minute constants
    time.ts              clock and duration text, snapping, bounds,
                         overlap, percent-of-day geometry
    board.ts             the preset week and the reset
    schedule.ts          footprints, what a day occupies, fit checks
    work.ts              work intervals and commute
    goals.ts             task definitions
    sessions.ts          placed blocks: sessions and one-offs
    progress.ts          quota maths and the sentences a task row shows
    view.ts              the grid model and the task list model
    refusal.ts           the one sentence per refusal reason
  persistence/
    storage.ts           load and save against an injected Storage
    transfer.ts          export text, and import with its validation
  colors/palette.ts      ColorId to complete Tailwind class strings
  orchestrators/
    BoardOrchestrator.tsx   the component: state, dialogs, wiring
    actions.ts              every change, and the one door that saves it
  components/           the dumb surfaces. They render and emit callbacks.
```

A test file sits beside the module it covers: `time.test.ts` beside
`time.ts`. There is one test file per module, plus two that check the
component and orchestrator folders against their own source.

## Conventions worth knowing before you edit

These are the rules the code is organised by. They are all checked by the
suite, so an edit that breaks one fails `npm test` rather than being a
matter of opinion.

- **Times are minutes from midnight.** There is no `Date` anywhere, and
  the board is not tied to a calendar.
- **`@` aliases `src`**, in TypeScript and in Vite, so imports read
  `@/domain/time`.
- **The rules are pure functions.** Anything that can refuse something
  lives in `domain/` or `persistence/`, takes the board, and returns a new
  board or a refusal. Nothing mutates its argument.
- **Components are dumb.** They render what they are handed and emit
  callbacks; they never import a rule module, call a mutation, or do
  geometry. `BoardOrchestrator` is the only place that knows the whole
  board, and `actions.ts` beside it is where the behaviour lives so that
  it can be tested without rendering anything.
- **Sentences are handed down, not composed.** Refusal wording comes from
  `refusal.ts` and progress wording from `progress.ts`. A component
  receives the finished string.
- **Tests are pure functions in a Node environment.** `describe`, `it`, and
  `expect` are imported from `vitest` in every file; globals are off, and
  there is no jsdom, so nothing renders a component.
- **Tailwind classes are written out in full.** A class assembled from
  parts — `` `bg-${color}-500` `` — is dropped by the build, and there is
  a test for it. `palette.ts` holds the colour classes for the same
  reason.
- **Strict TypeScript, no `any`.** Object shapes are interfaces and closed
  sets are string unions, so adding a case that has no handling is a
  compile error.

## Notes

- The board is saved to `localStorage` under the key `weekly-planner.board`
  as one JSON document, and written after every change that lands. A quiet
  **Backup** button under the chart copies that document out as text and
  imports one back in.
- Text left in storage that is not a valid board is **not** deleted on
  load. The app opens on the preset, and the bad text stays where it is
  until the next successful save overwrites it.
- With the app open in two tabs, the last save wins. There is no sync
  between tabs.
- Copying a backup uses the clipboard API, and falls back to the text area
  in the panel when the browser refuses it.
