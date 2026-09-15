# Convites de usuários

O convite é enviado pelo Supabase Auth, mas o usuário precisa concluir duas etapas:

1. abrir o link recebido;
2. criar uma senha na tela `/auth/set-password`.

Criar um usuário manualmente em **Authentication → Users** autentica a conta,
mas não cria o vínculo com uma organização. Para que ele veja os dados, use o
convite pela tela de Configurações ou associe o usuário a uma organização como
`organization_member`.

## Configuração obrigatória no Supabase

Em **Authentication → URL Configuration**:

- defina o **Site URL** para a URL pública do WEE;
- adicione `https://seu-dominio.com/auth/complete*`, `https://seu-dominio.com/auth/callback*` e `https://seu-dominio.com/auth/confirm*` em **Redirect URLs**.

Para convites enviados diretamente em **Authentication → Users → Send invitation**, configure o template **Invite user** com:

```text
{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite&next=/auth/set-password
```

Convites enviados pela tela de usuários passam automaticamente `redirectTo=/auth/complete?next=/auth/set-password` e funcionam com o fluxo padrão do Supabase.
