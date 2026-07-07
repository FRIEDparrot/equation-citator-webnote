const HTML_SPAN_OPEN = '<span';
const HTML_IMAGE_OPEN = '<img';
const EQUATION_TARGET_CLASS = 'equation-citator-target';
const EQUATION_CALLOUT_CLASS = 'equation-citator-callout';
const DATA_EC_KIND_ATTR = 'data-ec-kind';
const CALLOUT_PREFIX = '[!';
const DIGITS = new Set('0123456789'.split(''));
const DEFAULT_EQUATION_KIND = 'eq';
const DEFAULT_FIGURE_KIND = 'fig';
const DEFAULT_CALLOUT_KINDS = ['table'];
function escapeHtmlAttribute(value = '') {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('"', '&quot;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;');
}
function shouldProcess(state, options) {
    const include = options.include ?? options.filter;
    if (!include)
        return true;
    if (typeof include === 'function')
        return Boolean(include(state.env, state));
    if (include instanceof RegExp)
        return include.test(state.env.relativePath || '');
    if (typeof include === 'string')
        return String(state.env.relativePath || '').startsWith(include);
    return true;
}
function readEquationTag(content = '') {
    const source = String(content);
    const marker = String.raw `\tag`;
    let cursor = source.indexOf(marker);
    while (cursor >= 0) {
        let index = cursor + marker.length;
        while (source[index] === ' ' || source[index] === '\t' || source[index] === '\n' || source[index] === '\r') {
            index += 1;
        }
        if (source[index] === '{') {
            const end = source.indexOf('}', index + 1);
            if (end > index + 1) {
                return source.slice(index + 1, end).trim();
            }
        }
        cursor = source.indexOf(marker, cursor + marker.length);
    }
    return '';
}
function equationTagAttribute(content = '') {
    const tag = readEquationTag(content);
    if (!tag)
        return '';
    const escapedTag = escapeHtmlAttribute(tag);
    return ` data-ec-tag="${escapedTag}" data-tag="${escapedTag}"`;
}
function isWhitespace(char = '') {
    return char === ' ' || char === '\t' || char === '\n' || char === '\r' || char === '\f';
}
function startsWithCaseInsensitive(source, prefix) {
    return source.slice(0, prefix.length).toLowerCase() === prefix.toLowerCase();
}
function isDigitsOnly(value) {
    return Boolean(value) && [...value].every((char) => DIGITS.has(char));
}
export function parseEquationCitatorFigureLabel(raw = '') {
    const parts = String(raw)
        .split('|')
        .map((part) => part.trim())
        .filter(Boolean);
    const metadata = {
        tag: '',
        title: '',
        desc: '',
        width: '',
        label: ''
    };
    for (const part of parts) {
        const separator = part.indexOf(':');
        const key = separator >= 0 ? part.slice(0, separator).trim().toLowerCase() : '';
        const value = separator >= 0 ? part.slice(separator + 1).trim() : '';
        if ((key === 'fig' || key === 'figure') && value) {
            metadata.tag = value;
            continue;
        }
        if (key === 'title') {
            metadata.title = value;
            continue;
        }
        if (key === 'desc') {
            metadata.desc = value;
            continue;
        }
        if (isDigitsOnly(part)) {
            metadata.width = part;
            continue;
        }
        metadata.label = part;
    }
    return metadata.tag ? metadata : null;
}
function normalizeKind(kind = '') {
    return String(kind || '').trim().toLowerCase();
}
function configuredEquationKind(options) {
    return normalizeKind(options.equationKind) || DEFAULT_EQUATION_KIND;
}
function configuredFigureKind(options) {
    return normalizeKind(options.figureKind) || DEFAULT_FIGURE_KIND;
}
function configuredCalloutKinds(options) {
    return new Set(options.calloutKinds.map(normalizeKind).filter(Boolean));
}
function configuredNonCalloutKinds(options) {
    return new Set([
        configuredEquationKind(options),
        configuredFigureKind(options)
    ]);
}
function figureAttrsFromMetadata(metadata, figureKind = DEFAULT_FIGURE_KIND) {
    const attrs = {
        class: 'equation-citator-target equation-citator-figure',
        'data-ec-kind': figureKind,
        'data-ec-tag': metadata.tag
    };
    if (metadata.title)
        attrs['data-title'] = metadata.title;
    if (metadata.desc)
        attrs['data-desc'] = metadata.desc;
    if (metadata.width) {
        attrs['data-width'] = metadata.width;
        attrs.style = `width: ${metadata.width}px; max-width: 100%;`;
    }
    return attrs;
}
function normalizeFigureAttrs(attrs = {}, figureKind = DEFAULT_FIGURE_KIND) {
    if (normalizeKind(attrs['data-ec-kind']) !== figureKind || !attrs['data-ec-tag'])
        return null;
    const normalized = {
        class: 'equation-citator-target equation-citator-figure',
        'data-ec-kind': figureKind,
        'data-ec-tag': attrs['data-ec-tag']
    };
    if (attrs['data-title'])
        normalized['data-title'] = attrs['data-title'];
    if (attrs['data-desc'])
        normalized['data-desc'] = attrs['data-desc'];
    if (attrs['data-width'] || attrs.width) {
        const width = attrs['data-width'] || attrs.width;
        normalized['data-width'] = width;
        normalized.style = `width: ${width}px; max-width: 100%;`;
    }
    return normalized;
}
function parseCalloutPrefix(raw = '') {
    const source = String(raw);
    const trimmedStart = source.trimStart();
    if (!trimmedStart.startsWith(CALLOUT_PREFIX))
        return null;
    const close = trimmedStart.indexOf(']');
    if (close < 0)
        return null;
    const marker = trimmedStart.slice(CALLOUT_PREFIX.length, close).trim();
    const title = trimmedStart.slice(close + 1).trimStart();
    return marker ? { marker, title } : null;
}
function parseEquationCitatorCalloutLabel(raw = '') {
    const parsed = parseCalloutPrefix(raw);
    if (!parsed)
        return null;
    const [kindAndTag] = parsed.marker.split('|');
    const separator = kindAndTag.indexOf(':');
    if (separator < 0)
        return null;
    const kind = kindAndTag.slice(0, separator).trim();
    const tag = kindAndTag.slice(separator + 1).trim();
    if (!kind || !tag)
        return null;
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
    };
}
function containsHtmlOpenTag(content, tag) {
    return content.trimStart().toLowerCase().startsWith(`<${tag}`);
}
function readQuotedHtmlAttribute(raw, name) {
    const source = String(raw);
    const variants = [` ${name}="`, ` ${name}='`];
    for (const variant of variants) {
        const start = source.indexOf(variant);
        if (start < 0)
            continue;
        const valueStart = start + variant.length;
        const quote = variant.at(-1);
        const end = source.indexOf(quote, valueStart);
        return end >= 0 ? source.slice(valueStart, end) : source.slice(valueStart);
    }
    return '';
}
function markerAttrsFromHtml(content) {
    const kind = readQuotedHtmlAttribute(content, DATA_EC_KIND_ATTR);
    const tag = readQuotedHtmlAttribute(content, 'data-ec-tag') || readQuotedHtmlAttribute(content, 'data-tag');
    const attrs = {
        class: readQuotedHtmlAttribute(content, 'class'),
        [DATA_EC_KIND_ATTR]: kind
    };
    if (tag)
        attrs['data-ec-tag'] = tag;
    for (const name of ['data-title', 'data-desc', 'data-width', 'width']) {
        const value = readQuotedHtmlAttribute(content, name);
        if (value)
            attrs[name] = value;
    }
    return attrs;
}
function findEquationCitatorMarker(token) {
    const children = token?.children || [];
    const htmlToken = children.find((child) => child.type === 'html_inline' &&
        containsHtmlOpenTag(child.content, 'span') &&
        child.content.includes(EQUATION_TARGET_CLASS) &&
        child.content.includes(`${DATA_EC_KIND_ATTR}=`));
    if (!htmlToken)
        return null;
    const attrs = markerAttrsFromHtml(htmlToken.content);
    if (!attrs['data-ec-kind'])
        return null;
    return attrs;
}
function removeEquationCitatorMarker(token) {
    if (!token?.children)
        return;
    const children = [];
    let skipClosingSpan = false;
    for (const child of token.children) {
        if (child.type === 'html_inline' &&
            containsHtmlOpenTag(child.content, 'span') &&
            child.content.includes(EQUATION_TARGET_CLASS)) {
            skipClosingSpan = true;
            continue;
        }
        if (skipClosingSpan && child.type === 'html_inline' && child.content.trim() === '</span>') {
            skipClosingSpan = false;
            continue;
        }
        skipClosingSpan = false;
        children.push(child);
    }
    token.children = children;
}
function tokenContainsClass(token, className) {
    return (token?.children || []).some((child) => child.type === 'html_inline' &&
        child.content.includes(className));
}
function paragraphInlineAt(tokens, index) {
    return tokens[index]?.type === 'paragraph_open' &&
        tokens[index + 1]?.type === 'inline' &&
        tokens[index + 2]?.type === 'paragraph_close'
        ? tokens[index + 1]
        : null;
}
function removeParagraphAt(tokens, index) {
    tokens.splice(index, 3);
}
function addMarkerAttrs(token, attrs, extraClass = '') {
    const classes = [attrs.class, extraClass].filter(Boolean).join(' ');
    if (classes)
        token.attrJoin('class', classes);
    for (const [name, value] of Object.entries(attrs)) {
        if (name === 'class')
            continue;
        if (name === 'style' || name.startsWith('data-'))
            token.attrSet(name, value);
    }
}
function makeElementToken(Token, type, tag, nesting) {
    return new Token(type, tag, nesting);
}
function htmlImageTokenFromInlineHtml(token, Token) {
    const source = token.content.trim();
    if (!startsWithCaseInsensitive(source, HTML_IMAGE_OPEN))
        return null;
    const alt = readQuotedHtmlAttribute(source, 'alt');
    const title = readQuotedHtmlAttribute(source, 'title');
    const src = readQuotedHtmlAttribute(source, 'src');
    const metadata = parseEquationCitatorFigureLabel(alt || title);
    if (!metadata)
        return null;
    const image = makeElementToken(Token, 'image', 'img', 0);
    image.content = alt || title;
    image.attrSet('src', src);
    image.attrSet('alt', alt || title);
    if (title)
        image.attrSet('title', title);
    if (metadata.width)
        image.attrSet('width', metadata.width);
    return image;
}
function isFigureImageToken(token) {
    const content = token?.content?.trim() || '';
    const children = token?.children || [];
    return startsWithCaseInsensitive(content, HTML_IMAGE_OPEN) ||
        children.some((child) => child.type === 'image') ||
        children.some((child) => child.type === 'html_inline' &&
            startsWithCaseInsensitive(child.content.trim(), HTML_IMAGE_OPEN));
}
function setImageTokenAlt(token, alt, Token) {
    token.content = alt;
    token.attrSet('alt', alt);
    if (!Token)
        return;
    const textToken = makeElementToken(Token, 'text', '', 0);
    textToken.content = alt;
    token.children = [textToken];
}
function findFigureAttrs(token, Token, figureKind = DEFAULT_FIGURE_KIND) {
    for (const child of token?.children || []) {
        if (child.type === 'image') {
            const metadata = parseEquationCitatorFigureLabel(child.content || child.attrGet('alt') || '');
            if (!metadata)
                continue;
            if (metadata.width)
                child.attrSet('width', metadata.width);
            const alt = metadata.label || metadata.title || metadata.desc || metadata.tag;
            if (alt)
                setImageTokenAlt(child, alt, Token);
            return figureAttrsFromMetadata(metadata, figureKind);
        }
        if (child.type === 'html_inline') {
            const image = htmlImageTokenFromInlineHtml(child, Token);
            if (!image)
                continue;
            child.type = image.type;
            child.tag = image.tag;
            child.nesting = image.nesting;
            child.content = image.content;
            child.children = image.children;
            child.attrSet('src', image.attrGet('src') || '');
            child.attrSet('alt', image.attrGet('alt') || '');
            if (image.attrGet('title'))
                child.attrSet('title', image.attrGet('title') || '');
            if (image.attrGet('width'))
                child.attrSet('width', image.attrGet('width') || '');
            const metadata = parseEquationCitatorFigureLabel(image.content);
            if (!metadata)
                continue;
            const alt = metadata.label || metadata.title || metadata.desc || metadata.tag;
            if (alt)
                setImageTokenAlt(child, alt, Token);
            return figureAttrsFromMetadata(metadata, figureKind);
        }
    }
    return null;
}
function figureWrapEnd(tokens, imageOpenIndex) {
    let end = imageOpenIndex + 3;
    let cursor = end;
    while (cursor < tokens.length) {
        const inline = paragraphInlineAt(tokens, cursor);
        if (inline &&
            (tokenContainsClass(inline, 'ec-pdf-figure-title-marker') ||
                tokenContainsClass(inline, 'ec-pdf-figure-desc-marker'))) {
            end = cursor + 3;
            cursor = end;
            continue;
        }
        break;
    }
    return end;
}
function wrapExportedFigure(tokens, markerOpenIndex, attrs, Token) {
    const markerInline = paragraphInlineAt(tokens, markerOpenIndex);
    if (isFigureImageToken(markerInline)) {
        removeEquationCitatorMarker(markerInline);
        const end = figureWrapEnd(tokens, markerOpenIndex);
        const figureOpen = makeElementToken(Token, 'equation_citator_figure_open', 'figure', 1);
        const figureClose = makeElementToken(Token, 'equation_citator_figure_close', 'figure', -1);
        addMarkerAttrs(figureOpen, attrs, 'equation-citator-figure-wrapper');
        const wrapped = [
            figureOpen,
            ...tokens.slice(markerOpenIndex, end),
            figureClose
        ];
        tokens.splice(markerOpenIndex, end - markerOpenIndex, ...wrapped);
        return wrapped.length;
    }
    const imageInline = paragraphInlineAt(tokens, markerOpenIndex + 3);
    if (!isFigureImageToken(imageInline))
        return 0;
    const start = markerOpenIndex + 3;
    const end = figureWrapEnd(tokens, start);
    const figureOpen = makeElementToken(Token, 'equation_citator_figure_open', 'figure', 1);
    const figureClose = makeElementToken(Token, 'equation_citator_figure_close', 'figure', -1);
    addMarkerAttrs(figureOpen, attrs, 'equation-citator-figure-wrapper');
    const wrapped = [
        figureOpen,
        ...tokens.slice(start, end),
        figureClose
    ];
    tokens.splice(markerOpenIndex, end - markerOpenIndex, ...wrapped);
    return wrapped.length;
}
function wrapParsedFigure(tokens, imageOpenIndex, attrs, Token) {
    const imageInline = paragraphInlineAt(tokens, imageOpenIndex);
    if (!isFigureImageToken(imageInline))
        return 0;
    const end = figureWrapEnd(tokens, imageOpenIndex);
    const figureOpen = makeElementToken(Token, 'equation_citator_figure_open', 'figure', 1);
    const figureClose = makeElementToken(Token, 'equation_citator_figure_close', 'figure', -1);
    addMarkerAttrs(figureOpen, attrs, 'equation-citator-figure-wrapper');
    const wrapped = [
        figureOpen,
        ...tokens.slice(imageOpenIndex, end),
        figureClose
    ];
    tokens.splice(imageOpenIndex, end - imageOpenIndex, ...wrapped);
    return wrapped.length;
}
function wrapExportedCallout(tokens, markerOpenIndex, attrs) {
    for (let index = markerOpenIndex - 1; index >= 0; index -= 1) {
        const token = tokens[index];
        if (token.type === 'blockquote_close')
            return false;
        if (token.type !== 'blockquote_open')
            continue;
        const kind = (attrs['data-ec-kind'] || '').toLowerCase();
        if (kind) {
            attrs['data-callout-type'] = kind;
            token.attrJoin('class', `callout callout-${kind}`);
        }
        token.attrJoin('class', 'ec-callout');
        addMarkerAttrs(token, attrs, 'equation-citator-callout-wrapper');
        removeParagraphAt(tokens, markerOpenIndex);
        return true;
    }
    return false;
}
function stripCalloutLabel(content = '') {
    const parsed = parseCalloutPrefix(content);
    if (!parsed)
        return content;
    const source = String(content);
    const leading = source.length - source.trimStart().length;
    const close = source.indexOf(']', leading);
    if (close < 0)
        return content;
    return source.slice(close + 1).trimStart();
}
function removeCalloutLabel(inline, Token) {
    const updated = stripCalloutLabel(inline.content);
    inline.content = updated;
    let labelRemoved = false;
    const children = [];
    for (const child of inline.children || []) {
        if (!labelRemoved && child.type === 'text') {
            const nextContent = stripCalloutLabel(child.content);
            labelRemoved = nextContent !== child.content;
            if (nextContent) {
                child.content = nextContent;
                children.push(child);
            }
            continue;
        }
        children.push(child);
    }
    if (!labelRemoved && updated) {
        const textToken = makeElementToken(Token, 'text', '', 0);
        textToken.content = updated;
        children.push(textToken);
    }
    inline.children = children;
}
function wrapParsedCallout(tokens, blockquoteOpenIndex, Token) {
    if (tokens[blockquoteOpenIndex]?.type !== 'blockquote_open')
        return false;
    const inline = paragraphInlineAt(tokens, blockquoteOpenIndex + 1);
    const parsed = parseEquationCitatorCalloutLabel(inline?.content);
    if (!parsed)
        return false;
    addMarkerAttrs(tokens[blockquoteOpenIndex], parsed.attrs, 'equation-citator-callout-wrapper');
    removeCalloutLabel(inline, Token);
    if (!inline.content.trim() && !(inline.children || []).length) {
        removeParagraphAt(tokens, blockquoteOpenIndex + 1);
    }
    else {
        tokens[blockquoteOpenIndex].attrSet('data-callout-has-title', '');
    }
    return true;
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
};
function parseObsidianCalloutLabel(raw = '') {
    const parsed = parseCalloutPrefix(raw);
    if (!parsed)
        return null;
    if (parsed.marker.includes(':') || parsed.marker.includes('|'))
        return null;
    const type = parsed.marker.toLowerCase();
    const def = OBSIDIAN_CALLOUT_TYPES[type];
    if (!def)
        return null;
    return { type, title: parsed.title.trim() || def.title };
}
function isEquationCitatorCallout(raw = '') {
    return parseEquationCitatorCalloutLabel(raw) !== null;
}
function wrapObsidianCallouts(md, options) {
    md.core.ruler.after('block', 'obsidian-callouts', (state) => {
        if (!shouldProcess(state, options))
            return;
        const { tokens, Token } = state;
        for (let index = 0; index < tokens.length; index += 1) {
            if (tokens[index]?.type !== 'blockquote_open')
                continue;
            const inline = paragraphInlineAt(tokens, index + 1);
            if (!inline)
                continue;
            if (isEquationCitatorCallout(inline.content))
                continue;
            const parsed = parseObsidianCalloutLabel(inline.content);
            if (!parsed)
                continue;
            tokens[index].attrJoin('class', `callout callout-${parsed.type}`);
            tokens[index].attrSet('data-callout-type', parsed.type);
            removeCalloutLabel(inline, Token);
            inline.children = [];
            if (inline.content.trim()) {
                tokens[index].attrSet('data-callout-has-title', '');
            }
            else {
                removeParagraphAt(tokens, index + 1);
            }
        }
    });
}
function wrapEquationCitatorExports(md, options) {
    md.core.ruler.after('inline', 'equation-citator-exports', (state) => {
        if (!shouldProcess(state, options))
            return;
        const { tokens, Token } = state;
        const figureKind = configuredFigureKind(options);
        const calloutKinds = configuredCalloutKinds(options);
        const nonCalloutKinds = configuredNonCalloutKinds(options);
        for (let index = 0; index < tokens.length; index += 1) {
            if (wrapParsedCallout(tokens, index, Token)) {
                continue;
            }
            const inline = paragraphInlineAt(tokens, index);
            const marker = findEquationCitatorMarker(inline);
            if (marker) {
                const markerKind = normalizeKind(marker['data-ec-kind']);
                if (markerKind === figureKind) {
                    const consumed = wrapExportedFigure(tokens, index, marker, Token);
                    if (consumed) {
                        index += consumed - 1;
                        continue;
                    }
                }
                const isCalloutMarker = (marker.class || '').split(' ').includes(EQUATION_CALLOUT_CLASS) ||
                    calloutKinds.has(markerKind) ||
                    !nonCalloutKinds.has(markerKind);
                if (isCalloutMarker && wrapExportedCallout(tokens, index, marker)) {
                    index -= 1;
                    continue;
                }
            }
            const figureAttrs = findFigureAttrs(inline, Token, figureKind);
            if (figureAttrs) {
                const consumed = wrapParsedFigure(tokens, index, figureAttrs, Token);
                if (consumed)
                    index += consumed - 1;
            }
        }
    });
}
function wrapFigureCaptions(md) {
    md.renderer.rules.equation_citator_figure_close = (tokens, idx) => {
        let title = '';
        let desc = '';
        for (let i = idx; i >= 0; i -= 1) {
            if (tokens[i].type === 'equation_citator_figure_open') {
                title = tokens[i].attrGet('data-title') || '';
                desc = tokens[i].attrGet('data-desc') || '';
                break;
            }
        }
        let caption = '';
        if (title || desc) {
            caption = '<figcaption class="figure-caption">';
            if (title)
                caption += `<span class="figure-title">${md.utils.escapeHtml(title)}</span>`;
            if (desc)
                caption += `<span class="figure-desc">${md.utils.escapeHtml(desc)}</span>`;
            caption += '</figcaption>';
        }
        return `${caption}</figure>`;
    };
}
function wrapEquationBlocks(md, options) {
    const renderMathBlock = md.renderer.rules.math_block;
    if (!renderMathBlock)
        return;
    md.renderer.rules.math_block = (tokens, idx, markdownOptions, env, self) => {
        const rendered = renderMathBlock(tokens, idx, markdownOptions, env, self);
        const stateLike = { env };
        if (!shouldProcess(stateLike, options))
            return rendered;
        const equationKind = escapeHtmlAttribute(configuredEquationKind(options));
        return `<div class="equation-citator-target equation-citator-equation" data-ec-kind="${equationKind}" ${equationTagAttribute(tokens[idx].content)}>${rendered}</div>`;
    };
}
export function equationCitatorMarkdownIt(md, options = {}) {
    const normalizedOptions = {
        equationKind: DEFAULT_EQUATION_KIND,
        figureKind: DEFAULT_FIGURE_KIND,
        calloutKinds: DEFAULT_CALLOUT_KINDS,
        enableEquationTargets: true,
        enableFigureTargets: true,
        enableCalloutTargets: true,
        enableFigureCaptions: true,
        enableObsidianCallouts: false,
        ...options
    };
    if (normalizedOptions.enableObsidianCallouts) {
        wrapObsidianCallouts(md, normalizedOptions);
    }
    if (normalizedOptions.enableFigureCaptions) {
        wrapFigureCaptions(md);
    }
    if (normalizedOptions.enableEquationTargets) {
        wrapEquationBlocks(md, normalizedOptions);
    }
    if (normalizedOptions.enableFigureTargets || normalizedOptions.enableCalloutTargets) {
        wrapEquationCitatorExports(md, normalizedOptions);
    }
}
export default equationCitatorMarkdownIt;
//# sourceMappingURL=markdown-it.js.map