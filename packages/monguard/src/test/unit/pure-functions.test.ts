import { describe, it, expect } from 'vitest';
import { ObjectId } from 'mongodb';
import { toObjectId } from '../../types';

describe('Pure Functions', () => {
  describe('toObjectId', () => {
    it('should return ObjectId as-is when input is ObjectId', () => {
      const objectId = new ObjectId();
      const result = toObjectId(objectId);
      
      expect(result).toBe(objectId);
      expect(result).toBeInstanceOf(ObjectId);
    });

    it('should convert valid string to ObjectId', () => {
      const validHex = '507f1f77bcf86cd799439011';
      const result = toObjectId(validHex);
      
      expect(result).toBeInstanceOf(ObjectId);
      expect(result.toString()).toBe(validHex);
    });

    it('should convert valid ObjectId string to ObjectId', () => {
      const originalId = new ObjectId();
      const stringId = originalId.toString();
      const result = toObjectId(stringId);
      
      expect(result).toBeInstanceOf(ObjectId);
      expect(result.toString()).toBe(stringId);
      expect(result.equals(originalId)).toBe(true);
    });


    it('should throw error for invalid string', () => {
      const invalidString = 'invalid-object-id';
      
      expect(() => toObjectId(invalidString)).toThrow();
    });

    it('should throw error for empty string', () => {
      const emptyString = '';
      
      expect(() => toObjectId(emptyString)).toThrow();
    });

    it('should throw error for string that is too short', () => {
      const shortString = '123';
      
      expect(() => toObjectId(shortString)).toThrow();
    });

    it('should throw error for string that is too long', () => {
      const longString = '507f1f77bcf86cd799439011extra';
      
      expect(() => toObjectId(longString)).toThrow();
    });

    it('should throw error for special characters', () => {
      const specialChars = '!@#$%^&*(){}';
      
      expect(() => toObjectId(specialChars)).toThrow();
    });
  });
});