# NOVAGENTE • NOVI — assistente flutuante (MVP)

## Objetivo

Colocar o personagem próprio da NOVAGENTE dentro do NovaBot sem substituir o motor dos agentes. O Novi é uma interface de conversa/voz e encaminhamento; a autorização, os históricos, os computadores e as aprovações continuam com o NovaBot.

## O que esta primeira entrega faz

- Renderiza o Novi como bonequinho flutuante dentro das telas autenticadas do NovaBot.
- Permite abrir/fechar a conversa, digitar pedidos e usar sugestões.
- Oferece reconhecimento de voz por clique, somente quando o navegador disponibiliza SpeechRecognition e concede acesso ao microfone.
- Permite ligar/desligar leitura de confirmações com a voz do navegador.
- Usa **POST /api/route** existente para selecionar somente um agente autorizado para o usuário.
- Usa **useStartChannel** para abrir uma conversa real e mostrar as tarefas, aprovações e resultados no chat normal.
- Trata uma decisão ambígua do roteador como erro: não envia o pedido para outro agente silenciosamente.
- Não cria nenhum endpoint de execução privilegiada, permissões extras ou nova tabela.

## Limites explícitos

- Não é um serviço que fica escutando continuamente: microfone somente com clique.
- Reconhecimento e síntese de voz dependem do navegador; alguns provedores processam o áudio externamente.
- A primeira versão **encaminha** tarefas, mas não apresenta ainda um consolidado de status de todos os agentes.
- Não há integração específica com VENDA MAIS ou Contrato Vivo até que existam conectores autorizados e testados.
- Não pode tomar decisões de aprovação no lugar do usuário.
- O personagem flutua **dentro do aplicativo web/PWA**. Ficar por cima de outros programas Windows exigirá integração nativa adicional do app Tauri.
- O código e desenho do personagem são originais para a NOVAGENTE e não incluem assets protegidos de Coucou/Mochi.

## Próximas etapas propostas

1. **Estado e histórico:** criar endpoint de leitura do resumo de tarefas do usuário, retornando apenas tarefas autorizadas pelo escopo da sessão e tenant.
2. **Coordenação:** comandos do Novi criam pedidos rastreáveis com identificador, agente executor, status e resultado; executar ações sensíveis somente mediante aprovação humana no fluxo já existente.
3. **Desktop:** integrar uma janela flutuante opcional no Tauri, sem elevar permissões ou compartilhar cookies, tokens ou ambientes entre tenants.
4. **Voz mais natural:** preferir a infraestrutura de chamadas já existente em app/src/lib/voice, respeitando consentimento e avisos claros de gravação.

## Validação antes de publicar

- Rodar `bun install`, `bun run --cwd app typecheck` e testes do frontend.
- Testar em contas de dois tenants: Novi nunca deve exibir nomes, tarefas ou documentos de outro tenant.
- Testar erro de roteamento, conflito de agentes e agente indisponível.
- Testar reconhecimento de voz permitido, bloqueado e ausente; as funções de texto devem continuar disponíveis.
- Testar Windows desktop, navegadores móveis, teclado aberto e `prefers-reduced-motion`.
- Confirmar que aprovação e autorização são conferidas pelo servidor, nunca apenas pelo componente visual.
- Integrar e publicar somente após revisão em pull request; nenhuma VPS é modificada neste MVP.

## Referências no código

- `app/src/components/novi/novi-assistant.tsx`
- `app/src/components/novi/novi-assistant.css`
- `app/src/routes/_authed/_app.tsx`
- `app/src/lib/channels/route.ts`
- `app/src/lib/channels/start.ts`
- `app/src/lib/voice/use-voice-call.ts`
