// lib/textProcessor.ts
// Enhanced text validation and naming logic for the Stringify plugin
import { PLUGIN_CONFIG, ERROR_CODES, VARIABLE_NAME_PATTERNS } from './constants';
import { PluginError } from './types';
export function isValidTextForVariable(text) {
    const trimmed = text.trim();
    if (!trimmed || trimmed.length === 0)
        return false;
    // Check if first character is alphanumeric
    const firstChar = trimmed[0];
    return VARIABLE_NAME_PATTERNS.SAFE_CHARS.test(firstChar);
}
export function createVariableName(text) {
    if (!text || text.trim().length === 0) {
        throw new PluginError('Cannot create variable name from empty text', {
            code: ERROR_CODES.INVALID_TEXT
        });
    }
    let processed = text
        .trim()
        .toLowerCase()
        // Remove special characters first, keeping spaces
        .replace(VARIABLE_NAME_PATTERNS.REPLACE_CHARS, '')
        // Convert to snake_case
        .replace(/\s+/g, '_')
        // Clean up multiple underscores
        .replace(VARIABLE_NAME_PATTERNS.MULTIPLE_UNDERSCORES, '_')
        // Remove leading/trailing underscores
        .replace(VARIABLE_NAME_PATTERNS.EDGE_UNDERSCORES, '');
    // Handle empty result after processing
    if (!processed) {
        processed = 'text_variable';
    }
    // Apply intelligent truncation if needed
    if (processed.length > PLUGIN_CONFIG.MAX_VARIABLE_NAME_LENGTH) {
        return truncateVariableName(processed);
    }
    return processed;
}
function truncateVariableName(text) {
    const maxLength = PLUGIN_CONFIG.MAX_VARIABLE_NAME_LENGTH;
    const separator = '___';
    const availableLength = maxLength - separator.length;
    const startLength = Math.ceil(availableLength * 0.6);
    const endLength = Math.floor(availableLength * 0.4);
    const start = text.substring(0, startLength);
    const end = text.substring(text.length - endLength);
    return `${start}${separator}${end}`;
}
export function validateTextLayer(node) {
    var _a;
    try {
        // Check if already bound to a variable
        if ((_a = node.boundVariables) === null || _a === void 0 ? void 0 : _a.characters) {
            return false;
        }
        // Check if node is locked or hidden
        if (node.locked || !node.visible) {
            return false;
        }
        // Validate text content
        return isValidTextForVariable(node.characters);
    }
    catch (error) {
        console.warn(`Error validating text layer ${node.id}:`, error);
        return false;
    }
}
export function getValidTextLayers() {
    try {
        const allTextNodes = figma.currentPage.findAll(node => node.type === "TEXT");
        const validTextNodes = allTextNodes.filter(validateTextLayer);
        return {
            layers: validTextNodes,
            validCount: validTextNodes.length,
            totalCount: allTextNodes.length
        };
    }
    catch (error) {
        console.error('Error scanning text layers:', error);
        throw new PluginError('Failed to scan text layers');
    }
}
export function preprocessTextForVariable(text) {
    const trimmed = text.trim();
    return {
        original: text,
        processed: trimmed,
        variableName: createVariableName(trimmed)
    };
}
export function createVariableNameWithConflictResolution(baseName, existingNames) {
    let finalName = baseName;
    let counter = 1;
    while (existingNames.includes(finalName)) {
        finalName = `${baseName}_${counter}`;
        counter++;
    }
    return finalName;
}
export function sanitizeTextForVariable(text) {
    return text
        .trim()
        .replace(/\s+/g, ' ')
        .replace(/[^\w\s]/g, '');
}
