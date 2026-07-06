const CITATION_SELECTOR = '.equation-citator-citation[data-ec-kind][data-ec-refs]'
const TARGET_SELECTOR = '.equation-citator-target[data-ec-kind]'
const STYLE_ID = 'equation-citator-theme-module-style'
const CLEANUP_KEY = '__equationCitatorThemeCleanup'

const pageCache = new Map()
let pathMappings = []

let popover = null
let activeCitation = null
let hideTimer = 0
let hoverToken = 0

// Preview panel state
let previewTargets = []          // resolved targets for the active citation
let previewIndex = 0             // which target the iframe is currently showing
let previewLoadingFrame = null   // hidden iframe used by fetchPageDynamically

function normalizePathMappings(mappings = []) {
  return Array.isArray(mappings)
    ? mappings.filter((mapping) => mapping?.urlPattern && mapping?.baseUrl)
    : []
}

function escapeCssValue(value = '') {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value)
  }

  return String(value).replace(/["\\]/g, '\\$&')
}

function slugPart(value = '') {
  const slug = String(value)
    .trim()
    .toLowerCase()
    .replace(/&amp;/g, 'and')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return slug || 'target'
}

function hashString(value = '') {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }

  return (hash >>> 0).toString(36)
}

function targetTag(target) {
  return (target?.dataset?.ecTag || target?.dataset?.tag || '').trim()
}

function normalizedEquationTag(tag) {
  return String(tag || '').trim().replace(/^eq:/i, '')
}

function kindsMatch(citationKind, targetKind) {
  return String(citationKind || '').trim().toLowerCase() ===
    String(targetKind || '').trim().toLowerCase()
}

function tagsMatch(kind, citationTag, targetTagValue) {
  if (targetTagValue === citationTag) return true

  return String(kind || '').trim().toLowerCase() === 'eq' &&
    normalizedEquationTag(targetTagValue) === normalizedEquationTag(citationTag)
}

function targetIdTag(kind, tag) {
  if (String(kind || '').trim().toLowerCase() === 'eq') {
    return normalizedEquationTag(tag)
  }

  return tag
}

function stableTargetId(kind, tag) {
  return `equation-citator-${slugPart(kind)}-${slugPart(targetIdTag(kind, tag))}`
}

function legacyStableTargetId(kind, tag) {
  return `equation-citator-${slugPart(kind)}-${slugPart(tag)}`
}

function elementOwnerDocument(element) {
  return element?.ownerDocument || document
}

function ensureTargetId(target, kind, tag) {
  const ownerDocument = elementOwnerDocument(target)
  const baseId = stableTargetId(kind, tag)
  const legacyId = legacyStableTargetId(kind, tag)

  if (target.id && target.id !== legacyId) return target.id

  const existing = ownerDocument.getElementById(baseId)
  if (!existing || existing === target) {
    target.id = baseId
    return target.id
  }

  const fallbackId = `${baseId}-${hashString(target.textContent || target.outerHTML || tag)}`
  const fallbackExisting = ownerDocument.getElementById(fallbackId)
  if (!fallbackExisting || fallbackExisting === target) {
    target.id = fallbackId
    return target.id
  }

  let index = 2
  while (ownerDocument.getElementById(`${fallbackId}-${index}`)) index += 1
  target.id = `${fallbackId}-${index}`
  return target.id
}

function assignStableTargetIds(root = document) {
  root.querySelectorAll(TARGET_SELECTOR).forEach((target) => {
    if (target.closest('.equation-citator-preview')) return

    const tag = targetTag(target)
    if (!tag) return

    ensureTargetId(target, target.dataset.ecKind, tag)
  })
}

function parseRefs(citation) {
  try {
    const refs = JSON.parse(citation.dataset.ecRefs || '[]')
    return Array.isArray(refs) ? refs : []
  } catch {
    return []
  }
}

function findMatchingTarget(root, kind, tag) {
  const wantedTag = String(tag || '').trim()
  if (!wantedTag) return null

  return [...root.querySelectorAll(TARGET_SELECTOR)].find((target) =>
    kindsMatch(kind, target.dataset.ecKind) &&
    tagsMatch(kind, wantedTag, targetTag(target))
  ) || null
}

