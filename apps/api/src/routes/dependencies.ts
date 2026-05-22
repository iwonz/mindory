import { ApiError } from "../errors.js";

export interface RouteDependencyOptions {
  allowDependencyFreeRoutes?: boolean;
}

export function assertRouteDependencies(
  routeSet: string,
  dependencies: RouteDependencyOptions,
  required: Array<[name: string, value: unknown]>
): void {
  if (dependencies.allowDependencyFreeRoutes === true) {
    return;
  }

  const missing = required
    .filter(([, value]) => value === undefined || value === null)
    .map(([name]) => name);
  if (missing.length > 0) {
    throw new Error(`${routeSet} require runtime dependencies: ${missing.join(", ")}.`);
  }
}

export function requireRouteDependency<T>(value: T | undefined | null, name: string): T {
  if (value === undefined || value === null) {
    throw new ApiError(500, "api_dependency_missing", `${name} runtime dependency is not registered.`);
  }
  return value;
}
