import js from "@eslint/js";
import ts from "typescript-eslint";
import svelte from "eslint-plugin-svelte";
import svelteParser from "svelte-eslint-parser";
import sonarjs from "eslint-plugin-sonarjs";

// eslint-disable-next-line @typescript-eslint/no-deprecated, sonarjs/deprecation -- ts.config is the standard typescript-eslint config API
export default ts.config(
    sonarjs.configs.recommended,
    {
        files: ["**/*.js", "**/*.cjs"],
        ...ts.configs.disableTypeChecked,
        languageOptions: {
            parserOptions: {
                projectService: {
                    allowDefaultProject: ['eslint.config.js', 'svelte.config.js'],
                },
            },
        },
    },
    js.configs.recommended,
    ...ts.configs.strictTypeChecked,
    ...svelte.configs["flat/recommended"],
    {
        languageOptions: {
            parserOptions: {
                projectService: {
                    allowDefaultProject: ['eslint.config.js', 'svelte.config.js'],
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
            // Svelte 5's @render tag is the idiomatic way to invoke snippets,
            // but these rules flag it as a "void expression". Disable them since
            // @render is a statement, not an expression.
            "@typescript-eslint/no-void-expression": "off",
            "@typescript-eslint/no-confusing-void-expression": "off",
            // Svelte 5's @render tag invokes snippets that may return void.
            // This is idiomatic and expected — disable the SonarJS rule that
            // flags using the return value of void functions.
            "sonarjs/no-use-of-empty-return-value": "off",
            // document.execCommand('insertText') is deprecated but has no modern
            // replacement for contentEditable text insertion in Svelte components.
            "sonarjs/deprecation": "off",
            "@typescript-eslint/no-deprecated": "off",
        },
    },
    {
        rules: {
            "@typescript-eslint/no-dynamic-delete": "off",
            "@typescript-eslint/restrict-template-expressions": "off",
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

            // === Code Complexity Rules (SonarJS) ===
            "sonarjs/cognitive-complexity": ["warn", 15],
            "sonarjs/cyclomatic-complexity": "off",
            "sonarjs/max-lines-per-function": ["warn", { maximum: 80 }],
            "sonarjs/max-lines": ["warn", { maximum: 1000 }],
            "max-params": ["warn", { max: 4 }],
            "max-depth": ["warn", { max: 4 }],
            "max-nested-callbacks": ["warn", { max: 4 }],
            "max-statements": ["warn", { max: 30 }],
            "sonarjs/no-nested-conditional": "off",
            "sonarjs/no-unused-vars": "off",
        },
    },
    {
        ignores: [
            ".svelte-kit/**",
            "build/**",
            "dist/**",
            "node_modules/**",
            ".svelte-kit/",
            // shadcn-svelte UI components are vendored — don't lint them
            "src/lib/components/ui/**",
            // Config files — not worth linting
            "eslint.config.js",
            "svelte.config.js",
        ],
    },
);
