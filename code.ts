// Stringify Plugin - Convert text layers to variables
// Enhanced V2 implementation with consolidated modular architecture


// ============================================================================
// TYPES AND INTERFACES
// ============================================================================

interface ProcessingStats {
  created: number;
  connected: number;
  skipped: number;
  errors: number;
}

interface CollectionInfo {
  id: string;
  name: string;
  variables: string[];
}

interface TextLayerInfo {
  id: string;
  name: string;
  characters: string;
  node?: TextNode;
}

interface ProcessingResult extends ProcessingStats {
  totalProcessed: number;
}

interface TextProcessingResult {
  original: string;
  processed: string;
  variableName: string;
}

interface VariableCacheEntry {
  variable: Variable;
  name: string;
  content: string;
}

class PluginError extends Error {
  public readonly code?: string;
  public readonly context?: Record<string, unknown>;

  constructor(message: string, options?: { code?: string; context?: Record<string, unknown> }) {
    super(message);
    this.name = 'PluginError';
    this.code = options?.code;
    this.context = options?.context;
  }
}

type MessageFromUI = 
  | { type: 'get-collections' }
  | { type: 'scan-text-layers'; selectedCollectionId?: string }
  | { type: 'create-variables'; collectionId: string; options?: Record<string, unknown> }
  | { type: 'create-default-collection' };

type MessageToUI = 
  | { type: 'collections-loaded'; collections: CollectionInfo[] }
  | { type: 'collection-created'; collectionId: string; collections: CollectionInfo[] }
  | { type: 'text-layers-found'; layers: TextLayerInfo[]; validCount: number; totalCount: number }
  | { type: 'progress-update'; progress: number; remaining: number }
  | { type: 'variables-created'; result: ProcessingResult }
  | { type: 'collection-invalid'; message: string }
  | { type: 'error'; message: string };

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
    height: 560
  }
} as const;


const ERROR_CODES = {
  COLLECTION_NOT_FOUND: 'COLLECTION_NOT_FOUND',
  INVALID_TEXT: 'INVALID_TEXT',
  VARIABLE_CREATION_FAILED: 'VARIABLE_CREATION_FAILED',
  BINDING_FAILED: 'BINDING_FAILED',
  NO_VALID_LAYERS: 'NO_VALID_LAYERS',
  PROCESSING_IN_PROGRESS: 'PROCESSING_IN_PROGRESS',
  COLLECTION_ID_REQUIRED: 'COLLECTION_ID_REQUIRED'
} as const;

const UI_MESSAGES = {
  SCANNING: 'Scanning text layers...',
  PROCESSING: 'Creating variables...',
  COMPLETED: 'Processing completed successfully',
  NO_COLLECTIONS: 'No variable collections found',
  NO_LAYERS: 'No valid text layers found',
  SELECT_COLLECTION: 'Please select a collection first',
  PROCESSING_IN_PROGRESS: 'Processing is already in progress',
  COLLECTION_CREATED: 'Collection created successfully',
  VARIABLES_CREATED: 'Variables created successfully'
} as const;

const VARIABLE_NAME_PATTERNS = {
  SAFE_CHARS: /[A-Za-z0-9_]/,
  REPLACE_CHARS: /[^A-Za-z0-9_]/g,
  MULTIPLE_UNDERSCORES: /_{2,}/g,
  EDGE_UNDERSCORES: /^_+|_+$/g
} as const;

// ============================================================================
// TEXT PROCESSING FUNCTIONS
// ============================================================================

function isValidTextForVariable(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length === 0) return false;
  
  const firstChar = trimmed[0];
  return VARIABLE_NAME_PATTERNS.SAFE_CHARS.test(firstChar);
}

function createVariableName(text: string, textNode?: TextNode): string {
  if (!text || text.trim().length === 0) {
    throw new PluginError('Cannot create variable name from empty text', {
      code: ERROR_CODES.INVALID_TEXT
    });
  }

  // If no textNode provided, use simple naming
  if (!textNode) {
    return createSimpleVariableName(text);
  }

  // Create hierarchical naming: Group 2 / Group 1 / Name
  const hierarchicalName = createHierarchicalVariableName(text, textNode);
  
  if (hierarchicalName.length > PLUGIN_CONFIG.MAX_VARIABLE_NAME_LENGTH) {
    return truncateVariableName(hierarchicalName);
  }

  return hierarchicalName;
}

