/**
 * Injected by vite.config.ts `define`. Always read it through `appBuildId()`
 * so a build that somehow skipped the define (tests, ad-hoc scripts) degrades
 * to "dev" instead of throwing a ReferenceError.
 */
declare const __APP_BUILD__: string;