function footnoteIdCandidates(fileId) {
  const normalized = String(fileId || '').trim()
  if (!normalized) return []

  return [
    `fn${normalized}`,
    `fn-${normalized}`,
    `fn:${normalized}`,
    normalized
  ]
}

function findFootnoteDefinition(root, fileId) {
  for (const id of footnoteIdCandidates(fileId)) {
    const found = root.getElementById(id)
    if (found) return found
  }

  const escaped = escapeCssValue(String(fileId || '').trim())
  return root.querySelector(
    `.footnotes li[id$="${escaped}"], .footnote-item[id$="${escaped}"], li[id$="${escaped}"]`
  )
}

function hrefLooksLikeKnowledgeBase(href = '') {
  try {
    const url = new URL(href, window.location.href)
    if (url.origin !== window.location.origin) return false
    return pathMappings.some(({ urlPattern }) => url.pathname.includes(urlPattern))
  } catch {
    return false
  }
}

function definitionKnowledgeBaseHref(definition) {
  if (!definition) return ''

  const links = [...definition.querySelectorAll('a[href]')]
  const link = links.find((candidate) => {
    const href = candidate.getAttribute('href') || ''
    if (!href || href.startsWith('#')) return false
    if (candidate.classList.contains('footnote-backref')) return false

    return hrefLooksLikeKnowledgeBase(href)
  })

  return link?.getAttribute('href') || ''
}

// Build a URL path from a route-path string.
// Encodes each segment individually so special characters are safe.
function encodedRoutePath(routePath) {
  return `/${String(routePath || '')
    .replace(/^\/+/, '')
    .split('/')
    .map((part) => encodeURIComponent(decodeURIComponent(part)))
    .join('/')}`
}

function currentPageDirectoryPath() {
  const pathname = decodeURIComponent(window.location.pathname)
    .replace(/\/index\.html$/i, '/')
    .replace(/\.html$/i, '')

  return pathname.endsWith('/')
    ? pathname.replace(/\/$/, '')
    : pathname.replace(/\/[^/]*$/, '')
}

