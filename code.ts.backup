// Stringify Plugin - Convert text layers to variables
// This plugin scans text layers and creates corresponding variables

// Show the UI
figma.showUI(__html__, { width: 380, height: 560 });

// Enhanced text validation - only process text that starts with alphanumeric
function isValidTextForVariable(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  
  // Check if first non-space character is alphanumeric
  const firstChar = trimmed[0];
  return /[A-Za-z0-9]/.test(firstChar);
}

// Enhanced variable naming with underscore-based system
function createVariableName(text: string): string {
  let processed = text.trim();
  
  // Special character mappings
  processed = processed
    .replace(/@/g, '_A_')  // @ → _A_ (for emails/handles)
    .replace(/\s+/g, '_')  // spaces → underscores
    .replace(/[^A-Za-z0-9_]/g, '_'); // all other special chars → underscores
  
  // Remove multiple consecutive underscores
  processed = processed.replace(/_+/g, '_');
  
  // Remove leading/trailing underscores
  processed = processed.replace(/^_+|_+$/g, '');
  
  // Smart truncation for long names (50 char limit with 60/40 split)
  if (processed.length > 50) {
    const startLength = Math.floor(50 * 0.6); // 30 chars
    const endLength = Math.floor(50 * 0.4);   // 20 chars
    const start = processed.substring(0, startLength);
    const end = processed.substring(processed.length - endLength);
    processed = `${start}___${end}`;
  }
  
  return processed;
}

// Utility function to check if two strings are similar
function isSimilarString(str1: string, str2: string): boolean {
  const normalize = (str: string) => str.toLowerCase().replace(/\s+/g, '');
  return normalize(str1) === normalize(str2);
}

// Get all valid text layers from the current page
function getValidTextLayers(): { layers: TextNode[], validCount: number, totalCount: number } {
  const allTextLayers: TextNode[] = [];
  const validTextLayers: TextNode[] = [];
  
  function traverse(node: BaseNode) {
    if (node.type === 'TEXT') {
      const textNode = node as TextNode;
      allTextLayers.push(textNode);
      
      // Check if text is valid for variable creation
      if (isValidTextForVariable(textNode.characters)) {
        // Skip if already bound to a variable
        const boundVariable = textNode.boundVariables?.characters;
        if (!boundVariable) {
          validTextLayers.push(textNode);
        }
      }
    }
    
    if ('children' in node) {
      for (const child of node.children) {
        traverse(child);
      }
    }
  }
  
  traverse(figma.currentPage);
  
  return {
    layers: validTextLayers,
    validCount: validTextLayers.length,
    totalCount: allTextLayers.length
  };
}

// Get variable collections
async function getVariableCollections() {
  try {
    const collections = await figma.variables.getLocalVariableCollectionsAsync();
    
    return collections.map(collection => ({
      id: collection.id,
      name: collection.name,
      variables: collection.variableIds
    }));
  } catch (error) {
    console.error('Error getting variable collections:', error);
    return [];
  }
}

// Create a default collection for text variables
async function createDefaultCollection(): Promise<string | null> {
  try {
    let collectionName = "Text to String";
    let counter = 1;
    
    // Check for name conflicts and add number if needed
    const existingCollections = await figma.variables.getLocalVariableCollectionsAsync();
    const existingNames = existingCollections.map(c => c.name);
    
    while (existingNames.includes(collectionName)) {
      collectionName = `Text to String ${counter}`;
      counter++;
    }
    
    const collection = figma.variables.createVariableCollection(collectionName);
    return collection.id;
  } catch (error) {
    console.error('Error creating default collection:', error);
    return null;
  }
}

