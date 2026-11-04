# NovaBot Conexões · auditoria de segurança e entrega MVP 1

## Limites auditados

- `server/src/auth/guards.ts`: a identidade do usuário vem da sessão verificada
  (ou da configuração explícita `singleUser`). Nunca receber `ownerUserId`
  como argumento do navegador.
- `server/src/agents/profile-store.ts` e `profile-policy.ts`: `get` pode
  devolver bots públicos ou, para administradores, bots de outras pessoas.
  Para conceder acesso a uma aplicação privada é obrigatório comparar
  `bot.ownerUserId === actor.id`, com bot não excluído e não gerenciado.
- `agent-computer/src/profiles.ts`: cookies e perfis persistentes já existem,
  porém a identidade de um perfil por bot NÃO é isolamento multiempresa.
- `agent-computer/src/egress.ts`: proxies por bot existem, mas, sem configuração
  e verificação de rotas, o tráfego sai diretamente da VPS.
- `supervisor/src/docker.ts`: o supervisor controla Docker. Instalações
  diferentes na mesma máquina com socket Docker ainda NÃO são fronteira
  forte de isolamento.
- `server/src/plugins/app-access.ts`: integrações MCP/broker com suas próprias
  concessões. O catálogo de navegação humana abaixo não substitui essa política.

## Implementado nesta primeira entrega (código apenas)

1. Cadastro de aplicações HTTPS por usuário autenticado. A API recebe nome e
   origem pública, sem credenciais nem parâmetros. Retorna somente
   `sessionStatus: not_connected`, pois não há uma sessão verificada.
2. Permissão por bot `view` ou `operate`, negada por padrão, apenas para bots
   pertencentes ao dono da aplicação. Concessão e revogação revalidam o dono
   no banco a cada gravação. Não existe concessão automática por handoff.
3. Auditoria sem conteúdo de páginas, cookies, senhas ou tokens.
4. Contratos e testes de isolamento de usuário, concessão indevida,
   validação de URLs e revogação.
5. Painel inicial de cadastro e permissões na página Bots (sem conectar).

## NÃO implementado / bloqueios explícitos

- **Não** existe login na aplicação cadastrada, status de sessão confirmado
  ou ferramenta para os bots navegarem nela. `operate` é uma concessão
  preparatória; nenhum bot recebe capacidade de navegador por ela.
- Multiempresa no mesmo banco **não está homologado**. Cada cliente externo
  precisa de instalação e fronteira de execução isolada até haver
  autorização `tenant_id` de ponta a ponta e mitigação do socket Docker.
- Um URL cadastrado não é autorização de rede. Antes de navegação real:
  validar DNS/IP/redirecionamentos e bloquear SSRF; aplicar firewall de saída
  do computador e política por bot, não apenas proxy de navegador.
- Sessões só serão conectadas por takeover humano após aprovação, protegidas
  por criptografia/armazenamento por cliente, com expiração e revogação real.
- Tarefas financeiras, publicações, exclusões e ações sensíveis exigem
  aprovação humana por operação; `operate` sozinho não basta.

## Critérios de aceite da entrega

- Não autenticado: API 401.
- Usuário B: não lista, não exclui e não concede acesso ao cadastro de A.
- Bot público/de outro usuário/gerenciado: concessão 403.
- Permissões inválidas e origem local/IP/HTTP com usuário/senha: 400.
- Revogação bloqueia acesso na consulta seguinte; cadastro nunca marca
  sessão conectada a partir de input do navegador.
- Migrations, typecheck, UI build, testes isolados e CI precisam passar antes
  de qualquer proposta de merge ou publicação.
