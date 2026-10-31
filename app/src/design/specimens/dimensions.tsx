import { useState } from "react";
import { DimensionControlsEditor } from "../../DimensionControlsEditor";

const dimensions = [
  { id: "dim-1", leftLabel: "克制", rightLabel: "张扬" },
  { id: "dim-2", leftLabel: "抽象", rightLabel: "具象" },
];

/** B7 · 维度位置控件：真实 DimensionControlsEditor（中点向两侧延伸）。 */
export function DimensionControlsSpecimen() {
  const [values, setValues] = useState<Record<string, number>>({ "dim-1": 700, "dim-2": 320 });
  return (
    <div className="max-w-[440px] rounded-lg border border-line bg-surface p-4">
      <DimensionControlsEditor
        dimensions={dimensions}
        values={values}
        assetId="design-system-preview"
        busy={false}
        onChangeValue={(_, dimensionId, value) => setValues((current) => ({ ...current, [dimensionId]: value }))}
        onSaveValue={async () => {}}
      />
    </div>
  );
}
