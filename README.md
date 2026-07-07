# equation-citator-webnote
## Introduction 
Web citation grammar support for Equation Citator exported citations. Including web  citations support for equations, figures and custom callouts. 

This package is designed for pages that already contain Equation Citator exported citation spans:

```html
<span class="equation-citator-citation" data-ec-kind="eq" data-ec-refs="[...]">...</span>
```

![alt text](img/citation-example.png)

This package provides two entry points:

- `equation-citator/markdown-it`: build-time target injection for Markdown-it/VitePress.
- `equation-citator/runtime`: browser hover previews, stable target IDs, and navigation.

## Compatibility 

You can use `obsidian-equation-citator` plugin to generate the citation HTML label with correct format. For the obsidian equation-citator plugin, see https://github.com/FRIEDparrot/obsidian-equation-citator.

**Minor-version compatibility is applied**. That means, **equation-citator-webnote** (npm package) `v1.3.xx` is compatible with **obsidian-equation-citator** `v1.3.x`.

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
