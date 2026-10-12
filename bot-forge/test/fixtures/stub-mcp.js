// A tiny stdio MCP server for tests: answers initialize and tools/list.
let buffer = "";
process.stdin.on("data", (d) => {
  buffer += d;
  let i;
  while ((i = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, i);
    buffer = buffer.slice(i + 1);
    if (!line.trim()) continue;
    const m = JSON.parse(line);
    const reply = (result) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: m.id, result }) + "\n");
    if (m.method === "initialize") {
      process.stdout.write("a log line that isn't JSON\n");
      reply({ protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "stub" } });
    } else if (m.method === "tools/list") {
      reply({ tools: [{ name: "search_mail", inputSchema: { type: "object" } }, { name: process.env.STUB_TOOL || "archive", inputSchema: { type: "object" } }] });
    }
  }
});
