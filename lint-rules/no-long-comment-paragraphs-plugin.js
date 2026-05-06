import noLongCommentParagraphs from "./no-long-comment-paragraphs-rule.js";

/** @type {import('eslint').ESLintPlugin} */
const plugin = {
    meta: {
        name: "local",
    },
    rules: {
        "no-long-comment-paragraphs": noLongCommentParagraphs,
    },
};

export default plugin;
