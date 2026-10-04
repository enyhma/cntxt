import type { IslandRegistry } from "@tinacms/astro/experimental";
import { requestWithMetadata } from "@tinacms/astro";
import { client } from "../../tina/__generated__/client";
import HomeContent from "../components/HomeContent.astro";

export const islands: IslandRegistry = {
  home: {
    fetch: async () => {
      const result = await requestWithMetadata(
        client.queries.home({ relativePath: "home.json" }),
      );
      return result.data.home;
    },
    component: HomeContent,
    wrapper: { tag: "div" },
    propsFromData: (data) => ({ data }),
  },
};
