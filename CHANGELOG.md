# Changelog

## Unreleased

### Breaking

- Removed legacy deserialization/migration support; `deserializeConversation` now requires a full `Conversation` shape with `schemaVersion`, `ids`, and `messages` aligned.
- Removed `migrateConversation` export and compatibility shims around legacy schema formats.
- Removed internal backward-compatibility aliases in markdown utilities.
- Removed loose tool payload escape-hatch types.

### Added

- Tool-aware truncation and slicing with `preserveToolPairs` defaults.
- Integrity validation helpers: `validateConversationIntegrity` and `assertConversationIntegrity`.
- Tool interaction helpers: `appendToolUse`, `appendToolResult`, `getPendingToolCalls`, `getToolInteractions`.

### Changed

- Tool payload types are now strictly `JSONValue` for serialization safety.
- Redaction preserves tool linkage by default while redacting payloads.
