# NOVAGENTE · NovaBot multiempresa e computadores paralelos

## Decisão de arquitetura — 01/11/2026

Objetivo: atender várias empresas sem misturar dados, sessões, arquivos ou
credenciais; permitir que os bots **de uma mesma empresa** colaborem apenas
sobre recursos que foram explicitamente autorizados; executar computadores
isolados em paralelo quando houver capacidade.

**Não considerar esta entrega uma implementação de multi-tenancy no banco.**
O esquema atual tem usuários, bots e conexões, mas não impõe uma coluna
`tenant_id` e respectivas políticas em todos os caminhos de leitura e escrita.
Até existir esse isolamento de ponta a ponta, a fronteira de empresa deve
ser **uma instalação independente por cliente**, com banco, diretórios,
tokens, namespace e redes próprios. Nunca colocar dois clientes externos
na mesma instalação atual confiando somente no nome ou grupo do bot.

## O que este primeiro PR entrega

1. O compose aceita nome de projeto, porta local, arquivo de ambiente e
   diretório de dados exclusivos por instalação.
2. Imagens, rede Docker e namespace dos computadores acompanham o projeto.
   A instalação existente continua usando os mesmos valores padrão.
3. A quantidade de computadores em paralelo é configurável por instalação
   (`NOVABOT_MAX_COMPUTERS`; padrão **1**). **Não aumentar na VPS atual sem
   avaliar RAM, CPU, swap, armazenamento e carga real.**
4. Nova admissão serializada: inicia até o limite configurado, inclusive
   com pedidos concorrentes, sem derrubar um computador em funcionamento
   apenas para abrir vaga. Se não houver vaga, retorna **503** e preserva o
   trabalho existente. O reaper de inatividade continua responsável por
   parar computadores ociosos depois de 15 minutos (configurável).

**Ainda não entregue neste PR:** área de arquivos compartilhada por cliente,
política de permissões de conectores por bot, organização multiempresa no
mesmo banco, provisionamento automático de clientes, painel de cobrança e
observabilidade/limites por empresa. Colaboração/handoff de bots já possui
código no OpenBot, mas precisa de homologação com os fluxos da NOVAGENTE.

## Configuração por cliente (exemplo conceitual)

Para instalações diferentes, manter checkout/diretório de deploy separados,
cada um com seu próprio `.env` e segredos exclusivos.

```dotenv
# Instalação da empresa exemplo, nunca usar estes valores em produção sem revisar
NOVABOT_PROJECT_NAME=novabot-cliente-exemplo
NOVABOT_HOST_PORT=13011
NOVABOT_ENV_FILE=.env
NOVABOT_DATA_DIR=/srv/novabot/cliente-exemplo/app-data
NOVABOT_MAX_COMPUTERS=2
NOVABOT_MIN_AVAILABLE_MB=3072
NOVABOT_COMPUTER_IDLE_MINUTES=15
```

Com `NOVABOT_PROJECT_NAME=novabot-cliente-exemplo`, o compose cria a rede
`novabot-cliente-exemplo_default`, usa volumes de banco do próprio projeto
e deriva os computadores sob o namespace `novabot-cliente-exemplo`.
A porta é sempre publicada no loopback, não na internet. Use uma camada
externa de autenticação/TLS para publicar o acesso.

**Como executar depois da homologação, em um diretório de instalação exclusivo
para o cliente:**

```bash
# Nunca repetir nomes, portas, diretórios ou segredos entre clientes.
docker build -f agent-computer/Dockerfile -t "${NOVABOT_PROJECT_NAME}-agent-computer:latest" .
docker compose --env-file .env -f docker-compose.novabot.yml config
docker compose --env-file .env -f docker-compose.novabot.yml up -d --build
docker compose --env-file .env -f docker-compose.novabot.yml ps
```

Não executar esse procedimento na VPS de produção como parte deste PR.
O atual `scripts/novabot-update.sh` é **single-stack**, fixa `-p novabot`,
imagens, porta e branch. Ele **ainda não serve** para atualização coordenada
dos novos clientes. Atualizar o script/orquestrador é etapa obrigatória
antes de comercializar múltiplas instalações.

### Capacidade

Por instalação, os limites de memória dos serviços contínuos totalizam
**1.856 MB**, mais **640 MB por computador** em execução, sem contar
kernel, cache, processos de build, outros projetos e reservas da VPS.
Por exemplo, 3 computadores podem levar essa configuração a 3.776 MB
em limites por container. Isso **não é medição de consumo real**, nem
dimensionamento da VPS; testar CPU/RAM simultaneamente em homologação.

## Permissões e compartilhamento na mesma empresa

**Regra principal:** colaboração não significa compartilhar senha, cookies
ou volume de navegador. Cada bot conserva seu computador, perfil, sessão
e espaço privado. Um recurso comum precisa de uma concessão explícita.

Modelo a implementar na fase seguinte:

- `cliente -> membros -> bots -> recursos -> concessões`.
- Recursos: pasta/documento, fonte de conhecimento, ferramenta, conexão,
  fluxo de trabalho ou pasta compartilhada de entrega.
- Permissões por recurso e bot: visualizar, editar, executar, delegar.
  Negar por padrão; concessões registradas e revogáveis.
- Um handoff de Jojo para Programador **não transfere automaticamente** a
  autorização da Jojo. O Programador age com suas próprias permissões.
