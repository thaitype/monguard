import { describe, it, expect } from 'vitest';
import {
  computeDelta,
  generateFieldPath,
  isFieldBlacklisted,
  shouldUseFullDocument,
  DEFAULT_DELTA_OPTIONS,
  type DeltaOptions,
} from '../../src/utils/delta-calculator';

describe('Delta Calculator Unit Tests', () => {
  describe('computeDelta', () => {
    it('should detect simple field changes', () => {
      const before = { name: 'John', age: 30 };
      const after = { name: 'Jane', age: 30 };

      const result = computeDelta(before, after);

      expect(result.hasChanges).toBe(true);
      expect(result.changes).toEqual({
        name: { old: 'John', new: 'Jane' },
      });
    });

    it('should detect multiple field changes', () => {
      const before = { name: 'John', age: 30, email: 'john@example.com' };
      const after = { name: 'Jane', age: 31, email: 'john@example.com' };

      const result = computeDelta(before, after);

      expect(result.hasChanges).toBe(true);
      expect(result.changes).toEqual({
        name: { old: 'John', new: 'Jane' },
        age: { old: 30, new: 31 },
      });
    });

    it('should handle nested object changes', () => {
      const before = {
        user: { profile: { name: 'John', address: { city: 'Bangkok' } } },
      };
      const after = {
        user: { profile: { name: 'Jane', address: { city: 'Bangkok' } } },
      };

      const result = computeDelta(before, after);

      expect(result.hasChanges).toBe(true);
      expect(result.changes).toEqual({
        'user.profile.name': { old: 'John', new: 'Jane' },
      });
    });

    it('should handle array element changes', () => {
      const before = { tags: ['user', 'editor', 'active'] };
      const after = { tags: ['user', 'premium', 'active'] };

      const result = computeDelta(before, after);

      expect(result.hasChanges).toBe(true);
      expect(result.changes).toEqual({
        'tags.1': { old: 'editor', new: 'premium' },
      });
    });

    it('should handle array length changes', () => {
      const before = { tags: ['user', 'editor'] };
      const after = { tags: ['user', 'editor', 'verified'] };

      const result = computeDelta(before, after);

      expect(result.hasChanges).toBe(true);
      expect(result.changes).toEqual({
        'tags.2': { old: undefined, new: 'verified' },
      });
    });

    it('should handle property addition', () => {
      const before = { name: 'John' };
      const after = { name: 'John', age: 30 };

      const result = computeDelta(before, after);

      expect(result.hasChanges).toBe(true);
      expect(result.changes).toEqual({
        age: { old: undefined, new: 30 },
      });
    });

    it('should handle property removal', () => {
      const before = { name: 'John', age: 30 };
      const after = { name: 'John' };

      const result = computeDelta(before, after);

      expect(result.hasChanges).toBe(true);
      expect(result.changes).toEqual({
        age: { old: 30, new: undefined },
      });
    });

    it('should return no changes for identical objects', () => {
      const before = { name: 'John', age: 30, tags: ['user'] };
      const after = { name: 'John', age: 30, tags: ['user'] };

      const result = computeDelta(before, after);

      expect(result.hasChanges).toBe(false);
      expect(result.changes).toEqual({});
    });

    it('should handle null and undefined correctly', () => {
      const before = { value: null };
      const after = { value: undefined };

      const result = computeDelta(before, after);

      expect(result.hasChanges).toBe(true);
      expect(result.changes).toEqual({
        value: { old: null, new: undefined },
      });
    });

    it('should handle creation scenario (before is null)', () => {
      const before = null;
      const after = { name: 'John', age: 30 };

      const result = computeDelta(before, after);

      expect(result.hasChanges).toBe(true);
      expect(result.changes).toEqual({
        '': { old: undefined, new: after },
      });
    });

    it('should handle deletion scenario (after is null)', () => {
      const before = { name: 'John', age: 30 };
      const after = null;

      const result = computeDelta(before, after);

      expect(result.hasChanges).toBe(true);
      expect(result.changes).toEqual({
        '': { old: before, new: undefined },
      });
    });
  });

  describe('maxDepth configuration', () => {
    it('should respect maxDepth limit and mark as fullDocument', () => {
      const before = {
        level1: {
          level2: {
            level3: {
              level4: { value: 'old' },
            },
          },
        },
      };
      const after = {
        level1: {
          level2: {
            level3: {
              level4: { value: 'new' },
            },
          },
        },
      };

      const options: DeltaOptions = { maxDepth: 2 };
      const result = computeDelta(before, after, options);

      expect(result.hasChanges).toBe(true);
      expect(result.changes['level1.level2']).toBeDefined();
      expect(result.changes['level1.level2'].fullDocument).toBe(true);
    });

    it('should handle deep changes within maxDepth', () => {
      const before = {
        level1: {
          level2: {
            value: 'old',
          },
        },
      };
      const after = {
        level1: {
          level2: {
            value: 'new',
          },
        },
      };

      const options: DeltaOptions = { maxDepth: 3 };
      const result = computeDelta(before, after, options);

      expect(result.hasChanges).toBe(true);
      expect(result.changes['level1.level2.value']).toEqual({
        old: 'old',
        new: 'new',
      });
      expect(result.changes['level1.level2.value'].fullDocument).toBeUndefined();
    });
  });

  describe('array handling configuration', () => {
    it('should use full array replacement when arrayDiffMaxSize exceeded', () => {
      const smallArray = Array.from({ length: 5 }, (_, i) => `item${i}`);
      const before = { items: smallArray };
      const after = { items: [...smallArray, 'new-item'] };

      const options: DeltaOptions = { arrayDiffMaxSize: 3 };
      const result = computeDelta(before, after, options);

      expect(result.hasChanges).toBe(true);
      expect(result.changes['items']).toBeDefined();
      expect(result.changes['items'].fullDocument).toBe(true);
      expect(result.changes['items'].old).toEqual(smallArray);
      expect(result.changes['items'].new).toEqual([...smallArray, 'new-item']);
    });

    it('should use element-wise diff when array is small enough', () => {
      const before = { items: ['a', 'b', 'c'] };
      const after = { items: ['a', 'x', 'c'] };

      const options: DeltaOptions = { arrayDiffMaxSize: 10 };
      const result = computeDelta(before, after, options);

      expect(result.hasChanges).toBe(true);
      expect(result.changes['items.1']).toEqual({
        old: 'b',
        new: 'x',
      });
      expect(result.changes['items']).toBeUndefined();
    });

    it('should use array replacement when arrayHandling is "replace"', () => {
      const before = { items: ['a', 'b'] };
      const after = { items: ['a', 'x'] };

      const options: DeltaOptions = { arrayHandling: 'replace' };
      const result = computeDelta(before, after, options);

      expect(result.hasChanges).toBe(true);
      expect(result.changes['items']).toBeDefined();
      expect(result.changes['items'].fullDocument).toBe(true);
    });
  });

  describe('blacklist functionality', () => {
    it('should exclude blacklisted fields', () => {
      const before = { name: 'John', updatedAt: new Date('2023-01-01') };
      const after = { name: 'Jane', updatedAt: new Date('2023-01-02') };

      const options: DeltaOptions = { blacklist: ['updatedAt'] };
      const result = computeDelta(before, after, options);

      expect(result.hasChanges).toBe(true);
      expect(result.changes).toEqual({
        name: { old: 'John', new: 'Jane' },
      });
      expect(result.changes['updatedAt']).toBeUndefined();
    });

    it('should exclude nested blacklisted fields', () => {
      const before = {
        user: { name: 'John', meta: { updatedAt: new Date('2023-01-01') } },
      };
      const after = {
        user: { name: 'Jane', meta: { updatedAt: new Date('2023-01-02') } },
      };

      const options: DeltaOptions = { blacklist: ['user.meta.updatedAt'] };
      const result = computeDelta(before, after, options);

      expect(result.hasChanges).toBe(true);
      expect(result.changes).toEqual({
        'user.name': { old: 'John', new: 'Jane' },
      });
      expect(result.changes['user.meta.updatedAt']).toBeUndefined();
    });

    it('should never blacklist deletedAt and deletedBy fields', () => {
      const before = { name: 'John', deletedAt: null };
      const after = { name: 'John', deletedAt: new Date() };

      const options: DeltaOptions = { blacklist: ['deletedAt'] };
      const result = computeDelta(before, after, options);

      expect(result.hasChanges).toBe(true);
      expect(result.changes['deletedAt']).toBeDefined();
    });
  });

  describe('generateFieldPath', () => {
    it('should generate correct path for root level', () => {
      expect(generateFieldPath('', 'name')).toBe('name');
      expect(generateFieldPath('', 0)).toBe('0');
    });

    it('should generate correct nested path', () => {
      expect(generateFieldPath('user', 'name')).toBe('user.name');
      expect(generateFieldPath('user.profile', 'email')).toBe('user.profile.email');
    });

    it('should generate correct array index path', () => {
      expect(generateFieldPath('tags', 0)).toBe('tags.0');
      expect(generateFieldPath('users.0', 'name')).toBe('users.0.name');
    });
  });

  describe('isFieldBlacklisted', () => {
    it('should match exact field names', () => {
      expect(isFieldBlacklisted('updatedAt', ['updatedAt'])).toBe(true);
      expect(isFieldBlacklisted('createdAt', ['updatedAt'])).toBe(false);
    });

    it('should match nested field patterns', () => {
      expect(isFieldBlacklisted('user.updatedAt', ['updatedAt'])).toBe(true);
      expect(isFieldBlacklisted('user.profile.updatedAt', ['updatedAt'])).toBe(true);
    });

    it('should never blacklist soft delete fields', () => {
      expect(isFieldBlacklisted('deletedAt', ['deletedAt'])).toBe(false);
      expect(isFieldBlacklisted('deletedBy', ['deletedBy'])).toBe(false);
    });

    it('should handle wildcard patterns', () => {
      expect(isFieldBlacklisted('meta.updatedAt', ['meta.*'])).toBe(true);
      expect(isFieldBlacklisted('user.meta.timestamp', ['meta.*'])).toBe(false);
    });
  });

  describe('shouldUseFullDocument', () => {
    it('should return true when depth exceeds maxDepth', () => {
      const options: DeltaOptions = { maxDepth: 2 };
      expect(shouldUseFullDocument({}, 'level1.level2.level3', options)).toBe(true);
      expect(shouldUseFullDocument({}, 'level1.level2', options)).toBe(false);
    });

    it('should return true when array exceeds size limit', () => {
      const largeArray = Array.from({ length: 25 }, (_, i) => i);
      const options: DeltaOptions = { arrayDiffMaxSize: 20 };
      expect(shouldUseFullDocument(largeArray, 'items', options)).toBe(true);
      
      const smallArray = Array.from({ length: 15 }, (_, i) => i);
      expect(shouldUseFullDocument(smallArray, 'items', options)).toBe(false);
    });

    it('should return false for simple values', () => {
      const options: DeltaOptions = { maxDepth: 2 };
      expect(shouldUseFullDocument('string', 'field', options)).toBe(false);
      expect(shouldUseFullDocument(123, 'field', options)).toBe(false);
      expect(shouldUseFullDocument(true, 'field', options)).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should handle circular references gracefully', () => {
      const before: any = { name: 'John' };
      before.self = before;
      
      const after: any = { name: 'Jane' };
      after.self = after;

      // This should not throw an error and should handle the circular reference
      const result = computeDelta(before, after);
      expect(result.hasChanges).toBe(true);
      expect(result.changes['name']).toEqual({ old: 'John', new: 'Jane' });
    });

    it('should handle complex nested array scenarios', () => {
      const before = {
        users: [
          { name: 'John', tags: ['a', 'b'] },
          { name: 'Jane', tags: ['c', 'd'] },
        ],
      };
      const after = {
        users: [
          { name: 'John', tags: ['a', 'x'] },
          { name: 'Jane', tags: ['c', 'd'] },
        ],
      };

      const result = computeDelta(before, after);

      expect(result.hasChanges).toBe(true);
      expect(result.changes['users.0.tags.1']).toEqual({
        old: 'b',
        new: 'x',
      });
    });

    it('should handle mixed type changes', () => {
      const before = { value: 'string' };
      const after = { value: 123 };

      const result = computeDelta(before, after);

      expect(result.hasChanges).toBe(true);
      expect(result.changes['value']).toEqual({
        old: 'string',
        new: 123,
      });
    });

    it('should handle Date objects correctly', () => {
      const date1 = new Date('2023-01-01');
      const date2 = new Date('2023-01-02');
      
      const before = { timestamp: date1 };
      const after = { timestamp: date2 };

      const result = computeDelta(before, after);

      expect(result.hasChanges).toBe(true);
      expect(result.changes['timestamp']).toEqual({
        old: date1,
        new: date2,
      });
    });
  });

  describe('default options', () => {
    it('should use correct default values', () => {
      expect(DEFAULT_DELTA_OPTIONS.maxDepth).toBe(3);
      expect(DEFAULT_DELTA_OPTIONS.arrayHandling).toBe('diff');
      expect(DEFAULT_DELTA_OPTIONS.arrayDiffMaxSize).toBe(20);
      expect(DEFAULT_DELTA_OPTIONS.blacklist).toEqual([
        'createdAt',
        'updatedAt', 
        'createdBy',
        'updatedBy',
        '__v'
      ]);
    });

    it('should apply default options when none provided', () => {
      const before = { name: 'John', updatedAt: new Date('2023-01-01') };
      const after = { name: 'Jane', updatedAt: new Date('2023-01-02') };

      const result = computeDelta(before, after);

      expect(result.hasChanges).toBe(true);
      expect(result.changes['name']).toBeDefined();
      expect(result.changes['updatedAt']).toBeUndefined(); // Should be blacklisted by default
    });
  });
});