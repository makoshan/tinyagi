import {
    MessageJobData, AgentConfig, TeamConfig,
    log, emitEvent,
    findTeamForAgent, insertChatMessage,
    enqueueMessage, genId,
} from '@tinyagi/core';
import { convertTagsToReadable, extractTeammateMentions, extractChatRoomMessages } from './routing';

// ── Team Chat Room ───────────────────────────────────────────────────────────

export function postToChatRoom(
    teamId: string,
    fromAgent: string,
    message: string,
    teamAgents: string[],
    originalData: { channel: string; sender: string; senderId?: string | null; messageId: string },
    depth = 0
): number {
    const chatMsg = `[Chat room #${teamId} — @${fromAgent}]:\n${message}`;
    const id = insertChatMessage(teamId, fromAgent, message);
    for (const agentId of teamAgents) {
        if (agentId === fromAgent) continue;
        enqueueMessage({
            channel: 'chatroom',
            sender: originalData.sender,
            senderId: originalData.senderId ?? undefined,
            message: chatMsg,
            messageId: genId('chat'),
            agent: agentId,
            fromAgent,
            depth,
        });
    }
    return id;
}

// ── Team Orchestration ───────────────────────────────────────────────────────

function resolveTeamContext(
    agentId: string,
    isTeamRouted: boolean,
    teams: Record<string, TeamConfig>
): { teamId: string; team: TeamConfig } | null {
    if (isTeamRouted) {
        for (const [tid, t] of Object.entries(teams)) {
            if (t.leader_agent === agentId && t.agents.includes(agentId)) {
                return { teamId: tid, team: t };
            }
        }
    }
    return findTeamForAgent(agentId, teams);
}

const MAX_ROUTING_DEPTH = 6;

/**
 * Handle team orchestration for a response. Stateless — no conversation tracking.
 *
 * 1. Post chat room broadcasts
 * 2. Resolve team context
 * 3. Stream response to user
 * 4. Extract teammate mentions → enqueue as flat DMs
 *
 * Enforces a max routing depth to prevent infinite agent loops.
 */
export async function handleTeamResponse(params: {
    agentId: string;
    response: string;
    isTeamRouted: boolean;
    data: MessageJobData;
    agents: Record<string, AgentConfig>;
    teams: Record<string, TeamConfig>;
}): Promise<boolean> {
    const { agentId, response, isTeamRouted, data, agents, teams } = params;
    const { channel, sender, messageId } = data;
    const currentDepth = data.depth ?? 0;

    if (currentDepth >= MAX_ROUTING_DEPTH) {
        log('WARN', `Max routing depth (${MAX_ROUTING_DEPTH}) reached for agent ${agentId} — stopping further routing to prevent infinite loops`);
        return false;
    }

    // Extract and post [#team_id: message] chat room broadcasts
    const chatRoomMsgs = extractChatRoomMessages(response, agentId, teams);
    if (chatRoomMsgs.length > 0) {
        log('INFO', `Chat room broadcasts from @${agentId}: ${chatRoomMsgs.map(m => `#${m.teamId}`).join(', ')}`);
    }
    for (const crMsg of chatRoomMsgs) {
        postToChatRoom(crMsg.teamId, agentId, crMsg.message, teams[crMsg.teamId].agents, {
            channel, sender, senderId: data.senderId, messageId,
        }, currentDepth + 1);
    }

    const teamContext = resolveTeamContext(agentId, isTeamRouted, teams);
    if (!teamContext) {
        log('DEBUG', `No team context for agent ${agentId} — falling back to direct response`);
        return false;
    }

    // Extract teammate mentions and enqueue as flat DMs (skip pure acknowledgements)
    const ACK_PATTERN = /^[\s]*(?:收到|明确|对齐|了解|好的|确认|OK|Roger|Acknowledged|noted|保持静默|继续保持|同步|继续按|继续只在|后续只在|后续继续)[。.，,！!]?\s*$/i;
    const allMentions = extractTeammateMentions(response, agentId, teamContext.teamId, teams, agents);
    const teammateMentions = allMentions.filter(m => {
        // Extract just the directed part (after the "------" separator if present)
        const directed = m.message.includes('------\n\nDirected to you:\n')
            ? m.message.split('------\n\nDirected to you:\n').pop()!
            : m.message;
        if (ACK_PATTERN.test(directed)) {
            log('DEBUG', `Skipping acknowledgement from @${agentId} → @${m.teammateId}: "${directed.trim()}"`);
            return false;
        }
        return true;
    });
    if (teammateMentions.length > 0) {
        log('INFO', `@${agentId} → ${teammateMentions.map(m => `@${m.teammateId}`).join(', ')}`);
        for (const mention of teammateMentions) {
            emitEvent('agent:mention', { teamId: teamContext.teamId, fromAgent: agentId, toAgent: mention.teammateId });

            const internalMsg = `[Message from teammate @${agentId}]:\n${mention.message}`;
            enqueueMessage({
                channel,
                sender,
                senderId: data.senderId ?? undefined,
                message: internalMsg,
                messageId: genId('internal'),
                agent: mention.teammateId,
                fromAgent: agentId,
                depth: currentDepth + 1,
            });
        }
    }

    return true;
}
