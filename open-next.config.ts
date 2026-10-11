import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Every page is dynamic (signed-in data), so no incremental cache is needed.
export default defineCloudflareConfig();
