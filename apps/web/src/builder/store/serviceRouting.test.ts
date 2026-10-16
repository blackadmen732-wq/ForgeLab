import { describe, expect, it } from "vitest";
import { vec3, transform, QuaternionMath } from "@forgelab/shared";
import { getComponentDefinition } from "@forgelab/reactor-components";
import {
  SimulationWorld,
  deserializeWorld,
  planServiceRoutes,
  preflight,
  routeEnd,
  serializeWorld,
} from "@forgelab/sim-core";
import { EditorStore } from "./editor.js";
function fixture(blockAtPort = false) {
  const world = new SimulationWorld();
  world.addComponent(
    getComponentDefinition("grid-connection").createSpec({
      id: "grid",
      transform: transform(vec3(-8, 1.2, 0)),
    }),
  );
  world.addComponent(
    getComponentDefinition("coolant-pump").createSpec({
      id: "pump",
      transform: transform(vec3(8, 1, 0), QuaternionMath.fromAxisAngle(vec3(0, 1, 0), Math.PI / 2)),
    }),
  );
  world.addComponent(
    getComponentDefinition("equipment-block").createSpec({
      id: "block",
      dimensions: { sizeM: 3 },
      transform: transform(vec3(blockAtPort ? -6.8 : 0, 1.5, 0)),
    }),
  );
  const store = new EditorStore(world);
  const join = (port = "power") => {
    store.pickSocket({ componentId: "grid", connectionPointId: "power" });
    store.pickSocket({ componentId: "pump", connectionPointId: port });
  };
  return { store, join };
}
describe("route validation in the real editor", () => {
  it("rejects an obstructed service transaction without adding history, geometry or a solver link", () => {
    const { store, join } = fixture(true),
      before = serializeWorld(store.world);
    join();
    expect(store.world.listConnections()).toHaveLength(0);
    expect(serializeWorld(store.world)).toEqual(before);
    expect(store.getView().canUndo).toBe(false);
    expect(store.getView().connectFrom?.componentId).toBe("grid");
    join("inlet");
    expect(store.world.listConnections()).toHaveLength(0);
  });
  it("revalidates after editing, keeps invalid legacy links explicit, and restores on undo", () => {
    const { store, join } = fixture();
    join();
    expect(store.getView().serviceRoutes[0]?.state).toBe("clear");
    const file = serializeWorld(store.world);
    store.setPosition("block", vec3(-6.8, 1.5, 0));
    const view = store.getView();
    expect(view.serviceRoutes[0]?.state).toBe("blocked");
    expect(store.world.listConnections()).toHaveLength(1);
    const report = preflight(view.snapshot.components, view.snapshot.connections, [], {
      serviceRoutes: view.serviceRoutes,
    });
    expect(report.items).toContainEqual(
      expect.objectContaining({ code: "SERVICE_ROUTE_BLOCKED", severity: "warning" }),
    );
    expect(report.canActivate).toBe(true);
    store.select(["block"]);
    store.hideSelected();
    expect(store.getView().serviceRoutes[0]?.state).toBe("blocked");
    store.undo();
    expect(serializeWorld(store.world)).toEqual(file);
    expect(store.getView().serviceRoutes[0]?.state).toBe("clear");
    const id = store.world.listConnections()[0]!.id;
    store.disconnect(id);
    expect(store.world.listConnections()).toHaveLength(0);
    expect(store.getView().serviceRoutes).toEqual([]);
  });
  it("uses actual transformed endpoints and deterministic routes after save/reload without mutating physics", () => {
    const { store, join } = fixture();
    join();
    const c = store.world.requireComponent("pump");
    store.moveComponents(
      [
        {
          id: c.id,
          position: vec3(9, 1, 2),
          rotation: QuaternionMath.fromAxisAngle(vec3(0, 1, 0), 0),
        },
      ],
      true,
    );
    expect(store.getView().serviceRoutes[0]!.points.at(-1)).toEqual(
      routeEnd(store.world.requireComponent("pump"), "power")!.position,
    );
    const file = store.exportFile(),
      routes = store.getView().serviceRoutes;
    const restored = deserializeWorld(file);
    restored.solve();
    const before = serializeWorld(restored);
    expect(
      planServiceRoutes(
        restored.listComponents(),
        restored.listConnections(),
        restored.settings.groundLevelM,
      ),
    ).toEqual(routes);
    expect(
      planServiceRoutes(
        [...restored.listComponents()].reverse(),
        [...restored.listConnections()].reverse(),
        restored.settings.groundLevelM,
      ),
    ).toEqual(routes);
    expect(serializeWorld(restored)).toEqual(before);
  });
});