// Create variables for text layers with enhanced processing and progress updates
async function createVariablesForTextLayers(textLayers: TextNode[], collectionId: string) {
  try {
    const collection = await figma.variables.getVariableCollectionByIdAsync(collectionId);
    if (!collection) {
      throw new Error('Collection not found');
    }
    
    let created = 0;
    let connected = 0;
    let skipped = 0;
    let errors = 0;
    
    // Pre-load all existing variables for faster duplicate detection
    const existingVariables = new Map<string, Variable>();
    for (const id of collection.variableIds) {
      try {
        const variable = await figma.variables.getVariableByIdAsync(id);
        if (variable) {
          existingVariables.set(variable.name, variable);
        }
      } catch (error) {
        console.warn(`Could not load variable ${id}:`, error);
      }
    }
    
    // Process in batches for better performance and progress updates
    const BATCH_SIZE = 10; // Process 10 text layers at a time
    const totalLayers = textLayers.length;
    
    for (let i = 0; i < totalLayers; i += BATCH_SIZE) {
      const batch = textLayers.slice(i, i + BATCH_SIZE);
      
      // Process batch
      for (const textLayer of batch) {
        try {
          const textContent = textLayer.characters.trim();
          if (!textContent) {
            skipped++;
            continue;
          }
          
          const variableName = createVariableName(textContent);
          
          // Check if variable already exists by name and content
          let existingVariable = null;
          for (const [name, variable] of existingVariables) {
            if (name === variableName && 
                variable.valuesByMode[collection.defaultModeId] === textContent) {
              existingVariable = variable;
              break;
            }
          }
          
          if (existingVariable) {
            // Connect to existing variable
            textLayer.setBoundVariable('characters', existingVariable);
            connected++;
          } else {
            // Create new variable
            const newVariable = figma.variables.createVariable(variableName, collection, 'STRING');
            newVariable.setValueForMode(collection.defaultModeId, textContent);
            
            // Add to our cache for future checks
            existingVariables.set(variableName, newVariable);
            
            // Connect text layer to new variable
            textLayer.setBoundVariable('characters', newVariable);
            created++;
          }
        } catch (error) {
          console.error(`Error processing text layer "${textLayer.name}":`, error);
          errors++;
        }
      }
      
      // Send progress update
      const processed = Math.min(i + BATCH_SIZE, totalLayers);
      const progress = Math.round((processed / totalLayers) * 100);
      const remaining = totalLayers - processed;
      
      figma.ui.postMessage({
        type: 'progress-update',
        progress: progress,
        remaining: remaining
      });
      
      // Small delay to prevent UI freezing
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    
    return { created, connected, skipped, errors };
  } catch (error) {
    console.error('Error creating variables:', error);
    throw error;
  }
}

// Handle messages from UI
figma.ui.onmessage = async (msg: { type: string; collectionId?: string; createCollection?: boolean }) => {
  try {
    if (msg.type === 'get-collections') {
      const collections = await getVariableCollections();
      figma.ui.postMessage({
        type: 'collections-loaded',
        collections: collections
      });
    }
    
    if (msg.type === 'scan-text-layers') {
      const result = getValidTextLayers();
      figma.ui.postMessage({
        type: 'text-layers-found',
        layers: result.layers.map(layer => ({
          id: layer.id,
          name: layer.name,
          characters: layer.characters
        })),
        validCount: result.validCount,
        totalCount: result.totalCount
      });
    }
    
    if (msg.type === 'create-variables' && msg.collectionId) {
      const result = getValidTextLayers();
      if (result.validCount === 0) {
        figma.ui.postMessage({
          type: 'error',
          message: `No valid text layers found. Found ${result.totalCount} text layers total, but none are suitable for variable creation.`
        });
        return;
      }
      
      const processResult = await createVariablesForTextLayers(result.layers, msg.collectionId);
      
      figma.ui.postMessage({
        type: 'variables-created',
        created: processResult.created,
        connected: processResult.connected,
        skipped: processResult.skipped,
        errors: processResult.errors,
        totalProcessed: result.validCount
      });
    }
    
    if (msg.type === 'create-default-collection') {
      const collectionId = await createDefaultCollection();
      if (collectionId) {
        // Refresh collections and return the new one
        const collections = await getVariableCollections();
        figma.ui.postMessage({
          type: 'collection-created',
          collectionId: collectionId,
          collections: collections
        });
      } else {
        figma.ui.postMessage({
          type: 'error',
          message: 'Failed to create default collection'
        });
      }
    }
  } catch (error) {
    figma.ui.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : 'An error occurred'
    });
  }
};
