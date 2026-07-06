function escapeHtmlAttribute(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function shouldProcess(state, options) {
  const include = options.include ?? options.filter
  if (!include) return true
  if (typeof include === 'function') return Boolean(include(state.env, state))
  if (include instanceof RegExp) return include.test(state.env.relativePath || '')
  if (typeof include === 'string') return String(state.env.relativePath || '').startsWith(include)
  return true
}

function equationTagAttribute(content = '') {
  const tag = String(content).match(/\\tag\s*\{([^{}]+)\}/)?.[1]?.trim()
  if (!tag) return ''

  const escapedTag = escapeHtmlAttribute(tag)
  return ` data-ec-tag="${escapedTag}" data-tag="${escapedTag}"`
}

function parseHtmlAttributes(raw = '') {
  const attrs = {}

  for (const match of String(raw).matchAll(/\s([:@A-Za-z_][-\w:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    attrs[match[1]] = match[2] ?? match[3] ?? match[4] ?? ''
  }

  return attrs
}

export function parseEquationCitatorFigureLabel(raw = '') {
  const parts = String(raw)
    .split('|')
    .map((part) => part.trim())
    .filter(Boolean)
  const metadata = {
    tag: '',
    title: '',
    desc: '',
    width: '',
    label: ''
  }

  for (const part of parts) {
    const figureMatch = part.match(/^(?:fig|figure)\s*:\s*(.+)$/i)
    if (figureMatch) {
      metadata.tag = figureMatch[1].trim()
      continue
    }

    const titleMatch = part.match(/^title\s*:\s*(.*)$/i)
    if (titleMatch) {
      metadata.title = titleMatch[1].trim()
      continue
    }

    const descMatch = part.match(/^desc\s*:\s*(.*)$/i)
    if (descMatch) {
      metadata.desc = descMatch[1].trim()
      continue
    }

    if (/^\d+$/.test(part)) {
      metadata.width = part
      continue
    }

    metadata.label = part
  }

  return metadata.tag ? metadata : null
}

function figureAttrsFromMetadata(metadata) {
  const attrs = {
    class: 'equation-citator-target equation-citator-figure',
    'data-ec-kind': 'fig',
    'data-ec-tag': metadata.tag
  }

  if (metadata.title) attrs['data-title'] = metadata.title
  if (metadata.desc) attrs['data-desc'] = metadata.desc
  if (metadata.width) {
    attrs['data-width'] = metadata.width
    attrs.style = `width: ${metadata.width}px; max-width: 100%;`
  }

  return attrs
}

function normalizeFigureAttrs(attrs = {}) {
  if (!['fig', 'figure'].includes(attrs['data-ec-kind']) || !attrs['data-ec-tag']) return null

  const normalized = {
    class: 'equation-citator-target equation-citator-figure',
    'data-ec-kind': 'fig',
    'data-ec-tag': attrs['data-ec-tag']
  }

  if (attrs['data-title']) normalized['data-title'] = attrs['data-title']
  if (attrs['data-desc']) normalized['data-desc'] = attrs['data-desc']
  if (attrs['data-width'] || attrs.width) {
    const width = attrs['data-width'] || attrs.width
    normalized['data-width'] = width
    normalized.style = `width: ${width}px; max-width: 100%;`
  }

  return normalized
}

function parseEquationCitatorCalloutLabel(raw = '') {
  const match = String(raw).match(/^\s*\[!([A-Za-z][\w-]*(?::[^\]\s|]+)(?:\|[^\]]*)?)\](?:[ \t]*(.*))?$/s)
  if (!match) return null

  const [kindAndTag] = match[1].split('|')
  const separator = kindAndTag.indexOf(':')
  if (separator < 0) return null

  const kind = kindAndTag.slice(0, separator).trim()
  const tag = kindAndTag.slice(separator + 1).trim()
  if (!kind || !tag) return null

  return {
    title: match[2] || '',
    kind: kind.toLowerCase(),
    attrs: {
      class: `equation-citator-target equation-citator-callout ec-callout callout callout-${kind.toLowerCase()}`,
      'data-ec-kind': kind.toLowerCase(),
      'data-ec-callout-kind': kind,
      'data-ec-tag': tag,
      'data-callout-type': kind.toLowerCase()
    }
  }
}

function findEquationCitatorMarker(token) {
  const children = token?.children || []
  const htmlToken = children.find((child) =>
    child.type === 'html_inline' &&
    /<span\b/i.test(child.content) &&
    /\bequation-citator-target\b/.test(child.content) &&
    /\bdata-ec-kind=/.test(child.content)
  )

  if (!htmlToken) return null

  const attrs = parseHtmlAttributes(htmlToken.content)
  if (!attrs['data-ec-kind']) return null

  return attrs
}

function removeEquationCitatorMarker(token) {
  if (!token?.children) return

  const children = []
  let skipClosingSpan = false

  for (const child of token.children) {
    if (
      child.type === 'html_inline' &&
      /<span\b/i.test(child.content) &&
      /\bequation-citator-target\b/.test(child.content)
    ) {
      skipClosingSpan = true
      continue
    }

    if (skipClosingSpan && child.type === 'html_inline' && child.content.trim() === '</span>') {
      skipClosingSpan = false
      continue
    }

    skipClosingSpan = false
    children.push(child)
  }

  token.children = children
}

function tokenContainsClass(token, className) {
  return (token?.children || []).some((child) =>
    child.type === 'html_inline' &&
    child.content.includes(className)
  )
}

function paragraphInlineAt(tokens, index) {
  return tokens[index]?.type === 'paragraph_open' &&
    tokens[index + 1]?.type === 'inline' &&
    tokens[index + 2]?.type === 'paragraph_close'
    ? tokens[index + 1]
    : null
}

function removeParagraphAt(tokens, index) {
  tokens.splice(index, 3)
}

function addMarkerAttrs(token, attrs, extraClass = '') {
  const classes = [attrs.class, extraClass].filter(Boolean).join(' ')
  if (classes) token.attrJoin('class', classes)

  for (const [name, value] of Object.entries(attrs)) {
    if (name === 'class') continue
    if (name === 'style' || name.startsWith('data-')) token.attrSet(name, value)
  }
}

function makeElementToken(Token, type, tag, nesting) {
  return new Token(type, tag, nesting)
}

function isFigureImageToken(token) {
  const content = token?.content?.trim() || ''
  const children = token?.children || []

  return /^<img\b/i.test(content) ||
    children.some((child) => child.type === 'image') ||
    children.some((child) =>
      child.type === 'html_inline' &&
      /^<img\b/i.test(child.content.trim())
    )
}

function findFigureAttrs(token) {
  for (const child of token?.children || []) {
    if (child.type === 'image') {
      const metadata = parseEquationCitatorFigureLabel(child.content)
      if (!metadata) continue

      if (metadata.width) child.attrSet('width', metadata.width)

      const alt = metadata.label || metadata.title || metadata.desc
      if (alt) child.attrSet('alt', alt)

      return figureAttrsFromMetadata(metadata)
    }

    if (child.type === 'html_inline') {
      const attrs = parseHtmlAttributes(child.content)
      const figureAttrs = normalizeFigureAttrs(attrs)
      if (figureAttrs) return figureAttrs
    }
  }

  return null
}

function figureWrapEnd(tokens, imageOpenIndex) {
  let end = imageOpenIndex + 3
  let cursor = end

  while (cursor < tokens.length) {
    const inline = paragraphInlineAt(tokens, cursor)
    if (
      inline &&
      (tokenContainsClass(inline, 'ec-pdf-figure-title-marker') ||
        tokenContainsClass(inline, 'ec-pdf-figure-desc-marker'))
    ) {
      end = cursor + 3
      cursor = end
      continue
    }

    break
  }

  return end
}

function wrapExportedFigure(tokens, markerOpenIndex, attrs, Token) {
  const markerInline = paragraphInlineAt(tokens, markerOpenIndex)
  if (isFigureImageToken(markerInline)) {
    removeEquationCitatorMarker(markerInline)

    const end = figureWrapEnd(tokens, markerOpenIndex)
    const figureOpen = makeElementToken(Token, 'equation_citator_figure_open', 'figure', 1)
    const figureClose = makeElementToken(Token, 'equation_citator_figure_close', 'figure', -1)
    addMarkerAttrs(figureOpen, attrs, 'equation-citator-figure-wrapper')

    const wrapped = [
      figureOpen,
      ...tokens.slice(markerOpenIndex, end),
      figureClose
    ]

    tokens.splice(markerOpenIndex, end - markerOpenIndex, ...wrapped)
    return wrapped.length
  }

  const imageInline = paragraphInlineAt(tokens, markerOpenIndex + 3)
  if (!isFigureImageToken(imageInline)) return 0

  const start = markerOpenIndex + 3
  const end = figureWrapEnd(tokens, start)
  const figureOpen = makeElementToken(Token, 'equation_citator_figure_open', 'figure', 1)
  const figureClose = makeElementToken(Token, 'equation_citator_figure_close', 'figure', -1)
  addMarkerAttrs(figureOpen, attrs, 'equation-citator-figure-wrapper')

  const wrapped = [
    figureOpen,
    ...tokens.slice(start, end),
    figureClose
  ]

  tokens.splice(markerOpenIndex, end - markerOpenIndex, ...wrapped)
  return wrapped.length
}

function wrapParsedFigure(tokens, imageOpenIndex, attrs, Token) {
  const imageInline = paragraphInlineAt(tokens, imageOpenIndex)
  if (!isFigureImageToken(imageInline)) return 0

  const end = figureWrapEnd(tokens, imageOpenIndex)
  const figureOpen = makeElementToken(Token, 'equation_citator_figure_open', 'figure', 1)
  const figureClose = makeElementToken(Token, 'equation_citator_figure_close', 'figure', -1)
  addMarkerAttrs(figureOpen, attrs, 'equation-citator-figure-wrapper')

  const wrapped = [
    figureOpen,
    ...tokens.slice(imageOpenIndex, end),
    figureClose
  ]

  tokens.splice(imageOpenIndex, end - imageOpenIndex, ...wrapped)
  return wrapped.length
}

function wrapExportedCallout(tokens, markerOpenIndex, attrs) {
  for (let index = markerOpenIndex - 1; index >= 0; index -= 1) {
    const token = tokens[index]

    if (token.type === 'blockquote_close') return false
    if (token.type !== 'blockquote_open') continue

    const kind = (attrs['data-ec-kind'] || '').toLowerCase()
    if (kind) {
      attrs['data-callout-type'] = kind
      token.attrJoin('class', `callout callout-${kind}`)
    }
    token.attrJoin('class', 'ec-callout')
    addMarkerAttrs(token, attrs, 'equation-citator-callout-wrapper')
    removeParagraphAt(tokens, markerOpenIndex)
    return true
  }

  return false
}

function removeCalloutLabel(inline, Token) {
  const updated = inline.content.replace(/^\s*\[![^\]]+\][ \t]*/s, '')
  inline.content = updated

  let labelRemoved = false
  const children = []

  for (const child of inline.children || []) {
    if (!labelRemoved && child.type === 'text') {
      const nextContent = child.content.replace(/^\s*\[![^\]]+\][ \t]*/s, '')
      labelRemoved = nextContent !== child.content
      if (nextContent) {
        child.content = nextContent
        children.push(child)
      }
      continue
    }

    children.push(child)
  }

  if (!labelRemoved && updated) {
    const textToken = makeElementToken(Token, 'text', '', 0)
    textToken.content = updated
    children.push(textToken)
  }

  inline.children = children
}

