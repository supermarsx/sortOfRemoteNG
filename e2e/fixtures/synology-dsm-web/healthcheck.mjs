// Container liveness probe for `test-dsm-web`. It checks that the fixture
// answers on loopback, not certificate validity: the disposable certificate
// lasts two days, and the spec renews it before starting the service.
import https from "node:https";

const request = https.get(
  {
    host: "127.0.0.1",
    port: Number(process.env.PORT || 8446),
    path: "/__fixture/health",
    rejectUnauthorized: false,
    timeout: 2_500,
  },
  (response) => {
    response.resume();
    process.exit(response.statusCode === 200 ? 0 : 1);
  },
);
request.on("timeout", () => request.destroy(new Error("timeout")));
request.on("error", () => process.exit(1));
