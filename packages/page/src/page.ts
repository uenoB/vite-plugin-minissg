import type * as minissg from '../../vite-plugin-minissg/src/module'
import { ModuleName } from '../../vite-plugin-minissg/src/module'
import type { Awaitable } from '../../vite-plugin-minissg/src/util'
import { Trie } from './trie'
import { dirPath, normalizePath, safeDefineProperty } from './util'
import type { BivarianceFunc } from './util'
import { type Delay, delay } from './delay'
import { Memo } from './memo'

type EntriesModule = Extract<minissg.Module, { entries: unknown }>

interface PageContext<SomePage extends Page = Page> extends minissg.Context {
  moduleName: ModuleName
  module: SomePage
}

export type PathInfo = Readonly<{
  stem: string
  variant: string
  relURL: string
}>

interface PastEdge<SomePage> {
  page: SomePage
  final?: boolean | undefined
}

interface Edge<SomePage> extends PastEdge<SomePage> {
  final: boolean
  // Edge represents an edge in the nondeterministic finite automaton
  // constituted by PageIndex.
  // `final` means whether or not `page` is a final state.
  // If `final` is true, `page` and its epsillon and final successors
  // are final states.  If `final` is false, they are not final states.
  // Note that, in contrast to standard automata theory, final states are
  // not recognized by themselves but their incoming edges; only if
  // transition comes to a state through an final edge, the state is a final
  // state.
}

export const priv_: unique symbol = Symbol('private')

export interface Asset {
  [priv_]?: never
  type: 'asset'
  url: string
  getURL: () => Delay<string>
}

interface PageIndexEntry<SomePage> {
  fileNameMap: SomePage | Asset
  moduleNameMap: SomePage
  stemMap: SomePage
}

type PageIndexTrie<X> = Trie<string, Array<Edge<X>>>
type MakePageIndex<X> = { [K in keyof X]: PageIndexTrie<X[K]> }
type PageIndex<SomePage> = MakePageIndex<PageIndexEntry<SomePage>>

interface Directory<SomePage> extends PageIndex<SomePage> {
  pages: Array<readonly [string, SomePage]>
}

export interface PagePrivate<ModuleType, SomePage> {
  content: (() => Awaitable<ModuleType>) | Directory<SomePage> | undefined
  fileName: string
  stem: ModuleName
  variant: ModuleName
  moduleName: ModuleName
  url: string
  parent: SomePage | undefined
  root: SomePage
}

interface PageBase<SomePage> extends minissg.Context {
  [priv_]: PagePrivate<unknown, SomePage>
}
type Never<X> = { [K in keyof X]+?: never }

const isSameClass = <SomePage extends NonNullable<object>>(
  page: SomePage,
  other: NonNullable<object>
): other is SomePage => {
  const PageType = page.constructor as new () => never
  const OtherType = other.constructor as () => never
  return other instanceof PageType && page instanceof OtherType
}

const findParent = <SomePage extends NonNullable<object>>(
  page: SomePage,
  context: minissg.Context | undefined
): SomePage | undefined => {
  for (let c = context; c != null; c = c.parent) {
    if (isSameClass(page, c.module) && c.module !== page) return c.module
  }
  return undefined
}

const derefPage = async <
  SomePage extends Never<PageBase<SomePage>> | PageBase<SomePage>
>(
  page: SomePage
): Promise<SomePage | undefined> => {
  if (page[priv_] == null) return undefined
  if (typeof page[priv_].content !== 'function') return undefined
  const moduleName = page[priv_].moduleName
  let module = (await page[priv_].content()) as minissg.Module
  let context: minissg.Context = page
  while (typeof module === 'object' && module != null) {
    if (isSameClass(page, module)) return module
    if (!('entries' in module && typeof module.entries === 'function')) break
    context = Object.freeze({ moduleName, module, parent: context })
    module = await module.entries(context)
  }
  return undefined
}

