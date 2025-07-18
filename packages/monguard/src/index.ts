/**
 * @fileoverview Main entry point for the Monguard package, providing MongoDB document management with audit trails and soft delete functionality.
 */

/**
 * Exports all public interfaces, classes and types from the MonguardCollection module.
 */
export * from './monguard-collection';

/**
 * Exports all public type definitions and interfaces.
 */
export * from './types';

/**
 * Exports audit logger classes and interfaces.
 */
export * from './audit-logger';

/**
 * Exports outbox transport interfaces and implementations.
 */
export * from './outbox-transport';
