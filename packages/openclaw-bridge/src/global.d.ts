declare module 'process' {
    global {
        namespace NodeJS {
            interface Process {
                platform: string;
                env: Record<string, string | undefined>;
                argv: string[];
                exit(code?: number): never;
            }
        }
        const process: NodeJS.Process;
    }
}

declare const process: {
    platform: string;
    env: Record<string, string | undefined>;
    argv: string[];
    exit(code?: number): never;
};
