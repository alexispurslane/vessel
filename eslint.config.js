import js from "@eslint/js";
import ts from "typescript-eslint";
import svelte from "eslint-plugin-svelte";
import svelteParser from "svelte-eslint-parser";

export default ts.config(
    {
        files: ["**/*.js", "**/*.cjs"],
        ...ts.configs.disableTypeChecked,
    },
    js.configs.recommended,
    ...ts.configs.strictTypeChecked,
    ...svelte.configs["flat/recommended"],
    {
        languageOptions: {
            parserOptions: {
                projectService: {
                    allowDefaultProject: ['eslint.config.js'],
                },
                parser: ts.parser,
                extraFileExtensions: [".svelte"],
            },
        },
    },
    {
        files: ["**/*.svelte"],
        languageOptions: {
            parser: svelteParser,
            parserOptions: {
                parser: ts.parser,
            },
        },
        rules: {
            // TypeScript already catches undefined variables via type checking,
            // and Svelte files have many browser/DOM globals that are annoying
            // to enumerate. no-undef is redundant here.
            "no-undef": "off",
        },
    },
    {
        rules: {
            // Allow variables prefixed with _ to be unused (discard pattern)
            "@typescript-eslint/no-unused-vars": [
                "error",
                {
                    args: "all",
                    argsIgnorePattern: "^_",
                    vars: "all",
                    varsIgnorePattern: "^_",
                    caughtErrors: "all",
                    caughtErrorsIgnorePattern: "^_",
                    destructuredArrayIgnorePattern: "^_",
                },
            ],

            // === Code Complexity Rules ===

            // Cyclomatic complexity: number of independent paths through code
            // Lower = easier to test and understand
            complexity: ["warn", { max: 15 }],

            // Maximum lines per function (excluding blank lines and comments)
            "max-lines-per-function": [
                "warn",
                {
                    max: 80,
                    skipBlankLines: true,
                    skipComments: true,
                },
            ],

            // Maximum number of parameters in a function
            "max-params": ["warn", { max: 4 }],

            // Maximum depth of nested blocks
            "max-depth": ["warn", { max: 4 }],

            // Maximum depth of nested callbacks
            "max-nested-callbacks": ["warn", { max: 4 }],

            // Maximum lines per file
            "max-lines": [
                "warn",
                {
                    max: 1000,
                    skipBlankLines: true,
                    skipComments: true,
                },
            ],

            // Maximum number of statements in a function
            "max-statements": ["warn", { max: 30 }],
        },
    },
    {
        ignores: [
            ".svelte-kit/**",
            "build/**",
            "dist/**",
            "node_modules/**",
            ".svelte-kit/",
        ],
    },
);
