export interface ClientConfig {
    /** OpenClaw Gateway URL (default: http://localhost:18789) */
    gatewayUrl?: string;
    /** Authentication token */
    token?: string;
    /** Device ID for this bridge client */
    deviceId?: string;
    /** Device display name */
    deviceName?: string;
    /** Request timeout in ms (default: 30000) */
    timeout?: number;
}

export interface PairingResult {
    success: boolean;
    deviceId?: string;
    token?: string;
    error?: string;
    requiresApproval?: boolean;
    pairingCode?: string;
}

export interface ClientInitializationResult {
    gatewayUrl: string;
    deviceId: string;
    tokenConfigured: boolean;
    tokenMode: 'configured' | 'none';
}

export interface NodeInfo {
    deviceId: string;
    displayName: string;
    platform: string;
    clientMode: string;
    role: string;
    scopes: string[];
    approvedScopes: string[];
    connected: boolean;
    lastSeenAt?: number;
}

export interface ToolResult {
    success: boolean;
    data?: unknown;
    error?: {
        code: string;
        message: string;
        details?: {
            statusCode?: number;
            reason?: string;
            retryable?: boolean;
        };
    };
    metadata?: {
        durationMs: number;
        nodeId: string;
        requestId?: string;
        originType?: RequestOrigin['type'];
        originActorId?: string;
        capabilities?: string[];
        delivery?: 'at_least_once' | 'deduplicated';
    };
}

export interface PublicRejectionResult {
    success: false;
    delivery?: 'at_least_once' | 'deduplicated';
    error: {
        code: string;
        message: string;
    };
}

export interface RequestOrigin {
    type: 'agent' | 'player' | 'cron' | 'system';
    actorId: string;
}

export interface RequestContext {
    requestId?: string;
    origin?: RequestOrigin;
    capabilities?: string[];
    attempt?: number;
    idempotencyKey?: string;
}

export interface InvokeOptions {
    /** Timeout in milliseconds */
    timeout?: number;
    /** Whether to wait for the result */
    awaitResult?: boolean;
    /** Callback for progress updates */
    onProgress?: (progress: number, message?: string) => void;
    /** Request correlation and gate context */
    context?: RequestContext;
}

export interface CronJob {
    id: string;
    name: string;
    enabled: boolean;
    schedule: {
        kind: 'every' | 'cron';
        everyMs?: number;
        cron?: string;
    };
    sessionTarget: string;
    payload: unknown;
    delivery: {
        mode: string;
        channel?: string;
    };
    state?: {
        lastRunAtMs?: number;
        lastRunStatus?: string;
        consecutiveErrors?: number;
    };
}

export interface CronConfig {
    name: string;
    enabled?: boolean;
    schedule: {
        kind: 'every' | 'cron';
        everyMs?: number;
        cron?: string;
    };
    sessionTarget?: string;
    payload: unknown;
    delivery?: {
        mode: string;
        channel?: string;
    };
}

export interface GatewayResponse<T> {
    ok: boolean;
    data?: T;
    error?: string;
}

export type OpenClawTool =
    | 'browser_open'
    | 'browser_snapshot'
    | 'browser_screenshot'
    | 'browser_act'
    | 'nodes_camera_snap'
    | 'nodes_screen_record'
    | 'nodes_notify'
    | 'cron_list'
    | 'cron_add'
    | 'cron_remove';
