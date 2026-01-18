## Additional support for tool calls

- [ ] Let's add a function called `findResultForToolCall` function that takes a `ToolCall` or an id and then returns either the `ToolResult` or `undefined`.
- [ ] Add a `findToolCallForResult` function that takes a `ToolResult` and returns `ToolCall` or throws a `ToolCallNotFound` error—since there should _always_ be a tool call if there is a result.
- [ ] Add a `collectToolCallsAndResults` function that will return `{ toolCall: ToolCall, result: ToolResult | null }[]` array.
- [ ] When using `ConversationHistory`, tool calls should have a pointer to the result and the result should have a pointer to the tool call.
