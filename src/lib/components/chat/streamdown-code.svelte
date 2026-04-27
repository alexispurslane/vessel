<!--
  Adapter component for Streamdown's `components.code` prop.

  Streamdown expects `components.code` to accept `{ token: Tokens.Code; id: string }`,
  but our `CodeBlock` component takes `{ lang, text, codeStreaming }`.
  This adapter bridges the gap.

  Note: Mermaid code blocks (`token.lang === 'mermaid'`) are handled by a
  separate `components.mermaid` prop in Streamdown — they never reach this component.
-->
<script lang="ts">
    import CodeBlock from "$lib/components/chat/code-block.svelte";
    import type { Tokens } from "marked";

    let { token, id: _id }: { token: Tokens.Code; id: string } = $props();
</script>

<CodeBlock lang={token.lang} text={token.text} codeStreaming={false} />
