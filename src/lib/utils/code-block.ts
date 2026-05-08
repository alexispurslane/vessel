/**
 * @file Shared utilities for code block handling.
 *
 * Used by both the per-block CodeBlock component and the per-message
 * download-zip action in ChatMessage.
 */

/**
 * Map markdown lang identifiers to file extensions.
 *
 * @param l - The markdown language identifier
 * @returns The file extension (without leading dot), or "txt" if unknown
 */
export function langToExt(l: string): string {
    if (!l) return "txt";
    const lower = l.toLowerCase();
    const extensions: Record<string, string> = {
        javascript: "js",
        js: "js",
        typescript: "ts",
        ts: "ts",
        tsx: "tsx",
        jsx: "jsx",
        python: "py",
        py: "py",
        rust: "rs",
        rs: "rs",
        ruby: "rb",
        rb: "rb",
        go: "go",
        java: "java",
        kotlin: "kt",
        kt: "kt",
        swift: "swift",
        c: "c",
        cpp: "cpp",
        "c++": "cpp",
        "c#": "cs",
        cs: "cs",
        php: "php",
        perl: "pl",
        pl: "pl",
        r: "r",
        scala: "scala",
        haskell: "hs",
        hs: "hs",
        lua: "lua",
        dart: "dart",
        elixir: "ex",
        ex: "ex",
        erlang: "erl",
        clojure: "clj",
        sql: "sql",
        html: "html",
        css: "css",
        scss: "scss",
        sass: "sass",
        less: "less",
        xml: "xml",
        json: "json",
        yaml: "yaml",
        yml: "yml",
        toml: "toml",
        ini: "ini",
        markdown: "md",
        md: "md",
        shell: "sh",
        bash: "sh",
        sh: "sh",
        zsh: "sh",
        fish: "fish",
        powershell: "ps1",
        dockerfile: "Dockerfile",
        makefile: "mk",
        graphql: "graphql",
        protobuf: "proto",
        vue: "vue",
        svelte: "svelte",
        diff: "diff",
        plaintext: "txt",
        text: "txt",
    };
    return extensions[lower] ?? "txt";
}

/**
 * Generate a short unique ID for download filenames.
 *
 * @param length - The number of characters in the ID
 * @returns A random alphanumeric string
 */
export function generateId(length: number = 8): string {
    // Character pool for short IDs — not a credential
    // oxlint-disable-next-line secure-coding/no-hardcoded-credentials
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    let id = "";
    for (let i = 0; i < length; i++) {
        id += chars[Math.floor(Math.random() * chars.length)];
    }
    return id;
}
