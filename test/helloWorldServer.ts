const bindHost: string = process.env.DEVHOST_BIND_HOST ?? "127.0.0.1";
const host: string = process.env.HOST ?? "hello.xcv.lol";
const portText: string = process.env.PORT ?? "3200";
const port: number = Number.parseInt(portText, 10);

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error(`PORT must be a valid TCP port, received: ${portText}`);
}

const server = Bun.serve({
  hostname: bindHost,
  port,
  fetch(): Response {
    return new Response(
      JSON.stringify(
        {
          message: "hello from bun",
          host,
          port,
          bindHost,
          url: `https://${host}`,
        },
        null,
        2,
      ),
      {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
      },
    );
  },
});

console.log(`helloWorldServer listening on http://${bindHost}:${server.port} for ${host}`);
