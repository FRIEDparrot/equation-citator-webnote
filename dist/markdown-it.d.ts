type MarkdownItPlugin = {
    core: {
        ruler: {
            after: (afterName: string, ruleName: string, rule: (state: MarkdownItState) => void) => void;
        };
    };
    renderer: {
        rules: Record<string, (...args: any[]) => string>;
    };
    utils: {
        escapeHtml: (value: string) => string;
    };
};
type MarkdownItState = {
    env: Record<string, any>;
    tokens: MarkdownItToken[];
    Token: TokenConstructor;
};
type MarkdownItToken = {
    type: string;
    tag?: string;
    nesting?: number;
    content: string;
    children?: MarkdownItToken[];
    attrJoin: (name: string, value: string) => void;
    attrSet: (name: string, value: string) => void;
    attrGet: (name: string) => string | null;
};
type TokenConstructor = new (type: string, tag: string, nesting: number) => MarkdownItToken;
type ProcessInclude = string | RegExp | ((env: Record<string, any>, state: Pick<MarkdownItState, 'env'>) => boolean);
export type EquationCitatorPathMapping = Record<string, string> | Array<Record<string, string>>;
export type EquationCitatorMarkdownItOptions = {
    include?: ProcessInclude;
    filter?: ProcessInclude;
    equationKind?: string;
    figureKind?: string;
    calloutKinds?: string[];
    enableEquationTargets?: boolean;
    enableFigureTargets?: boolean;
    enableCalloutTargets?: boolean;
    enableFigureCaptions?: boolean;
    enableObsidianCallouts?: boolean;
    enableObsidianLinks?: boolean;
    logEmbedLinkRemapping?: boolean;
    useHeadingIdSlug?: boolean;
    pathMapping: EquationCitatorPathMapping;
};
type FigureMetadata = {
    tag: string;
    title: string;
    desc: string;
    width: string;
    label: string;
};
/**
 * Install the markwon it plugin to the page instance.
 */
export declare function equationCitatorMarkdownIt(md: MarkdownItPlugin, options: EquationCitatorMarkdownItOptions | undefined): void;
export default equationCitatorMarkdownIt;
export declare function parseEquationCitatorFigureLabel(raw?: string): FigureMetadata | null;
export declare function buildHeadingId(rawHeading?: string): string;
