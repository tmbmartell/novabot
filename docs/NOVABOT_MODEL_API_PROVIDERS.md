# NovaBot — cadastro de API Keys de provedores de IA

Primeira entrega: a administração oferece escolha de OpenAI, Claude (Anthropic),
Kimi/Moonshot, MiniMax, Gemini/Google, DeepSeek e OpenRouter. Usa o cofre
AES-GCM já existente e a rota exclusiva de administrador para credenciais.
O segredo nunca aparece nas respostas de listagem.

A instalação permite várias chaves por provedor em IDs diferentes.
Substituir o mesmo ID revoga a anterior.

IMPORTANTE: guardar uma API Key não significa que ela já foi vinculada
ao modelo de um bot. A execução corrente é nativa OpenAI/Anthropic.
Os provedores compatíveis dependem de roteamento e permissão por bot
em um próximo ciclo. A criação de chave não altera a API global da VPS.

OAuth difere de uma API Key: o login no ChatGPT não é chave da API OpenAI.
Somente implementar fluxos OAuth oficiais quando houver suporte, consentimento,
escopos e renovação próprios para aplicativos de terceiros.

Próximos ciclos: seleção de modelo por bot, teste de conexão sem vazar
segredos, limites de gasto, isolamento por cliente e revogação de sessões.