function createSimpleVariableName(text: string): string {
  let processed = text
    .trim()
    .toLowerCase()
    .replace(VARIABLE_NAME_PATTERNS.REPLACE_CHARS, '')
    .replace(/\s+/g, '_')
    .replace(VARIABLE_NAME_PATTERNS.MULTIPLE_UNDERSCORES, '_')
    .replace(VARIABLE_NAME_PATTERNS.EDGE_UNDERSCORES, '');

  if (!processed) {
    processed = 'text_variable';
  }

  return processed;
}

function createHierarchicalVariableName(text: string, textNode: TextNode): string {
  const parts: string[] = [];
  
  // Get the text layer name (sanitized)
  const textName = sanitizeName(text.trim());
  if (!textName) {
    return 'text_variable';
  }
  
  // Find Group 1 (one level higher than text layer)
  let group1 = '';
  const parent = textNode.parent;
  
  if (parent && parent.type !== 'PAGE') {
    group1 = sanitizeName(parent.name);
  }
  
  // Find Group 2 (root component or "root")
  let group2 = 'root';
  let currentParent = parent;
  
  // Traverse up to find the root component
  while (currentParent && currentParent.type !== 'PAGE') {
    if (currentParent.type === 'COMPONENT' || currentParent.type === 'COMPONENT_SET') {
      group2 = sanitizeName(currentParent.name);
      break;
    }
    currentParent = currentParent.parent;
  }
  
  // Build the hierarchical name: Group 2 / Group 1 / Name
  if (group2 && group2 !== 'root') {
    parts.push(group2);
  }
  
  if (group1) {
    parts.push(group1);
  }
  
  parts.push(textName);
  
  return parts.join('_');
}

function sanitizeName(name: string): string {
  if (!name || name.trim().length === 0) {
    return '';
  }
  
  return name
    .trim()
    .toLowerCase()
    .replace(VARIABLE_NAME_PATTERNS.REPLACE_CHARS, '')
    .replace(/\s+/g, '_')
    .replace(VARIABLE_NAME_PATTERNS.MULTIPLE_UNDERSCORES, '_')
    .replace(VARIABLE_NAME_PATTERNS.EDGE_UNDERSCORES, '');
}

function truncateVariableName(text: string): string {
  const maxLength = PLUGIN_CONFIG.MAX_VARIABLE_NAME_LENGTH;
  const separator = '___';
  const availableLength = maxLength - separator.length;
  
  const startLength = Math.ceil(availableLength * 0.6);
  const endLength = Math.floor(availableLength * 0.4);
  
  const start = text.substring(0, startLength);
  const end = text.substring(text.length - endLength);
  
  return `${start}${separator}${end}`;
}

function validateTextLayer(node: TextNode): boolean {
  try {
    // Skip layers already bound to variables
    if (node.boundVariables?.characters) {
      console.log(`Skipping ${node.name}: already bound to variable`);
      return false;
    }
    
    // Skip locked layers
    if (node.locked) {
      console.log(`Skipping ${node.name}: layer is locked`);
      return false;
    }
    
    // Skip hidden layers - check both visible property and parent visibility
    if (!node.visible) {
      console.log(`Skipping ${node.name}: layer is hidden (visible: ${node.visible})`);
      return false;
    }
    
    // Additional check: if parent is hidden, this layer should also be considered hidden
    let parent = node.parent;
    while (parent && parent.type !== 'PAGE') {
      if ('visible' in parent && !parent.visible) {
        console.log(`Skipping ${node.name}: parent layer "${parent.name}" is hidden`);
        return false;
      }
      parent = parent.parent;
    }
    
    // Check if text content is valid for variable creation
    const isValidText = isValidTextForVariable(node.characters);
    if (!isValidText) {
      console.log(`Skipping ${node.name}: invalid text content`);
      return false;
    }
    
    console.log(`Including ${node.name}: valid text layer`);
    return true;
  } catch (error) {
    console.warn(`Error validating text layer ${node.id}:`, error);
    return false;
  }
}

