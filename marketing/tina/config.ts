import { defineConfig } from "tinacms";

const branch = process.env.HEAD || process.env.VERCEL_GIT_COMMIT_REF || "main";

export default defineConfig({
  branch,
  // ponytail: local-only admin (no Tina Cloud yet) — set TINA_CLIENT_ID/TINA_TOKEN
  // once a non-dev editor needs the hosted /admin instead of running `pnpm dev`.
  clientId: process.env.TINA_CLIENT_ID || null,
  token: process.env.TINA_TOKEN || null,
  build: {
    outputFolder: "admin",
    publicFolder: "public",
  },
  media: {
    tina: {
      mediaRoot: "images",
      publicFolder: "public",
    },
  },
  schema: {
    collections: [
      {
        name: "home",
        label: "Homepage",
        path: "content/home",
        format: "json",
        ui: {
          allowedActions: { create: false, delete: false },
          // Without this, clicking the document opens the plain full-page
          // form editor instead of Visual Editing — the admin has no other
          // way to know this singleton document renders at "/".
          router: () => "/",
        },
        fields: [
          {
            type: "object",
            name: "hero",
            label: "Hero",
            fields: [
              { type: "string", name: "eyebrow", label: "Eyebrow" },
              { type: "string", name: "title", label: "Headline" },
              {
                type: "string",
                name: "lede",
                label: "Subheadline",
                ui: { component: "textarea" },
              },
            ],
          },
          {
            type: "object",
            name: "features",
            label: "Features",
            list: true,
            ui: {
              itemProps: (item) => ({ label: item?.title }),
            },
            fields: [
              { type: "string", name: "title", label: "Title" },
              {
                type: "string",
                name: "body",
                label: "Body",
                ui: { component: "textarea" },
              },
              {
                type: "string",
                name: "color",
                label: "Accent color",
                options: ["accent", "success", "info", "warning", "danger"],
              },
            ],
          },
          {
            type: "object",
            name: "steps",
            label: "How it works steps",
            list: true,
            ui: {
              itemProps: (item) => ({ label: item?.title }),
            },
            fields: [
              { type: "string", name: "n", label: "Number" },
              { type: "string", name: "title", label: "Title" },
              {
                type: "string",
                name: "body",
                label: "Body",
                ui: { component: "textarea" },
              },
            ],
          },
        ],
      },
    ],
  },
});
