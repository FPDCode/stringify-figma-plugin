
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

interface ContentGroup {
  content: string;
  trimmedContent: string;
  variableName: string;
  layers: TextLayerInfo[];
  existingVariableId?: string;
  needsNewVariable: boolean;
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
  contentGroups?: number;
  duplicateContentGroups?: number;
  processingTime?: number;
}

interface DetailedProcessingError {
  layerId: string;
  layerName: string;
  content: string;
  error: string;
  errorCode?: string;
  timestamp: number;
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
  | { type: 'select-ghost-layer'; nodeId: string }
  | { type: 'get-naming-preference' }
  | { type: 'update-naming-preference'; namingMode: 'simple' | 'hierarchical' };

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
  | { type: 'scan-scope-detected'; scope: ScanScope }
  | { type: 'naming-preference-loaded'; namingMode: 'simple' | 'hierarchical' }
  | { type: 'naming-preference-updated'; namingMode: 'simple' | 'hierarchical' };

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

const NAMING_CONSTANTS = {
  STORAGE_KEY: 'namingConvention',
  DEFAULT_MODE: 'simple' as const,
  MODES: {
    SIMPLE: 'simple' as const,
    HIERARCHICAL: 'hierarchical' as const
  }
} as const;

// ============================================================================
// PREFERENCE MANAGEMENT
// ============================================================================

class PreferenceManager {
  private static readonly STORAGE_KEY = NAMING_CONSTANTS.STORAGE_KEY;
  
  /**
   * Load naming mode preference from storage
   * Defaults to 'simple' for new users as per PRD
   */
  static async loadNamingMode(): Promise<'simple' | 'hierarchical'> {
    try {
      const saved = await figma.clientStorage.getAsync(this.STORAGE_KEY);
      return saved === 'hierarchical' ? 'hierarchical' : 'simple';
    } catch (error) {
      console.warn('Error loading naming preference:', error);
      return NAMING_CONSTANTS.DEFAULT_MODE;
    }
  }
  
  /**
   * Save naming mode preference to storage
   */
  static async saveNamingMode(mode: 'simple' | 'hierarchical'): Promise<void> {
    try {
      await figma.clientStorage.setAsync(this.STORAGE_KEY, mode);
    } catch (error) {
      console.error('Error saving naming preference:', error);
      throw new PluginError('Failed to save naming preference');
    }
  }
}

// ============================================================================
// TEXT PROCESSING FUNCTIONS
// ============================================================================

function isValidTextForVariable(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length === 0) return false;
  
  const firstChar = trimmed[0];
  return VARIABLE_NAME_PATTERNS.SAFE_CHARS.test(firstChar);
}

