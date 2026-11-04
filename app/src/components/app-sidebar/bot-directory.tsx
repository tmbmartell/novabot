import { IconRobot, IconSparkles } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { agentListQueryOptions, type AgentProfile } from "@/lib/agents/queries";
import type { ChannelSummary } from "@/lib/channels/queries";

/** Stable colours so a Bot keeps its identity across refreshes and conversations. */
const BOT_COLOURS = [
  "#2384ff",
  "#a06bfa",
  "#11b7a3",
  "#e750a2",
  "#15b981",
  "#f39b28",
  "#ee5264",
  "#9061db",
];

function avatarColour(botId: string) {
  let hash = 0;
  for (const char of botId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return BOT_COLOURS[hash % BOT_COLOURS.length];
}

function BotAvatar({
  bot,
  large = false,
}: {
  bot: AgentProfile;
  large?: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      className={`novagente-bot-avatar ${large ? "novagente-bot-avatar-lg" : ""}`}
      style={{ backgroundColor: avatarColour(bot.id) }}
    >
      <IconRobot size={large ? 32 : 23} stroke={1.8} />
    </span>
  );
}

/**
 * Chat-first roster: one visible row per Bot, not 20 conversations from the
 * same Bot. Clicking the Bot resumes its newest conversation or opens a new
 * one with that Bot already selected. Earlier threads stay in History below.
 *
 * Uses the existing authenticated Bot and channel queries, so only records
 * this signed-in person can access appear here.
 */
export function BotDirectory({
  channels,
  search,
}: {
  channels: ChannelSummary[];
  search: string;
}) {
  const { data: bots, isPending, isError } = useQuery(agentListQueryOptions());
  const params = useParams({ strict: false }) as { channelId?: string };
  const activeChannelId = params.channelId;

  const latestFor = (botId: string) =>
    channels
      .filter(
        (channel) =>
          channel.agentIds.length === 1 && channel.agentIds[0] === botId,
      )
      .sort((a, b) =>
        (b.lastMessageAt ?? b.createdAt).localeCompare(
          a.lastMessageAt ?? a.createdAt,
        ),
      )[0];

  const matching = (bots ?? []).filter((bot) => {
    const needle = search.trim().toLocaleLowerCase();
    if (!needle) return true;
    const latest = latestFor(bot.id);
    return [bot.name, bot.title, bot.roleDescription, latest?.lastMessage].some(
      (field) => field?.toLocaleLowerCase().includes(needle),
    );
  });

  const activeBot =
    bots?.find((bot) => latestFor(bot.id)?.id === activeChannelId) ??
    bots?.find((bot) => bot.pinned) ??
    bots?.[0];

  return (
    <section className="novagente-directory" aria-label="Seus agentes">
      {activeBot ? (
        <div className="novagente-featured-bot">
          <BotAvatar bot={activeBot} large />
          <span className="novagente-featured-name">{activeBot.name}</span>
          <span className="novagente-featured-label">Agente NOVAGENTE</span>
        </div>
      ) : null}
      <div className="novagente-directory-title">
        <span>Meus agentes</span>
        <Link to="/bots" aria-label="Gerenciar agentes">
          <IconSparkles size={16} />
          <span>Gerenciar</span>
        </Link>
      </div>
      {isPending ? (
        <p className="novagente-directory-note">Carregando seus agentes…</p>
      ) : isError && !bots ? (
        <p role="alert" className="novagente-directory-note">
          Não foi possível carregar os agentes.
        </p>
      ) : matching.length === 0 ? (
        <p className="novagente-directory-note">
          {search
            ? "Nenhum agente corresponde à busca."
            : "Crie seu primeiro agente em Bots."}
        </p>
      ) : (
        <div className="novagente-bot-list">
          {matching.map((bot) => {
            const latest = latestFor(bot.id);
            const chosen = latest?.id === activeChannelId;
            const description =
              latest?.lastMessage ||
              latest?.summary ||
              bot.roleDescription ||
              bot.title;
            const content = (
              <>
                <BotAvatar bot={bot} />
                <span className="novagente-bot-copy">
                  <strong>{bot.name}</strong>
                  <span>{description}</span>
                </span>
                {latest?.busy ? (
                  <span
                    className="novagente-bot-busy"
                    role="status"
                    aria-label="Trabalhando"
                  />
                ) : null}
              </>
            );
            return latest ? (
              <Link
                to="/channel/$channelId"
                params={{ channelId: latest.id }}
                aria-current={chosen ? "page" : undefined}
                className={`novagente-bot-row ${chosen ? "novagente-bot-row-active" : ""}`}
                key={bot.id}
                title={`Abrir conversa com ${bot.name}`}
              >
                {content}
              </Link>
            ) : (
              <Link
                to="/channel/new"
                search={{ agent: bot.id }}
                className="novagente-bot-row"
                key={bot.id}
                title={`Começar conversa com ${bot.name}`}
              >
                {content}
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}