function resolveFileUrlCandidates(filePath) {
  const cleaned = String(filePath || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.?\//, '')
    .replace(/\.md$/i, '')
  if (!cleaned) return []

  const currentPathname = window.location.pathname
  const candidates = []
  const addCandidate = (routePath) => {
    if (!routePath) return
    candidates.push(encodedRoutePath(routePath.replace(/\/+/g, '/')))
  }

  // Collect candidates from every matching path mapping
  for (const { urlPattern, baseUrl } of pathMappings) {
    if (currentPathname.includes(urlPattern)) {
      const base = String(baseUrl || '').replace(/\/+$/, '')
      addCandidate(`${base}/${cleaned}`)
    }
  }

  // Also try the cleaned path as-is (covers the case where the file path
  // already starts with a known prefix)
  if (!candidates.length || cleaned.includes('/')) {
    addCandidate(cleaned)
  }

  // Fallback: relative to the current page's directory.
  // Avoid duplicating a shared prefix (e.g. current dir is
  // /kb/Equation-Citator-Tutorial and cleaned already starts with
  const pageDir = currentPageDirectoryPath()
  if (pageDir) {
    const dirLast = pageDir.split('/').pop() || ''
    const fallbackRel = dirLast && cleaned.startsWith(`${dirLast}/`)
      ? cleaned.slice(dirLast.length + 1)
      : cleaned
    addCandidate(`${pageDir}/${fallbackRel}`)
  }

  return [...new Set(candidates)]
}

function resolveFileUrl(filePath) {
  return resolveFileUrlCandidates(filePath)[0] || ''
}

function resolveFootnoteHref(citation, fileId) {
  const definition = findFootnoteDefinition(document, fileId)
  const href = definitionKnowledgeBaseHref(definition)
  if (href) return href

  // Fallback: look for a footnote ref immediately after the citation element
  const nearbyRef = citation.nextElementSibling?.matches?.('.footnote-ref, sup')
    ? citation.nextElementSibling.querySelector('a[href^="#"]')
    : null
  const targetId = nearbyRef?.getAttribute('href')?.slice(1)
  const nearbyDefinition = targetId ? document.getElementById(decodeURIComponent(targetId)) : null
  const nearbyHref = definitionKnowledgeBaseHref(nearbyDefinition)
  if (nearbyHref) return nearbyHref

  console.warn(
    '[equation-citator] resolveFootnoteHref failed:',
    `footnoteId="${fileId}"`,
    `| definition found by ID: ${definition ? 'yes' : 'no'}`,
    `| definition had KB link: ${href ? 'yes' : 'no'}`,
    `| nearbyRef found: ${nearbyRef ? 'yes' : 'no'}`,
    `| nearbyDefinition found: ${nearbyDefinition ? 'yes' : 'no'}`,
    `| nearbyDefinition had KB link: ${nearbyHref ? 'yes' : 'no'}`,
    `| Citation next sibling:`,
    citation.nextElementSibling
  )
  return ''
}


function fetchPageDynamically(href) {
  return new Promise((resolve) => {
    const iframe = document.createElement('iframe')
    iframe.style.position = 'absolute'
    iframe.style.width = '0'
    iframe.style.height = '0'
    iframe.style.border = 'none'
    iframe.style.visibility = 'hidden'
    iframe.src = href

    iframe.onload = () => {
      try {
        const iframeDoc = iframe.contentDocument || iframe.contentWindow.document

        // Poll briefly for VitePress to finish client-side hydration
        const checkRendered = setInterval(() => {
          const appContainer = iframeDoc.getElementById('app')

          if (appContainer && appContainer.children.length > 0) {
            clearInterval(checkRendered)
            assignStableTargetIds(iframeDoc)
            resolve({
              document: iframeDoc,
              url: iframe.contentWindow.location.href,
              cleanup: () => iframe.remove()
            })
          }
        }, 50)

        // Fallback timeout if rendering doesn't complete
        setTimeout(() => {
          clearInterval(checkRendered)
          resolve({
            document: iframeDoc,
            url: href,
            cleanup: () => iframe.remove()
          })
        }, 2000)

      } catch (err) {
        console.error('[equation-citator] Failed to read iframe contents:', err)
        iframe.remove()
        resolve(null)
      }
    }

    document.body.appendChild(iframe)
  })
}

async function fetchPage(href) {
  const cacheKey = new URL(href, window.location.href).href.replace(/#.*$/, '')
  if (pageCache.has(cacheKey)) return pageCache.get(cacheKey)

  const promise = fetchPageDynamically(href)
  pageCache.set(cacheKey, promise)
  return promise
}


async function resolveTargets(citation, stopAfterFirst = false) {
  const kind = citation.dataset.ecKind
  const refs = parseRefs(citation)
  const resolved = []

  for (const ref of refs) {
    const tag = String(ref?.tag || '').trim()
    if (!tag) continue

    if (!ref.file) {
      const target = findMatchingTarget(document, kind, tag)
      if (target) {
        resolved.push({
          kind,
          tag,
          target,
          url: window.location.href.replace(/#.*$/, '')
        })
        if (stopAfterFirst) return resolved
      } else {
        console.warn(
          '[equation-citator] Same-page target not found:',
          `kind="${kind}", tag="${tag}"`,
          `| Current page: ${window.location.href}`
        )
      }

      continue
    }

    // Build the target page URL directly from the relative file path.
    const hrefs = resolveFileUrlCandidates(ref.file)
    if (!hrefs.length) {
      const footnoteId = ref.crossFile;
      const href = resolveFootnoteHref(citation, footnoteId)
      if (href) hrefs.push(href)
    }

    if (!hrefs.length) {
      const refsDebug = JSON.stringify({ file: ref.file, crossFile: ref.crossFile, tag })
      console.warn(
        '[equation-citator] Could not resolve target URL for cross-file citation:',
        `kind="${kind}", tag="${tag}"`,
        `| ref data: ${refsDebug}`,
        `| direct URL from file path: "${resolveFileUrl(ref.file)}"`,
        `| Citation element:`,
        citation
      )
      continue
    }

    let fetchedAnyPage = false
    let foundTarget = false

    for (const href of hrefs) {
      const page = await fetchPage(href)
      if (!page) {
        console.warn(
          '[equation-citator] Failed to fetch target page for cross-file citation:',
          `kind="${kind}", tag="${tag}"`,
          `| href: "${href}"`
        )
        continue
      }
      fetchedAnyPage = true

      const target = findMatchingTarget(page.document, kind, tag)
      if (target) {
        foundTarget = true
        resolved.push({
          kind,
          tag,
          target,
          samePage: false,
          url: page.url
        })
        if (stopAfterFirst) return resolved
        break
      }

      console.warn(
        '[equation-citator] Target not found on fetched page:',
        `kind="${kind}", tag="${tag}"`,
        `| Fetched page: ${page.url}`,
        `| Available targets on page:`,
        [...page.document.querySelectorAll('[data-ec-kind]')].map((el) => ({
          kind: el.dataset.ecKind,
          tag: el.dataset.ecTag || el.dataset.tag,
          id: el.id
        }))
      )
    }

    if (!fetchedAnyPage) {
      console.warn(
        '[equation-citator] Failed to fetch target page for cross-file citation:',
        `kind="${kind}", tag="${tag}"`,
        `| href candidates: ${hrefs.map((href) => `"${href}"`).join(', ')}`
      )
      continue
    }

    if (!foundTarget) {
      const footnoteId = ref.crossFile || ref.file
      const href = resolveFootnoteHref(citation, footnoteId)
      if (href && !hrefs.includes(href)) {
        const page = await fetchPage(href)
        const target = page ? findMatchingTarget(page.document, kind, tag) : null
        if (target) {
          resolved.push({
            kind,
            tag,
            target,
            samePage: false,
            url: page.url
          })
          if (stopAfterFirst) return resolved
        }
      }
    }
  }

  return resolved
}


function ensurePopover() {
  if (popover) return popover

  popover = document.createElement('div')
  popover.classList.add('equation-citator-preview')
  popover.setAttribute('role', 'tooltip')
  popover.hidden = true
  popover.addEventListener('mouseenter', () => {
    window.clearTimeout(hideTimer)
  })
  popover.addEventListener('mouseleave', scheduleHide)
  document.body.appendChild(popover)

  return popover
}

function positionPopover(anchor) {
  const popoverElement = ensurePopover()
  const anchorRect = anchor.getBoundingClientRect()
  const margin = 12
  const width = Math.min(560, window.innerWidth - margin * 2)

  popoverElement.style.maxWidth = `${width}px`
  popoverElement.hidden = false

  const popoverRect = popoverElement.getBoundingClientRect()
  let top = anchorRect.bottom + margin
  if (top + popoverRect.height > window.innerHeight - margin) {
    top = anchorRect.top - popoverRect.height - margin
  }
  if (top < margin) top = margin

  let left = anchorRect.left
  if (left + popoverRect.width > window.innerWidth - margin) {
    left = window.innerWidth - popoverRect.width - margin
  }
  if (left < margin) left = margin

  popoverElement.style.top = `${top}px`
  popoverElement.style.left = `${left}px`
}

function ensurePreviewIframe() {
  return ensurePreviewShell().iframe
}

function previewKindLabel(kind = '') {
  const normalized = String(kind || '').trim().toLowerCase()
  const labels = {
    eq: 'Equation',
    fig: 'Figure',
    table: 'Table',
    thm: 'Theorem',
    theorem: 'Theorem',
    lemma: 'Lemma',
    def: 'Definition',
    definition: 'Definition',
    prop: 'Proposition',
    proposition: 'Proposition',
    cor: 'Corollary',
    corollary: 'Corollary'
  }

  return labels[normalized] || (normalized ? normalized[0].toUpperCase() + normalized.slice(1) : 'Citation')
}

function previewTitle(resolved) {
  if (!resolved) return 'Citation preview'

  const tag = String(resolved.tag || '').trim()
  const label = previewKindLabel(resolved.kind)
  return tag ? `${label} ${tag}` : `${label} preview`
}

function ensurePreviewShell() {
  const el = ensurePopover()
  let header = el.querySelector('.ec-preview-header')
  let titleRow = el.querySelector('.ec-preview-title-row')
  let title = el.querySelector('.ec-preview-title')
  let counter = el.querySelector('.ec-preview-counter')
  let actions = el.querySelector('.ec-preview-actions')
  let prev = el.querySelector('.ec-preview-arrow.ec-preview-prev')
  let next = el.querySelector('.ec-preview-arrow.ec-preview-next')
  let jump = el.querySelector('.ec-preview-jump')
  let body = el.querySelector('.ec-preview-body')
  let iframe = el.querySelector('.equation-citator-preview-iframe')

  if (!header) {
    header = document.createElement('div')
    header.className = 'ec-preview-header'
    el.appendChild(header)
  }

  if (!titleRow) {
    titleRow = document.createElement('div')
    titleRow.className = 'ec-preview-title-row'
    header.appendChild(titleRow)
  }

  if (!title) {
    title = document.createElement('span')
    title.className = 'ec-preview-title'
    titleRow.appendChild(title)
  }

  if (!counter) {
    counter = document.createElement('span')
    counter.className = 'ec-preview-counter'
    titleRow.appendChild(counter)
  }

  if (!actions) {
    actions = document.createElement('div')
    actions.className = 'ec-preview-actions'
    header.appendChild(actions)
  }

  if (!prev) {
    prev = document.createElement('button')
    prev.className = 'ec-preview-arrow ec-preview-prev'
    prev.setAttribute('aria-label', 'Previous citation')
    prev.type = 'button'
    prev.textContent = '<'
    prev.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      navigatePreview(-1)
    })
  }
  actions.appendChild(prev)

  if (!next) {
    next = document.createElement('button')
    next.className = 'ec-preview-arrow ec-preview-next'
    next.setAttribute('aria-label', 'Next citation')
    next.type = 'button'
    next.textContent = '>'
    next.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      navigatePreview(1)
    })
  }
  actions.appendChild(next)

  if (!jump) {
    jump = document.createElement('button')
    jump.className = 'ec-preview-jump'
    jump.type = 'button'
    jump.innerHTML = '&nearr;'
    jump.title = 'Open target. Ctrl/Cmd-click opens in a new tab.'
    jump.setAttribute('aria-label', 'Open citation target')
    jump.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      openActivePreviewTarget(e)
    })
    jump.addEventListener('auxclick', (e) => {
      if (e.button !== 1) return
      e.preventDefault()
      e.stopPropagation()
      openActivePreviewTarget(e)
    })
  }

  if (!body) {
    body = document.createElement('div')
    body.className = 'ec-preview-body'
    el.appendChild(body)
  }

  if (!iframe) {
    iframe = document.createElement('iframe')
    iframe.className = 'equation-citator-preview-iframe'
    iframe.setAttribute('tabindex', '-1')
    iframe.setAttribute('aria-hidden', 'true')
    body.appendChild(iframe)
  } else if (iframe.parentElement !== body) {
    body.appendChild(iframe)
  }

  body.appendChild(jump)

  return { prev, next, counter, title, jump, iframe }
}