- Segredos: credenciais criptografadas por cliente; acesso via broker,
  jamais copiados para prompts, logs ou pastas compartilhadas.
- Auditoria: quem pediu, qual bot agiu, qual recurso acessou, ação, resultado.
  Aprovação humana para publicação, compras, exclusão e ações sensíveis.
- Quotas de concorrência por empresa e filas de tarefas para não deixar
  um cliente monopolizar os computadores.

## Fases seguintes e critérios de aceite

**Fase 2 — Permissões e colaboração:** recurso compartilhado por cliente com
ACL por bot; convite de membros; trabalho em cadeia e paralelo; auditoria
e testes negativos de acesso cruzado.

**Fase 3 — Multiempresa nativo:** `tenant_id` obrigatório em todas as
entidades relevantes, filas, memórias, buscas e arquivos; autorização
centralizada com filtro por cliente; isolamento de segredos e conectores;
testes de contrato e tentativas de acesso cruzado entre todos os endpoints.
Até lá, **cada cliente tem seu stack**.

**Fase 4 — Escala:** quotas por cliente, provisionamento automatizado,
observabilidade, backups/restauração por empresa, pools/filas de computadores,
desacoplamento de componentes compartilháveis e planejamento de múltiplos
hosts conforme o número de clientes.

Homologação mínima antes de qualquer deploy:
- [ ] `bun test supervisor/tests/novabot-capacity.test.ts`
- [ ] `bun run --cwd supervisor typecheck`
- [ ] `docker compose -f docker-compose.novabot.yml config`
- [ ] Vários `ensure` simultâneos não excedem o limite nem derrubam execução.
- [ ] Quando cheio, novo `ensure` retorna 503; processo atual continua.
- [ ] Duas instalações não enxergam bancos, arquivos, volumes, tokens ou bots
      uma da outra.
- [ ] Revogação de acesso interrompe novas operações com recurso compartilhado.
- [ ] Backups, restore, carga, quotas e isolamento de ações sensíveis testados.

## Alerta de segurança de infraestrutura

O supervisor atual monta `/var/run/docker.sock`, que equivale a poder
administrativo sobre o Docker host. Portanto **vários compose projects no
mesmo host NÃO são uma fronteira de segurança forte contra comprometimento de
containers/supervisores**. Para clientes externos, usar máquinas/hosts
isolados, Docker rootless com desenho apropriado ou um serviço de sandbox
com limites fortes; revisar essa superfície antes de produção multiempresa.


## Fase 2A — biblioteca de textos com permissão por Bot (implementação experimental)

A primeira entrega de colaboração inclui uma biblioteca de documentos **de texto**
de até 16 mil caracteres por registro, gerenciada em **Bots →
Biblioteca compartilhada**. O usuário autenticado cria a nota e pode
conceder a cada Bot **Sem acesso**, **Pode ler** ou **Pode ler e editar**.
Quando a permissão é revogada, as ferramentas do Bot deixam de poder
acessar o documento em novas chamadas. Cada chamada é validada novamente
no servidor, em SQL, com o par `owner_user_id + agent_id`.

- Tabelas: `novabot_shared_resources` e
  `novabot_shared_resource_grants` (`0070_novabot_shared_resources.sql`).
- API com sessão: `/api/shared-resources` (CRUD próprio) e
  `/:id/grants/:botId` (autorizar/revogar).
- Ferramentas para os agentes: `shared_resource_list`,
  `shared_resource_read` e `shared_resource_write`.
- Os parâmetros de ferramentas nunca recebem `ownerUserId` ou `botId`;
  ambos vêm do contexto assinado/verificado do turno.
- Ações de criação, edição, exclusão, concessão, revogação e leitura/edição
  pelos Bots são registradas na auditoria sem registrar o conteúdo.
- A camada de pesquisa proativa conserva a regra de não oferecer ferramentas
  de escrita desconhecidas; a delegação não concede acessos por si.
- Limites: esta versão compartilha **documentos do mesmo usuário entre Bots**.
  Ainda NÃO autoriza automaticamente outros membros da empresa nem oferece
  pastas binárias, integrações, cookies, senhas ou tokens.
- Essa biblioteca não torna uma instalação única segura para empresas
  diferentes. Para clientes externos, continuam obrigatórias instalações
  separadas e a revisão do acesso ao socket Docker.

### Cenário de aceite

1. Ti cria “Campanha novembro”, concede leitura a Jojo, edição a NovaMídia
   e nenhum acesso ao Programador.
2. Jojo lê o documento via ferramenta; NovaMídia lê e edita; Programador
   recebe recusa.
3. Ti revoga NovaMídia: nova tentativa de leitura ou edição recebe recusa.
4. Um Bot atuando por outro usuário não enxerga o documento nem com mesmo id.
5. O painel mostra as permissões atuais e o histórico de auditoria registra
   ações sem copiar conteúdo sensível.

### Pendências antes de liberar ao cliente

- Validar testes de rota, tipos, migração SQL e renderização da tela no CI.
- Testar concorrência de revogação/escrita com PostgreSQL real.
- Revisar e homologar o comportamento de aprovação para edições críticas.
- Fase 2B: compartilhamento entre **membros da mesma empresa**, com identidade
  e permissões por pessoa e por recurso, além das permissões por Bot.
