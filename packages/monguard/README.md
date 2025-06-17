# 🛡️ monguard – The Guardian of Your MongoDB Records

[![CI](https://github.com/thaitype/monguard/actions/workflows/main.yml/badge.svg)](https://github.com/thaitype/monguard/actions/workflows/main.yml) [![NPM Version](https://img.shields.io/npm/v/monguard) ](https://www.npmjs.com/package/monguard)[![npm downloads](https://img.shields.io/npm/dt/monguard)](https://www.npmjs.com/package/monguard)

> 🛡️ Soft delete, auto fields, and full audit logging – all in one TypeScript-friendly MongoDB toolkit.

lightweight, zero-boilerplate toolkit designed to enhance MongoDB or Mongoose models with production-ready features

### ✅ Overview

**`monguard`** is a lightweight, zero-boilerplate toolkit designed to enhance MongoDB or Mongoose models with production-ready features:

* 🗑️ **Soft Delete** — Mark records as deleted without removing them from the database
* ⏱️ **Auto Timestamps** — Automatically manage `createdAt` and `updatedAt` fields
* 🕵️ **Audit Logging** — Track every `create`, `update`, and `delete` action with detailed metadata
* 🧠 **TypeScript First** — Fully typed for safety and great DX
* ⚙️ **Plug-and-Play** — Minimal setup, maximum control

### ✨ Why `monguard`?

In real-world apps, deleting data is rarely the end of the story. Whether it's rollback, audit compliance, or just better traceability — `monguard` has your back.

With just a single call, you can guard your collections against accidental data loss while keeping every change accountable.

### 🚀 Example

```ts
import { applyMonguard } from 'monguard'
import { Schema } from 'mongoose'

const userSchema = new Schema({ name: String })

applyMonguard(userSchema, {
  audit: true,     // Enable audit logging
  softDelete: true // Enable soft delete
})
```

### 📦 Installation

```bash
npm install monguard
```

### 🔐 Use-case Highlights

* CRM systems with user-deletable data
* E-commerce with order history tracking
* Admin dashboards needing full audit trail
* Any app where “delete” doesn’t really mean delete 😉

> Guard your data. Track the truth. Sleep better.
> — with **`monguard`** 🛡️

## License

MIT License © 2025
Created by [@thaitype](https://github.com/thaitype)

