import { lookup } from 'node:dns/promises';
import type { OpenClawClient } from '../client.js';
import { BRIDGE_ERROR_CODES } from '../errors.js';
import type { InvokeOptions, RequestContext, ToolResult } from '../types.js';

export interface BrowserOpenParams {
    /** URL to open */
    url: string;
    /** Target browser tab ID (optional) */
    targetId?: string;
}

export interface BrowserNavigateParams {
    /** URL to navigate to */
    url: string;
    /** Target browser tab ID */
    targetId?: string;
}

export interface BrowserSnapshotParams {
    /** Target browser tab ID */
    targetId?: string;
    /** URL to snapshot (opens new tab if not specified) */
    targetUrl?: string;
    /** Element reference for partial snapshot */
    ref?: string;
    /** Element selector */
    element?: string;
    /** Format: 'html' or 'text' */
    format?: 'html' | 'text' | 'markdown';
}

export interface BrowserScreenshotParams {
    /** Target browser tab ID */
    targetId?: string;
    /** URL to screenshot (opens new tab if not specified) */
    targetUrl?: string;
    /** Element reference for partial screenshot */
    ref?: string;
    /** Element selector */
    element?: string;
}

export interface BrowserActParams {
    /** Action kind: click, type, scroll, etc */
    kind: string;
    /** Target browser tab ID */
    targetId?: string;
    /** Element reference */
    ref?: string;
    /** Element selector */
    selector?: string;
    /** Text to type (for 'type' action) */
    text?: string;
    /** Value to set (for form inputs) */
    value?: string;
}

export interface BrowserConsoleParams {
    /** Console log level to retrieve */
    level?: 'log' | 'warn' | 'error' | 'all';
    /** Target browser tab ID */
    targetId?: string;
}

type LookupAddressRecord = {
    address: string;
    family: number;
};

type LookupImpl = (hostname: string) => Promise<LookupAddressRecord[]>;
type BrowserFetchImpl = typeof fetch;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECT_DEPTH = 5;

function stripIpv6ZoneId(hostname: string): string {
    return hostname.replace(/^\[/, '').replace(/\]$/, '').replace(/%[0-9a-z]+$/i, '');
}

function isPrivateIpv4(hostname: string): boolean {
    return (
        hostname.startsWith('10.') ||
        hostname.startsWith('127.') ||
        hostname.startsWith('192.168.') ||
        hostname.startsWith('169.254.') ||
        hostname === '0.0.0.0' ||
        /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname) ||
        /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(hostname)
    );
}

function isPrivateIpv6(hostname: string): boolean {
    const normalized = stripIpv6ZoneId(hostname).toLowerCase();
    return (
        normalized === '::1' ||
        normalized === '::' ||
        normalized.startsWith('fc') ||
        normalized.startsWith('fd') ||
        normalized.startsWith('fe8') ||
        normalized.startsWith('fe9') ||
        normalized.startsWith('fea') ||
        normalized.startsWith('feb')
    );
}

function isBlockedHostname(hostname: string): boolean {
    const normalized = stripIpv6ZoneId(hostname.toLowerCase());
    const isLocalhost = normalized === 'localhost' || normalized === '::1' || normalized === '127.0.0.1';
    const isLocalDomain = normalized.endsWith('.local');
    const isIpv6Literal = normalized.includes(':');

    return isLocalhost || isLocalDomain || (isIpv6Literal ? isPrivateIpv6(normalized) : isPrivateIpv4(normalized));
}

function buildFailureResult(
    code: string,
    message: string,
    context?: RequestContext
): ToolResult {
    return {
        success: false,
        error: {
            code,
            message,
        },
        metadata: {
            durationMs: 0,
            nodeId: 'gateway',
            delivery: 'at_least_once',
            ...(context?.requestId ? { requestId: context.requestId } : {}),
            ...(context?.origin ? { originType: context.origin.type, originActorId: context.origin.actorId } : {}),
            ...(context?.capabilities ? { capabilities: context.capabilities } : {}),
        },
    };
}

async function resolveAndValidateDns(
    url: URL,
    context: RequestContext | undefined,
    lookupImpl: LookupImpl
): Promise<ToolResult | null> {
    if (isBlockedHostname(url.hostname)) {
        return buildFailureResult(
            BRIDGE_ERROR_CODES.ssrfBlocked,
            'Localhost, private network, link-local, and .local targets are blocked for remote browser open.',
            context
        );
    }

    try {
        const resolved = await lookupImpl(url.hostname);
        if (resolved.some((entry) => isBlockedHostname(entry.address))) {
            return buildFailureResult(
                BRIDGE_ERROR_CODES.ssrfBlocked,
                'DNS resolved the target to a private or link-local address.',
                context
            );
        }
    } catch {
        return buildFailureResult(
            BRIDGE_ERROR_CODES.urlBlocked,
            'DNS resolution failed for remote browser target.',
            context
        );
    }

    return null;
}

