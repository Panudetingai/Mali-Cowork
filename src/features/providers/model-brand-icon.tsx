import { cn } from "@/lib/utils";
import { apiModelOf, type AiModel } from "@/pages/chat/models";
import { ModelIcon, modelMappings } from "@lobehub/icons";
import { useMemo } from "react";
import { brandLogoForModelName } from "./model-logo";
import { ProviderLogo } from "./provider-logo";

function modelSlug(model: Pick<AiModel, "id" | "name">) {
  return apiModelOf(model.id)?.model ?? model.name;
}

function mappingFor(slug: string) {
  const model = slug.toLowerCase();
  return modelMappings.find((item) => item.keywords.some((keyword) => new RegExp(keyword, "i").test(model)));
}

export { brandLogoForModelName } from "./model-logo";

type Props = {
  model: Pick<AiModel, "id" | "name" | "provider">;
  className?: string;
  size?: number;
};

/**
 * Model row icon: Lobe model art when we know the family, else the provider
 * brand, else a neutral sparkle only when nothing else fits.
 */
export function ModelBrandIcon({ model, className, size = 16 }: Props) {
  const slug = modelSlug(model);
  const hasModelArt = useMemo(() => !!mappingFor(slug), [slug]);
  const providerLogo = brandLogoForModelName(slug, model.provider);

  if (hasModelArt) {
    return (
      <span className={cn("flex shrink-0 items-center justify-center", className)} aria-hidden>
        <ModelIcon model={slug} type="color" size={size} />
      </span>
    );
  }

  return (
    <ProviderLogo
      logo={providerLogo}
      name={model.name}
      className={cn("shrink-0", className)}
      size={size}
    />
  );
}
