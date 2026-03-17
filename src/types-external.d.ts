declare module '@gsd/pi-coding-agent' {
  export interface ExtensionAPI {
    registerTool(name: string, config: any): void;
    on(event: string, handler: Function): void;
    registerCommand(name: string, config: any): void;
  }
}
