import { describe, expect, it } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { SERVER_NAME, createMcpServer, startStdioServer } from "@/mcp";
import pkg from "../../package.json" with { type: "json" };

describe("mcp/server", () => {
  it("createMcpServer advertises the dennoh name and package version", async () => {
    // Drive a real client handshake over a linked in-memory transport so we
    // read the identity the server actually reports during `initialize`.
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createMcpServer();
    const serving = startStdioServer(server, serverTransport);

    const client = new Client({ name: "test-client", version: "0.0.0" });
    await client.connect(clientTransport);

    expect(client.getServerVersion()).toEqual({ name: SERVER_NAME, version: pkg.version });

    await client.close();
    // startStdioServer resolves only once the connection closes; awaiting it
    // here confirms the close path fires (and would hang the test otherwise).
    await serving;
  });

  it("startStdioServer stays pending until the transport closes", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createMcpServer();
    const serving = startStdioServer(server, serverTransport);

    const client = new Client({ name: "test-client", version: "0.0.0" });
    await client.connect(clientTransport);

    // Race the serving promise against a microtask: while connected it must not
    // have resolved yet.
    const pending = Symbol("pending");
    const raced = await Promise.race([serving.then(() => "resolved"), Promise.resolve(pending)]);
    expect(raced).toBe(pending);

    await client.close();
    await serving;
  });
});
