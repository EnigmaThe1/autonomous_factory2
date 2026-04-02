import test from "node:test";
import assert from "node:assert/strict";
import { summarizeBraveWebResults, summarizeDuckDuckGoInstantAnswer } from "../tools/WebResearchTools";

test("summarizeBraveWebResults: empty and malformed", () => {
  assert.deepEqual(summarizeBraveWebResults(null), { text: "", topUrls: [] });
  assert.deepEqual(summarizeBraveWebResults({}), { text: "", topUrls: [] });
  assert.deepEqual(summarizeBraveWebResults({ web: {} }), { text: "", topUrls: [] });
});

test("summarizeBraveWebResults: maps web.results", () => {
  const data = {
    web: {
      results: [
        { title: "A", description: "Desc A", url: "https://a.example" },
        { title: "B", url: "https://b.example" }
      ]
    }
  };
  const r = summarizeBraveWebResults(data);
  assert.match(r.text, /A/);
  assert.match(r.text, /Desc A/);
  assert.match(r.text, /B/);
  assert.deepEqual(r.topUrls, ["https://a.example", "https://b.example"]);
});

test("summarizeDuckDuckGoInstantAnswer: heading and abstract", () => {
  const r = summarizeDuckDuckGoInstantAnswer({
    Heading: "Topic",
    AbstractText: "Body text.",
    AbstractURL: "https://duck.example/x"
  });
  assert.match(r.text, /Topic/);
  assert.match(r.text, /Body text/);
  assert.equal(r.attribution, "https://duck.example/x");
});
