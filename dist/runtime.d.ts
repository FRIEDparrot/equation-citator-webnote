declare global {
    interface Document {
        __equationCitatorPreviewEventsBlocked?: boolean;
    }
    interface Window {
        __equationCitatorThemeCleanup?: () => void;
    }
}
type RouterLike = {
    onAfterRouteChanged?: (to: unknown) => void;
};
type InstallOptions = {
    router?: RouterLike;
};
export declare function installEquationCitatorPreviews({ router }?: InstallOptions): void;
export declare const install: typeof installEquationCitatorPreviews;
export {};
