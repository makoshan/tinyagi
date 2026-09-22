import type { PublicRejectionResult, ToolResult } from './types.js';

export function toPublicRejectionResult(result: ToolResult): PublicRejectionResult | null {
    if (result.success || !result.error) {
        return null;
    }

    return {
        success: false,
        ...(result.metadata?.delivery ? { delivery: result.metadata.delivery } : {}),
        error: {
            code: result.error.code,
            message: result.error.message,
        },
    };
}