export const pathSteps = (path: string): string[] => {
  const key = path.split('/')
  if (key[0] === '') key.shift()
  return key
}

const addPage = <SomePage>(
  trie: Trie<string, Array<Edge<SomePage>>>,
  path: string[],
  next: Edge<SomePage>
): void => {
  const { key, node } = trie.get(path)
  if (key.length === 0 && node.value != null) {
    node.value.push(next)
  } else {
    node.set(key, [next])
  }
}

const addRoute = <Key extends keyof PageIndex<object>>(
  index: PageIndex<object>,
  indexKey: Key,
  path: string,
  page: PageIndexEntry<object>[Key]
): void => {
  const trie = index[indexKey]
  const key = pathSteps(path)
  addPage(trie, key, { page, final: true })
  if (!(indexKey === 'fileNameMap' || key[key.length - 1] === '')) return
  // in fileNameMap, `page` may have an edge to different file name in the
  // directory and therefore we need an alternative way to `page` without
  // the file name part of `path` (last component of `key`).
  // in the case where `path` ends with `/` (last component of `key` is
  // an empty string), because `page` may have an additional edge to child
  // pages (for example, `/foo/` may have a link to `/foo/bar`), we need
  // an alternative way to `page` without the last empty string.
  addPage(trie, key.slice(0, key.length - 1), { page, final: false })
}

const find = <
  SomePage extends PageBase<SomePage>,
  Key extends keyof PageIndexEntry<SomePage>
>(
  { page, final }: PastEdge<PageIndexEntry<SomePage>[Key]>,
  indexKey: Key,
  path: string[],
  all?: Set<PageIndexEntry<SomePage>[Key]> | undefined
): Awaitable<PageIndexEntry<SomePage>[Key] | undefined> => {
  if (page[priv_] == null) {
    return path.length === 0 && final === true ? page : undefined
  }
  if (typeof page[priv_].content === 'function') {
    return derefPage(page).then(p => {
      if (p != null) return find({ page: p, final }, indexKey, path, all)
      if (path.length !== 0 || final !== true) return undefined
      if (all != null) all.add(page)
      return all != null ? undefined : page
    })
  }
  const index: PageIndex<SomePage> | undefined = page[priv_].content
  return index?.[indexKey]
    .walk(path)
    .reduceRight<PromiseLike<PageIndexEntry<SomePage>[Key] | undefined>>(
      (z, { key, node }) => {
        for (const next of node.value ?? []) {
          if (path.length !== 0 || final == null || final === next.final) {
            z = z.then(r => r ?? find(next, indexKey, key, all))
          }
        }
        return z
      },
      Promise.resolve(undefined)
    )
}

const defaultParsePath = (path: string): PathInfo => {
  const m = /\.?(?:\.([^./]+(?:\.[^./]+)*))?\.[^./]+$/.exec(path)
  const variant = m?.[1] ?? ''
  const stemBase = path.slice(0, m?.index ?? path.length)
  const stem = stemBase + (/(?:^|\/|\.[^./]*)$/.test(stemBase) ? '' : '/')
  const relURL = variant === '' ? stem : variant + '/' + stem
  return { stem, variant, relURL }
}

const defaultRender = (mod: unknown): Awaitable<minissg.Content> => {
  if (mod == null || typeof mod === 'string') return mod
  if (typeof mod !== 'object') return `[${typeof mod}]`
  return 'default' in mod ? (mod.default as minissg.Content) : undefined
}

const inherit = <SomePage extends Page, K extends 'parsePath' | 'render'>(
  page: SomePage,
  key: K,
  ...parents: ReadonlyArray<{ [P in K]?: SomePage[P] | undefined } | undefined>
): void => {
  for (const parent of parents) {
    const method = parent?.[key]
    if (method != null && page[key] !== method) {
      page[key] = method
      break
    }
  }
}

type Items<X> = Iterable<readonly [string, X]> | Readonly<Record<string, X>>

