# 🐝 monguard

[![CI](https://github.com/thaitype/monguard/actions/workflows/main.yml/badge.svg)](https://github.com/thaitype/monguard/actions/workflows/main.yml) [![NPM Version](https://img.shields.io/npm/v/monguard) ](https://www.npmjs.com/package/monguard)[![npm downloads](https://img.shields.io/npm/dt/monguard)](https://www.npmjs.com/package/monguard)

Tiny builds that fly.  

A minimal build tool for Node.js serverless functions and small Docker images.

>  🚧 Note: This project is in early development. Not READY for production use yet!

## ✨ What is monguard?

**monguard** is a minimalistic CLI build tool for producing small, production-ready Node.js outputs — ideal for serverless functions, microservices, and lightweight Docker containers.

It wraps powerful bundlers like `esbuild` (more in the future), giving you control over external dependencies and runtime packaging without boilerplate.

## 🚀 Why monguard?

- 🐝 **Tiny output** – Designed for small, fast-deployable builds.
- 📦 **External-aware** – Specify which dependencies to bundle or install separately.
- ⚙️ **Built for serverless & containers** – Output that's ready to run.
- 🛠️ **Simple config** – Define behavior directly in `package.json`.
- 🔧 **Zero lock-in** – Uses standard bundlers under the hood.

## 📦 Installation

```bash
npm install -D monguard
# or
pnpm add -D monguard
````

> Requires Node.js 18+
> You also need to install a bundler like `esbuild`:

```bash
npm install -D esbuild
```

## 🔧 Usage

### Development mode (watch)

```bash
monguard
```

### Production build

```bash
monguard build
```

## 🧠 Example `package.json`

```json
{
  "name": "my-function",
  "main": "dist/main.js",
  "monguard": {
    "externalDependencies": {
      "prisma": "install",
      "@prisma/client": "install",
      "@azure/functions-core": "external"
    }
  }
}
```

## 📁 Output example

```
dist/
  main.js
functions/
  package.json ← { "main": "dist/main.js" }
  node_modules/
    prisma/
    @prisma/client/
```

## 📍 Notes

* Currently supports only `esbuild`. More bundlers coming soon (`bun`, `ncc`, etc.)
* Automatically installs runtime dependencies (like `prisma`) into your target directory.
* Designed with serverless & container deploys in mind.

## 📣 Pronunciation

> `monguard` is pronounced **"bees"** 🐝
> Like “breeze” without the "r".

## 🧪 Roadmap

* [x] MVP with `esbuild` support
* [ ] Support for `bun`, `ncc`
* [ ] Custom `monguard.config.ts`

## 🐝 License

MIT License © 2025
Created by [@thaitype](https://github.com/thaitype)

## Note 
Support node 16 and above (due to https://github.com/sindresorhus/execa/releases/tag/v8.0.0)
