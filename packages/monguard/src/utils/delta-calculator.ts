/**
 * @fileoverview Delta calculation utilities for audit logging.
 * Computes field-level differences between document states with configurable depth and array handling.
 */

/**
 * Configuration options for delta computation.
 */
export interface DeltaOptions {
  /** Maximum depth for nested object diffing (default: 3) */
  maxDepth?: number;
  /** Array handling strategy */
  arrayHandling?: 'diff' | 'replace';
  /** Max array size for element-wise diffing (default: 20) */
  arrayDiffMaxSize?: number;
  /** Fields to exclude from delta computation */
  blacklist?: string[];
}

/**
 * Represents a change in a specific field path.
 */
export interface FieldChange {
  /** Previous value */
  old: any;
  /** New value */
  new: any;
  /** True if this represents a full document/array replacement due to complexity limits */
  fullDocument?: true;
}

/**
 * Result of delta computation containing all field changes.
 */
export interface DeltaResult {
  /** Map of field paths to their changes */
  changes: Record<string, FieldChange>;
  /** Whether any changes were detected */
  hasChanges: boolean;
}

/**
 * Default configuration for delta computation.
 */
export const DEFAULT_DELTA_OPTIONS: Required<DeltaOptions> = {
  maxDepth: 3,
  arrayHandling: 'diff',
  arrayDiffMaxSize: 20,
  blacklist: ['createdAt', 'updatedAt', 'createdBy', 'updatedBy', '__v'],
};

/**
 * Computes the delta between two document states.
 *
 * @param before - The document state before changes
 * @param after - The document state after changes
 * @param options - Configuration options for delta computation
 * @returns Delta result containing all field changes
 */
export function computeDelta(before: any, after: any, options: DeltaOptions = {}): DeltaResult {
  const opts = { ...DEFAULT_DELTA_OPTIONS, ...options };
  const changes: Record<string, FieldChange> = {};

  // Handle null/undefined cases
  if (before == null && after == null) {
    return { changes, hasChanges: false };
  }

  if (before == null) {
    // Creation case - treat entire document as new
    return {
      changes: { '': { old: undefined, new: after } },
      hasChanges: true,
    };
  }

  if (after == null) {
    // Deletion case - treat entire document as removed
    return {
      changes: { '': { old: before, new: undefined } },
      hasChanges: true,
    };
  }

  // Compute field-level differences
  computeFieldDifferences(before, after, '', 0, opts, changes);

  return {
    changes,
    hasChanges: Object.keys(changes).length > 0,
  };
}

/**
 * Recursively computes differences between two objects/values.
 *
 * @private
 */
function computeFieldDifferences(
  before: any,
  after: any,
  currentPath: string,
  depth: number,
  options: Required<DeltaOptions>,
  changes: Record<string, FieldChange>
): void {
  // Check if we should skip this field due to blacklist
  if (currentPath && isFieldBlacklisted(currentPath, options.blacklist)) {
    return;
  }

  // Handle arrays first (before primitive check since arrays are not considered objects by isObject)
  if (Array.isArray(before) || Array.isArray(after)) {
    handleArrayDifferences(before, after, currentPath, depth, options, changes);
    return;
  }

  // Handle primitive values or depth limit reached
  if (depth >= options.maxDepth || !isObject(before) || !isObject(after)) {
    if (!deepEqual(before, after)) {
      changes[currentPath] = {
        old: before,
        new: after,
        ...(depth >= options.maxDepth && (isObject(before) || isObject(after)) ? { fullDocument: true } : {}),
      };
    }
    return;
  }

  // Handle objects
  if (isObject(before) && isObject(after)) {
    handleObjectDifferences(before, after, currentPath, depth, options, changes);
    return;
  }

  // Different types - treat as simple change
  if (!deepEqual(before, after)) {
    changes[currentPath] = { old: before, new: after };
  }
}

/**
 * Handles differences between arrays.
 *
 * @private
 */
