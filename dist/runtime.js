const CITATION_SELECTOR = '.equation-citator-citation[data-ec-kind][data-ec-refs]';
const TARGET_SELECTOR = '.equation-citator-target[data-ec-kind]';
const CLEANUP_KEY = '__equationCitatorThemeCleanup';
const pageCache = new Map();
let popover = null;
let activeCitation = null;
let hideTimer = 0;
let hoverToken = 0;
// Preview panel state
let previewTargets = []; // resolved targets for the active citation
let previewIndex = 0; // which target the iframe is currently showing
function trimRepeatedEdges(value, edgeChar) {
    let start = 0;
    let end = value.length;
    while (start < end && value[start] === edgeChar)
        start += 1;
    while (end > start && value[end - 1] === edgeChar)
        end -= 1;
    return value.slice(start, end);
}
function removeUrlHash(value = '') {
    const hashIndex = value.indexOf('#');
    return hashIndex >= 0 ? value.slice(0, hashIndex) : value;
}
function slugPart(value = '') {
    const slug = String(value)
        .trim()
        .toLowerCase()
        .replaceAll('&amp;', 'and')
        .replaceAll('&', 'and')
        .replace(/[^a-z0-9]+/g, '-');
    return trimRepeatedEdges(slug, '-') || 'target';
}
function hashString(value = '') {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index); // nosonarjs: skip
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
}
function targetTag(target) {
    return (target?.dataset?.ecTag || target?.dataset?.tag || '').trim();
}
function normalizedEquationTag(tag) {
    return String(tag || '').trim().replace(/^eq:/i, '');
}
function kindsMatch(citationKind, targetKind) {
    return String(citationKind || '').trim().toLowerCase() ===
        String(targetKind || '').trim().toLowerCase();
}
function tagsMatch(kind, citationTag, targetTagValue) {
    if (targetTagValue === citationTag)
        return true;
    return String(kind || '').trim().toLowerCase() === 'eq' &&
        normalizedEquationTag(targetTagValue) === normalizedEquationTag(citationTag);
}
function targetIdTag(kind, tag) {
    if (String(kind || '').trim().toLowerCase() === 'eq') {
        return normalizedEquationTag(tag);
    }
    return tag;
}
function stableTargetId(kind, tag) {
    return `equation-citator-${slugPart(kind)}-${slugPart(targetIdTag(kind, tag))}`;
}
function legacyStableTargetId(kind, tag) {
    return `equation-citator-${slugPart(kind)}-${slugPart(tag)}`;
}
function elementOwnerDocument(element) {
    return element?.ownerDocument || document;
}
function ensureTargetId(target, kind, tag) {
    const ownerDocument = elementOwnerDocument(target);
    const baseId = stableTargetId(kind, tag);
    const legacyId = legacyStableTargetId(kind, tag);
    if (target.id && target.id !== legacyId)
        return target.id;
    const existing = ownerDocument.getElementById(baseId);
    if (!existing || existing === target) {
        target.id = baseId;
        return target.id;
    }
    const fallbackId = `${baseId}-${hashString(target.textContent || target.outerHTML || tag)}`;
    const fallbackExisting = ownerDocument.getElementById(fallbackId);
    if (!fallbackExisting || fallbackExisting === target) {
        target.id = fallbackId;
        return target.id;
    }
    let index = 2;
    while (ownerDocument.getElementById(`${fallbackId}-${index}`))
        index += 1;
    target.id = `${fallbackId}-${index}`;
    return target.id;
}
function assignStableTargetIds(root = document) {
    root.querySelectorAll(TARGET_SELECTOR).forEach((target) => {
        if (target.closest('.equation-citator-preview'))
            return;
        const tag = targetTag(target);
        if (!tag)
            return;
        ensureTargetId(target, target.dataset.ecKind, tag);
    });
}
function parseRefs(citation) {
    try {
        const refs = JSON.parse(citation.dataset.ecRefs || '[]');
        return Array.isArray(refs) ? refs : [];
    }
    catch {
        return [];
    }
}
function findMatchingTarget(root, kind, tag) {
    const wantedTag = String(tag || '').trim();
    if (!wantedTag)
        return null;
    return [...root.querySelectorAll(TARGET_SELECTOR)].find((target) => kindsMatch(kind, target.dataset.ecKind) &&
        tagsMatch(kind, wantedTag, targetTag(target))) || null;
}
function fetchPageDynamically(href) {
    return new Promise((resolve) => {
        const iframe = document.createElement('iframe');
        iframe.style.position = 'absolute';
        iframe.style.width = '0';
        iframe.style.height = '0';
        iframe.style.border = 'none';
        iframe.style.visibility = 'hidden';
        iframe.src = href;
        iframe.onload = () => {
            try {
                const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
                // Poll briefly for VitePress to finish client-side hydration
                const checkRendered = setInterval(() => {
                    const appContainer = iframeDoc.getElementById('app');
                    if (appContainer && appContainer.children.length > 0) {
                        clearInterval(checkRendered);
                        assignStableTargetIds(iframeDoc);
                        resolve({
                            document: iframeDoc,
                            url: iframe.contentWindow.location.href
                        });
                    }
                }, 50);
                // Fallback timeout if rendering doesn't complete
                setTimeout(() => {
                    clearInterval(checkRendered);
                    resolve({
                        document: iframeDoc,
                        url: href
                    });
                }, 2000);
            }
            catch (err) {
                console.error('[equation-citator] Failed to read iframe contents:', err);
                iframe.remove();
                resolve(null);
            }
        };
        document.body.appendChild(iframe);
    });
}
async function fetchPage(href) {
    const cacheKey = removeUrlHash(new URL(href, window.location.href).href);
    if (pageCache.has(cacheKey))
        return pageCache.get(cacheKey);
    const promise = fetchPageDynamically(href);
    pageCache.set(cacheKey, promise);
    return promise;
}
function resolvedTarget(kind, tag, target, url) {
    return { kind, tag, target, url };
}
function logSamePageTargetMissing(kind, tag) {
    console.warn('[equation-citator] Same-page target not found:', `kind="${kind}", tag="${tag}"`, `| Current page: ${window.location.href}`);
}
function resolveSamePageTarget(kind, tag) {
    const target = findMatchingTarget(document, kind, tag);
    if (!target) {
        logSamePageTargetMissing(kind, tag);
        return null;
    }
    return resolvedTarget(kind, tag, target, removeUrlHash(window.location.href));
}
function logMissingCrossFileUrl(citation, ref, kind, tag) {
    const refsDebug = JSON.stringify({ file: ref.file, local: ref.local, crossFile: ref.crossFile, tag });
    console.warn('[equation-citator] Could not resolve target URL for cross-file citation:', `kind="${kind}", tag="${tag}"`, `| ref data: ${refsDebug}`, `| Citation element:`, citation);
}
function targetSummary(pageDocument) {
    return [...pageDocument.querySelectorAll('[data-ec-kind]')].map((el) => ({
        kind: el.dataset.ecKind,
        tag: el.dataset.ecTag || el.dataset.tag,
        id: el.id
    }));
}
function logTargetNotFound(page, kind, tag) {
    console.warn('[equation-citator] Target not found on fetched page:', `kind="${kind}", tag="${tag}"`, `| Fetched page: ${page.url}`, `| Available targets on page:`, targetSummary(page.document));
}
async function resolveTargetFromHref(href, kind, tag) {
    const page = await fetchPage(href);
    if (!page) {
        console.warn('[equation-citator] Failed to fetch target page for cross-file citation:', `kind="${kind}", tag="${tag}"`, `| href: "${href}"`);
        return null;
    }
    const target = findMatchingTarget(page.document, kind, tag);
    if (!target) {
        logTargetNotFound(page, kind, tag);
        return null;
    }
    return resolvedTarget(kind, tag, target, page.url);
}
async function resolveTargets(citation) {
    const kind = citation.dataset.ecKind || '';
    const refs = parseRefs(citation);
    const resolved = [];
    for (const ref of refs) {
        const tag = String(ref?.tag || '').trim();
        if (!tag)
            continue;
        let target = null;
        if (ref.local) {
            target = await resolveTargetFromHref(ref.local, kind, tag);
        }
        else if (ref.file) {
            logMissingCrossFileUrl(citation, ref, kind, tag);
        }
        else {
            target = resolveSamePageTarget(kind, tag);
        }
        if (!target)
            continue;
        resolved.push(target);
    }
    return resolved;
}
function ensurePopover() {
    if (popover)
        return popover;
    popover = document.createElement('div');
    popover.classList.add('equation-citator-preview');
    popover.setAttribute('role', 'tooltip');
    popover.hidden = true;
    popover.addEventListener('mouseenter', () => {
        if (popover?.classList.contains('is-empty') || popover?.classList.contains('is-loading'))
            return;
        window.clearTimeout(hideTimer);
    });
    popover.addEventListener('mouseleave', scheduleHide);
    document.body.appendChild(popover);
    return popover;
}
function positionPopover(anchor) {
    const popoverElement = ensurePopover();
    const anchorRect = anchor.getBoundingClientRect();
    const margin = 12;
    const width = Math.min(560, window.innerWidth - margin * 2);
    popoverElement.style.maxWidth = `${width}px`;
    popoverElement.hidden = false;
    const popoverRect = popoverElement.getBoundingClientRect();
    let top = anchorRect.bottom + margin;
    if (top + popoverRect.height > window.innerHeight - margin) {
        top = anchorRect.top - popoverRect.height - margin;
    }
    if (top < margin)
        top = margin;
    let left = anchorRect.left;
    if (left + popoverRect.width > window.innerWidth - margin) {
        left = window.innerWidth - popoverRect.width - margin;
    }
    if (left < margin)
        left = margin;
    popoverElement.style.top = `${top}px`;
    popoverElement.style.left = `${left}px`;
}
function previewKindLabel(kind = '') {
    const normalized = String(kind || '').trim().toLowerCase();
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
    };
    return labels[normalized] || (normalized ? normalized[0].toUpperCase() + normalized.slice(1) : 'Citation');
}
function previewTitle(resolved) {
    if (!resolved)
        return 'Citation preview';
    const tag = String(resolved.tag || '').trim();
    const label = previewKindLabel(resolved.kind);
    return tag ? `${label} ${tag}` : `${label} preview`;
}
function ensurePreviewShell() {
    const el = ensurePopover();
    let header = el.querySelector('.ec-preview-header');
    let titleRow = el.querySelector('.ec-preview-title-row');
    let title = el.querySelector('.ec-preview-title');
    let counter = el.querySelector('.ec-preview-counter');
    let actions = el.querySelector('.ec-preview-actions');
    let prev = el.querySelector('.ec-preview-arrow.ec-preview-prev');
    let next = el.querySelector('.ec-preview-arrow.ec-preview-next');
    let jump = el.querySelector('.ec-preview-jump');
    let body = el.querySelector('.ec-preview-body');
    let iframe = el.querySelector('.equation-citator-preview-iframe');
    if (!header) {
        header = document.createElement('div');
        header.className = 'ec-preview-header';
        el.appendChild(header);
    }
    if (!titleRow) {
        titleRow = document.createElement('div');
        titleRow.className = 'ec-preview-title-row';
        header.appendChild(titleRow);
    }
    if (!title) {
        title = document.createElement('span');
        title.className = 'ec-preview-title';
        titleRow.appendChild(title);
    }
    if (!counter) {
        counter = document.createElement('span');
        counter.className = 'ec-preview-counter';
        titleRow.appendChild(counter);
    }
    if (!actions) {
        actions = document.createElement('div');
        actions.className = 'ec-preview-actions';
        header.appendChild(actions);
    }
    if (!prev) {
        prev = document.createElement('button');
        prev.className = 'ec-preview-arrow ec-preview-prev';
        prev.setAttribute('aria-label', 'Previous citation');
        prev.type = 'button';
        prev.textContent = '<';
        prev.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            navigatePreview(-1);
        });
    }
    actions.appendChild(prev);
    if (!next) {
        next = document.createElement('button');
        next.className = 'ec-preview-arrow ec-preview-next';
        next.setAttribute('aria-label', 'Next citation');
        next.type = 'button';
        next.textContent = '>';
        next.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            navigatePreview(1);
        });
    }
    actions.appendChild(next);
    if (!jump) {
        jump = document.createElement('button');
        jump.className = 'ec-preview-jump';
        jump.type = 'button';
        jump.innerHTML = '&nearr;';
        jump.title = 'Open target. Ctrl/Cmd-click opens in a new tab.';
        jump.setAttribute('aria-label', 'Open citation target');
        jump.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            openActivePreviewTarget(e);
        });
        jump.addEventListener('auxclick', (e) => {
            if (e.button !== 1)
                return;
            e.preventDefault();
            e.stopPropagation();
            openActivePreviewTarget(e);
        });
    }
    if (!body) {
        body = document.createElement('div');
        body.className = 'ec-preview-body';
        el.appendChild(body);
    }
    if (!iframe) {
        iframe = document.createElement('iframe');
        iframe.className = 'equation-citator-preview-iframe';
        iframe.setAttribute('tabindex', '-1');
        iframe.setAttribute('aria-hidden', 'true');
        body.appendChild(iframe);
    }
    else if (iframe.parentElement !== body) {
        body.appendChild(iframe);
    }
    body.appendChild(jump);
    return {
        prev,
        next,
        counter,
        title,
        jump,
        iframe
    };
}
function updateNavControls() {
    const { prev, next, counter, title, jump } = ensurePreviewShell();
    const count = previewTargets.length;
    const show = count > 1;
    const activeTarget = previewTargets[previewIndex];
    prev.hidden = !show;
    next.hidden = !show;
    counter.hidden = !show;
    jump.disabled = !activeTarget;
    title.textContent = previewTitle(activeTarget);
    if (show) {
        counter.textContent = `(${previewIndex + 1} of ${count})`;
    }
    else {
        counter.textContent = '';
    }
}
function navigatePreview(delta) {
    const count = previewTargets.length;
    if (count < 2)
        return;
    previewIndex = (previewIndex + delta + count) % count;
    loadPreviewTarget(previewTargets[previewIndex]);
    updateNavControls();
}
function buildPreviewUrl(resolved) {
    const targetId = ensureTargetId(resolved.target, resolved.kind, resolved.tag);
    const targetUrl = new URL(resolved.url, window.location.href);
    targetUrl.hash = targetId;
    return targetUrl.href;
}
function openActivePreviewTarget(event = {}) {
    const resolved = previewTargets[previewIndex];
    if (!resolved)
        return;
    const targetHref = buildPreviewUrl(resolved);
    const openInNewTab = event.ctrlKey || event.metaKey || event.button === 1;
    if (openInNewTab) {
        window.open(targetHref, '_blank', 'noopener');
        return;
    }
    const targetUrl = new URL(targetHref, window.location.href);
    const currentUrl = new URL(window.location.href);
    if (targetUrl.origin === currentUrl.origin &&
        targetUrl.pathname === currentUrl.pathname &&
        targetUrl.search === currentUrl.search) {
        window.location.hash = targetUrl.hash;
        refreshTargetsAndScrollToHash();
    }
    else {
        window.location.href = targetHref;
    }
    hidePopover();
}
function applyPreviewIframeStyles(iframeDocument) {
    let style = iframeDocument.getElementById('equation-citator-preview-iframe-style');
    if (!style) {
        style = iframeDocument.createElement('style');
        style.id = 'equation-citator-preview-iframe-style';
        iframeDocument.head.appendChild(style);
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
  `;
}
function suppressPreviewIframeEvents(iframeDocument) {
    if (iframeDocument.__equationCitatorPreviewEventsBlocked)
        return;
    iframeDocument.__equationCitatorPreviewEventsBlocked = true;
    const blockEvent = (event) => {
        event.preventDefault();
        event.stopPropagation();
    };
    for (const type of ['click', 'dblclick', 'auxclick', 'mousedown', 'mouseup', 'mouseover']) {
        iframeDocument.addEventListener(type, blockEvent, true);
    }
}
function preparePreviewIframe(iframe, resolved) {
    const run = () => {
        try {
            const iframeDocument = iframe.contentDocument || iframe.contentWindow?.document;
            if (!iframeDocument)
                return false;
            applyPreviewIframeStyles(iframeDocument);
            suppressPreviewIframeEvents(iframeDocument);
            assignStableTargetIds(iframeDocument);
            iframeDocument
                .querySelectorAll('.equation-citator-preview-current')
                .forEach((target) => target.classList.remove('equation-citator-preview-current'));
            const target = findMatchingTarget(iframeDocument, resolved.kind, resolved.tag);
            if (!target)
                return false;
            ensureTargetId(target, resolved.kind, resolved.tag);
            target.classList.add('equation-citator-preview-current');
            target.scrollIntoView({ block: 'center', inline: 'nearest' });
            return true;
        }
        catch (err) {
            console.warn('[equation-citator] Failed to prepare preview iframe:', err);
            return true;
        }
    };
    if (run())
        return;
    for (const delay of [120, 360, 800]) {
        window.setTimeout(run, delay);
    }
}
function loadPreviewTarget(resolved) {
    const { iframe } = ensurePreviewShell();
    iframe.onload = () => preparePreviewIframe(iframe, resolved);
    iframe.src = buildPreviewUrl(resolved);
    window.setTimeout(() => preparePreviewIframe(iframe, resolved), 120);
}
function renderPreviewPanel(citation, resolvedTargets) {
    previewTargets = resolvedTargets;
    previewIndex = 0;
    const popoverElement = ensurePopover();
    popoverElement.className = 'equation-citator-preview';
    ensurePreviewShell();
    loadPreviewTarget(resolvedTargets[0]);
    updateNavControls();
    positionPopover(citation);
}
function renderEmpty(citation) {
    const popoverElement = ensurePopover();
    popoverElement.className = 'equation-citator-preview is-empty';
    popoverElement.textContent = 'No matching citation target found.';
    positionPopover(citation);
}
function showLoadingState() {
    const popoverElement = ensurePopover();
    popoverElement.className = 'equation-citator-preview is-loading';
    popoverElement.hidden = true;
}
async function showForCitation(citation) {
    const token = ++hoverToken;
    activeCitation = citation;
    window.clearTimeout(hideTimer);
    showLoadingState();
    const resolved = await resolveTargets(citation);
    if (token !== hoverToken || activeCitation !== citation)
        return;
    if (!resolved.length) {
        renderEmpty(citation);
        return;
    }
    renderPreviewPanel(citation, resolved);
}
function hidePopover() {
    activeCitation = null;
    hoverToken += 1;
    previewTargets = [];
    previewIndex = 0;
    if (popover) {
        popover.hidden = true;
        if (popover.classList.contains('is-empty') || popover.classList.contains('is-loading')) {
            popover.textContent = '';
            popover.className = 'equation-citator-preview';
        }
    }
}
function scheduleHide() {
    window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(hidePopover, 120);
}
function citationFromEvent(event) {
    const target = event.target;
    return target instanceof Element ? target.closest(CITATION_SELECTOR) : null;
}
function onMouseOver(event) {
    const citation = citationFromEvent(event);
    if (!citation || citation === activeCitation)
        return;
    if (citation.contains(event.relatedTarget))
        return;
    void showForCitation(citation);
}
function onMouseOut(event) {
    const citation = citationFromEvent(event);
    if (!citation || citation.contains(event.relatedTarget))
        return;
    scheduleHide();
}
function scrollToCurrentHash() {
    if (!window.location.hash)
        return;
    const target = document.getElementById(decodeURIComponent(window.location.hash.slice(1)));
    if (!target)
        return;
    window.requestAnimationFrame(() => {
        target.scrollIntoView({ block: 'start' });
    });
}
function refreshTargets() {
    assignStableTargetIds(document);
}
function refreshTargetsAndScrollToHash() {
    refreshTargets();
    scrollToCurrentHash();
}
export function installEquationCitatorPreviews({ router, } = {}) {
    if (typeof window === 'undefined' || typeof document === 'undefined')
        return;
    window[CLEANUP_KEY]?.();
    refreshTargetsAndScrollToHash();
    document.addEventListener('mouseover', onMouseOver);
    document.addEventListener('mouseout', onMouseOut);
    window.addEventListener('scroll', scheduleHide, { passive: true });
    window.addEventListener('resize', scheduleHide, { passive: true });
    window.addEventListener('hashchange', refreshTargetsAndScrollToHash);
    let mutationTimer = 0;
    const observer = new MutationObserver(() => {
        window.clearTimeout(mutationTimer);
        mutationTimer = window.setTimeout(refreshTargets, 50);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    const previousRouteChanged = router?.onAfterRouteChanged;
    if (router) {
        router.onAfterRouteChanged = (to) => {
            previousRouteChanged?.(to);
            hidePopover();
            window.setTimeout(refreshTargetsAndScrollToHash, 0);
        };
    }
    window[CLEANUP_KEY] = () => {
        document.removeEventListener('mouseover', onMouseOver);
        document.removeEventListener('mouseout', onMouseOut);
        window.removeEventListener('scroll', scheduleHide);
        window.removeEventListener('resize', scheduleHide);
        window.removeEventListener('hashchange', refreshTargetsAndScrollToHash);
        window.clearTimeout(hideTimer);
        window.clearTimeout(mutationTimer);
        observer.disconnect();
        if (router)
            router.onAfterRouteChanged = previousRouteChanged;
        hidePopover();
        if (popover) {
            popover.remove();
            popover = null;
        }
    };
}
export const install = installEquationCitatorPreviews;
//# sourceMappingURL=runtime.js.map