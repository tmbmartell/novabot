import { IconKey, IconLockOff, IconPlus, IconShieldLock, IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
  PageEmpty,
  PageRows,
  PageSection,
  PageShell,
} from "@/components/layout/page-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Separator } from "@/components/ui/separator";
import {
  deleteSavedLoginMutationOptions,
  saveManualLoginMutationOptions,
} from "@/lib/passwords/mutations";
import { savedLoginsQueryOptions } from "@/lib/passwords/queries";
import { queryClient } from "@/query-client";

export const Route = createFileRoute("/_authed/settings/passwords")({
  component: PasswordsPage,
});

/**
 * The owner's password manager. No secret is ever read back into the page:
 * the GET response contains only site, username and timestamps.
 *
 * Adding a login does not sign a Bot in or allow unattended use. The person
 * chooses a saved login on the separate sign-in request whenever it is needed.
 */
function PasswordsPage() {
  const logins = useQuery(savedLoginsQueryOptions());
  const remove = useMutation(deleteSavedLoginMutationOptions(queryClient));
  const save = useMutation(saveManualLoginMutationOptions(queryClient));
  const [adding, setAdding] = useState(false);
  const [site, setSite] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const canSave = logins.data?.passwordManager === true;

  function clearForm() {
    setSite("");
    setUsername("");
    setPassword("");
    setAdding(false);
  }

  return (
    <PageShell
      title="Cofre de senhas"
      description="Seus acessos, protegidos e separados dos de outros usuários. O agente só poderá usar um login quando você confirmar."
      action={
        <Button
          size="sm"
          variant="outline"
          disabled={!canSave}
          onClick={() => {
            if (adding) clearForm();
            else setAdding(true);
          }}
        >
          <IconPlus />
          {adding ? "Cancelar" : "Adicionar login"}
        </Button>
      }
    >
      {adding && canSave ? (
        <PageSection title="Adicionar login com segurança">
          <form
            autoComplete="off"
            onSubmit={(event) => {
              event.preventDefault();
              if (save.isPending) return;
              save.mutate(
                { site, username, password },
                { onSuccess: clearForm },
              );
            }}
            className="rounded-2xl border border-border bg-card p-5 shadow-sm"
          >
            <div className="mb-5 flex items-start gap-3">
              <div className="rounded-xl bg-primary/10 p-2 text-primary">
                <IconShieldLock className="size-5" />
              </div>
              <p className="max-w-xl text-muted-foreground text-sm">
                Salve o endereço, o usuário e a senha. Ela será criptografada no servidor,
                nunca aparecerá no histórico da conversa e não será mostrada novamente.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5 text-sm sm:col-span-2">
                <span className="font-medium">Site</span>
                <Input
                  required
                  autoComplete="off"
                  placeholder="https://instagram.com"
                  value={site}
                  onChange={(event) => setSite(event.target.value)}
                  maxLength={2048}
                />
              </label>
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">Login ou e-mail</span>
                <Input
                  required
                  autoComplete="off"
                  placeholder="seu.usuario"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  maxLength={512}
                />
              </label>
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">Senha</span>
                <Input
                  required
                  type="password"
                  autoComplete="new-password"
                  placeholder="Digite sua senha"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  maxLength={4096}
                />
              </label>
            </div>
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
              <p className="max-w-md text-muted-foreground text-xs">
                Para sua proteção, o cadastro manual aceita apenas sites HTTPS.
                Salvar não inicia uma sessão automaticamente.
              </p>
              <Button
                type="submit"
                disabled={save.isPending || !site.trim() || !username.trim() || !password}
              >
                {save.isPending ? "Salvando…" : "Salvar no cofre"}
              </Button>
            </div>
            {save.error ? (
              <p className="mt-3 text-destructive text-sm" role="alert">
                Não foi possível salvar. Verifique os dados e tente novamente.
              </p>
            ) : null}
          </form>
        </PageSection>
      ) : null}
      <PageSection title="Logins salvos">
        {logins.isPending ? null : logins.error ? (
          <p className="text-destructive text-sm" role="alert">
            Não foi possível carregar suas senhas. Recarregue a página.
          </p>
        ) : !logins.data.passwordManager ? (
          <PageEmpty icon={IconLockOff} title="Cofre desativado">
            Um administrador desativou senhas salvas. Os logins permanecem
            protegidos e não serão oferecidos aos agentes.
          </PageEmpty>
        ) : logins.data.logins.length === 0 ? (
          <PageEmpty icon={IconKey} title="Seu cofre está vazio">
            Clique em Adicionar login para guardar seu primeiro acesso.
          </PageEmpty>
        ) : (
          <PageRows>
            {logins.data.logins.map((login, index) => (
              <div key={login.id}>
                {index > 0 ? <Separator /> : null}
                <Item size="sm">
                  <ItemMedia variant="icon">
                    <IconKey />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>{login.origin}</ItemTitle>
                    <ItemDescription>
                      {login.username}
                      {login.lastUsedAt
                        ? ` · último uso ${new Date(login.lastUsedAt).toLocaleDateString("pt-BR")}`
                        : " · nunca usado"}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Button
                      aria-label={`Excluir login de ${login.origin}`}
                      size="sm"
                      variant="ghost"
                      disabled={remove.isPending}
                      onClick={() => remove.mutate(login.id)}
                    >
                      <IconTrash />
                    </Button>
                  </ItemActions>
                </Item>
              </div>
            ))}
          </PageRows>
        )}
        {remove.error ? (
          <p className="mt-2 text-destructive text-sm" role="alert">
            Não foi possível excluir o login. Tente novamente.
          </p>
        ) : null}
      </PageSection>
    </PageShell>
  );
}