function ensureNavControls() {
  return ensurePreviewShell()
}

function updateNavControls() {
  const { prev, next, counter, title, jump } = ensureNavControls()
  const count = previewTargets.length
  const show = count > 1
  const activeTarget = previewTargets[previewIndex]

  prev.hidden = !show
  next.hidden = !show
  counter.hidden = !show
  jump.disabled = !activeTarget
  title.textContent = previewTitle(activeTarget)

  if (show) {
    counter.textContent = `(${previewIndex + 1} of ${count})`
  } else {
    counter.textContent = ''
  }
}

function navigatePreview(delta) {
  const count = previewTargets.length
  if (count < 2) return

  previewIndex = (previewIndex + delta + count) % count
  loadPreviewTarget(previewTargets[previewIndex])
  updateNavControls()
}

function buildPreviewUrl(resolved) {
  const targetId = ensureTargetId(resolved.target, resolved.kind, resolved.tag)
  const targetUrl = new URL(resolved.url, window.location.href)
  targetUrl.hash = targetId
  return targetUrl.href
}

function openActivePreviewTarget(event = {}) {
  const resolved = previewTargets[previewIndex]
  if (!resolved) return

  const targetHref = buildPreviewUrl(resolved)
  const openInNewTab = event.ctrlKey || event.metaKey || event.button === 1

  if (openInNewTab) {
    window.open(targetHref, '_blank', 'noopener')
    return
  }

  const targetUrl = new URL(targetHref, window.location.href)
  const currentUrl = new URL(window.location.href)
  if (
    targetUrl.origin === currentUrl.origin &&
    targetUrl.pathname === currentUrl.pathname &&
    targetUrl.search === currentUrl.search
  ) {
    window.location.hash = targetUrl.hash
    refreshTargetsAndScrollToHash()
  } else {
    window.location.href = targetHref
  }

  hidePopover()
}

