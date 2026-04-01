"use strict";

const Module = require("module");
const path = require("path");

const stubPath = path.join(__dirname, "vscode-stub.cjs");

const origRequire = Module.prototype.require;
Module.prototype.require = function (id) {
  if (id === "vscode") {
    return require(stubPath);
  }
  return origRequire.apply(this, arguments);
};