function getValidTextLayers(): { 
  layers: TextNode[], 
  validCount: number, 
  totalCount: number 
} {
  try {
    const allTextNodes = figma.currentPage.findAll(node => node.type === "TEXT") as TextNode[];
    console.log(`Found ${allTextNodes.length} total text layers on page`);
    
    const validTextNodes = allTextNodes.filter(validateTextLayer);
    
    console.log(`Validation complete: ${validTextNodes.length} valid layers out of ${allTextNodes.length} total`);
    
    return {
      layers: validTextNodes,
      validCount: validTextNodes.length,
      totalCount: allTextNodes.length
    };
  } catch (error) {
    console.error('Error scanning text layers:', error);
    throw new PluginError('Failed to scan text layers');
  }
}

function preprocessTextForVariable(text: string, textNode?: TextNode): TextProcessingResult {
  const trimmed = text.trim();
  return {
    original: text,
    processed: trimmed,
    variableName: createVariableName(trimmed, textNode)
  };
}

// ============================================================================
// VARIABLE MANAGEMENT FUNCTIONS
// ============================================================================

async function getVariableCollections(): Promise<CollectionInfo[]> {
  try {
    const collections = await figma.variables.getLocalVariableCollectionsAsync();
    
    return collections.map(collection => ({
      id: collection.id,
      name: collection.name,
      variables: collection.variableIds
    }));
  } catch (error) {
    console.error('Error getting variable collections:', error);
    throw new PluginError('Failed to load variable collections');
  }
}

async function createDefaultCollection(): Promise<string> {
  try {
    let collectionName: string = PLUGIN_CONFIG.DEFAULT_COLLECTION_NAME;
    let counter = 1;
    
    const existingCollections = await figma.variables.getLocalVariableCollectionsAsync();
    const existingNames = new Set(existingCollections.map(c => c.name));
    
    while (existingNames.has(collectionName)) {
      collectionName = `${PLUGIN_CONFIG.DEFAULT_COLLECTION_NAME} ${++counter}`;
    }
    
    const collection = figma.variables.createVariableCollection(collectionName);
    return collection.id;
  } catch (error) {
    console.error('Error creating default collection:', error);
    throw new PluginError('Failed to create default collection');
  }
}

async function validateCollection(collectionId: string): Promise<VariableCollection> {
  const collection = await figma.variables.getVariableCollectionByIdAsync(collectionId);
  
  if (!collection) {
    throw new PluginError('Collection not found or has been deleted', { 
      code: ERROR_CODES.COLLECTION_NOT_FOUND,
      context: { collectionId }
    });
  }
  
  return collection;
}

async function getExistingVariables(collectionId: string): Promise<Map<string, Variable>> {
  try {
    const collection = await validateCollection(collectionId);
    const variableMap = new Map<string, Variable>();
    
    for (const variableId of collection.variableIds) {
      try {
        const variable = await figma.variables.getVariableByIdAsync(variableId);
        if (variable && variable.resolvedType === 'STRING') {
          const key = `${variable.name}:${variable.valuesByMode[collection.defaultModeId]}`;
          variableMap.set(key, variable);
        }
      } catch (error) {
        console.warn(`Could not load variable ${variableId}:`, error);
      }
    }
    
    return variableMap;
  } catch (error) {
    if (error instanceof PluginError) throw error;
    throw new PluginError('Failed to load existing variables');
  }
}

async function createStringVariable(
  collectionId: string, 
  variableName: string, 
  content: string
): Promise<Variable> {
  try {
    const collection = await validateCollection(collectionId);
    
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
  } catch (error) {
    console.error(`Error creating variable "${variableName}":`, error);
    throw new PluginError(
      `Failed to create variable: ${variableName}`, 
      { 
        code: ERROR_CODES.VARIABLE_CREATION_FAILED, 
        context: { variableName, content, originalError: error instanceof Error ? error.message : String(error) } 
      }
    );
  }
}

