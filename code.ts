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

interface GhostVariable {
  nodeId: string;
  nodeName: string;
  textContent: string;
  bindingType: 'characters' | 'fontFamily' | 'fontSize' | 'fontWeight' | 'letterSpacing' | 'lineHeight';
  ghostVariableId: string;
}

interface ClearResult {
  totalAttempted: number;
  successfullyCleared: number;
  failed: number;
  errors: Array<{
    nodeId: string;
    nodeName: string;
    error: string;
    bindingType: string;
  }>;
}

interface ProcessingResult extends ProcessingStats {
  totalProcessed: number;
}

interface TextProcessingResult {
  original: string;
  processed: string;
  variableName: string;
}

// Enhanced Scanning Interfaces
interface ScanScope {
  type: 'selection' | 'page';
  targetNodes: SceneNode[];
  textNodeCount: number;
  description: string;
}

interface ScanPreview {
  scopeDescription: string;
  textLayerCount: number;
  selectionSummary?: string;
  hasSelection: boolean;
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
  | { type: 'create-variables'; collectionId: string }
  | { type: 'create-default-collection' }
  | { type: 'scan-ghost-variables' }
  | { type: 'clear-ghost-variables'; ghostIds: string[] }
  | { type: 'select-ghost-layer'; nodeId: string };

type MessageToUI = 
  | { type: 'collections-loaded'; collections: CollectionInfo[] }
  | { type: 'collection-created'; collectionId: string; collections: CollectionInfo[] }
  | { type: 'text-layers-found'; layers: TextLayerInfo[]; validCount: number; totalCount: number; scopeType: 'selection' | 'page' }
  | { type: 'progress-update'; progress: number; remaining: number }
  | { type: 'variables-created'; result: ProcessingResult }
  | { type: 'collection-invalid'; message: string }
  | { type: 'error'; message: string }
  | { type: 'ghost-variables-found'; ghosts: GhostVariable[]; count: number }
  | { type: 'ghost-clear-complete'; result: ClearResult }
  | { type: 'ghost-scan-error'; error: string }
  | { type: 'selection-changed'; scope: ScanPreview }
  | { type: 'scan-scope-detected'; scope: ScanScope };

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
  BINDING_FAILED: 'BINDING_FAILED'
} as const;

const UI_MESSAGES = {
  COLLECTION_CREATED: 'Collection created successfully'
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
    .replace(/\s+/g, '_') // Convert spaces to underscores first
    .replace(VARIABLE_NAME_PATTERNS.REPLACE_CHARS, '_') // Replace other invalid chars with underscores
    .replace(VARIABLE_NAME_PATTERNS.MULTIPLE_UNDERSCORES, '_')
    .replace(VARIABLE_NAME_PATTERNS.EDGE_UNDERSCORES, '');

  if (!processed) {
    processed = 'text_variable';
  }

  return processed;
}

function createHierarchicalVariableName(text: string, textNode: TextNode): string {
  const parts: string[] = [];
  
  // Use the layer name for variable naming (no text content suffix)
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
  
  parts.push(textName);
  
  const finalName = parts.join('/');
  return finalName;
}

