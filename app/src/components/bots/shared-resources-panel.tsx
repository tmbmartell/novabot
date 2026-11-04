import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { agentListQueryOptions } from "@/lib/agents/queries";
import { client } from "@/lib/client";

type Resource = {
  id: string;
  title: string;
  content: string;
  updatedAt: string;
};
type Grant = {
  botId: string;
  permission: "read" | "write";
};

const root = "/api/shared-resources";

/**
 * Starter management UI for the owner. This shares TEXT, not computers,
 * browser sessions, passwords, or files from the bot's private workspace.
 */
export function SharedResourcesPanel() {
  const agents = useQuery(agentListQueryOptions());
  const [resources, setResources] = useState<Resource[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [grants, setGrants] = useState<Grant[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const rows = await client<Resource[]>(root, "resources");
    setResources(rows);
    return rows;
  }

  useEffect(() => {
    void refresh().catch((failure: unknown) =>
      setError(failure instanceof Error ? failure.message : String(failure)),
    );
  }, []);

  async function choose(id: string | null) {
    setError(null);
    setSelectedId(id);
    if (!id) {
      setTitle("");
      setContent("");
      setGrants([]);
      return;
    }
    try {
      const [resource, permissions] = await Promise.all([
        client<Resource>(`${root}/${encodeURIComponent(id)}`, "resource"),
        client<Grant[]>(`${root}/${encodeURIComponent(id)}/grants`, "grants"),
      ]);
      setTitle(resource.title);
      setContent(resource.content);
      setGrants(permissions);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }

  const save = () =>
    run(async () => {
      const path = selectedId
        ? `${root}/${encodeURIComponent(selectedId)}`
        : root;
      const resource = await client<Resource>(path, "resource", {
        method: selectedId ? "PUT" : "POST",
        body: { title, content },
      });
      await refresh();
      await choose(resource.id);
    });

  const remove = () =>
    run(async () => {
      if (!selectedId) return;
      await client(`${root}/${encodeURIComponent(selectedId)}`, {
        method: "DELETE",
      });
      await refresh();
      await choose(null);
    });

  const changeGrant = (botId: string, permission: "read" | "write" | "none") =>
    run(async () => {
      if (!selectedId) return;
      const path = `${root}/${encodeURIComponent(selectedId)}/grants/${encodeURIComponent(botId)}`;
      await client(path, {
        method: permission === "none" ? "DELETE" : "PUT",
        ...(permission === "none" ? {} : { body: { permission } }),
      });
      const updated = await client<Grant[]>(
        `${root}/${encodeURIComponent(selectedId)}/grants`,
        "grants",
      );
      setGrants(updated);
    });

  return (
    <details className="mt-8 rounded-xl border p-4">
      <summary className="cursor-pointer font-semibold">
        Biblioteca compartilhada · permissões por Bot
      </summary>
      <p className="mt-2 text-sm text-muted-foreground">
        Guarde notas e documentos de texto, autorizando cada Bot a ler ou
        editar. Senhas, logins e sessões do navegador não são compartilhados.
      </p>
      {error ? (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="mt-4 grid gap-4 md:grid-cols-[220px_1fr]">
        <div className="space-y-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void choose(null)}
            className="w-full rounded-md border px-3 py-2 text-left text-sm font-semibold"
          >
            + Novo documento
          </button>
          {resources.map((resource) => (
            <button
              key={resource.id}
              type="button"
              disabled={busy}
              onClick={() => void choose(resource.id)}
              className={`w-full rounded-md border px-3 py-2 text-left text-sm ${selectedId === resource.id ? "border-primary bg-primary/10" : ""}`}
            >
              {resource.title}
            </button>
          ))}
        </div>
        <div className="space-y-3">
          <label
            className="block text-sm font-medium"
            htmlFor="shared-resource-title"
          >
            Título
          </label>
          <input
            id="shared-resource-title"
            className="w-full rounded-md border bg-background p-2 text-sm"
            maxLength={120}
            placeholder="Ex.: Campanha de novembro"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
          <label
            className="block text-sm font-medium"
            htmlFor="shared-resource-content"
          >
            Conteúdo
          </label>
          <textarea
            id="shared-resource-content"
            className="min-h-32 w-full rounded-md border bg-background p-2 text-sm"
            maxLength={16_000}
            placeholder="Cole aqui o material a compartilhar…"
            value={content}
            onChange={(event) => setContent(event.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || !title.trim()}
              onClick={() => void save()}
              className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              {selectedId ? "Salvar alterações" : "Criar documento"}
            </button>
            {selectedId ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void remove()}
                className="rounded-md border px-4 py-2 text-sm text-destructive"
              >
                Excluir
              </button>
            ) : null}
          </div>
          {selectedId ? (
            <div className="border-t pt-4">
              <h3 className="font-semibold">Quem pode usar este documento?</h3>
              <p className="mb-3 text-xs text-muted-foreground">
                Sem autorização, o Bot não pode nem visualizar o documento.
              </p>
              <div className="space-y-2">
                {(agents.data ?? [])
                  .filter((agent) => agent.systemOwned || agent.mine)
                  .map((agent) => (
                  <div
                    key={agent.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2"
                  >
                    <span className="text-sm">{agent.name}</span>
                    <select
                      aria-label={`Permissão de ${agent.name}`}
                      disabled={busy}
                      className="rounded-md border bg-background p-1 text-xs"
                      value={
                        grants.find((grant) => grant.botId === agent.id)
                          ?.permission ?? "none"
                      }
                      onChange={(event) =>
                        void changeGrant(
                          agent.id,
                          event.target.value as "read" | "write" | "none",
                        )
                      }
                    >
                      <option value="none">Sem acesso</option>
                      <option value="read">Pode ler</option>
                      <option value="write">Pode ler e editar</option>
                    </select>
                  </div>
                ))}
                {agents.isError ? (
                  <p className="text-sm text-destructive">
                    Não foi possível carregar a lista de Bots.
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </details>
  );
}
