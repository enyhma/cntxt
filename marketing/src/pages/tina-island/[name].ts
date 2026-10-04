import { experimental_createIslandRoute } from "@tinacms/astro/experimental";
import { islands } from "../../tina/islands";

export const prerender = false;
export const GET = experimental_createIslandRoute(islands);
