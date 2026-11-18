import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useEffect } from "react";
import { AppSidebar } from "@/components/app-sidebar/app-sidebar";
import { NoviAssistant } from "@/components/novi/novi-assistant";
import { PwaInstallBar } from "@/components/pwa/pwa-install-bar";
import { SelfHostBanner } from "@/components/layout/self-host-banner";
import { SidebarShell } from "@/components/layout/sidebar-shell";
import { useActiveSkin } from "@/skins/registry";

export const Route = createFileRoute("/_authed/_app")({
  component: RouteComponent,
});

function RouteComponent() {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const sync = () => {
      const obscured = Math.max(
        0,
        window.innerHeight - viewport.height - viewport.offsetTop,
      );
      document.documentElement.style.setProperty(
        "--novabot-keyboard-inset",
        String(Math.round(obscured)) + "px",
      );
    };
    sync();
    viewport.addEventListener("resize", sync);
    viewport.addEventListener("scroll", sync);
    return () => {
      viewport.removeEventListener("resize", sync);
      viewport.removeEventListener("scroll", sync);
      document.documentElement.style.removeProperty("--novabot-keyboard-inset");
    };
  }, []);

  const { Frame } = useActiveSkin();

  if (Frame) {
    return (
      <Frame>
        <Outlet />
        <NoviAssistant />
      </Frame>
    );
  }

  return (
    <>
      {/* One viewport, never scrolls: panes scroll inside it. */}
      <SidebarShell
        className="novagente-chat-shell dark h-dvh overflow-hidden"
        width="340px"
      >
        <AppSidebar />
        <main className="flex-1 flex flex-col min-h-0 overflow-hidden">
          <SelfHostBanner />
          <PwaInstallBar />
          <Outlet />
        </main>
      </SidebarShell>
      <NoviAssistant />
    </>
  );
}
