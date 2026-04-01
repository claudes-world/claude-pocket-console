import { Hono } from "hono";
import { slashCommandsRoute } from "./slash-commands.js";
import { gitRoute } from "./git.js";

const app = new Hono();

app.route("/", slashCommandsRoute);
app.route("/", gitRoute);

export { app as terminalRoute };
