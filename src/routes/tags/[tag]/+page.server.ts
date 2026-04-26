import { getConversationsByTag } from "$lib/server/db/index.js";

export const load = async ({ params }: { params: { tag: string } }) => {
    return {
        tag: params.tag,
        conversations: getConversationsByTag(params.tag),
    };
};
