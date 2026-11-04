import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { agentListQueryOptions } from "@/lib/agents/queries";
import { client } from "@/lib/client";

type Application = {
  id: string;
  name: string;
  origin: string;
  sessionStatus: "not_connected";
};
type Grant = { botId: string; permission: "view" | "operate" };

const endpoint = "/api/conexoes";

/** Metadata-only registry. Registration NEVER starts a browser or signs in. */
export function ConexoesPanel() {
  const agents = useQuery(agentListQueryOptions());
  const bots = (agents.data ?? []).filter(
    (bot) => bot.mine && !bot.systemOwned,
  );
  const [applications, setApplications] = useState<Application[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [name, setName] = useState("");
  const [origin, setOrigin] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function reload() {
    const found = await client<Application[]>(endpoint, "applications");
    setApplications(found);
    return found;
  }

  useEffect(() => {
    void reload().catch((cause: unknown) =>
      setError(cause instanceof Error ? cause.message : String(cause)),
    );
  }, []);

  async function action(callback: () => Promise<void>) {
    setPending(true);
    setError("");
    setMessage("");
    try {
      await callback();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(false);
    }
  }

  function select(application: Application) {
    setActiveId(application.id);
    setGrants([]);
    setMessage("");
    setError("");
    void client<Grant[]>(
      `${endpoint}/${encodeURIComponent(application.id)}/grants`,
      "grants",
    )
      .then(setGrants)
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : String(cause)),
      );
  }

  const create = () =>
    action(async () => {
      const application = await client<Application>(endpoint, "application", {
        method: "POST",
        body: { name, origin },
      });
      await reload();
      setName("");
      setOrigin("");
      select(application);
      setMessage("Aplicação cadastrada. Login ainda não habilitado.");
    });

  const changePermission = (
    botId: string,
    permission: "none" | "view" | "operate",
  ) =>
    action(async () => {
      if (!activeId) return;
      const path = `${endpoint}/${encodeURIComponent(activeId)}/grants/${encodeURIComponent(botId)}`;
      await client(path, {
        method: permission === "none" ? "DELETE" : "PUT",
        ...(permission === "none" ? {} : { body: { permission } }),
      });
      const next = await client<Grant[]>(
        `${endpoint}/${encodeURIComponent(activeId)}/grants`,
        "grants",
      );
      setGrants(next);
      setMessage("Permissão atualizada.");
    });

  const remove = () =>
    action(async () => {
      if (!activeId) return;
      await client(`${endpoint}/${encodeURIComponent(activeId)}`, {
        method: "DELETE",
      });
      await reload();
      setActiveId(null);
      setGrants([]);
      setMessage("Cadastro excluído e permissões revogadas.");
    });

  return (
    <section
      aria-label="NOVAGENTE Conexões"
      className="mt-8 rounded-2xl border border-border bg-card p-5"
    >
      <h2 className="text-lg font-semibold">NOVAGENTE Conexões</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Cadastre aplicações e escolha quais bots poderão utilizá-las. Nesta
        primeira etapa, nenhum login é feito e nenhuma sessão é compartilhada.
      </p>
      <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_2fr_auto]">
        <label className="text-sm">
          Nome da aplicação
          <input
            aria-label="Nome da aplicação"
            className="mt-1 w-full rounded-lg border bg-background px-3 py-2"
            maxLength={100}
            placeholder="Ex.: CRM"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className="text-sm">
          Endereço HTTPS
          <input
            aria-label="Endereço HTTPS"
            className="mt-1 w-full rounded-lg border bg-background px-3 py-2"
            placeholder="https://crm.empresa.com"
            value={origin}
            onChange={(event) => setOrigin(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="self-end rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
          disabled={pending || !name.trim() || !origin.trim()}
          onClick={() => void create()}
        >
          Cadastrar
        </button>
      </div>
      {error ? (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {message ? (
        <p role="status" className="mt-3 text-sm text-muted-foreground">
          {message}
        </p>
      ) : null}
      <div className="mt-5 grid gap-4 md:grid-cols-[220px_1fr]">
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Aplicações cadastradas</h3>
          {applications.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Nenhuma aplicação cadastrada.
            </p>
          ) : (
            applications.map((app) => (
              <button
                key={app.id}
                type="button"
                disabled={pending}
                onClick={() => select(app)}
                className={`block w-full rounded-lg border p-3 text-left text-sm ${activeId === app.id ? "border-primary" : "border-border"}`}
              >
                <strong className="block">{app.name}</strong>
                <span className="block truncate text-xs text-muted-foreground">
                  {app.origin}
                </span>
                <span className="block text-xs text-muted-foreground">
                  Não conectada
                </span>
              </button>
            ))
          )}
        </div>
        <div className="rounded-xl border border-border p-4">
          {activeId ? (
            <>
              <h3 className="font-semibold">Permissões dos bots</h3>
              <p className="my-2 text-xs text-muted-foreground">
                Negado por padrão. “Operar” prepara uma permissão futura, mas
                ainda não dá acesso ao navegador.
              </p>
              {bots.map((bot) => (
                <div
                  key={bot.id}
                  className="flex flex-wrap items-center justify-between gap-3 border-b py-2"
                >
                  <span className="text-sm">{bot.name}</span>
                  <select
                    aria-label={`Permissão de ${bot.name}`}
                    className="rounded-md border bg-background p-2 text-sm"
                    disabled={pending}
                    value={
                      grants.find((grant) => grant.botId === bot.id)
                        ?.permission ?? "none"
                    }
                    onChange={(event) =>
                      void changePermission(
                        bot.id,
                        event.target.value as "none" | "view" | "operate",
                      )
                    }
                  >
                    <option value="none">Sem acesso</option>
                    <option value="view">Visualizar</option>
                    <option value="operate">Operar (futuro)</option>
                  </select>
                </div>
              ))}
              <button
                type="button"
                disabled={pending}
                onClick={() => void remove()}
                className="mt-4 rounded-lg border border-destructive px-3 py-2 text-xs text-destructive"
              >
                Excluir aplicação
              </button>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Selecione uma aplicação para configurar as permissões.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
