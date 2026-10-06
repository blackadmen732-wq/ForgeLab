import { Workspace } from "./scene/Workspace.js";
import { FailureLog } from "./ui/FailureLog.js";
import { HazardLegend } from "./ui/HazardLegend.js";
import { Inspector } from "./ui/Inspector.js";
import { Palette } from "./ui/Palette.js";
import { Toolbar } from "./ui/Toolbar.js";

export function App() {
  return (
    <div className="app">
      <Toolbar />
      <main className="app__body">
        <Palette />
        <div className="app__viewport">
          <Workspace />
          <HazardLegend />
        </div>
        <Inspector />
      </main>
      <FailureLog />
    </div>
  );
}