function wrapParsedCallout(tokens, blockquoteOpenIndex, Token) {
  if (tokens[blockquoteOpenIndex]?.type !== 'blockquote_open') return false

  const inline = paragraphInlineAt(tokens, blockquoteOpenIndex + 1)
  const parsed = parseEquationCitatorCalloutLabel(inline?.content)
  if (!parsed) return false

  addMarkerAttrs(tokens[blockquoteOpenIndex], parsed.attrs, 'equation-citator-callout-wrapper')
  removeCalloutLabel(inline, Token)

  if (!inline.content.trim() && !(inline.children || []).length) {
    removeParagraphAt(tokens, blockquoteOpenIndex + 1)
  } else {
    tokens[blockquoteOpenIndex].attrSet('data-callout-has-title', '')
  }

  return true
}

const OBSIDIAN_CALLOUT_TYPES = {
  note: { title: 'Note' },
  abstract: { title: 'Abstract' },
  summary: { title: 'Summary' },
  tldr: { title: 'TL;DR' },
  info: { title: 'Info' },
  todo: { title: 'Todo' },
  tip: { title: 'Tip' },
  hint: { title: 'Hint' },
  important: { title: 'Important' },
  success: { title: 'Success' },
  check: { title: 'Check' },
  done: { title: 'Done' },
  question: { title: 'Question' },
  help: { title: 'Help' },
  faq: { title: 'FAQ' },
  warning: { title: 'Warning' },
  caution: { title: 'Caution' },
  attention: { title: 'Attention' },
  failure: { title: 'Failure' },
  fail: { title: 'Fail' },
  missing: { title: 'Missing' },
  danger: { title: 'Danger' },
  error: { title: 'Error' },
  bug: { title: 'Bug' },
  example: { title: 'Example' },
  quote: { title: 'Quote' },
  cite: { title: 'Cite' }
}

