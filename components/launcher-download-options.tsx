export function LauncherDownloadOptions() {
  return (
    <div
      aria-label="Descargar launcher"
      className="mt-6 grid w-full max-w-xl gap-3 sm:grid-cols-2"
    >
      <a
        aria-label="Descargar launcher para Windows de 64 bits"
        className="inline-flex min-h-16 items-center gap-3 rounded-lg bg-circuit px-5 py-3 text-left text-ink shadow-panel transition hover:bg-circuit/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-circuit focus-visible:ring-offset-2"
        href="/download/launcher/windows"
      >
        <img
          alt=""
          aria-hidden="true"
          className="h-8 w-8 shrink-0 object-contain"
          height="32"
          src="/icons/platform-windows.png"
          width="32"
        />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold">Descargar para Windows</span>
          <span className="mt-1 block text-xs font-semibold text-ink/75">Windows 64 bits</span>
        </span>
      </a>

      <div
        aria-disabled="true"
        className="inline-flex min-h-16 items-center gap-3 rounded-lg border px-5 py-3 theme-border theme-surface-muted"
      >
        <img
          alt=""
          aria-hidden="true"
          className="h-8 w-8 shrink-0 object-contain"
          height="32"
          src="/icons/platform-gnu-linux.png"
          width="32"
        />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold theme-text">GNU/Linux</span>
          <span className="mt-1 block text-xs font-semibold theme-text-muted">Próximamente</span>
        </span>
      </div>
    </div>
  );
}
