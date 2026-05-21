import http from "node:http";

const serviceName = process.argv[2] ?? "service";

function log(message, extra = {}) {
  console.log(JSON.stringify({
    level: "info",
    service: serviceName,
    message,
    ...extra
  }));
}

function keepAlive() {
  log("Mindory placeholder service started.", {
    task: "TASK-3",
    note: "Runtime behavior is added in later task-scoped changes."
  });
  setInterval(() => {
    log("Mindory placeholder service heartbeat.");
  }, 60_000);
}

if (serviceName === "api") {
  const host = process.env.MINDORY_API_HOST ?? "0.0.0.0";
  const port = Number.parseInt(process.env.MINDORY_API_PORT ?? "3000", 10);

  const server = http.createServer((request, response) => {
    response.setHeader("content-type", "application/json; charset=utf-8");

    if (request.url === "/_placeholder/health") {
      response.writeHead(200);
      response.end(JSON.stringify({
        status: "ok",
        service: "api",
        placeholder: true
      }));
      return;
    }

    response.writeHead(503);
    response.end(JSON.stringify({
      error: "mindory_api_placeholder",
      message: "Mindory API runtime is planned for a later task.",
      placeholder: true
    }));
  });

  server.listen(port, host, () => {
    log("Mindory API placeholder listening.", { host, port });
  });
} else {
  keepAlive();
}