function bindTextNodeToVariable(textNode: TextNode, variable: Variable): void {
  try {
    if (textNode.removed) {
      throw new Error('Text node has been removed');
    }
    
    if (textNode.locked) {
      throw new Error('Text node is locked');
    }
    
    textNode.setBoundVariable('characters', variable);
  } catch (error) {
    console.error(`Error binding text node ${textNode.id} to variable ${variable.id}:`, error);
    throw new PluginError(
      'Failed to bind text node to variable', 
      { 
        code: ERROR_CODES.BINDING_FAILED, 
        context: { 
          nodeId: textNode.id, 
          nodeName: textNode.name,
          variableId: variable.id, 
          variableName: variable.name,
          originalError: error instanceof Error ? error.message : String(error)
        } 
      }
    );
  }
}

function findExistingVariable(
  existingVariables: Map<string, Variable>, 
  variableName: string, 
  content: string
): Variable | null {
  const key = `${variableName}:${content}`;
  return existingVariables.get(key) || null;
}

function createVariableCache(): Map<string, VariableCacheEntry> {
  return new Map<string, VariableCacheEntry>();
}

function addToVariableCache(
  cache: Map<string, VariableCacheEntry>,
  variable: Variable,
  collection: VariableCollection
): void {
  const key = `${variable.name}:${variable.valuesByMode[collection.defaultModeId]}`;
  const content = variable.valuesByMode[collection.defaultModeId];
  cache.set(key, {
    variable,
    name: variable.name,
    content: typeof content === 'string' ? content : String(content)
  });
}

function getFromVariableCache(
  cache: Map<string, VariableCacheEntry>,
  variableName: string,
  content: string
): Variable | null {
  const key = `${variableName}:${content}`;
  const entry = cache.get(key);
  return entry ? entry.variable : null;
}

// ============================================================================
// PLUGIN STATE MANAGEMENT
// ============================================================================

// Plugin state management
let isProcessing = false;
let currentOperation: string | null = null;

// ============================================================================
// MAIN PLUGIN LOGIC
// ============================================================================

// Show the UI
figma.showUI(__html__, PLUGIN_CONFIG.UI_DIMENSIONS);

// Enhanced message handling with comprehensive error handling
figma.ui.onmessage = async (msg: MessageFromUI) => {
  try {
    currentOperation = msg.type;
    await handleMessage(msg);
  } catch (error) {
    console.error(`Error handling message ${msg.type}:`, error);
    handlePluginError(error);
  } finally {
    currentOperation = null;
  }
};

async function handleMessage(msg: MessageFromUI): Promise<void> {
  switch (msg.type) {
    case 'get-collections':
      await handleGetCollections();
      break;
    case 'scan-text-layers':
      await handleScanTextLayers(msg.selectedCollectionId);
      break;
    case 'create-variables':
      await handleCreateVariables(msg.collectionId, msg.options);
      break;
    case 'create-default-collection':
      await handleCreateDefaultCollection();
      break;
    default:
      throw new Error(`Unknown message type: ${(msg as { type: string }).type}`);
  }
}

