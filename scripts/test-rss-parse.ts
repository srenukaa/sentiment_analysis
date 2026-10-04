// Test the XML parser with a real RSS feed
import { XMLParser } from "fast-xml-parser";
import * as fs from "fs";

const xml = fs.readFileSync("/tmp/test-rss-fresh.xml", "utf8");

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  isArray: (name) => name === "entry",
});

const parsed = parser.parse(xml) as {
  feed?: { entry?: Array<Record<string, unknown>> };
};

console.log("Parsed feed:", parsed.feed ? "yes" : "no");
console.log("Entries:", parsed?.feed?.entry?.length ?? 0);

const entries = parsed?.feed?.entry ?? [];
for (const e of entries.slice(0, 2)) {
  console.log("---");
  console.log("id:", e.id);
  console.log("title:", e.title);
  console.log("author:", JSON.stringify(e.author));
  console.log("link:", JSON.stringify(e.link));
  console.log("updated:", e.updated);
  // content might be a string OR an object with type attribute + #text
  console.log("content type:", typeof e.content);
  console.log("content value:", JSON.stringify(e.content)?.slice(0, 300));
}
