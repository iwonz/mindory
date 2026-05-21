import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.MINDORY_DATABASE_URL ?? "postgresql://mindory:mindory@localhost:5432/mindory"
  }
});