function parseObsidianCalloutLabel(raw = '') {
  const match = String(raw).match(/^\s*\[!([A-Za-z][\w-]*)\](?:[ \t]*(.*))?$/s)
  if (!match) return null

  const type = match[1].toLowerCase()
  const def = OBSIDIAN_CALLOUT_TYPES[type]
  if (!def) return null

  return { type, title: match[2]?.trim() || def.title }
}

function isEquationCitatorCallout(raw = '') {
  return /^\s*\[![A-Za-z][\w-]*:/.test(String(raw))
}

function wrapObsidianCallouts(md, options) {
  md.core.ruler.after('block', 'obsidian-callouts', (state) => {
    if (!shouldProcess(state, options)) return

    const { tokens, Token } = state

    for (let index = 0; index < tokens.length; index += 1) {
      if (tokens[index]?.type !== 'blockquote_open') continue

      const inline = paragraphInlineAt(tokens, index + 1)
      if (!inline) continue
      if (isEquationCitatorCallout(inline.content)) continue

      const parsed = parseObsidianCalloutLabel(inline.content)
      if (!parsed) continue

      tokens[index].attrJoin('class', `callout callout-${parsed.type}`)
      tokens[index].attrSet('data-callout-type', parsed.type)
      removeCalloutLabel(inline, Token)
      inline.children = []

      if (inline.content.trim()) {
        tokens[index].attrSet('data-callout-has-title', '')
      } else {
        removeParagraphAt(tokens, index + 1)
      }
    }
  })
}

function wrapEquationCitatorExports(md, options) {
  md.core.ruler.after('inline', 'equation-citator-exports', (state) => {
    if (!shouldProcess(state, options)) return

    const { tokens, Token } = state
    const figureKinds = ['fig', 'figure']
    const nonCalloutKinds = ['eq', 'equation', ...figureKinds]
    for (let index = 0; index < tokens.length; index += 1) {
      if (wrapParsedCallout(tokens, index, Token)) {
        continue
      }

      const inline = paragraphInlineAt(tokens, index)
      const marker = findEquationCitatorMarker(inline)
      if (marker) {
        if (figureKinds.includes(marker['data-ec-kind'])) {
          const consumed = wrapExportedFigure(tokens, index, marker, Token)
          if (consumed) {
            index += consumed - 1
            continue
          }
        }

        const isCalloutMarker = /\bequation-citator-callout\b/.test(marker.class || '') ||
          !nonCalloutKinds.includes(marker['data-ec-kind'])
        if (isCalloutMarker && wrapExportedCallout(tokens, index, marker)) {
          index -= 1
          continue
        }
      }

      const figureAttrs = findFigureAttrs(inline)
      if (figureAttrs) {
        const consumed = wrapParsedFigure(tokens, index, figureAttrs, Token)
        if (consumed) index += consumed - 1
      }
    }
  })
}

function wrapFigureCaptions(md) {
  md.renderer.rules.equation_citator_figure_close = (tokens, idx) => {
    let title = ''
    let desc = ''
    for (let i = idx; i >= 0; i -= 1) {
      if (tokens[i].type === 'equation_citator_figure_open') {
        title = tokens[i].attrGet('data-title') || ''
        desc = tokens[i].attrGet('data-desc') || ''
        break
      }
    }

    let caption = ''
    if (title || desc) {
      caption = '<figcaption class="figure-caption">'
      if (title) caption += `<span class="figure-title">${md.utils.escapeHtml(title)}</span>`
      if (desc) caption += `<span class="figure-desc">${md.utils.escapeHtml(desc)}</span>`
      caption += '</figcaption>'
    }

    return `${caption}</figure>`
  }
}

function wrapEquationBlocks(md, options) {
  const renderMathBlock = md.renderer.rules.math_block
  if (!renderMathBlock) return

  md.renderer.rules.math_block = (tokens, idx, markdownOptions, env, self) => {
    const rendered = renderMathBlock(tokens, idx, markdownOptions, env, self)
    const stateLike = { env }
    if (!shouldProcess(stateLike, options)) return rendered

    return `<div class="equation-citator-target equation-citator-equation" data-ec-kind="eq" ${equationTagAttribute(tokens[idx].content)}>${rendered}</div>`
  }
}

export function equationCitatorMarkdownIt(md, options = {}) {
  const normalizedOptions = {
    enableEquationTargets: true,
    enableFigureTargets: true,
    enableCalloutTargets: true,
    enableFigureCaptions: true,
    enableObsidianCallouts: false,
    ...options
  }

  if (normalizedOptions.enableObsidianCallouts) {
    wrapObsidianCallouts(md, normalizedOptions)
  }

  if (normalizedOptions.enableFigureCaptions) {
    wrapFigureCaptions(md)
  }

  if (normalizedOptions.enableEquationTargets) {
    wrapEquationBlocks(md, normalizedOptions)
  }

  if (normalizedOptions.enableFigureTargets || normalizedOptions.enableCalloutTargets) {
    wrapEquationCitatorExports(md, normalizedOptions)
  }
}

export default equationCitatorMarkdownIt
