export const BRIDGE_ERROR_CODES = {
    requestFailed: 'REQUEST_FAILED',
    urlBlocked: 'URL_BLOCKED',
    ssrfBlocked: 'SSRF_BLOCKED',
} as const;

export class OpenClawError extends Error {
    constructor(
        message: string,
        public code: string,
        public statusCode?: number,
        public details?: unknown
    ) {
        super(message);
        this.name = 'OpenClawError';
    }
}

export class GatewayUnreachableError extends OpenClawError {
    constructor(message = 'OpenClaw Gateway is unreachable') {
        super(message, 'GATEWAY_UNREACHABLE');
        this.name = 'GatewayUnreachableError';
    }
}

export class NodeOfflineError extends OpenClawError {
    constructor(nodeId: string) {
        super(`Node ${nodeId} is offline`, 'NODE_OFFLINE');
        this.name = 'NodeOfflineError';
    }
}

export class PermissionDeniedError extends OpenClawError {
    constructor(scope: string) {
        super(`Permission denied: ${scope}`, 'PERMISSION_DENIED');
        this.name = 'PermissionDeniedError';
    }
}

export class PairingRequiredError extends OpenClawError {
    constructor() {
        super('Device pairing required', 'PAIRING_REQUIRED');
        this.name = 'PairingRequiredError';
    }
}

export class ToolTimeoutError extends OpenClawError {
    constructor(tool: string, timeoutMs: number) {
        super(`Tool ${tool} timed out after ${timeoutMs}ms`, 'TOOL_TIMEOUT');
        this.name = 'ToolTimeoutError';
    }
}
