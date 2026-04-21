import { Mgr, TFunc } from "./types";
import TabOutputView from "./TabOutputView";
import MosaicOutputView from "./MosaicOutputView";

function OutputArea({ mgr, t }: { mgr: Mgr; t: TFunc }) {
  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      {mgr.viewMode === "tabs" ? (
        <TabOutputView mgr={mgr} t={t} />
      ) : (
        <MosaicOutputView mgr={mgr} t={t} />
      )}
    </div>
  );
}

export default OutputArea;
