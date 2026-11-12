import { createServerFn } from "@tanstack/react-start";
import { appBuildId } from "@/lib/appBuild";

/**
 * Reports the build id of the deployment currently serving requests.
 *
 * Runs on the server, so it always answers with the *newest* build — which is
 * exactly what a stale client needs to hear.
 */
export const getServerBuild = createServerFn({ method: "GET" }).handler(async () => ({
  build: appBuildId(),
}));
