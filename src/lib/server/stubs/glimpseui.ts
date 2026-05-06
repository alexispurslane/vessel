/**
 * @file Stub for the optional `glimpseui` dependency of pi-mcp-adapter.
 * This is only used during the Vite/Rolldown build to satisfy
 * the import resolution. At runtime, pi-mcp-adapter is loaded
 * directly from node_modules and handles the missing dependency gracefully.
 */
export default {};
/**
 * Check if the glimpseui module is available (always false in this stub).
 *
 * @returns false
 */
export const isGlimpseAvailable = () => false;
