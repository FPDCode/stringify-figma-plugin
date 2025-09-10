// lib/variableManager.ts
// Robust variable CRUD operations for the Stringify plugin
import { PluginError } from './types';
import { PLUGIN_CONFIG, ERROR_CODES } from './constants';
import { preprocessTextForVariable } from './textProcessor';
export async function getVariableCollections() {
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
export async function createDefaultCollection() {
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
export async function validateCollection(collectionId) {
    const collection = await figma.variables.getVariableCollectionByIdAsync(collectionId);
    if (!collection) {
        throw new PluginError('Collection not found or has been deleted', {
            code: ERROR_CODES.COLLECTION_NOT_FOUND,
            context: { collectionId }
        });
    }
    return collection;
}
export async function getExistingVariables(collectionId) {
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
export async function createStringVariable(collectionId, variableName, content) {
    try {
        const collection = await validateCollection(collectionId);
        // Check for naming conflicts
        const existingVariables = await getExistingVariables(collectionId);
        const nameConflicts = Array.from(existingVariables.keys())
            .filter(key => key.startsWith(`${variableName}:`));
        let finalVariableName = variableName;
        if (nameConflicts.length > 0) {
            finalVariableName = `${variableName}_${nameConflicts.length + 1}`;
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
export function bindTextNodeToVariable(textNode, variable) {
    try {
        // Verify the text node is still valid
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
export function findExistingVariable(existingVariables, variableName, content) {
    const key = `${variableName}:${content}`;
    return existingVariables.get(key) || null;
}
export function createVariableCache(collectionId) {
    return new Map();
}
export function addToVariableCache(cache, variable, collection) {
    const key = `${variable.name}:${variable.valuesByMode[collection.defaultModeId]}`;
    const content = variable.valuesByMode[collection.defaultModeId];
    cache.set(key, {
        variable,
        name: variable.name,
        content: typeof content === 'string' ? content : String(content)
    });
}
export function getFromVariableCache(cache, variableName, content) {
    const key = `${variableName}:${content}`;
    const entry = cache.get(key);
    return entry ? entry.variable : null;
}
export async function processTextLayerToVariable(textLayer, collectionId, existingVariables, variableCache) {
    const { processed: textContent, variableName } = preprocessTextForVariable(textLayer.characters);
    if (!textContent) {
        throw new PluginError('Invalid text content for variable creation');
    }
    // Check cache first
    let variable = getFromVariableCache(variableCache, variableName, textContent);
    let wasCreated = false;
    if (!variable) {
        // Check existing variables
        variable = findExistingVariable(existingVariables, variableName, textContent);
        if (!variable) {
            // Create new variable
            variable = await createStringVariable(collectionId, variableName, textContent);
            wasCreated = true;
            // Add to cache
            const collection = await validateCollection(collectionId);
            addToVariableCache(variableCache, variable, collection);
        }
    }
    // Bind text layer to variable
    bindTextNodeToVariable(textLayer, variable);
    return { variable, wasCreated };
}
