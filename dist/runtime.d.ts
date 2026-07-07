declare global {
    interface Document {
        __equationCitatorPreviewEventsBlocked?: boolean;
    }
    interface Window {
        __equationCitatorThemeCleanup?: () => void;
    }
}
type PathMapping = {
    urlPattern: string;
    baseUrl: string;
};
type RouterLike = {
    onAfterRouteChanged?: (to: unknown) => void;
};
type InstallOptions = {
    router?: RouterLike;
    pathMappings?: PathMapping[];
};
export declare function installEquationCitatorPreviews({ router, pathMappings: configuredPathMappings }?: InstallOptions): void;
export declare const install: typeof installEquationCitatorPreviews;
export {};
