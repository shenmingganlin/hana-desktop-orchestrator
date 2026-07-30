# Roadmap

## V0.1 Scaffold

- Manifest and configuration
- PowerShell bridge
- Window list
- Desktop snapshot
- Action planner
- Dry-run protected click
- Dry-run protected focus

## V0.2 Semantic UIA

- Window-scoped UIA tree
- Snapshot-local element ids
- `click-element` dry-run and guarded UIA Invoke path
- Cursor overlay preview protocol
- stale snapshot guard with element signatures
- `type-element` UIA ValuePattern dry-run/input planning
- post-action UIA signature verification
- screenshot region visual diff verification
- region crop preview files
- approval panel protocol bundle
- approval widget exposed through explicit full-access dev slot
- temp-file lease snapshot store
- session-local snapshot store

## V0.3 Review Cockpit

- recent approval bundle store
- cockpit auto-load
- observation-only visual/region preview buttons
- DOM-only cursor overlay animation
- guarded crop image proxy
- approval checklist state machine
- local non-executable approval token generator
- approval token store with TTL and SHA-256 hash
- execution preflight gate
- final execution dry-run envelope
- audit timeline
- self-check tool
- protocol test matrix
- pure in-memory fixture sandbox
- cockpit summary dashboard
- audit timeline hash-chain
- audit evidence JSON export through widget API

## V0.4 Packaging Hardening

- update README and safety docs
- add release hardening checklist
- validate manifest and route/widget exposure
- verify registered tool list remains stable
- document dev tool discovery boundary around audit export wrappers
- add package structure checks
- add regression smoke commands
- prepare version bump

## V0.5 Visual Layer

- OCR text anchors
- image anchors
- richer screenshot diff
- visual action verification summaries
- preview history

## V0.6 Real Control Provider

This phase remains blocked until review cockpit, regression checks, and explicit real-input policy are stable.

Potential first real-control scope:

- minimal UIA Invoke only
- no raw mouse movement
- keyboard and clipboard fallback remain separately gated and are limited to `type-element`
- no focus/window switching unless separately gated
- mandatory fresh lease verification
- mandatory immediate signature verification
- mandatory post-action verification
- mandatory audit event append

## V0.7 UI Panel Expansion

- approval queue
- audit filters
- audit export history
- target window inspector
- event hash-chain visualization
- compact health summary mode