async function validateRedirectChain(
    url: URL,
    context: RequestContext | undefined,
    depth: number,
    lookupImpl: LookupImpl,
    fetchImpl: BrowserFetchImpl
): Promise<ToolResult | null> {
    if (depth >= MAX_REDIRECT_DEPTH) {
        return buildFailureResult(
            BRIDGE_ERROR_CODES.urlBlocked,
            'Redirect chain exceeded the allowed preflight depth.',
            context
        );
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    try {
        const response = await fetchImpl(url, {
            method: 'HEAD',
            redirect: 'manual',
            signal: controller.signal,
        });

        if (!REDIRECT_STATUSES.has(response.status)) {
            return null;
        }

        const location = response.headers.get('location');
        if (!location) {
            return buildFailureResult(
                BRIDGE_ERROR_CODES.urlBlocked,
                'Redirect target is missing a Location header.',
                context
            );
        }

        const nextUrl = new URL(location, url);
        return validateRemoteBrowserUrl(nextUrl.toString(), context, depth + 1, lookupImpl, fetchImpl);
    } catch {
        return null;
    } finally {
        clearTimeout(timeoutId);
    }
}

async function validateRemoteBrowserUrl(
    url: string,
    context?: RequestContext,
    redirectDepth = 0,
    lookupImpl: LookupImpl = defaultLookupImpl,
    fetchImpl: BrowserFetchImpl = fetch
): Promise<ToolResult | null> {
    let parsed: URL;

    try {
        parsed = new URL(url);
    } catch {
        return buildFailureResult(BRIDGE_ERROR_CODES.urlBlocked, 'Invalid browser URL.', context);
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) {
        return buildFailureResult(BRIDGE_ERROR_CODES.urlBlocked, 'Only http and https URLs are allowed.', context);
    }

    if (parsed.username || parsed.password) {
        return buildFailureResult(BRIDGE_ERROR_CODES.urlBlocked, 'Credential-bearing URLs are blocked.', context);
    }

    const dnsBlocked = await resolveAndValidateDns(parsed, context, lookupImpl);
    if (dnsBlocked) {
        return dnsBlocked;
    }

    return validateRedirectChain(parsed, context, redirectDepth, lookupImpl, fetchImpl);
}

async function defaultLookupImpl(hostname: string): Promise<LookupAddressRecord[]> {
    return lookup(hostname, {
        all: true,
        verbatim: true,
    });
}

export async function preflightBrowserOpen(
    params: BrowserOpenParams,
    options: {
        context?: RequestContext;
        lookupImpl?: LookupImpl;
        fetchImpl?: BrowserFetchImpl;
    } = {}
): Promise<ToolResult | null> {
    return validateRemoteBrowserUrl(
        params.url,
        options.context,
        0,
        options.lookupImpl ?? defaultLookupImpl,
        options.fetchImpl ?? fetch
    );
}

/**
 * Browser automation tools wrapper for OpenClaw
 */
export class BrowserTools {
    constructor(private client: OpenClawClient) {}

    /**
     * Open a URL in the browser
     */
    async open(params: BrowserOpenParams, options: InvokeOptions = {}): Promise<ToolResult> {
        const blocked = await preflightBrowserOpen(params, {
            context: options.context,
        });
        if (blocked) {
            return blocked;
        }

        return this.client.invokeTool('browser_open', {
            targetUrl: params.url,
            targetId: params.targetId,
        }, options);
    }

    /**
     * Navigate to a URL in an existing tab
     */
    async navigate(params: BrowserNavigateParams): Promise<ToolResult> {
        return this.client.invokeTool('browser_navigate', {
            targetUrl: params.url,
            targetId: params.targetId,
        });
    }

    /**
     * Get page content snapshot
     */
    async snapshot(params: BrowserSnapshotParams = {}): Promise<ToolResult> {
        return this.client.invokeTool('browser_snapshot', {
            targetId: params.targetId,
            targetUrl: params.targetUrl,
            ref: params.ref,
            element: params.element,
            format: params.format || 'text',
        });
    }

    /**
     * Take a screenshot
     */
    async screenshot(params: BrowserScreenshotParams = {}): Promise<ToolResult> {
        return this.client.invokeTool('browser_screenshot', {
            targetId: params.targetId,
            targetUrl: params.targetUrl,
            ref: params.ref,
            element: params.element,
        });
    }

    /**
     * Perform an action on the page
     */
    async act(params: BrowserActParams): Promise<ToolResult> {
        return this.client.invokeTool('browser_act', {
            request: {
                kind: params.kind,
                ref: params.ref,
                selector: params.selector,
                text: params.text,
                value: params.value,
            },
            targetId: params.targetId,
        });
    }

    /**
     * Get browser console logs
     */
    async console(params: BrowserConsoleParams = {}): Promise<ToolResult> {
        return this.client.invokeTool('browser_console', {
            level: params.level || 'all',
            targetId: params.targetId,
        });
    }

    /**
     * Get current browser status
     */
    async status(): Promise<ToolResult> {
        return this.client.invokeTool('browser_status', {});
    }

    /**
     * List open tabs
     */
    async listTabs(): Promise<ToolResult> {
        return this.client.invokeTool('browser_tabs', {});
    }

    /**
     * Focus a specific tab
     */
    async focusTab(targetId: string): Promise<ToolResult> {
        return this.client.invokeTool('browser_focus', { targetId });
    }

    /**
     * Close a specific tab
     */
    async closeTab(targetId: string): Promise<ToolResult> {
        return this.client.invokeTool('browser_close', { targetId });
    }

    /**
     * Export page as PDF
     */
    async pdf(targetId?: string): Promise<ToolResult> {
        return this.client.invokeTool('browser_pdf', { targetId });
    }

    /**
     * Upload files to a file input
     */
    async upload(params: {
        paths: string[];
        targetId?: string;
        ref?: string;
        element?: string;
    }): Promise<ToolResult> {
        return this.client.invokeTool('browser_upload', {
            paths: params.paths,
            targetId: params.targetId,
            ref: params.ref,
            element: params.element,
        });
    }
}
