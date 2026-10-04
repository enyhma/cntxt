import { experimental_createIslandRoute } from "@tinacms/astro/experimental";
import { islands } from "../../tina/islands";

export const prerender = false;
export const POST = experimental_createIslandRoute(islands);
