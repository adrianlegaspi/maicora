import { buildContainer } from "./container.js";
import { buildServer } from "./server.js";

const container = buildContainer();
const app = await buildServer(container);

await app.listen({ port: container.config.port, host: "0.0.0.0" });