const iterate = <X>(items: Items<X>): Iterable<readonly [string, X]> =>
  Symbol.iterator in items ? items : Object.entries(items)

interface PageConstructorArg<ModuleType> {
  context?: Readonly<minissg.Context> | undefined
  url?: URL | string | undefined
  parsePath?: ((path: string) => PathInfo) | undefined
  render?: ((module: ModuleType) => Awaitable<minissg.Content>) | undefined
}

interface PageNewArg<ModuleType> extends PageConstructorArg<ModuleType> {
  pages?: Items<() => Awaitable<ModuleType>> | undefined
  substPath?: ((path: string) => string) | undefined
  assets?: Items<() => Awaitable<string>> | undefined
}

export type PageArg<ModuleType> =
  | Readonly<PageConstructorArg<ModuleType>>
  | undefined

const memo = new Memo()

export class Page<ModuleType = unknown> implements EntriesModule, PageContext {
  declare readonly [priv_]: PagePrivate<ModuleType, this>

  constructor(arg?: PageArg<ModuleType>) {
    memo.forget() // tree structure has possibly been changed
    const parent = findParent(this, arg?.context)
    inherit(this, 'parsePath', arg, parent)
    inherit(this, 'render', arg, parent)
    const priv: PagePrivate<ModuleType, this> = {
      content: undefined,
      fileName: parent?.[priv_].fileName ?? '',
      stem: parent?.[priv_].stem ?? ModuleName.root,
      variant: parent?.[priv_].variant ?? ModuleName.root,
      moduleName: arg?.context?.moduleName ?? ModuleName.root,
      url: parent?.[priv_].url ?? new URL(arg?.url ?? 'file:').href,
      parent,
      root: parent?.[priv_].root ?? this
    }
    safeDefineProperty(this, priv_, { value: priv })
  }

  static new<
    ModuleType = unknown,
    SomePage extends Page<ModuleType> = Page<ModuleType>,
    Args extends readonly unknown[] = []
  >(
    this: new (arg: PageArg<ModuleType>, ...args: [] | Args) => SomePage,
    arg?: Readonly<PageNewArg<ModuleType>> | undefined,
    ...args: Args
  ): SomePage {
    const self = new this(arg, ...args)
    if (arg?.pages == null && arg?.assets == null) return self
    const priv = self[priv_]
    const parent = priv.parent
    const dir: Directory<SomePage> = (self[priv_].content = {
      pages: [],
      fileNameMap: new Trie(),
      moduleNameMap: new Trie(),
      stemMap: new Trie()
    })
    if (arg?.pages != null) {
      for (const [rawPath, load] of iterate(arg.pages)) {
        const filePath = normalizePath(rawPath)
        const srcPath = normalizePath(arg?.substPath?.(rawPath) ?? rawPath)
        const { relURL, stem, variant } = self.parsePath(srcPath)
        const moduleName = priv.moduleName.join(relURL)
        const context = { parent, moduleName, module: self, path: relURL }
        const page = new this({ context: Object.freeze(context) })
        page[priv_].content = load
        page[priv_].stem = priv.stem.join(stem)
        page[priv_].variant = priv.variant.join(variant)
        page[priv_].url = new URL(moduleName.path, priv.root[priv_].url).href
        if (rawPath !== '') {
          page[priv_].fileName = dirPath(priv.fileName) + filePath
        }
        const relName = moduleName.path.slice(priv.moduleName.path.length)
        const relStem = page[priv_].stem.path.slice(priv.stem.path.length)
        addRoute(dir, 'fileNameMap', filePath, page)
        addRoute(dir, 'moduleNameMap', relName, page)
        addRoute(dir, 'stemMap', relStem, page)
        dir.pages.push([relURL, page])
      }
    }
    if (arg?.assets != null) {
      const origin = new URL(priv.root[priv_].url).origin
      for (const [rawPath, load] of iterate(arg.assets)) {
        const filePath = normalizePath(rawPath)
        const asset: Asset = {
          type: 'asset',
          getURL(): Delay<string> {
            return memo.memoize(
              [this],
              async () => new URL(await load(), origin).href
            )
          },
          get url(): string {
            return this.getURL().value
          }
        }
        addRoute(dir, 'fileNameMap', filePath, asset)
      }
    }
    return self
  }

