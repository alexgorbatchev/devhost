import type { IRoutedServiceIdentity } from "../../shared/routedServices";
import type { IRoutingConfig } from "../../shared/types";

// Returns the injected configuration with the stack's current routing. Readers tell a change by the object's
// identity, so new routing produces a copy and unchanged routing returns the same object.
export function updateInjectedRouting(routing: IRoutingConfig | undefined, injectedConfig: unknown): unknown {
  if (routing === undefined || typeof injectedConfig !== "object" || injectedConfig === null) {
    return injectedConfig;
  }

  if (isCurrentRouting(routing, injectedConfig)) {
    return injectedConfig;
  }

  return {
    ...injectedConfig,
    primaryService: routing.primaryService,
    routedServices: routing.routedServices.map((route: IRoutedServiceIdentity): IRoutedServiceIdentity => {
      return { ...route };
    }),
  };
}

function isCurrentRouting(routing: IRoutingConfig, injectedConfig: object): boolean {
  const routedServices: unknown = Reflect.get(injectedConfig, "routedServices");

  return (
    Reflect.get(injectedConfig, "primaryService") === routing.primaryService &&
    Array.isArray(routedServices) &&
    routedServices.length === routing.routedServices.length &&
    routing.routedServices.every((route: IRoutedServiceIdentity, index: number): boolean => {
      const currentRoute: unknown = routedServices[index];

      return (
        typeof currentRoute === "object" &&
        currentRoute !== null &&
        Reflect.get(currentRoute, "host") === route.host &&
        Reflect.get(currentRoute, "path") === route.path &&
        Reflect.get(currentRoute, "serviceName") === route.serviceName
      );
    })
  );
}