function applyPreviewIframeStyles(iframeDocument) {
  let style = iframeDocument.getElementById('equation-citator-preview-iframe-style')
  if (!style) {
    style = iframeDocument.createElement('style')
    style.id = 'equation-citator-preview-iframe-style'
    iframeDocument.head.appendChild(style)
  }

  style.textContent = `
    html,
    body {
      background: var(--vp-c-bg) !important;
      overscroll-behavior: contain;
    }

    .VPNav,
    .VPLocalNav,
    .VPSidebar,
    .VPDocAside,
    .VPFooter,
    .VPDocFooter,
    .prev-next {
      display: none !important;
    }

    .Layout,
    .VPContent,
    .VPDoc {
      min-height: auto !important;
      padding: 0 !important;
    }

    .VPDoc .container,
    .VPDoc .content,
    .VPDoc .content-container,
    .VPDoc .main {
      max-width: none !important;
      margin: 0 !important;
      padding: 0 !important;
    }

    .vp-doc {
      max-width: none !important;
      padding: 18px 20px 28px !important;
    }

    .vp-doc h1,
    .vp-doc h2,
    .vp-doc h3 {
      font-size: 15px !important;
      line-height: 1.35 !important;
    }

    .equation-citator-preview-current,
    .equation-citator-target:target {
      border-radius: 8px;
      outline: 2px solid color-mix(in srgb, var(--vp-c-brand-1) 34%, transparent);
      outline-offset: 6px;
      background: color-mix(in srgb, var(--vp-c-brand-1) 5%, transparent);
    }
  `
}

