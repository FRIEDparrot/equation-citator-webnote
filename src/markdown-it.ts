type MarkdownItPlugin = {
    core: {
        ruler: {
            after: (afterName: string, ruleName: string, rule: (state: MarkdownItState) => void) => void
        }
    }
    renderer: {
        rules: Record<string, (...args: any[]) => string>
    }
    utils: {
        escapeHtml: (value: string) => string
    }
}

type MarkdownItState = {
    env: Record<string, any>
    tokens: MarkdownItToken[]
    Token: TokenConstructor
}

type MarkdownItToken = {
    type: string
    tag?: string
    nesting?: number
    content: string
    children?: MarkdownItToken[]
    attrJoin: (name: string, value: string) => void
    attrSet: (name: string, value: string) => void
    attrGet: (name: string) => string | null
}

type TokenConstructor = new (type: string, tag: string, nesting: number) => MarkdownItToken

type ProcessInclude =
    | string
    | RegExp
    | ((env: Record<string, any>, state: Pick<MarkdownItState, 'env'>) => boolean)

export type EquationCitatorMarkdownItOptions = {
    include?: ProcessInclude
    filter?: ProcessInclude
    equationKind?: string
    figureKind?: string
    calloutKinds?: string[]
    enableEquationTargets?: boolean
    enableFigureTargets?: boolean
    enableCalloutTargets?: boolean
    enableFigureCaptions?: boolean
    enableObsidianCallouts?: boolean
    enableObsidianLinks?: boolean
}

type NormalizedEquationCitatorMarkdownItOptions = Required<
    Pick<
        EquationCitatorMarkdownItOptions,
        | 'equationKind'
        | 'figureKind'
        | 'calloutKinds'
        | 'enableEquationTargets'
        | 'enableFigureTargets'
        | 'enableCalloutTargets'
        | 'enableFigureCaptions'
        | 'enableObsidianCallouts'
        | 'enableObsidianLinks'
    >
> & Pick<EquationCitatorMarkdownItOptions, 'include' | 'filter'>

type FigureMetadata = {
    tag: string
    title: string
    desc: string
    width: string
    label: string
}

type HtmlAttrs = Record<string, string>

type MarkerAttrs = HtmlAttrs & {
    class?: string
}

type ParsedEquationCitatorCallout = {
    title: string
    kind: string
    attrs: MarkerAttrs
}

type ParsedObsidianCallout = {
    type: string
    title: string
}

type ObsidianEmbedMetadata = FigureMetadata

type ParsedObsidianLink = {
    raw: string
    embed: boolean
    target: string
    alias: string
    rawAlias: string
    metadata: ObsidianEmbedMetadata
}

const HTML_SPAN_OPEN = '<span'
const HTML_IMAGE_OPEN = '<img'
const EQUATION_TARGET_CLASS = 'equation-citator-target'
const EQUATION_CALLOUT_CLASS = 'equation-citator-callout'
const DATA_EC_KIND_ATTR = 'data-ec-kind'
const CALLOUT_PREFIX = '[!'
const DIGITS = new Set('0123456789'.split(''))
const DEFAULT_EQUATION_KIND = 'eq'
const DEFAULT_FIGURE_KIND = 'fig'
const DEFAULT_CALLOUT_KINDS = ['table']
const OBSIDIAN_LINK_PATTERN = /(!?)\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g
const KNOWN_DOC_ROUTE_PREFIXES = ['knowledge-base/', 'posts/', 'projects/']
const SECTION_REFERENCE_TEXT = 'This is a section reference, click here to jump'

