/**
 * Ambient type declarations for webview JavaScript files.
 * Provides VS Code webview API and common DOM helpers.
 */

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;
