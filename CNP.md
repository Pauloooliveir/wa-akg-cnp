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
- **Prévia de link:** `link-preview-js@3.2.0` adicionado; `tsx`/`typescript` fixados no Dockerfile.
- Removidos arquivos de teste, logs e mídias do autor.

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
