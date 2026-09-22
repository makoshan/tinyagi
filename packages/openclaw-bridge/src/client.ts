import type {
    ClientConfig,
    ClientInitializationResult,
    PairingResult,
    NodeInfo,
    ToolResult,
    InvokeOptions,
    CronJob,
    CronConfig,
    RequestContext,
} from './types.js';
import {
    OpenClawError,
    GatewayUnreachableError,
    NodeOfflineError,
    PermissionDeniedError,
    PairingRequiredError,
    ToolTimeoutError,
} from './errors.js';

interface PendingRequest {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
}

export class OpenClawClient {
    private gatewayUrl: string;
    private token?: string;
    private deviceId: string;
    private deviceName: string;
    private timeout: number;
    private ws?: WebSocket;
    private pendingRequests = new Map<string, PendingRequest>();
    private connected = false;

    constructor(config: ClientConfig = {}) {
        this.gatewayUrl = (config.gatewayUrl || 'http://localhost:18789').replace(/\/$/, '');
        this.token = config.token;
        this.deviceId = config.deviceId || this.generateDeviceId();
        this.deviceName = config.deviceName || 'TinyAGI-Bridge';
        this.timeout = config.timeout || 30000;
    }

    private generateDeviceId(): string {
        const chars = '0123456789abcdef';
        let result = '';
        for (let i = 0; i < 64; i++) {
            result += chars[Math.floor(Math.random() * chars.length)];
        }
        return result;
    }

