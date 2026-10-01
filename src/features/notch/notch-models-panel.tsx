/**
 * Model picker for the notch — mounted only while the list is open so CLI
 * agent checks and the full catalog are not kept alive on every pill state.
 */
import { useNotchCatalog } from "./use-notch-catalog";
import { NotchModels } from "./notch-models";

type Props = {
  inFolder: boolean;
  selected: string | null;
  defaultName: string;
  onPick: (id: string | null) => void;
  onClose: () => void;
};

export function NotchModelsPanel({ inFolder, selected, defaultName, onPick, onClose }: Props) {
  const { catalog, loading } = useNotchCatalog("cowork");
  return (
    <NotchModels
      catalog={catalog}
      inFolder={inFolder}
      loading={loading}
      selected={selected}
      defaultName={defaultName}
      onPick={onPick}
      onClose={onClose}
    />
  );
}
