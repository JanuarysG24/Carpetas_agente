import { readFileSync } from "node:fs";
const m = await import("./dist/src/index.js");
console.log("exports:", Object.keys(m).join(", "));
