// lib/constants.ts
// Centralized configuration and constants for the Stringify plugin
export const PLUGIN_CONFIG = {
    BATCH_SIZE: 10,
    MAX_VARIABLE_NAME_LENGTH: 50,
    DEFAULT_COLLECTION_NAME: "Text to String",
    PROGRESS_UPDATE_DELAY: 10,
    UI_DIMENSIONS: {
        width: 380,
        height: 560
    }
};
export const ERROR_CODES = {
    COLLECTION_NOT_FOUND: 'COLLECTION_NOT_FOUND',
    INVALID_TEXT: 'INVALID_TEXT',
    VARIABLE_CREATION_FAILED: 'VARIABLE_CREATION_FAILED',
    BINDING_FAILED: 'BINDING_FAILED',
    NO_VALID_LAYERS: 'NO_VALID_LAYERS',
    PROCESSING_IN_PROGRESS: 'PROCESSING_IN_PROGRESS',
    COLLECTION_ID_REQUIRED: 'COLLECTION_ID_REQUIRED'
};
export const UI_MESSAGES = {
    SCANNING: 'Scanning text layers...',
    PROCESSING: 'Creating variables...',
    COMPLETED: 'Processing completed successfully',
    NO_COLLECTIONS: 'No variable collections found',
    NO_LAYERS: 'No valid text layers found',
    SELECT_COLLECTION: 'Please select a collection first',
    PROCESSING_IN_PROGRESS: 'Processing is already in progress',
    COLLECTION_CREATED: 'Collection created successfully',
    VARIABLES_CREATED: 'Variables created successfully'
};
export const VARIABLE_NAME_PATTERNS = {
    // Characters that are safe for variable names
    SAFE_CHARS: /[A-Za-z0-9_]/,
    // Characters that should be replaced with underscores
    REPLACE_CHARS: /[^A-Za-z0-9_]/g,
    // Multiple consecutive underscores
    MULTIPLE_UNDERSCORES: /_{2,}/g,
    // Leading/trailing underscores
    EDGE_UNDERSCORES: /^_+|_+$/g
};
export const STATUS_TYPES = {
    SUCCESS: 'success',
    ERROR: 'error',
    WARNING: 'warning',
    INFO: 'info'
};
