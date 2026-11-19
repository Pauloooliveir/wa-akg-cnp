# WA-AKG — versão CNP

Fork de [mrifqidaffaaditya/WA-AKG](https://github.com/mrifqidaffaaditya/WA-AKG) fixado no commit
`2ba6ada` (v1.7.1-beta.3), revisado e ajustado para o Disparador CNP. Uso: um chip dedicado,
postando texto, imagem e link nos grupos do evento, chamado só pelo painel (servidor a servidor).

## O que mudou em relação ao original

- **Sem telemetria:** removido o envio a cada 30 s para o servidor do autor.
- **Sem comandos de bot** (`#sticker`, `#ping`…), auto-resposta e ppguard.
- **Sem histórico completo** (`syncFullHistory: false`) e **sem baixar mídia recebida**
  (só com `STORE_MEDIA=true`).
- **Cadastro público sempre fechado** (403), a menos que `ALLOW_REGISTRATION=true`.
- **Login com trava:** 5 senhas erradas no mesmo e-mail bloqueiam por 15 minutos.
- **Postgres** no lugar do MySQL (schema e Dockerfile).
- **Prévia de link:** `link-preview-js@3.2.0` adicionado.
- **Dockerfile corrigido:** o original nunca funcionava em produção (com `NODE_ENV=production` o
  `npm ci` e o reinstall pulavam `prisma`/`tsx`, e o `npx` baixava um Prisma 8 rc sem versão fixa).
  Agora instala as devDependencies do lockfile, não faz prune e usa `npx --no-install`.
- Removidos arquivos de teste, logs e mídias do autor.
- **Grupos sempre atualizados:** grupo em que o chip entra depois de conectado é gravado na hora
  (`groups.upsert` e `group-participants.update`); grupos de que o chip saiu são apagados; e
  `GET /api/groups/{id}?refresh=1` busca a lista no WhatsApp antes de responder.
- **Transmissão em blocos:** opção "Pausar entre blocos de envio" na página Transmissão (enviar por X
  min, pausar Y min, repetir até acabar a lista; 1–1440 min) e no `POST /api/messages/{id}/broadcast`
  com `pauseAfterMinutes` + `pauseMinutes`. Intervalo entre mensagens vai até 60 s. A cada envio o
  socket é buscado de novo e, se a sessão caiu, espera até 2 min pela reconexão. Limite: a fila roda na
  memória do servidor — um deploy/restart no meio interrompe a transmissão (fica "running"/"paused" no histórico).
- **Exportar participantes dos grupos:** botão "Exportar participantes" na página Grupos (todos, os
  marcados ou os do filtro) e `GET /api/groups/{id}/export?jids=a@g.us,b@g.us&format=csv|json`.
  CSV com `grupo;grupo_jid;telefone;nome;admin;id_whatsapp`, uma linha por pessoa por grupo.
  Com a sessão conectada, atualiza os participantes no WhatsApp antes. Quem o WhatsApp mostra só
  como `…@lid` tem o número buscado no mapa LID→número da sessão e nos contatos; sem isso, sai sem
  telefone (o total aparece no aviso e no cabeçalho `X-Export-Missing-Phone`).

## Variáveis no Railway

| Variável | Valor |
|---|---|
| `DATABASE_URL` | Postgres do Railway |
| `AUTH_SECRET` | 64+ caracteres aleatórios (nunca trocar: derruba a sessão) |
| `ENCRYPTION_KEY` | 64+ caracteres aleatórios (criptografa a sessão do WhatsApp; nunca trocar) |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | admin criado no primeiro boot (senha forte) |
| `BASE_URL` | URL pública do serviço |

Depois do primeiro acesso: criar um usuário **USER** dono da sessão do chip C e usar a API key
dele no painel (não a do SUPERADMIN). Fazer backup do banco.

## Endpoints usados pelo painel (`X-API-Key`)

- `POST /api/sessions` · `GET /api/sessions/{id}` · `GET /api/sessions/{id}/qr`
- `GET /api/groups/{id}`
- `POST /api/messages/{id}/{jid}/send` — `{"message":{"text":"…"}}` ou
  `{"message":{"image":{"url":"https://…"},"caption":"…"}}`
