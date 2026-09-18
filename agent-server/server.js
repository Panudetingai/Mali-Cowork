// ตัวอย่าง Agent Server สำหรับทดสอบ Local Port/Socket integration
// รันแยกจาก Tauri: node agent-server/server.js
import { WebSocketServer } from "ws";
import http from "node:http";

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: true }));
  }

  // SSE endpoint
  if (req.url === "/chat/stream" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const { prompt } = JSON.parse(body || "{}") || {};
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      const words = `Echo: ${prompt ?? ""} — from Agent Server`.split(" ");
      let i = 0;
      const timer = setInterval(() => {
        if (i >= words.length) {
          res.write(`data: ${JSON.stringify({ event: "done" })}\n\n`);
          clearInterval(timer);
          return res.end();
        }
        res.write(
          `data: ${JSON.stringify({ event: "chunk", data: words[i] + " " })}\n\n`,
        );
        i++;
      }, 80);
    });
    return;
  }

  res.writeHead(404).end();
});

// WebSocket endpoint
const wss = new WebSocketServer({ server, path: "/ws" });
wss.on("connection", (ws) => {
  ws.on("message", (raw) => {
    const { prompt } = JSON.parse(raw.toString());
    const words = `WS Echo: ${prompt}`.split(" ");
    let i = 0;
    const timer = setInterval(() => {
      if (i >= words.length) {
        ws.send(
          JSON.stringify({ event: "done", data: { modelId: "agent-ws" } }),
        );
        clearInterval(timer);
        return;
      }
      ws.send(
        JSON.stringify({
          event: "chunk",
          data: { text: words[i] + " " },
        }),
      );
      i++;
    }, 80);
  });
});

server.listen(PORT, () => {
  console.log(
    `Agent Server listening on http://localhost:${PORT} and ws://localhost:${PORT}/ws`,
  );
});
