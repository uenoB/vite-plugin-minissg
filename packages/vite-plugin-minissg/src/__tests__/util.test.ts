import { test, expect } from 'vitest'
import * as M from '../util'

test('addSet order', () => {
  const set = new Set([0, 1, 3])
  M.addSet(set, [2, 3])
  expect(Array.from(set)).toStrictEqual([0, 1, 3, 2])
})

test.each([
  ['string', () => M.js`import ${'foo'}`, 'import "foo"'],
  ['number', () => M.js`import ${123}`, 'import 123'],
  ['boolean', () => M.js`import ${true}`, 'import true'],
  ['array', () => M.js`import ${[1, true, 'A']}`, 'import [1,true,"A"]'],
  ['object', () => M.js`import ${{ foo: 'bar' }}`, 'import {"foo":"bar"}'],
  // eslint-disable-next-line no-template-curly-in-string
  ['escape', () => M.js`\`"\${\`a${'\n'}b\n\`}$"\``, '`"${`a"\\n"b\\n`}$"`'],
  ['multi', () => M.js`${'a'}b${'c'}d${'e'}`, '"a"b"c"d"e"']
])('js %s', (_, actual, expected) => {
  expect(actual()).toBe(expected)
})

test('mapReduce order', async () => {
  await expect(
    M.mapReduce({
      sources: [1, 2, 3, 4, 5],
      destination: [0],
      map: i => i * 2,
      reduce: (i, z) => [...z, i]
    })
  ).resolves.toStrictEqual([0, 2, 4, 6, 8, 10])
})

test('mapReduce fork', async () => {
  await expect(
    M.mapReduce({
      sources: [1, 2, 3, 4, 5],
      destination: 0,
      fork: i => (i > 0 ? Array(i).fill(0) : null),
      map: i => i + 1,
      reduce: (i, z) => z + i
    })
  ).resolves.toStrictEqual(15)
})

test('mapReduce update', async () => {
  await expect(
    M.mapReduce({
      sources: [1, 2, 3, 4, 5],
      destination: { sum: 0 },
      fork: i => (i > 0 ? Array(i).fill(0) : null),
      map: i => i + 1,
      reduce: (i, z) => {
        z.sum += i
      }
    })
  ).resolves.toStrictEqual({ sum: 15 })
})

test('mapReduce null', async () => {
  await expect(
    M.mapReduce({
      sources: [1, 2, 3, 4, 5],
      destination: null,
      map: i => i,
      reduce: () => undefined
    })
  ).resolves.toStrictEqual(null)
})

const toObj = <X>(map: Iterable<[number, Iterable<X>]>): Record<number, X[]> =>
  Object.fromEntries(Array.from(map, ([k, v]) => [k, Array.from(v)]))

const sleep = async (ms: number): Promise<void> => {
  await new Promise(resolve => setTimeout(resolve, ms))
}

test('traverseGraph', async () => {
  const graph: Array<M.NodeInfo<number, number>> = [
    { next: [1, 3], values: [0] },
    { next: [2], values: null },
    { next: [4], values: [2] },
    { next: [4], values: [3] },
    { next: [], values: [4] }
  ]
  await expect(
    M.traverseGraph({
      nodes: [0],
      nodeInfo: node => graph[node] ?? {}
    }).then(toObj)
  ).resolves.toStrictEqual({
    0: [0, 2, 4, 3],
    1: [2, 4],
    2: [2, 4],
    3: [3, 4],
    4: [4]
  })
})

test('traverseGraph order', async () => {
  const graph: Array<M.NodeInfo<number, number>> = [
    { next: [4, 1], values: [0] },
    { next: [2], values: null },
    { next: [3], values: [2] },
    { next: [], values: [3] },
    { next: [2], values: [4] }
  ]
  await expect(
    M.traverseGraph({
      nodes: [0],
      nodeInfo: async n => {
        await sleep(n * 10)
        return graph[n] ?? {}
      }
    }).then(toObj)
  ).resolves.toStrictEqual({
    0: [0, 4, 2, 3],
    1: [2, 3],
    2: [2, 3],
    3: [3],
    4: [4, 2, 3]
  })
})

test('traverseGraph cycle', async () => {
  const graph: Array<M.NodeInfo<number, number>> = [
    { next: [1, 4], values: [0] },
    { next: [2], values: [1] },
    { next: [3], values: [2] },
    { next: [1], values: [3] },
    { next: [], values: [4] }
  ]
  await expect(
    M.traverseGraph({
      nodes: [0],
      nodeInfo: async n => {
        await sleep(n * 10)
        return graph[n] ?? {}
      }
    }).then(toObj)
  ).resolves.toStrictEqual({
    0: [0, 1, 2, 3, 4],
    1: [1, 2, 3],
    2: [2, 3, 1],
    3: [3, 1, 2],
    4: [4]
  })
})
