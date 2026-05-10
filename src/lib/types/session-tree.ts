/**
 * @file Shared session tree types for DAG visualization.
 *
 * Used by both the backend (session-history, session-messages, session-store)
 * and the frontend (message-dag component, API layer).
 */

/** A node in the session tree for DAG visualization */
export interface SessionTreeNodeData {
	/** Entry ID */
	id: string;
	/** Parent entry ID (null for root) */
	parentId: string | null;
	/** Entry type (message, model_change, etc.) */
	type: string;
	/** Message role (only for type=message entries) */
	role?: string;
	/** First few words of the message content */
	preview: string;
	/** Full message content (for hover expansion) */
	fullContent: string;
	/** Whether this entry is on the current active branch (from root to leaf) */
	onActiveBranch: boolean;
	/** Whether this entry is the current leaf */
	isCurrentLeaf: boolean;
}

/** A relation in the session tree DAG */
export interface SessionTreeRelation {
	id: string;
	parentId: string;
	childId: string;
}
