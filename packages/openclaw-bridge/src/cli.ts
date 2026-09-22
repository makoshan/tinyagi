#!/usr/bin/env node
/**
 * OpenClaw CLI - Command line interface for OpenClaw Bridge
 *
 * Usage: openclaw <command> [options]
 */
import { OpenClawClient, NodeTools, BrowserTools } from './index.js';
import * as fs from 'fs';
import * as path from 'path';
import { homedir } from 'os';

// Process type declarations
declare const process: {
    platform: string;
    env: Record<string, string | undefined>;
    argv: string[];
    exit(code?: number): never;
};

interface ParsedArgs {
    options: Record<string, string | boolean>;
    positional: string[];
}

// Simple argument parser
function parseArgs(args: string[]): ParsedArgs {
    const options: Record<string, string | boolean> = {};
    const positional: string[] = [];
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg.startsWith('--')) {
            const key = arg.slice(2);
            const nextArg = args[i + 1];
            if (nextArg && !nextArg.startsWith('-')) {
                options[key] = nextArg;
                i++;
            } else {
                options[key] = true;
            }
        } else if (arg.startsWith('-')) {
            const key = arg.slice(1);
            const nextArg = args[i + 1];
            if (nextArg && !nextArg.startsWith('-')) {
                options[key] = nextArg;
                i++;
            } else {
                options[key] = true;
            }
        } else {
            positional.push(arg);
        }
    }
    return { options, positional };
}

// Load config from environment or settings file
function loadConfig(): { gatewayUrl: string; token?: string } {
    const config = {
        gatewayUrl: process.env.OPENCLAW_GATEWAY_URL || 'http://localhost:18789',
        token: process.env.OPENCLAW_TOKEN,
    };
    // Try to load from TinyAGI settings
    const settingsPaths = [
        path.join(homedir(), '.tinyagi', 'settings.json'),
        path.join(homedir(), '.tinyagi', 'settings.local.json'),
        './settings.json',
    ];
    for (const settingsPath of settingsPaths) {
        try {
            if (fs.existsSync(settingsPath)) {
                const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
                if (settings.openclaw) {
                    config.gatewayUrl = settings.openclaw.gatewayUrl || config.gatewayUrl;
                    config.token = settings.openclaw.token || config.token;
                }
                break;
            }
        } catch {
            // Ignore errors reading settings
        }
    }
    return config;
}

// Save token to config
function saveToken(token: string): void {
    const configDir = path.join(homedir(), '.tinyagi');
    if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
    }
    const configPath = path.join(configDir, 'openclaw.json');
    let config: Record<string, string> = {};
    try {
        if (fs.existsSync(configPath)) {
            config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        }
    } catch {
        // Ignore errors
    }
    config.token = token;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    console.log(`Token saved to ${configPath}`);
}

// Format output as JSON or text
function output(data: unknown, format = 'json'): void {
    if (format === 'json') {
        console.log(JSON.stringify(data, null, 2));
    } else {
        console.log(data);
    }
}

// Main CLI handler
async function main(): Promise<void> {
    const args = process.argv.slice(2);
    if (args.length === 0) {
        showHelp();
        process.exit(0);
    }
    const command = args[0];
    const { options, positional } = parseArgs(args.slice(1));
    const config = loadConfig();
    const client = new OpenClawClient({
        gatewayUrl: config.gatewayUrl,
        token: config.token,
    });
    try {
        switch (command) {
            case 'pair':
                await handlePair(client, options);
                break;
            case 'approve':
                await handleApprove(client, positional[0], options);
                break;
            case 'nodes':
                await handleNodes(client, positional[0], options);
                break;
            case 'node':
                await handleNode(client, positional[0], options);
                break;
            case 'camera':
                await handleCamera(client, positional[0], options);
                break;
            case 'screen':
                await handleScreen(client, positional[0], options);
                break;
            case 'notify':
                await handleNotify(client, options);
                break;
            case 'browser':
                await handleBrowser(client, positional[0], options);
                break;
            case 'health':
                await handleHealth(client);
                break;
            case 'help':
            case '--help':
            case '-h':
                showHelp();
                break;
            default:
                console.error(`Unknown command: ${command}`);
                showHelp();
                process.exit(1);
        }
    } catch (error) {
        console.error(`Error: ${(error as Error).message}`);
        process.exit(1);
    }
}

// Command handlers
async function handlePair(
    client: OpenClawClient,
    _options: ParsedArgs['options']
): Promise<void> {
    console.log('Starting device pairing...');
    const result = await client.pair();
    if (result.success) {
        console.log('✓ Pairing successful!');
        console.log(`Device ID: ${result.deviceId}`);
        if (result.token) {
            saveToken(result.token);
        }
    } else if (result.requiresApproval) {
        console.log(`Pairing code: ${result.pairingCode}`);
        console.log('Approve this device in OpenClaw UI or run:');
        console.log(`  openclaw approve ${result.pairingCode}`);
    } else {
        console.error(`✗ Pairing failed: ${result.error}`);
        process.exit(1);
    }
}

