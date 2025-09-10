// lib/types.ts
// Comprehensive TypeScript interfaces for the Stringify plugin

export interface ProcessingStats {
  created: number;
  connected: number;
  skipped: number;
  errors: number;
}

export interface CollectionInfo {
  id: string;
  name: string;
  variables: string[];
}

export interface TextLayerInfo {
  id: string;
  name: string;
  characters: string;
  node?: TextNode;
}

export interface ProcessingResult extends ProcessingStats {
  totalProcessed: number;
}

export type MessageFromUI = 
  | { type: 'get-collections' }
  | { type: 'scan-text-layers' }
  | { type: 'create-variables'; collectionId: string }
  | { type: 'create-default-collection' };

export type MessageToUI = 
  | { type: 'collections-loaded'; collections: CollectionInfo[] }
  | { type: 'collection-created'; collectionId: string; collections: CollectionInfo[] }
  | { type: 'text-layers-found'; layers: TextLayerInfo[]; validCount: number; totalCount: number }
  | { type: 'progress-update'; progress: number; remaining: number }
  | { type: 'variables-created'; result: ProcessingResult }
  | { type: 'error'; message: string };

export class PluginError extends Error {
  public readonly code?: string;
  public readonly context?: Record<string, any>;

  constructor(message: string, options?: { code?: string; context?: Record<string, any> }) {
    super(message);
    this.name = 'PluginError';
    this.code = options?.code;
    this.context = options?.context;
  }
}

export interface UIState {
  collections: CollectionInfo[];
  selectedCollection: string | null;
  textLayers: TextLayerInfo[];
  scanResults: { validCount: number; totalCount: number } | null;
  isProcessing: boolean;
  progress: { current: number; total: number } | null;
  error: string | null;
}

export interface TextProcessingResult {
  original: string;
  processed: string;
  variableName: string;
}

export interface VariableCacheEntry {
  variable: Variable;
  name: string;
  content: string;
}
