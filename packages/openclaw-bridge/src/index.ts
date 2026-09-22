/**
 * TinyAGI OpenClaw Bridge
 *
 * Provides connectivity between TinyAGI multi-agent system and OpenClaw Gateway.
 * Enables TinyAGI agents to control OpenClaw nodes and use OpenClaw tools.
 */

// Core exports
export { OpenClawClient } from './client.js';
export type {
    ClientConfig,
    ClientInitializationResult,
    PairingResult,
    NodeInfo,
    ToolResult,
    InvokeOptions,
    CronJob,
    CronConfig,
} from './types.js';

// Error exports
export {
    OpenClawError,
    BRIDGE_ERROR_CODES,
    GatewayUnreachableError,
    NodeOfflineError,
    PermissionDeniedError,
    PairingRequiredError,
    ToolTimeoutError,
} from './errors.js';

// Tool wrappers
export { NodeTools } from './tools/nodes.js';
export { BrowserTools } from './tools/browser.js';
export { preflightBrowserOpen } from './tools/browser.js';
export { CronTools } from './tools/cron.js';
export type {
    CameraSnapParams,
    ScreenRecordParams,
    NotifyParams,
} from './tools/nodes.js';
export type {
    BrowserOpenParams,
    BrowserNavigateParams,
    BrowserSnapshotParams,
    BrowserScreenshotParams,
    BrowserActParams,
    BrowserConsoleParams,
} from './tools/browser.js';
export type { PublicRejectionResult } from './types.js';
export { toPublicRejectionResult } from './redaction.js';

// Re-export for convenience
export { OpenClawClient as default } from './client.js';
