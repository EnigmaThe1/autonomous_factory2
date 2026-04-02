import test from "node:test";
import assert from "node:assert/strict";
import {
  htmlToPlainTextForAgent,
  summarizeDuckDuckGoInstantAnswer
} from "../tools/WebResearchTools";

test("htmlToPlainTextForAgent strips tags and scripts", () => {
  const html = `<html><script>evil()</script><p>Hello <b>world</b></p></html>`;
  assert.equal(htmlToPlainTextForAgent(html), "Hello world");
});

test("summarizeDuckDuckGoInstantAnswer: builds text from abstract", () => {
  const { text, attribution } = summarizeDuckDuckGoInstantAnswer({
    Heading: "Topic",
    AbstractText: "Short summary here.",
    AbstractURL: "https://example.com"
  });
  assert.match(text, /Topic/);
  assert.match(text, /Short summary/);
  assert.equal(attribution, "https://example.com");
});

test("summarizeDuckDuckGoInstantAnswer: empty on bad input", () => {
  assert.equal(summarizeDuckDuckGoInstantAnswer(null).text, "");
  assert.equal(summarizeDuckDuckGoInstantAnswer("x").text, "");
});