  get url(): string {
    return this[priv_].url
  }

  get getURL(): Delay<string> {
    return delay(() => this[priv_].url)
  }

  get fileName(): string {
    return this[priv_].fileName
  }

  get variant(): string {
    return this[priv_].variant.path
  }

  get moduleName(): ModuleName {
    return this[priv_].moduleName
  }

  get module(): this {
    return this
  }

  get parent(): this | undefined {
    return this[priv_].parent
  }

  get root(): this {
    return this[priv_].root
  }

  load(): Delay<ModuleType> | undefined {
    const content = this[priv_].content
    if (typeof content !== 'function') return undefined
    return memo.memoize([this, 'load'], content)
  }

  findByURL(path: string): Delay<this | undefined> {
    return memo.memoize([this, 'findByURL', path], () => {
      const root = new URL('.', this[priv_].root[priv_].url)
      const base = path.startsWith('/') ? root : this[priv_].url
      const url = new URL(path.startsWith('/') ? path.slice(1) : path, base)
      if (!url.href.startsWith(root.href)) return undefined
      const key = url.pathname.slice(root.pathname.length)
      const edge = { page: this[priv_].root } as const
      return find<this, 'moduleNameMap'>(edge, 'moduleNameMap', pathSteps(key))
    })
  }

  findByFileName(path: string): Delay<this | Asset | undefined> {
    return memo.memoize([this, 'findByFileName', path], () => {
      const key = path.startsWith('/')
        ? normalizePath(path.slice(1))
        : normalizePath(dirPath(this[priv_].fileName) + path)
      const edge = { page: this[priv_].root } as const
      return find<this, 'fileNameMap'>(edge, 'fileNameMap', pathSteps(key))
    })
  }

  find(path: string): Delay<this | Asset | undefined> {
    return memo.memoize([this, 'find', path], async () => {
      return (await this.findByURL(path)) ?? (await this.findByFileName(path))
    })
  }

  variants(): Delay<Set<this>> {
    return memo.memoize([this, 'variants'], async () => {
      const key = pathSteps(this[priv_].stem.path)
      const edge = { page: this[priv_].root } as const
      const set = new Set<this>()
      await find(edge, 'stemMap', key, set)
      return set
    })
  }

  async entries(): Promise<minissg.Module> {
    const content = this[priv_].content
    if (typeof content !== 'function') return content?.pages ?? []
    const mod = await content()
    if (typeof mod === 'object' && mod != null) {
      if (Symbol.iterator in mod || 'entries' in mod) {
        return mod as minissg.Module
      }
    }
    return {
      default: delay(() => {
        memo.forgetAll() // to obtain the effect of dynamic importing
        return this.render(mod)
      })
    }
  }

  findParent<Key extends keyof this>(key?: Key | undefined): this | undefined {
    if (key == null) return this[priv_].parent
    for (let p = this[priv_].parent; p != null; p = p[priv_].parent) {
      if (p[key] !== this[key]) return p
    }
    return undefined
  }

  declare parsePath: BivarianceFunc<this, [string], PathInfo>
  declare render: BivarianceFunc<this, [ModuleType], Awaitable<minissg.Content>>
  declare readonly type: 'page'
}

safeDefineProperty(Page.prototype as Page, 'parsePath', {
  configurable: true,
  writable: true,
  value: defaultParsePath
})

safeDefineProperty(Page.prototype as Page, 'render', {
  configurable: true,
  writable: true,
  value: defaultRender
})

safeDefineProperty(Page.prototype as Page, 'type', {
  configurable: true,
  writable: true,
  value: 'page'
})
