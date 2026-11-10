// Sends the fixtures through the service started by `npm run dev`.
import { runDemo } from "./demo-lib.js";
import { local, mockUrl, serviceUrl } from "./local-env.js";

try {
  await runDemo({
    serviceUrl,
    mockUrl,
    sharedSecret: local.sharedSecret,
    sentryClientSecret: local.sentryClientSecret,
  });
} catch (err) {
  console.error(`demo failed: ${(err as Error).message}`);
  console.error("Is `npm run dev` running in another terminal?");
  process.exit(1);
}
