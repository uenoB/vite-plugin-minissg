import { test, expect } from 'vitest'
import { Trie } from '../trie'

test('linked list', () => {
  const t = new Trie<string, number>(1)
  const t1 = t.set(['foo'], 2)
  const t2 = t1.set(['bar'], 3)
  const t3 = t2.set(['baz'], 4)
  expect(t.value).toBe(1)
  expect(t1.value).toBe(2)
  expect(t2.value).toBe(3)
  expect(t3.value).toBe(4)
  expect(t.get([])).toStrictEqual({ key: [], trie: t })
  expect(t.get(['foo'])).toStrictEqual({ key: [], trie: t1 })
  expect(t.get(['foo', 'bar'])).toStrictEqual({ key: [], trie: t2 })
  expect(t.get(['foo', 'bar', 'baz'])).toStrictEqual({ key: [], trie: t3 })
  expect(t.get(['bar'])).toStrictEqual({ key: ['bar'], trie: t })
  expect(t.get(['foo', 'baz'])).toStrictEqual({ key: ['baz'], trie: t1 })
  expect(t.get(['foo', 'bar', 'foo'])).toStrictEqual({ key: ['foo'], trie: t2 })
})

test('branch', () => {
  const t = new Trie<string, number>(1)
  const t1 = t.set(['foo'], 2)
  const t2 = t1.set(['bar'], 3)
  const t3 = t1.set(['baz'], 4)
  expect(t.value).toBe(1)
  expect(t1.value).toBe(2)
  expect(t2.value).toBe(3)
  expect(t3.value).toBe(4)
  expect(t.get([])).toStrictEqual({ key: [], trie: t })
  expect(t.get(['foo'])).toStrictEqual({ key: [], trie: t1 })
  expect(t.get(['foo', 'bar'])).toStrictEqual({ key: [], trie: t2 })
  expect(t.get(['foo', 'baz'])).toStrictEqual({ key: [], trie: t3 })
  expect(t.get(['bar'])).toStrictEqual({ key: ['bar'], trie: t })
  expect(t.get(['foo', 'bar', 'baz'])).toStrictEqual({ key: ['baz'], trie: t2 })
  expect(t.get(['foo', 'baz', 'foo'])).toStrictEqual({ key: ['foo'], trie: t3 })
})

test('walk', () => {
  const t = new Trie<string, number>(1)
  const t1 = t.set(['foo'], 2)
  const t2 = t1.set(['bar'], 3)
  const t3 = t1.set(['baz'], 4)
  expect(Array.from(t.walk(['foo', 'bar', 'baz']))).toStrictEqual([
    { key: ['foo', 'bar', 'baz'], trie: t },
    { key: ['bar', 'baz'], trie: t1 },
    { key: ['baz'], trie: t2 }
  ])
  expect(Array.from(t.walk(['foo', 'baz']))).toStrictEqual([
    { key: ['foo', 'baz'], trie: t },
    { key: ['baz'], trie: t1 },
    { key: [], trie: t3 }
  ])
  expect(Array.from(t.walk(['baz', 'bar', 'foo']))).toStrictEqual([
    { key: ['baz', 'bar', 'foo'], trie: t }
  ])
})
