import { IconMicrophone, IconSend, IconVolume, IconVolumeOff, IconX } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { defaultAgentProfile } from "@/lib/agents/default-agent";
import { agentListQueryOptions } from "@/lib/agents/queries";
import { CoworkerRoutingRefusedError, routeMessage } from "@/lib/channels/route";
import { useStartChannel } from "@/lib/channels/start";
import "./novi-assistant.css";

/**
 * The browser's speech recognizer is optional. It is intentionally activated only
 * by a click; no background listening, recording, or upload is started here.
 * Availability and transcription privacy depend on the user's browser.
 */
type Recognizer = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
};
type SpeechWindow = Window & {
  SpeechRecognition?: new () => Recognizer;
  webkitSpeechRecognition?: new () => Recognizer;
};

function NoviCharacter({
  small = false,
  listening = false,
  working = false,
}: {
  small?: boolean;
  listening?: boolean;
  working?: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      className={[
        "novi-character",
        small ? "novi-character--small" : "",
        listening ? "novi-character--listening" : "",
        working ? "novi-character--working" : "",
      ].filter(Boolean).join(" ")}
    >
      <span className="novi-antenna" />
      <span className="novi-head">
        <span className="novi-eye novi-eye--left"><span /></span>
        <span className="novi-eye novi-eye--right"><span /></span>
        <span className="novi-cheek novi-cheek--left" />
        <span className="novi-cheek novi-cheek--right" />
        <span className="novi-mouth" />
      </span>
    </span>
  );
}

/**
 * A thin presentation layer for the existing authenticated routing + channel flow.
 * It does NOT create a new agent, bypass authorization, or approve tools.
 * Once routed, the normal channel UI owns the run, approvals and history.
 */
