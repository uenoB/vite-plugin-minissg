import MarkdownIt from 'markdown-it'

const md = MarkdownIt({ html: true, typographer: true })

const compile = ({ default: code }) => {
  const m = /^(-{2,})\s*?^.*?^\1\s*?^/msy.exec(code)
  if (m != null) code = code.slice(m[0].length)
  return { default: md.render(code) }
}

const sources = import.meta.glob('./posts/**/*.md', { query: { raw: '' } })

const posts = Object.entries(sources).map(([filename, load]) => {
  const main = async () => compile(await load())
  return [filename.replace(/\.md$/, '/'), { main }]
})

export const main = () => posts
