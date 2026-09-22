import type { OpenClawClient } from '../client.js';
import type { CronConfig, InvokeOptions, ToolResult } from '../types.js';

/**
 * Cron tools wrapper for OpenClaw
 */
export class CronTools {
    constructor(private client: OpenClawClient) {}

    async list(options: InvokeOptions = {}): Promise<ToolResult> {
        return this.client.listCronJobs(options);
    }

    async create(config: CronConfig, options: InvokeOptions = {}): Promise<ToolResult> {
        return this.client.createCronJob(config, options);
    }

    async remove(id: string, options: InvokeOptions = {}): Promise<ToolResult> {
        return this.client.deleteCronJob(id, options);
    }
}
