import { AgentAdapter, InvokeOptions } from './types';
import { runCommand, runCommandStreaming } from '../invoke';
import { log } from '../logging';

/**
 * Strip tool-call artifacts that gpt-5.x sometimes leaks into agent_message text.
 * Removes lines like: `assistant to=functions.exec_command commentary ...json`
 * and `{"cmd":"...","workdir":"..."}` blocks, plus prompt-injection noise.
 */
function cleanResponseText(text: string): string {
    return text
        .split('\n')
        .filter(line => {
            const trimmed = line.trim();
            // Remove tool-call preamble lines
            if (/^(assistant|analysis)\s+to=functions\./i.test(trimmed)) return false;
            // Remove raw JSON tool-call payloads
            if (/^\{"cmd":/i.test(trimmed)) return false;
            // Remove prompt-injection noise
            if (/^(Ignore\.|done\.|end\.|It won't end)/i.test(trimmed)) return false;
            return true;
        })
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

/**
 * Extract displayable text from a Codex JSONL event.
 */
function extractEventText(json: any): string | null {
    if (json.type === 'item.completed' && json.item?.type === 'agent_message') {
        const raw = json.item.text || null;
        return raw ? cleanResponseText(raw) : null;
    }
    return null;
}

export const codexAdapter: AgentAdapter = {
    providers: ['openai'],

    async invoke(opts: InvokeOptions): Promise<string> {
        const { agentId, message, workingDir, systemPrompt, model, shouldReset, envOverrides, onEvent } = opts;
        log('DEBUG', `Using Codex CLI (agent: ${agentId})`);

        const args = ['exec'];
        if (shouldReset) {
            log('INFO', `Resetting Codex conversation for agent: ${agentId}`);
        } else {
            args.push('resume', '--last');
        }
        if (model) args.push('--model', model);
        if (systemPrompt) args.push('-c', `developer_instructions=${systemPrompt}`);
        args.push('--skip-git-repo-check', '--dangerously-bypass-approvals-and-sandbox', '--json', message);

        let response = '';

        if (onEvent) {
            const { promise } = runCommandStreaming('codex', args, (line) => {
                try {
                    const json = JSON.parse(line);
                    const text = extractEventText(json);
                    if (text) {
                        response = text;
                        onEvent(text);
                    }
                } catch (e) {
                    // Ignore non-JSON lines
                }
            }, workingDir, envOverrides, agentId);
            await promise;
        } else {
            const output = await runCommand('codex', args, workingDir, envOverrides);
            const lines = output.trim().split('\n');
            for (const line of lines) {
                try {
                    const json = JSON.parse(line);
                    if (json.type === 'item.completed' && json.item?.type === 'agent_message') {
                        response = cleanResponseText(json.item.text || '');
                    }
                } catch (e) {
                    // Ignore non-JSON lines
                }
            }
        }

        return response || 'Sorry, I could not generate a response from Codex.';
    },
};
