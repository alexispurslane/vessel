<script lang="ts">
    /**
     * @file Streamdown-integrated code block renderer.
     *
     * Adapter component for Streamdown's `components.code` prop.
     *
     * Streamdown expects `components.code` to accept `{ token: Tokens.Code; id: string }`,
     * but our `CodeBlock` component takes `{ lang, text, codeStreaming }`.
     * This adapter bridges the gap.
     *
     * Note: Mermaid code blocks (`token.lang === 'mermaid'`) are handled by a
     * separate `components.mermaid` prop in Streamdown — they never reach this component.
     */
    import CodeBlock from "$lib/components/chat/code-block.svelte";
    import type { Tokens } from "marked";

    let { token }: { token: Tokens.Code } = $props();
</script>

<CodeBlock lang={token.lang} text={token.text} codeStreaming={false} />
