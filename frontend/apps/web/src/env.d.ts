interface ImportMetaEnv {
  /** `otlp` turns web telemetry on for this build (ADR-0062, #732); anything else leaves it off. */
  readonly VITE_OTEL_TRACES_EXPORTER?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
