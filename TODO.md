# TODO

- [x]   1. Model names above avatars in messages use raw IDs — should look up display names from the model list
- [x]   2. Model dropdown should show display names (fallback to ID if no display name)
- [x]   3. Ellipsis truncation for model/user names isn't working — need explicit Tailwind to make `truncate` work with the flex layout
- [x]   4. Error events from Pi (timeouts, rate limits, rejections) are not shown in the UI
- [x]   5. Tool calls and their output aren't restored from session history on page reload
- [x]   6. Blank message bubble appears alongside thinking when model thinks then calls a tool with no text output — hide bubble if content is empty
- [x]   7. Tool output shown twice: once as a message bubble, once inside the tool call dropdown — remove the duplicate bubble
