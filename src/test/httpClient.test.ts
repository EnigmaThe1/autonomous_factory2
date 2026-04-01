import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { httpRequest } from "../tools/HttpClient";

describe("HttpClient", () => {
  it("performs a successful GET request", async () => {
    const result = await httpRequest({
      method: "GET",
      url: "https://httpbin.org/get",
      timeoutMs: 10_000,
    });
    assert.equal(result.ok, true);
    assert.equal(result.status, 200);
    assert.ok(result.body, "should have a response body");
    assert.ok(result.summary.includes("200"), "summary should contain status code");
  });

  it("handles POST with body", async () => {
    const result = await httpRequest({
      method: "POST",
      url: "https://httpbin.org/post",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "value" }),
      timeoutMs: 10_000,
    });
    assert.equal(result.ok, true);
    assert.equal(result.status, 200);
    assert.ok(result.body!.includes("value"), "response should echo the body");
  });

  it("handles 404 responses", async () => {
    const result = await httpRequest({
      method: "GET",
      url: "https://httpbin.org/status/404",
      timeoutMs: 10_000,
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, 404);
  });

  it("handles timeout", async () => {
    const result = await httpRequest({
      method: "GET",
      url: "https://httpbin.org/delay/10",
      timeoutMs: 1000,
    });
    assert.equal(result.ok, false);
    assert.ok(result.summary.includes("timed out"), "should report timeout");
  });

  it("handles invalid URL", async () => {
    const result = await httpRequest({
      method: "GET",
      url: "http://this-host-does-not-exist-999.example.com",
      timeoutMs: 5000,
    });
    assert.equal(result.ok, false);
    assert.ok(result.summary.includes("error"), "should report error");
  });

  it("defaults method to GET", async () => {
    const result = await httpRequest({
      method: "",
      url: "https://httpbin.org/get",
      timeoutMs: 10_000,
    });
    assert.equal(result.ok, true);
    assert.ok(result.summary.includes("GET"));
  });

  it("ignores body for GET requests", async () => {
    const result = await httpRequest({
      method: "GET",
      url: "https://httpbin.org/get",
      body: "should be ignored",
      timeoutMs: 10_000,
    });
    assert.equal(result.ok, true);
  });

  it("returns response headers", async () => {
    const result = await httpRequest({
      method: "GET",
      url: "https://httpbin.org/get",
      timeoutMs: 10_000,
    });
    assert.ok(result.headers, "should have headers");
    assert.ok(result.headers!["content-type"], "should have content-type header");
  });
});
