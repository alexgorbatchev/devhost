import type { IRoutingConfig } from "../../shared/types";

export function updateInjectedRouting(routing: IRoutingConfig | undefined, injectedConfig: unknown): void {
  if (routing === undefined || typeof injectedConfig !== "object" || injectedConfig === null) return;
  Reflect.set(injectedConfig, "primaryService", routing.primaryService);
  Reflect.set(
    injectedConfig,
    "routedServices",
    routing.routedServices.map((route) => ({ ...route })),
  );
}
