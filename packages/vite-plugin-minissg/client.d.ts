declare module '*?renderer' {
  type Content = NonNullable<import('./dist/index').Content>
  const render: (component: any) => Content | PromiseLike<Content>
  export default render
}

declare module '*?render' {
  const content: PromiseLike<import('./dist/index').Content>
  export default content
}

declare module '*?client' {
  const data: Record<string, import('./dist/index').Json>
  export default data
}

declare module '*?hydrate' {
  const component: any
  export default component
}
