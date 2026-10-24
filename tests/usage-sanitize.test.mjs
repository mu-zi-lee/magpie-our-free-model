import test from 'node:test'
import assert from 'node:assert/strict'
import { sanitizeUsage } from '../vendor/ofm/src/stream.js'

test('usage sanitizer keeps values within the advertised window', () => {
  const usage = { inputTokens: 120, outputTokens: 30, totalTokens: 150 }
  assert.deepEqual(sanitizeUsage(usage, 256), usage)
})

test('usage sanitizer drops inflated input while retaining output and reasoning', () => {
  assert.deepEqual(sanitizeUsage({ inputTokens: 9000, outputTokens: 40, reasoningTokens: 12, totalTokens: 9052 }, 4096), {
    inputTokens: 0, outputTokens: 40, reasoningTokens: 12,
  })
})

test('usage sanitizer omits an entirely invalid stamp', () => {
  assert.equal(sanitizeUsage({ inputTokens: 9000, outputTokens: 0, totalTokens: 9000 }, 4096), undefined)
})

test('usage sanitizer leaves unknown windows and unrelated usage untouched', () => {
  const usage = { inputTokens: 9000, outputTokens: 1, totalTokens: 9001 }
  assert.deepEqual(sanitizeUsage(usage, undefined), usage)
})
