"use strict";

/**
 * Minimal vscode API for Node integration tests (MissionOrchestrator, MissionStore, etc.).
 * Keys match defaults used by `vscode.workspace.getConfiguration().get(key, default)`.
 */
const configValues = new Map();

/** Sane defaults for headless orchestrator tests (overridable via `__setTestConfig`). */
const configDefaults = {
  "myAi.missions.requirePlannerCoverage": false,
  "myAi.missions.autoCheckpointEveryStep": false,
  "myAi.memory.enableGlobalSemanticMemory": false,
  "myAi.missions.portableJson": false,
  "myAi.sendSelection": false,
  "myAi.sendActiveFile": false,
  "myAi.sendDiagnostics": false,
  "myAi.tools.requireApprovalForInWorkspaceWrites": true
};

function setConfig(key, value) {
  configValues.set(key, value);
}

function getConfig(key, defaultValue) {
  if (configValues.has(key)) return configValues.get(key);
  if (Object.prototype.hasOwnProperty.call(configDefaults, key)) return configDefaults[key];
  return defaultValue;
}

const RelativePattern = class {
  constructor(base, pattern) {
    this.base = base;
    this.pattern = pattern;
  }
};

const workspace = {
  name: undefined,
  workspaceFolders: undefined,
  findFiles: async () => [],
  getConfiguration(_section) {
    return {
      get(key, defaultValue) {
        return getConfig(key, defaultValue);
      },
      update: async () => {},
      inspect: () => undefined,
      has: () => false
    };
  },
  openTextDocument: async () => ({ getText: () => "" }),
  fs: {
    stat: async () => {
      throw new Error("vscode.workspace.fs.stat not stubbed");
    },
    readFile: async () => new Uint8Array(),
    writeFile: async () => {}
  }
};

const window = {
  activeTextEditor: undefined,
  showInformationMessage: async () => undefined,
  showWarningMessage: async () => undefined,
  showErrorMessage: async () => undefined,
  withProgress: async (_opts, task) => task({ report: () => {} }, new (class {
    onCancellationRequested = () => ({ dispose: () => {} });
  })())
};

const languages = {
  getDiagnostics: () => []
};

const env = {
  machineId: "test-machine",
  sessionId: "test-session"
};

const pathMod = require("path");

const Uri = {
  file: (p) => ({ fsPath: p, scheme: "file", path: p }),
  parse: (s) => ({ fsPath: s, scheme: "file", path: s }),
  joinPath: (base, ...parts) => {
    const joined = pathMod.join(base.fsPath || base.path || "", ...parts);
    return { fsPath: joined, scheme: "file", path: joined };
  }
};

const CancellationTokenSource = class {
  constructor() {
    this.token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => {} }) };
  }
  cancel() {}
  dispose() {}
};

module.exports = {
  workspace,
  RelativePattern,
  window,
  languages,
  env,
  Uri,
  CancellationTokenSource,
  /** Test hook: set a config key before running orchestrator. */
  __setTestConfig: setConfig,
  __clearTestConfig: () => configValues.clear()
};