function handleArrayDifferences(
  before: any,
  after: any,
  currentPath: string,
  depth: number,
  options: Required<DeltaOptions>,
  changes: Record<string, FieldChange>
): void {
  const beforeArray = Array.isArray(before) ? before : [];
  const afterArray = Array.isArray(after) ? after : [];

  // Check if arrays are too large for element-wise diffing
  const maxLength = Math.max(beforeArray.length, afterArray.length);
  const shouldUseDiff = options.arrayHandling === 'diff' && maxLength <= options.arrayDiffMaxSize;

  if (!shouldUseDiff) {
    // Store full array replacement
    if (!deepEqual(beforeArray, afterArray)) {
      changes[currentPath] = {
        old: beforeArray,
        new: afterArray,
        fullDocument: true,
      };
    }
    return;
  }

  // Perform element-wise diffing
  const maxIndex = Math.max(beforeArray.length, afterArray.length);
  for (let i = 0; i < maxIndex; i++) {
    const beforeElement = i < beforeArray.length ? beforeArray[i] : undefined;
    const afterElement = i < afterArray.length ? afterArray[i] : undefined;
    const elementPath = generateFieldPath(currentPath, i);

    computeFieldDifferences(beforeElement, afterElement, elementPath, depth + 1, options, changes);
  }
}

/**
 * Handles differences between objects.
 *
 * @private
 */
function handleObjectDifferences(
  before: any,
  after: any,
  currentPath: string,
  depth: number,
  options: Required<DeltaOptions>,
  changes: Record<string, FieldChange>
): void {
  const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);

  for (const key of allKeys) {
    const beforeValue = before[key];
    const afterValue = after[key];
    const fieldPath = generateFieldPath(currentPath, key);

    computeFieldDifferences(beforeValue, afterValue, fieldPath, depth + 1, options, changes);
  }
}

/**
 * Generates a field path for nested properties or array elements.
 *
 * @param basePath - The base path
 * @param keyOrIndex - The property key or array index
 * @returns The generated field path
 */
export function generateFieldPath(basePath: string, keyOrIndex: string | number): string {
  if (!basePath) {
    return String(keyOrIndex);
  }
  return `${basePath}.${keyOrIndex}`;
}

/**
 * Checks if a field should be excluded from delta computation.
 *
 * @param fieldPath - The field path to check
 * @param blacklist - Array of blacklisted field patterns
 * @returns True if the field should be excluded
 */
export function isFieldBlacklisted(fieldPath: string, blacklist: string[]): boolean {
  // Never blacklist soft delete fields
  if (fieldPath === 'deletedAt' || fieldPath === 'deletedBy') {
    return false;
  }

  return blacklist.some(pattern => {
    // Handle wildcard patterns
    if (pattern.includes('*')) {
      // Convert glob-like pattern to regex
      const regexPattern = pattern.replace(/\./g, '\\.').replace(/\*/g, '.*');
      return new RegExp(`^${regexPattern}$`).test(fieldPath);
    }

    // Handle exact dot patterns (like 'meta.updatedAt')
    if (pattern.includes('.')) {
      return fieldPath === pattern;
    }

    // Exact match, starts with pattern, or ends with pattern (for nested fields)
    return (
      fieldPath === pattern ||
      fieldPath.startsWith(`${pattern}.`) ||
      fieldPath.endsWith(`.${pattern}`) ||
      fieldPath.includes(`.${pattern}.`)
    );
  });
}

/**
 * Checks if a value is an object (not array, null, or primitive).
 *
 * @private
 */
function isObject(value: any): boolean {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date);
}

/**
 * Performs deep equality comparison between two values.
 *
 * @private
 */
function deepEqual(a: any, b: any): boolean {
  if (a === b) return true;

  if (a == null || b == null) return a === b;

  if (typeof a !== typeof b) return false;

  // Handle Date objects
  if (a instanceof Date && b instanceof Date) {
    return a.getTime() === b.getTime();
  }

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }

  if (isObject(a) && isObject(b)) {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;

    for (const key of keysA) {
      if (!keysB.includes(key) || !deepEqual(a[key], b[key])) return false;
    }
    return true;
  }

  return false;
}

/**
 * Determines if a value should be stored as a full document due to complexity.
 *
 * @param value - The value to evaluate
 * @param path - The field path
 * @param options - Delta computation options
 * @returns True if full document storage should be used
 */
export function shouldUseFullDocument(value: any, path: string, options: DeltaOptions): boolean {
  const opts = { ...DEFAULT_DELTA_OPTIONS, ...options };

  // Check depth limit
  const pathDepth = path.split('.').length - 1;
  if (pathDepth >= opts.maxDepth) {
    return true;
  }

  // Check array size limit
  if (Array.isArray(value) && value.length > opts.arrayDiffMaxSize) {
    return true;
  }

  return false;
}