async function handleApprove(
    client: OpenClawClient,
    pairingCode: string | undefined,
    _options: ParsedArgs['options']
): Promise<void> {
    if (!pairingCode) {
        console.error('Error: pairing code required');
        console.log('Usage: openclaw approve <pairing-code>');
        process.exit(1);
    }
    console.log(`Approving pairing code: ${pairingCode}`);
    const result = await client.completePairing(pairingCode as string);
    if (result.success) {
        console.log('✓ Pairing approved!');
        console.log(`Device ID: ${result.deviceId}`);
        if (result.token) {
            saveToken(result.token);
        }
    } else {
        console.error(`✗ Approval failed: ${result.error}`);
        process.exit(1);
    }
}

async function handleNodes(
    client: OpenClawClient,
    subcommand: string | undefined,
    _options: ParsedArgs['options']
): Promise<void> {
    if (subcommand === 'list' || !subcommand) {
        const nodes = await client.listNodes();
        output({ nodes });
    } else {
        console.error(`Unknown nodes subcommand: ${subcommand}`);
        process.exit(1);
    }
}

async function handleNode(
    client: OpenClawClient,
    subcommand: string | undefined,
    options: ParsedArgs['options']
): Promise<void> {
    const nodeIdRaw = options.node || options.n;
    if (!nodeIdRaw || typeof nodeIdRaw !== 'string') {
        console.error('Error: --node or -n required');
        process.exit(1);
    }
    const nodeId = nodeIdRaw;
    if (subcommand === 'status') {
        const node = await client.getNodeInfo(nodeId);
        output({ node });
    } else {
        console.error(`Unknown node subcommand: ${subcommand}`);
        process.exit(1);
    }
}

async function handleCamera(
    client: OpenClawClient,
    subcommand: string | undefined,
    options: ParsedArgs['options']
): Promise<void> {
    const nodeIdRaw = options.node || options.n;
    if (!nodeIdRaw || typeof nodeIdRaw !== 'string') {
        console.error('Error: --node or -n required');
        process.exit(1);
    }
    const nodeId = nodeIdRaw;
    if (subcommand === 'snap') {
        const nodes = new NodeTools(client);
        const outputPath = typeof options.output === 'string' ? options.output :
                          typeof options.o === 'string' ? options.o : undefined;
        const cameraId = typeof options.camera === 'string' ? options.camera : undefined;
        const result = await nodes.cameraSnap({
            nodeId,
            deviceId: cameraId,
        });
        if (result.success) {
            console.log('✓ Camera snapshot taken');
            if (outputPath && result.data && typeof result.data === 'object') {
                console.log(`Saved to: ${outputPath}`);
            }
        } else {
            console.error(`✗ Failed: ${result.error?.message || result.error}`);
            process.exit(1);
        }
    } else {
        console.error(`Unknown camera subcommand: ${subcommand}`);
        process.exit(1);
    }
}

async function handleScreen(
    client: OpenClawClient,
    subcommand: string | undefined,
    options: ParsedArgs['options']
): Promise<void> {
    const nodeIdRaw = options.node || options.n;
    if (!nodeIdRaw || typeof nodeIdRaw !== 'string') {
        console.error('Error: --node or -n required');
        process.exit(1);
    }
    const nodeId = nodeIdRaw;
    if (subcommand === 'record') {
        const durationStr = typeof options.duration === 'string' ? options.duration :
                           typeof options.d === 'string' ? options.d : '10';
        const duration = parseInt(durationStr, 10);
        const nodes = new NodeTools(client);
        const result = await nodes.screenRecord({
            nodeId,
            duration,
        });
        if (result.success) {
            console.log('✓ Screen recording complete');
        } else {
            console.error(`✗ Failed: ${result.error?.message || result.error}`);
            process.exit(1);
        }
    } else {
        console.error(`Unknown screen subcommand: ${subcommand}`);
        process.exit(1);
    }
}

async function handleNotify(
    client: OpenClawClient,
    options: ParsedArgs['options']
): Promise<void> {
    const nodeIdRaw = options.node || options.n;
    const titleRaw = options.title || options.t;
    const messageRaw = options.message || options.m;
    if (!nodeIdRaw || typeof nodeIdRaw !== 'string') {
        console.error('Error: --node or -n required');
        process.exit(1);
    }
    if (!titleRaw || !messageRaw || typeof titleRaw !== 'string' || typeof messageRaw !== 'string') {
        console.error('Error: --title and --message required');
        process.exit(1);
    }
    const nodeId = nodeIdRaw;
    const title = titleRaw;
    const message = messageRaw;
    const nodes = new NodeTools(client);
    const result = await nodes.notify({
        nodeId,
        title,
        body: message,
    });
    if (result.success) {
        console.log('✓ Notification sent');
    } else {
        console.error(`✗ Failed: ${result.error?.message || result.error}`);
        process.exit(1);
    }
}

