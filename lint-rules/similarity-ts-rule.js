/**
 * Oxlint rules: similarity-ts/no-duplicates and similarity-ts/no-duplicates-error
 *
 * Integrates the `similarity-ts` CLI tool into oxlint as JS plugin rules.
 * Runs similarity-ts once (lazily on first file visit), then reports
 * diagnostics per-file as oxlint visits each source file.
 *
 * Since similarity-ts is a project-wide analysis tool, these rules use
 * createOnce + a Program visitor to run the CLI exactly once and cache
 * results, then reports matching diagnostics as each file is visited.
 *
 * Two rules are provided so oxlint can assign different severities:
 * - `no-duplicates`      — warns on similarity >= threshold but < errorThreshold
 * - `no-duplicates-error`  — errors on similarity >= errorThreshold
 *
 * Both share the same similarity-ts output cache, so the CLI runs only once.
 */

import { execSync } from "node:child_process";
import path from "node:path";

/**
 * @typedef {{ line: number, kind: string, name: string, similarity: number, pairFile: string, pairLine: number, pairKind: string, pairName: string }} SimilarityDiagnostic
 */

/** @type {Map<string, SimilarityDiagnostic[]>} */
let diagnosticsByFile = null;

/** Whether we've already run similarity-ts for this lint session. */
let hasRun = false;

/** Default similarity threshold passed to the CLI (0-1). */
const DEFAULT_THRESHOLD = 0.87;

/** Default threshold above which findings are reported as errors (0-1). */
const DEFAULT_ERROR_THRESHOLD = 0.95;

/**
 * Parse the text output of `similarity-ts` into a map from file path
 * to an array of diagnostic objects.
 * @param {string} raw - The stdout from similarity-ts
 * @param {string} cwd - The working directory for resolving relative paths
 * @returns {Map<string, SimilarityDiagnostic[]>}
 */
function parseSimilarityOutput(raw, cwd) {
	/** @type {Map<string, SimilarityDiagnostic[]>} */
	const map = new Map();

	/**
	 * @param {string} l
	 * @returns {{ file: string, line: number, kind: string, name: string, detail: string } | null}
	 */
	const parseLine = (l) => {
		const match = l.match(
			/^\s*(.+?):(\d+)(?:\s*\|\s*L(\d+)(?:-L?(\d+))?)?\s+(?:similar-type|similar-type-literal|type-literal|duplicate-function):\s+(.+?)(?:\s+\((.+?)\))?$/,
		);
		if (!match) return null;
		return {
			file: match[1],
			line: parseInt(match[3] || match[2], 10),
			kind: l.includes("similar-type:")
				? "similar-type"
				: l.includes("similar-type-literal:")
					? "similar-type-literal"
					: l.includes("type-literal:")
						? "type-literal"
						: "duplicate-function",
			name: match[5],
			detail: match[6] || "",
		};
	};

	/** @param {string} f */
	const addDiagnostic = (f) => {
		const resolved = path.resolve(cwd, f);
		if (!map.has(resolved)) map.set(resolved, []);
		return (d) => map.get(resolved).push(d);
	};

	const sections = raw.split(/Similarity: /).slice(1);
	for (const section of sections) {
		const similarityMatch = section.match(/^([\d.]+)%/);
		if (!similarityMatch) continue;
		const similarity = parseFloat(similarityMatch[1]);

		const lines = section.split("\n").filter((l) => l.trim());
		if (lines.length < 3) continue;

		const first = (lines[1] || "").trim();
		const second = (lines[2] || "").trim();

		const a = parseLine(first);
		const b = parseLine(second);

		if (a && b) {
			addDiagnostic(a.file)({
				line: a.line,
				kind: a.kind,
				name: a.name,
				similarity,
				pairFile: b.file,
				pairLine: b.line,
				pairKind: b.kind,
				pairName: b.name,
			});
			addDiagnostic(b.file)({
				line: b.line,
				kind: b.kind,
				name: b.name,
				similarity,
				pairFile: a.file,
				pairLine: a.line,
				pairKind: a.kind,
				pairName: a.name,
			});
		}
	}

	return map;
}

/**
 * Run similarity-ts and populate the diagnosticsByFile map.
 * @param {string} cwd - The project root directory
 * @param {number} threshold - Similarity threshold (0-1) passed to the CLI
 */