    /** Check if Gateway is reachable */
    async isGatewayReachable(): Promise<boolean> {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);
            const response = await fetch(`${this.gatewayUrl}/health`, {
                method: 'GET',
                signal: controller.signal,
            });
            clearTimeout(timeoutId);
            return response.ok;
        } catch {
            return false;
        }
    }

    /** Start device pairing process */
    async pair(): Promise<PairingResult> {
        try {
            // Step 1: Initiate pairing
            const response = await fetch(`${this.gatewayUrl}/pairing/start`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    deviceId: this.deviceId,
                    displayName: this.deviceName,
                    clientMode: 'bridge',
                    platform: typeof process !== 'undefined' ? process.platform : 'unknown',
                }),
            });

            if (!response.ok) {
                const error = await response.text();
                return { success: false, error: `Pairing initiation failed: ${error}` };
            }

            const data = await response.json() as { pairingCode?: string; requiresApproval?: boolean };

            // Step 2: If approval required, wait for it
            if (data.requiresApproval) {
                return {
                    success: false,
                    requiresApproval: true,
                    pairingCode: data.pairingCode,
                    error: 'Pairing requires approval. Please approve in OpenClaw UI.',
                };
            }

            // Step 3: Complete pairing and get token
            return this.completePairing(data.pairingCode!);
        } catch (error) {
            if (error instanceof OpenClawError) throw error;
            throw new OpenClawError(
                `Pairing failed: ${(error as Error).message}`,
                'PAIRING_FAILED'
            );
        }
    }

    /** Complete pairing with approval code */
    async completePairing(pairingCode: string): Promise<PairingResult> {
        try {
            const response = await fetch(`${this.gatewayUrl}/pairing/approve/${pairingCode}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    deviceId: this.deviceId,
                    approvedScopes: ['operator.read', 'operator.write', 'node'],
                }),
            });

            if (!response.ok) {
                const error = await response.text();
                return { success: false, error: `Pairing approval failed: ${error}` };
            }

            const data = await response.json() as { token?: string };
            this.token = data.token;

            return {
                success: true,
                deviceId: this.deviceId,
                token: data.token,
            };
        } catch (error) {
            return {
                success: false,
                error: `Pairing completion failed: ${(error as Error).message}`,
            };
        }
    }

    /** Set authentication token */
    setToken(token: string): void {
        this.token = token;
    }

    /** Get current device ID */
    getDeviceId(): string {
        return this.deviceId;
    }

    /** Return a minimal initialization summary without touching Gateway routes */
    async initialize(): Promise<ClientInitializationResult> {
        return {
            gatewayUrl: this.gatewayUrl,
            deviceId: this.deviceId,
            tokenConfigured: Boolean(this.token),
            tokenMode: this.token ? 'configured' : 'none',
        };
    }

    /** List all paired nodes */
    async listNodes(): Promise<NodeInfo[]> {
        this.ensureAuthenticated();
        const response = await this.request<{ nodes: NodeInfo[] }>('/nodes', 'GET');
        return response.nodes || [];
    }

    /** Get specific node info */
    async getNodeInfo(nodeId: string): Promise<NodeInfo | null> {
        this.ensureAuthenticated();
        try {
            const response = await this.request<NodeInfo>(`/nodes/${nodeId}`, 'GET');
            return response;
        } catch (error) {
            if ((error as OpenClawError).code === 'NODE_NOT_FOUND') {
                return null;
            }
            throw error;
        }
    }

    /** Invoke a tool on a specific node */
    async invokeNodeTool(
        nodeId: string,
        tool: string,
        params: Record<string, unknown>,
        options: InvokeOptions = {}
    ): Promise<ToolResult> {
        const timeout = options.timeout || this.timeout;
        const startTime = Date.now();

        try {
            this.ensureAuthenticated();

            // Check if node is available
            const node = await this.getNodeInfo(nodeId);
            if (!node) {
                return this.failureResult(nodeId, startTime, new NodeOfflineError(nodeId), options.context);
            }

            // Invoke the tool
            const result = await this.request<{
                success: boolean;
                data?: unknown;
                error?: { code: string; message: string };
                deduplicated?: boolean;
            }>(
                `/nodes/${nodeId}/invoke`,
                'POST',
                {
                    tool,
                    params,
                    awaitResult: options.awaitResult !== false,
                    context: options.context,
                },
                timeout
            );

            const durationMs = Date.now() - startTime;

            if (!result.success) {
                return {
                    success: false,
                    error: result.error || { code: 'UNKNOWN_ERROR', message: 'Tool invocation failed' },
                    metadata: this.buildMetadata(
                        nodeId,
                        durationMs,
                        options.context,
                        result.deduplicated ? 'deduplicated' : 'at_least_once'
                    ),
                };
            }

            return {
                success: true,
                data: result.data,
                metadata: this.buildMetadata(
                    nodeId,
                    durationMs,
                    options.context,
                    result.deduplicated ? 'deduplicated' : 'at_least_once'
                ),
            };
        } catch (error) {
            return this.failureResult(nodeId, startTime, error, options.context);
        }
    }

    /** Invoke a general OpenClaw tool */
    async invokeTool(
        tool: string,
        params: Record<string, unknown>,
        options: InvokeOptions = {}
    ): Promise<ToolResult> {
        this.ensureAuthenticated();

        const timeout = options.timeout || this.timeout;
        const startTime = Date.now();

        try {
            const result = await this.request<{
                success: boolean;
                data?: unknown;
                error?: { code: string; message: string };
            }>(
                '/tools/invoke',
                'POST',
                { tool, params, awaitResult: options.awaitResult !== false },
                timeout
            );

            const durationMs = Date.now() - startTime;

            if (!result.success) {
                return {
                    success: false,
                    error: result.error || { code: 'UNKNOWN_ERROR', message: 'Tool invocation failed' },
                    metadata: { durationMs, nodeId: 'gateway' },
                };
            }

            return {
                success: true,
                data: result.data,
                metadata: { durationMs, nodeId: 'gateway' },
            };
        } catch (error) {
            if (error instanceof OpenClawError) throw error;

            const durationMs = Date.now() - startTime;
            return {
                success: false,
                error: {
                    code: 'INVOCATION_FAILED',
                    message: (error as Error).message,
                },
                metadata: { durationMs, nodeId: 'gateway' },
            };
        }
    }

    /** List all cron jobs */
    async listCronJobs(options: InvokeOptions = {}): Promise<ToolResult> {
        const startTime = Date.now();

        try {
            this.ensureAuthenticated();
            const response = await this.request<{ jobs: CronJob[] }>('/cron/jobs', 'GET');
            return {
                success: true,
                data: response.jobs || [],
                metadata: this.buildMetadata('gateway', Date.now() - startTime, options.context),
            };
        } catch (error) {
            return this.failureResult('gateway', startTime, error, options.context);
        }
    }

    /** Create a new cron job */
    async createCronJob(config: CronConfig, options: InvokeOptions = {}): Promise<ToolResult> {
        const startTime = Date.now();

        try {
            this.ensureAuthenticated();
            const response = await this.request<CronJob>('/cron/jobs', 'POST', {
                ...config,
                enabled: config.enabled !== false,
                sessionTarget: config.sessionTarget || 'isolated',
                context: options.context,
            });
            return {
                success: true,
                data: response,
                metadata: this.buildMetadata('gateway', Date.now() - startTime, options.context),
            };
        } catch (error) {
            return this.failureResult('gateway', startTime, error, options.context);
        }
    }

    /** Delete a cron job */
    async deleteCronJob(id: string, options: InvokeOptions = {}): Promise<ToolResult> {
        const startTime = Date.now();

        try {
            this.ensureAuthenticated();
            await this.request<void>(`/cron/jobs/${id}`, 'DELETE', {
                context: options.context,
            });
            return {
                success: true,
                data: { deleted: true, id },
                metadata: this.buildMetadata('gateway', Date.now() - startTime, options.context),
            };
        } catch (error) {
            return this.failureResult('gateway', startTime, error, options.context);
        }
    }

    /** Enable/disable a cron job */
    async toggleCronJob(id: string, enabled: boolean): Promise<CronJob | null> {
        this.ensureAuthenticated();
        try {
            const response = await this.request<CronJob>(
                `/cron/jobs/${id}`,
                'PUT',
                { enabled }
            );
            return response;
        } catch (error) {
            if ((error as OpenClawError).code === 'NOT_FOUND') {
                return null;
            }
            throw error;
        }
    }

    /** Connect WebSocket for real-time updates */
    async connectWebSocket(): Promise<void> {
        if (this.ws?.readyState === WebSocket.OPEN) {
            return;
        }

        if (!this.token) {
            throw new PairingRequiredError();
        }

        const wsUrl = this.gatewayUrl.replace(/^http/, 'ws');
        this.ws = new WebSocket(`${wsUrl}/ws?token=${this.token}`);

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new GatewayUnreachableError('WebSocket connection timeout'));
            }, 10000);

            this.ws!.onopen = () => {
                clearTimeout(timeout);
                this.connected = true;
                resolve();
            };

            this.ws!.onerror = (error) => {
                clearTimeout(timeout);
                reject(new GatewayUnreachableError(`WebSocket error: ${error}`));
            };

            this.ws!.onclose = () => {
                this.connected = false;
                this.ws = undefined;
            };

            this.ws!.onmessage = (event) => {
                this.handleWebSocketMessage(event.data);
            };
        });
    }

    /** Disconnect WebSocket */
    disconnect(): void {
        if (this.ws) {
            this.ws.close();
            this.ws = undefined;
            this.connected = false;
        }
    }

    /** Check if WebSocket is connected */
    isConnected(): boolean {
        return this.connected && this.ws?.readyState === WebSocket.OPEN;
    }

    private handleWebSocketMessage(data: string): void {
        try {
            const message = JSON.parse(data) as {
                type: string;
                requestId?: string;
                payload?: unknown;
            };

            if (message.requestId && this.pendingRequests.has(message.requestId)) {
                const request = this.pendingRequests.get(message.requestId)!;
                this.pendingRequests.delete(message.requestId);
                clearTimeout(request.timeout);

                if (message.type === 'error') {
                    request.reject(new OpenClawError(
                        (message.payload as { message: string }).message || 'WebSocket error',
                        'WS_ERROR'
                    ));
                } else {
                    request.resolve(message.payload);
                }
            }
        } catch {
            // Ignore malformed messages
        }
    }

    private ensureAuthenticated(): void {
        if (!this.token) {
            throw new PairingRequiredError();
        }
    }

    private buildMetadata(
        nodeId: string,
        durationMs: number,
        context?: RequestContext,
        delivery: 'at_least_once' | 'deduplicated' = 'at_least_once'
    ): NonNullable<ToolResult['metadata']> {
        return {
            durationMs,
            nodeId,
            delivery,
            ...(context?.requestId ? { requestId: context.requestId } : {}),
            ...(context?.origin ? { originType: context.origin.type, originActorId: context.origin.actorId } : {}),
            ...(context?.capabilities ? { capabilities: context.capabilities } : {}),
        };
    }

    private failureResult(
        nodeId: string,
        startTime: number,
        error: unknown,
        context?: RequestContext
    ): ToolResult {
        const durationMs = Date.now() - startTime;

        if (error instanceof OpenClawError) {
            return {
                success: false,
                error: {
                    code: error.code,
                    message: error.message,
                    details: {
                        ...(error.statusCode !== undefined ? { statusCode: error.statusCode } : {}),
                        ...(error.code === 'GATEWAY_UNREACHABLE' ? { reason: 'gateway_unreachable', retryable: true } : {}),
                        ...(error.code === 'TOOL_TIMEOUT' ? { reason: 'timeout', retryable: true } : {}),
                    },
                },
                metadata: this.buildMetadata(nodeId, durationMs, context),
            };
        }

        return {
            success: false,
            error: {
                code: 'INVOCATION_FAILED',
                message: (error as Error).message,
                details: {
                    reason: 'unexpected_error',
                    retryable: false,
                },
            },
            metadata: this.buildMetadata(nodeId, durationMs, context),
        };
    }

    private async request<T>(
        path: string,
        method: 'GET' | 'POST' | 'PUT' | 'DELETE',
        body?: unknown,
        timeoutMs?: number
    ): Promise<T> {
        const url = `${this.gatewayUrl}${path}`;
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
        };

        if (this.token) {
            headers['Authorization'] = `Bearer ${this.token}`;
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs || this.timeout);

        try {
            const response = await fetch(url, {
                method,
                headers,
                body: body ? JSON.stringify(body) : undefined,
                signal: controller.signal,
            });

            clearTimeout(timeout);

            if (response.status === 401) {
                throw new PermissionDeniedError('Invalid or expired token');
            }

            if (response.status === 403) {
                throw new PermissionDeniedError('Insufficient permissions');
            }

            if (response.status === 404) {
                throw new OpenClawError('Resource not found', 'NOT_FOUND', 404);
            }

            if (response.status === 503) {
                throw new GatewayUnreachableError('Gateway service unavailable');
            }

            if (!response.ok) {
                const errorText = await response.text();
                throw new OpenClawError(
                    `Request failed: ${errorText}`,
                    'REQUEST_FAILED',
                    response.status
                );
            }

            // Handle empty responses
            if (response.status === 204) {
                return undefined as T;
            }

            return await response.json() as T;
        } catch (error) {
            clearTimeout(timeout);

            if (error instanceof OpenClawError) throw error;

            if ((error as Error).name === 'AbortError') {
                throw new ToolTimeoutError(`${method} ${path}`, timeoutMs || this.timeout);
            }

            throw new GatewayUnreachableError((error as Error).message);
        }
    }
}
