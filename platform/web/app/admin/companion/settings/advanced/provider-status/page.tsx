"use client";

import { useEffect, useState } from "react";
import { AdvancedPage } from "@/components/admin/advanced-page";
import { getProviderStatus, type ProviderStatus } from "@/lib/admin-api";

const SECTIONS: { key: keyof ProviderStatus; title: string; note: string }[] = [
  { key: "auth_provider", title: "Authentication", note: "Development provider: password hashes and server-side sessions held by Veye. Production identity provider is a client decision." },
  { key: "email", title: "Email", note: "Local SMTP delivery to the Mailpit development mailbox. No real email is sent; the production sender is a client decision." },
  { key: "llm", title: "Language model", note: "The Companion talks to the model only through the LLMProvider interface. Absence of a provider is reported, never worked around." },
  { key: "embeddings", title: "Embeddings", note: "Deterministic local embeddings for development retrieval. The production embedding provider is a client decision." },
  { key: "object_store", title: "Object store", note: "Original source files. Local files in development; S3 is the production target and is not configured." },
  { key: "telemetry", title: "Telemetry", note: "All records are masked before export. The database exporter feeds these screens." },
  { key: "langfuse", title: "Langfuse", note: "Optional development observability. Keys are never displayed; only whether they are present." },
  { key: "database", title: "Database", note: "PostgreSQL with the pgvector extension in the local stack." },
];

export default function ProviderStatusPage() {
  const [data, setData] = useState<ProviderStatus | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    getProviderStatus().then(setData).catch((reason) => setError(reason instanceof Error ? reason.message : "Provider status could not be loaded."));
  }, []);

  return (
    <AdvancedPage active="provider-status" title="Provider Status" desc={data ? `Environment: ${data.environment}. Which replaceable services are connected, and which remain client decisions. No secrets are shown here.` : "Loading…"}>
      {error && <p className="errorbar">{error}</p>}
      {data && (
        <div className="grid grid--2">
          {SECTIONS.map((section) => {
            const values = data[section.key] as Record<string, unknown>;
            return (
              <div key={section.key} className="card">
                <div className="card__head"><div><h2 className="card__title">{section.title}</h2><p className="t-support">{section.note}</p></div></div>
                <div className="card__body">
                  <dl className="kv">
                    {Object.entries(values).map(([key, value]) => (
                      <div key={key} style={{ display: "contents" }}>
                        <dt>{key.replace(/_/g, " ")}</dt>
                        <dd>{value === null || value === undefined ? "—" : typeof value === "boolean" ? (value ? "yes" : "no") : String(value)}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </AdvancedPage>
  );
}
