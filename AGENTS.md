# AGENTS.md

## Project Overview

Pi Code is a desktop-first AI coding application. The UI is built with nsh 0.4 TSX and Tailwind 4; the agent runtime is pi 1.5.0 launched as a Node child process in RPC mode. The UI and runtime communicate through a JSONL bridge. Demo mode uses a local OpenAI-compatible mock model, but still runs the real pi agent loop and tools.

The app also has a browser transport: the browser UI connects to a loopback-only WebSocket server, which creates one bridge child per connection. Keep the desktop `process.spawn` path working when changing browser support. Read `README.md` for usage and `docs/SPEC.md` for protocol, UI conventions, constraints, and test strategy before making architectural changes.

## Environment And Commands

- Use Node.js >= 22.19 and nsh CLI >= 0.4. The app targets macOS 14+; web support is browser UI backed by a local Node process, not static hosting.
- `npm run setup` installs the pinned pi bridge dependency and generates the machine-specific `app/local-config.ts`. Do not hand-edit generated local config.
- `npm run dev` or `nsh run App.tsx` starts the desktop app.
- For browser development, run `node server/websocket-server.mjs` in one terminal, then start the nsh app with `nsh run App.tsx --target web` in another. The WebSocket service defaults to `ws://127.0.0.1:8787/bridge`; keep it local-only.
- `npm run check` or `nsh check` type-checks the project.
- `npm test` or `nsh test` runs the nsh test suite.
- `npm run build` runs `nsh build App.tsx`.
- `node server/test-bridge.mjs` runs the standalone bridge integration tests. If present, `node server/test-websocket.mjs` runs the WebSocket bridge integration tests.
- Tests that launch pi require setup to have completed. For visual checks use the relevant macOS/web target and inspect the generated screenshot; do not claim a target is verified unless it was run.

Run focused tests for the code changed, then `npm run check` and `npm test` for changes that cross modules or alter shared behavior. Run the bridge integration tests when changing `server/bridge.mjs`, `server/pi-session.mjs`, `server/workspace.mjs`, or transports. Report commands that could not be run and why.

## Repository Map

- `App.tsx`: nsh entry point.
- `app/App.tsx`: application shell, layout, global shortcuts.
- `app/protocol.ts`: shared request, response, and event types for bridge JSONL.
- `app/store.ts`: signals, event reduction, application actions, transport selection.
- `app/bridge-client.ts`: desktop child-process transport.
- `app/bridge-web.ts`: browser WebSocket transport.
- `app/components/shell/`: title bar, sidebar, status bar.
- `app/components/chat/`: chat transcript, composer, messages, tool cards, welcome view.
- `app/components/panels/`: files, changes/diff, settings, and right-panel views.
- `app/lib/`: shared presentation and formatting utilities.
- `server/bridge.mjs`: JSONL request dispatcher and runtime lifecycle.
- `server/pi-session.mjs`: pi RPC process integration and event normalization.
- `server/mock-llm.mjs`: local Demo model.
- `server/websocket-server.mjs`: loopback WebSocket server for browser clients.
- `server/workspace.mjs`: workspace file, git-status, and diff operations.
- `tests/`: nsh unit, UI, integration, and screenshot tests; `server/test-*.mjs` contains Node bridge tests.
- `docs/ROADMAP.md`, `docs/SPEC.md`: project direction and detailed engineering specification.

## Architecture Rules

- Keep UI components independent of process management. Use `app/store.ts` actions and the transport contract; do not spawn bridge or pi processes from components.
- Treat `app/protocol.ts` as the shared UI/bridge contract. Update types, bridge behavior, transport handling, and tests together when changing requests or events. Preserve JSONL framing: one JSON record per line on stdin/stdout, with logs on stderr only.
- Keep Demo and real modes on the same pi agent loop. Do not replace Demo with UI-only canned responses or mock tool execution.
- Keep desktop and web transports behaviorally aligned. WebSocket service must bind only to `127.0.0.1`; preserve Origin validation and per-connection bridge lifecycle. Do not expose the local agent service to a LAN/public interface.
- Keep workspace file operations constrained to the workspace root. Validate paths at the bridge boundary; do not add arbitrary host-file access through UI requests.
- Preserve the least-privilege intent of `nsh.json` capabilities. Add only the process, environment, filesystem, or network access a feature requires, and document why.
- Never write diagnostics to bridge stdout. `server/bridge.mjs` reserves stdout for protocol messages; use stderr for logs.

## nsh UI Conventions

- This is a native nsh UI, not a browser DOM app. Do not introduce React, DOM APIs (`window`/`document`), or `localStorage`; use nsh APIs and `nsh/storage` where needed.
- Follow the nsh constraints in `docs/SPEC.md`: `View` defaults to a vertical column; use `flex-row` for horizontal layouts. `Text` contains text or nested `Text`, not `View`. Scroll containers need `flex-1`. Use signals and nsh controls (`Input`, `Dialog`, `Sheet`, etc.) following existing components.
- Use Tailwind 4 classes and existing theme tokens from `theme.json`/`nsh.json`; avoid unsupported utility classes. Preserve the compact dark Claude Code-inspired palette and restrained motion.
- Components are invoked once and update reactively through signals. Avoid React-style assumptions about rerendering or browser lifecycle.
- Follow nearby component patterns for accessibility labels, disabled/loading states, keyboard shortcuts, empty states, and error display.

## Change And Test Guidance

- Add or update tests alongside behavior changes. Prefer fake transports for store/UI behavior; reserve real subprocess tests for bridge lifecycle, protocol framing, workspace operations, and pi integration.
- Keep tests isolated: use temporary workspaces and clean up resources/processes. Do not use the repository itself as a test workspace if a test can write files.
- For protocol changes, cover request/response correlation, event reduction, malformed or unknown records where relevant, timeouts/disconnects, and shutdown behavior.
- For UI changes, cover the relevant interaction/state in nsh tests and check the macOS target for native-only behavior. For transport changes, verify both desktop and web paths.
- Keep screenshots and fixtures intentional. Do not update snapshots only to make a failing test pass; inspect whether the UI change is expected first.

## Working Tree And Generated Files

- Preserve existing user changes. Inspect `git status` before editing and do not revert unrelated modifications.
- Do not commit or overwrite machine-specific `app/local-config.ts`, `.nsh/`, `node_modules/`, or `server/node_modules/`. Setup may regenerate local config and install dependencies.
- Avoid touching screenshots, generated build output, lockfiles, or configuration outside the requested scope unless the change requires it.
- Keep changes focused and update `README.md` or `docs/SPEC.md` when user-facing behavior, setup, architecture, or protocol contracts change.
