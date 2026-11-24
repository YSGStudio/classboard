import type { AttachmentView } from "@/lib/types";

export function LinkCard({ a, compact }: { a: AttachmentView; compact?: boolean }) {
  const url = a.url ?? "";
  let domain = "";
  try {
    domain = new URL(url).hostname;
  } catch {}
  const p = a.preview;
  if (!p?.ok) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer nofollow" className="block truncate text-sm text-indigo-700 underline" data-testid="link-url-only">
        {url}
      </a>
    );
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="flex overflow-hidden rounded-xl border-2 border-edge bg-card hover:bg-slate-50"
      data-testid="link-card"
    >
      {p.image_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={p.image_url} alt="" className={`${compact ? "h-14 w-14" : "h-24 w-24"} shrink-0 object-cover`} referrerPolicy="no-referrer" loading="lazy" />
      )}
      <span className="flex min-w-0 flex-col p-2">
        <span className="line-clamp-2 text-sm font-bold text-slate-900">{p.title ?? url}</span>
        {!compact && p.description && <span className="line-clamp-2 text-xs text-slate-600">{p.description}</span>}
        <span className="truncate text-xs text-slate-500">{p.site_name ?? domain}</span>
      </span>
    </a>
  );
}
