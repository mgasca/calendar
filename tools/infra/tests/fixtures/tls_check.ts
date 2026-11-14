import { assert, assertEquals } from "@std/assert";
import { X509Certificate } from "node:crypto";
import { postgresTlsOptions } from "../../database.ts";
const pem = await Deno.readTextFile(Deno.env.get("SSL_CERT_FILE")!);
const matching = postgresTlsOptions("localhost");
assertEquals(matching.rejectUnauthorized, true);
const fingerprint = new X509Certificate(pem).fingerprint256;
assert(
  matching.ca.some((authority) => new X509Certificate(authority).fingerprint256 === fingerprint),
  "system trust root must be used",
);
const certificate = new X509Certificate(pem).toLegacyObject();
assertEquals(matching.checkServerIdentity("localhost", certificate), undefined);
assert(
  postgresTlsOptions("wrong.example").checkServerIdentity("localhost", certificate) instanceof Error,
  "the requested host must be validated, not the TLS library's fallback name",
);
