import { IconKey, IconLockOff, IconPlus, IconSearch, IconShieldLock, IconTrash } from "@tabler/icons-react";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  saveManualLogin,
} from "@/lib/passwords/mutations";
import { passwordKeys, savedLoginsQueryOptions } from "@/lib/passwords/queries";
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
  // Keep passwords out of React Query mutation cache: submit straight to the API.
  const [isSaving, setIsSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [adding, setAdding] = useState(false);
  const [site, setSite] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [filter, setFilter] = useState("");
  const [deleteCandidate, setDeleteCandidate] = useState<{ id: string; origin: string; username: string } | null>(null);

  const canSave = logins.data?.passwordManager === true;
  const allLogins = logins.data?.logins ?? [];
  const search = filter.trim().toLocaleLowerCase("pt-BR");
  const visibleLogins = search
    ? allLogins.filter((login) =>
        [login.origin, login.username].some((value) => value.toLocaleLowerCase("pt-BR").includes(search)),
      )
    : allLogins;
  // A saved login is unique by owner, origin and username. Warn before replacing it.
  let proposedOrigin: string | undefined;
  try {
    const address = site.trim();
    proposedOrigin = new URL(
      /^[a-z][a-z0-9+.-]*:\/\//i.test(address) ? address : "https://" + address,
    ).origin;
  } catch {
    proposedOrigin = undefined;
  }
  const replacing = allLogins.some(
    (login) => login.origin === proposedOrigin && login.username === username.trim(),
  );

  function clearForm() {
    setSaveFailed(false);
    setSite("");
    setUsername("");
    setPassword("");
    setAdding(false);
  }

  async function submitManualLogin() {
    if (isSaving) return;
    setSaveFailed(false);
    setIsSaving(true);
    try {
      await saveManualLogin({ site, username, password });
      await queryClient.invalidateQueries({ queryKey: passwordKeys.all });
      clearForm();
    } catch {
      setSaveFailed(true);
    } finally {
      setIsSaving(false);
    }
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
              void submitManualLogin();
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
            {replacing ? (
              <p className="mt-4 rounded-lg border border-amber-300/50 bg-amber-50/70 p-3 text-sm text-amber-950 dark:bg-amber-500/10 dark:text-amber-200">
                Esse login já está salvo. Ao continuar, você substituirá a senha anterior.
              </p>
            ) : null}
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
              <p className="max-w-md text-muted-foreground text-xs">
                Para sua proteção, o cadastro manual aceita apenas sites HTTPS.
                Salvar não inicia uma sessão automaticamente.
              </p>
              <Button
                type="submit"
                disabled={isSaving || !site.trim() || !username.trim() || !password}
              >
                {isSaving ? "Salvando…" : "Salvar no cofre"}
              </Button>
            </div>
            {saveFailed ? (
              <p className="mt-3 text-destructive text-sm" role="alert">
                Não foi possível salvar. Verifique os dados e tente novamente.
              </p>
            ) : null}
          </form>
        </PageSection>
      ) : null}
      <PageSection title="Logins salvos">
        {canSave && allLogins.length > 0 ? (
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative w-full sm:max-w-sm">
              <IconSearch aria-hidden="true" className="absolute top-2.5 left-3 size-4 text-muted-foreground" />
              <Input
                aria-label="Buscar logins salvos"
                autoComplete="off"
                className="pl-9"
                placeholder="Buscar por site ou usuário"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
              />
            </div>
            <span className="text-xs text-muted-foreground">
              {visibleLogins.length} de {allLogins.length} acessos
            </span>
          </div>
        ) : null}
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
        ) : visibleLogins.length === 0 ? (
          <PageEmpty icon={IconSearch} title="Nenhum login encontrado">
            Experimente outro termo de busca.
          </PageEmpty>
        ) : (
          <PageRows>
            {visibleLogins.map((login, index) => (
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
                      onClick={() => setDeleteCandidate({ id: login.id, origin: login.origin, username: login.username })}
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
      <Dialog
        open={deleteCandidate !== null}
        onOpenChange={(open) => { if (!open) setDeleteCandidate(null); }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir login salvo?</DialogTitle>
            <DialogDescription>
              O acesso de {deleteCandidate?.username} em {deleteCandidate?.origin} será removido do cofre.
              Essa ação não pode ser desfeita.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteCandidate(null)}>Cancelar</Button>
            <Button
              variant="destructive"
              disabled={remove.isPending || !deleteCandidate}
              onClick={() => {
                if (!deleteCandidate) return;
                remove.mutate(deleteCandidate.id, { onSuccess: () => setDeleteCandidate(null) });
              }}
            >
              {remove.isPending ? "Excluindo…" : "Excluir login"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
