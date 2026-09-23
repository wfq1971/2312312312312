import { Hono } from "hono";
import type { HonoEnv } from "../types/hono";
import audioRoutes from "./audio";
import chatRoutes from "./chat";
import imagesRoutes from "./images";
import messagesRoutes from "./messages";
import modelsRoutes from "./models";
import probeRoutes from "./probe";
import responsesRoutes from "./responses";

const app = new Hono<HonoEnv>();

app.route("/models", modelsRoutes);
// Mounted before the POST routes so HEAD/GET reachability probes resolve.
app.route("/", probeRoutes);
app.route("/chat", chatRoutes);
app.route("/responses", responsesRoutes);
app.route("/images", imagesRoutes);
app.route("/audio", audioRoutes);
app.route("/messages", messagesRoutes);

export default app;