function escapeHtmlAttribute(value = ''): string {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('"', '&quot;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
}

/**
 * This function determines whether the Equation Citator plugin should process the current MarkdownIt state based on the provided options.
 * @param state - The current MarkdownIt state, which includes the environment and tokens. 
 */
function shouldProcess(state: Pick<MarkdownItState, 'env'>, options: EquationCitatorMarkdownItOptions): boolean {
    const include = options.include ?? options.filter
    if (!include) return true
    if (typeof include === 'function') return Boolean(include(state.env, state))
    if (include instanceof RegExp) return include.test(state.env.relativePath || '')
    if (typeof include === 'string') return String(state.env.relativePath || '').startsWith(include)
    return true
}

function readEquationTag(content = ''): string {
    const source = String(content)
    const marker = String.raw`\tag`
    let cursor = source.indexOf(marker)

    while (cursor >= 0) {
        let index = cursor + marker.length
        while (source[index] === ' ' || source[index] === '\t' || source[index] === '\n' || source[index] === '\r') {
            index += 1
        }

        if (source[index] === '{') {
            const end = source.indexOf('}', index + 1)
            if (end > index + 1) {
                return source.slice(index + 1, end).trim()
            }
        }

        cursor = source.indexOf(marker, cursor + marker.length)
    }

    return ''
}

function equationTagAttribute(content = ''): string {
    const tag = readEquationTag(content)
    if (!tag) return ''

    const escapedTag = escapeHtmlAttribute(tag)
    return ` data-ec-tag="${escapedTag}" data-tag="${escapedTag}"`
}

function isWhitespace(char = ''): boolean {
    return char === ' ' || char === '\t' || char === '\n' || char === '\r' || char === '\f'
}

function startsWithCaseInsensitive(source: string, prefix: string): boolean {
    return source.slice(0, prefix.length).toLowerCase() === prefix.toLowerCase()
}

function isDigitsOnly(value: string): boolean {
    return Boolean(value) && [...value].every((char) => DIGITS.has(char))
}

export function parseEquationCitatorFigureLabel(raw = ''): FigureMetadata | null {
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
        const separator = part.indexOf(':')
        const key = separator >= 0 ? part.slice(0, separator).trim().toLowerCase() : ''
        const value = separator >= 0 ? part.slice(separator + 1).trim() : ''

        if ((key === 'fig' || key === 'figure') && value) {
            metadata.tag = value
            continue
        }

        if (key === 'title') {
            metadata.title = value
            continue
        }

        if (key === 'desc') {
            metadata.desc = value
            continue
        }

        if (isDigitsOnly(part)) {
            metadata.width = part
            continue
        }

        metadata.label = part
    }

    return metadata.tag ? metadata : null
}

function parseObsidianEmbedMetadata(rawAlias = '', fallbackLabel = ''): ObsidianEmbedMetadata {
    const parsed = parseEquationCitatorFigureLabel(rawAlias)
    if (parsed) return parsed

    const metadata: ObsidianEmbedMetadata = {
        tag: '',
        title: '',
        desc: '',
        width: '',
        label: fallbackLabel
    }

    for (const part of String(rawAlias).split('|').map((value) => value.trim()).filter(Boolean)) {
        const separator = part.indexOf(':')
        const key = separator >= 0 ? part.slice(0, separator).trim().toLowerCase() : ''
        const value = separator >= 0 ? part.slice(separator + 1).trim() : ''

        if ((key === 'fig' || key === 'figure') && value) {
            metadata.tag = value
            continue
        }

        if (key === 'title') {
            metadata.title = value
            continue
        }

        if (key === 'desc') {
            metadata.desc = value
            continue
        }

        if (isDigitsOnly(part)) {
            metadata.width = part
            continue
        }

        metadata.label = part
    }

    return metadata
}

function isExternalTarget(target = ''): boolean {
    return /^(https?:)?\/\//.test(target)
}

function splitTargetHash(target = ''): { path: string, hash: string } {
    const hashIndex = target.indexOf('#')
    if (hashIndex < 0) return { path: target, hash: '' }
    return {
        path: target.slice(0, hashIndex),
        hash: target.slice(hashIndex + 1)
    }
}

function removeUrlHash(value = ''): string {
    return splitTargetHash(value).path
}

function trimRepeatedEdges(value = '', edgeChar = '-'): string {
    let start = 0
    let end = value.length

    while (start < end && value[start] === edgeChar) start += 1
    while (end > start && value[end - 1] === edgeChar) end -= 1

    return value.slice(start, end)
}

