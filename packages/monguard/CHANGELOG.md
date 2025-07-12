# monguard

## 0.11.3

### Patch Changes

- a56561f: Fix unexpected delta behavior

## 0.11.2

### Patch Changes

- aafb66f: fix: delta audit logger should log only deltaChanges, not full documents

## 0.11.1

### Patch Changes

- 0f8f706: Fix: when no \_\_v1 field it should not throw error on existing document

## 0.11.0

### Minor Changes

- c5ce7a7: Add delta audit logger mode

## 0.10.0

### Minor Changes

- 5beb9c6: refactor: version field to \_\_v for optimistic locking version to avoid generic word

## 0.9.0

### Minor Changes

- be82a1a: Add audit log mode in transaction concurrency mode for clear, stable audit logging, and most case of coverage test

## 0.8.0

### Minor Changes

- 0e8a973: Add `newVersion` to Versioned Update Results

## 0.7.0

### Minor Changes

- 1f6d706: Remove deprecated auditLogger options, disable audit log by default, fix auto-field issue

## 0.6.0

### Minor Changes

- 6117a89: feat: add public method for manually control user tracking, auto timestamp and audit log

## 0.5.0

### Minor Changes

- 9fec48e: feat: make audit log to dedicated class

## 0.4.2

### Patch Changes

- 0239e47: Fix Db class type

## 0.4.1

### Patch Changes

- e25572a: Improve mongo type

## 0.4.0

### Minor Changes

- 8aad686: feat: migrate result to try catch throw

## 0.3.0

### Minor Changes

- 978af58: Fix type & add jsdoc

## 0.2.0

### Minor Changes

- 4f01ada: Remove non-used field documentIdType

## 0.1.0

### Minor Changes

- a8b47ae: Init Release support soft delete, baisc concurrency support both transaction or not

## 0.0.2

### Patch Changes

- 3df306d: Rename package name upbuild to monguard

## 0.0.1

### Patch Changes

- 64d8ecf: Fix first build
