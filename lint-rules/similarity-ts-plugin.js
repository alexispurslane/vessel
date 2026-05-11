import noDuplicates, { noDuplicatesErrorRule } from "./similarity-ts-rule.js";

/** @type {import('eslint').ESLintPlugin} */
const plugin = {
	meta: {
		name: "similarity-ts",
	},
	rules: {
		"no-duplicates": noDuplicates,
		"no-duplicates-error": noDuplicatesErrorRule,
	},
};

export default plugin;
