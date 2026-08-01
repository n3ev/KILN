import { BrandSystem, StorefrontBuild } from "@kiln/contracts";
import type { ArtifactView } from "../../../../lib/view-contracts";

const label = (value: string) => value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ");

function ReadingValue({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (value === null || value === undefined) return <span className="k-reading-empty">Not supplied</span>;
  if (typeof value === "string") return <p>{value}</p>;
  if (typeof value === "number" || typeof value === "bigint") return <span className="k-reading-number">{value.toLocaleString()}</span>;
  if (typeof value === "boolean") return <span className="k-reading-number">{value ? "Yes" : "No"}</span>;
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="k-reading-empty">None</span>;
    return <ol className="k-reading-list">{value.map((item, index) => <li key={index}><ReadingValue value={item} depth={depth + 1} /></li>)}</ol>;
  }
  if (typeof value === "object") {
    return <dl className="k-reading-fields" data-depth={Math.min(depth, 3)}>{Object.entries(value).map(([key, item]) => <div key={key}><dt>{label(key)}</dt><dd><ReadingValue value={item} depth={depth + 1} /></dd></div>)}</dl>;
  }
  return <span>{String(value)}</span>;
}

function BrandReading({ content }: { content: unknown }) {
  const parsed = BrandSystem.safeParse(content);
  if (!parsed.success) return <ReadingValue value={content} />;
  const brand = parsed.data;
  return (
    <div className="k-brand-reading">
      <header><span>Chosen direction</span><h3>{brand.chosenName}</h3><p>{brand.visualDirection.brief}</p></header>
      <section><h4>Palette · {brand.tokens.palette.strategy}</h4><div className="k-brand-swatches">{brand.tokens.palette.ramps.flatMap((ramp) => ramp.stops.slice(0, 5).map((stop) => <div key={`${ramp.name}-${stop.step}`}><span style={{ backgroundColor: `oklch(${stop.colour.l} ${stop.colour.c} ${stop.colour.h})` }} /><small>{ramp.name} {stop.step}</small></div>))}</div></section>
      <section><h4>Type system</h4><p className="k-brand-display" style={{ fontFamily: brand.tokens.typePairing.display.family }}>{brand.tokens.typePairing.display.family} for display</p><p style={{ fontFamily: brand.tokens.typePairing.text.family }}>{brand.tokens.typePairing.text.family} for reading · {brand.tokens.typePairing.character.replace(/-/g, " ")}</p></section>
      <section><h4>Voice in one line</h4><blockquote>{brand.voice.writes[0]}</blockquote><p>{brand.voice.attributes.map((item) => `${item.attribute}: ${item.whichMeans}`).join(" · ")}</p></section>
    </div>
  );
}

function StorefrontReading({ content }: { content: unknown }) {
  const parsed = StorefrontBuild.safeParse(content);
  if (!parsed.success) return <ReadingValue value={content} />;
  const build = parsed.data;
  let previewUrl: string | undefined;
  if (build.storefrontUrl) {
    try {
      const url = new URL(build.storefrontUrl);
      if (url.protocol === "https:" || url.protocol === "http:") previewUrl = url.href;
    } catch { /* the contract report remains available below */ }
  }
  return (
    <div className="k-storefront-reading">
      <header><h3>{build.provider} storefront</h3><p>{build.sandbox ? "Sandbox surface" : "Live surface"} · {build.pages.length} pages · {build.payments.testModeVerified ? "test checkout verified" : `${build.payments.provider} checkout`}</p></header>
      {previewUrl ? <><iframe title="Storefront artifact preview" src={previewUrl} sandbox="" referrerPolicy="no-referrer" loading="lazy" /><a href={previewUrl} target="_blank" rel="noreferrer">Open storefront in a new tab</a></> : null}
      <ReadingValue value={{ pages: build.pages, navigation: build.navigation, shipping: build.shipping, tax: build.tax }} />
    </div>
  );
}

export function ArtifactReading({ artifact }: { artifact: ArtifactView }) {
  if (artifact.type === "brand_system") return <BrandReading content={artifact.content} />;
  if (artifact.type === "storefront_build") return <StorefrontReading content={artifact.content} />;
  return <ReadingValue value={artifact.content} />;
}
