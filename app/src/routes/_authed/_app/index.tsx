import { IconKey, IconPlug, IconRobot } from "@tabler/icons-react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Composer, toAgentOptions } from "@/components/channels/composer";
import { SidebarToggle } from "@/components/layout/sidebar-toggle";
import { defaultAgentProfile } from "@/lib/agents/default-agent";
import { agentListQueryOptions } from "@/lib/agents/queries";
import { channelListQueryOptions } from "@/lib/channels/queries";
import {
  CoworkerRoutingRefusedError,
  routeMessage,
} from "@/lib/channels/route";
import { useStartChannel } from "@/lib/channels/start";
import { appConfig } from "@/lib/generated/application-config";

export const Route = createFileRoute("/_authed/_app/")({
  component: RouteComponent,
});

/** Chat is the product's front door. The sidebar is the Bot directory. */
function RouteComponent() {
  const channels = useInfiniteQuery(channelListQueryOptions());
  const { data: agents, isError: failed } = useQuery(agentListQueryOptions());
  const { start, startChosen, pending } = useStartChannel();
  const [error, setError] = useState<string | null>(null);

  const fallback = defaultAgentProfile(
    agents,
    agents?.find((agent) => agent.visibility === "public"),
  );

  return (
    <div className="novagente-start-screen">
      <header className="novagente-start-header">
        <div className="flex items-center gap-3">
          <SidebarToggle />
          <img
            src="/novabot-mark.svg"
            alt=""
            aria-hidden="true"
            className="size-6"
          />
          <span className="text-sm font-semibold tracking-wide">
            {appConfig.brand.productName}
          </span>
        </div>
        <Link
          to="/bots"
          search={{ new: true }}
          className="rounded-lg border border-border px-3 py-2 text-xs font-medium transition-colors hover:bg-muted"
        >
          + Novo bot
        </Link>
      </header>
      <div className="novagente-start-content">
        <img
          src="/novabot-mark.svg"
          alt=""
          aria-hidden="true"
          className="mx-auto mb-4 size-12"
        />
        <p className="text-xs font-semibold uppercase tracking-[0.23em] text-blue-400">
          NOVAGENTE · Escritório de agentes
        </p>
        <h1 className="novagente-start-title">O que vamos resolver hoje?</h1>
        <p className="novagente-start-subtitle">
          Escolha um agente na lateral ou comece uma conversa aqui.
        </p>
        <div className="novagente-start-composer">
          <Composer
            agents={toAgentOptions(agents)}
            className="w-full"
            disabled={!fallback}
            onSubmit={async (draft) => {
              setError(null);
              try {
                if (draft.agentId) {
                  await startChosen(draft.agentId, draft.text);
                  return;
                }
                let agentId: string | undefined;
                try {
                  agentId = (await routeMessage(draft.text)).agentId;
                } catch (caught) {
                  if (caught instanceof CoworkerRoutingRefusedError)
                    throw caught;
                  agentId = fallback?.id;
                }
                if (!agentId) return;
                await start(agentId, draft.text);
              } catch (caught) {
                setError(
                  caught instanceof Error
                    ? caught.message
                    : "Não foi possível iniciar a conversa. Tente novamente.",
                );
                throw caught;
              }
            }}
            pending={pending}
          />
        </div>
        <nav
          className="mt-6 grid w-full grid-cols-1 gap-3 text-left sm:grid-cols-3"
          aria-label="Acesso rápido às ferramentas"
        >
          <Link
            to="/bots"
            search={{ new: true }}
            className="group rounded-2xl border border-[#303037] bg-[#1d1d22] p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-[#1e7bff] hover:bg-[#25252d] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1e7bff]"
          >
            <IconRobot className="mb-3 size-6 text-[#66a0ff]" aria-hidden="true" />
            <span className="block text-sm font-semibold text-[#f6f6f8]">Novo agente</span>
            <span className="mt-1 block text-xs leading-5 text-[#b4b4bd]">
              Crie seu próximo especialista.
            </span>
          </Link>
          <Link
            to="/connections"
            className="group rounded-2xl border border-[#303037] bg-[#1d1d22] p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-[#1e7bff] hover:bg-[#25252d] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1e7bff]"
          >
            <IconPlug className="mb-3 size-6 text-[#66a0ff]" aria-hidden="true" />
            <span className="block text-sm font-semibold text-[#f6f6f8]">Conexões</span>
            <span className="mt-1 block text-xs leading-5 text-[#b4b4bd]">
              Autorize apps e ferramentas.
            </span>
          </Link>
          <Link
            to="/settings/passwords"
            className="group rounded-2xl border border-[#303037] bg-[#1d1d22] p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-[#1e7bff] hover:bg-[#25252d] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1e7bff]"
          >
            <IconKey className="mb-3 size-6 text-[#66a0ff]" aria-hidden="true" />
            <span className="block text-sm font-semibold text-[#f6f6f8]">Cofre de senhas</span>
            <span className="mt-1 block text-xs leading-5 text-[#b4b4bd]">
              Guarde acessos com segurança.
            </span>
          </Link>
        </nav>
        {fallback ? (
          <p className="mt-4 text-xs text-muted-foreground">
            O NovaBot pode escolher o agente mais adequado. Use <code>@</code>{" "}
            para indicar um específico.
          </p>
        ) : null}
        {error ? (
          <p className="mt-3 text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : failed && agents === undefined ? (
          <p className="mt-3 text-sm text-destructive" role="alert">
            Não foi possível carregar os agentes. Recarregue a página.
          </p>
        ) : null}
        <nav
          className="novagente-start-bots"
          aria-label="Começar conversa com um bot"
        >
          {(agents ?? []).slice(0, 6).map((agent) => (
            <Link key={agent.id} to="/channel/new" search={{ agent: agent.id }}>
              {agent.name}
            </Link>
          ))}
        </nav>
        {channels.isSuccess && channels.data.length === 0 ? (
          <p className="mt-6 text-xs text-muted-foreground">
            Sua primeira conversa ficará salva no histórico do agente.
          </p>
        ) : null}
      </div>
    </div>
  );
}
