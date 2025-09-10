// lib/types.ts
// Comprehensive TypeScript interfaces for the Stringify plugin
export class PluginError extends Error {
    constructor(message, options) {
        super(message);
        this.name = 'PluginError';
        this.code = options === null || options === void 0 ? void 0 : options.code;
        this.context = options === null || options === void 0 ? void 0 : options.context;
    }
}
