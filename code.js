"use strict";
// Stringify Plugin - Convert text layers to variables
// Enhanced V2 implementation with consolidated modular architecture
class PluginError extends Error {
    constructor(message, options) {
        super(message);
        this.name = 'PluginError';
        this.code = options === null || options === void 0 ? void 0 : options.code;
        this.context = options === null || options === void 0 ? void 0 : options.context;
    }
}
// ============================================================================
// CONSTANTS
// ============================================================================
const PLUGIN_CONFIG = {
    BATCH_SIZE: 10,
    MAX_VARIABLE_NAME_LENGTH: 50,
    DEFAULT_COLLECTION_NAME: "Text to String",
    PROGRESS_UPDATE_DELAY: 10,
    UI_DIMENSIONS: {
        width: 380,
        height: 640
    }
};
const ERROR_CODES = {
    COLLECTION_NOT_FOUND: 'COLLECTION_NOT_FOUND',
    INVALID_TEXT: 'INVALID_TEXT',
    VARIABLE_CREATION_FAILED: 'VARIABLE_CREATION_FAILED',
    BINDING_FAILED: 'BINDING_FAILED'
};
const UI_MESSAGES = {
    COLLECTION_CREATED: 'Collection created successfully'
};
const VARIABLE_NAME_PATTERNS = {
    SAFE_CHARS: /[A-Za-z0-9_]/,
    // Figma-compatible regex: only allow basic Latin letters, numbers, underscores, spaces, and hyphens
    // Replace everything else including Unicode symbols, accented characters, and special symbols
    REPLACE_CHARS: /[^A-Za-z0-9\s_-]/g,
    MULTIPLE_UNDERSCORES: /_{2,}/g,
    // Only remove trailing underscores, preserve leading ones for cases like _hash_
    EDGE_UNDERSCORES: /_+$/g
};
const NAMING_CONSTANTS = {
    STORAGE_KEY: 'namingConvention',
    DEFAULT_MODE: 'simple',
    MODES: {
        SIMPLE: 'simple',
        HIERARCHICAL: 'hierarchical'
    }
};
// ============================================================================
// PREFERENCE MANAGEMENT
// ============================================================================
class PreferenceManager {
    /**
     * Load naming mode preference from storage
     * Defaults to 'simple' for new users as per PRD
     */
    static async loadNamingMode() {
        try {
            const saved = await figma.clientStorage.getAsync(this.STORAGE_KEY);
            return saved === 'hierarchical' ? 'hierarchical' : 'simple';
        }
        catch (error) {
            console.warn('Error loading naming preference:', error);
            return NAMING_CONSTANTS.DEFAULT_MODE;
        }
    }
    /**
     * Save naming mode preference to storage
     */
    static async saveNamingMode(mode) {
        try {
            await figma.clientStorage.setAsync(this.STORAGE_KEY, mode);
        }
        catch (error) {
            console.error('Error saving naming preference:', error);
            throw new PluginError('Failed to save naming preference');
        }
    }
}
PreferenceManager.STORAGE_KEY = NAMING_CONSTANTS.STORAGE_KEY;
// ============================================================================
// TEXT PROCESSING FUNCTIONS
// ============================================================================
function isValidTextForVariable(text) {
    const trimmed = text.trim();
    if (!trimmed || trimmed.length === 0)
        return false;
    // More permissive validation - accept any printable character
    // The sanitization functions will handle making it Figma-compatible
    return trimmed.length <= 1000; // Reasonable length limit
}
function createVariableName(text, textNode, namingMode) {
    if (!text || text.trim().length === 0) {
        throw new PluginError('Cannot create variable name from empty text', {
            code: ERROR_CODES.INVALID_TEXT
        });
    }
    // Use simple naming mode if specified or if no textNode provided
    if (namingMode === 'simple' || !textNode) {
        return generateSimpleVariableName(text);
    }
    // Default to hierarchical naming (backward compatibility)
    const hierarchicalName = createHierarchicalVariableName(text, textNode);
    if (hierarchicalName.length > PLUGIN_CONFIG.MAX_VARIABLE_NAME_LENGTH) {
        return truncateVariableName(hierarchicalName);
    }
    return hierarchicalName;
}
/**
 * Generate simple variable name using hierarchical processing logic but without parent hierarchy
 * - Uses robust sanitization from advanced mode
 * - Preserves original capitalization (Live Activities → Live_Activities)
 * - Applies same character handling and validation as hierarchical mode
 * - Uses existing truncation logic for length management
 */
