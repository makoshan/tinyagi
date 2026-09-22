import { AgentAdapter, InvokeOptions } from './types';
import { log } from '../logging';

/**
 * Generic OpenAI Chat Completions HTTP adapter.
 * Works with any provider that implements the standard
 * POST /v1/chat/completions endpoint (Kimi, DeepSeek, etc.).
 *
 * Credentials are passed via envOverrides:
 *   OPENAI_API_KEY  → Authorization: Bearer <key>
 *   OPENAI_BASE_URL → base URL (e.g. https://api.moonshot.cn/v1)
 */
export const openaiHttpAdapter: AgentAdapter = {
    providers: ['openai-http'],

    async invoke(opts: InvokeOptions): Promise<string> {
        const { agentId, message, systemPrompt, model, envOverrides, onEvent } = opts;
        log('DEBUG', `Using OpenAI HTTP adapter (agent: ${agentId})`);

        const baseUrl = (envOverrides.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
        const apiKey = envOverrides.OPENAI_API_KEY;
        if (!apiKey) {
            throw new Error('openai-http adapter: OPENAI_API_KEY is required');
        }

        const messages: { role: string; content: string }[] = [];
        if (systemPrompt) {
            messages.push({ role: 'system', content: systemPrompt });
        }
        messages.push({ role: 'user', content: message });

        const body: Record<string, unknown> = {
            model: model || 'gpt-4',
            messages,
        };

        // Streaming path
        if (onEvent) {
            body.stream = true;
            const res = await fetch(`${baseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`,
                },
                body: JSON.stringify(body),
            });

            if (!res.ok) {
                const errText = await res.text();
                throw new Error(`OpenAI HTTP ${res.status}: ${errText}`);
            }

            let fullResponse = '';
            const reader = res.body?.getReader();
            if (!reader) throw new Error('No response body');

            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });

                const lines = buffer.split('\n');
                buffer = lines.pop()!;

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed || !trimmed.startsWith('data: ')) continue;
                    const data = trimmed.slice(6);
                    if (data === '[DONE]') continue;
                    try {
                        const json = JSON.parse(data);
                        const delta = json.choices?.[0]?.delta?.content;
                        if (delta) {
                            fullResponse += delta;
                            onEvent(fullResponse);
                        }
                    } catch { /* skip malformed chunks */ }
                }
            }

            return fullResponse || 'Sorry, I could not generate a response.';
        }

        // Non-streaming path
        const res = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify(body),
        });

        if (!res.ok) {
            const errText = await res.text();
            throw new Error(`OpenAI HTTP ${res.status}: ${errText}`);
        }

        const json = await res.json() as { choices?: { message?: { content?: string } }[]; usage?: unknown };
        const content = json.choices?.[0]?.message?.content;

        if (content) {
            log('INFO', `OpenAI HTTP usage (${agentId}): ${JSON.stringify(json.usage || {})}`);
        }

        return content || 'Sorry, I could not generate a response.';
    },
};
