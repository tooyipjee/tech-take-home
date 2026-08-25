import { useEffect, useState } from "react";
import type { CapabilityDescriptor } from "@platform/sdk";
import { platform } from "../client.ts";

export function RegistryView() {
  const [capabilities, setCapabilities] = useState<CapabilityDescriptor[]>([]);

  useEffect(() => {
    platform.capabilities().then(setCapabilities).catch(() => setCapabilities([]));
  }, []);

  return (
    <>
      <h2>Capability registry</h2>
      <p className="hint">
        The reviewable surface. A new app is a new screen over these verbs; a new verb is a small
        declaration a human reads in full.
      </p>
      <table>
        <thead>
          <tr>
            <th>Capability</th>
            <th>Kind</th>
            <th>Scope</th>
            <th>Summary</th>
            <th>Declared policy</th>
          </tr>
        </thead>
        <tbody>
          {capabilities.map((capability) => (
            <tr key={capability.name}>
              <td>
                <code>{capability.name}</code>
              </td>
              <td>
                <span className={`badge ${capability.kind === "write" ? "warn" : ""}`}>
                  {capability.kind}
                </span>
              </td>
              <td>
                <code>{String(capability.policy.scope)}</code>
              </td>
              <td>{capability.summary}</td>
              <td>
                <pre>{JSON.stringify(capability.policy, null, 1)}</pre>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
