# Voxply-web

Browser client for the [Voxply](https://github.com/YOUR_ORG/Voxply) platform.
A lightweight web app that speaks the same hub API as the desktop client —
no native dependencies, runs entirely in the browser.

Part of the Voxply project — see the
[docs repo](https://github.com/YOUR_ORG/Voxply) for architecture,
API spec, and roadmap.

## Technologies

- **React** + **TypeScript** — UI layer
- **Vite** — build tooling and dev server
- **Web Crypto API** — Ed25519 keypair generation and signing (no native deps)
- **BIP39** (TypeScript) — 24-word recovery phrase

## Quick start

```bash
cd voxply-web
npm install
npm run dev
# Open http://localhost:5173
```

## Building

```bash
cd voxply-web
npm run build
# Output: dist/
```

## Type checking

```bash
cd voxply-web
npx tsc --noEmit
```

## Built with AI assistance

This project was built with substantial help from
[Claude](https://claude.ai) (Anthropic's AI assistant). The product
owner directs architecture, features, and tradeoffs; Claude drafts
most of the code, tests, and documentation, which is then reviewed,
adjusted, and accepted.

Calling this out for transparency — it's not a fully hand-written
codebase, and pretending otherwise wouldn't be honest.

## License

[GNU Affero General Public License v3.0](LICENSE).
