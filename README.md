# equation-citator-webnote

Web support for Equation Citator exported citations.

For the obsidian equation-citator plugin, see https://github.com/FRIEDparrot/obsidian-equation-citator.

This package is designed for pages that already contain Equation Citator exported citation spans:

```html
<span class="equation-citator-citation" data-ec-kind="eq" data-ec-refs="[...]">...</span>
```

It provides two entry points:

- `equation-citator/markdown-it`: build-time target injection for Markdown-it/VitePress.
- `equation-citator/runtime`: browser hover previews, stable target IDs, and navigation.

## Markdown-it

```js
import equationCitatorMarkdownIt from 'equation-citator/markdown-it'

md.use(equationCitatorMarkdownIt, {
  include: (env) => env.relativePath?.startsWith('knowledge-base/'),
  enableObsidianCallouts: true
})
```

This injects target metadata for math blocks with `\tag{...}`, figures, and Equation Citator callout blockquotes.

## Runtime

```js
import { install } from 'equation-citator/runtime'

install({
  router,
  pathMappings: [
    { urlPattern: '/knowledge-base/', baseUrl: '/knowledge-base' }
  ]
})
```

`pathMappings` are only needed for cross-file citations. Same-page citations work without them.
