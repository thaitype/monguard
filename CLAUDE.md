# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is **monguard** - a TypeScript library providing audit-safe MongoDB wrapper with automatic audit logging, soft deletes, user tracking, and concurrent operation handling. The library has zero runtime MongoDB dependencies and is designed to work with MongoDB Atlas, standalone MongoDB, and Azure Cosmos DB.

## Key Architecture

### Monorepo Structure
- `packages/monguard/` - Main library package
- `configs/` - Shared configuration packages (ESLint, TypeScript, Vitest)
- Uses pnpm workspaces with Turbo for build orchestration
- Uses Changesets for version management and releases

### Core Components
- **MonguardCollection** (`src/monguard-collection.ts`) - Main collection wrapper class
- **Strategy Pattern** (`src/strategies/`) - Handles different concurrency strategies:
  - `TransactionStrategy` - For MongoDB replica sets/Atlas (ACID transactions)
  - `OptimisticLockingStrategy` - For standalone MongoDB/Cosmos DB (version-based locking)
  - `StrategyFactory` - Auto-selects appropriate strategy
- **Type System** (`src/types.ts`) - Comprehensive TypeScript interfaces
- **MySQL Types** (`src/mongodb-types.ts`) - MongoDB driver type compatibility layer

### Key Features
- **Audit Logging**: Tracks all create/update/delete operations with before/after states
- **Soft Deletes**: Marks records as deleted without removing them
- **User Tracking**: Tracks who created/modified/deleted each document
- **Concurrency Control**: Automatic transaction vs optimistic locking strategies
- **Type Safety**: Fully typed with MongoDB compatibility

## Common Development Commands

### Setup and Development
```bash
# Install dependencies
pnpm install

# Run tests
pnpm test

# Run tests with coverage
pnpm test:coverage

# Run in watch mode
pnpm test:watch

# Build the project
pnpm build

# Run linting and type checking
pnpm lint

# Fix linting issues
pnpm lint:fix

# Format code
pnpm format

# Check types only
pnpm check-types
```

### Testing
```bash
# Run all tests
pnpm test

# Run specific test file
pnpm test tests/integration/crud-operations.test.ts

# Run tests with coverage report
pnpm test:coverage-report

# Run tests in CI mode
pnpm test:ci
```

### Build and Release
```bash
# Build all packages
pnpm build

# Run full validation (lint, build, test)
pnpm all

# Version packages (using changesets)
pnpm changeset

# Release packages
pnpm release
```

## Testing Strategy

### Test Structure
- **Unit Tests** (`tests/unit/`) - Internal logic testing
- **Integration Tests** (`tests/integration/`) - Full MongoDB integration
- **Test Utilities** (`tests/test-utils.ts`, `tests/factories.ts`) - Shared test helpers
- **MongoDB Setup** (`tests/mongodb-adapter.ts`) - MongoDB Memory Server setup

### Key Test Files
- `crud-operations.test.ts` - Basic CRUD operations
- `audit-logging.test.ts` - Audit trail functionality
- `concurrent-operations.test.ts` - Concurrency handling
- `strategy-comparison.test.ts` - Strategy behavior comparison
- `transaction-strategy.test.ts` - Transaction-specific tests

### Test Database
Uses MongoDB Memory Server for isolated testing environment. Tests automatically start/stop MongoDB instances.

## Architecture Decisions

### Concurrency Strategies
The library automatically selects the appropriate concurrency strategy based on MongoDB environment:
- **Transaction Strategy**: Used when `transactionsEnabled: true` (MongoDB Atlas/Replica Sets)
- **Optimistic Locking**: Used when `transactionsEnabled: false` (Standalone/Cosmos DB)
- **Automatic Fallback**: Transaction strategy falls back to optimistic locking if transactions fail

### Type Safety
- Uses conditional types for MongoDB compatibility
- Supports flexible ID types (ObjectId, string, custom)
- Provides strict typing for audit logs and user context
- Zero runtime dependencies on MongoDB driver

### Error Handling
- All operations return data directly and throw exceptions on error
- Detailed error messages with context
- Graceful fallback between strategies
- Comprehensive retry logic for optimistic locking

## Code Conventions

### TypeScript
- Strict type checking enabled
- Use explicit return types for public methods
- Prefer interfaces over types for complex objects
- Use generics for flexible type parameters

### Testing
- Use descriptive test names explaining the scenario
- Group related tests with `describe` blocks
- Use `beforeEach`/`afterEach` for setup/cleanup
- Mock external dependencies appropriately

### Naming
- Use PascalCase for classes and interfaces
- Use camelCase for methods and variables
- Use UPPER_CASE for constants
- Prefix interfaces with descriptive names (e.g., `MonguardCollectionOptions`)

## Important Files

### Configuration
- `turbo.json` - Turbo build configuration
- `pnpm-workspace.yaml` - Workspace definition
- `packages/monguard/tsconfig.json` - TypeScript configuration
- `packages/monguard/vitest.config.ts` - Test configuration

### Documentation
- `README.md` - Comprehensive user manual
- `docs/transaction-strategy-testing.md` - Strategy testing guide
- `memory-bank/` - Design documents and checklists

## Development Notes

### MongoDB Compatibility
- Peer dependency on `mongodb` driver ^6.0.0
- Tested with MongoDB Memory Server for CI/CD
- Supports both standalone and replica set configurations
- Compatible with Azure Cosmos DB for MongoDB API

### Performance Considerations
- Optimized for high-throughput scenarios
- Minimal memory footprint with lodash-es
- Efficient query patterns with proper indexing
- Batch operation support for bulk updates

### Error Scenarios
- Handles transaction failures gracefully
- Provides detailed error context
- Supports retry logic with exponential backoff
- Maintains data consistency across failure scenarios