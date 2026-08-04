/**
 * DOO Builders League connector contracts.
 *
 * These types define the shared standard every DOO connector must implement
 * (see requirements.md). Minimal typing for the scaffolding phase - hardened
 * types and full JSON Schemas arrive with T1.2 (Action Schema Design).
 */

/** Provider metadata as declared in connector.yaml. */
export interface ConnectorManifest {
  name: string;
  version: string;
  description?: string;
  provider: {
    name: string;
    version: string;
    type: string;
  };
  auth: {
    type: string;
    grantTypes: string[];
    scopes: string[];
  };
  actions: ConnectorAction[];
  capabilities?: Record<string, unknown>;
  risks?: string[];
}

/** Result of a testConnection() call. */
export interface ConnectionTestResult {
  success: boolean;
  message?: string;
  details?: unknown;
}

/** A single typed connector action (full schema refined in T1.2/S1.2.x). */
export interface ConnectorAction {
  id: string;
  name?: string;
  description?: string;
  type: 'read' | 'write';
  approval?: 'required' | 'optional';
  inputSchema?: unknown;
  outputSchema?: unknown;
  examples?: unknown[];
}

/** Result of execute(request). */
export interface ConnectorExecutionResult {
  success: boolean;
  data?: unknown;
  metadata?: Record<string, unknown>;
  error?: unknown;
}

/** Request contract passed to execute(). */
export interface ConnectorExecutionRequest {
  actionId: string;
  input: unknown;
  credentials?: unknown;
  metadata?: Record<string, unknown>;
}

/** The shared connector standard every DOO connector implements. */
export interface DooConnector {
  manifest: ConnectorManifest;
  testConnection(credentials: unknown): Promise<ConnectionTestResult>;
  listActions(): ConnectorAction[];
  execute(request: ConnectorExecutionRequest): Promise<ConnectorExecutionResult>;
}