function generateSimpleVariableName(textContent) {
    // Use the robust sanitization logic from hierarchical mode but preserve case
    let processed = sanitizeNamePreserveCase(textContent);
    // If empty after processing, return default
    if (!processed) {
        return 'text_variable';
    }
    // Ensure it starts with a valid character for Figma variables (basic Latin letter or underscore)
    if (!/^[A-Za-z_]/.test(processed)) {
        processed = `Var_${processed}`;
    }
    // Apply existing truncation logic if too long (reuse hierarchical truncation)
    if (processed.length > PLUGIN_CONFIG.MAX_VARIABLE_NAME_LENGTH) {
        return truncateVariableName(processed);
    }
    return processed;
}
function createHierarchicalVariableName(text, textNode) {
    const parts = [];
    // Use the layer name for variable naming
    let textName = sanitizeName(textNode.name);
    if (!textName) {
        textName = 'text_variable';
    }
    // Find meaningful parent using smart hierarchy traversal
    const meaningfulParent = findMeaningfulParent(textNode);
    // Find root component
    const rootComponent = findRootComponent(textNode);
    // Build the hierarchical name: Component / MeaningfulParent / LayerName
    if (rootComponent && rootComponent !== 'root') {
        parts.push(rootComponent);
    }
    if (meaningfulParent && meaningfulParent !== rootComponent) {
        parts.push(meaningfulParent);
    }
    // Append sanitized text content to layer name to ensure uniqueness
    // This prevents conflicts when multiple layers have the same name but different content
    // e.g., "title" with content "Class" becomes "title_class", "title" with "Engine" becomes "title_engine"
    const sanitizedContent = sanitizeName(text);
    if (sanitizedContent && sanitizedContent !== textName) {
        textName = `${textName}_${sanitizedContent}`;
    }
    parts.push(textName);
    const finalName = parts.join('/');
    return finalName;
}
function findMeaningfulParent(textNode) {
    let currentParent = textNode.parent;
    const maxLevels = 10; // Prevent infinite loops
    let level = 0;
    while (currentParent && currentParent.type !== 'PAGE' && level < maxLevels) {
        const sanitizedName = sanitizeName(currentParent.name);
        // Check if this is a meaningful name (not generic)
        if (sanitizedName && !isGenericName(sanitizedName)) {
            return sanitizedName;
        }
        // Stop if we hit a component boundary (unless it's also generic)
        if (currentParent.type === 'COMPONENT' || currentParent.type === 'COMPONENT_SET') {
            return sanitizedName || 'component';
        }
        currentParent = currentParent.parent;
        level++;
    }
    return ''; // No meaningful parent found
}
function findRootComponent(textNode) {
    let currentParent = textNode.parent;
    // Traverse up to find the root component
    while (currentParent && currentParent.type !== 'PAGE') {
        if (currentParent.type === 'COMPONENT' || currentParent.type === 'COMPONENT_SET') {
            const componentName = sanitizeName(currentParent.name);
            return componentName || 'component';
        }
        currentParent = currentParent.parent;
    }
    return ''; // Not inside a component
}
function isGenericName(name) {
    const genericPatterns = [
        /^frame(_\d+)?$/i,
        /^group(_\d+)?$/i,
        /^auto.?layout(_\d+)?$/i,
        /^container(_\d+)?$/i,
        /^rectangle(_\d+)?$/i,
        /^ellipse(_\d+)?$/i,
        /^polygon(_\d+)?$/i,
        /^star(_\d+)?$/i,
        /^line(_\d+)?$/i,
        /^vector(_\d+)?$/i,
        /^untitled(_\d+)?$/i,
        /^\d+$/,
        /^layer(_\d+)?$/i
    ];
    return genericPatterns.some(pattern => pattern.test(name));
}
function sanitizeName(name) {
    if (!name || name.trim().length === 0) {
        return '';
    }
    return name
        .trim()
        .toLowerCase()
        // Enhanced character handling for common special cases
        .replace(/@/g, '_at_') // email@domain.com → email_at_domain_com
        .replace(/#/g, '_hash_') // #hashtag → _hash_hashtag
        .replace(/\$/g, '_dollar_') // $99 → _dollar_99
        .replace(/%/g, '_percent_') // 50% → 50_percent_
        .replace(/&/g, '_and_') // A & B → A_and_B
        .replace(/\+/g, '_plus_') // A + B → A_plus_B
        .replace(/=/g, '_equals_') // A = B → A_equals_B
        .replace(/\s+/g, '_') // Convert spaces to underscores
        .replace(VARIABLE_NAME_PATTERNS.REPLACE_CHARS, '_') // Replace other invalid chars with underscores
        .replace(VARIABLE_NAME_PATTERNS.MULTIPLE_UNDERSCORES, '_')
        .replace(VARIABLE_NAME_PATTERNS.EDGE_UNDERSCORES, '');
}
/**
 * Sanitize name preserving original capitalization for simple mode
 * Uses same robust processing as hierarchical mode but keeps case intact
 */
function sanitizeNamePreserveCase(name) {
    if (!name || name.trim().length === 0) {
        return '';
    }
    return name
        .trim()
        // Enhanced character handling for common special cases (preserve case)
        .replace(/@/g, '_at_') // email@domain.com → email_at_domain_com
        .replace(/#/g, '_hash_') // #hashtag → _hash_hashtag
        .replace(/\$/g, '_dollar_') // $99 → _dollar_99
        .replace(/%/g, '_percent_') // 50% → 50_percent_
        .replace(/&/g, '_and_') // A & B → A_and_B
        .replace(/\+/g, '_plus_') // A + B → A_plus_B
        .replace(/=/g, '_equals_') // A = B → A_equals_B
        .replace(/\s+/g, '_') // Convert spaces to underscores
        .replace(VARIABLE_NAME_PATTERNS.REPLACE_CHARS, '_') // Replace other invalid chars with underscores
        .replace(VARIABLE_NAME_PATTERNS.MULTIPLE_UNDERSCORES, '_')
        .replace(VARIABLE_NAME_PATTERNS.EDGE_UNDERSCORES, '');
}
function truncateVariableName(text) {
    const maxLength = PLUGIN_CONFIG.MAX_VARIABLE_NAME_LENGTH;
    if (text.length <= maxLength)
        return text;
    const separator = '___';
    const availableLength = maxLength - separator.length;
    // Smart truncation: preserve meaningful parts
    // Try to break at word boundaries (underscores) when possible
    const parts = text.split('/');
    if (parts.length > 1) {
        // For hierarchical names, try to preserve the last part (most specific)
        const lastPart = parts[parts.length - 1];
        const remainingLength = availableLength - lastPart.length;
        if (remainingLength > 10) {
            const firstParts = parts.slice(0, -1).join('/');
            if (firstParts.length <= remainingLength) {
                return `${firstParts}/${lastPart}`;
            }
            else {
                const truncatedFirst = firstParts.substring(0, remainingLength - 3) + '...';
                return `${truncatedFirst}/${lastPart}`;
            }
        }
    }
    // Fallback to start/end preservation
    const startLength = Math.floor(availableLength * 0.65); // Slightly favor the start
    const endLength = availableLength - startLength;
    const start = text.substring(0, startLength);
    const end = text.substring(text.length - endLength);
    return `${start}${separator}${end}`;
}
function validateTextLayer(node) {
    var _a;
    try {
        // Skip layers already bound to variables
        if ((_a = node.boundVariables) === null || _a === void 0 ? void 0 : _a.characters) {
            return false;
        }
        // Skip locked layers
        if (node.locked) {
            return false;
        }
        // Skip hidden layers - check both visible property and parent visibility
        if (!node.visible) {
            return false;
        }
        // Additional check: if parent is hidden, this layer should also be considered hidden
        let parent = node.parent;
        while (parent && parent.type !== 'PAGE') {
            if ('visible' in parent && !parent.visible) {
                return false;
            }
            parent = parent.parent;
        }
        // Check if text content is valid for variable creation
        const isValidText = isValidTextForVariable(node.characters);
        if (!isValidText) {
            return false;
        }
        return true;
    }
    catch (error) {
        console.warn(`Error validating text layer ${node.id}:`, error);
        return false;
    }
}
// ============================================================================
// ENHANCED SCANNING - SELECTION DETECTION
// ============================================================================
function determineScanScope() {
    const selection = figma.currentPage.selection;
    if (selection.length === 0) {
        // For page scanning, we need to count all valid text nodes on the page
        const allTextNodes = figma.currentPage.findAll(node => node.type === "TEXT");
        const validTextNodes = allTextNodes.filter(validateTextLayer);
        return {
            type: 'page',
            targetNodes: [figma.currentPage], // PageNode is not SceneNode, but we need it for scanning
            textNodeCount: validTextNodes.length,
            description: 'Scanning entire page'
        };
    }
    // Use selected nodes directly for simpler, more predictable behavior
    const expandedNodes = [...selection];
    const textNodeCount = figma.currentPage.findAll(node => node.type === "TEXT" &&
        expandedNodes.some(selected => selected === node || ('children' in selected && selected.children.includes(node)))).filter(node => validateTextLayer(node)).length;
    return {
        type: 'selection',
        targetNodes: expandedNodes,
        textNodeCount: textNodeCount,
        description: `Scanning ${selection.length} selected ${selection.length === 1 ? 'item' : 'items'}`
    };
}
function groupTextLayersByContent(textLayers, namingMode = 'simple') {
    const contentMap = new Map();
    textLayers.forEach(layer => {
        const trimmedContent = layer.characters.trim();
        // For simple mode, use case-sensitive grouping to preserve exact content matching
        // For hierarchical mode, use case-insensitive grouping as before
        const contentKey = namingMode === 'simple'
            ? trimmedContent // Case-sensitive for simple mode
            : trimmedContent.toLowerCase(); // Case-insensitive for hierarchical mode
        if (contentMap.has(contentKey)) {
            // Add to existing group
            contentMap.get(contentKey).layers.push(layer);
        }
        else {
            // Create new group with appropriate naming mode
            const variableName = createVariableName(trimmedContent, layer.node, namingMode);
            contentMap.set(contentKey, {
                content: layer.characters, // Keep original casing
                trimmedContent: trimmedContent,
                variableName: variableName,
                layers: [layer],
                needsNewVariable: true
            });
        }
    });
    return Array.from(contentMap.values());
}
function analyzeContentGroups(groups) {
    const totalLayers = groups.reduce((sum, group) => sum + group.layers.length, 0);
    const uniqueContent = groups.filter(group => group.layers.length === 1).length;
    const duplicateContent = groups.filter(group => group.layers.length > 1).length;
    const averageLayersPerGroup = totalLayers / groups.length;
    return {
        totalLayers,
        uniqueContent,
        duplicateContent,
        averageLayersPerGroup: Math.round(averageLayersPerGroup * 10) / 10
    };
}
// ============================================================================
// VARIABLE MANAGEMENT FUNCTIONS
// ============================================================================
async function getVariableCollections() {
    try {
        const collections = await figma.variables.getLocalVariableCollectionsAsync();
        return collections.map(collection => ({
            id: collection.id,
            name: collection.name,
            variables: collection.variableIds
        }));
    }
    catch (error) {
        console.error('Error getting variable collections:', error);
        throw new PluginError('Failed to load variable collections');
    }
}
async function createDefaultCollection() {
    try {
        let collectionName = PLUGIN_CONFIG.DEFAULT_COLLECTION_NAME;
        let counter = 1;
        const existingCollections = await figma.variables.getLocalVariableCollectionsAsync();
        const existingNames = new Set(existingCollections.map(c => c.name));
        while (existingNames.has(collectionName)) {
            collectionName = `${PLUGIN_CONFIG.DEFAULT_COLLECTION_NAME} ${++counter}`;
        }
        const collection = figma.variables.createVariableCollection(collectionName);
        return collection.id;
    }
    catch (error) {
        console.error('Error creating default collection:', error);
        throw new PluginError('Failed to create default collection');
    }
}
async function validateCollection(collectionId) {
    const collection = await figma.variables.getVariableCollectionByIdAsync(collectionId);
    if (!collection) {
        throw new PluginError('Collection not found or has been deleted', {
            code: ERROR_CODES.COLLECTION_NOT_FOUND,
            context: { collectionId }
        });
    }
    return collection;
}
async function getExistingVariables(collectionId) {
    try {
        const collection = await validateCollection(collectionId);
        const variableMap = new Map();
        for (const variableId of collection.variableIds) {
            try {
                const variable = await figma.variables.getVariableByIdAsync(variableId);
                if (variable && variable.resolvedType === 'STRING') {
                    const key = `${variable.name}:${variable.valuesByMode[collection.defaultModeId]}`;
                    variableMap.set(key, variable);
                }
            }
            catch (error) {
                console.warn(`Could not load variable ${variableId}:`, error);
            }
        }
        return variableMap;
    }
    catch (error) {
        if (error instanceof PluginError)
            throw error;
        throw new PluginError('Failed to load existing variables');
    }
}
async function createStringVariable(collectionId, variableName, content) {
    try {
        const collection = await validateCollection(collectionId);
        const existingVariables = await getExistingVariables(collectionId);
        // Check if exact variable name and content combination already exists
        const exactMatch = findExistingVariable(existingVariables, variableName, content);
        if (exactMatch) {
            return exactMatch;
        }
        // Check for name conflicts (same variable name, different content)
        const nameConflicts = Array.from(existingVariables.keys())
            .filter(key => key.startsWith(`${variableName}:`));
        let finalVariableName = variableName;
        if (nameConflicts.length > 0) {
            // Only append suffix if there's a true conflict (same name, different content)
            const hasContentConflict = nameConflicts.some(key => key !== `${variableName}:${content}`);
            if (hasContentConflict) {
                finalVariableName = `${variableName}_${nameConflicts.length + 1}`;
            }
        }
        const variable = figma.variables.createVariable(finalVariableName, collection, 'STRING');
        variable.setValueForMode(collection.defaultModeId, content);
        return variable;
    }
    catch (error) {
        console.error(`Error creating variable "${variableName}":`, error);
        throw new PluginError(`Failed to create variable: ${variableName}`, {
            code: ERROR_CODES.VARIABLE_CREATION_FAILED,
            context: { variableName, content, originalError: error instanceof Error ? error.message : String(error) }
        });
    }
}
function bindTextNodeToVariable(textNode, variable) {
    try {
        if (textNode.removed) {
            throw new Error('Text node has been removed');
        }
        if (textNode.locked) {
            throw new Error('Text node is locked');
        }
        textNode.setBoundVariable('characters', variable);
    }
    catch (error) {
        console.error(`Error binding text node ${textNode.id} to variable ${variable.id}:`, error);
        throw new PluginError('Failed to bind text node to variable', {
            code: ERROR_CODES.BINDING_FAILED,
            context: {
                nodeId: textNode.id,
                nodeName: textNode.name,
                variableId: variable.id,
                variableName: variable.name,
                originalError: error instanceof Error ? error.message : String(error)
            }
        });
    }
}
function findExistingVariable(existingVariables, variableName, content) {
    const key = `${variableName}:${content}`;
    return existingVariables.get(key) || null;
}
// ============================================================================
// GHOST VARIABLE DETECTION FUNCTIONS
// ============================================================================
async function scanForGhostVariables() {
    try {
        // Phase 1: Build Set of all valid variable IDs from all collections
        const allValidVariableIds = await buildValidVariableIdSet();
        // Ghostbuster should always scan the entire page, not selection-aware
        const allTextNodes = figma.currentPage.findAll(node => node.type === "TEXT");
        // Filter for visible text nodes (additional validation)
        const visibleTextNodes = allTextNodes.filter(node => {
            // Check if node is visible and not hidden
            if (!node.visible)
                return false;
            // Check if any parent is hidden
            let parent = node.parent;
            while (parent && parent.type !== 'PAGE') {
                if ('visible' in parent && !parent.visible) {
                    return false;
                }
                parent = parent.parent;
            }
            return true;
        });
        const ghosts = [];
        for (const textNode of visibleTextNodes) {
            // Apply the same validation logic as Stringify
            if (!isValidTextForVariable(textNode.characters)) {
                continue;
            }
            const ghostInfo = await checkVariableConnection(textNode, allValidVariableIds);
            if (ghostInfo) {
                ghosts.push(ghostInfo);
            }
        }
        return ghosts;
    }
    catch (error) {
        console.error('Error scanning for ghost variables:', error);
        throw new PluginError('Failed to scan for ghost variables');
    }
}
async function buildValidVariableIdSet() {
    const allValidVariableIds = new Set();
    try {
        // Get all variable collections in the file
        const collections = await figma.variables.getLocalVariableCollectionsAsync();
        // Build Set of all valid variable IDs
        for (const collection of collections) {
            collection.variableIds.forEach(id => {
                allValidVariableIds.add(id);
            });
        }
        console.log(`Built valid variable ID set with ${allValidVariableIds.size} variables from ${collections.length} collections`);
        return allValidVariableIds;
    }
    catch (error) {
        console.error('Error building valid variable ID set:', error);
        return allValidVariableIds; // Return empty set on error
    }
}
async function checkVariableConnection(textNode, allValidVariableIds) {
    const binding = 'characters';
    try {
        // Pre-check: Only process layers that actually have bound variables
        if (!textNode.boundVariables || !textNode.boundVariables[binding]) {
            return null; // No connection - not a ghost
        }
        const boundVariable = textNode.getBoundVariable(binding);
        // No bound variable reference - not a ghost
        if (!boundVariable) {
            return null;
        }
        // Check if the bound variable ID exists in our valid set
        if (!allValidVariableIds.has(boundVariable.id)) {
            // Ghost variable - binding exists but variable ID not in any collection
            return {
                nodeId: textNode.id,
                nodeName: textNode.name,
                textContent: textNode.characters,
                bindingType: binding,
                ghostVariableId: boundVariable.id
            };
        }
        // Variable ID exists in collections - it's a valid connection
        return null;
    }
    catch (error) {
        // getBoundVariable() threw an error - likely a ghost or corrupted binding
        console.warn(`Error checking variable connection for node ${textNode.id}:`, error);
        return {
            nodeId: textNode.id,
            nodeName: textNode.name,
            textContent: textNode.characters,
            bindingType: binding,
            ghostVariableId: 'error'
        };
    }
}
async function clearGhostVariables(ghostIds) {
    const result = {
        totalAttempted: ghostIds.length,
        successfullyCleared: 0,
        failed: 0,
        errors: []
    };
    for (const nodeId of ghostIds) {
        try {
            const node = await figma.getNodeByIdAsync(nodeId);
            if (!node) {
                throw new Error('Node no longer exists');
            }
            if (node.type !== 'TEXT') {
                throw new Error('Node is no longer a text layer');
            }
            if (node.removed) {
                throw new Error('Node has been removed from the document');
            }
            // Find and clear all ghost bindings for this node
            const bindings = ['characters'];
            let clearedAny = false;
            for (const binding of bindings) {
                try {
                    const boundVariable = node.getBoundVariable(binding);
                    if (boundVariable) {
                        // Check if this is actually a ghost (variable doesn't exist)
                        const variable = await figma.variables.getVariableByIdAsync(boundVariable.id);
                        if (!variable) {
                            // Clear the ghost binding
                            node.setBoundVariable(binding, null);
                            clearedAny = true;
                        }
                    }
                }
                catch (error) {
                    // Binding exists but variable is inaccessible - clear it
                    node.setBoundVariable(binding, null);
                    clearedAny = true;
                }
            }
            if (clearedAny) {
                result.successfullyCleared++;
            }
            else {
                result.failed++;
                result.errors.push({
                    nodeId,
                    nodeName: node.name,
                    error: 'No ghost bindings found to clear',
                    bindingType: 'unknown'
                });
            }
        }
        catch (error) {
            result.failed++;
            result.errors.push({
                nodeId,
                nodeName: 'unknown',
                error: error instanceof Error ? error.message : 'Unknown error',
                bindingType: 'unknown'
            });
            console.error(`Failed to clear ghost variable ${nodeId}:`, error);
        }
    }
    return result;
}
// ============================================================================
// PLUGIN STATE MANAGEMENT
// ============================================================================
// Plugin state management
let isProcessing = false;
// ============================================================================
// MAIN PLUGIN LOGIC
// ============================================================================
// Show the UI
figma.showUI(__html__, PLUGIN_CONFIG.UI_DIMENSIONS);
// Initialize plugin by loading naming preference
async function initializePlugin() {
    try {
        const namingMode = await PreferenceManager.loadNamingMode();
        sendMessage({
            type: 'naming-preference-loaded',
            namingMode
        });
    }
    catch (error) {
        console.error('Error initializing plugin:', error);
        // Send default mode on error
        sendMessage({
            type: 'naming-preference-loaded',
            namingMode: NAMING_CONSTANTS.DEFAULT_MODE
        });
    }
}
// Initialize plugin
initializePlugin();
// Enhanced Scanning - Optimized Selection Change Handler
let selectionChangeTimeout = null;
let lastSelectionHash = '';
figma.on('selectionchange', () => {
    // Debounce selection changes for better performance
    if (selectionChangeTimeout) {
        clearTimeout(selectionChangeTimeout);
    }
    selectionChangeTimeout = setTimeout(() => {
        try {
            // Create a simple hash of the selection to avoid unnecessary updates
            const currentSelection = figma.currentPage.selection;
            const selectionHash = currentSelection.map(node => node.id).join(',');
            // Only update if selection actually changed
            if (selectionHash !== lastSelectionHash) {
                lastSelectionHash = selectionHash;
                const scope = determineScanScope();
                // Simplified preview without the removed function
                const preview = {
                    scopeDescription: scope.description,
                    textLayerCount: scope.textNodeCount,
                    selectionSummary: scope.type === 'selection' ?
                        `${scope.targetNodes.length} selected items` : undefined,
                    hasSelection: scope.type === 'selection'
                };
                // Only send update if UI is ready and not processing
                if (!isProcessing) {
                    figma.ui.postMessage({
                        type: 'selection-changed',
                        scope: preview
                    });
                    // Also trigger a text layer scan to update the main counter
                    try {
                        const textLayers = scope.type === 'selection'
                            ? figma.currentPage.findAll(node => node.type === "TEXT" &&
                                scope.targetNodes.some(selected => selected === node || ('children' in selected && selected.children.includes(node)))).filter(node => validateTextLayer(node))
                            : figma.currentPage.findAll(node => node.type === "TEXT" && validateTextLayer(node));
                        const layers = textLayers.map((layer) => ({
                            id: layer.id,
                            name: layer.name,
                            characters: layer.characters,
                            node: layer
                        }));
                        figma.ui.postMessage({
                            type: 'text-layers-found',
                            layers: layers,
                            validCount: layers.length,
                            totalCount: scope.textNodeCount
                        });
                    }
                    catch (error) {
                        console.warn('Error scanning text layers for selection change:', error);
                    }
                }
            }
        }
        catch (error) {
            console.warn('Error handling selection change:', error);
        }
    }, 50); // 50ms debounce for smooth performance
});
// Enhanced message handling with comprehensive error handling
figma.ui.onmessage = async (msg) => {
    try {
        await handleMessage(msg);
    }
    catch (error) {
        console.error(`Error handling message ${msg.type}:`, error);
        handlePluginError(error);
    }
};
async function handleMessage(msg) {
    switch (msg.type) {
        case 'get-collections':
            await handleGetCollections();
            break;
        case 'scan-text-layers':
            await handleScanTextLayers(msg.selectedCollectionId);
            break;
        case 'create-variables':
            await handleCreateVariables(msg.collectionId);
            break;
        case 'create-default-collection':
            await handleCreateDefaultCollection();
            break;
        case 'scan-ghost-variables':
            await handleScanGhostVariables();
            break;
        case 'clear-ghost-variables':
            await handleClearGhostVariables(msg.ghostIds);
            break;
        case 'select-ghost-layer':
            await handleSelectGhostLayer(msg.nodeId);
            break;
        case 'get-naming-preference':
            await handleGetNamingPreference();
            break;
        case 'update-naming-preference':
            await handleUpdateNamingPreference(msg.namingMode);
            break;
        default:
            throw new Error(`Unknown message type: ${msg.type}`);
    }
}
async function handleGetCollections() {
    try {
        const collections = await getVariableCollections();
        sendMessage({
            type: 'collections-loaded',
            collections
        });
    }
    catch (error) {
        throw new PluginError(`Failed to load collections: ${error instanceof Error ? error.message : String(error)}`);
    }
}
async function handleScanTextLayers(selectedCollectionId) {
    try {
        // First, get current collections to validate the selected one
        const collections = await getVariableCollections();
        // Check if the selected collection still exists
        if (selectedCollectionId) {
            const collectionExists = collections.some(collection => collection.id === selectedCollectionId);
            if (!collectionExists) {
                sendMessage({
                    type: 'collection-invalid',
                    message: 'The selected collection no longer exists. Please select a different collection.'
                });
                return;
            }
        }
        // Enhanced Scanning - Use selection-aware logic
        const scope = determineScanScope();
        const textNodes = scope.type === 'selection'
            ? figma.currentPage.findAll(node => node.type === "TEXT" &&
                scope.targetNodes.some(selected => selected === node || ('children' in selected && selected.children.includes(node)))).filter(node => validateTextLayer(node))
            : figma.currentPage.findAll(node => node.type === "TEXT" && validateTextLayer(node));
        // Send scope information to UI
        sendMessage({
            type: 'scan-scope-detected',
            scope: scope
        });
        // Convert to layer info format
        const layers = textNodes.map((layer) => ({
            id: layer.id,
            name: layer.name,
            characters: layer.characters,
            node: layer
        }));
        sendMessage({
            type: 'text-layers-found',
            layers: layers,
            validCount: layers.length,
            totalCount: scope.textNodeCount,
            scopeType: scope.type
        });
        if (layers.length === 0) {
            const message = scope.textNodeCount > 0
                ? `Found ${scope.textNodeCount} text layers, but none are suitable for variable creation (may be hidden, locked, or already bound to variables).`
                : scope.type === 'selection'
                    ? 'No suitable text layers selected for processing.'
                    : 'No suitable text layers found on the current page.';
            figma.notify(message, { timeout: 3000 });
        }
    }
    catch (error) {
        throw new PluginError(`Failed to scan text layers: ${error instanceof Error ? error.message : String(error)}`);
    }
}
async function handleCreateVariables(collectionId) {
    if (!collectionId) {
        throw new PluginError('Collection ID is required');
    }
    if (isProcessing) {
        throw new PluginError('Processing is already in progress');
    }
    isProcessing = true;
    try {
        // Enhanced Scanning - Use selection-aware logic for variable creation
        const scope = determineScanScope();
        const textLayers = scope.type === 'selection'
            ? figma.currentPage.findAll(node => node.type === "TEXT" &&
                scope.targetNodes.some(selected => selected === node || ('children' in selected && selected.children.includes(node)))).filter(node => validateTextLayer(node))
            : figma.currentPage.findAll(node => node.type === "TEXT" && validateTextLayer(node));
        if (textLayers.length === 0) {
            throw new PluginError('No valid text layers found for processing');
        }
        const result = await processTextLayersWithProgress(textLayers, collectionId);
        sendMessage({
            type: 'variables-created',
            result
        });
        const summary = createProcessingSummary(result);
        figma.notify(summary, { timeout: 5000 });
    }
    finally {
        isProcessing = false;
    }
}
async function handleCreateDefaultCollection() {
    try {
        const collectionId = await createDefaultCollection();
        const collections = await getVariableCollections();
        sendMessage({
            type: 'collection-created',
            collectionId,
            collections
        });
        figma.notify(UI_MESSAGES.COLLECTION_CREATED, { timeout: 3000 });
    }
    catch (error) {
        throw new PluginError(`Failed to create collection: ${error instanceof Error ? error.message : String(error)}`);
    }
}
async function handleScanGhostVariables() {
    try {
        const ghosts = await scanForGhostVariables();
        sendMessage({
            type: 'ghost-variables-found',
            ghosts,
            count: ghosts.length
        });
        if (ghosts.length > 0) {
            figma.notify(`Found ${ghosts.length} ghost variable${ghosts.length !== 1 ? 's' : ''}`, { timeout: 3000 });
        }
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        sendMessage({
            type: 'ghost-scan-error',
            error: errorMessage
        });
        throw new PluginError(`Failed to scan ghost variables: ${errorMessage}`);
    }
}
async function handleClearGhostVariables(ghostIds) {
    try {
        const result = await clearGhostVariables(ghostIds);
        sendMessage({
            type: 'ghost-clear-complete',
            result
        });
        const message = `Cleared ${result.successfullyCleared} ghost variable${result.successfullyCleared !== 1 ? 's' : ''}`;
        figma.notify(message, { timeout: 5000 });
        if (result.failed > 0) {
            figma.notify(`Warning: ${result.failed} ghost variable${result.failed !== 1 ? 's' : ''} could not be cleared`, {
                error: true,
                timeout: 5000
            });
        }
    }
    catch (error) {
        throw new PluginError(`Failed to clear ghost variables: ${error instanceof Error ? error.message : String(error)}`);
    }
}
async function handleSelectGhostLayer(nodeId) {
    try {
        const node = await figma.getNodeByIdAsync(nodeId);
        if (!node) {
            figma.notify('Layer not found or has been deleted', { error: true, timeout: 3000 });
            return;
        }
        if (node.removed) {
            figma.notify('Layer has been removed from the document', { error: true, timeout: 3000 });
            return;
        }
        // Select the node
        figma.currentPage.selection = [node];
        figma.viewport.scrollAndZoomIntoView([node]);
        figma.notify(`Selected layer: ${node.name}`, { timeout: 2000 });
    }
    catch (error) {
        console.error('Error selecting ghost layer:', error);
        figma.notify('Failed to select layer', { error: true, timeout: 3000 });
    }
}
async function handleGetNamingPreference() {
    try {
        const namingMode = await PreferenceManager.loadNamingMode();
        sendMessage({
            type: 'naming-preference-loaded',
            namingMode
        });
    }
    catch (error) {
        console.error('Error loading naming preference:', error);
        // Send default mode on error
        sendMessage({
            type: 'naming-preference-loaded',
            namingMode: NAMING_CONSTANTS.DEFAULT_MODE
        });
    }
}
async function handleUpdateNamingPreference(namingMode) {
    try {
        await PreferenceManager.saveNamingMode(namingMode);
        sendMessage({
            type: 'naming-preference-updated',
            namingMode
        });
        // Provide user feedback
        const modeLabel = namingMode === 'simple' ? 'Simple' : 'Advanced';
        figma.notify(`Naming mode switched to ${modeLabel}`, { timeout: 2000 });
    }
    catch (error) {
        console.error('Error updating naming preference:', error);
        throw new PluginError(`Failed to update naming preference: ${error instanceof Error ? error.message : String(error)}`);
    }
}
async function processTextLayersWithProgress(textLayers, collectionId) {
    const startTime = Date.now();
    const stats = {
        created: 0,
        connected: 0,
        skipped: 0,
        errors: 0
    };
    // Load current naming preference
    const namingMode = await PreferenceManager.loadNamingMode();
    // Convert to TextLayerInfo format
    const layerInfos = textLayers.map(layer => ({
        id: layer.id,
        name: layer.name,
        characters: layer.characters,
        node: layer
    }));
    // Group by content for efficient processing with current naming mode
    const contentGroups = groupTextLayersByContent(layerInfos, namingMode);
    const groupAnalysis = analyzeContentGroups(contentGroups);
    console.log('Content Analysis:', {
        'Total layers': groupAnalysis.totalLayers,
        'Unique content groups': groupAnalysis.uniqueContent,
        'Duplicate content groups': groupAnalysis.duplicateContent,
        'Average layers per group': groupAnalysis.averageLayersPerGroup
    });
    const existingVariables = await getExistingVariables(collectionId);
    // Simplified: use existingVariables directly instead of separate cache
    const detailedErrors = [];
    // Process by content groups instead of individual layers
    for (let i = 0; i < contentGroups.length; i += PLUGIN_CONFIG.BATCH_SIZE) {
        const batch = contentGroups.slice(i, i + PLUGIN_CONFIG.BATCH_SIZE);
        for (const group of batch) {
            try {
                await processContentGroup(group, existingVariables, collectionId, stats);
            }
            catch (error) {
                console.error(`Error processing content group "${group.content}":`, error);
                stats.errors += group.layers.length;
                // Add detailed error for each layer in the failed group
                group.layers.forEach(layer => {
                    detailedErrors.push({
                        layerId: layer.id,
                        layerName: layer.name,
                        content: group.content,
                        error: error instanceof Error ? error.message : 'Unknown error',
                        errorCode: error instanceof PluginError ? error.code : undefined,
                        timestamp: Date.now()
                    });
                });
            }
        }
        const processed = Math.min(i + PLUGIN_CONFIG.BATCH_SIZE, contentGroups.length);
        const progress = Math.round((processed / contentGroups.length) * 100);
        const remaining = contentGroups.length - processed;
        sendMessage({
            type: 'progress-update',
            progress,
            remaining
        });
        await new Promise(resolve => setTimeout(resolve, PLUGIN_CONFIG.PROGRESS_UPDATE_DELAY));
    }
    if (detailedErrors.length > 0) {
        console.warn('Detailed processing errors:', detailedErrors);
    }
    const processingTime = Date.now() - startTime;
    return Object.assign(Object.assign({}, stats), { totalProcessed: stats.created + stats.connected, contentGroups: contentGroups.length, duplicateContentGroups: groupAnalysis.duplicateContent, processingTime });
}
async function processContentGroup(group, existingVariables, collectionId, stats) {
    // Check if we can reuse an existing variable for this content
    let variable = findExistingVariable(existingVariables, group.variableName, group.trimmedContent);
    if (variable) {
        // Bind all layers in this group to the cached variable
        for (const layer of group.layers) {
            if (layer.node && validateTextLayer(layer.node)) {
                bindTextNodeToVariable(layer.node, variable);
                stats.connected++;
            }
            else {
                stats.skipped++;
            }
        }
        return;
    }
    // Check existing variables
    variable = findExistingVariable(existingVariables, group.variableName, group.trimmedContent);
    if (variable) {
        // Bind all layers in this group to the existing variable
        for (const layer of group.layers) {
            if (layer.node && validateTextLayer(layer.node)) {
                bindTextNodeToVariable(layer.node, variable);
                stats.connected++;
            }
            else {
                stats.skipped++;
            }
        }
        return;
    }
    // Create new variable for this content group
    variable = await createStringVariable(collectionId, group.variableName, group.trimmedContent);
    // Add to existingVariables for future lookups
    const key = `${variable.name}:${group.trimmedContent}`;
    existingVariables.set(key, variable);
    // Bind all layers in this group to the new variable
    let layersProcessed = 0;
    for (const layer of group.layers) {
        if (layer.node && validateTextLayer(layer.node)) {
            bindTextNodeToVariable(layer.node, variable);
            layersProcessed++;
        }
        else {
            stats.skipped++;
        }
    }
    if (layersProcessed > 0) {
        stats.created++; // One variable created for the group
        stats.connected += layersProcessed - 1; // Additional connections beyond the first
    }
}
function createProcessingSummary(result) {
    const parts = [];
    if (result.created > 0) {
        parts.push(`Created ${result.created} new variables`);
    }
    if (result.connected > 0) {
        parts.push(`connected ${result.connected} to existing variables`);
    }
    if (result.skipped > 0) {
        parts.push(`skipped ${result.skipped} layers`);
    }
    if (result.errors > 0) {
        parts.push(`${result.errors} errors occurred`);
    }
    // Add analytics information
    const analytics = [];
    if (result.contentGroups) {
        analytics.push(`${result.contentGroups} content groups processed`);
    }
    if (result.duplicateContentGroups && result.duplicateContentGroups > 0) {
        analytics.push(`${result.duplicateContentGroups} duplicate content groups found`);
    }
    if (result.processingTime) {
        const timeInSeconds = (result.processingTime / 1000).toFixed(1);
        analytics.push(`completed in ${timeInSeconds}s`);
    }
    const summary = parts.length > 0 ? parts.join(', ') : 'No changes made';
    const analyticsText = analytics.length > 0 ? ` (${analytics.join(', ')})` : '';
    return `Processing complete: ${summary}${analyticsText}`;
}
function handlePluginError(error) {
    let message;
    if (error && typeof error === 'object' && 'message' in error && 'code' in error) {
        // PluginError instance
        message = error.message;
    }
    else if (error instanceof Error) {
        message = error.message;
    }
    else {
        message = 'An unexpected error occurred';
    }
    sendMessage({
        type: 'error',
        message
    });
    figma.notify(`Error: ${message}`, { error: true });
}
function sendMessage(message) {
    figma.ui.postMessage(message);
}
// Handle plugin cleanup
figma.on('close', () => {
    isProcessing = false;
});
// Note: Selection changes during processing are handled by the main selection listener above