function createVariableName(text: string, textNode?: TextNode, namingMode?: 'simple' | 'hierarchical'): string {
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
 * Sanitize text content for simple mode variable names
 * - Preserve original capitalization (Live Activities → Live_Activities)
 * - Replace spaces and periods with underscores
 * - Handle special characters like hierarchical mode but preserve case
 * - Apply robust processing without parent hierarchy
 */
function sanitizeSimpleVariableName(text: string): string {
  if (!text || text.trim().length === 0) {
    return 'text_variable';
  }
  
  return text
    .trim()
    // Keep original capitalization - do NOT convert to lowercase
    // Enhanced character handling for common special cases (preserve case)
    .replace(/@/g, '_at_')           // email@domain.com → email_at_domain_com
    .replace(/#/g, '_hash_')         // #hashtag → _hash_hashtag
    .replace(/\$/g, '_dollar_')      // $99 → _dollar_99
    .replace(/%/g, '_percent_')      // 50% → 50_percent_
    .replace(/&/g, '_and_')          // A & B → A_and_B
    .replace(/\+/g, '_plus_')        // A + B → A_plus_B
    .replace(/=/g, '_equals_')       // A = B → A_equals_B
    .replace(/\./g, '_')             // Handle periods: "Live Activities 2.0" → "Live_Activities_2_0"
    .replace(/\s+/g, '_')            // Convert spaces to underscores
    .replace(VARIABLE_NAME_PATTERNS.REPLACE_CHARS, '_') // Replace other invalid chars with underscores
    .replace(VARIABLE_NAME_PATTERNS.MULTIPLE_UNDERSCORES, '_')
    .replace(VARIABLE_NAME_PATTERNS.EDGE_UNDERSCORES, '');
}

/**
 * Generate simple variable name using hierarchical processing logic but without parent hierarchy
 * - Use robust sanitization from hierarchical mode
 * - Preserve capitalization (Live Activities = Live_Activities)
 * - Handle periods by converting to underscores
 * - Apply length limits with existing truncation
 */
function generateSimpleVariableName(textContent: string): string {
  // Use the robust sanitization logic but preserve capitalization
  const sanitized = sanitizeSimpleVariableName(textContent);
  
  // Ensure it starts with a valid character for Figma variables
  let processed = sanitized;
  if (!/^[a-zA-Z_]/.test(processed)) {
    processed = `Var_${processed}`;
  }
  
  // Apply existing truncation logic if too long
  if (processed.length > PLUGIN_CONFIG.MAX_VARIABLE_NAME_LENGTH) {
    return truncateVariableName(processed);
  }
  
  return processed;
}

function createHierarchicalVariableName(text: string, textNode: TextNode): string {
  const parts: string[] = [];
  
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
    // Enhanced character handling for common special cases
    .replace(/@/g, '_at_')           // email@domain.com → email_at_domain_com
    .replace(/#/g, '_hash_')         // #hashtag → _hash_hashtag
    .replace(/\$/g, '_dollar_')      // $99 → _dollar_99
    .replace(/%/g, '_percent_')      // 50% → 50_percent_
    .replace(/&/g, '_and_')          // A & B → A_and_B
    .replace(/\+/g, '_plus_')        // A + B → A_plus_B
    .replace(/=/g, '_equals_')       // A = B → A_equals_B
    .replace(/\s+/g, '_')            // Convert spaces to underscores
    .replace(VARIABLE_NAME_PATTERNS.REPLACE_CHARS, '_') // Replace other invalid chars with underscores
    .replace(VARIABLE_NAME_PATTERNS.MULTIPLE_UNDERSCORES, '_')
    .replace(VARIABLE_NAME_PATTERNS.EDGE_UNDERSCORES, '');
}

/**
 * Smart truncation specifically designed for simple mode variable names
 * Preserves word boundaries and meaningful content for better readability
 */
function truncateSimpleVariableName(text: string): string {
  const maxLength = PLUGIN_CONFIG.MAX_VARIABLE_NAME_LENGTH;
  if (text.length <= maxLength) return text;
  
  const separator = '___';
  const availableLength = maxLength - separator.length;
  
  // Split by underscores (word boundaries in simple mode)
  const words = text.split('_').filter(word => word.length > 0);
  
  if (words.length <= 2) {
    // For 1-2 words, use character-based truncation
    const startLength = Math.floor(availableLength * 0.6);
    const endLength = availableLength - startLength;
    const start = text.substring(0, startLength);
    const end = text.substring(text.length - endLength);
    return `${start}${separator}${end}`;
  }
  
  // For multiple words, try to preserve meaningful start and end words
  let result = '';
  let startWords = [];
  let endWords = [];
  
  // Add words from the start until we use about 60% of available space
  const targetStartLength = Math.floor(availableLength * 0.6);
  let currentStartLength = 0;
  
  for (let i = 0; i < words.length; i++) {
    const wordWithUnderscore = (i === 0) ? words[i] : `_${words[i]}`;
    if (currentStartLength + wordWithUnderscore.length <= targetStartLength) {
      startWords.push(words[i]);
      currentStartLength += wordWithUnderscore.length;
    } else {
      break;
    }
  }
  
  // Add words from the end until we fill remaining space
  const remainingLength = availableLength - currentStartLength;
  let currentEndLength = 0;
  
  for (let i = words.length - 1; i >= startWords.length; i--) {
    const wordWithUnderscore = `_${words[i]}`;
    if (currentEndLength + wordWithUnderscore.length <= remainingLength) {
      endWords.unshift(words[i]);
      currentEndLength += wordWithUnderscore.length;
    } else {
      break;
    }
  }
  
  // Construct the final truncated name
  const startPart = startWords.join('_');
  const endPart = endWords.join('_');
  
  if (endPart.length > 0) {
    return `${startPart}${separator}${endPart}`;
  } else {
    // If no end words fit, just use start words
    return startPart.substring(0, maxLength);
  }
}

function truncateVariableName(text: string): string {
  const maxLength = PLUGIN_CONFIG.MAX_VARIABLE_NAME_LENGTH;
  if (text.length <= maxLength) return text;
  
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
      } else {
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


function groupTextLayersByContent(textLayers: TextLayerInfo[], namingMode: 'simple' | 'hierarchical' = 'simple'): ContentGroup[] {
  const contentMap = new Map<string, ContentGroup>();
  
  textLayers.forEach(layer => {
    const trimmedContent = layer.characters.trim();
    
    // For simple mode, use case-sensitive grouping to preserve exact content matching
    // For hierarchical mode, use case-insensitive grouping as before
    const contentKey = namingMode === 'simple' 
      ? trimmedContent  // Case-sensitive for simple mode
      : trimmedContent.toLowerCase(); // Case-insensitive for hierarchical mode
    
    if (contentMap.has(contentKey)) {
      // Add to existing group
      contentMap.get(contentKey)!.layers.push(layer);
    } else {
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

function analyzeContentGroups(groups: ContentGroup[]): {
  totalLayers: number;
  uniqueContent: number;
  duplicateContent: number;
  averageLayersPerGroup: number;
} {
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

// Initialize plugin by loading naming preference
async function initializePlugin(): Promise<void> {
  try {
    const namingMode = await PreferenceManager.loadNamingMode();
    sendMessage({
      type: 'naming-preference-loaded',
      namingMode
    });
  } catch (error) {
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
    case 'get-naming-preference':
      await handleGetNamingPreference();
      break;
    case 'update-naming-preference':
      await handleUpdateNamingPreference(msg.namingMode);
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

async function handleGetNamingPreference(): Promise<void> {
  try {
    const namingMode = await PreferenceManager.loadNamingMode();
    sendMessage({
      type: 'naming-preference-loaded',
      namingMode
    });
  } catch (error) {
    console.error('Error loading naming preference:', error);
    // Send default mode on error
    sendMessage({
      type: 'naming-preference-loaded',
      namingMode: NAMING_CONSTANTS.DEFAULT_MODE
    });
  }
}

async function handleUpdateNamingPreference(namingMode: 'simple' | 'hierarchical'): Promise<void> {
  try {
    await PreferenceManager.saveNamingMode(namingMode);
    sendMessage({
      type: 'naming-preference-updated',
      namingMode
    });
    
    // Provide user feedback
    const modeLabel = namingMode === 'simple' ? 'Simple' : 'Advanced';
    figma.notify(`Naming mode switched to ${modeLabel}`, { timeout: 2000 });
  } catch (error) {
    console.error('Error updating naming preference:', error);
    throw new PluginError(`Failed to update naming preference: ${error instanceof Error ? error.message : String(error)}`);
  }
}


async function processTextLayersWithProgress(
  textLayers: TextNode[], 
  collectionId: string
): Promise<ProcessingResult> {
  const startTime = Date.now();
  const stats: ProcessingStats = {
    created: 0,
    connected: 0,
    skipped: 0,
    errors: 0
  };

  // Load current naming preference
  const namingMode = await PreferenceManager.loadNamingMode();

  // Convert to TextLayerInfo format
  const layerInfos: TextLayerInfo[] = textLayers.map(layer => ({
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
  const variableCache = createVariableCache();
  const detailedErrors: DetailedProcessingError[] = [];

  // Process by content groups instead of individual layers
  for (let i = 0; i < contentGroups.length; i += PLUGIN_CONFIG.BATCH_SIZE) {
    const batch = contentGroups.slice(i, i + PLUGIN_CONFIG.BATCH_SIZE);
    
    for (const group of batch) {
      try {
        await processContentGroup(group, existingVariables, variableCache, collectionId, stats);
      } catch (error) {
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

  return {
    ...stats,
    totalProcessed: stats.created + stats.connected,
    contentGroups: contentGroups.length,
    duplicateContentGroups: groupAnalysis.duplicateContent,
    processingTime
  };
}

async function processContentGroup(
  group: ContentGroup,
  existingVariables: Map<string, Variable>,
  variableCache: Map<string, VariableCacheEntry>,
  collectionId: string,
  stats: ProcessingStats
): Promise<void> {
  // Check if we can reuse an existing variable for this content
  let variable = getFromVariableCache(variableCache, group.variableName, group.trimmedContent);
  
  if (variable) {
    // Bind all layers in this group to the cached variable
    for (const layer of group.layers) {
      if (layer.node && validateTextLayer(layer.node)) {
        bindTextNodeToVariable(layer.node, variable);
        stats.connected++;
      } else {
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
      } else {
        stats.skipped++;
      }
    }
    return;
  }

  // Create new variable for this content group
  variable = await createStringVariable(collectionId, group.variableName, group.trimmedContent);
  
  const collection = await figma.variables.getVariableCollectionByIdAsync(collectionId);
  if (collection) {
    addToVariableCache(variableCache, variable, collection);
  }
  
  // Bind all layers in this group to the new variable
  let layersProcessed = 0;
  for (const layer of group.layers) {
    if (layer.node && validateTextLayer(layer.node)) {
      bindTextNodeToVariable(layer.node, variable);
      layersProcessed++;
    } else {
      stats.skipped++;
    }
  }
  
  if (layersProcessed > 0) {
    stats.created++; // One variable created for the group
    stats.connected += layersProcessed - 1; // Additional connections beyond the first
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