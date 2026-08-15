import { describe, it, expect } from 'vitest'

// Deliberately failing test: CI red-verification only.
// Branch `ci-red-verify` proves the GitHub Actions `test` job blocks
// broken commits. This file is deleted before the PR is closed.
describe('ci red verification', () => {
  it('must fail so the gate is proven to block', () => {
    expect(true).toBe(false)
  })
})
