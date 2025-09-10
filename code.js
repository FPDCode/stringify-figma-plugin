// Stringify Plugin - Convert text layers to variables
// Enhanced V2 implementation with modular architecture
import { PluginError } from './lib/types';
import { PLUGIN_CONFIG, UI_MESSAGES } from './lib/constants';
import { getValidTextLayers, validateTextLayer, preprocessTextForVariable } from './lib/textProcessor';
import { getVariableCollections, createDefaultCollection, getExistingVariables, createStringVariable, bindTextNodeToVariable, findExistingVariable, createVariableCache, addToVariableCache, getFromVariableCache } from './lib/variableManager';
// Plugin state management
let isProcessing = false;
let currentOperation = null;
// Show the UI
figma.showUI(__html__, PLUGIN_CONFIG.UI_DIMENSIONS);
// Enhanced message handling with comprehensive error handling
figma.ui.onmessage = async (msg) => {
    try {
        currentOperation = msg.type;
        await handleMessage(msg);
    }
    catch (error) {
        console.error(`Error handling message ${msg.type}:`, error);
        handlePluginError(error);
    }
    finally {
        currentOperation = null;
    }
};
async function handleMessage(msg) {
    switch (msg.type) {
        case 'get-collections':
            await handleGetCollections();
            break;
        case 'scan-text-layers':
            await handleScanTextLayers();
            break;
        case 'create-variables':
            await handleCreateVariables(msg.collectionId);
            break;
        case 'create-default-collection':
            await handleCreateDefaultCollection();
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
async function handleScanTextLayers() {
    try {
        const result = getValidTextLayers();
        sendMessage({
            type: 'text-layers-found',
            layers: result.layers.map(layer => ({
                id: layer.id,
                name: layer.name,
                characters: layer.characters
            })),
            validCount: result.validCount,
            totalCount: result.totalCount
        });
        if (result.validCount === 0) {
            const message = result.totalCount > 0
                ? `Found ${result.totalCount} text layers, but none are suitable for variable creation.`
                : 'No text layers found on the current page.';
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
        const { layers: textLayers } = getValidTextLayers();
        if (textLayers.length === 0) {
            throw new PluginError('No valid text layers found for processing');
        }
        const result = await processTextLayersWithProgress(textLayers, collectionId);
        sendMessage({
            type: 'variables-created',
            result
        });
        // Show completion notification
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
async function processTextLayersWithProgress(textLayers, collectionId) {
    const stats = {
        created: 0,
        connected: 0,
        skipped: 0,
        errors: 0
    };
    const existingVariables = await getExistingVariables(collectionId);
    const variableCache = createVariableCache(collectionId);
    const totalLayers = textLayers.length;
    const errors = [];
    for (let i = 0; i < totalLayers; i += PLUGIN_CONFIG.BATCH_SIZE) {
        const batch = textLayers.slice(i, i + PLUGIN_CONFIG.BATCH_SIZE);
        for (const textLayer of batch) {
            try {
                await processTextLayer(textLayer, existingVariables, variableCache, collectionId, stats);
            }
            catch (error) {
                console.error(`Error processing text layer "${textLayer.name}":`, error);
                stats.errors++;
                errors.push({
                    layer: textLayer.name,
                    error: error instanceof Error ? error.message : 'Unknown error'
                });
            }
        }
        // Send progress update
        const processed = Math.min(i + PLUGIN_CONFIG.BATCH_SIZE, totalLayers);
        const progress = Math.round((processed / totalLayers) * 100);
        const remaining = totalLayers - processed;
        sendMessage({
            type: 'progress-update',
            progress,
            remaining
        });
        // Small delay to prevent UI freezing
        await new Promise(resolve => setTimeout(resolve, PLUGIN_CONFIG.PROGRESS_UPDATE_DELAY));
    }
    // Log errors for debugging
    if (errors.length > 0) {
        console.warn('Processing errors:', errors);
    }
    return Object.assign(Object.assign({}, stats), { totalProcessed: stats.created + stats.connected });
}
async function processTextLayer(textLayer, existingVariables, variableCache, collectionId, stats) {
    // Validate the text layer is still processable
    if (!validateTextLayer(textLayer)) {
        stats.skipped++;
        return;
    }
    const { processed: textContent, variableName } = preprocessTextForVariable(textLayer.characters);
    if (!textContent) {
        stats.skipped++;
        return;
    }
    // Check cache first
    let variable = getFromVariableCache(variableCache, variableName, textContent);
    if (variable) {
        // Use cached variable
        bindTextNodeToVariable(textLayer, variable);
        stats.connected++;
    }
    else {
        // Check existing variables
        variable = findExistingVariable(existingVariables, variableName, textContent);
        if (variable) {
            // Connect to existing variable
            bindTextNodeToVariable(textLayer, variable);
            stats.connected++;
        }
        else {
            // Create new variable
            variable = await createStringVariable(collectionId, variableName, textContent);
            // Add to cache for future use
            const collection = await figma.variables.getVariableCollectionByIdAsync(collectionId);
            if (collection) {
                addToVariableCache(variableCache, variable, collection);
            }
            // Connect text layer to new variable
            bindTextNodeToVariable(textLayer, variable);
            stats.created++;
        }
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
    const summary = parts.length > 0 ? parts.join(', ') : 'No changes made';
    return `Processing complete: ${summary}`;
}
function handlePluginError(error) {
    const message = error instanceof PluginError
        ? error.message
        : error instanceof Error
            ? error.message
            : 'An unexpected error occurred';
    sendMessage({
        type: 'error',
        message
    });
    // Also show as notification for better UX
    figma.notify(`Error: ${message}`, { error: true });
}
function sendMessage(message) {
    figma.ui.postMessage(message);
}
// Handle plugin cleanup
figma.on('close', () => {
    isProcessing = false;
    currentOperation = null;
});
// Handle selection changes during processing
figma.on('selectionchange', () => {
    if (isProcessing && currentOperation === 'create-variables') {
        console.warn('Selection changed during processing - results may be inconsistent');
    }
});