function findMeaningfulParent(textNode: TextNode): string {
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

function findRootComponent(textNode: TextNode): string {
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

function isGenericName(name: string): boolean {
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

function sanitizeName(name: string): string {
  if (!name || name.trim().length === 0) {
    return '';
  }
  
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_') // Convert spaces to underscores first
    .replace(VARIABLE_NAME_PATTERNS.REPLACE_CHARS, '_') // Replace other invalid chars with underscores
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
  } catch (error) {
    console.warn(`Error validating text layer ${node.id}:`, error);
    return false;
  }
}

// ============================================================================
// ENHANCED SCANNING - SELECTION DETECTION
// ============================================================================

function determineScanScope(): ScanScope {
  const selection = figma.currentPage.selection;
  
  if (selection.length === 0) {
    // For page scanning, we need to count all valid text nodes on the page
    const allTextNodes = figma.currentPage.findAll(node => node.type === "TEXT") as TextNode[];
    const validTextNodes = allTextNodes.filter(validateTextLayer);
    
    return {
      type: 'page',
      targetNodes: [figma.currentPage as any], // PageNode is not SceneNode, but we need it for scanning
      textNodeCount: validTextNodes.length,
      description: 'Scanning entire page'
    };
  }
  
  // Expand selection to include meaningful containers
  const expandedNodes = expandSelection(selection);
  const textNodeCount = countTextNodesInSelection(expandedNodes);
  
  return {
    type: 'selection',
    targetNodes: expandedNodes,
    textNodeCount: textNodeCount,
    description: `Scanning ${selection.length} selected ${selection.length === 1 ? 'item' : 'items'}`
  };
}

function expandSelection(selection: readonly SceneNode[]): SceneNode[] {
  const expanded: SceneNode[] = [];
  
  selection.forEach(node => {
    expanded.push(node);
    
    // Only expand meaningful containers to avoid including too many nodes
    if (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET' || 
        node.type === 'FRAME' || node.type === 'GROUP') {
      if ('children' in node) {
        expanded.push(...node.children);
      }
    }
  });
  
  return expanded;
}

function countTextNodesInSelection(nodes: readonly SceneNode[]): number {
  // Performance optimization: limit depth to prevent infinite recursion
  const maxDepth = 10;
  let currentDepth = 0;
  
  function countRecursive(nodeList: readonly SceneNode[]): number {
    if (currentDepth >= maxDepth) return 0;
    
    let localCount = 0;
    currentDepth++;
    
    for (const node of nodeList) {
      if (node.type === 'TEXT' && validateTextLayer(node as TextNode)) {
        localCount++;
      } else if ('children' in node && node.children.length > 0) {
        localCount += countRecursive(node.children);
      }
    }
    
    currentDepth--;
    return localCount;
  }
  
  return countRecursive(nodes);
}

function findTextNodesInScope(scope: ScanScope): TextNode[] {
  if (scope.type === 'selection') {
    return findTextNodesInSelection(scope.targetNodes);
  } else {
    return figma.currentPage.findAll(node => 
      node.type === "TEXT" && validateTextLayer(node)
    ) as TextNode[];
  }
}

function findTextNodesInSelection(nodes: readonly SceneNode[]): TextNode[] {
  const textNodes: TextNode[] = [];
  
  nodes.forEach(node => {
    if (node.type === 'TEXT' && validateTextLayer(node)) {
      textNodes.push(node);
    } else if ('children' in node) {
      textNodes.push(...findTextNodesInSelection(node.children));
    }
  });
  
  return textNodes;
}

function createScanPreview(scope: ScanScope): ScanPreview {
  return {
    scopeDescription: scope.description,
    textLayerCount: scope.textNodeCount,
    selectionSummary: scope.type === 'selection' ? 
      `${scope.targetNodes.length} selected items` : undefined,
    hasSelection: scope.type === 'selection'
  };
}

function preprocessTextForVariable(text: string, textNode?: TextNode): TextProcessingResult {
  const trimmed = text.trim();
  return {
    original: text,
    processed: trimmed, // Use text content for variable value
    variableName: createVariableName(trimmed, textNode) // Use layer name for variable name
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
// GHOST VARIABLE DETECTION FUNCTIONS
// ============================================================================

async function scanForGhostVariables(): Promise<GhostVariable[]> {
  try {
    // Phase 1: Build Set of all valid variable IDs from all collections
    const allValidVariableIds = await buildValidVariableIdSet();
    
    // Ghostbuster should always scan the entire page, not selection-aware
    const allTextNodes = figma.currentPage.findAll(node => node.type === "TEXT") as TextNode[];
    
    // Filter for visible text nodes (additional validation)
    const visibleTextNodes = allTextNodes.filter(node => {
      // Check if node is visible and not hidden
      if (!node.visible) return false;
      
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
    
    const ghosts: GhostVariable[] = [];
    
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
  } catch (error) {
    console.error('Error scanning for ghost variables:', error);
    throw new PluginError('Failed to scan for ghost variables');
  }
}

async function buildValidVariableIdSet(): Promise<Set<string>> {
  const allValidVariableIds = new Set<string>();
  
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
    
  } catch (error) {
    console.error('Error building valid variable ID set:', error);
    return allValidVariableIds; // Return empty set on error
  }
}

async function checkVariableConnection(textNode: TextNode, allValidVariableIds: Set<string>): Promise<GhostVariable | null> {
  const binding = 'characters';
  
  try {
    // Pre-check: Only process layers that actually have bound variables
    if (!textNode.boundVariables || !textNode.boundVariables[binding]) {
      return null; // No connection - not a ghost
    }
    
    const boundVariable = (textNode as any).getBoundVariable(binding);
    
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
    
  } catch (error) {
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

async function clearGhostVariables(ghostIds: string[]): Promise<ClearResult> {
  const result: ClearResult = {
    totalAttempted: ghostIds.length,
    successfullyCleared: 0,
    failed: 0,
    errors: []
  };

  for (const nodeId of ghostIds) {
    try {
      const node = await figma.getNodeByIdAsync(nodeId) as TextNode;
      
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
      const bindings = ['characters'] as const;
      let clearedAny = false;
      
      for (const binding of bindings) {
        try {
          const boundVariable = (node as any).getBoundVariable(binding);
          if (boundVariable) {
            // Check if this is actually a ghost (variable doesn't exist)
            const variable = await figma.variables.getVariableByIdAsync(boundVariable.id);
            if (!variable) {
              // Clear the ghost binding
              node.setBoundVariable(binding, null);
              clearedAny = true;
            }
          }
        } catch (error) {
          // Binding exists but variable is inaccessible - clear it
          node.setBoundVariable(binding, null);
          clearedAny = true;
        }
      }
      
      if (clearedAny) {
        result.successfullyCleared++;
      } else {
        result.failed++;
        result.errors.push({
          nodeId,
          nodeName: node.name,
          error: 'No ghost bindings found to clear',
          bindingType: 'unknown'
        });
      }
      
    } catch (error) {
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

// Enhanced Scanning - Optimized Selection Change Handler
let selectionChangeTimeout: number | null = null;
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
        const preview = createScanPreview(scope);
        
        // Only send update if UI is ready and not processing
        if (!isProcessing) {
          figma.ui.postMessage({
            type: 'selection-changed',
            scope: preview
          });
          
          // Also trigger a text layer scan to update the main counter
          try {
            const textLayers = findTextNodesInScope(scope);
            const layers: TextLayerInfo[] = textLayers.map((layer: TextNode) => ({
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
          } catch (error) {
            console.warn('Error scanning text layers for selection change:', error);
          }
        }
      }
    } catch (error) {
      console.warn('Error handling selection change:', error);
    }
  }, 50); // 50ms debounce for smooth performance
});

// Enhanced message handling with comprehensive error handling
figma.ui.onmessage = async (msg: MessageFromUI) => {
  try {
    await handleMessage(msg);
  } catch (error) {
    console.error(`Error handling message ${msg.type}:`, error);
    handlePluginError(error);
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
    
    // Enhanced Scanning - Use selection-aware logic
    const scope = determineScanScope();
    const textNodes = findTextNodesInScope(scope);
    
    // Send scope information to UI
    sendMessage({
      type: 'scan-scope-detected',
      scope: scope
    });
    
    // Convert to layer info format
    const layers: TextLayerInfo[] = textNodes.map((layer: TextNode) => ({
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
  } catch (error) {
    throw new PluginError(`Failed to scan text layers: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function handleCreateVariables(collectionId: string): Promise<void> {
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
    const textLayers = findTextNodesInScope(scope);
    
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

async function handleScanGhostVariables(): Promise<void> {
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
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    sendMessage({
      type: 'ghost-scan-error',
      error: errorMessage
    });
    throw new PluginError(`Failed to scan ghost variables: ${errorMessage}`);
  }
}

async function handleClearGhostVariables(ghostIds: string[]): Promise<void> {
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
  } catch (error) {
    throw new PluginError(`Failed to clear ghost variables: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function handleSelectGhostLayer(nodeId: string): Promise<void> {
  try {
    const node = await figma.getNodeByIdAsync(nodeId) as SceneNode;
    
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
  } catch (error) {
    console.error('Error selecting ghost layer:', error);
    figma.notify('Failed to select layer', { error: true, timeout: 3000 });
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
});

// Note: Selection changes during processing are handled by the main selection listener above