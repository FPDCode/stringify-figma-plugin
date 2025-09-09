"use strict";
// Stringify Plugin - Convert text layers to variables
// This plugin scans text layers and creates corresponding variables
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
// Show the UI
figma.showUI(__html__, { width: 300, height: 400 });
// Utility function to convert text to camelCase
function toCamelCase(text) {
    return text
        .replace(/(?:^\w|[A-Z]|\b\w)/g, (word, index) => {
        return index === 0 ? word.toLowerCase() : word.toUpperCase();
    })
        .replace(/\s+/g, '')
        .replace(/[^a-zA-Z0-9]/g, '');
}
// Utility function to check if two strings are similar
function isSimilarString(str1, str2) {
    const normalize = (str) => str.toLowerCase().replace(/\s+/g, '');
    return normalize(str1) === normalize(str2);
}
// Get all text layers from the current page
function getTextLayers() {
    const textLayers = [];
    function traverse(node) {
        if (node.type === 'TEXT') {
            textLayers.push(node);
        }
        if ('children' in node) {
            for (const child of node.children) {
                traverse(child);
            }
        }
    }
    traverse(figma.currentPage);
    return textLayers;
}
// Get variable collections
function getVariableCollections() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const collections = yield figma.variables.getLocalVariableCollectionsAsync();
            return collections.map(collection => ({
                id: collection.id,
                name: collection.name,
                variables: collection.variableIds
            }));
        }
        catch (error) {
            console.error('Error getting variable collections:', error);
            return [];
        }
    });
}
// Create variables for text layers
function createVariablesForTextLayers(textLayers, collectionId) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const collection = yield figma.variables.getVariableCollectionByIdAsync(collectionId);
            if (!collection) {
                throw new Error('Collection not found');
            }
            let created = 0;
            let connected = 0;
            let errors = 0;
            for (const textLayer of textLayers) {
                try {
                    const textContent = textLayer.characters;
                    if (!textContent || textContent.trim() === '') {
                        continue; // Skip empty text layers
                    }
                    const variableId = toCamelCase(textContent);
                    // Check if variable already exists
                    let existingVariable = null;
                    for (const id of collection.variableIds) {
                        const variable = yield figma.variables.getVariableByIdAsync(id);
                        if (variable &&
                            variable.name === variableId &&
                            variable.valuesByMode[collection.defaultModeId] === textContent) {
                            existingVariable = variable;
                            break;
                        }
                    }
                    if (existingVariable) {
                        // Connect to existing variable
                        textLayer.setBoundVariable('characters', existingVariable);
                        connected++;
                    }
                    else {
                        // Create new variable
                        const newVariable = figma.variables.createVariable(variableId, collection, 'STRING');
                        newVariable.setValueForMode(collection.defaultModeId, textContent);
                        // Connect text layer to new variable
                        textLayer.setBoundVariable('characters', newVariable);
                        created++;
                    }
                }
                catch (error) {
                    console.error(`Error processing text layer "${textLayer.name}":`, error);
                    errors++;
                }
            }
            return { created, connected, errors };
        }
        catch (error) {
            console.error('Error creating variables:', error);
            throw error;
        }
    });
}
// Handle messages from UI
figma.ui.onmessage = (msg) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        if (msg.type === 'get-collections') {
            const collections = yield getVariableCollections();
            figma.ui.postMessage({
                type: 'collections-loaded',
                collections: collections
            });
        }
        if (msg.type === 'scan-text-layers') {
            const textLayers = getTextLayers();
            figma.ui.postMessage({
                type: 'text-layers-found',
                layers: textLayers.map(layer => ({
                    id: layer.id,
                    name: layer.name,
                    characters: layer.characters
                }))
            });
        }
        if (msg.type === 'create-variables' && msg.collectionId) {
            const textLayers = getTextLayers();
            if (textLayers.length === 0) {
                figma.ui.postMessage({
                    type: 'error',
                    message: 'No text layers found on the current page'
                });
                return;
            }
            const result = yield createVariablesForTextLayers(textLayers, msg.collectionId);
            figma.ui.postMessage({
                type: 'variables-created',
                created: result.created,
                connected: result.connected,
                errors: result.errors
            });
        }
    }
    catch (error) {
        figma.ui.postMessage({
            type: 'error',
            message: error instanceof Error ? error.message : 'An error occurred'
        });
    }
});
