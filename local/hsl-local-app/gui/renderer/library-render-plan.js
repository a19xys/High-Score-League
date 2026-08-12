export function applyLibraryPacksRenderPlan({
  currentTopologyKey,
  html,
  model,
  nextTopologyKey,
  region,
  regionRenderer,
  synchronize,
}) {
  let synchronization = null;
  if (currentTopologyKey === nextTopologyKey && region) {
    synchronization = synchronize(region, model);
    if (synchronization.ok) {
      regionRenderer.prime("library-packs", html);
      return { mode: "incremental", synchronization, wrote: false };
    }
    if (model?.kind === "cards") regionRenderer.forget("library-packs");
  }

  return {
    mode: "structural",
    synchronization,
    wrote: regionRenderer.render("library-packs", html),
  };
}
