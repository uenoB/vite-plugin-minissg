import { createHmac } from 'node:crypto'
import { type ResolvedConfig, normalizePath, isCSSRequest } from 'vite'
import type { ResolvedOptions } from './options'
import { Query } from './query'

const hasUrlQuery = Query.Class('url').test
const hasInlineQuery = Query.Class('inline').test
const hasRawQuery = Query.Class('raw').test

export class Site {
  readonly config: ResolvedConfig
  readonly options: ResolvedOptions
  readonly projectRoot: string

  constructor(config: ResolvedConfig, options: ResolvedOptions) {
    this.config = config
    this.options = options
    this.projectRoot = normalizePath(this.config.root).replace(/\/*$/, '/')
  }

  isAsset(moduleId: string): boolean {
    if (hasRawQuery(moduleId)) return false // Vite makes ?raw precede ?url
    if (isCSSRequest(moduleId) && !hasInlineQuery(moduleId)) return true
    if (hasUrlQuery(moduleId) || moduleId.endsWith('.html')) return true
    return this.config.assetsInclude(moduleId.replace(/[?#].*$/s, ''))
  }

  scriptId(moduleId: string): string {
    if (moduleId.startsWith(this.projectRoot)) {
      moduleId = moduleId.slice(this.projectRoot.length)
    }
    moduleId = moduleId.replace(/[?#].*$/s, '')
    const hmac = createHmac('sha256', '--MINISSG--').update(moduleId)
    return hmac.digest('base64url').slice(0, 8)
  }

  entries(): Map<string, string> {
    let input = this.config.build.rollupOptions.input
    if (input == null) return new Map<string, string>()
    if (typeof input === 'string') input = [input]
    const fallbackName = (s: string): string =>
      s.replace(/^.*\/|(?:\.[^./?#]*)?(?:[?#].*)?$/gs, '')
    const entries = Array.isArray(input)
      ? input.map(i => [fallbackName(normalizePath(i)), i] as const)
      : Object.entries(input)
    return new Map(entries)
  }
}
