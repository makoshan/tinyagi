import { OpenClawClient } from './client.js';
import { BRIDGE_ERROR_CODES } from './errors.js';
import { toPublicRejectionResult } from './redaction.js';
import { preflightBrowserOpen } from './tools/browser.js';

function assert(condition: unknown, message: string): void {
    if (!condition) {
        throw new Error(message);
    }
}

async function main(): Promise<void> {
    const client = new OpenClawClient({
        gatewayUrl: 'http://localhost:18789',
    });

    const result = await client.initialize();
    const metadataEndpointBlocked = await preflightBrowserOpen({
        url: 'http://169.254.169.254/latest/meta-data',
    }, {
        context: {
            requestId: 'req-ssrf-001',
            origin: {
                type: 'agent',
                actorId: 'coder',
            },
        },
    });
    assert(metadataEndpointBlocked?.error?.code === BRIDGE_ERROR_CODES.ssrfBlocked, 'metadata IP must be blocked');

    const ipv6LinkLocalBlocked = await preflightBrowserOpen({
        url: 'http://[fe80::1]/',
    });
    assert(ipv6LinkLocalBlocked?.error?.code === BRIDGE_ERROR_CODES.ssrfBlocked, 'IPv6 link-local must be blocked');

    const dnsPrivateBlocked = await preflightBrowserOpen({
        url: 'https://public.example.test',
    }, {
        lookupImpl: async () => [
            {
                address: '192.168.10.20',
                family: 4,
            },
        ],
    });
    assert(dnsPrivateBlocked?.error?.code === BRIDGE_ERROR_CODES.ssrfBlocked, 'DNS private resolution must be blocked');

    const redirectPrivateBlocked = await preflightBrowserOpen({
        url: 'https://redirect.example.test',
    }, {
        lookupImpl: async () => [
            {
                address: '93.184.216.34',
                family: 4,
            },
        ],
        fetchImpl: async () =>
            new Response(null, {
                status: 302,
                headers: {
                    location: 'http://127.0.0.1/admin',
                },
            }),
    });
    assert(redirectPrivateBlocked?.error?.code === BRIDGE_ERROR_CODES.ssrfBlocked, 'redirect to private target must be blocked');

    const publicRejection = toPublicRejectionResult(metadataEndpointBlocked!);
    assert(publicRejection?.error.code === BRIDGE_ERROR_CODES.ssrfBlocked, 'public rejection should retain safe code');
    assert(!('metadata' in publicRejection!), 'public rejection must not expose internal metadata');

    console.log(JSON.stringify(result));
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
