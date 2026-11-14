import { assert } from "@std/assert";
import { fileURLToPath } from "node:url";

Deno.test("PostgreSQL TLS trusts the system CA and validates the requested host", async () => {
  const dir = await Deno.makeTempDir({ prefix: "infra-tls-" });
  try {
    const key = `${dir}/key.pem`;
    const cert = `${dir}/cert.pem`;
    const result = await new Deno.Command("openssl", {
      args: [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-days",
        "1",
        "-keyout",
        key,
        "-out",
        cert,
        "-subj",
        "/CN=localhost",
        "-addext",
        "subjectAltName=DNS:localhost",
      ],
      stdout: "null",
      stderr: "null",
    }).output();
    assert(result.success, "openssl must create a synthetic certificate");
    const child = await new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--config",
        fileURLToPath(new URL("../../deno.json", import.meta.url)),
        "--frozen",
        "--allow-read",
        "--allow-env",
        "--allow-sys=ca",
        fileURLToPath(new URL("./fixtures/tls_check.ts", import.meta.url)),
      ],
      env: { SSL_CERT_FILE: cert },
      stdout: "piped",
      stderr: "piped",
    }).output();
    assert(child.success, new TextDecoder().decode(child.stderr));
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