function suppressPreviewIframeEvents(iframeDocument) {
  if (iframeDocument.__equationCitatorPreviewEventsBlocked) return
  iframeDocument.__equationCitatorPreviewEventsBlocked = true

  const blockEvent = (event) => {
    event.preventDefault()
    event.stopPropagation()
  }

  ;['click', 'dblclick', 'auxclick', 'mousedown', 'mouseup', 'mouseover'].forEach((type) => {
    iframeDocument.addEventListener(type, blockEvent, true)
  })
}

function preparePreviewIframe(iframe, resolved) {
  const run = () => {
    try {
      const iframeDocument = iframe.contentDocument || iframe.contentWindow?.document
      if (!iframeDocument) return false

      applyPreviewIframeStyles(iframeDocument)
      suppressPreviewIframeEvents(iframeDocument)
      assignStableTargetIds(iframeDocument)

      iframeDocument
        .querySelectorAll('.equation-citator-preview-current')
        .forEach((target) => target.classList.remove('equation-citator-preview-current'))

      const target = findMatchingTarget(iframeDocument, resolved.kind, resolved.tag)
      if (!target) return false

      ensureTargetId(target, resolved.kind, resolved.tag)
      target.classList.add('equation-citator-preview-current')
      target.scrollIntoView({ block: 'center', inline: 'nearest' })
      return true
    } catch (err) {
      console.warn('[equation-citator] Failed to prepare preview iframe:', err)
      return true
    }
  }

  if (run()) return
  ;[120, 360, 800].forEach((delay) => {
    window.setTimeout(run, delay)
  })
}

function loadPreviewTarget(resolved) {
  const iframe = ensurePreviewIframe()
  iframe.onload = () => preparePreviewIframe(iframe, resolved)
  iframe.src = buildPreviewUrl(resolved)
  window.setTimeout(() => preparePreviewIframe(iframe, resolved), 120)
}