function runSimilarity(cwd, threshold) {
	const args = [
		"--no-fast",
		"--types",
		`-t ${threshold}`,
		"-m 3",
		"src",
	].join(" ");

	try {
		const output = execSync(`similarity-ts ${args}`, {
			encoding: "utf-8",
			cwd,
			stdio: ["pipe", "pipe", "pipe"],
			timeout: 120_000,
		});
		diagnosticsByFile = parseSimilarityOutput(output, cwd);
	} catch (err) {
		const stdout = err.stdout || "";
		diagnosticsByFile = parseSimilarityOutput(stdout, cwd);
	}

	hasRun = true;
}

/** Shared messages for both rules. */
const messages = {
	duplicateFunction:
		"Function `{{name}}` is {{similarity}}% similar to `{{pairName}}` in `{{pairFile}}:{{pairLine}}`. Consider refactoring to reduce duplication.",
	similarType:
		"Type `{{name}}` is {{similarity}}% similar to `{{pairName}}` in `{{pairFile}}:{{pairLine}}`. Consider unifying or extracting a shared type.",
	similarTypeLiteral:
		"Type literal for `{{name}}` is {{similarity}}% similar to `{{pairName}}` in `{{pairFile}}:{{pairLine}}`. Consider using the existing type definition instead.",
	typeLiteral:
		"Type literal for `{{name}}` is {{similarity}}% similar to `{{pairName}}` in `{{pairFile}}:{{pairLine}}`. Consider extracting a shared type.",
};

/** Shared schema for both rules. */
const schema = [
	{
		type: "object",
		properties: {
			threshold: {
				type: "number",
				minimum: 0,
				maximum: 1,
			},
			errorThreshold: {
				type: "number",
				minimum: 0,
				maximum: 1,
			},
			types: { type: "boolean" },
			minLines: { type: "integer", minimum: 1 },
		},
		additionalProperties: false,
	},
];

/**
 * Resolve the message ID for a given diagnostic kind.
 * @param {string} kind
 * @returns {keyof messages}
 */
function resolveMessageId(kind) {
	return (
		kind === "duplicate-function" ? "duplicateFunction"
		: kind === "similar-type" ? "similarType"
		: kind === "similar-type-literal" ? "similarTypeLiteral"
		: "typeLiteral"
	);
}

/**
 * Create a createOnce visitor that filters diagnostics by similarity range.
 * Reports diagnostics where `minSimilarity <= similarity < maxSimilarity`.
 * @param {number} minSimilarity - Lower bound (inclusive), as a percentage (e.g. 87)
 * @param {number} maxSimilarity - Upper bound (exclusive), as a percentage (e.g. 95)
 */
function createFilteredVisitor(minSimilarity, maxSimilarity) {
	return (context) => {
		const cwd = process.cwd();

		/** @type {SimilarityDiagnostic[]} */
		let fileDiagnostics = [];

		return {
			before() {
				if (!hasRun) {
					runSimilarity(cwd, DEFAULT_THRESHOLD);
				}

				const filename = context.filename;
				const resolved = path.resolve(cwd, filename);
				const all = diagnosticsByFile.get(resolved) || [];
				fileDiagnostics = all.filter(
					(d) => d.similarity >= minSimilarity && d.similarity < maxSimilarity,
				);
			},

			Program(node) {
				for (const d of fileDiagnostics) {
					context.report({
						node,
						messageId: resolveMessageId(d.kind),
						data: {
							name: d.name,
							similarity: d.similarity,
							pairName: d.pairName,
							pairFile: d.pairFile,
							pairLine: d.pairLine,
						},
						line: d.line,
					});
				}
			},
		};
	};
}

/** Rule for warn-level findings (similarity >= threshold but < errorThreshold). */
const noDuplicatesRule = {
	meta: {
		type: "suggestion",
		docs: {
			description:
				"Warn on duplicate or highly similar functions and types using similarity-ts",
			category: "Best Practices",
			recommended: true,
		},
		messages,
		schema,
	},
	createOnce: createFilteredVisitor(DEFAULT_THRESHOLD * 100, DEFAULT_ERROR_THRESHOLD * 100),
};

/** Rule for error-level findings (similarity >= errorThreshold). */
const noDuplicatesErrorRule = {
	meta: {
		type: "problem",
		docs: {
			description:
				"Error on near-identical functions and types using similarity-ts (above errorThreshold)",
			category: "Best Practices",
			recommended: true,
		},
		messages,
		schema,
	},
	createOnce: createFilteredVisitor(DEFAULT_ERROR_THRESHOLD * 100, Infinity),
};

export { noDuplicatesRule as default, noDuplicatesErrorRule };