async function handleGetCollections(): Promise<void> {
  try {
    const collections = await getVariableCollections();
    sendMessage({
      type: 'collections-loaded',
      collections
    });
  } catch (error) {
    throw new PluginError(`Failed to load collections: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function handleScanTextLayers(selectedCollectionId?: string): Promise<void> {
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
    
    const result = getValidTextLayers();
    
    sendMessage({
      type: 'text-layers-found',
      layers: result.layers.map((layer: TextNode) => ({
        id: layer.id,
        name: layer.name,
        characters: layer.characters
      })),
      validCount: result.validCount,
      totalCount: result.totalCount
    });
    
    if (result.validCount === 0) {
      const message = result.totalCount > 0 
        ? `Found ${result.totalCount} text layers, but none are suitable for variable creation (may be hidden, locked, or already bound to variables).`
        : 'No text layers found on the current page.';
      
      figma.notify(message, { timeout: 3000 });
    }
  } catch (error) {
    throw new PluginError(`Failed to scan text layers: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function handleCreateVariables(collectionId: string, options?: Record<string, unknown>): Promise<void> {
  // options parameter reserved for future extensibility
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

    const summary = createProcessingSummary(result);
    figma.notify(summary, { timeout: 5000 });
    
  } finally {
    isProcessing = false;
  }
}

async function handleCreateDefaultCollection(): Promise<void> {
  try {
    const collectionId = await createDefaultCollection();
    const collections = await getVariableCollections();
    
    sendMessage({
      type: 'collection-created',
      collectionId,
      collections
    });
    
    figma.notify(UI_MESSAGES.COLLECTION_CREATED, { timeout: 3000 });
  } catch (error) {
    throw new PluginError(`Failed to create collection: ${error instanceof Error ? error.message : String(error)}`);
  }
}


async function processTextLayersWithProgress(
  textLayers: TextNode[], 
  collectionId: string
): Promise<ProcessingResult> {
  const stats: ProcessingStats = {
    created: 0,
    connected: 0,
    skipped: 0,
    errors: 0
  };

  const existingVariables = await getExistingVariables(collectionId);
  const variableCache = createVariableCache();
  const totalLayers = textLayers.length;
  const errors: Array<{ layer: string; error: string }> = [];

  for (let i = 0; i < totalLayers; i += PLUGIN_CONFIG.BATCH_SIZE) {
    const batch = textLayers.slice(i, i + PLUGIN_CONFIG.BATCH_SIZE);
    
    for (const textLayer of batch) {
      try {
        await processTextLayer(textLayer, existingVariables, variableCache, collectionId, stats);
      } catch (error) {
        console.error(`Error processing text layer "${textLayer.name}":`, error);
        stats.errors++;
        errors.push({
          layer: textLayer.name,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }
    
    const processed = Math.min(i + PLUGIN_CONFIG.BATCH_SIZE, totalLayers);
    const progress = Math.round((processed / totalLayers) * 100);
    const remaining = totalLayers - processed;
    
    sendMessage({
      type: 'progress-update',
      progress,
      remaining
    });
    
    await new Promise(resolve => setTimeout(resolve, PLUGIN_CONFIG.PROGRESS_UPDATE_DELAY));
  }

  if (errors.length > 0) {
    console.warn('Processing errors:', errors);
  }

  return {
    ...stats,
    totalProcessed: stats.created + stats.connected
  };
}

async function processTextLayer(
  textLayer: TextNode,
  existingVariables: Map<string, Variable>,
  variableCache: Map<string, VariableCacheEntry>,
  collectionId: string,
  stats: ProcessingStats
): Promise<void> {
  if (!validateTextLayer(textLayer)) {
    stats.skipped++;
    return;
  }

  // Process text layer using standard logic with hierarchical naming
  const { processed: textContent, variableName } = preprocessTextForVariable(textLayer.characters, textLayer);
  
  console.log(`Creating variable for "${textLayer.name}": "${textContent}" → "${variableName}"`);
  
  if (!textContent) {
    stats.skipped++;
    return;
  }

  let variable = getFromVariableCache(variableCache, variableName, textContent);
  
  if (variable) {
    bindTextNodeToVariable(textLayer, variable);
    stats.connected++;
  } else {
    variable = findExistingVariable(existingVariables, variableName, textContent);
    
    if (variable) {
      bindTextNodeToVariable(textLayer, variable);
      stats.connected++;
    } else {
      variable = await createStringVariable(collectionId, variableName, textContent);
      
      const collection = await figma.variables.getVariableCollectionByIdAsync(collectionId);
      if (collection) {
        addToVariableCache(variableCache, variable, collection);
      }
      
      bindTextNodeToVariable(textLayer, variable);
      stats.created++;
    }
  }
}


function createProcessingSummary(result: ProcessingResult): string {
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

function handlePluginError(error: unknown): void {
  let message: string;
  
  if (error && typeof error === 'object' && 'message' in error && 'code' in error) {
    // PluginError instance
    message = (error as { message: string }).message;
  } else if (error instanceof Error) {
    message = error.message;
  } else {
    message = 'An unexpected error occurred';
  }
  
  sendMessage({
    type: 'error',
    message
  });
  
  figma.notify(`Error: ${message}`, { error: true });
}

function sendMessage(message: MessageToUI): void {
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