function renderPreviewPanel(citation, resolvedTargets) {
  previewTargets = resolvedTargets
  previewIndex = 0

  const popoverElement = ensurePopover()
  popoverElement.className = 'equation-citator-preview'

  ensurePreviewShell()

  loadPreviewTarget(resolvedTargets[0])
  updateNavControls()
  positionPopover(citation)
}

function renderEmpty(citation) {
  const popoverElement = ensurePopover()
  popoverElement.className = 'equation-citator-preview is-empty'
  popoverElement.textContent = 'No matching citation target found.'
  positionPopover(citation)
}

function showLoadingState(citation) {
  const popoverElement = ensurePopover()
  popoverElement.className = 'equation-citator-preview is-loading'
  popoverElement.hidden = true
}


async function showForCitation(citation) {
  const token = ++hoverToken
  activeCitation = citation
  window.clearTimeout(hideTimer)
  showLoadingState(citation)

  const resolved = await resolveTargets(citation)
  if (token !== hoverToken || activeCitation !== citation) return

  if (!resolved.length) {
    renderEmpty(citation)
    return
  }

  renderPreviewPanel(citation, resolved)
}

function hidePopover() {
  activeCitation = null
  hoverToken += 1
  previewTargets = []
  previewIndex = 0

  if (popover) popover.hidden = true
}

function scheduleHide() {
  window.clearTimeout(hideTimer)
  hideTimer = window.setTimeout(hidePopover, 120)
}


function citationFromEvent(event) {
  const target = event.target
  return target instanceof Element ? target.closest(CITATION_SELECTOR) : null
}

function onMouseOver(event) {
  const citation = citationFromEvent(event)
  if (!citation || citation === activeCitation) return
  if (citation.contains(event.relatedTarget)) return

  void showForCitation(citation)
}

function onMouseOut(event) {
  const citation = citationFromEvent(event)
  if (!citation || citation.contains(event.relatedTarget)) return

  scheduleHide()
}


function scrollToCurrentHash() {
  if (!window.location.hash) return

  const target = document.getElementById(decodeURIComponent(window.location.hash.slice(1)))
  if (!target) return

  window.requestAnimationFrame(() => {
    target.scrollIntoView({ block: 'start' })
  })
}

function refreshTargets() {
  assignStableTargetIds(document)
}

function refreshTargetsAndScrollToHash() {
  refreshTargets()
  scrollToCurrentHash()
}

export function installEquationCitatorPreviews({ router, pathMappings: configuredPathMappings = [] } = {}) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return

  window[CLEANUP_KEY]?.()
  pathMappings = normalizePathMappings(configuredPathMappings)
  refreshTargetsAndScrollToHash()
  
  document.addEventListener('mouseover', onMouseOver)
  document.addEventListener('mouseout', onMouseOut)
  window.addEventListener('scroll', scheduleHide, { passive: true })
  window.addEventListener('resize', scheduleHide, { passive: true })
  window.addEventListener('hashchange', refreshTargetsAndScrollToHash)

  let mutationTimer = 0
  const observer = new MutationObserver(() => {
    window.clearTimeout(mutationTimer)
    mutationTimer = window.setTimeout(refreshTargets, 50)
  })
  observer.observe(document.body, { childList: true, subtree: true })

  const previousRouteChanged = router?.onAfterRouteChanged
  if (router) {
    router.onAfterRouteChanged = (to) => {
      previousRouteChanged?.(to)
      hidePopover()
      window.setTimeout(refreshTargetsAndScrollToHash, 0)
    }
  }

  window[CLEANUP_KEY] = () => {
    document.removeEventListener('mouseover', onMouseOver)
    document.removeEventListener('mouseout', onMouseOut)
    window.removeEventListener('scroll', scheduleHide)
    window.removeEventListener('resize', scheduleHide)
    window.removeEventListener('hashchange', refreshTargetsAndScrollToHash)
    window.clearTimeout(hideTimer)
    window.clearTimeout(mutationTimer)
    observer.disconnect()

    if (router) router.onAfterRouteChanged = previousRouteChanged
    hidePopover()
    if (popover) {
      popover.remove()
      popover = null
    }
  }
}

export const install = installEquationCitatorPreviews
