import { Hono } from "hono";
import { slashCommandsRoute } from "./slash-commands.js";
import { gitRoute } from "./git.js";
import { sessionsRoute } from "./sessions.js";

const app = new Hono();

app.route("/", slashCommandsRoute);
app.route("/", gitRoute);
app.route("/", sessionsRoute);

export { app as terminalRoute };
