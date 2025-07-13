# 🛡️ monguard – The Guardian of Your MongoDB Records

[![CI](https://github.com/thaitype/monguard/actions/workflows/main.yml/badge.svg)](https://github.com/thaitype/monguard/actions/workflows/main.yml) [![codecov](https://codecov.io/gh/thaitype/monguard/graph/badge.svg?token=B7MCHM57BH)](https://codecov.io/gh/thaitype/monguard) [![NPM Version](https://img.shields.io/npm/v/monguard) ](https://www.npmjs.com/package/monguard)[![npm downloads](https://img.shields.io/npm/dt/monguard)](https://www.npmjs.com/package/monguard) 

> Note: The API is subject to change, please follow the release note to migration document, please report any issues or suggestions. 

**`monguard`** is a lightweight, zero-boilerplate toolkit designed to enhance MongoDB models with production-ready features:

* 🗑️ **Soft Delete** — Mark records as deleted without removing them from the database
* ⏱️ **Auto Timestamps** — Automatically manage `createdAt` and `updatedAt` fields
* 🕵️ **Audit Logging** — Track every `create`, `update`, and `delete` action with detailed metadata
* 🚀 **Transaction-Aware Auditing** — In-transaction or outbox patterns for different consistency needs
* 🧠 **TypeScript First** — Fully typed for safety and great DX
* ⚙️ **Plug-and-Play** — Minimal setup, maximum control

### ✨ Why `monguard`?

In real-world apps, deleting data is rarely the end of the story. Whether it's rollback, audit compliance, or just better traceability — `monguard` has your back.

With just a single call, you can guard your collections against accidental data loss while keeping every change accountable.

### 📦 Installation

```bash
npm install monguard
```

### 🔐 Use-case Highlights

* CRM systems with user-deletable data
* E-commerce with order history tracking
* Admin dashboards needing full audit trail
* **Financial systems** requiring strict audit compliance
* **High-throughput applications** with eventual consistency needs
* Any app where "delete" doesn't really mean delete 😉

> Guard your data. Track the truth. Sleep better.
> — with **`monguard`** 🛡️

# Monguard User Manual

Monguard is an audit-safe MongoDB wrapper that provides automatic audit logging, soft deletes, user tracking, and concurrent operation handling with zero runtime MongoDB dependencies in your application code.

## Table of Contents

- [Introduction](/docs/introduction.md)
- [Configuration](#configuration)
- [API Reference](#api-reference)
- [Multi-Phase Operations](#multi-phase-operations)
- [Concurrency Strategies](#concurrency-strategies)
- [Audit Logging](#audit-logging)
- [Delta Mode Audit Logging](#delta-mode-audit-logging)
- [Transactions with Outbox Pattern](#transactions-with-outbox-pattern)
- [Soft Deletes](#soft-deletes)
- [User Tracking](#user-tracking)
- [Manual Auto-Field Control](#manual-auto-field-control)
- [Manual Audit Logging](#manual-audit-logging)
- [Best Practices](#best-practices)
- [Examples](#examples)
- [Troubleshooting](#troubleshooting)
