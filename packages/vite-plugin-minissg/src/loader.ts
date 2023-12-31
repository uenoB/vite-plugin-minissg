import type { Plugin, PluginOption } from 'vite'
import { init, parse } from 'es-module-lexer'
import MagicString from 'magic-string'
import type { ResolvedOptions } from './options'
import { Site } from './site'
import { Query } from './query'
import { type JsonObj, type NodeInfo, js, freshId } from './utils'

const encode64 = (s: string): string => Buffer.from(s).toString('base64url')
const decode64 = (s: string): string => Buffer.from(s, 'base64url').toString()

const CLIENT = Query.Class('client')
const HYDRATE = Query.Class('hydrate')
const RENDER = Query.Class('render')
const RENDERER = Query.Class('renderer')
const MARK = Query.Class('MINISSG-MARK')

type Side = 'client' | 'server'
const coerceSide = (s: string | boolean | undefined): Side =>
  s === 'server' || s === true ? 'server' : 'client'

type Tuple<F, X, N extends number, T extends X[]> = T extends { length: N }
  ? [F, ...T, ...X[]]
  : Tuple<F, X, N, [X, ...T]>
type Virtual<F, N extends number> = Tuple<F, string, N, []>

const virtualName = (id: string, ext = '.js'): string =>
  id.replace(/^.*\/|[.?#].*$/gs, '') + ext
const VIRTUAL_RE = /^\0?\/?virtual:minissg\/?(?:@\/([\w,-]*)\/|(\w+)(?=\?|$))/
const virtual = (args: string[], id: string): string =>
  `virtual:minissg/@/${args.map(encode64).join(',')}${id.replace(/^\/*/, '/')}`
const getVirtual = (id: string): string[] | undefined => {
  const m = VIRTUAL_RE.exec(id)
  if (m?.[1] != null) return m[1].split(',').map(decode64)
  if (m?.[2] != null) return [m[2], id.slice(m[0].length)]
  return undefined
}
const isVirtual = <Name extends string, N extends number>(
  v: string[] | undefined,
  name: Name,
  args: N
): v is Virtual<Name, N> => v != null && v[0] === name && v.length > args

const Lib = virtual(['Lib'], 'lib.js')
const Keep = (outputName: string): string =>
  virtual(['Keep', outputName], virtualName(outputName, '.css'))
const Head = (outputName: string): string =>
  virtual(['Head', outputName], virtualName(outputName, '.html'))
const Client = (side: Side, id: string): string =>
  virtual(['Client', side, id], virtualName(id))
const Hydrate = (side: Side | '', id: string, arg: string): string =>
  virtual(['Hydrate', side, id, arg], side === 'server' ? id : virtualName(id))
const Renderer = (side: Side, key: number, arg: string): string =>
  virtual(['Renderer', side, String(key), arg], 'render.js')
const Render = (id: string, arg: string): string =>
  virtual(['Render', id, arg], virtualName(id))
const Resolved = (id: string): string =>
  virtual(['Resolved', id], virtualName(id))
const Exact = (id: string, ext = '.js'): string =>
  virtual(['Exact', id], virtualName(id, ext))
export const Virtual = { Lib, Keep, Exact, Head }

export interface ServerSideResult {
  heads: ReadonlyMap<string, { head: string }>
  data: ReadonlyMap<string, JsonObj>
}

export const clientInfo = <Node>(
  info: NodeInfo<Node, string>,
  id: string | null | undefined,
  site: Site
): NodeInfo<Node, string> => {
  if (id == null) return {}
  const v = getVirtual(id)
  if (isVirtual(v, 'Client', 2)) return { values: [Exact(v[2])] }
  if (isVirtual(v, 'Hydrate', 3)) return { values: [Hydrate('', v[2], v[3])] }
  // add `.css` suffix to avoid polyfill insertion by Vite
  if (site.isAsset(id)) return { values: [Exact(id, '.css')] }
  return info
}

export const loaderPlugin = (
  options: ResolvedOptions,
  server?: ServerSideResult | undefined
): PluginOption => {
  let site: Site
  const isInSSR = new Map<string, boolean>()

  const pre: Plugin = {
    name: 'minissg:loader',
    enforce: 'pre',
    configResolved(config) {
      site = new Site(config, options)
    },
    resolveId: {
      order: 'pre',
      async handler(id, importer, options) {
        const fromSSR = importer == null || isInSSR.get(importer)
        const inSSR = fromSSR ?? options.ssr === true
        const resolveQuery = <R extends { id: string }>(r: R): R => {
          if ((q = RENDERER.match(r.id)) != null) {
            const k = coerceSide(inSSR)
            const m = site.options.render.match(r.id)
            const found = m?.value.render?.[k] != null
            const key = found ? m.key : -1
            const a = found ? q.value : `renderer not found for ${r.id} on ${k}`
            return { ...r, id: '\0' + Renderer(k, key, a) }
          } else if ((q = CLIENT.match(r.id)) != null) {
            return { ...r, id: '\0' + Client(coerceSide(inSSR), q.remove()) }
          } else if ((q = RENDER.match(r.id)) != null) {
            return { ...r, id: '\0' + Render(q.remove(), q.value) }
          } else if ((q = HYDRATE.match(r.id)) != null) {
            return { ...r, id: Hydrate(coerceSide(inSSR), q.remove(), q.value) }
          }
          return r
        }
        let r, q
        const v = getVirtual(id)
        if (isVirtual(v, 'self', 1) && importer != null) {
          r = resolveQuery({ id: importer.replace(/[?#].*/s, '') + v[1] })
        } else if (isVirtual(v, 'Exact', 1)) {
          r = { id: v[1] }
        } else if (isVirtual(v, 'Resolved', 1)) {
          r = resolveQuery({ id: v[1] })
        } else if (v != null) {
          r = { id: v[0] === 'Hydrate' || id.startsWith('\0') ? id : '\0' + id }
        } else {
          r = await this.resolve(id, importer, { ...options, skipSelf: true })
          if (r == null || Boolean(r.external) || r.id.includes('\0')) return r
          r = resolveQuery(r)
        }
        const ssr = inSSR && !site.isAsset(r.id)
        const prev = isInSSR.get(r.id)
        if (prev != null && prev !== ssr) r = { ...r, id: MARK.add(r.id) }
        isInSSR.set(r.id, ssr)
        return r
      }
    },
    load: {
      order: 'pre',
      async handler(id) {
        const v = getVirtual(id)
        if (isVirtual(v, 'Lib', 0)) {
          return libModule
        } else if (isVirtual(v, 'Keep', 0)) {
          return { code: '', moduleSideEffects: 'no-treeshake' }
        } else if (isVirtual(v, 'Head', 1)) {
          return server?.heads.get(v[1])?.head ?? null
        } else if (isVirtual(v, 'Client', 2)) {
          const key = site.scriptId(v[2])
          if (v[1] === 'server') {
            return js`
              import { data } from ${Lib}
              if (!data.has(${v[2]})) data.set(${v[2]}, { id: ${key} })
              export default data.get(${v[2]})`
          } else {
            return js`export default ${server?.data.get(v[2]) ?? { id: key }}`
          }
        } else if (isVirtual(v, 'Renderer', 3)) {
          const k = coerceSide(v[1])
          let r = site.options.render.get(Number(v[2]))?.render?.[k]
          r ??= () => js`throw Error(${v[3]})`
          return await r({ parameter: v[3] })
        } else if (isVirtual(v, 'Render', 2)) {
          return js`
            import render from ${Resolved(RENDERER.add(v[1], v[2]))}
            import * as m from ${Resolved(v[1])}
            export * from ${Resolved(v[1])}
            const get = m => Promise.resolve(m.default)
            const desc = Object.create(null)
            desc['value'] = (...a) => get(m).then(render).then(...a)
            const obj = Object.create(null)
            export default Object.defineProperty(obj, 'then', desc)`
        } else if (isVirtual(v, 'Hydrate', 3)) {
          const k = coerceSide(v[1])
          let h = site.options.render.match(v[2])?.value.hydrate?.[k]
          h ??= () => js`throw Error(${`hydration not available for ${v[2]}`})`
          const hid = site.scriptId(v[2])
          const args = { id: hid, moduleId: Resolved(v[2]), parameter: v[3] }
          return { code: await h(args), map: { mappings: '' } }
        }
        return null
      }
    }
  }

  const post: Plugin = {
    name: 'minissg:loader:post',
    enforce: 'post',
    // transform must be done after others but before vite:import-analysis.
    async transform(code, id) {
      if (server != null || isInSSR.get(id) !== true) return null
      await init
      const addId = freshId(code)
      const ms = new MagicString(code)
      for (const { d, n, ss, se } of parse(code)[0]) {
        if (d < 0 || n == null) continue
        const r = await this.resolve(n, id)
        if (r == null || Boolean(r.external)) continue
        const load = addId + js`(${r.id}),import(${Resolved(r.id)})`
        ms.update(ss, se, `(${load})`)
      }
      if (!ms.hasChanged()) return null
      ms.appendLeft(0, `import { add as ${addId} } ` + js`from ${Lib};` + '\n')
      return { code: ms.toString(), map: ms.generateMap({ hires: true }) }
    },
    generateBundle: {
      order: 'post',
      handler(_, bundle) {
        if (server == null || !site.options.clean) return
        for (const [chunkName, chunk] of Object.entries(bundle)) {
          if (chunk.type !== 'chunk') continue
          if (chunk.moduleIds.some(i => isInSSR.get(i) !== true)) continue
          // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
          delete bundle[chunkName]
        }
      }
    }
  }

  return [pre, post]
}

export interface LibModule {
  readonly data: Map<string, JsonObj>
  readonly add: (id: string) => unknown
  readonly run: <R>(s: { add: (id: string) => unknown }, f: () => R) => R
}

const libModule = `
  import { AsyncLocalStorage } from 'node:async_hooks'
  export const data = /*#__PURE__*/ new Map()
  const storage = /*#__PURE__*/ new AsyncLocalStorage()
  export const add = id => storage.getStore()?.add(id)
  export const run = storage.run.bind(storage)`