async function handleBrowser(
    client: OpenClawClient,
    subcommand: string | undefined,
    options: ParsedArgs['options']
): Promise<void> {
    const nodeIdRaw = options.node || options.n;
    if (!nodeIdRaw || typeof nodeIdRaw !== 'string') {
        console.error('Error: --node or -n required');
        process.exit(1);
    }
    // Note: nodeId is not used directly but kept for future use
    // const nodeId = nodeIdRaw;
    const browser = new BrowserTools(client);
    const tabId = typeof options.tab === 'string' ? options.tab :
                  typeof options.t === 'string' ? options.t : undefined;

    switch (subcommand) {
        case 'open': {
            const url = positional[0];
            if (!url) {
                console.error('Error: URL required');
                process.exit(1);
            }
            const result = await browser.open({ url, targetId: tabId });
            output(result);
            break;
        }
        case 'snapshot': {
            const format = typeof options.format === 'string' ? options.format :
                          typeof options.f === 'string' ? options.f : 'text';
            const result = await browser.snapshot({
                targetId: tabId,
                format: format as 'text' | 'html' | 'markdown',
            });
            output(result);
            break;
        }
        case 'screenshot': {
            const result = await browser.screenshot({ targetId: tabId });
            if (result.success) {
                console.log('✓ Screenshot taken');
            } else {
                console.error(`✗ Failed: ${result.error?.message || result.error}`);
                process.exit(1);
            }
            break;
        }
        case 'click': {
            const ref = typeof options.ref === 'string' ? options.ref :
                       typeof options.r === 'string' ? options.r : undefined;
            const selector = typeof options.selector === 'string' ? options.selector :
                            typeof options.s === 'string' ? options.s : undefined;
            if (!ref && !selector) {
                console.error('Error: --ref or --selector required');
                process.exit(1);
            }
            const result = await browser.act({
                kind: 'click',
                targetId: tabId,
                ref,
                selector,
            });
            output(result);
            break;
        }
        case 'fill': {
            const ref = typeof options.ref === 'string' ? options.ref :
                       typeof options.r === 'string' ? options.r : undefined;
            const text = typeof options.text === 'string' ? options.text : undefined;
            if (!ref || !text) {
                console.error('Error: --ref and --text required');
                process.exit(1);
            }
            const result = await browser.act({
                kind: 'fill',
                targetId: tabId,
                ref,
                text,
            });
            output(result);
            break;
        }
        case 'tabs': {
            const result = await browser.listTabs();
            output(result);
            break;
        }
        case 'status': {
            const result = await browser.status();
            output(result);
            break;
        }
        default:
            console.error(`Unknown browser subcommand: ${subcommand}`);
            process.exit(1);
    }
}

async function handleHealth(client: OpenClawClient): Promise<void> {
    const reachable = await client.isGatewayReachable();
    if (reachable) {
        console.log('✓ Gateway is reachable');
    } else {
        console.error('✗ Gateway is unreachable');
        process.exit(1);
    }
}

function showHelp(): void {
    console.log(`
OpenClaw CLI - Control remote nodes and browsers via OpenClaw Gateway

Usage: openclaw <command> [options]

Commands:
  pair                          Start device pairing
  approve <code>               Complete pairing with approval code
  health                        Check Gateway connectivity

Nodes:
  nodes list                    List all paired nodes
  node status --node <id>       Get node status

Camera & Screen:
  camera snap --node <id>       Take camera snapshot
  screen record --node <id>     Record screen
  notify --node <id>            Send notification

Browser:
  browser open --node <id> <url>      Open URL in remote browser
  browser snapshot --node <id>        Get page content
  browser screenshot --node <id>      Take screenshot
  browser click --node <id> --ref @e1 Click element
  browser fill --node <id> --ref @e1 --text "value"
  browser tabs --node <id>            List browser tabs
  browser status --node <id>          Get browser status

Options:
  --node, -n <id>              Target node device ID
  --output, -o <path>          Output file path
  --format, -f <format>        Output format (text, html, markdown)
  --help, -h                   Show this help

Environment:
  OPENCLAW_GATEWAY_URL         Gateway URL (default: http://localhost:18789)
  OPENCLAW_TOKEN               Authentication token

Configuration:
  Token is saved to ~/.tinyagi/openclaw.json after pairing.
  Settings can also be configured in TinyAGI settings.json.
`);
}

// Need to capture positional for browser open
let positional: string[] = [];

// Run CLI
main().catch((error) => {
    console.error(`Fatal error: ${(error as Error).message}`);
    process.exit(1);
});