export function NoviAssistant() {
  const { data: agents, isError: agentsFailed } = useQuery(agentListQueryOptions());
  const { start, pending } = useStartChannel();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [status, setStatus] = useState("Oi! Sou o Novi. Me diga o que precisa e eu encontro o agente certo.");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const recognizerRef = useRef<Recognizer | null>(null);
  const busyRef = useRef(false);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        toggleRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [open]);

  useEffect(() => {
    return () => {
      recognizerRef.current?.stop();
      window.speechSynthesis?.cancel();
    };
  }, []);

  function say(message: string) {
    if (!voiceEnabled || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(message);
    utterance.lang = "pt-BR";
    utterance.rate = 1.02;
    window.speechSynthesis.speak(utterance);
  }

  async function sendMessage(raw: string) {
    const message = raw.trim();
    if (!message || busyRef.current || pending) return;
    busyRef.current = true;
    setBusy(true);
    setDraft("");
    setError(null);
    setStatus("Vou descobrir qual dos seus agentes pode cuidar disso…");

    try {
      // This server endpoint selects only from agents reachable by the signed-in user.
      // A server refusal to disambiguate is never silently replaced with a fallback.
      let agentId: string;
      let agentName: string;
      try {
        const routed = await routeMessage(message);
        agentId = routed.agentId;
        agentName = routed.name;
      } catch (caught) {
        if (caught instanceof CoworkerRoutingRefusedError) throw caught;
        const fallback = defaultAgentProfile(agents);
        if (!fallback) throw new Error("Não encontrei um agente disponível para encaminhar este pedido.");
        agentId = fallback.id;
        agentName = fallback.name;
      }

      setStatus(`Encaminhando para ${agentName}. Você poderá acompanhar tudo no chat.`);
      say(`Encontrei ${agentName}. Vou abrir a conversa para você acompanhar.`);
      await start(agentId, message);
      setOpen(false);
    } catch (caught) {
      const detail = caught instanceof Error ? caught.message : "Tente novamente.";
      setError(detail);
      setStatus("Não consegui encaminhar seu pedido.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendMessage(draft);
  }

  function toggleMicrophone() {
    if (recognizerRef.current) {
      recognizerRef.current.stop();
      return;
    }
    const speechWindow = window as SpeechWindow;
    const Recognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!Recognition) {
      setError("O reconhecimento de voz não está disponível neste navegador. Você pode digitar seu pedido.");
      return;
    }
    try {
      const recognition = new Recognition();
      recognition.lang = "pt-BR";
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.onresult = (event) => {
        const transcript = event.results[0]?.[0]?.transcript?.trim();
        if (transcript) void sendMessage(transcript);
      };
      recognition.onerror = (event) => {
        setError(`Não consegui usar o microfone (${event.error}). Verifique a permissão do navegador.`);
      };
      recognition.onend = () => {
        recognizerRef.current = null;
        setListening(false);
      };
      recognizerRef.current = recognition;
      setError(null);
      setListening(true);
      setStatus("Estou ouvindo. Pode falar seu pedido…");
      recognition.start();
    } catch {
      recognizerRef.current = null;
      setListening(false);
      setError("Não foi possível iniciar o microfone. Tente digitar seu pedido.");
    }
  }

  const sending = busy || pending;
  return (
    <div className="novi-dock" data-testid="novi-assistant">
      {open && (
        <section className="novi-panel" aria-label="Conversar com Novi" id="novi-panel">
          <header className="novi-panel-header">
            <NoviCharacter listening={listening} working={sending} />
            <div className="novi-panel-heading">
              <strong>Oi, eu sou o Novi!</strong>
              <span>Seu assistente no NovaBot</span>
            </div>
            <button
              type="button"
              className="novi-icon-button"
              aria-label="Fechar conversa com Novi"
              onClick={() => { setOpen(false); toggleRef.current?.focus(); }}
            >
              <IconX size={18} />
            </button>
          </header>
          <p className="novi-status" role="status" aria-live="polite">{status}</p>
          <p className="novi-help">
            Eu encontro o agente e abro a conversa real. As ações e aprovações continuam no chat.
          </p>
          <div className="novi-suggestions" aria-label="Sugestões de pedidos">
            {["Organize minhas prioridades", "Como estão os meus agentes?", "Verificar oportunidades de vendas"].map((text) => (
              <button key={text} type="button" disabled={sending || !agents?.length}
                onClick={() => void sendMessage(text)}>{text}</button>
            ))}
          </div>
          {error && <p className="novi-error" role="alert">{error}</p>}
          {agentsFailed && <p className="novi-error">Não foi possível carregar seus agentes.</p>}
          <form className="novi-form" onSubmit={handleSubmit}>
            <input
              ref={inputRef}
              aria-label="Seu pedido para o Novi"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              disabled={sending}
              placeholder="Novi, preciso de ajuda com…"
            />
            <button
              type="button"
              className={listening ? "novi-mic novi-mic--active" : "novi-mic"}
              aria-label={listening ? "Parar de ouvir" : "Falar com Novi"}
              aria-pressed={listening}
              onClick={toggleMicrophone}
              disabled={sending}
              title="Falar por voz (requer suporte e permissão do navegador)"
            >
              <IconMicrophone size={19} />
            </button>
            <button type="submit" className="novi-send" aria-label="Enviar pedido"
              disabled={sending || !draft.trim() || !agents?.length}>
              <IconSend size={19} />
            </button>
          </form>
          <footer className="novi-footer">
            <span>{sending ? "Encaminhando…" : listening ? "Ouvindo…" : "Microfone desligado até você clicar"}</span>
            <button type="button"
              onClick={() => {
                setVoiceEnabled((current) => !current);
                window.speechSynthesis?.cancel();
              }}
              aria-label={voiceEnabled ? "Desativar voz do Novi" : "Ativar voz do Novi"}
              aria-pressed={voiceEnabled}
              title="Ativar ou desativar leitura de respostas"
            >
              {voiceEnabled ? <IconVolume size={17} /> : <IconVolumeOff size={17} />}
            </button>
          </footer>
        </section>
      )}
      <button
        type="button"
        className="novi-trigger"
        ref={toggleRef}
        aria-label={open ? "Fechar Novi" : "Conversar com Novi"}
        aria-controls="novi-panel"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <NoviCharacter small listening={listening} working={sending} />
        <span>{open ? "Fechar Novi" : "Fale com o Novi"}</span>
      </button>
    </div>
  );
}
