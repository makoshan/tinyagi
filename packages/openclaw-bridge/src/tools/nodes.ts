import type { OpenClawClient } from '../client.js';
import type { InvokeOptions, ToolResult } from '../types.js';

export interface CameraSnapParams {
    /** Node device ID */
    nodeId: string;
    /** Camera facing direction */
    facing?: 'front' | 'back';
    /** Specific device ID (optional) */
    deviceId?: string;
}

export interface ScreenRecordParams {
    /** Node device ID */
    nodeId: string;
    /** Recording duration in seconds (default: 10) */
    duration?: number;
    /** Recording duration in milliseconds */
    durationMs?: number;
    /** Frames per second (default: 30) */
    fps?: number;
    /** Screen index for multi-monitor setups */
    screenIndex?: number;
}

export interface NotifyParams {
    /** Node device ID */
    nodeId: string;
    /** Notification title */
    title: string;
    /** Notification body */
    body: string;
}

/**
 * Node tools wrapper for OpenClaw
 */
export class NodeTools {
    constructor(private client: OpenClawClient) {}

    /**
     * Take a photo from a node's camera
     */
    async cameraSnap(params: CameraSnapParams, options: InvokeOptions = {}): Promise<ToolResult> {
        return this.client.invokeNodeTool(params.nodeId, 'nodes_camera_snap', {
            node: params.nodeId,
            facing: params.facing,
            deviceId: params.deviceId,
        }, options);
    }

    /**
     * Record screen from a node
     */
    async screenRecord(params: ScreenRecordParams, options: InvokeOptions = {}): Promise<ToolResult> {
        const durationMs = params.durationMs || (params.duration || 10) * 1000;
        return this.client.invokeNodeTool(params.nodeId, 'nodes_screen_record', {
            node: params.nodeId,
            durationMs,
            fps: params.fps,
            screenIndex: params.screenIndex,
        }, options);
    }

    /**
     * Send notification to a node
     */
    async notify(params: NotifyParams, options: InvokeOptions = {}): Promise<ToolResult> {
        return this.client.invokeNodeTool(params.nodeId, 'nodes_notify', {
            node: params.nodeId,
            title: params.title,
            body: params.body,
        }, options);
    }

    /**
     * List available cameras on a node
     */
    async listCameras(nodeId: string, options: InvokeOptions = {}): Promise<ToolResult> {
        return this.client.invokeNodeTool(nodeId, 'nodes_camera_list', {
            node: nodeId,
        }, options);
    }

    /**
     * Get node status
     */
    async getStatus(nodeId: string, options: InvokeOptions = {}): Promise<ToolResult> {
        return this.client.invokeNodeTool(nodeId, 'nodes_describe', {
            node: nodeId,
        }, options);
    }
}
