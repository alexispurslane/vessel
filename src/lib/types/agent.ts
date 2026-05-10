/**
 * @file Shared agent info types for the agent panel UI.
 *
 * Used by both the backend (session-tools) and the frontend (API layer, AgentInfoPanel).
 */

/** Info about a tool available to the agent */
export interface AgentToolInfo {
	name: string;
	description: string;
	source: string;
	scope: string;
}

/** Info about a skill available to the agent (extends AgentToolInfo with skill-specific fields) */
export interface AgentSkillInfo extends AgentToolInfo {
	disableModelInvocation: boolean;
}

/** Agent info returned to the frontend for the agent panel */
export interface AgentInfo {
	systemPrompt: string;
	tools: AgentToolInfo[];
	skills: AgentSkillInfo[];
	/** Custom system prompt from conversation settings (null = use default) */
	customSystemPrompt?: string | null;
	/** Appended system prompt instructions from conversation settings (null = nothing appended) */
	appendSystemPrompt?: string[] | null;
}
