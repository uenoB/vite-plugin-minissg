import render from 'virtual:minissg/self?renderer'
import Anchor from './Anchor'
import Root from './Root'

const pages = import.meta.glob(['./*.{md,mdx}', '!./App.mdx'])

const pagesMap = new Map(
  Object.entries(pages).map(([filename, load]) => {
    const relPath = filename.replace(/(?:\/index)?\.mdx?$/, '/')
    const get = async () => {
      const md = await load()
      const title = md.frontmatter?.title ?? filename
      const component = () => (
        <Root title={title}>
          <md.default components={{ a: Anchor }} />
        </Root>
      )
      return { default: render(component) }
    }
    return [relPath, { get }]
  })
)

export const get = () => pagesMap