function headingSlug(rawHeading = ''): string {
    const slug = rawHeading
        .trim()
        .toLowerCase()
        .replace(/[`*_~[\]()]/g, '')
        .replaceAll('&amp;', 'and')
        .replaceAll('&', 'and')
        .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    const trimmedSlug = trimRepeatedEdges(slug, '-')

    if (!trimmedSlug) return ''
    return DIGITS.has(trimmedSlug[0]) ? `_${trimmedSlug}` : trimmedSlug
}

function sectionHrefFromTarget(target = ''): string {
    if (!target.startsWith('#')) return ''

    const slug = headingSlug(target.slice(1))
    return slug ? `#${slug}` : '#'
}

function stripMarkdownExtension(target = ''): string {
    return target.replace(/\.md$/i, '')
}

function posixDirname(target = ''): string {
    const normalized = target.replaceAll('\\', '/')
    const index = normalized.lastIndexOf('/')
    return index >= 0 ? normalized.slice(0, index) : '.'
}

function encodePathSegments(target = ''): string {
    return target.split('/').map((segment) => encodeURIComponent(segment)).join('/')
}

function relativePosixPath(fromDir = '', targetPath = ''): string {
    const fromParts = fromDir.split('/').filter(Boolean)
    const targetParts = targetPath.split('/').filter(Boolean)
    let common = 0

    while (common < fromParts.length && common < targetParts.length && fromParts[common] === targetParts[common]) {
        common += 1
    }

    const up = fromParts.slice(common).map(() => '..')
    const down = targetParts.slice(common)
    const relative = [...up, ...down].join('/')
    return relative || '.'
}

function relativeMarkdownLink(fromRelativePath = '', targetPath = ''): string {
    const fromDir = posixDirname(fromRelativePath.replaceAll('\\', '/') || 'knowledge-base/index.md')
    const relative = relativePosixPath(fromDir, targetPath.replaceAll('\\', '/'))
    const link = relative.startsWith('.') ? relative : `./${relative}`
    return encodePathSegments(link)
}

function currentRouteRoot(relativePath = ''): string {
    const first = relativePath.replaceAll('\\', '/').split('/').find(Boolean) || ''
    return first ? `${first}/` : ''
}

function hasKnownRoutePrefix(target = ''): boolean {
    return KNOWN_DOC_ROUTE_PREFIXES.some((prefix) => target.startsWith(prefix))
}

function resolveEmbedTargetPath(target = '', relativePath = ''): string {
    if (isExternalTarget(target)) return target

    const { path, hash } = splitTargetHash(target)
    const normalizedTarget = stripMarkdownExtension(path).replace(/^\/+/, '')
    if (!normalizedTarget) return hash ? `#${hash}` : ''
    if (hasKnownRoutePrefix(normalizedTarget)) return hash ? `${normalizedTarget}#${hash}` : normalizedTarget

    const routeRoot = currentRouteRoot(relativePath)
    let resolved: string;
    if (normalizedTarget.includes('/')) {
        resolved = routeRoot && !hasKnownRoutePrefix(normalizedTarget)
            ? `${routeRoot}${normalizedTarget}`
            : normalizedTarget
    } else {
        resolved = `${posixDirname(relativePath.replaceAll('\\', '/') || 'knowledge-base/index.md')}/${normalizedTarget}`
    }

    return hash ? `${resolved}#${hash}` : resolved
}

function encodedDocsLink(targetPath = ''): string {
    if (isExternalTarget(targetPath)) return targetPath

    const { path, hash } = splitTargetHash(targetPath)
    const normalized = path.replace(/^\/+/, '')
    const link = hasKnownRoutePrefix(normalized) ? `/${normalized}` : `/knowledge-base/${normalized}`
    const encodedPath = encodePathSegments(link)

    if (!hash) return encodedPath

    const slug = headingSlug(hash)
    return slug ? `${encodedPath}#${slug}` : `${encodedPath}#`
}

function parseObsidianLink(raw = ''): ParsedObsidianLink | null {
    const match = /^(!?)\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/.exec(raw)
    if (!match) return null

    const target = match[2].trim()
    if (!target) return null

    const rawAlias = match[3] || ''
    const alias = (rawAlias || target).trim()

    return {
        raw,
        embed: match[1] === '!',
        target,
        alias,
        rawAlias,
        metadata: parseObsidianEmbedMetadata(rawAlias, target)
    }
}

function normalizeKind(kind = ''): string {
    return String(kind || '').trim().toLowerCase()
}

function configuredEquationKind(options: NormalizedEquationCitatorMarkdownItOptions): string {
    return normalizeKind(options.equationKind) || DEFAULT_EQUATION_KIND
}

function configuredFigureKind(options: NormalizedEquationCitatorMarkdownItOptions): string {
    return normalizeKind(options.figureKind) || DEFAULT_FIGURE_KIND
}

function configuredCalloutKinds(options: NormalizedEquationCitatorMarkdownItOptions): Set<string> {
    return new Set(options.calloutKinds.map(normalizeKind).filter(Boolean))
}

function configuredNonCalloutKinds(options: NormalizedEquationCitatorMarkdownItOptions): Set<string> {
    return new Set([
        configuredEquationKind(options),
        configuredFigureKind(options)
    ])
}

function figureAttrsFromMetadata(metadata: FigureMetadata, figureKind = DEFAULT_FIGURE_KIND): MarkerAttrs {
    const attrs: MarkerAttrs = {
        class: 'equation-citator-target equation-citator-figure',
        'data-ec-kind': figureKind,
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

function normalizeFigureAttrs(attrs: HtmlAttrs = {}, figureKind = DEFAULT_FIGURE_KIND): MarkerAttrs | null {
    if (normalizeKind(attrs['data-ec-kind']) !== figureKind || !attrs['data-ec-tag']) return null

    const normalized: MarkerAttrs = {
        class: 'equation-citator-target equation-citator-figure',
        'data-ec-kind': figureKind,
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

function parseCalloutPrefix(raw = ''): { marker: string, title: string } | null {
    const source = String(raw)
    const trimmedStart = source.trimStart()
    if (!trimmedStart.startsWith(CALLOUT_PREFIX)) return null

    const close = trimmedStart.indexOf(']')
    if (close < 0) return null

    const marker = trimmedStart.slice(CALLOUT_PREFIX.length, close).trim()
    const title = trimmedStart.slice(close + 1).trimStart()
    return marker ? { marker, title } : null
}

function parseEquationCitatorCalloutLabel(raw = ''): ParsedEquationCitatorCallout | null {
    const parsed = parseCalloutPrefix(raw)
    if (!parsed) return null

    const [kindAndTag] = parsed.marker.split('|')
    const separator = kindAndTag.indexOf(':')
    if (separator < 0) return null

    const kind = kindAndTag.slice(0, separator).trim()
    const tag = kindAndTag.slice(separator + 1).trim()
    if (!kind || !tag) return null

    return {
        title: parsed.title,
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

function containsHtmlOpenTag(content: string, tag: string): boolean {
    return content.trimStart().toLowerCase().startsWith(`<${tag}`)
}

function readQuotedHtmlAttribute(raw: string, name: string): string {
    const source = String(raw)
    const variants = [` ${name}="`, ` ${name}='`]

    for (const variant of variants) {
        const start = source.indexOf(variant)
        if (start < 0) continue

        const valueStart = start + variant.length
        const quote = variant.at(-1)
        const end = source.indexOf(quote, valueStart)
        return end >= 0 ? source.slice(valueStart, end) : source.slice(valueStart)
    }

    return ''
}

function markerAttrsFromHtml(content: string): MarkerAttrs {
    const kind = readQuotedHtmlAttribute(content, DATA_EC_KIND_ATTR)
    const tag = readQuotedHtmlAttribute(content, 'data-ec-tag') || readQuotedHtmlAttribute(content, 'data-tag')
    const attrs: MarkerAttrs = {
        class: readQuotedHtmlAttribute(content, 'class'),
        [DATA_EC_KIND_ATTR]: kind
    }

    if (tag) attrs['data-ec-tag'] = tag
    for (const name of ['data-title', 'data-desc', 'data-width', 'width']) {
        const value = readQuotedHtmlAttribute(content, name)
        if (value) attrs[name] = value
    }

    return attrs
}

function findEquationCitatorMarker(token?: MarkdownItToken | null): MarkerAttrs | null {
    const children = token?.children || []
    const htmlToken = children.find((child) =>
        child.type === 'html_inline' &&
        containsHtmlOpenTag(child.content, 'span') &&
        child.content.includes(EQUATION_TARGET_CLASS) &&
        child.content.includes(`${DATA_EC_KIND_ATTR}=`)
    )

    if (!htmlToken) return null

    const attrs = markerAttrsFromHtml(htmlToken.content)
    if (!attrs['data-ec-kind']) return null

    return attrs
}

function removeEquationCitatorMarker(token?: MarkdownItToken | null): void {
    if (!token?.children) return

    const children: MarkdownItToken[] = []
    let skipClosingSpan = false

    for (const child of token.children) {
        if (
            child.type === 'html_inline' &&
            containsHtmlOpenTag(child.content, 'span') &&
            child.content.includes(EQUATION_TARGET_CLASS)
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

function tokenContainsClass(token: MarkdownItToken | null | undefined, className: string): boolean {
    return (token?.children || []).some((child) =>
        child.type === 'html_inline' &&
        child.content.includes(className)
    )
}

function paragraphInlineAt(tokens: MarkdownItToken[], index: number): MarkdownItToken | null {
    return tokens[index]?.type === 'paragraph_open' &&
        tokens[index + 1]?.type === 'inline' &&
        tokens[index + 2]?.type === 'paragraph_close'
        ? tokens[index + 1]
        : null
}

function removeParagraphAt(tokens: MarkdownItToken[], index: number): void {
    tokens.splice(index, 3)
}

function addMarkerAttrs(token: MarkdownItToken, attrs: MarkerAttrs, extraClass = ''): void {
    const classes = [attrs.class, extraClass].filter(Boolean).join(' ')
    if (classes) token.attrJoin('class', classes)

    for (const [name, value] of Object.entries(attrs)) {
        if (name === 'class') continue
        if (name === 'style' || name.startsWith('data-')) token.attrSet(name, value)
    }
}

function makeElementToken(Token: TokenConstructor, type: string, tag: string, nesting: number): MarkdownItToken {
    return new Token(type, tag, nesting)
}

function makeTextToken(Token: TokenConstructor, content: string): MarkdownItToken {
    const token = makeElementToken(Token, 'text', '', 0)
    token.content = content
    return token
}

function makeHtmlInlineToken(Token: TokenConstructor, content: string): MarkdownItToken {
    const token = makeElementToken(Token, 'html_inline', '', 0)
    token.content = content
    return token
}

function makeLinkTokens(Token: TokenConstructor, href: string, text: string, className = ''): MarkdownItToken[] {
    const open = makeElementToken(Token, 'link_open', 'a', 1)
    open.attrSet('href', href)
    if (className) open.attrSet('class', className)

    const close = makeElementToken(Token, 'link_close', 'a', -1)
    return [open, makeTextToken(Token, text), close]
}

function makeObsidianImageToken(Token: TokenConstructor, parsed: ParsedObsidianLink, relativePath = ''): MarkdownItToken {
    const metadata = parsed.metadata
    const image = makeElementToken(Token, 'image', 'img', 0)
    const resolvedTarget = resolveEmbedTargetPath(parsed.target, relativePath)

    const isEmbedded = parsed.target.includes('#') ? 'data:,' : relativeMarkdownLink(relativePath, resolvedTarget)
    const src = isExternalTarget(parsed.target) ? parsed.target : isEmbedded;

    image.content = parsed.rawAlias || parsed.target
    image.attrSet('src', src)
    image.attrSet('alt', parsed.rawAlias || parsed.target)
    image.children = [makeTextToken(Token, parsed.rawAlias || parsed.target)]

    if (metadata.title) image.attrSet('title', metadata.title)
    if (metadata.width) image.attrSet('width', metadata.width)

    if (src === 'data:,') {
        image.attrSet('data-missing-src', encodedDocsLink(resolvedTarget))
    }

    return image
}

function makeObsidianLinkTokens(Token: TokenConstructor, parsed: ParsedObsidianLink, relativePath = ''): MarkdownItToken[] {
    if (isExternalTarget(parsed.target)) {
        return makeLinkTokens(Token, parsed.target, parsed.alias)
    }

    if (parsed.target.startsWith('#')) {
        return makeLinkTokens(Token, sectionHrefFromTarget(parsed.target), parsed.alias)
    }

    const normalizedTarget = stripMarkdownExtension(parsed.target).replace(/^\/+/, '')
    const targetPath = resolveEmbedTargetPath(normalizedTarget, relativePath)
    const href = encodedDocsLink(targetPath)
    return [
        makeHtmlInlineToken(Token, `<a href="${escapeHtmlAttribute(href)}">${escapeHtmlAttribute(parsed.alias)}</a>`)
    ]
}

function makeSectionReferenceTokens(Token: TokenConstructor, parsed: ParsedObsidianLink): MarkdownItToken[] {
    return makeLinkTokens(
        Token,
        sectionHrefFromTarget(parsed.target),
        SECTION_REFERENCE_TEXT,
        'equation-citator-section-reference'
    )
}

function tokensFromObsidianLink(Token: TokenConstructor, parsed: ParsedObsidianLink, relativePath = ''): MarkdownItToken[] {
    if (parsed.embed) {
        if (parsed.target.startsWith('#')) {
            return makeSectionReferenceTokens(Token, parsed)
        }

        return [makeObsidianImageToken(Token, parsed, relativePath)]
    }

    return makeObsidianLinkTokens(Token, parsed, relativePath)
}

function replaceObsidianLinksInInlineToken(inline: MarkdownItToken, Token: TokenConstructor, relativePath = ''): void {
    const children = inline.children || []
    const updatedChildren: MarkdownItToken[] = []
    let changed = false

    for (const child of children) {
        if (child.type !== 'text') {
            updatedChildren.push(child)
            continue
        }

        const source = child.content
        let cursor = 0
        OBSIDIAN_LINK_PATTERN.lastIndex = 0

        for (const match of source.matchAll(OBSIDIAN_LINK_PATTERN)) {
            const index = match.index ?? 0
            const parsed = parseObsidianLink(match[0])
            if (!parsed) continue

            if (index > cursor) updatedChildren.push(makeTextToken(Token, source.slice(cursor, index)))
            updatedChildren.push(...tokensFromObsidianLink(Token, parsed, relativePath))
            cursor = index + match[0].length
            changed = true
        }

        if (changed && cursor < source.length) {
            updatedChildren.push(makeTextToken(Token, source.slice(cursor)))
        } else if (!changed) {
            updatedChildren.push(child)
        }
    }

    if (!changed) return

    inline.children = updatedChildren
    inline.content = updatedChildren.map((token) => token.content || '').join('')
}

function singleTextObsidianEmbed(inline: MarkdownItToken | null): ParsedObsidianLink | null {
    if (!inline) return null
    const trimmed = inline.content.trim()
    const parsed = parseObsidianLink(trimmed)
    if (!parsed?.embed) return null
    return parsed
}

function wrapSectionReferenceEmbed(
    tokens: MarkdownItToken[],
    paragraphIndex: number,
    parsed: ParsedObsidianLink,
    Token: TokenConstructor,
    figureKind = DEFAULT_FIGURE_KIND
): boolean {
    if (!parsed.target.startsWith('#') || !parsed.metadata.tag) return false

    const figureOpen = makeElementToken(Token, 'equation_citator_figure_open', 'figure', 1)
    const figureClose = makeElementToken(Token, 'equation_citator_figure_close', 'figure', -1)
    addMarkerAttrs(figureOpen, figureAttrsFromMetadata({ ...parsed.metadata, tag: parsed.metadata.tag }, figureKind), 'equation-citator-figure-wrapper')

    const inline = makeElementToken(Token, 'inline', '', 0)
    inline.content = SECTION_REFERENCE_TEXT
    inline.children = makeSectionReferenceTokens(Token, parsed)

    const paragraphOpen = makeElementToken(Token, 'paragraph_open', 'p', 1)
    const paragraphClose = makeElementToken(Token, 'paragraph_close', 'p', -1)

    tokens.splice(paragraphIndex, 3, figureOpen, paragraphOpen, inline, paragraphClose, figureClose)
    return true
}

function convertObsidianLinksInTokens(
    tokens: MarkdownItToken[],
    Token: TokenConstructor,
    relativePath = '',
    figureKind = DEFAULT_FIGURE_KIND
): void {
    for (let index = 0; index < tokens.length; index += 1) {
        const inline = paragraphInlineAt(tokens, index)
        const standaloneEmbed = singleTextObsidianEmbed(inline)

        if (standaloneEmbed?.target.startsWith('#') && wrapSectionReferenceEmbed(tokens, index, standaloneEmbed, Token, figureKind)) {
            index += 4
            continue
        }

        const token = tokens[index]
        if (token.type !== 'inline') continue
        replaceObsidianLinksInInlineToken(token, Token, relativePath)
    }
}

////////////////////////// IMAGE EXTENSIONS /////////////////////  

function htmlImageTokenFromInlineHtml(token: MarkdownItToken, Token: TokenConstructor): MarkdownItToken | null {
    const source = token.content.trim()
    if (!startsWithCaseInsensitive(source, HTML_IMAGE_OPEN)) return null

    const alt = readQuotedHtmlAttribute(source, 'alt')
    const title = readQuotedHtmlAttribute(source, 'title')
    const src = readQuotedHtmlAttribute(source, 'src')
    const metadata = parseEquationCitatorFigureLabel(alt || title)
    if (!metadata) return null

    const image = makeElementToken(Token, 'image', 'img', 0)
    image.content = alt || title
    image.attrSet('src', src)
    image.attrSet('alt', alt || title)
    if (title) image.attrSet('title', title)
    if (metadata.width) image.attrSet('width', metadata.width)

    return image
}

function isFigureImageToken(token: MarkdownItToken | null | undefined): boolean {
    const content = token?.content?.trim() || ''
    const children = token?.children || []

    return startsWithCaseInsensitive(content, HTML_IMAGE_OPEN) ||
        children.some((child) => child.type === 'image') ||
        children.some((child) =>
            child.type === 'html_inline' &&
            startsWithCaseInsensitive(child.content.trim(), HTML_IMAGE_OPEN)
        )
}

// #region  figure wrapping functions 

function setImageTokenAlt(token: MarkdownItToken, alt: string, Token?: TokenConstructor): void {
    token.content = alt
    token.attrSet('alt', alt)

    if (!Token) return

    const textToken = makeElementToken(Token, 'text', '', 0)
    textToken.content = alt
    token.children = [textToken]
}

function findFigureAttrs(
    token: MarkdownItToken | null | undefined,
    Token: TokenConstructor,
    figureKind = DEFAULT_FIGURE_KIND
): MarkerAttrs | null {
    for (const child of token?.children || []) {
        if (child.type === 'image') {
            const metadata = parseEquationCitatorFigureLabel(child.content || child.attrGet('alt') || '')
            if (!metadata) continue
            if (metadata.width) child.attrSet('width', metadata.width)

            const alt = metadata.label || metadata.title || metadata.desc || metadata.tag
            if (alt) setImageTokenAlt(child, alt, Token)

            return figureAttrsFromMetadata(metadata, figureKind)
        }

        if (child.type === 'html_inline') {
            const image = htmlImageTokenFromInlineHtml(child, Token)
            if (!image) continue

            child.type = image.type
            child.tag = image.tag
            child.nesting = image.nesting
            child.content = image.content
            child.children = image.children
            child.attrSet('src', image.attrGet('src') || '')
            child.attrSet('alt', image.attrGet('alt') || '')
            if (image.attrGet('title')) child.attrSet('title', image.attrGet('title') || '')
            if (image.attrGet('width')) child.attrSet('width', image.attrGet('width') || '')

            const metadata = parseEquationCitatorFigureLabel(image.content)
            if (!metadata) continue
            const alt = metadata.label || metadata.title || metadata.desc || metadata.tag
            if (alt) setImageTokenAlt(child, alt, Token)
            return figureAttrsFromMetadata(metadata, figureKind)
        }
    }

    return null
}



function figureWrapEnd(tokens: MarkdownItToken[], imageOpenIndex: number): number {
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

/***
 * Core function: wrapParsedFigure 
 */
function wrapExportedFigure(tokens: MarkdownItToken[], markerOpenIndex: number, attrs: MarkerAttrs, Token: TokenConstructor): number {
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

function wrapParsedFigure(tokens: MarkdownItToken[], imageOpenIndex: number, attrs: MarkerAttrs, Token: TokenConstructor): number {
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

// #endregion 

function wrapExportedCallout(tokens: MarkdownItToken[], markerOpenIndex: number, attrs: MarkerAttrs): boolean {
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

function stripCalloutLabel(content = ''): string {
    const parsed = parseCalloutPrefix(content)
    if (!parsed) return content

    const source = String(content)
    const leading = source.length - source.trimStart().length
    const close = source.indexOf(']', leading)
    if (close < 0) return content

    return source.slice(close + 1).trimStart()
}

function removeCalloutLabel(inline: MarkdownItToken, Token: TokenConstructor): void {
    const updated = stripCalloutLabel(inline.content)
    inline.content = updated

    let labelRemoved = false
    const children: MarkdownItToken[] = []

    for (const child of inline.children || []) {
        if (!labelRemoved && child.type === 'text') {
            const nextContent = stripCalloutLabel(child.content)
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

function wrapParsedCallout(tokens: MarkdownItToken[], blockquoteOpenIndex: number, Token: TokenConstructor): boolean {
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

const OBSIDIAN_CALLOUT_TYPES: Record<string, { title: string }> = {
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

function parseObsidianCalloutLabel(raw = ''): ParsedObsidianCallout | null {
    const parsed = parseCalloutPrefix(raw)
    if (!parsed) return null
    if (parsed.marker.includes(':') || parsed.marker.includes('|')) return null

    const type = parsed.marker.toLowerCase()
    const def = OBSIDIAN_CALLOUT_TYPES[type]
    if (!def) return null

    return { type, title: parsed.title.trim() || def.title }
}

function isEquationCitatorCallout(raw = ''): boolean {
    return parseEquationCitatorCalloutLabel(raw) !== null
}

function wrapObsidianCallouts(md: MarkdownItPlugin, options: EquationCitatorMarkdownItOptions): void {
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

function wrapEquationCitatorExports(md: MarkdownItPlugin, options: NormalizedEquationCitatorMarkdownItOptions): void {
    md.core.ruler.after('inline', 'equation-citator-exports', (state) => {
        if (!shouldProcess(state, options)) return

        const { tokens, Token } = state
        const figureKind = configuredFigureKind(options)
        const calloutKinds = configuredCalloutKinds(options)
        const nonCalloutKinds = configuredNonCalloutKinds(options)

        if (options.enableObsidianLinks) {
            convertObsidianLinksInTokens(tokens, Token, state.env.relativePath, figureKind)
        }

        for (let index = 0; index < tokens.length; index += 1) {
            if (wrapParsedCallout(tokens, index, Token)) {
                continue
            }
            const inline = paragraphInlineAt(tokens, index)
            const marker = findEquationCitatorMarker(inline)
            if (marker) {
                const markerKind = normalizeKind(marker['data-ec-kind'])
                if (markerKind === figureKind) {
                    const consumed = wrapExportedFigure(tokens, index, marker, Token)
                    if (consumed) {
                        index += consumed - 1
                        continue
                    }
                }

                const isCalloutMarker = (marker.class || '').split(' ').includes(EQUATION_CALLOUT_CLASS) ||
                    calloutKinds.has(markerKind) ||
                    !nonCalloutKinds.has(markerKind)
                if (isCalloutMarker && wrapExportedCallout(tokens, index, marker)) {
                    index -= 1
                    continue
                }
            }
            // this part determines the figure that found and wrapped
            const figureAttrs = findFigureAttrs(inline, Token, figureKind)
            if (figureAttrs) {
                const consumed = wrapParsedFigure(tokens, index, figureAttrs, Token)
                if (consumed) index += consumed - 1
            }
        }
    })
}

function wrapFigureCaptions(md: MarkdownItPlugin): void {
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

function wrapEquationBlocks(md: MarkdownItPlugin, options: NormalizedEquationCitatorMarkdownItOptions): void {
    const renderMathBlock = md.renderer.rules.math_block
    if (!renderMathBlock) return

    md.renderer.rules.math_block = (tokens, idx, markdownOptions, env, self) => {
        const rendered = renderMathBlock(tokens, idx, markdownOptions, env, self)
        const stateLike = { env }
        if (!shouldProcess(stateLike, options)) return rendered

        const equationKind = escapeHtmlAttribute(configuredEquationKind(options))
        return `<div class="equation-citator-target equation-citator-equation" data-ec-kind="${equationKind}" ${equationTagAttribute(tokens[idx].content)}>${rendered}</div>`
    }
}

export function equationCitatorMarkdownIt(md: MarkdownItPlugin, options: EquationCitatorMarkdownItOptions = {}): void {
    const normalizedOptions = {
        equationKind: DEFAULT_EQUATION_KIND,
        figureKind: DEFAULT_FIGURE_KIND,
        calloutKinds: DEFAULT_CALLOUT_KINDS,
        enableEquationTargets: true,
        enableFigureTargets: true,
        enableCalloutTargets: true,
        enableFigureCaptions: true,
        enableObsidianCallouts: false,
        enableObsidianLinks: true,
        ...options
    } satisfies NormalizedEquationCitatorMarkdownItOptions

    if (normalizedOptions.enableFigureTargets || normalizedOptions.enableCalloutTargets) {
        wrapEquationCitatorExports(md, normalizedOptions)
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
}

export default equationCitatorMarkdownIt
