// Temporary. Proves the runner finds and executes a `.test.ts` file in Node
// mode, and that the `@` alias resolves inside tests. Delete in task 3.
import { describe, expect, it } from 'vitest'

import App from '@/App'

describe('vitest setup', () => {
  it('runs a .test.ts file in the node environment', () => {
    // No DOM, so this is the node environment and not jsdom.
    expect(typeof window).toBe('undefined')
    expect(typeof globalThis.setTimeout).toBe('function')
  })

  it('resolves the @ alias to src', () => {
    expect(App).toBeDefined()
  })
})
